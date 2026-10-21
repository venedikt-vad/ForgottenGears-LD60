import type { Diagnostic, DiagnosticCode, DiagnosticPhase, OpCode } from './types'
import { CONDITIONAL_JUMPS, OPCODES } from './types'

/**
 * Static description of one instruction: how many operands it takes and which
 * operand shapes are accepted at each position. The compiler validates against
 * this table, so adding an instruction means editing exactly one place.
 */
export interface InstructionSpec {
  opcode: OpCode
  /** Accepted kind sets per operand position. */
  operands: OperandKindSet[]
  summary: string
}

/** Allowed shapes for one operand slot; `register` is accepted almost everywhere. */
export type OperandKindSet = readonly (
  | 'register'
  | 'immediate'
  | 'address'
  | 'device'
  | 'label'
)[]

const REGISTER: OperandKindSet = ['register']
const REGISTER_OR_IMMEDIATE: OperandKindSet = ['register', 'immediate']
const RAM_ADDRESS: OperandKindSet = ['address']
const DEVICE: OperandKindSet = ['device']
const LABEL: OperandKindSet = ['label']
const ANY_VALUE: OperandKindSet = ['register', 'immediate']

/** Operand table of RASM 1.0 — the single source of truth for the compiler. */
export const INSTRUCTION_SPECS: Record<OpCode, InstructionSpec> = {
  NOP: { opcode: 'NOP', operands: [], summary: 'Do nothing for one tick.' },
  MOV: { opcode: 'MOV', operands: [REGISTER, REGISTER_OR_IMMEDIATE], summary: 'Copy a value into a register.' },
  LOAD: { opcode: 'LOAD', operands: [REGISTER, RAM_ADDRESS], summary: 'Read a RAM cell into a register.' },
  STORE: { opcode: 'STORE', operands: [RAM_ADDRESS, REGISTER], summary: 'Write a register into a RAM cell.' },
  ADD: { opcode: 'ADD', operands: [REGISTER, REGISTER_OR_IMMEDIATE], summary: 'Add to a register (mod 65536).' },
  SUB: { opcode: 'SUB', operands: [REGISTER, REGISTER_OR_IMMEDIATE], summary: 'Subtract from a register (mod 65536).' },
  CMP: { opcode: 'CMP', operands: [REGISTER, REGISTER_OR_IMMEDIATE], summary: 'Compare two unsigned values for the conditional jumps.' },
  JMP: { opcode: 'JMP', operands: [LABEL], summary: 'Jump to a label.' },
  JE: { opcode: 'JE', operands: [LABEL], summary: 'Jump when the last CMP was equal.' },
  JNE: { opcode: 'JNE', operands: [LABEL], summary: 'Jump when the last CMP was not equal.' },
  JGT: { opcode: 'JGT', operands: [LABEL], summary: 'Jump when the last CMP left the first value greater.' },
  JGE: { opcode: 'JGE', operands: [LABEL], summary: 'Jump when the last CMP left the first value greater or equal.' },
  JLT: { opcode: 'JLT', operands: [LABEL], summary: 'Jump when the last CMP left the first value smaller.' },
  JLE: { opcode: 'JLE', operands: [LABEL], summary: 'Jump when the last CMP left the first value smaller or equal.' },
  IN: { opcode: 'IN', operands: [REGISTER, DEVICE], summary: 'Read a value from a device port.' },
  OUT: { opcode: 'OUT', operands: [DEVICE, ANY_VALUE], summary: 'Send a value to a device port.' },
  HALT: { opcode: 'HALT', operands: [], summary: 'Stop the program.' },
}

/** Human-readable operand shape, used in diagnostics. */
export function describeKindSet(kinds: OperandKindSet): string {
  return kinds.join(' | ')
}

/** Convenience: the spec of an uppercased mnemonic, or undefined when unknown. */
export function specFor(mnemonic: string): InstructionSpec | undefined {
  return (INSTRUCTION_SPECS as Record<string, InstructionSpec | undefined>)[mnemonic]
}

export function isOpcode(value: string): value is OpCode {
  return (OPCODES as readonly string[]).includes(value)
}

export function isConditionalJump(opcode: OpCode): boolean {
  return (CONDITIONAL_JUMPS as readonly string[]).includes(opcode)
}

/** Small helper so every layer builds diagnostics the same way. */
export function makeDiagnostic(
  code: DiagnosticCode,
  message: string,
  phase: DiagnosticPhase,
  line: number,
  column: number | null = null,
  text?: string,
): Diagnostic {
  return { code, message, phase, line, column, text }
}

/** True when a diagnostic list contains at least one error (RASM has no warnings yet). */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.length > 0
}
