export type VirtualFileLanguage = 'ru' | 'en'

interface VirtualFile {
  path: string
  content: Record<VirtualFileLanguage, string>
}

export interface VirtualFileMatch {
  path: string
  preview: string
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
    '/usr',
    '/usr/share',
    '/usr/share/docs',
    '/var',
    '/var/log',
  ])

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
cat <путь>           прочитать файл
find <слово>         поиск по путям и содержимому файлов
vim [путь]           открыть Vim-подобный редактор исходников
ui                   открыть панель обслуживания

Рекомендуемый порядок:
1. Прочитать отчёт POST и запустить diagnostics.
2. Проверить источник питания и карту распределения.
3. Не включать движение до проверки охлаждения.
4. После каждого крупного изменения повторять diagnostics.

Чтение доступно из консоли; исходники .drv/.seq можно редактировать через vim. Изменения хранятся в текущем сеансе. Пути начинаются с /.
Имена команд и путей нечувствительны к регистру.`,
        en: `ROBOT OS / OPERATOR QUICK REFERENCE
===================================

help                 list commands
components           list robot components
info <ID>            component information
status               overall system status
diagnostics          fault and dependency report
ls [path]            list directories and files
cat <path>           read a file
find <term>          search file paths and contents
ui                   open service toolbar

Recommended order:
1. Read the POST report and run diagnostics.
2. Inspect the power source and distribution map.
3. Do not enable motion before checking cooling.
4. Run diagnostics again after each major change.

Source .drv/.seq files can be edited with vim; changes persist in the current game session. Paths start at /.
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
  ]

  private readonly fileByPath = new Map(this.files.map((file) => [file.path, file]))

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
    const normalized = this.normalizePath(path)
    const file = this.fileByPath.get(normalized)
    if (!file) return false
    const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (language) {
      file.content[language] = text
    } else {
      file.content.ru = text
      file.content.en = text
    }
    return true
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
