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

  private pointerX = 0
  private pointerY = 0
  private pointerDeltaX = 0
  private pointerDeltaY = 0
  private pointerDown = false

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const state = this.keys.get(e.code)

    if (!state?.down) {
      this.pressedThisFrame.add(e.code)
      this.keys.set(e.code, { down: true })
    }

    // Tab must be explicitly included: unlike letters, its key string is longer than one character.
    if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.isComposing &&
      (
        e.key === 'Backspace' ||
        e.key === 'Enter' ||
        e.key === 'Escape' ||
        e.key === 'Tab' ||
        e.key === 'Delete' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === 'PageUp' ||
        e.key === 'PageDown' ||
        e.key.startsWith('Arrow') ||
        e.key.length === 1
      )
    ) {
      this.pressedKeyValues.push(e.key)
    }

    // Prevent browser focus traversal while using the game's terminal, and retain the
    // existing prevention for editing/navigation keys.
    if (
      (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) ||
      e.key === 'Backspace' ||
      e.key === 'Enter' ||
      e.key === 'Escape' ||
      e.key === 'Delete' ||
      e.key === 'Home' ||
      e.key === 'End' ||
      e.key.startsWith('Arrow') ||
      e.key === ' ' ||
      e.key === 'PageUp' ||
      e.key === 'PageDown'
    ) {
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

  // Dragging with the right button must not open the browser's own menu.
  private readonly onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    this.pointerDown = true
    this.pointerX = e.clientX
    this.pointerY = e.clientY
  }

  private readonly onPointerUp = (e: PointerEvent) => {
    this.pointerDown = false
    this.pointerX = e.clientX
    this.pointerY = e.clientY
  }

  private readonly onPointerMove = (e: PointerEvent) => {
    if (this.pointerDown) {
      this.pointerDeltaX += e.clientX - this.pointerX
      this.pointerDeltaY += e.clientY - this.pointerY
    }
    this.pointerX = e.clientX
    this.pointerY = e.clientY
  }

  private readonly onBlur = () => {
    this.keys.clear()
    this.pressedThisFrame.clear()
    this.releasedThisFrame.clear()
    this.pressedKeyValues.length = 0
    this.wheelDeltaY = 0
    this.pointerDown = false
    this.pointerDeltaX = 0
    this.pointerDeltaY = 0
  }

  attach(target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
    target.addEventListener('wheel', this.onWheel, { passive: false })
    target.addEventListener('pointerdown', this.onPointerDown)
    target.addEventListener('pointerup', this.onPointerUp)
    target.addEventListener('pointermove', this.onPointerMove)
    target.addEventListener('contextmenu', this.onContextMenu)
  }

  detach(target: Window = window) {
    target.removeEventListener('keydown', this.onKeyDown)
    target.removeEventListener('keyup', this.onKeyUp)
    target.removeEventListener('blur', this.onBlur)
    target.removeEventListener('wheel', this.onWheel)
    target.removeEventListener('pointerdown', this.onPointerDown)
    target.removeEventListener('pointerup', this.onPointerUp)
    target.removeEventListener('pointermove', this.onPointerMove)
    target.removeEventListener('contextmenu', this.onContextMenu)
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

  isPointerDown(): boolean {
    return this.pointerDown
  }

  get pointerPosition(): { x: number; y: number } {
    return { x: this.pointerX, y: this.pointerY }
  }

  /** Pointer movement in pixels since the previous call; resets after reading. */
  consumePointerDelta(): { x: number; y: number } {
    const delta = { x: this.pointerDeltaX, y: this.pointerDeltaY }
    this.pointerDeltaX = 0
    this.pointerDeltaY = 0
    return delta
  }

  endFrame() {
    this.pressedThisFrame.clear()
    this.releasedThisFrame.clear()
    this.pressedKeyValues.length = 0
    this.pointerDeltaX = 0
    this.pointerDeltaY = 0
  }
}
