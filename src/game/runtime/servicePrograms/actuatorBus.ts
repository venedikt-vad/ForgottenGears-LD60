import type { ServiceProgram } from './types'

/** fg.actuator.bus — ACT-610 command dispatch. */
export const actuatorBusProgram: ServiceProgram = {
  pid: 8,
  name: 'fg.actuator.bus',
  file: 'fg.actuator.bus.rasm',
  source: `; ============================================================
;  fg.actuator.bus — ACT-610 command dispatch
; ============================================================
;  Forwards the speed queued in RAM[0x90] to the drive. Commands
;  are clamped to 1000 and are not sent while the body rail is off.
; ============================================================

        IN  R0, BUS
        CMP R0, #1
        JNE BUS_OFFLINE
        IN  R0, ACT
        CMP R0, #1
        JNE BUS_OFFLINE

        LOAD R1, [0x90]     ; queued speed
        CMP R1, #1000
        JGT BUS_CLAMP
        OUT SERVO, R1
        STORE [0x91], R1
        HALT

BUS_CLAMP:
        OUT SERVO, #1000
        MOV R1, #1000
        STORE [0x91], R1
        HALT

BUS_OFFLINE:
        MOV R1, #0          ; command not dispatched
        STORE [0x91], R1
        HALT
`,
}
