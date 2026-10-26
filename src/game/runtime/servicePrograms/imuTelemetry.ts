import type { ServiceProgram } from './types'

/** fg.imu.telemetry — IMU-430 inertial sampler. */
export const imuTelemetryProgram: ServiceProgram = {
  pid: 15,
  name: 'fg.imu.telemetry',
  file: 'fg.imu.telemetry.rasm',
  source: `; ============================================================
;  fg.imu.telemetry — IMU-430 inertial sampler
; ============================================================
;  The inertial node integrates its own three axes; the kernel
;  stores the sample count and the published sequence number.
; ============================================================

        MOV R0, #0          ; samples
        MOV R1, #0          ; published values

INTEGRATE:
        ADD R1, #3          ; three axes per sample
        ADD R0, #1
        STORE [0xFE], R0
        CMP R0, #200
        JLT INTEGRATE
        STORE [0xFF], R1
        HALT
`,
}
