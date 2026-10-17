import { FONT_FAMILY } from '../fonts'
import type { Input } from '../Input'
import type { GameLanguage, GameWindow } from './GameWindow'
import { GlyphRain, type RainStyle } from './GlyphRain'
import type { MazeCell, MazeCellStyle, MazeTileStyles } from './MazeCell'
import { loadRandomMaze, type MazeField, type Rect } from './MazeField'
import { ScanWave } from './ScanWave'
import type { WindowManager } from './WindowManager'

const COLORS = {
  panel: 'rgba(40, 22, 6, 0.22)',
  border: '#8a5a1e',
  borderBright: '#ffcc78',
  dim: '#8a6a3a',
  text: '#f0c98a',
  bright: '#fff0d0',
  glow: 'rgba(255, 190, 110, 0.3)',
  wave: '#ffd9a0',
  success: '#9fe08a',
}

const TILE_IDLE: MazeCellStyle = {
  background: 'rgba(40, 22, 6, 0.35)', border: '#6d4718', glyph: COLORS.text, glow: COLORS.glow,
}
// The tile a run starts from, marked while it is still untouched.
const TILE_START: MazeCellStyle = {
  background: 'rgba(120, 88, 18, 0.5)', border: '#ffd27a', glyph: '#fff3d4', glow: 'rgba(255, 215, 140, 0.7)',
}
// Scanned tiles are kept bright enough to read on a dim screen.
const TILE_WALL: MazeCellStyle = {
  background: 'rgba(168, 34, 16, 0.95)', border: '#ff8a62', glyph: '#ffe2d6', glow: 'rgba(255, 120, 80, 0.6)',
}
const TILE_PATH: MazeCellStyle = {
  background: 'rgba(28, 126, 46, 0.95)', border: '#7bea86', glyph: '#e6ffdc', glow: 'rgba(130, 255, 160, 0.6)',
}
const TILE_ROUTE: MazeCellStyle = {
  background: 'rgba(26, 96, 40, 0.92)', border: '#5fd06a', glyph: '#dcffd2', glow: 'rgba(120, 255, 150, 0.45)',
}
const TILE_FLASH: MazeCellStyle = {
  background: 'rgba(150, 255, 170, 0.55)', border: '#eaffe4', glyph: '#ffffff', glow: 'rgba(190, 255, 200, 0.8)',
}
const RAIN_STYLE: RainStyle = { head: '#ffe3b0', trail: '#9a6f36', glow: 'rgba(255, 200, 130, 0.5)' }
const GLOW_MIN_TILE = 22
const SCAN_COOLDOWN = 0.25
const SCAN_LIMIT = 4
const APPEAR_FRAME = 0.45
const APPEAR_TEXT = 0.4
const APPEAR_TOTAL = APPEAR_FRAME + APPEAR_TEXT

export interface WindowMazeOptions {
  /** Called once when the entrance-to-exit route is completed. Game.ts owns the robot state. */
  onSolved?: () => void
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function flatten(style: MazeCellStyle): MazeCellStyle {
  return style.glow === null ? style : { ...style, glow: null }
}

function adjacent(a: { col: number; row: number }, b: { col: number; row: number }): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1
}

/** Scan-to-reveal bus-bypass maze. Drag a route from the left entrance to the right exit. */
export class WindowMaze implements GameWindow {
  readonly id = 'maze'

  private manager: WindowManager | null = null
  private language: GameLanguage = 'ru'
  private readonly onSolved?: () => void
  private appearTime = APPEAR_TOTAL
  private solved = false
  private field: MazeField = loadRandomMaze()
  private readonly rain = new GlyphRain()
  private waves: ScanWave[] = []
  private scanCooldown = 0
  private route: MazeCell[] = []
  private lastPointer: { x: number; y: number } | null = null

  constructor(options: WindowMazeOptions = {}) {
    this.onSolved = options.onSolved
  }

  /** Public read-only flag used by tests and Game.ts. */
  get isSolved(): boolean {
    return this.solved
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.field = loadRandomMaze()
    this.waves = []
    this.scanCooldown = 0
    this.route = []
    this.lastPointer = null
    this.solved = false
    this.appearTime = 0
  }

  update(dt: number, input: Input): void {
    this.appearTime += dt
    input.consumeWheelDelta()

    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('console')
      return
    }
    if (input.wasPressed('KeyU')) {
      this.manager?.show('ui')
      return
    }

    if (this.scanCooldown > 0) this.scanCooldown = Math.max(0, this.scanCooldown - dt)
    if (input.wasPressed('KeyQ')) this.startScan(input)

    if (!this.solved) this.traceRoute(input)
    this.advanceWaves(dt)
    this.rain.update(dt)
    this.field.update(dt)
  }

  /** The route follows the bare cursor: no button is held while drawing it. */
  private traceRoute(input: Input): void {
    const pointer = input.pointerPosition
    const previous = this.lastPointer ?? pointer
    this.lastPointer = { x: pointer.x, y: pointer.y }

    for (const cell of this.field.trace(previous.x, previous.y, pointer.x, pointer.y)) {
      if (cell.onRoute) {
        const index = this.route.indexOf(cell)
        if (index >= 0) for (const undone of this.route.splice(index + 1)) undone.release()
        continue
      }
      if (cell.wall) {
        if (this.route.length > 0) this.failRun()
        continue
      }

      const head = this.route[this.route.length - 1]
      if (!head) {
        if (cell !== this.field.entrance) continue
      } else if (!adjacent(head, cell)) {
        continue
      }

      cell.claim(this.route.length)
      this.route.push(cell)

      if (cell === this.field.exit) {
        this.solved = true
        this.onSolved?.()
        return
      }
    }
  }

  private failRun(): void {
    this.field.clearRoute(true)
    this.route = []
  }

  private startScan(input: Input): void {
    if (this.scanCooldown > 0) return
    const pointer = input.pointerPosition
    const origin = this.field.toField(pointer.x, pointer.y)
    if (!origin) return
    this.waves.push(new ScanWave(origin.col, origin.row))
    if (this.waves.length > SCAN_LIMIT) this.waves.shift()
    this.scanCooldown = SCAN_COOLDOWN
  }

  private advanceWaves(dt: number): void {
    for (const wave of this.waves) {
      wave.update(dt)
      this.field.applyWave(wave)
    }
    this.waves = this.waves.filter((wave) => !wave.finished)
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
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
    ctx.fillText(this.language === 'ru' ? 'ОБХОД ПОВРЕЖДЁННОЙ ШИНЫ' : 'DAMAGED BUS BYPASS', margin + lineHeight, margin + lineHeight)
    ctx.shadowBlur = 0
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText(`SLOT 05 / ${this.field.name} / ${this.field.columns}x${this.field.rows}`, margin + lineHeight, margin + lineHeight * 2)

    const area: Rect = {
      x: margin + lineHeight,
      y: margin + lineHeight * 3.4,
      width: Math.max(0, width - (margin + lineHeight) * 2),
      height: Math.max(0, height - margin * 2 - lineHeight * 5.4),
    }
    this.drawField(ctx, area, text)
    this.drawRain(ctx, area, text)
    this.drawWaves(ctx, text)

    ctx.font = smallFont
    ctx.fillStyle = this.solved ? COLORS.success : COLORS.dim
    const controls = this.solved
      ? (this.language === 'ru' ? 'ОБХОД ШИНЫ ВОССТАНОВЛЕН  ·  U: UI  ·  ESC / C: КОНСОЛЬ' : 'BUS BYPASS RESTORED  ·  U: UI  ·  ESC / C: CONSOLE')
      : (this.language === 'ru' ? 'МЫШЬ: ВЕСТИ ОТ ВХОДА ДО ВЫХОДА  ·  Q: СКАН  ·  U: UI  ·  ESC: КОНСОЛЬ' : 'MOUSE: TRACE ENTRANCE TO EXIT  ·  Q: SCAN  ·  U: UI  ·  ESC: CONSOLE')
    ctx.fillText(this.fitText(ctx, controls, width - margin * 2), margin + lineHeight, height - margin - lineHeight)
    ctx.globalAlpha = 1
    ctx.restore()
  }

  private drawField(ctx: CanvasRenderingContext2D, area: Rect, alpha: number): void {
    if (area.width <= 0 || area.height <= 0) return
    const tileSize = Math.min(area.width / this.field.columns, area.height / this.field.rows)
    const styles: MazeTileStyles = tileSize >= GLOW_MIN_TILE
      ? { idle: TILE_IDLE, start: TILE_START, wall: TILE_WALL, path: TILE_PATH, route: TILE_ROUTE, flash: TILE_FLASH }
      : { idle: flatten(TILE_IDLE), start: TILE_START, wall: flatten(TILE_WALL), path: flatten(TILE_PATH), route: TILE_ROUTE, flash: TILE_FLASH }
    this.field.draw(ctx, area, styles, alpha)
  }

  private drawRain(ctx: CanvasRenderingContext2D, area: Rect, alpha: number): void {
    const field = this.field.bounds
    if (field.width <= 0) return
    const gap = Math.max(8, this.field.tileSize * 0.5)
    const rightX = field.x + field.width + gap
    const bands: Rect[] = [
      { x: area.x, y: area.y, width: Math.max(0, field.x - gap - area.x), height: area.height },
      { x: rightX, y: area.y, width: Math.max(0, area.x + area.width - rightX), height: area.height },
    ]
    this.rain.draw(ctx, bands, RAIN_STYLE, alpha)
  }

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

  private drawFrame(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, progress: number): void {
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

  private fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return maxWidth <= 0 ? '' : text
    let result = text
    while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1)
    return `${result}…`
  }
}
