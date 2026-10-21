/**
 * Game-facing scenario for the RASM demo level.
 *
 * Keeps the language core untouched: this file is the only place that knows the
 * level exposes `TEMP` and `MOTOR`, and it adapts them to the generic
 * `DeviceBus` the processor expects. The console and the RASM window both read
 * the scenario read-model, so the two screens always agree.
 */

import type { RobotSystem } from '../Game'
import { SimpleDeviceBus, type DemoLevelState } from './bus'

/** Program the demo level ships with; also used as the window's default buffer. */
export const DEMO_PROGRAM_PATH = '/opt/firmware/motion/thermal_governor.rasm'

/** Short label of each port, shown in the RASM window's device panel. */
export const DEMO_DEVICES: readonly { name: string; description: string }[] = [
  { name: 'TEMP', description: 'Thermal sensor' },
  { name: 'MOTOR', description: 'Drive motor' },
]

export interface DemoScenarioOptions {
  /** Ambient temperature the sensor settles back to, in degrees Celsius. */
  ambient?: number
  /** Optional hook so the level can react to the motor being commanded. */
  onMotorWrite?: (value: number) => void
}

/**
 * The demo level's hardware, wrapped in the generic bus. One instance lives per
 * RASM window so a reset always starts from the same physical conditions.
 */
export class DemoScenario {
  readonly bus: SimpleDeviceBus
  readonly state: DemoLevelState
  private readonly onMotorWrite?: (value: number) => void

  constructor(options: DemoScenarioOptions = {}) {
    const ambient = options.ambient ?? 20
    this.onMotorWrite = options.onMotorWrite
    const state: DemoLevelState = { motorSpeed: 0, ticks: 0 }
    this.state = state

    let temperature = ambient
    let heat = 0

    const bus = new SimpleDeviceBus()
    bus.register('TEMP', {
      description: 'Thermal sensor (degrees Celsius)',
      read: () => Math.round(temperature) & 0xffff,
      onTick: (ticks) => {
        state.ticks += ticks
        // The motor is the heat source: running it warms the sensor toward
        // ambient + 90 °C (so it can cross a typical 80 °C limit), and stopping
        // it lets the sensor cool back down.
        if (state.motorSpeed > 0) heat = Math.min(90, heat + ticks * 2.2)
        else heat = Math.max(0, heat - ticks * 3)
        temperature += (ambient + heat - temperature) * 0.25 * Math.min(1, ticks)
      },
    })
    bus.register('MOTOR', {
      description: 'Drive motor (0 = stop, 1..1000 = speed)',
      read: () => state.motorSpeed,
      write: (value) => {
        state.motorSpeed = value
        this.onMotorWrite?.(value)
      },
    })

    this.bus = bus
  }

  /** Return the hardware to its initial state (motor stopped, sensor at ambient). */
  reset(): void {
    this.state.motorSpeed = 0
    this.state.ticks = 0
  }

  /** Sensor reading as an integer, for the window's device panel. */
  readTemperature(): number {
    const result = this.bus.read('TEMP')
    return result.ok ? result.value : 0
  }

  get motorSpeed(): number {
    return this.state.motorSpeed
  }
}

/**
 * Adapts the game's `RobotSystem` to the demo level: the motor only accepts a
 * command once the actuator chain is powered, which ties the RASM exercise into
 * the existing recovery progression without duplicating puzzle state.
 */
export function motorPermitted(robotSystem: RobotSystem | null): boolean {
  if (!robotSystem) return true
  const status = robotSystem.getComponentStatus('ACT-610')
  return status === 'ONLINE' || status === 'DEGRADED'
}

/** Human-readable reason the motor refuses a command, or null when it accepts. */
export function motorRejectionReason(robotSystem: RobotSystem | null): string | null {
  if (motorPermitted(robotSystem)) return null
  return 'ACTUATOR_BUS is not powered; MOTOR commands are refused.'
}
