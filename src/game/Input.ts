export type KeyState = {
  down: boolean
}

export class Input {
  private keys = new Map<string, KeyState>()
  private pressedThisFrame = new Set<string>()
  private releasedThisFrame = new Set<string>()
  // Keep ordered key events, including OS auto-repeat, for terminal text entry.
  private pressedKeyValues: string[] = []
  private wheelDeltaY = 0

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const state = this.keys.get(e.code)
    if (!state?.down) {
      this.pressedThisFrame.add(e.code)
      this.keys.set(e.code, { down: true })
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      if (e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Escape' || e.key.length === 1) {
        this.pressedKeyValues.push(e.key)
      }
    }

    if (e.key === 'Backspace' || e.key.startsWith('Arrow') || e.key === ' ' || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (this.keys.has(e.code)) {
      this.releasedThisFrame.add(e.code)
      this.keys.set(e.code, { down: false })
    }
  }

  private readonly onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return
    this.wheelDeltaY += e.deltaY
    e.preventDefault()
  }

  private readonly onBlur = () => {
    this.keys.clear()
    this.pressedThisFrame.clear()
    this.releasedThisFrame.clear()
    this.pressedKeyValues.length = 0
    this.wheelDeltaY = 0
  }

  attach(target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
    target.addEventListener('wheel', this.onWheel, { passive: false })
  }

  detach(target: Window = window) {
    target.removeEventListener('keydown', this.onKeyDown)
    target.removeEventListener('keyup', this.onKeyUp)
    target.removeEventListener('blur', this.onBlur)
    target.removeEventListener('wheel', this.onWheel)
  }

  isDown(code: string): boolean {
    return this.keys.get(code)?.down ?? false
  }

  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code)
  }

  wasReleased(code: string): boolean {
    return this.releasedThisFrame.has(code)
  }

  /** KeyboardEvent.key values in event order, including OS auto-repeat events. */
  getPressedKeyValues(): string[] {
    return [...this.pressedKeyValues]
  }

  /** Wheel delta accumulated since the previous call; negative means scroll up. */
  consumeWheelDelta(): number {
    const value = this.wheelDeltaY
    this.wheelDeltaY = 0
    return value
  }

  endFrame() {
    this.pressedThisFrame.clear()
    this.releasedThisFrame.clear()
    this.pressedKeyValues.length = 0
  }
}
