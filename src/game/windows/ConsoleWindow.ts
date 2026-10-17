import type { Input } from '../Input'

import { FONT_FAMILY } from '../fonts'

import type { GameLanguage, GameWindow } from './GameWindow'

import type { WindowManager } from './WindowManager'



type ConsoleStage = 'boot' | 'manual-prompt' | 'manual-stream' | 'manual-wait' | 'terminal'

type ComponentStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'CRITICAL'
type LocalizedText = Record<GameLanguage, string>

interface RobotComponentInfo {
  id: string
  name: string
  category: string
  status: ComponentStatus
  description: LocalizedText
  function: LocalizedText
  dependencies: string[]
  affects: string[]
  symptoms: LocalizedText
  recommendation: LocalizedText
}

/** Initial recovery scenario. Later this registry can be moved into RobotSystem. */
const ROBOT_COMPONENTS: RobotComponentInfo[] = [
  {
    id: 'PWR-100', name: 'Power Core', category: 'POWER', status: 'DEGRADED',
    description: { ru: 'Основной источник электрической энергии робота.', en: 'The robot\'s primary electrical power source.' },
    function: { ru: 'Подаёт основное питание на распределительную систему.', en: 'Supplies primary power to the distribution system.' },
    dependencies: [], affects: ['PDU-230', 'BMS-221'],
    symptoms: { ru: 'Нестабильное питание, внезапные отключения узлов.', en: 'Unstable power and unexpected subsystem shutdowns.' },
    recommendation: { ru: 'Проверьте состояние PWR-100 и входное напряжение PDU-230.', en: 'Inspect PWR-100 and verify the input voltage at PDU-230.' },
  },
  {
    id: 'BAT-220', name: 'Battery Pack', category: 'POWER', status: 'ONLINE',
    description: { ru: 'Аккумуляторный блок для автономной работы.', en: 'Battery pack used for autonomous operation.' },
    function: { ru: 'Хранит запас энергии и поддерживает питание без внешнего источника.', en: 'Stores energy and supplies the robot when primary power is unavailable.' },
    dependencies: [], affects: ['BMS-221', 'PDU-230'],
    symptoms: { ru: 'Снижение времени работы, просадка напряжения под нагрузкой.', en: 'Reduced runtime or voltage sag under load.' },
    recommendation: { ru: 'Проверьте заряд и показания BMS-221.', en: 'Check the charge level and readings reported by BMS-221.' },
  },
  {
    id: 'BMS-221', name: 'Battery Management System', category: 'POWER', status: 'DEGRADED',
    description: { ru: 'Контроллер контроля и защиты аккумулятора.', en: 'Battery monitoring and protection controller.' },
    function: { ru: 'Отслеживает заряд, напряжение и состояние батареи.', en: 'Monitors battery charge, voltage and condition.' },
    dependencies: ['BAT-220'], affects: ['PDU-230'],
    symptoms: { ru: 'Некорректный уровень заряда или отсутствие данных о батарее.', en: 'Incorrect charge readings or missing battery telemetry.' },
    recommendation: { ru: 'Проверьте телеметрию BAT-220 и перезапустите диагностику.', en: 'Check BAT-220 telemetry and run diagnostics again.' },
  },
  {
    id: 'PDU-230', name: 'Power Distribution Unit', category: 'POWER', status: 'DEGRADED',
    description: { ru: 'Блок распределения электропитания между узлами.', en: 'Power distribution unit for robot subsystems.' },
    function: { ru: 'Подаёт питание на вычислители, датчики и приводы.', en: 'Routes power to compute modules, sensors and actuators.' },
    dependencies: ['PWR-100', 'BAT-220'], affects: ['CPU-730', 'CAM-410', 'ACT-610', 'CLG-820'],
    symptoms: { ru: 'Одновременные сбои нескольких несвязанных компонентов.', en: 'Multiple otherwise unrelated components failing at once.' },
    recommendation: { ru: 'Проверьте входное питание и линии распределения PDU-230.', en: 'Inspect PDU-230 input power and distribution rails.' },
  },
  {
    id: 'CPU-730', name: 'Central Processing Unit', category: 'COMPUTE', status: 'DEGRADED',
    description: { ru: 'Центральный вычислительный модуль робота.', en: 'The robot\'s central compute module.' },
    function: { ru: 'Выполняет системные задачи и обрабатывает данные подсистем.', en: 'Executes system tasks and processes subsystem data.' },
    dependencies: ['PDU-230', 'MEM-732'], affects: ['OSK-710', 'DGN-900', 'LOC-630', 'CAM-410'],
    symptoms: { ru: 'Задержки команд, ошибки вычислений, пропуск сроков задач.', en: 'Command latency, computation errors or missed task deadlines.' },
    recommendation: { ru: 'Запустите diagnostics и проверьте MEM-732 и RTS-711.', en: 'Run diagnostics and inspect MEM-732 and RTS-711.' },
  },
  {
    id: 'MEM-732', name: 'System Memory', category: 'COMPUTE', status: 'DEGRADED',
    description: { ru: 'Рабочая память для системных процессов и данных.', en: 'Working memory used by system processes and data.' },
    function: { ru: 'Хранит временные данные, буферы и состояние процессов.', en: 'Stores temporary data, buffers and process state.' },
    dependencies: ['PDU-230'], affects: ['CPU-730', 'OSK-710', 'DGN-900'],
    symptoms: { ru: 'Ошибки чтения/записи, сбои процессов и повреждение данных.', en: 'Read/write errors, process failures or corrupted data.' },
    recommendation: { ru: 'Проверьте целостность памяти и журналы системного ядра.', en: 'Check memory integrity and system-kernel logs.' },
  },
  {
    id: 'OSK-710', name: 'System Kernel', category: 'OS', status: 'DEGRADED',
    description: { ru: 'Базовый системный слой, связывающий ПО и оборудование.', en: 'Core system layer connecting software and hardware.' },
    function: { ru: 'Управляет системными операциями и доступом к ресурсам.', en: 'Coordinates system operations and access to resources.' },
    dependencies: ['CPU-730', 'MEM-732'], affects: ['RTS-711', 'DGN-900', 'LOC-630'],
    symptoms: { ru: 'Службы не запускаются, устройства недоступны системе.', en: 'Services fail to start or devices become unavailable to software.' },
    recommendation: { ru: 'Проверьте целостность ядра и таблицу драйверов.', en: 'Verify kernel integrity and the device-driver table.' },
  },
  {
    id: 'RTS-711', name: 'Real-Time Scheduler', category: 'OS', status: 'OFFLINE',
    description: { ru: 'Планировщик выполнения задач реального времени.', en: 'Real-time task execution scheduler.' },
    function: { ru: 'Выдаёт процессорное время задачам с учётом приоритетов.', en: 'Allocates CPU time to tasks according to their priorities.' },
    dependencies: ['OSK-710', 'CPU-730'], affects: ['LOC-630', 'BAL-640', 'DGN-900'],
    symptoms: { ru: 'Задачи управления выполняются с опозданием или не запускаются.', en: 'Control tasks run late or fail to execute.' },
    recommendation: { ru: 'Проверьте состояние OSK-710 и загрузку CPU-730.', en: 'Inspect OSK-710 and CPU-730 load before restarting the scheduler.' },
  },
  {
    id: 'CAM-410', name: 'Primary Camera Array', category: 'SENSORS', status: 'ONLINE',
    description: { ru: 'Основной массив визуальных датчиков.', en: 'Primary visual sensor array.' },
    function: { ru: 'Передаёт изображения для распознавания окружающей среды.', en: 'Provides images for environmental perception.' },
    dependencies: ['PDU-230'], affects: ['CPU-730', 'LOC-630'],
    symptoms: { ru: 'Пустой видеопоток, артефакты изображения или устаревшие кадры.', en: 'Missing video stream, image artifacts or stale frames.' },
    recommendation: { ru: 'Проверьте поток кадров и подключение датчика.', en: 'Check the frame stream and sensor connection.' },
  },
  {
    id: 'LID-420', name: 'LIDAR Mapping Unit', category: 'SENSORS', status: 'OFFLINE',
    description: { ru: 'Лазерный дальномер для измерения расстояний.', en: 'Laser ranging unit used to measure distances.' },
    function: { ru: 'Передаёт измерения для построения карты препятствий.', en: 'Supplies range measurements for obstacle mapping.' },
    dependencies: ['PDU-230'], affects: ['LOC-630', 'BAL-640'],
    symptoms: { ru: 'Карта окружения не обновляется, данные дальности отсутствуют.', en: 'The environment map stops updating or range data is missing.' },
    recommendation: { ru: 'Проверьте соединение и калибровку LID-420.', en: 'Check the LID-420 connection and calibration.' },
  },
  {
    id: 'IMU-430', name: 'Inertial Measurement Unit', category: 'SENSORS', status: 'DEGRADED',
    description: { ru: 'Инерциальный измерительный модуль.', en: 'Inertial measurement module.' },
    function: { ru: 'Измеряет угловую скорость и линейное ускорение корпуса.', en: 'Measures angular velocity and linear acceleration.' },
    dependencies: ['PDU-230'], affects: ['BAL-640', 'LOC-630'],
    symptoms: { ru: 'Дрейф ориентации и нестабильная оценка положения корпуса.', en: 'Orientation drift and unstable body-pose estimates.' },
    recommendation: { ru: 'Проверьте калибровку IMU-430 и сравните показания с другими датчиками.', en: 'Calibrate IMU-430 and compare its readings with other sensors.' },
  },
  {
    id: 'FRC-440', name: 'Force/Torque Feedback Array', category: 'SENSORS', status: 'DEGRADED',
    description: { ru: 'Массив датчиков силы и крутящего момента.', en: 'Force and torque feedback sensor array.' },
    function: { ru: 'Измеряет нагрузку на механизмы и точки контакта.', en: 'Measures loads on mechanisms and contact points.' },
    dependencies: ['PDU-230'], affects: ['SRV-620', 'BAL-640'],
    symptoms: { ru: 'Некорректная оценка нагрузки, контакта или сопротивления движению.', en: 'Incorrect estimates of load, contact or resistance to motion.' },
    recommendation: { ru: 'Ограничьте нагрузку на приводы и проверьте датчики обратной связи.', en: 'Limit actuator loads and inspect the feedback sensors.' },
  },
  {
    id: 'ACT-610', name: 'Actuator Control Bus', category: 'MOTION', status: 'OFFLINE',
    description: { ru: 'Внутренняя шина команд для исполнительных механизмов.', en: 'Internal command bus for actuators.' },
    function: { ru: 'Передаёт управляющие сигналы сервоконтроллерам.', en: 'Carries control messages to servo controllers.' },
    dependencies: ['PDU-230'], affects: ['SRV-620', 'LOC-630', 'BAL-640'],
    symptoms: { ru: 'Приводы не отвечают на команды или теряют синхронизацию.', en: 'Actuators ignore commands or lose synchronization.' },
    recommendation: { ru: 'Проверьте питание шины, соединения и журнал ошибок ACT-610.', en: 'Check bus power, connections and ACT-610 fault logs.' },
  },
  {
    id: 'SRV-620', name: 'Servo & Joint Controller', category: 'MOTION', status: 'DEGRADED',
    description: { ru: 'Контроллеры сервоприводов и суставных механизмов.', en: 'Controllers for servos and joint mechanisms.' },
    function: { ru: 'Исполняют команды положения и регулируют движение суставов.', en: 'Execute joint-position commands and regulate motion.' },
    dependencies: ['ACT-610', 'PDU-230'], affects: ['LOC-630', 'BAL-640'],
    symptoms: { ru: 'Рывки, запаздывание или отсутствие движения отдельных суставов.', en: 'Jerky, delayed or missing joint motion.' },
    recommendation: { ru: 'Проверьте ACT-610 и проведите проверку привода без нагрузки.', en: 'Inspect ACT-610 and test the actuator without load.' },
  },
  {
    id: 'LOC-630', name: 'Locomotion Controller', category: 'MOTION', status: 'DEGRADED',
    description: { ru: 'Основной программный контроллер передвижения.', en: 'Primary robot locomotion controller.' },
    function: { ru: 'Преобразует задачу движения в команды исполнительным механизмам.', en: 'Converts movement goals into actuator commands.' },
    dependencies: ['CPU-730', 'ACT-610', 'RTS-711'], affects: ['BAL-640'],
    symptoms: { ru: 'Робот не начинает движение, останавливается или выполняет команды неточно.', en: 'The robot fails to move, stops unexpectedly or moves inaccurately.' },
    recommendation: { ru: 'Проверьте RTS-711, ACT-610 и доступность датчиков навигации.', en: 'Check RTS-711, ACT-610 and navigation-sensor availability.' },
  },
  {
    id: 'BAL-640', name: 'Balance & Posture Engine', category: 'MOTION', status: 'DEGRADED',
    description: { ru: 'Подсистема стабилизации и контроля положения корпуса.', en: 'Body balance and posture-control subsystem.' },
    function: { ru: 'Корректирует позу робота на основе инерциальных и силовых измерений.', en: 'Adjusts robot posture using inertial and force feedback.' },
    dependencies: ['IMU-430', 'SRV-620'], affects: ['LOC-630'],
    symptoms: { ru: 'Потеря равновесия, колебания корпуса или защитная остановка.', en: 'Loss of balance, body oscillation or protective stop.' },
    recommendation: { ru: 'Не запускайте движение до проверки IMU-430 и SRV-620.', en: 'Do not initiate movement until IMU-430 and SRV-620 are checked.' },
  },
  {
    id: 'TMP-810', name: 'Thermal Sensor Array', category: 'THERMAL', status: 'ONLINE',
    description: { ru: 'Массив температурных датчиков.', en: 'Array of temperature sensors.' },
    function: { ru: 'Измеряет температуру вычислительных и механических узлов.', en: 'Measures temperatures of compute and mechanical components.' },
    dependencies: ['PDU-230'], affects: ['CLG-820', 'THP-830'],
    symptoms: { ru: 'Отсутствующие, застывшие или неправдоподобные показания температуры.', en: 'Missing, frozen or implausible temperature readings.' },
    recommendation: { ru: 'Сравните измерения нескольких датчиков и проверьте телеметрию.', en: 'Compare multiple sensor readings and verify telemetry.' },
  },
  {
    id: 'CLG-820', name: 'Cooling Circuit', category: 'THERMAL', status: 'DEGRADED',
    description: { ru: 'Контур отвода тепла от основных компонентов.', en: 'Cooling loop that removes heat from major components.' },
    function: { ru: 'Снижает температуру узлов при работе под нагрузкой.', en: 'Reduces component temperature during operation.' },
    dependencies: ['PDU-230'], affects: ['CPU-730', 'PDU-230', 'THP-830'],
    symptoms: { ru: 'Рост температуры при обычной нагрузке, перегрев или снижение производительности.', en: 'Temperature rise at normal load, overheating or performance throttling.' },
    recommendation: { ru: 'Проверьте насос, вентиляторы и циркуляцию охлаждающей среды.', en: 'Inspect the pump, fans and coolant circulation.' },
  },
  {
    id: 'THP-830', name: 'Overheat Protection Unit', category: 'SAFETY', status: 'DEGRADED',
    description: { ru: 'Защита от превышения температурных порогов.', en: 'Protection against excessive operating temperatures.' },
    function: { ru: 'Ограничивает нагрузку или отключает узлы при перегреве.', en: 'Reduces load or shuts components down when overheating is detected.' },
    dependencies: ['TMP-810', 'CLG-820'], affects: ['CPU-730', 'SRV-620'],
    symptoms: { ru: 'Ложные температурные тревоги либо отсутствие реакции на перегрев.', en: 'False thermal alarms or failure to react to overheating.' },
    recommendation: { ru: 'Не отключайте защиту; проверьте TMP-810 и CLG-820.', en: 'Do not disable protection; inspect TMP-810 and CLG-820.' },
  },
  {
    id: 'NET-510', name: 'External Command Link', category: 'NETWORK', status: 'OFFLINE',
    description: { ru: 'Канал внешней связи с оператором или управляющей станцией.', en: 'External communication link to the operator or control station.' },
    function: { ru: 'Принимает внешние команды и передаёт телеметрию.', en: 'Receives external commands and transmits telemetry.' },
    dependencies: ['PDU-230'], affects: ['DGN-900'],
    symptoms: { ru: 'Потеря удалённого управления и отсутствие внешней телеметрии.', en: 'Remote control is lost and external telemetry is unavailable.' },
    recommendation: { ru: 'Проверьте питание и локальный сетевой интерфейс. Локальная стабилизация должна оставаться автономной.', en: 'Check power and the local network interface. Local stabilization should remain autonomous.' },
  },
  {
    id: 'DGN-900', name: 'Self-Diagnostic Suite', category: 'SYSTEM', status: 'DEGRADED',
    description: { ru: 'Системный комплекс самодиагностики и регистрации ошибок.', en: 'System self-diagnostics and fault-reporting suite.' },
    function: { ru: 'Проверяет доступность узлов и собирает сведения о неисправностях.', en: 'Checks component availability and collects fault information.' },
    dependencies: ['CPU-730', 'OSK-710'], affects: ['FSF-910'],
    symptoms: { ru: 'Неполные отчёты, пропущенные ошибки или невозможность завершить проверку.', en: 'Incomplete reports, missed faults or diagnostics that cannot finish.' },
    recommendation: { ru: 'Сначала проверьте CPU-730 и OSK-710, затем повторите diagnostics.', en: 'Inspect CPU-730 and OSK-710, then rerun diagnostics.' },
  },
  {
    id: 'FSF-910', name: 'Failsafe Controller', category: 'SAFETY', status: 'ONLINE',
    description: { ru: 'Контроллер безопасного поведения при системных отказах.', en: 'Controller for safe behavior during system faults.' },
    function: { ru: 'Переводит робота в ограниченный или безопасный режим.', en: 'Places the robot into a restricted or safe operating mode.' },
    dependencies: ['BAT-220'], affects: ['LOC-630', 'BAL-640'],
    symptoms: { ru: 'Опасные команды не блокируются или безопасный режим не активируется.', en: 'Unsafe commands are not blocked or safe mode fails to activate.' },
    recommendation: { ru: 'Не обходите защиту; проверьте регистрацию ошибок DGN-900.', en: 'Do not bypass safety controls; inspect fault records from DGN-900.' },
  },
]



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

  // Command history is retained for the lifetime of this console instance.
  private commandHistory: string[] = []
  private commandHistoryIndex = 0
  private commandDraft = ''
  private browsingCommandHistory = false

  private promptInput = ''

  // Repeated Tab presses cycle through the current set of completion candidates.
  private completionCandidates: string[] = []
  private completionIndex = -1
  private lastCompletedValue: string | null = null



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

    ctx.clearRect(0,0,  width, height)



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
        ? 'ROM v1.08 | TAB — АВТОДОПОЛНЕНИЕ | PGUP/PGDN — ПРОКРУТКА'
        : 'ROM v1.08 | TAB — AUTOCOMPLETE | PGUP/PGDN — SCROLLBACK',
      margin,
      margin + lineHeight + 1,
      textWidth,
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

    const cursor = Math.floor(this.blinkClock * 2) % 2 === 0 ? '\_' : ' '

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
        this.clearCompletionState()
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
        this.commandHistoryIndex = Math.max(0, this.commandHistoryIndex - 1)
        this.command = this.commandHistory[this.commandHistoryIndex] ?? ''
        this.clearCompletionState()
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
        this.clearCompletionState()
        continue
      }

      if (key === 'Tab') {
        this.completeCommandInput()
        continue
      }

      if (key === 'Backspace') {
        this.command = this.command.slice(0, -1)
        this.browsingCommandHistory = false
        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
        this.clearCompletionState()
        continue
      }

      if (key === 'Escape') continue

      if (key.length === 1 && this.command.length < 128) {
        this.command += key
        this.browsingCommandHistory = false
        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
        this.clearCompletionState()
      }
    }
  }

  /**
   * Autocomplete every supported command. `info` additionally completes component IDs.
   * Repeated Tab presses cycle through ambiguous matches without printing them to the transcript.
   */
  private completeCommandInput(): void {
    // Keep cycling only while the player has not edited the completed value.
    if (
      this.completionCandidates.length > 1 &&
      this.lastCompletedValue !== null &&
      this.command === this.lastCompletedValue
    ) {
      this.completionIndex = (this.completionIndex + 1) % this.completionCandidates.length
      this.command = this.completionCandidates[this.completionIndex]
      this.lastCompletedValue = this.command
      return
    }

    this.clearCompletionState()
    const candidates = this.getCompletionCandidates(this.command)
    if (candidates.length === 0) return

    this.command = candidates[0]

    // A single command candidate (for example, "inf" -> "info") should not
    // trap the user in a one-item cycle: the next Tab can complete its argument.
    if (candidates.length > 1) {
      this.completionCandidates = candidates
      this.completionIndex = 0
      this.lastCompletedValue = this.command
    }
  }

  private getCompletionCandidates(rawInput: string): string[] {
    const input = rawInput.trimStart()
    const commandMatch = /^(\S+)([\s\S]*)$/.exec(input)

    // Tab on an empty line cycles through available command names.
    if (!commandMatch) {
      return this.getCommandNames()
    }

    const enteredCommand = commandMatch[1]
    const rest = commandMatch[2] ?? ''
    const normalizedCommand = enteredCommand.toLowerCase()

    // `info`, `info ` and partial component IDs complete against the registry.
    if (normalizedCommand === 'info') {
      const hasArgument = rest.trim().length > 0
      const argument = rest.trim().toUpperCase()

      // Component IDs are one token; ignore accidental extra arguments.
      if (argument.includes(' ')) return []

      let components = ROBOT_COMPONENTS
      if (argument) {
        components = components.filter((component) => component.id.startsWith(argument))
      } else if (!hasArgument) {
        // CPU-730 is the primary example in the operator manual, so show it first.
        components = [
          ...ROBOT_COMPONENTS.filter((component) => component.id === 'CPU-730'),
          ...ROBOT_COMPONENTS.filter((component) => component.id !== 'CPU-730'),
        ]
      }

      return components.map((component) => `${enteredCommand} ${component.id}`)
    }

    // The other commands take no arguments. Still complete their names uniformly,
    // but do not replace a trailing argument or unrelated text.
    if (rest.trim().length > 0) return []

    const prefix = enteredCommand.toLowerCase()
    const leadingWhitespace = input.slice(0, input.length - enteredCommand.length)
    return this.getCommandNames()
      .filter((name) => name.startsWith(prefix))
      .map((name) => `${leadingWhitespace}${name}`)
  }

  private getCommandNames(): string[] {
    // `compinents` is retained as a compatibility alias for the original command spelling.
    return ['help', 'components', 'compinents', 'info', 'status', 'diagnostics', 'ui', 'manual', 'clear', 'reboot']
  }

  private clearCompletionState(): void {
    this.completionCandidates = []
    this.completionIndex = -1
    this.lastCompletedValue = null
  }

  private executeCommand(rawCommand: string): void {
    const parts = rawCommand.trim().split(/\s+/)
    const command = (parts.shift() ?? '').toLowerCase()
    const argument = parts.join(' ').trim().toUpperCase()

    // Keep the requested typo as an alias, but document the correct spelling.
    if (command === 'components' || command === 'compinents') {
      this.printComponentList()
      return
    }
    if (command === 'info') {
      this.printComponentInfo(argument)
      return
    }
    if (command === 'diagnostics') {
      this.printDiagnostics()
      return
    }
    if (command === 'status') {
      this.printRobotStatus()
      return
    }

    switch (command) {

      case 'help':
        this.appendLines(this.language === 'ru'
          ? [
              'ДОСТУПНЫЕ КОМАНДЫ:',
              '  help             — список команд',
              '  components       — список компонентов робота',
              '  compinents       — псевдоним components',
              '  info <ID>         — справка, например info CPU-730',
              '  status            — сводка состояния робота',
              '  diagnostics       — диагностика отказов и зависимостей',
              '  ui                — открыть панель обслуживания',
              '  manual            — показать мануал',
              '  clear             — очистить экран (история сохранится)',
              '  reboot            — повторить загрузку BIOS',
              '  Tab               — автодополнение команды; повторный Tab — следующий вариант',
              '  ↑ / ↓             — история введённых команд',
              '',
            ]
          : [
              'AVAILABLE COMMANDS:',
              '  help             — list commands',
              '  components       — list robot components',
              '  compinents       — alias for components',
              '  info <ID>         — component details, e.g. info CPU-730',
              '  status            — robot status summary',
              '  diagnostics       — inspect faults and dependencies',
              '  ui                — open service toolbar',
              '  manual            — print the manual',
              '  clear             — clear view (history is retained)',
              '  reboot            — run BIOS startup again',
              '  Tab               — complete command; press again for next match',
              '  ↑ / ↓             — command history',
              '',
            ])
        break

      case 'ui':

        this.appendTranscript(this.language === 'ru' ? 'ЗАПУСК ПАНЕЛИ ОБСЛУЖИВАНИЯ...\n' : 'STARTING SERVICE TOOLBAR...\n')

        this.manager?.show('ui')

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



  private printComponentList(): void {
    const ru = this.language === 'ru'
    const lines = [
      ru ? 'РЕЕСТР КОМПОНЕНТОВ РОБОТА' : 'ROBOT COMPONENT REGISTRY',
      '----------------------------------------------------------------',
      `${'ID'.padEnd(9)} ${'COMPONENT'.padEnd(32)} ${'STATUS'.padEnd(10)} CATEGORY`,
      '----------------------------------------------------------------',
    ]

    for (const component of ROBOT_COMPONENTS) {
      lines.push(
        `${component.id.padEnd(9)} ${component.name.padEnd(32).slice(0, 32)} ${component.status.padEnd(10)} ${component.category}`,
      )
    }

    lines.push(
      '----------------------------------------------------------------',
      ru
        ? `${ROBOT_COMPONENTS.length} КОМПОНЕНТОВ. ВВЕДИТЕ info <ID> ДЛЯ ПОДРОБНОСТЕЙ.`
        : `${ROBOT_COMPONENTS.length} COMPONENTS. TYPE info <ID> FOR DETAILS.`,
      '',
    )
    this.appendLines(lines)
  }

  private printComponentInfo(id: string): void {
    const ru = this.language === 'ru'
    if (!id) {
      this.appendLines(ru
        ? ['ОШИБКА: УКАЖИТЕ ID КОМПОНЕНТА.', 'ПРИМЕР: info CPU-730', '']
        : ['ERROR: COMPONENT ID REQUIRED.', 'EXAMPLE: info CPU-730', ''])
      return
    }

    const component = ROBOT_COMPONENTS.find((item) => item.id === id)
    if (!component) {
      this.appendLines(ru
        ? [`КОМПОНЕНТ НЕ НАЙДЕН: ${id}`, 'ВВЕДИТЕ components ДЛЯ СПИСКА ID.', '']
        : [`COMPONENT NOT FOUND: ${id}`, 'TYPE components TO LIST VALID IDS.', ''])
      return
    }

    const language = this.language
    const list = (ids: string[]) => ids.length > 0 ? ids.join(', ') : (ru ? 'нет' : 'none')
    this.appendLines([
      `${component.id} — ${component.name}`,
      `${ru ? 'КАТЕГОРИЯ' : 'CATEGORY'}: ${component.category}`,
      `${ru ? 'СОСТОЯНИЕ' : 'STATUS'}: [${component.status}]`,
      '',
      `${ru ? 'ОПИСАНИЕ' : 'DESCRIPTION'}:`,
      component.description[language],
      '',
      `${ru ? 'НАЗНАЧЕНИЕ' : 'FUNCTION'}:`,
      component.function[language],
      '',
      `${ru ? 'ЗАВИСИТ ОТ' : 'DEPENDENCIES'}: ${list(component.dependencies)}`,
      `${ru ? 'ВЛИЯЕТ НА' : 'AFFECTS'}: ${list(component.affects)}`,
      '',
      `${ru ? 'ПРИЗНАКИ НЕИСПРАВНОСТИ' : 'FAILURE SYMPTOMS'}:`,
      component.symptoms[language],
      '',
      `${ru ? 'РЕКОМЕНДАЦИЯ' : 'RECOMMENDATION'}:`,
      component.recommendation[language],
      '',
    ])
  }

  private printRobotStatus(): void {
    const ru = this.language === 'ru'
    const online = ROBOT_COMPONENTS.filter((item) => item.status === 'ONLINE').length
    const degraded = ROBOT_COMPONENTS.filter((item) => item.status === 'DEGRADED').length
    const offline = ROBOT_COMPONENTS.filter((item) => item.status === 'OFFLINE').length
    const critical = ROBOT_COMPONENTS.filter((item) => item.status === 'CRITICAL').length
    const faulty = ROBOT_COMPONENTS.filter((item) => item.status !== 'ONLINE')

    this.appendLines([
      ru ? 'СВОДКА СОСТОЯНИЯ РОБОТА' : 'ROBOT STATUS SUMMARY',
      '-----------------------------------------------',
      `${ru ? 'Всего компонентов' : 'Total components'}: ${ROBOT_COMPONENTS.length}`,
      `ONLINE: ${online}   DEGRADED: ${degraded}   OFFLINE: ${offline}   CRITICAL: ${critical}`,
      '',
      ru ? 'КОМПОНЕНТЫ, ТРЕБУЮЩИЕ ВНИМАНИЯ:' : 'COMPONENTS REQUIRING ATTENTION:',
      ...faulty.map((item) => `${item.status.padEnd(8)} ${item.id}  ${item.name}`),
      '',
      ru ? 'РЕЖИМ РОБОТА: ВОССТАНОВЛЕНИЕ' : 'ROBOT MODE: RECOVERY',
      '',
    ])
  }

  private printDiagnostics(): void {
    const ru = this.language === 'ru'
    const issueComponents = ROBOT_COMPONENTS.filter((item) => item.status !== 'ONLINE')
    const dependencyFaults: string[] = []

    for (const component of ROBOT_COMPONENTS) {
      for (const dependencyId of component.dependencies) {
        const dependency = ROBOT_COMPONENTS.find((item) => item.id === dependencyId)
        if (dependency && (dependency.status === 'OFFLINE' || dependency.status === 'CRITICAL')) {
          dependencyFaults.push(`${component.id} -> ${dependency.id} [${dependency.status}]`)
        }
      }
    }

    const lines = [
      ru ? 'ОТЧЁТ ДИАГНОСТИКИ' : 'DIAGNOSTIC REPORT',
      '-----------------------------------------------',
      ru
        ? `Компонентов с отклонениями: ${issueComponents.length}`
        : `Components with faults or degradation: ${issueComponents.length}`,
      ...issueComponents.map((item) => `${item.status.padEnd(8)} ${item.id}  ${item.name}`),
      '',
      ru ? 'НАРУШЕННЫЕ ЗАВИСИМОСТИ:' : 'BROKEN DEPENDENCIES:',
      ...(dependencyFaults.length > 0
        ? dependencyFaults
        : [ru ? 'Не обнаружены.' : 'None detected.']),
      '',
      ru
        ? 'Примечание: отчёт использует состояния текущего реестра компонентов.'
        : 'Note: this report uses the current component registry states.',
      '',
    ]
    this.appendLines(lines)
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

        '02. components ВЫВОДИТ РЕЕСТР КОМПОНЕНТОВ.',

        '03. info CPU-730 ПОКАЗЫВАЕТ СПРАВКУ О КОМПОНЕНТЕ.',

        '04. status ПОКАЗЫВАЕТ СВОДКУ СОСТОЯНИЯ РОБОТА.',

        '05. diagnostics ПРОВЕРЯЕТ НЕИСПРАВНОСТИ И ЗАВИСИМОСТИ.',

        '06. ui ОТКРЫВАЕТ ПАНЕЛЬ ОБСЛУЖИВАНИЯ.',

        '07. help, manual, clear И reboot — СПРАВОЧНИК И УПРАВЛЕНИЕ СЕАНСОМ.',

        '08. TAB ДОПОЛНЯЕТ КОМАНДЫ; ПОВТОРНЫЙ TAB ПЕРЕКЛЮЧАЕТ ВАРИАНТЫ.',

        '09. СТРЕЛКИ ВВЕРХ/ВНИЗ ПЕРЕКЛЮЧАЮТ ИСТОРИЮ КОМАНД.',

        '10. НЕ ОБХОДИТЕ ЗАЩИТУ ПРИ НЕИСПРАВНОСТЯХ.',

        '----------------------------------------------------',

      ].join('\n')

    }



    return [

      'OPERATOR MANUAL / MANUAL RECOVERY PROTOCOL',

      '------------------------------------------',

      '01. DO NOT DISCONNECT POWER DURING DIAGNOSTICS.',

      '02. components LISTS REGISTERED COMPONENTS.',

      '03. info CPU-730 SHOWS COMPONENT INFORMATION.',

      '04. status SHOWS THE ROBOT STATUS SUMMARY.',

      '05. diagnostics CHECKS FAULTS AND DEPENDENCIES.',

      '06. ui OPENS THE MAINTENANCE TOOLBAR.',

      '07. help, manual, clear AND reboot PROVIDE HELP AND SESSION CONTROLS.',

      '08. TAB COMPLETES COMMANDS; PRESS TAB AGAIN TO CYCLE MATCHES.',

      '09. UP/DOWN ARROWS BROWSE COMMAND HISTORY.',

      '10. DO NOT BYPASS SAFETY CONTROLS.',

      '------------------------------------------',

    ].join('\n')

  }



  private getManualPromptLabel(): string {

    return this.language === 'ru' ? 'ПОСМОТРЕТЬ МАНУАЛ? ВВЕДИТЕ Y И ENTER: ' : 'VIEW MANUAL? TYPE Y AND PRESS ENTER: '

  }



  private getTerminalPrompt(): string {

    return this.language === 'ru' ? 'ОПЕРАТОР@РОБОТ:\~$ ' : 'OPERATOR\@ROBOT:\~$ '

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
