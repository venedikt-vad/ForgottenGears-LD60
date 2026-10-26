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
  menuFont,
  type MenuRect,
} from './menu/MenuTheme'

interface ShutdownText {
  kicker: string
  title: string
  subtitle: string
  lines: string[]
  prompt: string
  note: string
  status: string
}

const TEXT: Record<GameLanguage, ShutdownText> = {
  ru: {
    kicker: 'ROBOT OS // CONTROL SHELL',
    title: 'СИСТЕМА ОСТАНОВЛЕНА',
    subtitle: 'БЕЗОПАСНОЕ ЗАВЕРШЕНИЕ СЕАНСА',
    lines: [
      'ВСЕ СЛУЖБЫ ОСТАНОВЛЕНЫ.',
      'НЕСОХРАНЁННЫЕ ИЗМЕНЕНИЯ ЗАПИСАНЫ В АКТИВНЫЙ СЛОТ.',
      'ПИТАНИЕ КОРПУСА ОТКЛЮЧЕНО.',
    ],
    prompt: 'ENTER — ВЕРНУТЬСЯ В ГЛАВНОЕ МЕНЮ',
    note: 'БРАУЗЕР НЕ ПОЗВОЛЯЕТ ИГРЕ ЗАКРЫТЬ ВКЛАДКУ АВТОМАТИЧЕСКИ.',
    status: 'СЕАНС ЗАВЕРШЁН',
  },
  en: {
    kicker: 'ROBOT OS // CONTROL SHELL',
    title: 'SYSTEM HALTED',
    subtitle: 'SAFE SESSION SHUTDOWN',
    lines: [
      'ALL SERVICES HAVE STOPPED.',
      'UNSAVED CHANGES WERE WRITTEN TO THE ACTIVE SLOT.',
      'BODY POWER IS DISCONNECTED.',
    ],
    prompt: 'ENTER — RETURN TO MAIN MENU',
    note: 'THE BROWSER DOES NOT ALLOW THE GAME TO CLOSE THE TAB AUTOMATICALLY.',
    status: 'SESSION COMPLETE',
  },
}

export interface ShutdownOptions {
  onReturn: () => void
}

/** Browser-safe "exit": a console-style halt screen that returns to the menu. */
export class ShutdownWindow implements GameWindow {
  readonly id = 'shutdown'

  private readonly options: ShutdownOptions
  private language: GameLanguage = 'ru'
  private time = 0
  private wasPointerDown = false

  constructor(options: ShutdownOptions) {
    this.options = options
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(_manager: WindowManager, input: Input): void {
    this.time = 0
    // A click that caused this transition is usually still held; require a new
    // press before returning to the title screen.
    this.wasPointerDown = input.isPointerDown()
  }

  update(dt: number, input: Input): void {
    this.time += dt
    input.consumeWheelDelta()
    const down = input.isPointerDown()
    const clicked = down && !this.wasPointerDown
    this.wasPointerDown = down

    if (input.wasPressed('Enter') || input.wasPressed('Space') || input.wasPressed('Escape') || clicked) {
      this.options.onReturn()
    }
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
    const titleSize = width < 520 ? 24 : width < 900 ? 32 : 42
    const panelWidth = Math.min(width - margin * 2, 720)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(text.kicker, margin, margin)

    ctx.textAlign = 'right'
    ctx.fillStyle = MENU_COLORS.yellow
    ctx.fillText(text.status, width - margin, margin)
    ctx.textAlign = 'left'

    const titleY = margin + lineHeight * 2.2
    const titleFont = menuFont(titleSize, true)
    ctx.font = titleFont
    drawGlowText(
      ctx,
      fitText(ctx, text.title, width - margin * 2),
      margin,
      titleY,
      titleFont,
      MENU_COLORS.bright,
      14,
    )

    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(fitText(ctx, text.subtitle, width - margin * 2), margin + 2, titleY + titleSize + 8)

    const ruleY = titleY + titleSize + lineHeight * 2
    drawRule(ctx, margin, ruleY, panelWidth)

    const panelRect: MenuRect = {
      x: margin,
      y: ruleY + 16,
      width: panelWidth,
      height: Math.max(150, Math.min(240, lineHeight * 10)),
    }
    drawPanel(ctx, panelRect, MENU_COLORS.panelAlt)
    const pad = 16
    ctx.font = menuFont(small + 1, true)
    ctx.fillStyle = MENU_COLORS.green
    ctx.fillText(ru ? 'СОСТОЯНИЕ СИСТЕМЫ' : 'SYSTEM STATE', panelRect.x + pad, panelRect.y + 14)
    drawRule(ctx, panelRect.x + pad, panelRect.y + 33, panelRect.width - pad * 2, 1, 'rgba(83, 158, 98, 0.25)')

    text.lines.forEach((line, index) => {
      ctx.font = menuFont(small + 1)
      ctx.fillStyle = MENU_COLORS.text
      ctx.fillText(
        fitText(ctx, line, panelRect.width - pad * 2 - 18),
        panelRect.x + pad + 14,
        panelRect.y + 48 + index * lineHeight * 1.5,
      )
      ctx.fillStyle = MENU_COLORS.green
      ctx.fillRect(panelRect.x + pad, panelRect.y + 51 + index * lineHeight * 1.5, 4, 4)
    })

    const barY = panelRect.y + panelRect.height - 24
    drawProgressBar(
      ctx,
      { x: panelRect.x + pad, y: barY, width: panelRect.width - pad * 2, height: 4 },
      0,
      MENU_COLORS.dim,
    )

    const promptY = panelRect.y + panelRect.height + lineHeight * 1.8
    const blinkOn = Math.floor(this.time * 2) % 2 === 0
    ctx.font = menuFont(small + 2, true)
    ctx.fillStyle = MENU_COLORS.bright
    if (blinkOn) {
      ctx.fillText('>', margin, promptY)
    }
    ctx.fillStyle = MENU_COLORS.text
    ctx.fillText(fitText(ctx, text.prompt, width - margin * 2 - small * 2), margin + small * 2, promptY)

    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(
      fitText(ctx, text.note, width - margin * 2),
      margin,
      Math.min(height - margin - lineHeight, promptY + lineHeight * 2),
    )

    ctx.textAlign = 'right'
    ctx.fillText(`FG-OS 1.08  ·  ${this.language.toUpperCase()}`, width - margin, height - margin - lineHeight)
    ctx.textAlign = 'left'

    ctx.restore()
  }
}
