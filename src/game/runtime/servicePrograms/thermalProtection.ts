import type { ServiceProgram } from './types'

/** fg.thermal.prot — THP-830 overheat protection. */
export const thermalProtectionProgram: ServiceProgram = {
  pid: 12,
  name: 'fg.thermal.prot',
  file: 'fg.thermal.prot.rasm',
  source: `; ============================================================
;  fg.thermal.prot — THP-830 overheat protection
; ============================================================
;  Cuts the drive when the body crosses the 80 degree limit.
;  RAM[0xD0] = 1 marks a protective stop.
; ============================================================

        IN  R0, TEMP
        CMP R0, #80
        JGE THERMAL_TRIP

        MOV R1, #0
        STORE [0xD0], R1    ; within limits
        HALT

THERMAL_TRIP:
        OUT MOTOR, #0
        MOV R1, #1
        STORE [0xD0], R1    ; protective stop
        HALT
`,
}
