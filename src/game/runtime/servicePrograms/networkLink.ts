import type { ServiceProgram } from './types'

/** fg.net.link — NET-510 command link. */
export const networkLinkProgram: ServiceProgram = {
  pid: 18,
  name: 'fg.net.link',
  file: 'fg.net.link.rasm',
  source: `; ============================================================
;  fg.net.link — NET-510 command link
; ============================================================
;  Keeps a heartbeat while the primary source is stable.
;  RAM[0xB8] holds the last heartbeat value.
; ============================================================

        MOV R0, #0

HEARTBEAT:
        IN  R2, PWR
        CMP R2, #1
        JNE LINK_DOWN
        ADD R0, #1
        STORE [0xB8], R0
        CMP R0, #32
        JLT HEARTBEAT
        HALT

LINK_DOWN:
        MOV R0, #0
        STORE [0xB8], R0
        HALT
`,
}
