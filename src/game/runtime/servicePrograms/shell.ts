import type { ServiceProgram } from './types'

/** fg.shell — operator shell. */
export const shellProgram: ServiceProgram = {
  pid: 91,
  name: 'fg.shell',
  file: 'fg.shell.rasm',
  source: `; ============================================================
;  fg.shell — operator shell
; ============================================================
;  Mirrors the kernel verdict so the console can report it without
;  reading the latches directly. RAM[0xEA] = 1 means accepted.
; ============================================================

        IN  R0, BOOT
        STORE [0xE8], R0
        IN  R1, DIAG
        STORE [0xE9], R1
        CMP R0, #1
        JNE SHELL_IDLE

        MOV R2, #1
        STORE [0xEA], R2
        HALT

SHELL_IDLE:
        MOV R2, #0
        STORE [0xEA], R2
        HALT
`,
}
