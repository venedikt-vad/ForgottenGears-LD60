import type { Input } from '../Input'
import type { WindowManager } from './WindowManager'

export type GameLanguage = 'ru' | 'en'

/** A drawable screen managed by WindowManager. Instances are kept alive when hidden. */
export interface GameWindow {
  readonly id: string
  onShow?(manager: WindowManager, input: Input): void
  onHide?(): void
  update(dt: number, input: Input): void
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void
}
