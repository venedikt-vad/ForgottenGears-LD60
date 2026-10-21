import { describeKindSet, hasErrors, isOpcode, makeDiagnostic, specFor } from './isa'
import { parseProgram } from './parser'
import {
  MAX_RAM_ADDRESS,
  type CompiledInstruction,
  type CompiledProgram,
  type Diagnostic,
  type Operand,
  type OperandKind,
  type ParsedInstruction,
  type ParsedProgram,
} from './types'

/**
 * RASM compiler.
 *
 * Two passes:
 *  1. walk the parsed instructions and register every label with the index of
 *     the instruction it points at (a label alone on a line points at the next
 *     real instruction);
 *  2. validate operand shapes against the ISA table and rewrite identifier
 *     operands into either a resolved label target or a device port name.
 *
 * A program with any parse or compile diagnostic is never executable: callers
 * must check `diagnostics` before loading it into the processor.
 */

interface PassOneResult {
  /** Label → instruction index. */
  labels: Map<string, number>
  /** Label → source line it was declared on, for duplicate reporting. */
  labelLines: Map<string, number>
  diagnostics: Diagnostic[]
  /** Only instructions that actually carry an opcode, in program order. */
  executable: ParsedInstruction[]
  /** The index in `executable` that each parsed line maps onto. */
  addressOfLine: Map<number, number>
}

function passLabels(parsed: ParsedProgram): PassOneResult {
  const diagnostics: Diagnostic[] = [...parsed.diagnostics]
  const labels = new Map<string, number>()
  const labelLines = new Map<string, number>()
  const executable: ParsedInstruction[] = []
  const addressOfLine = new Map<number, number>()

  for (const instruction of parsed.instructions) {
    // A label points at the next executable instruction. Resolving it here means
    // labels are instruction indices, exactly as the specification requires.
    const target = executable.length
    for (const label of instruction.labels) {
      if (labels.has(label)) {
        diagnostics.push(makeDiagnostic(
          'DUPLICATE_LABEL',
          `Label "${label}" is declared more than once (first declared on line ${labelLines.get(label)}).`,
          'compile',
          instruction.line,
          null,
          instruction.text,
        ))
        continue
      }
      labels.set(label, target)
      labelLines.set(label, instruction.line)
    }

    if (instruction.opcode.length === 0) continue // pure label line

    addressOfLine.set(instruction.line, executable.length)
    executable.push(instruction)
  }

  return { labels, labelLines, diagnostics, executable, addressOfLine }
}

/** Check that an operand's shape is allowed at a position, reporting otherwise. */
function checkOperandKind(
  operand: Operand,
  allowed: readonly OperandKind[],
  opcode: string,
  operandIndex: number,
  line: number,
  text: string,
  column: number | null,
): Diagnostic | null {
  // Identifiers arrive as `device` from the parser but may legally be labels.
  const kind: OperandKind = operand.kind
  const accepted = allowed.includes(kind) || (kind === 'device' && allowed.includes('label'))
  if (accepted) return null
  return makeDiagnostic(
    'BAD_OPERAND',
    `Operand ${operandIndex + 1} of ${opcode} must be ${describeKindSet(allowed)}, but "${operand.text}" is not.`,
    'compile',
    line,
    column,
    text,
  )
}

/**
 * Compile RASM source into processor instructions.
 *
 * `lineToAddress` maps a 1-based source line to the instruction index it
 * produced, which is what the debugger uses for "run to cursor" and for
 * highlighting the currently executing source line.
 */
export function compileProgram(source: string): CompiledProgram {
  const parsed = parseProgram(source)
  const pass1 = passLabels(parsed)
  const diagnostics: Diagnostic[] = [...pass1.diagnostics]
  const instructions: CompiledInstruction[] = []
  const labels = pass1.labels
  const lineToAddress = new Map<number, number>()

  const columnOfOperand = (line: ParsedInstruction, index: number): number | null => {
    // The parser does not keep columns on operands, so re-derive a close-enough
    // column by locating the operand text in the raw line from the right.
    const needle = line.operands[index]?.text
    if (!needle) return null
    const at = line.text.lastIndexOf(needle)
    return at >= 0 ? at + 1 : null
  }

  for (const line of pass1.executable) {
    const mnemonic = line.opcode.toUpperCase()

    if (!isOpcode(mnemonic)) {
      diagnostics.push(makeDiagnostic(
        'UNKNOWN_INSTRUCTION',
        `Unknown instruction "${line.mnemonic || mnemonic}". Type "help" in the RASM window for the instruction set.`,
        'compile',
        line.line,
        null,
        line.text,
      ))
      // Keep the instruction slot so following labels keep their indices stable.
      instructions.push({ opcode: 'NOP', operands: [], sourceLine: line.line, address: instructions.length })
      lineToAddress.set(line.line, instructions.length - 1)
      continue
    }

    const spec = specFor(mnemonic)!
    const operands = line.operands

    if (operands.length !== spec.operands.length) {
      diagnostics.push(makeDiagnostic(
        'BAD_ARGUMENT_COUNT',
        `${mnemonic} expects ${spec.operands.length} operand${spec.operands.length === 1 ? '' : 's'}, got ${operands.length}.`,
        'compile',
        line.line,
        null,
        line.text,
      ))
      instructions.push({ opcode: mnemonic, operands: [], sourceLine: line.line, address: instructions.length })
      lineToAddress.set(line.line, instructions.length - 1)
      continue
    }

    const resolved: Operand[] = []
    let lineOk = true
    for (let i = 0; i < operands.length; i += 1) {
      const operand = operands[i]!
      const allowed = spec.operands[i]!
      const column = columnOfOperand(line, i)

      const kindError = checkOperandKind(operand, allowed, mnemonic, i, line.line, line.text, column)
      if (kindError) {
        diagnostics.push(kindError)
        lineOk = false
      }

      if (operand.kind === 'register' && operand.value > MAX_RAM_ADDRESS && allowed.includes('address')) {
        // Defensive: addressed cells are validated in the parser; nothing to do.
      }

      if (operand.kind !== 'device' && operand.kind !== 'label') {
        // Numeric operand (register / immediate / address): nothing to resolve.
        resolved.push(operand)
        continue
      }

      // Identifier operand: a `label` slot resolves to a jump target, a `device`
      // slot is a port name handed to the bus at runtime.
      const identifier = operand.name
      if (allowed.includes('label') && !allowed.includes('device')) {
        const target = labels.get(identifier)
        if (target === undefined) {
          diagnostics.push(makeDiagnostic(
            'UNKNOWN_LABEL',
            `Unknown label "${identifier}". Declare it as "${identifier}:" somewhere in the program.`,
            'compile',
            line.line,
            column,
            line.text,
          ))
          lineOk = false
          resolved.push({ kind: 'label', value: 0, name: identifier, text: operand.text })
          continue
        }
        resolved.push({ kind: 'label', value: target, name: identifier, text: operand.text })
        continue
      }
      resolved.push({ kind: 'device', value: 0, name: identifier, text: operand.text })
    }

    lineToAddress.set(line.line, instructions.length)
    instructions.push({
      opcode: mnemonic,
      operands: lineOk ? resolved : resolved,
      sourceLine: line.line,
      address: instructions.length,
    })
  }

  return { instructions, labels, lineToAddress, diagnostics }
}

/** True when a compiled program is safe to load into the processor. */
export function isRunnable(program: CompiledProgram): boolean {
  return !hasErrors(program.diagnostics)
}

/**
 * Convenience: parse and compile, then return both the program and a boolean
 * so callers do not have to import `hasErrors` separately.
 */
export function prepareProgram(source: string): { program: CompiledProgram; ok: boolean } {
  const program = compileProgram(source)
  return { program, ok: isRunnable(program) }
}

/**
 * Render diagnostics as human-readable one-liners for a console or log.
 * Kept in the language core (no UI dependency) so every host formats errors
 * the same way: `line 12:4: BAD_REGISTER — Register index 9 is out of range.`
 */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string[] {
  if (!diagnostics.length) return ['OK: no problems found.']
  return diagnostics.map((d) => `line ${d.line}${d.column ? `:${d.column}` : ''}: ${d.code} — ${d.message}`)
}
