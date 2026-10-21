import test from 'node:test'
import assert from 'node:assert/strict'

import { RobotDeviceBus } from '../src/game/runtime/RobotDeviceBus'
import { RobotKernel } from '../src/game/runtime/RobotKernel'
import { STARTUP_PROGRAM_PATH, startupCheck } from '../src/game/runtime/constants'
import type { RobotSystem, RuntimeComponent } from '../src/game/Game'

function makeComponent(status: RuntimeComponent['status']): RuntimeComponent {
  return {
    id: 'TEST',
    name: 'Test',
    category: 'TEST',
    status,
    description: 'test',
    dependencies: [],
    affects: [],
    fault: status === 'ONLINE' ? null : 'broken',
    recommendation: status === 'ONLINE' ? null : 'fix',
    windowId: null,
  }
}

class TestSystem implements RobotSystem {
  private readonly map = new Map<string, RuntimeComponent>()
  reactorRestored = true
  powerGridPuzzleSolved = true
  bodyBusRestored = true
  busBypassRestored = true
  analyzerControllerPowered = true
  coolingRestored = true
  memoryCoreRestored = true
  motionProfileRestored = true
  visionRestored = true
  motionStartupComplete = false
  masterAlarm = false

  constructor(initial: Record<string, RuntimeComponent['status']> = {}) {
    for (const [id, status] of Object.entries(initial)) {
      this.map.set(id, { ...makeComponent(status), id })
    }
  }

  getComponent(id: string): RuntimeComponent | undefined {
    return this.map.get(id)
  }

  getComponentStatus(id: string): RuntimeComponent['status'] {
    return this.map.get(id)?.status ?? 'MISSING'
  }

  listComponents(): RuntimeComponent[] {
    return [...this.map.values()]
  }

  getCounts() {
    const counts = { ONLINE: 0, DEGRADED: 0, CRITICAL: 0, LOCKED: 0, OFFLINE: 0, MISSING: 0 }
    for (const component of this.map.values()) counts[component.status] += 1
    return counts
  }

  getEvents(): any[] { return [] }
  getProgress(): any[] { return [] }
  setComponentStatus(): boolean { return true }
  powerMotionComponents(): boolean { return true }
  restoreBusBypass(): boolean { return true }
  repairMemoryCore(): boolean { return true }
  restoreMotionProfile(): boolean { return true }
  completeBodyStartup(): boolean { this.motionStartupComplete = true; return true }
  log(): void {}
}

const STARTUP_SOURCE = `; body startup
        MOV R0, PWR
        CMP R0, #1
        JNE FAIL1
        MOV R0, MEM
        CMP R0, #1
        JNE FAIL2
        MOV R0, PROFILE
        CMP R0, #1
        JNE FAIL3
        MOV R0, BUS
        CMP R0, #1
        JNE FAIL4
        MOV R0, ACT
        CMP R0, #1
        JNE FAIL5
        OUT DIAG, #0
        OUT BOOT, #1
        HALT
FAIL1:  OUT DIAG, #1
        OUT BOOT, #0
        HALT
FAIL2:  OUT DIAG, #2
        OUT BOOT, #0
        HALT
FAIL3:  OUT DIAG, #3
        OUT BOOT, #0
        HALT
FAIL4:  OUT DIAG, #4
        OUT BOOT, #0
        HALT
FAIL5:  OUT DIAG, #5
        OUT BOOT, #0
        HALT
`

function makeBus(system: TestSystem) {
  return new RobotDeviceBus(system, { temperature: () => 40, batteryPercent: () => 80 })
}

function runToEnd(kernel: RobotKernel, steps = 200): void {
  for (let i = 0; i < steps; i += 1) kernel.tick(0.016)
}

test('kernel launch is blocked without CPU or OSK', () => {
  const system = new TestSystem({ 'CPU-730': 'OFFLINE', 'OSK-710': 'ONLINE' })
  const bus = makeBus(system)
  const kernel = new RobotKernel({ system, bus })
  const result = kernel.launch('MOV R0, #1\nHALT')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HARDWARE_BLOCKED')
})

test('kernel refuses empty source', () => {
  const system = new TestSystem({ 'CPU-730': 'ONLINE', 'OSK-710': 'ONLINE' })
  const bus = makeBus(system)
  const kernel = new RobotKernel({ system, bus })
  const result = kernel.launch('   ')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NO_SOURCE')
})

test('startup program writes DIAG 1 when power is missing', () => {
  const system = new TestSystem({
    'CPU-730': 'ONLINE',
    'OSK-710': 'ONLINE',
    'PWR-100': 'OFFLINE',
    'MEM-732': 'ONLINE',
    'MCM-740': 'ONLINE',
    'BUS-T-240': 'ONLINE',
    'ACT-610': 'ONLINE',
    'SRV-620': 'DEGRADED',
  })
  const bus = makeBus(system)
  const kernel = new RobotKernel({ system, bus })
  const result = kernel.launch(STARTUP_SOURCE, { path: STARTUP_PROGRAM_PATH })
  console.log('DEBUG1', result.ok, result.code, result.message)
  assert.equal(result.ok, true)
  runToEnd(kernel)
  assert.equal(bus.getLatch('DIAG'), 1)
  assert.equal(bus.getLatch('BOOT'), 0)
})

test('startup program writes DIAG 0 and BOOT 1 on success', () => {
  const system = new TestSystem({
    'CPU-730': 'ONLINE',
    'OSK-710': 'ONLINE',
    'PWR-100': 'ONLINE',
    'MEM-732': 'ONLINE',
    'MCM-740': 'ONLINE',
    'BUS-T-240': 'ONLINE',
    'ACT-610': 'ONLINE',
    'SRV-620': 'DEGRADED',
  })
  const bus = makeBus(system)
  const kernel = new RobotKernel({ system, bus })
  const result = kernel.launch(STARTUP_SOURCE, { path: STARTUP_PROGRAM_PATH })
  assert.equal(result.ok, true)
  runToEnd(kernel)
  assert.equal(bus.getLatch('DIAG'), 0)
  assert.equal(bus.getLatch('BOOT'), 1)
})

test('kill suspends and resume works', () => {
  const system = new TestSystem({ 'CPU-730': 'ONLINE', 'OSK-710': 'ONLINE' })
  const bus = makeBus(system)
  const kernel = new RobotKernel({ system, bus })
  const result = kernel.launch('LOOP: JMP LOOP\nHALT')
  assert.ok(result.pid)
  kernel.tick(0.016)
  assert.equal(kernel.get(result.pid!)?.state !== 'STOPPED', true)
  assert.equal(kernel.suspend(result.pid!), true)
  assert.equal(kernel.get(result.pid!)?.state, 'SUSPENDED')
  assert.equal(kernel.resume(result.pid!), true)
  assert.equal(kernel.get(result.pid!)?.state, 'RUNNING')
  assert.equal(kernel.kill(result.pid!), true)
  assert.equal(kernel.get(result.pid!)?.state, 'STOPPED')
})

test('status ports never fail', () => {
  const system = new TestSystem({ 'PWR-100': 'OFFLINE' })
  const bus = makeBus(system)
  const read = bus.read('PWR')
  assert.equal(read.ok, true)
  assert.equal(read.value, 0)
})

test('actuator write refused when actuator bus missing', () => {
  const system = new TestSystem({ 'ACT-610': 'OFFLINE', 'SRV-620': 'ONLINE' })
  const bus = makeBus(system)
  const write = bus.write('MOTOR', 100)
  assert.equal(write.ok, false)
  assert.ok(write.error?.includes('ACT-610'))
})

test('startupCheck returns the component', () => {
  const check = startupCheck(4)
  assert.equal(check?.componentId, 'BUS-T-240')
})
