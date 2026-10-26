import type { ServiceProgram } from './types'

/** fg.thermal.mon — TMP-810 telemetry. */
export const thermalMonitorProgram: ServiceProgram = {
  pid: 11,
  name: 'fg.thermal.mon',
  file: 'fg.thermal.mon.rasm',
  source: `; ============================================================
;  fg.thermal.mon — TMP-810 telemetry
; ============================================================
;  Samples the thermal sensor 128 times and keeps the last
;  reading in RAM[0xC0] for the interface windows.
; ============================================================

        MOV R0, #0

SAMPLE:
        IN  R1, TEMP
        STORE [0xC0], R1
        ADD R0, #1
        CMP R0, #128
        JLT SAMPLE
        HALT
`,
}
