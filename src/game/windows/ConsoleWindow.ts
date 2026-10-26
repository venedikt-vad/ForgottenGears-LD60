import type { Input } from '../Input'

import { FONT_FAMILY } from '../fonts'

import type { GameLanguage, GameWindow } from './GameWindow'

import type { WindowManager } from './WindowManager'
import { VirtualFileSystem, VFS_LIMITS, formatBytes, type VirtualFileErrorCode } from '../VirtualFileSystem'
import type { CodeEditorWindow } from './CodeEditorWindow'
import type { RobotSystem, RuntimeStatus } from '../Game'
import type { RobotData } from '../RobotData'
import { compileProgram, isRunnable, formatDiagnostics } from '../rasm'
import type { RasmWindow } from './RasmWindow'
import { STARTUP_PROGRAM_PATH, startupCheck } from '../runtime/constants'


/** Commands whose argument is a filesystem path, used for Tab completion. */
const PATH_COMMANDS = new Set(['vim', 'ls', 'cat', 'touch', 'rm', 'mv', 'cd', 'mkdir', 'rmdir', 'run'])

/** Commands whose path argument is a directory, so completion offers folders only. */
const DIRECTORY_ONLY_COMMANDS = new Set(['cd', 'mkdir', 'rmdir'])


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
    id: 'CAM-410', name: 'Primary Camera Array', category: 'SENSORS', status: 'OFFLINE',
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
  {
    id: 'RCTR-110', name: 'Reactor Control Unit', category: 'POWER', status: 'DEGRADED',
    description: { ru: 'Контроллер запуска основного источника питания.', en: 'Startup controller for the primary power core.' },
    function: { ru: 'Выполняет безопасную последовательность запуска и подтверждает стабильность выхода PWR-100.', en: 'Runs the safe startup sequence and verifies PWR-100 output stability.' },
    dependencies: ['PWR-100', 'PDU-230'], affects: ['BUS-T-240', 'PDU-230'],
    symptoms: { ru: 'Источник питания доступен, но последовательность запуска не завершена.', en: 'The power source is available, but startup has not completed.' },
    recommendation: { ru: 'Прочитайте /etc/power/reactor-sequence.txt и откройте редактор RCTR-110.', en: 'Read /etc/power/reactor-sequence.txt and open the RCTR-110 editor.' },
  },
  {
    id: 'BUS-T-240', name: 'Torso Power Bus', category: 'POWER', status: 'OFFLINE',
    description: { ru: 'Основная силовая шина центрального корпуса.', en: 'Main power bus for the robot torso.' },
    function: { ru: 'Передаёт питание от PDU-230 к корпусным подсистемам и приводным шинам.', en: 'Routes PDU-230 power to torso subsystems and actuator buses.' },
    dependencies: ['PDU-230', 'RCTR-110'], affects: ['ACT-610', 'ANL-450', 'SRV-620'],
    symptoms: { ru: 'Контроллеры могут отвечать по вспомогательному питанию, но корпусные каналы остаются недоступны.', en: 'Controllers may respond on auxiliary power while body channels remain unavailable.' },
    recommendation: { ru: 'Проверьте карту линий питания и активируйте BODY_MAIN после запуска реактора.', en: 'Inspect the power-rail map and enable BODY_MAIN after reactor startup.' },
  },
  {
    id: 'ANL-450', name: 'Chemical & Atmospheric Analyzer', category: 'SENSORS', status: 'OFFLINE',
    description: { ru: 'Анализатор химического состава и параметров атмосферы.', en: 'Analyzer for chemical composition and atmospheric conditions.' },
    function: { ru: 'Считывает данные измерительных каналов A и B.', en: 'Reads data from measurement channels A and B.' },
    dependencies: ['PDU-230', 'BUS-T-240'], affects: ['DGN-900'],
    symptoms: { ru: 'Интерфейс анализатора недоступен либо один из каналов не проходит самотест.', en: 'The analyzer UI is unavailable or one of its channels fails self-test.' },
    recommendation: { ru: 'Для доступа к панели включите вспомогательное питание командой power ANL-450 on, затем изучите channel-map.cfg.', en: 'Enable its auxiliary controller rail with power ANL-450 on, then inspect channel-map.cfg.' },
  },
  {
    id: 'ARM-R-660', name: 'Right Arm Assembly', category: 'BODY', status: 'OFFLINE',
    description: { ru: 'Правая рука робота как единый аппаратный узел.', en: 'The robot right arm as a hardware assembly.' },
    function: { ru: 'Обеспечивает движение правой руки через шину приводов.', en: 'Provides right-arm motion through the actuator bus.' },
    dependencies: ['BUS-T-240', 'ACT-610', 'SRV-620'], affects: ['LOC-630'],
    symptoms: { ru: 'После подачи питания узел не обнаруживается в аппаратной карте.', en: 'The assembly remains undetected after power is restored.' },
    recommendation: { ru: 'Проверьте /sys/body/assembly-map.cfg: это может быть отсутствие аппаратного модуля, а не сбой питания.', en: 'Check /sys/body/assembly-map.cfg; this may be missing hardware rather than a power fault.' },
  },
  {
    id: 'LEG-L-670', name: 'Left Lower Leg Assembly', category: 'BODY', status: 'OFFLINE',
    description: { ru: 'Нижний сегмент левой ноги ниже коленного сустава.', en: 'The lower segment of the left leg below the knee joint.' },
    function: { ru: 'Передаёт усилие от коленного узла к стопе и датчикам опоры.', en: 'Transfers force from the knee joint to the foot and contact sensors.' },
    dependencies: ['BUS-T-240', 'ACT-610', 'SRV-620', 'FRC-440'], affects: ['BAL-640', 'LOC-630'],
    symptoms: { ru: 'Неполная кинематическая цепь левой ноги и потеря опоры.', en: 'Incomplete left-leg kinematic chain and loss of support.' },
    recommendation: { ru: 'Сверьте физическую сборку с /sys/body/assembly-map.cfg.', en: 'Compare the physical assembly against /sys/body/assembly-map.cfg.' },
  },
  {
    id: 'MCM-740', name: 'Motion Command Memory', category: 'COMPUTE', status: 'CRITICAL',
    description: { ru: 'Хранилище профиля и таблиц команд движения.', en: 'Storage for motion profiles and command tables.' },
    function: { ru: 'Проверяет целостность профиля до передачи команд контроллеру движения.', en: 'Validates the command profile before passing commands to motion control.' },
    dependencies: ['MEM-732', 'OSK-710'], affects: ['LOC-630', 'ACT-610'],
    symptoms: { ru: 'Команда принимается консолью, но диспетчер движения отклоняет её до отправки на приводы.', en: 'The console accepts a command, but motion dispatch rejects it before it reaches the actuators.' },
    recommendation: { ru: 'Прочитайте /sys/memory/motion-command-store.txt и /usr/share/docs/motion-control.txt.', en: 'Read /sys/memory/motion-command-store.txt and /usr/share/docs/motion-control.txt.' },
  },
]



/** Persistent BIOS/CRT console with a full, scrollable transcript. */

export class ConsoleWindow implements GameWindow {

  readonly id = 'console'



  private manager: WindowManager | null = null
  private readonly fileSystem: VirtualFileSystem
  private readonly codeEditor: Pick<CodeEditorWindow, 'openFile'> | null
  private readonly robotSystem: RobotSystem | null
  /** Read-model in front of the runtime; the shell's only door to the kernel. */
  private readonly robotData: RobotData | null

  private language: GameLanguage = 'ru'

  private stage: ConsoleStage = 'boot'



  // Keep the entire transcript for the lifetime of this window. It is never capped.

  private transcript = ''

  private bootText = ''
  private bootQueued = false
  private manualText = ''
  private manualQueued = false

  // All console output is queued and streamed into the visible transcript.
  // BIOS/manual output is faster; command results use a slower readable rate.
  private pendingOutput = ''
  private outputCharAccumulator = 0

  private blinkClock = 0
  private readonly charsPerSecond = 7200
  private readonly terminalCharsPerSecond = 1350

  private command = ''

  /** Cursor position inside `command`; arrows move it so edits can target mid-line. */
  private commandCursor = 0

  /** Shell working directory for relative paths; cd changes it, the prompt shows it. */
  private cwd = '/'

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

  /**
   * The startup program the shell is waiting for. The program runs as a real
   * process, so its verdict arrives a few frames later — the game loop calls
   * `pollRuntime()` every frame, even while another window is open.
   */
  private startupWatch: { pid: number } | null = null



  constructor(
    fileSystem: VirtualFileSystem = new VirtualFileSystem(),
    codeEditor: Pick<CodeEditorWindow, 'openFile'> | null = null,
    robotSystem: RobotSystem | null = null,
    robotData: RobotData | null = null,
  ) {
    this.fileSystem = fileSystem
    this.codeEditor = codeEditor
    this.robotSystem = robotSystem
    this.robotData = robotData
    this.setLanguage('ru')
  }



  setLanguage(language: GameLanguage): void {

    this.language = language

    this.manualText = this.getManualText()

    this.transcript = ''
    this.pendingOutput = ''
    this.outputCharAccumulator = 0
    this.bootQueued = false
    this.manualQueued = false

    this.command = ''
    this.commandCursor = 0

    this.cwd = '/'

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
      case 'boot':
        if (!this.bootQueued) {
          this.appendTranscript(this.bootText)
          this.bootQueued = true
        }
        break

      case 'manual-prompt':
        this.handleManualPromptInput(input)
        break

      case 'manual-stream':
        if (!this.manualQueued) {
          this.appendTranscript(`${this.manualText}\n`)
          this.manualQueued = true
        }
        break

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

    this.flushPendingOutput(dt)

    // Advance boot/manual stages only after all queued output has reached the
    // transcript, so the prompt never appears before the text finishes printing.
    if (this.stage === 'boot' && this.bootQueued && this.pendingOutput.length === 0) {
      this.stage = 'manual-prompt'
      this.followTail = true
    } else if (this.stage === 'manual-stream' && this.manualQueued && this.pendingOutput.length === 0) {
      this.stage = 'manual-wait'
      this.followTail = true
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
        ? 'ROM v1.08 | ТЕРМИНАЛ ВОССТАНОВЛЕНИЯ'
        : 'ROM v1.08 | RECOVERY TERMINAL',
      margin,
      margin + lineHeight + 1,
      textWidth,
    )



    const ruleY = margin + lineHeight * 2 + 5

    // Storage quota readout: the file count and size limits stay visible in the
    // console header so the operator always knows how full the archive is.
    if (width >= 720) {
      const usage = this.fileSystem.getStorageUsage()
      const ru = this.language === 'ru'
      const nearLimit = usage.fileRatio >= 0.9 || usage.byteRatio >= 0.9
      const watchLimit = usage.fileRatio >= 0.7 || usage.byteRatio >= 0.7
      ctx.textAlign = 'right'
      ctx.fillStyle = nearLimit ? '#ff7782' : watchLimit ? '#ffd166' : '#659e5c'
      ctx.fillText(
        `${ru ? 'ФАЙЛОВ' : 'FILES'}: ${usage.fileCount} / ${usage.maxFiles}`,
        width - margin,
        margin - 1,
      )
      ctx.fillText(
        ru
          ? `ОБЪЁМ: ${formatBytes(usage.usedBytes, 'ru')} / ${formatBytes(usage.maxBytes, 'ru')}`
          : `SIZE: ${formatBytes(usage.usedBytes, 'en')} / ${formatBytes(usage.maxBytes, 'en')}`,
        width - margin,
        margin + lineHeight + 1,
      )
      const meterWidth = Math.min(180, Math.floor(width * 0.22))
      const meterY = ruleY - 4
      const meterX = width - margin - meterWidth
      ctx.fillStyle = 'rgba(53, 96, 62, 0.85)'
      ctx.fillRect(meterX, meterY, meterWidth, 3)
      ctx.fillStyle = nearLimit ? '#ff7782' : watchLimit ? '#ffd166' : '#71f79f'
      ctx.fillRect(meterX, meterY, Math.max(1, meterWidth * Math.max(usage.fileRatio, usage.byteRatio)), 3)
      ctx.textAlign = 'left'
    }

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

    ctx.font = normalFont

    ctx.fillStyle = '#c8f3b5'

    ctx.shadowColor = 'rgba(114, 255, 98, 0.2)'

    ctx.shadowBlur = 1

    const inputText = this.getBottomInput()

    // In the terminal the cursor can sit mid-line; the Y/N and streaming
    // prompts have no movable cursor and keep it at the end.
    const cursorIndex = this.stage === 'terminal'
      ? Math.min(this.commandCursor, inputText.length)
      : inputText.length

    ctx.fillText(`${this.getBottomPrompt()}${inputText}`, margin, promptY)

    // The underscore blinks over the character under the cursor (or just past
    // the last one), so the typed text never shifts while editing.
    if (Math.floor(this.blinkClock * 2) % 2 === 0) {
      const prefixWidth = ctx.measureText(
        `${this.getBottomPrompt()}${inputText.slice(0, cursorIndex)}`,
      ).width
      ctx.fillText('_', margin + prefixWidth, promptY)
    }

    ctx.shadowBlur = 0



    // Put navigation hints beside the recovery-mode indicator under the console.
    ctx.font = smallFont
    ctx.fillStyle = '#659e5c'
    const footerY = height - margin - lineHeight
    const footerStatus = this.language === 'ru'
      ? (this.robotSystem?.motionStartupComplete
          ? 'ПИТАНИЕ: ВКЛ  |  РЕЖИМ: РАБОЧИЙ'
          : 'ПИТАНИЕ: ВКЛ  |  РЕЖИМ: ВОССТАНОВЛЕНИЕ')
      : (this.robotSystem?.motionStartupComplete
          ? 'POWER: ON  |  MODE: OPERATIONAL'
          : 'POWER: ON  |  MODE: RECOVERY')
    const footerHints = this.language === 'ru'
      ? '←/→: КУРСОР  ↑/↓: ИСТОРИЯ  TAB: АВТОДОП.'
      : '←/→: CURSOR  ↑/↓: HISTORY  TAB: AUTOCOMP.'

    ctx.textAlign = 'left'
    ctx.fillText(footerStatus, margin, footerY, width * 0.59)
    ctx.textAlign = 'right'
    ctx.fillText(footerHints, width - margin, footerY, width * 0.38)


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
          this.manualQueued = false
          this.followTail = true

        } else if (answer === 'N') {

          this.openTerminal()

        } else {

          this.appendTranscript(this.language === 'ru'

            ? 'ОШИБКА ВВОДА: ДОПУСТИМЫЕ ЗНАЧЕНИЯ — Y ИЛИ N.\n'

            : 'INPUT ERROR: VALID VALUES ARE Y OR N.\n')

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
        this.commandCursor = 0
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
        this.commandCursor = this.command.length
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
        this.commandCursor = this.command.length
        this.clearCompletionState()
        continue
      }

      // Mid-line editing: the cursor slides over the typed text instead of
      // always sitting at the end, so mistakes can be fixed in place.
      if (key === 'ArrowLeft') {
        this.commandCursor = Math.max(0, this.commandCursor - 1)
        continue
      }

      if (key === 'ArrowRight') {
        this.commandCursor = Math.min(this.command.length, this.commandCursor + 1)
        continue
      }

      if (key === 'Home') {
        this.commandCursor = 0
        continue
      }

      if (key === 'End') {
        this.commandCursor = this.command.length
        continue
      }

      if (key === 'Tab') {
        this.completeCommandInput()
        continue
      }

      if (key === 'Backspace') {
        if (this.commandCursor > 0) {
          this.command =
            this.command.slice(0, this.commandCursor - 1) + this.command.slice(this.commandCursor)
          this.commandCursor -= 1
        }
        this.browsingCommandHistory = false
        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
        this.clearCompletionState()
        continue
      }

      // Delete removes the character under the cursor; without it Backspace
      // alone could not fix a character typed past the cursor.
      if (key === 'Delete') {
        if (this.commandCursor < this.command.length) {
          this.command =
            this.command.slice(0, this.commandCursor) + this.command.slice(this.commandCursor + 1)
        }
        this.browsingCommandHistory = false
        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
        this.clearCompletionState()
        continue
      }

      if (key === 'Escape') continue

      if (key.length === 1 && this.command.length < 128) {
        this.command =
          this.command.slice(0, this.commandCursor) + key + this.command.slice(this.commandCursor)
        this.commandCursor += 1
        this.browsingCommandHistory = false
        this.commandHistoryIndex = this.commandHistory.length
        this.commandDraft = ''
        this.clearCompletionState()
      }
    }
  }

  /** Autocomplete the supported commands and paths passed to `vim`. */
  private completeCommandInput(): void {
    // Keep cycling only while the player has not edited the completed value.
    if (
      this.completionCandidates.length > 1 &&
      this.lastCompletedValue !== null &&
      this.command === this.lastCompletedValue
    ) {
      this.completionIndex = (this.completionIndex + 1) % this.completionCandidates.length
      this.command = this.completionCandidates[this.completionIndex]
      this.commandCursor = this.command.length
      this.lastCompletedValue = this.command
      return
    }

    this.clearCompletionState()
    const candidates = this.getCompletionCandidates(this.command)
    if (candidates.length === 0) return

    this.command = candidates[0]
    this.commandCursor = this.command.length

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

    if (!commandMatch) return this.getCommandNames()

    const enteredCommand = commandMatch[1]
    const rest = commandMatch[2] ?? ''
    const normalizedCommand = enteredCommand.toLowerCase()

    // `mv` completes each of its two path arguments; the other path commands
    // use the whole argument. `find` takes a search term and `df` takes no arguments.
    if (normalizedCommand === 'mv' && rest.trim().length > 0) {
      const endsWithSpace = /\s$/.test(rest)
      const tokens = rest.trim().split(/\s+/).filter(Boolean)
      const prefix = endsWithSpace ? '' : (tokens.pop() ?? '')
      const candidates = this.completePath(prefix)
      return candidates.map((path) => [enteredCommand, ...tokens, path].join(' '))
    }

    if (PATH_COMMANDS.has(normalizedCommand)) {
      const argumentText = rest.trim()
      // Complete once an argument (or at least the separating space) is typed.
      if (argumentText.length > 0 || /\s$/.test(rest)) {
        const prefix = /\s$/.test(rest) ? '' : argumentText
        const candidates = this.completePath(prefix, DIRECTORY_ONLY_COMMANDS.has(normalizedCommand))
        return candidates.map((path) => `${enteredCommand} ${path}`)
      }
    }

    // `rasm` takes an optional `check` subcommand followed by a path:
    // `rasm check /var/busy.rasm` or `rasm /var/busy.rasm`.
    if (normalizedCommand === 'rasm') return this.completeRasmArguments(enteredCommand, rest)

    if (rest.trim().length > 0) return []

    const prefix = enteredCommand.toLowerCase()
    // Preserve leading whitespace only; the command itself may be followed by
    // a trailing space, which must not leak into the replacement.
    const leadingWhitespace = /^\s*/.exec(rawInput)?.[0] ?? ''
    return this.getCommandNames()
      .filter((name) => name.startsWith(prefix))
      .map((name) => `${leadingWhitespace}${name}`)
  }

  /** Autocomplete `rasm [check] <path>`: the subcommand first, then a VFS path. */
  private completeRasmArguments(command: string, rest: string): string[] {
    const endsWithSpace = /\s$/.test(rest)
    const tokens = rest.trim().split(/\s+/).filter(Boolean)

    // No subcommand yet: offer `check` (the common way to assemble a file).
    if (tokens.length === 0) return endsWithSpace ? [`${command} check `] : []

    const first = (tokens[0] ?? '').toLowerCase()

    // Still typing the first token: it can be the subcommand or a path.
    if (tokens.length === 1 && !endsWithSpace) {
      const prefix = tokens[0] ?? ''
      const candidates: string[] = []
      if ('check'.startsWith(prefix.toLowerCase())) candidates.push(`${command} check `)
      if (prefix.toLowerCase() !== 'check') {
        candidates.push(...this.completePath(prefix).map((path) => `${command} ${path}`))
      }
      return candidates
    }

    // A path follows `check` (or follows `rasm` directly).
    const afterCheck = first === 'check' ? tokens.slice(1) : tokens
    const prefix = endsWithSpace ? '' : (afterCheck.pop() ?? '')
    return this.completePath(prefix).map((path) =>
      [command, ...(first === 'check' ? ['check'] : []), ...afterCheck, path].join(' '),
    )
  }

  /** Complete a typed path prefix relative to the working directory, keeping the typed form relative. */
  private completePath(rawPrefix: string, directoriesOnly = false): string[] {
    const typed = rawPrefix.trim()
    // An empty prefix (or one ending in `/`) lists the directory itself;
    // resolvePath strips the trailing slash, so it is restored here.
    const listContents = typed === '' || typed.endsWith('/')
    const resolved = this.fileSystem.resolvePath(this.cwd, typed || '.')
    const absolutePrefix = listContents && resolved !== '/' ? `${resolved}/` : resolved
    const candidates = this.fileSystem
      .getPathCandidates(absolutePrefix, true)
      .filter((path) => !directoriesOnly || this.fileSystem.isDirectory(path))

    // A relative input keeps completing to relative paths; absolute stays absolute.
    if (typed.startsWith('/') || !candidates.length) return candidates
    const base = this.cwd === '/' ? '/' : `${this.cwd}/`
    return candidates.map((path) => (path.startsWith(base) ? path.slice(base.length) : path))
  }

  private getCommandNames(): string[] {
    // File/directory commands plus the window/system commands of this console.
    return [
      'help', 'components', 'ui', 'status', 'vim', 'manual', 'clear', 'start',
      'ls', 'cd', 'pwd', 'cat', 'touch', 'rm', 'mv', 'mkdir', 'rmdir', 'find', 'df', 'tasks',
      'ps', 'run', 'kill', 'pause', 'resume', 'rasm',
    ]
  }

  private clearCompletionState(): void {
    this.completionCandidates = []
    this.completionIndex = -1
    this.lastCompletedValue = null
  }

  private executeCommand(rawCommand: string): void {
    const parts = rawCommand.trim().split(/\s+/)
    const command = (parts.shift() ?? '').toLowerCase()
    const rawArgument = parts.join(' ').trim()
    const path = rawArgument || '/opt/firmware/motion/оптимизатор_акселерации_1.0.18.drv'
    switch (command) {
      case 'help':
        this.appendLines(this.language === 'ru'
          ? [
              'ДОСТУПНЫЕ КОМАНДЫ:',
              '  help       — список команд',
              '  components — текущее состояние компонентов',
              '  ui         — открыть панель обслуживания',
              '  tasks      — открыть диспетчер задач и производительности',
              '  status     — сводка состояния робота',
              '  manual     — инструкция оператора',
              '  rasm       — открыть отладчик RASM',
              '  clear      — полностью очистить экран консоли',
              '  start      — запустить программу проверки аппаратуры; при отказе выводится код отказа.',
              '',
              'ПРОЦЕССЫ:',
              '  ps               — таблица процессов робота',
              '  run <путь>       — запустить .rasm-программу в фоне',
              '  kill <PID>       — завершить процесс',
              '  pause <PID>      — приостановить процесс',
              '  resume <PID>     — продолжить процесс',
              '',
              'ФАЙЛЫ:',
              '  ls [путь]      — содержимое каталога',
              '  cd <путь>      — перейти в каталог (как в cmd); cd .. — вверх, cd — текущий путь',
              '  pwd            — показать текущий каталог',
              '  cat <путь>     — прочитать файл',
              '  touch <путь>   — создать новый файл',
              '  mkdir <путь>   — создать каталог',
              '  rmdir <путь>   — удалить пустой созданный вами каталог',
              '  rm <путь>      — удалить созданный вами файл',
              '  mv <а> <б>     — переименовать созданный файл',
              '  find <слово>   — поиск по путям и содержимому',
              '  df             — лимиты и заполнение файлового хранилища',
              '  vim [путь]     — открыть редактор',
              '  rasm check <п> — собрать .rasm и вывести диагностику',
              '  Справочник RASM: /usr/share/docs/rasm.txt (cat или vim).',
              '  cat /usr/share/docs/rasm.txt — справочник по языку RASM 1.0.',
              '',
              'ПУТИ: команды файлов работают с текущего каталога; абсолютные начинаются с /.',
              'УПРАВЛЕНИЕ: ↑/↓ — история команд; ←/→, Home/End — курсор в строке;',
              'Backspace/Delete — правка; TAB — автодополнение.',
              '',
            ]
          : [
              'AVAILABLE COMMANDS:',
              '  help       — list commands',
              '  components — live component status',
              '  ui         — open maintenance UI',
              '  tasks      — open the task manager and performance screen',
              '  status     — robot status summary',
              '  manual     — operator manual',
              '  rasm       — open the RASM debugger',
              '  clear      — clear the console screen completely',
              '  start      — run the hardware self-test program; a failed check reports its code.',
              '',
              'PROCESSES:',
              '  ps               — process table of the robot',
              '  run <path>       — start a .rasm program in the background',
              '  kill <PID>       — terminate a process',
              '  pause <PID>      — suspend a process',
              '  resume <PID>     — continue a process',
              '',
              'FILES:',
              '  ls [path]    — list a directory',
              '  cd <path>    — change directory (like cmd); cd .. — up, cd — print the current path',
              '  pwd          — print the current directory',
              '  cat <path>   — read a file',
              '  touch <path> — create a new file',
              '  mkdir <path> — create a directory',
              '  rmdir <path> — remove an empty directory you created',
              '  rm <path>    — delete a file you created',
              '  mv <a> <b>   — rename a file you created',
              '  find <term>  — search paths and contents',
              '  df           — storage quotas and fill levels',
              '  vim [path]   — open the editor',
              '  rasm check <p> — assemble a .rasm file and print diagnostics',
              '  RASM reference: /usr/share/docs/rasm.txt (cat or vim).',
              '  cat /usr/share/docs/rasm.txt — RASM 1.0 language reference.',
              '',
              'PATHS: file commands resolve from the current directory; absolute paths start with /.',
              'CONTROLS: ↑/↓ — command history; ←/→, Home/End — cursor in the line;',
              'Backspace/Delete — editing; TAB — autocomplete.',
              '',
            ])
        return

      case 'components':
        this.printComponentList()
        return

      case 'ui':
        this.appendTranscript(this.language === 'ru'
          ? 'ЗАПУСК ПАНЕЛИ ОБСЛУЖИВАНИЯ...\n'
          : 'STARTING MAINTENANCE UI...\n')
        this.manager?.show('ui')
        return

      case 'rasm': {
        this.runRasmCommand(rawArgument)
        return
      }

      case 'status':
        this.printRobotStatus()
        return

      case 'vim': {
        if (!this.codeEditor) {
          this.appendLines(this.language === 'ru'
            ? ['РЕДАКТОР НЕ ПОДКЛЮЧЁН.', 'Передайте CodeEditorWindow в конструктор ConsoleWindow.', '']
            : ['EDITOR IS NOT CONNECTED.', 'Pass CodeEditorWindow to the ConsoleWindow constructor.', ''])
          return
        }
        const editorPath = rawArgument ? this.fileSystem.resolvePath(this.cwd, rawArgument) : path
        if (this.codeEditor.openFile(editorPath, false)) {
          this.appendLines(this.language === 'ru'
            ? [`ОТКРЫТИЕ РЕДАКТОРА: ${editorPath}`, 'NORMAL: i — ввод; Esc — команды Vim; выход — :q или :wq.', '']
            : [`OPENING EDITOR: ${editorPath}`, 'NORMAL: i — insert; Esc — Vim commands; exit with :q or :wq.', ''])
          this.manager?.show('editor')
        } else if (!this.fileSystem.exists(editorPath)) {
          this.appendLines(this.language === 'ru'
            ? [
                `ФАЙЛ НЕ СУЩЕСТВУЕТ: ${editorPath}`,
                `СОЗДАЙТЕ ЕГО КОМАНДОЙ: touch ${editorPath}`,
                'ЗАТЕМ ОТКРОЙТЕ: vim ' + editorPath,
                '',
              ]
            : [
                `FILE DOES NOT EXIST: ${editorPath}`,
                `CREATE IT WITH: touch ${editorPath}`,
                'THEN OPEN: vim ' + editorPath,
                '',
              ])
        } else {
          this.appendLines(this.language === 'ru'
            ? [`НЕ УДАЛОСЬ ОТКРЫТЬ ФАЙЛ: ${editorPath}`, 'Проверьте имя файла и попробуйте снова.', '']
            : [`COULD NOT OPEN FILE: ${editorPath}`, 'Check the file name and try again.', ''])
        }
        return
      }

      case 'ls':
        this.printDirectory(rawArgument ? this.fileSystem.resolvePath(this.cwd, rawArgument) : this.cwd)
        return

      case 'cat':
        this.printFile(this.resolveArgument(rawArgument))
        return

      case 'touch':
        this.createFile(this.resolveArgument(rawArgument))
        return

      case 'rm':
        this.removeFile(this.resolveArgument(rawArgument))
        return

      case 'mv':
        this.renameFile(rawArgument)
        return

      case 'cd':
        this.changeDirectory(rawArgument)
        return

      case 'pwd':
        this.appendLines([this.cwd, ''])
        return

      case 'mkdir':
        this.createDirectory(this.resolveArgument(rawArgument))
        return

      case 'rmdir':
        this.removeDirectory(this.resolveArgument(rawArgument))
        return

      case 'find':
        this.findInFiles(rawArgument)
        return

      case 'df':
        this.printStorage()
        return

      case 'tasks':
        this.appendTranscript(this.language === 'ru'
          ? 'ОТКРЫТИЕ ДИСПЕТЧЕРА ЗАДАЧ...\n'
          : 'OPENING TASK MANAGER...\n')
        this.manager?.show('tasks')
        return

      case 'ps':
        this.printProcessTable()
        return

      case 'run':
        this.runProgramFile(rawArgument)
        return

      case 'kill':
        this.controlProgram('kill', rawArgument)
        return

      case 'pause':
        this.controlProgram('pause', rawArgument)
        return

      case 'resume':
        this.controlProgram('resume', rawArgument)
        return

      case 'manual':
        this.appendTranscript(`${this.manualText}\n\n`)
        return

      case 'clear':
        // Remove both the visible transcript and queued output, including the
        // just-echoed `clear` command. No confirmation text is printed.
        this.transcript = ''
        this.pendingOutput = ''
        this.outputCharAccumulator = 0
        this.scrollTopLine = 0
        this.lastMaxScrollTop = 0
        this.followTail = true
        return

      // The launch command is intentionally not part of `help`, whose list is
      // restricted to the seven operator commands requested for this console.
      case 'start':
        this.tryStartRobot()
        return

      default:
        this.appendTranscript(this.language === 'ru'
          ? `НЕИЗВЕСТНАЯ КОМАНДА: ${rawCommand}. ВВЕДИТЕ help.\n\n`
          : `UNKNOWN COMMAND: ${rawCommand}. TYPE help.\n\n`)
    }
  }

  /** The UI window's recovery checklist; falls back to the shared state flags. */
  private recoveryChecklist(): { label: string; done: boolean }[] {
    try {
      const ui = this.manager?.get('ui') as unknown as { getChecklist?: (manager?: WindowManager | null) => { label: string; done: boolean }[] }
      const tasks = ui?.getChecklist?.(this.manager)
      if (tasks && tasks.length > 0) return tasks
    } catch {
      // UI window not registered; fall through to the shared state flags.
    }

    const system = this.robotSystem
    const ru = this.language === 'ru'
    const labels = ru
      ? [
          'Починить реактор',
          'Подать питание на компоненты движения',
          'Восстановить обход шины',
          'Починить память',
          'Починить алгоритм',
        ]
      : [
          'Repair the reactor',
          'Power motion components',
          'Restore the bus bypass',
          'Repair memory',
          'Repair the algorithm',
        ]
    const done = [
      system?.reactorRestored ?? false,
      system?.powerGridPuzzleSolved ?? false,
      system?.busBypassRestored ?? false,
      system?.memoryCoreRestored ?? false,
      system?.motionProfileRestored ?? false,
    ]
    return labels.map((label, index) => ({ label, done: done[index] ?? false }))
  }

  /**
   * The `start` command.
   *
   * The robot does not trust the console: the command launches the shipped
   * startup program as a real process, and the program itself reads the
   * hardware ports. The checklist below is only the operator-facing summary of
   * what is still missing; the machine has the final word.
   */
  private tryStartRobot(): void {
    const ru = this.language === 'ru'
    const system = this.robotSystem
    const data = this.robotData
    if (!system || !data) {
      this.appendLines(ru
        ? [
            'ОТКАЗ ЗАПУСКА: СИСТЕМНОЕ СОСТОЯНИЕ НЕ ПОДКЛЮЧЕНО К КОНСОЛИ.',
            'Передайте shared RobotSystem и RobotData в конструктор ConsoleWindow.',
            '',
          ]
        : [
            'START REFUSED: ROBOT SYSTEM STATE IS NOT CONNECTED TO THE CONSOLE.',
            'Pass the shared RobotSystem and RobotData to the ConsoleWindow constructor.',
            '',
          ])
      return
    }

    // The gate is the same recovery checklist the UI window renders, so both
    // screens can never disagree about what is left to do.
    const checklist = this.recoveryChecklist()
    const taskComponentIds = ['PWR-100', 'BUS-T-240', 'ACT-610', 'MEM-732', 'MCM-740']

    const blockers: string[] = []
    checklist.forEach((task, index) => {
      if (task.done) return
      const componentId = taskComponentIds[index]
      // Hint rows without a matching component (the final "type start" line) never block.
      if (!componentId) return
      const component = system.getComponent(componentId)
      blockers.push(`- ${task.label.toUpperCase()}${component ? ` [${component.id}]` : ''}`)
      if (component?.fault) blockers.push(`    ${ru ? 'ТЕКУЩАЯ ОШИБКА' : 'CURRENT FAULT'}: ${component.fault}`)
      if (component?.recommendation) blockers.push(`    ${ru ? 'ДЕЙСТВИЕ' : 'ACTION'}: ${component.recommendation}`)
    })

    if (blockers.length > 0) {
      this.appendLines([
        ru ? 'ЗАПУСК ОТКЛОНЁН: ЗАДАЧИ ВОССТАНОВЛЕНИЯ НЕ ЗАВЕРШЕНЫ.' : 'START REFUSED: RECOVERY TASKS INCOMPLETE.',
        ru ? 'ТЕКУЩИЕ ПРИЧИНЫ:' : 'CURRENT BLOCKERS:',
        ...blockers,
        '',
        ru ? 'ПРОВЕРКА МАШИНЫ НЕ ЗАПУЩЕНА. Исправьте перечисленные проблемы и повторите start.' : 'THE MACHINE CHECK WAS NOT RUN. Resolve the listed issues and run start again.',
        '',
      ])
      return
    }

    // The startup program is shipped firmware; it must exist on the robot.
    const source = this.fileSystem.read(STARTUP_PROGRAM_PATH, this.language)?.join('\n')
    if (!source) {
      this.appendLines([
        ru ? `ОШИБКА: ПРОГРАММА ЗАПУСКА НЕ НАЙДЕНА: ${STARTUP_PROGRAM_PATH}` : `ERROR: STARTUP PROGRAM NOT FOUND: ${STARTUP_PROGRAM_PATH}`,
        '',
      ])
      return
    }

    // A previous attempt is retired first, so the process table never fills
    // with stale copies of the same firmware.
    for (const program of data.listProgramsByPath(STARTUP_PROGRAM_PATH)) {
      if (program.state === 'RUNNING' || program.state === 'DEGRADED' || program.state === 'WAITING' || program.state === 'SUSPENDED') {
        data.killProcess(program.pid)
      }
    }

    // Latches belong to the run: clear them so the verdict is this run's.
    data.resetLatches()

    const result = data.launchProgram(source, { path: STARTUP_PROGRAM_PATH })
    if (!result) {
      this.appendLines([
        ru ? 'ОТКАЗ ЗАПУСКА: СРЕДА ВЫПОЛНЕНИЯ НЕ ПОДКЛЮЧЕНА.' : 'START REFUSED: THE EXECUTION ENVIRONMENT IS NOT CONNECTED.',
        '',
      ])
      return
    }

    const pid = result.pid
    if (pid === null) {
      this.appendLines([
        ru ? 'ОТКАЗ ЗАПУСКА ПРОГРАММЫ.' : 'STARTUP PROGRAM REFUSED.',
        result.message[this.language],
        '',
      ])
      return
    }

    this.startupWatch = { pid }
    this.appendLines([
      ru ? `ЗАПУСК ПРОГРАММЫ: ${STARTUP_PROGRAM_PATH}` : `PROGRAM STARTED: ${STARTUP_PROGRAM_PATH}`,
      ru ? `PID: ${pid} — ПРОВЕРКА АППАРАТУРЫ ВЫПОЛНЯЕТСЯ...` : `PID: ${pid} — RUNNING THE HARDWARE CHECKS...`,
      '',
    ])
  }

  /**
   * Called once per frame by the game loop.
   *
   * The startup program is a real process, so its verdict arrives later than
   * the command that launched it. This method notices the end of that program
   * and reports it, no matter which window is currently open.
   */
  pollRuntime(): void {
    const watch = this.startupWatch
    if (!watch) return
    const data = this.robotData
    if (!data) {
      this.startupWatch = null
      return
    }
    const program = data.getProgram(watch.pid)
    if (!program) {
      this.startupWatch = null
      return
    }
    if (program.state === 'RUNNING' || program.state === 'DEGRADED' || program.state === 'WAITING' || program.state === 'SUSPENDED') return

    this.startupWatch = null
    this.reportStartupResult(program.pid, program.state, program.error)
  }

  /** Turn the finished startup program into a verdict for the operator. */
  private reportStartupResult(pid: number, state: string, error: string | null): void {
    const ru = this.language === 'ru'
    const data = this.robotData
    const system = this.robotSystem

    if (state === 'FAULT') {
      this.appendLines([
        ru ? `ОТКАЗ: ПРОГРАММА ЗАПУСКА ${pid} ЗАВЕРШИЛАСЬ ОШИБКОЙ.` : `FAILED: STARTUP PROGRAM ${pid} ENDED WITH AN ERROR.`,
        error ?? (ru ? 'Причина неизвестна.' : 'The reason is unknown.'),
        ru ? 'ПРОВЕРЬТЕ СОСТОЯНИЕ КОМПОНЕНТОВ КОМАНДОЙ status.' : 'CHECK THE COMPONENT STATE WITH status.',
        '',
      ])
      return
    }

    const diag = data?.readLatch('DIAG') ?? 0
    const boot = data?.readLatch('BOOT') ?? 0

    if (diag === 0 && boot === 1) {
      if (system?.completeBodyStartup()) {
        // Every check passed: clear the console and show the win screen.
        this.transcript = ''
        this.pendingOutput = ''
        this.outputCharAccumulator = 0
        this.scrollTopLine = 0
        this.lastMaxScrollTop = 0
        this.followTail = true
        this.manager?.show('victory')
        return
      }
      const startupEvent = [...(system?.getEvents() ?? [])].reverse().find((event) => event.source === 'BODY STARTUP')
      this.appendLines([
        ru ? 'ЗАПУСК НЕ СОСТОЯЛСЯ.' : 'STARTUP FAILED.',
        startupEvent?.message ?? (ru ? 'Система отклонила запуск.' : 'The system rejected startup.'),
        '',
      ])
      return
    }

    const check = startupCheck(diag)
    const component = check ? system?.getComponent(check.componentId) : undefined
    this.appendLines([
      ru ? `ОТКАЗ: ПРОВЕРКА ${diag} НЕ ПРОЙДЕНА.` : `FAILED: CHECK ${diag} DID NOT PASS.`,
      ru ? `УЗЕЛ: ${check?.label.ru ?? 'неизвестно'}` : `UNIT: ${check?.label.en ?? 'unknown'}`,
      ...(check ? [`[${check.componentId}]${component ? ` — ${component.status}` : ''}`] : []),
      ...(component?.fault ? [`${ru ? 'ТЕКУЩАЯ ОШИБКА' : 'CURRENT FAULT'}: ${component.fault}`] : []),
      ...(component?.recommendation ? [`${ru ? 'ДЕЙСТВИЕ' : 'ACTION'}: ${component.recommendation}`] : []),
      ru ? 'ПОВТОРИТЕ start ПОСЛЕ УСТРАНЕНИЯ ПРИЧИНЫ.' : 'RUN start AGAIN AFTER FIXING THE CAUSE.',
      '',
    ])
  }

  private mapRuntimeStatus(status: RuntimeStatus): ComponentStatus {
    switch (status) {
      case 'ONLINE': return 'ONLINE'
      case 'DEGRADED': return 'DEGRADED'
      case 'CRITICAL':
      case 'LOCKED': return 'CRITICAL'
      case 'OFFLINE':
      case 'MISSING':
      default: return 'OFFLINE'
    }
  }

  private getComponentRows(): Array<{ id: string; name: string; category: string; status: ComponentStatus }> {
    const live = this.robotSystem?.listComponents()
    if (live && live.length > 0) {
      return live.map((component) => ({
        id: component.id,
        name: component.name,
        category: component.category,
        status: this.mapRuntimeStatus(component.status),
      }))
    }
    return ROBOT_COMPONENTS.map((component) => ({
      id: component.id,
      name: component.name,
      category: component.category,
      status: component.status,
    }))
  }

  private printComponentList(): void {
    const ru = this.language === 'ru'
    const components = this.getComponentRows()
    const lines = [
      ru ? 'РЕЕСТР КОМПОНЕНТОВ РОБОТА' : 'ROBOT COMPONENT REGISTRY',
      '----------------------------------------------------------------',
      `${'ID'.padEnd(12)} ${'COMPONENT'.padEnd(32)} ${'STATUS'.padEnd(10)} CATEGORY`,
      '----------------------------------------------------------------',
    ]

    for (const component of components) {
      lines.push(
        `${component.id.padEnd(12)} ${component.name.padEnd(32).slice(0, 32)} ${component.status.padEnd(10)} ${component.category}`,
      )
    }

    lines.push(
      '----------------------------------------------------------------',
      ru
        ? `${components.length} КОМПОНЕНТОВ В РЕЕСТРЕ.`
        : `${components.length} COMPONENTS IN REGISTRY.`,
      '',
    )
    this.appendLines(lines)
  }

  private printRobotStatus(): void {
    const ru = this.language === 'ru'
    const components = this.getComponentRows()
    const online = components.filter(({ status }) => status === 'ONLINE').length
    const degraded = components.filter(({ status }) => status === 'DEGRADED').length
    const offline = components.filter(({ status }) => status === 'OFFLINE').length
    const critical = components.filter(({ status }) => status === 'CRITICAL').length
    const faulty = components.filter(({ status }) => status !== 'ONLINE')

    this.appendLines([
      ru ? 'СВОДКА СОСТОЯНИЯ РОБОТА' : 'ROBOT STATUS SUMMARY',
      '-----------------------------------------------',
      `${ru ? 'Всего компонентов' : 'Total components'}: ${components.length}`,
      `ONLINE: ${online}   DEGRADED: ${degraded}   OFFLINE: ${offline}   CRITICAL: ${critical}`,
      '',
      ru ? 'КОМПОНЕНТЫ, ТРЕБУЮЩИЕ ВНИМАНИЯ:' : 'COMPONENTS REQUIRING ATTENTION:',
      ...faulty.map(({ id, name, status }) => `${status.padEnd(8)} ${id}  ${name}`),
      '',
      ru
        ? `РЕЖИМ РОБОТА: ${this.robotSystem?.motionStartupComplete ? 'РАБОЧИЙ' : 'ВОССТАНОВЛЕНИЕ'}`
        : `ROBOT MODE: ${this.robotSystem?.motionStartupComplete ? 'OPERATIONAL' : 'RECOVERY'}`,
      '',
    ])
  }

  /** Localized text for a filesystem quota or path error. */
  private fileSystemError(error: VirtualFileErrorCode): string {
    const ru = this.language === 'ru'
    switch (error) {
      case 'NOT_FOUND':
        return ru ? 'ПУТЬ НЕ НАЙДЕН' : 'PATH NOT FOUND'
      case 'ALREADY_EXISTS':
        return ru ? 'ФАЙЛ ИЛИ КАТАЛОГ УЖЕ СУЩЕСТВУЕТ' : 'FILE OR DIRECTORY ALREADY EXISTS'
      case 'PARENT_MISSING':
        return ru ? 'КАТАЛОГ НЕ СУЩЕСТВУЕТ — ФАЙЛ СОЗДАЁТСЯ ТОЛЬКО В СУЩЕСТВУЮЩЕМ КАТАЛОГЕ' : 'PARENT DIRECTORY DOES NOT EXIST — FILES ARE CREATED INSIDE EXISTING DIRECTORIES'
      case 'INVALID_NAME':
        return ru ? 'НЕДОПУСТИМОЕ ИМЯ ФАЙЛА' : 'INVALID FILE NAME'
      case 'FILE_LIMIT':
        return ru ? `ДОСТИГНУТ ЛИМИТ ФАЙЛОВ: ${VFS_LIMITS.maxFiles}` : `FILE LIMIT REACHED: ${VFS_LIMITS.maxFiles}`
      case 'FILE_TOO_LARGE':
        return ru
          ? `ПРЕВЫШЕН ЛИМИТ РАЗМЕРА ОДНОГО ФАЙЛА: ${formatBytes(VFS_LIMITS.maxFileBytes, 'ru')}`
          : `SINGLE FILE SIZE LIMIT EXCEEDED: ${formatBytes(VFS_LIMITS.maxFileBytes, 'en')}`
      case 'NO_SPACE':
        return ru
          ? `ХРАНИЛИЩЕ ЗАПОЛНЕНО: ${formatBytes(VFS_LIMITS.maxTotalBytes, 'ru')}`
          : `STORAGE FULL: ${formatBytes(VFS_LIMITS.maxTotalBytes, 'en')}`
      case 'PROTECTED':
        return ru
          ? 'СИСТЕМНЫЙ ФАЙЛ ЗАЩИЩЁН — УДАЛЯТЬ И ПЕРЕИМЕНОВЫВАТЬ МОЖНО ТОЛЬКО СОЗДАННЫЕ ВАМИ ФАЙЛЫ'
          : 'SYSTEM FILE IS PROTECTED — ONLY FILES YOU CREATED CAN BE REMOVED OR RENAMED'
      case 'DIR_LIMIT':
        return ru
          ? `ДОСТИГНУТ ЛИМИТ КАТАЛОГОВ: ${VFS_LIMITS.maxDirectories}`
          : `DIRECTORY LIMIT REACHED: ${VFS_LIMITS.maxDirectories}`
      case 'DIR_NOT_EMPTY':
        return ru
          ? 'КАТАЛОГ НЕ ПУСТ — СНАЧАЛА УДАЛИТЕ ЕГО СОДЕРЖИМОЕ'
          : 'DIRECTORY IS NOT EMPTY — REMOVE ITS CONTENTS FIRST'
      default:
        return ru ? 'ОПЕРАЦИЯ С ФАЙЛОМ ОТКЛОНЕНА' : 'FILE OPERATION REFUSED'
    }
  }

  private storageSummaryLine(): string {
    const usage = this.fileSystem.getStorageUsage()
    const ru = this.language === 'ru'
    return ru
      ? `ХРАНИЛИЩЕ: ${usage.fileCount}/${usage.maxFiles} ФАЙЛ. · ${formatBytes(usage.usedBytes, 'ru')} / ${formatBytes(usage.maxBytes, 'ru')}`
      : `STORAGE: ${usage.fileCount}/${usage.maxFiles} FILES · ${formatBytes(usage.usedBytes, 'en')} / ${formatBytes(usage.maxBytes, 'en')}`
  }

  /** Resolve a command argument against the working directory; empty input stays empty for usage hints. */
  private resolveArgument(rawArgument: string): string {
    if (!rawArgument.trim()) return ''
    return this.fileSystem.resolvePath(this.cwd, rawArgument)
  }

  /** cd — move the shell to another directory, exactly like cmd: absolute or relative, `..` supported. */
  private changeDirectory(argument: string): void {
    const ru = this.language === 'ru'
    const raw = argument.trim()
    if (!raw) {
      // cd without arguments behaves like pwd, matching cmd.
      this.appendLines([this.cwd, ''])
      return
    }
    const target = this.fileSystem.resolvePath(this.cwd, raw)
    if (!this.fileSystem.isDirectory(target)) {
      this.appendLines([
        ru ? `КАТАЛОГ НЕ НАЙДЕН: ${target}` : `DIRECTORY NOT FOUND: ${target}`,
        ru ? 'СПИСОК СОДЕРЖИМОГО: ls' : 'LIST CONTENTS WITH: ls',
        '',
      ])
      return
    }
    this.cwd = target
  }

  private createDirectory(rawPath: string): void {
    const ru = this.language === 'ru'
    if (!rawPath) {
      this.appendLines([ru ? 'ФОРМАТ: mkdir <путь>' : 'USAGE: mkdir <path>', ''])
      return
    }
    const result = this.fileSystem.makeDirectory(rawPath)
    if (!result.ok) {
      this.appendLines([`${ru ? 'ОШИБКА СОЗДАНИЯ КАТАЛОГА' : 'MKDIR ERROR'}: ${this.fileSystemError(result.error ?? 'NOT_FOUND')}`, ''])
      return
    }
    this.appendLines([
      ru ? `СОЗДАН КАТАЛОГ: ${result.path}` : `DIRECTORY CREATED: ${result.path}`,
      ru ? `ПЕРЕЙТИ: cd ${result.path}` : `ENTER IT: cd ${result.path}`,
      '',
    ])
  }

  private removeDirectory(rawPath: string): void {
    const ru = this.language === 'ru'
    if (!rawPath) {
      this.appendLines([ru ? 'ФОРМАТ: rmdir <путь>' : 'USAGE: rmdir <path>', ''])
      return
    }
    const result = this.fileSystem.removeDirectory(rawPath)
    if (!result.ok) {
      this.appendLines([`${ru ? 'ОШИБКА УДАЛЕНИЯ КАТАЛОГА' : 'RMDIR ERROR'}: ${this.fileSystemError(result.error ?? 'NOT_FOUND')}`, ''])
      return
    }
    this.appendLines([ru ? `УДАЛЁН КАТАЛОГ: ${result.path}` : `DIRECTORY REMOVED: ${result.path}`, ''])
  }

  /**
   * `rasm` opens the RASM debugger; `rasm <path>` compiles a source file from
   * the virtual filesystem and prints its diagnostics, then loads it into the
   * window so the player can step through it immediately.
   */
  private runRasmCommand(argument: string): void {
    const ru = this.language === 'ru'
    const trimmed = argument.trim()
    const wantsCheck = /^check\b/i.test(trimmed)
    const pathArgument = wantsCheck ? trimmed.replace(/^check\b/i, '').trim() : trimmed

    if (pathArgument) {
      const resolved = this.fileSystem.resolvePath(this.cwd, pathArgument)
      const lines = this.fileSystem.read(resolved, this.language)
      if (!lines) {
        this.appendLines([
          ru ? `ОШИБКА: ФАЙЛ НЕ НАЙДЕН: ${resolved}` : `ERROR: FILE NOT FOUND: ${resolved}`,
          ru ? 'СОЗДАЙТЕ ЕГО КОМАНДОЙ: touch <путь>' : 'CREATE IT WITH: touch <path>',
          '',
        ])
        return
      }

      const source = lines.join('\n')
      const program = compileProgram(source)
      const ok = isRunnable(program)

      this.appendLines([
        ru ? `--- РАЗБОР RASM: ${resolved} ---` : `--- RASM ASSEMBLY: ${resolved} ---`,
        ...formatDiagnostics(program.diagnostics),
        ok
          ? (ru
              ? `СБОРКА OK: ${program.instructions.length} ИНСТРУКЦИЙ, ${program.labels.size} МЕТОК.`
              : `COMPILED OK: ${program.instructions.length} INSTRUCTIONS, ${program.labels.size} LABELS.`)
          : (ru
              ? `СБОРКА НЕ УДАЛАСЬ: ${program.diagnostics.length} ОШИБОК — ЗАПУСК ЗАБЛОКИРОВАН.`
              : `COMPILE FAILED: ${program.diagnostics.length} ERRORS — RUNNING IS BLOCKED.`),
        '',
      ])

      const rasmWindow = this.manager?.get<RasmWindow>('rasm')
      if (rasmWindow && ok) rasmWindow.loadSource(source)
      if (ok) this.manager?.show('rasm')
      return
    }

    this.manager?.show('rasm')
  }

  /**
   * `ps` — the process table of the robot.
   *
   * System services come from the component registry, user programs from the
   * kernel, so the shell shows exactly what the task manager shows.
   */
  private printProcessTable(): void {
    const ru = this.language === 'ru'
    const data = this.robotData
    if (!data) {
      this.appendLines([ru ? 'ТАБЛИЦА ПРОЦЕССОВ НЕДОСТУПНА.' : 'THE PROCESS TABLE IS NOT AVAILABLE.', ''])
      return
    }

    const programs = data.listPrograms()
    const lines = [
      ru ? 'ПРОЦЕССЫ РОБОТА' : 'ROBOT PROCESSES',
      '------------------------------------------------------------',
      `${'PID'.padStart(5)} ${'STATE'.padEnd(9)} ${'CPU%'.padStart(6)} ${'NAME'}`,
      '------------------------------------------------------------',
    ]

    for (const process of data.getProcesses()) {
      const kind = process.kind === 'program' ? '*' : ' '
      const state = process.state.padEnd(9)
      const cpu = process.cpuPercent.toFixed(1).padStart(6)
      lines.push(`${String(process.pid).padStart(4)}${kind} ${state} ${cpu} ${process.name}`)
    }

    lines.push(
      '------------------------------------------------------------',
      ru
        ? `${programs.length} ПРОГРАММ, ${data.getProcesses().filter((process) => process.kind === 'program' && (process.state === 'RUNNING' || process.state === 'DEGRADED')).length} АКТИВНЫХ. * — ПРОГРАММА ОПЕРАТОРА.`
        : `${programs.length} PROGRAMS, ${data.getProcesses().filter((process) => process.kind === 'program' && (process.state === 'RUNNING' || process.state === 'DEGRADED')).length} ACTIVE. * — OPERATOR PROGRAM.`,
      '',
    )
    this.appendLines(lines)
  }

  /** `run <path>` — launch a program from the robot's file system. */
  private runProgramFile(rawArgument: string): void {
    const ru = this.language === 'ru'
    const data = this.robotData
    if (!data) {
      this.appendLines([ru ? 'СРЕДА ВЫПОЛНЕНИЯ НЕ ПОДКЛЮЧЕНА.' : 'THE EXECUTION ENVIRONMENT IS NOT CONNECTED.', ''])
      return
    }
    if (!rawArgument) {
      this.appendLines([ru ? 'ФОРМАТ: run <путь>' : 'USAGE: run <path>', ''])
      return
    }

    const resolved = this.fileSystem.resolvePath(this.cwd, rawArgument)
    const lines = this.fileSystem.read(resolved, this.language)
    if (!lines) {
      this.appendLines([
        ru ? `ОШИБКА: ФАЙЛ НЕ НАЙДЕН: ${resolved}` : `ERROR: FILE NOT FOUND: ${resolved}`,
        '',
      ])
      return
    }

    const source = lines.join('\n')
    const result = data.launchProgram(source, { path: resolved })
    if (!result) {
      this.appendLines([ru ? 'СРЕДА ВЫПОЛНЕНИЯ НЕ ПОДКЛЮЧЕНА.' : 'THE EXECUTION ENVIRONMENT IS NOT CONNECTED.', ''])
      return
    }
    if (!result.ok) {
      this.appendLines([
        ru ? `ЗАПУСК ОТКАЗАН: ${result.name}` : `LAUNCH REFUSED: ${result.name}`,
        result.message[this.language],
        ...(result.diagnostics?.length
          ? formatDiagnostics(result.diagnostics).map((line) => `  ${line}`)
          : []),
        '',
      ])
      return
    }

    this.appendLines([
      ru ? `ПРОГРАММА ЗАПУЩЕНА: ${result.name} (PID ${result.pid})` : `PROGRAM STARTED: ${result.name} (PID ${result.pid})`,
      ru ? 'ПРОСМОТР: ps · ОСТАНОВКА: kill <PID>' : 'WATCH: ps · STOP: kill <PID>',
      '',
    ])
  }

  /** `kill|pause|resume <pid>` — the control verbs of the shell. */
  private controlProgram(verb: 'kill' | 'pause' | 'resume', rawArgument: string): void {
    const ru = this.language === 'ru'
    const data = this.robotData
    if (!data) {
      this.appendLines([ru ? 'СРЕДА ВЫПОЛНЕНИЯ НЕ ПОДКЛЮЧЕНА.' : 'THE EXECUTION ENVIRONMENT IS NOT CONNECTED.', ''])
      return
    }

    const pid = Number.parseInt(rawArgument.trim(), 10)
    if (!Number.isFinite(pid)) {
      this.appendLines([
        ru ? `ФОРМАТ: ${verb} <PID>` : `USAGE: ${verb} <PID>`,
        '',
      ])
      return
    }

    const program = data.getProgram(pid)
    if (!program) {
      this.appendLines([
        ru ? `ОШИБКА: ПРОЦЕСС НЕ НАЙДЕН: ${pid}` : `ERROR: PROCESS NOT FOUND: ${pid}`,
        ru ? 'СПИСОК ПРОЦЕССОВ: ps' : 'LIST THE PROCESSES: ps',
        '',
      ])
      return
    }

    const ok = verb === 'kill'
      ? data.killProcess(pid)
      : verb === 'pause'
        ? data.suspendProcess(pid)
        : data.resumeProcess(pid)

    if (!ok) {
      this.appendLines([
        ru ? `ОТКАЗ: ${program.name} (PID ${pid}) НЕЛЬЗЯ ${verb === 'kill' ? 'ЗАВЕРШИТЬ' : verb === 'pause' ? 'ПРИОСТАНОВИТЬ' : 'ПРОДОЛЖИТЬ'}.` : `REFUSED: ${program.name} (PID ${pid}) CANNOT BE ${verb === 'kill' ? 'TERMINATED' : verb === 'pause' ? 'SUSPENDED' : 'RESUMED'}.`,
        ru ? `СОСТОЯНИЕ: ${program.state}` : `STATE: ${program.state}`,
        '',
      ])
      return
    }

    const done = verb === 'kill'
      ? (ru ? 'ПРОЦЕСС ЗАВЕРШЁН.' : 'PROCESS TERMINATED.')
      : verb === 'pause'
        ? (ru ? 'ПРОЦЕСС ПРИОСТАНОВЛЕН.' : 'PROCESS SUSPENDED.')
        : (ru ? 'ПРОЦЕСС ПРОДОЛЖЕН.' : 'PROCESS RESUMED.')
    this.appendLines([`${program.name} (PID ${pid}): ${done}`, ''])
  }

  private printDirectory(rawPath: string): void {
    const entries = this.fileSystem.list(rawPath || '/', this.language)
    const failed = entries[0]?.startsWith(this.language === 'ru' ? 'ОШИБКА' : 'ERROR') ?? false
    this.appendLines(failed ? entries : [...entries, '', this.storageSummaryLine(), ''])
  }

  private printFile(rawPath: string): void {    const ru = this.language === 'ru'
    if (!rawPath) {
      this.appendLines([ru ? 'ФОРМАТ: cat <путь>' : 'USAGE: cat <path>', ''])
      return
    }
    const lines = this.fileSystem.read(rawPath, this.language)
    if (!lines) {
      this.appendLines([
        ru ? `ОШИБКА: ФАЙЛ НЕ НАЙДЕН: ${rawPath}` : `ERROR: FILE NOT FOUND: ${rawPath}`,
        ru ? 'ПОКАЖИТЕ СОДЕРЖИМОЕ КАТАЛОГА КОМАНДОЙ ls.' : 'LIST THE DIRECTORY CONTENTS WITH ls.',
        '',
      ])
      return
    }
    this.appendLines([
      `--- ${rawPath} ---`,
      ...lines,
      '',
      `${lines.length} ${ru ? 'СТРОК' : 'LINES'}`,
      '',
    ])
  }

  private createFile(rawPath: string): void {
    const ru = this.language === 'ru'
    if (!rawPath) {
      this.appendLines([ru ? 'ФОРМАТ: touch <путь>' : 'USAGE: touch <path>', ''])
      return
    }
    const result = this.fileSystem.create(rawPath)
    if (!result.ok) {
      this.appendLines([
        `${ru ? 'ОШИБКА СОЗДАНИЯ' : 'CREATE ERROR'}: ${this.fileSystemError(result.error ?? 'NOT_FOUND')}`,
        '',
      ])
      return
    }
    this.appendLines([
      ru ? `СОЗДАН ФАЙЛ: ${result.path}` : `CREATED FILE: ${result.path}`,
      ru ? `ОТКРЫТЬ В РЕДАКТОРЕ: vim ${result.path}` : `OPEN IN THE EDITOR: vim ${result.path}`,
      this.storageSummaryLine(),
      '',
    ])
  }

  private removeFile(rawPath: string): void {
    const ru = this.language === 'ru'
    if (!rawPath) {
      this.appendLines([ru ? 'ФОРМАТ: rm <путь>' : 'USAGE: rm <path>', ''])
      return
    }
    const result = this.fileSystem.remove(rawPath)
    if (!result.ok) {
      this.appendLines([
        `${ru ? 'ОШИБКА УДАЛЕНИЯ' : 'REMOVE ERROR'}: ${this.fileSystemError(result.error ?? 'NOT_FOUND')}`,
        '',
      ])
      return
    }
    this.appendLines([
      ru ? `УДАЛЁН ФАЙЛ: ${result.path}` : `REMOVED FILE: ${result.path}`,
      this.storageSummaryLine(),
      '',
    ])
  }

  private renameFile(argument: string): void {
    const ru = this.language === 'ru'
    const [fromRaw, toRaw] = argument.split(/\s+/).filter(Boolean)
    if (!fromRaw || !toRaw) {
      this.appendLines([ru ? 'ФОРМАТ: mv <исходный путь> <новый путь>' : 'USAGE: mv <source path> <new path>', ''])
      return
    }
    const from = this.fileSystem.resolvePath(this.cwd, fromRaw)
    const to = this.fileSystem.resolvePath(this.cwd, toRaw)
    const result = this.fileSystem.rename(from, to)
    if (!result.ok) {
      this.appendLines([
        `${ru ? 'ОШИБКА ПЕРЕИМЕНОВАНИЯ' : 'RENAME ERROR'}: ${this.fileSystemError(result.error ?? 'NOT_FOUND')}`,
        '',
      ])
      return
    }
    this.appendLines([ru ? `ПЕРЕИМЕНОВАН: ${from} -> ${result.path}` : `RENAMED: ${from} -> ${result.path}`, ''])
  }

  private findInFiles(term: string): void {
    const ru = this.language === 'ru'
    if (!term.trim()) {
      this.appendLines([ru ? 'ФОРМАТ: find <слово>' : 'USAGE: find <term>', ''])
      return
    }
    const matches = this.fileSystem.find(term, this.language)
    if (matches.length === 0) {
      this.appendLines([ru ? `СОВПАДЕНИЙ НЕ НАЙДЕНО: ${term}` : `NO MATCHES: ${term}`, ''])
      return
    }
    const shown = matches.slice(0, 20)
    this.appendLines([
      ru ? `НАЙДЕНО ${matches.length} (ПОКАЗАНЫ ПЕРВЫЕ ${shown.length})` : `FOUND ${matches.length} (SHOWING FIRST ${shown.length})`,
      ...shown.map((match) => `${match.path}\n    ${match.preview}`),
      '',
    ])
  }

  /** Quota report: file count, total size, and how full each limit is. */
  private printStorage(): void {
    const ru = this.language === 'ru'
    const usage = this.fileSystem.getStorageUsage()
    const width = 24
    const directoriesText = `${usage.directoryCount} / ${usage.maxDirectories}`
    const bar = (ratio: number): string => {
      const filled = Math.max(ratio > 0 ? 1 : 0, Math.min(width, Math.round(ratio * width)))
      return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`
    }
    this.appendLines([
      ru ? 'ФАЙЛОВОЕ ХРАНИЛИЩЕ / КВОТЫ СЕАНСА' : 'FILE STORAGE / SESSION QUOTAS',
      '------------------------------------------------------------------',
      `${ru ? 'ФАЙЛОВ' : 'FILES'}     ${String(usage.fileCount).padStart(3)} / ${String(usage.maxFiles).padEnd(3)} ${bar(usage.fileRatio)}`,
      `${ru ? 'ОБЪЁМ' : 'SIZE'}     ${formatBytes(usage.usedBytes, ru ? 'ru' : 'en').padStart(8)} / ${formatBytes(usage.maxBytes, ru ? 'ru' : 'en').padEnd(8)} ${bar(usage.byteRatio)}`,
      `${ru ? 'СВОБОДНО' : 'FREE'}    ${usage.maxFiles - usage.fileCount} ${ru ? 'ФАЙЛ.' : 'FILES'} · ${formatBytes(Math.max(0, usage.maxBytes - usage.usedBytes), ru ? 'ru' : 'en')}`,
      `${ru ? 'ЛИМИТ ФАЙЛА' : 'PER FILE'} ${formatBytes(VFS_LIMITS.maxFileBytes, ru ? 'ru' : 'en')}`,
      `${ru ? 'КАТАЛОГОВ' : 'DIRS'}    ${directoriesText}`,
      `${ru ? 'САМЫЙ БОЛЬШОЙ ФАЙЛ' : 'LARGEST FILE'}: ${formatBytes(usage.largestFileBytes, ru ? 'ru' : 'en')}`,
      '',
      ru
        ? 'Запись отклоняется, когда лимит исчерпан: сеанс не переполняется.'
        : 'Writes are refused when a limit is reached, so the session cannot grow unbounded.',
      '',
    ])
  }

  private openTerminal(): void {

    this.stage = 'terminal'

    this.command = ''
    this.commandCursor = 0

    this.appendTranscript(this.language === 'ru'

      ? '\nСЕАНС ВОССТАНОВЛЕНИЯ ОТКРЫТ.\nВВЕДИТЕ help ДЛЯ СПИСКА КОМАНД.\n\n'

      : '\nRECOVERY SESSION OPENED.\nTYPE help TO LIST COMMANDS.\n\n')

    this.followTail = true

  }



  /** Starts or restarts the BIOS sequence without discarding an existing transcript. */
  private beginBootSequence(preserveTranscript: boolean): void {
    if (preserveTranscript && (this.transcript.length > 0 || this.pendingOutput.length > 0)) {
      this.appendTranscript(
        `\n\n============================================================\n${
          this.language === 'ru' ? 'ПОВТОРНЫЙ ЗАПУСК BIOS...' : 'BIOS RESTART...'
        }\n============================================================\n\n`,
      )
    } else if (!preserveTranscript) {
      this.transcript = ''
      this.pendingOutput = ''
      this.outputCharAccumulator = 0
    }

    this.bootText = this.getBootText()
    this.bootQueued = false
    this.manualQueued = false
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

      L('Operator manual available.', 'Доступен мануал оператора.'),

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
        'МАНУАЛ ОПЕРАТОРА / ПРОТОКОЛ ВОССТАНОВЛЕНИЯ',
        '------------------------------------------',
        '01. components — список компонентов и их текущих состояний.',
        '02. status — сводка неисправностей и режим робота.',
        '03. ui — открыть панель обслуживания и мини-игры.',
        '04. tasks — диспетчер задач: производительность, параметры и процессы робота.',
        '05. vim — открыть редактор профиля движения.',
        '06. manual — повторно показать эту инструкцию.',
        '07. clear — полностью очистить экран консоли.',
        '08. start — запустить программу запуска тела /opt/firmware/motion/body-startup.rasm;',
        '    программа проверяет аппаратуру сама и пишет код отказа в DIAG (1..5).',
        '09. ↑/↓ — история введённых команд; ←/→, Home/End — курсор в строке ввода;',
        '    Backspace/Delete — правка символа; TAB — автодополнение видимых команд.',
        '',
        'ПРОЦЕССЫ:',
        '10. ps — таблица процессов робота: сервисы и запущенные программы.',
        '11. run <путь> — скомпилировать .rasm из хранилища и запустить как процесс.',
        '    Справочник по языку RASM: /usr/share/docs/rasm.txt (cat или vim).',
        '12. kill <PID> — завершить процесс.',
        '13. pause <PID> — приостановить процесс (состояние сохраняется).',
        '14. resume <PID> — продолжить приостановленный процесс.',
        'Запуск программы блокируется, если вычислительный узел (CPU-730) или ядро (OSK-710) недоступны.',
        '',
        'ФАЙЛОВЫЕ КОМАНДЫ:',
        '15. ls [путь] — содержимое каталога.',
        '16. cat <путь> — прочитать файл.',
        '17. touch <путь> — создать файл (лимиты: файлы и общий объём).',
        '18. rm <путь> / mv <а> <б> — удалить или переименовать созданный вами файл.',
        '19. find <слово> — поиск по путям и содержимому.',
        '20. df — заполнение файлового хранилища и лимиты.',
        '21. vim [путь] — правка файлов; создать новый можно командой touch.',
        '',
        'КАТАЛОГИ:',
        '22. cd <путь> — перейти в каталог (как в cmd): cd .. — вверх, cd — текущий путь.',
        '23. pwd — показать текущий каталог.',
        '24. mkdir <путь> / rmdir <путь> — создать каталог или удалить пустой созданный вами.',
        'Пути файловых команд считаются от текущего каталога; абсолютные начинаются с /.',
        '',
        'Не обходите защиту: запуск блокируется при невосстановленных критических подсистемах.',
        '------------------------------------------',
      ].join('\n')
    }
    return [
      'OPERATOR MANUAL / RECOVERY PROTOCOL',
      '-----------------------------------',
      '01. components — list components and their current state.',
      '02. status — summary of faults and robot mode.',
      '03. ui — open maintenance UI and minigames.',
      '04. tasks — task manager: robot performance, parameters and processes.',
      '05. vim — open the motion-profile editor.',
      '06. manual — print this manual again.',
      '07. clear — fully clear the console screen.',
      '08. start — launch the body startup program /opt/firmware/motion/body-startup.rasm;',
      '    the program checks the hardware itself and writes the failure code to DIAG (1..5).',
      '09. ↑/↓ — command history; ←/→, Home/End — cursor inside the input line;',
      '    Backspace/Delete — edit a character; TAB — autocomplete visible commands.',
      '',
      'PROCESSES:',
      '10. ps — process table: robot services and running programs.',
      '11. run <path> — compile a stored .rasm file and start it as a process.',
      '    RASM language reference: /usr/share/docs/rasm.txt (cat or vim).',
      '12. kill <PID> — terminate a process.',
      '13. pause <PID> — suspend a process (its state is kept).',
      '14. resume <PID> — continue a suspended process.',
      'Program launch is blocked while the compute unit (CPU-730) or the kernel (OSK-710) is unavailable.',
      '',
      'FILE COMMANDS:',
      '15. ls [path] — list a directory.',
      '16. cat <path> — read a file.',
      '17. touch <path> — create a file (file-count and size quotas apply).',
      '18. rm <path> / mv <a> <b> — remove or rename a file you created.',
      '19. find <term> — search paths and contents.',
      '20. df — storage fill levels and quotas.',
      '21. vim [path] — edit files; create a new one with touch.',
      '',
      'DIRECTORIES:',
      '22. cd <path> — change directory (like cmd): cd .. — go up, cd — print the current path.',
      '23. pwd — print the current directory.',
      '24. mkdir <path> / rmdir <path> — create a directory or remove an empty one you created.',
      'File-command paths resolve from the current directory; absolute paths start with /.',
      '',
      'Do not bypass safety systems: startup is blocked while critical systems remain unrecovered.',
      '-----------------------------------',
    ].join('\n')
  }

  private getManualPromptLabel(): string {

    return this.language === 'ru' ? 'МАНУАЛ ОПЕРАТОРА [Y/N]? ' : 'OPERATOR MANUAL [Y/N]? '

  }



  private getTerminalPrompt(): string {
    const path = this.getPromptPath()
    return this.language === 'ru' ? `ОПЕРАТОР@РОБОТ:${path}$ ` : `OPERATOR@ROBOT:${path}$ `
  }

  /** Current directory in the prompt; long paths keep their tail so the user still sees where they are. */
  private getPromptPath(): string {
    if (this.cwd === '/') return '/'
    const max = 18
    if (this.cwd.length <= max) return this.cwd
    return `...${this.cwd.slice(-max + 3)}`
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
    if (text.length === 0) return
    this.pendingOutput += text
  }

  private flushPendingOutput(dt: number): void {
    if (this.pendingOutput.length === 0) {
      this.outputCharAccumulator = 0
      return
    }

    const fastStage = this.stage === 'boot' || this.stage === 'manual-stream'
    const speed = fastStage ? this.charsPerSecond : this.terminalCharsPerSecond
    this.outputCharAccumulator += Math.max(0, dt) * speed
    const count = Math.min(this.pendingOutput.length, Math.floor(this.outputCharAccumulator))
    if (count <= 0) return

    this.transcript += this.pendingOutput.slice(0, count)
    this.pendingOutput = this.pendingOutput.slice(count)
    this.outputCharAccumulator -= count

    // Do not bank unused typing time while the queue is empty; otherwise the
    // next short command could appear all at once.
    if (this.pendingOutput.length === 0) this.outputCharAccumulator = 0
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
