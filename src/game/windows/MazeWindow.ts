import { FONT_FAMILY } from '../fonts'
import type { Input } from '../Input'
import type { GameLanguage, GameWindow } from './GameWindow'
import { GlyphRain, type RainStyle } from './GlyphRain'
import type { MazeCell, MazeCellStyle, MazeTileStyles } from './MazeCell'
import { loadRandomMaze, type MazeField, type Rect } from './MazeField'
import { ScanWave } from './ScanWave'
import type { WindowManager } from './WindowManager'

const COLORS = {
  background: '#0a0603',
  panel: 'rgba(40, 22, 6, 0.22)',
  border: '#8a5a1e',
  borderBright: '#ffcc78',
  dim: '#8a6a3a',
  text: '#f0c98a',
  bright: '#fff0d0',
  glow: 'rgba(255, 190, 110, 0.3)',
  wave: '#ffd9a0',
}

// Look of an unscanned tile: identical for every cell until a wave lights it up.
const TILE_IDLE: MazeCellStyle = {
  background: 'rgba(40, 22, 6, 0.35)',
  border: '#6d4718',
  glyph: COLORS.text,
  glow: COLORS.glow,
}

// A scanned wall reads as danger, a scanned passage as safe footing.
const TILE_WALL: MazeCellStyle = {
  background: 'rgba(90, 20, 10, 0.55)',
  border: '#8c3a24',
  glyph: '#ff9a7a',
  glow: null,
}

const TILE_PATH: MazeCellStyle = {
  background: 'rgba(20, 60, 24, 0.55)',
  border: '#3c7a3a',
  glyph: '#9fe08a',
  glow: null,
}

// A tile the route runs through: green and bright enough to read without a scan.
const TILE_ROUTE: MazeCellStyle = {
  background: 'rgba(26, 96, 40, 0.92)',
  border: '#5fd06a',
  glyph: '#dcffd2',
  glow: 'rgba(120, 255, 150, 0.45)',
}

// Layered over a freshly claimed tile for its flash.
const TILE_FLASH: MazeCellStyle = {
  background: 'rgba(150, 255, 170, 0.55)',
  border: '#eaffe4',
  glyph: '#ffffff',
  glow: 'rgba(190, 255, 200, 0.8)',
}

// Falling symbols in the free space either side of the puzzle.
const RAIN_STYLE: RainStyle = {
  head: '#ffe3b0',
  trail: '#9a6f36',
  glow: 'rgba(255, 200, 130, 0.5)',
}

// Below this tile size the per-tile glow costs more than it shows.
const GLOW_MIN_TILE = 22

// Shortest gap between two scans, in seconds.
const SCAN_COOLDOWN = 0.25
// Scans still travelling at once; older ones are dropped rather than queued.
const SCAN_LIMIT = 4

// Appear animation timings (seconds): the frame stretches open, then the text fades in.
const APPEAR_FRAME = 0.45
const APPEAR_TEXT = 0.4
const APPEAR_TOTAL = APPEAR_FRAME + APPEAR_TEXT

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

/** Same style without the glow, for tiles too small to carry one. */
function flatten(style: MazeCellStyle): MazeCellStyle {
  return style.glow === null ? style : { ...style, glow: null }
}

/** True when two tiles share an edge; the route may only step between those. */
function adjacent(a: MazeCell, b: MazeCell): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1
}

/**
 * Maze minigame, built up one piece at a time. The field is loaded from a random
 * layout file and looks uniform until Q sends a scan wave out from the cursor;
 * the mouse-drawn route comes later.
 */
export class WindowMaze implements GameWindow {
  readonly id = 'maze'

  private manager: WindowManager | null = null
  private language: GameLanguage = 'ru'
  private appearTime = APPEAR_TOTAL
  private revealed = false

  private field: MazeField = loadRandomMaze()
  private readonly rain = new GlyphRain()
  private waves: ScanWave[] = []
  private scanCooldown = 0

  // Tiles claimed so far, entrance first, plus where the pointer was last frame.
  private route: MazeCell[] = []
  private lastPointer: { x: number; y: number } | null = null

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    // A fresh layout on every visit, picked at random from the three files.
    this.field = loadRandomMaze()
    this.waves = []
    this.scanCooldown = 0
    this.route = []
    this.lastPointer = null
    this.revealed = false
    // Replay the appear animation on every visit.
    this.appearTime = 0
  }

  update(dt: number, input: Input): void {
    this.appearTime += dt

    // The wheel delta is shared state; drop it so the console does not inherit a scroll.
    input.consumeWheelDelta()

    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('console')
      return
    }

    // Temporary build aid: show which tiles are walls.
    if (input.wasPressed('KeyD')) this.revealed = !this.revealed

    if (this.scanCooldown > 0) this.scanCooldown = Math.max(0, this.scanCooldown - dt)
    if (input.wasPressed('KeyQ')) this.startScan(input)

    this.traceRoute(input)
    this.advanceWaves(dt)
    this.rain.update(dt)
    this.field.update(dt)
  }

  /**
   * Follows the pointer while a mouse button is held: tiles it sweeps over join the
   * route one step at a time, and touching a wall throws the whole run away.
   */
  private traceRoute(input: Input): void {
    if (!input.isPointerDown()) {
      // Let go and the trail so far stays; the next press picks it up again.
      this.lastPointer = null
      return
    }

    const pointer = input.pointerPosition
    const previous = this.lastPointer ?? pointer
    this.lastPointer = { x: pointer.x, y: pointer.y }

    for (const cell of this.field.trace(previous.x, previous.y, pointer.x, pointer.y)) {
      if (cell.onRoute) {
        // Stepping back onto the trail rubs out everything drawn past that tile,
        // so the player can take another turn from there.
        const index = this.route.indexOf(cell)
        if (index >= 0) for (const undone of this.route.splice(index + 1)) undone.release()
        continue
      }

      if (cell.wall) {
        // Only a run in progress can be broken; brushing a wall beforehand is free.
        if (this.route.length > 0) this.failRun()
        continue
      }

      const head = this.route[this.route.length - 1]
      if (!head) {
        // A run may only begin at the entrance on the left edge.
        if (cell !== this.field.entrance) continue
      } else if (!adjacent(head, cell)) {
        // The pointer cut a corner or jumped the trail; wait until it is back on it.
        continue
      }

      // The tile's place in the route decides which letter of the text it shows.
      cell.claim(this.route.length)
      this.route.push(cell)
    }
  }

  /**
   * Drops every claimed tile — each one flaring as it goes — and makes the player
   * start the run over.
   */
  private failRun(): void {
    this.field.clearRoute(true)
    this.route = []
  }

  /** Sends a wave out from wherever the cursor is, unless a scan just fired. */
  private startScan(input: Input): void {
    if (this.scanCooldown > 0) return

    const pointer = input.pointerPosition
    const origin = this.field.toField(pointer.x, pointer.y)
    if (!origin) return

    this.waves.push(new ScanWave(origin.col, origin.row))
    if (this.waves.length > SCAN_LIMIT) this.waves.shift()
    this.scanCooldown = SCAN_COOLDOWN
  }

  /** Expands every live wave and lights the tiles its ring is passing. */
  private advanceWaves(dt: number): void {
    if (this.waves.length === 0) return

    for (const wave of this.waves) {
      wave.update(dt)
      this.field.applyWave(wave)
    }
    this.waves = this.waves.filter((wave) => !wave.finished)
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    // The screen keeps a transparent background; only the panel is painted.
    ctx.clearRect(0, 0, width, height)

    const margin = width < 560 ? 14 : 34
    const fontSize = width < 560 ? 12 : width < 1100 ? 15 : 17
    const smallSize = Math.max(10, fontSize - 4)
    const lineHeight = Math.round(fontSize * 1.6)
    const font = `${fontSize}px "${FONT_FAMILY}", monospace`
    const smallFont = `${smallSize}px "${FONT_FAMILY}", monospace`

    const frame = clamp01(this.appearTime / APPEAR_FRAME)
    const text = clamp01((this.appearTime - APPEAR_FRAME) / APPEAR_TEXT)

    this.drawFrame(ctx, margin, margin, width - margin * 2, height - margin * 2, frame)

    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.globalAlpha = text

    ctx.font = font
    ctx.fillStyle = COLORS.bright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 4
    ctx.fillText(
      this.language === 'ru' ? 'ОБХОД ПОВРЕЖДЁННОЙ ШИНЫ' : 'DAMAGED BUS BYPASS',
      margin + lineHeight,
      margin + lineHeight,
    )
    ctx.shadowBlur = 0

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText(
      `SLOT 05 / ${this.field.name} / ${this.field.columns}x${this.field.rows}`,
      margin + lineHeight,
      margin + lineHeight * 2,
    )

    const area: Rect = {
      x: margin + lineHeight,
      y: margin + lineHeight * 3.4,
      width: width - (margin + lineHeight) * 2,
      height: height - margin * 2 - lineHeight * 5.4,
    }
    this.drawField(ctx, area, text)
    this.drawRain(ctx, area, text)
    this.drawWaves(ctx, text)

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText(
      this.language === 'ru'
        ? 'МЫШЬ: ВЕСТИ   Q: СКАН   D: СХЕМА   ESC / C: КОНСОЛЬ'
        : 'MOUSE: TRACE   Q: SCAN   D: SCHEMATIC   ESC / C: CONSOLE',
      margin + lineHeight,
      height - margin - lineHeight,
    )

    ctx.globalAlpha = 1
    ctx.restore()
  }

  /** Draws the maze, flattening tile glow once the tiles get small. */
  private drawField(ctx: CanvasRenderingContext2D, area: Rect, alpha: number): void {
    if (area.width <= 0 || area.height <= 0) return

    const tileSize = Math.min(area.width / this.field.columns, area.height / this.field.rows)
    const lit = tileSize >= GLOW_MIN_TILE

    const styles: MazeTileStyles = lit
      ? { idle: TILE_IDLE, wall: TILE_WALL, path: TILE_PATH, route: TILE_ROUTE, flash: TILE_FLASH }
      : {
          idle: flatten(TILE_IDLE),
          wall: flatten(TILE_WALL),
          path: flatten(TILE_PATH),
          // The route keeps its glow: there are only ever a few such tiles on screen.
          route: TILE_ROUTE,
          flash: TILE_FLASH,
        }

    this.field.draw(ctx, area, styles, alpha, this.revealed)
  }

  /**
   * Draws the falling symbols in the free space either side of the puzzle. The
   * bands come from where the field actually landed, so they follow the layout.
   */
  private drawRain(ctx: CanvasRenderingContext2D, area: Rect, alpha: number): void {
    const field = this.field.bounds
    if (field.width <= 0) return

    const gap = Math.max(8, this.field.tileSize * 0.5)
    const left = field.x - gap - area.x
    const rightX = field.x + field.width + gap
    const bands: Rect[] = [
      { x: area.x, y: area.y, width: left, height: area.height },
      { x: rightX, y: area.y, width: area.x + area.width - rightX, height: area.height },
    ]

    this.rain.draw(ctx, bands, RAIN_STYLE, alpha)
  }

  /** Draws the expanding ring of every live scan, clipped to the field. */
  private drawWaves(ctx: CanvasRenderingContext2D, alpha: number): void {
    const tileSize = this.field.tileSize
    if (this.waves.length === 0 || tileSize <= 0 || alpha <= 0) return

    const bounds = this.field.bounds

    ctx.save()
    ctx.beginPath()
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height)
    ctx.clip()

    ctx.strokeStyle = COLORS.wave
    ctx.shadowColor = COLORS.wave

    for (const wave of this.waves) {
      const center = this.field.toCanvas(wave.col, wave.row)
      const radius = (wave.radius - wave.band / 2) * tileSize
      if (radius <= 0) continue

      ctx.globalAlpha = alpha * wave.intensity * 0.5
      ctx.lineWidth = Math.max(1, wave.band * tileSize * 0.5)
      ctx.shadowBlur = tileSize
      ctx.beginPath()
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.restore()
  }

  /** Draws the panel background plus a border that stretches open from the center. */
  private drawFrame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    progress: number,
  ): void {
    if (width <= 0 || height <= 0) return

    ctx.fillStyle = COLORS.panel
    ctx.fillRect(x, y, width, height)

    const drawnWidth = width * progress
    const drawnHeight = height * progress
    const left = Math.floor(x + (width - drawnWidth) / 2) + 0.5
    const top = Math.floor(y + (height - drawnHeight) / 2) + 0.5

    ctx.strokeStyle = progress >= 1 ? COLORS.border : COLORS.borderBright
    ctx.lineWidth = 1
    ctx.strokeRect(left, top, Math.max(1, drawnWidth - 1), Math.max(1, drawnHeight - 1))
  }
}
