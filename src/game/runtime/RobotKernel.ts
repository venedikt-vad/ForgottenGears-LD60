import { compileProgram, isRunnable } from '../rasm/compiler'
import { Processor } from '../rasm/processor'
import type { RobotSystem } from '../Game'
import type { LaunchResult, LocalText, RobotBus, RobotProgram, RobotProgramState } from './types'

/**
 * The robot's process table and scheduler.
 *
 * A program becomes a process here: it is compiled, checked against the
 * machine's condition, given a PID, and then executed under a budget that the
 * robot's compute unit provides. The kernel never touches the UI — the shell,
 * the task manager and the game loop talk to it through the same API.
 */

export interface RobotKernelOptions {
  system: RobotSystem
  bus: RobotBus
  /** Maximum number of live user programs. */
  maxPrograms?: number
  /** Instructions the compute unit retires per second at full speed. */
  instructionsPerSecond?: number
  /** Instructions one program may execute before the watchdog terminates it. */
  lifetimeInstructionLimit?: number
}

interface KernelProcess {
  record: RobotProgram
  processor: Processor
  /** The source, kept so a process can be restarted without the file system. */
  source: string
  /** Set when the operator suspended the process, as opposed to an interlock. */
  operatorSuspended: boolean
}

const DEFAULT_MAX_PROGRAMS = 8
const DEFAULT_INSTRUCTIONS_PER_SECOND = 900
const DEFAULT_LIFETIME_LIMIT = 500_000

/** First PID handed out. Service PIDs live below 100, so user programs start there. */
const FIRST_PID = 100

/** Components that must be alive before any program may run. */
const COMPUTE_CHAIN = ['CPU-730', 'OSK-710'] as const

/** Component whose health decides how fast programs retire instructions. */
const COMPUTE_UNIT = 'CPU-730'
const MEMORY_UNIT = 'MEM-732'

/** A program name derived from its path, e.g. `/opt/x/y.rasm` -> `y`. */
function nameFromPath(path: string | undefined): string | null {
  if (!path) return null
  const file = path.split('/').filter(Boolean).pop()
  if (!file) return null
  return file.replace(/\.[a-z0-9]+$/i, '') || file
}

export class RobotKernel {
  private readonly system: RobotSystem
  private readonly bus: RobotBus
  private readonly maxPrograms: number
  private readonly instructionsPerSecond: number
  private readonly lifetimeLimit: number

  private readonly processes = new Map<number, KernelProcess>()
  private nextPid = FIRST_PID

  constructor(options: RobotKernelOptions) {
    this.system = options.system
    this.bus = options.bus
    this.maxPrograms = options.maxPrograms ?? DEFAULT_MAX_PROGRAMS
    this.instructionsPerSecond = options.instructionsPerSecond ?? DEFAULT_INSTRUCTIONS_PER_SECOND
    this.lifetimeLimit = options.lifetimeInstructionLimit ?? DEFAULT_LIFETIME_LIMIT
  }

  // ----------------------------------------------------------------- launch

  /**
   * Compile a source and start it as a process.
   *
   * The launch is refused when the source does not build, when the compute
   * chain is down, or when too many programs are already live. The refusal
   * message names the component that blocks the run, so the operator knows
   * what to repair.
   */
  launch(
    source: string,
    options: { name?: string; path?: string; priority?: number } = {},
  ): LaunchResult {
    const name = options.name ?? nameFromPath(options.path) ?? 'program'
    const text = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    if (!text.trim()) {
      return this.refusal('NO_SOURCE', name, {
        ru: 'Источник пуст: запускать нечего.',
        en: 'The source is empty: there is nothing to run.',
      })
    }

    const program = compileProgram(text)
    if (!isRunnable(program)) {
      return {
        ok: false,
        pid: null,
        name,
        code: 'COMPILE_ERROR',
        message: {
          ru: `Сборка не удалась: ошибок — ${program.diagnostics.length}.`,
          en: `Compilation failed: ${program.diagnostics.length} errors.`,
        },
        diagnostics: program.diagnostics,
      }
    }

    const blocked = this.computeBlockedReason()
    if (blocked) return this.refusal('HARDWARE_BLOCKED', name, blocked)

    if (this.liveCount() >= this.maxPrograms) {
      return this.refusal('LIMIT_REACHED', name, {
        ru: `Достигнут лимит одновременно работающих программ: ${this.maxPrograms}.`,
        en: `Too many programs are running at once: ${this.maxPrograms}.`,
      })
    }

    const processor = new Processor({ bus: this.bus })
    processor.load(program)

    const pid = this.nextPid
    this.nextPid += 1

    const record: RobotProgram = {
      pid,
      name,
      path: options.path ?? null,
      state: 'RUNNING',
      instructions: 0,
      cpuPercent: 0,
      memoryKb: 0,
      priority: options.priority ?? 1,
      detail: { ru: 'Выполняется', en: 'Running' },
      error: null,
      errorLine: null,
      killed: false,
    }

    this.processes.set(pid, { record, processor, source: text, operatorSuspended: false })
    this.system.log('INFO', 'RUNTIME', `Process ${pid} (${name}) started.`)
    return {
      ok: true,
      pid,
      name,
      code: null,
      message: { ru: 'Процесс запущен.', en: 'Process started.' },
    }
  }

  // ------------------------------------------------------------------- tick

  /**
   * Advance every live program by one frame's worth of instructions.
   *
   * The budget scales with the compute unit's condition: a degraded CPU
   * retires fewer instructions, and a dead one leaves the programs waiting.
   */
  tick(dt: number): void {
    if (this.processes.size === 0) return

    const live = this.liveProcesses()
    if (live.length === 0) return

    const factor = this.computeFactor()
    if (factor <= 0) {
      for (const entry of live) {
        entry.record.state = 'WAITING'
        entry.record.cpuPercent = 0
        entry.record.detail = {
          ru: `Ожидание: ${COMPUTE_UNIT} недоступен`,
          en: `Waiting: ${COMPUTE_UNIT} is unavailable`,
        }
      }
      return
    }

    const frame = Math.min(Math.max(dt, 0), 0.1)
    const totalBudget = Math.max(1, Math.round(this.instructionsPerSecond * factor * frame))
    const weightSum = live.reduce((sum, entry) => sum + Math.max(0.1, entry.record.priority), 0)

    for (const entry of live) {
      const share = Math.max(0.1, entry.record.priority) / weightSum
      this.execute(entry, Math.max(1, Math.round(totalBudget * share)), totalBudget)
    }
  }

  // ---------------------------------------------------------------- control

  /** Terminate a process. Returns false when the PID is unknown or already over. */
  kill(pid: number): boolean {
    const entry = this.processes.get(pid)
    if (!entry) return false
    if (entry.record.state === 'STOPPED' || entry.record.state === 'FAULT') return false
    entry.processor.halt()
    entry.record.state = 'STOPPED'
    entry.record.killed = true
    entry.record.cpuPercent = 0
    entry.record.detail = { ru: 'Завершён оператором', en: 'Terminated by operator' }
    this.system.log('INFO', 'RUNTIME', `Process ${pid} (${entry.record.name}) terminated.`)
    return true
  }

  /** Pause a process; it keeps its state and resumes where it stopped. */
  suspend(pid: number): boolean {
    const entry = this.processes.get(pid)
    if (!entry) return false
    if (entry.record.state === 'STOPPED' || entry.record.state === 'FAULT') return false
    entry.operatorSuspended = true
    entry.record.state = 'SUSPENDED'
    entry.record.cpuPercent = 0
    entry.record.detail = { ru: 'Приостановлен оператором', en: 'Suspended by operator' }
    return true
  }

  /** Continue a suspended process. */
  resume(pid: number): boolean {
    const entry = this.processes.get(pid)
    if (!entry) return false
    entry.operatorSuspended = false
    if (entry.record.state === 'SUSPENDED') {
      entry.record.state = 'RUNNING'
      entry.record.detail = { ru: 'Выполняется', en: 'Running' }
    }
    return true
  }

  /** Restart a process from its source, clearing the error state. */
  reset(pid: number): boolean {
    const entry = this.processes.get(pid)
    if (!entry) return false
    const program = compileProgram(entry.source)
    if (!isRunnable(program)) return false
    entry.processor.load(program)
    entry.record.state = 'RUNNING'
    entry.record.instructions = 0
    entry.record.cpuPercent = 0
    entry.record.memoryKb = 0
    entry.record.error = null
    entry.record.errorLine = null
    entry.record.killed = false
    entry.operatorSuspended = false
    entry.record.detail = { ru: 'Перезапущен', en: 'Restarted' }
    this.system.log('INFO', 'RUNTIME', `Process ${pid} (${entry.record.name}) restarted.`)
    return true
  }

  /** Change the scheduling weight of a process. */
  setPriority(pid: number, priority: number): boolean {
    const entry = this.processes.get(pid)
    if (!entry) return false
    entry.record.priority = Math.max(0.1, Math.min(10, priority))
    return true
  }

  // ------------------------------------------------------------- inspection

  /**
   * Read a kernel latch a program has written (BOOT, DIAG).
   *
   * The kernel owns the bus, so the shell reads the outcome of a program
   * through the same handle it launched the program with.
   */
  readLatch(name: string): number {
    return this.bus.getLatch(name)
  }

  /** Clear every latch, so the next run reports its own result only. */
  resetLatches(): void {
    this.bus.clearLatches()
  }

  /** The hardware bus this kernel schedules programs on. */
  get deviceBus(): RobotBus {
    return this.bus
  }

  /** Every process launched from a given path, live ones first. */
  listByPath(path: string): RobotProgram[] {
    const normalized = path.trim().toLowerCase()
    return this.list().filter((program) => (program.path ?? '').toLowerCase() === normalized)
  }

  /** Every known process, live ones first. */
  list(): RobotProgram[] {
    const order: Record<RobotProgramState, number> = {
      RUNNING: 0,
      DEGRADED: 1,
      WAITING: 2,
      SUSPENDED: 3,
      STOPPED: 4,
      FAULT: 5,
    }
    return [...this.processes.values()]
      .map((entry) => entry.record)
      .sort((a, b) => order[a.state] - order[b.state] || a.pid - b.pid)
  }

  /** One process by PID, or undefined. */
  get(pid: number): RobotProgram | undefined {
    return this.processes.get(pid)?.record
  }

  /** Number of processes that still occupy the machine. */
  liveCount(): number {
    return this.liveProcesses().length
  }

  /** Drop every process, for example when the robot reboots. */
  clear(): void {
    this.processes.clear()
    this.nextPid = FIRST_PID
  }

  // -------------------------------------------------------------- internals

  private liveProcesses(): KernelProcess[] {
    return [...this.processes.values()].filter(
      (entry) => entry.record.state === 'RUNNING' || entry.record.state === 'DEGRADED',
    )
  }

  private execute(entry: KernelProcess, budget: number, totalBudget: number): void {
    const { record, processor } = entry
    let executed = 0

    while (executed < budget) {
      const ran = processor.step()
      if (!ran) break
      executed += 1
      record.instructions += 1
      if (record.instructions > this.lifetimeLimit) {
        this.fail(
          entry,
          `Execution exceeded the ${this.lifetimeLimit}-instruction limit.`,
          processor.currentSourceLine,
        )
        return
      }
    }

    record.cpuPercent = totalBudget > 0 ? Math.min(100, (executed / totalBudget) * 100) : 0
    record.memoryKb = 64 + Math.floor(record.instructions / 64)

    const state = processor.currentState
    if (state === 'error') {
      const error = processor.lastError
      this.fail(entry, error?.message ?? 'Runtime error.', error?.line ?? null)
      return
    }

    if (state === 'halted') {
      record.state = 'STOPPED'
      record.cpuPercent = 0
      record.detail = { ru: 'Завершён (HALT)', en: 'Completed (HALT)' }
      this.system.log('OK', 'RUNTIME', `Process ${record.pid} (${record.name}) finished.`)
      return
    }

    // The program is still alive: report degraded hardware when the last
    // access hit a component that is only half healthy.
    record.state = this.bus.lastAccessDegraded() ? 'DEGRADED' : 'RUNNING'
    record.detail = record.state === 'DEGRADED'
      ? { ru: 'Выполняется на неисправном узле', en: 'Running on a degraded unit' }
      : { ru: 'Выполняется', en: 'Running' }
  }

  private fail(entry: KernelProcess, message: string, line: number | null): void {
    const { record } = entry
    record.state = 'FAULT'
    record.cpuPercent = 0
    record.error = message
    record.errorLine = line
    record.detail = { ru: `Ошибка: ${message}`, en: `Error: ${message}` }
    this.system.log(
      'ERROR',
      'RUNTIME',
      `Process ${record.pid} (${record.name}) failed${line ? ` at line ${line}` : ''}: ${message}`,
    )
  }

  /** Why the machine cannot run programs right now, or null when it can. */
  private computeBlockedReason(): LocalText | null {
    for (const id of COMPUTE_CHAIN) {
      const status = this.system.getComponentStatus(id)
      if (status === 'ONLINE' || status === 'DEGRADED') continue
      const component = this.system.getComponent(id)
      const fault = component?.fault ? ` — ${component.fault}` : ''
      return {
        ru: `${id} недоступен (${status})${fault}. Программы не запускаются.`,
        en: `${id} is unavailable (${status})${fault}. Programs cannot start.`,
      }
    }
    return null
  }

  /**
   * How fast the machine can retire instructions right now: a fraction
   * between 0 and 1 of the full budget.
   */
  private computeFactor(): number {
    const cpu = this.system.getComponentStatus(COMPUTE_UNIT)
    if (cpu !== 'ONLINE' && cpu !== 'DEGRADED') return 0
    const memory = this.system.getComponentStatus(MEMORY_UNIT)
    return memory === 'ONLINE' ? 1 : 0.5
  }

  private refusal(code: LaunchResult['code'], name: string, message: LocalText): LaunchResult {
    return { ok: false, pid: null, name, code, message }
  }
}
