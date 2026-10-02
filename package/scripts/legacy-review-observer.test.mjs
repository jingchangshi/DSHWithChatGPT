import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../tests/fixtures/legacy-review-observer.mjs'
function fixture(report) {
  const handlers = new Map()
  apply({ on: (name, handler) => handlers.set(name, handler) }, { report, stopOnFix: false })
  return { handlers, records: () => readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}
test('observer delegates unchanged and records only successful shell nonces', async () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'legacy-review-observer-')), 'events.jsonl')
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
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'legacy-review-observer-')), 'events.jsonl')
  const observed = fixture(report)
  observed.handlers.get('tools/result')({ name: 'chatgpt_review', callId: 'review', arguments: {} }, { value: { taskId: 'task', state: 'done', iteration: 2, summary: 'E2E_EVIDENCE=' + 'c'.repeat(32), actions: 'PRIVATE_ACTIONS', arbitrary: 'PRIVATE_VALUE' } })
  const record = observed.records().at(-1)
  assert.equal(record.taskId, 'task')
  assert.equal(record.reviewNonce, 'c'.repeat(32))
  assert.equal(JSON.stringify(record).includes('PRIVATE'), false)
})

test('observer restart restores only the canonical run nonce despite obsolete environment values', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'legacy-review-observer-'))
  const report = path.join(directory, 'events.jsonl')
  const keys = ['PLANNER_EXECUTOR_RUN_ID', 'PLANNER_EXECUTOR_PHASE', 'C2C_E2E_RUN_ID', 'C2C_E2E_PHASE']
  const previous = new Map(keys.map(key => [key, process.env[key]]))
  const nonce = 'a'.repeat(32)
  const foreign = 'b'.repeat(32)
  try {
    process.env.PLANNER_EXECUTOR_RUN_ID = 'current-run'
    process.env.PLANNER_EXECUTOR_PHASE = '2'
    process.env.C2C_E2E_RUN_ID = 'obsolete-run'
    process.env.C2C_E2E_PHASE = '1'
    writeFileSync(report, [
      { kind: 'result', runId: 'current-run', nonce },
      { kind: 'result', runId: 'obsolete-run', nonce: foreign },
    ].map(record => JSON.stringify(record)).join('\n') + '\n')
    const restarted = fixture(report)
    assert.equal(restarted.records().at(-1).runId, 'current-run')
    assert.equal(restarted.records().at(-1).phase, '2')
    const result = { value: { state: 'done' } }
    await restarted.handlers.get('tools/execute')({ name: 'chatgpt_review', arguments: { note: nonce } }, async () => result)
    assert.equal(restarted.records().at(-1).reviewArgumentNonceLeak, true)
    await restarted.handlers.get('tools/execute')({ name: 'chatgpt_review', arguments: { note: foreign } }, async () => result)
    assert.equal(restarted.records().at(-1).reviewArgumentNonceLeak, false)
  } finally {
    for(const [key,value] of previous) { if(value===undefined)delete process.env[key]; else process.env[key]=value }
    rmSync(directory, { recursive:true, force:true })
  }
})
