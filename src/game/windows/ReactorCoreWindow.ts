import { FONT_FAMILY } from '../fonts'
import { playSfx } from '../sfx'
import type { Input } from '../Input'
import type { GameWindow } from './GameWindow'
import { SolvePopup } from './SolvePopup'
import type { WindowManager } from './WindowManager'

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
  panel: 'rgba(11, 9, 4, 0.0)',
  border: 'rgba(224, 170, 51, 0.22)',
  glow: 'rgba(255, 196, 64, 0.4)',
  bright: '#ffd766',
  mid: '#e0aa33',
  dim: '#6b5016',
  content: '#fff2c4',
  well: 'rgba(10, 8, 3, 0.85)',
  laser: '#ff3b30',
  laserGlow: 'rgba(255, 70, 40, 0.55)',
  track: 'rgba(120, 40, 20, 0.6)',
  stable: '#66ff88',
}

const MARGIN = 28
// Spacing of the decorative 45-degree lines running down from the sides.
const DIAGONAL_STEP = 200 / 3

// Lasers live inside the inner (content) ring: each emitter rides that ring and the
// beam reflects off the same wall once. The ring's rotation swings the emitter around
// the wall while the aim sweeps at its own rate (LASER_SPIN); the aim is folded so it
// always points inward and the beam stays contained.
const LASER_TILT = [0.4, 0.5, 0.62]
const LASER_SPIN = [2, -1.5, 1.3]
const LASER_OFFSET = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]
const CORE_SCALE = 0.46

// Big, faint background rings half-off the left/right/top edges. Each one trails a
// primary ring at its own pace when that ring is turned (negative = counter-spin).
// ox/oy nudge the centre so the group never sits perfectly centred (primary-radius
// units), letting the rings peek in at uneven, organic angles. Each ring is sized
// so it exactly touches the primary ring that drives it.
const DECOR_RINGS = [
  { ring: 0, anchor: 'left', pace: -0.45, ox: 0.04, oy: -0.22 },
  { ring: 1, anchor: 'top', pace: 0.7, ox: 0.16, oy: -0.06 },
  { ring: 2, anchor: 'right', pace: 1.6, ox: -0.08, oy: 0.27 },
] as const

// Primary ring radii as a fraction of the outer ring, indexed by ring number.
const PRIMARY_SCALES = [1, 0.82, 0.62]

// Activation nodes sit on the lasers' paths: they are laid on the beams at a solved
// rotation, then the rings are scrambled. The hit radius is kept small so the player
// has to line each beam up precisely.
const NODE_HIT_SCALE = 0.06
const NODE_FADE = 3
// Points must stay at least this far apart (in core-normalized units), otherwise the
// whole puzzle is rolled again.
const NODE_MIN_SPACING = 0.2
const MAX_PUZZLE_ATTEMPTS = 60

// Left-side signal monitor. The trace scrolls vertically; its noise shrinks as the
// reactor stabilizes (noise scales with 1 - stability). It sits beside a second
// monitor that plots the recent stability history as a line graph.
const WAVE_FREQ = 0.06
const WAVE_SPEED = 2.2
const WAVE_AMPLITUDE = 30
const WAVE_NOISE = 22
const MONITOR_WIDTH = 132
const STABILITY_WIDTH = 132
const MONITOR_GAP = 16
const MONITOR_MAX_HEIGHT = 600
// Stability history sampling: one point every STABILITY_SAMPLE seconds, capped at
// STABILITY_SAMPLES points (newest at the bottom of the vertical graph).
const STABILITY_SAMPLE = 0.1
const STABILITY_SAMPLES = 120

// Appear animation timeline (seconds): rings snap in one after another, then the
// core content and lasers, then the readout progress bars fill up.
const APPEAR_RING = 0.6
const APPEAR_RING_STAGGER = 0.18
const APPEAR_CORE = 0.5
const APPEAR_CORE_START = APPEAR_RING_STAGGER * 2
const APPEAR_BARS = 0.7
const APPEAR_BARS_START = 0.5
const APPEAR_WAVE = 0.6
const APPEAR_WAVE_START = 0.55
const APPEAR_LINES = 1.6
const APPEAR_LINES_START = 0.
const APPEAR_LINE_STAGGER = 0.08
const APPEAR_TOTAL = 1.8

/** Eased 0..1 reveal that starts at `start` and finishes `duration` later. */
function reveal(time: number, duration: number, start: number): number {
  const t = (time - start) / duration
  return Math.max(0, Math.min(1, t))
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Angle in radians to a fixed-width, 0..360 degree readout. */
function formatAngle(radians: number): string {
  const deg = ((radians * 180) / Math.PI) % 360
  const wrapped = deg < 0 ? deg + 360 : deg
  return `${wrapped.toFixed(1)}°`.padStart(7)
}

/** Font size shared by the bottom-right telemetry block and the dial row. */
function telemetryFontSize(width: number): number {
  return width < 560 ? 11 : width < 1100 ? 12 : 14
}

/** Number of telemetry rows in the bottom-right angles block. */
const ANGLE_ROWS = 6

/** Intersection distances of a ray with a circle, or null if it misses. */
function rayCircleRoots(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  centerX: number,
  centerY: number,
  radius: number,
): [number, number] | null {
  const mx = originX - centerX
  const my = originY - centerY
  const b = mx * dirX + my * dirY
  const c = mx * mx + my * my - radius * radius
  const discriminant = b * b - c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  return [-b - root, -b + root]
}

/** Reflect an angle into (-PI/2, PI/2] with period PI, keeping a rim beam inward. */
function foldHalfPi(angle: number): number {
  let x = angle % Math.PI
  if (x < 0) x += Math.PI
  if (x > Math.PI / 2) x -= Math.PI
  return x
}

/** Shortest distance from a point to a line segment. */
function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  let t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Beam endpoints in core-normalized space (inner radius = 1): emitter, bounce, exit. */
type LaserPath = {
  originX: number
  originY: number
  hitX: number
  hitY: number
  exitX: number
  exitY: number
}

/** Geometry of one laser for a given ring rotation, normalized to the core radius. */
function laserPath(index: number, ringAngle: number): LaserPath {
  const theta = ringAngle + LASER_OFFSET[index]
  const originX = Math.cos(theta)
  const originY = Math.sin(theta)

  const beamAngle =
    theta + Math.PI + foldHalfPi(LASER_TILT[index] + (LASER_SPIN[index] - 1) * ringAngle)
  const dirX = Math.cos(beamAngle)
  const dirY = Math.sin(beamAngle)

  // Origin sits on the unit circle, so the first positive root is the bounce point.
  const roots = rayCircleRoots(originX, originY, dirX, dirY, 0, 0, 1)
  let hitDistance = Infinity
  if (roots) {
    for (const root of roots) {
      if (root > 1e-4) hitDistance = Math.min(hitDistance, root)
    }
  }
  if (!Number.isFinite(hitDistance)) hitDistance = 1

  const hitX = originX + dirX * hitDistance
  const hitY = originY + dirY * hitDistance

  // Reflect about the radial normal (unit circle: the normal is simply the point).
  const dot = dirX * hitX + dirY * hitY
  const reflectX = dirX - 2 * dot * hitX
  const reflectY = dirY - 2 * dot * hitY

  let exitDistance = 0
  const exitRoots = rayCircleRoots(hitX, hitY, reflectX, reflectY, 0, 0, 1)
  if (exitRoots) {
    for (const root of exitRoots) {
      if (root > exitDistance) exitDistance = root
    }
  }
  if (exitDistance <= 0) exitDistance = 1

  return {
    originX,
    originY,
    hitX,
    hitY,
    exitX: hitX + reflectX * exitDistance,
    exitY: hitY + reflectY * exitDistance,
  }
}

/** Point at fraction t along the segment a -> b. */
function lerpPoint(ax: number, ay: number, bx: number, by: number, t: number): Node {
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t }
}

/** A target point inside the core, stored in core-normalized space. */
type Node = { x: number; y: number }

/** Whether two normalized points sit closer than the minimum spacing. */
function pointsTooClose(a: Node, b: Node): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < NODE_MIN_SPACING
}

/** Two-rect progress bar: a full track plus a value fill (vertical fills bottom-up). */
function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number,
  color: string,
  vertical = false,
): void {
  const amount = Math.max(0, Math.min(1, value))

  ctx.fillStyle = COLORS.track
  ctx.fillRect(x, y, width, height)

  ctx.fillStyle = color
  if (vertical) ctx.fillRect(x, y + height * (1 - amount), width, height * amount)
  else ctx.fillRect(x, y, width * amount, height)
}

/** A yellow reactor-core screen: three concentric rings rotating over each other. */
export class ReactorCoreWindow implements GameWindow {
  readonly id: string

  private readonly ringAngles = [0, 0, 0]
  private readonly decorAngles = [0, 0, 0]
  private readonly content: ReactorContentRenderer | null

  manager: WindowManager | null = null

  private activeRing: number | null = null
  private wasPointerDown = false
  private solved = false
  private wasSolved = false
  private readonly popup = new SolvePopup()
  private time = 0
  private appearTime = APPEAR_TOTAL
  private cx = 0
  private cy = 0
  private radius = 0
  private readonly nodes: Node[] = []
  private readonly nodeGlow: number[] = []

  // Rolling window of stability samples for the left-hand history graph.
  private readonly stabilitySamples: number[] = []
  private stabilityTimer = 0

  constructor(options: ReactorCoreWindowOptions = {}) {
    this.id = options.id ?? 'reactor'
    this.content = options.content ?? null
    this.generatePuzzle()
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    // Replay the whole appear timeline each time the window opens.
    this.appearTime = 0
  }

  update(dt: number, input: Input): void {
    this.time += dt
    if (this.appearTime < APPEAR_TOTAL) {
      this.appearTime = Math.min(APPEAR_TOTAL, this.appearTime + dt)
    }

    // The solve lands during render; announce it on the next frame.
    if (this.solved && !this.wasSolved) {
      this.wasSolved = true
      playSfx('correct')
    }
    this.popup.update(dt, this.appearTime >= APPEAR_TOTAL && this.solved)

    // Reactor does not scroll; discard wheel input so it never builds up.
    input.consumeWheelDelta()

    // Let freshly activated nodes cool back down.
    for (let i = 0; i < this.nodeGlow.length; i += 1) {
      this.nodeGlow[i] = Math.max(0, this.nodeGlow[i] - dt * NODE_FADE)
    }

    // Sample stability at a fixed rate for the history graph.
    this.stabilityTimer += dt
    while (this.stabilityTimer >= STABILITY_SAMPLE) {
      this.stabilityTimer -= STABILITY_SAMPLE
      this.stabilitySamples.push(this.computeStability())
      if (this.stabilitySamples.length > STABILITY_SAMPLES) this.stabilitySamples.shift()
    }

    // Return to the maintenance UI on request.
    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('ui')
      return
    }

    const delta = input.consumePointerDelta()
    const down = input.isPointerDown()

    // Input stays locked while the screen assembles.
    if (this.appearTime < APPEAR_TOTAL) {
      this.activeRing = null
      this.wasPointerDown = down
      return
    }

    // Once the puzzle is solved the rings lock in their aligned state.
    if (this.solved) {
      this.activeRing = null
      this.wasPointerDown = down
      return
    }

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
      // The big background rings trail their primary ring at their own pace.
      for (let i = 0; i < DECOR_RINGS.length; i += 1) {
        if (DECOR_RINGS[i].ring === this.activeRing) {
          this.decorAngles[i] += spin * DECOR_RINGS[i].pace
        }
      }
    }

    this.wasPointerDown = down
  }

  /** Roll a solvable puzzle: three laser paths carrying two well-spaced points each. */
  private generatePuzzle(): void {
    for (let attempt = 0; attempt < MAX_PUZZLE_ATTEMPTS; attempt += 1) {
      if (this.tryPlacePuzzle(true)) return
    }
    // Extremely unlikely fallback: take a layout without the spacing guarantee rather
    // than end up with fewer than six points.
    this.tryPlacePuzzle(false)
  }

  /** Place the points; returns false when any pair is closer than the minimum. */
  private tryPlacePuzzle(enforceSpacing: boolean): boolean {
    this.nodes.length = 0
    this.nodeGlow.length = 0

    // Solved rotation for each of the three lasers.
    const solved = new Array<number>(3).fill(0)

    for (let i = 0; i < 3; i += 1) {
      solved[i] = Math.random() * Math.PI * 2
      const path = laserPath(i, solved[i])

      // Two points on the laser's path (one per segment), with small randomness.
      const t1 = 0.25 + Math.random() * 0.5
      const first = lerpPoint(path.originX, path.originY, path.hitX, path.hitY, t1)
      const t2 = 0.25 + Math.random() * 0.5
      const second = lerpPoint(path.hitX, path.hitY, path.exitX, path.exitY, t2)

      const clashes =
        pointsTooClose(first, second) ||
        this.nodes.some((node) => pointsTooClose(node, first)) ||
        this.nodes.some((node) => pointsTooClose(node, second))
      if (enforceSpacing && clashes) return false

      this.nodes.push(first, second)
      this.nodeGlow.push(0, 0)
    }

    // Scramble the ring angles so the puzzle starts off.
    for (let i = 0; i < 3; i += 1) {
      const offset = (0.4 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1)
      this.ringAngles[i] = solved[i] + offset
    }

    return true
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

    this.drawFrame(ctx, width, height)
    this.drawDiagonalLines(ctx, width, height)
    this.drawDecorRings(ctx, width, cx, cy, radius)

    const now = this.appearTime
    const ringT = [
      reveal(now, APPEAR_RING, 0),
      reveal(now, APPEAR_RING, APPEAR_RING_STAGGER),
      reveal(now, APPEAR_RING, APPEAR_RING_STAGGER * 2),
    ]
    this.drawAppearing(ctx, cx, cy, ringT[0], () =>
      this.drawOuterRing(ctx, cx, cy, radius, this.ringAngles[0], this.activeRing === 0),
    )
    this.drawAppearing(ctx, cx, cy, ringT[1], () =>
      this.drawMiddleRing(ctx, cx, cy, radius * PRIMARY_SCALES[1], this.ringAngles[1], this.activeRing === 1),
    )
    this.drawAppearing(ctx, cx, cy, ringT[2], () =>
      this.drawInnerRing(ctx, cx, cy, radius * PRIMARY_SCALES[2], this.ringAngles[2], this.activeRing === 2),
    )

    const coreT = reveal(now, APPEAR_CORE, APPEAR_CORE_START)
    this.drawAppearing(ctx, cx, cy, coreT, () => {
      this.drawContent(ctx, cx, cy, radius * 0.46)
      // Beams sit above everything so the bounce vertex stays visible.
      this.drawLasers(ctx, cx, cy, radius)
    })

    // Side readouts: per-node bars + stability gauge (right) and signal trace (left).
    const stability = this.computeStability()
    this.drawReadouts(ctx, width, height, radius, stability)
    this.drawMonitors(ctx, width, height, stability)

    this.drawCaptions(ctx, width, height)
    this.drawAngles(ctx, width, height)

    this.popup.draw(ctx, width, height, {
      title: 'REACTOR CORE IS RESTORED',
      hint: 'TO RETURN PRESS C / ESC',
    })

    ctx.restore()
  }

  /** Outer screen frame, matching the other service screens. Scales into view. */
  private drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const t = reveal(this.appearTime, APPEAR_RING, 0)
    if (t <= 0) return

    const inset = MARGIN - 8
    const scale = 0.6 + 0.4 * easeOut(t)

    ctx.save()
    ctx.globalAlpha = t
    ctx.translate(width / 2, height / 2)
    ctx.scale(scale, scale)
    ctx.translate(-width / 2, -height / 2)

    ctx.fillStyle = COLORS.panel
    ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2)
    ctx.strokeStyle = this.solved ? COLORS.stable : COLORS.border
    ctx.lineWidth = 2
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2)

    ctx.restore()
  }

  /**
   * Faint 45-degree lines running down from the left and right sides, spaced by
   * DIAGONAL_STEP. Matched lines cross on the centre axis, forming an X down the middle.
   * On open each line is drawn (stretched) from its side end across to the other.
   */
  private drawDiagonalLines(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const base = reveal(this.appearTime, APPEAR_LINES, APPEAR_LINES_START)
    if (base <= 0) return

    const inset = MARGIN - 8
    const left = inset
    const right = width - inset
    const top = inset
    const bottom = height - inset
    const span = right - left

    ctx.save()
    ctx.beginPath()
    ctx.rect(left, top, span, bottom - top)
    ctx.clip()

    ctx.strokeStyle = 'rgba(224, 170, 51, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()

    let row = 0
    const rows = Math.ceil((bottom - top) / DIAGONAL_STEP) + 4
    for (let y = top; y <= bottom + DIAGONAL_STEP * 2; y += DIAGONAL_STEP) {
      // Linear "drawing" progress from the anchored end toward the far end.
      const rowStart = APPEAR_LINES_START + row * APPEAR_LINE_STAGGER
      let grow = reveal(this.appearTime, APPEAR_LINES, rowStart)
      if (grow > 1) grow = 1
      if (grow > 0) {
        // Down-right line drawn from the left edge across to the right.
        ctx.moveTo(left, y)
        ctx.lineTo(left + grow * span, y + grow * span)
        // Down-left line drawn from the right edge across to the left.
        ctx.moveTo(right, y)
        ctx.lineTo(right - grow * span, y + grow * span)
      }
      row += 1
      if (row > rows) break
    }

    ctx.stroke()
    ctx.restore()
  }

  /** Headline, subtitle and the bottom controls hint. */
  private drawCaptions(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const fontSize = width < 560 ? 12 : width < 1100 ? 14 : 16

    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.bright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 2
    ctx.fillText('REACTOR CORE', MARGIN, MARGIN)
    ctx.shadowBlur = 0

    ctx.font = `${Math.max(8, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.dim
    ctx.fillText('REACTION CONTROL // LASER ALIGNMENT', MARGIN, MARGIN + fontSize * 1.5)
    ctx.fillText('DRAG RING — ROTATE · ESC / C — UI', MARGIN, height - MARGIN - fontSize * 0.6)

    ctx.restore()
  }

  /** Bottom-right telemetry: the current ring rotations and laser beam angles. */
  private drawAngles(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const fontSize = telemetryFontSize(width)
    const lineHeight = Math.round(fontSize * 1.4)

    const rows: string[] = []
    for (let i = 0; i < this.ringAngles.length; i += 1) {
      rows.push(`RING ${i + 1}  ${formatAngle(this.ringAngles[i])}`)
    }
    for (let i = 0; i < this.ringAngles.length; i += 1) {
      const path = laserPath(i, this.ringAngles[i])
      const beam = Math.atan2(path.hitY - path.originY, path.hitX - path.originX)
      rows.push(`LASER ${i + 1}  ${formatAngle(beam)}`)
    }

    ctx.save()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.mid

    let y = height - MARGIN
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      ctx.fillText(rows[i], width - MARGIN, y)
      y -= lineHeight
    }

    ctx.restore()
  }

  /** Assemble helper: fades and grows a drawing about (cx, cy) as `t` runs 0 -> 1. */
  private drawAppearing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    t: number,
    draw: () => void,
  ): void {
    if (t <= 0) return
    const scale = 0.82 + 0.18 * easeOut(t)
    ctx.save()
    ctx.globalAlpha = t
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)
    draw()
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

  /**
   * Large, faint rings anchored half-off the left edge, the top and the right edge.
   * They trail the primary rings at different paces when the player turns them, and
   * each is sized to touch the very ring that drives it.
   */
  private drawDecorRings(
    ctx: CanvasRenderingContext2D,
    width: number,
    cx: number,
    cy: number,
    primary: number,
  ): void {
    const t = reveal(this.appearTime, APPEAR_RING, 0)
    if (t <= 0) return

    ctx.save()
    ctx.globalAlpha = 0.5 * t

    for (let i = 0; i < DECOR_RINGS.length; i += 1) {
      const spec = DECOR_RINGS[i]
      const anchorX = spec.anchor === 'left' ? MARGIN : spec.anchor === 'right' ? width - MARGIN : cx
      const anchorY = spec.anchor === 'top' ? MARGIN : cy
      // Offset the centre so the rings are not perfectly centred on their edge.
      const x = anchorX + primary * spec.ox
      const y = anchorY + primary * spec.oy
      const angle = this.decorAngles[i]

      // Touching the driven ring: radius = distance between the two centres minus
      // the driven ring's own radius.
      const drivenRadius = primary * PRIMARY_SCALES[spec.ring]
      const distance = Math.hypot(x - cx, y - cy)
      const ringRadius = distance - drivenRadius
      if (ringRadius <= 16) continue

      // Faint base circle.
      ctx.strokeStyle = COLORS.dim
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2)
      ctx.stroke()

      // Brighter arc plus an off-side marker so the slow rotation reads clearly.
      ctx.strokeStyle = COLORS.mid
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(x, y, ringRadius, angle, angle + 0.5)
      ctx.stroke()

      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(
        x + Math.cos(angle + Math.PI) * (ringRadius - 18),
        y + Math.sin(angle + Math.PI) * (ringRadius - 18),
      )
      ctx.lineTo(
        x + Math.cos(angle + Math.PI) * (ringRadius + 8),
        y + Math.sin(angle + Math.PI) * (ringRadius + 8),
      )
      ctx.stroke()
    }

    ctx.restore()
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

  /**
   * One angled laser per ring. Each is contained inside the inner (content)
   * circle: it leaves that ring, crosses the core and reflects off its wall once.
   */
  private drawLasers(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ): void {
    const coreRadius = radius * CORE_SCALE

    ctx.save()
    ctx.strokeStyle = COLORS.laser
    ctx.fillStyle = COLORS.laser
    ctx.shadowColor = COLORS.laserGlow
    ctx.shadowBlur = 12
    ctx.lineWidth = 2
    ctx.lineCap = 'round'

    for (let index = 0; index < 3; index += 1) {
      const ringAngle = this.ringAngles[index]
      const path = laserPath(index, ringAngle)
      if (!path) continue

      const originX = cx + path.originX * coreRadius
      const originY = cy + path.originY * coreRadius
      const hitX = cx + path.hitX * coreRadius
      const hitY = cy + path.hitY * coreRadius
      const exitX = cx + path.exitX * coreRadius
      const exitY = cy + path.exitY * coreRadius

      ctx.beginPath()
      ctx.moveTo(originX, originY)
      ctx.lineTo(hitX, hitY)
      ctx.lineTo(exitX, exitY)
      ctx.stroke()

      // Emitter dot on the ring.
      ctx.beginPath()
      ctx.arc(originX, originY, 3, 0, Math.PI * 2)
      ctx.fill()

      this.activateNodes(cx, cy, coreRadius, originX, originY, hitX, hitY, exitX, exitY)
    }

    this.drawNodes(ctx, cx, cy, coreRadius)

    // All nodes lit at once means the beams are aligned: lock the puzzle.
    if (!this.solved && this.nodes.length > 0 && this.nodeGlow.every((value) => value >= 0.99)) {
      this.solved = true
    }

    ctx.restore()
  }

  /** Light up any node a segment of the beam passes through. */
  private activateNodes(
    cx: number,
    cy: number,
    coreRadius: number,
    originX: number,
    originY: number,
    hitX: number,
    hitY: number,
    exitX: number,
    exitY: number,
  ): void {
    const tolerance = coreRadius * NODE_HIT_SCALE

    for (let i = 0; i < this.nodes.length; i += 1) {
      const node = this.nodes[i]
      const nodeX = cx + node.x * coreRadius
      const nodeY = cy + node.y * coreRadius

      if (
        pointSegmentDistance(nodeX, nodeY, originX, originY, hitX, hitY) <= tolerance ||
        pointSegmentDistance(nodeX, nodeY, hitX, hitY, exitX, exitY) <= tolerance
      ) {
        this.nodeGlow[i] = 1
      }
    }
  }

  /** Draw the fixed nodes, glowing while activated. */
  private drawNodes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    coreRadius: number,
  ): void {
    const dot = Math.max(2, coreRadius * 0.03)

    ctx.save()
    for (let i = 0; i < this.nodes.length; i += 1) {
      const node = this.nodes[i]
      const nodeX = cx + node.x * coreRadius
      const nodeY = cy + node.y * coreRadius
      const level = this.nodeGlow[i]

      ctx.beginPath()
      ctx.arc(nodeX, nodeY, dot * (1 + level * 0.6), 0, Math.PI * 2)
      if (level > 0.05) {
        ctx.fillStyle = COLORS.bright
        ctx.shadowColor = COLORS.glow
        ctx.shadowBlur = 16 * level
      } else {
        ctx.fillStyle = COLORS.dim
        ctx.shadowBlur = 0
      }
      ctx.fill()
    }
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

  /** Inner containment ring; optional custom content is clipped to it. */
  private drawContent(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ): void {
    ctx.save()

    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()

    if (this.content) {
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.clip()
      this.content(ctx, cx, cy, radius)
    }

    ctx.restore()
  }

  /** Overall stability: fraction of nodes lit, plus noise that stops once solved. */
  private computeStability(): number {
    if (this.solved) return 1
    const total = this.nodeGlow.reduce((sum, value) => sum + value, 0)
    const progress = this.nodes.length > 0 ? total / this.nodes.length : 0
    if (progress >= 0.999) return 1
    return Math.max(0, Math.min(0.97, progress + (Math.random() - 0.5) * 0.1))
  }

  /** Right-side readouts: one labelled bar per node plus the stability gauge. */
  private drawReadouts(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    radius: number,
    stability: number,
  ): void {
    // Bars fill up as the screen assembles.
    const showAll = reveal(this.appearTime, APPEAR_BARS, APPEAR_BARS_START)
    if (showAll <= 0) return

    const barWidth = 170
    const barHeight = 16
    const gap = 10
    const barsX = width - MARGIN - barWidth
    const barsY = MARGIN

    // Stability gauge sits to the left of the node bars.
    const stabWidth = 34
    const stabHeight = 340
    const stabX = barsX - 44 - stabWidth
    const stabY = height / 2 - stabHeight / 2

    // Skip the readouts when they would collide with the rings.
    if (stabX - 40 <= width / 2 + radius) return

    ctx.save()
    ctx.globalAlpha = showAll
    ctx.font = `13px "${FONT_FAMILY}", monospace`
    ctx.textBaseline = 'middle'

    for (let i = 0; i < this.nodes.length; i += 1) {
      const barY = barsY + i * (barHeight + gap)
      const fill = reveal(this.appearTime, APPEAR_BARS, APPEAR_BARS_START + i * 0.05)
      drawProgressBar(ctx, barsX, barY, barWidth, barHeight, this.nodeGlow[i] * fill, COLORS.bright)

      ctx.textAlign = 'right'
      ctx.fillStyle = COLORS.content
      ctx.fillText(`N${i + 1}`, barsX - 8, barY + barHeight / 2)
    }

    const stabT = reveal(this.appearTime, APPEAR_BARS, APPEAR_BARS_START + this.nodes.length * 0.05)
    drawProgressBar(
      ctx,
      stabX,
      stabY,
      stabWidth,
      stabHeight,
      stability * stabT,
      this.solved ? COLORS.stable : COLORS.laser,
      true,
    )

    ctx.textAlign = 'center'
    ctx.fillStyle = COLORS.content
    ctx.fillText(`${Math.round(stability * stabT * 100)}%`, stabX + stabWidth / 2, stabY - 14)
    ctx.fillText('STABILITY', stabX + stabWidth / 2, stabY + stabHeight + 18)

    // Ring rotation dials sit under the node bars, right-aligned with them.
    const dialTop = barsY + this.nodes.length * (barHeight + gap) + 26
    this.drawRingDials(ctx, barsX + barWidth, dialTop, width, height)

    ctx.restore()
  }

  /**
   * Large dials stacked down the right edge, one per ring, each drawing the ring's
   * current rotation as a needle. Skipped when the bottom telemetry would collide.
   */
  private drawRingDials(
    ctx: CanvasRenderingContext2D,
    rightX: number,
    topY: number,
    width: number,
    height: number,
  ): void {
    const radius = 28
    const spacing = 40
    const count = this.ringAngles.length
    const stride = radius * 2 + spacing
    const total = count * stride - spacing + 18

    // Room needed below for the dials themselves plus the bottom telemetry block.
    const telemetry = ANGLE_ROWS * Math.round(telemetryFontSize(width) * 1.4)
    if (topY + total > height - MARGIN - telemetry - 8) return

    ctx.save()
    ctx.lineWidth = 2

    for (let i = 0; i < count; i += 1) {
      const cx = rightX - radius
      const cy = topY + radius + i * stride

      // Dial face.
      ctx.strokeStyle = COLORS.dim
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()

      // Needle at the ring's rotation.
      const angle = this.ringAngles[i]
      ctx.strokeStyle = COLORS.bright
      ctx.shadowColor = COLORS.glow
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * (radius - 4), cy + Math.sin(angle) * (radius - 4))
      ctx.stroke()
      ctx.shadowBlur = 0

      // Hub and label.
      ctx.fillStyle = COLORS.mid
      ctx.beginPath()
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
      ctx.fill()

      ctx.font = `12px "${FONT_FAMILY}", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = COLORS.dim
      ctx.fillText(`R${i + 1}`, cx, cy + radius + 4)
    }

    ctx.restore()
  }

  /**
   * Left-side monitors: the live signal trace and, beside it, a line graph of the
   * recent stability history. Both are skipped when the rings crowd the left edge.
   */
  private drawMonitors(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    stability: number,
  ): void {
    const appear = reveal(this.appearTime, APPEAR_WAVE, APPEAR_WAVE_START)
    if (appear <= 0) return

    const panelHeight = Math.min(height * 0.8, MONITOR_MAX_HEIGHT)
    const leftX = MARGIN
    const topY = height / 2 - panelHeight / 2
    const graphX = leftX + MONITOR_WIDTH + MONITOR_GAP

    // Skip when they would collide with the rings.
    if (graphX + STABILITY_WIDTH + 16 >= width / 2 - this.radius) return

    ctx.save()
    ctx.globalAlpha = appear

    this.drawWaveformPanel(ctx, leftX, topY, MONITOR_WIDTH, panelHeight, stability)
    this.drawStabilityPanel(ctx, graphX, topY, STABILITY_WIDTH, panelHeight)

    ctx.restore()
  }

  /** Live signal trace; its noise fades out as stability approaches 100%. */
  private drawWaveformPanel(
    ctx: CanvasRenderingContext2D,
    leftX: number,
    topY: number,
    panelWidth: number,
    panelHeight: number,
    stability: number,
  ): void {
    const centerX = leftX + panelWidth / 2
    const noise = WAVE_NOISE * (1 - stability)

    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 1
    ctx.strokeRect(leftX, topY, panelWidth, panelHeight)

    ctx.strokeStyle = COLORS.laser
    ctx.shadowColor = COLORS.laserGlow
    ctx.shadowBlur = 8
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let offset = 0; offset <= panelHeight; offset += 2) {
      const phase = offset * WAVE_FREQ + this.time * WAVE_SPEED
      const value = Math.sin(phase) * WAVE_AMPLITUDE + (Math.random() - 0.5) * 2 * noise
      const x = centerX + value
      const y = topY + offset
      if (offset === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  /**
   * Vertical line graph of the recent stability value: time runs down the panel
   * (newest at the bottom) and the value runs across it.
   */
  private drawStabilityPanel(
    ctx: CanvasRenderingContext2D,
    leftX: number,
    topY: number,
    panelWidth: number,
    panelHeight: number,
  ): void {
    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 1
    ctx.strokeRect(leftX, topY, panelWidth, panelHeight)

    const padX = 10
    const padY = 14
    const gx = leftX + padX
    const gy = topY + padY
    const gw = panelWidth - padX * 2
    const gh = panelHeight - padY * 2
    const latest = this.stabilitySamples[this.stabilitySamples.length - 1] ?? this.computeStability()

    // Vertical quarter gridlines.
    ctx.strokeStyle = 'rgba(224, 170, 51, 0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 4; i += 1) {
      const x = gx + (gw * i) / 4
      ctx.moveTo(x, gy)
      ctx.lineTo(x, gy + gh)
    }
    ctx.stroke()

    const color = this.solved ? COLORS.stable : COLORS.laser
    const samples = this.stabilitySamples
    const span = STABILITY_SAMPLES - 1

    if (samples.length >= 2) {
      // Value runs across the graph; the newest sample sits at the bottom edge.
      const pointX = (value: number): number => gx + gw * value
      const pointY = (i: number): number => gy + gh * (1 - (samples.length - 1 - i) / span)

      // Faint area between the curve and the 0% edge.
      ctx.beginPath()
      ctx.moveTo(gx, pointY(0))
      for (let i = 0; i < samples.length; i += 1) {
        ctx.lineTo(pointX(samples[i]), pointY(i))
      }
      ctx.lineTo(gx, pointY(samples.length - 1))
      ctx.closePath()
      ctx.fillStyle = this.solved ? 'rgba(102, 255, 136, 0.16)' : 'rgba(255, 59, 48, 0.16)'
      ctx.fill()

      ctx.strokeStyle = color
      ctx.shadowColor = this.solved ? COLORS.glow : COLORS.laserGlow
      ctx.shadowBlur = 8
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < samples.length; i += 1) {
        const x = pointX(samples[i])
        const y = pointY(i)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    // Current value readout and caption.
    ctx.font = `13px "${FONT_FAMILY}", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(`${Math.round(latest * 100)}%`, leftX + panelWidth / 2, topY - 12)
    ctx.fillStyle = COLORS.dim
    ctx.fillText('STABILITY', leftX + panelWidth / 2, topY + panelHeight + 14)
  }
}
