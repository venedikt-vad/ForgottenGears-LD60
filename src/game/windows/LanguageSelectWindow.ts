import { FONT_FAMILY } from '../fonts'
import type { Input } from '../Input'
import type { GameLanguage, GameWindow } from './GameWindow'

type LanguageOption = { label: string; language: GameLanguage }

/** English is listed first so it is the default (index 0) selection. */
const OPTIONS: LanguageOption[] = [
  { label: 'ENGLISH', language: 'en' },
  { label: 'РУССКИЙ', language: 'ru' },
]

type OptionRect = { x: number; y: number; width: number; height: number }

/** A deliberately tiny, centered language picker. */
export class LanguageSelectWindow implements GameWindow {
  readonly id = 'language'

  private selectedIndex = 0
  private hoverIndex = -1
  private wasPointerDown = false
  private optionRects: OptionRect[] = []
  private readonly onSelect: (language: GameLanguage) => void

  constructor(onSelect: (language: GameLanguage) => void) {
    this.onSelect = onSelect
  }

  onShow(): void {
    this.selectedIndex = 0
    this.hoverIndex = -1
    this.wasPointerDown = false
    this.optionRects = []
  }

  update(_dt: number, input: Input): void {
    input.consumeWheelDelta()

    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) {
      this.selectedIndex = (this.selectedIndex + 1) % OPTIONS.length
    }
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) {
      this.selectedIndex = (this.selectedIndex + OPTIONS.length - 1) % OPTIONS.length
    }

    if (input.wasPressed('Digit1')) this.selectedIndex = 0
    if (input.wasPressed('Digit2')) this.selectedIndex = 1

    const pointer = input.pointerPosition
    this.hoverIndex = this.indexAt(pointer.x, pointer.y)

    const down = input.isPointerDown()
    const clicked = down && !this.wasPointerDown
    this.wasPointerDown = down

    if (this.hoverIndex >= 0) {
      this.selectedIndex = this.hoverIndex
      if (clicked) {
        this.onSelect(OPTIONS[this.selectedIndex].language)
        return
      }
    }

    if (input.wasPressed('Enter')) {
      this.onSelect(OPTIONS[this.selectedIndex].language)
    }
  }

  private indexAt(px: number, py: number): number {
    return this.optionRects.findIndex(
      (rect) =>
        px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height,
    )
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.clearRect(0, 0, width, height)

    const boxWidth = Math.min(280, width - 24)
    const boxHeight = 126
    const x = Math.floor((width - boxWidth) / 2)
    const y = Math.floor((height - boxHeight) / 2)
    const fontSize = width < 420 ? 11 : 12

    ctx.fillStyle = '#030703'
    ctx.fillRect(x, y, boxWidth, boxHeight)
    ctx.strokeStyle = '#477943'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1)

    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = '#9bcf91'
    ctx.fillText('LANGUAGE / ЯЗЫК', width / 2, y + 14)

    ctx.textAlign = 'left'
    const optionX = x + Math.max(28, (boxWidth - 155) / 2)
    const optionY = y + 43
    const rowHeight = 20
    this.optionRects = OPTIONS.map((option, index) => {
      const selected = index === this.selectedIndex
      const text = `${selected ? '>' : ' '} ${option.label}`
      ctx.fillStyle = selected ? '#d1e8a4' : '#659e5c'
      const rowY = optionY + index * rowHeight
      ctx.fillText(text, optionX, rowY)
      const textWidth = ctx.measureText(text).width
      return {
        x: optionX - 6,
        y: rowY - 4,
        width: textWidth + 12,
        height: rowHeight - 1,
      }
    })

    ctx.textAlign = 'center'
    ctx.font = `${Math.max(9, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = '#52774b'
    ctx.fillText('↑ ↓  /  ENTER  /  CLICK', width / 2, y + 101)
    ctx.restore()
  }
}
