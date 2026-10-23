import test from 'node:test'
import assert from 'node:assert/strict'

import {
  byteLength,
  RASM_DOC_PATH,
  VFS_LIMITS,
  VirtualFileSystem,
} from '../src/game/VirtualFileSystem'

/**
 * The language reference used to live only in the repository. These checks
 * keep the in-game copy present, readable and inside the VFS quotas so `cat`,
 * `vim` and the editor's `:help rasm` can rely on it.
 */

test('the RASM reference is shipped in the robot filesystem', () => {
  const fileSystem = new VirtualFileSystem()

  for (const language of ['ru', 'en'] as const) {
    const lines = fileSystem.read(RASM_DOC_PATH, language)
    assert.ok(lines && lines.length > 20, `missing ${language} documentation`)

    const text = lines.join('\n')
    for (const mnemonic of ['MOV', 'LOAD', 'STORE', 'CMP', 'JGE', 'IN', 'OUT', 'HALT']) {
      assert.ok(text.includes(mnemonic), `${language} reference does not mention ${mnemonic}`)
    }
    for (const error of ['COMPARE_NOT_SET', 'STEP_BUDGET_EXCEEDED', 'UNKNOWN_LABEL']) {
      assert.ok(text.includes(error), `${language} reference does not mention ${error}`)
    }
  }
})

test('the reference is discoverable from the docs directory and the manual', () => {
  const fileSystem = new VirtualFileSystem()

  assert.ok(fileSystem.list('/usr/share/docs', 'ru').includes('rasm.txt'))

  const manual = fileSystem.read('/manual/operator.txt', 'ru')?.join('\n') ?? ''
  assert.ok(manual.includes(RASM_DOC_PATH))
})

test('the reference stays within the editable VFS file quota', () => {
  const fileSystem = new VirtualFileSystem()
  const ru = fileSystem.read(RASM_DOC_PATH, 'ru')?.join('\n') ?? ''
  const en = fileSystem.read(RASM_DOC_PATH, 'en')?.join('\n') ?? ''

  // `:w` writes one text into both language copies, so the doubled size has to
  // fit the per-file limit applied by VirtualFileSystem.writeEx.
  assert.ok(byteLength(ru) + byteLength(en) <= VFS_LIMITS.maxFileBytes)
})
