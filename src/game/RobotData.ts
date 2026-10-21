import type { RobotSystem, RuntimeComponent, RuntimeStatus, SystemEvent } from './Game'
import type { GameLanguage } from './windows/GameWindow'
import { VirtualFileSystem, formatBytes, type VirtualStorageUsage } from './VirtualFileSystem'
import type { RobotKernel } from './runtime/RobotKernel'
import type { LaunchResult, RobotProgram } from './runtime/types'

export interface RobotPerformance {
  /** Smoothed frames per second. */
  fps: number
  /** Smoothed frame period in milliseconds. */
  frameTimeMs: number
  /** Longest frame observed in the recent window, in milliseconds. */
  worstFrameMs: number
  /** Share of the frame budget actually spent on update/render, in percent. */
  loadPercent: number
  uptimeSeconds: number
  /** Rolling history (oldest first) for sparkline graphs. */
  fpsHistory: number[]
  loadHistory: number[]
}

export type RobotParameterLevel = 'ok' | 'warn' | 'bad'

export interface RobotParameter {
  id: string
  label: Record<GameLanguage, string>
  value: string
  /** 0..1 fill ratio for the gauge bar. */
  ratio: number
  level: RobotParameterLevel
}

export type RobotProcessState = 'RUNNING' | 'DEGRADED' | 'WAITING' | 'SUSPENDED' | 'STOPPED' | 'FAULT'

export interface RobotProcess {
  pid: number
  name: string
  componentId: string | null
  cpuPercent: number
  memoryKb: number
  state: RobotProcessState
  detail: Record<GameLanguage, string>
  /** System services come from the component registry, programs from the kernel. */
  kind: 'service' | 'program'
  /** Source path of a user program, when it was launched from storage. */
  path?: string | null
  /** Instructions a user program has retired. */
  instructions?: number
}

interface ProcessDefinition {
  pid: number
  name: string
  componentId?: string
  /** Relative CPU share of a healthy system; shares are normalized per frame. */
  share: number
  memoryKb: number
  phase: number
  detail: Record<GameLanguage, string>
}

// Fixed process table: every row is tied to a real RobotSystem component, so a
// broken subsystem shows up in the task manager as a stopped or faulted service.
const PROCESS_DEFINITIONS: ProcessDefinition[] = [
  { pid: 1, name: 'fg.kernel', componentId: 'OSK-710', share: 0.14, memoryKb: 5120, phase: 0.0, detail: { ru: 'Ядро ОС / доступ к устройствам', en: 'Kernel / device access' } },
  { pid: 2, name: 'fg.cpu.mgr', componentId: 'CPU-730', share: 0.16, memoryKb: 4096, phase: 1.1, detail: { ru: 'Планирование вычислений', en: 'Compute scheduling' } },
  { pid: 3, name: 'fg.diag.svc', componentId: 'DGN-900', share: 0.07, memoryKb: 2048, phase: 2.3, detail: { ru: 'Самодиагностика', en: 'Self-diagnostics' } },
  { pid: 4, name: 'fg.power.route', componentId: 'PDU-230', share: 0.06, memoryKb: 1536, phase: 3.5, detail: { ru: 'Распределение питания', en: 'Power routing' } },
  { pid: 5, name: 'fg.power.core', componentId: 'PWR-100', share: 0.05, memoryKb: 1024, phase: 4.2, detail: { ru: 'Контроль источника', en: 'Source monitoring' } },
  { pid: 6, name: 'fg.battery.mgr', componentId: 'BMS-221', share: 0.03, memoryKb: 512, phase: 5.0, detail: { ru: 'Контроль батареи', en: 'Battery supervision' } },
  { pid: 7, name: 'fg.motion.profile', componentId: 'MCM-740', share: 0.1, memoryKb: 3072, phase: 0.6, detail: { ru: 'Хранилище профиля движения', en: 'Motion profile store' } },
  { pid: 8, name: 'fg.actuator.bus', componentId: 'ACT-610', share: 0.09, memoryKb: 2048, phase: 1.7, detail: { ru: 'Шина исполнительных механизмов', en: 'Actuator command bus' } },
  { pid: 9, name: 'fg.servo.ctl', componentId: 'SRV-620', share: 0.08, memoryKb: 2560, phase: 2.9, detail: { ru: 'Сервоприводы и суставы', en: 'Servos and joints' } },
  { pid: 10, name: 'fg.balance.eng', componentId: 'BAL-640', share: 0.07, memoryKb: 2048, phase: 3.8, detail: { ru: 'Стабилизация корпуса', en: 'Posture stabilization' } },
  { pid: 11, name: 'fg.thermal.mon', componentId: 'TMP-810', share: 0.04, memoryKb: 768, phase: 4.7, detail: { ru: 'Телеметрия температуры', en: 'Temperature telemetry' } },
  { pid: 12, name: 'fg.thermal.prot', componentId: 'THP-830', share: 0.03, memoryKb: 512, phase: 5.4, detail: { ru: 'Защита от перегрева', en: 'Overheat protection' } },
  { pid: 13, name: 'fg.vision.stream', componentId: 'CAM-410', share: 0.11, memoryKb: 6144, phase: 0.9, detail: { ru: 'Поток основной камеры', en: 'Primary camera stream' } },
  { pid: 14, name: 'fg.lidar.scan', componentId: 'LID-420', share: 0.08, memoryKb: 4096, phase: 2.0, detail: { ru: 'Сканирование LIDAR', en: 'LIDAR scanning' } },
  { pid: 15, name: 'fg.imu.telemetry', componentId: 'IMU-430', share: 0.04, memoryKb: 512, phase: 3.1, detail: { ru: 'Телеметрия инерции', en: 'Inertial telemetry' } },
  { pid: 16, name: 'fg.force.fb', componentId: 'FRC-440', share: 0.04, memoryKb: 768, phase: 4.4, detail: { ru: 'Обратная связь по силе', en: 'Force feedback' } },
  { pid: 17, name: 'fg.analyzer.svc', componentId: 'ANL-450', share: 0.05, memoryKb: 1536, phase: 5.8, detail: { ru: 'Служба анализатора', en: 'Analyzer service' } },
  { pid: 18, name: 'fg.net.link', componentId: 'NET-510', share: 0.03, memoryKb: 1024, phase: 1.4, detail: { ru: 'Внешний канал связи', en: 'External command link' } },
  { pid: 19, name: 'fg.failsafe', componentId: 'FSF-910', share: 0.04, memoryKb: 1024, phase: 2.6, detail: { ru: 'Контроллер безопасного режима', en: 'Failsafe controller' } },
  { pid: 90, name: 'fg.fs.service', share: 0.03, memoryKb: 1024, phase: 0.3, detail: { ru: 'Виртуальная файловая система', en: 'Virtual file system' } },
  { pid: 91, name: 'fg.shell', share: 0.05, memoryKb: 2048, phase: 1.9, detail: { ru: 'Оболочка оператора', en: 'Operator shell' } },
  { pid: 92, name: 'fg.telemetry.log', share: 0.02, memoryKb: 1536, phase: 3.3, detail: { ru: 'Журнал событий', en: 'Event log' } },
]

const HISTORY_LIMIT = 90
const TARGET_FRAME_MS = 16.7

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function stateForStatus(status: RuntimeStatus): RobotProcessState {
  switch (status) {
    case 'ONLINE': return 'RUNNING'
    case 'DEGRADED': return 'DEGRADED'
    case 'CRITICAL':
    case 'LOCKED': return 'FAULT'
    case 'OFFLINE':
    case 'MISSING':
    default: return 'STOPPED'
  }
}

/**
 * Single read-model in front of RobotSystem + VirtualFileSystem for interface
 * windows. Windows never reach into the raw state or the filesystem: they ask
 * this class for components, performance samples, storage usage and processes.
 */
export class RobotData {
  private readonly system: RobotSystem
  private readonly fileSystem: VirtualFileSystem
  private readonly activeWindowId: () => string | null
  /** The process table; null when the game runs without a runtime. */
  private readonly kernel: RobotKernel | null

  private uptime = 0
  private frameTimeEma = TARGET_FRAME_MS
  private workTimeEma = TARGET_FRAME_MS * 0.35
  private worstFrameMs = TARGET_FRAME_MS
  private worstFrameCooldown = 0
  private readonly fpsHistory: number[] = []
  private readonly loadHistory: number[] = []

  constructor(
    system: RobotSystem,
    fileSystem: VirtualFileSystem,
    activeWindowId: () => string | null = () => null,
    kernel: RobotKernel | null = null,
  ) {
    this.system = system
    this.fileSystem = fileSystem
    this.activeWindowId = activeWindowId
    this.kernel = kernel
  }

  // ---------------------------------------------------------------- robot state

  listComponents(): RuntimeComponent[] {
    return this.system.listComponents()
  }

  getComponent(id: string): RuntimeComponent | undefined {
    return this.system.getComponent(id)
  }

  getComponentStatus(id: string): RuntimeStatus {
    return this.system.getComponentStatus(id)
  }

  getCounts(): Record<RuntimeStatus, number> {
    return this.system.getCounts()
  }

  getEvents(): SystemEvent[] {
    return this.system.getEvents()
  }

  getProgress(): { label: string; done: boolean; detail: string }[] {
    return this.system.getProgress()
  }

  /** `OPERATIONAL` once the safe startup sequence has passed, otherwise `RECOVERY`. */
  getMode(): 'OPERATIONAL' | 'RECOVERY' {
    return this.system.motionStartupComplete ? 'OPERATIONAL' : 'RECOVERY'
  }

  // --------------------------------------------------------------- performance

  /**
   * Called once per frame from the game loop. `workMs` is the time actually
   * spent in update+render, `frameMs` the real elapsed frame period.
   */
  sampleFrame(workMs: number, frameMs: number): void {
    const frame = clamp(frameMs, 0.5, 250)
    const work = clamp(workMs, 0, frame)
    this.uptime += frameMs / 1000
    this.frameTimeEma += (frame - this.frameTimeEma) * 0.08
    this.workTimeEma += (work - this.workTimeEma) * 0.08

    this.worstFrameCooldown -= frameMs / 1000
    if (this.worstFrameCooldown <= 0) {
      this.worstFrameMs = this.frameTimeEma
      this.worstFrameCooldown = 2
    } else {
      this.worstFrameMs = Math.max(this.worstFrameMs, frame)
    }

    const fps = 1000 / this.frameTimeEma
    const load = this.computeLoad()
    this.fpsHistory.push(fps)
    this.loadHistory.push(load)
    if (this.fpsHistory.length > HISTORY_LIMIT) this.fpsHistory.shift()
    if (this.loadHistory.length > HISTORY_LIMIT) this.loadHistory.shift()
  }

  private computeLoad(): number {
    // Work time relative to the real frame period: vsync idle is not CPU load.
    const raw = (this.workTimeEma / this.frameTimeEma) * 100
    return clamp(Math.round(raw * 10) / 10, 1, 99)
  }

  getPerformance(): RobotPerformance {
    return {
      fps: 1000 / this.frameTimeEma,
      frameTimeMs: this.frameTimeEma,
      worstFrameMs: this.worstFrameMs,
      loadPercent: this.computeLoad(),
      uptimeSeconds: this.uptime,
      fpsHistory: [...this.fpsHistory],
      loadHistory: [...this.loadHistory],
    }
  }

  // ------------------------------------------------------------------- storage

  getStorage(): VirtualStorageUsage {
    return this.fileSystem.getStorageUsage()
  }

  // ------------------------------------------------------------------ metrics

  /** Estimated JS heap, falling back to a model of the game's own allocations. */
  getMemory(): { usedBytes: number; totalBytes: number } {
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
    const heap = perf.memory
    if (heap && heap.usedJSHeapSize > 0) {
      return { usedBytes: heap.usedJSHeapSize, totalBytes: heap.jsHeapSizeLimit || 256 * 1024 * 1024 }
    }
    const storage = this.fileSystem.getStorageUsage()
    const used = 24 * 1024 * 1024 + storage.usedBytes
    return { usedBytes: used, totalBytes: 192 * 1024 * 1024 }
  }

  /** Synthetic but deterministic body temperature driven by load and cooling state. */
  getTemperature(): number {
    const load = this.computeLoad()
    const coolingBonus = this.system.coolingRestored ? -7 : 14
    const motionBonus = this.system.motionStartupComplete ? 5 : 0
    const drift = Math.sin(this.uptime / 6) * 1.4
    return clamp(37 + load * 0.24 + coolingBonus + motionBonus + drift, 28, 96)
  }

  /**
   * Remaining battery charge in percent.
   *
   * The pack charges slowly while the primary source is stable and drains a
   * little while the robot works, so the BATT port reports a live reading.
   */
  getBatteryPercent(): number {
    const charging = this.system.reactorRestored ? 11 : 0
    const drain = this.system.motionStartupComplete ? 6 : 0
    const drift = Math.sin(this.uptime / 45) * 2.5
    return clamp(Math.round(63 + charging - drain + drift), 8, 100)
  }

  /** Rail draw in watts: each restored subsystem adds its share of the load. */
  getPowerWatts(): number {
    let watts = 96
    if (this.system.reactorRestored) watts += 44
    if (this.system.bodyBusRestored) watts += 88
    if (this.system.busBypassRestored) watts += 46
    if (this.system.analyzerControllerPowered) watts += 14
    if (this.system.visionRestored) watts += 26
    if (this.system.motionStartupComplete) watts += 118
    return Math.round(watts + this.computeLoad() * 0.55)
  }

  /** Aggregated gauges for the task manager and other interface windows. */
  getParameters(language: GameLanguage): RobotParameter[] {
    const perf = this.getPerformance()
    const memory = this.getMemory()
    const temperature = this.getTemperature()
    const watts = this.getPowerWatts()
    const storage = this.fileSystem.getStorageUsage()

    const level = (value: number, warnAt: number, badAt: number): RobotParameterLevel =>
      value >= badAt ? 'bad' : value >= warnAt ? 'warn' : 'ok'

    return [
      {
        id: 'cpu',
        label: { ru: 'ЗАГРУЗКА CPU', en: 'CPU LOAD' },
        value: `${perf.loadPercent.toFixed(1)} %`,
        ratio: perf.loadPercent / 100,
        level: level(perf.loadPercent, 70, 88),
      },
      {
        id: 'frame',
        label: { ru: 'КАДР', en: 'FRAME' },
        value: `${perf.frameTimeMs.toFixed(1)} ms / ${perf.fps.toFixed(0)} FPS`,
        ratio: perf.frameTimeMs / (TARGET_FRAME_MS * 2),
        level: level(perf.frameTimeMs, 22, 34),
      },
      {
        id: 'memory',
        label: { ru: 'ПАМЯТЬ', en: 'MEMORY' },
        value: `${formatBytes(memory.usedBytes, language)} / ${formatBytes(memory.totalBytes, language)}`,
        ratio: memory.usedBytes / Math.max(1, memory.totalBytes),
        level: level(memory.usedBytes / Math.max(1, memory.totalBytes), 0.75, 0.9),
      },
      {
        id: 'thermal',
        label: { ru: 'ТЕМПЕРАТУРА', en: 'TEMPERATURE' },
        value: `${temperature.toFixed(1)} °C`,
        ratio: clamp((temperature - 28) / 62, 0, 1),
        level: level(temperature, 62, 78),
      },
      {
        id: 'power',
        label: { ru: 'ПОТРЕБЛЕНИЕ', en: 'POWER DRAW' },
        value: `${watts} W`,
        ratio: clamp(watts / 420, 0, 1),
        level: level(watts, 320, 390),
      },
      {
        id: 'storage',
        label: { ru: 'ХРАНИЛИЩЕ', en: 'STORAGE' },
        value: `${formatBytes(storage.usedBytes, language)} / ${formatBytes(storage.maxBytes, language)}`,
        ratio: storage.byteRatio,
        level: level(storage.byteRatio, 0.7, 0.9),
      },
      {
        id: 'files',
        label: { ru: 'ФАЙЛЫ', en: 'FILES' },
        value: `${storage.fileCount} / ${storage.maxFiles}`,
        ratio: storage.fileRatio,
        level: level(storage.fileRatio, 0.7, 0.9),
      },
    ]
  }

  // ----------------------------------------------------------------- processes

  /**
   * Live process table: system services first, then the programs the operator
   * has launched. Service shares are renormalized over the services that run;
   * a program reports the share of the compute budget it actually used.
   */
  getProcesses(): RobotProcess[] {
    const load = this.computeLoad()
    const base = PROCESS_DEFINITIONS.map((definition) => {
      const status = definition.componentId ? this.system.getComponentStatus(definition.componentId) : 'ONLINE'
      const state = definition.componentId ? stateForStatus(status) : 'RUNNING'
      const wave = 0.72 + 0.28 * Math.sin(this.uptime * (0.6 + definition.share * 2) + definition.phase)
      const stateFactor = state === 'RUNNING' ? 1 : state === 'DEGRADED' ? 0.45 : state === 'FAULT' ? 0.2 : 0
      return { definition, state, weight: definition.share * wave * stateFactor }
    })

    const totalWeight = base.reduce((sum, entry) => sum + entry.weight, 0)
    const memoryKb = (definition: ProcessDefinition, state: RobotProcessState): number => {
      if (state === 'STOPPED') return 0
      const factor = state === 'RUNNING' ? 1 : state === 'DEGRADED' ? 0.7 : state === 'WAITING' ? 0.5 : 0.3
      return Math.round(definition.memoryKb * factor)
    }

    const services = base.map(({ definition, state, weight }) => {
      const cpu = totalWeight > 0 ? (load * weight) / totalWeight : 0
      return {
        pid: definition.pid,
        name: definition.name,
        componentId: definition.componentId ?? null,
        cpuPercent: Math.round(cpu * 10) / 10,
        memoryKb: memoryKb(definition, state),
        state,
        detail: definition.detail,
        kind: 'service' as const,
        path: null,
        instructions: 0,
      }
    })

    return [...services, ...this.getProgramProcesses()]
  }

  /** User programs, rendered as rows of the same process table. */
  private getProgramProcesses(): RobotProcess[] {
    return this.listPrograms().map((program) => ({
      pid: program.pid,
      name: program.name,
      componentId: null,
      cpuPercent: Math.round(program.cpuPercent * 10) / 10,
      memoryKb: program.memoryKb,
      state: program.state,
      detail: program.detail,
      kind: 'program' as const,
      path: program.path,
      instructions: program.instructions,
    }))
  }

  /** Every program the kernel knows about, live ones first. */
  listPrograms(): RobotProgram[] {
    return this.kernel?.list() ?? []
  }

  /** Every program launched from a given path, live ones first. */
  listProgramsByPath(path: string): RobotProgram[] {
    return this.kernel?.listByPath(path) ?? []
  }

  /** One program by PID, or undefined. */
  getProgram(pid: number): RobotProgram | undefined {
    return this.kernel?.get(pid)
  }

  /**
   * Compile a source and start it as a process.
   *
   * The kernel refuses the launch when the source does not build, when the
   * compute chain is down, or when too many programs are already live.
   */
  launchProgram(
    source: string,
    options: { name?: string; path?: string; priority?: number } = {},
  ): LaunchResult | null {
    return this.kernel?.launch(source, options) ?? null
  }

  /** Terminate a program. Returns false when the PID is unknown or already over. */
  killProcess(pid: number): boolean {
    return this.kernel?.kill(pid) ?? false
  }

  /** Pause a program; it keeps its state and resumes where it stopped. */
  suspendProcess(pid: number): boolean {
    return this.kernel?.suspend(pid) ?? false
  }

  /** Continue a suspended program. */
  resumeProcess(pid: number): boolean {
    return this.kernel?.resume(pid) ?? false
  }

  /** Restart a program from its source, clearing the error state. */
  resetProcess(pid: number): boolean {
    return this.kernel?.reset(pid) ?? false
  }

  /** Read a kernel latch a program wrote (BOOT, DIAG). */
  readLatch(name: string): number {
    return this.kernel?.readLatch(name) ?? 0
  }

  /** Clear the kernel latches, so the next run reports its own result only. */
  resetLatches(): void {
    this.kernel?.resetLatches()
  }

  /** Which window the shell currently hosts; shown as the shell process detail. */
  getActiveWindowId(): string | null {
    return this.activeWindowId()
  }

  formatUptime(language: GameLanguage): string {
    const total = Math.floor(this.uptime)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    const pad = (value: number) => String(value).padStart(2, '0')
    const stamp = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    return language === 'ru' ? `НАРАБОТКА ${stamp}` : `UPTIME ${stamp}`
  }
}

/** Shared read-model used by every interface window in this session. */
export type { VirtualStorageUsage }
