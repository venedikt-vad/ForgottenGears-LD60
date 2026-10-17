import { Input } from './Input'
import { FONT_FAMILY, loadFont } from './fonts'
import { ConsoleWindow } from './ConsoleWindow'
import { LanguageSelectWindow } from './LanguageSelectWindow'
import { UiWindow } from './UiWindow'
import { WindowManager } from './WindowManager'
import type { GameLanguage } from './GameWindow'

export type GameOptions = {
  canvas: HTMLCanvasElement
  glowCanvas: HTMLCanvasElement
}

export class Game {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly glowCanvas: HTMLCanvasElement
  readonly glowCtx: CanvasRenderingContext2D
  readonly input: Input
  readonly windows: WindowManager

  private width = 0
  private height = 0
  private running = false
  private lastTime = 0
  private fontLoaded = false

  // Existing player/gameplay state is retained.
  private player = { x: 200, y: 200, size: 32, speed: 240 }

  private readonly onResize = () => this.resize()

  constructor(options: GameOptions) {
    this.canvas = options.canvas
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2D rendering context')
    this.ctx = ctx

    this.glowCanvas = options.glowCanvas
    const glowCtx = this.glowCanvas.getContext('2d')
    if (!glowCtx) throw new Error('Failed to get 2D rendering context for glow canvas')
    this.glowCtx = glowCtx

    this.input = new Input()
    this.windows = new WindowManager(this.input)

    const consoleWindow = new ConsoleWindow()
    const uiWindow = new UiWindow()
    const languageWindow = new LanguageSelectWindow((language: GameLanguage) => {
      consoleWindow.setLanguage(language)
      uiWindow.setLanguage(language)
      this.windows.show('console')
    })

    this.windows
      .register(languageWindow)
      .register(consoleWindow)
      .register(uiWindow)

    // First screen shown when the game starts.
    this.windows.show('language')
  }

  start() {
    if (this.running) return
    this.running = true

    loadFont(FONT_FAMILY)
      .then(() => {
        this.fontLoaded = true
      })
      .catch(() => {
        this.fontLoaded = true
      })

    this.input.attach()
    window.addEventListener('resize', this.onResize)
    this.resize()

    this.lastTime = performance.now()
    requestAnimationFrame(this.loop)
  }

  stop() {
    this.running = false
    this.input.detach()
    window.removeEventListener('resize', this.onResize)
  }

  private readonly loop = (time: number) => {
    if (!this.running) return

    const dt = Math.min((time - this.lastTime) / 1000, 0.1)
    this.lastTime = time

    this.update(dt)
    this.render()
    this.mirrorToGlow()
    this.input.endFrame()

    requestAnimationFrame(this.loop)
  }

  private update(dt: number) {
    // Original movement code is kept unchanged.
    const p = this.player
    let dx = 0
    let dy = 0

    if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) dx -= 1
    if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) dx += 1
    if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) dy -= 1
    if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) dy += 1

    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2)
      dx *= inv
      dy *= inv
    }

    p.x += dx * p.speed * dt
    p.y += dy * p.speed * dt

    const half = p.size / 2
    p.x = Math.max(half, Math.min(this.width - half, p.x))
    p.y = Math.max(half, Math.min(this.height - half, p.y))

    this.windows.update(dt)
  }

  private render() {
    const { ctx, width, height } = this

    ctx.clearRect(0, 0, width, height)

    ctx.fillStyle = 'rgba(46, 48, 58, 0.6)'
    for (let x = 0; x < width; x += 64) ctx.fillRect(x, 0, 1, height)
    for (let y = 0; y < height; y += 64) ctx.fillRect(0, y, width, 1)

    const p = this.player
    ctx.fillStyle = '#c084fc'
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)

    if (this.fontLoaded) {
      ctx.fillStyle = '#f3f4f6'
      ctx.font = `32px "${FONT_FAMILY}", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('FORGOTTEN GEARS', this.width / 2, 16)
    } else {
      ctx.fillStyle = '#9ca3af'
      ctx.font = '16px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('Loading font...', this.width / 2, 16)
    }

    // Draw the active window on top of the existing game scene.
    this.windows.render(ctx, this.width, this.height)
  }

  private mirrorToGlow() {
    const { glowCtx, glowCanvas } = this
    glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height)
    glowCtx.drawImage(this.canvas, 0, 0)
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1
    this.width = window.innerWidth
    this.height = window.innerHeight

    const pixelWidth = Math.round(this.width * dpr)
    const pixelHeight = Math.round(this.height * dpr)

    for (const canvas of [this.canvas, this.glowCanvas]) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
      canvas.style.width = `${this.width}px`
      canvas.style.height = `${this.height}px`
    }

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
