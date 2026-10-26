import type { ServiceProgram } from './types'

/** fg.kernel — OSK-710 supervisor. */
export const kernelProgram: ServiceProgram = {
  pid: 1,
  name: 'fg.kernel',
  file: 'fg.kernel.rasm',
  source: `; ============================================================
;  fg.kernel — OSK-710 supervisor
; ============================================================
;  The kernel releases the body only after the power source and
;  the core memory have reported ready. The verdict is published
;  through the BOOT and DIAG latches read by the shell.
; ============================================================

        IN  R0, PWR         ; primary source ready?
        CMP R0, #1
        JNE KERNEL_FAULT
        IN  R0, MEM         ; core memory validated?
        CMP R0, #1
        JNE KERNEL_FAULT

        MOV R1, #0          ; no failed check
        OUT DIAG, R1
        MOV R1, #1          ; allow the startup program
        OUT BOOT, R1
        HALT

KERNEL_FAULT:
        MOV R1, #1
        OUT DIAG, R1
        MOV R1, #0
        OUT BOOT, R1
        HALT
`,
}
