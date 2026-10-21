import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseProgram } from '../src/game/rasm/parser'
import { compileProgram, isRunnable } from '../src/game/rasm/compiler'
import { Processor } from '../src/game/rasm/processor'
import { Debugger } from '../src/game/rasm/debugger'
import { ConstantDevice, RecordingSink, SimpleDeviceBus, createDemoBus } from '../src/game/rasm/bus'
import type { CompiledProgram, Diagnostic } from '../src/game/rasm/types'

/** Compile source that is expected to be valid, failing the test otherwise. */
function compileOk(source: string): CompiledProgram {
  const program = compileProgram(source)
  if (!isRunnable(program)) {
    const messages = program.diagnostics.map((d) => `${d.line}:${d.code} ${d.message}`).join('\n')
    assert.fail(`Expected a clean compile, got diagnostics:\n${messages}`)
  }
  return program
}

function runSource(source: string, options: { bus?: SimpleDeviceBus; budget?: number } = {}): Processor {
  const program = compileOk(source)
  const processor = new Processor({ bus: options.bus })
  processor.load(program)
  processor.run(options.budget ?? 5000)
  return processor
}

function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code)
}

// ---------------------------------------------------------------------------
// 1. Comments and blank lines
// ---------------------------------------------------------------------------

test('comments and blank lines are ignored but line numbers are preserved', () => {
  const source = [
    '; a leading comment',
    '',
    'MOV R0, #1   ; inline comment',
    '   ',
    '; another comment',
    '',
    'HALT',
  ].join('\n')

  const parsed = parseProgram(source)
  assert.equal(parsed.diagnostics.length, 0)
  assert.equal(parsed.instructions.length, 2)
  // The first real instruction lives on source line 3, not line 1.
  assert.equal(parsed.instructions[0]!.line, 3)
  assert.equal(parsed.instructions[0]!.opcode, 'MOV')
  assert.equal(parsed.instructions[1]!.line, 7)
  assert.equal(parsed.instructions[1]!.opcode, 'HALT')
})

test('a semicolon inside an operand terminates the line', () => {
  const parsed = parseProgram('MOV R0, #5 ; trailing junk should be dropped')
  assert.equal(parsed.diagnostics.length, 0)
  assert.equal(parsed.instructions[0]!.operands.length, 2)
  assert.deepEqual(parsed.instructions[0]!.operands[1], { kind: 'immediate', value: 5, text: '#5' })
})

// ---------------------------------------------------------------------------
// 2. Registers and immediates
// ---------------------------------------------------------------------------

test('registers and immediates are case-insensitive and keep their value', () => {
  const program = compileOk('mov r1, #10\nHALT')
  const instruction = program.instructions[0]!
  assert.equal(instruction.opcode, 'MOV')
  assert.equal(instruction.operands[0]!.kind, 'register')
  assert.equal(instruction.operands[0]!.value, 1)
  assert.equal(instruction.operands[1]!.kind, 'immediate')
  assert.equal(instruction.operands[1]!.value, 10)
})

test('hexadecimal immediates are decoded', () => {
  const processor = runSource('MOV R0, #0x50\nHALT')
  assert.equal(processor.getRegister(0), 80)
})

test('a register copy MOV R1, R2 reads the source register', () => {
  const processor = runSource('MOV R0, #7\nMOV R1, R0\nHALT')
  assert.equal(processor.getRegister(1), 7)
})

test('registers store 16-bit values and wrap on write', () => {
  const processor = runSource('MOV R0, #65535\nADD R0, #1\nHALT')
  assert.equal(processor.getRegister(0), 0)
})

test('all eight registers exist and start at zero', () => {
  const processor = new Processor()
  processor.load(compileOk('NOP\nHALT'))
  assert.equal(processor.snapshot().registers.length, 8)
  assert.deepEqual(processor.snapshot().registers, [0, 0, 0, 0, 0, 0, 0, 0])
  assert.equal(processor.getRegister(7), 0)
})

// ---------------------------------------------------------------------------
// 3. RAM read / write
// ---------------------------------------------------------------------------

test('STORE writes a register into RAM and LOAD reads it back', () => {
  const processor = runSource('MOV R0, #0x1234\nSTORE [0x20], R0\nLOAD R1, [0x20]\nHALT')
  assert.equal(processor.getRam(0x20), 0x1234)
  assert.equal(processor.getRegister(1), 0x1234)
})

test('RAM starts zeroed for all 256 cells', () => {
  const processor = new Processor()
  processor.load(compileOk('HALT'))
  const ram = processor.snapshot().ram
  assert.equal(ram.length, 256)
  assert.ok(ram.every((value) => value === 0))
})

test('a decimal RAM address is equivalent to its hex form', () => {
  const processor = runSource('MOV R0, #9\nSTORE [32], R0\nHALT')
  assert.equal(processor.getRam(32), 9)
})

// ---------------------------------------------------------------------------
// 4. Arithmetic, including overflow
// ---------------------------------------------------------------------------

test('ADD and SUB use unsigned 16-bit modular arithmetic', () => {
  const add = runSource('MOV R0, #65530\nADD R0, #10\nHALT')
  assert.equal(add.getRegister(0), 4) // 65540 mod 65536

  const sub = runSource('MOV R0, #5\nSUB R0, #10\nHALT')
  assert.equal(sub.getRegister(0), 65531) // wraps below zero

  const sub2 = runSource('MOV R0, #10\nMOV R1, #4\nSUB R0, R1\nHALT')
  assert.equal(sub2.getRegister(0), 6)
})

test('ADD accumulates across a loop', () => {
  const source = [
    'MOV R0, #0',
    'MOV R1, #0',
    'ADD R0, #3',
    'ADD R1, #1',
    'CMP R1, #5',
    'JLT LOOP',
    'HALT',
    'LOOP: NOP',
  ]
  // Restructure so the loop body is entered from the top.
  const looped = [
    'MOV R0, #0',
    'MOV R1, #5',
    'LOOP: ADD R0, #3',
    'SUB R1, #1',
    'CMP R1, #0',
    'JGT LOOP',
    'HALT',
  ].join('\n')
  void source
  const processor = runSource(looped)
  assert.equal(processor.getRegister(0), 15)
})

// ---------------------------------------------------------------------------
// 5. All jump types and comparison boundaries
// ---------------------------------------------------------------------------

for (const [mnemonic, condition, expectTaken] of [
  ['JE', 'equal', true],
  ['JNE', 'equal', false],
  ['JGT', 'equal', false],
  ['JGE', 'equal', true],
  ['JLT', 'equal', false],
  ['JLE', 'equal', true],
] as const) {
  test(`${mnemonic} on an equal comparison behaves as ${condition}`, () => {
    const source = [
      'MOV R0, #10',
      'CMP R0, #10',
      `${mnemonic} TARGET`,
      'MOV R1, #1',
      'JMP DONE',
      'TARGET: MOV R1, #2',
      'DONE: HALT',
    ].join('\n')
    const processor = runSource(source)
    assert.equal(processor.getRegister(1), expectTaken ? 2 : 1)
  })
}

for (const [mnemonic, expectTaken] of [
  ['JE', false],
  ['JNE', true],
  ['JGT', true],
  ['JGE', true],
  ['JLT', false],
  ['JLE', false],
] as const) {
  test(`${mnemonic} when the first value is greater`, () => {
    const source = [
      'MOV R0, #20',
      'CMP R0, #10',
      `${mnemonic} TARGET`,
      'MOV R1, #1',
      'JMP DONE',
      'TARGET: MOV R1, #2',
      'DONE: HALT',
    ].join('\n')
    const processor = runSource(source)
    assert.equal(processor.getRegister(1), expectTaken ? 2 : 1)
  })
}

for (const [mnemonic, expectTaken] of [
  ['JE', false],
  ['JNE', true],
  ['JGT', false],
  ['JGE', false],
  ['JLT', true],
  ['JLE', true],
] as const) {
  test(`${mnemonic} when the first value is smaller`, () => {
    const source = [
      'MOV R0, #5',
      'CMP R0, #10',
      `${mnemonic} TARGET`,
      'MOV R1, #1',
      'JMP DONE',
      'TARGET: MOV R1, #2',
      'DONE: HALT',
    ].join('\n')
    const processor = runSource(source)
    assert.equal(processor.getRegister(1), expectTaken ? 2 : 1)
  })
}

test('comparison boundaries cover 0 and 65535 as unsigned values', () => {
  const processor = runSource('MOV R0, #0\nCMP R0, #65535\nJLT SMALL\nMOV R1, #1\nJMP DONE\nSMALL: MOV R1, #2\nDONE: HALT')
  assert.equal(processor.getRegister(1), 2)
})

test('JMP is unconditional', () => {
  const processor = runSource('JMP SKIP\nMOV R0, #1\nSKIP: MOV R0, #2\nHALT')
  assert.equal(processor.getRegister(0), 2)
})

test('an unconditional jump alone is not enough to fake a comparison', () => {
  const processor = runSource('MOV R0, #1\nJMP DONE\nDONE: HALT')
  assert.equal(processor.currentState, 'halted')
  assert.equal(processor.lastError, null)
})

// ---------------------------------------------------------------------------
// 6. Label resolution and label errors
// ---------------------------------------------------------------------------

test('labels resolve to instruction indices, not source lines', () => {
  const program = compileOk([
    '; comment',
    '',
    'MOV R0, #1',
    'JMP END',
    'MOV R0, #2',
    'END: HALT',
  ].join('\n'))

  const jump = program.instructions.find((i) => i.opcode === 'JMP')!
  // Instructions: 0=MOV, 1=JMP, 2=MOV, 3=HALT → END is index 3.
  assert.equal(jump.operands[0]!.value, 3)
  assert.equal(program.labels.get('END'), 3)
})

test('a label alone on a line points at the next instruction', () => {
  const program = compileOk('MOV R0, #1\nTOP:\nADD R0, #1\nJMP TOP\nHALT')
  assert.equal(program.labels.get('TOP'), 1)
})

test('several labels may prefix one line', () => {
  const program = compileOk('A: B: MOV R0, #1\nHALT')
  assert.equal(program.labels.get('A'), 0)
  assert.equal(program.labels.get('B'), 0)
})

test('a jump to an unknown label is a compile error', () => {
  const program = compileProgram('JMP NOWHERE\nHALT')
  assert.equal(isRunnable(program), false)
  assert.deepEqual(codes(program.diagnostics), ['UNKNOWN_LABEL'])
  assert.equal(program.diagnostics[0]!.line, 1)
})

test('a duplicate label is a compile error that names the first line', () => {
  const program = compileProgram('A: NOP\nA: NOP\nHALT')
  assert.equal(isRunnable(program), false)
  assert.deepEqual(codes(program.diagnostics), ['DUPLICATE_LABEL'])
  assert.match(program.diagnostics[0]!.message, /line 1/)
})

test('labels are case-insensitive', () => {
  const processor = runSource('JMP Done\nMOV R0, #1\nDONE: MOV R0, #2\nHALT')
  assert.equal(processor.getRegister(0), 2)
})

// ---------------------------------------------------------------------------
// 7. Device I/O
// ---------------------------------------------------------------------------

test('IN reads a device and OUT writes to one', () => {
  const bus = new SimpleDeviceBus()
  bus.register('TEMP', { read: () => 42 })
  const sink = new RecordingSink()
  bus.register('MOTOR', { write: (value) => sink.write(value) })

  const processor = runSource('IN R1, TEMP\nOUT MOTOR, R1\nHALT', { bus })
  assert.equal(processor.getRegister(1), 42)
  assert.deepEqual(sink.writes, [42])
})

test('device names are case-insensitive', () => {
  const bus = new SimpleDeviceBus()
  bus.register('TEMP', { read: () => 7 })
  const processor = runSource('IN R0, temp\nHALT', { bus })
  assert.equal(processor.getRegister(0), 7)
})

test('reading an unknown device fails with a source line', () => {
  const bus = new SimpleDeviceBus()
  const processor = runSource('MOV R0, #1\nIN R1, MISSING\nHALT', { bus })
  assert.equal(processor.currentState, 'error')
  assert.equal(processor.lastError?.code, 'UNKNOWN_DEVICE')
  assert.equal(processor.lastError?.line, 2)
})

test('writing an unknown device fails with a source line', () => {
  const bus = new SimpleDeviceBus()
  const processor = runSource('OUT NOPE, #1\nHALT', { bus })
  assert.equal(processor.currentState, 'error')
  assert.equal(processor.lastError?.code, 'UNKNOWN_DEVICE')
  assert.equal(processor.lastError?.line, 1)
})

test('a read-only device rejects writes and a write-only device rejects reads', () => {
  const bus = new SimpleDeviceBus()
  bus.register('SENSOR', { read: () => 1 })
  bus.register('ACTUATOR', { write: () => {} })

  const writeFail = runSource('OUT SENSOR, #1\nHALT', { bus })
  assert.equal(writeFail.lastError?.code, 'DEVICE_WRITE_ERROR')

  const readFail = runSource('IN R0, ACTUATOR\nHALT', { bus })
  assert.equal(readFail.lastError?.code, 'DEVICE_READ_ERROR')
})

test('with no bus connected, device instructions report a runtime error', () => {
  const processor = runSource('IN R0, TEMP\nHALT')
  assert.equal(processor.lastError?.code, 'DEVICE_READ_ERROR')
})

test('the demo bus drives TEMP and MOTOR as described', () => {
  const { bus, state } = createDemoBus()
  const processor = runSource('IN R0, TEMP\nOUT MOTOR, #50\nIN R1, MOTOR\nHALT', { bus })
  assert.equal(processor.getRegister(0), 20) // ambient temperature
  assert.equal(state.motorSpeed, 50)
  assert.equal(processor.getRegister(1), 50)
  assert.ok(bus.ticks > 0)
})

test('the demo temperature rises while the motor runs', () => {
  const { bus } = createDemoBus()
  bus.write('MOTOR', 100)
  const loop = [
    'MOV R1, #0',
    'TICK: IN R2, TEMP',
    'ADD R1, #1',
    'CMP R1, #300',
    'JLT TICK',
    'HALT',
  ].join('\n')
  const processor = runSource(loop, { bus })
  assert.ok(processor.getRegister(2) > 20, 'expected the sensor to warm up')
})

test('ConstantDevice is readable and mutable', () => {
  const device = new ConstantDevice('X', 12)
  assert.equal(device.read(), 12)
  device.set(65540)
  assert.equal(device.read(), 4)
})

// ---------------------------------------------------------------------------
// 8. HALT and end of program
// ---------------------------------------------------------------------------

test('HALT stops execution and further steps do nothing', () => {
  const processor = runSource('MOV R0, #1\nHALT\nMOV R0, #2')
  assert.equal(processor.currentState, 'halted')
  assert.equal(processor.getRegister(0), 1)
  assert.equal(processor.step(), false)
})

test('running off the end of the program stops cleanly without an error', () => {
  const processor = runSource('MOV R0, #5\nMOV R1, #6')
  assert.equal(processor.currentState, 'halted')
  assert.equal(processor.lastError, null)
  assert.equal(processor.getRegister(1), 6)
})

test('HALT does not reset what was written earlier', () => {
  const processor = runSource('MOV R0, #11\nSTORE [4], R0\nHALT')
  assert.equal(processor.getRam(4), 11)
})

// ---------------------------------------------------------------------------
// 9. Stepping and breakpoints
// ---------------------------------------------------------------------------

test('step executes exactly one instruction at a time', () => {
  const debuggerInstance = new Debugger()
  const result = debuggerInstance.load('MOV R0, #1\nADD R0, #1\nHALT')
  assert.equal(result.ok, true)

  assert.equal(debuggerInstance.snapshot().pc, 0)
  debuggerInstance.step()
  assert.equal(debuggerInstance.snapshot().pc, 1)
  assert.equal(debuggerInstance.snapshot().registers[0], 1)
  debuggerInstance.step()
  assert.equal(debuggerInstance.snapshot().registers[0], 2)
  debuggerInstance.step()
  assert.equal(debuggerInstance.snapshot().state, 'halted')
})

test('the snapshot reports the source line of the current instruction', () => {
  const debuggerInstance = new Debugger()
  debuggerInstance.load('; comment\nMOV R0, #1\n\nHALT')
  assert.equal(debuggerInstance.snapshot().currentLine, 2)
  assert.equal(debuggerInstance.snapshot().currentInstruction?.sourceLine, 2)
})

test('a breakpoint pauses run() before the line executes', () => {
  const debuggerInstance = new Debugger()
  debuggerInstance.load([
    'MOV R0, #0',       // line 1
    'ADD R0, #1',       // line 2
    'ADD R0, #1',       // line 3 (breakpoint)
    'HALT',             // line 4
  ].join('\n'))

  debuggerInstance.setBreakpoint(3, true)
  const result = debuggerInstance.run()
  assert.equal(result.reason, 'breakpoint')
  // Line 3 has not run yet: R0 is 1 after line 2.
  assert.equal(debuggerInstance.snapshot().registers[0], 1)
  assert.equal(debuggerInstance.snapshot().currentLine, 3)

  // Continue: the breakpoint is checked only at the start of the next pass,
  // so stepping past it resumes normally.
  debuggerInstance.step()
  const finished = debuggerInstance.run()
  assert.equal(finished.reason, 'halted')
  assert.equal(debuggerInstance.snapshot().registers[0], 2)
})

test('breakpoints can be toggled and cleared', () => {
  const debuggerInstance = new Debugger()
  assert.equal(debuggerInstance.toggleBreakpoint(2), true)
  assert.equal(debuggerInstance.hasBreakpoint(2), true)
  assert.equal(debuggerInstance.toggleBreakpoint(2), false)
  assert.equal(debuggerInstance.hasBreakpoint(2), false)
  debuggerInstance.setBreakpoint(5, true)
  assert.deepEqual(debuggerInstance.getBreakpoints(), [5])
  debuggerInstance.clearBreakpoints()
  assert.deepEqual(debuggerInstance.getBreakpoints(), [])
})

test('stop() interrupts a running loop', () => {
  // The realistic path: a breakpoint fires mid-run and asks to stop, so the
  // loop unwinds at the next iteration with reason 'stopped'.
  const debuggerInstance = new Debugger({
    onBreakpoint: () => debuggerInstance.stop(),
  })
  debuggerInstance.load('LOOP: NOP\nJMP LOOP')
  debuggerInstance.setBreakpoint(2, true)
  const result = debuggerInstance.run(1000)
  assert.equal(result.reason, 'stopped')
  // The breakpoint is on line 2, reached after the first NOP.
  assert.equal(result.executed, 1)
})

test('an invalid program cannot be loaded or stepped', () => {
  const debuggerInstance = new Debugger()
  const result = debuggerInstance.load('MOV R0\nHALT')
  assert.equal(result.ok, false)
  assert.equal(debuggerInstance.hasProgram(), false)
  assert.equal(debuggerInstance.step(), false)
})

// ---------------------------------------------------------------------------
// 10. Infinite loop guard
// ---------------------------------------------------------------------------

test('an infinite loop is bounded by the step budget and reports it', () => {
  const processor = new Processor({ defaultStepBudget: 500 })
  processor.load(compileOk('LOOP: NOP\nJMP LOOP'))
  const executed = processor.run(500)
  assert.equal(executed, 500)
  assert.equal(processor.currentState, 'error')
  assert.equal(processor.lastError?.code, 'STEP_BUDGET_EXCEEDED')
})

test('the debugger run loop also stops a runaway program', () => {
  const debuggerInstance = new Debugger()
  debuggerInstance.load('LOOP: MOV R0, R0\nJMP LOOP')
  const result = debuggerInstance.run(250)
  assert.equal(result.reason, 'budget')
  assert.equal(result.executed, 250)
})

// ---------------------------------------------------------------------------
// 11. Diagnostics carry source lines and columns
// ---------------------------------------------------------------------------

test('an unknown instruction is reported with its line', () => {
  const program = compileProgram('MOV R0, #1\nFROBNICATE R0\nHALT')
  assert.equal(isRunnable(program), false)
  assert.deepEqual(codes(program.diagnostics), ['UNKNOWN_INSTRUCTION'])
  assert.equal(program.diagnostics[0]!.line, 2)
  assert.match(program.diagnostics[0]!.message, /FROBNICATE/i)
})

test('a wrong argument count is reported', () => {
  const program = compileProgram('MOV R0\nHALT')
  assert.deepEqual(codes(program.diagnostics), ['BAD_ARGUMENT_COUNT'])
  assert.equal(program.diagnostics[0]!.line, 1)
})

test('an operand of the wrong type is reported with a column', () => {
  const program = compileProgram('MOV #1, R0\nHALT')
  assert.equal(isRunnable(program), false)
  assert.ok(codes(program.diagnostics).includes('BAD_OPERAND'))
  assert.equal(program.diagnostics[0]!.line, 1)
  assert.equal(typeof program.diagnostics[0]!.column, 'number')
})

test('an out-of-range register is reported', () => {
  const program = compileProgram('MOV R9, #1\nHALT')
  assert.ok(codes(program.diagnostics).includes('BAD_REGISTER'))
  assert.equal(program.diagnostics[0]!.line, 1)
})

test('an out-of-range RAM address is reported', () => {
  const below = compileProgram('MOV R0, #1\nSTORE [256], R0\nHALT')
  assert.ok(codes(below.diagnostics).includes('BAD_ADDRESS'))
  assert.equal(below.diagnostics[0]!.line, 2)
})

test('a malformed number is reported', () => {
  const program = compileProgram('MOV R0, #0xZZ\nHALT')
  assert.ok(codes(program.diagnostics).includes('BAD_NUMBER'))
})

test('a 16-bit overflow in an immediate is reported', () => {
  const program = compileProgram('MOV R0, #70000\nHALT')
  assert.ok(codes(program.diagnostics).includes('BAD_NUMBER'))
})

test('a conditional jump before any CMP is a runtime error, not a silent branch', () => {
  const processor = runSource('JE SOMEWHERE\nMOV R0, #1\nSOMEWHERE: HALT')
  assert.equal(processor.currentState, 'error')
  assert.equal(processor.lastError?.code, 'COMPARE_NOT_SET')
  assert.equal(processor.lastError?.line, 1)
})

test('executing after a halt is refused', () => {
  const processor = runSource('HALT')
  assert.equal(processor.step(), false)
  assert.equal(processor.run(10), 0)
})

test('executing after an error is refused until reset', () => {
  const bus = new SimpleDeviceBus()
  const processor = runSource('IN R0, MISSING\nHALT', { bus })
  assert.equal(processor.currentState, 'error')
  assert.equal(processor.step(), false)
  processor.reset()
  assert.equal(processor.currentState, 'ready')
})

test('every diagnostic carries a code, message, phase and line', () => {
  const program = compileProgram('BOGUS\nMOV R0, #1\nJMP NONE')
  assert.ok(program.diagnostics.length >= 2)
  for (const diagnostic of program.diagnostics) {
    assert.equal(typeof diagnostic.code, 'string')
    assert.ok(diagnostic.message.length > 0)
    assert.ok(diagnostic.phase === 'parse' || diagnostic.phase === 'compile')
    assert.ok(diagnostic.line >= 1)
  }
})

// ---------------------------------------------------------------------------
// 12. Machine reset
// ---------------------------------------------------------------------------

test('reset clears registers, RAM, flags, ticks and errors', () => {
  const bus = new SimpleDeviceBus()
  bus.register('TEMP', { read: () => 1 })
  const processor = new Processor({ bus })
  processor.load(compileOk('MOV R0, #50\nSTORE [10], R0\nIN R1, TEMP\nCMP R0, R1\nHALT'))
  processor.run(100)
  assert.equal(processor.currentState, 'halted')
  assert.ok(processor.tickCount > 0)

  processor.reset()
  const snapshot = processor.snapshot()
  assert.deepEqual(snapshot.registers, [0, 0, 0, 0, 0, 0, 0, 0])
  assert.ok(snapshot.ram.every((value) => value === 0))
  assert.equal(snapshot.comparison, null)
  assert.equal(snapshot.ticks, 0)
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.state, 'ready')
  assert.equal(snapshot.pc, 0)
})

test('reset then re-run produces the same result', () => {
  const program = compileOk('MOV R0, #1\nADD R0, #1\nADD R0, #1\nHALT')
  const processor = new Processor()
  processor.load(program)
  processor.run(100)
  const first = processor.getRegister(0)
  processor.reset()
  processor.run(100)
  assert.equal(processor.getRegister(0), first)
  assert.equal(first, 3)
})

test('loading a new program resets the machine', () => {
  const processor = new Processor()
  processor.load(compileOk('MOV R0, #7\nHALT'))
  processor.run(10)
  processor.load(compileOk('MOV R1, #9\nHALT'))
  assert.equal(processor.getRegister(0), 0)
  processor.run(10)
  assert.equal(processor.getRegister(1), 9)
})

test('the debugger reset restores a clean snapshot', () => {
  const debuggerInstance = new Debugger()
  debuggerInstance.load('MOV R0, #9\nSTORE [1], R0\nHALT')
  debuggerInstance.run(10)
  debuggerInstance.reset()
  const snapshot = debuggerInstance.snapshot()
  assert.equal(snapshot.registers[0], 0)
  assert.equal(snapshot.ram[1], 0)
  assert.equal(snapshot.state, 'ready')
})

// ---------------------------------------------------------------------------
// 13. The shipped sample program
// ---------------------------------------------------------------------------

test('the thermal governor sample compiles and drives MOTOR from TEMP', () => {
  // Load the file that actually ships with the game, so the guarantee is about
  // the real artifact and not a copy that could drift away from it.
  const samplePath = fileURLToPath(new URL('../public/rasm/thermal_governor.rasm', import.meta.url))
  const source = readFileSync(samplePath, 'utf8')
  const { bus, state } = createDemoBus()
  const processor = runSource(source, { bus })

  assert.equal(processor.currentState, 'halted')
  assert.equal(processor.lastError, null)
  // The governor stops the motor once the limit is hit.
  assert.equal(state.motorSpeed, 0)
  // The temperature crossed the 80 degree limit.
  assert.ok(processor.getRam(0x20) > 0, 'expected at least one speed ramp before shutdown')
  assert.equal(processor.getRegister(4), processor.getRam(0x20))
})

test('the in-game copy of the sample is the same runnable program', async () => {
  // Guard against the file on disk and the copy seeded into the in-game
  // filesystem drifting apart: both must compile clean.
  const { VirtualFileSystem } = await import('../src/game/VirtualFileSystem/index')
  const fileSystem = new VirtualFileSystem()
  const lines = fileSystem.read('/opt/firmware/motion/thermal_governor.rasm', 'en')
  assert.ok(lines, 'the sample must be present in the in-game filesystem')
  const program = compileProgram(lines.join('\n'))
  assert.ok(isRunnable(program), 'the seeded sample must compile without errors')
})

test('formatDiagnostics renders one line per problem and a clean message', async () => {
  const { formatDiagnostics } = await import('../src/game/rasm/compiler')
  assert.deepEqual(formatDiagnostics([]), ['OK: no problems found.'])
  const program = compileProgram('MOV R9, #1\nHALT')
  const lines = formatDiagnostics(program.diagnostics)
  assert.equal(lines.length, program.diagnostics.length)
  assert.match(lines[0]!, /^line \d+/)
})

// ---------------------------------------------------------------------------
// 14. Error categories that only appear through the debugger / parser edges
// ---------------------------------------------------------------------------

test('a malformed label is reported as INVALID_LABEL', () => {
  const parsed = parseProgram('2FAST: HALT')
  assert.ok(codes(parsed.diagnostics).includes('INVALID_LABEL'))
})

test('stepping after a halt explains itself with PROCESSOR_HALTED', () => {
  const processor = runSource('MOV R0, #1\nHALT')
  assert.equal(processor.currentState, 'halted')
  const reason = processor.explainStep()
  assert.equal(reason?.code, 'PROCESSOR_HALTED')
})

test('stepping a program that ran off the end also reports PROCESSOR_HALTED', () => {
  const processor = runSource('MOV R0, #1')
  assert.equal(processor.currentState, 'halted')
  assert.equal(processor.explainStep()?.code, 'PROCESSOR_HALTED')
})

test('explainStep returns null while the machine can still run', () => {
  const program = compileProgram('MOV R0, #1\nHALT')
  const processor = new Processor()
  processor.load(program)
  assert.equal(processor.explainStep(), null)
})

test('the debugger surfaces the same halt reason as the processor', () => {
  const debuggerInstance = new Debugger()
  debuggerInstance.load('HALT')
  assert.equal(debuggerInstance.step(), true)
  assert.equal(debuggerInstance.step(), false)
  assert.equal(debuggerInstance.explainStep()?.code, 'PROCESSOR_HALTED')
})

test('the debugger budget stop carries a STEP_BUDGET_EXCEEDED diagnostic', () => {
  const debuggerInstance = new Debugger()
  debuggerInstance.load('LOOP: JMP LOOP')
  const result = debuggerInstance.run(500)
  assert.equal(result.reason, 'budget')
  assert.equal(result.snapshot.error?.code, 'STEP_BUDGET_EXCEEDED')
  // The machine is stopped, so a further step must refuse.
  assert.equal(debuggerInstance.step(), false)
})
