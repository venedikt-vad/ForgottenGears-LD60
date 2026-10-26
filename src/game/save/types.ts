import type { GameLanguage } from '../windows/GameWindow'
import type { VirtualFileSystemSnapshot } from '../VirtualFileSystem'

export type SavedRuntimeStatus =
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'CRITICAL'
  | 'MISSING'
  | 'LOCKED'

export type SavedEventLevel = 'INFO' | 'WARN' | 'ERROR' | 'OK'

export type SavedAnalyzerChannelState = 'NO_FEED' | 'DISABLED' | 'READY' | 'ONLINE' | 'FAULT'

export interface SavedComponent {
  id: string
  status: SavedRuntimeStatus
  fault: string
}

export interface SavedSystemEvent {
  time: number
  level: SavedEventLevel
  source: string
  message: string
}

export interface SavedRobotFlags {
  reactorRestored: boolean
  analyzerControllerPowered: boolean
  powerGridPuzzleSolved: boolean
  busBypassRestored: boolean
  bodyBusRestored: boolean
  analyzerValidated: boolean
  memoryCoreRestored: boolean
  motionProfileRestored: boolean
  coolingRestored: boolean
  visionRestored: boolean
  motionStartupComplete: boolean
  thermalShutdownCount: number
}

export interface SavedRobotState {
  components: SavedComponent[]
  events: SavedSystemEvent[]
  eventClock: number
  channels: Record<'A' | 'B', SavedAnalyzerChannelState>
  flags: SavedRobotFlags
}

export interface SavedGameData {
  version: 1
  language: GameLanguage
  savedAt: number
  robot: SavedRobotState
  fileSystem: VirtualFileSystemSnapshot
}

export interface SaveSlot {
  /** 0-based slot index. */
  id: number
  name: string
  createdAt: number
  updatedAt: number
  playSeconds: number
  /** Completed recovery tasks, 0..total. */
  progressDone: number
  progressTotal: number
  data: SavedGameData
}

export interface GameSettings {
  language: GameLanguage
  /** 0..1 */
  musicVolume: number
  /** 0..1 */
  sfxVolume: number
}
