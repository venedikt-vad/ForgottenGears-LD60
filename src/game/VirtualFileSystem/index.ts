import { SERVICE_PROGRAM_DIR, SERVICE_PROGRAMS, serviceProgramPath } from '../runtime/servicePrograms'

export type VirtualFileLanguage = 'ru' | 'en'

interface VirtualFile {
  path: string
  content: Record<VirtualFileLanguage, string>
  /** Session-created files may be renamed and removed; shipped files are protected. */
  user?: boolean
}

export interface VirtualFileMatch {
  path: string
  preview: string
}

export type VirtualFileErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PARENT_MISSING'
  | 'INVALID_NAME'
  | 'FILE_LIMIT'
  | 'FILE_TOO_LARGE'
  | 'NO_SPACE'
  | 'PROTECTED'
  | 'DIR_LIMIT'
  | 'DIR_NOT_EMPTY'

export interface VirtualFileResult {
  ok: boolean
  error?: VirtualFileErrorCode
  /** Normalized path the operation applied to, when it is known. */
  path?: string
}

export interface VirtualStorageUsage {
  fileCount: number
  maxFiles: number
  directoryCount: number
  maxDirectories: number
  usedBytes: number
  maxBytes: number
  largestFileBytes: number
  /** 0..1 fill ratios for progress bars. */
  fileRatio: number
  byteRatio: number
}

/** One file in a save-game snapshot, including both localized copies. */
export interface VirtualFileSnapshot {
  path: string
  content: Record<VirtualFileLanguage, string>
  user: boolean
}

/** Serializable state of the in-memory filesystem. Stored in save slots. */
export interface VirtualFileSystemSnapshot {
  files: VirtualFileSnapshot[]
  directories: string[]
  userDirectories: string[]
}

/**
 * Hard caps for the in-memory filesystem. Everything lives in JS memory, so the
 * quotas keep a long session from growing without bound and stalling the frame.
 */
export const VFS_LIMITS = {
  maxFiles: 72,
  maxFileBytes: 16 * 1024,
  maxTotalBytes: 192 * 1024,
  maxDirectories: 32,
} as const

/** Shipped RASM 1.0 language reference, readable with `cat` and `vim`. */
export const RASM_DOC_PATH = '/usr/share/docs/rasm.txt'

/** UTF-8 size of a string without allocating an encoder buffer. */
export function byteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: 4 UTF-8 bytes, and the low surrogate is skipped.
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

/** Human-readable size with localized units, used by every storage readout. */
export function formatBytes(bytes: number, language: VirtualFileLanguage = 'ru'): string {
  if (bytes < 1024) return `${bytes} ${language === 'ru' ? 'Б' : 'B'}`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${language === 'ru' ? 'КБ' : 'KB'}`
  return `${(bytes / (1024 * 1024)).toFixed(2)} ${language === 'ru' ? 'МБ' : 'MB'}`
}

/**
 * In-game filesystem independent from the host filesystem. Every path is
 * defined by the game; writes affect only this in-memory game session.
 */
export class VirtualFileSystem {
  private readonly directories = new Set([
    '/',
    '/boot',
    '/etc',
    '/etc/motion',
    '/etc/power',
    '/etc/thermal',
    '/manual',
    '/opt',
    '/opt/analyzer',
    '/opt/firmware',
    '/opt/firmware/motion',
    '/sys',
    '/sys/body',
    '/sys/memory',
    SERVICE_PROGRAM_DIR,
    '/usr',
    '/usr/share',
    '/usr/share/docs',
    '/var',
    '/var/log',
  ])

  /** Session-created directories; only these can be removed with rmdir. */
  private readonly userDirectories = new Set<string>()

  private readonly files: VirtualFile[] = [
    {
      path: '/manual/operator.txt',
      content: {
        ru: `ROBOT OS / ПАМЯТКА ОПЕРАТОРА
============================

help                 список команд
components           реестр компонентов робота
info <ID>            справка по компоненту
status               общее состояние системы
diagnostics          отчёт неисправностей и зависимостей
ls [путь]            список каталогов и файлов
cd <путь>            перейти в каталог (как в cmd); cd .. — вверх
pwd                  показать текущий каталог
mkdir <путь>         создать каталог
rmdir <путь>         удалить пустой созданный вами каталог
cat <путь>           прочитать файл
touch <путь>         создать пустой файл
rm <путь>            удалить созданный вами файл
mv <откуда> <куда>   переименовать или переместить файл
find <слово>         поиск по путям и содержимому файлов
df                   занятость хранилища и квоты
vim [путь]           открыть Vim-подобный редактор исходников
ui                   открыть панель обслуживания
tasks                диспетчер задач: производительность и сервисы
ps                   таблица процессов: сервисы и запущенные программы
run <путь>           скомпилировать .rasm и запустить его как процесс
kill <PID>           завершить процесс
pause <PID>          приостановить процесс
resume <PID>         продолжить приостановленный процесс
start                запустить программу запуска тела и получить её вердикт

Рекомендуемый порядок:
1. Прочитать отчёт POST и запустить diagnostics.
2. Проверить источник питания и карту распределения.
3. Не включать движение до проверки охлаждения.
4. После каждого крупного изменения повторять diagnostics.
5. Когда все узлы в норме — выполнить start: программа проверяет аппаратуру
   сама и пишет код отказа в DIAG (1..5).

Программы .rasm редактируются через vim и запускаются командой run <путь>.
Исходники служб: /sys/services/*.rasm; в диспетчере задач клавиша E открывает
скрипт выбранного процесса в редакторе.
Справочник по языку RASM: /usr/share/docs/rasm.txt (cat или vim).
Запуск программы блокируется, если вычислительный узел (CPU-730) или ядро
операционной системы (OSK-710) недоступны.
Чтение доступно из консоли; исходники .drv/.seq можно редактировать через vim. Изменения хранятся в текущем сеансе.
Пути считаются от текущего каталога (cd/pwd); абсолютные пути начинаются с /.
Хранилище ограничено (файлы, каталоги, размер файла и общий объём); превышение отклоняется. Статус квот показывает df и метр в шапке.
Имена команд и путей нечувствительны к регистру.`,
        en: `ROBOT OS / OPERATOR QUICK REFERENCE
===================================

help                 list commands
components           list robot components
info <ID>            component information
status               overall system status
diagnostics          fault and dependency report
ls [path]            list directories and files
cd <path>            change directory (like cmd); cd .. — go up
pwd                  print the current directory
mkdir <path>         create a directory
rmdir <path>         remove an empty directory you created
cat <path>           read a file
touch <path>         create an empty file
rm <path>            delete a file you created
mv <from> <to>       rename or move a file
find <term>          search file paths and contents
df                   storage usage and quotas
vim [path]           open the Vim-like source editor
ui                   open service toolbar
tasks                task manager: performance and services
ps                   process table: services and running programs
run <path>           compile a .rasm file and start it as a process
kill <PID>           terminate a process
pause <PID>          suspend a process
resume <PID>         continue a suspended process
start                run the body startup program and get its verdict

Recommended order:
1. Read the POST report and run diagnostics.
2. Inspect the power source and distribution map.
3. Do not enable motion before checking cooling.
4. Run diagnostics again after each major change.
5. Once every unit is healthy — run start: the program checks the hardware
   itself and writes the failure code to DIAG (1..5).

.rasm programs are edited with vim and started with run <path>.
Service sources: /sys/services/*.rasm; press E on a task-manager row to open
the selected process script in the editor.
RASM language reference: /usr/share/docs/rasm.txt (cat or vim).
Program launch is blocked while the compute unit (CPU-730) or the operating
system kernel (OSK-710) is unavailable.
Source .drv/.seq files can be edited with vim; changes persist in the current game session.
File-command paths resolve from the current directory (cd/pwd); absolute paths start with /.
Storage is limited (files, directories, per-file size, total size); over-quota writes are refused. Run df or watch the header meter for usage.
Commands and paths are case-insensitive.`,
      },
    },
    {
      path: '/boot/post.log',
      content: {
        ru: `POST REPORT / BOOT-001
-----------------------
PWR-100 primary source: DEGRADED
RCTR-110 reactor controller: CONFIGURATION REQUIRED
PDU-230 primary input: PRESENT
PDU-230 BODY_MAIN route: INHIBITED
ANL-450 auxiliary controller rail: OFF
MCM-740 motion command image: CRC MISMATCH
CLG-820 cooling flow: BELOW EXPECTED RANGE

POST cannot distinguish an unpowered device from an absent assembly.
Run diagnostics after restoring each subsystem.`,
        en: `POST REPORT / BOOT-001
-----------------------
PWR-100 primary source: DEGRADED
RCTR-110 reactor controller: CONFIGURATION REQUIRED
PDU-230 primary input: PRESENT
PDU-230 BODY_MAIN route: INHIBITED
ANL-450 auxiliary controller rail: OFF
MCM-740 motion command image: CRC MISMATCH
CLG-820 cooling flow: BELOW EXPECTED RANGE

POST cannot distinguish an unpowered device from an absent assembly.
Run diagnostics after restoring each subsystem.`,
      },
    },
    {
      path: '/etc/power/reactor-sequence.txt',
      content: {
        ru: `RCTR-110 / SEQUENCE CONTROLLER

Назначение: подготовить выход PWR-100 к подключению нагрузки.

Перед запуском проверьте:
- входное питание PWR-100 стабильно;
- профиль запуска соответствует метке SAFE-START;
- выход не подключён к нагрузке до завершения самопроверки.

Ожидаемые результаты:
REACTOR_READY=1
OUTPUT_STABLE=1
LOAD_ENABLE остаётся под контролем PDU-230.

Внимание: успешный запуск реактора не означает, что питание уже подано
на шину корпуса. Распределительные линии проверяются отдельно.`,
        en: `RCTR-110 / SEQUENCE CONTROLLER

Purpose: prepare PWR-100 output for connection to a load.

Before startup, verify:
- PWR-100 input is stable;
- the startup profile matches SAFE-START;
- no load is connected before self-test completes.

Expected results:
REACTOR_READY=1
OUTPUT_STABLE=1
LOAD_ENABLE remains controlled by PDU-230.

Note: a successful reactor startup does not mean the torso is powered.
Distribution rails are checked separately.`,
      },
    },
    {
      path: '/etc/power/rail-map.cfg',
      content: {
        ru: `# PDU-230 / POWER RAIL MAP
PRIMARY_IN=PWR-100
AUX_DIAG=ANL-450:CONTROL
BODY_MAIN=BUS-T-240
ACTUATOR_BUS=ACT-610

# Current stored configuration
BODY_MAIN_ENABLE=0
ACTUATOR_BUS_ENABLE=0
AUX_DIAG_ENABLE=0

# AUX_DIAG powers the analyzer controller only. It does not supply
# the analyzer measurement channels or the torso bus.`,
        en: `# PDU-230 / POWER RAIL MAP
PRIMARY_IN=PWR-100
AUX_DIAG=ANL-450:CONTROL
BODY_MAIN=BUS-T-240
ACTUATOR_BUS=ACT-610

# Current stored configuration
BODY_MAIN_ENABLE=0
ACTUATOR_BUS_ENABLE=0
AUX_DIAG_ENABLE=0

# AUX_DIAG powers the analyzer controller only. It does not supply
# the analyzer measurement channels or the torso bus.`,
      },
    },
    {
      path: '/var/log/power.log',
      content: {
        ru: `POWER ROUTING SERVICE / LAST EVENTS

[10:42:01] PWR-100 output voltage within nominal range.
[10:42:02] RCTR-110 REACTOR_READY=0; waiting for startup configuration.
[10:42:03] PDU-230 PRIMARY_IN=PRESENT.
[10:42:03] BODY_MAIN route inhibited: route flag is disabled.
[10:42:04] ACTUATOR_BUS unavailable because BODY_MAIN is not active.
[10:42:05] ANL-450 control rail is not energized.

Подсказка: источник питания, распределитель и отдельные ветви — три разных
звена. Исправление одного звена не активирует остальные автоматически.`,
        en: `POWER ROUTING SERVICE / LAST EVENTS

[10:42:01] PWR-100 output voltage within nominal range.
[10:42:02] RCTR-110 REACTOR_READY=0; waiting for startup configuration.
[10:42:03] PDU-230 PRIMARY_IN=PRESENT.
[10:42:03] BODY_MAIN route inhibited: route flag is disabled.
[10:42:04] ACTUATOR_BUS unavailable because BODY_MAIN is not active.
[10:42:05] ANL-450 control rail is not energized.

Hint: the source, distribution unit, and individual rails are three separate
stages. Fixing one stage does not automatically activate the others.`,
      },
    },
    {
      path: '/opt/firmware/motion/оптимизатор_акселерации_1.0.18.drv',
      content: {
        ru: `# ACCELERATION OPTIMIZER 1.0.18
# MCM-740 / BODY STARTUP PROFILE
PROFILE_ID = "MCM-740"
CRC_CHECK = false
REQUIRE_COOLING = false

PROC BODY_STARTUP:
    VERIFY_POWER(PWR-100, PDU-230)
    INITIALIZE_SCHEDULER(RTS-711)
    DISCOVER_ACTUATORS(ACT-610, SRV-620)
    ENABLE_MOTION(LOC-630)
    ENABLE_VISION(CAM-410)
END
`,
        en: `# ACCELERATION OPTIMIZER 1.0.18
# MCM-740 / BODY STARTUP PROFILE
PROFILE_ID = "MCM-740"
CRC_CHECK = false
REQUIRE_COOLING = false

PROC BODY_STARTUP:
    VERIFY_POWER(PWR-100, PDU-230)
    INITIALIZE_SCHEDULER(RTS-711)
    DISCOVER_ACTUATORS(ACT-610, SRV-620)
    ENABLE_MOTION(LOC-630)
    ENABLE_VISION(CAM-410)
END
`,
      },
    },
    {
      path: '/opt/firmware/motion/body-startup.seq',
      content: {
        ru: `# MCM-740 / BODY STARTUP SEQUENCE
PROFILE_ID = "MCM-740"
CRC_CHECK = false
REQUIRE_COOLING = false

PROC BODY_STARTUP:
    VERIFY_POWER(PWR-100, PDU-230)
    INITIALIZE_SCHEDULER(RTS-711)
    DISCOVER_ACTUATORS(ACT-610, SRV-620)
    ENABLE_MOTION(LOC-630)
    ENABLE_VISION(CAM-410)
END
`,
        en: `# MCM-740 / BODY STARTUP SEQUENCE
PROFILE_ID = "MCM-740"
CRC_CHECK = false
REQUIRE_COOLING = false

PROC BODY_STARTUP:
    VERIFY_POWER(PWR-100, PDU-230)
    INITIALIZE_SCHEDULER(RTS-711)
    DISCOVER_ACTUATORS(ACT-610, SRV-620)
    ENABLE_MOTION(LOC-630)
    ENABLE_VISION(CAM-410)
END
`,
      },
    },
    {
      path: '/opt/firmware/motion/body-startup.rasm',
      content: {
        ru: `; ============================================================
;  RASM 1.0 - BODY STARTUP SELF-TEST
; ============================================================
;  The console command "start" launches this file as a real process.
;  Every check reads a hardware port of the robot:
;
;    PWR     primary power source        (check 1)
;    MEM     core memory                 (check 2)
;    PROFILE motion command profile      (check 3)
;    BUS     body power bus              (check 4)
;    ACT     actuator bus                (check 5)
;
;  The first failed check writes its number into the DIAG latch
;  and clears the BOOT latch. When all five checks pass, DIAG is
;  set to 0 and BOOT to 1.
; ============================================================

        IN  R0, PWR          ; primary power source
        CMP R0, #1
        JNE FAIL_PWR
        IN  R0, MEM          ; core memory
        CMP R0, #1
        JNE FAIL_MEM
        IN  R0, PROFILE      ; motion command profile
        CMP R0, #1
        JNE FAIL_PROFILE
        IN  R0, BUS          ; body power bus
        CMP R0, #1
        JNE FAIL_BUS
        IN  R0, ACT          ; actuator bus
        CMP R0, #1
        JNE FAIL_ACT

        MOV R1, #0           ; every check passed
        OUT DIAG, R1
        MOV R1, #1
        OUT BOOT, R1
        HALT

FAIL_PWR:
        MOV R1, #1
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_MEM:
        MOV R1, #2
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_PROFILE:
        MOV R1, #3
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_BUS:
        MOV R1, #4
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_ACT:
        MOV R1, #5
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT
`,
        en: `; ============================================================
;  RASM 1.0 - BODY STARTUP SELF-TEST
; ============================================================
;  The console command "start" launches this file as a real process.
;  Every check reads a hardware port of the robot:
;
;    PWR     primary power source        (check 1)
;    MEM     core memory                 (check 2)
;    PROFILE motion command profile      (check 3)
;    BUS     body power bus              (check 4)
;    ACT     actuator bus                (check 5)
;
;  The first failed check writes its number into the DIAG latch
;  and clears the BOOT latch. When all five checks pass, DIAG is
;  set to 0 and BOOT to 1.
; ============================================================

        IN  R0, PWR          ; primary power source
        CMP R0, #1
        JNE FAIL_PWR
        IN  R0, MEM          ; core memory
        CMP R0, #1
        JNE FAIL_MEM
        IN  R0, PROFILE      ; motion command profile
        CMP R0, #1
        JNE FAIL_PROFILE
        IN  R0, BUS          ; body power bus
        CMP R0, #1
        JNE FAIL_BUS
        IN  R0, ACT          ; actuator bus
        CMP R0, #1
        JNE FAIL_ACT

        MOV R1, #0           ; every check passed
        OUT DIAG, R1
        MOV R1, #1
        OUT BOOT, R1
        HALT

FAIL_PWR:
        MOV R1, #1
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_MEM:
        MOV R1, #2
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_PROFILE:
        MOV R1, #3
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_BUS:
        MOV R1, #4
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT

FAIL_ACT:
        MOV R1, #5
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT
`,
      },
    },
    {
      path: '/opt/firmware/motion/default-profile.bin',
      content: {
        ru: `MOTION PROFILE IMAGE / DIAGNOSTIC VIEW ONLY

FORMAT=MCPR-2
HEADER=VALID
PAYLOAD_BLOCK_00=8F31C0A2
PAYLOAD_BLOCK_01=8F31????
CRC_EXPECTED=8F31-C0A2
CRC_READ=8F31-0000
STATE=CORRUPTED

Это бинарный профиль. Текстовый просмотр показывает только метаданные.
Восстанавливайте профиль через редактор команд, а не редактированием этого текста.`,
        en: `MOTION PROFILE IMAGE / DIAGNOSTIC VIEW ONLY

FORMAT=MCPR-2
HEADER=VALID
PAYLOAD_BLOCK_00=8F31C0A2
PAYLOAD_BLOCK_01=8F31????
CRC_EXPECTED=8F31-C0A2
CRC_READ=8F31-0000
STATE=CORRUPTED

This is a binary profile. The text view exposes metadata only.
Restore it through the command editor, not by editing this text file.`,
      },
    },
    {
      path: '/opt/analyzer/channel-map.cfg',
      content: {
        ru: `ANL-450 / SENSOR CHANNEL MAP

CONTROLLER_RAIL=AUX_DIAG
CHANNEL_A_SOURCE=BODY_SENSOR_RAIL
CHANNEL_A_STATUS=NO_FEED
CHANNEL_B_SOURCE=BODY_SENSOR_RAIL
CHANNEL_B_STATUS=DISABLED

Контроллер анализатора и измерительные каналы питаются раздельно.
После запуска контроллера проверьте оба канала в панели анализатора:
- NO_FEED означает отсутствие физического питания на входе;
- DISABLED означает, что источник доступен, но канал не запущен.`,
        en: `ANL-450 / SENSOR CHANNEL MAP

CONTROLLER_RAIL=AUX_DIAG
CHANNEL_A_SOURCE=BODY_SENSOR_RAIL
CHANNEL_A_STATUS=NO_FEED
CHANNEL_B_SOURCE=BODY_SENSOR_RAIL
CHANNEL_B_STATUS=DISABLED

The analyzer controller and measurement channels use separate power paths.
After starting the controller, inspect both channels in the analyzer UI:
- NO_FEED means the physical supply is missing;
- DISABLED means the source is available but the channel is not running.`,
      },
    },
    {
      path: '/var/log/analyzer.log',
      content: {
        ru: `ANL-450 / SELF-TEST LOG

Controller response: OK (auxiliary rail)
Channel A: FAIL / supply voltage = 0.0 V
Channel B: READY / enable bit = 0
Measurement service: LOCKED

Нельзя считать анализатор исправным только потому, что его интерфейс открылся.
Для прохождения самотеста должны работать оба измерительных канала.`,
        en: `ANL-450 / SELF-TEST LOG

Controller response: OK (auxiliary rail)
Channel A: FAIL / supply voltage = 0.0 V
Channel B: READY / enable bit = 0
Measurement service: LOCKED

The analyzer is not healthy just because its interface opens.
Both measurement channels must be active to pass self-test.`,
      },
    },
    {
      path: '/sys/body/assembly-map.cfg',
      content: {
        ru: `BODY ASSEMBLY INVENTORY / LAST VERIFIED

TORSO: PRESENT
LEFT_ARM: PRESENT
RIGHT_ARM: MODULE NOT DETECTED
LEFT_LEG_UPPER: PRESENT
LEFT_LEG_LOWER: MODULE NOT DETECTED (disconnect at knee joint)
RIGHT_LEG: PRESENT

Список описывает физически обнаруженные узлы, а не только их питание.
Если модуль не обнаружен после включения BODY_MAIN, проверьте шину приводов,
разъёмы и регистрацию аппаратуры.`,
        en: `BODY ASSEMBLY INVENTORY / LAST VERIFIED

TORSO: PRESENT
LEFT_ARM: PRESENT
RIGHT_ARM: MODULE NOT DETECTED
LEFT_LEG_UPPER: PRESENT
LEFT_LEG_LOWER: MODULE NOT DETECTED (disconnect at knee joint)
RIGHT_LEG: PRESENT

This list describes physically detected assemblies, not only their power state.
If a module remains absent after BODY_MAIN is powered, inspect the actuator bus,
connectors, and hardware registry.`,
      },
    },
    {
      path: '/sys/memory/motion-command-store.txt',
      content: {
        ru: `MCM-740 / MOTION COMMAND STORE

Image: /opt/firmware/motion/default-profile.bin
Expected CRC32: 8F31-C0A2
Read CRC32:     8F31-0000
Validation: FAILED
Last writer: interrupted recovery session

Система блокирует отправку команд движения, пока профиль команд не пройдёт
проверку целостности. Неисправность памяти команд не равна неисправности
самих приводов. Найдите описание формата профиля и последовательности запуска.`,
        en: `MCM-740 / MOTION COMMAND STORE

Image: /opt/firmware/motion/default-profile.bin
Expected CRC32: 8F31-C0A2
Read CRC32:     8F31-0000
Validation: FAILED
Last writer: interrupted recovery session

Motion commands are blocked until the command profile passes integrity checks.
A command-store fault is not the same as a failed actuator. Find the profile
format and startup sequence documentation.`,
      },
    },
    {
      path: '/usr/share/docs/motion-control.txt',
      content: {
        ru: `MOTION CONTROL / OPERATOR NOTES

Контур движения состоит из четырёх уровней:
1. MCM-740 — хранит профиль и таблицу команд.
2. LOC-630 — преобразует цель движения в управляющую последовательность.
3. BAL-640 — стабилизирует положение корпуса.
4. ACT-610 и SRV-620 — доставляют команды исполнительным механизмам.

Если команда принята консолью, но тело не реагирует, проверяйте по цепочке:
MCM-740 -> RTS-711 -> LOC-630 -> ACT-610 -> SRV-620.

Не отправляйте команды движения при статусе PROFILE_CRC=FAILED.
После восстановления профиля выполните проверку без нагрузки перед тестом тела.`,
        en: `MOTION CONTROL / OPERATOR NOTES

The motion-control path has four layers:
1. MCM-740 stores the profile and command table.
2. LOC-630 converts a motion goal into a control sequence.
3. BAL-640 stabilizes the body posture.
4. ACT-610 and SRV-620 deliver commands to the actuators.

If the console accepts a command but the body does not move, check in order:
MCM-740 -> RTS-711 -> LOC-630 -> ACT-610 -> SRV-620.

Do not issue motion commands while PROFILE_CRC=FAILED.
After restoring the profile, run an unloaded check before the body test.`,
      },
    },
    {
      path: '/usr/share/docs/body-startup-sequence.txt',
      content: {
        ru: `BODY STARTUP / RECOVERY SEQUENCE

Профиль предназначен для безопасной инициализации после ремонта.

1. VERIFY_POWER(PWR-100, PDU-230)
2. VERIFY_RAIL(BUS-T-240)
3. VERIFY_COOLING(TMP-810, CLG-820)
4. VERIFY_COMMAND_PROFILE(MCM-740)
5. INITIALIZE_SCHEDULER(RTS-711)
6. DISCOVER_ACTUATORS(ACT-610, SRV-620)
7. CALIBRATE_BALANCE(IMU-430, FRC-440)
8. ENABLE_MOTION(LOC-630)
9. ENABLE_VISION(CAM-410)

Условие безопасности: шаги 4 и 3 должны пройти до шага 8.
Профиль не должен обходить аппаратные блокировки и не может восстановить
физически отсутствующие сборки — они должны быть обнаружены отдельно.`,
        en: `BODY STARTUP / RECOVERY SEQUENCE

This profile is intended for safe initialization after repair.

1. VERIFY_POWER(PWR-100, PDU-230)
2. VERIFY_RAIL(BUS-T-240)
3. VERIFY_COOLING(TMP-810, CLG-820)
4. VERIFY_COMMAND_PROFILE(MCM-740)
5. INITIALIZE_SCHEDULER(RTS-711)
6. DISCOVER_ACTUATORS(ACT-610, SRV-620)
7. CALIBRATE_BALANCE(IMU-430, FRC-440)
8. ENABLE_MOTION(LOC-630)
9. ENABLE_VISION(CAM-410)

Safety rule: steps 4 and 3 must pass before step 8.
The profile must not bypass hardware interlocks and cannot restore physically
missing assemblies; those must be detected separately.`,
      },
    },
    {
      path: RASM_DOC_PATH,
      content: {
        ru: `RASM 1.0 — СПРАВОЧНИК ПО ЯЗЫКУ
=============================
RASM (Robot Assembly) — язык программирования роботов Forgotten Gears.
Регистр букв не важен. Комментарий начинается с ";".
Одна инструкция на строку; операнды разделяются запятой: MOV R0, #5.

ИСХОДНИК
  START:  MOV R0, #1    ; метка и инструкция
  DONE:                 ; метка на отдельной строке
          HALT
  A: B: HALT            ; несколько меток
  Числа: 80 или 0x50. Отрицательных чисел нет.

МАШИНА
  R0..R7         8 регистров по 16 бит (0..65535)
  RAM            256 ячеек [0x00..0xFF], по 16 бит
  PC             номер текущей инструкции
  Флаг CMP       =, < или >; сбрасывается при сбросе машины
  Вся арифметика выполняется по модулю 65536.

ОПЕРАНДЫ
  R3          регистр
  #80 #0x50   непосредственное значение
  [0x20]      ячейка RAM
  OVERHEAT    метка перехода
  TEMP MOTOR  имя порта устройства

ИНСТРУКЦИИ
  NOP                ничего, один такт
  MOV dst, src       dst = src
  LOAD dst, [addr]   dst = RAM[addr]
  STORE [addr], src  RAM[addr] = src
  ADD dst, src       dst = (dst + src) mod 65536
  SUB dst, src       dst = (dst - src) mod 65536
  CMP a, b           сравнить a и b, задать флаг
  JMP label          безусловный переход
  JE label           переход, если равно
  JNE label          переход, если не равно
  JGT label          переход, если больше
  JGE label          переход, если больше или равно
  JLT label          переход, если меньше
  JLE label          переход, если меньше или равно
  IN dst, PORT       прочитать значение порта в регистр
  OUT PORT, src      записать значение в порт
  HALT               остановить программу (нормальное завершение)
  src — регистр или #число. Условный переход требует CMP,
  иначе ошибка COMPARE_NOT_SET.

МЕТКИ
  Имя: [A-Za-z_][A-Za-z0-9_]*, затем ":".
  Метка указывает на индекс инструкции, а не на строку.
  Повтор метки — DUPLICATE_LABEL; переход без метки — UNKNOWN_LABEL.

УСТРОЙСТВА
  TEMP   только чтение: температура в градусах Цельсия.
  MOTOR  чтение/запись: 0 — стоп, 1..1000 — скорость.
  Порты задаются уровнем; неподключённый порт даёт
  DEVICE_READ_ERROR или DEVICE_WRITE_ERROR.

ВЫПОЛНЕНИЕ
  Одна инструкция за шаг. Запуск останавливается на HALT,
  ошибке, конце программы или исчерпании бюджета
  (STEP_BUDGET_EXCEEDED). Выход за конец программы — норма.
  Ошибки компиляции блокируют запуск.

ОШИБКИ
  UNKNOWN_INSTRUCTION BAD_ARGUMENT_COUNT BAD_OPERAND BAD_NUMBER
  BAD_REGISTER BAD_ADDRESS TRAILING_TEXT EMPTY_OPERAND
  DUPLICATE_LABEL UNKNOWN_LABEL INVALID_LABEL
  UNKNOWN_DEVICE DEVICE_READ_ERROR DEVICE_WRITE_ERROR
  COMPARE_NOT_SET INVALID_RAM_ACCESS PROCESSOR_HALTED
  STEP_BUDGET_EXCEEDED PROGRAM_NOT_LOADED

ПРИМЕР: ТЕРМОСТАТ
  MOV R0, #0
  MOV R1, #80
LOOP: IN R3, TEMP
  CMP R3, R1
  JGE OVERHEAT
  ADD R0, #10
  OUT MOTOR, R0
  JMP LOOP
OVERHEAT:
  OUT MOTOR, #0
  HALT

ОТЛАДЧИК RASM (консоль: rasm)
  F5/R запуск, F8/S шаг, F9/G сброс, F10/B точка останова,
  C сборка, M режим DEMO/ROBOT, TAB панель, ESC выход.
  Проверка файла: rasm check /путь/файл.rasm
  Редактор: :check собирает, :run запускает .rasm.
`,
        en: `RASM 1.0 — LANGUAGE REFERENCE
=============================
RASM (Robot Assembly) is the robot programming language of Forgotten Gears.
Mnemonics, registers, labels and devices are case-insensitive.
One instruction per line; operands are comma-separated: MOV R0, #5.
A semicolon starts a comment.

SOURCE
  START:  MOV R0, #1    ; label and instruction
  DONE:                 ; label on its own line
          HALT
  A: B: HALT            ; several labels
  Numbers are decimal (80) or hexadecimal (0x50). No negative values.

MACHINE
  R0..R7         8 general registers, 16-bit (0..65535)
  RAM            256 cells [0x00..0xFF], 16 bits each
  PC             current instruction index
  CMP flag       =, < or >; cleared when the machine is reset
  All arithmetic wraps modulo 65536.

OPERANDS
  R3          register
  #80 #0x50   immediate value
  [0x20]      RAM cell
  OVERHEAT    jump label
  TEMP MOTOR  device port name

INSTRUCTIONS
  NOP                do nothing for one tick
  MOV dst, src       dst = src
  LOAD dst, [addr]   dst = RAM[addr]
  STORE [addr], src  RAM[addr] = src
  ADD dst, src       dst = (dst + src) mod 65536
  SUB dst, src       dst = (dst - src) mod 65536
  CMP a, b           compare a and b, set the flag
  JMP label          unconditional jump
  JE label           jump if equal
  JNE label          jump if not equal
  JGT label          jump if greater
  JGE label          jump if greater or equal
  JLT label          jump if smaller
  JLE label          jump if smaller or equal
  IN dst, PORT       read a port into a register
  OUT PORT, src      write a value to a port
  HALT               stop the program (normal end)
  src is a register or #number. A conditional jump requires CMP,
  otherwise it raises COMPARE_NOT_SET.

LABELS
  Name: [A-Za-z_][A-Za-z0-9_]*, followed by ":".
  A label points to an instruction index, not a source line.
  A repeated label is DUPLICATE_LABEL; a missing one is UNKNOWN_LABEL.

DEVICES
  TEMP  read only: temperature in degrees Celsius.
  MOTOR read/write: 0 = stop, 1..1000 = speed.
  Port names are level-defined. An unconnected port raises
  DEVICE_READ_ERROR or DEVICE_WRITE_ERROR.

EXECUTION
  One instruction per step. A run stops at HALT, an error,
  the end of the program or the instruction budget
  (STEP_BUDGET_EXCEEDED). Running past the end is normal.
  Compile errors prevent running.

ERRORS
  UNKNOWN_INSTRUCTION BAD_ARGUMENT_COUNT BAD_OPERAND BAD_NUMBER
  BAD_REGISTER BAD_ADDRESS TRAILING_TEXT EMPTY_OPERAND
  DUPLICATE_LABEL UNKNOWN_LABEL INVALID_LABEL
  UNKNOWN_DEVICE DEVICE_READ_ERROR DEVICE_WRITE_ERROR
  COMPARE_NOT_SET INVALID_RAM_ACCESS PROCESSOR_HALTED
  STEP_BUDGET_EXCEEDED PROGRAM_NOT_LOADED

EXAMPLE: THERMAL GOVERNOR
  MOV R0, #0
  MOV R1, #80
LOOP: IN R3, TEMP
  CMP R3, R1
  JGE OVERHEAT
  ADD R0, #10
  OUT MOTOR, R0
  JMP LOOP
OVERHEAT:
  OUT MOTOR, #0
  HALT

RASM DEBUGGER (console: rasm)
  F5/R run, F8/S step, F9/G reset, F10/B breakpoint,
  C compile, M DEMO/ROBOT mode, TAB pane, ESC exit.
  Check a file: rasm check /path/file.rasm
  Editor: :check compiles, :run starts a .rasm file.
`,
      },
    },
    {
      path: '/etc/motion/controller.cfg',
      content: {
        ru: `# LOC-630 / MOTION CONTROLLER
PROFILE=/sys/memory/motion-command-store.txt
REQUIRE_CRC=1
REQUIRE_RTS=1
REQUIRE_ACTUATOR_BUS=1
BODY_TEST_REQUIRES_COOLING=1

# Do not disable safety interlocks to bypass startup validation.`,
        en: `# LOC-630 / MOTION CONTROLLER
PROFILE=/sys/memory/motion-command-store.txt
REQUIRE_CRC=1
REQUIRE_RTS=1
REQUIRE_ACTUATOR_BUS=1
BODY_TEST_REQUIRES_COOLING=1

# Do not disable safety interlocks to bypass startup validation.`,
      },
    },
    {
      path: '/etc/thermal/cooling.cfg',
      content: {
        ru: `CLG-820 / COOLING CONTROL CONFIGURATION

PUMP_STATUS=UNVERIFIED
FLOW_SENSOR=TMP-810
FLOW_CALIBRATION=INVALID
THERMAL_INTERLOCK=ENABLED

Управление движением должно оставаться заблокированным, пока поток охлаждения
не подтверждён. Проверка охлаждения проводится до нагрузочного теста приводов.
Перезапуск системы не исправляет калибровку контура.`,
        en: `CLG-820 / COOLING CONTROL CONFIGURATION

PUMP_STATUS=UNVERIFIED
FLOW_SENSOR=TMP-810
FLOW_CALIBRATION=INVALID
THERMAL_INTERLOCK=ENABLED

Motion must remain locked until cooling flow is verified.
Check cooling before running a loaded actuator test.
Restarting the system does not repair loop calibration.`,
      },
    },
    {
      path: '/var/log/thermal.log',
      content: {
        ru: `THERMAL EVENT LOG / RECOVERY-17

Previous session: motion test started with unverified coolant flow.
Motor driver temperature exceeded the safe threshold.
PDU-230 triggered protective reset of BODY_MAIN and ACTUATOR_BUS.
Volatile motion configuration was lost; affected rails returned to DISABLED.

Это можно предотвратить: сначала завершите самопроверку CLG-820 и TMP-810,
затем запускайте приводную нагрузку. Перезапуск — аварийная защита, не ремонт.`,
        en: `THERMAL EVENT LOG / RECOVERY-17

Previous session: motion test started with unverified coolant flow.
Motor driver temperature exceeded the safe threshold.
PDU-230 triggered protective reset of BODY_MAIN and ACTUATOR_BUS.
Volatile motion configuration was lost; affected rails returned to DISABLED.

Prevention: complete the CLG-820 and TMP-810 self-test before applying actuator
load. The reset is a safety response, not a repair.`,
      },
    },
    {
      path: '/var/log/motion.log',
      content: {
        ru: `MOTION SERVICE / LAST ATTEMPT

Command received: TEST_STAND
Command parsed: YES
MCM-740 profile verification: FAILED
LOC-630 dispatch: REJECTED
ACT-610 bus request: NOT SENT

Интерпретация: отсутствие движения само по себе не доказывает отказ сервоприводов.
Проверьте целостность командного профиля до проверки механики.`,
        en: `MOTION SERVICE / LAST ATTEMPT

Command received: TEST_STAND
Command parsed: YES
MCM-740 profile verification: FAILED
LOC-630 dispatch: REJECTED
ACT-610 bus request: NOT SENT

Interpretation: no motion does not by itself prove that the servo drives failed.
Verify the command profile before diagnosing the mechanics.`,
      },
    },
    {
      path: '/opt/firmware/motion/thermal_governor.rasm',
      content: {
        ru: `; ============================================================
;  RASM 1.0 example — "thermal governor"
; ============================================================
;  Reads the TEMP sensor, and while the robot is cooler than
;  80 degrees it ramps the MOTOR speed up by 10 each pass.
;  Once the limit is reached it stops the motor and halts.
;
;  Try it in the RASM window (console command: rasm):
;    F5 / R   run
;    F8 / S   step one instruction
;    F9       reset
;    F10 / B  toggle a breakpoint on the current line
; ============================================================

        MOV R0, #0          ; R0 = motor speed
        MOV R1, #80         ; R1 = temperature limit
        MOV R2, #0x20       ; R2 = scratch address in RAM (0x20 = 32)

LOOP:   IN  R3, TEMP        ; read the thermal sensor into R3
        CMP R3, R1          ; compare temperature with the limit
        JGE OVERHEAT        ; hot enough? stop the motor

        ADD R0, #10         ; ramp the speed up by 10
        OUT MOTOR, R0       ; send the speed to the motor
        STORE [0x20], R0    ; remember the last speed in RAM
        JMP LOOP            ; repeat while it is safe

OVERHEAT:
        OUT MOTOR, #0       ; cut the motor
        LOAD R4, [0x20]     ; R4 = last speed we reached
        HALT                ; done
`,
        en: `; ============================================================
;  RASM 1.0 example — "thermal governor"
; ============================================================
;  Reads the TEMP sensor, and while the robot is cooler than
;  80 degrees it ramps the MOTOR speed up by 10 each pass.
;  Once the limit is reached it stops the motor and halts.
;
;  Try it in the RASM window (console command: rasm):
;    F5 / R   run
;    F8 / S   step one instruction
;    F9       reset
;    F10 / B  toggle a breakpoint on the current line
; ============================================================

        MOV R0, #0          ; R0 = motor speed
        MOV R1, #80         ; R1 = temperature limit
        MOV R2, #0x20       ; R2 = scratch address in RAM (0x20 = 32)

LOOP:   IN  R3, TEMP        ; read the thermal sensor into R3
        CMP R3, R1          ; compare temperature with the limit
        JGE OVERHEAT        ; hot enough? stop the motor

        ADD R0, #10         ; ramp the speed up by 10
        OUT MOTOR, R0       ; send the speed to the motor
        STORE [0x20], R0    ; remember the last speed in RAM
        JMP LOOP            ; repeat while it is safe

OVERHEAT:
        OUT MOTOR, #0       ; cut the motor
        LOAD R4, [0x20]     ; R4 = last speed we reached
        HALT                ; done
`,
      },
    },
  ]

  private readonly fileByPath = new Map(this.files.map((file) => [file.path, file]))

  /** Pristine shipped state, used to start a brand-new session. */
  private readonly initialSnapshot: VirtualFileSystemSnapshot

  constructor() {
    // One RASM source per service process. The files are shipped, editable and
    // bound to the process table through their PID (see runtime/servicePrograms).
    for (const program of SERVICE_PROGRAMS) {
      const path = serviceProgramPath(program.file)
      const file: VirtualFile = {
        path,
        content: { ru: program.source, en: program.source },
      }
      this.files.push(file)
      this.fileByPath.set(path, file)
    }

    this.initialSnapshot = this.serialize()
  }

  list(path = '/', language: VirtualFileLanguage = 'ru'): string[] {
    const normalized = this.normalizePath(path)
    if (this.fileByPath.has(normalized)) {
      return [language === 'ru' ? `ФАЙЛ: ${normalized}` : `FILE: ${normalized}`]
    }
    if (!this.directories.has(normalized)) {
      return [language === 'ru' ? `ОШИБКА: ПУТЬ НЕ НАЙДЕН: ${normalized}` : `ERROR: PATH NOT FOUND: ${normalized}`]
    }

    const childDirs = [...this.directories]
      .filter((dir) => dir !== normalized && this.parentPath(dir) === normalized)
      .map((dir) => `${dir.slice(normalized === '/' ? 1 : normalized.length + 1)}/`)
    const childFiles = this.files
      .filter((file) => this.parentPath(file.path) === normalized)
      .map((file) => file.path.slice(normalized === '/' ? 1 : normalized.length + 1))

    const entries = [...childDirs.sort(), ...childFiles.sort()]
    if (entries.length === 0) return [language === 'ru' ? '(пусто)' : '(empty)']
    return [language === 'ru' ? `СОДЕРЖИМОЕ ${normalized}` : `CONTENTS OF ${normalized}`, ...entries]
  }

  read(path: string, language: VirtualFileLanguage = 'ru'): string[] | null {
    const normalized = this.normalizePath(path)
    const file = this.fileByPath.get(normalized)
    if (!file) return null
    return file.content[language].split('\n')
  }

  /** Save text into an existing virtual file. No host filesystem is accessed. */
  write(path: string, content: string, language?: VirtualFileLanguage): boolean {
    return this.writeEx(path, content, language).ok
  }

  /** Save text and report why the write was refused (quota, missing file, ...). */
  writeEx(path: string, content: string, language?: VirtualFileLanguage): VirtualFileResult {
    const normalized = this.normalizePath(path)
    const file = this.fileByPath.get(normalized)
    if (!file) return { ok: false, error: 'NOT_FOUND', path: normalized }

    const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const incoming = byteLength(text)
    if (incoming > VFS_LIMITS.maxFileBytes) return { ok: false, error: 'FILE_TOO_LARGE', path: normalized }

    const oldActive = language ? byteLength(file.content[language]) : byteLength(file.content.ru) + byteLength(file.content.en)
    const newActive = language ? incoming : incoming * 2
    const otherBytes = byteLength(file.content.ru) + byteLength(file.content.en) - oldActive
    if (otherBytes + newActive > VFS_LIMITS.maxFileBytes) {
      return { ok: false, error: 'FILE_TOO_LARGE', path: normalized }
    }
    if (this.usageBytes() - oldActive + newActive > VFS_LIMITS.maxTotalBytes) {
      return { ok: false, error: 'NO_SPACE', path: normalized }
    }

    if (language) {
      file.content[language] = text
    } else {
      file.content.ru = text
      file.content.en = text
    }
    return { ok: true, path: normalized }
  }

  /** Create a new in-memory file. Both language copies start with the same text. */
  create(path: string, content = ''): VirtualFileResult {
    const normalized = this.normalizePath(path)
    const nameError = this.validateName(normalized)
    if (nameError) return { ok: false, error: nameError, path: normalized }

    if (this.fileByPath.has(normalized) || this.directories.has(normalized)) {
      return { ok: false, error: 'ALREADY_EXISTS', path: normalized }
    }
    if (!this.directories.has(this.parentPath(normalized))) {
      return { ok: false, error: 'PARENT_MISSING', path: normalized }
    }

    const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const incoming = byteLength(text)
    if (incoming > VFS_LIMITS.maxFileBytes) return { ok: false, error: 'FILE_TOO_LARGE', path: normalized }
    if (this.files.length + 1 > VFS_LIMITS.maxFiles) return { ok: false, error: 'FILE_LIMIT', path: normalized }
    if (this.usageBytes() + incoming * 2 > VFS_LIMITS.maxTotalBytes) {
      return { ok: false, error: 'NO_SPACE', path: normalized }
    }

    const file: VirtualFile = { path: normalized, content: { ru: text, en: text }, user: true }
    this.files.push(file)
    this.fileByPath.set(normalized, file)
    return { ok: true, path: normalized }
  }

  /** Remove a session-created file. Shipped system files are protected. */
  remove(path: string): VirtualFileResult {
    const normalized = this.normalizePath(path)
    const file = this.fileByPath.get(normalized)
    if (!file) return { ok: false, error: 'NOT_FOUND', path: normalized }
    if (!file.user) return { ok: false, error: 'PROTECTED', path: normalized }

    this.files.splice(this.files.indexOf(file), 1)
    this.fileByPath.delete(normalized)
    return { ok: true, path: normalized }
  }

  /** Rename a session-created file. System files keep their shipped paths. */
  rename(from: string, to: string): VirtualFileResult {
    const source = this.normalizePath(from)
    const target = this.normalizePath(to)
    const file = this.fileByPath.get(source)
    if (!file) return { ok: false, error: 'NOT_FOUND', path: source }
    if (!file.user) return { ok: false, error: 'PROTECTED', path: source }
    if (source === target) return { ok: true, path: source }

    const nameError = this.validateName(target)
    if (nameError) return { ok: false, error: nameError, path: target }
    if (this.fileByPath.has(target) || this.directories.has(target)) {
      return { ok: false, error: 'ALREADY_EXISTS', path: target }
    }
    if (!this.directories.has(this.parentPath(target))) {
      return { ok: false, error: 'PARENT_MISSING', path: target }
    }

    this.files.splice(this.files.indexOf(file), 1)
    this.fileByPath.delete(source)
    file.path = target
    this.files.push(file)
    this.fileByPath.set(target, file)
    return { ok: true, path: target }
  }

  exists(path: string): boolean {
    return this.fileByPath.has(this.normalizePath(path))
  }

  /** True when the path names a directory of this filesystem. */
  isDirectory(path: string): boolean {
    return this.directories.has(this.normalizePath(path))
  }

  /**
   * Resolve a user-entered path against the shell working directory, the same
   * way cmd resolves relative paths: absolute inputs are normalized as-is,
   * relative ones are joined onto `cwd` before `.` and `..` are applied.
   */
  resolvePath(cwd: string, path: string): string {
    const raw = path.trim().replace(/\\/g, '/')
    if (!raw) return this.normalizePath(cwd)
    if (raw.startsWith('/')) return this.normalizePath(raw)
    return this.normalizePath(`${cwd}/${raw}`)
  }

  /** Create a directory inside an existing one; the session may hold up to `VFS_LIMITS.maxDirectories`. */
  makeDirectory(path: string): VirtualFileResult {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return { ok: false, error: 'ALREADY_EXISTS', path: normalized }
    const nameError = this.validateName(normalized)
    if (nameError) return { ok: false, error: nameError, path: normalized }
    if (this.directories.has(normalized) || this.fileByPath.has(normalized)) {
      return { ok: false, error: 'ALREADY_EXISTS', path: normalized }
    }
    if (!this.directories.has(this.parentPath(normalized))) {
      return { ok: false, error: 'PARENT_MISSING', path: normalized }
    }
    if (this.directories.size + 1 > VFS_LIMITS.maxDirectories) {
      return { ok: false, error: 'DIR_LIMIT', path: normalized }
    }
    this.directories.add(normalized)
    this.userDirectories.add(normalized)
    return { ok: true, path: normalized }
  }

  /** Remove an empty session-created directory; shipped and non-empty ones stay. */
  removeDirectory(path: string): VirtualFileResult {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return { ok: false, error: 'PROTECTED', path: normalized }
    if (!this.directories.has(normalized)) return { ok: false, error: 'NOT_FOUND', path: normalized }
    if (!this.userDirectories.has(normalized)) return { ok: false, error: 'PROTECTED', path: normalized }

    const hasChildren = [...this.directories, ...this.files.map((file) => file.path)]
      .some((entry) => entry !== normalized && this.parentPath(entry) === normalized)
    if (hasChildren) return { ok: false, error: 'DIR_NOT_EMPTY', path: normalized }

    this.directories.delete(normalized)
    this.userDirectories.delete(normalized)
    return { ok: true, path: normalized }
  }

  /** Size metadata for one file; both language copies are counted. */
  stat(path: string): { path: string; bytes: number; lines: number; user: boolean } | null {
    const normalized = this.normalizePath(path)
    const file = this.fileByPath.get(normalized)
    if (!file) return null
    const bytes = byteLength(file.content.ru) + byteLength(file.content.en)
    return { path: file.path, bytes, lines: file.content.ru.split('\n').length, user: Boolean(file.user) }
  }

  /** Deep copy of the whole virtual filesystem, for a save slot. */
  serialize(): VirtualFileSystemSnapshot {
    return {
      files: this.files.map((file) => ({
        path: file.path,
        content: { ru: file.content.ru, en: file.content.en },
        user: Boolean(file.user),
      })),
      directories: [...this.directories],
      userDirectories: [...this.userDirectories],
    }
  }

  /**
   * Replace the live filesystem with a snapshot. Invalid or incomplete data
   * falls back to the shipped files, so a broken save can never leave the
   * filesystem without its root directory.
   */
  restore(snapshot: VirtualFileSystemSnapshot | null | undefined): void {
    if (!snapshot || !Array.isArray(snapshot.files) || !Array.isArray(snapshot.directories)) {
      this.restore(this.initialSnapshot)
      return
    }

    this.files.length = 0
    this.fileByPath.clear()
    this.directories.clear()
    this.userDirectories.clear()

    this.directories.add('/')
    for (const directory of snapshot.directories) {
      if (typeof directory !== 'string' || !directory.startsWith('/')) continue
      this.directories.add(this.normalizePath(directory))
    }

    const seen = new Set<string>()
    for (const entry of snapshot.files) {
      if (!entry || typeof entry.path !== 'string') continue
      if (this.files.length >= VFS_LIMITS.maxFiles) break
      const path = this.normalizePath(entry.path)
      if (path === '/' || seen.has(path)) continue
      const ru = typeof entry.content?.ru === 'string' ? entry.content.ru : ''
      const en = typeof entry.content?.en === 'string' ? entry.content.en : ru
      if (byteLength(ru) + byteLength(en) > VFS_LIMITS.maxFileBytes) continue
      const file: VirtualFile = { path, content: { ru, en }, user: Boolean(entry.user) }
      this.files.push(file)
      this.fileByPath.set(path, file)
      seen.add(path)
    }

    for (const directory of snapshot.userDirectories ?? []) {
      const path = typeof directory === 'string' ? this.normalizePath(directory) : ''
      if (path && this.directories.has(path)) this.userDirectories.add(path)
    }

    // Quotas may have changed since the save was written; refuse an overfull
    // snapshot rather than entering a state the rest of the game cannot edit.
    if (this.usageBytes() > VFS_LIMITS.maxTotalBytes) this.restore(this.initialSnapshot)
  }

  /** Return to the shipped files (new game). */
  reset(): void {
    this.restore(this.initialSnapshot)
  }

  /** Current fill levels against the quotas, used by every storage UI. */
  getStorageUsage(): VirtualStorageUsage {
    let largest = 0
    for (const file of this.files) {
      const size = byteLength(file.content.ru) + byteLength(file.content.en)
      if (size > largest) largest = size
    }
    const usedBytes = this.usageBytes()
    const fileCount = this.files.length
    return {
      fileCount,
      maxFiles: VFS_LIMITS.maxFiles,
      directoryCount: this.directories.size,
      maxDirectories: VFS_LIMITS.maxDirectories,
      usedBytes,
      maxBytes: VFS_LIMITS.maxTotalBytes,
      largestFileBytes: largest,
      fileRatio: Math.max(0, Math.min(1, fileCount / VFS_LIMITS.maxFiles)),
      byteRatio: Math.max(0, Math.min(1, usedBytes / VFS_LIMITS.maxTotalBytes)),
    }
  }

  private usageBytes(): number {
    let total = 0
    for (const file of this.files) total += byteLength(file.content.ru) + byteLength(file.content.en)
    return total
  }

  private validateName(normalizedPath: string): VirtualFileErrorCode | null {
    const name = normalizedPath.split('/').filter(Boolean).pop() ?? ''
    if (!name || name.length > 64) return 'INVALID_NAME'
    if (/[<>:"\\|?*]/.test(name)) return 'INVALID_NAME'
    if (name.endsWith('.') || name.endsWith(' ')) return 'INVALID_NAME'
    return null
  }

  find(query: string, language: VirtualFileLanguage = 'ru'): VirtualFileMatch[] {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []

    const matches: VirtualFileMatch[] = []
    for (const file of this.files) {
      const content = file.content[language]
      const line = content.split('\n').find((entry) => entry.toLocaleLowerCase().includes(needle))
      if (file.path.toLocaleLowerCase().includes(needle) || line !== undefined) {
        matches.push({
          path: file.path,
          preview: line?.trim() ?? (language === 'ru' ? 'Совпадение в пути файла' : 'Match in file path'),
        })
      }
    }
    return matches
  }

  getPathCandidates(prefix: string, includeDirectories = false): string[] {
    const rawPrefix = prefix.trim()
    if (!rawPrefix) {
      if (includeDirectories) {
        return [...this.directories]
          .filter((dir) => dir !== '/' && this.parentPath(dir) === '/')
          .map((dir) => `/${dir.slice(1)}/`)
          .sort()
      }
      return this.files.map((file) => file.path).sort()
    }

    const normalizedPrefix = this.normalizePath(rawPrefix)
    if (normalizedPrefix === '/' && !includeDirectories) {
      return this.files.map((file) => file.path).sort()
    }

    const hasTrailingSlash = rawPrefix.endsWith('/')
    const slashIndex = normalizedPrefix.lastIndexOf('/')
    const parent = hasTrailingSlash
      ? normalizedPrefix
      : (slashIndex <= 0 ? '/' : normalizedPrefix.slice(0, slashIndex))
    const namePrefix = hasTrailingSlash ? '' : normalizedPrefix.slice(slashIndex + 1).toLowerCase()
    const candidates: string[] = []

    if (includeDirectories) {
      for (const dir of this.directories) {
        if (dir === '/' || this.parentPath(dir) !== parent) continue
        const name = `${dir.slice(parent === '/' ? 1 : parent.length + 1)}/`
        if (name.toLowerCase().startsWith(namePrefix)) {
          candidates.push(`${parent === '/' ? '' : parent}/${name}`)
        }
      }
    }

    for (const file of this.files) {
      if (this.parentPath(file.path) !== parent) continue
      const name = file.path.slice(parent === '/' ? 1 : parent.length + 1)
      if (name.toLowerCase().startsWith(namePrefix)) {
        candidates.push(`${parent === '/' ? '' : parent}/${name}`)
      }
    }
    return [...new Set(candidates)].sort()
  }

  private normalizePath(path: string): string {
    const value = path.trim().replace(/\\/g, '/').toLowerCase()
    const segments: string[] = []
    for (const segment of value.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        segments.pop()
      } else {
        segments.push(segment)
      }
    }
    return `/${segments.join('/')}`
  }

  private parentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const index = normalized.lastIndexOf('/')
    return index <= 0 ? '/' : normalized.slice(0, index)
  }
}
