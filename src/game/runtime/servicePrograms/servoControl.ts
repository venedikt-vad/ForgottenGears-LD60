import type { ServiceProgram } from './types'

/** fg.servo.ctl — SRV-620 joint servo. */
export const servoControlProgram: ServiceProgram = {
  pid: 9,
  name: 'fg.servo.ctl',
  file: 'fg.servo.ctl.rasm',
  source: `; ============================================================
;  fg.servo.ctl — SRV-620 joint servo
; ============================================================
;  Ramps the joint command from rest to the target angle in 10
;  degree steps, then holds the target.
; ============================================================

        MOV R0, #0          ; commanded angle
        MOV R1, #10         ; step
        MOV R2, #90         ; target

RAMP:
        ADD R0, R1
        CMP R0, R2
        JGT LIMIT
        OUT SERVO, R0
        JMP RAMP

LIMIT:
        OUT SERVO, R2
        STORE [0xA0], R2
        HALT
`,
}
