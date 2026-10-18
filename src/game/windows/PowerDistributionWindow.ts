import { FONT_FAMILY } from '../fonts'
import { playSfx } from '../sfx'
import type { Input } from '../Input'
import type { GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

const COLORS = {
  panel: 'rgba(5, 20, 12, 0.0)',
  border: 'rgba(31, 122, 73, 0.2)',
  borderBright: '#7dffb0',
  grid: 'rgba(60, 160, 100, 0.0)',
  gridLine: 'rgba(60, 160, 100, 0.14)',
  cell: 'rgba(8, 28, 16, 0.0)',
  hover: 'rgba(120, 255, 170, 0.12)',
  focus: '#7dffb0',
  pipe: '#3f8f5f',
  pipeGlow: 'rgba(120, 255, 150, 0.5)',
  powered: '#9dffc0',
  source: '#e6ff5c',
  sourceGlow: 'rgba(200, 255, 90, 0.5)',
  sinkOff: '#e05a4a',
  sinkOn: '#66ff88',
  dim: '#2f6b45',
  text: '#bff7cf',
  bright: '#eaffea',
  glow: 'rgba(120, 255, 160, 0.3)',
  barTrack: 'rgba(47, 107, 69, 0.25)',
}

const NORTH = 1
const EAST = 2
const SOUTH = 4
const WEST = 8

const ORDER = [
  { bit: NORTH, dx: 0, dy: -1 },
  { bit: EAST, dx: 1, dy: 0 },
  { bit: SOUTH, dx: 0, dy: 1 },
  { bit: WEST, dx: -1, dy: 0 },
] as const

const COLS = 10
const ROWS = 7
const MARGIN = 40

// A disconnected cell flickers out with two rapid blinks, like a dying lamp.
const BLINK_DURATION = 0.36
// Powered paths pulse gently (a slow sine on glow strength).
const BREATH_SPEED = 2.6

// Each connected output draws this share of the power budget; at POWER_CAPACITY
// (100%) the grid is over capacity: the gauge turns red and the game glow is cut.
const POWER_PER_OUTPUT = 0.3
const POWER_CAPACITY = 1

// Show animation: the grid lines stretch across first, then the pipes flicker in.
const APPEAR_GRID = 0.5
const APPEAR_SYMBOL = 1
const APPEAR_REVEAL = 0.18
const APPEAR_TOTAL = APPEAR_GRID + APPEAR_SYMBOL
// Pipes spin this far into place as they appear.
const APPEAR_SPIN = Math.PI * 0.15

// Screen frame scales and fades in before the grid assembles.
const APPEAR_FRAME = 0.5
// Background diagonal lines grow in row by row behind the frame, once it is mostly in.
const APPEAR_LINES = 0.9
const APPEAR_LINES_START = APPEAR_FRAME * 0.5
const APPEAR_LINE_STAGGER = 0.06
// Spacing of the decorative 45-degree lines running down the background.
const DIAGONAL_STEP = 200 / 3

// Occasional square points sliding along those lines.
const POINT_MIN_INTERVAL = 0.3
const POINT_MAX_INTERVAL = 1.1
const POINT_MAX_ACTIVE = 6
const POINT_SPEED_MIN = 90
const POINT_SPEED_MAX = 200
const POINT_SIZE = 5

// Random filler fittings for cells the routing network does not pass through.
// Deliberately excludes the 4-way cross so every tile visibly rotates.
const DECOR = [
  NORTH | SOUTH,
  EAST | WEST,
  NORTH | EAST,
  NORTH | WEST,
  SOUTH | EAST,
  SOUTH | WEST,
  NORTH | EAST | SOUTH,
  NORTH | EAST | WEST,
  NORTH | SOUTH | WEST,
  EAST | SOUTH | WEST,
]

/** Rotates a connection mask 90 degrees clockwise. */
function rotateMask(mask: number): number {
  let out = 0
  if (mask & NORTH) out |= EAST
  if (mask & EAST) out |= SOUTH
  if (mask & SOUTH) out |= WEST
  if (mask & WEST) out |= NORTH
  return out
}

/** Number of openings (set bits) in a connection mask. */
function bitCount(mask: number): number {
  let count = 0
  while (mask > 0) {
    count += mask & 1
    mask >>= 1
  }
  return count
}

/** Stable pseudo-random 0..1 for a seed, so per-cell delays do not flicker. */
function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123
  return x - Math.floor(x)
}

/** 0..1 reveal progress for a symbol whose staggered delay has just elapsed. */
function reveal(time: number, delay: number, start: number): number {
  const p = (time - start - delay) / APPEAR_REVEAL
  return p <= 0 ? 0 : p >= 1 ? 1 : p
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Inner frame rectangle the screen content and background lines live in. */
function frameRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const inset = MARGIN - 8
  return { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 }
}

function opposite(bit: number): number {
  if (bit === NORTH) return SOUTH
  if (bit === SOUTH) return NORTH
  if (bit === EAST) return WEST
  return EAST
}

/** Shuffles an array in place (Fisher-Yates). */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = items[i]
    items[i] = items[j]
    items[j] = swap
  }
  return items
}

type Terminal = { col: number; row: number; bit: number; name: string }

/** A square point sliding along one of the background diagonal lines. */
type LinePoint = {
  /** Row index: the line starts at y offset row * DIAGONAL_STEP inside the frame. */
  row: number
  /** Horizontal offset travelled along the line, in px. */
  u: number
  speed: number
}

// Sink order defines the OUTPUT numbers shown on the board and in the side list.
const SYSTEMS = [
  'LEFT LEG',
  'RIGHT LEG',
  'LEFT ARM',
  'RIGHT ARM',
  'RADIO TRANSMITTER',
]

// Win pattern: outputs 2, 3 and 4 feed their systems; outputs 1 and 5 stay dark.
// (1-based output numbers follow the OUTPUT legend order.)
const TARGET_OUTPUTS = [false, true, true, true, false]

/**
 * A cyan power-distribution screen: one fixed source feeds three sinks. A grid of
 * rotatable pipe fittings sits between them; a fitting is live only while power
 * reaches it from the source. Solved when outputs 2, 3 and 4 are powered and
 * outputs 1 and 5 stay off.
 */
export class PowerDistributionWindow implements GameWindow {
  readonly id = 'powerDistribution'

  private manager: WindowManager | null = null
  private masks: number[] = []
  private powered: boolean[] = []

  private sourceIndex = 0
  private sinks: Terminal[] = []
  private sinkIndices: number[] = []

  private focusIndex = 0
  private hoverIndex = -1
  private wasPointerDown = false
  private clock = 0
  private prevPowered: boolean[] = []
  private blink: number[] = []
  private appearTime = APPEAR_TOTAL
  // Baselines for the connected / disconnected / power-loss sound edges.
  private prevOutputsOnline = 0
  private prevOverCapacity = false

  // Background diagonals: last known canvas size plus the sliding square points.
  private bgWidth = 0
  private bgHeight = 0
  private spawnTimer = POINT_MIN_INTERVAL
  private readonly linePoints: LinePoint[] = []

  // Grid geometry in CSS px, for mouse hit testing and drawing.
  private gridX = 0
  private gridY = 0
  private cellSize = 0
  // Right-hand output legend geometry.
  private listX = 0
  private listWidth = 0

  constructor() {
    this.generate()
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    // State is preserved across visits so a partly-routed grid survives reopen.
    this.wasPointerDown = false
    this.hoverIndex = -1
    // Replay the show animation each time the window opens.
    this.appearTime = 0
    // Fresh slide points so none linger from a previous visit.
    this.linePoints.length = 0
    this.spawnTimer = POINT_MIN_INTERVAL
    // Re-baseline power so no stray blinks fire during the reveal.
    this.powered = this.computePowered()
    this.prevPowered = this.powered.slice()
    this.blink = new Array<number>(this.powered.length).fill(0)
    this.prevOutputsOnline = this.outputsPowered
    this.prevOverCapacity = this.powerOverCapacity
  }

  /**
   * EXPOSED GAME STATE — powered status of every output, in SYSTEMS order.
   * An output counts as powered when its cell carries power and its terminal
   * faces outward (ready to feed its system).
   */
  get outputStatus(): boolean[] {
    return this.sinks.map((sink, i) => {
      const index = this.sinkIndices[i]
      return this.powered[index] && (this.masks[index] & sink.bit) !== 0
    })
  }

  /** EXPOSED GAME STATE — how many outputs are currently powered. */
  get outputsOnline(): number {
    return this.outputsPowered
  }

  /**
   * EXPOSED GAME STATE — overall power consumption, where each connected output
   * draws POWER_PER_OUTPUT (30%). >= POWER_CAPACITY (100%) means over capacity.
   */
  get powerConsumption(): number {
    return this.outputsPowered * POWER_PER_OUTPUT
  }

  /** EXPOSED GAME STATE — true while consumption is at or above capacity. */
  get powerOverCapacity(): boolean {
    return this.powerConsumption >= POWER_CAPACITY
  }

  update(dt: number, input: Input): void {
    this.appearTime += dt
    this.clock += dt
    this.advanceLinePoints(dt)

    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('console')
      return
    }

    // Input is locked while the grid and pipes animate in.
    if (this.appearTime < APPEAR_TOTAL) {
      this.advancePower(dt)
      return
    }

    this.hoverIndex = this.indexAt(input.pointerPosition.x, input.pointerPosition.y)

    const down = input.isPointerDown()
    if (down && !this.wasPointerDown && this.hoverIndex >= 0) {
      this.focusIndex = this.hoverIndex
      if (this.isRotatable(this.hoverIndex)) this.rotate(this.hoverIndex)
    }
    this.wasPointerDown = down

    if (input.wasPressed('ArrowLeft')) this.moveFocus(-1, 0)
    else if (input.wasPressed('ArrowRight')) this.moveFocus(1, 0)
    else if (input.wasPressed('ArrowUp')) this.moveFocus(0, -1)
    else if (input.wasPressed('ArrowDown')) this.moveFocus(0, 1)
    else if (input.wasPressed('Space') || input.wasPressed('Enter')) {
      if (this.isRotatable(this.focusIndex)) this.rotate(this.focusIndex)
    }

    this.advancePower(dt)

    // Sound edges: outputs coming online / dropping off, and the brownout.
    const online = this.outputsPowered
    if (online > this.prevOutputsOnline) playSfx('connected')
    else if (online < this.prevOutputsOnline) playSfx('disconnected')
    this.prevOutputsOnline = online
    if (this.powerOverCapacity && !this.prevOverCapacity) playSfx('power_loss')
    this.prevOverCapacity = this.powerOverCapacity
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.clearRect(0, 0, width, height)
    ctx.textBaseline = 'top'

    this.bgWidth = width
    this.bgHeight = height

    const fontSize = width < 520 ? 10 : width < 1000 ? 11 : 12
    const lineHeight = Math.ceil(fontSize * 1.32)

    this.layout(width, height, fontSize)

    this.drawFrame(ctx, width, height)
    this.drawDiagonalLines(ctx, width, height)
    this.drawHeader(ctx, fontSize)

    ctx.textAlign = 'left'
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.text
    ctx.fillText('GRID LINK // ROUTE POWER', MARGIN, MARGIN + lineHeight + 1)

    this.drawStatus(ctx, width, fontSize, lineHeight)
    this.drawGrid(ctx)
    this.drawOutputList(ctx, fontSize, lineHeight)
    this.drawConsumptionGauge(ctx, fontSize, lineHeight)

    ctx.textAlign = 'left'
    ctx.font = `${Math.max(8, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.dim
    ctx.fillText('CLICK — ROTATE · ARROWS / SPACE — SELECT · ESC — CONSOLE', MARGIN, height - MARGIN - lineHeight)
    ctx.restore()
  }

  private layout(width: number, height: number, fontSize: number): void {
    const headerHeight = MARGIN + Math.ceil(fontSize * 1.32) * 2 + 12
    const footerHeight = MARGIN + Math.ceil(fontSize * 1.32)
    const availableHeight = Math.max(0, height - headerHeight - footerHeight)

    // Reserve a column on the right for the consumption gauge and the output legend.
    this.listWidth = Math.max(150, Math.min(320, width * 0.24))
    const gap = 56
    const contentWidth = Math.max(0, width - MARGIN * 2 - this.listWidth - gap)
    this.listX = width - MARGIN - this.listWidth

    // Reserve a gutter on every side of the grid for the external stubs and labels.
    const raw = Math.min(contentWidth / COLS, availableHeight / ROWS)
    const gutter = Math.max(20, raw * 0.65)

    const size = Math.max(
      0,
      Math.floor(Math.min((contentWidth - gutter * 2) / COLS, (availableHeight - gutter * 2) / ROWS)),
    )
    this.cellSize = size
    this.gridX = MARGIN + Math.floor((contentWidth - this.cellSize * COLS) / 2)
    this.gridY = Math.floor(headerHeight + (availableHeight - this.cellSize * ROWS) / 2)
  }

  /** Outer screen frame; scales and fades into view as the window opens. */
  private drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const t = clamp01(this.appearTime / APPEAR_FRAME)
    if (t <= 0) return

    const rect = frameRect(width, height)
    const scale = 0.6 + 0.4 * easeOut(t)

    ctx.save()
    ctx.globalAlpha = t
    ctx.translate(width / 2, height / 2)
    ctx.scale(scale, scale)
    ctx.translate(-width / 2, -height / 2)

    ctx.fillStyle = COLORS.panel
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    // Red outline while over capacity, green once solved, subtle border otherwise.
    ctx.strokeStyle = this.powerOverCapacity
      ? COLORS.sinkOff
      : this.solved
        ? COLORS.sinkOn
        : COLORS.border
    ctx.lineWidth = 2
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

    ctx.restore()
  }

  /**
   * Faint 45-degree lines filling the frame, each row drawn from the left edge
   * down to the right, with occasional square points sliding along them.
   */
  private drawDiagonalLines(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const rect = frameRect(width, height)
    if (rect.width <= 0 || rect.height <= 0) return
    const span = rect.width

    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.width, rect.height)
    ctx.clip()

    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    const rowCount = Math.floor(rect.height / DIAGONAL_STEP) + 1
    for (let row = 0; row < rowCount; row += 1) {
      const grow = this.lineGrow(row)
      if (grow <= 0) continue
      const y = rect.y + row * DIAGONAL_STEP
      ctx.moveTo(rect.x, y)
      ctx.lineTo(rect.x + grow * span, y + grow * span)
    }
    ctx.stroke()

    const size = POINT_SIZE
    ctx.fillStyle = COLORS.borderBright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 6
    for (const point of this.linePoints) {
      const yOff = point.row * DIAGONAL_STEP
      if (yOff > rect.height) continue
      // The square rides the line only as far as it has been drawn so far.
      if (point.u > this.lineGrow(point.row) * span) continue

      const maxU = Math.min(span, rect.height - yOff)
      if (maxU <= 0) continue
      const travel = point.u / maxU
      ctx.globalAlpha = travel < 0.15 ? travel / 0.15 : travel > 0.85 ? (1 - travel) / 0.15 : 1

      ctx.fillRect(rect.x + point.u - size / 2, rect.y + yOff + point.u - size / 2, size, size)
    }

    ctx.restore()
  }

  /** 0..1 draw progress of one diagonal line row, staggered from the top. */
  private lineGrow(row: number): number {
    return clamp01((this.appearTime - APPEAR_LINES_START - row * APPEAR_LINE_STAGGER) / APPEAR_LINES)
  }

  /** Moves the sliding squares along the diagonals and occasionally spawns a new one. */
  private advanceLinePoints(dt: number): void {
    this.spawnTimer -= dt

    const rect = frameRect(this.bgWidth, this.bgHeight)
    const span = rect.width
    const maxRow = Math.floor((rect.height - 1) / DIAGONAL_STEP)

    if (
      this.spawnTimer <= 0 &&
      span > 0 &&
      maxRow >= 0 &&
      this.linePoints.length < POINT_MAX_ACTIVE
    ) {
      this.spawnTimer = POINT_MIN_INTERVAL + Math.random() * (POINT_MAX_INTERVAL - POINT_MIN_INTERVAL)
      this.linePoints.push({
        row: Math.floor(Math.random() * (maxRow + 1)),
        u: 0,
        speed: POINT_SPEED_MIN + Math.random() * (POINT_SPEED_MAX - POINT_SPEED_MIN),
      })
    }

    for (let i = this.linePoints.length - 1; i >= 0; i -= 1) {
      const point = this.linePoints[i]
      point.u += point.speed * dt
      const maxU = Math.min(span, rect.height - point.row * DIAGONAL_STEP)
      if (point.u > maxU) this.linePoints.splice(i, 1)
    }
  }

  private drawHeader(ctx: CanvasRenderingContext2D, fontSize: number): void {
    ctx.textAlign = 'left'
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 2
    ctx.fillStyle = COLORS.text
    ctx.fillText('POWER DISTRIBUTION', MARGIN, MARGIN)
    ctx.shadowBlur = 0
  }

  private drawStatus(ctx: CanvasRenderingContext2D, width: number, fontSize: number, lineHeight: number): void {
    ctx.textAlign = 'right'
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.bright
    const done = this.outputsPowered
    const total = this.sinks.length
    ctx.fillText(`${done}/${total} ONLINE`, width - MARGIN, MARGIN)
    // Over capacity takes priority: it is the reason recovery is required.
    const over = this.powerOverCapacity
    ctx.fillStyle = over ? COLORS.sinkOff : this.solved ? COLORS.sinkOn : COLORS.sinkOff
    const status = over ? 'OVER CAPACITY' : this.solved ? 'GRID STABLE' : 'RECOVERY REQUIRED'
    ctx.fillText(status, width - MARGIN, MARGIN + lineHeight + 1)
    ctx.textAlign = 'left'
  }

  /** Right-hand legend: each OUTPUT number and the system it feeds. */
  private drawOutputList(ctx: CanvasRenderingContext2D, fontSize: number, lineHeight: number): void {
    const alpha = clamp01(this.appearTime / (APPEAR_GRID + APPEAR_SYMBOL * 0.5))
    if (alpha <= 0 || this.listWidth <= 0) return

    const x = this.listX
    const width = this.listWidth
    const top = this.gridY
    const small = Math.max(8, fontSize - 1)
    const rowH = lineHeight + 8
    const panelH = lineHeight + 12 + rowH * this.sinks.length + 10

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.textBaseline = 'top'

    ctx.fillStyle = 'rgba(6, 24, 14, 0.6)'
    ctx.fillRect(x - 10, top - 8, width + 20, panelH)
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(x - 9.5, top - 7.5, width + 19, panelH + 1)

    // Clip content to the panel so long names cannot spill out.
    ctx.beginPath()
    ctx.rect(x - 6, top - 8, width + 12, panelH)
    ctx.clip()

    ctx.textAlign = 'left'
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.text
    ctx.fillText('OUTPUT BUS', x, top)

    const ruleY = Math.floor(top + lineHeight + 4) + 0.5
    ctx.strokeStyle = COLORS.dim
    ctx.beginPath()
    ctx.moveTo(x, ruleY)
    ctx.lineTo(x + width, ruleY)
    ctx.stroke()

    ctx.font = `${small}px "${FONT_FAMILY}", monospace`
    let y = ruleY + 8
    for (let i = 0; i < this.sinks.length; i += 1) {
      const sink = this.sinks[i]
      const si = this.sinkIndices[i]
      const live = this.powered[si] && (this.masks[si] & sink.bit) !== 0
      const color = live ? COLORS.sinkOn : COLORS.sinkOff

      const dot = Math.max(6, Math.floor(small * 0.7))
      ctx.fillStyle = color
      ctx.fillRect(x, y + 2, dot, dot)

      ctx.fillStyle = color
      ctx.fillText(`${i + 1}`, x + dot + 6, y)

      ctx.fillStyle = live ? COLORS.bright : COLORS.text
      ctx.fillText(sink.name, x + dot + 6 + small * 1.8, y)

      y += rowH
    }
    ctx.restore()
  }

  /**
   * Vertical gauge just left of the output legend: overall power consumption,
   * 30% per connected output. Turns red at or above 100%.
   */
  private drawConsumptionGauge(
    ctx: CanvasRenderingContext2D,
    fontSize: number,
    lineHeight: number,
  ): void {
    const alpha = clamp01(this.appearTime / (APPEAR_GRID + APPEAR_SYMBOL * 0.5))
    if (alpha <= 0 || this.listWidth <= 0 || this.cellSize <= 0) return

    const barWidth = 18
    const small = Math.max(8, fontSize - 2)
    const panelLeft = this.listX - 10
    const barX = panelLeft - 12 - barWidth
    const gridRight = this.gridX + this.cellSize * COLS
    // Skip the gauge when the grid leaves no room for it before the legend.
    if (panelLeft - gridRight < barWidth + small + 22) return

    const panelTop = this.gridY - 8
    const rowH = lineHeight + 8
    const panelH = lineHeight + 12 + rowH * this.sinks.length + 10

    const consumption = this.powerConsumption
    const over = this.powerOverCapacity
    // Value fills up during the reveal, then tracks consumption (capped at full).
    const fill = clamp01(consumption) * clamp01((this.appearTime - APPEAR_GRID) / APPEAR_SYMBOL)

    ctx.save()
    ctx.globalAlpha = alpha

    ctx.fillStyle = COLORS.barTrack
    ctx.fillRect(barX, panelTop, barWidth, panelH)
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(barX + 0.5, panelTop + 0.5, barWidth - 1, panelH - 1)

    ctx.fillStyle = over ? COLORS.sinkOff : COLORS.powered
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = over ? 12 : 6
    const filled = panelH * fill
    ctx.fillRect(barX + 1, panelTop + panelH - 1 - filled, barWidth - 2, filled)
    ctx.shadowBlur = 0

    ctx.font = `${small}px "${FONT_FAMILY}", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = over ? COLORS.sinkOff : COLORS.bright
    ctx.fillText(`${Math.round(consumption * 100)}%`, barX + barWidth / 2, panelTop - 6)

    // Caption runs bottom-to-top along the left of the bar.
    ctx.translate(barX - small / 2 - 4, panelTop + panelH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillStyle = COLORS.dim
    ctx.textBaseline = 'middle'
    ctx.fillText('POWER CONSUMPTION', 0, 0)

    ctx.restore()
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {    const size = this.cellSize
    if (size <= 0 || this.masks.length !== COLS * ROWS) return

    const gridWidth = size * COLS
    const gridHeight = size * ROWS
    const gridP = clamp01(this.appearTime / APPEAR_GRID)

    // Cell wells fade in with the lattice.
    if (gridP > 0) {
      ctx.globalAlpha = gridP
      ctx.fillStyle = COLORS.cell
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          ctx.fillRect(this.gridX + col * size, this.gridY + row * size, size, size)
        }
      }
      ctx.globalAlpha = 1
    }

    // Lattice lines stretch across: verticals grow down, horizontals grow right.
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let col = 0; col <= COLS; col += 1) {
      const x = Math.floor(this.gridX + col * size) + 0.5
      ctx.moveTo(x, this.gridY)
      ctx.lineTo(x, this.gridY + gridHeight * gridP)
    }
    for (let row = 0; row <= ROWS; row += 1) {
      const y = Math.floor(this.gridY + row * size) + 0.5
      ctx.moveTo(this.gridX, y)
      ctx.lineTo(this.gridX + gridWidth * gridP, y)
    }
    ctx.stroke()

    // Hover / focus markers (only once the screen has settled).
    if (this.appearTime >= APPEAR_TOTAL) {
      if (this.hoverIndex >= 0) {
        const x = this.gridX + (this.hoverIndex % COLS) * size
        const y = this.gridY + Math.floor(this.hoverIndex / COLS) * size
        ctx.fillStyle = COLORS.hover
        ctx.fillRect(x, y, size, size)
      }
      const fx = this.gridX + (this.focusIndex % COLS) * size
      const fy = this.gridY + Math.floor(this.focusIndex / COLS) * size
      ctx.strokeStyle = COLORS.focus
      ctx.lineWidth = 2
      ctx.strokeRect(fx + 1, fy + 1, size - 2, size - 2)
    }

    // Pipes flicker in asynchronously.
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'miter'
    for (let index = 0; index < this.masks.length; index += 1) {
      this.drawPipe(ctx, index)
    }

    // Terminals.
    const termT = this.terminalReveal()
    this.drawSource(ctx, termT)
    for (let i = 0; i < this.sinks.length; i += 1) {
      this.drawSink(ctx, this.sinks[i], i + 1, termT)
    }
  }

  /** 0..1 reveal of a pipe tile, staggered per cell. */
  private pipeReveal(index: number): number {
    return reveal(this.appearTime, hash01(index * 1.7) * APPEAR_SYMBOL, APPEAR_GRID)
  }

  /** 0..1 reveal of the IN/OUT terminals, just behind the pipes. */
  private terminalReveal(): number {
    return reveal(this.appearTime, APPEAR_SYMBOL * 0.55, APPEAR_GRID)
  }

  private drawPipe(ctx: CanvasRenderingContext2D, index: number): void {
    const t = this.pipeReveal(index)
    if (t <= 0) return

    const size = this.cellSize
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const cx = this.gridX + col * size + size / 2
    const cy = this.gridY + row * size + size / 2
    const mask = this.masks[index]
    const lit = this.isLit(index)
    // Spin into place: a small turn that eases to zero, no scaling.
    const eased = 1 - (1 - t) * (1 - t)
    const angle = (1 - eased) * APPEAR_SPIN

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    ctx.lineWidth = Math.max(2, size * 0.1)
    ctx.strokeStyle = lit ? COLORS.powered : COLORS.pipe
    if (lit) {
      const breath = this.breath()
      ctx.shadowColor = COLORS.pipeGlow
      ctx.shadowBlur = size * 0.3 * breath
      ctx.globalAlpha = (0.55 + 0.45 * breath) * t
    } else {
      ctx.globalAlpha = t
    }

    ctx.beginPath()
    for (const dir of ORDER) {
      if ((mask & dir.bit) === 0) continue
      ctx.moveTo(0, 0)
      ctx.lineTo(dir.dx * size * 0.5, dir.dy * size * 0.5)
    }
    ctx.stroke()
    ctx.restore()
  }

  /** Slow sine used to make live paths "breathe". */
  private breath(): number {
    return 0.75 + 0.25 * Math.sin(this.clock * BREATH_SPEED)
  }

  /** A cell is lit while powered, or during the "on" half of a dying-lamp blink. */
  private isLit(index: number): boolean {
    if (this.powered[index]) return true
    if (this.blink[index] <= 0) return false
    const elapsed = BLINK_DURATION - this.blink[index]
    const phase = Math.floor(elapsed / (BLINK_DURATION / 4))
    return phase % 2 === 0
  }

  /**
   * Recomputes power and drives the per-cell blink timers: a cell that loses power
   * starts a two-blink fade-out, and regained power cancels any pending blink.
   */
  private advancePower(dt: number): void {
    const next = this.computePowered()

    if (this.prevPowered.length !== next.length) {
      this.prevPowered = next.slice()
      this.blink = new Array<number>(next.length).fill(0)
      this.powered = next
      return
    }

    for (let i = 0; i < next.length; i += 1) {
      if (this.prevPowered[i] && !next[i]) this.blink[i] = BLINK_DURATION
      else if (next[i]) this.blink[i] = 0

      if (this.blink[i] > 0) this.blink[i] = Math.max(0, this.blink[i] - dt)
      this.prevPowered[i] = next[i]
    }
    this.powered = next
  }

  private drawSource(ctx: CanvasRenderingContext2D, alpha: number): void {
    if (alpha <= 0) return
    const size = this.cellSize
    const col = this.sourceIndex % COLS
    const row = Math.floor(this.sourceIndex / COLS)
    const cx = this.gridX + col * size + size / 2
    const cy = this.gridY + row * size + size / 2
    const dir = ORDER.find((item) => item.bit === WEST)!

    this.drawStub(ctx, cx, cy, dir, COLORS.source, COLORS.sourceGlow, true, alpha)
    this.drawTerminalLabel(ctx, cx, cy, dir, 'IN', COLORS.source, alpha)
  }

  private drawSink(ctx: CanvasRenderingContext2D, sink: Terminal, ordinal: number, alpha: number): void {
    if (alpha <= 0) return
    const size = this.cellSize
    const col = sink.col
    const row = sink.row
    const cx = this.gridX + col * size + size / 2
    const cy = this.gridY + row * size + size / 2
    const index = row * COLS + col
    const live = this.powered[index] && (this.masks[index] & sink.bit) !== 0
    const color = live ? COLORS.sinkOn : COLORS.sinkOff
    const dir = ORDER.find((item) => item.bit === sink.bit)!

    this.drawStub(ctx, cx, cy, dir, color, live ? COLORS.pipeGlow : 'rgba(224, 90, 74, 0.45)', live, alpha)
    this.drawTerminalLabel(ctx, cx, cy, dir, `${ordinal}`, color, alpha)
  }

  /** Draws the external feed line running from a terminal off the grid edge. */
  private drawStub(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    dir: { bit: number; dx: number; dy: number },
    color: string,
    glow: string,
    lit: boolean,
    alpha: number,
  ): void {
    const size = this.cellSize
    const breath = lit ? this.breath() : 1
    ctx.save()
    ctx.lineCap = 'butt'
    ctx.lineWidth = Math.max(2, size * 0.1)
    ctx.strokeStyle = color
    ctx.shadowColor = glow
    ctx.shadowBlur = size * 0.3 * breath
    ctx.globalAlpha = (lit ? 0.55 + 0.45 * breath : 1) * alpha
    ctx.beginPath()
    ctx.moveTo(cx + dir.dx * size * 0.5, cy + dir.dy * size * 0.5)
    ctx.lineTo(cx + dir.dx * size * 1.05, cy + dir.dy * size * 1.05)
    ctx.stroke()
    ctx.restore()
  }

  /** Draws IN/OUT text just beyond a terminal's stub, outside the grid. */
  private drawTerminalLabel(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    dir: { bit: number; dx: number; dy: number },
    text: string,
    color: string,
    alpha: number,
  ): void {
    const size = this.cellSize
    const fontSize = Math.max(10, Math.floor(size * 0.26))
    const endX = cx + dir.dx * size * 1.05
    const endY = cy + dir.dy * size * 1.05

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.font = `${fontSize}px "${FONT_FAMILY}", monospace`
    if (dir.bit === WEST) {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, endX - 8, endY)
    } else if (dir.bit === EAST) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, endX + 8, endY)
    } else if (dir.bit === NORTH) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(text, endX, endY - 8)
    } else {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(text, endX, endY + 8)
    }
    ctx.restore()
  }

  private moveFocus(dx: number, dy: number): void {
    const col = (this.focusIndex % COLS + dx + COLS) % COLS
    const row = (Math.floor(this.focusIndex / COLS) + dy + ROWS) % ROWS
    this.focusIndex = row * COLS + col
  }

  private isRotatable(index: number): boolean {
    return index >= 0 && index < this.masks.length && index !== this.sourceIndex
  }

  private rotate(index: number): void {
    this.masks[index] = rotateMask(this.masks[index])
    playSfx('selection')
  }

  private indexAt(x: number, y: number): number {
    if (this.cellSize <= 0) return -1
    const col = Math.floor((x - this.gridX) / this.cellSize)
    const row = Math.floor((y - this.gridY) / this.cellSize)
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1
    return row * COLS + col
  }

  /**
   * True when the live outputs match the win pattern: outputs 2, 3 and 4 powered,
   * outputs 1 and 5 off (1-based numbers from the OUTPUT legend).
   */
  private get solved(): boolean {
    if (this.sinkIndices.length !== TARGET_OUTPUTS.length) return false
    for (let i = 0; i < this.sinkIndices.length; i += 1) {
      const index = this.sinkIndices[i]
      const on = this.powered[index] && (this.masks[index] & this.sinks[i].bit) !== 0
      if (on !== TARGET_OUTPUTS[i]) return false
    }
    return true
  }

  private get outputsPowered(): number {
    let count = 0
    for (let i = 0; i < this.sinkIndices.length; i += 1) {
      const index = this.sinkIndices[i]
      if (this.powered[index] && (this.masks[index] & this.sinks[i].bit) !== 0) count += 1
    }
    return count
  }

  /**
   * Builds a solvable board. A routing network with a maximum of three openings per
   * cell is grown from the source and tied to each sink, so the solved layout uses
   * only rotatable fittings (never the 4-way cross). Every piece but the fixed source
   * is then scrambled; restoring it (or any valid routing) re-powers the sinks.
   */
  private generate(): void {
    const count = COLS * ROWS
    const MAX_DEGREE = 3

    this.sourceIndex = this.index(0, Math.floor(ROWS / 2))
    this.sinks = [
      { col: Math.floor(COLS * 0.2), row: 0, bit: NORTH, name: SYSTEMS[0] },
      { col: Math.floor(COLS * 0.7), row: 0, bit: NORTH, name: SYSTEMS[1] },
      { col: COLS - 1, row: Math.floor(ROWS / 2), bit: EAST, name: SYSTEMS[2] },
      { col: Math.floor(COLS * 0.2), row: ROWS - 1, bit: SOUTH, name: SYSTEMS[3] },
      { col: Math.floor(COLS * 0.7), row: ROWS - 1, bit: SOUTH, name: SYSTEMS[4] },
    ]
    const sinkCells = new Set(this.sinks.map((sink) => this.index(sink.col, sink.row)))

    let masks: number[] | null = null
    for (let attempt = 0; attempt < 400 && masks === null; attempt += 1) {
      const base = new Array<number>(count).fill(0)
      const visited = new Array<boolean>(count).fill(false)

      // Grow a degree-limited routing network from the source (sinks attached later).
      visited[this.sourceIndex] = true
      const stack = [this.sourceIndex]
      while (stack.length > 0) {
        const current = stack[stack.length - 1]
        if (bitCount(base[current]) >= MAX_DEGREE) {
          stack.pop()
          continue
        }
        const options = this.neighbours(current).filter(
          (n) => !visited[n] && !sinkCells.has(n) && bitCount(base[n]) < MAX_DEGREE,
        )
        if (options.length === 0) {
          stack.pop()
          continue
        }
        const next = options[0]
        const dir = this.directionFromTo(current, next)
        base[current] |= dir
        base[next] |= opposite(dir)
        visited[next] = true
        stack.push(next)
      }

      // Tie each sink to one routed neighbour, then give it its outward terminal.
      let ok = true
      for (const sink of this.sinks) {
        const si = this.index(sink.col, sink.row)
        const reachable = this.neighbours(si).filter((n) => visited[n] && bitCount(base[n]) < MAX_DEGREE)
        if (reachable.length === 0) {
          ok = false
          break
        }
        const n = reachable[Math.floor(Math.random() * reachable.length)]
        const dir = this.directionFromTo(si, n)
        base[si] |= dir
        base[n] |= opposite(dir)
        base[si] |= sink.bit
        visited[si] = true
      }
      if (!ok) continue

      // The source always feeds in from the west, and is never rotated.
      base[this.sourceIndex] |= WEST

      // Untouched cells become rotatable decorative fittings.
      for (let i = 0; i < count; i += 1) {
        if (!visited[i]) base[i] = DECOR[i % DECOR.length]
      }

      // Scramble every piece except the fixed source.
      const scrambled = new Array<number>(count).fill(0)
      for (let i = 0; i < count; i += 1) {
        if (i === this.sourceIndex) {
          scrambled[i] = base[i]
          continue
        }
        const turns = 1 + Math.floor(Math.random() * 3)
        let mask = base[i]
        for (let r = 0; r < turns; r += 1) mask = rotateMask(mask)
        scrambled[i] = mask
      }
      masks = scrambled
    }

    if (masks === null) {
      masks = new Array<number>(count).fill(0)
      for (let i = 0; i < count; i += 1) {
        masks[i] = i === this.sourceIndex ? WEST | EAST : DECOR[i % DECOR.length]
      }
    }

    this.masks = masks
    this.sinkIndices = this.sinks.map((sink) => this.index(sink.col, sink.row))
    this.focusIndex = this.index(1, Math.floor(ROWS / 2))
    this.powered = this.computePowered()
    // Prime the transition tracker so the initial dark grid does not blink on load.
    this.prevPowered = this.powered.slice()
    this.blink = new Array<number>(count).fill(0)
  }

  private computePowered(): boolean[] {
    const powered = new Array<boolean>(COLS * ROWS).fill(false)
    powered[this.sourceIndex] = true
    const stack = [this.sourceIndex]

    while (stack.length > 0) {
      const current = stack.pop() as number
      const col = current % COLS
      const row = Math.floor(current / COLS)
      for (const dir of ORDER) {
        if ((this.masks[current] & dir.bit) === 0) continue
        const nc = col + dir.dx
        const nr = row + dir.dy
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue
        const neighbour = nr * COLS + nc
        if (!powered[neighbour] && (this.masks[neighbour] & opposite(dir.bit)) !== 0) {
          powered[neighbour] = true
          stack.push(neighbour)
        }
      }
    }
    return powered
  }

  private index(col: number, row: number): number {
    return row * COLS + col
  }

  private neighbours(index: number): number[] {
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const result: number[] = []
    for (const dir of ORDER) {
      const nc = col + dir.dx
      const nr = row + dir.dy
      if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) result.push(nr * COLS + nc)
    }
    return shuffle(result)
  }

  private directionFromTo(from: number, to: number): number {
    const dx = (to % COLS) - (from % COLS)
    const dy = Math.floor(to / COLS) - Math.floor(from / COLS)
    if (dx === 1) return EAST
    if (dx === -1) return WEST
    if (dy === 1) return SOUTH
    return NORTH
  }
}
