import type { ServiceProgram } from './types'

/** fg.force.fb — FRC-440 force feedback. */
export const forceFeedbackProgram: ServiceProgram = {
  pid: 16,
  name: 'fg.force.fb',
  file: 'fg.force.fb.rasm',
  source: `; ============================================================
;  fg.force.fb — FRC-440 force feedback
; ============================================================
;  Calibrates the force channel against the last drive command.
;  RAM[0x92] counts the calibration samples that saw motion.
; ============================================================

        MOV R0, #0          ; samples with motion
        MOV R1, #12         ; calibration budget

CALIBRATE:
        LOAD R2, [0x91]     ; last actuator command
        CMP R2, #0
        JE  NEXT_SAMPLE
        ADD R0, #1

NEXT_SAMPLE:
        SUB R1, #1
        CMP R1, #0
        JGT CALIBRATE
        STORE [0x92], R0
        HALT
`,
}
