import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  observed.handlers.get('tools/result')(plan, { value: { taskId: 'task', workspaceId: 'workspace', iteration: 2, state: 'planned', protocolVersion: 2 } })
  const exec = { name: 'pwsh', callId: 'shell', agent, arguments: { command: 'npm test' } }
  await observed.handlers.get('tools/execute')(exec, async () => ({}))
  observed.handlers.get('tools/result')(plan, { value: { taskId: 'other', workspaceId: 'other-workspace', iteration: 9, state: 'planned' } })
  observed.handlers.get('tools/result')(exec, { value: { exitCode: 0, stdout: { text: 'E2E_EVIDENCE=' + 'a'.repeat(32) } } })
  const recorded = observed.records().find(record => record.callId === 'shell' && record.kind === 'result')
  assert.equal(recorded.taskId, 'task')
  assert.equal(recorded.workspaceId, 'workspace')
  assert.equal(recorded.iteration, 2)
  assert.equal(recorded.protocolVersion, 2)
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

for (const [mode, result] of [
  ['local', { value: { localReady: false } }],
  ['local', { isError: true }],
  ['app-proof', { value: { localReady: true, appDataPlaneVerified: false } }],
  ['app-proof', { value: {} }],
  ['app-proof', { isError: true }],
]) test('failed explicit ' + mode + ' readiness closes tool admission before another dispatch', async t => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'planner-executor-stop-')), 'events.jsonl')
  const observed = fixture(report)
  let signals = 0, dispatched = false
  const emit = process.emit
  t.mock.method(process, 'emit', function (name, ...args) {
    if (name === 'SIGTERM') { signals++; return true }
    return emit.call(this, name, ...args)
  })
  const exec = { name: 'chatgpt_doctor', callId: 'failed-readiness', agent: { session: { id: 'session' } }, arguments: { mode } }
  await observed.handlers.get('tools/execute')(exec, async () => ({}))
  observed.handlers.get('tools/result')(exec, result)
  await assert.rejects(observed.handlers.get('tools/execute')({ ...exec, callId: 'forbidden-app-proof', arguments: { mode: 'app-proof' } }, async () => { dispatched = true }), /ACCEPTANCE_READINESS_FAILED/)
  assert.equal(dispatched, false)
  assert.equal(observed.records().filter(record => record.kind === 'acceptance-stop').length, 1)
  assert.equal(observed.records().some(record => record.kind === 'dispatch' && record.callId === 'forbidden-app-proof'), false)
  assert.equal(signals, 1)
})

test('local readiness ignores the unrequested remote proof and ordinary test failures remain repairable', async () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'planner-executor-nonfatal-')), 'events.jsonl')
  const observed = fixture(report)
  const exec = { name: 'chatgpt_doctor', callId: 'local', arguments: { mode: 'local' } }
  await observed.handlers.get('tools/execute')(exec, async () => ({}))
  observed.handlers.get('tools/result')(exec, { value: { localReady: true, appDataPlaneVerified: false } })
  const shell = { name: 'pwsh', callId: 'red-test', arguments: { command: 'npm test' } }
  await observed.handlers.get('tools/execute')(shell, async () => ({}))
  observed.handlers.get('tools/result')(shell, { isError: true, value: { exitCode: 1 } })
  let continued = false
  await observed.handlers.get('tools/execute')({ ...shell, callId: 'fix' }, async () => { continued = true })
  assert.equal(continued, true)
  assert.equal(observed.records().some(record => record.kind === 'acceptance-stop'), false)
})

test('a restarted observer preserves fatal readiness for the same run but ignores other runs', async () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'planner-executor-restored-stop-')), 'events.jsonl')
  writeFileSync(report, JSON.stringify({ runId: process.env.PLANNER_EXECUTOR_RUN_ID, kind: 'result', name: 'chatgpt_doctor', mode: 'local', localReady: false }) + '\n')
  const observed = fixture(report)
  let dispatched = false
  await assert.rejects(observed.handlers.get('tools/execute')({ name: 'chatgpt_reconnect', callId: 'forbidden', arguments: {} }, async () => { dispatched = true }), /ACCEPTANCE_READINESS_FAILED/)
  assert.equal(dispatched, false)
  writeFileSync(report, JSON.stringify({ runId: 'another-run', kind: 'acceptance-stop' }) + '\n')
  const fresh = fixture(report)
  await fresh.handlers.get('tools/execute')({ name: 'chatgpt_doctor', callId: 'allowed', arguments: { mode: 'local' } }, async () => { dispatched = true })
  assert.equal(dispatched, true)
})
