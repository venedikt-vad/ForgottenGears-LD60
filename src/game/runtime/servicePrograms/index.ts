/**
 * RASM sources of the robot's service processes.
 *
 * Every row of the task manager is a real process of the machine. This barrel
 * binds each service PID to the RASM file that the service is built from, so
 * the operator can open the source from the task manager, read it, edit it and
 * launch it again with `run`. The files are seeded into the virtual filesystem
 * by `VirtualFileSystem` and live under SERVICE_PROGRAM_DIR.
 *
 * Each service lives in its own module next to this file; see `types.ts` for
 * the shared shape. The scripts only use the robot's real ports (see
 * runtime/RobotDeviceBus), so they compile cleanly and can also be executed
 * against the hardware.
 */

import type { ServiceProgram } from './types'

import { kernelProgram } from './kernel'
import { cpuManagerProgram } from './cpuManager'
import { diagServiceProgram } from './diagService'
import { powerRouteProgram } from './powerRoute'
import { powerCoreProgram } from './powerCore'
import { batteryManagerProgram } from './batteryManager'
import { motionProfileProgram } from './motionProfile'
import { actuatorBusProgram } from './actuatorBus'
import { servoControlProgram } from './servoControl'
import { balanceEngineProgram } from './balanceEngine'
import { thermalMonitorProgram } from './thermalMonitor'
import { thermalProtectionProgram } from './thermalProtection'
import { visionStreamProgram } from './visionStream'
import { lidarScanProgram } from './lidarScan'
import { imuTelemetryProgram } from './imuTelemetry'
import { forceFeedbackProgram } from './forceFeedback'
import { analyzerServiceProgram } from './analyzerService'
import { networkLinkProgram } from './networkLink'
import { failsafeProgram } from './failsafe'
import { fileServiceProgram } from './fileService'
import { shellProgram } from './shell'
import { telemetryLogProgram } from './telemetryLog'

export type { ServiceProgram } from './types'

/** Directory that holds one RASM source per service process. */
export const SERVICE_PROGRAM_DIR = '/sys/services'

/** Every service program, in task-manager order. */
export const SERVICE_PROGRAMS: readonly ServiceProgram[] = [
  kernelProgram,
  cpuManagerProgram,
  diagServiceProgram,
  powerRouteProgram,
  powerCoreProgram,
  batteryManagerProgram,
  motionProfileProgram,
  actuatorBusProgram,
  servoControlProgram,
  balanceEngineProgram,
  thermalMonitorProgram,
  thermalProtectionProgram,
  visionStreamProgram,
  lidarScanProgram,
  imuTelemetryProgram,
  forceFeedbackProgram,
  analyzerServiceProgram,
  networkLinkProgram,
  failsafeProgram,
  fileServiceProgram,
  shellProgram,
  telemetryLogProgram,
]

/** Absolute path of a service source inside the virtual filesystem. */
export function serviceProgramPath(file: string): string {
  return `${SERVICE_PROGRAM_DIR}/${file}`
}

/** The service source bound to a PID, or undefined for unknown PIDs. */
export function serviceProgramFor(pid: number): ServiceProgram | undefined {
  return SERVICE_PROGRAMS.find((program) => program.pid === pid)
}

/** File-system path of the source of a PID, or null when it has none. */
export function serviceScriptPath(pid: number): string | null {
  const program = serviceProgramFor(pid)
  return program ? serviceProgramPath(program.file) : null
}
