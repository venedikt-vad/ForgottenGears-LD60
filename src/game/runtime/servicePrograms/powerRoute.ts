import type { ServiceProgram } from './types'

/** fg.power.route — PDU-230 rail router. */
export const powerRouteProgram: ServiceProgram = {
  pid: 4,
  name: 'fg.power.route',
  file: 'fg.power.route.rasm',
  source: `; ============================================================
;  fg.power.route — PDU-230 rail router
; ============================================================
;  Confirms the primary source, then reports the BODY_MAIN rail
;  state in RAM[0x50] and the route verdict in RAM[0x51]:
;  1 = healthy, 0 = rail inhibited, 2 = source missing.
; ============================================================

        IN  R0, PWR
        CMP R0, #1
        JNE ROUTE_HOLD

        IN  R1, BUS
        STORE [0x50], R1
        CMP R1, #1
        JNE ROUTE_BODY_OFF

        MOV R2, #1
        STORE [0x51], R2
        HALT

ROUTE_BODY_OFF:
        MOV R2, #0
        STORE [0x51], R2
        HALT

ROUTE_HOLD:
        MOV R2, #2
        STORE [0x51], R2
        HALT
`,
}
