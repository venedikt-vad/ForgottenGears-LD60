import { FONT_FAMILY } from '../fonts'
import type { Input } from '../Input'
import type { GameLanguage, GameWindow } from './GameWindow'

/** Renders custom content inside the reactor's inner circle. */
export type ReactorContentRenderer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
) => void

export type ReactorCoreWindowOptions = {
  id?: string
  /** Optional content drawn inside the rings. Clipped to the inner circle. */
  content?: ReactorContentRenderer
}

const COLORS = {
  background: '#0b0904',
  glow: 'rgba(255, 196, 64, 0.4)',
  bright: '#ffd766',
  mid: '#e0aa33',
  dim: '#6b5016',
  content: '#fff2c4',
  well: 'rgba(10, 8, 3, 0.85)',
}

/** A yellow reactor-core screen: three concentric rings rotating over each other. */
export class ReactorCoreWindow implements GameWindow {
  readonly id: string

  private language: GameLanguage = 'ru'
  private readonly ringAngles = [0, 0, 0]
  private readonly content: ReactorContentRenderer | null

  private activeRing: number | null = null
  private wasPointerDown = false
  private cx = 0
  private cy = 0
  private radius = 0

  constructor(options: ReactorCoreWindowOptions = {}) {
    this.id = options.id ?? 'reactor'
    this.content = options.content ?? null
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  update(_dt: number, input: Input): void {
    // Reactor does not scroll; discard wheel input so it never builds up.
    input.consumeWheelDelta()

    const delta = input.consumePointerDelta()
    const down = input.isPointerDown()

    // Grab the ring under the pointer when the drag begins, keep turning it until release.
    if (down && !this.wasPointerDown) {
      const position = input.pointerPosition
      this.activeRing = this.ringAt(position.x, position.y)
    } else if (!down) {
      this.activeRing = null
    }

    if (down && this.activeRing !== null) {
      const spin = delta.x * 0.006 + delta.y * 0.003
      this.ringAngles[this.activeRing] += spin
    }

    this.wasPointerDown = down
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) * 0.42

    // Remember geometry so pointer-down can hit-test the rings.
    this.cx = cx
    this.cy = cy
    this.radius = radius

    ctx.save()
    ctx.clearRect(0, 0, width, height)

    this.drawOuterRing(ctx, cx, cy, radius, this.ringAngles[0], this.activeRing === 0)
    this.drawMiddleRing(ctx, cx, cy, radius * 0.82, this.ringAngles[1], this.activeRing === 1)
    this.drawInnerRing(ctx, cx, cy, radius * 0.62, this.ringAngles[2], this.activeRing === 2)

    this.drawContent(ctx, cx, cy, radius * 0.46)

    ctx.restore()
  }

  /** Which ring sits under a screen point, or null for the content well. */
  private ringAt(x: number, y: number): number | null {
    if (this.radius <= 0) return null

    const distance = Math.hypot(x - this.cx, y - this.cy) / this.radius
    if (distance < 0.46) return null
    if (distance < 0.72) return 2
    if (distance < 0.9) return 1
    return 0
  }

  private drawOuterRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rotation: number,
    active: boolean,
  ): void {
    ctx.save()

    if (active) this.drawActiveHalo(ctx, cx, cy, radius)

    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()

    const ticks = 72
    for (let i = 0; i < ticks; i += 1) {
      const angle = rotation + (i / ticks) * Math.PI * 2
      const major = i % 6 === 0
      const inner = radius - (major ? 20 : 14)
      const outer = radius + 5
      ctx.strokeStyle = major ? COLORS.mid : COLORS.dim
      ctx.lineWidth = major ? 3 : 1.5
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
      ctx.stroke()
    }

    ctx.strokeStyle = COLORS.bright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 18
    ctx.lineWidth = 6
    for (let i = 0; i < 4; i += 1) {
      const start = rotation + (i / 4) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(cx, cy, radius, start, start + Math.PI * 0.28)
      ctx.stroke()
    }

    ctx.restore()
  }

  private drawMiddleRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rotation: number,
    active: boolean,
  ): void {
    ctx.save()

    if (active) this.drawActiveHalo(ctx, cx, cy, radius)

    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()

    const segments = 48
    ctx.strokeStyle = COLORS.mid
    ctx.lineWidth = 10
    for (let i = 0; i < segments; i += 1) {
      const angle = rotation + (i / segments) * Math.PI * 2
      const arcLength = ((Math.PI * 2) / segments) * 0.55
      ctx.beginPath()
      ctx.arc(cx, cy, radius, angle, angle + arcLength)
      ctx.stroke()
    }

    ctx.strokeStyle = COLORS.bright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 14
    ctx.lineWidth = 12
    for (let i = 0; i < 3; i += 1) {
      const start = rotation + (i / 3) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(cx, cy, radius, start, start + 0.25)
      ctx.stroke()
    }

    ctx.restore()
  }

  private drawInnerRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rotation: number,
    active: boolean,
  ): void {
    ctx.save()

    if (active) this.drawActiveHalo(ctx, cx, cy, radius)

    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()

    const teeth = 32
    ctx.strokeStyle = COLORS.mid
    ctx.lineWidth = 6
    for (let i = 0; i < teeth; i += 1) {
      const angle = rotation + (i / teeth) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
      ctx.lineTo(cx + Math.cos(angle) * (radius - 12), cy + Math.sin(angle) * (radius - 12))
      ctx.stroke()
    }

    ctx.strokeStyle = COLORS.bright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 16
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.86, 0, Math.PI * 2)
    ctx.stroke()

    ctx.restore()
  }

  /** Bright glow marking the ring currently being dragged. */
  private drawActiveHalo(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ): void {
    ctx.save()
    ctx.strokeStyle = COLORS.bright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 16
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  /** Dark well in the middle where content lives, clipped to a circle. */
  private drawContent(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ): void {
    ctx.save()

    ctx.fillStyle = COLORS.well
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.clip()

    if (this.content) this.content(ctx, cx, cy, radius)
    else this.drawDefaultContent(ctx, cx, cy, radius)

    ctx.restore()
  }

  private drawDefaultContent(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ): void {
    const title = this.language === 'ru' ? 'РЕАКТОРНОЕ ЯДРО' : 'REACTOR CORE'
    const subtitle = this.language === 'ru' ? 'СИСТЕМА СТАБИЛЬНА' : 'SYSTEM STABLE'
    const fontSize = Math.max(12, Math.round(radius * 0.16))

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.fillStyle = COLORS.content
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 8
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillText(title, cx, cy - fontSize * 0.8)

    ctx.shadowBlur = 0
    ctx.fillStyle = COLORS.mid
    ctx.font = `${Math.round(fontSize * 0.6)}px "${FONT_FAMILY}", monospace`
    ctx.fillText(subtitle, cx, cy + fontSize * 0.9)
  }
}
