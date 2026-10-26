import { playSfx } from '../sfx'
import type { Input } from '../Input'
import type { SaveManager } from '../save/SaveManager'
import type { SaveSlot, SavedRobotFlags } from '../save/types'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'
import {
  MENU_COLORS,
  drawConsoleBackground,
  drawPanel,
  drawProgressBar,
  drawRule,
  fillGlowText,
  fitText,
  formatDuration,
  formatSaveDate,
  includesPoint,
  menuFont,
  type MenuRect,
} from './menu/MenuTheme'

interface SaveSelectText {
  title: string
  subtitle: string
  headers: string[]
  empty: string
  newGame: string
  load: string
  selected: string
  slot: string
  created: string
  updated: string
  playTime: string
  progress: string
  stages: string
  hints: string
  back: string
  deleteQuestion: string
  deleteHint: string
  deleted: string
}

const TEXT: Record<GameLanguage, SaveSelectText> = {
  ru: {
    title: 'СОХРАНЕНИЯ',
    subtitle: 'SAVE DATA // ВЫБЕРИТЕ СЛОТ ДЛЯ ЗАГРУЗКИ ИЛИ НОВОЙ ИГРЫ',
    headers: ['СЛОТ', 'СЕАНС', 'ПРОГРЕСС', 'ИЗМЕНЕНО'],
    empty: 'ПУСТО',
    newGame: 'НОВАЯ ИГРА',
    load: 'ЗАГРУЗИТЬ',
    selected: 'ВЫБРАНО',
    slot: 'СЛОТ',
    created: 'СОЗДАНО',
    updated: 'ИЗМЕНЕНО',
    playTime: 'ВРЕМЯ В ИГРЕ',
    progress: 'ВОССТАНОВЛЕНИЕ',
    stages: 'КЛЮЧЕВЫЕ ЭТАПЫ',
    hints: '↑/↓ ВЫБОР  ·  ENTER ЗАГРУЗИТЬ / НОВАЯ ИГРА  ·  DEL УДАЛИТЬ  ·  ESC НАЗАД',
    back: 'НАЗАД',
    deleteQuestion: 'УДАЛИТЬ ЭТО СОХРАНЕНИЕ?',
    deleteHint: 'ENTER / Y — ДА        N / ESC — НЕТ',
    deleted: 'СОХРАНЕНИЕ УДАЛЕНО.',
  },
  en: {
    title: 'SAVE DATA',
    subtitle: 'SAVE DATA // SELECT A SLOT TO LOAD OR START A NEW GAME',
    headers: ['SLOT', 'SESSION', 'PROGRESS', 'UPDATED'],
    empty: 'EMPTY',
    newGame: 'NEW GAME',
    load: 'LOAD',
    selected: 'SELECTED',
    slot: 'SLOT',
    created: 'CREATED',
    updated: 'UPDATED',
    playTime: 'PLAY TIME',
    progress: 'RECOVERY',
    stages: 'KEY MILESTONES',
    hints: '↑/↓ SELECT  ·  ENTER LOAD / NEW GAME  ·  DEL DELETE  ·  ESC BACK',
    back: 'BACK',
    deleteQuestion: 'DELETE THIS SAVE?',
    deleteHint: 'ENTER / Y — YES        N / ESC — NO',
    deleted: 'SAVE SLOT DELETED.',
  },
}

const STAGES: Array<{ key: keyof SavedRobotFlags; ru: string; en: string }> = [
  { key: 'reactorRestored', ru: 'РЕАКТОР', en: 'REACTOR' },
  { key: 'bodyBusRestored', ru: 'ПИТАНИЕ КОРПУСА', en: 'BODY POWER' },
  { key: 'busBypassRestored', ru: 'ОБХОД ШИНЫ', en: 'BUS BYPASS' },
  { key: 'analyzerValidated', ru: 'АНАЛИЗАТОР', en: 'ANALYZER' },
  { key: 'memoryCoreRestored', ru: 'ПАМЯТЬ', en: 'MEMORY' },
  { key: 'motionProfileRestored', ru: 'ПРОФИЛЬ ДВИЖЕНИЯ', en: 'MOTION PROFILE' },
  { key: 'coolingRestored', ru: 'ОХЛАЖДЕНИЕ', en: 'COOLING' },
  { key: 'visionRestored', ru: 'КАМЕРЫ', en: 'VISION' },
  { key: 'motionStartupComplete', ru: 'БЕЗОПАСНЫЙ ЗАПУСК', en: 'SAFE STARTUP' },
]

export interface SaveSelectOptions {
  saveManager: SaveManager
  onLoad: (slot: SaveSlot) => void
  onNewGame: (slotId: number) => void
  onDelete: (slotId: number) => void
  onBack: () => void
}

/** Slot browser opened from the title screen's CONTINUE item. */
export class SaveSelectWindow implements GameWindow {
  readonly id = 'saves'

  private readonly options: SaveSelectOptions
  private language: GameLanguage = 'ru'
  private slots: Array<SaveSlot | null> = []
  private selectedIndex = 0
  private hoverIndex = -1
  private wasPointerDown = false
  private rowRects: MenuRect[] = []
  private time = 0
  private message = ''
  private messageTimer = 0
  private pendingDelete = false

  constructor(options: SaveSelectOptions) {
    this.options = options
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(_manager: WindowManager, input: Input): void {
    this.refresh(true)
    // A click that caused this transition is usually still held; do not treat
    // that same press as a click on the slot list.
    this.wasPointerDown = input.isPointerDown()
    this.hoverIndex = -1
    this.pendingDelete = false
    this.message = ''
    this.messageTimer = 0
  }

  /** Reload the slots; opening the browser always lands on the first occupied slot. */
  private refresh(resetSelection = false): void {
    this.slots = this.options.saveManager.listSlots()
    const firstFilled = this.slots.findIndex((slot) => slot !== null)
    if (resetSelection || this.selectedIndex < 0 || this.selectedIndex >= this.slots.length) {
      this.selectedIndex = Math.max(0, firstFilled)
    }
  }

  update(dt: number, input: Input): void {
    this.time += dt
    if (this.messageTimer > 0) {
      this.messageTimer = Math.max(0, this.messageTimer - dt)
      if (this.messageTimer === 0) this.message = ''
    }
    input.consumeWheelDelta()

    const pointer = input.pointerPosition
    this.hoverIndex = this.rowRects.findIndex((rect) => includesPoint(rect, pointer.x, pointer.y))
    const down = input.isPointerDown()
    const clicked = down && !this.wasPointerDown
    this.wasPointerDown = down

    if (this.pendingDelete) {
      const confirm = input.wasPressed('Enter') || input.wasPressed('KeyY')
      const cancel = input.wasPressed('Escape') || input.wasPressed('KeyN')
      if (confirm) {
        this.deleteSelected()
      } else if (cancel) {
        this.pendingDelete = false
      }
      return
    }

    if (input.wasPressed('Escape')) {
      this.options.onBack()
      return
    }

    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.moveSelection(-1)
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.moveSelection(1)
    if (input.wasPressed('Home')) this.selectSlot(0)
    if (input.wasPressed('End')) this.selectSlot(this.slots.length - 1)

    for (let index = 0; index < this.slots.length; index += 1) {
      if (input.wasPressed(`Digit${index + 1}`)) this.selectSlot(index)
    }

    if (clicked && this.hoverIndex >= 0) {
      if (this.hoverIndex === this.selectedIndex) {
        this.activateSelected()
        return
      }
      this.selectSlot(this.hoverIndex)
      return
    }

    if (input.wasPressed('Enter') || input.wasPressed('Space')) {
      this.activateSelected()
      return
    }

    if (input.wasPressed('Delete') || input.wasPressed('KeyX')) {
      if (this.slots[this.selectedIndex]) {
        this.pendingDelete = true
        playSfx('selection')
      }
    }
  }

  private selectSlot(index: number): void {
    if (index < 0 || index >= this.slots.length || index === this.selectedIndex) return
    this.selectedIndex = index
    this.message = ''
    playSfx('selection')
  }

  private moveSelection(amount: number): void {
    const length = this.slots.length
    if (length === 0) return
    const next = (this.selectedIndex + amount + length) % length
    this.selectSlot(next)
  }

  private activateSelected(): void {
    const slot = this.slots[this.selectedIndex]
    if (!slot) {
      playSfx('selection')
      this.options.onNewGame(this.selectedIndex)
      return
    }
    playSfx('selection')
    this.options.onLoad(slot)
  }

  private deleteSelected(): void {
    const slot = this.slots[this.selectedIndex]
    this.pendingDelete = false
    if (!slot) return
    if (this.options.saveManager.deleteSlot(slot.id)) {
      playSfx('correct')
      this.options.onDelete(slot.id)
      this.message = TEXT[this.language].deleted
      this.messageTimer = 3
      this.refresh()
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const text = TEXT[this.language]
    ctx.save()
    ctx.clearRect(0, 0, width, height)
    drawConsoleBackground(ctx, width, height, this.time)

    const margin = width < 560 ? 12 : width < 1000 ? 22 : 32
    const small = width < 560 ? 9 : width < 1000 ? 10 : 11
    const lineHeight = Math.ceil(small * 1.45)
    const titleSize = width < 560 ? 21 : width < 1000 ? 27 : 32
    const detailVisible = width >= 880 && height >= 560
    const detailWidth = detailVisible ? Math.min(330, width * 0.3) : 0
    const gap = detailVisible ? 18 : 0
    const listWidth = width - margin * 2 - detailWidth - gap

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = menuFont(titleSize, true)
    ctx.fillStyle = MENU_COLORS.bright
    ctx.shadowColor = 'rgba(114, 255, 98, 0.3)'
    ctx.shadowBlur = 8
    fillGlowText(ctx, text.title, margin, margin)
    ctx.shadowBlur = 0

    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    fillGlowText(ctx, fitText(ctx, text.subtitle, width - margin * 2), margin, margin + titleSize + 8)

    const ruleY = margin + titleSize + lineHeight * 2.1
    drawRule(ctx, margin, ruleY, width - margin * 2)
    const listTop = ruleY + 12

    const footerHeight = lineHeight + 8
    const listBottom = height - margin - footerHeight
    const headerHeight = lineHeight + 10
    const rowsTop = listTop + headerHeight
    const rowGap = 6
    const rowHeight = Math.max(
      40,
      Math.min(68, Math.floor((listBottom - rowsTop - rowGap * (this.slots.length - 1)) / Math.max(1, this.slots.length))),
    )

    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    const slotX = margin + 10
    const nameX = margin + 62
    const progressWidth = Math.min(190, Math.max(110, listWidth * 0.25))
    const dateX = margin + listWidth - 10
    const progressX = dateX - progressWidth - 18
    fillGlowText(ctx, text.headers[0], slotX, listTop + 1)
    fillGlowText(ctx, text.headers[1], nameX, listTop + 1)
    fillGlowText(ctx, text.headers[2], Math.max(nameX + 100, progressX - 92), listTop + 1)
    ctx.textAlign = 'right'
    fillGlowText(ctx, text.headers[3], dateX, listTop + 1)
    ctx.textAlign = 'left'
    drawRule(ctx, margin, listTop + headerHeight - 4, listWidth, 1, 'rgba(83, 158, 98, 0.2)')

    this.rowRects = []
    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index]
      const rect: MenuRect = {
        x: margin,
        y: rowsTop + index * (rowHeight + rowGap),
        width: listWidth,
        height: rowHeight,
      }
      this.rowRects.push(rect)
      const selected = index === this.selectedIndex
      const hovered = index === this.hoverIndex

      ctx.fillStyle = selected
        ? MENU_COLORS.selected
        : hovered ? 'rgba(103, 218, 130, 0.07)' : 'rgba(2, 12, 6, 0.48)'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeStyle = selected ? MENU_COLORS.borderBright : MENU_COLORS.border
      ctx.lineWidth = selected ? 1.5 : 1
      if (selected) {
        ctx.shadowColor = 'rgba(114, 255, 130, 0.36)'
        ctx.shadowBlur = 8
      }
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
      ctx.shadowBlur = 0
      if (selected) {
        ctx.fillStyle = MENU_COLORS.borderBright
        ctx.fillRect(rect.x, rect.y, 3, rect.height)
      }

      ctx.font = menuFont(small + 1, selected)
      ctx.fillStyle = selected ? MENU_COLORS.bright : MENU_COLORS.dim
      fillGlowText(ctx, String(index + 1).padStart(2, '0'), slotX, rect.y + 9)

      if (!slot) {
        ctx.fillStyle = selected ? MENU_COLORS.text : MENU_COLORS.dim
        fillGlowText(ctx, text.empty, nameX, rect.y + 9)
        ctx.font = menuFont(small)
        ctx.fillStyle = MENU_COLORS.dim
        fillGlowText(ctx, selected ? `ENTER — ${text.newGame}` : text.newGame, nameX, rect.y + 9 + lineHeight * 1.25)
      } else {
        ctx.fillStyle = selected ? MENU_COLORS.bright : MENU_COLORS.text
        fillGlowText(ctx, fitText(ctx, slot.name, Math.max(80, progressX - nameX - 12)), nameX, rect.y + 9)

        const ratio = slot.progressTotal > 0 ? slot.progressDone / slot.progressTotal : 0
        const compact = rowHeight < 54
        if (!compact) {
          ctx.font = menuFont(small)
          ctx.fillStyle = MENU_COLORS.dim
          fillGlowText(ctx, `${text.progress} ${slot.progressDone} / ${slot.progressTotal}`, nameX, rect.y + 9 + lineHeight * 1.2)
        }
        drawProgressBar(
          ctx,
          {
            x: progressX,
            y: rect.y + (compact ? rowHeight / 2 - 2 : rowHeight - 17),
            width: progressWidth - 40,
            height: 4,
          },
          ratio,
          ratio >= 1 ? MENU_COLORS.green : MENU_COLORS.yellow,
        )
        ctx.font = menuFont(small)
        ctx.textAlign = 'right'
        ctx.fillStyle = MENU_COLORS.text
        fillGlowText(ctx, `${Math.round(ratio * 100)}%`, dateX, rect.y + (compact ? rowHeight / 2 - lineHeight / 2 : rowHeight - 26))
        ctx.fillStyle = MENU_COLORS.dim
        fillGlowText(ctx, formatSaveDate(slot.updatedAt, this.language), dateX, rect.y + (compact ? rowHeight / 2 + 2 : rowHeight - 12))
        ctx.textAlign = 'left'
      }

      if (selected) {
        ctx.font = menuFont(Math.max(8, small - 1))
        ctx.fillStyle = MENU_COLORS.dim
        ctx.textAlign = 'right'
        fillGlowText(ctx, slot ? text.load : text.newGame, rect.x + rect.width - 10, rect.y + 9)
        ctx.textAlign = 'left'
      }
    }

    if (detailVisible) {
      const selected = this.slots[this.selectedIndex] ?? null
      const detailRect: MenuRect = {
        x: margin + listWidth + gap,
        y: listTop,
        width: detailWidth,
        height: Math.max(160, listBottom - listTop),
      }
      this.drawDetails(ctx, detailRect, selected, small, lineHeight)
    }

    ctx.font = menuFont(small)
    const footerY = height - margin - lineHeight
    if (this.message) {
      ctx.fillStyle = MENU_COLORS.yellow
      fillGlowText(ctx, fitText(ctx, this.message, width - margin * 2), margin, footerY)
    } else {
      ctx.fillStyle = MENU_COLORS.dim
      fillGlowText(ctx, fitText(ctx, text.hints, width - margin * 2), margin, footerY)
    }

    if (this.pendingDelete) {
      this.drawDeleteConfirmation(ctx, width, height, small, lineHeight, text)
    }

    ctx.restore()
  }

  private drawDetails(
    ctx: CanvasRenderingContext2D,
    rect: MenuRect,
    slot: SaveSlot | null,
    small: number,
    lineHeight: number,
  ): void {
    const text = TEXT[this.language]
    drawPanel(ctx, rect, MENU_COLORS.panelAlt)
    const pad = 13
    ctx.textAlign = 'left'
    ctx.font = menuFont(small + 1, true)
    ctx.fillStyle = MENU_COLORS.text
    fillGlowText(ctx, `${text.slot} ${String(this.selectedIndex + 1).padStart(2, '0')}`, rect.x + pad, rect.y + 11)
    drawRule(ctx, rect.x + pad, rect.y + 30, rect.width - pad * 2)

    if (!slot) {
      ctx.font = menuFont(small)
      ctx.fillStyle = MENU_COLORS.dim
      fillGlowText(ctx, text.empty, rect.x + pad, rect.y + 43)
      fillGlowText(ctx, `ENTER — ${text.newGame}`, rect.x + pad, rect.y + 43 + lineHeight * 1.4)
      return
    }

    let y = rect.y + 42
    ctx.font = menuFont(small + 2, true)
    ctx.fillStyle = MENU_COLORS.bright
    fillGlowText(ctx, fitText(ctx, slot.name, rect.width - pad * 2), rect.x + pad, y)
    y += lineHeight * 1.7

    const rows: Array<[string, string]> = [
      [text.created, formatSaveDate(slot.createdAt, this.language)],
      [text.updated, formatSaveDate(slot.updatedAt, this.language)],
      [text.playTime, formatDuration(slot.playSeconds, this.language)],
    ]
    for (const [label, value] of rows) {
      ctx.font = menuFont(small)
      ctx.fillStyle = MENU_COLORS.dim
      fillGlowText(ctx, label, rect.x + pad, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = MENU_COLORS.text
      fillGlowText(ctx, value, rect.x + rect.width - pad, y)
      ctx.textAlign = 'left'
      y += lineHeight * 1.35
    }

    const ratio = slot.progressTotal > 0 ? slot.progressDone / slot.progressTotal : 0
    y += lineHeight * 0.4
    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    fillGlowText(ctx, `${text.progress}  ${slot.progressDone} / ${slot.progressTotal}`, rect.x + pad, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = MENU_COLORS.text
    fillGlowText(ctx, `${Math.round(ratio * 100)}%`, rect.x + rect.width - pad, y)
    ctx.textAlign = 'left'
    drawProgressBar(
      ctx,
      { x: rect.x + pad, y: y + lineHeight + 3, width: rect.width - pad * 2, height: 5 },
      ratio,
      ratio >= 1 ? MENU_COLORS.green : MENU_COLORS.yellow,
    )
    y += lineHeight * 2.4

    ctx.font = menuFont(small, true)
    ctx.fillStyle = MENU_COLORS.dim
    fillGlowText(ctx, text.stages, rect.x + pad, y)
    y += lineHeight * 1.5

    const flags = slot.data.robot.flags
    const availableRows = Math.max(0, Math.floor((rect.y + rect.height - 12 - y) / (lineHeight * 1.15)))
    STAGES.slice(0, availableRows).forEach((stage, index) => {
      const done = Boolean(flags[stage.key])
      ctx.font = menuFont(small)
      ctx.fillStyle = done ? MENU_COLORS.green : MENU_COLORS.dim
      fillGlowText(ctx, `${done ? '[x]' : '[ ]'} ${stage[this.language]}`, rect.x + pad, y + index * lineHeight * 1.15)
    })
  }

  private drawDeleteConfirmation(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    small: number,
    lineHeight: number,
    text: SaveSelectText,
  ): void {
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)'
    ctx.fillRect(0, 0, width, height)
    const boxWidth = Math.min(420, width - 32)
    const boxHeight = Math.max(98, lineHeight * 4.8)
    const rect: MenuRect = {
      x: Math.floor((width - boxWidth) / 2),
      y: Math.floor((height - boxHeight) / 2),
      width: boxWidth,
      height: boxHeight,
    }
    drawPanel(ctx, rect, 'rgba(12, 28, 15, 0.98)', MENU_COLORS.red)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = menuFont(small + 2, true)
    ctx.fillStyle = MENU_COLORS.bright
    fillGlowText(ctx, text.deleteQuestion, width / 2, rect.y + 16)
    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    fillGlowText(ctx, text.deleteHint, width / 2, rect.y + 16 + lineHeight * 1.8)
    ctx.textAlign = 'left'
    ctx.restore()
  }
}
