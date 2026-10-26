import type { ServiceProgram } from './types'

/** fg.lidar.scan — LID-420 range sweep. */
export const lidarScanProgram: ServiceProgram = {
  pid: 14,
  name: 'fg.lidar.scan',
  file: 'fg.lidar.scan.rasm',
  source: `; ============================================================
;  fg.lidar.scan — LID-420 range sweep
; ============================================================
;  The scanner shares the vision rail, so it sweeps only while
;  VISION is up. RAM[0xF0] counts the completed sweep steps.
; ============================================================

        IN  R0, VISION
        CMP R0, #1
        JNE SCAN_HOLD

        MOV R1, #0
SCAN:
        ADD R1, #1
        STORE [0xF0], R1
        CMP R1, #64
        JLT SCAN
        HALT

SCAN_HOLD:
        MOV R1, #0
        STORE [0xF0], R1
        HALT
`,
}
