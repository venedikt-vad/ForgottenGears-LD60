import { FONT_FAMILY } from '../../fonts'

export const MENU_COLORS = {
  // Painted on the glow layer so the opaque CRT backdrop does not hide the bloom.
  background: 'rgba(2, 8, 4, 0.94)',
  panel: 'rgba(4, 20, 10, 0.78)',
  panelAlt: 'rgba(8, 34, 17, 0.66)',
  border: '#2f6b3c',
  borderBright: '#89f5a4',
  grid: 'rgba(83, 158, 98, 0.11)',
  text: '#bcffae',
  bright: '#eaffea',
  dim: '#659e5c',
  accent: '#a8ffb7',
  green: '#71f79f',
  yellow: '#ffd166',
  red: '#ff7782',
  selected: 'rgba(103, 218, 130, 0.16)',
}

export type MenuRect = { x: number; y: number; width: number; height: number }

export function menuFont(size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${size}px "${FONT_FAMILY}", monospace`
}

/** Dark CRT terminal backdrop: faint grid, phosphor vignette and scanlines. */
export function drawConsoleBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time = 0,
): void {
  ctx.save()
  // The solid backdrop lives on the glow layer (see Game.mirrorToGlow), so the
  // game canvas stays transparent and the bloom is not covered by it.

  ctx.strokeStyle = MENU_COLORS.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0.5; x < width; x += 32) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  for (let y = 0.5; y < height; y += 32) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()

  // Slow phosphor sweep, visible but never in the way of the text.
  const sweepY = ((time * 36) % (height + 160)) - 80
  const sweep = ctx.createLinearGradient(0, sweepY - 60, 0, sweepY + 60)
  sweep.addColorStop(0, 'rgba(114, 255, 130, 0)')
  sweep.addColorStop(0.5, 'rgba(114, 255, 130, 0.035)')
  sweep.addColorStop(1, 'rgba(114, 255, 130, 0)')
  ctx.fillStyle = sweep
  ctx.fillRect(0, sweepY - 60, width, 120)

  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.15,
    width / 2, height / 2, Math.max(width, height) * 0.75,
  )
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
  for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1)
  ctx.restore()
}

export function drawRule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  progress = 1,
  color = MENU_COLORS.border,
): void {
  if (width <= 0 || progress <= 0) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(Math.floor(x) + 0.5, Math.floor(y) + 0.5)
  ctx.lineTo(Math.floor(x + width * Math.min(1, progress)) + 0.5, Math.floor(y) + 0.5)
  ctx.stroke()
  ctx.restore()
}

export function drawPanel(
  ctx: CanvasRenderingContext2D,
  rect: MenuRect,
  fill = MENU_COLORS.panel,
  border = MENU_COLORS.border,
): void {
  if (rect.width <= 0 || rect.height <= 0) return
  ctx.save()
  ctx.fillStyle = fill
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1))
  ctx.restore()
}

/**
 * Draw text with the same subtle phosphor halo as console text. Uses the
 * context's current font, fill style and alignment.
 */
export function fillGlowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  blur = 2,
): void {
  if (!text) return
  ctx.save()
  ctx.shadowColor = 'rgba(114, 255, 98, 0.22)'
  ctx.shadowBlur = blur
  ctx.fillText(text, x, y)
  ctx.restore()
}

export function drawGlowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  blur = 8,
): void {
  ctx.save()
  ctx.font = font
  ctx.fillStyle = color
  ctx.shadowColor = 'rgba(114, 255, 98, 0.42)'
  ctx.shadowBlur = blur
  ctx.fillText(text, x, y)
  ctx.shadowBlur = 0
  ctx.restore()
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  let fitted = text
  while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) {
    fitted = fitted.slice(0, -1)
  }
  return `${fitted}…`
}

export function includesPoint(rect: MenuRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

export function formatDuration(seconds: number, language: 'ru' | 'en'): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return language === 'ru'
    ? `${pad(hours)}ч ${pad(minutes)}м ${pad(secs)}с`
    : `${pad(hours)}h ${pad(minutes)}m ${pad(secs)}s`
}

export function formatSaveDate(timestamp: number, language: 'ru' | 'en'): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--.--.---- --:--'
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = pad(date.getDate())
  const month = pad(date.getMonth() + 1)
  const year = date.getFullYear()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return language === 'ru' ? `${day}.${month}.${year}  ${time}` : `${year}-${month}-${day}  ${time}`
}

/** A compact progress bar with a percentage label slot kept to its right. */
export function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  rect: MenuRect,
  ratio: number,
  color = MENU_COLORS.green,
): void {
  if (rect.width <= 0 || rect.height <= 0) return
  ctx.save()
  ctx.fillStyle = 'rgba(53, 96, 62, 0.55)'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.fillStyle = color
  ctx.fillRect(rect.x, rect.y, Math.max(0, Math.min(1, ratio)) * rect.width, rect.height)
  ctx.strokeStyle = 'rgba(137, 245, 164, 0.22)'
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1))
  ctx.restore()
}
