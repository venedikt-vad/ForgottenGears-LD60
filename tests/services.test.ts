import test from 'node:test'
import assert from 'node:assert/strict'

import { RobotData } from '../src/game/RobotData'
import { compileProgram, isRunnable } from '../src/game/rasm'
import {
  SERVICE_PROGRAMS,
  SERVICE_PROGRAM_DIR,
  serviceProgramPath,
} from '../src/game/runtime/servicePrograms'
import { VFS_LIMITS, VirtualFileSystem } from '../src/game/VirtualFileSystem'
import type { RobotSystem } from '../src/game/Game'

/** Only the read-model paths used by `getProcesses` are needed here. */
function stubSystem(): RobotSystem {
  return {
    getComponentStatus: () => 'ONLINE',
  } as unknown as RobotSystem
}

test('every service process has a shipped RASM source', () => {
  const fileSystem = new VirtualFileSystem()
  const paths = fileSystem.list(SERVICE_PROGRAM_DIR, 'en')

  for (const program of SERVICE_PROGRAMS) {
    const path = serviceProgramPath(program.file)
    assert.ok(paths.includes(program.file), `missing ${program.file} in ${SERVICE_PROGRAM_DIR}`)
    assert.ok(fileSystem.exists(path), `missing file ${path}`)
    assert.ok((fileSystem.read(path, 'en')?.length ?? 0) > 3, `empty script ${path}`)
  }
})

test('every seeded service source compiles without diagnostics', () => {
  for (const program of SERVICE_PROGRAMS) {
    const compiled = compileProgram(program.source)
    assert.ok(
      isRunnable(compiled),
      `${program.name} does not compile: ${compiled.diagnostics.map((d) => `${d.line}:${d.code}`).join(', ')}`,
    )
  }
})

test('the process table binds every service row to its script', () => {
  const data = new RobotData(stubSystem(), new VirtualFileSystem())
  const services = data.getProcesses().filter((process) => process.kind === 'service')

  assert.equal(services.length, SERVICE_PROGRAMS.length)
  for (const process of services) {
    const expected = SERVICE_PROGRAMS.find((program) => program.pid === process.pid)
    assert.ok(expected, `no service script registered for PID ${process.pid}`)
    assert.equal(process.scriptPath, serviceProgramPath(expected!.file))
  }
})

test('the shipped files and the service scripts fit the VFS quotas', () => {
  const usage = new VirtualFileSystem().getStorageUsage()
  assert.ok(usage.fileCount < VFS_LIMITS.maxFiles, 'shipped files leave no room for new files')
  assert.ok(usage.usedBytes < VFS_LIMITS.maxTotalBytes, 'shipped files exceed the storage quota')
})
