export type Point = { x: number; y: number }
export type Size = { width: number; height: number }

export type ImageDrawerOptions = {
  image: CanvasImageSource
  beginTime: number
  position: Point
  size: Size
  /** How long the glitch runs, in milliseconds. After this the image draws clean. */
  duration?: number
  /** Multiplies the glitch strength (1 = default). */
  intensity?: number
  /** Number of horizontal bands the image is torn into. */
  slices?: number
}

type SizedSource = CanvasImageSource & {
  width?: number
  height?: number
  naturalWidth?: number
  naturalHeight?: number
  videoWidth?: number
  videoHeight?: number
}

const DEFAULT_DURATION = 300
const DEFAULT_INTENSITY = 0.4
const DEFAULT_SLICES = 5

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getSourceSize(image: CanvasImageSource): Size {
  const source = image as SizedSource
  return {
    width: source.naturalWidth || source.videoWidth || source.width || 0,
    height: source.naturalHeight || source.videoHeight || source.height || 0,
  }
}

/**
 * Draws an image with a decaying glitch/tear animation that runs from `beginTime`.
 * `position` is the top-left corner; `size` is the drawn size in canvas units.
 */
export class ImageDrawer {
  image: CanvasImageSource
  beginTime: number
  position: Point
  size: Size
  duration: number
  intensity: number
  slices: number

  constructor(options: ImageDrawerOptions) {
    this.image = options.image
    this.beginTime = options.beginTime
    this.position = options.position
    this.size = options.size
    this.duration = options.duration ?? DEFAULT_DURATION
    this.intensity = options.intensity ?? DEFAULT_INTENSITY
    this.slices = Math.max(1, Math.floor(options.slices ?? DEFAULT_SLICES))
  }

  restart(time: number = performance.now()): void {
    this.beginTime = time
  }

  /** Glitch strength in 0..1 for a given time; reaches 0 once the animation settles. */
  glitchAmount(time: number): number {
    if (this.duration <= 0) return 0
    const progress = clamp((time - this.beginTime) / this.duration, 0, 1)
    return (1 - progress) * this.intensity
  }

  draw(ctx: CanvasRenderingContext2D, time: number = performance.now()): void {
    const { x, y } = this.position
    const { width, height } = this.size

    if (time < this.beginTime) return

    const source = getSourceSize(this.image)
    const amount = this.glitchAmount(time)

    // Nothing to draw yet (unloaded image) or degenerate target rect.
    if (source.width <= 0 || source.height <= 0 || width <= 0 || height <= 0) return

    if (amount <= 0) {
      ctx.drawImage(this.image, x, y, width, height)
      return
    }

    const sliceHeight = height / this.slices
    const sourceSliceHeight = source.height / this.slices

    ctx.save()
    // Whole-frame flicker keeps the tear pattern feeling unstable.
    ctx.globalAlpha = 1 - Math.random() * 0.18 * amount

    for (let index = 0; index < this.slices; index += 1) {
      const destY = y + index * sliceHeight
      const destSliceHeight =
        index === this.slices - 1 ? y + height - destY : sliceHeight
      const sourceY = index * sourceSliceHeight
      const sourceSliceHeightCurrent =
        index === this.slices - 1 ? source.height - sourceY : sourceSliceHeight

      const displacement = (Math.random() * 2 - 1) * amount * width * 0.35
      // Occasionally fling a band much further to break the silhouette.
      const jump =
        Math.random() < amount * 0.2 ? (Math.random() * 2 - 1) * width * 0.6 : 0

      ctx.drawImage(
        this.image,
        0,
        sourceY,
        source.width,
        sourceSliceHeightCurrent,
        x + displacement + jump,
        destY + jump,
        width,
        destSliceHeight,
      )
    }

    // Occasional bright tear line.
    if (Math.random() < amount * 0.6) {
      const localY = Math.random() * height
      const tearHeight = Math.max(1, height * 0.02)
      const sourceY = (localY / height) * source.height
      ctx.globalAlpha = 0.35 * amount
      ctx.drawImage(
        this.image,
        0,
        sourceY,
        source.width,
        tearHeight,
        x + (Math.random() * 2 - 1) * width * 0.15,
        y + localY,
        width,
        tearHeight,
      )
    }

    ctx.restore()
  }
}
