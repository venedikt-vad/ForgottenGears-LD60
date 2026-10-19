import { FONT_FAMILY, LOST_LANGUAGE_FAMILY } from '../fonts'
import { playSfx } from '../sfx'
import type { Input } from '../Input'
import type { GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

const COLORS = {
  background: '#04081a',
  panel: 'rgba(26, 62, 130, 0.16)',
  border: '#2f66c8',
  grid: 'rgba(64, 118, 210, 0.28)',
  headerBg: 'rgba(47, 102, 200, 0.22)',
  highlight: 'rgba(87, 200, 255, 0.16)',
  focus: 'rgba(87, 200, 255, 0.34)',
  dim: '#2b4c8c',
  text: '#8fc0ff',
  bright: '#dceeff',
  accent: '#57c8ff',
  glow: 'rgba(87, 200, 255, 0.35)',
  correct: '#4ade80',
  correctBg: 'rgba(74, 222, 128, 0.2)',
  incorrect: '#ff6b5e',
  incorrectBg: 'rgba(255, 107, 94, 0.22)',
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

// Target cell size in px: panels are packed with as many cells as fit.
// The right table also reserves one header column on its left.
const CELL_TARGET = 48

// How many right-table cells are blanked out for the player to fill in.
const PUZZLE_MIN = 7
const PUZZLE_MAX = 12

// Appear animation timings (seconds). Row headers reveal first, then the rest.
const APPEAR_GRID = 0.5
const APPEAR_BLINK = 0.1
const APPEAR_HEADER = 0.5
const APPEAR_SYMBOL = 1
const APPEAR_REVEAL = 0.18
const APPEAR_HEADER_START = APPEAR_GRID
const APPEAR_SYMBOL_START = APPEAR_HEADER_START + APPEAR_HEADER
const APPEAR_TOTAL = APPEAR_SYMBOL_START + APPEAR_SYMBOL

type Rect = { x: number; y: number; width: number; height: number }

type CellGrid = {
  x: number
  y: number
  cellWidth: number
  cellHeight: number
  columns: number
  rows: number
}

type Appear = {
  time: number
  grid: number
  borderAlpha: number
}

/** Stable pseudo-random 0..1 for a seed, so per-cell delays don't flicker. */
function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123
  return x - Math.floor(x)
}

/** 0..1 reveal progress for a symbol whose staggered delay has just elapsed. */
function reveal(time: number, delay: number, start: number): number {
  const p = (time - start - delay) / APPEAR_REVEAL
  return p <= 0 ? 0 : p >= 1 ? 1 : p
}

/** Table border fades in, blinks a few times, then holds solid. */
function borderAlpha(time: number): number {
  const p = (time - 0) / APPEAR_BLINK
  if (p <= 0 || p >= 1) return 1
  return Math.floor(p * 10) % 2 === 0 ? 1 : 0.1
}

/** Fill an array with `count` symbols drawn at random from the pool. */
function randomSymbols(pool: string[], count: number): string[] {
  const result = new Array<string>(count)
  for (let i = 0; i < count; i += 1) {
    result[i] = pool[Math.floor(Math.random() * pool.length)]
  }
  return result
}

/** Pick `count` letters, distinct while the pool lasts. */
function randomHeaders(count: number): string[] {
  const shuffled = [...LETTERS]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = swap
  }

  const result = new Array<string>(count)
  for (let i = 0; i < count; i += 1) {
    result[i] = i < shuffled.length ? shuffled[i] : LETTERS[Math.floor(Math.random() * LETTERS.length)]
  }
  return result
}

/** A blue memory-core screen: a lost-language glyph table beside a counting table. */
export class MemoryCoreWindow implements GameWindow {
  readonly id = 'memoryCore'

  private manager: WindowManager | null = null
  private columns = 0
  private rows = 0
  private focusRow = 0
  private focusCol = 0

  private leftSymbols: string[] = []
  private rowHeaders: string[] = []

  private values: number[] = []
  private puzzleCells = new Set<number>()
  private answers = new Map<number, string>()
  private wasPointerDown = false
  private appearTime = APPEAR_TOTAL

  // Right-table data geometry in CSS px, for mouse hit testing.
  private hitX = 0
  private hitY = 0
  private cellW = 0
  private cellH = 0

  onShow(manager: WindowManager): void {
    this.manager = manager
    // State is kept across visits so a half-solved puzzle survives reopen.
    this.wasPointerDown = false
    // Replay the appear animation each time the window is opened.
    this.appearTime = 0
  }

  update(dt: number, input: Input): void {
    this.appearTime += dt

    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('ui')
      return
    }

    // Input is locked while the reveal animation plays.
    if (this.appearTime < APPEAR_TOTAL) return

    // Click to select a right-table cell.
    const down = input.isPointerDown()
    if (down && !this.wasPointerDown && this.cellW > 0) {
      const position = input.pointerPosition
      const column = Math.floor((position.x - this.hitX) / this.cellW)
      const row = Math.floor((position.y - this.hitY) / this.cellH)
      if (column >= 0 && column < this.columns && row >= 0 && row < this.rows) {
        if (column !== this.focusCol || row !== this.focusRow) playSfx('selection')
        this.focusCol = column
        this.focusRow = row
      }
    }
    this.wasPointerDown = down

    if (this.columns <= 0 || this.rows <= 0) return

    if (input.wasPressed('ArrowLeft')) this.focusCol = (this.focusCol - 1 + this.columns) % this.columns
    else if (input.wasPressed('ArrowRight')) this.focusCol = (this.focusCol + 1) % this.columns
    else if (input.wasPressed('ArrowUp')) this.focusRow = (this.focusRow - 1 + this.rows) % this.rows
    else if (input.wasPressed('ArrowDown')) this.focusRow = (this.focusRow + 1) % this.rows

    // Once solved the table locks and no further edits are accepted.
    if (!this.isSolved) this.handleTyping(input)
  }

  /** Number of blanked cells currently holding their correct value. */
  private solvedCount(): number {
    if (this.values.length !== this.columns * this.rows) return 0
    let total = 0
    for (const index of this.puzzleCells) {
      if ((this.answers.get(index) ?? '') === String(this.values[index])) total += 1
    }
    return total
  }

  /** True once every blanked cell has been filled in correctly. */
  private get isSolved(): boolean {
    return this.puzzleCells.size > 0 && this.solvedCount() === this.puzzleCells.size
  }

  /** Type a number into the focused cell when it is one of the blanked-out cells. */
  private handleTyping(input: Input): void {
    const index = this.focusRow * this.columns + this.focusCol
    if (!this.puzzleCells.has(index)) return

    for (const key of input.getPressedKeyValues()) {
      if (key === 'Backspace') {
        const current = this.answers.get(index) ?? ''
        this.answers.set(index, current.slice(0, -1))
      } else if (key.length === 1 && key >= '0' && key <= '9') {
        const current = this.answers.get(index) ?? ''
        if (current.length < 3) {
          const value = current + key
          this.answers.set(index, value)
          const answer = String(this.values[index])
          if (value === answer) playSfx('correct')
          else if (!answer.startsWith(value)) playSfx('incorrect')
        }
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.clearRect(0, 0, width, height)

    ctx.fillStyle = COLORS.background
    // ctx.fillRect(0, 0, width, height)

    const margin = width < 560 ? 10 : 22
    const baseSize = width < 560 ? 13 : width < 1100 ? 16 : 18
    const smallFont = `${Math.max(10, baseSize - 4)}px "${FONT_FAMILY}", monospace`

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `${baseSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.bright
    ctx.shadowColor = COLORS.glow
    ctx.shadowBlur = 6
    ctx.fillText('MEMORY CORE', margin, margin)
    ctx.shadowBlur = 0

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText('GLYPH DECODE // ADDRESS SPACE', margin, margin + baseSize * 1.5)

    const top = margin + baseSize * 3
    const bottom = height - margin - baseSize * 1.6
    const panelHeight = Math.max(120, bottom - top)

    const gap = margin
    const panelWidth = (width - margin * 2 - gap) / 2

    const left: Rect = { x: margin, y: top, width: panelWidth, height: panelHeight }
    const right: Rect = { x: margin + panelWidth + gap, y: top, width: panelWidth, height: panelHeight }

    const pad = Math.max(6, baseSize * 0.4)
    const titleHeight = baseSize * 1.5

    // The right table leaves room for one header column on its left.
    const rightAvailWidth = right.width - pad * 2
    const rightAvailHeight = right.height - titleHeight - pad * 2
    const columns = Math.max(4, Math.floor(rightAvailWidth / CELL_TARGET) - 1)
    const rows = Math.max(4, Math.floor(rightAvailHeight / CELL_TARGET))

    this.columns = columns
    this.rows = rows
    this.focusRow = ((this.focusRow % rows) + rows) % rows
    this.focusCol = ((this.focusCol % columns) + columns) % columns

    const count = columns * rows
    const sizeChanged = this.leftSymbols.length !== count || this.rowHeaders.length !== rows
    if (this.leftSymbols.length !== count) this.leftSymbols = randomSymbols(LETTERS, count)
    if (this.rowHeaders.length !== rows) this.rowHeaders = randomHeaders(rows)
    if (sizeChanged) this.generatePuzzle()
    this.values = this.cellValues()

    const leftGrid: CellGrid = {
      x: left.x + pad,
      y: left.y + titleHeight + pad,
      cellWidth: (left.width - pad * 2) / columns,
      cellHeight: (left.height - titleHeight - pad * 2) / rows,
      columns,
      rows,
    }

    const rightGrid: CellGrid = {
      x: right.x + pad,
      y: right.y + titleHeight + pad,
      cellWidth: rightAvailWidth / (columns + 1),
      cellHeight: rightAvailHeight / rows,
      columns,
      rows,
    }

    // Remember where the data cells sit so the mouse can select them.
    this.hitX = rightGrid.x + rightGrid.cellWidth
    this.hitY = rightGrid.y
    this.cellW = rightGrid.cellWidth
    this.cellH = rightGrid.cellHeight

    const appear: Appear = {
      time: this.appearTime,
      grid: Math.min(1, this.appearTime / APPEAR_GRID),
      borderAlpha: borderAlpha(this.appearTime),
    }

    this.drawGlyphTable(ctx, left, leftGrid, pad, baseSize, appear)
    this.drawCountTable(ctx, right, rightGrid, pad, baseSize, appear)

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('CLICK / ARROWS — SELECT   ·   TYPE — FILL   ·   ESC / C — UI', margin, height - margin - baseSize * 0.6)

    ctx.restore()
  }

  /** Blank out a random handful of right-table cells for the player to solve. */
  private generatePuzzle(): void {
    this.puzzleCells.clear()
    this.answers.clear()

    const count = this.columns * this.rows
    if (count <= 0) return

    const blanks = Math.min(
      count,
      PUZZLE_MIN + Math.floor(Math.random() * (PUZZLE_MAX - PUZZLE_MIN + 1)),
    )
    while (this.puzzleCells.size < blanks) {
      this.puzzleCells.add(Math.floor(Math.random() * count))
    }
  }

  /**
   * Value of every right-grid cell: how many times the row's header letter appears
   * among the left table's positionally matching row and column (union, no double count).
   */
  private cellValues(): number[] {
    const values = new Array<number>(this.rows * this.columns)
    const letterIndex = (letter: string): number => letter.charCodeAt(0) - 97

    const rowHits = new Array<number>(this.rows)
    const columnCounts: number[][] = []
    for (let column = 0; column < this.columns; column += 1) {
      columnCounts.push(new Array<number>(26).fill(0))
    }

    for (let row = 0; row < this.rows; row += 1) {
      const header = this.rowHeaders[row]
      let hits = 0
      for (let column = 0; column < this.columns; column += 1) {
        const symbol = this.leftSymbols[row * this.columns + column]
        columnCounts[column][letterIndex(symbol)] += 1
        if (symbol === header) hits += 1
      }
      rowHits[row] = hits
    }

    for (let row = 0; row < this.rows; row += 1) {
      const headerIndex = letterIndex(this.rowHeaders[row])
      for (let column = 0; column < this.columns; column += 1) {
        const shared =
          this.leftSymbols[row * this.columns + column] === this.rowHeaders[row] ? 1 : 0
        values[row * this.columns + column] =
          rowHits[row] + columnCounts[column][headerIndex] - shared
      }
    }
    return values
  }

  /** Left panel: a random lost-language glyph grid with the focused row/column lit up. */
  private drawGlyphTable(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    grid: CellGrid,
    pad: number,
    baseSize: number,
    appear: Appear,
  ): void {
    ctx.fillStyle = COLORS.panel
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

    ctx.globalAlpha = appear.borderAlpha
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
    ctx.globalAlpha = 1

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `${baseSize}px "${FONT_FAMILY}", monospace`
    ctx.globalAlpha = appear.grid
    ctx.fillStyle = COLORS.accent
    ctx.fillText('DATA', rect.x + pad, rect.y + pad * 0.6)
    ctx.globalAlpha = 1

    const width = grid.cellWidth * grid.columns
    const height = grid.cellHeight * grid.rows

    // Grid lines stretch across the panel as it opens.
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let column = 0; column <= grid.columns; column += 1) {
      const x = Math.floor(grid.x + column * grid.cellWidth) + 0.5
      ctx.moveTo(x, grid.y)
      ctx.lineTo(x, grid.y + height * appear.grid)
    }
    for (let row = 0; row <= grid.rows; row += 1) {
      const y = Math.floor(grid.y + row * grid.cellHeight) + 0.5
      ctx.moveTo(grid.x, y)
      ctx.lineTo(grid.x + width * appear.grid, y)
    }
    ctx.stroke()

    const rowTop = grid.y + this.focusRow * grid.cellHeight
    const columnLeft = grid.x + this.focusCol * grid.cellWidth

    ctx.globalAlpha = appear.grid
    ctx.fillStyle = COLORS.highlight
    ctx.fillRect(grid.x, rowTop, width, grid.cellHeight)
    ctx.fillRect(columnLeft, grid.y, grid.cellWidth, height)

    ctx.strokeStyle = COLORS.accent
    ctx.strokeRect(grid.x + 0.5, Math.floor(rowTop) + 0.5, Math.floor(width) - 1, Math.floor(grid.cellHeight) - 1)
    ctx.strokeRect(Math.floor(columnLeft) + 0.5, grid.y + 0.5, Math.floor(grid.cellWidth) - 1, Math.floor(height) - 1)
    ctx.globalAlpha = 1

    const glyphSize = Math.max(8, Math.floor(Math.min(grid.cellHeight * 0.5, grid.cellWidth * 0.62)))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // The selected right-table cell counts the header letter wherever it appears
    // in the focused row or column — those symbols light up green.
    const header = this.rowHeaders[this.focusRow] ?? ''

    for (let index = 0; index < this.leftSymbols.length; index += 1) {
      const shown = reveal(appear.time, hash01(index * 1.13) * APPEAR_SYMBOL, APPEAR_SYMBOL_START)
      if (shown <= 0) continue

      const symbol = this.leftSymbols[index]
      const column = index % grid.columns
      const row = Math.floor(index / grid.columns)
      const centerX = grid.x + column * grid.cellWidth + grid.cellWidth / 2
      const centerY = grid.y + row * grid.cellHeight + grid.cellHeight / 2
      const lit = row === this.focusRow || column === this.focusCol
      const counted = lit && symbol === header

      ctx.globalAlpha = shown
      ctx.font = `${Math.round(glyphSize * (0.5 + 0.5 * shown))}px "${LOST_LANGUAGE_FAMILY}", monospace`
      ctx.fillStyle = counted ? COLORS.correct : lit ? COLORS.bright : COLORS.text
      if (counted) {
        ctx.shadowColor = COLORS.correct
        ctx.shadowBlur = 6
      } else if (lit) {
        ctx.shadowColor = COLORS.glow
        ctx.shadowBlur = 4
      }
      ctx.fillText(symbol, centerX, centerY)
      if (lit) ctx.shadowBlur = 0
    }
    ctx.globalAlpha = 1
  }

  /** Right panel: header letters plus the counting table the player can fill in. */
  private drawCountTable(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    grid: CellGrid,
    pad: number,
    baseSize: number,
    appear: Appear,
  ): void {
    ctx.fillStyle = COLORS.panel
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

    ctx.globalAlpha = appear.borderAlpha
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)

    const solved = this.isSolved
    if (solved) {
      ctx.strokeStyle = COLORS.correct
      ctx.lineWidth = 2
      ctx.shadowColor = COLORS.correct
      ctx.shadowBlur = 12
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2)
      ctx.shadowBlur = 0
      ctx.lineWidth = 1
    }
    ctx.globalAlpha = 1

    ctx.textBaseline = 'top'
    ctx.font = `${baseSize}px "${FONT_FAMILY}", monospace`
    ctx.globalAlpha = appear.grid
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.accent
    ctx.fillText('CHECKSUM', rect.x + pad, rect.y + pad * 0.6)

    ctx.textAlign = 'right'
    if (solved) {
      ctx.fillStyle = COLORS.correct
      ctx.shadowColor = COLORS.correct
      ctx.shadowBlur = 8
      ctx.fillText('SOLVED', rect.x + rect.width - pad, rect.y + pad * 0.6)
      ctx.shadowBlur = 0
    } else {
      ctx.fillStyle = COLORS.dim
      ctx.fillText(`${this.solvedCount()}/${this.puzzleCells.size}`, rect.x + rect.width - pad, rect.y + pad * 0.6)
    }
    ctx.textAlign = 'left'
    ctx.globalAlpha = 1

    const dataX = grid.x + grid.cellWidth
    const dataY = grid.y
    const width = grid.cellWidth * (grid.columns + 1)
    const height = grid.cellHeight * grid.rows

    ctx.globalAlpha = appear.grid
    ctx.fillStyle = COLORS.headerBg
    ctx.fillRect(grid.x, grid.y, grid.cellWidth, height)

    ctx.fillStyle = COLORS.focus
    ctx.fillRect(
      dataX + this.focusCol * grid.cellWidth,
      dataY + this.focusRow * grid.cellHeight,
      grid.cellWidth,
      grid.cellHeight,
    )

    // Blanked cells read red until the player types the right value (then green).
    for (const index of this.puzzleCells) {
      const column = index % grid.columns
      const row = Math.floor(index / grid.columns)
      const answer = this.answers.get(index) ?? ''
      const isCorrect = answer !== '' && answer === String(this.values[index])
      ctx.fillStyle = isCorrect ? COLORS.correctBg : COLORS.incorrectBg
      ctx.fillRect(
        dataX + column * grid.cellWidth,
        dataY + row * grid.cellHeight,
        grid.cellWidth,
        grid.cellHeight,
      )
    }
    ctx.globalAlpha = 1

    // Grid lines stretch across the panel as it opens.
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let column = 0; column <= grid.columns + 1; column += 1) {
      const x = Math.floor(grid.x + column * grid.cellWidth) + 0.5
      ctx.moveTo(x, grid.y)
      ctx.lineTo(x, grid.y + height * appear.grid)
    }
    for (let row = 0; row <= grid.rows; row += 1) {
      const y = Math.floor(grid.y + row * grid.cellHeight) + 0.5
      ctx.moveTo(grid.x, y)
      ctx.lineTo(grid.x + width * appear.grid, y)
    }
    ctx.stroke()

    ctx.globalAlpha = appear.grid
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 2
    ctx.strokeRect(
      Math.floor(dataX + this.focusCol * grid.cellWidth) + 1,
      Math.floor(dataY + this.focusRow * grid.cellHeight) + 1,
      Math.floor(grid.cellWidth) - 2,
      Math.floor(grid.cellHeight) - 2,
    )
    ctx.lineWidth = 1
    ctx.globalAlpha = 1

    const headerSize = Math.max(8, Math.floor(Math.min(grid.cellHeight * 0.56, grid.cellWidth * 0.72)))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (let row = 0; row < grid.rows; row += 1) {
      const shown = reveal(appear.time, hash01(row * 1.13 + 2000) * APPEAR_HEADER, APPEAR_HEADER_START)
      if (shown <= 0) continue

      const lit = row === this.focusRow
      ctx.globalAlpha = shown
      ctx.font = `${Math.round(headerSize * (0.5 + 0.5 * shown))}px "${LOST_LANGUAGE_FAMILY}", monospace`
      ctx.fillStyle = lit ? COLORS.bright : COLORS.accent
      if (lit) {
        ctx.shadowColor = COLORS.glow
        ctx.shadowBlur = 4
      }
      ctx.fillText(
        this.rowHeaders[row],
        grid.x + grid.cellWidth / 2,
        dataY + row * grid.cellHeight + grid.cellHeight / 2,
      )
      if (lit) ctx.shadowBlur = 0
    }

    const valueSize = Math.max(9, Math.floor(Math.min(grid.cellHeight * 0.5, grid.cellWidth * 0.56)))

    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const index = row * grid.columns + column
        const shown = reveal(appear.time, hash01(index * 1.13 + 1000) * APPEAR_SYMBOL, APPEAR_SYMBOL_START)
        if (shown <= 0) continue

        const isPuzzle = this.puzzleCells.has(index)
        const focused = row === this.focusRow && column === this.focusCol
        const answer = isPuzzle ? this.answers.get(index) ?? '' : String(this.values[index])

        if (answer === '') continue

        const color = isPuzzle
          ? answer === String(this.values[index])
            ? COLORS.correct
            : COLORS.incorrect
          : focused
            ? COLORS.bright
            : COLORS.text
        ctx.globalAlpha = shown
        ctx.font = `${Math.round(valueSize * (0.5 + 0.5 * shown))}px "${FONT_FAMILY}", monospace`
        ctx.fillStyle = color
        if (isPuzzle || focused) {
          ctx.shadowColor = color
          ctx.shadowBlur = 6
        }
        ctx.fillText(
          answer,
          dataX + column * grid.cellWidth + grid.cellWidth / 2,
          dataY + row * grid.cellHeight + grid.cellHeight / 2,
        )
        if (isPuzzle || focused) ctx.shadowBlur = 0
      }
    }
    ctx.globalAlpha = 1
  }
}
