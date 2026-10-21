import type { DeviceBus } from '../rasm/bus'
import type { Diagnostic } from '../rasm/types'

/**
 * Robot runtime — shared types.
 *
 * The runtime is the layer that turns files into processes: it compiles RASM
 * sources, hands every one of them a PID, schedules their execution against
 * the robot's real compute budget, and exposes the control verbs the shell and
 * the task manager need.
 *
 * The module is free of any UI or DOM dependency, so the whole runtime can be
 * unit-tested in plain Node, exactly like the RASM language core.
 */

/** Console languages the runtime speaks. Structurally identical to GameLanguage. */
export type RuntimeLanguage = 'ru' | 'en'

/** A line of text that exists in both console languages. */
export interface LocalText {
  ru: string
  en: string
}

/**
 * Lifecycle of a user program on the robot.
 *
 * RUNNING   — executing under the scheduler.
 * DEGRADED  — executing, but the hardware it touches is only partly healthy.
 * WAITING   — the robot cannot run it right now (compute unit unavailable).
 * SUSPENDED — paused by the operator or by a safety interlock.
 * STOPPED   — finished (HALT) or terminated by the operator.
 * FAULT     — stopped by a runtime error.
 */
export type RobotProgramState =
  | 'RUNNING'
  | 'DEGRADED'
  | 'WAITING'
  | 'SUSPENDED'
  | 'STOPPED'
  | 'FAULT'

/** One program running (or finished running) on the robot. */
export interface RobotProgram {
  pid: number
  name: string
  /** Source path the program was launched from, when it came from storage. */
  path: string | null
  state: RobotProgramState
  /** Instructions executed since the process was created. */
  instructions: number
  /** Share of the compute budget the process holds, in percent. */
  cpuPercent: number
  memoryKb: number
  /** Scheduling weight; a higher value means a larger share of the budget. */
  priority: number
  /** Human-readable status line for the task manager and the shell. */
  detail: LocalText
  /** Last runtime error message, or null. */
  error: string | null
  /** Source line of the last error, or null. */
  errorLine: number | null
  /** True when the process was terminated by the operator. */
  killed: boolean
}

/** Why a launch was refused. */
export type LaunchFailureCode =
  | 'COMPILE_ERROR'
  | 'HARDWARE_BLOCKED'
  | 'LIMIT_REACHED'
  | 'NO_SOURCE'

/** Outcome of a launch attempt. */
export interface LaunchResult {
  ok: boolean
  /** PID of the created process; null when the launch was refused. */
  pid: number | null
  name: string
  /** Machine-readable failure reason, or null on success. */
  code: LaunchFailureCode | null
  /** Human-readable reason, localized. */
  message: LocalText
  /** Compiler diagnostics, when the source did not build. */
  diagnostics?: Diagnostic[]
}

/**
 * The bus the kernel expects: a normal RASM device bus plus two runtime
 * specific readings — whether the last access hit degraded hardware, and the
 * value of a kernel latch a program wrote.
 */
export interface RobotBus extends DeviceBus {
  /** True when the last successful access touched a DEGRADED component. */
  lastAccessDegraded(): boolean
  /** Read a kernel latch (for example BOOT) written by a program. */
  getLatch(name: string): number
  /** Drop every latch, so a new run starts from a clean state. */
  clearLatches(): void
}
