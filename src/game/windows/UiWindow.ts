import { FONT_FAMILY } from '../fonts'
import { ImageDrawer } from '../ImageDrawer'
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

  private bodyImg: ImageDrawer | null = null
  private readonly schemeImage = new Image()

  private readonly parts = [
    { ru: 'ГОЛОВА / КАМЕРЫ', en: 'HEAD / CAMERAS' },
    { ru: 'ЛЕВАЯ РУКА', en: 'LEFT ARM' },
    { ru: 'ПРАВАЯ РУКА', en: 'RIGHT ARM' },
    { ru: 'ЦЕНТРАЛЬНЫЙ БЛОК', en: 'CORE UNIT' },
  ]

  constructor() {
    this.schemeImage.src = `${import.meta.env.BASE_URL}robot_scheme/scheme_01.png`
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.bodyImg = new ImageDrawer({
      image: this.schemeImage,
      beginTime: performance.now(),
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
    })
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
    ctx.clearRect(0,0,  width, height)

    const margin = width < 560 ? 14 : 34
    const fontSize = width < 560 ? 13 : width < 1100 ? 16 : 18
    const lineHeight = Math.round(fontSize * 1.65)
    const x = margin
    const y = margin
    const font = `${fontSize}px "${FONT_FAMILY}", monospace`
    const smallFont = `${Math.max(10, fontSize - 3)}px "${FONT_FAMILY}", monospace`

    const scheme = this.drawScheme(ctx, width, height, margin)
    const contentRight = scheme ? scheme.x - lineHeight : width - margin

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
        ctx.fillText(status, contentRight, itemY)
        ctx.textAlign = 'left'
      } else {
        ctx.font = smallFont
        ctx.fillStyle = '#ff765e'
        ctx.fillText(`       ${status}`, x, itemY + lineHeight * 0.8)
      }
    })

    const detailY = Math.min(height - lineHeight * 4, listStartY + this.parts.length * lineHeight * 1.35 + lineHeight)
    this.drawRule(ctx, x, detailY, contentRight - x)
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

    this.drawRule(ctx, x, height - margin - lineHeight * 2, contentRight - x)
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

  /**
   * Draws the robot schematic on the right side, scaled to fit while keeping the
   * source aspect ratio. Returns its rect so the text column can stay clear of it.
   */
  private drawScheme(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    margin: number,
  ): { x: number; y: number; width: number; height: number } | null {
    if (!this.bodyImg || width < 900) return null

    const aspect = 687 / 1024
    const schemeHeight = Math.min(height - margin * 2, height * 0.82)
    const schemeWidth = schemeHeight * aspect
    const schemeX = width - margin - schemeWidth
    const schemeY = (height - schemeHeight) / 2

    this.bodyImg.position = { x: schemeX, y: schemeY }
    this.bodyImg.size = { width: schemeWidth, height: schemeHeight }
    this.bodyImg.draw(ctx)

    return { x: schemeX, y: schemeY, width: schemeWidth, height: schemeHeight }
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
