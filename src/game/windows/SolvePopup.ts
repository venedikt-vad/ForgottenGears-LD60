import { FONT_FAMILY } from '../fonts'

/** Title and hint lines drawn inside the "system restored" notice. */
export type SolvePopupContent = {
  title: string
  hint: string
}

// Animation timeline (seconds): the border scales in first, the translucent
// background fades up behind it, then the text fades in last and the border
// settles from its bright intro green to the dimmer frame green.
const BORDER_TIME = 0.28
const FILL_START = BORDER_TIME
const FILL_TIME = 0.22
const TEXT_START = FILL_START + FILL_TIME
const TEXT_TIME = 0.25

const BORDER_BRIGHT = '#89f5a4'
const BORDER_SETTLED = '#376d42'
const BORDER_GLOW = 'rgba(137, 245, 164, 0.55)'
const FILL = 'rgba(12, 34, 19, 0.78)'
const TITLE_COLOR = '#eaffea'
const TITLE_GLOW = 'rgba(137, 245, 164, 0.6)'
const HINT_COLOR = '#8fce9f'

const PAD_X = 26
const PAD_Y = 18
const TITLE_GAP = 8
// The box never grows wider than this much of the window, so short windows keep margins.
const WIDTH_MARGIN = 24

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Blend two #rrggbb colours, used to settle the border from bright to dim green. */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  const from = parse(a)
  const to = parse(b)
  const channel = (index: number): string =>
    Math.round(lerp(from[index], to[index], t))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

/**
 * Small centred notice shown when a system has been restored: the border draws
 * first, the translucent green background follows, then the title and the
 * return hint fade in. Not a window itself — the owning window drives it.
 */
export class SolvePopup {
  private shown = false
  private time = 0

  /** Latch the popup; the entrance animation replays only after a hide. */
  show(): void {
    if (this.shown) return
    this.shown = true
    this.time = 0
  }

  hide(): void {
    this.shown = false
    this.time = 0
  }

  /** True while the notice is latched on screen. */
  get active(): boolean {
    return this.shown
  }

  /**
   * Advance the animation. Pass `winActive` to keep the popup tied to a win
   * flag: true shows it, false hides it, undefined leaves the latch alone.
   */
  update(dt: number, winActive?: boolean): void {
    if (winActive === true) this.show()
    else if (winActive === false) this.hide()
    if (this.shown) this.time += dt
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, content: SolvePopupContent): void {
    if (!this.shown || width <= 0 || height <= 0) return

    ctx.save()

    const fontSize = width < 560 ? 12 : width < 1100 ? 14 : 16
    const hintSize = Math.max(9, fontSize - 3)
    const titleFont = `${fontSize}px "${FONT_FAMILY}", monospace`
    const hintFont = `${hintSize}px "${FONT_FAMILY}", monospace`

    ctx.font = titleFont
    const titleWidth = ctx.measureText(content.title).width
    ctx.font = hintFont
    const hintWidth = ctx.measureText(content.hint).width

    const boxWidth = Math.min(width - WIDTH_MARGIN, Math.max(titleWidth, hintWidth) + PAD_X * 2)
    const titleLine = Math.round(fontSize * 1.35)
    const hintLine = Math.round(hintSize * 1.35)
    const boxHeight = PAD_Y * 2 + titleLine + TITLE_GAP + hintLine

    const cx = width / 2
    const cy = height / 2
    const x = Math.round(cx - boxWidth / 2)
    const y = Math.round(cy - boxHeight / 2)

    const borderT = clamp01(this.time / BORDER_TIME)
    if (borderT <= 0) {
      ctx.restore()
      return
    }
    const fillT = clamp01((this.time - FILL_START) / FILL_TIME)
    const textT = clamp01((this.time - TEXT_START) / TEXT_TIME)
    const settle = easeOut(textT)

    // Translucent background, full size while it fades up.
    if (fillT > 0) {
      ctx.globalAlpha = easeOut(fillT)
      ctx.fillStyle = FILL
      ctx.fillRect(x, y, boxWidth, boxHeight)
      ctx.globalAlpha = 1
    }

    // Border scales in from the centre, then settles to the frame green.
    const scale = 0.55 + 0.45 * easeOut(borderT)
    ctx.save()
    ctx.globalAlpha = borderT
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)
    ctx.strokeStyle = mixHex(BORDER_BRIGHT, BORDER_SETTLED, settle)
    ctx.lineWidth = 2
    ctx.shadowColor = BORDER_GLOW
    ctx.shadowBlur = 16 * (1 - settle) + 6 * settle
    ctx.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1)
    ctx.restore()

    if (textT > 0) {
      const textAlpha = easeOut(textT)
      const maxWidth = Math.max(1, boxWidth - PAD_X * 2)

      ctx.save()
      ctx.globalAlpha = textAlpha
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'

      ctx.font = titleFont
      ctx.fillStyle = TITLE_COLOR
      ctx.shadowColor = TITLE_GLOW
      ctx.shadowBlur = 8
      ctx.fillText(content.title, cx, y + PAD_Y, maxWidth)
      ctx.shadowBlur = 0

      ctx.font = hintFont
      ctx.fillStyle = HINT_COLOR
      ctx.fillText(content.hint, cx, y + PAD_Y + titleLine + TITLE_GAP, maxWidth)
      ctx.restore()
    }

    ctx.restore()
  }
}
