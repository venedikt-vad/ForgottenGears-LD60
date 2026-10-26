import type { ServiceProgram } from './types'

/** fg.balance.eng — BAL-640 posture loop. */
export const balanceEngineProgram: ServiceProgram = {
  pid: 10,
  name: 'fg.balance.eng',
  file: 'fg.balance.eng.rasm',
  source: `; ============================================================
;  fg.balance.eng — BAL-640 posture loop
; ============================================================
;  Holds the neutral posture while the body is below 70 degrees.
;  A hot body is returned to rest instead of being stabilised.
; ============================================================

        IN  R0, TEMP
        CMP R0, #70
        JGE BALANCE_HOT

        OUT SERVO, #45      ; neutral posture
        MOV R1, #1
        STORE [0xB0], R1    ; stabiliser active
        HALT

BALANCE_HOT:
        OUT SERVO, #0
        MOV R1, #0
        STORE [0xB0], R1    ; stabiliser released
        HALT
`,
}
