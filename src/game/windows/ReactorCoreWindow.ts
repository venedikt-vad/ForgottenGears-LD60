import { FONT_FAMILY } from '../fonts'
import type { Input } from '../Input'
import type { GameWindow } from './GameWindow'

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
  laser: '#ff3b30',
  laserGlow: 'rgba(255, 70, 40, 0.55)',
  track: 'rgba(120, 40, 20, 0.6)',
  stable: '#66ff88',
}

// Lasers live inside the inner (content) ring: each emitter rides that ring and the
// beam reflects off the same wall once. The ring's rotation swings the emitter around
// the wall while the aim sweeps at its own rate (LASER_SPIN); the aim is folded so it
// always points inward and the beam stays contained.
const LASER_TILT = [0.4, 0.5, 0.62]
const LASER_SPIN = [2, -1.5, 1.3]
const LASER_OFFSET = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]
const CORE_SCALE = 0.46

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
// reactor stabilizes (noise scales with 1 - stability).
const WAVE_FREQ = 0.06
const WAVE_SPEED = 2.2
const WAVE_AMPLITUDE = 22
const WAVE_NOISE = 18

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
  private readonly content: ReactorContentRenderer | null

  private activeRing: number | null = null
  private wasPointerDown = false
  private solved = false
  private time = 0
  private cx = 0
  private cy = 0
  private radius = 0
  private readonly nodes: Node[] = []
  private readonly nodeGlow: number[] = []

  constructor(options: ReactorCoreWindowOptions = {}) {
    this.id = options.id ?? 'reactor'
    this.content = options.content ?? null
    this.generatePuzzle()
  }

  update(dt: number, input: Input): void {
    this.time += dt

    // Reactor does not scroll; discard wheel input so it never builds up.
    input.consumeWheelDelta()

    // Let freshly activated nodes cool back down.
    for (let i = 0; i < this.nodeGlow.length; i += 1) {
      this.nodeGlow[i] = Math.max(0, this.nodeGlow[i] - dt * NODE_FADE)
    }

    const delta = input.consumePointerDelta()
    const down = input.isPointerDown()

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

    this.drawOuterRing(ctx, cx, cy, radius, this.ringAngles[0], this.activeRing === 0)
    this.drawMiddleRing(ctx, cx, cy, radius * 0.82, this.ringAngles[1], this.activeRing === 1)
    this.drawInnerRing(ctx, cx, cy, radius * 0.62, this.ringAngles[2], this.activeRing === 2)

    this.drawContent(ctx, cx, cy, radius * 0.46)

    // Beams sit above everything so the bounce vertex stays visible.
    this.drawLasers(ctx, cx, cy, radius)

    // Side readouts: per-node bars + stability gauge (right) and signal trace (left).
    const stability = this.computeStability()
    this.drawReadouts(ctx, width, height, radius, stability)
    this.drawWaveform(ctx, width, height, stability)

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
    const stabWidth = 30
    const stabHeight = 340
    const stabX = width - 44 - stabWidth
    const stabY = height / 2 - stabHeight / 2

    const barWidth = 130
    const barHeight = 12
    const gap = 8
    const barsX = stabX - 36 - barWidth

    // Skip the readouts when they would collide with the rings.
    if (barsX - 40 <= width / 2 + radius) return

    const barsHeight = this.nodes.length * barHeight + Math.max(0, this.nodes.length - 1) * gap
    const barsY = height / 2 - barsHeight / 2

    ctx.save()
    ctx.font = `12px "${FONT_FAMILY}", monospace`
    ctx.textBaseline = 'middle'

    for (let i = 0; i < this.nodes.length; i += 1) {
      const barY = barsY + i * (barHeight + gap)
      drawProgressBar(ctx, barsX, barY, barWidth, barHeight, this.nodeGlow[i], COLORS.bright)

      ctx.textAlign = 'right'
      ctx.fillStyle = COLORS.content
      ctx.fillText(`N${i + 1}`, barsX - 8, barY + barHeight / 2)
    }

    drawProgressBar(
      ctx,
      stabX,
      stabY,
      stabWidth,
      stabHeight,
      stability,
      this.solved ? COLORS.stable : COLORS.laser,
      true,
    )

    ctx.textAlign = 'center'
    ctx.fillStyle = COLORS.content
    ctx.fillText(`${Math.round(stability * 100)}%`, stabX + stabWidth / 2, stabY - 14)
    ctx.fillText('STABILITY', stabX + stabWidth / 2, stabY + stabHeight + 18)

    ctx.restore()
  }

  /** Left-side signal trace; its noise fades out as stability approaches 100%. */
  private drawWaveform(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    stability: number,
  ): void {
    const panelWidth = 90
    const panelHeight = Math.min(height * 0.6, 340)
    const leftX = 40
    const topY = height / 2 - panelHeight / 2

    // Skip when it would collide with the rings.
    if (leftX + panelWidth + 16 >= width / 2 - this.radius) return

    const centerX = leftX + panelWidth / 2
    const noise = WAVE_NOISE * (1 - stability)

    ctx.save()

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

    ctx.restore()
  }
}
