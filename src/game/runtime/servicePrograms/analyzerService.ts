import type { ServiceProgram } from './types'

/** fg.analyzer.svc — ANL-450 measurement service. */
export const analyzerServiceProgram: ServiceProgram = {
  pid: 17,
  name: 'fg.analyzer.svc',
  file: 'fg.analyzer.svc.rasm',
  source: `; ============================================================
;  fg.analyzer.svc — ANL-450 measurement service
; ============================================================
;  Publishes the thermal measurement once the primary source is
;  stable. RAM[0xA9] = 1 means a measurement was published.
; ============================================================

        IN  R0, PWR
        CMP R0, #1
        JNE ANALYZER_OFF

        IN  R1, TEMP
        STORE [0xA8], R1
        MOV R2, #1
        STORE [0xA9], R2
        HALT

ANALYZER_OFF:
        MOV R2, #0
        STORE [0xA9], R2
        HALT
`,
}
