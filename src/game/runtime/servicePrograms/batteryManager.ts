import type { ServiceProgram } from './types'

/** fg.battery.mgr — BMS-221 charge supervision. */
export const batteryManagerProgram: ServiceProgram = {
  pid: 6,
  name: 'fg.battery.mgr',
  file: 'fg.battery.mgr.rasm',
  source: `; ============================================================
;  fg.battery.mgr — BMS-221 charge supervision
; ============================================================
;  Raises a recharge request when the pack falls below 20 percent.
;  RAM[0x70] = last reading, RAM[0x71] = 1 when recharge is due.
; ============================================================

        IN  R0, BATT
        CMP R0, #20
        JLT PACK_LOW

        STORE [0x70], R0
        MOV R1, #0
        STORE [0x71], R1    ; normal
        HALT

PACK_LOW:
        STORE [0x70], R0
        MOV R1, #1
        STORE [0x71], R1    ; recharge required
        HALT
`,
}
