import { makeDiagnostic } from './isa'
import {
  MAX_RAM_ADDRESS,
  MAX_REGISTER_INDEX,
  RAM_SIZE,
  WORD_MASK,
  type Diagnostic,
  type Operand,
  type ParsedInstruction,
  type ParsedProgram,
} from './types'

/**
 * RASM parser.
 *
 * Grammar (one statement per source line):
 *
 *   line        := [ label ] [ instruction ] [ comment ]
 *   label       := IDENT ':'
 *   instruction := IDENT [ operand { ',' operand } ]
 *   operand     := register | immediate | address | device | label
 *   register    := 'R' digit                       ; R0..R7
 *   immediate   := '#' number                      ; decimal or 0x hex
 *   address     := '[' number ']'                  ; 0..255
 *   device      := IDENT                           ; device port name
 *   comment     := ';' ...end-of-line
 *
 * Mnemonics, register names and device names are case-insensitive. Labels are
 * resolved by the compiler, so the parser only records their identifiers and
 * the source column they start at.
 */

/** Maximum value an immediate can hold: registers and RAM are 16-bit. */
const MAX_IMMEDIATE = WORD_MASK

interface Token {
  text: string
  /** 1-based column of the token's first character. */
  column: number
}

/** Strip a `;` comment, respecting nothing else: RASM has no string literals. */
function stripComment(line: string): string {
  const commentAt = line.indexOf(';')
  return commentAt >= 0 ? line.slice(0, commentAt) : line
}

/**
 * Split the operand list into comma-separated tokens while tracking the column
 * each token starts at. Brackets are kept intact inside a token so `[0x20]`
 * stays a single operand. Commas are the only operand separator, so `MOV R0,
 * #1` yields the operands `R0` and `#1`.
 */
export function tokenizeOperands(text: string, startColumn: number): Token[] {
  const tokens: Token[] = []
  let current = ''
  let currentColumn = startColumn
  let depth = 0

  const flush = (): void => {
    const trimmed = current.trim()
    if (trimmed.length > 0) {
      // The token may be padded with spaces; point the column at the trimmed start.
      const leading = current.length - current.trimStart().length
      tokens.push({ text: trimmed, column: currentColumn + leading })
    }
    current = ''
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (ch === '[') depth += 1
    if (ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      flush()
      currentColumn = startColumn + i + 1
      continue
    }
    if (current === '' && (ch === ' ' || ch === '\t')) {
      // Leading whitespace: keep the column pointing at the first real character.
      currentColumn = startColumn + i + 1
      continue
    }
    current += ch
  }
  flush()
  return tokens
}

/**
 * Parse a numeric literal. Accepts decimal (`80`) and hexadecimal with either
 * `0x` or `0X` prefix (`0x50`). Rejects sign characters, empty strings and
 * anything with a non-digit tail, so `12abc` is reported instead of silently
 * read as 12.
 */
export function parseNumber(raw: string): { ok: true; value: number } | { ok: false } {
  const text = raw.trim()
  if (text.length === 0) return { ok: false }
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) {
    const value = Number.parseInt(text.slice(2), 16)
    return Number.isFinite(value) ? { ok: true, value } : { ok: false }
  }
  if (/^[0-9]+$/.test(text)) {
    const value = Number.parseInt(text, 10)
    return Number.isFinite(value) ? { ok: true, value } : { ok: false }
  }
  return { ok: false }
}

const REGISTER_PATTERN = /^r([0-9]+)$/i
const LABEL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Parse a single register operand such as `R0` or `r7`. */
function parseRegister(raw: string, line: number, column: number, diagnostics: Diagnostic[]): Operand | null {
  const match = REGISTER_PATTERN.exec(raw)
  if (!match) return null
  const index = Number.parseInt(match[1]!, 10)
  if (index < 0 || index > MAX_REGISTER_INDEX) {
    diagnostics.push(makeDiagnostic(
      'BAD_REGISTER',
      `Register ${raw.toUpperCase()} is out of range; RASM has R0..R${MAX_REGISTER_INDEX}.`,
      'parse',
      line,
      column,
      raw,
    ))
    // Return a placeholder so the instruction keeps its operand count and the
    // compiler does not also report a missing argument for the same typo.
    return { kind: 'register', value: 0, text: raw }
  }
  return { kind: 'register', value: index, text: raw }
}

/** Parse an immediate operand such as `#10` or `#0x50`. */
function parseImmediate(raw: string, line: number, column: number, diagnostics: Diagnostic[]): Operand | null {
  if (!raw.startsWith('#')) return null
  const body = raw.slice(1)
  const parsed = parseNumber(body)
  if (!parsed.ok) {
    diagnostics.push(makeDiagnostic(
      'BAD_NUMBER',
      `"${raw}" is not a valid number. Use decimal (80) or hexadecimal (0x50).`,
      'parse',
      line,
      column,
      raw,
    ))
    return { kind: 'immediate', value: 0, text: raw }
  }
  if (parsed.value > MAX_IMMEDIATE) {
    diagnostics.push(makeDiagnostic(
      'BAD_NUMBER',
      `Value ${raw} does not fit in a 16-bit word (0..${MAX_IMMEDIATE}).`,
      'parse',
      line,
      column,
      raw,
    ))
  }
  return { kind: 'immediate', value: parsed.value & WORD_MASK, text: raw }
}

/** Parse a RAM address operand such as `[0x20]` or `[32]`. */
function parseAddress(raw: string, line: number, column: number, diagnostics: Diagnostic[]): Operand | null {
  if (!raw.startsWith('[')) return null
  if (!raw.endsWith(']')) {
    diagnostics.push(makeDiagnostic(
      'BAD_ADDRESS',
      `"${raw}" is missing the closing "]" of a RAM address.`,
      'parse',
      line,
      column,
      raw,
    ))
    return { kind: 'address', value: 0, text: raw }
  }
  const body = raw.slice(1, -1)
  const parsed = parseNumber(body)
  if (!parsed.ok) {
    diagnostics.push(makeDiagnostic(
      'BAD_NUMBER',
      `"${raw}" does not contain a valid RAM address.`,
      'parse',
      line,
      column,
      raw,
    ))
    return { kind: 'address', value: 0, text: raw }
  }
  if (parsed.value < 0 || parsed.value > MAX_RAM_ADDRESS) {
    diagnostics.push(makeDiagnostic(
      'BAD_ADDRESS',
      `RAM address ${parsed.value} is out of range; valid cells are 0..${MAX_RAM_ADDRESS} (${RAM_SIZE} cells).`,
      'parse',
      line,
      column,
      raw,
    ))
    return { kind: 'address', value: parsed.value & 0xffff, text: raw }
  }
  return { kind: 'address', value: parsed.value, text: raw }
}

/**
 * Parse the operands of one instruction line. Labels are left unresolved: the
 * compiler decides whether an identifier is a jump target or a device port,
 * based on the instruction it belongs to.
 */
function parseOperands(
  tokens: Token[],
  line: number,
  diagnostics: Diagnostic[],
): Operand[] {
  const operands: Operand[] = []
  for (const token of tokens) {
    const raw = token.text
    if (raw.length === 0) {
      diagnostics.push(makeDiagnostic('EMPTY_OPERAND', 'Empty operand between commas.', 'parse', line, token.column))
      continue
    }
    const register = parseRegister(raw, line, token.column, diagnostics)
    if (register) {
      operands.push(register)
      continue
    }
    const immediate = parseImmediate(raw, line, token.column, diagnostics)
    if (immediate) {
      operands.push(immediate)
      continue
    }
    const address = parseAddress(raw, line, token.column, diagnostics)
    if (address) {
      operands.push(address)
      continue
    }
    if (LABEL_PATTERN.test(raw)) {
      // Identifier: could be a jump label or a device port. The compiler resolves it.
      operands.push({ kind: 'device', value: 0, name: raw.toUpperCase(), text: raw })
      continue
    }
    diagnostics.push(makeDiagnostic(
      'BAD_OPERAND',
      `"${raw}" is not a valid operand. Expected a register, #immediate, [address] or an identifier.`,
      'parse',
      line,
      token.column,
      raw,
    ))
  }
  return operands
}

/**
 * Parse a whole source file. Never throws: every problem lands in the returned
 * diagnostics so the editor can show a list and the processor refuses to run.
 */
export function parseProgram(source: string): ParsedProgram {
  const diagnostics: Diagnostic[] = []
  const instructions: ParsedInstruction[] = []
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!
    const lineNumber = index + 1
    const code = stripComment(rawLine)
    if (code.trim().length === 0) continue

    // Serialise label declarations: `A: B: MOV R0, #1` declares both labels.
    const labels: string[] = []
    let cursor = 0
    // Skip leading spaces while remembering where real text begins.
    while (cursor < code.length && code[cursor] === ' ') cursor += 1

    let consumedAny = false
    while (cursor < code.length) {
      const rest = code.slice(cursor)
      const labelMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(rest)
      if (!labelMatch) {
        // Something that looks like a label but breaks the identifier rule
        // (`2FAST:`, `my-label:`) is reported as such instead of being read as
        // an unknown instruction further down. The `:` must come before any
        // space, so `HALT ; note: x` is not mistaken for a label.
        const colonAt = rest.indexOf(':')
        const spaceAt = rest.search(/\s/)
        if (colonAt > 0 && (spaceAt === -1 || colonAt < spaceAt)) {
          const name = rest.slice(0, colonAt).trim()
          diagnostics.push(makeDiagnostic(
            'INVALID_LABEL',
            `"${name}" is not a valid label. Use letters, digits and "_", starting with a letter or "_".`,
            'parse',
            lineNumber,
            cursor + 1,
            rawLine,
          ))
        }
        break
      }
      consumedAny = true
      const name = labelMatch[1]!.toUpperCase()
      labels.push(name)
      cursor += labelMatch[0].length
      while (cursor < code.length && code[cursor] === ' ') cursor += 1
    }

    const remainder = code.slice(cursor).trim()
    if (remainder.length === 0) {
      // A pure label line (`OVERHEAT:`).
      if (labels.length > 0) {
        instructions.push({
          line: lineNumber,
          opcode: '',
          mnemonic: '',
          operands: [],
          labels,
          text: rawLine,
        })
        continue
      }
      // Unreachable: empty code was filtered above.
      if (!consumedAny) continue
      continue
    }

    const statementColumn = cursor + 1
    // The mnemonic is the first whitespace-delimited word; the rest of the line
    // is the comma-separated operand list.
    const mnemonicMatch = /^([^\s,]+)/.exec(remainder)
    if (!mnemonicMatch) continue
    const mnemonic = mnemonicMatch[1]!.toUpperCase()
    const mnemonicColumn = statementColumn
    const afterMnemonic = remainder.slice(mnemonicMatch[0].length)
    // Report leftovers that are glued to the mnemonic without a space, e.g.
    // `HALT#1`, instead of silently ignoring them.
    if (afterMnemonic.length > 0 && afterMnemonic[0] !== ' ' && afterMnemonic[0] !== '\t') {
      diagnostics.push(makeDiagnostic(
        'TRAILING_TEXT',
        `Unexpected text "${afterMnemonic.trim()}" after "${mnemonicMatch[0]}". Separate the instruction and its operands with a space.`,
        'parse',
        lineNumber,
        mnemonicColumn + mnemonicMatch[0].length,
        rawLine,
      ))
    }
    const operandTokens = tokenizeOperands(afterMnemonic, mnemonicColumn + mnemonicMatch[0].length)
    const operands = parseOperands(operandTokens, lineNumber, diagnostics)

    instructions.push({
      line: lineNumber,
      opcode: mnemonic,
      mnemonic,
      operands,
      labels,
      text: rawLine,
    })
  }

  return { instructions, diagnostics }
}
