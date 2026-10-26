import { playSfx } from '../sfx'
import type { Input } from '../Input'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'
import {
  MENU_COLORS,
  drawConsoleBackground,
  drawGlowText,
  drawPanel,
  drawProgressBar,
  drawRule,
  fitText,
  includesPoint,
  menuFont,
  type MenuRect,
} from './menu/MenuTheme'

interface MainMenuText {
  kicker: string
  subtitle: string
  menu: string[]
  language: string
  languageHint: string
  saveSlots: string
  ready: string
  hints: string
  authorsPending: string
}

const TEXT: Record<GameLanguage, MainMenuText> = {
  ru: {
    kicker: 'ROBOT OS // CONTROL SHELL',
    subtitle: 'СИСТЕМА ВОССТАНОВЛЕНИЯ  ·  ГЛАВНОЕ МЕНЮ',
    menu: ['ПРОДОЛЖИТЬ', 'НАСТРОЙКИ', 'АВТОРЫ', 'ВЫХОД'],
    language: 'ЯЗЫК ИНТЕРФЕЙСА',
    languageHint: '← / →',
    saveSlots: 'СОХРАНЕНИЙ',
    ready: 'СИСТЕМА ГОТОВА',
    hints: '↑/↓ ВЫБОР  ·  ENTER ПОДТВЕРДИТЬ  ·  ←/→ ЯЗЫК',
    authorsPending: 'АВТОРЫ: РАЗДЕЛ ГОТОВИТСЯ К ПУБЛИКАЦИИ.',
  },
  en: {
    kicker: 'ROBOT OS // CONTROL SHELL',
    subtitle: 'RECOVERY SYSTEM  ·  MAIN MENU',
    menu: ['CONTINUE', 'SETTINGS', 'AUTHORS', 'EXIT'],
    language: 'INTERFACE LANGUAGE',
    languageHint: '← / →',
    saveSlots: 'SAVE SLOTS',
    ready: 'SYSTEM READY',
    hints: '↑/↓ SELECT  ·  ENTER CONFIRM  ·  ←/→ LANGUAGE',
    authorsPending: 'AUTHORS: THE SECTION IS BEING PREPARED.',
  },
}

const LANGUAGES: Array<{ label: Record<GameLanguage, string>; language: GameLanguage }> = [
  { label: { ru: 'РУССКИЙ', en: 'RUSSIAN' }, language: 'ru' },
  { label: { ru: 'АНГЛИЙСКИЙ', en: 'ENGLISH' }, language: 'en' },
]

export interface MainMenuOptions {
  getSaveCount: () => number
  getLanguage: () => GameLanguage
  onLanguageChange: (language: GameLanguage) => void
  onContinue: () => void
  onSettings: () => void
  onExit: () => void
}

/** Console-style title screen. Navigation stays pinned to the left edge. */
export class MainMenuWindow implements GameWindow {
  readonly id = 'mainMenu'

  private readonly options: MainMenuOptions
  private language: GameLanguage = 'ru'
  private selectedIndex = 0
  private hoverIndex = -1
  private hoverLanguage = -1
  private wasPointerDown = false
  private time = 0
  private appearTime = 1
  private message = ''
  private messageTimer = 0
  private rowRects: MenuRect[] = []
  private languageRects: MenuRect[] = []

  constructor(options: MainMenuOptions) {
    this.options = options
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(_manager: WindowManager, input: Input): void {
    // A click that caused this transition is usually still held; do not treat
    // that same press as a click on the new screen.
    this.wasPointerDown = input.isPointerDown()
    this.hoverIndex = -1
    this.hoverLanguage = -1
    this.message = ''
    this.messageTimer = 0
    this.appearTime = 0
  }

  update(dt: number, input: Input): void {
    this.time += dt
    this.appearTime = Math.min(1.4, this.appearTime + dt)
    if (this.messageTimer > 0) {
      this.messageTimer = Math.max(0, this.messageTimer - dt)
      if (this.messageTimer === 0) this.message = ''
    }

    input.consumeWheelDelta()
    const pointer = input.pointerPosition
    this.hoverIndex = this.rowRects.findIndex((rect) => includesPoint(rect, pointer.x, pointer.y))
    this.hoverLanguage = this.languageRects.findIndex((rect) => includesPoint(rect, pointer.x, pointer.y))

    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.moveSelection(-1)
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.moveSelection(1)
    if (input.wasPressed('ArrowLeft') || input.wasPressed('ArrowRight') || input.wasPressed('KeyL')) {
      this.cycleLanguage()
    }

    for (let index = 0; index < 4; index += 1) {
      if (input.wasPressed(`Digit${index + 1}`)) {
        this.selectedIndex = index
        this.activate(index)
        return
      }
    }

    const down = input.isPointerDown()
    const clicked = down && !this.wasPointerDown
    this.wasPointerDown = down

    if (clicked && this.hoverLanguage >= 0) {
      const option = LANGUAGES[this.hoverLanguage]
      if (option) this.changeLanguage(option.language)
      return
    }

    if (clicked && this.hoverIndex >= 0) {
      this.selectedIndex = this.hoverIndex
      this.activate(this.hoverIndex)
      return
    }

    if (input.wasPressed('Enter') || input.wasPressed('Space')) this.activate(this.selectedIndex)
  }

  private moveSelection(amount: number): void {
    const next = (this.selectedIndex + amount + TEXT[this.language].menu.length) % TEXT[this.language].menu.length
    if (next === this.selectedIndex) return
    this.selectedIndex = next
    this.message = ''
    playSfx('selection')
  }

  private cycleLanguage(): void {
    const current = LANGUAGES.findIndex((option) => option.language === this.language)
    const next = LANGUAGES[(current + 1 + LANGUAGES.length) % LANGUAGES.length]
    if (next) this.changeLanguage(next.language)
  }

  private changeLanguage(language: GameLanguage): void {
    if (language === this.language) return
    this.language = language
    this.options.onLanguageChange(language)
    this.message = ''
    playSfx('selection')
  }

  private activate(index: number): void {
    playSfx('selection')
    if (index === 0) {
      this.options.onContinue()
      return
    }
    if (index === 1) {
      this.options.onSettings()
      return
    }
    if (index === 2) {
      this.message = TEXT[this.language].authorsPending
      this.messageTimer = 4
      return
    }
    this.options.onExit()
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const text = TEXT[this.language]
    const ru = this.language === 'ru'
    ctx.save()
    ctx.clearRect(0, 0, width, height)
    drawConsoleBackground(ctx, width, height, this.time)

    const margin = width < 560 ? 14 : width < 1000 ? 24 : 36
    const small = width < 560 ? 9 : width < 1000 ? 10 : 11
    const lineHeight = Math.ceil(small * 1.45)
    const titleSize = width < 520 ? 27 : width < 900 ? 38 : 50
    const menuWidth = Math.min(width * (width < 900 ? 0.7 : 0.48), 520)
    const menuFontSize = width < 520 ? 14 : width < 900 ? 17 : 20
    const menuRowHeight = Math.max(32, Math.min(44, Math.round(height * 0.055)))

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(text.kicker, margin, margin)

    const saveCount = this.options.getSaveCount()
    ctx.textAlign = 'right'
    ctx.fillStyle = MENU_COLORS.text
    ctx.fillText(`${text.saveSlots}: ${saveCount} / 6`, width - margin, margin)
    ctx.textAlign = 'left'

    const titleY = margin + lineHeight * 1.8
    const titleProgress = Math.min(1, this.appearTime / 0.45)
    const titleFont = menuFont(titleSize, true)
    ctx.font = titleFont
    ctx.save()
    ctx.globalAlpha = titleProgress
    drawGlowText(
      ctx,
      fitText(ctx, 'FORGOTTEN GEARS', width - margin * 2),
      margin,
      titleY,
      titleFont,
      MENU_COLORS.bright,
      14,
    )
    ctx.restore()

    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(
      fitText(ctx, text.subtitle, width - margin * 2),
      margin + 2,
      titleY + titleSize + 7,
    )

    const ruleY = titleY + titleSize + lineHeight + 12
    drawRule(ctx, margin, ruleY, Math.min(width - margin * 2, menuWidth + 90), Math.min(1, this.appearTime / 0.7))

    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(ru ? 'ВЫБЕРИТЕ ДЕЙСТВИЕ' : 'SELECT AN ACTION', margin + 2, ruleY + 11)

    const menuTop = ruleY + 11 + lineHeight * 1.9
    this.rowRects = []
    for (let index = 0; index < text.menu.length; index += 1) {
      const rowProgress = Math.min(1, Math.max(0, (this.appearTime - 0.18 - index * 0.06) / 0.28))
      const rect: MenuRect = {
        x: margin,
        y: menuTop + index * (menuRowHeight + 8),
        width: menuWidth,
        height: menuRowHeight,
      }
      this.rowRects.push(rect)
      const selected = index === this.selectedIndex
      const hovered = index === this.hoverIndex

      ctx.save()
      ctx.globalAlpha = rowProgress
      ctx.translate((1 - rowProgress) * -12, 0)
      if (selected || hovered) {
        ctx.fillStyle = MENU_COLORS.selected
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
        ctx.strokeStyle = selected ? MENU_COLORS.borderBright : MENU_COLORS.border
        ctx.lineWidth = selected ? 1.5 : 1
        if (selected) {
          ctx.shadowColor = 'rgba(114, 255, 130, 0.42)'
          ctx.shadowBlur = 10
        }
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
        ctx.shadowBlur = 0
        ctx.fillStyle = selected ? MENU_COLORS.borderBright : MENU_COLORS.dim
        ctx.fillRect(rect.x, rect.y, 3, rect.height)
      }

      ctx.font = menuFont(menuFontSize, selected)
      ctx.fillStyle = selected ? MENU_COLORS.bright : hovered ? MENU_COLORS.text : MENU_COLORS.dim
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const marker = selected ? '>' : ' '
      ctx.fillText(
        `${marker} ${String(index + 1).padStart(2, '0')}  ${text.menu[index]}`,
        rect.x + 15,
        rect.y + rect.height / 2 + 1,
      )

      if (selected) {
        ctx.font = menuFont(Math.max(8, small - 1))
        ctx.textAlign = 'right'
        ctx.fillStyle = MENU_COLORS.dim
        ctx.fillText('ENTER', rect.x + rect.width - 12, rect.y + rect.height / 2 + 1)
      }
      ctx.restore()
    }

    // Language selector, pinned to the same left edge as the menu.
    const footerHeight = lineHeight + 10
    const panelWidth = Math.min(menuWidth, width - margin * 2)
    const panelHeight = Math.max(58, lineHeight * 2 + 30)
    const panelRect: MenuRect = {
      x: margin,
      y: height - margin - footerHeight - panelHeight,
      width: panelWidth,
      height: panelHeight,
    }
    drawPanel(ctx, panelRect, MENU_COLORS.panelAlt)
    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.textAlign = 'left'
    ctx.fillText(text.language, panelRect.x + 12, panelRect.y + 8)
    ctx.textAlign = 'right'
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(text.languageHint, panelRect.x + panelRect.width - 12, panelRect.y + 8)
    ctx.textAlign = 'left'

    const optionGap = 8
    const optionHeight = Math.max(24, lineHeight + 12)
    const optionWidth = Math.floor((panelRect.width - 24 - optionGap) / 2)
    this.languageRects = []
    for (let index = 0; index < LANGUAGES.length; index += 1) {
      const option = LANGUAGES[index]
      const rect: MenuRect = {
        x: panelRect.x + 12 + index * (optionWidth + optionGap),
        y: panelRect.y + panelRect.height - optionHeight - 10,
        width: optionWidth,
        height: optionHeight,
      }
      this.languageRects.push(rect)
      const selected = option.language === this.language
      const hovered = index === this.hoverLanguage
      ctx.fillStyle = selected
        ? 'rgba(103, 218, 130, 0.22)'
        : hovered ? 'rgba(103, 218, 130, 0.1)' : 'rgba(2, 10, 5, 0.45)'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeStyle = selected ? MENU_COLORS.borderBright : MENU_COLORS.border
      ctx.lineWidth = selected ? 1.5 : 1
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
      ctx.font = menuFont(Math.max(10, small + 1), selected)
      ctx.fillStyle = selected ? MENU_COLORS.bright : MENU_COLORS.dim
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(option.label[this.language], rect.x + rect.width / 2, rect.y + rect.height / 2 + 1)
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    // Tertiary panel on wide screens: a compact boot/status readout.
    if (width >= 900 && height >= 620) {
      const statusWidth = Math.min(360, width * 0.32)
      const statusRect: MenuRect = {
        x: width - margin - statusWidth,
        y: Math.max(menuTop, height * 0.30),
        width: statusWidth,
        height: Math.max(172, Math.min(250, height * 0.34)),
      }
      drawPanel(ctx, statusRect, 'rgba(2, 14, 7, 0.6)')
      const pad = 14
      ctx.font = menuFont(small + 1, true)
      ctx.fillStyle = MENU_COLORS.text
      ctx.fillText(ru ? 'СОСТОЯНИЕ СИСТЕМЫ' : 'SYSTEM STATUS', statusRect.x + pad, statusRect.y + 12)
      drawRule(ctx, statusRect.x + pad, statusRect.y + 31, statusRect.width - pad * 2, 1)
      const lines = [
        `${text.ready}`,
        `${ru ? 'СЕЙВ-МОДУЛЬ' : 'SAVE MODULE'}: ${saveCount > 0 ? 'OK' : (ru ? 'ПУСТО' : 'EMPTY')}`,
        `${ru ? 'СЛОТЫ' : 'SLOTS'}: ${saveCount} / 6`,
        `${ru ? 'ВЕРСИЯ' : 'VERSION'}: ROM v1.08`,
        `${ru ? 'КАНАЛ' : 'CHANNEL'}: OPERATOR-01`,
      ]
      lines.forEach((line, index) => {
        ctx.font = menuFont(small)
        ctx.fillStyle = index === 0 ? MENU_COLORS.green : MENU_COLORS.dim
        ctx.fillText(fitText(ctx, line, statusRect.width - pad * 2), statusRect.x + pad, statusRect.y + 42 + index * lineHeight * 1.35)
      })

      const barY = statusRect.y + statusRect.height - 28
      ctx.fillStyle = MENU_COLORS.dim
      ctx.fillText(ru ? 'ЗАГРУЗКА ЯДРА' : 'KERNEL LOAD', statusRect.x + pad, barY - lineHeight - 2)
      drawProgressBar(
        ctx,
        { x: statusRect.x + pad, y: barY, width: statusRect.width - pad * 2, height: 4 },
        this.options.getSaveCount() > 0 ? 0.92 : 0.64,
        MENU_COLORS.green,
      )
      const blinkOn = Math.floor(this.time * 2) % 2 === 0
      if (blinkOn) {
        ctx.fillStyle = MENU_COLORS.green
        ctx.fillRect(statusRect.x + pad, barY + 10, 4, 4)
      }
    }

    // Messages replace the footer hint for a few seconds.
    ctx.font = menuFont(small)
    const footerY = height - margin - lineHeight
    if (this.message) {
      ctx.fillStyle = MENU_COLORS.yellow
      ctx.fillText(fitText(ctx, this.message, width - margin * 2), margin, footerY)
    } else {
      ctx.fillStyle = MENU_COLORS.dim
      ctx.fillText(fitText(ctx, text.hints, width * 0.72), margin, footerY)
      ctx.textAlign = 'right'
      ctx.fillStyle = MENU_COLORS.dim
      ctx.fillText(`FG-OS 1.08  ·  ${this.language.toUpperCase()}`, width - margin, footerY)
      ctx.textAlign = 'left'
    }

    ctx.restore()
  }
}
