import type { BusReadResult, BusWriteResult, DeviceName } from '../rasm/bus'
import type { RobotSystem } from '../Game'
import type { LocalText, RobotBus } from './types'

/**
 * The robot's hardware ports, seen from a program.
 *
 * Every port is backed by a real component of the robot, so a program can
 * only touch hardware that is actually present and powered. Three kinds of
 * ports exist:
 *
 *   status   — a readiness flag of a component (1 = online, 0 = otherwise).
 *              Status ports never fail: they exist so a program can *ask* the
 *              machine what is wrong instead of tripping over it.
 *   sensor   — a live measurement (temperature, battery). Fails when the
 *              sensor itself is not available.
 *   actuator — a command to a machine (motor, servo). Fails when the rail or
 *              the device is not fully online, which is what limits a script
 *              to what the hardware can actually do.
 *   latch    — a software register owned by the kernel (BOOT, DIAG).
 */
export type RobotPortKind = 'status' | 'sensor' | 'actuator' | 'latch'

export interface RobotPort {
  name: DeviceName
  kind: RobotPortKind
  /** Component that physically backs the port. */
  componentId: string
  /** Components that must be fully ONLINE for the port to work. */
  requires: readonly string[]
  /** Live measurement a sensor port reports. */
  sensor?: 'temperature' | 'battery'
  description: LocalText
}

/** The full port table of the robot. */
export const ROBOT_PORTS: readonly RobotPort[] = [
  {
    name: 'PWR',
    kind: 'status',
    componentId: 'PWR-100',
    requires: [],
    description: { ru: 'Первичный источник питания готов', en: 'Primary power source ready' },
  },
  {
    name: 'MEM',
    kind: 'status',
    componentId: 'MEM-732',
    requires: [],
    description: { ru: 'Оперативная память ядра проверена', en: 'Core memory validated' },
  },
  {
    name: 'PROFILE',
    kind: 'status',
    componentId: 'MCM-740',
    requires: [],
    description: { ru: 'Профиль команд движения принят', en: 'Motion command profile accepted' },
  },
  {
    name: 'BUS',
    kind: 'status',
    componentId: 'BUS-T-240',
    requires: [],
    description: { ru: 'Шина питания корпуса запитана', en: 'Body power bus energized' },
  },
  {
    name: 'ACT',
    kind: 'status',
    componentId: 'ACT-610',
    requires: [],
    description: { ru: 'Шина исполнительных механизмов в работе', en: 'Actuator bus operational' },
  },
  {
    name: 'COOL',
    kind: 'status',
    componentId: 'CLG-820',
    requires: [],
    description: { ru: 'Контур охлаждения проверен', en: 'Cooling loop verified' },
  },
  {
    name: 'VISION',
    kind: 'status',
    componentId: 'CAM-410',
    requires: [],
    description: { ru: 'Камера инициализирована', en: 'Camera array initialized' },
  },
  {
    name: 'TEMP',
    kind: 'sensor',
    componentId: 'TMP-810',
    requires: [],
    sensor: 'temperature',
    description: { ru: 'Датчик температуры, градусы Цельсия', en: 'Thermal sensor, degrees Celsius' },
  },
  {
    name: 'BATT',
    kind: 'sensor',
    componentId: 'BMS-221',
    requires: [],
    sensor: 'battery',
    description: { ru: 'Заряд батареи, проценты', en: 'Battery charge, percent' },
  },
  {
    name: 'MOTOR',
    kind: 'actuator',
    componentId: 'SRV-620',
    requires: ['ACT-610'],
    description: { ru: 'Привод, 0 — стоп, 1..1000 — скорость', en: 'Drive motor, 0 = stop, 1..1000 = speed' },
  },
  {
    name: 'SERVO',
    kind: 'actuator',
    componentId: 'SRV-620',
    requires: ['ACT-610'],
    description: { ru: 'Сервопривод сустава, commanded angle', en: 'Joint servo, commanded angle' },
  },
  {
    name: 'BOOT',
    kind: 'latch',
    componentId: 'OSK-710',
    requires: [],
    description: { ru: 'Запрос запуска тела (защёлка ядра)', en: 'Body startup request (kernel latch)' },
  },
  {
    name: 'DIAG',
    kind: 'latch',
    componentId: 'OSK-710',
    requires: [],
    description: { ru: 'Код последней неудачной проверки', en: 'Code of the last failed check' },
  },
]

/** Live sensor readings the bus forwards to the programs. */
export interface RobotSensorSource {
  /** Body temperature in degrees Celsius. */
  temperature(): number
  /** Remaining battery charge in percent. */
  batteryPercent(): number
}

const DEFAULT_SENSORS: RobotSensorSource = {
  temperature: () => 20,
  batteryPercent: () => 90,
}

/**
 * Device bus bound to the robot's real hardware.
 *
 * The processor knows nothing about the robot: it only asks the bus for a
 * port. This implementation answers from `RobotSystem`, so a program that
 * drives an unpowered actuator is refused by the machine, not by a fake
 * device table.
 */
export class RobotDeviceBus implements RobotBus {
  private readonly system: RobotSystem
  private sensors: RobotSensorSource
  private readonly ports = new Map<string, RobotPort>()
  private readonly latches = new Map<string, number>()
  private readonly lastWrites = new Map<string, number>()
  private degradedAccess = false
  private tickCount = 0

  constructor(system: RobotSystem, sensors: RobotSensorSource = DEFAULT_SENSORS) {
    this.system = system
    this.sensors = sensors
    for (const port of ROBOT_PORTS) this.ports.set(port.name.toUpperCase(), port)
  }

  /** Replace the live sensor readings (the game wires the real ones). */
  setSensors(sensors: RobotSensorSource): void {
    this.sensors = sensors
  }

  // ------------------------------------------------------------------- ports

  /** The port table, in declaration order. */
  get portTable(): readonly RobotPort[] {
    return ROBOT_PORTS
  }

  /** Look up a port by name; names are case-insensitive. */
  portFor(name: DeviceName): RobotPort | undefined {
    return this.ports.get(name.toUpperCase())
  }

  /** The component a port is backed by, or null for an unknown port. */
  componentOf(name: DeviceName): string | null {
    return this.portFor(name)?.componentId ?? null
  }

  /** Current status of a component of the robot, for the interface windows. */
  componentStatus(componentId: string): string {
    return this.system.getComponentStatus(componentId)
  }

  /** Last value a program wrote to an actuator port. */
  lastWrite(name: DeviceName): number | null {
    return this.lastWrites.get(name.toUpperCase()) ?? null
  }

  /** Value of a kernel latch a program wrote. */
  getLatch(name: DeviceName): number {
    return this.latches.get(name.toUpperCase()) ?? 0
  }

  /** Clear every latch; used when the robot reboots. */
  clearLatches(): void {
    this.latches.clear()
    this.lastWrites.clear()
  }

  lastAccessDegraded(): boolean {
    return this.degradedAccess
  }

  // -------------------------------------------------------------------- bus

  read(name: DeviceName): BusReadResult {
    const port = this.portFor(name)
    if (!port) {
      return { ok: false, error: `Unknown device "${name.toUpperCase()}".`, code: 'UNKNOWN_DEVICE' }
    }

    this.degradedAccess = false

    if (port.kind === 'latch') {
      return { ok: true, value: this.getLatch(port.name) }
    }

    if (port.kind === 'status') {
      // Status ports report readiness; they never fail, so a program can
      // branch on the machine's condition instead of crashing on it.
      const status = this.system.getComponentStatus(port.componentId)
      return { ok: true, value: status === 'ONLINE' ? 1 : 0 }
    }

    const blocked = this.gateFor(port)
    if (blocked) return { ok: false, error: blocked, code: 'DEVICE_READ_ERROR' }

    this.degradedAccess = this.system.getComponentStatus(port.componentId) === 'DEGRADED'
    const raw = port.sensor === 'battery' ? this.sensors.batteryPercent() : this.sensors.temperature()
    return { ok: true, value: Math.round(raw) & 0xffff }
  }

  write(name: DeviceName, value: number): BusWriteResult {
    const port = this.portFor(name)
    if (!port) {
      return { ok: false, error: `Unknown device "${name.toUpperCase()}".`, code: 'UNKNOWN_DEVICE' }
    }

    this.degradedAccess = false

    if (port.kind === 'latch') {
      this.latches.set(port.name.toUpperCase(), value & 0xffff)
      return { ok: true }
    }

    if (port.kind !== 'actuator') {
      return { ok: false, error: `Device "${port.name}" is read-only.`, code: 'DEVICE_WRITE_ERROR' }
    }

    const blocked = this.gateFor(port)
    if (blocked) return { ok: false, error: blocked, code: 'DEVICE_WRITE_ERROR' }

    this.degradedAccess = this.system.getComponentStatus(port.componentId) === 'DEGRADED'
    this.lastWrites.set(port.name.toUpperCase(), value & 0xffff)
    return { ok: true }
  }

  tick(ticks: number): void {
    if (ticks <= 0) return
    this.tickCount += ticks
  }

  list(): readonly DeviceName[] {
    return [...this.ports.keys()].sort()
  }

  describe(name: DeviceName): string {
    const port = this.portFor(name)
    if (!port) return ''
    return port.description.en
  }

  // -------------------------------------------------------------- internals

  /**
   * Why the port cannot be used right now, or null when it can.
   *
   * A port whose rail is not fully online is refused outright: a script must
   * not be able to drive a machine the robot has not powered yet. The message
   * names the component and its current fault, so the operator learns which
   * repair is missing.
   */
  private gateFor(port: RobotPort): string | null {
    for (const id of port.requires) {
      const status = this.system.getComponentStatus(id)
      if (status === 'ONLINE') continue
      const component = this.system.getComponent(id)
      const fault = component?.fault ? ` — ${component.fault}` : ''
      return `Port ${port.name} is not powered: ${id} is ${status}${fault}.`
    }

    const own = this.system.getComponentStatus(port.componentId)
    if (own === 'ONLINE' || own === 'DEGRADED') return null
    const component = this.system.getComponent(port.componentId)
    const fault = component?.fault ? ` — ${component.fault}` : ''
    return `Port ${port.name} is unavailable: ${port.componentId} is ${own}${fault}.`
  }
}
