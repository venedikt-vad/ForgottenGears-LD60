import type { GameSettings, SaveSlot, SavedGameData } from './types'

const SAVES_KEY = 'forgottenGears.saves.v1'
const SETTINGS_KEY = 'forgottenGears.settings.v1'
export const SAVE_SLOT_COUNT = 6

const DEFAULT_SETTINGS: GameSettings = {
  language: 'ru',
  musicVolume: 0.5,
  sfxVolume: 0.6,
}

function clampVolume(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(1, Math.max(0, numeric))
}

function isLanguage(value: unknown): value is GameSettings['language'] {
  return value === 'ru' || value === 'en'
}

function normalizeSettings(value: unknown): GameSettings {
  const source = typeof value === 'object' && value !== null
    ? value as Partial<GameSettings>
    : {}
  return {
    language: isLanguage(source.language) ? source.language : DEFAULT_SETTINGS.language,
    musicVolume: clampVolume(source.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clampVolume(source.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
  }
}

function isValidSavedData(value: unknown): value is SavedGameData {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Partial<SavedGameData>
  return data.version === 1
    && isLanguage(data.language)
    && typeof data.robot === 'object'
    && data.robot !== null
    && Array.isArray(data.robot.components)
    && typeof data.fileSystem === 'object'
    && data.fileSystem !== null
    && Array.isArray(data.fileSystem.files)
}

function isSaveSlot(value: unknown): value is SaveSlot {
  if (typeof value !== 'object' || value === null) return false
  const slot = value as Partial<SaveSlot>
  return typeof slot.id === 'number'
    && Number.isInteger(slot.id)
    && slot.id >= 0
    && slot.id < SAVE_SLOT_COUNT
    && typeof slot.name === 'string'
    && typeof slot.createdAt === 'number'
    && typeof slot.updatedAt === 'number'
    && isValidSavedData(slot.data)
}

/**
 * Persistent save slots and user settings. Everything lives in localStorage;
 * when storage is unavailable (private mode, tests) the manager keeps working
 * in memory for the current session.
 */
export class SaveManager {
  private slots: Array<SaveSlot | null> = new Array<SaveSlot | null>(SAVE_SLOT_COUNT).fill(null)
  private settings: GameSettings = { ...DEFAULT_SETTINGS }

  constructor() {
    this.readFromStorage()
  }

  /** All slots in index order; empty positions are `null`. */
  listSlots(): Array<SaveSlot | null> {
    return this.slots.map((slot) => (slot ? this.cloneSlot(slot) : null))
  }

  getSlot(id: number): SaveSlot | null {
    const slot = this.slots[id]
    return slot ? this.cloneSlot(slot) : null
  }

  countSaves(): number {
    return this.slots.reduce((count, slot) => count + (slot ? 1 : 0), 0)
  }

  /**
   * Start or overwrite a slot. `createdAt` and the generated name survive a
   * later overwrite, so a slot keeps its identity across sessions.
   */
  writeSlot(id: number, data: SavedGameData, options: {
    playSeconds?: number
    progressDone?: number
    progressTotal?: number
  } = {}): SaveSlot | null {
    if (!Number.isInteger(id) || id < 0 || id >= SAVE_SLOT_COUNT) return null
    if (!isValidSavedData(data)) return null

    const now = Date.now()
    const existing = this.slots[id]
    const slot: SaveSlot = {
      id,
      name: existing?.name ?? `СЕАНС ${String(id + 1).padStart(2, '0')}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      playSeconds: Math.max(0, Math.round(options.playSeconds ?? existing?.playSeconds ?? 0)),
      progressDone: Math.max(0, Math.round(options.progressDone ?? 0)),
      progressTotal: Math.max(1, Math.round(options.progressTotal ?? 1)),
      data: structuredCloneSafe(data),
    }
    this.slots[id] = slot
    this.persistSaves()
    return this.cloneSlot(slot)
  }

  deleteSlot(id: number): boolean {
    if (!Number.isInteger(id) || id < 0 || id >= SAVE_SLOT_COUNT) return false
    if (!this.slots[id]) return false
    this.slots[id] = null
    this.persistSaves()
    return true
  }

  loadSettings(): GameSettings {
    return { ...this.settings }
  }

  saveSettings(settings: GameSettings): GameSettings {
    this.settings = normalizeSettings(settings)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      // In-memory settings still apply to the current session.
    }
    return this.loadSettings()
  }

  private readFromStorage(): void {
    try {
      const rawSaves = localStorage.getItem(SAVES_KEY)
      if (rawSaves) {
        const parsed: unknown = JSON.parse(rawSaves)
        if (Array.isArray(parsed)) {
          const next: Array<SaveSlot | null> = new Array<SaveSlot | null>(SAVE_SLOT_COUNT).fill(null)
          for (const entry of parsed) {
            if (!isSaveSlot(entry)) continue
            next[entry.id] = entry
          }
          this.slots = next
        }
      }
    } catch {
      // Ignore corrupt storage; the player can still create fresh slots.
    }

    try {
      const rawSettings = localStorage.getItem(SETTINGS_KEY)
      if (rawSettings) this.settings = normalizeSettings(JSON.parse(rawSettings))
    } catch {
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  private persistSaves(): void {
    try {
      localStorage.setItem(SAVES_KEY, JSON.stringify(this.slots))
    } catch {
      // Storage full or blocked: keep the slot in memory for this session.
    }
  }

  private cloneSlot(slot: SaveSlot): SaveSlot {
    return structuredCloneSafe(slot)
  }
}

/** structuredClone is available in modern browsers; JSON is a safe fallback. */
function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}
