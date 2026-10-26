import type { ServiceProgram } from './types'

/** fg.failsafe — FSF-910 safe-mode controller. */
export const failsafeProgram: ServiceProgram = {
  pid: 19,
  name: 'fg.failsafe',
  file: 'fg.failsafe.rasm',
  source: `; ============================================================
;  fg.failsafe — FSF-910 safe-mode controller
; ============================================================
;  Enters safe mode when cooling is unverified or the body is too
;  hot. A protective stop cuts the drive and raises DIAG.
; ============================================================

        IN  R0, COOL
        CMP R0, #1
        JNE FAILSAFE_TRIP
        IN  R0, TEMP
        CMP R0, #80
        JGE FAILSAFE_TRIP

        MOV R1, #0
        STORE [0xC8], R1    ; safe mode not engaged
        HALT

FAILSAFE_TRIP:
        OUT MOTOR, #0
        OUT DIAG, #1
        MOV R1, #1
        STORE [0xC8], R1    ; safe mode engaged
        HALT
`,
}
