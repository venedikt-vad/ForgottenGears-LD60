import { Input } from './Input'
import { CursorDrawer } from './CursorDrawer'
import { FONT_FAMILY, LOST_LANGUAGE_FAMILY, loadFont } from './fonts'

import { ConsoleWindow } from './windows/ConsoleWindow'
import { CodeEditorWindow } from './windows/CodeEditorWindow'
import { MemoryCoreWindow } from './windows/MemoryCoreWindow'
import { PowerDistributionWindow } from './windows/PowerDistributionWindow'
import { UiWindow } from './windows/UiWindow'
import { TaskManagerWindow } from './windows/TaskManagerWindow'
import { WindowManager } from './windows/WindowManager'
import { ReactorCoreWindow } from './windows/ReactorCoreWindow'
import { RasmWindow } from './windows/RasmWindow'
import { WindowMaze } from './windows/mazeComponents/WindowMaze'
import { VictoryWindow } from './windows/VictoryWindow'
import { MainMenuWindow } from './windows/MainMenuWindow'
import { SaveSelectWindow } from './windows/SaveSelectWindow'
import { SettingsWindow } from './windows/SettingsWindow'
import { ShutdownWindow } from './windows/ShutdownWindow'

import type { GameLanguage } from './windows/GameWindow'
import { VirtualFileSystem } from './VirtualFileSystem'
import { RobotData } from './RobotData'
import { DemoScenario, DEMO_PROGRAM_PATH } from './rasm/scenario'
import { RobotDeviceBus } from './runtime/RobotDeviceBus'
import { RobotKernel } from './runtime/RobotKernel'
import { SaveManager } from './save/SaveManager'
import { setSfxVolume } from './sfx'
import type {
  GameSettings,
  SavedAnalyzerChannelState,
  SavedGameData,
  SavedRobotState,
  SavedRuntimeStatus,
  SaveSlot,
} from './save/types'

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
  { id: 'RCTR-110', name: 'Reactor Controller', category: 'POWER', status: 'DEGRADED', description: 'Runs the safe-start sequence of the primary power core.', dependencies: [], affects: ['PWR-100', 'PDU-230'], fault: 'Safe-start sequence is not configured.', recommendation: 'Open the reactor panel and complete the startup alignment.', windowId: 'reactor' },
  { id: 'BAT-220', name: 'Battery Pack', category: 'POWER', status: 'ONLINE', description: 'Backup energy store.', dependencies: [], affects: ['BMS-221', 'PDU-230'], fault: 'No active fault reported.', recommendation: 'No action required.' },
  { id: 'BMS-221', name: 'Battery Management System', category: 'POWER', status: 'OFFLINE', description: 'Monitors and protects the battery.', dependencies: ['BAT-220'], affects: ['PDU-230'], fault: 'Telemetry is degraded.', recommendation: 'Inspect battery telemetry after primary power recovery.' },
  { id: 'PDU-230', name: 'Power Distribution Unit', category: 'POWER', status: 'DEGRADED', description: 'Routes power to the individual system rails.', dependencies: ['PWR-100', 'RCTR-110'], affects: ['BUS-T-240', 'ANL-450', 'ACT-610'], fault: 'Body and actuator rails are not enabled.', recommendation: 'Complete the reactor startup, then solve the distribution-grid puzzle.', windowId: 'powerDistribution' },
  { id: 'BUS-T-240', name: 'Body Power Bus', category: 'POWER', status: 'OFFLINE', description: 'Energizes the torso and sensor rails from the primary source.', dependencies: ['PWR-100', 'PDU-230'], affects: ['ACT-610', 'CAM-410', 'IMU-430'], fault: 'BODY_MAIN route is not energized.', recommendation: 'Complete the reactor startup, then solve the distribution-grid puzzle.', windowId: 'powerDistribution' },
  { id: 'CPU-730', name: 'Central Processing Unit', category: 'COMPUTE', status: 'DEGRADED', description: 'Executes system tasks and subsystem logic.', dependencies: ['PDU-230', 'MEM-732'], affects: ['OSK-710', 'DGN-900', 'LOC-630'], fault: 'System memory and the kernel are not fully validated.', recommendation: 'Restore core memory and rerun diagnostics.', windowId: 'memoryCore' },
  { id: 'MEM-732', name: 'System Memory', category: 'COMPUTE', status: 'DEGRADED', description: 'Working memory of the compute core.', dependencies: ['PDU-230'], affects: ['CPU-730', 'OSK-710', 'MCM-740'], fault: 'Memory table integrity has not been verified.', recommendation: 'Open the memory core panel and complete the integrity check.', windowId: 'memoryCore' },
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
  { id: 'LOC-630', name: 'Locomotion Controller', category: 'MOTION', status: 'LOCKED', description: 'Turns motion goals into actuator command sequences.', dependencies: ['CPU-730', 'ACT-610', 'RTS-711'], affects: ['BAL-640'], fault: 'Motion is locked until the safe startup sequence passes.', recommendation: 'Run the recovery sequence: "start" in the console.' },
  { id: 'BAL-640', name: 'Balance & Posture Engine', category: 'MOTION', status: 'OFFLINE', description: 'Stabilizes posture using inertial and force feedback.', dependencies: ['IMU-430', 'FRC-440', 'SRV-620'], affects: ['LOC-630'], fault: 'Sensor calibration and the actuator chain are incomplete.', recommendation: 'Calibrate balance after the sensor and actuator checks.' },
  { id: 'TMP-810', name: 'Thermal Sensor Array', category: 'THERMAL', status: 'ONLINE', description: 'Measures temperatures of key components.', dependencies: ['PDU-230'], affects: ['CLG-820', 'THP-830'], fault: 'Sensor is present but cooling-flow calibration is invalid.', recommendation: 'Validate flow readings in the cooling service panel.', windowId: 'cooling' },
  { id: 'CLG-820', name: 'Cooling Circuit', category: 'THERMAL', status: 'DEGRADED', description: 'Removes heat from the compute and motion assemblies.', dependencies: ['PDU-230'], affects: ['TMP-810', 'THP-830'], fault: 'Coolant flow calibration is invalid.', recommendation: 'Validate flow readings in the cooling service panel.', windowId: 'cooling' },
  { id: 'THP-830', name: 'Overheat Protection Unit', category: 'SAFETY', status: 'ONLINE', description: 'Protects the system from thermal damage.', dependencies: ['TMP-810', 'CLG-820'], affects: ['CPU-730', 'SRV-620'], fault: 'Thermal protection remains armed because cooling is not verified.', recommendation: 'Repair the cooling circuit; do not bypass the interlock.' },
  { id: 'NET-510', name: 'External Command Link', category: 'NETWORK', status: 'OFFLINE', description: 'External communications and telemetry.', dependencies: ['PDU-230'], affects: ['DGN-900'], fault: 'No response.', recommendation: 'Inspect the network interface after core recovery.' },
  { id: 'DGN-900', name: 'Self-Diagnostic Suite', category: 'SYSTEM', status: 'ONLINE', description: 'Collects fault data and validates subsystem dependencies.', dependencies: ['CPU-730', 'OSK-710'], affects: ['FSF-910'], fault: 'Several component checks are still failing.', recommendation: 'Run diagnostics again after each major subsystem repair.' },
  { id: 'FSF-910', name: 'Failsafe Controller', category: 'SAFETY', status: 'ONLINE', description: 'Applies safe behavior during system faults.', dependencies: ['BAT-220'], affects: ['LOC-630', 'BAL-640'], fault: 'No active fault reported.', recommendation: 'Keep safety interlocks enabled.' },
  { id: 'ARM-R-660', name: 'Right Arm Assembly', category: 'BODY', status: 'MISSING', description: 'Physical right-arm assembly.', dependencies: ['BUS-T-240', 'ACT-610', 'SRV-620'], affects: ['LOC-630'], fault: 'Hardware inventory reports that the module is not detected.', recommendation: 'Inspect the assembly map and connector. Power cannot repair missing hardware.' },
  { id: 'LEG-L-670', name: 'Hardware Missing', category: 'BODY', status: 'MISSING', description: 'Physical lower segment of the left leg below the knee.', dependencies: ['BUS-T-240', 'ACT-610', 'SRV-620', 'FRC-440'], affects: ['BAL-640', 'LOC-630'], fault: 'Hardware inventory reports a disconnect at the knee joint.', recommendation: 'Reconnect and register the missing segment; power cannot replace the physical part.' },
]

const INITIAL_CHANNELS: Record<'A' | 'B', AnalyzerChannelState> = { A: 'NO_FEED', B: 'DISABLED' }

const SAVED_STATUSES: ReadonlySet<SavedRuntimeStatus> = new Set([
  'ONLINE', 'DEGRADED', 'OFFLINE', 'CRITICAL', 'MISSING', 'LOCKED',
])

const SAVED_CHANNELS: ReadonlySet<SavedAnalyzerChannelState> = new Set([
  'NO_FEED', 'DISABLED', 'READY', 'ONLINE', 'FAULT',
])

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
    const ready = this.reactorRestored && this.bodyBusRestored && this.busBypassRestored && this.motionProfileRestored && this.memoryCoreRestored
    if (!ready) {
      this.log('ERROR', 'BODY STARTUP', 'Startup blocked: one or more power, memory, or profile checks have not passed.')
      return false
    }
    if (this.getComponentStatus('ARM-R-660') === 'MISSING' || this.getComponentStatus('LEG-L-670') === 'MISSING') {
      // Missing assemblies no longer block startup; they only limit the body test.
      this.log('WARN', 'BODY STARTUP', 'Control profile is ready, but missing physical assemblies limit the body test.')
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

  /** Snapshot of every mutable robot flag, component and log entry. */
  getSaveState(): SavedRobotState {
    return {
      components: [...this.components.values()].map((component) => ({
        id: component.id,
        status: component.status,
        fault: component.fault,
      })),
      events: this.events.map((event) => ({ ...event })),
      eventClock: this.eventClock,
      channels: { ...this.channels },
      flags: {
        reactorRestored: this.reactorRestored,
        analyzerControllerPowered: this.analyzerControllerPowered,
        powerGridPuzzleSolved: this.powerGridPuzzleSolved,
        busBypassRestored: this.busBypassRestored,
        bodyBusRestored: this.bodyBusRestored,
        analyzerValidated: this.analyzerValidated,
        memoryCoreRestored: this.memoryCoreRestored,
        motionProfileRestored: this.motionProfileRestored,
        coolingRestored: this.coolingRestored,
        visionRestored: this.visionRestored,
        motionStartupComplete: this.motionStartupComplete,
        thermalShutdownCount: this.thermalShutdownCount,
      },
    }
  }

  /** Restore a save slot over the pristine component definitions. */
  applySaveState(state: SavedRobotState): void {
    this.reset()
    if (!state || typeof state !== 'object') return

    for (const saved of state.components ?? []) {
      if (!saved || typeof saved.id !== 'string') continue
      const component = this.components.get(saved.id.toUpperCase())
      if (!component) continue
      if (SAVED_STATUSES.has(saved.status)) component.status = saved.status
      if (typeof saved.fault === 'string') component.fault = saved.fault
    }

    const flags = state.flags ?? ({} as SavedRobotState['flags'])
    this.reactorRestored = Boolean(flags.reactorRestored)
    this.analyzerControllerPowered = Boolean(flags.analyzerControllerPowered)
    this.powerGridPuzzleSolved = Boolean(flags.powerGridPuzzleSolved)
    this.busBypassRestored = Boolean(flags.busBypassRestored)
    this.bodyBusRestored = Boolean(flags.bodyBusRestored)
    this.analyzerValidated = Boolean(flags.analyzerValidated)
    this.memoryCoreRestored = Boolean(flags.memoryCoreRestored)
    this.motionProfileRestored = Boolean(flags.motionProfileRestored)
    this.coolingRestored = Boolean(flags.coolingRestored)
    this.visionRestored = Boolean(flags.visionRestored)
    this.motionStartupComplete = Boolean(flags.motionStartupComplete)
    const shutdowns = Number(flags.thermalShutdownCount)
    this.thermalShutdownCount = Number.isFinite(shutdowns) ? Math.max(0, Math.floor(shutdowns)) : 0

    const channels = state.channels ?? INITIAL_CHANNELS
    this.channels.A = SAVED_CHANNELS.has(channels.A) ? channels.A as AnalyzerChannelState : INITIAL_CHANNELS.A
    this.channels.B = SAVED_CHANNELS.has(channels.B) ? channels.B as AnalyzerChannelState : INITIAL_CHANNELS.B

    if (Array.isArray(state.events)) {
      this.events = state.events
        .filter((event) => event && typeof event.message === 'string')
        .map((event) => ({
          time: Number.isFinite(event.time) ? event.time : 0,
          level: event.level === 'WARN' || event.level === 'ERROR' || event.level === 'OK' ? event.level : 'INFO',
          source: typeof event.source === 'string' ? event.source : 'SYSTEM',
          message: event.message,
        }))
    }
    const clock = Number(state.eventClock)
    this.eventClock = Number.isFinite(clock) ? Math.max(this.events.length, Math.floor(clock)) : this.events.length
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

/** Autosave cadence while the player is in a recovery session. */
const AUTOSAVE_INTERVAL = 12

/** Windows that count as active gameplay; menus pause the play clock and autosave. */
const GAMEPLAY_WINDOWS = new Set([
  'console',
  'editor',
  'ui',
  'tasks',
  'reactor',
  'memoryCore',
  'powerDistribution',
  'maze',
  'rasm',
  'victory',
])

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
  /** Persistent slot and settings storage. */
  readonly saveManager: SaveManager

  private width = 0
  private height = 0
  private running = false
  private lastTime = 0
  private fontLoaded = false
  private bgMusic: HTMLAudioElement | null = null
  /** Read-model shared by the interface windows; sampled once per frame. */
  private robotData: RobotData | null = null
  /** Process table and scheduler of the robot's own programs. */
  private kernel: RobotKernel | null = null
  /** The shell that owns the `start` flow and the process control verbs. */
  private consoleWindow: ConsoleWindow | null = null
  /** Session filesystem; snapshotted into every save slot. */
  private fileSystem: VirtualFileSystem
  private codeEditor: CodeEditorWindow | null = null
  private uiWindow: UiWindow | null = null
  private taskManagerWindow: TaskManagerWindow | null = null
  private victoryWindow: VictoryWindow | null = null
  private reactorWindow: ReactorCoreWindow | null = null
  private memoryCoreWindow: MemoryCoreWindow | null = null
  private powerWindow: PowerDistributionWindow | null = null
  private mazeWindow: WindowMaze | null = null
  private rasmWindow: RasmWindow | null = null
  private mainMenu: MainMenuWindow | null = null
  private saveSelect: SaveSelectWindow | null = null
  private settingsWindow: SettingsWindow | null = null
  private shutdownWindow: ShutdownWindow | null = null
  /** Console language of the running session; every window follows it. */
  private language: GameLanguage = 'ru'
  /** Persisted operator settings (language and audio levels). */
  private settings: GameSettings
  /** Slot that receives autosaves; null while browsing the menu. */
  private activeSlotId: number | null = null
  private playSeconds = 0
  private autosaveTimer = 0
  private lastProgressSignature = ''

  private player = { x: 200, y: 200, size: 32, speed: 240 }
  private readonly onResize = () => this.resize()
  private readonly onBeforeUnload = () => this.saveActiveSlot()

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

    this.saveManager = new SaveManager()
    this.settings = this.saveManager.loadSettings()
    this.language = this.settings.language

    // Reset shared state for a new gameplay session. Every subsystem below reports
    // to this same object, and UiWindow reads directly from it.
    this.robotSystem.reset()

    this.fileSystem = new VirtualFileSystem()
    const fileSystem = this.fileSystem

    // The hardware bus a program sees: it answers from the robot's real
    // components, so a script can only touch hardware that is powered.
    const deviceBus = new RobotDeviceBus(this.robotSystem)
    // The kernel turns files into processes: it compiles the sources, hands
    // every one of them a PID and schedules them against the compute budget.
    const kernel = new RobotKernel({ system: this.robotSystem, bus: deviceBus })
    this.kernel = kernel

    // Single read-model in front of RobotSystem + VirtualFileSystem; interface
    // windows consume it instead of touching the raw state or the disk layer.
    const robotData = new RobotData(this.robotSystem, fileSystem, () => this.windows.activeId, kernel)
    this.robotData = robotData
    // Live sensor readings: the body temperature follows the real load, and the
    // battery slowly charges while the primary source is up.
    deviceBus.setSensors({
      temperature: () => robotData.getTemperature(),
      batteryPercent: () => robotData.getBatteryPercent(),
    })

    const codeEditor = new CodeEditorWindow({
      fileSystem,
      returnWindowId: 'ui',
      onValidate: (_path, valid) => {
        if (valid) this.robotSystem.completeMotionProfile()
      },
      onRun: (path, source) => {
        // The editor hands the buffer to the kernel: it becomes a real process
        // the operator can watch in the task manager and stop from the shell.
        const result = robotData.launchProgram(source, { path })
        if (!result) {
          return this.language === 'ru'
            ? 'ЗАПУСК НЕДОСТУПЕН: НЕТ СРЕДЫ ВЫПОЛНЕНИЯ.'
            : 'RUN UNAVAILABLE: NO EXECUTION ENVIRONMENT.'
        }
        if (result.ok) {
          this.robotSystem.log('INFO', 'RUNTIME', `Program ${result.pid} (${result.name}) started from ${path}.`)
          return this.language === 'ru'
            ? `ЗАПУЩЕНО: ${path} · PID ${result.pid}`
            : `STARTED: ${path} · PID ${result.pid}`
        }
        this.robotSystem.log('ERROR', 'RUNTIME', `Program ${result.name} refused: ${result.message.en}`)
        return this.language === 'ru'
          ? `ОТКАЗ: ${result.message.ru}`
          : `REFUSED: ${result.message.en}`
      },
    })
    const consoleWindow = new ConsoleWindow(fileSystem, codeEditor, this.robotSystem, robotData)
    this.consoleWindow = consoleWindow
    this.codeEditor = codeEditor

    const uiWindow = new UiWindow(this.robotSystem, robotData)
    const taskManagerWindow = new TaskManagerWindow(robotData)
    const victoryWindow = new VictoryWindow()
    this.uiWindow = uiWindow
    this.taskManagerWindow = taskManagerWindow
    this.victoryWindow = victoryWindow

    // Existing puzzle windows keep their current constructors. Game.ts owns all
    // robot state; the maze only reports completion through this callback.
    const reactor = new ReactorCoreWindow()
    const memoryCore = new MemoryCoreWindow()
    const powerDistribution = new PowerDistributionWindow()
    const maze = new WindowMaze({
      onSolved: () => this.robotSystem.completeBusBypassPuzzle(),
    })
    this.reactorWindow = reactor
    this.memoryCoreWindow = memoryCore
    this.powerWindow = powerDistribution
    this.mazeWindow = maze

    // RASM demo level: a temperature sensor and a motor on a generic device bus.
    // Compiling a valid program counts as restoring the motion profile, the same
    // way the editor's `:check` command does, so both routes feed the progression.
    const rasmScenario = new DemoScenario()
    const rasmWindow = new RasmWindow({
      scenario: rasmScenario,
      robotBus: deviceBus,
      onProgramValidated: () => this.robotSystem.completeMotionProfile(),
    })
    this.rasmWindow = rasmWindow
    // Seed the debugger with the shipped sample so the player has a working
    // program to step through, and a known-good reference when editing.
    const sampleSource = fileSystem.read(DEMO_PROGRAM_PATH, 'en')
    if (sampleSource) rasmWindow.loadSource(sampleSource.join('\n'))

    // Title screen and the configuration screens behind it.
    const mainMenu = new MainMenuWindow({
      getSaveCount: () => this.saveManager.countSaves(),
      getLanguage: () => this.language,
      onLanguageChange: (language) => this.changeLanguage(language),
      onContinue: () => this.windows.show('saves'),
      onSettings: () => this.windows.show('settings'),
      onExit: () => this.windows.show('shutdown'),
    })
    const saveSelect = new SaveSelectWindow({
      saveManager: this.saveManager,
      onLoad: (slot) => this.loadGame(slot),
      onNewGame: (slotId) => this.startNewGame(slotId),
      onDelete: (slotId) => this.handleSlotDeleted(slotId),
      onBack: () => this.windows.show('mainMenu'),
    })
    const settingsWindow = new SettingsWindow({
      getSettings: () => this.settings,
      onChange: (settings) => this.changeSettings(settings),
      onBack: () => this.windows.show('mainMenu'),
    })
    const shutdownWindow = new ShutdownWindow({
      onReturn: () => this.windows.show('mainMenu'),
    })
    this.mainMenu = mainMenu
    this.saveSelect = saveSelect
    this.settingsWindow = settingsWindow
    this.shutdownWindow = shutdownWindow

    this.windows
      .register(mainMenu)
      .register(saveSelect)
      .register(settingsWindow)
      .register(shutdownWindow)
      .register(consoleWindow)
      .register(codeEditor)
      .register(uiWindow)
      .register(taskManagerWindow)
      .register(reactor)
      .register(memoryCore)
      .register(powerDistribution)
      .register(maze)
      .register(rasmWindow)
      .register(victoryWindow)

    // Apply the stored language and audio levels before the title screen appears.
    this.applyLanguage(this.language)
    this.applyAudioSettings()
    this.windows.show('mainMenu')
  }

  /** Push the selected language into every screen without touching the save slot. */
  private applyLanguage(language: GameLanguage): void {
    this.language = language
    this.mainMenu?.setLanguage(language)
    this.saveSelect?.setLanguage(language)
    this.settingsWindow?.setLanguage(language)
    this.shutdownWindow?.setLanguage(language)
    this.consoleWindow?.setLanguage(language)
    this.codeEditor?.setLanguage(language)
    this.uiWindow?.setLanguage(language)
    this.taskManagerWindow?.setLanguage(language)
    this.victoryWindow?.setLanguage(language)
    this.mazeWindow?.setLanguage(language)
    this.rasmWindow?.setLanguage(language)
  }

  /** Title-screen language switch; the choice is stored with the settings. */
  private changeLanguage(language: GameLanguage): void {
    if (language === this.language) return
    this.settings = this.saveManager.saveSettings({ ...this.settings, language })
    this.applyLanguage(language)
  }

  /** Settings-screen callback. Applies audio immediately and persists the values. */
  private changeSettings(settings: GameSettings): void {
    this.settings = this.saveManager.saveSettings(settings)
    if (this.language !== this.settings.language) this.applyLanguage(this.settings.language)
    this.applyAudioSettings()
  }

  private applyAudioSettings(): void {
    setSfxVolume(this.settings.sfxVolume)
    if (this.bgMusic) this.bgMusic.volume = this.settings.musicVolume
  }

  /** Fresh puzzle layouts and a clean shell for a new session or a loaded save. */
  private resetSessionWindows(): void {
    this.kernel?.clear()
    this.robotData?.resetLatches()
    this.codeEditor?.resetSession()
    this.consoleWindow?.setLanguage(this.language)
    this.reactorWindow?.resetPuzzle()
    this.memoryCoreWindow?.resetPuzzle()
    this.powerWindow?.resetPuzzle()
    this.mazeWindow?.resetPuzzle()
    const sample = this.fileSystem.read(DEMO_PROGRAM_PATH, 'en')
    if (sample) this.rasmWindow?.loadSource(sample.join('\n'))
  }

  /** Start a brand-new recovery session in the given save slot. */
  private startNewGame(slotId: number): void {
    this.activeSlotId = slotId
    this.playSeconds = 0
    this.fileSystem.reset()
    this.resetSessionWindows()
    // The reset also reloads the shipped RASM sample, which validates itself
    // through the normal callback. Reset the robot afterwards so a new game
    // starts from the pristine component state, not from that side effect.
    this.robotSystem.reset()
    this.autosaveTimer = 0
    this.lastProgressSignature = this.progressSignature()
    this.windows.show('console')
    // Create the slot immediately, so CONTINUE lists the session even if the
    // player reloads before the first timed autosave.
    this.saveActiveSlot()
  }

  /** Stop autosaving into a slot the player deleted from the browser. */
  private handleSlotDeleted(slotId: number): void {
    if (this.activeSlotId !== slotId) return
    this.activeSlotId = null
    this.playSeconds = 0
    this.autosaveTimer = 0
    this.lastProgressSignature = ''
  }

  /** Restore a slot and continue in the console. */
  private loadGame(slot: SaveSlot): void {
    this.activeSlotId = slot.id
    this.playSeconds = slot.playSeconds
    this.fileSystem.restore(slot.data.fileSystem)
    this.resetSessionWindows()
    // Apply the saved state last: opening the editor or the RASM sample must
    // not count as progress made during this loaded session.
    this.robotSystem.applySaveState(slot.data.robot)
    this.autosaveTimer = 0
    this.lastProgressSignature = this.progressSignature()
    this.windows.show('console')
  }

  private captureSaveData(): SavedGameData {
    return {
      version: 1,
      language: this.language,
      savedAt: Date.now(),
      robot: this.robotSystem.getSaveState(),
      fileSystem: this.fileSystem.serialize(),
    }
  }

  /** Write the live session into its slot. No-op while no slot is active. */
  private saveActiveSlot(): void {
    if (this.activeSlotId === null) return
    const progress = this.robotSystem.getProgress()
    const written = this.saveManager.writeSlot(this.activeSlotId, this.captureSaveData(), {
      playSeconds: this.playSeconds,
      progressDone: progress.filter((entry) => entry.done).length,
      progressTotal: progress.length,
    })
    if (written) this.lastProgressSignature = this.progressSignature()
  }

  /** Cheap fingerprint of the recovery flags; drives immediate autosaves. */
  private progressSignature(): string {
    const state = this.robotSystem
    return [
      state.reactorRestored,
      state.analyzerControllerPowered,
      state.powerGridPuzzleSolved,
      state.busBypassRestored,
      state.bodyBusRestored,
      state.analyzerValidated,
      state.memoryCoreRestored,
      state.motionProfileRestored,
      state.coolingRestored,
      state.visionRestored,
      state.motionStartupComplete,
      state.thermalShutdownCount,
    ].map((value) => (typeof value === 'boolean' ? (value ? '1' : '0') : String(value))).join('|')
  }

  /** Advance the play clock and autosave on progress changes or on a timer. */
  private updateAutosave(dt: number): void {
    if (this.activeSlotId === null) return
    const active = this.windows.activeId
    if (!active || !GAMEPLAY_WINDOWS.has(active)) return

    this.playSeconds += dt
    this.autosaveTimer += dt
    const signature = this.progressSignature()
    if (signature !== this.lastProgressSignature) {
      this.saveActiveSlot()
      this.autosaveTimer = 0
      return
    }
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL) {
      this.autosaveTimer = 0
      this.saveActiveSlot()
    }
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
    window.addEventListener('beforeunload', this.onBeforeUnload)
    this.resize()

    this.lastTime = performance.now()
    requestAnimationFrame(this.loop)
  }

  /** Starts the looping background track; autoplay may need one user gesture. */
  private startBackgroundMusic(): void {
    if (!this.bgMusic) {
      const music = new Audio(BACKGROUND_MUSIC)
      music.loop = true
      music.volume = this.settings.musicVolume
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
    this.saveActiveSlot()
    this.input.detach()
    this.cursor.detach()
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
  }

  private readonly loop = (time: number) => {
    if (!this.running) return
    const dt = Math.min((time - this.lastTime) / 1000, 0.1)
    this.lastTime = time
    const workStart = performance.now()
    this.update(dt)
    this.render()
    this.mirrorToGlow()
    // Feed the task manager: work time vs. the real frame period.
    this.robotData?.sampleFrame(performance.now() - workStart, dt * 1000)
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
    this.updateAutosave(dt)
    this.syncPuzzleProgress()
    // The runtime lives outside the window manager: programs keep running while
    // another window is open, and the shell notices a finished startup program
    // even when the console is not the active window.
    this.kernel?.tick(dt)
    this.consoleWindow?.pollRuntime()
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

    // Brownout: while the power grid is over capacity the glow layer is cut
    // on every screen, and comes back once the load drops to normal.
    const power = this.windows.get('powerDistribution') as unknown as { powerOverCapacity?: boolean } | undefined
    if (power?.powerOverCapacity) return

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
