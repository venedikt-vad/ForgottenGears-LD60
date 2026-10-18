import type { Input, InputKeyEvent } from '../Input'
import { FONT_FAMILY } from '../fonts'
import { playSfx } from '../sfx'
import { VirtualFileSystem } from '../VirtualFileSystem'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'
type EditorMode = 'NORMAL' | 'INSERT' | 'COMMAND' | 'SEARCH'
type Pane = 'files' | 'editor'
interface HitRect {
  x: number
  y: number
  width: number
  height: number
}
interface EditorPointerLayout {
  width: number
  height: number
  filePane: HitRect
  editorPane: HitRect
  fileList: HitRect & {
    lineHeight: number
    firstIndex: number
    visibleRows: number
  }
}
export interface CodeEditorOptions {
  fileSystem?: VirtualFileSystem
  initialPath?: string
  returnWindowId?: string
  onValidate?: (path: string, valid: boolean) => void
}
const DEFAULT_FILE = '/opt/firmware/motion/оптимизатор_акселерации_1.0.18.drv'
const INSTRUCTION_FILE = '/opt/firmware/motion/ИНСТРУКЦИЯ'
const RESTORE_COMMAND = 'RESTORE_MOTION_PROFILE()'
const EDITABLE_EXTENSION = /\.(drv|seq|cfg|txt|conf|asm|src|md)$/i

type SupplementalEditorFile = {
  path: string
  ru: string[]
  en: string[]
}

// Extra, read-only diagnostic documents shown in the editor's virtual file list.
// The underlying VirtualFileSystem is shared with the console, so these documents
// are provided as editor-local virtual files rather than mutating shared game data.
const SUPPLEMENTAL_EDITOR_FILES: SupplementalEditorFile[] = [
  {
    path: '/opt/firmware/diagnostics/BOOT_REPORT.LOG',
    ru: [
      'ОТЧЁТ ЗАГРУЗКИ / BOOT REPORT',
      '--------------------------------',
      'ЯДРО: DEGRADED',
      'ПИТАНИЕ: ДОСТУПНО',
      'MCM-740: PROFILE_CRC=FAILED',
      'ЗАДАЧА: ВОССТАНОВИТЬ ПРОФИЛЬ ДВИЖЕНИЯ',
      'ПЕРЕЗАПУСК ПЛАНИРОВЩИКА ОЖИДАЕТ ПРОВЕРКИ ПРОФИЛЯ.',
    ],
    en: [
      'BOOT REPORT',
      '--------------------------------',
      'KERNEL: DEGRADED',
      'POWER: AVAILABLE',
      'MCM-740: PROFILE_CRC=FAILED',
      'TASK: RESTORE MOTION PROFILE',
      'SCHEDULER RESTART IS WAITING FOR PROFILE VALIDATION.',
    ],
  },
  {
    path: '/opt/firmware/motion/PROFILE_README.TXT',
    ru: [
      'СПРАВКА ПРОФИЛЯ ДВИЖЕНИЯ',
      '-------------------------',
      'ПРОФИЛЬ УПРАВЛЕНИЯ НЕ ПРОШЁЛ ПРОВЕРКУ CRC.',
      'ДЛЯ ВОССТАНОВЛЕНИЯ ДОСТАТОЧНО ОДНОЙ КОМАНДЫ.',
      'КОМАНДА ДОЛЖНА БЫТЬ ЕДИНСТВЕННОЙ ИСПОЛНЯЕМОЙ СТРОКОЙ.',
      'СТРОКИ, НАЧИНАЮЩИЕСЯ С #, ЯВЛЯЮТСЯ КОММЕНТАРИЯМИ.',
    ],
    en: [
      'MOTION PROFILE README',
      '-------------------------',
      'THE MOTION PROFILE FAILED CRC VALIDATION.',
      'ONE COMMAND IS SUFFICIENT FOR RECOVERY.',
      'THE COMMAND MUST BE THE ONLY EXECUTABLE LINE.',
      'LINES STARTING WITH # ARE COMMENTS.',
    ],
  },
  {
    path: '/etc/robot/SAFETY_INTERLOCKS.CONF',
    ru: [
      'КОНФИГУРАЦИЯ БЛОКИРОВОК БЕЗОПАСНОСТИ',
      '-------------------------------------',
      'CRC_CHECK = TRUE',
      'REQUIRE_COOLING = TRUE',
      'ПРЕДУПРЕЖДЕНИЕ: НЕ ОТКЛЮЧАТЬ БЛОКИРОВКИ.',
      'ПРОВЕРКА БЕЗОПАСНОСТИ ВЫПОЛНЯЕТСЯ СИСТЕМОЙ АВТОМАТИЧЕСКИ.',
    ],
    en: [
      'SAFETY INTERLOCK CONFIGURATION',
      '-------------------------------------',
      'CRC_CHECK = TRUE',
      'REQUIRE_COOLING = TRUE',
      'WARNING: DO NOT DISABLE INTERLOCKS.',
      'SAFETY VALIDATION IS HANDLED AUTOMATICALLY.',
    ],
  },
  {
    path: '/var/log/MOTION_CONTROLLER_PREVIOUS.LOG',
    ru: [
      'ЖУРНАЛ КОНТРОЛЛЕРА ДВИЖЕНИЯ',
      '----------------------------',
      '[WARN] ПОЛУЧЕН ПРОФИЛЬ С НЕВЕРНЫМ CRC.',
      '[ERROR] КОМАНДЫ ДВИЖЕНИЯ ЗАБЛОКИРОВАНЫ.',
      '[INFO] ОЖИДАНИЕ ВОССТАНОВЛЕНИЯ MCM-740.',
    ],
    en: [
      'MOTION CONTROLLER PREVIOUS LOG',
      '----------------------------',
      '[WARN] PROFILE WITH INVALID CRC RECEIVED.',
      '[ERROR] MOTION COMMANDS ARE LOCKED.',
      '[INFO] WAITING FOR MCM-740 RECOVERY.',
    ],
  },
  {
    path: '/opt/firmware/sensors/SENSOR_MAP.CFG',
    ru: [
      'КАРТА ДАТЧИКОВ',
      '--------------',
      'IMU-430 = ORIENTATION / ACCELERATION',
      'FRC-440 = FORCE / TORQUE FEEDBACK',
      'CAM-410 = PRIMARY CAMERA ARRAY',
      'ДАННЫЕ ДАТЧИКОВ НЕ ЗАМЕНЯЮТ ПРОВЕРКУ ПРОФИЛЯ.',
    ],
    en: [
      'SENSOR MAP',
      '--------------',
      'IMU-430 = ORIENTATION / ACCELERATION',
      'FRC-440 = FORCE / TORQUE FEEDBACK',
      'CAM-410 = PRIMARY CAMERA ARRAY',
      'SENSOR DATA DOES NOT REPLACE PROFILE VALIDATION.',
    ],
  },
  {
    path: '/opt/firmware/archive/OLD_MOTION_PROFILE.BAK',
    ru: [
      'АРХИВНЫЙ ПРОФИЛЬ ДВИЖЕНИЯ',
      '-------------------------',
      'СТАТУС: УСТАРЕЛ',
      'CRC: INVALID',
      'ФАЙЛ ОСТАВЛЕН ДЛЯ СРАВНЕНИЯ.',
      'НЕ КОПИРОВАТЬ СОДЕРЖИМОЕ В АКТИВНЫЙ ПРОФИЛЬ.',
    ],
    en: [
      'ARCHIVED MOTION PROFILE',
      '-------------------------',
      'STATUS: OBSOLETE',
      'CRC: INVALID',
      'FILE RETAINED FOR COMPARISON.',
      'DO NOT COPY THIS CONTENT INTO THE ACTIVE PROFILE.',
    ],
  },
]
// Opening animation timings (seconds): both pane frames stretch from the center
// out to the sides, the text types itself in, then the file list fills in one
// row after another and the help panel fades up last.
const APPEAR_FRAME = 0.4
const APPEAR_TEXT_START = 0.4
const APPEAR_TEXT = 0.8
const APPEAR_FILES_START = 0.45
const APPEAR_FILE_STAGGER = 0.05
const APPEAR_FILE_ROW = 0.18
// Rows past this one share the delay so long file lists never drag the reveal out.
const APPEAR_FILE_STAGGER_CAP = 14
const APPEAR_FOOTER_START = 1.25
const APPEAR_FOOTER = 0.3
const APPEAR_TOTAL = APPEAR_FOOTER_START + APPEAR_FOOTER
function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}
/**
 * Canvas-based Vim-like editor for the in-game virtual filesystem.
 * File selection works with both the mouse and keyboard.
 */
export class CodeEditorWindow implements GameWindow {
  readonly id = 'editor'
  private manager: WindowManager | null = null
  private language: GameLanguage = 'ru'
  private readonly fileSystem: VirtualFileSystem
  private readonly returnWindowId: string
  private readonly onValidate?: (path: string, valid: boolean) => void
  private files: string[] = []
  private selectedFileIndex = 0
  private currentPath = ''
  private recoveryTargetPath = DEFAULT_FILE
  private buffer: string[] = ['']
  private savedText = ''
  private cursorRow = 0
  private cursorCol = 0
  private scrollTop = 0
  private fileScrollTop = 0
  private mode: EditorMode = 'NORMAL'
  private activePane: Pane = 'editor'
  private commandLine = ''
  private lastCommand = ''
  private searchQuery = ''
  private searchMatches: Array<{ row: number; col: number }> = []
  private searchIndex = -1
  private pendingNormalKey = ''
  private yankLine = ''
  private undoStack: string[][] = []
  private checkedBufferText: string | null = null
  // Last :check verdict, pinned to the bottom of the source pane until another
  // file is opened. `text` is the buffer that was checked, used to flag edits.
  private checkResult: { ok: boolean; detail: string; text: string } | null = null
  private showLineNumbers = true
  private blinkClock = 0
  private message = 'NORMAL  |  :help — справка по клавишам'
  private messageIsError = false
  private appearTime = APPEAR_TOTAL
  private openedThisFrame = false
  private readonly maxUndo = 80
  private pointerCanvas: HTMLCanvasElement | null = null
  private pointerListenersAttached = false
  private pointerLayout: EditorPointerLayout | null = null
  private readonly onCanvasPointerDown = (event: PointerEvent): void => {
    this.handleCanvasPointer(event, false)
  }
  private readonly onCanvasDoubleClick = (event: MouseEvent): void => {
    this.handleCanvasPointer(event, true)
  }
  constructor(options: CodeEditorOptions = {}) {
    this.fileSystem = options.fileSystem ?? new VirtualFileSystem()
    this.returnWindowId = options.returnWindowId ?? 'ui'
    this.onValidate = options.onValidate
    this.refreshFileList()
    const wanted = options.initialPath ?? INSTRUCTION_FILE
    const initial = this.files.findIndex((path) => path.toLowerCase() === wanted.toLowerCase())
    this.selectedFileIndex = initial >= 0 ? initial : 0
    if (this.files[this.selectedFileIndex]) this.loadFile(this.files[this.selectedFileIndex]!)
  }
  setLanguage(language: GameLanguage): void {
    this.language = language
    if (!this.isDirty()) {
      this.loadFile(this.currentPath || this.files[this.selectedFileIndex] || '')
    }
  }
  onShow(manager: WindowManager): void {
    this.manager = manager
    // Replay the appear animation each time the window is opened.
    this.appearTime = 0
    this.openedThisFrame = true
    this.refreshFileList()
    if (!this.currentPath && this.files.length) {
      this.loadFile(this.files[this.selectedFileIndex]!)
    }
  }
  /** Open a virtual file. Returns false if it does not exist or edits would be lost. */
  openFile(path: string, force = false): boolean {
    if (this.isDirty() && !force) {
      this.setMessage(
        this.language === 'ru'
          ? 'Есть несохранённые изменения. Используйте :w или :e! <путь>.'
          : 'Unsaved changes. Use :w or :e! <path>.',
        true,
      )
      return false
    }
    const normalized = path.trim().replace(/\\/g, '/').toLowerCase()
    const resolved = this.files.find((entry) => entry.toLowerCase() === normalized)
    if (!resolved || !this.readEditorFile(resolved)) {
      this.setMessage(
        this.language === 'ru' ? `ФАЙЛ НЕ НАЙДЕН: ${path}` : `FILE NOT FOUND: ${path}`,
        true,
      )
      return false
    }
    this.loadFile(resolved)
    return true
  }
  update(_dt: number, input: Input): void {
    this.blinkClock += _dt
    this.appearTime += _dt
    const events = input.getPressedKeyEvents()
    // The key that opened the window must not skip its own animation.
    if (this.openedThisFrame) {
      this.openedThisFrame = false
    } else if (this.appearTime < APPEAR_TOTAL && events.length) {
      // Any later key jumps straight to the finished layout.
      this.appearTime = APPEAR_TOTAL
      return
    }
    // Input is locked while the opening animation plays.
    if (this.appearTime < APPEAR_TOTAL) return
    for (const event of events) {
      if (this.mode === 'INSERT') {
        this.handleInsertKey(this.normalizeEditorInputKey(event))
      } else if (this.mode === 'COMMAND' || this.mode === 'SEARCH') {
        this.handleCommandLineKey(event.key.length === 1 ? event.key.toUpperCase() : event.key)
      } else {
        this.handleNormalKey(this.normalizeNormalModeKey(event))
      }
    }
  }
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.attachPointerInput(ctx.canvas)
    ctx.save()
    ctx.fillStyle = '#241200'
    ctx.fillRect(0, 0, width, height)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const margin = width < 620 ? 8 : 15
    const fontSize = width < 500 ? 10 : width < 900 ? 11 : 13
    const lineHeight = Math.ceil(fontSize * 1.48)
    const tinyFont = `${Math.max(8, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    const normalFont = `${fontSize}px "${FONT_FAMILY}", monospace`
    const boldFont = `bold ${fontSize}px "${FONT_FAMILY}", monospace`
    // Opening animation progress values.
    const frameProgress = easeOut(clamp01(this.appearTime / APPEAR_FRAME))
    const textProgress = clamp01((this.appearTime - APPEAR_TEXT_START) / APPEAR_TEXT)
    const footerAlpha = clamp01((this.appearTime - APPEAR_FOOTER_START) / APPEAR_FOOTER)
    // Reserve a larger, single help panel at the bottom. Narrow screens get
    // extra height because the longer help lines may wrap.
    const compactFooterLayout = width < 700
    const bodyTop = Math.max(8, margin)
    const footerHeight = Math.min(
      Math.max(150, Math.floor(height * 0.48)),
      compactFooterLayout ? 290 : 230,
    )
    const bodyBottom = Math.max(bodyTop + lineHeight * 5, height - footerHeight - 9)
    const bodyHeight = bodyBottom - bodyTop
    const filePaneWidth = Math.max(150, Math.min(width * 0.31, width - 200))
    const dividerX = margin + filePaneWidth
    const fileX = margin
    const fileWidth = filePaneWidth - 10
    const codeX = dividerX + 12
    const codeWidth = Math.max(50, width - codeX - margin)
    this.drawPaneFrame(ctx, fileX - 3, bodyTop, fileWidth + 4, bodyHeight, this.activePane === 'files', frameProgress)
    this.drawPaneFrame(ctx, codeX - 4, bodyTop, codeWidth + 4, bodyHeight, this.activePane === 'editor', frameProgress)
    ctx.font = boldFont
    ctx.fillStyle = '#ffd02f'
    ctx.fillText(this.written(this.language === 'ru' ? 'ФАЙЛОВАЯ СИСТЕМА' : 'FILE SYSTEM', textProgress), fileX + 3, bodyTop + 5)
    ctx.textAlign = 'right'
    ctx.font = tinyFont
    ctx.fillStyle = '#d59b20'
    ctx.fillText(
      this.written(`${this.files.length} ${this.language === 'ru' ? 'ФАЙЛОВ' : 'FILES'}`, textProgress),
      fileX + fileWidth - 2,
      bodyTop + 7,
    )
    ctx.textAlign = 'left'
    const listTop = bodyTop + lineHeight * 1.7
    const listBottom = bodyBottom - 5
    const visibleFiles = Math.max(1, Math.floor((listBottom - listTop) / lineHeight))
    if (this.selectedFileIndex < this.fileScrollTop) this.fileScrollTop = this.selectedFileIndex
    if (this.selectedFileIndex >= this.fileScrollTop + visibleFiles) {
      this.fileScrollTop = this.selectedFileIndex - visibleFiles + 1
    }
    this.fileScrollTop = Math.max(0, Math.min(this.fileScrollTop, Math.max(0, this.files.length - visibleFiles)))
    this.pointerLayout = {
      width,
      height,
      filePane: {
        x: fileX - 3,
        y: bodyTop,
        width: fileWidth + 4,
        height: bodyHeight,
      },
      editorPane: {
        x: codeX - 4,
        y: bodyTop,
        width: codeWidth + 4,
        height: bodyHeight,
      },
      fileList: {
        x: fileX,
        y: listTop,
        width: fileWidth - 2,
        height: listBottom - listTop,
        lineHeight,
        firstIndex: this.fileScrollTop,
        visibleRows: visibleFiles,
      },
    }
    ctx.font = tinyFont
    for (let row = 0; row < visibleFiles; row += 1) {
      const index = this.fileScrollTop + row
      const path = this.files[index]
      if (!path) break
      // Rows fade and slide in one after another while the window opens.
      const delay = Math.min(row, APPEAR_FILE_STAGGER_CAP) * APPEAR_FILE_STAGGER
      const rowProgress = easeOut(clamp01((this.appearTime - APPEAR_FILES_START - delay) / APPEAR_FILE_ROW))
      if (rowProgress <= 0) continue
      const y = listTop + row * lineHeight
      const selected = index === this.selectedFileIndex
      const isInstruction = this.isInstructionFile(path)
      const isRecoveryTarget = this.isRecoveryTargetFile(path)
      const isSupplemental = this.isSupplementalFile(path)
      const basename = this.basename(path).toLocaleUpperCase(this.language === 'ru' ? 'ru-RU' : 'en-US')
      const prefix = isInstruction ? '!' : isRecoveryTarget ? '>' : '·'
      ctx.save()
      ctx.globalAlpha = rowProgress
      ctx.translate((rowProgress - 1) * 10, 0)
      if (selected) {
        ctx.fillStyle = isInstruction ? '#526b00' : '#507500'
        ctx.fillRect(fileX, y - 1, fileWidth - 2, lineHeight)
      }
      ctx.fillStyle = selected
        ? '#f8ff97'
        : isInstruction
          ? '#ffe064'
          : isRecoveryTarget
            ? '#b7ff8a'
            : isSupplemental
              ? '#d59b20'
              : (EDITABLE_EXTENSION.test(path) ? '#f1b22c' : '#8f661d')
      ctx.fillText(`${prefix} ${this.fitText(ctx, basename, fileWidth - 34)}`, fileX + 5, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#c68b17'
      ctx.fillText(this.extension(path).toUpperCase().slice(0, 5), fileX + fileWidth - 7, y)
      ctx.textAlign = 'left'
      ctx.restore()
    }
    // Active path and source pane.
    ctx.font = boldFont
    ctx.fillStyle = '#ffe15a'
    ctx.fillText(
      this.written(
        (this.currentPath || (this.language === 'ru' ? '[ФАЙЛ НЕ ВЫБРАН]' : '[NO FILE SELECTED]'))
          .toLocaleUpperCase(this.language === 'ru' ? 'ru-RU' : 'en-US'),
        textProgress,
      ),
      codeX + 3,
      bodyTop + 5,
      codeWidth - 8,
    )
    ctx.font = tinyFont
    ctx.textAlign = 'right'
    ctx.fillStyle = this.isDirty() ? '#ff9861' : '#d8a733'
    ctx.fillText(this.written(this.isDirty() ? '● MODIFIED' : 'SAVED', textProgress), width - margin - 2, bodyTop + 7)
    ctx.textAlign = 'left'
    const codeTop = bodyTop + lineHeight * 1.7
    // A :check verdict is pinned to the bottom of the source pane, so the code
    // area gives up one row for it while a result for this file exists.
    const checkStripHeight = this.checkResult ? lineHeight + 4 : 0
    const codeBottom = bodyBottom - 5 - checkStripHeight
    const codeRows = Math.max(1, Math.floor((codeBottom - codeTop) / lineHeight))
    const gutterWidth = this.showLineNumbers
      ? Math.max(28, ctx.measureText(String(this.buffer.length)).width + 14)
      : 0
    const textX = codeX + 8 + gutterWidth
    const maxTextWidth = Math.max(20, width - margin - textX)
    if (this.cursorRow < this.scrollTop) this.scrollTop = this.cursorRow
    if (this.cursorRow >= this.scrollTop + codeRows) this.scrollTop = this.cursorRow - codeRows + 1
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.buffer.length - codeRows)))
    // While the window opens the source text is typed out character by character.
    let typedTotal = 0
    for (let row = 0; row < codeRows; row += 1) {
      const line = this.buffer[this.scrollTop + row]
      if (line === undefined) break
      typedTotal += line.length + 1
    }
    const writeBudget = Math.floor(typedTotal * textProgress)
    let typedBefore = 0
    for (let row = 0; row < codeRows; row += 1) {
      const lineIndex = this.scrollTop + row
      const line = this.buffer[lineIndex]
      if (line === undefined) break
      // Lines still waiting for their turn in the typewriter are not drawn yet.
      if (textProgress <= 0 || writeBudget < typedBefore) break
      const shown = line.slice(0, Math.min(line.length, writeBudget - typedBefore))
      typedBefore += line.length + 1
      const y = codeTop + row * lineHeight
      const isCurrent = lineIndex === this.cursorRow && this.activePane === 'editor'
      if (isCurrent) {
        ctx.fillStyle = '#4a2c00'
        ctx.fillRect(codeX + 2, y - 1, codeWidth - 8, lineHeight)
      }
      if (this.showLineNumbers) {
        ctx.font = tinyFont
        ctx.textAlign = 'right'
        ctx.fillStyle = isCurrent ? '#ffe46a' : '#95661a'
        ctx.fillText(String(lineIndex + 1).padStart(3, ' '), codeX + 4 + gutterWidth - 4, y)
        ctx.textAlign = 'left'
      }
      this.drawCodeLine(ctx, shown, textX, y, maxTextWidth, normalFont, tinyFont)
      if (textProgress < 1) continue
      if (isCurrent && this.mode === 'NORMAL' && this.blinkClock % 1.1 < 0.65) {
        const before = line.slice(0, this.cursorCol)
        const cursorX = textX + Math.min(maxTextWidth - fontSize, ctx.measureText(before).width)
        const cursorY = y + 1
        ctx.fillStyle = '#fff06b'
        ctx.fillRect(cursorX, cursorY, Math.max(2, Math.min(8, ctx.measureText(line[this.cursorCol] ?? ' ').width)), lineHeight - 2)
        ctx.fillStyle = '#4a2c00'
        ctx.font = normalFont
        ctx.fillText(line[this.cursorCol] ?? ' ', cursorX, y, maxTextWidth - (cursorX - textX))
      } else if (isCurrent && this.mode === 'INSERT' && this.blinkClock % 1.1 < 0.65) {
        const cursorX = textX + Math.min(maxTextWidth - 2, ctx.measureText(line.slice(0, this.cursorCol)).width)
        ctx.fillStyle = '#fff06b'
        ctx.fillRect(cursorX, y + 1, 2, lineHeight - 2)
      }
    }
    // The last :check verdict stays pinned below the code while this file is
    // open, so it survives typing and other transient status messages.
    if (checkStripHeight > 0) {
      ctx.save()
      ctx.globalAlpha = textProgress
      this.drawCheckStrip(ctx, codeX - 3, bodyBottom - 5 - checkStripHeight, codeWidth + 2, checkStripHeight, tinyFont)
      ctx.restore()
    }
    // One large, continuous help panel. File state and editor status occupy
    // compact rows at the top; the rest of the panel is dedicated to readable
    // keyboard instructions. No nested cards, columns, or boxed help items.
    // It fades in last, once the panes have finished opening.
    ctx.save()
    ctx.globalAlpha = footerAlpha
    const footerY = bodyBottom + 8
    const footerW = width - margin * 2
    const footerH = footerHeight - 5
    ctx.fillStyle = '#351a00'
    ctx.fillRect(margin, footerY, footerW, footerH)
    ctx.strokeStyle = '#b87b00'
    ctx.lineWidth = 1
    ctx.strokeRect(margin + 0.5, footerY + 0.5, footerW - 1, footerH - 1)
    const innerX = margin + 10
    const innerW = Math.max(1, footerW - 20)
    ctx.font = tinyFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const currentFileLabel = this.language === 'ru' ? 'ФАЙЛ:' : 'FILE:'
    const currentFileName = this.basename(this.currentPath) || (this.language === 'ru' ? 'НЕ ВЫБРАН' : 'NONE SELECTED')
    ctx.fillStyle = '#e8b52d'
    ctx.fillText(currentFileLabel, innerX, footerY + 7)
    const fileLabelWidth = ctx.measureText(`${currentFileLabel} `).width
    ctx.fillStyle = '#ffdf62'
    ctx.fillText(this.fitText(ctx, currentFileName, Math.max(1, innerW - fileLabelWidth - 190)), innerX + fileLabelWidth, footerY + 7)
    ctx.textAlign = 'right'
    ctx.fillStyle = this.isDirty() ? '#ff9861' : '#bbd66b'
    ctx.fillText(
      this.isDirty()
        ? (this.language === 'ru' ? 'ИЗМЕНЁН — НЕ СОХРАНЁН' : 'MODIFIED — UNSAVED')
        : (this.language === 'ru' ? 'ФАЙЛ СОХРАНЁН' : 'FILE SAVED'),
      margin + footerW - 10,
      footerY + 7,
    )
    ctx.textAlign = 'left'
    const modeLabel = this.mode === 'INSERT'
      ? '-- INSERT --'
      : this.mode === 'COMMAND'
        ? '-- COMMAND --'
        : this.mode === 'SEARCH'
          ? '-- SEARCH --'
          : '-- NORMAL --'
    const modeColor = this.mode === 'INSERT'
      ? '#afff55'
      : this.mode === 'COMMAND' || this.mode === 'SEARCH'
        ? '#7de5ff'
        : '#ffe064'
    const statusY = footerY + lineHeight + 5
    ctx.fillStyle = modeColor
    const modeText = `${modeLabel}   ${this.cursorRow + 1}:${this.cursorCol + 1}   ${this.language === 'ru' ? 'СТРОК' : 'LINES'}: ${this.buffer.length}`
    ctx.fillText(this.fitText(ctx, modeText, innerW * 0.48), innerX, statusY)
    const promptText = this.mode === 'COMMAND'
      ? `:${this.commandLine}`
      : this.mode === 'SEARCH'
        ? `/${this.commandLine}`
        : this.message
    ctx.fillStyle = this.messageIsError ? '#ff805b' : '#f0bb35'
    const promptX = innerX + Math.min(innerW * 0.50, ctx.measureText(modeText).width + 18)
    ctx.fillText(this.fitText(ctx, promptText, Math.max(1, margin + footerW - 10 - promptX)), promptX, statusY)
    const dividerY = footerY + lineHeight * 2 + 8
    ctx.strokeStyle = '#76500f'
    ctx.beginPath()
    ctx.moveTo(innerX, dividerY)
    ctx.lineTo(innerX + innerW, dividerY)
    ctx.stroke()
    const instructions = this.language === 'ru'
      ? [
          { title: '1. ФАЙЛ', detail: 'В начале выделен файл ИНСТРУКЦИЯ. Нажмите стрелку вниз, затем Enter, чтобы открыть драйвер.' },
          { title: '2. ВВОД', detail: 'Нажмите i и введите одну строку: RESTORE_MOTION_PROFILE()' },
          { title: 'ГОТОВО', detail: 'Ввод автоматически становится заглавным. Команда сохранится сама, а игра вернётся в консоль. :check и :w не нужны.' },
        ]
      : [
          { title: '1. FILE', detail: 'The INSTRUCTIONS file is selected first. Press Down, then Enter, to open the driver.' },
          { title: '2. INPUT', detail: 'Press i and type one line: RESTORE_MOTION_PROFILE()' },
          { title: 'DONE', detail: 'Input becomes uppercase automatically. The command is saved and the game returns to the console. No :check or :w is needed.' },
        ]
    // Wrap each help paragraph against the full width of the one large panel.
    // Keep a modest indent on continuation lines so the category labels remain clear.
    const wrapWords = (text: string, maxWidth: number): string[] => {
      const words = text.split(/\s+/).filter(Boolean)
      const lines: string[] = []
      let current = ''
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word
        if (ctx.measureText(candidate).width <= maxWidth) {
          current = candidate
        } else {
          if (current) lines.push(current)
          current = ctx.measureText(word).width <= maxWidth ? word : this.fitText(ctx, word, maxWidth)
        }
      }
      if (current) lines.push(current)
      return lines.length ? lines : ['']
    }
    const helpTop = dividerY + 7
    const helpBottom = footerY + footerH - 8
    const helpLineHeight = Math.max(10, lineHeight - 2)
    const continuationIndent = Math.min(16, innerW * 0.04)
    let helpY = helpTop
    ctx.font = tinyFont
    for (const item of instructions) {
      if (helpY + helpLineHeight > helpBottom) break
      const label = `${item.title}: `
      const labelWidth = ctx.measureText(label).width
      const firstLineWidth = Math.max(1, innerW - labelWidth)
      const detailLines = wrapWords(item.detail, firstLineWidth)
      ctx.fillStyle = '#ffe064'
      ctx.fillText(label, innerX, helpY)
      ctx.fillStyle = '#c39a37'
      ctx.fillText(detailLines[0] ?? '', innerX + labelWidth, helpY, firstLineWidth)
      helpY += helpLineHeight
      for (const continuation of detailLines.slice(1)) {
        if (helpY + helpLineHeight > helpBottom) break
        ctx.fillStyle = '#c39a37'
        ctx.fillText(continuation, innerX + continuationIndent, helpY, Math.max(1, innerW - continuationIndent))
        helpY += helpLineHeight
      }
    }
    ctx.restore()
    ctx.restore()
  }
  private attachPointerInput(canvas: HTMLCanvasElement): void {
    if (this.pointerCanvas === canvas && this.pointerListenersAttached) return
    this.detachPointerInput()
    this.pointerCanvas = canvas
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown)
    canvas.addEventListener('dblclick', this.onCanvasDoubleClick)
    this.pointerListenersAttached = true
  }
  private detachPointerInput(): void {
    if (!this.pointerCanvas || !this.pointerListenersAttached) return
    this.pointerCanvas.removeEventListener('pointerdown', this.onCanvasPointerDown)
    this.pointerCanvas.removeEventListener('dblclick', this.onCanvasDoubleClick)
    this.pointerListenersAttached = false
    this.pointerCanvas = null
  }
  private handleCanvasPointer(event: MouseEvent, openFile: boolean): void {
    if (event.button !== 0) return
    // A click while the window is still opening just skips the animation.
    if (this.appearTime < APPEAR_TOTAL) {
      this.appearTime = APPEAR_TOTAL
      return
    }
    const canvas = this.pointerCanvas
    const layout = this.pointerLayout
    if (!canvas || !layout) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const x = (event.clientX - bounds.left) * (layout.width / bounds.width)
    const y = (event.clientY - bounds.top) * (layout.height / bounds.height)
    const contains = (rect: HitRect): boolean =>
      x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
    if (contains(layout.filePane)) {
      this.activePane = 'files'
      if (!contains(layout.fileList)) return
      const row = Math.floor((y - layout.fileList.y) / layout.fileList.lineHeight)
      if (row < 0 || row >= layout.fileList.visibleRows) return
      const index = layout.fileList.firstIndex + row
      const path = this.files[index]
      if (!path) return
      this.selectedFileIndex = index
      if (openFile) {
        this.openSelectedFile()
      } else {
        this.setMessage(
          this.language === 'ru'
            ? `ВЫБРАН: ${this.basename(path)} — ENTER ИЛИ ДВОЙНОЙ ЩЕЛЧОК, ЧТОБЫ ОТКРЫТЬ`
            : `SELECTED: ${this.basename(path)} — PRESS ENTER OR DOUBLE-CLICK TO OPEN`,
        )
      }
      return
    }
    if (contains(layout.editorPane)) this.activePane = 'editor'
  }
  /**
   * Vim shortcuts in NORMAL mode use physical QWERTY key positions so commands
   * such as dd, gg, hjkl and :w also work while a non-Latin keyboard layout is active.
   * INSERT, COMMAND and SEARCH modes continue to use KeyboardEvent.key and therefore
   * preserve the user's actual typed characters.
   */
  private normalizeNormalModeKey(event: InputKeyEvent): string {
    const { code, key, shiftKey } = event
    // Preserve Latin key values as delivered by the browser, including Caps Lock.
    if (/^Key[A-Z]$/.test(code) && /^[a-zA-Z]$/.test(key)) {
      return key
    }
    // Convert physical letter keys to their Latin Vim command equivalents.
    if (/^Key[A-Z]$/.test(code)) {
      const letter = code.slice(3).toLowerCase()
      return shiftKey ? letter.toUpperCase() : letter
    }
    const digitMatch = /^Digit([0-9])$/.exec(code)
    if (digitMatch) {
      const digit = digitMatch[1]!
      const shifted: Record<string, string> = {
        '0': ')', '1': '!', '2': '@', '3': '#', '4': '$',
        '5': '%', '6': '^', '7': '&', '8': '*', '9': '(',
      }
      return shiftKey ? (shifted[digit] ?? digit) : digit
    }
    const punctuation: Record<string, [string, string]> = {
      Backquote: ['`', '~'],
      Minus: ['-', '_'],
      Equal: ['=', '+'],
      BracketLeft: ['[', '{'],
      BracketRight: [']', '}'],
      Backslash: ['\\', '|'],
      Semicolon: [';', ':'],
      Quote: ["'", '"'],
      Comma: [',', '<'],
      Period: ['.', '>'],
      Slash: ['/', '?'],
    }
    const pair = punctuation[code]
    if (pair) return shiftKey ? pair[1] : pair[0]
    return key
  }
  private handleNormalKey(key: string): void {
    if (this.activePane === 'files') {
      if (key === 'ArrowUp' || key.toLowerCase() === 'k') this.moveFileSelection(-1)
      else if (key === 'ArrowDown' || key.toLowerCase() === 'j') this.moveFileSelection(1)
      else if (key === 'Enter') this.openSelectedFile()
      else if (key === 'Tab' || key === 'ArrowRight' || key.toLowerCase() === 'l') this.activePane = 'editor'
      else if (key === 'ArrowLeft' || key.toLowerCase() === 'h') this.activePane = 'editor'
      else if (key === 'Escape') this.exitEditor()
      else if (key === ':') this.startCommandMode()
      return
    }
    if (key === 'Tab') {
      this.activePane = 'files'
      this.setMessage(this.language === 'ru' ? 'ПАНЕЛЬ ФАЙЛОВ: ↑/↓, ENTER' : 'FILE PANE: ↑/↓, ENTER')
      return
    }
    if (key === 'Escape') {
      this.pendingNormalKey = ''
      this.setMessage('-- NORMAL --')
      return
    }
    const lower = key.toLowerCase()
    if (this.pendingNormalKey === 'd') {
      this.pendingNormalKey = ''
      if (lower === 'd') this.deleteCurrentLine()
      else this.setMessage(this.language === 'ru' ? 'НЕИЗВЕСТНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ' : 'UNKNOWN KEY SEQUENCE', true)
      return
    }
    if (this.pendingNormalKey === 'g') {
      this.pendingNormalKey = ''
      if (lower === 'g') this.setCursor(0, 0)
      return
    }
    if (lower === 'd') { this.pendingNormalKey = 'd'; return }
    if (lower === 'g') { this.pendingNormalKey = 'g'; return }
    switch (key) {
      case 'ArrowUp': case 'k': this.setCursor(this.cursorRow - 1, this.cursorCol); break
      case 'ArrowDown': case 'j': this.setCursor(this.cursorRow + 1, this.cursorCol); break
      case 'ArrowLeft': case 'h': this.setCursor(this.cursorRow, this.cursorCol - 1); break
      case 'ArrowRight': case 'l': this.setCursor(this.cursorRow, this.cursorCol + 1); break
      case 'Home': case '0': this.cursorCol = 0; break
      case 'End': case '$': this.cursorCol = Math.max(0, (this.buffer[this.cursorRow] ?? '').length - 1); break
      case 'PageUp': this.setCursor(this.cursorRow - this.visibleCodeRows(), this.cursorCol); break
      case 'PageDown': this.setCursor(this.cursorRow + this.visibleCodeRows(), this.cursorCol); break
      case 'G': this.setCursor(this.buffer.length - 1, this.cursorCol); break
      case 'w': this.moveWord(1); break
      case 'b': this.moveWord(-1); break
      case 'i': this.beginInsert(); break
      case 'a': this.cursorCol = Math.min((this.buffer[this.cursorRow] ?? '').length, this.cursorCol + 1); this.beginInsert(); break
      case 'I': this.cursorCol = 0; this.beginInsert(); break
      case 'A': this.cursorCol = (this.buffer[this.cursorRow] ?? '').length; this.beginInsert(); break
      case 'o': this.openLineBelow(); break
      case 'O': this.openLineAbove(); break
      case 'x': this.deleteCharacter(); break
      case 'u': this.undo(); break
      case 'p': this.pasteLine(); break
      case 'n': this.findNext(); break
      case '/': this.mode = 'SEARCH'; this.commandLine = ''; this.setMessage(this.language === 'ru' ? 'ПОИСК: ВВЕДИТЕ ТЕКСТ И ENTER' : 'SEARCH: TYPE TEXT AND ENTER'); break
      case ':': this.startCommandMode(); break
      case '?': this.showHelp(); break
      default:
        if (key.length === 1) this.setMessage(this.language === 'ru' ? `NORMAL: НЕИЗВЕСТНАЯ КОМАНДА ${key}` : `NORMAL: UNKNOWN COMMAND ${key}`, true)
    }
  }
  private handleInsertKey(key: string): void {
    if (key === 'Escape') {
      this.mode = 'NORMAL'
      this.cursorCol = Math.max(0, Math.min(this.cursorCol, (this.buffer[this.cursorRow] ?? '').length - 1))
      this.setMessage('-- NORMAL --')
      return
    }
    if (key === 'ArrowUp') { this.setCursor(this.cursorRow - 1, this.cursorCol); return }
    if (key === 'ArrowDown') { this.setCursor(this.cursorRow + 1, this.cursorCol); return }
    if (key === 'ArrowLeft') { this.setCursor(this.cursorRow, this.cursorCol - 1); return }
    if (key === 'ArrowRight') { this.setCursor(this.cursorRow, this.cursorCol + 1); return }
    if (key === 'Home') { this.cursorCol = 0; return }
    if (key === 'End') { this.cursorCol = (this.buffer[this.cursorRow] ?? '').length; return }
    const line = this.buffer[this.cursorRow] ?? ''
    if (key === 'Enter') {
      this.pushUndo()
      const before = line.slice(0, this.cursorCol)
      const after = line.slice(this.cursorCol)
      this.buffer[this.cursorRow] = before
      this.buffer.splice(this.cursorRow + 1, 0, after)
      this.cursorRow += 1
      this.cursorCol = 0
      this.setMessage('-- INSERT --')
    } else if (key === 'Backspace') {
      if (this.cursorCol > 0) {
        this.pushUndo()
        this.buffer[this.cursorRow] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol)
        this.cursorCol -= 1
      } else if (this.cursorRow > 0) {
        this.pushUndo()
        const previous = this.buffer[this.cursorRow - 1] ?? ''
        this.cursorCol = previous.length
        this.buffer[this.cursorRow - 1] = previous + line
        this.buffer.splice(this.cursorRow, 1)
        this.cursorRow -= 1
      }
    } else if (key === 'Tab') {
      this.pushUndo()
      this.buffer[this.cursorRow] = line.slice(0, this.cursorCol) + '  ' + line.slice(this.cursorCol)
      this.cursorCol += 2
    } else if (key.length === 1) {
      this.pushUndo()
      const uppercaseKey = key.toUpperCase()
      this.buffer[this.cursorRow] = line.slice(0, this.cursorCol) + uppercaseKey + line.slice(this.cursorCol)
      this.cursorCol += uppercaseKey.length
    } else if (key === 'Delete') {
      if (this.cursorCol < line.length) {
        this.pushUndo()
        this.buffer[this.cursorRow] = line.slice(0, this.cursorCol) + line.slice(this.cursorCol + 1)
      }
    }
    this.tryCompleteRecoveryCommand()
  }
  private handleCommandLineKey(key: string): void {
    if (key === 'Escape') {
      this.mode = 'NORMAL'
      this.commandLine = ''
      this.setMessage('-- NORMAL --')
      return
    }
    if (key === 'Enter') {
      const raw = this.commandLine.trim()
      const mode = this.mode
      this.commandLine = ''
      this.mode = 'NORMAL'
      if (mode === 'SEARCH') this.performSearch(raw)
      else this.executeEditorCommand(raw)
      return
    }
    if (key === 'Backspace') {
      this.commandLine = this.commandLine.slice(0, -1)
      return
    }
    if (key === 'Tab' && this.mode === 'COMMAND') {
      this.completeEditorCommand()
      return
    }
    if (key.length === 1 && this.commandLine.length < 240) this.commandLine += key
  }
  private executeEditorCommand(raw: string): void {
    if (!raw) return
    this.lastCommand = raw
    const [command, ...rest] = raw.split(/\s+/)
    const argument = rest.join(' ').trim()
    switch ((command ?? '').toLowerCase()) {
      case 'w': case 'write': this.saveFile(); break
      case 'q': case 'quit':
        if (this.isDirty()) {
          this.setMessage(this.language === 'ru' ? 'НЕСОХРАНЁННЫЕ ИЗМЕНЕНИЯ — ИСПОЛЬЗУЙТЕ :wq ИЛИ :q!' : 'UNSAVED CHANGES — USE :wq OR :q!', true)
        } else this.exitEditor()
        break
      case 'q!': this.reloadCurrentFile(); this.exitEditor(); break
      case 'wq': if (this.saveFile()) this.exitEditor(); break
      case 'e': case 'edit':
        if (!argument) this.setMessage(this.language === 'ru' ? 'ФОРМАТ: :e <ПУТЬ>' : 'USAGE: :e <PATH>', true)
        else this.openFile(argument, false)
        break
      case 'e!':
        if (!argument) this.setMessage(this.language === 'ru' ? 'ФОРМАТ: :e! <ПУТЬ>' : 'USAGE: :e! <PATH>', true)
        else this.openFile(argument, true)
        break
      case 'set':
        if (argument.toLowerCase() === 'number' || argument.toLowerCase() === 'nu') {
          this.showLineNumbers = true
          this.setMessage(this.language === 'ru' ? 'НОМЕРА СТРОК ВКЛЮЧЕНЫ' : 'LINE NUMBERS ON')
        } else if (argument.toLowerCase() === 'nonumber' || argument.toLowerCase() === 'nonu') {
          this.showLineNumbers = false
          this.setMessage(this.language === 'ru' ? 'НОМЕРА СТРОК ВЫКЛЮЧЕНЫ' : 'LINE NUMBERS OFF')
        } else this.setMessage(this.language === 'ru' ? 'ДОСТУПНО: :set number / :set nonumber' : 'AVAILABLE: :set number / :set nonumber', true)
        break
      case 'check': this.validateProgram(); break
      case 'help': this.showHelp(); break
      case 'files': this.activePane = 'files'; this.setMessage(this.language === 'ru' ? 'ПАНЕЛЬ ФАЙЛОВ: ↑/↓, ENTER' : 'FILE PANE: ↑/↓, ENTER'); break
      default: this.setMessage(this.language === 'ru' ? `НЕИЗВЕСТНАЯ КОМАНДА :${command}` : `UNKNOWN COMMAND :${command}`, true)
    }
  }
  private completeEditorCommand(): void {
    const raw = this.commandLine
    const match = /^(e|edit|e!)\s+(.+)$/i.exec(raw)
    if (!match) {
      const candidates = ['w', 'wq', 'q', 'q!', 'e ', 'e! ', 'check', 'help', 'set number', 'set nonumber']
      const prefix = raw.toLowerCase()
      const next = candidates.find((candidate) => candidate.toLowerCase().startsWith(prefix) && candidate !== raw)
      if (next) this.commandLine = next.toUpperCase()
      return
    }
    const pathPrefix = match[2] ?? ''
    const candidates = this.fileSystem.getPathCandidates(pathPrefix, false)
    const next = candidates.find((path) => path.toLowerCase().startsWith(pathPrefix.toLowerCase()) && path !== pathPrefix)
    if (next) this.commandLine = `${match[1]} ${next}`.toUpperCase()
  }
  private validateProgram(): void {
    const path = this.currentPath.toLowerCase()
    if (!this.isRecoveryTargetFile(this.currentPath) || (!path.endsWith('.drv') && !path.endsWith('.seq'))) {
      this.setMessage(this.language === 'ru' ? 'ПРОВЕРКА ДОСТУПНА ДЛЯ ФАЙЛОВ .DRV И .SEQ' : 'CHECK IS AVAILABLE FOR .DRV AND .SEQ FILES', true)
      return
    }

    const text = this.buffer.join('\n')
    const valid = this.hasValidRecoveryCommand(this.buffer)
    if (valid) {
      this.checkedBufferText = text
      this.checkResult = { ok: true, detail: '', text: this.checkedBufferText }
      playSfx('correct')
      this.setMessage(this.language === 'ru' ? 'КОМАНДА ПРИНЯТА. СОХРАНЕНИЕ АВТОМАТИЧЕСКОЕ.' : 'COMMAND ACCEPTED. SAVING IS AUTOMATIC.')
    } else {
      this.checkedBufferText = null
      this.checkResult = {
        ok: false,
        detail: this.language === 'ru' ? `ВВЕДИТЕ ОДНУ КОМАНДУ: ${RESTORE_COMMAND}` : `ENTER ONE COMMAND: ${RESTORE_COMMAND}`,
        text: this.buffer.join('\n'),
      }
      playSfx('incorrect')
      this.onValidate?.(this.currentPath, false)
    }
  }
  private saveFile(): boolean {
    if (!this.currentPath) return false
    if (this.isInstructionFile(this.currentPath) || this.isSupplementalFile(this.currentPath) || !EDITABLE_EXTENSION.test(this.currentPath)) {
      this.setMessage(this.language === 'ru' ? 'ФОРМАТ ФАЙЛА ТОЛЬКО ДЛЯ ЧТЕНИЯ' : 'FILE FORMAT IS READ-ONLY', true)
      return false
    }
    const text = this.buffer.join('\n')
    const success = this.fileSystem.write(this.currentPath, text)
    if (!success) {
      this.setMessage(this.language === 'ru' ? 'ОШИБКА СОХРАНЕНИЯ: ФАЙЛ НЕ НАЙДЕН' : 'SAVE ERROR: FILE NOT FOUND', true)
      return false
    }
    this.savedText = text
    if (this.checkedBufferText && this.checkedBufferText === this.savedText) this.onValidate?.(this.currentPath, true)
    this.setMessage(this.language === 'ru' ? `СОХРАНЕНО: ${this.currentPath}` : `WRITTEN: ${this.currentPath}`)
    return true
  }
  private loadFile(path: string): void {
    if (!path) return
    const content = this.readEditorFile(path)
    if (!content) {
      this.setMessage(this.language === 'ru' ? `ФАЙЛ НЕ НАЙДЕН: ${path}` : `FILE NOT FOUND: ${path}`, true)
      return
    }

    this.currentPath = path
    this.buffer = [...content]
    if (!this.buffer.length) this.buffer = ['']
    this.savedText = this.buffer.join('\n')
    this.activePane = this.isInstructionFile(path) ? 'files' : 'editor'
    this.cursorRow = 0
    this.cursorCol = 0
    this.scrollTop = 0
    this.mode = 'NORMAL'
    this.pendingNormalKey = ''
    this.undoStack = []
    this.checkedBufferText = null
    this.checkResult = null
    const index = this.files.findIndex((entry) => entry.toLowerCase() === path.toLowerCase())
    if (index >= 0) this.selectedFileIndex = index
    this.setMessage(this.language === 'ru' ? `ОТКРЫТ: ${this.basename(path).toLocaleUpperCase('ru-RU')}` : `OPENED: ${this.basename(path).toUpperCase()}`)
  }

  private isInstructionFile(path: string): boolean {
    return path.toLowerCase() === INSTRUCTION_FILE.toLowerCase()
  }

  private isRecoveryTargetFile(path: string): boolean {
    return path.toLowerCase() === this.recoveryTargetPath.toLowerCase()
      && /\.(drv|seq)$/i.test(path)
      && !this.isInstructionFile(path)
  }

  private isSupplementalFile(path: string): boolean {
    return SUPPLEMENTAL_EDITOR_FILES.some((file) => file.path.toLowerCase() === path.toLowerCase())
  }

  private hasValidRecoveryCommand(lines: string[]): boolean {
    const executableLines = lines
      .map((line) => line.trim().toUpperCase())
      .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'))
    return executableLines.length === 1 && executableLines[0] === RESTORE_COMMAND
  }

  private recoveryTemplate(): string[] {
    return this.language === 'ru'
      ? [
          '# ПРОФИЛЬ КОНТРОЛЛЕРА ДВИЖЕНИЯ',
          '# СОСТОЯНИЕ: CRC НЕ ПРОЙДЕН',
          '# ЗАДАЧА: ВОССТАНОВИТЬ ПРОФИЛЬ ДВИЖЕНИЯ',
          '#',
          '# ДОБАВЬТЕ КОМАНДУ В ПУСТУЮ СТРОКУ 7.',
          '# НЕ ИЗМЕНЯЙТЕ ОСТАЛЬНЫЕ СТРОКИ.',
          '',
          '# КОМАНДА ДОЛЖНА БЫТЬ ЕДИНСТВЕННОЙ ИСПОЛНЯЕМОЙ СТРОКОЙ.',
          '# ПРОВЕРКА БЕЗОПАСНОСТИ ВЫПОЛНЯЕТСЯ АВТОМАТИЧЕСКИ.',
        ]
      : [
          '# MOTION CONTROLLER PROFILE',
          '# STATUS: CRC VALIDATION FAILED',
          '# TASK: RESTORE THE MOTION PROFILE',
          '#',
          '# ADD THE COMMAND ON THE EMPTY LINE 7.',
          '# DO NOT MODIFY THE OTHER LINES.',
          '',
          '# THE COMMAND MUST BE THE ONLY EXECUTABLE LINE.',
          '# SAFETY VALIDATION RUNS AUTOMATICALLY.',
        ]
  }

  private readEditorFile(path: string): string[] | undefined {
    if (this.isInstructionFile(path)) {
      return this.language === 'ru'
        ? [
            'ИНСТРУКЦИЯ',
            '',
            'НУЖНО ДОПИСАТЬ ОДНУ КОМАНДУ В ФАЙЛЕ ДРАЙВЕРА.',
            '',
            '1. ИНСТРУКЦИЯ ВЫДЕЛЕНА ЖЁЛТЫМ ЦВЕТОМ; ДИАГНОСТИЧЕСКИЕ ФАЙЛЫ ВЫШЕ — ОТВЛЕКАЮЩИЕ.',
            '2. НАЙДИТЕ ЗЕЛЁНЫЙ ФАЙЛ ДРАЙВЕРА С ИМЕНЕМ ОПТИМИЗАТОР_АКСЕЛЕРАЦИИ_1.0.18.DRV.',
            '3. В СПИСКЕ ОН РАСПОЛОЖЕН НИЖЕ ИНСТРУКЦИИ, ПОСЛЕ НЕСКОЛЬКИХ ДИАГНОСТИЧЕСКИХ ФАЙЛОВ.',
            '4. В ДРАЙВЕРЕ ДОПИШИТЕ КОМАНДУ В ПУСТУЮ СТРОКУ 7: КУРСОР НАЧИНАЕТ В СТРОКЕ 1 — НАЖМИТЕ ↓ ШЕСТЬ РАЗ.',
            '5. НАЖМИТЕ I И ВВЕДИТЕ:',
            RESTORE_COMMAND,
            '',
            'СТРОКА 7 — ПУСТАЯ СТРОКА МЕЖДУ КОММЕНТАРИЯМИ.',
            'НЕ УДАЛЯЙТЕ ЗАГОЛОВОК И ДРУГИЕ СТРОКИ, НАЧИНАЮЩИЕСЯ С #.',
            'БУКВЫ АВТОМАТИЧЕСКИ ПЕРЕВОДЯТСЯ В ЗАГЛАВНЫЕ.',
            'ПОСЛЕ ПОСЛЕДНЕЙ СКОБКИ ФАЙЛ СОХРАНИТСЯ, ИГРА ВЕРНЁТСЯ В КОНСОЛЬ.',
          ]
        : [
            'INSTRUCTIONS',
            '',
            'ADD ONE COMMAND TO THE DRIVER FILE.',
            '',
            '1. THE INSTRUCTION FILE IS HIGHLIGHTED IN YELLOW; FILES ABOVE IT ARE DISTRACTORS.',
            '2. FIND THE GREEN DRIVER FILE NAMED ОПТИМИЗАТОР_АКСЕЛЕРАЦИИ_1.0.18.DRV.',
            '3. IT IS BELOW THE INSTRUCTION, AFTER SEVERAL DIAGNOSTIC FILES.',
            '4. ADD THE COMMAND ON THE EMPTY LINE 7: THE CURSOR STARTS ON LINE 1, SO PRESS DOWN SIX TIMES.',
            '5. PRESS I AND TYPE:',
            RESTORE_COMMAND,
            '',
            'LINE 7 IS THE EMPTY LINE BETWEEN THE COMMENTS.',
            'KEEP THE HEADER AND OTHER LINES STARTING WITH #.',
            'LETTERS ARE AUTOMATICALLY CONVERTED TO UPPERCASE.',
            'AFTER THE FINAL PARENTHESIS, THE FILE IS SAVED AND THE GAME RETURNS TO CONSOLE.',
          ]
    }

    const supplemental = SUPPLEMENTAL_EDITOR_FILES.find(
      (file) => file.path.toLowerCase() === path.toLowerCase(),
    )
    if (supplemental) return [...(this.language === 'ru' ? supplemental.ru : supplemental.en)]

    const stored = this.fileSystem.read(path, this.language) ?? undefined
    if (!stored) return undefined

    if (this.isRecoveryTargetFile(path)) {
      // Preserve a previously solved profile, otherwise show a scaffold that asks
      // the player to fill line 7 instead of presenting a blank editor.
      return this.hasValidRecoveryCommand(stored) ? [...stored] : this.recoveryTemplate()
    }

    return stored
  }

  /** Accept and save the puzzle when the one required command is added on line 7. */
  private tryCompleteRecoveryCommand(): void {
    if (!this.isRecoveryTargetFile(this.currentPath)) return
    if (!this.hasValidRecoveryCommand(this.buffer)) return

    const text = this.buffer.join('\n')
    const success = this.fileSystem.write(this.currentPath, text)
    if (!success) {
      this.setMessage(this.language === 'ru' ? 'НЕ УДАЛОСЬ СОХРАНИТЬ КОМАНДУ.' : 'FAILED TO SAVE THE COMMAND.', true)
      return
    }

    this.savedText = text
    this.checkedBufferText = text
    this.checkResult = { ok: true, detail: '', text }
    this.setMessage(this.language === 'ru' ? 'ПРОФИЛЬ ДВИЖЕНИЯ ВОССТАНОВЛЕН.' : 'MOTION PROFILE RESTORED.')
    this.onValidate?.(this.currentPath, true)
    this.exitEditor()
  }

  private normalizeEditorInputKey(event: InputKeyEvent): string {
    if (event.key.length !== 1) return event.key
    // For letters use the physical key so the English command works on any layout.
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toUpperCase()
    const key = this.normalizeNormalModeKey(event)
    return key.length === 1 ? key.toUpperCase() : key
  }

  private reloadCurrentFile(): void {
    if (this.currentPath) this.loadFile(this.currentPath)
  }

  private refreshFileList(): void {
    const available = this.fileSystem.getPathCandidates('', false)
      .filter((path) => Boolean(this.fileSystem.read(path, this.language)))

    const target = available.find((path) => path.toLowerCase() === DEFAULT_FILE.toLowerCase())
      ?? available.find((path) => /\.drv$/i.test(path))
      ?? available.find((path) => /\.seq$/i.test(path))

    this.recoveryTargetPath = target ?? DEFAULT_FILE

    // Keep every real VFS file visible, and add a handful of read-only diagnostic
    // documents if the shared filesystem doesn't already contain them.
    const supplementalMissing = SUPPLEMENTAL_EDITOR_FILES
      .map((file) => file.path)
      .filter((path) => !available.some((candidate) => candidate.toLowerCase() === path.toLowerCase()))

    const remaining = available
      .filter((path) => path.toLowerCase() !== (target ?? '').toLowerCase())
      .filter((path) => path.toLowerCase() !== INSTRUCTION_FILE.toLowerCase())
      .sort((a, b) => a.localeCompare(b))

    // Keep the important files discoverable but not pinned to the top of the list.
    // A few diagnostic/archive files appear first; the instruction and active driver
    // are placed among them so the player has to inspect the file list.
    const otherFiles: string[] = []
    const otherSeen = new Set<string>()
    for (const path of [...supplementalMissing, ...remaining]) {
      const normalized = path.toLowerCase()
      if (normalized === INSTRUCTION_FILE.toLowerCase()) continue
      if (normalized === (target ?? '').toLowerCase()) continue
      if (otherSeen.has(normalized)) continue
      otherSeen.add(normalized)
      otherFiles.push(path)
    }

    const beforeInstruction = Math.min(4, otherFiles.length)
    const beforeDriverEnd = Math.min(beforeInstruction + 3, otherFiles.length)
    this.files = [
      ...otherFiles.slice(0, beforeInstruction),
      INSTRUCTION_FILE,
      ...otherFiles.slice(beforeInstruction, beforeDriverEnd),
      ...(target ? [target] : []),
      ...otherFiles.slice(beforeDriverEnd),
    ]

    const currentIndex = this.files.findIndex((path) => path.toLowerCase() === this.currentPath.toLowerCase())
    this.selectedFileIndex = currentIndex >= 0 ? currentIndex : 0
    this.fileScrollTop = 0
  }
  private openSelectedFile(): void {
    const path = this.files[this.selectedFileIndex]
    if (!path) return
    this.openFile(path, false)
  }
  private moveFileSelection(amount: number): void {
    if (!this.files.length) return
    this.selectedFileIndex = Math.max(0, Math.min(this.files.length - 1, this.selectedFileIndex + amount))
  }
  private moveWord(direction: 1 | -1): void {
    const line = this.buffer[this.cursorRow] ?? ''
    if (direction > 0) {
      let col = this.cursorCol
      while (col < line.length && /\S/.test(line[col] ?? '')) col += 1
      while (col < line.length && /\s/.test(line[col] ?? '')) col += 1
      if (col < line.length) this.cursorCol = col
      else if (this.cursorRow < this.buffer.length - 1) this.setCursor(this.cursorRow + 1, 0)
    } else {
      let col = Math.max(0, this.cursorCol - 1)
      while (col > 0 && /\s/.test(line[col] ?? '')) col -= 1
      while (col > 0 && /\S/.test(line[col - 1] ?? '')) col -= 1
      this.cursorCol = col
    }
  }
  private beginInsert(): void {
    this.pushUndo()
    this.mode = 'INSERT'
    this.setMessage('-- INSERT --')
  }
  private openLineBelow(): void {
    this.pushUndo()
    this.buffer.splice(this.cursorRow + 1, 0, '')
    this.cursorRow += 1
    this.cursorCol = 0
    this.mode = 'INSERT'
    this.setMessage('-- INSERT --')
  }
  private openLineAbove(): void {
    this.pushUndo()
    this.buffer.splice(this.cursorRow, 0, '')
    this.cursorCol = 0
    this.mode = 'INSERT'
    this.setMessage('-- INSERT --')
  }
  private deleteCharacter(): void {
    const line = this.buffer[this.cursorRow] ?? ''
    if (this.cursorCol >= line.length) return
    this.pushUndo()
    this.buffer[this.cursorRow] = line.slice(0, this.cursorCol) + line.slice(this.cursorCol + 1)
  }
  private deleteCurrentLine(): void {
    this.pushUndo()
    this.yankLine = this.buffer[this.cursorRow] ?? ''
    if (this.buffer.length === 1) this.buffer[0] = ''
    else this.buffer.splice(this.cursorRow, 1)
    this.cursorRow = Math.min(this.cursorRow, this.buffer.length - 1)
    this.cursorCol = Math.min(this.cursorCol, (this.buffer[this.cursorRow] ?? '').length)
    this.setMessage(this.language === 'ru' ? 'СТРОКА УДАЛЕНА (dd); p — ВСТАВИТЬ' : 'LINE DELETED (dd); p — PASTE')
  }
  private pasteLine(): void {
    if (!this.yankLine) return
    this.pushUndo()
    this.buffer.splice(this.cursorRow + 1, 0, this.yankLine)
    this.cursorRow += 1
    this.cursorCol = 0
  }
  private undo(): void {
    const previous = this.undoStack.pop()
    if (!previous) {
      this.setMessage(this.language === 'ru' ? 'НЕТ ДЕЙСТВИЙ ДЛЯ ОТМЕНЫ' : 'NOTHING TO UNDO')
      return
    }
    this.buffer = previous
    this.checkedBufferText = null
    this.cursorRow = Math.min(this.cursorRow, this.buffer.length - 1)
    this.cursorCol = Math.min(this.cursorCol, (this.buffer[this.cursorRow] ?? '').length)
    this.setMessage(this.language === 'ru' ? 'ИЗМЕНЕНИЕ ОТМЕНЕНО' : 'CHANGE UNDONE')
  }
  private pushUndo(): void {
    this.checkedBufferText = null
    this.undoStack.push([...this.buffer])
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift()
  }
  private performSearch(query: string): void {
    if (!query) query = this.searchQuery
    if (!query) {
      this.setMessage(this.language === 'ru' ? 'ПУСТОЙ ПОИСК' : 'EMPTY SEARCH', true)
      return
    }
    this.searchQuery = query
    this.searchMatches = []
    const needle = query.toLowerCase()
    this.buffer.forEach((line, row) => {
      let from = 0
      const haystack = line.toLowerCase()
      while (from <= haystack.length) {
        const col = haystack.indexOf(needle, from)
        if (col < 0) break
        this.searchMatches.push({ row, col })
        from = col + Math.max(1, needle.length)
      }
    })
    this.searchIndex = -1
    this.findNext()
  }
  private findNext(): void {
    if (!this.searchMatches.length) {
      this.setMessage(this.language === 'ru' ? `НЕТ СОВПАДЕНИЙ: ${this.searchQuery}` : `NO MATCHES: ${this.searchQuery}`, true)
      return
    }
    const startRow = this.cursorRow
    const nextIndex = this.searchMatches.findIndex(
      (match) => match.row > startRow || (match.row === startRow && match.col > this.cursorCol),
    )
    this.searchIndex = nextIndex >= 0 ? nextIndex : 0
    const match = this.searchMatches[this.searchIndex]!
    this.setCursor(match.row, match.col)
    this.setMessage(this.language === 'ru'
      ? `ПОИСК ${this.searchIndex + 1}/${this.searchMatches.length}: ${this.searchQuery}`
      : `SEARCH ${this.searchIndex + 1}/${this.searchMatches.length}: ${this.searchQuery}`)
  }
  private startCommandMode(): void {
    this.mode = 'COMMAND'
    this.commandLine = ''
    this.setMessage(this.language === 'ru'
      ? 'КОМАНДА: :w :q :wq :e <путь> :check :help'
      : 'COMMAND: :w :q :wq :e <path> :check :help')
  }
  private showHelp(): void {
    this.setMessage(this.language === 'ru'
      ? 'ПРОХОЖДЕНИЕ: ↓, Enter, i, затем RESTORE_MOTION_PROFILE() — сохранение и возврат автоматические.'
      : 'RECOVERY: Down, Enter, i, then RESTORE_MOTION_PROFILE() — save and return are automatic.')
  }
  private exitEditor(): void {
    this.mode = 'NORMAL'
    this.detachPointerInput()
    this.manager?.show(this.returnWindowId)
  }
  private setCursor(row: number, col: number): void {
    this.cursorRow = Math.max(0, Math.min(this.buffer.length - 1, row))
    this.cursorCol = Math.max(0, Math.min((this.buffer[this.cursorRow] ?? '').length, col))
  }
  private isDirty(): boolean {
    return this.buffer.join('\n') !== this.savedText
  }
  private visibleCodeRows(): number {
    return 20
  }
  private basename(path: string): string {
    if (this.isInstructionFile(path)) return 'ИНСТРУКЦИЯ'
    return path.split('/').filter(Boolean).pop() ?? path
  }
  private extension(path: string): string {
    if (this.isInstructionFile(path)) return 'TXT'
    const name = this.basename(path)
    const dot = name.lastIndexOf('.')
    return dot >= 0 ? name.slice(dot + 1) : 'file'
  }
  private setMessage(message: string, error = false): void {
    this.message = message
    this.messageIsError = error
  }
  private fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (maxWidth <= 0) return ''
    if (ctx.measureText(text).width <= maxWidth) return text
    let fitted = text
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1)
    return `${fitted}…`
  }
  /** Text revealed by the opening typewriter: a growing fraction of its length. */
  private written(text: string, progress: number): string {
    if (progress >= 1) return text
    if (progress <= 0) return ''
    return text.slice(0, Math.ceil(text.length * progress))
  }
  /** Persistent :check verdict pinned to the bottom of the source pane. */
  private drawCheckStrip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    tinyFont: string,
  ): void {
    const result = this.checkResult
    if (!result || width <= 0 || height <= 0) return
    ctx.fillStyle = '#351a00'
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = result.ok ? '#6f9a2a' : '#b84000'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
    // The verdict describes the text it was run against; later edits mark it stale.
    const stale = this.buffer.join('\n') !== result.text
    const label = result.ok
      ? (this.language === 'ru'
          ? 'КОМАНДА ПРИНЯТА: ПРОФИЛЬ ВОССТАНОВЛЕН.'
          : 'COMMAND ACCEPTED: PROFILE RESTORED.')
      : (this.language === 'ru' ? `ПРОВЕРКА НЕ ПРОЙДЕНА: ${result.detail}` : `CHECK FAILED: ${result.detail}`)
    const text = stale
      ? `${label} — ${this.language === 'ru' ? 'ИЗМЕНЁН ПОСЛЕ ПРОВЕРКИ' : 'CHANGED SINCE CHECK'}`
      : label
    ctx.font = tinyFont
    ctx.textAlign = 'left'
    ctx.fillStyle = stale ? '#c39a37' : result.ok ? '#bbd66b' : '#ff805b'
    ctx.fillText(this.fitText(ctx, text, Math.max(1, width - 12)), x + 6, y + 3)
  }
  private drawPaneFrame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    active: boolean,
    progress = 1,
  ): void {
    if (width <= 0 || height <= 0 || progress <= 0) return
    // While the window opens the frame stretches from the center out to both sides.
    const drawnWidth = width * progress
    const drawnX = x + (width - drawnWidth) / 2
    ctx.save()
    ctx.globalAlpha = progress
    ctx.fillStyle = '#2d1600'
    ctx.fillRect(drawnX, y, drawnWidth, height)
    ctx.strokeStyle = progress >= 1 ? (active ? '#ffe33c' : '#8d5b00') : '#ffd76a'
    ctx.lineWidth = active ? 1.5 : 1
    ctx.strokeRect(drawnX + 0.5, y + 0.5, Math.max(1, drawnWidth - 1), height - 1)
    ctx.restore()
  }
  private drawCodeLine(
    ctx: CanvasRenderingContext2D,
    line: string,
    x: number,
    y: number,
    maxWidth: number,
    normalFont: string,
    tinyFont: string,
  ): void {
    ctx.font = normalFont
    const value = this.fitText(ctx, line, maxWidth)
    if (/^\s*#/.test(line) || /^\s*\/\//.test(line)) {
      ctx.fillStyle = '#c28a2b'
    } else if (/^\s*(PROC|PROCEDURE|END|IF|ELSE|RETURN)\b/i.test(line)) {
      ctx.fillStyle = '#6edce5'
    } else if (/\b(TRUE|FALSE)\b/i.test(line)) {
      ctx.fillStyle = '#ff9e46'
    } else if (/\b(VERIFY_|INITIALIZE_|DISCOVER_|CALIBRATE_|ENABLE_)[A-Z_]+/i.test(line)) {
      ctx.fillStyle = '#e9d65b'
    } else if (/^[A-Z_][A-Z0-9_]*\s*=/.test(line.trim())) {
      ctx.fillStyle = '#d7ed84'
    } else {
      ctx.fillStyle = '#ffd264'
    }
    ctx.fillText(value, x, y, maxWidth)
    if (/CRC_ACTUAL\s*=\s*INVALID/i.test(line)) {
      ctx.fillStyle = '#ff6550'
      ctx.fillText('  [CRC ERROR]', x + Math.min(maxWidth - 45, ctx.measureText(value).width + 4), y)
    }
  }
}
