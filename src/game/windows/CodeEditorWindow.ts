import type { Input } from '../Input'
import { FONT_FAMILY } from '../fonts'
import { VirtualFileSystem } from '../VirtualFileSystem'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

type EditorMode = 'NORMAL' | 'INSERT' | 'COMMAND' | 'SEARCH'
type Pane = 'files' | 'editor'

export interface CodeEditorOptions {
  fileSystem?: VirtualFileSystem
  initialPath?: string
  returnWindowId?: string
  onValidate?: (path: string, valid: boolean) => void
}

const DEFAULT_FILE = '/opt/firmware/motion/оптимизатор_акселерации_1.0.18.drv'
const EDITABLE_EXTENSION = /\.(drv|seq|cfg|txt|conf|asm|src|md)$/i

/**
 * Retro code editor with a small Vim-like modal command set.
 * It edits the in-game VirtualFileSystem, not files on the host computer.
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
  private showLineNumbers = true
  private blinkClock = 0
  private message = 'NORMAL  |  :help — справка по клавишам'
  private messageIsError = false
  private readonly maxUndo = 80

  constructor(options: CodeEditorOptions = {}) {
    this.fileSystem = options.fileSystem ?? new VirtualFileSystem()
    this.returnWindowId = options.returnWindowId ?? 'ui'
    this.onValidate = options.onValidate
    this.refreshFileList()
    const wanted = options.initialPath ?? DEFAULT_FILE
    const initial = this.files.findIndex((path) => path.toLowerCase() === wanted.toLowerCase())
    this.selectedFileIndex = initial >= 0 ? initial : 0
    if (this.files[this.selectedFileIndex]) this.loadFile(this.files[this.selectedFileIndex])
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
    if (!this.isDirty()) this.loadFile(this.currentPath || this.files[this.selectedFileIndex] || '')
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.refreshFileList()
    if (!this.currentPath && this.files.length) this.loadFile(this.files[this.selectedFileIndex]!)
  }

  /** Open a virtual file. Returns false when the path is not present. */
  openFile(path: string, force = false): boolean {
    if (this.isDirty() && !force) {
      this.setMessage(this.language === 'ru'
        ? 'Есть несохранённые изменения. Используйте :w или :e! <путь>.'
        : 'Unsaved changes. Use :w or :e! <path>.', true)
      return false
    }
    const normalized = path.trim().replace(/\\/g, '/').toLowerCase()
    const resolved = this.files.find((entry) => entry.toLowerCase() === normalized)
    if (!resolved || !this.fileSystem.read(resolved, this.language)) {
      this.setMessage(this.language === 'ru' ? `ФАЙЛ НЕ НАЙДЕН: ${path}` : `FILE NOT FOUND: ${path}`, true)
      return false
    }
    this.loadFile(resolved)
    return true
  }

  update(dt: number, input: Input): void {
    this.blinkClock += dt
    for (const key of input.getPressedKeyValues()) {
      if (this.mode === 'INSERT') this.handleInsertKey(key)
      else if (this.mode === 'COMMAND' || this.mode === 'SEARCH') this.handleCommandLineKey(key)
      else this.handleNormalKey(key)
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
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
    const titleFont = `bold ${fontSize + 2}px "${FONT_FAMILY}", monospace`

    // Top navigation strip mirrors the maintenance/file-system UI.
    const topBarHeight = Math.max(30, lineHeight * 2)
    ctx.fillStyle = '#613000'
    ctx.fillRect(0, 0, width, topBarHeight)
    ctx.fillStyle = '#e4a000'
    ctx.fillRect(margin, 3, width - margin * 2, 1)
    const tabs = this.language === 'ru'
      ? ['КОНСОЛЬ', 'SD-РАДИО', 'ФАЙЛЫ', 'РЕДАКТОР']
      : ['CONSOLE', 'SD-RADIO', 'FILES', 'EDITOR']
    let tabX = margin + 6
    ctx.font = tinyFont
    for (let i = 0; i < tabs.length; i += 1) {
      const tabW = Math.max(68, ctx.measureText(tabs[i]!).width + 24)
      ctx.fillStyle = i === 3 ? '#a65a00' : '#412000'
      ctx.fillRect(tabX, 5, tabW, topBarHeight - 9)
      ctx.strokeStyle = i === 3 ? '#ffd42a' : '#9c6500'
      ctx.strokeRect(tabX + 0.5, 5.5, tabW - 1, topBarHeight - 10)
      ctx.fillStyle = i === 3 ? '#fff06b' : '#d3a323'
      ctx.fillText(tabs[i]!, tabX + 10, 11)
      tabX += tabW + 5
    }
    ctx.textAlign = 'right'
    ctx.font = tinyFont
    ctx.fillStyle = '#ffd34e'
    ctx.fillText('VIM-LIKE EDITOR // MCM-740', width - margin, 11)
    ctx.textAlign = 'left'

    const bodyTop = topBarHeight + 8
    const footerHeight = Math.max(62, lineHeight * 4.2)
    const bodyBottom = Math.max(bodyTop + lineHeight * 5, height - footerHeight - 9)
    const bodyHeight = bodyBottom - bodyTop
    const filePaneWidth = Math.max(150, Math.min(width * 0.31, width - 200))
    const dividerX = margin + filePaneWidth
    const fileX = margin
    const fileWidth = filePaneWidth - 10
    const codeX = dividerX + 12
    const codeWidth = Math.max(50, width - codeX - margin)

    this.drawPaneFrame(ctx, fileX - 3, bodyTop, fileWidth + 4, bodyHeight, this.activePane === 'files')
    this.drawPaneFrame(ctx, codeX - 4, bodyTop, codeWidth + 4, bodyHeight, this.activePane === 'editor')

    ctx.font = boldFont
    ctx.fillStyle = '#ffd02f'
    ctx.fillText(this.language === 'ru' ? 'ФАЙЛОВАЯ СИСТЕМА' : 'FILE SYSTEM', fileX + 3, bodyTop + 5)
    ctx.textAlign = 'right'
    ctx.font = tinyFont
    ctx.fillStyle = '#d59b20'
    ctx.fillText(`${this.files.length} FILES`, fileX + fileWidth - 2, bodyTop + 7)
    ctx.textAlign = 'left'

    const listTop = bodyTop + lineHeight * 1.7
    const listBottom = bodyBottom - 5
    const visibleFiles = Math.max(1, Math.floor((listBottom - listTop) / lineHeight))
    if (this.selectedFileIndex < this.fileScrollTop) this.fileScrollTop = this.selectedFileIndex
    if (this.selectedFileIndex >= this.fileScrollTop + visibleFiles) this.fileScrollTop = this.selectedFileIndex - visibleFiles + 1
    this.fileScrollTop = Math.max(0, Math.min(this.fileScrollTop, Math.max(0, this.files.length - visibleFiles)))

    ctx.font = tinyFont
    for (let row = 0; row < visibleFiles; row += 1) {
      const index = this.fileScrollTop + row
      const path = this.files[index]
      if (!path) break
      const y = listTop + row * lineHeight
      const selected = index === this.selectedFileIndex
      if (selected) {
        ctx.fillStyle = '#507500'
        ctx.fillRect(fileX, y - 1, fileWidth - 2, lineHeight)
      }
      const basename = this.basename(path)
      const prefix = EDITABLE_EXTENSION.test(path) ? '>' : '·'
      ctx.fillStyle = selected ? '#f8ff97' : (EDITABLE_EXTENSION.test(path) ? '#f1b22c' : '#8f661d')
      ctx.fillText(`${prefix} ${this.fitText(ctx, basename, fileWidth - 34)}`, fileX + 5, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#c68b17'
      ctx.fillText(this.extension(path).toUpperCase().slice(0, 5), fileX + fileWidth - 7, y)
      ctx.textAlign = 'left'
    }

    // Active path header and Vim-like source pane.
    ctx.font = boldFont
    ctx.fillStyle = '#ffe15a'
    ctx.fillText(this.currentPath || (this.language === 'ru' ? '[ФАЙЛ НЕ ВЫБРАН]' : '[NO FILE SELECTED]'), codeX + 3, bodyTop + 5, codeWidth - 8)
    ctx.font = tinyFont
    ctx.textAlign = 'right'
    ctx.fillStyle = this.isDirty() ? '#ff9861' : '#d8a733'
    ctx.fillText(this.isDirty() ? '● MODIFIED' : 'SAVED', width - margin - 2, bodyTop + 7)
    ctx.textAlign = 'left'

    const codeTop = bodyTop + lineHeight * 1.7
    const codeBottom = bodyBottom - 5
    const codeRows = Math.max(1, Math.floor((codeBottom - codeTop) / lineHeight))
    const gutterWidth = this.showLineNumbers ? Math.max(28, ctx.measureText(String(this.buffer.length)).width + 14) : 0
    const textX = codeX + 8 + gutterWidth
    const maxTextWidth = Math.max(20, width - margin - textX)
    if (this.cursorRow < this.scrollTop) this.scrollTop = this.cursorRow
    if (this.cursorRow >= this.scrollTop + codeRows) this.scrollTop = this.cursorRow - codeRows + 1
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.buffer.length - codeRows)))

    for (let row = 0; row < codeRows; row += 1) {
      const lineIndex = this.scrollTop + row
      const line = this.buffer[lineIndex]
      if (line === undefined) break
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
      this.drawCodeLine(ctx, line, textX, y, maxTextWidth, normalFont, tinyFont)
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

    // Bottom panels follow the reference screenshot: file metadata on the left,
    // editor state / command prompt on the right.
    const footerY = bodyBottom + 8
    const footerW = width - margin * 2
    const footerLeftW = Math.max(145, Math.min(footerW * 0.31, footerW - 180))
    ctx.fillStyle = '#4b2600'
    ctx.fillRect(margin, footerY, footerLeftW, footerHeight - 5)
    ctx.strokeStyle = '#b87b00'
    ctx.strokeRect(margin + 0.5, footerY + 0.5, footerLeftW - 1, footerHeight - 6)
    ctx.fillStyle = '#e8b52d'
    ctx.font = tinyFont
    ctx.fillText(this.language === 'ru' ? 'ВЫБРАННЫЙ ФАЙЛ' : 'SELECTED FILE', margin + 8, footerY + 5)
    ctx.fillStyle = '#ffdf62'
    ctx.fillText(this.fitText(ctx, this.basename(this.currentPath), footerLeftW - 16), margin + 8, footerY + lineHeight + 3)
    ctx.fillStyle = '#bb8a22'
    ctx.fillText(this.isDirty() ? (this.language === 'ru' ? 'ИЗМЕНЁН • НЕ СОХРАНЁН' : 'MODIFIED • UNSAVED') : (this.language === 'ru' ? 'ФАЙЛ СОХРАНЁН' : 'FILE SAVED'), margin + 8, footerY + lineHeight * 2 + 1)

    const rightFooterX = margin + footerLeftW + 7
    const rightFooterW = width - margin - rightFooterX
    ctx.fillStyle = '#351a00'
    ctx.fillRect(rightFooterX, footerY, rightFooterW, footerHeight - 5)
    ctx.strokeStyle = '#b87b00'
    ctx.strokeRect(rightFooterX + 0.5, footerY + 0.5, rightFooterW - 1, footerHeight - 6)
    ctx.font = tinyFont
    ctx.fillStyle = this.mode === 'INSERT' ? '#afff55' : this.mode === 'COMMAND' || this.mode === 'SEARCH' ? '#7de5ff' : '#ffe064'
    const modeLabel = this.mode === 'INSERT' ? '-- INSERT --' : this.mode === 'COMMAND' ? 'COMMAND' : this.mode === 'SEARCH' ? 'SEARCH' : '-- NORMAL --'
    ctx.fillText(`${modeLabel}   ${this.cursorRow + 1}:${this.cursorCol + 1}   ${this.language === 'ru' ? 'СТРОК' : 'LINES'} ${this.buffer.length}`, rightFooterX + 8, footerY + 5)

    const promptText = this.mode === 'COMMAND'
      ? `:${this.commandLine}`
      : this.mode === 'SEARCH'
        ? `/${this.commandLine}`
        : this.message
    ctx.fillStyle = this.messageIsError ? '#ff805b' : '#f0bb35'
    ctx.fillText(this.fitText(ctx, promptText, rightFooterW - 16), rightFooterX + 8, footerY + lineHeight + 3)
    ctx.fillStyle = '#af8425'
    const keysHint = this.language === 'ru'
      ? 'i: ввод   Esc: режим   :w: сохранить   :q: выход   :check: проверить'
      : 'i: insert   Esc: normal   :w: save   :q: quit   :check: validate'
    ctx.fillText(this.fitText(ctx, keysHint, rightFooterW - 16), rightFooterX + 8, footerY + lineHeight * 2 + 1)

    ctx.restore()
  }

  private handleNormalKey(key: string): void {
    if (this.activePane === 'files') {
      if (key === 'ArrowUp' || key.toLowerCase() === 'k') this.moveFileSelection(-1)
      else if (key === 'ArrowDown' || key.toLowerCase() === 'j') this.moveFileSelection(1)
      else if (key === 'Enter') this.openSelectedFile()
      else if (key === 'Tab' || key === 'ArrowRight') this.activePane = 'editor'
      else if (key === 'Escape') this.exitEditor()
      else if (key === ':') this.startCommandMode()
      return
    }

    if (key === 'Tab') {
      this.activePane = 'files'
      this.setMessage(this.language === 'ru' ? 'ПАНЕЛЬ ФАЙЛОВ: ↑/↓ ВЫБОР, ENTER ОТКРЫТЬ' : 'FILE PANE: ↑/↓ SELECT, ENTER OPEN')
      return
    }
    if (key === 'Escape') {
      this.pendingNormalKey = ''
      this.setMessage('NORMAL')
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

    this.pushUndo()
    const line = this.buffer[this.cursorRow] ?? ''
    if (key === 'Enter') {
      const before = line.slice(0, this.cursorCol)
      const after = line.slice(this.cursorCol)
      this.buffer[this.cursorRow] = before
      this.buffer.splice(this.cursorRow + 1, 0, after)
      this.cursorRow += 1
      this.cursorCol = 0
      this.setMessage('-- INSERT --')
    } else if (key === 'Backspace') {
      if (this.cursorCol > 0) {
        this.buffer[this.cursorRow] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol)
        this.cursorCol -= 1
      } else if (this.cursorRow > 0) {
        const previous = this.buffer[this.cursorRow - 1] ?? ''
        this.cursorCol = previous.length
        this.buffer[this.cursorRow - 1] = previous + line
        this.buffer.splice(this.cursorRow, 1)
        this.cursorRow -= 1
      }
    } else if (key === 'Tab') {
      this.buffer[this.cursorRow] = line.slice(0, this.cursorCol) + '  ' + line.slice(this.cursorCol)
      this.cursorCol += 2
    } else if (key.length === 1) {
      this.buffer[this.cursorRow] = line.slice(0, this.cursorCol) + key + line.slice(this.cursorCol)
      this.cursorCol += 1
    } else if (key === 'Delete') {
      this.buffer[this.cursorRow] = line.slice(0, this.cursorCol) + line.slice(this.cursorCol + 1)
    } else {
      // Navigation keys must not create extra undo entries.
      this.undoStack.pop()
    }
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
      case 'w':
      case 'write': this.saveFile(); break
      case 'q':
      case 'quit':
        if (this.isDirty()) this.setMessage(this.language === 'ru' ? 'НЕСОХРАНЁННЫЕ ИЗМЕНЕНИЯ — ИСПОЛЬЗУЙТЕ :wq ИЛИ :q!' : 'UNSAVED CHANGES — USE :wq OR :q!', true)
        else this.exitEditor()
        break
      case 'q!': this.reloadCurrentFile(); this.exitEditor(); break
      case 'wq': if (this.saveFile()) this.exitEditor(); break
      case 'e':
      case 'edit':
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
      default:
        this.setMessage(this.language === 'ru' ? `НЕИЗВЕСТНАЯ КОМАНДА :${command}` : `UNKNOWN COMMAND :${command}`, true)
    }
  }

  private completeEditorCommand(): void {
    const raw = this.commandLine
    const match = /^(e|edit|e!)\s+(.+)$/i.exec(raw)
    if (!match) {
      const candidates = ['w', 'wq', 'q', 'q!', 'e ', 'e! ', 'check', 'help', 'set number', 'set nonumber']
      const prefix = raw.toLowerCase()
      const next = candidates.find((candidate) => candidate.toLowerCase().startsWith(prefix) && candidate !== raw)
      if (next) this.commandLine = next
      return
    }
    const pathPrefix = match[2] ?? ''
    const candidates = this.fileSystem.getPathCandidates(pathPrefix, false)
    const next = candidates.find((path) => path.toLowerCase().startsWith(pathPrefix.toLowerCase()) && path !== pathPrefix)
    if (next) this.commandLine = `${match[1]} ${next}`
  }

  private validateProgram(): void {
    const path = this.currentPath.toLowerCase()
    if (!path.endsWith('.drv') && !path.endsWith('.seq')) {
      this.setMessage(this.language === 'ru' ? 'ПРОВЕРКА ДОСТУПНА ДЛЯ ФАЙЛОВ .DRV И .SEQ' : 'CHECK IS AVAILABLE FOR .DRV AND .SEQ FILES', true)
      return
    }
    const text = this.buffer.join('\n').toUpperCase()
    const required = [
      'VERIFY_POWER(PWR-100, PDU-230)',
      'VERIFY_RAIL(BUS-T-240)',
      'VERIFY_COOLING(TMP-810, CLG-820)',
      'VERIFY_COMMAND_PROFILE(MCM-740)',
      'INITIALIZE_SCHEDULER(RTS-711)',
      'DISCOVER_ACTUATORS(ACT-610, SRV-620)',
      'CALIBRATE_BALANCE(IMU-430, FRC-440)',
      'ENABLE_MOTION(LOC-630)',
      'ENABLE_VISION(CAM-410)',
    ]
    const positions = required.map((line) => text.indexOf(line))
    const firstMissing = positions.findIndex((position) => position < 0)
    const orderValid = positions.every((position, index) => index === 0 || position > positions[index - 1]!)
    const safetyFlagsValid = /CRC_CHECK\s*=\s*TRUE/.test(text) && /REQUIRE_COOLING\s*=\s*TRUE/.test(text)
    const valid = firstMissing < 0 && orderValid && safetyFlagsValid
    if (valid) {
      this.checkedBufferText = this.buffer.join('\n')
      this.setMessage(this.language === 'ru' ? 'CHECK OK: ПОСЛЕДОВАТЕЛЬНОСТЬ И БЛОКИРОВКИ КОРРЕКТНЫ. СОХРАНИТЕ :w' : 'CHECK OK: SEQUENCE AND INTERLOCKS VALID. SAVE WITH :w')
    } else {
      this.checkedBufferText = null
      const missing = firstMissing >= 0 ? required[firstMissing] : !orderValid ? 'SEQUENCE ORDER' : 'CRC_CHECK=true / REQUIRE_COOLING=true'
      this.setMessage(this.language === 'ru' ? `CHECK FAILED: ${missing}` : `CHECK FAILED: ${missing}`, true)
      this.onValidate?.(this.currentPath, false)
    }
  }

  private saveFile(): boolean {
    if (!this.currentPath) return false
    if (!EDITABLE_EXTENSION.test(this.currentPath)) {
      this.setMessage(this.language === 'ru' ? 'ФОРМАТ ФАЙЛА ТОЛЬКО ДЛЯ ЧТЕНИЯ' : 'FILE FORMAT IS READ-ONLY', true)
      return false
    }
    const success = this.fileSystem.write(this.currentPath, this.buffer.join('\n'))
    if (!success) {
      this.setMessage(this.language === 'ru' ? 'ОШИБКА СОХРАНЕНИЯ: ФАЙЛ НЕ НАЙДЕН' : 'SAVE ERROR: FILE NOT FOUND', true)
      return false
    }
    this.savedText = this.buffer.join('\n')
    if (this.checkedBufferText && this.checkedBufferText === this.savedText) this.onValidate?.(this.currentPath, true)
    this.setMessage(this.language === 'ru' ? `СОХРАНЕНО: ${this.currentPath}` : `WRITTEN: ${this.currentPath}`)
    return true
  }

  private loadFile(path: string): void {
    if (!path) return
    const content = this.fileSystem.read(path, this.language)
    if (!content) {
      this.setMessage(this.language === 'ru' ? `ФАЙЛ НЕ НАЙДЕН: ${path}` : `FILE NOT FOUND: ${path}`, true)
      return
    }
    this.currentPath = path
    this.buffer = [...content]
    if (!this.buffer.length) this.buffer = ['']
    this.savedText = this.buffer.join('\n')
    this.cursorRow = 0
    this.cursorCol = 0
    this.scrollTop = 0
    this.mode = 'NORMAL'
    this.activePane = 'editor'
    this.pendingNormalKey = ''
    this.undoStack = []
    this.checkedBufferText = null
    const index = this.files.findIndex((entry) => entry.toLowerCase() === path.toLowerCase())
    if (index >= 0) this.selectedFileIndex = index
    this.setMessage(this.language === 'ru' ? `ОТКРЫТ: ${path}` : `OPENED: ${path}`)
  }

  private reloadCurrentFile(): void {
    if (this.currentPath) this.loadFile(this.currentPath)
  }

  private refreshFileList(): void {
    this.files = this.fileSystem.getPathCandidates('', false)
      .filter((path) => Boolean(this.fileSystem.read(path, this.language)))
      .sort((a, b) => a.localeCompare(b))
    if (this.files.length && !this.files.includes(this.currentPath)) {
      this.selectedFileIndex = Math.min(this.selectedFileIndex, this.files.length - 1)
    }
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
    const nextIndex = this.searchMatches.findIndex((match) => match.row > startRow || (match.row === startRow && match.col > this.cursorCol))
    this.searchIndex = nextIndex >= 0 ? nextIndex : 0
    const match = this.searchMatches[this.searchIndex]!
    this.setCursor(match.row, match.col)
    this.setMessage(this.language === 'ru' ? `ПОИСК ${this.searchIndex + 1}/${this.searchMatches.length}: ${this.searchQuery}` : `SEARCH ${this.searchIndex + 1}/${this.searchMatches.length}: ${this.searchQuery}`)
  }

  private startCommandMode(): void {
    this.mode = 'COMMAND'
    this.commandLine = ''
    this.setMessage(this.language === 'ru' ? 'КОМАНДА: :w :q :wq :e <путь> :check :help' : 'COMMAND: :w :q :wq :e <path> :check :help')
  }

  private showHelp(): void {
    this.setMessage(this.language === 'ru'
      ? 'VIM: h/j/k/l или стрелки • w/b слово • gg/G начало/конец • i/a/o ввод • Esc NORMAL • dd удалить строку • x удалить символ • u отмена • / поиск • :w сохранить • :q выйти • :check проверка'
      : 'VIM: h/j/k/l or arrows • w/b word • gg/G top/bottom • i/a/o insert • Esc NORMAL • dd delete line • x delete char • u undo • / search • :w save • :q quit • :check validate')
  }

  private exitEditor(): void {
    this.mode = 'NORMAL'
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
    return path.split('/').filter(Boolean).pop() ?? path
  }

  private extension(path: string): string {
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

  private drawPaneFrame(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, active: boolean): void {
    ctx.fillStyle = '#2d1600'
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = active ? '#ffe33c' : '#8d5b00'
    ctx.lineWidth = active ? 1.5 : 1
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  }

  private drawCodeLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, maxWidth: number, normalFont: string, tinyFont: string): void {
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
    // Keep a small distinct marker for malformed profile checksums in the source.
    if (/CRC_ACTUAL\s*=\s*INVALID/i.test(line)) {
      ctx.font = tinyFont
      ctx.fillStyle = '#ff6550'
      ctx.fillText('  [CRC ERROR]', x + Math.min(maxWidth - 45, ctx.measureText(value).width + 4), y)
    }
  }
}
