import type { DeviceBus } from './bus'
import { compileProgram, isRunnable } from './compiler'
import { Processor, type ProcessorSnapshot, type ProcessorOptions } from './processor'
import type { CompiledProgram, Diagnostic } from './types'

/** Result of compiling and loading a source file through the debugger. */
export interface LoadResult {
  ok: boolean
  program: CompiledProgram
  diagnostics: Diagnostic[]
}

export interface DebuggerRunResult {
  executed: number
  reason: 'halted' | 'completed' | 'error' | 'budget' | 'breakpoint' | 'stopped'
  snapshot: ProcessorSnapshot
}

export interface DebuggerOptions extends ProcessorOptions {
  /** Optional callback when a breakpoint is reached (used to fire SFX in the UI). */
  onBreakpoint?: (line: number) => void
}

/**
 * High-level debug session over the processor.
 *
 * Owns the source, the compiled program and the breakpoint set, and exposes the
 * operations the in-game window needs: `load`, `step`, `run`, `stop`, `reset`,
 * `setBreakpoint`, plus snapshots for registers/RAM/current line.
 *
 * Like the rest of the core this class has no UI dependency: the window drives
 * it and renders its snapshot.
 */
export class Debugger {
  private readonly bus: DeviceBus | null
  private readonly onBreakpoint?: (line: number) => void
  private readonly processor: Processor

  private source = ''
  private program: CompiledProgram | null = null
  private diagnostics: Diagnostic[] = []
  /** Source lines (1-based) that pause execution. */
  private breakpoints = new Set<number>()
  /** Set while a `run()` loop is in flight, so `stop()` can interrupt it. */
  private stopRequested = false

  constructor(options: DebuggerOptions = {}) {
    this.bus = options.bus ?? null
    this.onBreakpoint = options.onBreakpoint
    this.processor = new Processor({
      bus: options.bus,
      defaultStepBudget: options.defaultStepBudget,
      busTraceLimit: options.busTraceLimit,
    })
  }

  get deviceBus(): DeviceBus | null {
    return this.bus
  }

  get compiledProgram(): CompiledProgram | null {
    return this.program
  }

  get currentSource(): string {
    return this.source
  }

  get errors(): readonly Diagnostic[] {
    return this.diagnostics
  }

  getBreakpoints(): number[] {
    return [...this.breakpoints].sort((a, b) => a - b)
  }

  // -------------------------------------------------------------------- load

  /**
   * Compile and load source text. On compile errors the processor is reset and
   * nothing is loaded, so an invalid program can never be executed by mistake.
   */
  load(source: string): LoadResult {
    this.source = source
    const program = compileProgram(source)
    this.program = program
    this.diagnostics = [...program.diagnostics]

    if (!isRunnable(program)) {
      // Clear machine state: an inconsistent program must not stay loaded.
      this.processor.load({ instructions: [], labels: new Map(), lineToAddress: new Map(), diagnostics: program.diagnostics })
      return { ok: false, program, diagnostics: this.diagnostics }
    }

    this.processor.load(program)
    return { ok: true, program, diagnostics: this.diagnostics }
  }

  hasProgram(): boolean {
    return this.processor.hasProgram()
  }

  // --------------------------------------------------------------- execution

  /** Execute a single instruction. Returns true when one ran. */
  step(): boolean {
    return this.processor.step()
  }

  /**
   * Why the next `step()` would not run (halted, faulted, or nothing loaded),
   * or null when it can. Lets the UI explain a refusal precisely.
   */
  explainStep(): Diagnostic | null {
    return this.processor.explainStep()
  }

  /**
   * Run until HALT/end/error, a breakpoint, an explicit `stop()`, or the
   * step budget. The processor's own budget guard is reused for the whole loop,
   * so an infinite loop ends with a `STEP_BUDGET_EXCEEDED` diagnostic.
   */
  run(stepBudget?: number): DebuggerRunResult {
    if (!this.processor.hasProgram()) {
      return { executed: 0, reason: 'error', snapshot: this.snapshot() }
    }
    this.stopRequested = false
    const limit = stepBudget ?? 10000
    let executed = 0

    while (executed < limit) {
      if (this.stopRequested) {
        return { executed, reason: 'stopped', snapshot: this.snapshot() }
      }

      const nextLine = this.processor.currentSourceLine
      // A breakpoint pauses *before* the instruction on that line runs.
      if (executed > 0 && nextLine !== null && this.breakpoints.has(nextLine)) {
        this.onBreakpoint?.(nextLine)
        // A callback may ask to stop entirely; report that instead of a pause.
        if (this.stopRequested) {
          return { executed, reason: 'stopped', snapshot: this.snapshot() }
        }
        return { executed, reason: 'breakpoint', snapshot: this.snapshot() }
      }

      const ran = this.processor.step()
      if (!ran) {
        const state = this.processor.currentState
        return {
          executed,
          reason: state === 'error' ? 'error' : 'completed',
          snapshot: this.snapshot(),
        }
      }
      executed += 1

      const snapshot = this.processor.snapshot()
      if (snapshot.state === 'error') {
        return { executed, reason: 'error', snapshot }
      }
      if (snapshot.state === 'halted') {
        return { executed, reason: 'halted', snapshot }
      }
    }

    // Budget exhausted by the debugger loop itself. Latch the same diagnostic
    // the processor's own `run()` would produce, so the UI can explain it.
    this.processor.latchBudgetError(limit)
    return { executed, reason: 'budget', snapshot: this.snapshot() }
  }

  /** Ask an in-flight `run()` to stop at the next iteration. */
  stop(): void {
    this.stopRequested = true
  }

  reset(): void {
    this.processor.reset()
  }

  halt(): void {
    this.processor.halt()
  }

  // -------------------------------------------------------------- breakpoints

  /** Toggle a breakpoint on a source line. Returns the new state. */
  toggleBreakpoint(line: number): boolean {
    if (line < 1) return false
    if (this.breakpoints.has(line)) {
      this.breakpoints.delete(line)
      return false
    }
    this.breakpoints.add(line)
    return true
  }

  setBreakpoint(line: number, enabled: boolean): void {
    if (line < 1) return
    if (enabled) this.breakpoints.add(line)
    else this.breakpoints.delete(line)
  }

  hasBreakpoint(line: number): boolean {
    return this.breakpoints.has(line)
  }

  clearBreakpoints(): void {
    this.breakpoints.clear()
  }

  // ------------------------------------------------------------- inspection

  snapshot(): ProcessorSnapshot {
    return this.processor.snapshot()
  }

  get processorState(): Processor {
    return this.processor
  }

  /** Instruction index for a source line, used by "run to line" style features. */
  addressForLine(line: number): number | null {
    return this.program?.lineToAddress.get(line) ?? null
  }
}
