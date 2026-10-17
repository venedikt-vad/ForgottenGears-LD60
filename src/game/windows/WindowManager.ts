import type { Input } from '../Input'
import type { GameWindow } from './GameWindow'

/** Stores window instances and changes which one receives input and renders. */
export class WindowManager {
  private readonly windows = new Map<string, GameWindow>()
  private activeWindow: GameWindow | null = null
  private readonly input: Input

  constructor(input: Input) {
    this.input = input
  }

  register(window: GameWindow): this {
    if (this.windows.has(window.id)) {
      throw new Error(`A window with id "${window.id}" is already registered`)
    }

    this.windows.set(window.id, window)
    return this
  }

  show(id: string): void {
    const nextWindow = this.windows.get(id)
    if (!nextWindow) {
      throw new Error(`Window "${id}" is not registered`)
    }
    if (this.activeWindow === nextWindow) return

    this.activeWindow?.onHide?.()
    this.activeWindow = nextWindow
    this.activeWindow.onShow?.(this)
  }

  get activeId(): string | null {
    return this.activeWindow?.id ?? null
  }

  get<T extends GameWindow = GameWindow>(id: string): T {
    const window = this.windows.get(id)
    if (!window) throw new Error(`Window "${id}" is not registered`)
    return window as T
  }

  update(dt: number): void {
    this.activeWindow?.update(dt, this.input)
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.activeWindow?.render(ctx, width, height)
  }
}
