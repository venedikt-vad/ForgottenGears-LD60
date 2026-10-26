import type { ServiceProgram } from './types'

/** fg.cpu.mgr — compute scheduler. */
export const cpuManagerProgram: ServiceProgram = {
  pid: 2,
  name: 'fg.cpu.mgr',
  file: 'fg.cpu.mgr.rasm',
  source: `; ============================================================
;  fg.cpu.mgr — compute scheduler
; ============================================================
;  One scheduling window is 256 ticks. The manager counts them in
;  RAM[0x40] and records the last tick of a degraded window.
; ============================================================

        MOV R0, #0          ; tick counter
        MOV R1, #256        ; ticks per scheduling window

SCHED:
        IN  R2, MEM         ; memory must stay available
        CMP R2, #1
        JNE SCHED_DEGRADED
        ADD R0, #1
        STORE [0x40], R0
        CMP R0, R1
        JLT SCHED
        HALT

SCHED_DEGRADED:
        STORE [0x41], R0    ; window stopped early
        HALT
`,
}
