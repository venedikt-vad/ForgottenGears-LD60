import { FONT_FAMILY } from '../fonts'
import { ImageDrawer } from '../ImageDrawer'
import type { Input } from '../Input'
import type { RobotSystem, RuntimeComponent, RuntimeStatus } from '../Game'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

type BodyPart = 'ALL' | 'HEAD' | 'LEFT_ARM' | 'RIGHT_ARM' | 'TORSO' | 'LEFT_LEG' | 'RIGHT_LEG'
type UiStatus = 'normal' | 'disabled' | 'damaged'
type Rect = { x: number; y: number; width: number; height: number }
type ComponentRow = { id: string; rect: Rect }
type BodyHotspot = { part: Exclude<BodyPart, 'ALL'>; rect: Rect }

const COLORS = {
  background: '#050b07',
  panel: 'rgba(7, 23, 13, 0.94)',
  panelAlt: 'rgba(12, 34, 19, 0.95)',
  border: '#376d42',
  borderBright: '#89f5a4',
  grid: 'rgba(83, 158, 98, 0.13)',
  text: '#bcffae',
  bright: '#eaffea',
  dim: '#659e5c',
  accent: '#a8ffb7',
  selected: 'rgba(103, 218, 130, 0.18)',
  green: '#71f79f',
  yellow: '#ffd166',
  red: '#ff3448',
  redBright: '#ff7782',
  redDark: '#8e1422',
  gray: '#a0afa4',
}

const PARTS: Array<{
  id: Exclude<BodyPart, 'ALL'>
  title: Record<GameLanguage, string>
  componentIds: string[]
}> = [
  { id: 'HEAD', title: { ru: 'ГОЛОВА', en: 'HEAD' }, componentIds: ['CAM-410', 'LID-420', 'IMU-430'] },
  { id: 'LEFT_ARM', title: { ru: 'ЛЕВАЯ РУКА', en: 'LEFT ARM' }, componentIds: ['FRC-440', 'SRV-620'] },
  { id: 'RIGHT_ARM', title: { ru: 'ПРАВАЯ РУКА', en: 'RIGHT ARM' }, componentIds: ['ARM-R-660', 'ACT-610', 'SRV-620'] },
  { id: 'TORSO', title: { ru: 'ТОРС / ВНУТРЕННИЕ СИСТЕМЫ', en: 'TORSO / INTERNAL SYSTEMS' }, componentIds: ['PWR-100', 'RCTR-110', 'PDU-230', 'BUS-T-240', 'MCM-740', 'CLG-820', 'THP-830', 'CPU-730', 'MEM-732'] },
  { id: 'LEFT_LEG', title: { ru: 'ЛЕВАЯ НОГА', en: 'LEFT LEG' }, componentIds: ['LEG-L-670', 'FRC-440', 'BAL-640'] },
  { id: 'RIGHT_LEG', title: { ru: 'ПРАВАЯ НОГА', en: 'RIGHT LEG' }, componentIds: ['ACT-610', 'SRV-620', 'BAL-640'] },
]

function toUiStatus(status: RuntimeStatus): UiStatus {
  if (status === 'ONLINE') return 'normal'
  if (status === 'OFFLINE' || status === 'MISSING') return 'disabled'
  return 'damaged'
}

function statusLabel(status: RuntimeStatus, language: GameLanguage): string {
  const normalized = toUiStatus(status)
  if (language === 'ru') {
    if (normalized === 'normal') return 'В НОРМЕ'
    if (normalized === 'disabled') return 'ОТКЛЮЧЁН'
    return 'ПОВРЕЖДЁН'
  }
  if (normalized === 'normal') return 'NORMAL'
  if (normalized === 'disabled') return 'DISABLED'
  return 'DAMAGED'
}

function statusColor(status: RuntimeStatus): string {
  const normalized = toUiStatus(status)
  if (normalized === 'normal') return COLORS.green
  if (normalized === 'disabled') return COLORS.gray
  return COLORS.redBright
}

function includesPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

/**
 * BIOS-style maintenance utility. The shared RobotSystem stays owned by Game.ts;
 * this window only reads it and asks WindowManager to open existing service windows.
 */
export class UiWindow implements GameWindow {
  readonly id = 'ui'

  private manager: WindowManager | null = null
  private readonly robotSystem: RobotSystem
  private language: GameLanguage = 'ru'
  private selectedPart: BodyPart = 'ALL'
  private selectedIndex = 0
  private scrollTop = 0
  private wasPointerDown = false
  private message = ''

  private bodyImg: ImageDrawer | null = null
  private readonly schemeImage = new Image()

  private componentRows: ComponentRow[] = []
  private bodyHotspots: BodyHotspot[] = []
  private openButtonRect: Rect | null = null
  private powerButtonRect: Rect | null = null
  private lastMainRect: Rect | null = null
  private lastFooterRect: Rect | null = null
  private visibleComponents: RuntimeComponent[] = []

  constructor(robotSystem: RobotSystem) {
    this.robotSystem = robotSystem
    this.schemeImage.src = `${import.meta.env.BASE_URL}robot_scheme/scheme_01.png`
    const first = this.robotSystem.listComponents().findIndex((item) => toUiStatus(item.status) !== 'normal')
    this.selectedIndex = Math.max(0, first)
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.wasPointerDown = false
    this.bodyImg = new ImageDrawer({
      image: this.schemeImage,
      beginTime: performance.now(),
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
    })
  }

  update(_dt: number, input: Input): void {
    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('console')
      return
    }

    // Quick filters for body regions; 0 returns to the complete component registry.
    const digitPart: Record<string, BodyPart> = {
      Digit1: 'HEAD', Digit2: 'LEFT_ARM', Digit3: 'RIGHT_ARM',
      Digit4: 'TORSO', Digit5: 'LEFT_LEG', Digit6: 'RIGHT_LEG', Digit0: 'ALL',
    }
    for (const [key, part] of Object.entries(digitPart)) {
      if (input.wasPressed(key)) {
        this.selectPart(part)
        break
      }
    }

    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.moveSelection(-1)
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.moveSelection(1)
    if (input.wasPressed('PageUp')) this.moveSelection(-8)
    if (input.wasPressed('PageDown')) this.moveSelection(8)
    if (input.wasPressed('ArrowLeft')) this.cyclePart(-1)
    if (input.wasPressed('ArrowRight')) this.cyclePart(1)
    if (input.wasPressed('Enter') || input.wasPressed('KeyO')) this.openSelectedComponent()
    if (input.wasPressed('KeyP')) this.openPowerRedistribution()

    const down = input.isPointerDown()
    if (down && !this.wasPointerDown) {
      const p = input.pointerPosition
      this.handlePointer(p.x, p.y)
    }
    this.wasPointerDown = down
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    // Clear the previous frame. Glow is intentionally drawn after clearing so it stays crisp.
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, width, height)
    this.drawGrid(ctx, width, height)

    const margin = width < 560 ? 10 : width < 1000 ? 18 : 28
    const fontSize = width < 460 ? 10 : width < 1000 ? 12 : 14
    const lineHeight = Math.ceil(fontSize * 1.48)
    const font = `${fontSize}px "${FONT_FAMILY}", monospace`
    const smallFont = `${Math.max(8, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    const titleFont = `bold ${fontSize + 2}px "${FONT_FAMILY}", monospace`

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    this.drawGlowText(
      ctx,
      this.language === 'ru' ? 'УТИЛИТА ОБСЛУЖИВАНИЯ РОБОТА' : 'ROBOT MAINTENANCE UTILITY',
      margin,
      margin,
      titleFont,
      COLORS.bright,
      'rgba(114, 255, 98, 0.36)',
      5,
    )

    const counts = this.getUiCounts()
    const countText = this.language === 'ru'
      ? `В НОРМЕ ${counts.normal}   ОТКЛЮЧЕНО ${counts.disabled}   ПОВРЕЖДЕНО ${counts.damaged}`
      : `NORMAL ${counts.normal}   DISABLED ${counts.disabled}   DAMAGED ${counts.damaged}`
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText('SERVICE MODE / LIVE COMPONENT STATE', margin, margin + lineHeight * 1.25)

    const compactHeader = width < 720
    if (compactHeader) {
      ctx.fillStyle = COLORS.text
      ctx.fillText(this.fitText(ctx, countText, width - margin * 2), margin, margin + lineHeight * 2.05)
    } else {
      ctx.textAlign = 'right'
      ctx.fillStyle = COLORS.text
      ctx.fillText(this.fitText(ctx, countText, Math.max(80, width * 0.52)), width - margin, margin + lineHeight * 1.25)
      ctx.textAlign = 'left'
    }

    const ruleY = margin + lineHeight * (compactHeader ? 3.0 : 2.3)
    this.drawRule(ctx, margin, ruleY, width - margin * 2)

    const contentY = ruleY + 8
    const footerHeight = Math.max(4.4 * lineHeight + 8, 72)
    const footerY = height - margin - footerHeight
    const mainHeight = Math.max(100, footerY - contentY - 9)
    const availableWidth = width - margin * 2
    const showDiagram = width >= 780 && mainHeight >= 220
    const gap = showDiagram ? 12 : 0
    const diagramWidth = showDiagram ? Math.min(availableWidth * 0.39, 470) : 0
    const listWidth = Math.max(0, availableWidth - diagramWidth - gap)
    const mainRect: Rect = { x: margin, y: contentY, width: availableWidth, height: mainHeight }
    this.lastMainRect = mainRect
    this.visibleComponents = this.getFilteredComponents()
    this.clampSelection()

    const listRect: Rect = { x: margin, y: contentY, width: listWidth, height: mainHeight }
    this.drawComponentTable(ctx, listRect, font, smallFont, titleFont, fontSize, lineHeight)

    this.bodyHotspots = []
    if (showDiagram) {
      const diagramRect: Rect = {
        x: margin + listWidth + gap,
        y: contentY,
        width: diagramWidth,
        height: mainHeight,
      }
      this.drawBodyDiagram(ctx, diagramRect, font, smallFont, lineHeight)
    }

    const footerRect: Rect = { x: margin, y: footerY, width: availableWidth, height: footerHeight }
    this.lastFooterRect = footerRect
    this.drawDetailsAndActions(ctx, footerRect, font, smallFont, lineHeight)

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    const footerHelp = this.language === 'ru'
      ? '1–6: ЧАСТЬ ТЕЛА  ·  0: ВСЕ  ·  ↑/↓: КОМПОНЕНТ  ·  ENTER: ОТЛАДКА  ·  P: ПИТАНИЕ  ·  ESC: КОНСОЛЬ'
      : '1–6: BODY PART  ·  0: ALL  ·  ↑/↓: COMPONENT  ·  ENTER: DEBUG  ·  P: POWER  ·  ESC: CONSOLE'
    ctx.fillText(this.fitText(ctx, footerHelp, width - margin * 2), margin, height - margin + 1)

    ctx.restore()
  }

  private getFilteredComponents(): RuntimeComponent[] {
    const all = this.robotSystem.listComponents()
    if (this.selectedPart === 'ALL') return all
    const ids = PARTS.find((part) => part.id === this.selectedPart)?.componentIds ?? []
    return all.filter((component) => ids.includes(component.id))
  }

  private getSelectedComponent(): RuntimeComponent | undefined {
    return this.visibleComponents[this.selectedIndex]
  }

  private clampSelection(): void {
    if (this.visibleComponents.length === 0) {
      this.selectedIndex = 0
      this.scrollTop = 0
      return
    }
    this.selectedIndex = Math.max(0, Math.min(this.visibleComponents.length - 1, this.selectedIndex))
  }

  private selectPart(part: BodyPart): void {
    this.selectedPart = part
    this.scrollTop = 0
    const ids = part === 'ALL' ? [] : (PARTS.find((item) => item.id === part)?.componentIds ?? [])
    const all = this.robotSystem.listComponents()
    const targetIndex = part === 'ALL'
      ? all.findIndex((component) => toUiStatus(component.status) !== 'normal')
      : all.findIndex((component) => ids.includes(component.id) && toUiStatus(component.status) !== 'normal')
    this.visibleComponents = this.getFilteredComponents()
    const desiredId = targetIndex >= 0 ? all[targetIndex]?.id : this.visibleComponents[0]?.id
    const filteredIndex = this.visibleComponents.findIndex((component) => component.id === desiredId)
    this.selectedIndex = filteredIndex >= 0 ? filteredIndex : 0
    this.message = ''
  }

  private moveSelection(amount: number): void {
    const components = this.getFilteredComponents()
    if (components.length === 0) return
    this.selectedIndex = Math.max(0, Math.min(components.length - 1, this.selectedIndex + amount))
    this.message = ''
  }

  private cyclePart(amount: number): void {
    const allParts: BodyPart[] = ['ALL', ...PARTS.map((part) => part.id)]
    const current = allParts.indexOf(this.selectedPart)
    const next = (current + amount + allParts.length) % allParts.length
    this.selectPart(allParts[next] ?? 'ALL')
  }

  private getUiCounts(): Record<UiStatus, number> {
    const counts: Record<UiStatus, number> = { normal: 0, disabled: 0, damaged: 0 }
    for (const item of this.robotSystem.listComponents()) counts[toUiStatus(item.status)] += 1
    return counts
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x < width; x += 32) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, height)
    }
    for (let y = 0; y < height; y += 32) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(width, y + 0.5)
    }
    ctx.stroke()
  }

  private drawComponentTable(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    font: string,
    smallFont: string,
    titleFont: string,
    fontSize: number,
    lineHeight: number,
  ): void {
    this.drawPanel(ctx, rect)
    const pad = 9
    const titleY = rect.y + 7
    ctx.font = titleFont
    ctx.fillStyle = COLORS.text
    ctx.fillText(this.language === 'ru' ? 'РЕЕСТР КОМПОНЕНТОВ' : 'COMPONENT REGISTRY', rect.x + pad, titleY)

    const partTitle = this.selectedPart === 'ALL'
      ? (this.language === 'ru' ? 'ВСЕ ПОДСИСТЕМЫ' : 'ALL SUBSYSTEMS')
      : (PARTS.find((part) => part.id === this.selectedPart)?.title[this.language] ?? this.selectedPart)
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText(this.fitText(ctx, partTitle, rect.width - pad * 2), rect.x + pad, titleY + lineHeight * 1.2)

    const tableHeaderY = titleY + lineHeight * 2.15
    this.drawRule(ctx, rect.x + pad, tableHeaderY - 3, rect.width - pad * 2)
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    const idX = rect.x + pad
    const nameX = rect.x + pad + Math.min(91, Math.max(68, rect.width * 0.19))
    const statusW = Math.min(92, Math.max(72, rect.width * 0.21))
    const statusX = rect.x + rect.width - pad - statusW
    ctx.fillText('ID', idX, tableHeaderY + 2)
    ctx.fillText(this.language === 'ru' ? 'КОМПОНЕНТ' : 'COMPONENT', nameX, tableHeaderY + 2)
    ctx.textAlign = 'right'
    ctx.fillText(this.language === 'ru' ? 'СОСТОЯНИЕ' : 'STATE', rect.x + rect.width - pad, tableHeaderY + 2)
    ctx.textAlign = 'left'

    const rowsTop = tableHeaderY + lineHeight * 1.05
    const rowsBottom = rect.y + rect.height - 7
    const rowHeight = Math.max(15, Math.min(lineHeight * 1.15, (rowsBottom - rowsTop) / 5.5))
    const visibleRows = Math.max(1, Math.floor((rowsBottom - rowsTop) / rowHeight))

    if (this.selectedIndex < this.scrollTop) this.scrollTop = this.selectedIndex
    if (this.selectedIndex >= this.scrollTop + visibleRows) this.scrollTop = this.selectedIndex - visibleRows + 1
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.visibleComponents.length - visibleRows)))

    this.componentRows = []
    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x + 2, rowsTop, rect.width - 4, Math.max(0, rowsBottom - rowsTop))
    ctx.clip()

    for (let row = 0; row < visibleRows; row += 1) {
      const index = this.scrollTop + row
      const component = this.visibleComponents[index]
      if (!component) break
      const y = rowsTop + row * rowHeight
      const rowRect: Rect = { x: rect.x + 5, y: y - 1, width: rect.width - 10, height: rowHeight }
      this.componentRows.push({ id: component.id, rect: rowRect })

      if (index === this.selectedIndex) {
        ctx.fillStyle = COLORS.selected
        ctx.fillRect(rowRect.x, rowRect.y, rowRect.width, rowRect.height)
        ctx.strokeStyle = COLORS.borderBright
        ctx.strokeRect(rowRect.x + 0.5, rowRect.y + 0.5, rowRect.width - 1, rowRect.height - 1)
      }

      ctx.font = font
      ctx.fillStyle = index === this.selectedIndex ? COLORS.bright : COLORS.text
      ctx.fillText(component.id, idX, y + Math.max(0, (rowHeight - fontSize) / 2), Math.max(35, nameX - idX - 6))

      const nameWidth = Math.max(25, statusX - nameX - 8)
      ctx.fillStyle = index === this.selectedIndex ? COLORS.bright : COLORS.text
      ctx.fillText(this.fitText(ctx, component.name, nameWidth), nameX, y + Math.max(0, (rowHeight - fontSize) / 2), nameWidth)

      ctx.font = smallFont
      ctx.textAlign = 'right'
      ctx.fillStyle = statusColor(component.status)
      ctx.fillText(statusLabel(component.status, this.language), rect.x + rect.width - pad, y + Math.max(0, (rowHeight - fontSize) / 2), statusW)
      ctx.textAlign = 'left'
    }
    ctx.restore()

    if (this.visibleComponents.length > visibleRows) {
      ctx.font = smallFont
      ctx.fillStyle = COLORS.dim
      ctx.textAlign = 'right'
      ctx.fillText(`${this.scrollTop + 1}-${Math.min(this.scrollTop + visibleRows, this.visibleComponents.length)}/${this.visibleComponents.length}`, rect.x + rect.width - pad, rect.y + rect.height - lineHeight * 0.8)
      ctx.textAlign = 'left'
    }
  }

  private drawBodyDiagram(ctx: CanvasRenderingContext2D, rect: Rect, font: string, smallFont: string, lineHeight: number): void {
    this.drawPanel(ctx, rect)
    const pad = 9
    ctx.font = font
    ctx.fillStyle = COLORS.text
    ctx.fillText(this.language === 'ru' ? 'СХЕМА КОРПУСА' : 'BODY SCHEMATIC', rect.x + pad, rect.y + 7)

    const hintY = rect.y + rect.height - lineHeight - 6
    const top = rect.y + lineHeight * 1.7
    const area: Rect = {
      x: rect.x + pad,
      y: top,
      width: rect.width - pad * 2,
      height: Math.max(20, hintY - top - 4),
    }
    const aspect = 687 / 1024
    const h = Math.min(area.height, area.width / aspect)
    const w = h * aspect
    const imageRect: Rect = {
      x: area.x + (area.width - w) / 2,
      y: area.y + (area.height - h) / 2,
      width: w,
      height: h,
    }

    if (this.schemeImage.complete && this.schemeImage.naturalWidth > 0 && this.bodyImg) {
      this.bodyImg.position = { x: imageRect.x, y: imageRect.y }
      this.bodyImg.size = { width: imageRect.width, height: imageRect.height }
      this.bodyImg.draw(ctx)
    } else {
      this.drawFallbackRobot(ctx, imageRect)
    }

    const regions: Array<{ part: Exclude<BodyPart, 'ALL'>; x: number; y: number; w: number; h: number; tag: string }> = [
      { part: 'HEAD', x: 0.34, y: 0.04, w: 0.32, h: 0.17, tag: 'CAM / LIDAR' },
      { part: 'LEFT_ARM', x: 0.00, y: 0.23, w: 0.28, h: 0.34, tag: 'L-ARM' },
      { part: 'RIGHT_ARM', x: 0.72, y: 0.23, w: 0.28, h: 0.34, tag: 'R-ARM' },
      { part: 'TORSO', x: 0.30, y: 0.22, w: 0.40, h: 0.36, tag: 'PWR / BUS / CPU' },
      { part: 'LEFT_LEG', x: 0.30, y: 0.60, w: 0.19, h: 0.37, tag: 'L-LEG' },
      { part: 'RIGHT_LEG', x: 0.51, y: 0.60, w: 0.19, h: 0.37, tag: 'R-LEG' },
    ]
    this.bodyHotspots = []
    for (const region of regions) {
      const hit: Rect = {
        x: imageRect.x + imageRect.width * region.x,
        y: imageRect.y + imageRect.height * region.y,
        width: imageRect.width * region.w,
        height: imageRect.height * region.h,
      }
      this.bodyHotspots.push({ part: region.part, rect: hit })
      if (this.selectedPart === region.part) {
        ctx.save()
        ctx.strokeStyle = COLORS.borderBright
        ctx.fillStyle = 'rgba(120,255,150,0.09)'
        ctx.shadowColor = 'rgba(114,255,130,0.38)'
        ctx.shadowBlur = 8
        ctx.lineWidth = 2
        ctx.fillRect(hit.x, hit.y, hit.width, hit.height)
        ctx.strokeRect(hit.x + 1, hit.y + 1, Math.max(1, hit.width - 2), Math.max(1, hit.height - 2))
        ctx.restore()
      }
      // Small component tags are clipped to each body region to avoid crossing adjacent parts.
      ctx.save()
      ctx.beginPath()
      ctx.rect(hit.x, hit.y, hit.width, hit.height)
      ctx.clip()
      ctx.font = smallFont
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(4, 15, 8, 0.88)'
      const tagW = Math.min(hit.width, Math.max(36, ctx.measureText(region.tag).width + 8))
      const tagH = Math.max(12, Math.min(lineHeight * 0.8, hit.height * 0.38))
      const tx = hit.x + (hit.width - tagW) / 2
      const ty = hit.y + hit.height / 2 - tagH / 2
      ctx.fillRect(tx, ty, tagW, tagH)
      ctx.strokeStyle = statusColor(this.statusForPart(region.part))
      ctx.strokeRect(tx + 0.5, ty + 0.5, Math.max(1, tagW - 1), Math.max(1, tagH - 1))
      ctx.fillStyle = statusColor(this.statusForPart(region.part))
      ctx.fillText(this.fitText(ctx, region.tag, tagW - 5), tx + tagW / 2, ty + tagH / 2, tagW - 4)
      ctx.restore()
    }

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.textAlign = 'left'
    ctx.fillText(
      this.fitText(
        ctx,
        this.language === 'ru' ? 'ЩЁЛКНИТЕ ПО ЧАСТИ ТЕЛА — СПИСОК СЛЕВА ОТРЕАГИРУЕТ' : 'CLICK A BODY PART TO FILTER THE COMPONENT LIST',
        rect.width - pad * 2,
      ),
      rect.x + pad,
      hintY,
    )
  }

  private drawFallbackRobot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const cx = rect.x + rect.width / 2
    const headY = rect.y + rect.height * 0.12
    const torsoY = rect.y + rect.height * 0.30
    const torsoW = rect.width * 0.36
    const torsoH = rect.height * 0.29
    ctx.save()
    ctx.strokeStyle = COLORS.dim
    ctx.fillStyle = 'rgba(40,90,50,0.25)'
    ctx.lineWidth = Math.max(2, rect.width * 0.012)
    ctx.shadowColor = 'rgba(114,255,130,0.2)'
    ctx.shadowBlur = 5
    ctx.beginPath()
    ctx.ellipse(cx, headY + rect.height * 0.05, rect.width * 0.14, rect.height * 0.07, 0, 0, Math.PI * 2)
    ctx.fill(); ctx.stroke()
    ctx.fillRect(cx - torsoW / 2, torsoY, torsoW, torsoH)
    ctx.strokeRect(cx - torsoW / 2, torsoY, torsoW, torsoH)
    ctx.beginPath()
    ctx.moveTo(cx - torsoW / 2, torsoY + torsoH * 0.15)
    ctx.lineTo(cx - rect.width * 0.36, torsoY + torsoH * 0.2)
    ctx.lineTo(cx - rect.width * 0.42, rect.y + rect.height * 0.57)
    ctx.moveTo(cx + torsoW / 2, torsoY + torsoH * 0.15)
    ctx.lineTo(cx + rect.width * 0.36, torsoY + torsoH * 0.2)
    ctx.lineTo(cx + rect.width * 0.42, rect.y + rect.height * 0.57)
    ctx.moveTo(cx - torsoW * 0.28, torsoY + torsoH)
    ctx.lineTo(cx - torsoW * 0.32, rect.y + rect.height * 0.91)
    ctx.moveTo(cx + torsoW * 0.28, torsoY + torsoH)
    ctx.lineTo(cx + torsoW * 0.32, rect.y + rect.height * 0.91)
    ctx.stroke()
    ctx.restore()
  }

  private statusForPart(part: Exclude<BodyPart, 'ALL'>): RuntimeStatus {
    const ids = PARTS.find((item) => item.id === part)?.componentIds ?? []
    const components = this.robotSystem.listComponents().filter((item) => ids.includes(item.id))
    if (components.some((item) => toUiStatus(item.status) === 'damaged')) return 'CRITICAL'
    if (components.some((item) => toUiStatus(item.status) === 'disabled')) return 'OFFLINE'
    return 'ONLINE'
  }

  private drawDetailsAndActions(ctx: CanvasRenderingContext2D, rect: Rect, font: string, smallFont: string, lineHeight: number): void {
    this.drawPanel(ctx, rect, COLORS.panelAlt)
    const pad = 9
    const component = this.getSelectedComponent()
    const buttonHeight = Math.max(22, Math.min(lineHeight * 1.3, rect.height * 0.30))
    const buttonY = rect.y + rect.height - buttonHeight - 6
    const buttonGap = 8
    const innerButtonWidth = Math.max(0, rect.width - pad * 2 - buttonGap)
    // Derive both widths from the same available region so buttons never overlap,
    // even in a narrow browser window.
    const debugWidth = Math.floor(innerButtonWidth * 0.45)
    const powerWidth = innerButtonWidth - debugWidth
    const contentTop = rect.y + 6

    if (component) {
      ctx.font = font
      ctx.fillStyle = COLORS.bright
      const title = `${component.id} — ${component.name}`
      ctx.fillText(this.fitText(ctx, title, rect.width - pad * 2 - 140), rect.x + pad, contentTop)
      ctx.textAlign = 'right'
      ctx.fillStyle = statusColor(component.status)
      ctx.fillText(statusLabel(component.status, this.language), rect.x + rect.width - pad, contentTop)
      ctx.textAlign = 'left'

      ctx.font = smallFont
      ctx.fillStyle = this.message ? COLORS.yellow : COLORS.text
      const fault = this.message || component.fault || (this.language === 'ru' ? 'Активных ошибок нет.' : 'No active fault.')
      ctx.fillText(this.fitText(ctx, fault, rect.width - pad * 2), rect.x + pad, contentTop + lineHeight * 1.15)
      ctx.fillStyle = COLORS.dim
      const recommendation = component.recommendation || (this.language === 'ru' ? 'Рекомендаций нет.' : 'No recommendation.')
      ctx.fillText(this.fitText(ctx, recommendation, rect.width - pad * 2), rect.x + pad, contentTop + lineHeight * 2.05)
    } else {
      ctx.font = font
      ctx.fillStyle = COLORS.text
      ctx.fillText(this.language === 'ru' ? 'КОМПОНЕНТ НЕ ВЫБРАН' : 'NO COMPONENT SELECTED', rect.x + pad, contentTop)
    }

    const leftButton: Rect = { x: rect.x + pad, y: buttonY, width: debugWidth, height: buttonHeight }
    const powerButton: Rect = {
      x: leftButton.x + leftButton.width + buttonGap,
      y: buttonY,
      width: powerWidth,
      height: buttonHeight,
    }
    this.openButtonRect = leftButton
    this.powerButtonRect = powerButton

    this.drawButton(
      ctx,
      leftButton,
      this.language === 'ru' ? 'ЗАПУСТИТЬ ОТЛАДКУ' : 'OPEN DEBUG',
      COLORS.redDark,
      COLORS.redBright,
      true,
      smallFont,
    )
    this.drawButton(
      ctx,
      powerButton,
      this.language === 'ru' ? 'ПЕРЕРАСПРЕДЕЛИТЬ ПИТАНИЕ' : 'REDISTRIBUTE POWER',
      'rgba(55, 63, 18, 0.96)',
      COLORS.yellow,
      false,
      smallFont,
    )
  }

  private drawButton(ctx: CanvasRenderingContext2D, rect: Rect, label: string, fill: string, border: string, glow: boolean, font: string): void {
    ctx.save()
    ctx.fillStyle = fill
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = border
    ctx.lineWidth = 1.5
    if (glow) {
      ctx.shadowColor = 'rgba(255, 52, 72, 0.6)'
      ctx.shadowBlur = 10
    }
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
    ctx.shadowBlur = 0
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = COLORS.bright
    ctx.fillText(this.fitText(ctx, label, rect.width - 10), rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - 8)
    ctx.restore()
  }

  private handlePointer(x: number, y: number): void {
    if (this.openButtonRect && includesPoint(this.openButtonRect, x, y)) {
      this.openSelectedComponent()
      return
    }
    if (this.powerButtonRect && includesPoint(this.powerButtonRect, x, y)) {
      this.openPowerRedistribution()
      return
    }
    for (const row of this.componentRows) {
      if (!includesPoint(row.rect, x, y)) continue
      const index = this.visibleComponents.findIndex((item) => item.id === row.id)
      if (index >= 0) {
        this.selectedIndex = index
        this.message = ''
      }
      return
    }
    for (const hotspot of this.bodyHotspots) {
      if (!includesPoint(hotspot.rect, x, y)) continue
      this.selectPart(hotspot.part)
      return
    }
  }

  private openSelectedComponent(): void {
    const component = this.getSelectedComponent()
    if (!component) return
    if (!component.windowId) {
      this.message = this.language === 'ru'
        ? 'Для этого узла отдельная панель пока не подключена.'
        : 'No dedicated service panel is registered for this component yet.'
      return
    }
    try {
      // Check registration first so future analyzer/vision/cooling panels do not crash the UI.
      this.manager?.get(component.windowId)
      this.manager?.show(component.windowId)
    } catch {
      this.message = this.language === 'ru'
        ? `ПАНЕЛЬ ${component.windowId} ЕЩЁ НЕ ПОДКЛЮЧЕНА.`
        : `PANEL ${component.windowId} IS NOT REGISTERED YET.`
    }
  }

  private openPowerRedistribution(): void {
    try {
      this.manager?.get('powerDistribution')
      this.manager?.show('powerDistribution')
    } catch {
      this.message = this.language === 'ru'
        ? 'ПАНЕЛЬ ПЕРЕРАСПРЕДЕЛЕНИЯ ПИТАНИЯ НЕ ПОДКЛЮЧЕНА.'
        : 'POWER DISTRIBUTION PANEL IS NOT REGISTERED.'
    }
  }

  private drawPanel(ctx: CanvasRenderingContext2D, rect: Rect, fill = COLORS.panel): void {
    ctx.fillStyle = fill
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1))
  }

  private drawGlowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, glow: string, blur: number): void {
    ctx.save()
    ctx.font = font
    ctx.fillStyle = color
    ctx.shadowColor = glow
    ctx.shadowBlur = blur
    ctx.fillText(text, x, y)
    ctx.shadowBlur = 0
    ctx.restore()
  }

  private drawRule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
    if (width <= 0) return
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(Math.floor(x) + 0.5, Math.floor(y) + 0.5)
    ctx.lineTo(Math.floor(x + width) + 0.5, Math.floor(y) + 0.5)
    ctx.stroke()
  }

  private fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (maxWidth <= 0) return ''
    if (ctx.measureText(text).width <= maxWidth) return text
    let fitted = text
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1)
    return `${fitted}…`
  }
}
