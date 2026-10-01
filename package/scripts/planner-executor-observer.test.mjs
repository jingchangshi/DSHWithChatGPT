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

test('observer freezes shell task/workspace/iteration before dispatch and records reviewer identity', async () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'planner-executor-observer-')), 'events.jsonl')
  const observed = fixture(report)
  const agent = { session: { id: 'session' } }
  const plan = { name: 'chatgpt_plan', callId: 'plan', agent, arguments: { goal: 'work' } }
  observed.handlers.get('tools/result')(plan, { value: { taskId: 'task', workspaceId: 'workspace', iteration: 2, state: 'planned' } })
  const exec = { name: 'pwsh', callId: 'shell', agent, arguments: { command: 'npm test' } }
  await observed.handlers.get('tools/execute')(exec, async () => ({}))
  observed.handlers.get('tools/result')(plan, { value: { taskId: 'other', workspaceId: 'other-workspace', iteration: 9, state: 'planned' } })
  observed.handlers.get('tools/result')(exec, { value: { exitCode: 0, stdout: { text: 'E2E_EVIDENCE=' + 'a'.repeat(32) } } })
  const recorded = observed.records().find(record => record.callId === 'shell' && record.kind === 'result')
  assert.equal(recorded.taskId, 'task')
  assert.equal(recorded.workspaceId, 'workspace')
  assert.equal(recorded.iteration, 2)
  const review = { name: 'chatgpt_review', callId: 'review', agent, arguments: { taskId: 'other', head: 'b'.repeat(40) } }
  await observed.handlers.get('tools/execute')(review, async () => ({}))
  observed.handlers.get('tools/result')(review, { value: { taskId: 'other', workspaceId: 'other-workspace', iteration: 10, state: 'done', head: 'b'.repeat(40) } })
  assert.equal(observed.records().find(record => record.callId === 'review' && record.kind === 'dispatch').reviewTaskId, 'other')
  assert.equal(observed.records().find(record => record.callId === 'review' && record.kind === 'result').head, 'b'.repeat(40))
})

test('observer selects the final marker from a successful test and never attributes a failed result', async () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'planner-executor-observer-')), 'events.jsonl')
  const observed = fixture(report)
  const exec = { name: 'pwsh', callId: 'test', arguments: { command: 'npm test' } }
  observed.handlers.get('tools/result')(exec, { value: { exitCode: 0, stdout: { text: 'E2E_EVIDENCE=' + 'a'.repeat(32) + '\nE2E_EVIDENCE=' + 'b'.repeat(32) } } })
  observed.handlers.get('tools/result')({ ...exec, callId: 'failed' }, { isError: true, value: { exitCode: 0, stdout: { text: 'E2E_EVIDENCE=' + 'c'.repeat(32) } } })
  assert.equal(observed.records().find(record => record.callId === 'test').nonce, 'b'.repeat(32))
  assert.equal(observed.records().find(record => record.callId === 'failed' && record.kind === 'result').nonce, undefined)
})
