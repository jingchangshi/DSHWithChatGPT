import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../tests/fixtures/c2c-e2e-observer.mjs'
function fixture(report) {
  const handlers = new Map()
  apply({ on: (name, handler) => handlers.set(name, handler) }, { report, stopOnFix: false })
  return { handlers, records: () => readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}
test('observer delegates unchanged and records only successful shell nonces', async () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'c2c-observer-')), 'events.jsonl')
  const observed = fixture(report)
  const result = { value: { exitCode: 0, stdout: { text: 'E2E_EVIDENCE=' + 'a'.repeat(32) } } }
  const exec = { name: 'pwsh', callId: 'shell-1', arguments: { command: 'npm test' } }
  let calls = 0
  assert.equal(await observed.handlers.get('tools/execute')(exec, async () => { calls++; return result }), result)
  assert.equal(calls, 1)
  observed.handlers.get('tools/result')(exec, result)
  observed.handlers.get('tools/result')({ ...exec, callId: 'failed' }, { value: { exitCode: 1, stdout: { text: 'E2E_EVIDENCE=' + 'b'.repeat(32) } } })
  assert.equal(observed.records().find(record => record.callId === 'failed').nonce, undefined)
  await observed.handlers.get('tools/execute')({ name: 'chatgpt_review', arguments: { note: 'a'.repeat(32) } }, async () => result)
  assert.equal(observed.records().at(-1).reviewArgumentNonceLeak, true)
  const resumed = fixture(report)
  await resumed.handlers.get('tools/execute')({ name: 'chatgpt_review', arguments: { note: 'a'.repeat(32) } }, async () => result)
  assert.equal(resumed.records().at(-1).reviewArgumentNonceLeak, true)
})
test('observer projects review metadata without actions or arbitrary values', () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'c2c-observer-')), 'events.jsonl')
  const observed = fixture(report)
  observed.handlers.get('tools/result')({ name: 'chatgpt_review', callId: 'review', arguments: {} }, { value: { taskId: 'task', state: 'done', iteration: 2, summary: 'E2E_EVIDENCE=' + 'c'.repeat(32), actions: 'PRIVATE_ACTIONS', arbitrary: 'PRIVATE_VALUE' } })
  const record = observed.records().at(-1)
  assert.equal(record.taskId, 'task')
  assert.equal(record.reviewNonce, 'c'.repeat(32))
  assert.equal(JSON.stringify(record).includes('PRIVATE'), false)
})
