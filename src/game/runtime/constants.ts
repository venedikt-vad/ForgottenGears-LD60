import type { LocalText } from './types'

/**
 * Constants of the robot runtime.
 *
 * The body startup program is a real RASM file: the `start` command compiles
 * it and runs it as a process, so the last step of the recovery is executed by
 * the machine instead of being asserted by the console.
 */

/** Path of the body startup program inside the robot's file system. */
export const STARTUP_PROGRAM_PATH = '/opt/firmware/motion/body-startup.rasm'

/**
 * The checks the startup program performs, in the order it performs them.
 *
 * The program writes the index of the failed check into the DIAG latch, so the
 * shell can name the exact repair that is still missing.
 */
export const STARTUP_CHECKS: readonly {
  code: number
  port: string
  componentId: string
  label: LocalText
}[] = [
  {
    code: 1,
    port: 'PWR',
    componentId: 'PWR-100',
    label: { ru: 'первичное питание не подтверждено', en: 'primary power is not confirmed' },
  },
  {
    code: 2,
    port: 'MEM',
    componentId: 'MEM-732',
    label: { ru: 'память ядра не восстановлена', en: 'core memory is not restored' },
  },
  {
    code: 3,
    port: 'PROFILE',
    componentId: 'MCM-740',
    label: { ru: 'профиль движения не прошёл проверку', en: 'motion profile did not pass validation' },
  },
  {
    code: 4,
    port: 'BUS',
    componentId: 'BUS-T-240',
    label: { ru: 'шина питания корпуса не запитана', en: 'body power bus is not energized' },
  },
  {
    code: 5,
    port: 'ACT',
    componentId: 'ACT-610',
    label: { ru: 'шина исполнительных механизмов не в работе', en: 'actuator bus is not operational' },
  },
]

/** Description of one startup check, or null when the code is unknown. */
export function startupCheck(code: number): (typeof STARTUP_CHECKS)[number] | null {
  return STARTUP_CHECKS.find((check) => check.code === code) ?? null
}
