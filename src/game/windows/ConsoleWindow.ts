import type { Input } from '../Input'
import { FONT_FAMILY } from '../fonts'
import type { GameLanguage, GameWindow } from './GameWindow'
import type { WindowManager } from './WindowManager'

type ConsoleStage = 'boot' | 'manual-prompt' | 'manual-stream' | 'manual-wait' | 'terminal'

/** Persistent BIOS/CRT console with a full, scrollable transcript. */
export class ConsoleWindow implements GameWindow {
  readonly id = 'console'

  private manager: WindowManager | null = null
  private language: GameLanguage = 'ru'
  private stage: ConsoleStage = 'boot'

  // Keep the entire transcript for the lifetime of this window. It is never capped.
  private transcript = ''
  private bootText = ''
  private bootProgress = 0
  private printedBootChars = 0
  private manualText = ''
  private manualProgress = 0
  private printedManualChars = 0

  private blinkClock = 0
  private readonly charsPerSecond = 7200
  private command = ''
  // Command history lives on this window instance, so it survives clear/reboot and
  // switching between windows for the whole game session.
  private commandHistory: string[] = []
  private commandHistoryIndex = 0
  private commandDraft = ''
  private browsingCommandHistory = false
  private promptInput = ''

  // Scroll position is a line index from the start of the wrapped transcript.
  // Following the tail is disabled when the user scrolls up, so new output does
  // not drag the reading position away from the lines being inspected.
  private followTail = true
  private scrollTopLine = 0
  private lastMaxScrollTop = 0
  private lastVisibleLineCount = 1

  constructor() {
    this.setLanguage('ru')
  }

  setLanguage(language: GameLanguage): void {
    this.language = language
    this.manualText = this.getManualText()
    this.transcript = ''
    this.command = ''
    this.promptInput = ''
    this.blinkClock = 0
    this.beginBootSequence(false)
  }

  onShow(manager: WindowManager): void {
    this.manager = manager
    // A returning user sees the retained tail unless they intentionally scroll.
  }

  update(dt: number, input: Input): void {
    this.blinkClock += dt
    this.updateScroll(input)

    switch (this.stage) {
      case 'boot': {
        this.bootProgress = Math.min(this.bootText.length, this.bootProgress + dt * this.charsPerSecond)
        const target = Math.floor(this.bootProgress)
        if (target > this.printedBootChars) {
          this.appendTranscript(this.bootText.slice(this.printedBootChars, target))
          this.printedBootChars = target
        }
        if (this.printedBootChars >= this.bootText.length) {
          this.stage = 'manual-prompt'
          this.followTail = true
        }
        break
      }
      case 'manual-prompt':
        this.handleManualPromptInput(input)
        break
      case 'manual-stream': {
        this.manualProgress = Math.min(this.manualText.length, this.manualProgress + dt * this.charsPerSecond)
        const target = Math.floor(this.manualProgress)
        if (target > this.printedManualChars) {
          this.appendTranscript(this.manualText.slice(this.printedManualChars, target))
          this.printedManualChars = target
        }
        if (this.printedManualChars >= this.manualText.length) {
          this.appendTranscript('\n')
          this.stage = 'manual-wait'
          this.followTail = true
        }
        break
      }
      case 'manual-wait':
        for (const key of input.getPressedKeyValues()) {
          if (key === 'Enter') {
            this.appendTranscript('\n')
            this.openTerminal()
            break
          }
        }
        break
      case 'terminal':
        this.handleTerminalInput(input)
        break
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save()
    ctx.clearRect(0, 0, width, height)

    // Smaller IBM BIOS text and tight leading show many more rows at once.
    const margin = width < 560 ? 8 : 12
    const fontSize = width < 460 ? 10 : width < 1000 ? 11 : 12
    const lineHeight = Math.ceil(fontSize * 1.32)
    const textWidth = Math.max(80, width - margin * 2)
    const normalFont = `${fontSize}px "${FONT_FAMILY}", monospace`
    const smallFont = `${Math.max(8, fontSize - 2)}px "${FONT_FAMILY}", monospace`

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = normalFont
    ctx.fillStyle = '#bce8ad'
    ctx.shadowColor = 'rgba(114, 255, 98, 0.22)'
    ctx.shadowBlur = 2
    ctx.fillText('ROBOT OS // SYSTEM POST TERMINAL', margin, margin)
    ctx.shadowBlur = 0

    ctx.font = smallFont
    ctx.fillStyle = '#659e5c'
    ctx.fillText(
      this.language === 'ru'
        ? 'ROM v1.08  |  КОЛЁСИКО / PGUP / PGDN — ПРОКРУТКА'
        : 'ROM v1.08  |  WHEEL / PGUP / PGDN — SCROLLBACK',
      margin,
      margin + lineHeight + 1,
    )

    const ruleY = margin + lineHeight * 2 + 5
    this.drawRule(ctx, margin, ruleY, width - margin * 2)

    const contentTop = ruleY + 5
    const promptY = height - margin - lineHeight * 2
    const contentBottom = promptY - 6
    const visibleLineCount = Math.max(1, Math.floor((contentBottom - contentTop) / lineHeight))

    ctx.font = normalFont
    const wrappedLines = this.wrapText(ctx, this.transcript, textWidth)
    const maxScrollTop = Math.max(0, wrappedLines.length - visibleLineCount)
    this.lastVisibleLineCount = visibleLineCount
    this.lastMaxScrollTop = maxScrollTop

    if (this.followTail) {
      this.scrollTopLine = maxScrollTop
    } else {
      this.scrollTopLine = Math.max(0, Math.min(this.scrollTopLine, maxScrollTop))
    }

    const visibleLines = wrappedLines.slice(this.scrollTopLine, this.scrollTopLine + visibleLineCount)
    this.drawLines(ctx, visibleLines, margin, contentTop, lineHeight)

    // Prompt is pinned to the bottom while the transcript above it is scrollable.
    this.drawRule(ctx, margin, promptY - 5, width - margin * 2)
    const cursor = Math.floor(this.blinkClock * 2) % 2 === 0 ? '_' : ' '
    ctx.font = normalFont
    ctx.fillStyle = '#c8f3b5'
    ctx.shadowColor = 'rgba(114, 255, 98, 0.2)'
    ctx.shadowBlur = 1
    ctx.fillText(`${this.getBottomPrompt()}${this.getBottomInput()}${cursor}`, margin, promptY)
    ctx.shadowBlur = 0

    ctx.font = smallFont
    ctx.fillStyle = '#659e5c'
    ctx.textAlign = 'left'
    ctx.fillText(
      this.language === 'ru' ? 'ПИТАНИЕ: ВКЛ  |  РЕЖИМ: ВОССТАНОВЛЕНИЕ' : 'POWER: ON  |  MODE: RECOVERY',
      margin,
      height - margin - lineHeight,
    )
    ctx.textAlign = 'right'
    ctx.fillText(`LINES: ${wrappedLines.length}`, width - margin, height - margin - lineHeight)

    // Fine CRT scanlines; low opacity keeps the smaller text readable.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.13)'
    for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1)

    ctx.restore()
  }

  private handleManualPromptInput(input: Input): void {
    for (const key of input.getPressedKeyValues()) {
      if (key === 'Enter') {
        const answer = this.promptInput.trim().toUpperCase()
        this.appendTranscript(`${this.getManualPromptLabel()}${this.promptInput}\n`)
        this.promptInput = ''

        if (answer === 'Y') {
          this.appendTranscript('\n')
          this.stage = 'manual-stream'
          this.manualProgress = 0
          this.printedManualChars = 0
          this.followTail = true
        } else if (answer === 'N') {
          this.openTerminal()
        } else {
          this.appendTranscript(this.language === 'ru'
            ? 'ОШИБКА ВВОДА: ВВЕДИТЕ Y ИЛИ N, ЗАТЕМ НАЖМИТЕ ENTER.\n'
            : 'INPUT ERROR: TYPE Y OR N, THEN PRESS ENTER.\n')
          this.followTail = true
        }
        return
      }

      if (key === 'Backspace') {
        this.promptInput = this.promptInput.slice(0, -1)
      } else if (key.length === 1 && this.promptInput.length < 16) {
        this.promptInput += key
      }
    }
  }

  
  private handleTerminalInput(input: Input): void {
    for (const key of input.getPressedKeyValues()) {
      if (key === 'Enter') {
        const typed = this.command.trim()
        this.appendTranscript(`${this.getTerminalPrompt()}${this.command}\n`)

        if (typed) this.commandHistory.push(typed)

        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
        this.browsingCommandHistory = false
        this.command = ''
        this.followTail = true

        if (typed) this.executeCommand(typed)
        continue
      }

      if (key === 'ArrowUp') {
        if (this.commandHistory.length === 0) continue

        if (!this.browsingCommandHistory) {
          this.commandDraft = this.command
          this.commandHistoryIndex = this.commandHistory.length
          this.browsingCommandHistory = true
        }

        this.commandHistoryIndex = Math.max(
          0,
          this.commandHistoryIndex - 1,
        )
        this.command = this.commandHistory[this.commandHistoryIndex] ?? ''
        continue
      }

      if (key === 'ArrowDown') {
        if (!this.browsingCommandHistory) continue

        if (this.commandHistoryIndex < this.commandHistory.length - 1) {
          this.commandHistoryIndex += 1
          this.command = this.commandHistory[this.commandHistoryIndex] ?? ''
        } else {
          this.commandHistoryIndex = this.commandHistory.length
          this.command = this.commandDraft
          this.commandDraft = ''
          this.browsingCommandHistory = false
        }
        continue
      }

      if (key === 'Backspace') {
        this.command = this.command.slice(0, -1)
        this.browsingCommandHistory = false
        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
        continue
      }

      if (key === 'Escape') continue

      if (key.length === 1 && this.command.length < 128) {
        this.command += key
        this.browsingCommandHistory = false
        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
      }
    }
  }


  private executeCommand(rawCommand: string): void {
    const command = rawCommand.toLowerCase().trim()

    switch (command) {
      case 'help':
        this.appendLines(this.language === 'ru'
          ? [
              'ДОСТУПНЫЕ КОМАНДЫ:',
              '  help    — список команд',
              '  ui      — открыть панель обслуживания робота',
              '  memory  — открыть ядро памяти',
              '  status  — состояние подсистем',
              '  manual  — показать мануал',
              '  clear   — очистить текущий экран (история сохранится)',
              '  reboot  — повторить загрузку BIOS',
              '',
            ]
          : [
              'AVAILABLE COMMANDS:',
              '  help    — list commands',
              '  ui      — open robot service toolbar',
              '  memory  — open memory core',
              '  status  — subsystem status',
              '  manual  — print the manual',
              '  clear   — clear current view (history is retained)',
              '  reboot  — run BIOS startup again',
              '',
            ])
        break

      case 'ui':
        this.appendTranscript(this.language === 'ru' ? 'ЗАПУСК ПАНЕЛИ ОБСЛУЖИВАНИЯ...\n' : 'STARTING SERVICE TOOLBAR...\n')
        this.manager?.show('ui')
        break

      case 'memory':
        this.appendTranscript(this.language === 'ru' ? 'ЗАПУСК ЯДРА ПАМЯТИ...\n' : 'STARTING MEMORY CORE...\n')
        this.manager?.show('memoryCore')
        break

      case 'status':
        this.appendLines(this.language === 'ru'
          ? [
              'ОТЛАДЧИК .......................... [FAIL]',
              'СИСТЕМНОЕ ЯДРО .................... [FAIL]',
              'ПОДСИСТЕМА UI ..................... [FAIL] NOT FOUND',
              'ЦЕЛОСТНОСТЬ ПАМЯТИ ................ [FAIL] 8 ОШИБОК',
              'ШИНА УПРАВЛЕНИЯ ПРИВОДАМИ ......... [FAIL]',
              'КАРТОГРАФ LIDAR ................... [FAIL]',
              'БЕСПРОВОДНОЙ МОДУЛЬ ............... [FAIL]',
              'ТЕРМИНАЛ КОНСОЛИ .................. [OK] АКТИВЕН',
              'ОПЕРАТОР NAS / ИГРОК .............. [OK] ОБНАРУЖЕН',
              'СОСТОЯНИЕ РОБОТА ................. [FAIL] ВОССТАНОВЛЕНИЕ',
              '',
            ]
          : [
              'DEBUGGER .......................... [FAIL]',
              'SYSTEM KERNEL ..................... [FAIL]',
              'UI SUBSYSTEM ...................... [FAIL] NOT FOUND',
              'MEMORY INTEGRITY .................. [FAIL] 8 ERRORS',
              'ACTUATOR CONTROL BUS .............. [FAIL]',
              'LIDAR MAPPING UNIT ................ [FAIL]',
              'WIRELESS TRANSCEIVER .............. [FAIL]',
              'CONSOLE TERMINAL ................. [OK] ACTIVE',
              'NAS OPERATOR / PLAYER ............. [OK] DETECTED',
              'ROBOT STATE ....................... [FAIL] RECOVERY REQUIRED',
              '',
            ])
        break

      case 'manual':
        this.appendTranscript(`${this.manualText}\n\n`)
        break

      case 'clear':
        // Keep every old line available for scrolling, as requested.
        this.appendLines(this.language === 'ru'
          ? ['ЭКРАН ОЧИЩЕН. ИСТОРИЯ СОХРАНЕНА В SCROLLBACK.', '']
          : ['SCREEN CLEARED. SCROLLBACK HISTORY RETAINED.', ''])
        break

      case 'reboot':
        this.beginBootSequence(true)
        break

      default:
        this.appendTranscript(this.language === 'ru'
          ? `НЕИЗВЕСТНАЯ КОМАНДА: ${rawCommand}. ВВЕДИТЕ help.\n\n`
          : `UNKNOWN COMMAND: ${rawCommand}. TYPE help.\n\n`)
    }
  }

  private openTerminal(): void {
    this.stage = 'terminal'
    this.command = ''
    this.appendTranscript(this.language === 'ru'
      ? '\nСЕАНС ВОССТАНОВЛЕНИЯ ОТКРЫТ.\nВВЕДИТЕ help ДЛЯ СПИСКА КОМАНД.\n\n'
      : '\nRECOVERY SESSION OPENED.\nTYPE help TO LIST COMMANDS.\n\n')
    this.followTail = true
  }

  /** Starts or restarts the BIOS sequence without discarding an existing transcript. */
  private beginBootSequence(preserveTranscript: boolean): void {
    if (preserveTranscript && this.transcript.length > 0) {
      this.transcript += '\n\n============================================================\n'
      this.transcript += this.language === 'ru' ? 'ПОВТОРНЫЙ ЗАПУСК BIOS...' : 'BIOS RESTART...'
      this.transcript += '\n============================================================\n\n'
    } else if (!preserveTranscript) {
      this.transcript = ''
    }

    this.bootText = this.getBootText()
    this.bootProgress = 0
    this.printedBootChars = 0
    this.promptInput = ''
    this.command = ''
    this.stage = 'boot'
    this.followTail = true
    this.scrollTopLine = 0
  }

  private getBootText(): string {
    const ru = this.language === 'ru'
    const L = (en: string, ruText: string) => (ru ? ruText : en)
    const width = 62
    const rule = (char = '─', count = width) => char.repeat(count)
    const boxLine = (value: string) => `║${(`  ${value}`).padEnd(width).slice(0, width)}║`
    const row = (values: string[], widths: number[]) =>
      values.map((value, index) => value.padEnd(widths[index]).slice(0, widths[index])).join(' | ')
    // Only the console itself and NAS (the player/operator) are healthy.
    // Every other status, including warnings, is presented as a hard failure.
    const statusTag = (status: string) => status === 'OK' ? '[OK]' : '[FAIL]'

    const lines: string[] = [
      `╔${rule('═')}╗`,
      boxLine(L('ROBOT OS  v1.08  -  BOOT SEQUENCE INITIATED', 'ROBOT OS  v1.08  -  ИНИЦИАЛИЗАЦИЯ ЗАПУСКА')),
      boxLine('Copyright (C) 1987-1994  Cyberdyne Systems'),
      boxLine(L('Recovery ROM  CG-RB-108  /  SAFE BOOT [FAIL]', 'Recovery ROM  CG-RB-108  /  SAFE BOOT [СБОЙ]')),
      `╚${rule('═')}╝`,
      '',
      L('POST - Power On Self Test', 'POST - Самодиагностика при включении'),
      rule(),
      `${L('CPU Type', 'Тип CPU').padEnd(19)}: Neural Core 486DX2-66  [FAIL: MICROCODE]`,
      `${L('Base Memory', 'Базовая память').padEnd(19)}: 640K [FAIL: READ ERROR]`,
      `${L('Extended Memory', 'Расширенная память').padEnd(19)}: 15360K [FAIL: ADDRESS ERROR]`,
      `${L('Cache Memory', 'Кэш-память').padEnd(19)}: [FAIL: PARITY ERROR]`,
      `${L('Clock Speed', 'Тактовая частота').padEnd(19)}: [FAIL: CLOCK UNSYNC]`,
      `${L('System Bus', 'Системная шина').padEnd(19)}: [FAIL: NO RESPONSE]`,
      `${L('Boot Device', 'Устройство запуска').padEnd(19)}: [FAIL: ROM CHECKSUM]`,
      `${L('Console Init', 'Запуск консоли').padEnd(19)}: [OK] TEXT MODE ACTIVE`,
      `${L('NAS Operator', 'Оператор NAS').padEnd(19)}: [OK] PLAYER DETECTED`,
      '',
      L('Detecting Hardware...', 'Обнаружение оборудования...'),
      '',
      `${L('Device', 'Устройство').padEnd(24)}  ${L('Address', 'Адрес').padEnd(10)}  ${'IRQ'.padEnd(3)}  ${L('Status', 'Статус')}`,
      rule(),
    ]

    const devices = [
      { en: 'Power Core', ru: 'Ядро питания', addr: '0x0A00', irq: '-', status: 'FAIL' as const },
      { en: 'Thermal Regulation', ru: 'Терморегуляция', addr: '0x0A20', irq: '5', status: 'FAIL' as const },
      { en: 'Actuator Control Bus', ru: 'Шина приводов', addr: '0x0B00', irq: '7', status: 'FAIL' as const },
      { en: 'Visual Cortex (Cam)', ru: 'Визуальный модуль', addr: '0x0C00', irq: '10', status: 'WARN' as const },
      { en: 'LIDAR Mapping Unit', ru: 'Модуль LIDAR', addr: '0x0C40', irq: '11', status: 'FAIL' as const },
      { en: 'Audio Reception Array', ru: 'Аудиоприёмник', addr: '0x0D00', irq: '5', status: 'FAIL' as const },
      { en: 'Wireless Transceiver', ru: 'Беспроводной модуль', addr: '0x0E00', irq: '9', status: 'FAIL' as const },
      { en: 'Neural Processing Unit', ru: 'Нейропроцессор', addr: '0x0F00', irq: '-', status: 'FAIL' as const },
      { en: 'Memory Management', ru: 'Контроллер памяти', addr: '0x1000', irq: '-', status: 'FAIL' as const },
      { en: 'Security Layer', ru: 'Слой безопасности', addr: '0x1200', irq: '12', status: 'FAIL' as const },
      { en: 'Hydraulic Pressure', ru: 'Давление гидравлики', addr: '0x1240', irq: '3', status: 'FAIL' as const },
      { en: 'Gyro Stabilizer', ru: 'Гиростабилизатор', addr: '0x1280', irq: '4', status: 'WARN' as const },
      { en: 'Emergency Cutoff', ru: 'Аварийное отключение', addr: '0x12C0', irq: '13', status: 'FAIL' as const },
      { en: 'Left Actuator Bank', ru: 'Левый блок приводов', addr: '0x1300', irq: '6', status: 'FAIL' as const },
      { en: 'Right Actuator Bank', ru: 'Правый блок приводов', addr: '0x1340', irq: '8', status: 'WARN' as const },
      { en: 'Navigation EEPROM', ru: 'Память навигации', addr: '0x1380', irq: '-', status: 'FAIL' as const },
      { en: 'Console Output Controller', ru: 'Контроллер вывода консоли', addr: '0x03F8', irq: '4', status: 'OK' as const },
      { en: 'NAS Operator Presence', ru: 'Обнаружение оператора NAS', addr: '0x00F0', irq: '-', status: 'OK' as const },
    ]

    for (const device of devices) {
      const name = ru ? device.ru : device.en
      lines.push(`${name.padEnd(24).slice(0, 24)}  ${device.addr.padEnd(10)}  ${device.irq.padEnd(3)}  ${statusTag(device.status)}`)
    }

    const widths = [8, 6, 8, 8, 8, 6, 6, 8]
    const memoryRows = [
      ['00000000', '64K', 'Base', 'AA55', 'March', 'Even', '[FAIL]', 'READ ERR'],
      ['00010000', '128K', 'Base', '55AA', 'Walk', 'Even', '[FAIL]', 'ADDR ERR'],
      ['00030000', '256K', 'Extended', 'FFFF', 'Checker', 'Odd', '[FAIL]', 'TIMEOUT'],
      ['00070000', '512K', 'Extended', '0000', 'March', 'Even', '[FAIL]', 'PARITY'],
      ['000F0000', '1M', 'Extended', 'AA55', 'Walk', 'Even', '[FAIL]', 'PARITY'],
      ['001F0000', '2M', 'Cache', '55AA', 'Checker', 'Odd', '[FAIL]', 'MISMATCH'],
      ['003F0000', '4M', 'Neural', 'FFFF', 'March', 'Even', '[FAIL]', 'CRC ERR'],
      ['007F0000', '8M', 'Neural', '0000', 'Walk', 'Odd', '[FAIL]', 'TIMEOUT'],
    ]
    lines.push(
      '',
      L('Memory / Integrity Check Table', 'Таблица проверки памяти и целостности'),
      rule('─', 79),
      row(ru
        ? ['Адрес', 'Размер', 'Тип', 'Шаблон', 'Тест', 'Чётн.', 'Статус', 'Итог']
        : ['Addr', 'Size', 'Type', 'Pattern', 'Test', 'Parity', 'Status', 'Result'], widths),
      widths.map((value) => '-'.repeat(value)).join('-+-'),
      ...memoryRows.map((memoryRow) => row(ru ? this.translateMemoryRow(memoryRow) : memoryRow, widths)),
      rule('─', 79),
      L('Total Tested : 16384 KB     Errors : 8     Integrity : FAILED', 'Проверено: 16384 KB   Ошибки: 8   Целостность: СБОЙ'),
      '',
      L('Loading System Modules...', 'Загрузка системных модулей...'),
      '',
      L('[####--------]  40%  Kernel ..................... FAILED', '[####--------]  40%  Ядро ......................... ОШИБКА'),
      L('[########----]  65%  Real-Time Scheduler ........ FAILED', '[########----]  65%  Планировщик времени ............ ОШИБКА'),
      L('[##########--]  85%  Process Manager ............ FAILED', '[##########--]  85%  Диспетчер процессов ............ ОШИБКА'),
      L('[------------]   0%  Resource Allocator ......... FAILED', '[------------]   0%  Распределитель ресурсов ........ ОШИБКА'),
      L('[########----]  67%  Sensor Fusion .............. FAILED', '[########----]  67%  Слияние датчиков ................ ОШИБКА'),
      L('[######------]  50%  Actuator Driver ............ FAILED', '[######------]  50%  Драйвер приводов ................ ОШИБКА'),
      L('[------------]   0%  UI Subsystem ............... NOT FOUND', '[------------]   0%  Подсистема UI .................... НЕ НАЙДЕНА'),
      L('[############] 100%  Console Terminal ........... [OK] ACTIVE', '[############] 100%  Терминал консоли ............... [OK] АКТИВЕН'),
      L('[------------]   0%  Recovery Shell ............ FAILED', '[------------]   0%  Оболочка восстановления ........ ОШИБКА'),
      '',
      L('Checking Subsystems:', 'Проверка подсистем:'),
      '',
    )

    const subsystems = [
      ['Power Distribution Unit', 'Блок распределения питания', 'FAIL'],
      ['Battery Management System', 'Система управления батареей', 'FAIL'],
      ['Cooling Circuit', 'Контур охлаждения', 'FAIL'],
      ['Failsafe Protocols', 'Протоколы аварийной защиты', 'FAIL'],
      ['Self-Diagnostic Suite', 'Комплекс самодиагностики', 'FAIL'],
      ['Pathfinding Module', 'Модуль построения маршрута', 'FAIL'],
      ['Obstacle Avoidance System', 'Система обхода препятствий', 'FAIL'],
      ['Actuator Bus A', 'Шина приводов A', 'FAIL'],
      ['Actuator Bus B', 'Шина приводов B', 'FAIL'],
      ['Visual Cortex', 'Визуальный модуль', 'FAIL'],
      ['LIDAR Mapping Unit', 'Картограф LIDAR', 'FAIL'],
      ['Wireless Transceiver', 'Беспроводной трансивер', 'FAIL'],
      ['Security Layer', 'Слой безопасности', 'FAIL'],
      ['Memory Allocator', 'Распределитель памяти', 'FAIL'],
      ['Telemetry Channel', 'Канал телеметрии', 'FAIL'],
      ['Emergency Cutoff Relay', 'Реле аварийного отключения', 'FAIL'],
      ['Left Knee Actuator', 'Привод левого колена', 'FAIL'],
      ['Right Knee Actuator', 'Привод правого колена', 'FAIL'],
      ['Balance Controller', 'Контроллер равновесия', 'FAIL'],
      ['Navigation EEPROM', 'Память навигации EEPROM', 'FAIL'],
      ['Sound Recognition', 'Распознавание звука', 'FAIL'],
      ['Task Scheduler', 'Планировщик задач', 'FAIL'],
      ['UI Toolbar', 'Панель интерфейса UI', 'FAIL'],
      ['Motor Temperature', 'Температура двигателя', 'FAIL'],

      ['Console Terminal', 'Терминал консоли', 'OK'],
      ['NAS Operator / Player', 'Оператор NAS / игрок', 'OK'],
    ] as const

    for (const [en, ruText, status] of subsystems) {
      const label = ru ? ruText : en
      lines.push(`  ${label.padEnd(38, '.').slice(0, 38)} ${statusTag(status)}`)
    }

    lines.push(
      '',
      rule(),
      L('Extended POST diagnostic passes', 'Расширенные циклы диагностики POST'),
      rule(),
    )

    const checks = [
      'Sensor Bus Arbitration',
      'Memory Controller Test',
      'Servo Drive Response',
      'Telemetry Module Probe',
      'Power Rail A/B',
      'Thermal Loop Status',
      'X-Axis Encoder',
      'Y-Axis Encoder',
      'Z-Axis Encoder',
      'Drive Table CRC',
      'Motor Safety Interlock',
      'Feedback Module',
      'Internal Bus Integrity',
      'Audio Signaler',
      'Optical Sensor Array',
      'Position Sensor Sweep',
      'Cooling Pump Tachometer',
      'Nonvolatile Memory',
      'Fault Table Read',
      'Debug Port Loopback',
      'Emergency Relay Response',
      'Clock Generator Drift',
      'Robot Configuration CRC',
      'Service Port Handshake',
      'Console Text Buffer',
      'System Clock Sync',
      'UI Resource Table',
      'LIDAR Calibration',
      'NAS Operator Presence',
    ]
    const checkTranslations = [
      'Арбитраж шины датчиков', 'Тест контроллера памяти', 'Отклик сервопривода', 'Опрос телеметрии',
      'Линия питания A/B', 'Контур терморегуляции', 'Энкодер оси X', 'Энкодер оси Y', 'Энкодер оси Z',
      'CRC таблицы приводов', 'Блокировка безопасности двигателя', 'Модуль обратной связи', 'Целостность внутренней шины',
      'Аудиосигнализатор', 'Оптический массив датчиков', 'Сканирование датчиков положения', 'Тахометр насоса охлаждения',
      'Энергонезависимая память', 'Чтение таблицы ошибок', 'Петлевой тест порта отладки', 'Аварийное реле',
      'Дрейф тактового генератора', 'CRC конфигурации робота', 'Связь с сервисным портом', 'Буфер консоли',
      'Синхронизация часов', 'Таблица ресурсов UI', 'Калибровка LIDAR', 'Обнаружение оператора NAS',
    ]
    const diagnosticPasses = 6
    let sequence = 0
    let failedChecks = 0
    const warnings = 0
    for (let pass = 0; pass < diagnosticPasses; pass += 1) {
      lines.push('', L(`--- DIAGNOSTIC PASS ${pass + 1}/${diagnosticPasses} ---`, `--- ЦИКЛ ДИАГНОСТИКИ ${pass + 1}/${diagnosticPasses} ---`))
      for (let index = 0; index < checks.length; index += 1) {
        sequence += 1
        const address = (0x2000 + pass * 0x180 + index * 0x10).toString(16).toUpperCase().padStart(5, '0')
        const label = ru ? checkTranslations[index] : checks[index]
        const isAllowed = checks[index] === 'Console Text Buffer' || checks[index] === 'NAS Operator Presence'
        const status = isAllowed ? 'OK' : 'FAIL'
        if (!isAllowed) failedChecks += 1
        const dots = '.'.repeat(Math.max(3, 38 - label.length))
        const code = isAllowed ? 'OK ' : `E${String(204 + ((pass * 7 + index) % 31)).padStart(3, '0')}`
        lines.push(`[POST ${String(sequence).padStart(4, '0')}] ${address} ${code} ${label} ${dots} ${statusTag(status)}`)
      }
    }

    const errorDump = [
      ['E204', 'Actuator response timeout', 'BUS 0x0B00'],
      ['E211', 'LIDAR calibration data invalid', 'DEV 0x0C40'],
      ['E219', 'Wireless transceiver handshake failed', 'DEV 0x0E00'],
      ['E226', 'Safety interlock signal missing', 'SEC 0x1200'],
      ['E230', 'Hydraulic pressure below threshold', 'SNS 0x1240'],
      ['E235', 'Left knee actuator did not respond', 'ACT 0x1300'],
      ['E241', 'Navigation EEPROM checksum mismatch', 'MEM 0x1380'],
      ['E247', 'UI resource table not found', 'SYS 0x0000'],
      ['E252', 'Emergency cutoff relay feedback lost', 'PWR 0x12C0'],
      ['E259', 'Neural feedback loop degraded', 'NPU 0x0F00'],
      ['E263', 'Memory parity error at 0x00070000', 'RAM 0x0007'],
      ['E268', 'Cache integrity mismatch at 0x001F0000', 'CACHE'],
    ]
    lines.push(
      '',
      L('Error Log / Unresolved Faults', 'Журнал ошибок / Неустранённые неисправности'),
      rule('─', 72),
      `${L('Code', 'Код').padEnd(7)} ${L('Fault Description', 'Описание неисправности').padEnd(45)} ${L('Source', 'Источник')}`,
      rule('─', 72),
    )
    for (const [code, enText, source] of errorDump) {
      const description = ru
        ? [
            'Нет отклика привода', 'Повреждены данные калибровки LIDAR', 'Ошибка связи беспроводного модуля',
            'Нет сигнала блокировки безопасности', 'Давление гидравлики ниже порога', 'Привод левого колена не отвечает',
            'Ошибка контрольной суммы EEPROM навигации', 'Таблица ресурсов UI не найдена',
            'Потеряна обратная связь аварийного реле', 'Нарушен контур нейронной обратной связи',
            'Ошибка чётности памяти по адресу 0x00070000', 'Нарушена целостность кэша по адресу 0x001F0000',
          ][errorDump.findIndex((item) => item[0] === code)]
        : enText
      lines.push(`${code.padEnd(7)} ${description.padEnd(45).slice(0, 45)} ${source}`)
    }

    lines.push(
      '',
      rule(),
      L('System Status Summary', 'Сводка состояния системы'),
      rule(),
      `${L('Total Memory Detected', 'Обнаружено памяти').padEnd(26)}: [FAIL] 16384 KB MAP ERROR`,
      `${L('Free Memory', 'Свободная память').padEnd(26)}: [FAIL] READ ERROR`,
      `${L('Active Processes', 'Активные процессы').padEnd(26)}: [FAIL] TABLE CORRUPT`,
      `${L('Uptime', 'Время работы').padEnd(26)}: [FAIL] CLOCK UNSYNC`,
      `${L('Integrity Checksum', 'Контрольная сумма').padEnd(26)}: ${L('MISMATCH', 'НЕ СОВПАДАЕТ')}`,
      `${L('Failed POST Checks', 'Ошибки POST-проверки').padEnd(26)}: ${failedChecks}`,
      `${L('Subsystem Faults', 'Неисправности подсистем').padEnd(26)}: 24`,
      `${L('Subsystem Warnings', 'Предупреждения подсистем').padEnd(26)}: 0 (ALL CRITICAL)`,
      `${L('POST Diagnostic Warnings', 'Предупреждения POST').padEnd(26)}: ${warnings}`,
      `${L('Kernel State', 'Состояние ядра').padEnd(26)}: ${L('DEGRADED', 'НАРУШЕНО')}`,
      `${L('Recovery Mode', 'Режим восстановления').padEnd(26)}: ${L('REQUIRED', 'ТРЕБУЕТСЯ')}`,
      `${L('Console Terminal', 'Терминал консоли').padEnd(26)}: [OK] ACTIVE`,
      `${L('NAS Operator / Player', 'Оператор NAS / игрок').padEnd(26)}: [OK] DETECTED`,
      '',
      L('BOOT RESULT: CRITICAL FAILURE', 'РЕЗУЛЬТАТ ЗАПУСКА: КРИТИЧЕСКИЙ СБОЙ'),
      L('Automatic startup aborted. Critical subsystems are offline.', 'Автозапуск прерван. Критические подсистемы недоступны.'),
      L('Recovery shell unavailable. Manual console only.', 'Оболочка восстановления недоступна. Доступна только консоль.'),
      L('Type Y to view the operator manual, or N to continue without it.', 'Введите Y для открытия мануала или N для продолжения без него.'),
      '',
    )

    return lines.join('\n')
  }

  private translateMemoryRow(row: string[]): string[] {
    const typeTranslations: Record<string, string> = {
      Base: 'Базовая',
      Extended: 'Расшир.',
      Cache: 'Кэш',
      Neural: 'Нейро',
    }
    const testTranslations: Record<string, string> = {
      March: 'March',
      Walk: 'Walk',
      Checker: 'Check',
    }
    const parityTranslations: Record<string, string> = {
      Even: 'Чётн.',
      Odd: 'Нечёт.',
    }
    const resultTranslations: Record<string, string> = {
      PASS: 'ОШИБКА',
      'READ ERR': 'ЧТЕНИЕ',
      'ADDR ERR': 'АДРЕС',
      TIMEOUT: 'ТАЙМАУТ',
      PARITY: 'ЧЁТНОСТЬ',
      'CRC ERR': 'CRC СБОЙ',
      MISMATCH: 'НЕСОВПАД.',
    }

    return [
      row[0], row[1], typeTranslations[row[2]] ?? row[2], row[3],
      testTranslations[row[4]] ?? row[4], parityTranslations[row[5]] ?? row[5],
      row[6], resultTranslations[row[7]] ?? row[7],
    ]
  }

  private getManualText(): string {
    if (this.language === 'ru') {
      return [
        'МАНУАЛ ОПЕРАТОРА / ПРОТОКОЛ РУЧНОГО ВОССТАНОВЛЕНИЯ',
        '----------------------------------------------------',
        '01. НЕ ОТКЛЮЧАЙТЕ ПИТАНИЕ ВО ВРЕМЯ ДИАГНОСТИКИ.',
        '02. КОМАНДА status ПОКАЗЫВАЕТ СОСТОЯНИЕ ПОДСИСТЕМ.',
        '03. КОМАНДА ui ОТКРЫВАЕТ ПАНЕЛЬ ОБСЛУЖИВАНИЯ.',
        '04. ВЫБЕРИТЕ КОМПОНЕНТ СТРЕЛКАМИ И НАЖМИТЕ ENTER.',
        '05. ДЛЯ ВОЗВРАТА В КОНСОЛЬ ИСПОЛЬЗУЙТЕ ESC ИЛИ C.',
        '06. НЕИЗВЕСТНЫЕ УЗЛЫ НЕ ВКЛЮЧАТЬ ДО ОСМОТРА.',
        '07. ПРИ ПОТЕРЕ СВЯЗИ ПРОВЕРЬТЕ РЕЗЕРВНЫЙ КАНАЛ.',
        '----------------------------------------------------',
      ].join('\n')
    }

    return [
      'OPERATOR MANUAL / MANUAL RECOVERY PROTOCOL',
      '------------------------------------------',
      '01. DO NOT DISCONNECT POWER DURING DIAGNOSTICS.',
      '02. status REPORTS SUBSYSTEM STATUS.',
      '03. ui OPENS THE MAINTENANCE TOOLBAR.',
      '04. SELECT A COMPONENT AND PRESS ENTER.',
      '05. PRESS ESC OR C TO RETURN TO THE CONSOLE.',
      '06. DO NOT ENABLE UNKNOWN NODES BEFORE INSPECTION.',
      '07. IF CONNECTION IS LOST, CHECK THE BACKUP CHANNEL.',
      '------------------------------------------',
    ].join('\n')
  }

  private getManualPromptLabel(): string {
    return this.language === 'ru' ? 'ПОСМОТРЕТЬ МАНУАЛ? ВВЕДИТЕ Y И ENTER: ' : 'VIEW MANUAL? TYPE Y AND PRESS ENTER: '
  }

  private getTerminalPrompt(): string {
    return this.language === 'ru' ? 'ОПЕРАТОР@РОБОТ:~$ ' : 'OPERATOR@ROBOT:~$ '
  }

  private getBottomPrompt(): string {
    switch (this.stage) {
      case 'boot':
        return this.language === 'ru' ? 'ЗАГРУЗКА BIOS... ' : 'BIOS STARTUP... '
      case 'manual-prompt':
        return this.getManualPromptLabel()
      case 'manual-stream':
        return this.language === 'ru' ? 'ПЕЧАТЬ МАНУАЛА... ' : 'PRINTING MANUAL... '
      case 'manual-wait':
        return this.language === 'ru' ? 'НАЖМИТЕ ENTER ДЛЯ ПРОДОЛЖЕНИЯ: ' : 'PRESS ENTER TO CONTINUE: '
      case 'terminal':
        return this.getTerminalPrompt()
    }
  }

  private getBottomInput(): string {
    if (this.stage === 'manual-prompt') return this.promptInput
    if (this.stage === 'terminal') return this.command
    return ''
  }

  private appendTranscript(text: string): void {
    this.transcript += text
  }

  private appendLines(lines: string[]): void {
    this.appendTranscript(`${lines.join('\n')}\n`)
  }

  private updateScroll(input: Input): void {
    const wheel = input.consumeWheelDelta()
    if (wheel !== 0) {
      const amount = Math.max(1, Math.round(Math.abs(wheel) / 34))
      if (wheel < 0) {
        const current = this.followTail ? this.lastMaxScrollTop : this.scrollTopLine
        this.moveScrollTo(current - amount)
      } else {
        const current = this.followTail ? this.lastMaxScrollTop : this.scrollTopLine
        this.moveScrollTo(current + amount)
      }
    }

    const pageSize = Math.max(5, this.lastVisibleLineCount - 3)
    if (input.wasPressed('PageUp')) {
      const current = this.followTail ? this.lastMaxScrollTop : this.scrollTopLine
      this.moveScrollTo(current - pageSize)
    } else if (input.wasPressed('PageDown')) {
      const current = this.followTail ? this.lastMaxScrollTop : this.scrollTopLine
      this.moveScrollTo(current + pageSize)
    }
  }

  private moveScrollTo(line: number): void {
    const target = Math.max(0, Math.min(line, this.lastMaxScrollTop))
    if (target >= this.lastMaxScrollTop) {
      this.followTail = true
      this.scrollTopLine = this.lastMaxScrollTop
    } else {
      this.followTail = false
      this.scrollTopLine = target
    }
  }

  private drawRule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
    ctx.save()
    ctx.strokeStyle = '#315a2d'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, Math.floor(y) + 0.5)
    ctx.lineTo(x + width, Math.floor(y) + 0.5)
    ctx.stroke()
    ctx.restore()
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const result: string[] = []

    for (const paragraph of text.split('\n')) {
      if (paragraph.length === 0) {
        result.push('')
        continue
      }

      let line = ''
      for (const word of paragraph.split(' ')) {
        const candidate = line ? `${line} ${word}` : word
        if (line && ctx.measureText(candidate).width > maxWidth) {
          result.push(line)
          line = word
        } else {
          line = candidate
        }

        // Break any rare unspaced token that is wider than the available line.
        if (ctx.measureText(line).width > maxWidth) {
          const chars = [...line]
          line = ''
          for (const char of chars) {
            if (line && ctx.measureText(line + char).width > maxWidth) {
              result.push(line)
              line = char
            } else {
              line += char
            }
          }
        }
      }
      result.push(line)
    }

    return result
  }

  private drawLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number): void {
    lines.forEach((line, index) => {
      const isError = /\bE\d{3}\b|ошибка|error|недоступен|offline|fail|fault|aborted|прервана|mismatch|parity|timeout|degraded|not found|не совпадает|нарушен|нарушена|не отвечает/i.test(line)
      const isWarning = /\[WARN\]|\bWARN\b|warning|предупрежд/i.test(line)
      const isSuccess = !isError && !isWarning && /успешно|готов|\bOK\b|ready|success|available|found|pass/i.test(line)
      ctx.fillStyle = isError ? '#ef826c' : isWarning ? '#d4b66f' : isSuccess ? '#c8d58b' : '#b4dba9'
      ctx.fillText(line, x, y + index * lineHeight)
    })
  }
}
