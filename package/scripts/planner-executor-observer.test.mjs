import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../tests/fixtures/planner-executor-e2e-observer.mjs'

function fixture(report) {
  const handlers = new Map()
  apply({ on: (name, handler) => handlers.set(name, handler) }, { report, stopOnFix: false })
  return { handlers, records: () => readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}

test('canonical observer records successful nonce provenance and rejects review leaks', async () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'planner-executor-observer-')), 'events.jsonl')
  const observed = fixture(report)
  const nonce = 'a'.repeat(32)
  const exec = { name: 'pwsh', callId: 'shell-1', arguments: { command: 'npm test' } }
  const result = { value: { exitCode: 0, stdout: { text: 'E2E_EVIDENCE=' + nonce } } }
  await observed.handlers.get('tools/execute')(exec, async () => result)
  observed.handlers.get('tools/result')(exec, result)
  const review = { name: 'chatgpt_review', callId: 'review', arguments: { note: nonce } }
  await observed.handlers.get('tools/execute')(review, async () => ({ value: { taskId: 'task', state: 'done', iteration: 1, summary: 'E2E_EVIDENCE=' + nonce } }))
  observed.handlers.get('tools/result')(review, { value: { taskId: 'task', state: 'done', iteration: 1, summary: 'E2E_EVIDENCE=' + nonce } })
  const records = observed.records()
  assert.equal(records.find(record => record.callId === 'shell-1' && record.kind === 'result').nonce, nonce)
  assert.equal(records.find(record => record.callId === 'review' && record.kind === 'dispatch').reviewArgumentNonceLeak, true)
})
