import { FONT_FAMILY } from '../fonts'
import type { Input } from '../Input'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

/** A BIOS-like textual maintenance utility. The window can be reopened without losing selection. */
export class UiWindow implements GameWindow {
  readonly id = 'ui'

  private manager: WindowManager | null = null
  private language: GameLanguage = 'ru'
  private selectedIndex = 0
  private inspectedIndex: number | null = null

  private readonly parts = [
    { ru: 'ГОЛОВА / КАМЕРЫ', en: 'HEAD / CAMERAS' },
    { ru: 'ЛЕВАЯ РУКА', en: 'LEFT ARM' },
    { ru: 'ПРАВАЯ РУКА', en: 'RIGHT ARM' },
    { ru: 'ЦЕНТРАЛЬНЫЙ БЛОК', en: 'CORE UNIT' },
  ]

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
  }

  update(_dt: number, input: Input): void {
    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('console')
      return
    }

    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) {
      this.selectedIndex = (this.selectedIndex + this.parts.length - 1) % this.parts.length
      this.inspectedIndex = null
    }
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) {
      this.selectedIndex = (this.selectedIndex + 1) % this.parts.length
      this.inspectedIndex = null
    }

    const digitKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4']
    digitKeys.forEach((key, index) => {
      if (input.wasPressed(key)) {
        this.selectedIndex = index
        this.inspectedIndex = null
      }
    })

    if (input.wasPressed('Enter')) this.inspectedIndex = this.selectedIndex
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.fillStyle = '#020602'
    ctx.fillRect(0, 0, width, height)

    const margin = width < 560 ? 14 : 34
    const fontSize = width < 560 ? 13 : width < 1100 ? 16 : 18
    const lineHeight = Math.round(fontSize * 1.65)
    const x = margin
    const y = margin
    const font = `${fontSize}px "${FONT_FAMILY}", monospace`
    const smallFont = `${Math.max(10, fontSize - 3)}px "${FONT_FAMILY}", monospace`

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = font
    ctx.fillStyle = '#bcffae'
    ctx.shadowColor = 'rgba(114, 255, 98, 0.25)'
    ctx.shadowBlur = 3
    ctx.fillText(this.language === 'ru' ? 'УТИЛИТА ОБСЛУЖИВАНИЯ РОБОТА' : 'ROBOT MAINTENANCE UTILITY', x, y)
    ctx.shadowBlur = 0

    ctx.font = smallFont
    ctx.fillStyle = '#659e5c'
    ctx.fillText('SERVICE MODE / BUILD 0.4.1', x, y + lineHeight * 1.5)
    this.drawRule(ctx, x, y + lineHeight * 2.5, width - margin * 2)

    ctx.font = font
    ctx.fillStyle = '#bcffae'
    ctx.fillText(this.language === 'ru' ? 'ВЫБЕРИТЕ УЗЕЛ ДЛЯ ДИАГНОСТИКИ:' : 'SELECT COMPONENT TO INSPECT:', x, y + lineHeight * 4)

    const listStartY = y + lineHeight * 6
    this.parts.forEach((part, index) => {
      const selected = index === this.selectedIndex
      const itemY = listStartY + index * lineHeight * 1.35
      ctx.font = font
      ctx.fillStyle = selected ? '#d8c783' : '#bcffae'
      const name = part[this.language]
      const status = this.language === 'ru' ? 'НЕТ ОТВЕТА' : 'NO RESPONSE'
      ctx.fillText(`${selected ? '>' : ' '} [${index + 1}] ${name}`, x, itemY)

      // Keep statuses on the same row on wide screens; move them below on narrow screens.
      if (width > 760) {
        ctx.textAlign = 'right'
        ctx.fillStyle = '#ff765e'
        ctx.fillText(status, width - margin, itemY)
        ctx.textAlign = 'left'
      } else {
        ctx.font = smallFont
        ctx.fillStyle = '#ff765e'
        ctx.fillText(`       ${status}`, x, itemY + lineHeight * 0.8)
      }
    })

    const detailY = Math.min(height - lineHeight * 4, listStartY + this.parts.length * lineHeight * 1.35 + lineHeight)
    this.drawRule(ctx, x, detailY, width - margin * 2)
    ctx.font = font
    if (this.inspectedIndex !== null) {
      ctx.fillStyle = '#ff765e'
      ctx.fillText(this.language === 'ru'
        ? `ОШИБКА: ${this.parts[this.inspectedIndex][this.language]} НЕ ОТВЕЧАЕТ.`
        : `ERROR: ${this.parts[this.inspectedIndex][this.language]} NOT RESPONDING.`, x, detailY + lineHeight)
      ctx.fillStyle = '#d8c783'
      ctx.fillText(this.language === 'ru' ? 'ТРЕБУЕТСЯ РУЧНОЕ ВОССТАНОВЛЕНИЕ.' : 'MANUAL RECOVERY REQUIRED.', x, detailY + lineHeight * 2)
    } else {
      ctx.fillStyle = '#659e5c'
      ctx.fillText(this.language === 'ru' ? 'ENTER — ЗАПУСТИТЬ ДИАГНОСТИКУ УЗЛА' : 'ENTER — RUN COMPONENT DIAGNOSTICS', x, detailY + lineHeight)
    }

    this.drawRule(ctx, x, height - margin - lineHeight * 2, width - margin * 2)
    ctx.font = smallFont
    ctx.fillStyle = '#659e5c'
    ctx.fillText(
      this.language === 'ru'
        ? '↑ / ↓ ИЛИ 1–4: ВЫБОР   ENTER: ПРОВЕРКА   ESC / C: КОНСОЛЬ'
        : '↑ / ↓ OR 1–4: SELECT   ENTER: INSPECT   ESC / C: CONSOLE',
      x,
      height - margin - lineHeight,
    )

    ctx.restore()
  }

  private drawRule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
    ctx.strokeStyle = '#376d32'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, Math.floor(y) + 0.5)
    ctx.lineTo(x + width, Math.floor(y) + 0.5)
    ctx.stroke()
  }
}
