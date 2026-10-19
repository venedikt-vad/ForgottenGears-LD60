import { MazeCell, type MazeTileStyles } from './MazeCell'
import type { ScanWave } from './ScanWave'
import maze01 from '../../mazes/maze_01.txt?raw'
import maze02 from '../../mazes/maze_02.txt?raw'
import maze03 from '../../mazes/maze_03.txt?raw'

/** Layout files: '#' is a wall, '.' is a passage. */
const LAYOUTS: { name: string; source: string }[] = [
  { name: 'MAP 01', source: maze01 },
  { name: 'MAP 02', source: maze02 },
  { name: 'MAP 03', source: maze03 },
]

const PATH_CHAR = '.'

export type Rect = { x: number; y: number; width: number; height: number }

/** A point in field coordinates: fractional column/row, tile centers at .5 steps. */
export type FieldPoint = { col: number; row: number }

/** Reads a random layout file and builds the field from it. */
export function loadRandomMaze(): MazeField {
  const layout = LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)]
  return new MazeField(layout.source, layout.name)
}

/**
 * The maze grid itself: tiles parsed from a layout file, scaled to fit the area it
 * is drawn into. It keeps the geometry of the last draw so the mouse and the scan
 * waves can be mapped onto tiles.
 */
export class MazeField {
  readonly name: string
  readonly columns: number
  readonly rows: number

  private readonly cells: MazeCell[]

  // Geometry of the most recent draw, in CSS px.
  private originX = 0
  private originY = 0
  private cellSize = 0

  constructor(layout: string, name = '') {
    this.name = name

    const lines = layout.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length > 0)
    if (lines.length === 0) throw new Error(`Maze layout "${name}" is empty`)

    this.rows = lines.length
    this.columns = lines.reduce((widest, line) => Math.max(widest, line.length), 0)

    this.cells = new Array<MazeCell>(this.columns * this.rows)
    for (let row = 0; row < this.rows; row += 1) {
      const line = lines[row]
      for (let col = 0; col < this.columns; col += 1) {
        // Anything that is not a passage — including a short line's missing tail — is a wall.
        const wall = line[col] !== PATH_CHAR
        this.cells[row * this.columns + col] = new MazeCell(col, row, wall)
      }
    }

    // The entrance carries a marker of its own, so a run has a visible start.
    this.entrance?.markStart()
  }

  get tiles(): readonly MazeCell[] {
    return this.cells
  }

  /** The passage cut into the left edge, where a run starts. */
  get entrance(): MazeCell | null {
    for (let row = 0; row < this.rows; row += 1) {
      const cell = this.cells[row * this.columns]
      if (!cell.wall) return cell
    }
    return null
  }

  /** The passage cut into the right edge, where a run ends. */
  get exit(): MazeCell | null {
    for (let row = 0; row < this.rows; row += 1) {
      const cell = this.cells[row * this.columns + this.columns - 1]
      if (!cell.wall) return cell
    }
    return null
  }

  /**
   * Drops the whole route, putting every tile back to its untouched state.
   * `flash` makes the tiles that were on the route flare once as they go.
   */
  clearRoute(flash = false): void {
    for (const cell of this.cells) cell.release(flash)
  }

  /**
   * Tiles the pointer swept over on its way from one canvas point to the next, in
   * order and without repeats, so a fast mouse cannot jump across a wall unnoticed.
   */
  trace(fromX: number, fromY: number, toX: number, toY: number): MazeCell[] {
    if (this.cellSize <= 0) return []

    const distance = Math.hypot(toX - fromX, toY - fromY)
    const steps = Math.max(1, Math.ceil(distance / (this.cellSize / 3)))

    const visited: MazeCell[] = []
    let previous: MazeCell | null = null
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      const cell = this.cellAtPoint(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t)
      if (!cell || cell === previous) continue
      previous = cell
      visited.push(cell)
    }
    return visited
  }

  /** Side of one tile as it was last drawn, in CSS px. */
  get tileSize(): number {
    return this.cellSize
  }

  cellAt(col: number, row: number): MazeCell | null {
    if (col < 0 || row < 0 || col >= this.columns || row >= this.rows) return null
    return this.cells[row * this.columns + col]
  }

  /** Tile under a point in canvas coordinates, or null outside the field. */
  cellAtPoint(x: number, y: number): MazeCell | null {
    const point = this.toField(x, y)
    if (!point) return null
    return this.cellAt(Math.floor(point.col), Math.floor(point.row))
  }

  /** Canvas point to field coordinates, or null before the field has been drawn. */
  toField(x: number, y: number): FieldPoint | null {
    if (this.cellSize <= 0) return null
    return {
      col: (x - this.originX) / this.cellSize,
      row: (y - this.originY) / this.cellSize,
    }
  }

  /** Field coordinates back to a canvas point. */
  toCanvas(col: number, row: number): { x: number; y: number } {
    return {
      x: this.originX + col * this.cellSize,
      y: this.originY + row * this.cellSize,
    }
  }

  /** Lights every tile the wave's ring is sweeping over right now. */
  applyWave(wave: ScanWave): void {
    const reach = wave.radius

    // Only the ring's bounding box can be affected, so skip the rest of the grid.
    const minCol = Math.max(0, Math.floor(wave.col - reach))
    const maxCol = Math.min(this.columns - 1, Math.ceil(wave.col + reach))
    const minRow = Math.max(0, Math.floor(wave.row - reach))
    const maxRow = Math.min(this.rows - 1, Math.ceil(wave.row + reach))

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const dx = col + 0.5 - wave.col
        const dy = row + 0.5 - wave.row
        const strength = wave.strengthAt(Math.hypot(dx, dy))
        if (strength > 0) this.cells[row * this.columns + col].illuminate(strength)
      }
    }
  }

  update(dt: number): void {
    for (const cell of this.cells) cell.update(dt)
  }

  /** Lays the field out inside `area`, centered, with square tiles, and draws it. */
  draw(
    ctx: CanvasRenderingContext2D,
    area: Rect,
    styles: MazeTileStyles,
    alpha = 1,
  ): void {
    this.cellSize = Math.floor(Math.min(area.width / this.columns, area.height / this.rows))
    if (this.cellSize <= 0) return

    const fieldWidth = this.cellSize * this.columns
    const fieldHeight = this.cellSize * this.rows
    this.originX = Math.floor(area.x + (area.width - fieldWidth) / 2)
    this.originY = Math.floor(area.y + (area.height - fieldHeight) / 2)

    if (alpha <= 0) return

    for (const cell of this.cells) {
      cell.draw(
        ctx,
        this.originX + cell.col * this.cellSize,
        this.originY + cell.row * this.cellSize,
        this.cellSize,
        styles,
        alpha,
      )
    }
  }

  /** Rect the field occupied in the most recent draw. */
  get bounds(): Rect {
    return {
      x: this.originX,
      y: this.originY,
      width: this.cellSize * this.columns,
      height: this.cellSize * this.rows,
    }
  }
}
