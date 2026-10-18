import { FONT_FAMILY } from '../fonts'
import type { Input } from '../Input'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

const ENDGAME_VIDEO = `${import.meta.env.BASE_URL}endgame.mp4`

/** Full-screen success scene shown only after RobotSystem accepts safe startup. */
export class VictoryWindow implements GameWindow {
  readonly id = 'victory'

  private language: GameLanguage = 'ru'
  private manager: WindowManager | null = null
  private elapsed = 0
  private video: HTMLVideoElement | null = null

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.elapsed = 0
    this.startVideo()
  }

  onHide(): void {
    this.stopVideo()
  }

  update(dt: number, input: Input): void {
    this.elapsed += dt
    for (const event of input.getPressedKeyEvents()) {
      if (event.code === 'Escape' || event.code === 'KeyR') {
        window.location.reload()
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        this.manager?.show('console')
        return
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const ru = this.language === 'ru'
    ctx.save()
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#020704'
    ctx.fillRect(0, 0, width, height)
    this.drawVideoFrame(ctx, width, height)
    // Dim layer so the overlay text stays readable above the cinematic.
    ctx.fillStyle = 'rgba(2, 7, 4, 0.4)'
    ctx.fillRect(0, 0, width, height)

    // Dim diagnostic grid in the same CRT style as the recovery console.
    ctx.strokeStyle = 'rgba(82, 255, 116, 0.13)'
    ctx.lineWidth = 1
    for (let x = 0; x < width; x += 32) {
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, height)
      ctx.stroke()
    }
    for (let y = 0; y < height; y += 32) {
      ctx.beginPath()
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(width, y + 0.5)
      ctx.stroke()
    }

    const inset = Math.max(18, Math.min(52, width * 0.07))
    const pulse = 0.65 + Math.sin(this.elapsed * 2.4) * 0.2
    ctx.strokeStyle = `rgba(100, 233, 130, ${pulse})`
    ctx.lineWidth = 2
    ctx.shadowColor = 'rgba(88, 255, 123, 0.45)'
    ctx.shadowBlur = 14
    ctx.strokeRect(inset, inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2))
    ctx.shadowBlur = 0

    // Central status mark.
    const cx = width / 2
    const cy = height * 0.22
    const radius = Math.max(22, Math.min(42, width * 0.045))
    ctx.strokeStyle = '#71f79f'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(cx - radius * 0.48, cy + radius * 0.02)
    ctx.lineTo(cx - radius * 0.12, cy + radius * 0.38)
    ctx.lineTo(cx + radius * 0.5, cy - radius * 0.35)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#a5ffb5'
    ctx.shadowColor = 'rgba(88, 255, 123, 0.35)'
    ctx.shadowBlur = 10
    ctx.font = `bold ${Math.max(20, Math.min(46, width * 0.055))}px "${FONT_FAMILY}", monospace`
    ctx.fillText(ru ? 'РОБОТ ЗАПУЩЕН' : 'ROBOT ONLINE', cx, height * 0.39, Math.max(1, width - inset * 3))
    ctx.shadowBlur = 0

    ctx.fillStyle = '#70d987'
    ctx.font = `${Math.max(11, Math.min(18, width * 0.022))}px "${FONT_FAMILY}", monospace`
    ctx.fillText(
      ru ? 'ПОСЛЕДОВАТЕЛЬНОСТЬ БЕЗОПАСНОГО ЗАПУСКА ЗАВЕРШЕНА' : 'SAFE START SEQUENCE COMPLETED',
      cx,
      height * 0.49,
      Math.max(1, width - inset * 3),
    )

    ctx.fillStyle = '#bdf8c7'
    ctx.font = `${Math.max(11, Math.min(17, width * 0.02))}px "${FONT_FAMILY}", monospace`
    ctx.fillText('RTS-711  /  LOC-630  /  BAL-640  [ONLINE]', cx, height * 0.56, Math.max(1, width - inset * 3))

    if (Math.floor(this.elapsed * 2) % 2 === 0) {
      ctx.fillStyle = '#659e5c'
      ctx.font = `${Math.max(10, Math.min(15, width * 0.018))}px "${FONT_FAMILY}", monospace`
      ctx.fillText(
        ru ? 'ENTER — ВЕРНУТЬСЯ В КОНСОЛЬ    ESC / R — ПЕРЕЗАГРУЗКА' : 'ENTER — RETURN TO CONSOLE    ESC / R — RELOAD',
        cx,
        height * 0.70,
        Math.max(1, width - inset * 3),
      )
    }

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.restore()
  }

  /** Plays the endgame cinematic on repeat for as long as the window is shown. */
  private startVideo(): void {
    if (!this.video) {
      const video = document.createElement('video')
      video.src = ENDGAME_VIDEO
      video.playsInline = true
      video.preload = 'auto'
      video.loop = true
      // Off-screen: its frames are copied into the canvas on every render.
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;pointer-events:none'
      document.body.appendChild(video)
      this.video = video
    }
    const video = this.video
    video.currentTime = 0
    video.muted = false
    video.play().catch(() => {
      // Autoplay with sound requires a user gesture; retry muted.
      video.muted = true
      void video.play().catch(() => {})
    })
  }

  private stopVideo(): void {
    if (!this.video) return
    this.video.pause()
    this.video.currentTime = 0
  }

  /** Cover-fit video frame; skipped until the file has decodable data. */
  private drawVideoFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const video = this.video
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
    const drawWidth = video.videoWidth * scale
    const drawHeight = video.videoHeight * scale
    ctx.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  }
}
