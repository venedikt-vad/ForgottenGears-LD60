/**
 * Shape of one shipped service program.
 *
 * Every row of the task manager is a real process of the machine. A service
 * source binds the process to the RASM file it is built from, so the operator
 * can open it from the task manager, read it, edit it and launch it again with
 * `run`.
 */
export interface ServiceProgram {
  /** PID of the service row this source belongs to. */
  pid: number
  /** Process name, exactly as it appears in the task manager. */
  name: string
  /** File name inside SERVICE_PROGRAM_DIR. */
  file: string
  /** RASM 1.0 source. */
  source: string
}
