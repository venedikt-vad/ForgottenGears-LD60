import type { DeviceBus } from './bus'
import { isConditionalJump } from './isa'
import {
  RAM_SIZE,
  REGISTER_COUNT,
  WORD_MASK,
  WORD_MODULO,
  type CompiledInstruction,
  type CompiledProgram,
  type Diagnostic,
} from './types'

/** Three-way result of the last `CMP`, consumed by the conditional jumps. */
export type ComparisonFlag = -1 | 0 | 1

/** Why the processor is not running any more. */
export type ProcessorState = 'ready' | 'running' | 'halted' | 'error'

/** State of the last bus write, kept for the debugger's device panel. */
export interface BusTraceEntry {
  kind: 'in' | 'out'
  device: string
  value: number
  sourceLine: number
}

export interface ProcessorOptions {
  bus?: DeviceBus
  /** Instruction budget for a single `run()` call; stops runaway loops. */
  defaultStepBudget?: number
  /** How many bus trace entries to keep (ring buffer). */
  busTraceLimit?: number
}

/** Everything the debugger needs to render the machine after a step. */
export interface ProcessorSnapshot {
  state: ProcessorState
  pc: number
  registers: number[]
  ram: number[]
  comparison: ComparisonFlag | null
  ticks: number
  /** Source line of the instruction the PC points at, or null at the end. */
  currentLine: number | null
  /** The instruction at the PC, if any. */
  currentInstruction: CompiledInstruction | null
  error: Diagnostic | null
  busTrace: BusTraceEntry[]
}

const DEFAULT_STEP_BUDGET = 10000
const DEFAULT_TRACE_LIMIT = 16

/**
 * The RASM virtual processor.
 *
 * Registers, RAM and the comparison flag are plain typed values; program
 * memory is the compiled instruction list. `step()` executes at most one
 * instruction and returns whether one was executed, so the debugger can drive
 * the machine one tick at a time while `run()` applies a step budget.
 *
 * The processor holds no UI state and never touches the DOM.
 */
export class Processor {
  private readonly bus: DeviceBus | null
  private readonly defaultStepBudget: number
  private readonly busTraceLimit: number

  private program: CompiledInstruction[] = []
  private registers = new Array<number>(REGISTER_COUNT).fill(0)
  private ram = new Array<number>(RAM_SIZE).fill(0)
  private pc = 0
  private comparison: ComparisonFlag | null = null
  private state: ProcessorState = 'ready'
  private ticks = 0
  private error: Diagnostic | null = null
  private trace: BusTraceEntry[] = []
  /** Program identity tag used by `hasProgram`. */
  private loaded = false

  constructor(options: ProcessorOptions = {}) {
    this.bus = options.bus ?? null
    this.defaultStepBudget = options.defaultStepBudget ?? DEFAULT_STEP_BUDGET
    this.busTraceLimit = options.busTraceLimit ?? DEFAULT_TRACE_LIMIT
  }

  // ------------------------------------------------------------------ loading

  /**
   * Load a compiled program. Loading always resets registers, RAM, the
   * comparison flag, the tick counter and the error state, so a program never
   * inherits a previous run's memory.
   */
  load(program: CompiledProgram): void {
    this.program = program.instructions
    this.loaded = program.instructions.length > 0
    this.reset()
  }

  hasProgram(): boolean {
    return this.loaded
  }

  /** Reset registers, RAM, PC, flags and errors. The program stays loaded. */
  reset(): void {
    this.registers = new Array<number>(REGISTER_COUNT).fill(0)
    this.ram = new Array<number>(RAM_SIZE).fill(0)
    this.pc = 0
    this.comparison = null
    this.ticks = 0
    this.error = null
    this.trace = []
    this.state = this.loaded ? 'ready' : 'ready'
  }

  // --------------------------------------------------------------- inspection

  get currentState(): ProcessorState {
    return this.state
  }

  get programCounter(): number {
    return this.pc
  }

  get tickCount(): number {
    return this.ticks
  }

  get lastError(): Diagnostic | null {
    return this.error
  }

  get comparisonFlag(): ComparisonFlag | null {
    return this.comparison
  }

  get instructionCount(): number {
    return this.program.length
  }

  getRegister(index: number): number {
    return this.registers[index] ?? 0
  }

  getRam(address: number): number {
    return this.ram[address] ?? 0
  }

  /** Set a register directly; used by tests and the debugger's edit mode. */
  setRegister(index: number, value: number): void {
    if (index < 0 || index >= REGISTER_COUNT) return
    this.registers[index] = ((value % WORD_MODULO) + WORD_MODULO) % WORD_MODULO
  }

  setRam(address: number, value: number): void {
    if (address < 0 || address >= RAM_SIZE) return
    this.ram[address] = ((value % WORD_MODULO) + WORD_MODULO) % WORD_MODULO
  }

  /** The instruction at a program address, or null when out of range. */
  instructionAt(address: number): CompiledInstruction | null {
    return this.program[address] ?? null
  }

  /** Source line currently pointed at by the PC, or null when the PC is past the end. */
  get currentSourceLine(): number | null {
    return this.program[this.pc]?.sourceLine ?? null
  }

  currentInstruction(): CompiledInstruction | null {
    return this.program[this.pc] ?? null
  }

  snapshot(): ProcessorSnapshot {
    return {
      state: this.state,
      pc: this.pc,
      registers: [...this.registers],
      ram: [...this.ram],
      comparison: this.comparison,
      ticks: this.ticks,
      currentLine: this.currentSourceLine,
      currentInstruction: this.currentInstruction(),
      error: this.error,
      busTrace: [...this.trace],
    }
  }

  // ------------------------------------------------------------------ stepping

  /**
   * Explain why `step()` would not run, without changing machine state.
   *
   * Returns a `Diagnostic` for "execution after halt/fault" (`PROCESSOR_HALTED`)
   * and "no program loaded" (`PROGRAM_NOT_LOADED`), or `null` when the machine
   * can execute. The debugger and the window use this to show a precise reason
   * instead of a generic refusal.
   */
  explainStep(): Diagnostic | null {
    if (this.state === 'error') return this.error
    if (this.state === 'halted') {
      const atEnd = this.pc >= this.program.length
      return {
        code: 'PROCESSOR_HALTED',
        message: atEnd
          ? 'The program ran off the end and has stopped. Reset to run it again.'
          : 'The program reached HALT and has stopped. Reset to run it again.',
        phase: 'runtime',
        line: this.pc > 0 ? this.program[this.pc - 1]?.sourceLine ?? 0 : 0,
        column: null,
      }
    }
    if (!this.loaded) {
      return {
        code: 'PROGRAM_NOT_LOADED',
        message: 'No program is loaded. Compile and load a program first.',
        phase: 'runtime',
        line: 0,
        column: null,
      }
    }
    return null
  }

  /**
   * Execute exactly one instruction.
   *
   * Returns `true` when an instruction ran. Returns `false` when the machine is
   * halted, has errored, or has run off the end of the program. A conditional
   * jump before any `CMP` is a runtime error, never a silent false.
   */
  step(): boolean {
    if (this.state === 'halted' || this.state === 'error') return false
    if (!this.loaded) {
      this.fail('PROGRAM_NOT_LOADED', 'No program is loaded. Compile and load a program first.', null)
      return false
    }

    const instruction = this.program[this.pc]
    if (!instruction) {
      // Falling off the end is a normal stop, not a fault.
      this.state = 'halted'
      return false
    }

    this.ticks += 1
    this.bus?.tick(1)

    switch (instruction.opcode) {
      case 'NOP':
        this.pc += 1
        return true

      case 'MOV': {
        const destination = instruction.operands[0]!
        const source = instruction.operands[1]!
        this.writeRegister(destination.value, this.readValue(source))
        this.pc += 1
        return true
      }

      case 'LOAD': {
        const register = instruction.operands[0]!
        const address = instruction.operands[1]!
        this.writeRegister(register.value, this.readRam(address.value, instruction.sourceLine))
        if (this.error !== null) return true
        this.pc += 1
        return true
      }

      case 'STORE': {
        const address = instruction.operands[0]!
        const register = instruction.operands[1]!
        this.writeRam(address.value, this.readRegister(register.value), instruction.sourceLine)
        if (this.error !== null) return true
        this.pc += 1
        return true
      }

      case 'ADD': {
        const destination = instruction.operands[0]!
        const source = instruction.operands[1]!
        const value = (this.readRegister(destination.value) + this.readValue(source)) % WORD_MODULO
        this.writeRegister(destination.value, value)
        this.pc += 1
        return true
      }

      case 'SUB': {
        const destination = instruction.operands[0]!
        const source = instruction.operands[1]!
        const value = (this.readRegister(destination.value) - this.readValue(source) + WORD_MODULO) % WORD_MODULO
        this.writeRegister(destination.value, value)
        this.pc += 1
        return true
      }

      case 'CMP': {
        const left = this.readRegister(instruction.operands[0]!.value)
        const right = this.readValue(instruction.operands[1]!)
        this.comparison = left === right ? 0 : left < right ? -1 : 1
        this.pc += 1
        return true
      }

      case 'JMP': {
        this.pc = instruction.operands[0]!.value
        return true
      }

      case 'JE': case 'JNE': case 'JGT': case 'JGE': case 'JLT': case 'JLE': {
        const taken = this.evaluateJump(instruction, instruction.sourceLine)
        if (taken === null) return true // failed; state is 'error'
        this.pc = taken ? instruction.operands[0]!.value : this.pc + 1
        return true
      }

      case 'IN': {
        const register = instruction.operands[0]!
        const device = instruction.operands[1]!
        const deviceName = device.kind === 'device' ? device.name : device.text
        const result = this.bus?.read(deviceName)
        if (!result || !result.ok) {
          this.recordTrace('in', deviceName, 0, instruction.sourceLine)
          this.fail(
            result?.code ?? 'DEVICE_READ_ERROR',
            result ? result.error : `No device bus is connected; cannot read "${deviceName}".`,
            instruction.sourceLine,
          )
          return true
        }
        this.writeRegister(register.value, result.value)
        this.recordTrace('in', deviceName, result.value, instruction.sourceLine)
        this.pc += 1
        return true
      }

      case 'OUT': {
        const device = instruction.operands[0]!
        const value = this.readValue(instruction.operands[1]!)
        const deviceName = device.kind === 'device' ? device.name : device.text
        const result = this.bus?.write(deviceName, value)
        if (!result || !result.ok) {
          this.recordTrace('out', deviceName, value, instruction.sourceLine)
          this.fail(
            result?.code ?? 'DEVICE_WRITE_ERROR',
            result ? result.error : `No device bus is connected; cannot write "${deviceName}".`,
            instruction.sourceLine,
          )
          return true
        }
        this.recordTrace('out', deviceName, value, instruction.sourceLine)
        this.pc += 1
        return true
      }

      case 'HALT': {
        this.state = 'halted'
        return true
      }

      default: {
        // Unreachable for compiled programs; compiled opcodes always match the ISA.
        this.fail('UNKNOWN_INSTRUCTION', `Cannot execute unknown opcode "${instruction.opcode}".`, instruction.sourceLine)
        return true
      }
    }
  }

  /**
   * Run until HALT, an error, or the step budget is exhausted.
   *
   * The budget is the guard against infinite loops: the caller gets a
   * `STEP_BUDGET_EXCEEDED` diagnostic instead of a frozen UI. Returns the
   * number of instructions actually executed.
   */
  run(stepBudget = this.defaultStepBudget): number {
    if (this.state === 'halted' || this.state === 'error') return 0
    if (!this.loaded) {
      this.fail('PROGRAM_NOT_LOADED', 'No program is loaded. Compile and load a program first.', null)
      return 0
    }
    if (stepBudget <= 0) return 0

    this.state = 'running'
    let executed = 0
    while (executed < stepBudget) {
      if (this.state !== 'running') break
      const ran = this.step()
      if (!ran) break
      executed += 1
    }

    if (this.state === 'running') {
      // Budget exhausted while still executing: report it and stop cleanly.
      this.fail(
        'STEP_BUDGET_EXCEEDED',
        `Execution exceeded the ${stepBudget}-instruction budget. Check for an infinite loop.`,
        this.currentSourceLine,
      )
    }
    return executed
  }

  /** Explicitly stop a running machine without marking it as an error. */
  halt(): void {
    if (this.state === 'ready') this.state = 'halted'
    else if (this.state === 'running') this.state = 'halted'
  }

  /**
   * Record a `STEP_BUDGET_EXCEEDED` fault. Hosts that drive `step()` themselves
   * (the debugger, so it can check breakpoints between instructions) call this
   * when their own instruction limit is reached, so the machine stops with the
   * same diagnostic `run()` would have produced.
   */
  latchBudgetError(stepBudget: number): void {
    if (this.state === 'halted' || this.state === 'error') return
    this.fail(
      'STEP_BUDGET_EXCEEDED',
      `Execution exceeded the ${stepBudget}-instruction budget. Check for an infinite loop.`,
      this.currentSourceLine,
    )
  }

  // ------------------------------------------------------------------ internals

  /** Read a value operand: a register's content or an immediate literal. */
  private readValue(operand: CompiledInstruction['operands'][number]): number {
    if (operand.kind === 'register') return this.readRegister(operand.value)
    return operand.value & WORD_MASK
  }

  private readRegister(index: number): number {
    if (index < 0 || index >= REGISTER_COUNT) {
      this.fail('BAD_REGISTER', `Register index ${index} is out of range.`, this.currentSourceLine)
      return 0
    }
    return this.registers[index] ?? 0
  }

  private writeRegister(index: number, value: number): void {
    if (index < 0 || index >= REGISTER_COUNT) {
      this.fail('BAD_REGISTER', `Register index ${index} is out of range.`, this.currentSourceLine)
      return
    }
    this.registers[index] = ((value % WORD_MODULO) + WORD_MODULO) % WORD_MODULO
  }

  private readRam(address: number, line: number): number {
    if (address < 0 || address >= RAM_SIZE) {
      this.fail('INVALID_RAM_ACCESS', `RAM address ${address} is out of range (0..${RAM_SIZE - 1}).`, line)
      return 0
    }
    return this.ram[address] ?? 0
  }

  private writeRam(address: number, value: number, line: number): void {
    if (address < 0 || address >= RAM_SIZE) {
      this.fail('INVALID_RAM_ACCESS', `RAM address ${address} is out of range (0..${RAM_SIZE - 1}).`, line)
      return
    }
    this.ram[address] = ((value % WORD_MODULO) + WORD_MODULO) % WORD_MODULO
  }

  /**
   * Evaluate a conditional jump. Returns `true`/`false` for the branch, or
   * `null` when the machine failed because no `CMP` ran first.
   */
  private evaluateJump(instruction: CompiledInstruction, line: number): boolean | null {
    if (this.comparison === null) {
      this.fail(
        'COMPARE_NOT_SET',
        `${instruction.opcode} cannot run before a CMP. Compare two values first.`,
        line,
      )
      return null
    }
    const flag = this.comparison
    switch (instruction.opcode) {
      case 'JE': return flag === 0
      case 'JNE': return flag !== 0
      case 'JGT': return flag > 0
      case 'JGE': return flag >= 0
      case 'JLT': return flag < 0
      case 'JLE': return flag <= 0
      default: return false
    }
  }

  private recordTrace(kind: 'in' | 'out', device: string, value: number, sourceLine: number): void {
    this.trace.push({ kind, device, value, sourceLine })
    if (this.trace.length > this.busTraceLimit) this.trace.splice(0, this.trace.length - this.busTraceLimit)
  }

  /** Latch a runtime error with its source line, then stop the machine. */
  private fail(
    code: Diagnostic['code'],
    message: string,
    line: number | null,
  ): void {
    this.error = {
      code,
      message,
      phase: 'runtime',
      line: line ?? 0,
      column: null,
    }
    this.state = 'error'
  }
}

/** Re-export so hosts can build a processor and check conditions in one import. */
export { isConditionalJump }

/** True when a diagnostic code stops execution. */
export function isFatalDiagnostic(code: Diagnostic['code']): boolean {
  return code !== 'STEP_BUDGET_EXCEEDED'
}
