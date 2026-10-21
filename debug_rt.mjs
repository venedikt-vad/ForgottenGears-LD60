import { RobotDeviceBus } from './src/game/runtime/RobotDeviceBus.ts'
import { RobotKernel } from './src/game/runtime/RobotKernel.ts'
import { STARTUP_PROGRAM_PATH } from './src/game/runtime/constants.ts'

function makeComponent(status) {
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

class TestSystem {
  constructor(initial = {}) {
    this.map = new Map()
    this.reactorRestored = true
    this.powerGridPuzzleSolved = true
    this.bodyBusRestored = true
    this.busBypassRestored = true
    this.analyzerControllerPowered = true
    this.coolingRestored = true
    this.memoryCoreRestored = true
    this.motionProfileRestored = true
    this.visionRestored = true
    this.motionStartupComplete = false
    this.masterAlarm = false
    for (const [id, status] of Object.entries(initial)) {
      this.map.set(id, { ...makeComponent(status), id })
    }
  }
  getComponent(id) { return this.map.get(id) }
  getComponentStatus(id) { return this.map.get(id)?.status ?? 'MISSING' }
  listComponents() { return [...this.map.values()] }
  getCounts() {
    const counts = { ONLINE: 0, DEGRADED: 0, CRITICAL: 0, LOCKED: 0, OFFLINE: 0, MISSING: 0 }
    for (const component of this.map.values()) counts[component.status] += 1
    return counts
  }
  getEvents() { return [] }
  getProgress() { return [] }
  setComponentStatus() { return true }
  powerMotionComponents() { return true }
  restoreBusBypass() { return true }
  repairMemoryCore() { return true }
  restoreMotionProfile() { return true }
  completeBodyStartup() { this.motionStartupComplete = true; return true }
  log() {}
}

function makeBus(system) {
  return new RobotDeviceBus(system, { temperature: () => 40, batteryPercent: () => 80 })
}

function runToEnd(kernel, steps = 200) {
  for (let i = 0; i < steps; i += 1) kernel.tick(0.016)
}

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
const source = `; body startup
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
const result = kernel.launch(source, { path: STARTUP_PROGRAM_PATH })
console.log('ok', result.ok)
runToEnd(kernel)
console.log('diag', bus.getLatch('DIAG'), 'boot', bus.getLatch('BOOT'))
for (const p of kernel.list()) console.log(p.pid, p.state, p.error)
