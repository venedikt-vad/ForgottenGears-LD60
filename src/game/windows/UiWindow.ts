import { FONT_FAMILY } from '../fonts'
import { ImageDrawer } from '../ImageDrawer'
import { playSfx } from '../sfx'
import type { Input } from '../Input'
import type { RobotSystem, RuntimeComponent, RuntimeStatus } from '../Game'
import type { RobotData } from '../RobotData'
import { formatBytes } from '../VirtualFileSystem'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

type BodyPart = 'ALL' | 'HEAD' | 'LEFT_ARM' | 'RIGHT_ARM' | 'TORSO' | 'LEFT_LEG' | 'RIGHT_LEG'
type UiStatus = 'normal' | 'disabled' | 'damaged'
type Rect = { x: number; y: number; width: number; height: number }
type ComponentRow = { id: string; rect: Rect }
type BodyHotspot = { part: Exclude<BodyPart, 'ALL'>; rect: Rect }

const COLORS = {
  // The blurred glow layer sits below the game canvas and is only visible
  // through transparent pixels, so the windows never paint an opaque backdrop:
  // a full-screen tint would swallow the bloom completely (see #glow CSS).
  panel: 'rgba(7, 23, 13, 0.5)',
  panelAlt: 'rgba(12, 34, 19, 0.55)',
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
  redDark: 'rgba(142, 20, 34, 0.82)',
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

// Opening animation timings (seconds): panel borders scale from the center in
// all directions, rules and graphs stretch from start to end, text types itself
// in, then list items show up one after another.
const APPEAR_FRAME = 0.45
const APPEAR_RULE_START = 0.3
const APPEAR_RULE = 0.35
const APPEAR_TEXT_START = 0.35
const APPEAR_TEXT = 0.8
const APPEAR_ITEMS_START = 0.5
const APPEAR_ITEM_STAGGER = 0.05
const APPEAR_ITEM_ROW = 0.18
// Items past this one share the delay so long lists never drag the reveal out.
const APPEAR_ITEM_STAGGER_CAP = 12
const APPEAR_TOTAL = APPEAR_ITEMS_START + APPEAR_ITEM_STAGGER_CAP * APPEAR_ITEM_STAGGER + APPEAR_ITEM_ROW

// Damaged rows blink a red border: on for most of the period, brief pause.
const DAMAGE_BLINK_PERIOD = 0.9
const DAMAGE_BLINK_ON = 0.6

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/**
 * BIOS-style maintenance utility. The shared RobotSystem stays owned by Game.ts;
 * this window only reads it and asks WindowManager to open existing service windows.
 */
export class UiWindow implements GameWindow {
  readonly id = 'ui'

  private manager: WindowManager | null = null
  private readonly robotSystem: RobotSystem
  /** Read-model for shared robot data; falls back to the raw state when absent. */
  private readonly robotData: RobotData | null
  private language: GameLanguage = 'ru'
  private selectedPart: BodyPart = 'ALL'
  private selectedIndex = 0
  private scrollTop = 0
  private wasPointerDown = false
  private message = ''
  private appearTime = APPEAR_TOTAL
  private openedThisFrame = false
  private blinkClock = 0

  private bodyImg: ImageDrawer | null = null
  private readonly schemeImage = new Image()

  private componentRows: ComponentRow[] = []
  private bodyHotspots: BodyHotspot[] = []
  private openButtonRect: Rect | null = null
  private powerButtonRect: Rect | null = null
  private visibleComponents: RuntimeComponent[] = []

  // Rolling history samples for continuous line graphs (up to 40 samples each)
  private readonly stabilityHistory: number[] = []
  private readonly powerHistory: number[] = []
  private historyTimer = 0

  constructor(robotSystem: RobotSystem, robotData: RobotData | null = null) {
    this.robotSystem = robotSystem
    this.robotData = robotData
    this.robotSystem = robotSystem
    this.schemeImage.src = `${import.meta.env.BASE_URL}robot_scheme/scheme_01.png`
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  /** Live component list; the shared RobotData read-model is preferred when wired. */
  private components(): RuntimeComponent[] {
    return this.robotData?.listComponents() ?? this.robotSystem.listComponents()
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.wasPointerDown = false
    // Replay the appear animation each time the window is opened.
    this.appearTime = 0
    this.openedThisFrame = true
    this.bodyImg = new ImageDrawer({
      image: this.schemeImage,
      beginTime: performance.now(),
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
    })

    // Select the first visible component that needs attention, if there is one.
    this.visibleComponents = this.getFilteredComponents()
    const firstProblem = this.visibleComponents.findIndex(
      (item) => toUiStatus(this.effectiveStatus(item)) !== 'normal',
    )
    this.selectedIndex = firstProblem >= 0 ? firstProblem : (this.visibleComponents.length > 0 ? 0 : -1)
    this.scrollTop = 0
    this.message = ''
  }

  update(dt: number, input: Input): void {
    this.appearTime += dt
    this.blinkClock += dt

    // Accumulate history data points over time.
    this.historyTimer += dt
    if (this.historyTimer >= 0.15) {
      this.historyTimer = 0

      const reactorWin = this.manager?.get('reactor') as unknown as { solved?: boolean; computeStability?: () => number } | undefined
      const stability = typeof reactorWin?.computeStability === 'function'
        ? reactorWin.computeStability()
        : (this.robotSystem.reactorRestored ? 1 : 0.3)

      const powerWin = this.manager?.get('powerDistribution') as unknown as { powerConsumption?: number } | undefined
      const powerConsumption = typeof powerWin?.powerConsumption === 'number'
        ? powerWin.powerConsumption
        : (this.robotSystem.powerGridPuzzleSolved ? 0.9 : 0.3)

      this.stabilityHistory.push(stability)
      if (this.stabilityHistory.length > 40) this.stabilityHistory.shift()

      this.powerHistory.push(powerConsumption)
      if (this.powerHistory.length > 40) this.powerHistory.shift()
    }

    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('console')
      return
    }

    const keyEvents = input.getPressedKeyEvents()
    const down = input.isPointerDown()

    // Input is locked while the opening animation plays. Any later key or click
    // skips it; the input that opened the window cannot skip its own animation.
    if (this.appearTime < APPEAR_TOTAL) {
      if (down && !this.wasPointerDown) this.appearTime = APPEAR_TOTAL
      else if (!this.openedThisFrame && keyEvents.length) this.appearTime = APPEAR_TOTAL
      this.openedThisFrame = false
      this.wasPointerDown = down
      return
    }
    this.openedThisFrame = false

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
    if (input.wasPressed('KeyT')) this.manager?.show('tasks')

    if (down && !this.wasPointerDown) {
      const p = input.pointerPosition
      this.handlePointer(p.x, p.y)
    }
    this.wasPointerDown = down
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.clearRect(0, 0, width, height)
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
      this.written(this.language === 'ru' ? 'УТИЛИТА ОБСЛУЖИВАНИЯ РОБОТА' : 'ROBOT MAINTENANCE UTILITY'),
      margin,
      margin,
      titleFont,
      COLORS.bright,
      'rgba(114, 255, 98, 0.36)',
      5,
    )

    const counts = this.getUiCounts()
    let countText = this.language === 'ru'
      ? `В НОРМЕ ${counts.normal}   ОТКЛЮЧЕНО ${counts.disabled}   ПОВРЕЖДЕНО ${counts.damaged}`
      : `NORMAL ${counts.normal}   DISABLED ${counts.disabled}   DAMAGED ${counts.damaged}`
    const storage = this.robotData?.getStorage()
    if (storage) {
      countText += this.language === 'ru'
        ? `   ДАННЫЕ ${formatBytes(storage.usedBytes, this.language)}`
        : `   DATA ${formatBytes(storage.usedBytes, this.language)}`
    }
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText(this.written('SERVICE MODE / LIVE COMPONENT STATE'), margin, margin + lineHeight * 1.25)

    const compactHeader = width < 720
    if (compactHeader) {
      ctx.fillStyle = COLORS.text
      ctx.fillText(this.fitText(ctx, this.written(countText), width - margin * 2), margin, margin + lineHeight * 2.05)
    } else {
      ctx.textAlign = 'right'
      ctx.fillStyle = COLORS.text
      ctx.fillText(this.fitText(ctx, this.written(countText), Math.max(80, width * 0.52)), width - margin, margin + lineHeight * 1.25)
      ctx.textAlign = 'left'
    }

    const ruleY = margin + lineHeight * (compactHeader ? 3.0 : 2.3)
    this.drawRule(ctx, margin, ruleY, width - margin * 2)

    const contentY = ruleY + 8
    const availableWidth = Math.max(0, width - margin * 2)
    const compactFooter = width < 680
    const hintHeight = lineHeight + 4
    const detailsHeight = compactFooter
      ? Math.max(4 * lineHeight + 14, 74)
      : Math.max(4.4 * lineHeight + 8, 72)
    const powerHeight = compactFooter
      ? Math.max(2.5 * lineHeight + 12, 54)
      : detailsHeight
    const footerHeight = compactFooter
      ? detailsHeight + 8 + powerHeight
      : detailsHeight
    const footerY = height - margin - hintHeight - footerHeight
    const mainHeight = Math.max(100, footerY - contentY - 9)
    const showDiagram = width >= 780 && mainHeight >= 220
    const gap = showDiagram ? 12 : 0
    const diagramWidth = showDiagram ? Math.min(availableWidth * 0.39, 470) : 0
    const listWidth = Math.max(0, availableWidth - diagramWidth - gap)

    this.visibleComponents = this.getFilteredComponents()
    this.clampSelection()

    const listRect: Rect = { x: margin, y: contentY, width: listWidth, height: mainHeight }
    this.drawComponentTable(ctx, listRect, font, smallFont, titleFont, fontSize, lineHeight)

    this.bodyHotspots = []
    if (showDiagram) {
      // Tall power button under the schematic image.
      const powerButtonHeight = Math.max(30, lineHeight * 1.7)
      const diagramRect: Rect = {
        x: margin + listWidth + gap,
        y: contentY,
        width: diagramWidth,
        height: Math.max(120, mainHeight - powerButtonHeight - 10),
      }
      this.drawBodyDiagram(ctx, diagramRect, font, smallFont, lineHeight)

      const powerButton: Rect = {
        x: diagramRect.x,
        y: contentY + mainHeight - powerButtonHeight,
        width: diagramWidth,
        height: powerButtonHeight,
      }
      this.powerButtonRect = powerButton
      this.drawButton(
        ctx,
        powerButton,
        this.language === 'ru' ? 'ПЕРЕРАСПРЕДЕЛИТЬ ПИТАНИЕ' : 'REDISTRIBUTE POWER',
        'rgba(55, 63, 18, 0.78)',
        COLORS.yellow,
        false,
        font,
      )
    }

    let detailsRect: Rect
    let powerRect: Rect | null = null

    if (compactFooter) {
      // Narrow layout: details and power controls use their own stacked panels.
      detailsRect = {
        x: margin,
        y: footerY,
        width: availableWidth,
        height: detailsHeight,
      }
      powerRect = {
        x: margin,
        y: footerY + detailsHeight + 8,
        width: availableWidth,
        height: powerHeight,
      }
    } else if (showDiagram) {
      // With the body image on screen the power button lives under the schematic.
      detailsRect = {
        x: margin,
        y: footerY,
        width: availableWidth,
        height: footerHeight,
      }
    } else {
      // Wide layout without the image: the power panel sits to the right.
      const footerGap = 10
      const powerWidth = Math.min(250, Math.max(190, Math.floor(availableWidth * 0.28)))
      const detailsWidth = Math.max(0, availableWidth - powerWidth - footerGap)
      detailsRect = {
        x: margin,
        y: footerY,
        width: detailsWidth,
        height: footerHeight,
      }
      powerRect = {
        x: margin + detailsWidth + footerGap,
        y: footerY,
        width: powerWidth,
        height: footerHeight,
      }
    }

    this.drawDetailsAndActions(ctx, detailsRect, font, smallFont, lineHeight)
    if (powerRect) this.drawPowerPanel(ctx, powerRect, font, smallFont, lineHeight)

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    const footerHelp = this.language === 'ru'
      ? '1–6: ЧАСТЬ ТЕЛА  ·  0: ВСЕ  ·  ↑/↓: КОМПОНЕНТ  ·  ENTER: ОТЛАДКА  ·  P: ПИТАНИЕ  ·  T: ДИСПЕТЧЕР  ·  ESC: КОНСОЛЬ'
      : '1–6: BODY PART  ·  0: ALL  ·  ↑/↓: COMPONENT  ·  ENTER: DEBUG  ·  P: POWER  ·  T: TASKS  ·  ESC: CONSOLE'
    ctx.fillText(this.fitText(ctx, this.written(footerHelp), width - margin * 2), margin, height - margin - lineHeight)

    ctx.restore()
  }

  /**
   * A component is shown if it is healthy or it has a registered service/minigame window.
   * A missing window ID, or an ID not registered in WindowManager, does not qualify.
   */
  private hasRegisteredMinigame(component: RuntimeComponent): boolean {
    if (!component.windowId || !this.manager) return false

    try {
      return Boolean(this.manager.get(component.windowId))
    } catch {
      return false
    }
  }

  /** Win-condition components read NORMAL once their puzzle is solved. */
  private effectiveStatus(component: RuntimeComponent): RuntimeStatus {
    if (!this.isWinConditionMet(component)) return component.status
    return 'ONLINE'
  }

  private isWinConditionMet(component: RuntimeComponent): boolean {
    const windowId = component.windowId
    if (!windowId || !this.manager) return false
    // The motion profile reports through robotSystem, not a window flag.
    if (windowId === 'editor') return this.robotSystem.motionProfileRestored
    try {
      const target = this.manager.get(windowId) as unknown as { solved?: boolean; isSolved?: boolean }
      return Boolean(target.solved ?? target.isSolved)
    } catch {
      return false
    }
  }

  private getFilteredComponents(): RuntimeComponent[] {
    const components = this.components().filter((component) => {
      const isNormal = toUiStatus(this.effectiveStatus(component)) === 'normal'
      return isNormal || this.hasRegisteredMinigame(component)
    })

    if (this.selectedPart === 'ALL') return components
    const ids = PARTS.find((part) => part.id === this.selectedPart)?.componentIds ?? []
    return components.filter((component) => ids.includes(component.id))
  }

  private getSelectedComponent(): RuntimeComponent | undefined {
    if (this.selectedIndex < 0) return undefined
    return this.visibleComponents[this.selectedIndex]
  }

  private clampSelection(): void {
    if (this.visibleComponents.length === 0) {
      this.selectedIndex = -1
      this.scrollTop = 0
      return
    }
    this.selectedIndex = Math.max(0, Math.min(this.visibleComponents.length - 1, this.selectedIndex))
  }

  private selectPart(part: BodyPart): void {
    if (part !== this.selectedPart) playSfx('selection')
    this.selectedPart = part
    this.scrollTop = 0
    this.visibleComponents = this.getFilteredComponents()

    const firstProblem = this.visibleComponents.findIndex(
      (component) => toUiStatus(this.effectiveStatus(component)) !== 'normal',
    )
    this.selectedIndex = firstProblem >= 0
      ? firstProblem
      : (this.visibleComponents.length > 0 ? 0 : -1)
    this.message = ''
  }

  private moveSelection(amount: number): void {
    const components = this.getFilteredComponents()
    if (components.length === 0) {
      this.selectedIndex = -1
      return
    }
    const currentIndex = this.selectedIndex < 0 ? 0 : this.selectedIndex
    const next = Math.max(0, Math.min(components.length - 1, currentIndex + amount))
    if (next !== this.selectedIndex) playSfx('selection')
    this.selectedIndex = next
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
    for (const item of this.components()) counts[toUiStatus(this.effectiveStatus(item))] += 1
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
    ctx.fillText(this.written(this.language === 'ru' ? 'РЕЕСТР КОМПОНЕНТОВ' : 'COMPONENT REGISTRY'), rect.x + pad, titleY)

    const partTitle = this.selectedPart === 'ALL'
      ? (this.language === 'ru' ? 'ВСЕ ПОДСИСТЕМЫ' : 'ALL SUBSYSTEMS')
      : (PARTS.find((part) => part.id === this.selectedPart)?.title[this.language] ?? this.selectedPart)
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.fillText(this.fitText(ctx, this.written(partTitle), rect.width - pad * 2), rect.x + pad, titleY + lineHeight * 1.2)

    const tableHeaderY = titleY + lineHeight * 2.15
    this.drawRule(ctx, rect.x + pad, tableHeaderY - 3, rect.width - pad * 2, 0.1)
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    const idX = rect.x + pad
    const nameX = rect.x + pad + Math.min(91, Math.max(68, rect.width * 0.19))
    const statusW = Math.min(92, Math.max(72, rect.width * 0.21))
    const statusX = rect.x + rect.width - pad - statusW
    ctx.fillText(this.written('ID'), idX, tableHeaderY + 2)
    ctx.fillText(this.written(this.language === 'ru' ? 'КОМПОНЕНТ' : 'COMPONENT'), nameX, tableHeaderY + 2)
    ctx.textAlign = 'right'
    ctx.fillText(this.written(this.language === 'ru' ? 'СОСТОЯНИЕ' : 'STATE'), rect.x + rect.width - pad, tableHeaderY + 2)
    ctx.textAlign = 'left'

    const rowsTop = tableHeaderY + lineHeight * 1.05
    const graphPanelHeight = 72
    const graphsGap = 8
    // Tall debug button strip spanning the graphs section.
    const debugButtonHeight = Math.max(30, lineHeight * 1.7)
    const graphsSectionHeight = debugButtonHeight + graphsGap + graphPanelHeight * 2 + graphsGap
    const rowsBottom = rect.y + rect.height - graphsSectionHeight - graphsGap - 7
    const rowHeight = Math.max(15, Math.min(lineHeight * 1.15, (rowsBottom - rowsTop) / 5.5))
    const visibleRows = Math.max(1, Math.floor((rowsBottom - rowsTop) / rowHeight))

    if (this.selectedIndex >= 0 && this.selectedIndex < this.scrollTop) this.scrollTop = this.selectedIndex
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

      // Rows fade and slide in one after another while the window opens.
      const rowProgress = this.itemProgress(row)
      if (rowProgress <= 0) continue

      ctx.save()
      ctx.globalAlpha = rowProgress
      ctx.translate((rowProgress - 1) * 10, 0)

      if (index === this.selectedIndex) {
        ctx.fillStyle = COLORS.selected
        ctx.fillRect(rowRect.x, rowRect.y, rowRect.width, rowRect.height)
        ctx.strokeStyle = COLORS.borderBright
        ctx.strokeRect(rowRect.x + 0.5, rowRect.y + 0.5, rowRect.width - 1, rowRect.height - 1)
      }

      // Damaged entries draw a red border that blinks on and off.
      if (
        toUiStatus(this.effectiveStatus(component)) === 'damaged' &&
        this.blinkClock % DAMAGE_BLINK_PERIOD < DAMAGE_BLINK_ON
      ) {
        ctx.save()
        ctx.strokeStyle = COLORS.redBright
        ctx.lineWidth = 1.5
        ctx.shadowColor = 'rgba(255, 52, 72, 0.7)'
        ctx.shadowBlur = 6
        ctx.strokeRect(rowRect.x + 0.5, rowRect.y + 0.5, rowRect.width - 1, rowRect.height - 1)
        ctx.restore()
      }

      ctx.font = font
      ctx.fillStyle = index === this.selectedIndex ? COLORS.bright : COLORS.text
      ctx.fillText(component.id, idX, y + Math.max(0, (rowHeight - fontSize) / 2), Math.max(35, nameX - idX - 6))

      const nameWidth = Math.max(25, statusX - nameX - 8)
      ctx.fillStyle = index === this.selectedIndex ? COLORS.bright : COLORS.text
      ctx.fillText(this.fitText(ctx, component.name, nameWidth), nameX, y + Math.max(0, (rowHeight - fontSize) / 2), nameWidth)

      ctx.font = smallFont
      ctx.textAlign = 'right'
      ctx.fillStyle = statusColor(this.effectiveStatus(component))
      ctx.fillText(statusLabel(this.effectiveStatus(component), this.language), rect.x + rect.width - pad, y + Math.max(0, (rowHeight - fontSize) / 2), statusW)
      ctx.textAlign = 'left'
      ctx.restore()
    }
    ctx.restore()

    if (this.visibleComponents.length > visibleRows) {
      ctx.font = smallFont
      ctx.fillStyle = COLORS.dim
      ctx.textAlign = 'right'
      ctx.fillText(this.written(`${this.scrollTop + 1}-${Math.min(this.scrollTop + visibleRows, this.visibleComponents.length)}/${this.visibleComponents.length}`), rect.x + rect.width - pad, rect.y + rect.height - graphsSectionHeight - graphsGap - lineHeight * 0.8)
      ctx.textAlign = 'left'
    }

    // Stack the power distribution graph above reactor stability, and place
    // the recovery checklist in a column to their right.
    const graphsY = rowsBottom + graphsGap
    const graphsWidth = Math.max(0, rect.width - pad * 2)
    const columnGap = 8
    const graphColumnWidth = Math.floor((graphsWidth - columnGap) / 2)
    const graphX = rect.x + pad
    const checklistX = graphX + graphColumnWidth + columnGap
    const checklistWidth = Math.max(0, graphsWidth - graphColumnWidth - columnGap)
    const graphsTop = graphsY + debugButtonHeight + graphsGap
    const graphsBlockHeight = graphPanelHeight * 2 + graphsGap

    // Tall debug button on top of the graphs, spanning the whole section.
    // Hidden (and unclickable) while the selected component is healthy.
    this.openButtonRect = null
    const selected = this.getSelectedComponent()
    if (selected && toUiStatus(this.effectiveStatus(selected)) !== 'normal') {
      const debugButton: Rect = { x: graphX, y: graphsY, width: graphsWidth, height: debugButtonHeight }
      this.openButtonRect = debugButton
      this.drawButton(
        ctx,
        debugButton,
        this.language === 'ru' ? 'ЗАПУСТИТЬ ОТЛАДКУ' : 'OPEN DEBUG',
        COLORS.redDark,
        COLORS.redBright,
        true,
        smallFont,
      )
    }

    const reactorWin = this.manager?.get('reactor') as unknown as { solved?: boolean; computeStability?: () => number } | undefined
    const currentStability = typeof reactorWin?.computeStability === 'function'
      ? reactorWin.computeStability()
      : (this.robotSystem.reactorRestored ? 1 : 0.3)

    const powerWin = this.manager?.get('powerDistribution') as unknown as { powerConsumption?: number; powerOverCapacity?: boolean } | undefined
    const currentPower = typeof powerWin?.powerConsumption === 'number'
      ? powerWin.powerConsumption
      : (this.robotSystem.powerGridPuzzleSolved ? 0.9 : 0.3)
    const overCapacity = powerWin?.powerOverCapacity ?? (currentPower >= 1)

    if (this.stabilityHistory.length === 0) this.stabilityHistory.push(currentStability)
    if (this.powerHistory.length === 0) this.powerHistory.push(currentPower)

    const drawLineGraph = (
      subX: number,
      subY: number,
      subW: number,
      subH: number,
      title: string,
      history: number[],
      currentVal: number,
      isDanger: boolean,
    ) => {
      if (subW <= 0 || subH <= 0) return
      this.drawPanel(ctx, { x: subX, y: subY, width: subW, height: subH }, COLORS.panelAlt)

      ctx.save()
      ctx.globalAlpha = this.textProgress
      ctx.font = smallFont
      ctx.fillStyle = COLORS.dim
      ctx.fillText(this.fitText(ctx, title, subW - 36), subX + 6, subY + 4)

      ctx.textAlign = 'right'
      ctx.fillStyle = isDanger ? COLORS.redBright : COLORS.bright
      ctx.fillText(`${Math.round(Math.max(0, Math.min(1, currentVal)) * 100)}%`, subX + subW - 6, subY + 4)
      ctx.textAlign = 'left'
      ctx.restore()

      const plotX = subX + 6
      const plotY = subY + 18
      const plotW = subW - 12
      const plotH = subH - 22
      if (plotW <= 0 || plotH <= 0) return

      // The plot stretches open from the start toward the end while opening.
      const stretch = clamp01((this.appearTime - APPEAR_RULE_START) / APPEAR_RULE)
      if (stretch <= 0) return

      ctx.save()
      ctx.beginPath()
      ctx.rect(plotX, plotY, plotW * stretch, plotH)
      ctx.clip()

      ctx.strokeStyle = COLORS.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(plotX, plotY + plotH / 2)
      ctx.lineTo(plotX + plotW, plotY + plotH / 2)
      ctx.stroke()

      if (history.length >= 2) {
        ctx.strokeStyle = isDanger ? COLORS.redBright : COLORS.green
        ctx.lineWidth = 1.5
        ctx.beginPath()
        const step = plotW / Math.max(1, history.length - 1)
        for (let i = 0; i < history.length; i += 1) {
          const val = Math.max(0, Math.min(1, history[i]))
          const hx = plotX + i * step
          const hy = plotY + plotH - val * plotH
          if (i === 0) ctx.moveTo(hx, hy)
          else ctx.lineTo(hx, hy)
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    const powerTitle = this.language === 'ru' ? 'РАСПРЕДЕЛЕНИЕ ЭНЕРГИИ' : 'POWER DISTRIBUTION'
    const stabTitle = this.language === 'ru' ? 'СТАБИЛЬНОСТЬ РЕАКТОРА' : 'REACTOR STABILITY'

    // Power distribution is intentionally above reactor stability.
    drawLineGraph(
      graphX,
      graphsTop,
      graphColumnWidth,
      graphPanelHeight,
      powerTitle,
      this.powerHistory,
      currentPower,
      overCapacity,
    )
    drawLineGraph(
      graphX,
      graphsTop + graphPanelHeight + graphsGap,
      graphColumnWidth,
      graphPanelHeight,
      stabTitle,
      this.stabilityHistory,
      currentStability,
      currentStability < 0.5,
    )

    this.drawRecoveryChecklist(
      ctx,
      {
        x: checklistX,
        y: graphsTop,
        width: checklistWidth,
        height: graphsBlockHeight,
      },
      font,
      lineHeight,
    )
  }

  private drawRecoveryChecklist(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    font: string,
    lineHeight: number,
  ): void {
    this.drawPanel(ctx, rect, COLORS.panelAlt)

    const pad = 7
    const checklist = this.getChecklist()
    const tasks = checklist.map((task, index) => `${index + 1}. ${task.label}`)

    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2))
    ctx.clip()

    ctx.font = font
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = COLORS.text
    const heading = this.language === 'ru' ? 'СДЕЛАТЬ:' : 'TODO:'
    ctx.fillText(this.written(this.fitText(ctx, heading, rect.width - pad * 2)), rect.x + pad, rect.y + 6)

    const contentWidth = Math.max(1, rect.width - pad * 2)
    const longestTask = Math.max(...tasks.map((task) => task.length))
    // Keep every task visible even when the component registry becomes narrow.
    const taskFontSize = Math.max(5, Math.min(12, contentWidth / (longestTask * 0.62)))
    ctx.font = `${taskFontSize}px "${FONT_FAMILY}", monospace`
    ctx.fillStyle = COLORS.bright

    const titleHeight = Math.max(14, lineHeight * 0.95)
    const taskAreaHeight = Math.max(0, rect.height - titleHeight - 10)
    const taskLineHeight = Math.min(
      Math.max(taskFontSize + 2, 8),
      taskAreaHeight / tasks.length,
    )

    tasks.forEach((task, index) => {
      // Checklist items show up one after another while the window opens.
      const itemProgress = this.itemProgress(index)
      if (itemProgress <= 0) return
      const y = rect.y + titleHeight + index * taskLineHeight
      ctx.save()
      ctx.globalAlpha = itemProgress
      // Tasks whose puzzle is solved read green.
      ctx.fillStyle = checklist[index].done ? COLORS.green : COLORS.bright
      ctx.fillText(task, rect.x + pad, y, contentWidth)
      ctx.restore()
    })

    ctx.restore()
  }

  /**
   * Recovery checklist in panel order with live win state. The console `start`
   * command gates on this exact list, so both screens always agree.
   */
  getChecklist(manager?: WindowManager | null): { label: string; done: boolean }[] {
    const labels = this.language === 'ru'
      ? [
          'Починить реактор',
          'Подать питание на компоненты движения',
          'Восстановить обход шины',
          'Починить память',
          'Починить алгоритм',
          'Запустить робота: введите \'start\' в консоли',
        ]
      : [
          'Repair the reactor',
          'Power motion components',
          'Restore the bus bypass',
          'Repair memory',
          'Repair the algorithm',
          'Type \'start\' in console to start the robot',
        ]
    const done = this.checklistDone(manager)
    // The final row is a hint: it lights up once every repair is finished.
    const flags = [...done, done.every(Boolean)]
    return labels.map((label, index) => ({ label, done: flags[index] ?? false }))
  }

  /** Live win state for each recovery task, read from the matching puzzle window. */
  private checklistDone(manager?: WindowManager | null): boolean[] {
    // The console queries this list while UiWindow is inactive; fall back to the
    // caller's manager when this window has not been shown yet.
    const windows = manager ?? this.manager
    const reactor = windows?.get('reactor') as unknown as { solved?: boolean } | undefined
    const power = windows?.get('powerDistribution') as unknown as { solved?: boolean } | undefined
    const maze = windows?.get('maze') as unknown as { isSolved?: boolean } | undefined
    const memory = windows?.get('memoryCore') as unknown as { isSolved?: boolean } | undefined
    return [
      reactor?.solved ?? false,
      power?.solved ?? false,
      maze?.isSolved ?? false,
      memory?.isSolved ?? false,
      this.robotSystem.motionProfileRestored,
    ]
  }

  private drawBodyDiagram(ctx: CanvasRenderingContext2D, rect: Rect, font: string, smallFont: string, lineHeight: number): void {
    this.drawPanel(ctx, rect)
    const pad = 9
    ctx.font = font
    ctx.fillStyle = COLORS.text
    ctx.fillText(this.written(this.language === 'ru' ? 'СХЕМА КОРПУСА' : 'BODY SCHEMATIC'), rect.x + pad, rect.y + 7)

    // The schematic itself fades in with the written text.
    ctx.save()
    ctx.globalAlpha = this.textProgress

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
      // Clip labels to their region so they don't cross adjacent body parts.
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
        this.written(this.language === 'ru' ? 'ЩЁЛКНИТЕ ПО ЧАСТИ ТЕЛА — СПИСОК СЛЕВА ОТРЕАГИРУЕТ' : 'CLICK A BODY PART TO FILTER THE COMPONENT LIST'),
        rect.width - pad * 2,
      ),
      rect.x + pad,
      hintY,
    )

    ctx.restore()
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
    ctx.fill()
    ctx.stroke()
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
    const components = this.components().filter((item) => ids.includes(item.id))
    if (components.some((item) => toUiStatus(this.effectiveStatus(item)) === 'damaged')) return 'CRITICAL'
    if (components.some((item) => toUiStatus(this.effectiveStatus(item)) === 'disabled')) return 'OFFLINE'
    return 'ONLINE'
  }

  private drawDetailsAndActions(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    font: string,
    smallFont: string,
    lineHeight: number,
  ): void {
    this.drawPanel(ctx, rect, COLORS.panelAlt)

    const pad = 9
    const component = this.getSelectedComponent()
    const contentTop = rect.y + 6

    if (!component) {
      ctx.font = font
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = COLORS.text
      ctx.fillText(
        this.written(this.language === 'ru' ? 'КОМПОНЕНТ НЕ ВЫБРАН' : 'NO COMPONENT SELECTED'),
        rect.x + pad,
        contentTop,
      )
      return
    }

    ctx.font = font
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = COLORS.bright
    const title = `${component.id} — ${component.name}`
    ctx.fillText(this.fitText(ctx, this.written(title), rect.width - pad * 2 - 140), rect.x + pad, contentTop)

    ctx.textAlign = 'right'
    ctx.fillStyle = statusColor(this.effectiveStatus(component))
    ctx.fillText(this.written(statusLabel(this.effectiveStatus(component), this.language)), rect.x + rect.width - pad, contentTop)
    ctx.textAlign = 'left'

    ctx.font = smallFont
    ctx.fillStyle = this.message ? COLORS.yellow : COLORS.text
    const fault = this.message || component.fault || (this.language === 'ru' ? 'Активных ошибок нет.' : 'No active fault.')
    ctx.fillText(this.fitText(ctx, this.written(fault), rect.width - pad * 2), rect.x + pad, contentTop + lineHeight * 1.15)

    ctx.fillStyle = COLORS.dim
    const recommendation = component.recommendation || (this.language === 'ru' ? 'Рекомендаций нет.' : 'No recommendation.')
    ctx.fillText(this.fitText(ctx, this.written(recommendation), rect.width - pad * 2), rect.x + pad, contentTop + lineHeight * 2.05)
  }

  private drawPowerPanel(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    font: string,
    smallFont: string,
    lineHeight: number,
  ): void {
    this.drawPanel(ctx, rect, COLORS.panelAlt)
    const pad = 9

    ctx.font = font
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = COLORS.text
    ctx.fillText(
      this.fitText(
        ctx,
        this.language === 'ru' ? 'УПРАВЛЕНИЕ ПИТАНИЕМ' : 'POWER DISTRIBUTION',
        rect.width - pad * 2,
      ),
      rect.x + pad,
      rect.y + 7,
    )

    const buttonHeight = Math.max(28, rect.height - lineHeight * 1.2 - 12)
    const powerButton: Rect = {
      x: rect.x + pad,
      y: rect.y + rect.height - buttonHeight - 6,
      width: Math.max(0, rect.width - pad * 2),
      height: buttonHeight,
    }

    this.powerButtonRect = powerButton
    this.drawButton(
      ctx,
      powerButton,
      this.language === 'ru' ? 'ПЕРЕРАСПРЕДЕЛИТЬ ПИТАНИЕ' : 'REDISTRIBUTE POWER',
      'rgba(55, 63, 18, 0.78)',
      COLORS.yellow,
      false,
      smallFont,
    )
  }

  private drawButton(ctx: CanvasRenderingContext2D, rect: Rect, label: string, fill: string, border: string, glow: boolean, font: string): void {
    // Buttons fade in together with the panel borders around them.
    const appear = easeOut(clamp01(this.appearTime / APPEAR_FRAME))
    if (rect.width <= 0 || rect.height <= 0 || appear <= 0) return
    ctx.save()
    ctx.globalAlpha = appear
    ctx.fillStyle = fill
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = border
    ctx.lineWidth = 1.5
    if (glow) {
      ctx.shadowColor = 'rgba(255, 52, 72, 0.6)'
      ctx.shadowBlur = 10
    }
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1))
    ctx.shadowBlur = 0
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = COLORS.bright

    // Keep the complete button label visible. If it is too wide, reduce the
    // font size instead of truncating it with fitText(...).
    const maxTextWidth = Math.max(0, rect.width - 12)
    const measuredTextWidth = ctx.measureText(label).width
    const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/)
    if (measuredTextWidth > maxTextWidth && maxTextWidth > 0 && fontSizeMatch) {
      const currentFontSize = Number(fontSizeMatch[1])
      const fittedFontSize = Math.max(7, currentFontSize * maxTextWidth / measuredTextWidth)
      ctx.font = font.replace(fontSizeMatch[0], `${fittedFontSize.toFixed(2)}px`)
    }

    // Canvas applies horizontal scaling only as a last resort for very narrow
    // buttons; the full label is still drawn and never replaced by an ellipsis.
    ctx.fillText(
      label,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      maxTextWidth,
    )
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
        if (index !== this.selectedIndex) playSfx('selection')
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
      const target = this.manager?.get(component.windowId)
      if (!target) throw new Error(`Window "${component.windowId}" is not registered`)
      this.manager?.show(component.windowId)
    } catch {
      this.message = this.language === 'ru'
        ? `ПАНЕЛЬ ${component.windowId} ЕЩЁ НЕ ПОДКЛЮЧЕНА.`
        : `PANEL ${component.windowId} IS NOT REGISTERED YET.`
    }
  }

  private openPowerRedistribution(): void {
    try {
      const target = this.manager?.get('powerDistribution')
      if (!target) throw new Error('Power distribution window is not registered')
      this.manager?.show('powerDistribution')
    } catch {
      this.message = this.language === 'ru'
        ? 'ПАНЕЛЬ ПЕРЕРАСПРЕДЕЛЕНИЯ ПИТАНИЯ НЕ ПОДКЛЮЧЕНА.'
        : 'POWER DISTRIBUTION PANEL IS NOT REGISTERED.'
    }
  }

  private drawPanel(ctx: CanvasRenderingContext2D, rect: Rect, fill = COLORS.panel): void {
    // While the window opens the border scales from the center in all directions.
    const progress = easeOut(clamp01(this.appearTime / APPEAR_FRAME))
    if (rect.width <= 0 || rect.height <= 0 || progress <= 0) return

    const drawnWidth = rect.width * progress
    const drawnHeight = rect.height * progress
    const x = rect.x + (rect.width - drawnWidth) / 2
    const y = rect.y + (rect.height - drawnHeight) / 2

    ctx.save()
    ctx.globalAlpha = progress
    ctx.fillStyle = fill
    ctx.fillRect(x, y, drawnWidth, drawnHeight)
    ctx.strokeStyle = progress >= 1 ? COLORS.border : COLORS.borderBright
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, drawnWidth - 1), Math.max(0, drawnHeight - 1))
    ctx.restore()
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

  private drawRule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, delay = 0): void {
    // While the window opens the rule stretches from its start toward its end.
    const progress = clamp01((this.appearTime - APPEAR_RULE_START - delay) / APPEAR_RULE)
    if (width <= 0 || progress <= 0) return
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(Math.floor(x) + 0.5, Math.floor(y) + 0.5)
    ctx.lineTo(Math.floor(x + width * progress) + 0.5, Math.floor(y) + 0.5)
    ctx.stroke()
  }

  private fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (maxWidth <= 0) return ''
    if (ctx.measureText(text).width <= maxWidth) return text
    let fitted = text
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1)
    return `${fitted}…`
  }

  /** 0..1 reveal progress for the opening typewriter. */
  private get textProgress(): number {
    return clamp01((this.appearTime - APPEAR_TEXT_START) / APPEAR_TEXT)
  }

  /** 0..1 reveal progress of a list item whose staggered delay has just elapsed. */
  private itemProgress(index: number): number {
    const delay = Math.min(index, APPEAR_ITEM_STAGGER_CAP) * APPEAR_ITEM_STAGGER
    return easeOut(clamp01((this.appearTime - APPEAR_ITEMS_START - delay) / APPEAR_ITEM_ROW))
  }

  /** Text revealed by the opening typewriter: a growing fraction of its length. */
  private written(text: string): string {
    const progress = this.textProgress
    if (progress >= 1) return text
    if (progress <= 0) return ''
    return text.slice(0, Math.ceil(text.length * progress))
  }
}
