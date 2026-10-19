import { FONT_FAMILY } from '../../fonts'

// Glyph pool of an untouched tile: digits and technical symbols, in the spirit of
// the memory-core tables.
const GLYPHS = '0123456789ABCDEF#%&*+-=/\\<>?@$!'.split('')

// Tiles the route claims spell this text out, one letter per tile, so a finished
// run reads as a line of recovered prose.
const ROUTE_TEXT =
  'Loremipsumdolorsitametconsecteturadipiscingelit' +
  'CrasaccumsanposuerelacusnonconsequatlectusportaetCurabiturvitaecondimentumjustoagravidaenim' +
  'NullamatefficiturvelitatimperdietipsumPraesentportavelipsumetfermentum' +
  'PhasellusloremlectusmattiseuviverraaportaaenimCrasvestibulumarcuidleovenenatisinterdum' +
  'Proinefficiturorciliberononaliquetliberofermentumeu'

// How long a single glyph stays on screen before it is swapped (seconds).
// Every cell runs at this same rate; only the starting phase differs.
const SWAP_INTERVAL = 0.07

// How long a scanned tile keeps its color before it blends back in (seconds).
const LIGHT_FADE = 2.2

// Flash envelope of a tile the route has just claimed: up, then back down to its
// steady brightness (seconds).
const FLASH_ATTACK = 0.2
const FLASH_RELEASE = 0.5
// How far a flash lifts the tile above its steady look.
const FLASH_PEAK = 0.65

// Flash a tile plays on its way out of a failed run.
const RESET_ATTACK = 0.12
const RESET_RELEASE = 0.5

// Breathing rate of the entrance marker, in radians per second.
const START_PULSE = 3

export type MazeCellStyle = {
  background: string
  border: string
  glyph: string
  /** Glow color behind the glyph, or null for a flat one. */
  glow: string | null
}

/** Idle look, the entrance marker, the two looks a scan reveals, and the route's. */
export type MazeTileStyles = {
  idle: MazeCellStyle
  start: MazeCellStyle
  wall: MazeCellStyle
  path: MazeCellStyle
  route: MazeCellStyle
  flash: MazeCellStyle
}

function pickGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

/** Random phase offset so the whole field does not flip in unison. */
function pickPhase(): number {
  return Math.random() * SWAP_INTERVAL
}

/**
 * One tile of the maze grid. Tiles look the same until a scan wave lights them up;
 * while lit, a wall and a passage read as different colors. A tile the route has
 * claimed turns green, holds its letter from the route text, and goes back to the
 * random churn when the run is dropped.
 */
export class MazeCell {
  readonly col: number
  readonly row: number
  /** True for a wall tile; the player may only travel along passages. */
  readonly wall: boolean

  private glyph = pickGlyph()
  private hold = pickPhase()
  private lit = 0
  private claimed = false
  private flashTime = 0
  private resetTime = -1
  private start = false
  private clock = Math.random() * Math.PI * 2

  constructor(col: number, row: number, wall: boolean) {
    this.col = col
    this.row = row
    this.wall = wall
  }

  /** 0..1 — how strongly the last scan still shows on this tile. */
  get light(): number {
    return this.lit
  }

  /** True once the player's route has run through this tile. */
  get onRoute(): boolean {
    return this.claimed
  }

  /** Marks this tile as the entrance, so it stands out before a run begins. */
  markStart(): void {
    this.start = true
  }

  /** Marks the tile as touched by a scan wave; the strongest hit wins. */
  illuminate(strength: number): void {
    if (strength > this.lit) this.lit = Math.min(1, strength)
  }

  /**
   * Takes the tile into the route: it flashes, turns green and holds the letter
   * the route text has at `step` — the tile's place in the route, counted from 0.
   */
  claim(step: number): void {
    if (this.claimed) return
    this.claimed = true
    this.flashTime = 0
    this.resetTime = -1
    this.glyph = ROUTE_TEXT[step % ROUTE_TEXT.length]
  }

  /**
   * Puts the tile back to its untouched state. `flash` marks a tile dropped by a
   * failed run, which flares once as it goes.
   */
  release(flash = false): void {
    if (!this.claimed) return
    this.claimed = false
    this.flashTime = 0
    this.resetTime = flash ? 0 : -1
    // Back to the random churn, starting from a fresh symbol.
    this.glyph = pickGlyph()
  }

  update(dt: number): void {
    this.clock += dt

    if (this.resetTime >= 0) {
      this.resetTime += dt
      if (this.resetTime > RESET_ATTACK + RESET_RELEASE) this.resetTime = -1
    }

    // A claimed tile holds its letter, so the route stays readable.
    if (this.claimed) {
      this.flashTime += dt
    } else {
      this.hold -= dt
      while (this.hold <= 0) {
        this.glyph = pickGlyph()
        this.hold += SWAP_INTERVAL
      }
    }

    if (this.lit > 0) this.lit = Math.max(0, this.lit - dt / LIGHT_FADE)
  }

  /**
   * Draws the tile into the square at (x, y). A claimed tile draws its own green
   * look; otherwise the idle look is painted, the entrance keeps a slow pulse of
   * its own, and the wall/passage look is layered on as far as the tile is lit.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    styles: MazeTileStyles,
    alpha = 1,
  ): void {
    if (size <= 0 || alpha <= 0) return

    const left = Math.floor(x)
    const top = Math.floor(y)
    const side = Math.max(1, Math.floor(size))

    if (this.claimed) {
      this.paint(ctx, left, top, side, styles.route, alpha)
      const flash = this.flashLevel()
      if (flash > 0) this.paint(ctx, left, top, side, styles.flash, alpha * flash * FLASH_PEAK)
      return
    }

    // A fading scan stays readable a little longer than a linear ramp would.
    const strength = Math.pow(this.lit, 0.6)

    // The idle layer is pulled back as the color comes up, so the color stays clean.
    this.paint(ctx, left, top, side, styles.idle, alpha * (1 - strength * 0.9))

    if (this.start && strength < 1) {
      // The entrance breathes, so the player can see where a run begins.
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * START_PULSE)
      this.paint(ctx, left, top, side, styles.start, alpha * pulse * (1 - strength))
    }

    if (strength > 0) {
      this.paint(ctx, left, top, side, this.wall ? styles.wall : styles.path, alpha * strength)
    }

    // The flare a tile dropped by a failed run plays on its way out.
    const reset = this.resetLevel()
    if (reset > 0) this.paint(ctx, left, top, side, styles.flash, alpha * reset * FLASH_PEAK)
  }

  /** 0..1 flash envelope of a freshly claimed tile. */
  private flashLevel(): number {
    if (this.flashTime < FLASH_ATTACK) return this.flashTime / FLASH_ATTACK
    const released = (this.flashTime - FLASH_ATTACK) / FLASH_RELEASE
    return released >= 1 ? 0 : 1 - released
  }

  /** 0..1 flash envelope of a tile the failed run just dropped. */
  private resetLevel(): number {
    if (this.resetTime < 0) return 0
    if (this.resetTime < RESET_ATTACK) return this.resetTime / RESET_ATTACK
    const released = (this.resetTime - RESET_ATTACK) / RESET_RELEASE
    return released >= 1 ? 0 : 1 - released
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    side: number,
    style: MazeCellStyle,
    alpha: number,
  ): void {
    ctx.save()
    ctx.globalAlpha = alpha

    ctx.fillStyle = style.background
    ctx.fillRect(left, top, side, side)

    ctx.strokeStyle = style.border
    ctx.lineWidth = 1
    ctx.strokeRect(left + 0.5, top + 0.5, side - 1, side - 1)

    const glyphSize = Math.max(7, Math.floor(side * 0.54))
    ctx.font = `${glyphSize}px "${FONT_FAMILY}", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style.glyph
    if (style.glow) {
      ctx.shadowColor = style.glow
      ctx.shadowBlur = Math.max(4, side * 0.12)
    }
    ctx.fillText(this.glyph, left + side / 2, top + side / 2 + 1)

    ctx.restore()
  }
}
