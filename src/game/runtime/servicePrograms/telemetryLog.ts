import type { ServiceProgram } from './types'

/** fg.telemetry.log — event log writer. */
export const telemetryLogProgram: ServiceProgram = {
  pid: 92,
  name: 'fg.telemetry.log',
  file: 'fg.telemetry.log.rasm',
  source: `; ============================================================
;  fg.telemetry.log — event log writer
; ============================================================
;  Takes a thermal and battery snapshot for the next record.
;  RAM[0xFA] = 1 marks a complete record.
; ============================================================

        IN  R0, TEMP
        STORE [0xF8], R0
        IN  R1, BATT
        STORE [0xF9], R1
        MOV R2, #1
        STORE [0xFA], R2    ; record ready
        HALT
`,
}
