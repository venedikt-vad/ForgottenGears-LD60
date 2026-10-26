import { playSfx } from '../sfx'
import type { Input } from '../Input'
import type { GameSettings } from '../save/types'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'
import {
  MENU_COLORS,
  drawConsoleBackground,
  drawPanel,
  drawProgressBar,
  drawRule,
  fitText,
  includesPoint,
  menuFont,
  type MenuRect,
} from './menu/MenuTheme'

interface SettingsText {
  title: string
  subtitle: string
  rows: string[]
  language: string
  music: string
  sfx: string
  back: string
  hints: string
  percent: (value: number) => string
  audioHint: string
}

const TEXT: Record<GameLanguage, SettingsText> = {
  ru: {
    title: 'НАСТРОЙКИ',
    subtitle: 'СИСТЕМА ВОССТАНОВЛЕНИЯ  ·  КОНФИГУРАЦИЯ ОПЕРАТОРА',
    rows: ['ЯЗЫК ИНТЕРФЕЙСА', 'ГРОМКОСТЬ МУЗЫКИ', 'ГРОМКОСТЬ ЭФФЕКТОВ', 'НАЗАД'],
    language: 'ЯЗЫК ИНТЕРФЕЙСА',
    music: 'ГРОМКОСТЬ МУЗЫКИ',
    sfx: 'ГРОМКОСТЬ ЭФФЕКТОВ',
    back: 'НАЗАД',
    hints: '↑/↓ ВЫБОР  ·  ←/→ ИЗМЕНИТЬ  ·  ENTER ПОДТВЕРДИТЬ  ·  ESC НАЗАД',
    percent: (value: number) => `${Math.round(value * 100)}%`,
    audioHint: 'ПАРАМЕТРЫ ПРИМЕНЯЮТСЯ СРАЗУ И СОХРАНЯЮТСЯ НА ЭТОМ УСТРОЙСТВЕ.',
  },
  en: {
    title: 'SETTINGS',
    subtitle: 'RECOVERY SYSTEM  ·  OPERATOR CONFIGURATION',
    rows: ['INTERFACE LANGUAGE', 'MUSIC VOLUME', 'EFFECT VOLUME', 'BACK'],
    language: 'INTERFACE LANGUAGE',
    music: 'MUSIC VOLUME',
    sfx: 'EFFECT VOLUME',
    back: 'BACK',
    hints: '↑/↓ SELECT  ·  ←/→ ADJUST  ·  ENTER CONFIRM  ·  ESC BACK',
    percent: (value: number) => `${Math.round(value * 100)}%`,
    audioHint: 'CHANGES APPLY IMMEDIATELY AND ARE STORED ON THIS DEVICE.',
  },
}

const LANGUAGES: Array<{ label: Record<GameLanguage, string>; language: GameLanguage }> = [
  { label: { ru: 'РУССКИЙ', en: 'RUSSIAN' }, language: 'ru' },
  { label: { ru: 'АНГЛИЙСКИЙ', en: 'ENGLISH' }, language: 'en' },
]

const ROW = { language: 0, music: 1, sfx: 2, back: 3 } as const
const VOLUME_STEP = 0.1

export interface SettingsOptions {
  getSettings: () => GameSettings
  onChange: (settings: GameSettings) => void
  onBack: () => void
}

/** Console-styled settings: language, music volume and sound-effect volume. */
export class SettingsWindow implements GameWindow {
  readonly id = 'settings'

  private readonly options: SettingsOptions
  private language: GameLanguage = 'ru'
  private settings: GameSettings = { language: 'ru', musicVolume: 0.5, sfxVolume: 0.6 }
  private selectedIndex = 0
  private hoverIndex = -1
  private hoverLanguage = -1
  private wasPointerDown = false
  private draggingSlider = -1
  private rowRects: MenuRect[] = []
  private languageRects: MenuRect[] = []
  private sliderRects: MenuRect[] = []
  private time = 0

  constructor(options: SettingsOptions) {
    this.options = options
    this.settings = options.getSettings()
    this.language = this.settings.language
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
  }

  onShow(_manager: WindowManager, input: Input): void {
    this.settings = this.options.getSettings()
    this.language = this.settings.language
    // A click that caused this transition is usually still held; do not treat
    // that same press as a click on a settings row.
    this.wasPointerDown = input.isPointerDown()
    this.draggingSlider = -1
    this.hoverIndex = -1
    this.hoverLanguage = -1
  }

  update(dt: number, input: Input): void {
    this.time += dt
    input.consumeWheelDelta()

    const pointer = input.pointerPosition
    this.hoverIndex = this.rowRects.findIndex((rect) => includesPoint(rect, pointer.x, pointer.y))
    this.hoverLanguage = this.languageRects.findIndex((rect) => includesPoint(rect, pointer.x, pointer.y))

    const down = input.isPointerDown()
    if (this.draggingSlider >= 0) {
      if (down) {
        this.setVolumeFromPointer(this.draggingSlider, pointer.x)
        return
      }
      this.draggingSlider = -1
    }

    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.moveSelection(-1)
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.moveSelection(1)
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.adjust(-1)
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.adjust(1)

    if (input.wasPressed('Digit1')) this.changeLanguage('ru')
    if (input.wasPressed('Digit2')) this.changeLanguage('en')

    const clicked = down && !this.wasPointerDown
    this.wasPointerDown = down

    if (clicked && this.hoverLanguage >= 0) {
      const option = LANGUAGES[this.hoverLanguage]
      if (option) this.changeLanguage(option.language)
      return
    }

    if (clicked && this.hoverIndex >= 0) {
      this.selectedIndex = this.hoverIndex
      const sliderIndex = this.sliderIndexForRow(this.hoverIndex)
      if (sliderIndex >= 0) {
        this.draggingSlider = sliderIndex
        this.setVolumeFromPointer(sliderIndex, pointer.x)
        return
      }
      if (this.hoverIndex === ROW.back) {
        this.activateBack()
        return
      }
      playSfx('selection')
      return
    }

    if (input.wasPressed('Escape')) {
      this.activateBack()
      return
    }

    if (input.wasPressed('Enter') || input.wasPressed('Space')) {
      if (this.selectedIndex === ROW.back) this.activateBack()
      else if (this.selectedIndex === ROW.language) this.adjust(1)
      else this.adjust(1)
    }
  }

  private moveSelection(amount: number): void {
    const next = (this.selectedIndex + amount + 4) % 4
    if (next === this.selectedIndex) return
    this.selectedIndex = next
    playSfx('selection')
  }

  private adjust(direction: number): void {
    if (this.selectedIndex === ROW.language) {
      const current = LANGUAGES.findIndex((option) => option.language === this.language)
      const next = LANGUAGES[(current + direction + LANGUAGES.length) % LANGUAGES.length]
      if (next) this.changeLanguage(next.language)
      return
    }
    if (this.selectedIndex === ROW.music) {
      this.applySettings({ ...this.settings, musicVolume: clamp01(this.settings.musicVolume + direction * VOLUME_STEP) })
      playSfx('selection')
      return
    }
    if (this.selectedIndex === ROW.sfx) {
      this.applySettings({ ...this.settings, sfxVolume: clamp01(this.settings.sfxVolume + direction * VOLUME_STEP) })
      playSfx('selection')
    }
  }

  private changeLanguage(language: GameLanguage): void {
    if (language === this.language) return
    this.applySettings({ ...this.settings, language })
    playSfx('selection')
  }

  private activateBack(): void {
    playSfx('selection')
    this.options.onBack()
  }

  private sliderIndexForRow(row: number): number {
    if (row === ROW.music) return 0
    if (row === ROW.sfx) return 1
    return -1
  }

  private setVolumeFromPointer(sliderIndex: number, x: number): void {
    const rect = this.sliderRects[sliderIndex]
    if (!rect || rect.width <= 0) return
    const ratio = clamp01((x - rect.x) / rect.width)
    if (sliderIndex === 0) {
      if (Math.abs(ratio - this.settings.musicVolume) < 0.005) return
      this.applySettings({ ...this.settings, musicVolume: ratio })
    } else {
      if (Math.abs(ratio - this.settings.sfxVolume) < 0.005) return
      this.applySettings({ ...this.settings, sfxVolume: ratio })
    }
  }

  private applySettings(settings: GameSettings): void {
    this.settings = settings
    this.language = settings.language
    this.options.onChange(settings)
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const text = TEXT[this.language]
    ctx.save()
    ctx.clearRect(0, 0, width, height)
    drawConsoleBackground(ctx, width, height, this.time)

    const margin = width < 560 ? 14 : width < 1000 ? 24 : 34
    const small = width < 560 ? 9 : width < 1000 ? 10 : 11
    const lineHeight = Math.ceil(small * 1.45)
    const titleSize = width < 560 ? 23 : width < 1000 ? 29 : 36
    const panelWidth = Math.min(width - margin * 2, 760)
    const rowHeight = Math.max(40, Math.min(64, Math.round(height * 0.075)))

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = menuFont(titleSize, true)
    ctx.fillStyle = MENU_COLORS.bright
    ctx.shadowColor = 'rgba(114, 255, 98, 0.3)'
    ctx.shadowBlur = 8
    ctx.fillText(text.title, margin, margin)
    ctx.shadowBlur = 0

    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(fitText(ctx, text.subtitle, width - margin * 2), margin, margin + titleSize + 8)

    const ruleY = margin + titleSize + lineHeight * 2.1
    drawRule(ctx, margin, ruleY, panelWidth)
    const top = ruleY + 14

    const panelRect: MenuRect = {
      x: margin,
      y: top,
      width: panelWidth,
      height: Math.max(
        rowHeight * 4 + 24 + lineHeight * 2.4,
        Math.min(height - top - margin - lineHeight * 2, rowHeight * 4 + 120),
      ),
    }
    drawPanel(ctx, panelRect, MENU_COLORS.panelAlt)

    const pad = width < 560 ? 12 : 18
    const rowsTop = panelRect.y + pad
    const rowGap = 4
    this.rowRects = []
    this.languageRects = []
    this.sliderRects = []

    for (let index = 0; index < 4; index += 1) {
      const rect: MenuRect = {
        x: panelRect.x + pad,
        y: rowsTop + index * (rowHeight + rowGap),
        width: panelRect.width - pad * 2,
        height: rowHeight,
      }
      this.rowRects.push(rect)
      const selected = index === this.selectedIndex
      const hovered = index === this.hoverIndex

      ctx.fillStyle = selected
        ? MENU_COLORS.selected
        : hovered ? 'rgba(103, 218, 130, 0.07)' : 'rgba(2, 12, 6, 0.4)'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeStyle = selected ? MENU_COLORS.borderBright : MENU_COLORS.border
      ctx.lineWidth = selected ? 1.5 : 1
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
      if (selected) {
        ctx.fillStyle = MENU_COLORS.borderBright
        ctx.fillRect(rect.x, rect.y, 3, rect.height)
      }

      ctx.font = menuFont(small + 1, selected)
      ctx.fillStyle = selected ? MENU_COLORS.bright : MENU_COLORS.text
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${selected ? '>' : ' '} ${text.rows[index]}`, rect.x + 13, rect.y + rect.height / 2 + 1)

      if (index === ROW.language) {
        this.drawLanguageOptions(ctx, rect, small)
      } else if (index === ROW.music || index === ROW.sfx) {
        this.drawVolume(ctx, rect, index, small)
      } else {
        ctx.font = menuFont(small)
        ctx.textAlign = 'right'
        ctx.fillStyle = MENU_COLORS.dim
        ctx.fillText(selected ? 'ENTER' : '', rect.x + rect.width - 12, rect.y + rect.height / 2 + 1)
      }
    }

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = menuFont(small)
    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(
      fitText(ctx, text.audioHint, panelRect.width - pad * 2),
      panelRect.x + pad,
      panelRect.y + panelRect.height - lineHeight - 10,
    )

    ctx.fillStyle = MENU_COLORS.dim
    ctx.fillText(fitText(ctx, text.hints, width - margin * 2), margin, height - margin - lineHeight)

    ctx.restore()
  }

  private drawLanguageOptions(ctx: CanvasRenderingContext2D, row: MenuRect, small: number): void {
    const optionGap = 6
    const optionHeight = Math.max(24, Math.min(row.height - 12, 34))
    const optionWidth = Math.min(120, Math.floor((row.width - 30) / 2))
    const startX = row.x + row.width - optionWidth * 2 - optionGap - 12
    for (let index = 0; index < LANGUAGES.length; index += 1) {
      const option = LANGUAGES[index]
      const rect: MenuRect = {
        x: startX + index * (optionWidth + optionGap),
        y: row.y + (row.height - optionHeight) / 2,
        width: optionWidth,
        height: optionHeight,
      }
      this.languageRects.push(rect)
      const active = option.language === this.language
      const hovered = index === this.hoverLanguage
      ctx.fillStyle = active
        ? 'rgba(103, 218, 130, 0.24)'
        : hovered ? 'rgba(103, 218, 130, 0.12)' : 'rgba(2, 10, 5, 0.5)'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeStyle = active ? MENU_COLORS.borderBright : MENU_COLORS.border
      ctx.lineWidth = active ? 1.5 : 1
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
      ctx.font = menuFont(Math.max(9, small), active)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = active ? MENU_COLORS.bright : MENU_COLORS.dim
      ctx.fillText(option.label[this.language], rect.x + rect.width / 2, rect.y + rect.height / 2 + 1)
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
  }

  private drawVolume(ctx: CanvasRenderingContext2D, row: MenuRect, index: number, small: number): void {
    const value = index === ROW.music ? this.settings.musicVolume : this.settings.sfxVolume
    const barWidth = Math.max(90, Math.min(240, row.width * 0.34))
    const barHeight = 7
    const barRect: MenuRect = {
      x: row.x + row.width - barWidth - 64,
      y: row.y + row.height / 2 - barHeight / 2,
      width: barWidth,
      height: barHeight,
    }
    this.sliderRects.push(barRect)
    drawProgressBar(ctx, barRect, value, value > 0 ? MENU_COLORS.green : MENU_COLORS.dim)
    ctx.font = menuFont(small, true)
    ctx.fillStyle = MENU_COLORS.text
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(TEXT[this.language].percent(value), row.x + row.width - 12, row.y + row.height / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100))
}
