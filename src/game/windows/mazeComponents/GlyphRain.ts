import { FONT_FAMILY } from '../../fonts'
import type { Rect } from './MazeField'

// Same pool the untouched maze tiles churn through.
const GLYPHS = '0123456789ABCDEF#%&*+-=/\\<>?@$!'.split('')

// Spawn points the glyphs fall from, split evenly between the two bands.
const STREAM_COUNT = 12

// Font size is drawn once per glyph and kept for the whole fall, in px.
const SIZE_MIN = 11
const SIZE_MAX = 28

// Fall speed in band heights per second, so it does not change with the layout.
const SPEED_MIN = 0.14
const SPEED_MAX = 0.42

// Gap between two glyphs leaving the same spawn point, in seconds.
const SPAWN_MIN = 0.35
const SPAWN_MAX = 1.6

// How often a glyph swaps its symbol while falling — the tile rate of the maze.
const SWAP_INTERVAL = 0.07

// Symbols kept behind the leading one; they are what the trail is made of.
const TRAIL = 7

/** Colors of a falling glyph and the trail it leaves. */
export type RainStyle = {
  head: string
  trail: string
  glow: string | null
}

type RainGlyph = {
  /** Position down the band, 0 at the spawn point and 1 at the bottom. */
  y: number
  size: number
  /** Newest symbol first; the rest are the trail above it. */
  symbols: string[]
  hold: number
}

type RainStream = {
  /** Which band the stream falls in. */
  band: number
  /** Position across that band, 0..1. */
  offset: number
  speed: number
  spawnIn: number
  glyphs: RainGlyph[]
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

/**
 * Columns of falling symbols for the empty space on either side of the puzzle.
 * Each glyph keeps the size it was born with and swaps its symbol as it falls,
 * dragging the symbols it showed before along as a trail.
 */
export class GlyphRain {
  private readonly streams: RainStream[] = []

  constructor(bands = 2, count = STREAM_COUNT) {
    for (let index = 0; index < count; index += 1) {
      const band = index % bands
      const place = Math.floor(index / bands)
      const perBand = Math.ceil(count / bands)
      this.streams.push({
        band,
        // Spread the spawn points across the band, then nudge each one off the grid.
        offset: Math.min(0.96, Math.max(0.04, (place + 0.5) / perBand + between(-0.06, 0.06))),
        speed: between(SPEED_MIN, SPEED_MAX),
        spawnIn: between(0, SPAWN_MAX),
        glyphs: [],
      })
    }
  }

  update(dt: number): void {
    for (const stream of this.streams) {
      stream.spawnIn -= dt
      if (stream.spawnIn <= 0) {
        stream.glyphs.push({
          y: 0,
          size: between(SIZE_MIN, SIZE_MAX),
          symbols: [pickGlyph()],
          hold: Math.random() * SWAP_INTERVAL,
        })
        stream.spawnIn = between(SPAWN_MIN, SPAWN_MAX)
      }

      for (const glyph of stream.glyphs) {
        glyph.y += stream.speed * dt

        glyph.hold -= dt
        while (glyph.hold <= 0) {
          glyph.symbols.unshift(pickGlyph())
          if (glyph.symbols.length > TRAIL) glyph.symbols.pop()
          glyph.hold += SWAP_INTERVAL
        }
      }

      // The trail hangs above the glyph, so it is gone well past the bottom edge.
      stream.glyphs = stream.glyphs.filter((glyph) => glyph.y < 1.2)
    }
  }

  /** Draws the streams into the given bands, each clipped to its own band. */
  draw(ctx: CanvasRenderingContext2D, bands: Rect[], style: RainStyle, alpha = 1): void {
    if (alpha <= 0) return

    bands.forEach((band, index) => {
      if (band.width <= 0 || band.height <= 0) return

      ctx.save()
      ctx.beginPath()
      ctx.rect(band.x, band.y, band.width, band.height)
      ctx.clip()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (const stream of this.streams) {
        if (stream.band !== index) continue
        const x = band.x + stream.offset * band.width

        for (const glyph of stream.glyphs) {
          const y = band.y + glyph.y * band.height
          ctx.font = `${Math.round(glyph.size)}px "${FONT_FAMILY}", monospace`

          glyph.symbols.forEach((symbol, position) => {
            // The leading symbol is bright; everything behind it fades out.
            const fade = 1 - position / TRAIL
            ctx.globalAlpha = alpha * fade * fade * (position === 0 ? 1 : 0.7)
            ctx.fillStyle = position === 0 ? style.head : style.trail
            if (style.glow && position === 0) {
              ctx.shadowColor = style.glow
              ctx.shadowBlur = glyph.size * 0.5
            } else {
              ctx.shadowBlur = 0
            }
            ctx.fillText(symbol, x, y - position * glyph.size * 1.05)
          })
        }
      }

      ctx.restore()
    })
  }
}
