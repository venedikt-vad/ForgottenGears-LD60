import type { Input } from '../Input'
import { FONT_FAMILY } from '../fonts'
import type { RobotData, RobotParameter, RobotProcess, RobotProcessState } from '../RobotData'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

type Rect = { x: number; y: number; width: number; height: number }

export interface TaskManagerWindowOptions {
  /**
   * Open the RASM source of a process. The task manager only asks the host to
   * show the file; when the host refuses, it returns a message to display.
   */
  openSource?: (path: string, pid: number) => string | null
}

const COLORS = {
  // Kept transparent on purpose: the blurred glow layer lives *under* the game
  // canvas and only shows through unpainted pixels, so a full-screen tint here
  // would kill the bloom (same reason PowerDistribution leaves panel at 0.0).
  panel: 'rgba(7, 23, 13, 0.5)',
  panelAlt: 'rgba(12, 34, 19, 0.55)',
  border: '#376d42',
  borderBright: '#89f5a4',
  text: '#bcffae',
  bright: '#eaffea',
  dim: '#659e5c',
  track: 'rgba(53, 96, 62, 0.55)',
  green: '#71f79f',
  yellow: '#ffd166',
  red: '#ff7782',
  cyan: '#7de5ff',
  blue: '#9fb8ff',
  gray: '#a0afa4',
}

const APPEAR_TOTAL = 0.55

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function stateColor(state: RobotProcessState): string {
  switch (state) {
    case 'RUNNING': return COLORS.green
    case 'DEGRADED': return COLORS.yellow
    case 'WAITING': return COLORS.cyan
    case 'SUSPENDED': return COLORS.blue
    case 'FAULT': return COLORS.red
    default: return COLORS.gray
  }
}

function stateLabel(state: RobotProcessState, language: GameLanguage): string {
  if (language === 'ru') {
    switch (state) {
      case 'RUNNING': return 'РАБОТАЕТ'
      case 'DEGRADED': return 'СБОЙНЫЙ'
      case 'WAITING': return 'ОЖИДАНИЕ'
      case 'SUSPENDED': return 'ПАУЗА'
      case 'FAULT': return 'ОТКАЗ'
      default: return 'ОСТАНОВЛЕН'
    }
  }
  switch (state) {
    case 'RUNNING': return 'RUNNING'
    case 'DEGRADED': return 'DEGRADED'
    case 'WAITING': return 'WAITING'
    case 'SUSPENDED': return 'SUSPENDED'
    case 'FAULT': return 'FAULT'
    default: return 'STOPPED'
  }
}

function levelColor(level: RobotParameter['level']): string {
  if (level === 'bad') return COLORS.red
  if (level === 'warn') return COLORS.yellow
  return COLORS.green
}

/**
 * Task-manager screen: live performance of the game loop, robot parameters,
 * the service process table and the virtual-storage gauges. Every number comes
 * from RobotData, so the window owns no robot state of its own.
 */
export class TaskManagerWindow implements GameWindow {
  readonly id = 'tasks'

  private manager: WindowManager | null = null
  private readonly robotData: RobotData
  private readonly openSource: ((path: string, pid: number) => string | null) | null
  private language: GameLanguage = 'ru'

  private selectedIndex = 0
  private scrollTop = 0
  private appearTime = APPEAR_TOTAL
  private openedThisFrame = false
  private blinkClock = 0
  private wasPointerDown = false
  private processRows: Rect[] = []
  /** Time left in which a second click on the same row opens its source. */
  private doubleClickClock = 0
  private lastClickIndex = -1
  /** Transient message shown after a control verb, empty when there is none. */
  private notice = ''
  private noticeClock = 0

  constructor(robotData: RobotData, options: TaskManagerWindowOptions = {}) {
    this.robotData = robotData
    this.openSource = options.openSource ?? null
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.appearTime = 0
    this.openedThisFrame = true
    this.scrollTop = 0
    this.wasPointerDown = false
  }

  update(dt: number, input: Input): void {
    this.appearTime += dt
    this.blinkClock += dt
    this.doubleClickClock = Math.max(0, this.doubleClickClock - dt)

    if (this.notice) {
      this.noticeClock += dt
      if (this.noticeClock > 2.6) {
        this.notice = ''
        this.noticeClock = 0
      }
    }

    const processes = this.robotData.getProcesses()
    if (this.selectedIndex >= processes.length) this.selectedIndex = Math.max(0, processes.length - 1)

    const keyEvents = input.getPressedKeyEvents()
    if (this.appearTime < APPEAR_TOTAL) {
      // The key that opened the window must not skip its own animation.
      if (!this.openedThisFrame && keyEvents.length) this.appearTime = APPEAR_TOTAL
      this.openedThisFrame = false
      return
    }
    this.openedThisFrame = false

    if (input.wasPressed('Escape') || input.wasPressed('KeyC')) {
      this.manager?.show('console')
      return
    }

    const move = (delta: number): void => {
      if (processes.length === 0) return
      this.selectedIndex = Math.max(0, Math.min(processes.length - 1, this.selectedIndex + delta))
    }
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) move(-1)
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) move(1)
    if (input.wasPressed('PageUp')) move(-8)
    if (input.wasPressed('PageDown')) move(8)
    if (input.wasPressed('Home')) this.selectedIndex = 0
    if (input.wasPressed('End')) this.selectedIndex = Math.max(0, processes.length - 1)

    // Process control verbs act on the selected program row.
    if (input.wasPressed('KeyK')) this.controlSelected('kill')
    if (input.wasPressed('KeyP')) this.controlSelected('pause')
    if (input.wasPressed('KeyR')) this.controlSelected('restart')
    // E / Enter opens the RASM source bound to the selected row.
    if (input.wasPressed('KeyE') || input.wasPressed('Enter')) this.openSelectedSource()

    const down = input.isPointerDown()
    if (down && !this.wasPointerDown) {
      const x = input.pointerPosition.x
      const y = input.pointerPosition.y
      let clicked = -1
      for (const [index, rect] of this.processRows.entries()) {
        if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
          clicked = Math.min(processes.length - 1, this.scrollTop + index)
          break
        }
      }
      if (clicked >= 0) {
        this.selectedIndex = clicked
        if (clicked === this.lastClickIndex && this.doubleClickClock > 0) {
          this.openSelectedSource()
          this.doubleClickClock = 0
          this.lastClickIndex = -1
        } else {
          this.lastClickIndex = clicked
          this.doubleClickClock = 0.4
        }
      }
    }
    this.wasPointerDown = down
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    // Clear instead of painting a backdrop: it wipes the debug grid/Game layer
    // beneath and leaves the background transparent for the glow layer to show.
    ctx.clearRect(0, 0, width, height)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    const appear = easeOut(clamp01(this.appearTime / APPEAR_TOTAL))
    ctx.globalAlpha = appear

    const margin = width < 560 ? 10 : width < 1000 ? 18 : 26
    const fontSize = width < 460 ? 10 : width < 1000 ? 12 : 13
    const lineHeight = Math.ceil(fontSize * 1.48)
    const font = `${fontSize}px "${FONT_FAMILY}", monospace`
    const smallFont = `${Math.max(8, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    const titleFont = `bold ${fontSize + 3}px "${FONT_FAMILY}", monospace`

    const performance = this.robotData.getPerformance()
    const parameters = this.robotData.getParameters(this.language)
    const processes = this.robotData.getProcesses()
    const storage = this.robotData.getStorage()

    // ------------------------------------------------------------ header
    ctx.font = titleFont
    ctx.fillStyle = COLORS.bright
    ctx.shadowColor = 'rgba(114, 255, 98, 0.35)'
    ctx.shadowBlur = 6
    ctx.fillText(
      this.language === 'ru' ? 'ДИСПЕТЧЕР ЗАДАЧ РОБОТА' : 'ROBOT TASK MANAGER',
      margin,
      margin,
    )
    ctx.shadowBlur = 0

    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    const modeText = this.language === 'ru'
      ? `РЕЖИМ: ${this.robotData.getMode() === 'OPERATIONAL' ? 'РАБОЧИЙ' : 'ВОССТАНОВЛЕНИЕ'}`
      : `MODE: ${this.robotData.getMode()}`
    ctx.fillText(
      `${modeText}   ${this.robotData.formatUptime(this.language)}`,
      margin,
      margin + lineHeight + 3,
    )
    ctx.textAlign = 'right'
    ctx.fillStyle = COLORS.text
    const running = processes.filter((process) => process.state === 'RUNNING' || process.state === 'DEGRADED').length
    ctx.fillText(
      this.language === 'ru'
        ? `ЗАДАЧ: ${processes.length} · АКТИВНЫХ: ${running} · ${performance.fps.toFixed(0)} FPS`
        : `TASKS: ${processes.length} · ACTIVE: ${running} · ${performance.fps.toFixed(0)} FPS`,
      width - margin,
      margin + lineHeight + 3,
    )
    ctx.textAlign = 'left'

    const ruleY = margin + lineHeight * 2 + 8
    ctx.strokeStyle = COLORS.border
    ctx.beginPath()
    ctx.moveTo(margin, ruleY)
    ctx.lineTo(width - margin, ruleY)
    ctx.stroke()

    // ---------------------------------------------------------- gauges
    const gaugeColumns = width < 700 ? 2 : width < 1120 ? 3 : 4
    const gaugeGap = 8
    const gaugeWidth = Math.max(120, (width - margin * 2 - gaugeGap * (gaugeColumns - 1)) / gaugeColumns)
    const gaugeHeight = Math.max(lineHeight * 3.2, 46)
    const gaugeTop = ruleY + 10
    const gaugeRows = Math.ceil(parameters.length / gaugeColumns)

    parameters.forEach((parameter, index) => {
      const column = index % gaugeColumns
      const row = Math.floor(index / gaugeColumns)
      const rect: Rect = {
        x: margin + column * (gaugeWidth + gaugeGap),
        y: gaugeTop + row * (gaugeHeight + gaugeGap),
        width: gaugeWidth,
        height: gaugeHeight,
      }
      this.drawGauge(ctx, rect, parameter, smallFont, font, lineHeight)
    })

    // ------------------------------------------------------------- main
    const footerHeight = lineHeight + 8
    const mainTop = gaugeTop + gaugeRows * (gaugeHeight + gaugeGap) + 6
    const footerY = height - margin - footerHeight
    const mainHeight = Math.max(lineHeight * 6, footerY - mainTop - 8)
    const wide = width >= 900
    const sideWidth = wide ? Math.min(340, Math.max(240, Math.floor(width * 0.3))) : 0

    const processRect: Rect = {
      x: margin,
      y: mainTop,
      width: wide ? width - margin * 2 - sideWidth - 12 : width - margin * 2,
      height: wide ? mainHeight : Math.floor(mainHeight * 0.62),
    }
    const sideRect: Rect | null = wide
      ? { x: margin + processRect.width + 12, y: mainTop, width: sideWidth, height: mainHeight }
      : { x: margin, y: mainTop + processRect.height + 10, width: width - margin * 2, height: Math.max(lineHeight * 5, mainHeight - processRect.height - 10) }

    this.drawProcessPanel(ctx, processRect, processes, smallFont, font, lineHeight)
    if (sideRect) this.drawSidePanels(ctx, sideRect, performance, storage, smallFont, font, lineHeight)

    // ----------------------------------------------------------- footer
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    ctx.textAlign = 'left'
    const hint = this.language === 'ru'
      ? '↑/↓: ВЫБОР · PAGEUP/PAGEDOWN: ПРОКРУТКА · E: ИСХОДНИК · K: ЗАВЕРШИТЬ · P: ПАУЗА · R: ПЕРЕЗАПУСК · ESC / C: КОНСОЛЬ'
      : '↑/↓: SELECT · PAGEUP/PAGEDOWN: SCROLL · E: SOURCE · K: KILL · P: PAUSE · R: RESTART · ESC / C: CONSOLE'
    ctx.fillText(this.fitText(ctx, hint, width - margin * 2), margin, footerY)

    if (this.notice) {
      ctx.textAlign = 'right'
      ctx.fillStyle = COLORS.yellow
      ctx.fillText(this.fitText(ctx, this.notice, width - margin * 2), width - margin, footerY)
      ctx.textAlign = 'left'
    }

    ctx.restore()
  }

  /**
   * Open the RASM source bound to the selected row.
   *
   * Every service process ships a script under /sys/services; an operator
   * program points at the file it was launched from. The task manager does not
   * edit the file itself — it hands the path to the code editor, which owns the
   * buffer and the quota-aware save.
   */
  private openSelectedSource(): void {
    const selected = this.robotData.getProcesses()[this.selectedIndex]
    if (!selected) return

    if (!selected.scriptPath) {
      this.notice = this.language === 'ru'
        ? `ПРОЦЕСС ${selected.pid}: ФАЙЛ ИСХОДНИКА НЕ НАЙДЕН.`
        : `PROCESS ${selected.pid}: NO SOURCE FILE.`
      this.noticeClock = 0
      return
    }

    if (!this.openSource) {
      this.notice = this.language === 'ru' ? 'РЕДАКТОР НЕ ПОДКЛЮЧЁН.' : 'EDITOR IS NOT CONNECTED.'
      this.noticeClock = 0
      return
    }

    const error = this.openSource(selected.scriptPath, selected.pid)
    if (error) {
      this.notice = error
      this.noticeClock = 0
      return
    }

    this.notice = this.language === 'ru'
      ? `ИСХОДНИК ОТКРЫТ: ${selected.scriptPath}`
      : `SOURCE OPENED: ${selected.scriptPath}`
    this.noticeClock = 0
  }

  // ------------------------------------------------------------------ pieces

  /**
   * Apply a control verb to the selected row.
   *
   * Only programs can be controlled; a service row belongs to the hardware
   * and is repaired through the maintenance UI, not from the task manager.
   */
  private controlSelected(verb: 'kill' | 'pause' | 'restart'): void {
    const processes = this.robotData.getProcesses()
    const selected = processes[this.selectedIndex]
    if (!selected) return

    if (selected.kind !== 'program') {
      this.notice = this.language === 'ru'
        ? `СЛУЖБА ${selected.name}: УПРАВЛЕНИЕ НЕДОСТУПНО.`
        : `SERVICE ${selected.name}: NOT CONTROLLABLE.`
      return
    }

    const pid = selected.pid
    let ok = false
    if (verb === 'kill') {
      ok = this.robotData.killProcess(pid)
      this.notice = ok
        ? (this.language === 'ru' ? `ПРОЦЕСС ${pid} ЗАВЕРШЁН.` : `PROCESS ${pid} TERMINATED.`)
        : (this.language === 'ru' ? `ПРОЦЕСС ${pid} УЖЕ ЗАВЕРШЁН.` : `PROCESS ${pid} IS ALREADY OVER.`)
    } else if (verb === 'pause') {
      const program = this.robotData.getProgram(pid)
      const suspended = program?.state === 'SUSPENDED'
      ok = suspended ? this.robotData.resumeProcess(pid) : this.robotData.suspendProcess(pid)
      this.notice = ok
        ? suspended
          ? (this.language === 'ru' ? `ПРОЦЕСС ${pid} ПРОДОЛЖЕН.` : `PROCESS ${pid} RESUMED.`)
          : (this.language === 'ru' ? `ПРОЦЕСС ${pid} ПРИОСТАНОВЛЕН.` : `PROCESS ${pid} SUSPENDED.`)
        : (this.language === 'ru' ? `ПРОЦЕСС ${pid} НЕЛЬЗЯ ${suspended ? 'ПРОДОЛЖИТЬ' : 'ПРИОСТАНОВИТЬ'}.` : `PROCESS ${pid} CANNOT BE ${suspended ? 'RESUMED' : 'SUSPENDED'}.`)
    } else {
      ok = this.robotData.resetProcess(pid)
      this.notice = ok
        ? (this.language === 'ru' ? `ПРОЦЕСС ${pid} ПЕРЕЗАПУЩЕН.` : `PROCESS ${pid} RESTARTED.`)
        : (this.language === 'ru' ? `ПРОЦЕСС ${pid} НЕЛЬЗЯ ПЕРЕЗАПУСТИТЬ.` : `PROCESS ${pid} CANNOT BE RESTARTED.`)
    }
  }

  private drawGauge(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    parameter: RobotParameter,
    smallFont: string,
    font: string,
    lineHeight: number,
  ): void {
    ctx.fillStyle = COLORS.panel
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)

    const pad = 7
    ctx.font = smallFont
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.dim
    ctx.fillText(
      this.fitText(ctx, parameter.label[this.language], rect.width - pad * 2),
      rect.x + pad,
      rect.y + pad - 1,
    )

    ctx.font = font
    ctx.fillStyle = levelColor(parameter.level)
    ctx.fillText(
      this.fitText(ctx, parameter.value, rect.width - pad * 2),
      rect.x + pad,
      rect.y + pad + Math.ceil(lineHeight * 0.95),
    )

    const barHeight = 4
    const barY = rect.y + rect.height - barHeight - pad + 2
    const barWidth = rect.width - pad * 2
    ctx.fillStyle = COLORS.track
    ctx.fillRect(rect.x + pad, barY, barWidth, barHeight)
    ctx.fillStyle = levelColor(parameter.level)
    ctx.fillRect(rect.x + pad, barY, Math.max(1, barWidth * Math.min(1, parameter.ratio)), barHeight)
  }

  private drawProcessPanel(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    processes: RobotProcess[],
    smallFont: string,
    font: string,
    lineHeight: number,
  ): void {
    ctx.fillStyle = COLORS.panel
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = COLORS.border
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)

    const pad = 9
    const columns = this.processColumns(rect.width)
    const baseX = rect.x + pad
    ctx.font = font
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.text
    ctx.fillText(
      this.language === 'ru' ? 'ПРОЦЕССЫ' : 'PROCESSES',
      baseX,
      rect.y + 7,
    )
    ctx.font = smallFont
    ctx.fillStyle = COLORS.dim
    const headerY = rect.y + 7 + Math.ceil(lineHeight * 1.2)
    ctx.fillText('PID', baseX, headerY)
    ctx.fillText('*', baseX + columns.pid, headerY)
    ctx.fillText(this.language === 'ru' ? 'ИМЯ' : 'NAME', baseX + columns.pid + columns.kind, headerY)
    ctx.textAlign = 'right'
    ctx.fillText('CPU%', baseX + columns.pid + columns.kind + columns.name + columns.cpu, headerY)
    ctx.fillText(this.language === 'ru' ? 'ПАМ' : 'MEM', baseX + columns.pid + columns.kind + columns.name + columns.cpu + columns.mem, headerY)
    ctx.fillText(this.language === 'ru' ? 'СОСТОЯНИЕ' : 'STATE', rect.x + rect.width - pad, headerY)
    ctx.textAlign = 'left'

    const detailHeight = lineHeight * 3 + 10
    const listTop = rect.y + Math.ceil(lineHeight * 2.4) + 14
    const listBottom = rect.y + rect.height - detailHeight - pad
    const rowHeight = Math.max(lineHeight + 2, lineHeight + 4)
    const visibleRows = Math.max(1, Math.floor((listBottom - listTop) / rowHeight))

    if (this.selectedIndex < this.scrollTop) this.scrollTop = this.selectedIndex
    if (this.selectedIndex >= this.scrollTop + visibleRows) this.scrollTop = this.selectedIndex - visibleRows + 1
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, processes.length - visibleRows)))

    ctx.font = smallFont
    this.processRows = []
    for (let row = 0; row < visibleRows; row += 1) {
      const index = this.scrollTop + row
      const process = processes[index]
      if (!process) break
      const y = listTop + row * rowHeight
      const selected = index === this.selectedIndex
      const rowRect: Rect = { x: rect.x + 1, y, width: rect.width - 2, height: rowHeight }
      this.processRows.push(rowRect)

      // Faulted services pulse so a broken subsystem is visible at a glance.
      const faultDimmed = process.state === 'FAULT' && this.blinkClock % 0.9 >= 0.6
      ctx.save()
      if (faultDimmed) ctx.globalAlpha = 0.45
      if (selected) {
        ctx.fillStyle = 'rgba(103, 218, 130, 0.18)'
        ctx.fillRect(rowRect.x, y, rowRect.width, rowHeight)
      }

      const columns = this.processColumns(rect.width)
      const baseX = rect.x + pad
      ctx.textAlign = 'left'
      ctx.fillStyle = selected ? COLORS.bright : COLORS.text
      ctx.fillText(String(process.pid).padStart(4, ' '), baseX, y + 2, columns.pid - 4)
      // The marker tells a user program apart from a system service.
      ctx.fillStyle = process.kind === 'program'
        ? (selected ? COLORS.bright : COLORS.green)
        : COLORS.dim
      ctx.fillText(process.kind === 'program' ? '*' : '·', baseX + columns.pid, y + 2)
      ctx.fillText(this.fitText(ctx, process.name, columns.name - 6), baseX + columns.pid + columns.kind, y + 2, columns.name - 4)
      ctx.textAlign = 'right'
      ctx.fillStyle = process.cpuPercent > 0.05 ? (selected ? COLORS.bright : COLORS.green) : COLORS.dim
      ctx.fillText(process.cpuPercent.toFixed(1), baseX + columns.pid + columns.kind + columns.name + columns.cpu, y + 2)
      ctx.fillStyle = selected ? COLORS.bright : COLORS.dim
      ctx.fillText(
        process.memoryKb >= 1024
          ? `${(process.memoryKb / 1024).toFixed(1)}M`
          : `${process.memoryKb}K`,
        baseX + columns.pid + columns.kind + columns.name + columns.cpu + columns.mem,
        y + 2,
      )
      ctx.textAlign = 'right'
      ctx.fillStyle = stateColor(process.state)
      ctx.fillText(
        this.fitText(ctx, stateLabel(process.state, this.language), columns.state - 6),
        rect.x + rect.width - pad,
        y + 2,
      )
      ctx.textAlign = 'left'
      ctx.restore()
    }

    // Selected-task detail strip: what the service does and why it is not healthy.
    const selected = processes[this.selectedIndex]
    const detailY = listBottom + 4
    ctx.strokeStyle = 'rgba(55, 109, 66, 0.6)'
    ctx.beginPath()
    ctx.moveTo(rect.x + pad, detailY)
    ctx.lineTo(rect.x + rect.width - pad, detailY)
    ctx.stroke()

    if (selected) {
      ctx.font = smallFont
      ctx.fillStyle = COLORS.text
      ctx.fillText(
        this.fitText(ctx, selected.detail[this.language], rect.width - pad * 2),
        rect.x + pad,
        detailY + 5,
      )
      const component = selected.componentId ? this.robotData.getComponent(selected.componentId) : undefined
      ctx.fillStyle = component ? stateColor(processStateOf(component.status)) : COLORS.dim
      const statusLine = selected.kind === 'program'
        ? this.programStatusLine(selected)
        : selected.componentId
          ? component
            ? `${selected.componentId}: ${component.status} — ${this.fitText(ctx, component.fault, Math.max(40, rect.width - pad * 2 - 90))}`
            : `${selected.componentId}: —`
          : (this.language === 'ru' ? 'СЛУЖБА СИСТЕМЫ (БЕЗ КОМПОНЕНТА)' : 'SYSTEM SERVICE (NO COMPONENT)')
      ctx.fillText(this.fitText(ctx, statusLine, rect.width - pad * 2), rect.x + pad, detailY + 5 + lineHeight)

      // Third line: the RASM source bound to the process. E / Enter opens it.
      ctx.fillStyle = selected.scriptPath ? COLORS.cyan : COLORS.dim
      const scriptLine = selected.scriptPath
        ? `${this.language === 'ru' ? 'СКРИПТ' : 'SCRIPT'}: ${selected.scriptPath}`
        : (this.language === 'ru' ? 'СКРИПТ: —' : 'SCRIPT: —')
      const openHint = selected.scriptPath
        ? (this.language === 'ru' ? '  [E — ОТКРЫТЬ]' : '  [E — OPEN]')
        : ''
      ctx.fillText(
        this.fitText(ctx, `${scriptLine}${openHint}`, rect.width - pad * 2),
        rect.x + pad,
        detailY + 5 + lineHeight * 2,
      )
    }
  }

  /** Second detail line of a program row: where it came from and how far it got. */
  private programStatusLine(process: RobotProcess): string {
    const instructions = process.instructions ?? 0
    const source = process.path ?? (this.language === 'ru' ? 'БУФЕР РЕДАКТОРА' : 'EDITOR BUFFER')
    return this.language === 'ru'
      ? `ПРОГРАММА · ${source} · ИНСТРУКЦИЙ: ${instructions}`
      : `PROGRAM · ${source} · INSTRUCTIONS: ${instructions}`
  }

  private processColumns(panelWidth: number): { pid: number; kind: number; name: number; cpu: number; mem: number; state: number } {
    const compact = panelWidth < 520
    return {
      pid: compact ? 40 : 46,
      kind: compact ? 12 : 16,
      name: compact ? Math.max(110, panelWidth * 0.32) : Math.max(150, panelWidth * 0.34),
      cpu: compact ? 48 : 60,
      mem: compact ? 56 : 70,
      state: compact ? 96 : 130,
    }
  }

  private drawSidePanels(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    performance: ReturnType<RobotData['getPerformance']>,
    storage: ReturnType<RobotData['getStorage']>,
    smallFont: string,
    font: string,
    lineHeight: number,
  ): void {
    const gap = 10
    const storageHeight = Math.max(lineHeight * 5 + 18, Math.floor(rect.height * 0.44))
    const graphRect: Rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height - storageHeight - gap }
    const storageRect: Rect = { x: rect.x, y: rect.y + graphRect.height + gap, width: rect.width, height: storageHeight }

    this.drawHistoryPanel(ctx, graphRect, performance, smallFont, font, lineHeight)
    this.drawStoragePanel(ctx, storageRect, storage, smallFont, font, lineHeight)
  }

  private drawHistoryPanel(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    performance: ReturnType<RobotData['getPerformance']>,
    smallFont: string,
    font: string,
    lineHeight: number,
  ): void {
    ctx.fillStyle = COLORS.panelAlt
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = COLORS.border
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)

    const pad = 9
    ctx.font = font
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.text
    ctx.fillText(this.language === 'ru' ? 'НАГРУЗКА СИСТЕМЫ' : 'SYSTEM LOAD', rect.x + pad, rect.y + 7)
    ctx.textAlign = 'right'
    ctx.fillStyle = COLORS.green
    ctx.fillText(`${performance.loadPercent.toFixed(1)} %`, rect.x + rect.width - pad, rect.y + 7)

    const history = performance.loadHistory
    const graphTop = rect.y + lineHeight + 14
    const graphBottom = rect.y + rect.height - lineHeight - 10
    const graphHeight = Math.max(10, graphBottom - graphTop)

    ctx.fillStyle = 'rgba(6, 18, 10, 0.85)'
    ctx.fillRect(rect.x + pad, graphTop, rect.width - pad * 2, graphHeight)
    ctx.strokeStyle = 'rgba(55, 109, 66, 0.5)'
    ctx.strokeRect(rect.x + pad + 0.5, graphTop + 0.5, rect.width - pad * 2 - 1, graphHeight - 1)

    // 50% guide line so a healthy load can be read at a glance.
    ctx.strokeStyle = 'rgba(55, 109, 66, 0.35)'
    ctx.beginPath()
    const guideY = graphBottom - graphHeight * 0.5
    ctx.moveTo(rect.x + pad, guideY)
    ctx.lineTo(rect.x + rect.width - pad, guideY)
    ctx.stroke()

    if (history.length > 1) {
      const innerWidth = rect.width - pad * 2
      const step = innerWidth / Math.max(1, history.length - 1)
      ctx.beginPath()
      history.forEach((value, index) => {
        const x = rect.x + pad + index * step
        const y = graphBottom - (Math.min(100, value) / 100) * graphHeight
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = COLORS.green
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.lineWidth = 1
    }

    ctx.font = smallFont
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.dim
    ctx.fillText(
      this.language === 'ru'
        ? `ХУДШИЙ КАДР: ${performance.worstFrameMs.toFixed(1)} ms`
        : `WORST FRAME: ${performance.worstFrameMs.toFixed(1)} ms`,
      rect.x + pad,
      rect.y + rect.height - lineHeight - 6,
    )
    ctx.textAlign = 'right'
    ctx.fillText(
      `${performance.fps.toFixed(0)} FPS · ${performance.frameTimeMs.toFixed(1)} ms`,
      rect.x + rect.width - pad,
      rect.y + rect.height - lineHeight - 6,
    )
    ctx.textAlign = 'left'
  }

  private drawStoragePanel(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    storage: ReturnType<RobotData['getStorage']>,
    smallFont: string,
    font: string,
    lineHeight: number,
  ): void {
    ctx.fillStyle = COLORS.panelAlt
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = COLORS.border
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)

    const pad = 9
    ctx.font = font
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.text
    ctx.fillText(this.language === 'ru' ? 'ФАЙЛОВОЕ ХРАНИЛИЩЕ' : 'FILE STORAGE', rect.x + pad, rect.y + 7)
    ctx.textAlign = 'right'
    ctx.fillStyle = storage.fileRatio >= 0.9 || storage.byteRatio >= 0.9 ? COLORS.red : COLORS.green
    ctx.fillText(
      `${Math.round(storage.fileRatio * 100)}% / ${Math.round(storage.byteRatio * 100)}%`,
      rect.x + rect.width - pad,
      rect.y + 7,
    )
    ctx.textAlign = 'left'

    const barWidth = rect.width - pad * 2
    const rows: Array<{ label: string; value: string; ratio: number; y: number }> = [
      {
        label: this.language === 'ru' ? 'ФАЙЛОВ' : 'FILES',
        value: `${storage.fileCount} / ${storage.maxFiles}`,
        ratio: storage.fileRatio,
        y: rect.y + lineHeight + 12,
      },
      {
        label: this.language === 'ru' ? 'ОБЪЁМ' : 'SIZE',
        value: `${formatBytesShort(storage.usedBytes, this.language)} / ${formatBytesShort(storage.maxBytes, this.language)}`,
        ratio: storage.byteRatio,
        y: rect.y + lineHeight + 12 + Math.max(24, lineHeight + 8),
      },
    ]

    ctx.font = smallFont
    for (const row of rows) {
      ctx.textAlign = 'left'
      ctx.fillStyle = COLORS.dim
      ctx.fillText(row.label, rect.x + pad, row.y)
      ctx.textAlign = 'right'
      ctx.fillStyle = COLORS.text
      ctx.fillText(row.value, rect.x + rect.width - pad, row.y)
      ctx.textAlign = 'left'

      const barY = row.y + Math.ceil(lineHeight * 1.05)
      const ratio = Math.min(1, row.ratio)
      ctx.fillStyle = COLORS.track
      ctx.fillRect(rect.x + pad, barY, barWidth, 5)
      ctx.fillStyle = ratio >= 0.9 ? COLORS.red : ratio >= 0.7 ? COLORS.yellow : COLORS.green
      ctx.fillRect(rect.x + pad, barY, Math.max(1, barWidth * ratio), 5)
    }

    const freeFiles = Math.max(0, storage.maxFiles - storage.fileCount)
    const freeBytes = Math.max(0, storage.maxBytes - storage.usedBytes)
    ctx.fillStyle = COLORS.dim
    ctx.fillText(
      this.language === 'ru'
        ? `СВОБОДНО: ${freeFiles} ФАЙЛ. · ${formatBytesShort(freeBytes, this.language)}`
        : `FREE: ${freeFiles} FILES · ${formatBytesShort(freeBytes, this.language)}`,
      rect.x + pad,
      rect.y + rect.height - lineHeight - 6,
    )
  }

  private fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (maxWidth <= 0) return ''
    if (ctx.measureText(text).width <= maxWidth) return text
    let fitted = text
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1)
    return `${fitted}…`
  }
}

function processStateOf(status: string): RobotProcessState {
  if (status === 'ONLINE') return 'RUNNING'
  if (status === 'DEGRADED') return 'DEGRADED'
  if (status === 'CRITICAL' || status === 'LOCKED') return 'FAULT'
  return 'STOPPED'
}

function formatBytesShort(bytes: number, language: GameLanguage): string {
  if (bytes < 1024) return `${bytes} ${language === 'ru' ? 'Б' : 'B'}`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${language === 'ru' ? 'КБ' : 'KB'}`
  return `${(bytes / (1024 * 1024)).toFixed(2)} ${language === 'ru' ? 'МБ' : 'MB'}`
}
