import type { ServiceProgram } from './types'

/** fg.fs.service — virtual file service. */
export const fileServiceProgram: ServiceProgram = {
  pid: 90,
  name: 'fg.fs.service',
  file: 'fg.fs.service.rasm',
  source: `; ============================================================
;  fg.fs.service — virtual file service
; ============================================================
;  Mounts the file store only when the core memory is available.
;  RAM[0xD8] mirrors the profile flag, RAM[0xD9] = 1 means mounted.
; ============================================================

        IN  R0, MEM
        CMP R0, #1
        JNE FS_FAULT

        IN  R0, PROFILE
        STORE [0xD8], R0
        MOV R1, #1
        STORE [0xD9], R1    ; mounted
        HALT

FS_FAULT:
        MOV R1, #0
        STORE [0xD9], R1    ; not mounted
        HALT
`,
}
