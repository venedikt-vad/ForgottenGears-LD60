import { FONT_FAMILY } from './fonts'
import type { Input } from './Input'
import type { GameLanguage, GameWindow } from './GameWindow'

/** A deliberately tiny, centered language picker. */
export class LanguageSelectWindow implements GameWindow {
  readonly id = 'language'

  private selectedIndex = 0

  constructor(private readonly onSelect: (language: GameLanguage) => void) {}

  update(_dt: number, input: Input): void {
    input.consumeWheelDelta()
    if (input.wasPressed('ArrowUp') || input.wasPressed('ArrowDown') || input.wasPressed('KeyW') || input.wasPressed('KeyS')) {
      this.selectedIndex = (this.selectedIndex + 1) % 2
    }

    if (input.wasPressed('Digit1')) this.selectedIndex = 0
    if (input.wasPressed('Digit2')) this.selectedIndex = 1

    if (input.wasPressed('Enter')) {
      this.onSelect(this.selectedIndex === 0 ? 'ru' : 'en')
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.fillStyle = '#020402'
    ctx.fillRect(0, 0, width, height)

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
    const options = ['РУССКИЙ', 'ENGLISH']
    options.forEach((label, index) => {
      const selected = index === this.selectedIndex
      ctx.fillStyle = selected ? '#d1e8a4' : '#659e5c'
      ctx.fillText(`${selected ? '>' : ' '} ${label}`, optionX, optionY + index * 20)
    })

    ctx.textAlign = 'center'
    ctx.font = `${Math.max(9, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = '#52774b'
    ctx.fillText('↑ ↓  /  ENTER', width / 2, y + 101)
    ctx.restore()
  }
}
