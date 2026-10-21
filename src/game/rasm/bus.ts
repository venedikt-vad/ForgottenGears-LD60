/**
 * Device bus abstraction for the RASM processor.
 *
 * The processor never knows what a `TEMP` or a `MOTOR` is: it only asks the
 * bus to read a port, write a port, or advance the sim by N ticks. Any host
 * (the demo level, a unit test, or the real game's component system) can
 * implement `DeviceBus` and plug its own hardware in.
 */

/** Names a device port. Case-insensitive: the compiler uppercases them. */
export type DeviceName = string

/** The outcome of a bus read. `ok: false` carries a message for the debugger. */
export type BusReadResult =
  | { ok: true; value: number }
  | { ok: false; error: string; code?: BusErrorCode }

export type BusWriteResult = { ok: true } | { ok: false; error: string; code?: BusErrorCode }

/**
 * Optional machine-readable reason for a bus failure. `UNKNOWN_DEVICE` means the
 * port is not connected at all; the other codes describe a connected port that
 * refused the operation. Hosts may omit it, in which case the processor reports
 * a generic read/write error.
 */
export type BusErrorCode = 'UNKNOWN_DEVICE' | 'DEVICE_READ_ERROR' | 'DEVICE_WRITE_ERROR'

/**
 * Everything the processor needs from the outside world. Implementations are
 * free to be pure in-memory models, adapters over `RobotSystem`, or fakes in
 * tests.
 */
export interface DeviceBus {
  /** Read the current value of a port. Unknown ports must report `ok: false`. */
  read(name: DeviceName): BusReadResult
  /** Send a value to a port. Unknown ports must report `ok: false`. */
  write(name: DeviceName, value: number): BusWriteResult
  /** Advance device state by `ticks` (one tick per executed instruction). */
  tick(ticks: number): void
  /** Names of every connected port, in a stable order, for the debugger UI. */
  list(): readonly DeviceName[]
  /** Optional short description of a port, shown next to its name. */
  describe?(name: DeviceName): string
}

/** A minimal device: a stable value that tests can pin and inspect. */
export class ConstantDevice {
  readonly name: string
  private value: number

  constructor(name: string, value: number) {
    this.name = name
    this.value = value
  }

  read(): number {
    return this.value & 0xffff
  }

  set(value: number): void {
    this.value = value & 0xffff
  }
}

/** A write-only sink that records everything written to it. */
export class RecordingSink {
  readonly writes: number[] = []

  write(value: number): void {
    this.writes.push(value & 0xffff)
  }

  get last(): number | undefined {
    return this.writes[this.writes.length - 1]
  }
}

/**
 * A tiny in-memory bus used by the demo level and the tests.
 *
 * Devices are registered with a read and/or write handler, so a single class
 * covers sensors (read-only), actuators (write-only) and bidirectional ports.
 * `onTick` lets a device evolve over time, which is how the demo temperature
 * sensor warms up and cools down.
 */
export interface SimpleDevice {
  read?: () => number
  write?: (value: number) => void
  onTick?: (ticks: number) => void
  description?: string
}

export class SimpleDeviceBus implements DeviceBus {
  private readonly devices = new Map<DeviceName, SimpleDevice>()
  private tickCount = 0

  /** Register or replace a device. Names are normalised to upper case. */
  register(name: DeviceName, device: SimpleDevice): this {
    this.devices.set(name.toUpperCase(), device)
    return this
  }

  has(name: DeviceName): boolean {
    return this.devices.has(name.toUpperCase())
  }

  read(name: DeviceName): BusReadResult {
    const device = this.devices.get(name.toUpperCase())
    if (!device) return { ok: false, error: `Unknown device "${name.toUpperCase()}".`, code: 'UNKNOWN_DEVICE' }
    if (!device.read) return { ok: false, error: `Device "${name.toUpperCase()}" is write-only.`, code: 'DEVICE_READ_ERROR' }
    return { ok: true, value: device.read() & 0xffff }
  }

  write(name: DeviceName, value: number): BusWriteResult {
    const device = this.devices.get(name.toUpperCase())
    if (!device) return { ok: false, error: `Unknown device "${name.toUpperCase()}".`, code: 'UNKNOWN_DEVICE' }
    if (!device.write) return { ok: false, error: `Device "${name.toUpperCase()}" is read-only.`, code: 'DEVICE_WRITE_ERROR' }
    device.write(value & 0xffff)
    return { ok: true }
  }

  tick(ticks: number): void {
    if (ticks <= 0) return
    this.tickCount += ticks
    for (const device of this.devices.values()) device.onTick?.(ticks)
  }

  list(): readonly DeviceName[] {
    return [...this.devices.keys()].sort()
  }

  describe(name: DeviceName): string {
    return this.devices.get(name.toUpperCase())?.description ?? ''
  }

  get ticks(): number {
    return this.tickCount
  }
}

/**
 * Demo hardware for the RASM sample program: a temperature sensor and a motor.
 *
 * `TEMP` reports a temperature that drifts upward while the motor runs and
 * cools down while it is idle. `MOTOR` records the last commanded speed and
 * also reports it on read, so the sample program can verify its own output.
 */
export interface DemoLevelState {
  /** Last speed written to MOTOR. */
  motorSpeed: number
  /** Total instructions that advanced the sim. */
  ticks: number
}

export function createDemoBus(options: { ambient?: number } = {}): {
  bus: SimpleDeviceBus
  state: DemoLevelState
} {
  const ambient = options.ambient ?? 20
  const state: DemoLevelState = { motorSpeed: 0, ticks: 0 }
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
    },
  })
  return { bus, state }
}
