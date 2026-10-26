import type { ServiceProgram } from './types'

/** fg.motion.profile — MCM-740 command profile. */
export const motionProfileProgram: ServiceProgram = {
  pid: 7,
  name: 'fg.motion.profile',
  file: 'fg.motion.profile.rasm',
  source: `; ============================================================
;  fg.motion.profile — MCM-740 command profile
; ============================================================
;  Motion stays locked until the command profile is accepted and
;  the actuator bus is operational. RAM[0x80] carries the verdict.
; ============================================================

        IN  R0, PROFILE
        CMP R0, #1
        JNE PROFILE_BLOCK
        IN  R0, ACT
        CMP R0, #1
        JNE PROFILE_BLOCK

        MOV R1, #1
        STORE [0x80], R1    ; motion released
        HALT

PROFILE_BLOCK:
        MOV R1, #0
        STORE [0x80], R1    ; motion locked
        HALT
`,
}
