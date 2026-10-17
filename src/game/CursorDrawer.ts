import { FONT_FAMILY } from './fonts'

export type CursorDrawerOptions = {
  /** Side length of the square drawn at the pointer. */
  size?: number
  /** Distance between the square and the start of the full-screen lines. */
  gap?: number
  color?: string
  lineWidth?: number
  /** Draw the x/y coordinate numbers at the base of each line. */
  showCoordinates?: boolean
  fontSize?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Hides the system cursor and draws a targeting reticle instead: a square at the
 * pointer with vertical and horizontal lines reaching in from the screen edges.
 */
export class CursorDrawer {
  x = 0
  y = 0
  visible = false

  size: number
  gap: number
  color: string
  lineWidth: number
  showCoordinates: boolean
  fontSize: number

  private host: HTMLElement | null = null
  private previousCursor = ''

  constructor(options: CursorDrawerOptions = {}) {
    this.size = options.size ?? 10
    this.gap = options.gap ?? 6
    this.color = options.color ?? '#ffae00'
    this.lineWidth = options.lineWidth ?? 2
    this.showCoordinates = options.showCoordinates ?? true
    this.fontSize = options.fontSize ?? 11
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    this.x = event.clientX
    this.y = event.clientY
    this.visible = true
  }

  private readonly onPointerEnter = () => {
    this.visible = true
  }

  private readonly onPointerLeave = () => {
    this.visible = false
  }

  /** Hides the cursor on `host` and starts tracking pointer movement. */
  attach(host: HTMLElement = document.body) {
    this.host = host
    this.previousCursor = host.style.cursor
    host.style.cursor = 'none'

    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerdown', this.onPointerMove)
    window.addEventListener('pointerenter', this.onPointerEnter)
    document.addEventListener('pointerleave', this.onPointerLeave)
    window.addEventListener('blur', this.onPointerLeave)
  }

  detach() {
    if (this.host) {
      this.host.style.cursor = this.previousCursor
      this.host = null
    }

    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerdown', this.onPointerMove)
    window.removeEventListener('pointerenter', this.onPointerEnter)
    document.removeEventListener('pointerleave', this.onPointerLeave)
    window.removeEventListener('blur', this.onPointerLeave)
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.visible) return

    const cx = Math.floor(clamp(this.x, 0, width)) + 0.5
    const cy = Math.floor(clamp(this.y, 0, height)) + 0.5

    const half = this.size / 2
    const reach = half + this.gap
    const left = Math.floor(cx - half) + 0.5
    const top = Math.floor(cy - half) + 0.5

    ctx.save()
    ctx.strokeStyle = this.color
    ctx.lineWidth = this.lineWidth

    // Square standing in for the cursor.
    ctx.strokeRect(left, top, this.size, this.size)

    // Lines reaching toward the square from each screen edge.
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, cy - reach)
    ctx.moveTo(cx, cy + reach)
    ctx.lineTo(cx, height)

    ctx.moveTo(0, cy)
    ctx.lineTo(cx - reach, cy)
    ctx.moveTo(cx + reach, cy)
    ctx.lineTo(width, cy)
    ctx.stroke()

    if (this.showCoordinates) {
      const pad = 4
      const xText = `${Math.round(this.x)}`
      const yText = `${Math.round(this.y)}`

      ctx.font = `${this.fontSize}px "${FONT_FAMILY}", monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = this.color

      // x at the base of the vertical line (top edge).
      const xLabelX = clamp(cx + this.gap + pad, pad, width - ctx.measureText(xText).width - pad)
      ctx.fillText(xText, xLabelX, pad)

      // y at the base of the horizontal line (left edge).
      const yLabelY = clamp(cy + this.gap + pad, pad, height - this.fontSize - pad)
      ctx.fillText(yText, pad, yLabelY)
    }

    ctx.restore()
  }
}
