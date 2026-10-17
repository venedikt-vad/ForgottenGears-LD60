import './style.css'
import { Game } from './game/Game'

const gameCanvas = document.querySelector<HTMLCanvasElement>('#game')
const glowCanvas = document.querySelector<HTMLCanvasElement>('#glow')
if (!gameCanvas) throw new Error('Canvas element #game not found')
if (!glowCanvas) throw new Error('Canvas element #glow not found')

const game = new Game({ canvas: gameCanvas, glowCanvas })
game.start()
