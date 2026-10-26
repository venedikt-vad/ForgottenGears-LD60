import type { ServiceProgram } from './types'

/** fg.vision.stream — CAM-410 stream monitor. */
export const visionStreamProgram: ServiceProgram = {
  pid: 13,
  name: 'fg.vision.stream',
  file: 'fg.vision.stream.rasm',
  source: `; ============================================================
;  fg.vision.stream — CAM-410 stream monitor
; ============================================================
;  Publishes the stream rate only while the body rail and the
;  camera array are up. RAM[0xE0] = frames per second.
; ============================================================

        IN  R0, BUS
        CMP R0, #1
        JNE VISION_DOWN
        IN  R0, VISION
        CMP R0, #1
        JNE VISION_DOWN

        MOV R1, #30
        STORE [0xE0], R1
        HALT

VISION_DOWN:
        MOV R1, #0
        STORE [0xE0], R1
        HALT
`,
}
