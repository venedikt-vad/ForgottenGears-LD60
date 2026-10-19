// Wave geometry is measured in tiles, so a scan covers the same part of the maze
// no matter how large the field is drawn.

/** How fast the ring expands, in tiles per second. */
const SPEED = 16
/** How far from the cursor a scan still reaches, in tiles. */
const MAX_RADIUS = 9.5
/** Thickness of the ring that lights tiles up, in tiles. */
const BAND = 1.4

/**
 * A single ping sent out from the cursor: a ring that expands across the field and
 * lights up every tile it sweeps over, weaker the further it travels.
 */
export class ScanWave {
  /** Origin in field coordinates (fractional column/row). */
  readonly col: number
  readonly row: number

  private radiusTiles = 0

  constructor(col: number, row: number) {
    this.col = col
    this.row = row
  }

  /** Outer edge of the ring, in tiles. */
  get radius(): number {
    return this.radiusTiles
  }

  get band(): number {
    return BAND
  }

  /** 0..1 — the ring itself dims as it travels out. */
  get intensity(): number {
    return Math.max(0, 1 - this.radiusTiles / MAX_RADIUS)
  }

  /** True once the whole ring has passed the scan's reach. */
  get finished(): boolean {
    return this.radiusTiles - BAND > MAX_RADIUS
  }

  update(dt: number): void {
    this.radiusTiles += SPEED * dt
  }

  /**
   * How strongly this wave lights a tile at `distance` tiles from the origin,
   * or 0 while the ring has not reached it yet (or has already passed it).
   */
  strengthAt(distance: number): number {
    if (distance > this.radiusTiles || distance < this.radiusTiles - BAND) return 0
    if (distance > MAX_RADIUS) return 0
    return Math.max(0, 1 - distance / MAX_RADIUS)
  }
}
