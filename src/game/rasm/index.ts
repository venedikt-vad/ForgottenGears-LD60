/**
 * RASM (Robot Assembly) language core — public entry point.
 *
 * Layering (each layer depends only on the ones above it):
 *
 *   types.ts      machine limits and shared data shapes
 *   isa.ts        instruction table (operand shapes, summaries)
 *   parser.ts     source text → typed instructions + parse diagnostics
 *   compiler.ts   instructions → processor program, label resolution
 *   bus.ts        device bus interface + demo hardware
 *   processor.ts  the virtual machine: step()/run(), registers, RAM, flags
 *   debugger.ts   breakpoints and a step/run session on top of the processor
 *
 * Nothing in this folder imports the DOM, the game windows or a UI framework,
 * so the whole language can be unit-tested in plain Node.
 */
export * from './types'
export * from './isa'
export { parseProgram, parseNumber } from './parser'
export { compileProgram, prepareProgram, isRunnable, formatDiagnostics } from './compiler'
export * from './bus'
export {
  Processor,
  isFatalDiagnostic,
  type BusTraceEntry,
  type ComparisonFlag,
  type ProcessorOptions,
  type ProcessorSnapshot,
  type ProcessorState,
} from './processor'
export { Debugger, type DebuggerOptions, type DebuggerRunResult, type LoadResult } from './debugger'
