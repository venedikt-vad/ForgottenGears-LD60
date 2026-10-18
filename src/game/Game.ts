import { Input } from './Input'
import { CursorDrawer } from './CursorDrawer'
import { FONT_FAMILY, LOST_LANGUAGE_FAMILY, loadFont } from './fonts'

import { ConsoleWindow } from './windows/ConsoleWindow'
import { CodeEditorWindow } from './windows/CodeEditorWindow'
import { LanguageSelectWindow } from './windows/LanguageSelectWindow'
import { MemoryCoreWindow } from './windows/MemoryCoreWindow'
import { PowerDistributionWindow } from './windows/PowerDistributionWindow'
import { UiWindow } from './windows/UiWindow'
import { WindowManager } from './windows/WindowManager'
import { ReactorCoreWindow } from './windows/ReactorCoreWindow'
import { WindowMaze } from './windows/WindowMaze'

import type { GameLanguage } from './windows/GameWindow'
import { VirtualFileSystem } from './VirtualFileSystem'

export type RuntimeStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'CRITICAL' | 'MISSING' | 'LOCKED'
export type RuntimeCategory = 'POWER' | 'COMPUTE' | 'OS' | 'SENSORS' | 'MOTION' | 'THERMAL' | 'SAFETY' | 'NETWORK' | 'BODY' | 'SYSTEM'
export type PuzzleId = 'reactor' | 'powerDistribution' | 'memoryCore' | 'analyzer' | 'vision' | 'cooling' | 'editor' | 'maze'

export interface RuntimeComponent {
  id: string
  name: string
  category: RuntimeCategory
  status: RuntimeStatus
  description: string
  dependencies: string[]
  affects: string[]
  fault: string
  recommendation: string
  windowId?: string
}

export interface SystemEvent {
  time: number
  level: 'INFO' | 'WARN' | 'ERROR' | 'OK'
  source: string
  message: string
}

export type AnalyzerChannelState = 'NO_FEED' | 'DISABLED' | 'READY' | 'ONLINE' | 'FAULT'

const INITIAL_COMPONENTS: RuntimeComponent[] = [
  { id: 'PWR-100', name: 'Primary Power Core', category: 'POWER', status: 'DEGRADED', description: 'Primary source of electrical power.', dependencies: [], affects: ['RCTR-110', 'PDU-230'], fault: 'Output is not yet validated by the reactor controller.', recommendation: 'Open the reactor panel and complete the startup alignment.', windowId: 'reactor' },
  { id: 'BAT-220', name: 'Battery Pack', category: 'POWER', status: 'ONLINE', description: 'Backup energy store.', dependencies: [], affects: ['BMS-221', 'PDU-230'], fault: 'No active fault reported.', recommendation: 'No action required.' },
  { id: 'BMS-221', name: 'Battery Management System', category: 'POWER', status: 'OFFLINE', description: 'Monitors and protects the battery.', dependencies: ['BAT-220'], affects: ['PDU-230'], fault: 'Telemetry is degraded.', recommendation: 'Inspect battery telemetry after primary power recovery.' },
  { id: 'PDU-230', name: 'Power Distribution Unit', category: 'POWER', status: 'DEGRADED', description: 'Routes power to the individual system rails.', dependencies: ['PWR-100', 'RCTR-110'], affects: ['BUS-T-240', 'ANL-450', 'ACT-610'], fault: 'Body and actuator rails are not enabled.', recommendation: 'Complete the reactor startup, then solve the distribution-grid puzzle.', windowId: 'powerDistribution' },
  { id: 'CPU-730', name: 'Central Processing Unit', category: 'COMPUTE', status: 'DEGRADED', description: 'Executes system tasks and subsystem logic.', dependencies: ['PDU-230', 'MEM-732'], affects: ['OSK-710', 'DGN-900', 'LOC-630'], fault: 'System memory and the kernel are not fully validated.', recommendation: 'Restore core memory and rerun diagnostics.', windowId: 'memoryCore' },
  { id: 'MCM-740', name: 'Motion Command Memory', category: 'COMPUTE', status: 'DEGRADED', description: 'Stores and validates the motion command profile.', dependencies: ['MEM-732', 'OSK-710'], affects: ['LOC-630', 'ACT-610'], fault: 'PROFILE_CRC=FAILED; motion commands are being rejected.', recommendation: 'Read the motion-control documents and repair the .drv/.seq source in Vim.', windowId: 'editor' },
  { id: 'OSK-710', name: 'System Kernel', category: 'OS', status: 'ONLINE', description: 'Coordinates software services and hardware access.', dependencies: ['CPU-730', 'MEM-732'], affects: ['RTS-711', 'DGN-900'], fault: 'Some services cannot be initialized until memory validation passes.', recommendation: 'Restore core memory, then rerun diagnostics.' },
  { id: 'RTS-711', name: 'Real-Time Scheduler', category: 'OS', status: 'OFFLINE', description: 'Schedules time-critical tasks.', dependencies: ['OSK-710', 'CPU-730'], affects: ['LOC-630', 'BAL-640'], fault: 'Scheduler is not initialized.', recommendation: 'Repair and validate the startup profile, then run the recovery sequence.' },
  { id: 'CAM-410', name: 'Primary Camera Array', category: 'SENSORS', status: 'OFFLINE', description: 'Provides visual input for perception.', dependencies: ['PDU-230', 'BUS-T-240'], affects: ['CPU-730', 'LOC-630'], fault: 'Camera stream is not initialized.', recommendation: 'Open the vision calibration panel and complete camera initialization.', windowId: 'vision' },
  { id: 'LID-420', name: 'LIDAR Mapping Unit', category: 'SENSORS', status: 'OFFLINE', description: 'Provides range data for obstacle mapping.', dependencies: ['PDU-230'], affects: ['LOC-630', 'BAL-640'], fault: 'No response.', recommendation: 'Inspect the sensor connection and calibration.' },
  { id: 'IMU-430', name: 'Inertial Measurement Unit', category: 'SENSORS', status: 'ONLINE', description: 'Measures orientation and acceleration.', dependencies: ['PDU-230', 'BUS-T-240'], affects: ['BAL-640', 'LOC-630'], fault: 'Calibration is not confirmed.', recommendation: 'Calibrate balance during the body startup sequence.' },
  { id: 'FRC-440', name: 'Force/Torque Feedback Array', category: 'SENSORS', status: 'OFFLINE', description: 'Measures loads and contact forces.', dependencies: ['PDU-230', 'BUS-T-240'], affects: ['SRV-620', 'BAL-640'], fault: 'Feedback channels are not calibrated.', recommendation: 'Validate the sensor channels and balance calibration.' },
  { id: 'ANL-450', name: 'Chemical & Atmospheric Analyzer', category: 'SENSORS', status: 'OFFLINE', description: 'Reads two independent measurement channels.', dependencies: ['PDU-230', 'BUS-T-240'], affects: ['DGN-900'], fault: 'Controller rail is off. After power-up, channel A has no feed and channel B is disabled.', recommendation: 'Enable the analyzer controller with `power ANL-450 on`, then inspect both channels in the analyzer panel.', windowId: 'analyzer' },
  { id: 'ACT-610', name: 'Actuator Control Bus', category: 'MOTION', status: 'DEGRADED', description: 'Carries control messages to the servo controllers.', dependencies: ['PDU-230', 'BUS-T-240'], affects: ['SRV-620', 'LOC-630', 'BAL-640'], fault: 'Actuator bus is not powered and its bypass has not been restored.', recommendation: 'Restore body power, then open the actuator-bus debug panel and complete the bypass maze.', windowId: 'maze' },
  { id: 'SRV-620', name: 'Servo & Joint Controller', category: 'MOTION', status: 'OFFLINE', description: 'Controls joint motors and position servos.', dependencies: ['ACT-610', 'PDU-230'], affects: ['LOC-630', 'BAL-640'], fault: 'Actuator bus and physical assemblies are not fully available.', recommendation: 'Restore power, inspect the body assembly map, and perform an unloaded test.' },
  { id: 'BAL-640', name: 'Balance & Posture Engine', category: 'MOTION', status: 'OFFLINE', description: 'Stabilizes posture using inertial and force feedback.', dependencies: ['IMU-430', 'FRC-440', 'SRV-620'], affects: ['LOC-630'], fault: 'Sensor calibration and the actuator chain are incomplete.', recommendation: 'Calibrate balance after the sensor and actuator checks.' },
  { id: 'TMP-810', name: 'Thermal Sensor Array', category: 'THERMAL', status: 'ONLINE', description: 'Measures temperatures of key components.', dependencies: ['PDU-230'], affects: ['CLG-820', 'THP-830'], fault: 'Sensor is present but cooling-flow calibration is invalid.', recommendation: 'Validate flow readings in the cooling service panel.', windowId: 'cooling' },
  { id: 'THP-830', name: 'Overheat Protection Unit', category: 'SAFETY', status: 'ONLINE', description: 'Protects the system from thermal damage.', dependencies: ['TMP-810', 'CLG-820'], affects: ['CPU-730', 'SRV-620'], fault: 'Thermal protection remains armed because cooling is not verified.', recommendation: 'Repair the cooling circuit; do not bypass the interlock.' },
  { id: 'NET-510', name: 'External Command Link', category: 'NETWORK', status: 'OFFLINE', description: 'External communications and telemetry.', dependencies: ['PDU-230'], affects: ['DGN-900'], fault: 'No response.', recommendation: 'Inspect the network interface after core recovery.' },
  { id: 'DGN-900', name: 'Self-Diagnostic Suite', category: 'SYSTEM', status: 'ONLINE', description: 'Collects fault data and validates subsystem dependencies.', dependencies: ['CPU-730', 'OSK-710'], affects: ['FSF-910'], fault: 'Several component checks are still failing.', recommendation: 'Run diagnostics again after each major subsystem repair.' },
  { id: 'FSF-910', name: 'Failsafe Controller', category: 'SAFETY', status: 'ONLINE', description: 'Applies safe behavior during system faults.', dependencies: ['BAT-220'], affects: ['LOC-630', 'BAL-640'], fault: 'No active fault reported.', recommendation: 'Keep safety interlocks enabled.' },
  { id: 'ARM-R-660', name: 'Right Arm Assembly', category: 'BODY', status: 'MISSING', description: 'Physical right-arm assembly.', dependencies: ['BUS-T-240', 'ACT-610', 'SRV-620'], affects: ['LOC-630'], fault: 'Hardware inventory reports that the module is not detected.', recommendation: 'Inspect the assembly map and connector. Power cannot repair missing hardware.' },
  { id: 'LEG-L-670', name: 'Left Lower Leg Assembly', category: 'BODY', status: 'MISSING', description: 'Physical lower segment of the left leg below the knee.', dependencies: ['BUS-T-240', 'ACT-610', 'SRV-620', 'FRC-440'], affects: ['BAL-640', 'LOC-630'], fault: 'Hardware inventory reports a disconnect at the knee joint.', recommendation: 'Reconnect and register the missing segment; power cannot replace the physical part.' },
]

const INITIAL_CHANNELS: Record<'A' | 'B', AnalyzerChannelState> = { A: 'NO_FEED', B: 'DISABLED' }

/** Shared in-memory state for all service windows and puzzles in one game session. */
export class RobotSystem {
  private components = new Map<string, RuntimeComponent>()
  private events: SystemEvent[] = []
  private eventClock = 0
  private channels: Record<'A' | 'B', AnalyzerChannelState> = { ...INITIAL_CHANNELS }

  reactorRestored = false
  analyzerControllerPowered = false
  powerGridPuzzleSolved = false
  busBypassRestored = false
  bodyBusRestored = false
  analyzerValidated = false
  memoryCoreRestored = false
  motionProfileRestored = false
  coolingRestored = false
  visionRestored = false
  motionStartupComplete = false
  thermalShutdownCount = 0

  constructor() {
    this.reset()
  }

  reset(): void {
    this.components = new Map(INITIAL_COMPONENTS.map((component) => [component.id, { ...component, dependencies: [...component.dependencies], affects: [...component.affects] }]))
    this.events = []
    this.eventClock = 0
    this.channels = { ...INITIAL_CHANNELS }
    this.reactorRestored = false
    this.analyzerControllerPowered = false
    this.powerGridPuzzleSolved = false
    this.busBypassRestored = false
    this.bodyBusRestored = false
    this.analyzerValidated = false
    this.memoryCoreRestored = false
    this.motionProfileRestored = false
    this.coolingRestored = false
    this.visionRestored = false
    this.motionStartupComplete = false
    this.thermalShutdownCount = 0
    this.log('INFO', 'BOOT', 'Recovery session created. Core systems require manual recovery.')
  }

  listComponents(): RuntimeComponent[] {
    return [...this.components.values()]
  }

  getComponent(id: string): RuntimeComponent | undefined {
    return this.components.get(id.toUpperCase())
  }

  getComponentStatus(id: string): RuntimeStatus {
    return this.getComponent(id)?.status ?? 'OFFLINE'
  }

  /** Maps extended UI states to the original console status vocabulary. */
  getConsoleStatus(id: string): 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'CRITICAL' {
    const status = this.getComponentStatus(id)
    if (status === 'MISSING' || status === 'OFFLINE') return 'OFFLINE'
    if (status === 'LOCKED') return 'CRITICAL'
    return status
  }

  getEvents(): SystemEvent[] {
    return [...this.events]
  }

  getAnalyzerChannels(): Record<'A' | 'B', AnalyzerChannelState> {
    return { ...this.channels }
  }

  setComponentStatus(id: string, status: RuntimeStatus, fault?: string, source = 'SERVICE'): void {
    const component = this.components.get(id.toUpperCase())
    if (!component) return
    const changed = component.status !== status || (fault !== undefined && component.fault !== fault)
    component.status = status
    if (fault !== undefined) component.fault = fault
    if (changed) this.log(status === 'ONLINE' ? 'OK' : status === 'CRITICAL' || status === 'MISSING' ? 'ERROR' : 'INFO', source, `${component.id}: ${status}${component.fault ? ` — ${component.fault}` : ''}`)
  }

  log(level: SystemEvent['level'], source: string, message: string): void {
    this.eventClock += 1
    this.events.push({ time: this.eventClock, level, source, message })
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100)
  }

  completeReactorPuzzle(): void {
    if (this.reactorRestored) return
    this.reactorRestored = true
    this.setComponentStatus('RCTR-110', 'ONLINE', 'Safe-start sequence validated.', 'REACTOR')
    this.setComponentStatus('PWR-100', 'ONLINE', 'Primary output stable.', 'REACTOR')
    this.setComponentStatus('PDU-230', 'DEGRADED', 'Primary source is stable; body rails remain disabled.', 'REACTOR')
    this.log('OK', 'REACTOR', 'Reactor safe-start complete. Body distribution is still inactive.')
    if (this.powerGridPuzzleSolved) this.activatePowerDistribution()
  }

  setAnalyzerControllerPower(enabled: boolean): void {
    this.analyzerControllerPowered = enabled
    this.analyzerValidated = false
    if (!enabled) {
      this.channels.A = 'NO_FEED'
      this.channels.B = 'DISABLED'
      this.setComponentStatus('ANL-450', 'OFFLINE', 'Analyzer controller rail is off.', 'POWER')
      this.log('WARN', 'ANALYZER', 'Analyzer controller power disabled.')
      return
    }

    this.setComponentStatus('ANL-450', 'DEGRADED', 'Controller responds; channel A has no feed and channel B is disabled.', 'POWER')
    this.channels.A = this.bodyBusRestored ? 'READY' : 'NO_FEED'
    this.channels.B = 'DISABLED'
    this.log('INFO', 'ANALYZER', `Controller online. Channel A: ${this.channels.A}; channel B: ${this.channels.B}.`)
  }

  completePowerDistributionPuzzle(): void {
    this.powerGridPuzzleSolved = true
    if (!this.reactorRestored) {
      this.setComponentStatus('BUS-T-240', 'LOCKED', 'Routing is configured, but the reactor output is not ready.', 'POWER GRID')
      this.log('WARN', 'POWER GRID', 'Route configuration saved; it will become live after reactor recovery.')
      return
    }
    this.activatePowerDistribution()
  }

  private activatePowerDistribution(): void {
    if (this.bodyBusRestored) return
    this.bodyBusRestored = true
    this.setComponentStatus('BUS-T-240', 'ONLINE', 'BODY_MAIN route is energized.', 'POWER GRID')
    this.setComponentStatus('PDU-230', 'DEGRADED', 'Body rail is active; secondary diagnostics are still pending.', 'POWER GRID')
    if (this.busBypassRestored) {
      this.setComponentStatus('ACT-610', 'ONLINE', 'Actuator bus is powered and the damaged bypass is restored.', 'POWER GRID')
    } else {
      this.setComponentStatus('ACT-610', 'DEGRADED', 'Power is available, but the damaged actuator-bus bypass is not restored.', 'POWER GRID')
    }
    this.setComponentStatus('SRV-620', 'DEGRADED', 'Bus is powered; assembly inventory and calibration remain incomplete.', 'POWER GRID')
    this.channels.A = this.analyzerControllerPowered ? 'READY' : 'NO_FEED'
    this.channels.B = 'DISABLED'
    this.log('OK', 'POWER GRID', 'Body distribution restored. Physical assembly inventory still contains missing modules.')
  }

  /** Completes the damaged actuator-bus bypass maze. Robot state remains owned here in Game.ts. */
  completeBusBypassPuzzle(): void {
    if (this.busBypassRestored) return
    this.busBypassRestored = true
    if (this.bodyBusRestored) {
      this.setComponentStatus('ACT-610', 'ONLINE', 'Actuator bus power and bypass continuity verified.', 'BUS BYPASS')
    } else {
      this.setComponentStatus('ACT-610', 'LOCKED', 'Bypass continuity repaired; body power is not energized yet.', 'BUS BYPASS')
    }
    this.log('OK', 'BUS BYPASS', 'Damaged actuator-bus bypass route has been restored.')
    this.updateMotionReadiness()
  }

  completeAnalyzerPuzzle(): void {
    this.analyzerValidated = true
    this.channels.A = 'ONLINE'
    this.channels.B = 'ONLINE'
    this.setComponentStatus('ANL-450', 'ONLINE', 'Both measurement channels passed self-test.', 'ANALYZER')
    this.log('OK', 'ANALYZER', 'Channels A and B passed self-test.')
  }

  completeMemoryCorePuzzle(): void {
    if (this.memoryCoreRestored) return
    this.memoryCoreRestored = true
    this.setComponentStatus('MEM-732', 'ONLINE', 'Memory table integrity verified.', 'MEMORY CORE')
    this.setComponentStatus('CPU-730', this.reactorRestored ? 'DEGRADED' : 'DEGRADED', 'Core memory is ready; dependent services still require recovery.', 'MEMORY CORE')
    this.setComponentStatus('OSK-710', 'DEGRADED', 'Kernel validation is waiting for the full startup sequence.', 'MEMORY CORE')
    this.log('OK', 'MEMORY CORE', 'Memory validation puzzle complete.')
  }

  completeMotionProfile(): void {
    this.motionProfileRestored = true
    this.setComponentStatus('MCM-740', 'ONLINE', 'Motion command source passed sequence and safety-flag checks.', 'MOTION EDITOR')
    this.updateMotionReadiness()
    this.log('OK', 'MOTION EDITOR', 'Motion profile validated and saved.')
  }

  completeCoolingPuzzle(): void {
    this.coolingRestored = true
    this.setComponentStatus('CLG-820', 'ONLINE', 'Coolant flow and calibration verified.', 'COOLING')
    this.setComponentStatus('TMP-810', 'ONLINE', 'Thermal flow measurements validated.', 'COOLING')
    this.setComponentStatus('THP-830', 'ONLINE', 'Thermal interlock is active with valid cooling telemetry.', 'COOLING')
    this.updateMotionReadiness()
    this.log('OK', 'COOLING', 'Cooling loop verified. Thermal protection remains enabled.')
  }

  completeVisionPuzzle(): void {
    this.visionRestored = true
    this.setComponentStatus('CAM-410', 'ONLINE', 'Camera stream initialized and calibration passed.', 'VISION')
    this.log('OK', 'VISION', 'Primary camera array initialized.')
  }

  /** Call after the startup program has passed validation and is executed. */
  completeBodyStartup(): boolean {
    const ready = this.reactorRestored && this.bodyBusRestored && this.busBypassRestored && this.coolingRestored && this.motionProfileRestored && this.memoryCoreRestored
    if (!ready) {
      this.log('ERROR', 'BODY STARTUP', 'Startup blocked: one or more power, memory, profile, or cooling checks have not passed.')
      return false
    }
    if (this.getComponentStatus('ARM-R-660') === 'MISSING' || this.getComponentStatus('LEG-L-670') === 'MISSING') {
      this.log('WARN', 'BODY STARTUP', 'Control profile is ready, but missing physical assemblies prevent a full body test.')
      this.updateMotionReadiness()
      return false
    }
    this.motionStartupComplete = true
    this.setComponentStatus('RTS-711', 'ONLINE', 'Real-time scheduler initialized.', 'BODY STARTUP')
    this.setComponentStatus('LOC-630', 'ONLINE', 'Motion control enabled after all safety checks.', 'BODY STARTUP')
    this.setComponentStatus('BAL-640', 'ONLINE', 'Balance calibration complete.', 'BODY STARTUP')
    if (!this.visionRestored) this.setComponentStatus('CAM-410', 'DEGRADED', 'Motion startup is complete; camera calibration remains pending.', 'BODY STARTUP')
    this.log('OK', 'BODY STARTUP', 'Safe body startup sequence complete.')
    return true
  }

  markHardwarePresent(id: 'ARM-R-660' | 'LEG-L-670'): void {
    const component = this.components.get(id)
    if (!component) return
    this.setComponentStatus(id, 'DEGRADED', 'Assembly registered; actuator calibration is still required.', 'HARDWARE REGISTRY')
    this.log('OK', 'HARDWARE REGISTRY', `${id} is now detected. Run actuator and balance checks.`)
  }

  /** Protective power reset after an unsafe loaded motion test. */
  triggerThermalShutdown(): void {
    this.thermalShutdownCount += 1
    this.bodyBusRestored = false
    this.powerGridPuzzleSolved = false
    this.motionStartupComplete = false
    this.visionRestored = false
    this.setComponentStatus('BUS-T-240', 'OFFLINE', 'Protective reset disabled BODY_MAIN.', 'THERMAL FAILSAFE')
    this.setComponentStatus('ACT-610', 'OFFLINE', 'Protective reset disabled ACTUATOR_BUS.', 'THERMAL FAILSAFE')
    this.setComponentStatus('PDU-230', 'DEGRADED', 'Volatile rail configuration was reset after overheating.', 'THERMAL FAILSAFE')
    this.setComponentStatus('LOC-630', 'LOCKED', 'Motion is locked after a thermal protective reset.', 'THERMAL FAILSAFE')
    this.setComponentStatus('SRV-620', 'DEGRADED', 'Actuator rail was reset after overheating.', 'THERMAL FAILSAFE')
    this.setComponentStatus('CAM-410', 'OFFLINE', 'Body power reset; camera initialization must be repeated.', 'THERMAL FAILSAFE')
    this.analyzerValidated = false
    this.channels.A = 'NO_FEED'
    this.channels.B = 'DISABLED'
    if (this.analyzerControllerPowered) {
      this.setComponentStatus('ANL-450', 'DEGRADED', 'Controller responds; thermal reset removed the measurement feed.', 'THERMAL FAILSAFE')
    } else {
      this.setComponentStatus('ANL-450', 'OFFLINE', 'Analyzer controller rail is off.', 'THERMAL FAILSAFE')
    }
    this.log('ERROR', 'THERMAL FAILSAFE', 'Overheat protection reset body and actuator rails. Repair cooling before re-enabling them.')
  }

  updateMotionReadiness(): void {
    if (this.motionStartupComplete) return
    if (!this.motionProfileRestored) {
      this.setComponentStatus('LOC-630', 'LOCKED', 'MCM-740 command profile is not validated.', 'MOTION CONTROL')
      return
    }
    if (!this.coolingRestored) {
      this.setComponentStatus('LOC-630', 'LOCKED', 'Cooling-flow verification is required before motion.', 'MOTION CONTROL')
      return
    }
    if (!this.bodyBusRestored || this.getComponentStatus('ACT-610') !== 'ONLINE') {
      this.setComponentStatus('LOC-630', 'LOCKED', 'Body and actuator power rails are not active.', 'MOTION CONTROL')
      return
    }
    if (!this.memoryCoreRestored) {
      this.setComponentStatus('LOC-630', 'LOCKED', 'Core memory and the scheduler are not ready.', 'MOTION CONTROL')
      return
    }
    this.setComponentStatus('LOC-630', 'DEGRADED', 'Software checks pass; physical assemblies and balance calibration must be verified.', 'MOTION CONTROL')
  }

  getProgress(): { label: string; done: boolean; detail: string }[] {
    return [
      { label: 'Реактор / Reactor', done: this.reactorRestored, detail: 'RCTR-110 / PWR-100' },
      { label: 'Питание корпуса / Body power', done: this.bodyBusRestored, detail: 'PDU-230 / BUS-T-240' },
      { label: 'Обход шины / Bus bypass', done: this.busBypassRestored, detail: 'ACT-610' },
      { label: 'Анализатор / Analyzer', done: this.analyzerValidated, detail: 'ANL-450 / channels A+B' },
      { label: 'Память / Memory', done: this.memoryCoreRestored, detail: 'MEM-732' },
      { label: 'Профиль движения / Motion profile', done: this.motionProfileRestored, detail: 'MCM-740' },
      { label: 'Охлаждение / Cooling', done: this.coolingRestored, detail: 'TMP-810 / CLG-820' },
      { label: 'Камеры / Vision', done: this.visionRestored, detail: 'CAM-410' },
      { label: 'Безопасный запуск / Safe startup', done: this.motionStartupComplete, detail: 'RTS-711 / LOC-630 / BAL-640' },
    ]
  }

  getCounts(): Record<RuntimeStatus, number> {
    const counts: Record<RuntimeStatus, number> = { ONLINE: 0, DEGRADED: 0, OFFLINE: 0, CRITICAL: 0, MISSING: 0, LOCKED: 0 }
    for (const component of this.components.values()) counts[component.status] += 1
    return counts
  }
}

/** Single authoritative robot-state instance, owned by the Game.ts module. */
export const sharedRobotSystem = new RobotSystem()

export type GameOptions = {
  canvas: HTMLCanvasElement
  glowCanvas: HTMLCanvasElement
}

// Ambient soundtrack, looped for the whole session.
const BACKGROUND_MUSIC = `${import.meta.env.BASE_URL}sound/Project_45.mp3`

export class Game {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly glowCanvas: HTMLCanvasElement
  readonly glowCtx: CanvasRenderingContext2D
  readonly input: Input
  readonly windows: WindowManager
  readonly cursor: CursorDrawer
  /** Authoritative robot state for this gameplay session. All component and puzzle data lives in this Game.ts module. */
  readonly robotSystem = sharedRobotSystem

  private width = 0
  private height = 0
  private running = false
  private lastTime = 0
  private fontLoaded = false
  private bgMusic: HTMLAudioElement | null = null

  private player = { x: 200, y: 200, size: 32, speed: 240 }
  private readonly onResize = () => this.resize()

  constructor(options: GameOptions) {
    this.canvas = options.canvas
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2D rendering context')
    this.ctx = ctx

    this.glowCanvas = options.glowCanvas
    const glowCtx = this.glowCanvas.getContext('2d')
    if (!glowCtx) throw new Error('Failed to get 2D rendering context for glow canvas')
    this.glowCtx = glowCtx

    this.input = new Input()
    this.windows = new WindowManager(this.input)
    this.cursor = new CursorDrawer()

    // Reset shared state for a new gameplay session. Every subsystem below reports
    // to this same object, and UiWindow reads directly from it.
    this.robotSystem.reset()

    const fileSystem = new VirtualFileSystem()
    const codeEditor = new CodeEditorWindow({
      fileSystem,
      returnWindowId: 'console',
      onValidate: (_path, valid) => {
        if (valid) this.robotSystem.completeMotionProfile()
      },
    })
    const consoleWindow = new ConsoleWindow(fileSystem, codeEditor)
    const uiWindow = new UiWindow(this.robotSystem)

    // Existing puzzle windows keep their current constructors. Game.ts owns all
    // robot state; the maze only reports completion through this callback.
    const reactor = new ReactorCoreWindow()
    const memoryCore = new MemoryCoreWindow()
    const powerDistribution = new PowerDistributionWindow()
    const maze = new WindowMaze({
      onSolved: () => this.robotSystem.completeBusBypassPuzzle(),
    })

    const languageWindow = new LanguageSelectWindow((language: GameLanguage) => {
      consoleWindow.setLanguage(language)
      codeEditor.setLanguage(language)
      uiWindow.setLanguage(language)
      maze.setLanguage(language)
      this.windows.show('console')
    })

    this.windows
      .register(languageWindow)
      .register(consoleWindow)
      .register(codeEditor)
      .register(uiWindow)
      .register(reactor)
      .register(memoryCore)
      .register(powerDistribution)
      .register(maze)

    // The intended recovery walkthrough starts at the console, not at a puzzle.
    this.windows.show('ui')
  }

  start() {
    if (this.running) return
    this.running = true

    Promise.all([loadFont(FONT_FAMILY), loadFont(LOST_LANGUAGE_FAMILY)])
      .then(() => { this.fontLoaded = true })
      .catch(() => { this.fontLoaded = true })

    this.startBackgroundMusic()
    this.input.attach()
    this.cursor.attach(this.canvas)
    window.addEventListener('resize', this.onResize)
    this.resize()

    this.lastTime = performance.now()
    requestAnimationFrame(this.loop)
  }

  /** Starts the looping background track; autoplay may need one user gesture. */
  private startBackgroundMusic(): void {
    if (!this.bgMusic) {
      const music = new Audio(BACKGROUND_MUSIC)
      music.loop = true
      music.volume = 0.5
      this.bgMusic = music
    }

    const music = this.bgMusic
    const tryPlay = (): void => {
      music.play()
        .then(() => {
          window.removeEventListener('pointerdown', tryPlay)
          window.removeEventListener('keydown', tryPlay)
        })
        .catch(() => { /* Blocked until the player interacts; the listeners stay. */ })
    }

    tryPlay()
    // Browsers usually block autoplay with sound until the first interaction.
    window.addEventListener('pointerdown', tryPlay)
    window.addEventListener('keydown', tryPlay)
  }

  stop() {
    this.running = false
    this.input.detach()
    this.cursor.detach()
    window.removeEventListener('resize', this.onResize)
  }

  private readonly loop = (time: number) => {
    if (!this.running) return
    const dt = Math.min((time - this.lastTime) / 1000, 0.1)
    this.lastTime = time
    this.update(dt)
    this.render()
    this.mirrorToGlow()
    this.input.endFrame()
    requestAnimationFrame(this.loop)
  }

  private update(dt: number) {
    const p = this.player
    let dx = 0
    let dy = 0
    if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) dx -= 1
    if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) dx += 1
    if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) dy -= 1
    if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) dy += 1
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2)
      dx *= inv
      dy *= inv
    }
    p.x += dx * p.speed * dt
    p.y += dy * p.speed * dt
    const half = p.size / 2
    p.x = Math.max(half, Math.min(this.width - half, p.x))
    p.y = Math.max(half, Math.min(this.height - half, p.y))
    this.windows.update(dt)
    this.syncPuzzleProgress()
  }

  /**
   * Bridges existing mini-games to the authoritative state without changing their
   * constructors or running a migration script. These classes use TS `private`
   * fields (not ECMAScript #private fields), so their existing completion flags are
   * observable at runtime. The public integration surface remains inside Game.ts.
   */
  private syncPuzzleProgress(): void {
    const reactor = this.windows.get('reactor') as unknown as { solved?: boolean }
    if (reactor.solved && !this.robotSystem.reactorRestored) {
      this.robotSystem.completeReactorPuzzle()
    }

    const memory = this.windows.get('memoryCore') as unknown as { isSolved?: boolean }
    if (memory.isSolved && !this.robotSystem.memoryCoreRestored) {
      this.robotSystem.completeMemoryCorePuzzle()
    }

    const power = this.windows.get('powerDistribution') as unknown as { solved?: boolean }
    if (power.solved && !this.robotSystem.powerGridPuzzleSolved) {
      this.robotSystem.completePowerDistributionPuzzle()
    }
  }

  private render() {
    const { ctx, width, height } = this
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(46, 48, 58, 0.6)'
    for (let x = 0; x < width; x += 64) ctx.fillRect(x, 0, 1, height)
    for (let y = 0; y < height; y += 64) ctx.fillRect(0, y, width, 1)

    const p = this.player
    ctx.fillStyle = '#c084fc'
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    if (this.fontLoaded) {
      ctx.fillStyle = '#f3f4f6'
      ctx.font = `32px "${FONT_FAMILY}", monospace`
      ctx.fillText('FORGOTTEN GEARS', this.width / 2, 16)
    } else {
      ctx.fillStyle = '#9ca3af'
      ctx.font = '16px monospace'
      ctx.fillText('Loading font...', this.width / 2, 16)
    }

    this.windows.render(ctx, this.width, this.height)
    this.cursor.draw(ctx, this.width, this.height)
  }

  private mirrorToGlow() {
    const { glowCtx, glowCanvas } = this
    glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height)
    glowCtx.drawImage(this.canvas, 0, 0)
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1
    this.width = window.innerWidth
    this.height = window.innerHeight
    const pixelWidth = Math.round(this.width * dpr)
    const pixelHeight = Math.round(this.height * dpr)
    for (const canvas of [this.canvas, this.glowCanvas]) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
      canvas.style.width = `${this.width}px`
      canvas.style.height = `${this.height}px`
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
