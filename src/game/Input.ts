export type KeyState = {
  down: boolean
}

export class Input {
  private keys = new Map<string, KeyState>()
  private pressedThisFrame = new Set<string>()
  private releasedThisFrame = new Set<string>()

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const state = this.keys.get(e.code)
    if (!state?.down) {
      this.pressedThisFrame.add(e.code)
      this.keys.set(e.code, { down: true })
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (this.keys.has(e.code)) {
      this.releasedThisFrame.add(e.code)
      this.keys.set(e.code, { down: false })
    }
  }

  private readonly onBlur = () => {
    this.keys.clear()
  }

  attach(target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
  }

  detach(target: Window = window) {
    target.removeEventListener('keydown', this.onKeyDown)
    target.removeEventListener('keyup', this.onKeyUp)
    target.removeEventListener('blur', this.onBlur)
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

  endFrame() {
    this.pressedThisFrame.clear()
    this.releasedThisFrame.clear()
  }
}
