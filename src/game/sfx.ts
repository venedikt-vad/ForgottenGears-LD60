// Short one-shot sound effects from public/sound, shared by the game windows.
const BASE = import.meta.env.BASE_URL

export type SfxName =
  | 'selection'
  | 'correct'
  | 'incorrect'
  | 'connected'
  | 'disconnected'
  | 'power_loss'

const DEFAULT_VOLUME = 0.6

// One template per effect keeps the browser cache warm for the first play.
const templates = new Map<SfxName, HTMLAudioElement>()

function templateFor(name: SfxName): HTMLAudioElement {
  let template = templates.get(name)
  if (!template) {
    template = new Audio(`${BASE}sound/${name}.mp3`)
    template.preload = 'auto'
    templates.set(name, template)
  }
  return template
}

/** Plays a sound effect; every call gets its own copy so plays can overlap. */
export function playSfx(name: SfxName, volume = DEFAULT_VOLUME): void {
  const audio = templateFor(name).cloneNode(true) as HTMLAudioElement
  audio.volume = volume
  // Autoplay may be blocked until the first user gesture; the miss is harmless.
  audio.play().catch(() => {})
}
