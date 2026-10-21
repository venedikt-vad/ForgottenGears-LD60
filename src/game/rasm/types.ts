/**
 * RASM (Robot Assembly) — shared types for the language core.
 *
 * This module is intentionally free of any UI, DOM or game dependency: the
 * parser, compiler, processor and bus all speak only these types, so the whole
 * language can be unit-tested and reused from any host (the game window, the
 * console, or a plain Node script).
 */

/** Machine limits of the RASM virtual processor (RASM 1.0). */
export const REGISTER_COUNT = 8
export const RAM_SIZE = 256
export const WORD_MASK = 0xffff
export const WORD_MODULO = 0x10000
export const MAX_RAM_ADDRESS = RAM_SIZE - 1
export const MAX_REGISTER_INDEX = REGISTER_COUNT - 1

/** Every mnemonic understood by the compiler. */
export type OpCode =
  | 'NOP'
  | 'MOV'
  | 'LOAD'
  | 'STORE'
  | 'ADD'
  | 'SUB'
  | 'CMP'
  | 'JMP'
  | 'JE'
  | 'JNE'
  | 'JGT'
  | 'JGE'
  | 'JLT'
  | 'JLE'
  | 'IN'
  | 'OUT'
  | 'HALT'

export const OPCODES: readonly OpCode[] = [
  'NOP', 'MOV', 'LOAD', 'STORE', 'ADD', 'SUB', 'CMP',
  'JMP', 'JE', 'JNE', 'JGT', 'JGE', 'JLT', 'JLE',
  'IN', 'OUT', 'HALT',
]

/** Instructions that read the comparison flag produced by `CMP`. */
export const CONDITIONAL_JUMPS: readonly OpCode[] = ['JE', 'JNE', 'JGT', 'JGE', 'JLT', 'JLE']

/** Operand shapes an instruction can be validated and executed against. */
export type OperandKind = 'register' | 'immediate' | 'address' | 'device' | 'label'

/**
 * A parsed operand. `kind` narrows the payload:
 * - `register`  → `value` is the 0-based register index
 * - `immediate` → `value` is the 16-bit literal
 * - `address`   → `value` is the 0-based RAM cell (written `[0x20]`)
 * - `label`     → `value` is unused, `name` holds the identifier
 * - `device`    → `value` is unused, `name` holds the device identifier
 */
export type Operand =
  | { kind: 'register'; value: number; text: string }
  | { kind: 'immediate'; value: number; text: string }
  | { kind: 'address'; value: number; text: string }
  | { kind: 'label'; value: number; name: string; text: string }
  | { kind: 'device'; value: number; name: string; text: string }

/** A single source line reduced to what the compiler needs. */
export interface ParsedInstruction {
  /** 1-based line number in the original source. Keeps editor/debugger alignment. */
  line: number
  /** OPCODE. Empty string for a line that is only a label declaration. */
  opcode: string
  /** Uppercased mnemonic, kept for messages even when `opcode` is invalid. */
  mnemonic: string
  operands: Operand[]
  /** Labels declared on their own line, e.g. `OVERHEAT:`. */
  labels: string[]
  /** Raw source text of the line (without the trailing newline). */
  text: string
}

/** Result of tokenising and parsing one source file. */
export interface ParsedProgram {
  instructions: ParsedInstruction[]
  diagnostics: Diagnostic[]
}

/** A compiled instruction as stored in the processor's program memory. */
export interface CompiledInstruction {
  opcode: OpCode
  operands: Operand[]
  /** 1-based source line the instruction came from. */
  sourceLine: number
  /** Index of this instruction in the compiled program. */
  address: number
}

/** Result of compiling a source file. */
export interface CompiledProgram {
  instructions: CompiledInstruction[]
  /** Label → instruction index. Labels never degrade into line numbers. */
  labels: Map<string, number>
  /** Source line (1-based) → instruction index, for debugger breakpoints. */
  lineToAddress: Map<number, number>
  diagnostics: Diagnostic[]
}

/**
 * Error categories the parser, compiler and processor report. They are stable
 * string codes so tests and the UI can branch on them without string matching.
 */
export type DiagnosticCode =
  // --- syntax / parsing -----------------------------------------------------
  | 'UNKNOWN_INSTRUCTION'
  | 'BAD_ARGUMENT_COUNT'
  | 'BAD_OPERAND'
  | 'BAD_NUMBER'
  | 'BAD_REGISTER'
  | 'BAD_ADDRESS'
  | 'TRAILING_TEXT'
  | 'EMPTY_OPERAND'
  // --- labels ---------------------------------------------------------------
  | 'DUPLICATE_LABEL'
  | 'UNKNOWN_LABEL'
  | 'INVALID_LABEL'
  // --- runtime --------------------------------------------------------------
  | 'UNKNOWN_DEVICE'
  | 'DEVICE_READ_ERROR'
  | 'DEVICE_WRITE_ERROR'
  | 'COMPARE_NOT_SET'
  | 'INVALID_RAM_ACCESS'
  | 'PROCESSOR_HALTED'
  | 'STEP_BUDGET_EXCEEDED'
  | 'PROGRAM_NOT_LOADED'

export type DiagnosticPhase = 'parse' | 'compile' | 'runtime'

/**
 * One problem, with everything the editor and debugger need to point the
 * player at the exact spot: a code, a human message, the source line and,
 * when it is known, the column the operand starts at.
 */
export interface Diagnostic {
  code: DiagnosticCode
  message: string
  phase: DiagnosticPhase
  /** 1-based source line. 0 when the diagnostic is not tied to a line. */
  line: number
  /** 1-based column inside the line, or null when unknown. */
  column: number | null
  /** Raw text of the offending line, for editor highlighting. */
  text?: string
}
