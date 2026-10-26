import type { ServiceProgram } from './types'

/** fg.power.core — PWR-100 source monitor. */
export const powerCoreProgram: ServiceProgram = {
  pid: 5,
  name: 'fg.power.core',
  file: 'fg.power.core.rasm',
  source: `; ============================================================
;  fg.power.core — PWR-100 source monitor
; ============================================================
;  Samples the source and the battery every tick for 64 ticks.
;  The last pair is kept in RAM[0x60] (source) and RAM[0x61]
;  (battery percent).
; ============================================================

        MOV R0, #0          ; sample counter

MONITOR:
        IN  R1, PWR
        STORE [0x60], R1
        IN  R2, BATT
        STORE [0x61], R2
        ADD R0, #1
        CMP R0, #64
        JLT MONITOR
        HALT
`,
}
