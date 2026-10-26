import type { ServiceProgram } from './types'

/** fg.diag.svc — self-diagnostics. */
export const diagServiceProgram: ServiceProgram = {
  pid: 3,
  name: 'fg.diag.svc',
  file: 'fg.diag.svc.rasm',
  source: `; ============================================================
;  fg.diag.svc — self-diagnostics
; ============================================================
;  Publishes the code of the first subsystem that still blocks the
;  startup: 10 = power, 11 = cooling, 12 = vision.
; ============================================================

        IN  R0, PWR
        CMP R0, #1
        JNE DIAG_POWER
        IN  R0, COOL
        CMP R0, #1
        JNE DIAG_COOL
        IN  R0, VISION
        CMP R0, #1
        JNE DIAG_VISION

        MOV R1, #0          ; every check passed
        OUT DIAG, R1
        HALT

DIAG_POWER:
        OUT DIAG, #10
        HALT

DIAG_COOL:
        OUT DIAG, #11
        HALT

DIAG_VISION:
        OUT DIAG, #12
        HALT
`,
}
