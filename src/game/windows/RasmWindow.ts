import { FONT_FAMILY } from '../fonts'
import { playSfx } from '../sfx'
import type { Input, InputKeyEvent } from '../Input'
import { Debugger } from '../rasm/debugger'
import { formatDiagnostics } from '../rasm/compiler'
import type { DemoScenario } from '../rasm/scenario'
import { DEMO_DEVICES } from '../rasm/scenario'
import { REGISTER_COUNT, RAM_SIZE } from '../rasm/types'
import type { ProcessorSnapshot } from '../rasm/processor'
import type { GameLanguage, GameWindow } from './GameWindow'
import { SolvePopup } from './SolvePopup'
import type { WindowManager } from './WindowManager'

/**
 * In-game RASM debugger.
 *
 * Hosts the language core: it compiles the buffer through `Debugger`, renders
 * the machine snapshot (source + current line, registers, RAM, PC, ticks,
 * devices, diagnostics) and maps keys to step / run / reset / breakpoints.
 *
 * The window is a pure view: all execution state lives in `Debugger`.
 */

type Pane = 'source' | 'machine'

const RAM_COLUMNS = 16
const RAM_PREVIEW_ROWS = 4

const APPEAR_FRAME = 0.4
const APPEAR_TEXT_START = 0.35
const APPEAR_TEXT = 0.7
const APPEAR_FOOTER_START = 1.05
const APPEAR_FOOTER = 0.28
const APPEAR_TOTAL = APPEAR_FOOTER_START + APPEAR_FOOTER

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Default buffer shown when the window opens on an empty editor. */
export const RASM_DEFAULT_PROGRAM = `; RASM 1.0 — thermal governor
; R0 = motor speed, R1 = temperature limit
        MOV R0, #0
        MOV R1, #80
LOOP:   IN  R3, TEMP
        CMP R3, R1
        JGE OVERHEAT
        ADD R0, #10
        OUT MOTOR, R0
        STORE [0x20], R0
        JMP LOOP
OVERHEAT:
        OUT MOTOR, #0
        LOAD R4, [0x20]
        HALT
`

export interface RasmWindowOptions {
  scenario?: DemoScenario
  /** Called when a program passes compilation, so the level can react. */
  onProgramValidated?: (source: string) => void
}

export class RasmWindow implements GameWindow {
  readonly id = 'rasm'

  private manager: WindowManager | null = null
  private language: GameLanguage = 'ru'
  private readonly debugger: Debugger
  private readonly scenario: DemoScenario | undefined
  private readonly onProgramValidated?: (source: string) => void

  private buffer: string[] = RASM_DEFAULT_PROGRAM.replace(/\r\n/g, '\n').split('\n')
  private cursorRow = 0
  private scrollTop = 0
  private activePane: Pane = 'source'
  private message = ''
  private messageIsError = false
  private appearTime = APPEAR_TOTAL
  private openedThisFrame = false
  private readonly popup = new SolvePopup()

  constructor(options: RasmWindowOptions = {}) {
    this.scenario = options.scenario
    this.onProgramValidated = options.onProgramValidated
    this.debugger = new Debugger({
      bus: options.scenario?.bus,
      onBreakpoint: () => playSfx('selection'),
    })
    this.compile()
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    this.appearTime = 0
    this.openedThisFrame = true
    this.popup.hide()
  }

  /** Replace the editor buffer and recompile. Used by the console `rasm` command. */
  loadSource(source: string): void {
    this.buffer = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    if (!this.buffer.length) this.buffer = ['']
    this.cursorRow = 0
    this.scrollTop = 0
    this.compile()
  }

  get source(): string {
    return this.buffer.join('\n')
  }

  // -------------------------------------------------------------- entry point

  update(dt: number, input: Input): void {
    this.appearTime += dt
    const events = input.getPressedKeyEvents()

    if (this.openedThisFrame) {
      this.openedThisFrame = false
    } else if (this.appearTime < APPEAR_TOTAL && events.length) {
      this.appearTime = APPEAR_TOTAL
      return
    }
    if (this.appearTime < APPEAR_TOTAL) return

    this.popup.update(dt)

    for (const event of events) this.handleKey(event)
  }

  private handleKey(event: InputKeyEvent): void {
    const code = event.code

    // Control keys first, so they work regardless of the focused pane.
    if (code === 'Escape' || code === 'KeyQ') {
      this.exitWindow()
      return
    }
    if (code === 'F5' || code === 'KeyR') {
      this.run()
      return
    }
    if (code === 'F8' || code === 'KeyS') {
      this.stepOnce()
      return
    }
    if (code === 'F9' || code === 'KeyG') {
      this.resetMachine()
      return
    }
    if (code === 'F10' || code === 'KeyB') {
      this.toggleBreakpoint()
      return
    }
    if (code === 'KeyC') {
      this.compile(true)
      return
    }

    // Pane switching and navigation.
    if (code === 'Tab') {
      this.activePane = this.activePane === 'source' ? 'machine' : 'source'
      return
    }
    if (code === 'ArrowUp') {
      this.moveCursor(-1)
      return
    }
    if (code === 'ArrowDown') {
      this.moveCursor(1)
      return
    }
    if (code === 'PageUp') {
      this.moveCursor(-10)
      return
    }
    if (code === 'PageDown') {
      this.moveCursor(10)
      return
    }
  }

  private moveCursor(amount: number): void {
    const next = Math.max(0, Math.min(this.buffer.length - 1, this.cursorRow + amount))
    if (next !== this.cursorRow) {
      this.cursorRow = next
      if (this.scenario) playSfx('selection')
    }
  }

  private compile(announce = false): void {
    const result = this.debugger.load(this.buffer.join('\n'))
    this.popup.hide()
    if (result.ok) {
      if (announce || this.messageIsError) {
        this.setMessage(this.language === 'ru'
          ? `СБОРКА OK: ${result.program.instructions.length} ИНСТРУКЦИЙ`
          : `COMPILED OK: ${result.program.instructions.length} INSTRUCTIONS`)
      }
      this.messageIsError = false
      this.onProgramValidated?.(this.buffer.join('\n'))
    } else {
      const related = result.diagnostics.find((d) => d.line === this.cursorRow + 1) ?? result.diagnostics[0]
      const count = result.diagnostics.length
      this.setMessage(this.language === 'ru'
        ? `ОШИБКА СБОРКИ: ${count} — СТРОКА ${related?.line ?? '?'}: ${related?.message ?? ''}`
        : `COMPILE FAILED: ${count} — LINE ${related?.line ?? '?'}: ${related?.message ?? ''}`, true)
      if (announce) playSfx('incorrect')
    }
  }

  private run(): void {
    if (!this.debugger.hasProgram()) {
      this.compile(true)
      return
    }
    const result = this.debugger.run(20000)
    switch (result.reason) {
      case 'halted':
        playSfx('correct')
        this.popup.show()
        this.setMessage(this.language === 'ru' ? 'ПРОГРАММА ЗАВЕРШЕНА (HALT)' : 'PROGRAM HALTED')
        break
      case 'completed':
        playSfx('correct')
        this.popup.show()
        this.setMessage(this.language === 'ru' ? 'КОНЕЦ ПРОГРАММЫ' : 'END OF PROGRAM')
        break
      case 'breakpoint':
        playSfx('selection')
        this.setMessage(this.language === 'ru'
          ? `ТОЧКА ОСТАНОВА: СТРОКА ${result.snapshot.currentLine ?? '?'}`
          : `BREAKPOINT: LINE ${result.snapshot.currentLine ?? '?'}`)
        break
      case 'budget': {
        playSfx('incorrect')
        const budgetError = result.snapshot.error
        this.setMessage(this.language === 'ru'
          ? `ОШИБКА — СТРОКА ${budgetError?.line ?? '?'}: ${budgetError?.message ?? `ЛИМИТ ${result.executed} ИНСТРУКЦИЙ ИСЧЕРПАН`}`
          : `ERROR — LINE ${budgetError?.line ?? '?'}: ${budgetError?.message ?? `STEP BUDGET ${result.executed} EXHAUSTED`}`, true)
        break
      }
      case 'error': {
        playSfx('incorrect')
        const error = result.snapshot.error
        this.setMessage(this.language === 'ru'
          ? `ОШИБКА ВЫПОЛНЕНИЯ — СТРОКА ${error?.line ?? '?'}: ${error?.message ?? ''}`
          : `RUNTIME ERROR — LINE ${error?.line ?? '?'}: ${error?.message ?? ''}`, true)
        break
      }
      default:
        this.setMessage(this.language === 'ru' ? 'ОСТАНОВЛЕНО' : 'STOPPED')
    }
    this.syncCursorToPc()
  }

  private stepOnce(): void {
    if (!this.debugger.hasProgram()) {
      this.compile(true)
      return
    }
    this.popup.hide()
    const ran = this.debugger.step()
    if (!ran) {
      const reason = this.debugger.explainStep()
      if (reason) {
        const isError = reason.code !== 'PROCESSOR_HALTED'
        this.setMessage(this.language === 'ru'
          ? `${reason.code} — СТРОКА ${reason.line}: ${reason.message}`
          : `${reason.code} — LINE ${reason.line}: ${reason.message}`, isError)
        if (isError) playSfx('incorrect')
      }
      return
    }
    const snapshot = this.debugger.snapshot()
    if (snapshot.state === 'error') {
      playSfx('incorrect')
      this.setMessage(this.language === 'ru'
        ? `ОШИБКА — СТРОКА ${snapshot.error?.line ?? '?'}: ${snapshot.error?.message ?? ''}`
        : `ERROR — LINE ${snapshot.error?.line ?? '?'}: ${snapshot.error?.message ?? ''}`, true)
    }
    this.syncCursorToPc()
  }

  private resetMachine(): void {
    this.debugger.reset()
    this.scenario?.reset()
    this.popup.hide()
    this.setMessage(this.language === 'ru' ? 'СБРОС: PC=0, РЕГИСТРЫ И RAM ОЧИЩЕНЫ' : 'RESET: PC=0, REGISTERS AND RAM CLEARED')
  }

  private toggleBreakpoint(): void {
    const line = this.cursorRow + 1
    const on = this.debugger.toggleBreakpoint(line)
    if (this.scenario) playSfx(on ? 'connected' : 'disconnected')
    this.setMessage(this.language === 'ru'
      ? `ТОЧКА ОСТАНОВА ${on ? 'ВКЛ' : 'ВЫКЛ'}: СТРОКА ${line}`
      : `BREAKPOINT ${on ? 'ON' : 'OFF'}: LINE ${line}`)
  }

  /** Keep the source cursor on the instruction the PC is about to run. */
  private syncCursorToPc(): void {
    const line = this.debugger.snapshot().currentLine
    if (line !== null && line >= 1 && line <= this.buffer.length) this.cursorRow = line - 1
  }

  private exitWindow(): void {
    this.manager?.show('ui')
  }

  private setMessage(message: string, error = false): void {
    this.message = message
    this.messageIsError = error
  }

  // --------------------------------------------------------------------- draw

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.fillStyle = '#1b1405'
    ctx.fillRect(0, 0, width, height)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    const margin = width < 620 ? 8 : 15
    const fontSize = width < 500 ? 10 : width < 900 ? 11 : 13
    const lineHeight = Math.ceil(fontSize * 1.48)
    const tinyFont = `${Math.max(8, fontSize - 2)}px "${FONT_FAMILY}", monospace`
    const normalFont = `${fontSize}px "${FONT_FAMILY}", monospace`
    const boldFont = `bold ${fontSize}px "${FONT_FAMILY}", monospace`

    const frameProgress = easeOut(clamp01(this.appearTime / APPEAR_FRAME))
    const textProgress = clamp01((this.appearTime - APPEAR_TEXT_START) / APPEAR_TEXT)
    const footerAlpha = clamp01((this.appearTime - APPEAR_FOOTER_START) / APPEAR_FOOTER)

    const snapshot = this.debugger.snapshot()
    const footerHeight = Math.min(150, Math.max(110, Math.floor(height * 0.32)))
    const bodyTop = margin
    const bodyBottom = Math.max(bodyTop + lineHeight * 6, height - footerHeight - 9)
    const bodyHeight = bodyBottom - bodyTop

    // Two columns: source on the left, machine state on the right.
    const gap = 10
    const sourceWidth = Math.max(180, Math.floor((width - margin * 2 - gap) * (width < 780 ? 0.58 : 0.6)))
    const machineX = margin + sourceWidth + gap
    const machineWidth = Math.max(80, width - margin - machineX)

    this.drawSource(ctx, margin, bodyTop, sourceWidth, bodyHeight, {
      fontSize, lineHeight, tinyFont, normalFont, boldFont, frameProgress, textProgress, snapshot,
    })
    this.drawMachine(ctx, machineX, bodyTop, machineWidth, bodyHeight, {
      fontSize, lineHeight, tinyFont, normalFont, boldFont, frameProgress, textProgress, snapshot,
    })

    this.drawFooter(ctx, margin, bodyBottom + 8, width - margin * 2, footerHeight - 5, {
      tinyFont, boldFont, footerAlpha, snapshot,
    })

    this.popup.draw(ctx, width, height, {
      title: this.language === 'ru' ? 'ПРОГРАММА ЗАВЕРШЕНА' : 'PROGRAM COMPLETED',
      hint: this.language === 'ru' ? 'F9 — СБРОС, ESC — ВЫХОД' : 'F9 — RESET, ESC — EXIT',
    })

    ctx.restore()
  }

  private drawSource(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    style: {
      fontSize: number
      lineHeight: number
      tinyFont: string
      normalFont: string
      boldFont: string
      frameProgress: number
      textProgress: number
      snapshot: ProcessorSnapshot
    },
  ): void {
    this.drawPaneFrame(ctx, x, y, width, height, this.activePane === 'source', style.frameProgress)
    ctx.font = style.boldFont
    ctx.fillStyle = '#ffd02f'
    ctx.fillText(this.language === 'ru' ? 'ИСХОДНЫЙ КОД RASM' : 'RASM SOURCE', x + 6, y + 5)

    const top = y + style.lineHeight * 1.7
    const bottom = y + height - 5
    const rows = Math.max(1, Math.floor((bottom - top) / style.lineHeight))
    if (this.cursorRow < this.scrollTop) this.scrollTop = this.cursorRow
    if (this.cursorRow >= this.scrollTop + rows) this.scrollTop = this.cursorRow - rows + 1
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.buffer.length - rows)))

    const gutterWidth = Math.max(34, ctx.measureText(String(this.buffer.length)).width + 24)
    const textX = x + 8 + gutterWidth
    const maxTextWidth = Math.max(20, width - (textX - x) - 12)

    const currentLine = style.snapshot.currentLine
    // Highlight the source line of the fault, if the last execution stopped on one.
    const errorLine = style.snapshot.error && style.snapshot.error.line >= 1 ? style.snapshot.error.line : null
    const diagnosticLines = new Set(this.debugger.errors.map((d) => d.line))

    for (let row = 0; row < rows; row += 1) {
      const lineIndex = this.scrollTop + row
      const line = this.buffer[lineIndex]
      if (line === undefined) break
      const lineNumber = lineIndex + 1
      const rowY = top + row * style.lineHeight
      const isCursor = lineIndex === this.cursorRow
      const isCurrent = lineNumber === currentLine
      const isError = lineNumber === errorLine
      const hasBreakpoint = this.debugger.hasBreakpoint(lineNumber)
      const hasDiagnostic = diagnosticLines.has(lineNumber)

      if (isCurrent) {
        ctx.fillStyle = 'rgba(120, 255, 120, 0.16)'
        ctx.fillRect(x + 2, rowY - 1, width - 6, style.lineHeight)
      } else if (isError) {
        ctx.fillStyle = 'rgba(255, 52, 72, 0.18)'
        ctx.fillRect(x + 2, rowY - 1, width - 6, style.lineHeight)
      } else if (isCursor) {
        ctx.fillStyle = 'rgba(80, 60, 10, 0.55)'
        ctx.fillRect(x + 2, rowY - 1, width - 6, style.lineHeight)
      }

      // Gutter: breakpoint dot, line number, diagnostic marker.
      ctx.font = style.tinyFont
      ctx.textAlign = 'center'
      if (hasBreakpoint) {
        ctx.fillStyle = '#ff5a4a'
        ctx.beginPath()
        ctx.arc(x + 10, rowY + style.lineHeight / 2, 3.2, 0, Math.PI * 2)
        ctx.fill()
      } else if (hasDiagnostic) {
        ctx.fillStyle = '#ff9d5b'
        ctx.fillText('!', x + 10, rowY)
      }
      ctx.textAlign = 'right'
      ctx.fillStyle = isCurrent ? '#b6ff9a' : '#95661a'
      ctx.fillText(String(lineNumber).padStart(3, ' '), x + gutterWidth + 2, rowY)
      ctx.textAlign = 'left'

      // Current-instruction arrow.
      if (isCurrent) {
        ctx.fillStyle = '#b6ff9a'
        ctx.fillText('▶', x + 16, rowY)
      }

      this.drawCodeLine(ctx, line, textX, rowY, maxTextWidth, style.normalFont)
    }
  }

  private drawMachine(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    style: {
      fontSize: number
      lineHeight: number
      tinyFont: string
      normalFont: string
      boldFont: string
      frameProgress: number
      textProgress: number
      snapshot: ProcessorSnapshot
    },
  ): void {
    this.drawPaneFrame(ctx, x, y, width, height, this.activePane === 'machine', style.frameProgress)
    ctx.font = style.boldFont
    ctx.fillStyle = '#ffd02f'
    ctx.fillText(this.language === 'ru' ? 'ПРОЦЕССОР' : 'PROCESSOR', x + 6, y + 5)

    let cursorY = y + style.lineHeight * 1.7
    const innerX = x + 7
    const innerWidth = Math.max(20, width - 14)
    ctx.font = style.tinyFont

    const line = (label: string, value: string, color: string): void => {
      ctx.textAlign = 'left'
      ctx.fillStyle = '#c39a37'
      ctx.fillText(label, innerX, cursorY, innerWidth)
      ctx.textAlign = 'right'
      ctx.fillStyle = color
      ctx.fillText(value, innerX + innerWidth, cursorY, innerWidth)
      ctx.textAlign = 'left'
      cursorY += style.lineHeight
    }

    const stateColor = style.snapshot.state === 'error'
      ? '#ff805b'
      : style.snapshot.state === 'halted'
        ? '#ffd166'
        : style.snapshot.state === 'running'
          ? '#b6ff9a'
          : '#8fc0ff'
    line(this.language === 'ru' ? 'СОСТОЯНИЕ' : 'STATE', style.snapshot.state.toUpperCase(), stateColor)
    line('PC', String(style.snapshot.pc), '#eaffea')
    line(this.language === 'ru' ? 'ТАКТЫ' : 'TICKS', String(style.snapshot.ticks), '#eaffea')
    line('CMP', style.snapshot.comparison === null ? '—' : style.snapshot.comparison > 0 ? '>' : style.snapshot.comparison < 0 ? '<' : '=', '#eaffea')

    cursorY += 3
    ctx.fillStyle = '#8a6a3a'
    ctx.fillText(this.language === 'ru' ? 'РЕГИСТРЫ' : 'REGISTERS', innerX, cursorY)
    cursorY += style.lineHeight
    for (let i = 0; i < REGISTER_COUNT; i += 1) {
      const value = style.snapshot.registers[i] ?? 0
      ctx.textAlign = 'left'
      ctx.fillStyle = '#c39a37'
      ctx.fillText(`R${i}`, innerX, cursorY)
      ctx.fillStyle = '#f0e2b0'
      const hex = value.toString(16).toUpperCase().padStart(4, '0')
      ctx.fillText(`${String(value).padStart(5, ' ')}  #0x${hex}`, innerX + 34, cursorY, innerWidth - 34)
      ctx.textAlign = 'left'
      cursorY += style.lineHeight
    }

    // RAM preview: first rows, 16 cells wide, with the last written value marked.
    cursorY += 3
    ctx.fillStyle = '#8a6a3a'
    ctx.fillText(this.language === 'ru' ? `RAM (0..${RAM_SIZE - 1})` : `RAM (0..${RAM_SIZE - 1})`, innerX, cursorY)
    cursorY += style.lineHeight
    const cellWidth = Math.max(24, Math.min(38, innerWidth / RAM_COLUMNS))
    for (let row = 0; row < RAM_PREVIEW_ROWS; row += 1) {
      ctx.fillStyle = '#8a6a3a'
      ctx.fillText(String(row * RAM_COLUMNS).padStart(3, ' '), innerX, cursorY)
      for (let col = 0; col < RAM_COLUMNS; col += 1) {
        const address = row * RAM_COLUMNS + col
        const value = style.snapshot.ram[address] ?? 0
        ctx.fillStyle = value === 0 ? '#5a4a22' : '#f0e2b0'
        ctx.fillText(value === 0 ? '·' : value.toString(16).toUpperCase().padStart(2, '0'), innerX + 26 + col * cellWidth, cursorY)
      }
      cursorY += style.lineHeight
    }

    void clamp01(this.appearTime / APPEAR_TEXT)
    void style.textProgress
  }

  private drawFooter(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    style: { tinyFont: string; boldFont: string; footerAlpha: number; snapshot: ProcessorSnapshot },
  ): void {
    ctx.save()
    ctx.globalAlpha = style.footerAlpha
    ctx.fillStyle = '#351a00'
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = '#b87b00'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)

    const pad = 9
    ctx.font = style.tinyFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    // Status / error line.
    const statusColor = this.messageIsError ? '#ff805b' : '#f0bb35'
    ctx.fillStyle = statusColor
    ctx.fillText(this.fitText(ctx, this.message || (this.language === 'ru' ? 'ГОТОВО' : 'READY'), width - pad * 2), x + pad, y + 6)

    // Diagnostics list (first three).
    let cursorY = y + 6 + Math.ceil(11 * 1.4)
    const diagnostics = this.debugger.errors.slice(0, 3)
    if (diagnostics.length) {
      ctx.fillStyle = '#ff9861'
      for (const diagnostic of diagnostics) {
        const text = `L${diagnostic.line}  ${diagnostic.code}  ${diagnostic.message}`
        ctx.fillText(this.fitText(ctx, text, width - pad * 2), x + pad, cursorY)
        cursorY += Math.ceil(11 * 1.35)
      }
    } else {
      // Device panel: name, current value, last direction.
      const devices = DEMO_DEVICES
      ctx.fillStyle = '#8fce9f'
      for (const device of devices) {
        const value = this.deviceValue(device.name)
        const text = `${device.name.padEnd(6, ' ')} ${String(value).padStart(5, ' ')}  ${device.description}`
        ctx.fillStyle = device.name === 'MOTOR' && value > 0 ? '#b6ff9a' : '#8fce9f'
        ctx.fillText(this.fitText(ctx, text, width - pad * 2), x + pad, cursorY)
        cursorY += Math.ceil(11 * 1.35)
      }
    }

    // Control hints pinned to the bottom.
    const hints = this.language === 'ru'
      ? 'F5/R ЗАПУСК · F8/S ШАГ · F9/G СБРОС · F10/B ТОЧКА ОСТАНОВА · C СБОРКА · TAB ПАНЕЛЬ · ↑↓ СТРОКА · ESC ВЫХОД'
      : 'F5/R RUN · F8/S STEP · F9/G RESET · F10/B BREAKPOINT · C COMPILE · TAB PANE · ↑↓ LINE · ESC EXIT'
    ctx.fillStyle = '#c39a37'
    ctx.fillText(this.fitText(ctx, hints, width - pad * 2), x + pad, y + height - Math.ceil(11 * 1.6))
    ctx.restore()
  }

  private deviceValue(name: string): number {
    const source = this.scenario?.bus
    if (!source) return 0
    const result = source.read(name)
    return result.ok ? result.value : 0
  }

  // -------------------------------------------------------------- primitives

  private drawPaneFrame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    active: boolean,
    progress = 1,
  ): void {
    if (width <= 0 || height <= 0 || progress <= 0) return
    const drawnWidth = width * progress
    const drawnX = x + (width - drawnWidth) / 2
    ctx.save()
    ctx.globalAlpha = progress
    ctx.fillStyle = '#2d1600'
    ctx.fillRect(drawnX, y, drawnWidth, height)
    ctx.strokeStyle = progress >= 1 ? (active ? '#ffe33c' : '#8d5b00') : '#ffd76a'
    ctx.lineWidth = active ? 1.5 : 1
    ctx.strokeRect(drawnX + 0.5, y + 0.5, Math.max(1, drawnWidth - 1), height - 1)
    ctx.restore()
  }

  private drawCodeLine(
    ctx: CanvasRenderingContext2D,
    line: string,
    x: number,
    y: number,
    maxWidth: number,
    normalFont: string,
  ): void {
    ctx.font = normalFont
    const value = this.fitText(ctx, line, maxWidth)
    if (/^\s*;/.test(line)) ctx.fillStyle = '#c28a2b'
    else if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) ctx.fillStyle = '#7de5ff'
    else if (/^\s*(HALT|NOP)\b/i.test(line)) ctx.fillStyle = '#ff9861'
    else if (/^\s*(JMP|JE|JNE|JGT|JGE|JLT|JLE)\b/i.test(line)) ctx.fillStyle = '#ffe064'
    else ctx.fillStyle = '#ffdf9b'
    ctx.fillText(value, x, y, maxWidth)
  }

  private fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (maxWidth <= 0) return ''
    if (ctx.measureText(text).width <= maxWidth) return text
    let fitted = text
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1)
    return `${fitted}…`
  }
}

/** Diagnostics summary used by the console `rasm check` output. */
export { formatDiagnostics }
