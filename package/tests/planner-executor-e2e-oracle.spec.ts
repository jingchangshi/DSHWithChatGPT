import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const head = 'b'.repeat(40)
const nonce = 'c'.repeat(32)
const scope = { runId: 'run', taskId: 'task', workspaceId: 'workspace', sessionId: 'session', protocolVersion: 2 }
function fixture() {
  return [
    { ...scope, phase: '1', kind: 'result', name: 'chatgpt_doctor', mode: 'local', localReady: true },
    { ...scope, phase: '1', kind: 'result', name: 'chatgpt_doctor', mode: 'app-proof', appDataPlaneVerified: true },
    { ...scope, phase: '1', kind: 'result', name: 'chatgpt_plan', iteration: 1, state: 'planned', callId: 'plan' },
    { ...scope, phase: '1', kind: 'result', name: 'chatgpt_review', iteration: 2, state: 'planned', callId: 'fix', head },
    { ...scope, phase: '1', kind: 'restart-checkpoint', iteration: 2, callId: 'fix' },
    { ...scope, phase: '2', kind: 'result', name: 'chatgpt_reconnect', iteration: 2, recovered: true, callId: 'reconnect' },
    { ...scope, phase: '2', kind: 'dispatch', name: 'pwsh', iteration: 2, callId: 'test', testCommand: true },
    { ...scope, phase: '2', kind: 'result', name: 'pwsh', iteration: 2, callId: 'test', exitCode: 0, nonce },
    { ...scope, phase: '2', kind: 'dispatch', name: 'chatgpt_review', iteration: 2, callId: 'review', reviewTaskId: 'task', reviewHead: head },
    { ...scope, phase: '2', kind: 'result', name: 'chatgpt_review', iteration: 2, callId: 'review', state: 'done', reviewNonce: nonce, head },
  ] as Array<Record<string, any>>
}

// Execute the real runner's final block, avoiding model calls/profile installation.
// Initial red run exercises the pre-fix oracle itself, not a duplicate test oracle.
async function runOracle(records: Array<Record<string, any>>, code: number | null = 0, gitOverrides: Record<string, string> = {}) {
  const script = readFileSync(resolve(import.meta.dirname, '../scripts/verify-planner-executor-e2e.mjs'), 'utf8').replaceAll('\r\n', '\n')
  const tail = script.slice(script.lastIndexOf('{\n  const observations'))
  expect(tail.startsWith('{\n  const observations')).toBe(true)
  const evaluatorPath = resolve(import.meta.dirname, '../scripts/planner-executor-acceptance.mjs')
  const evaluateAcceptance = existsSync(evaluatorPath) ? (await import('../scripts/planner-executor-acceptance.mjs')).evaluateAcceptance : undefined
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const processFixture = { exitCode: undefined as number | undefined }
  let result: any
  const gitValues: Record<string, string> = { 'branch --show-current': 'planner-executor/e2e', 'rev-parse HEAD': head, 'rev-parse @{upstream}': head, 'status --porcelain': '', 'rev-list --count @{upstream}..HEAD': '0', ...gitOverrides }
  await new AsyncFunction('readFile', 'writeFile', 'process', 'git', 'path', 'console', 'code', 'report', 'root', 'restartPending', 'runId', 'evaluateAcceptance', tail)(
    async () => records.map(record => JSON.stringify(record)).join('\n'), async (_path: string, text: string) => { result = JSON.parse(text) }, processFixture,
    (...args: string[]) => gitValues[args.join(' ')] ?? '', { join: (...args: string[]) => args.join('/') }, { log: () => {} }, code, 'report', 'root', true, 'run', evaluateAcceptance,
  )
  return { ...result, exitCode: processFixture.exitCode }
}

describe('real Planner-Executor runner acceptance oracle', () => {
  it.each([undefined, 1])('refuses legacy or absent protocol provenance (%s) even with otherwise matching legacy evidence', async version => {
    const records = fixture()
    for (const record of records) record.protocolVersion = version
    records[9]!.iteration = 3
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it('rejects canonical DONE that uses legacy iteration advancement', async () => {
    const records = fixture(); records[9]!.iteration = 3
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it('rejects protocol provenance changing across restart', async () => {
    const records = fixture(); records[5]!.protocolVersion = 1
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it('accepts correlated final DONE, latest test and pushed identity after recovery', async () => {
    expect(await runOracle(fixture())).toMatchObject({ plannerExecutorAccepted: true, exitCode: 0 })
  })
  it('returns failure even when DSH exits zero without accepted evidence', async () => {
    expect(await runOracle([])).toMatchObject({ plannerExecutorAccepted: false, exitCode: 1 })
  })
  it('rejects an old successful test nonce after a newer successful test', async () => {
    const records = fixture()
    records.splice(8, 0, { ...records[6], callId: 'new-test' }, { ...records[7], callId: 'new-test', nonce: 'd'.repeat(32) })
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it('rejects an earlier DONE followed by another final failed review', async () => {
    const records = fixture()
    records.push({ ...records[9], callId: 'later-review', state: 'error', isError: true })
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it.each(['callId', 'taskId', 'workspaceId', 'iteration', 'head', 'runId'])('rejects final review with mismatched %s', async key => {
    const records = fixture()
    records[9]![key] = key === 'iteration' ? 99 : 'wrong'
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it('rejects the right nonce from another task', async () => {
    const records = fixture()
    records[7]!.taskId = 'other'
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it('requires a matching recovered checkpoint, not arbitrary phase-two activity', async () => {
    const records = fixture().filter(record => record.name !== 'chatgpt_reconnect')
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it('refuses a checkpoint without the corresponding fix PLAN result', async () => {
    expect((await runOracle(fixture().filter(record => record.callId !== 'fix' || record.kind === 'restart-checkpoint'))).plannerExecutorAccepted).toBe(false)
  })
  it('requires the explicit App proof, not just local startup', async () => {
    expect((await runOracle(fixture().filter(record => record.mode !== 'app-proof'))).plannerExecutorAccepted).toBe(false)
  })
  it('refuses readiness borrowed from a different executor session', async () => {
    const records = fixture()
    records[1]!.sessionId = 'other-session'
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it.each([null, 2])('does not convert unsuccessful executor exit %s into acceptance', async code => {
    expect((await runOracle(fixture(), code)).plannerExecutorAccepted).toBe(false)
    expect((await runOracle(fixture(), code)).exitCode).not.toBe(0)
  })
  it('refuses review argument evidence leakage', async () => {
    const records = fixture()
    records[8]!.reviewArgumentNonceLeak = true
    expect((await runOracle(records)).plannerExecutorAccepted).toBe(false)
  })
  it.each([{ 'branch --show-current': '' }, { 'branch --show-current': 'main' }, { 'status --porcelain': ' M x' }, { 'rev-parse @{upstream}': 'a'.repeat(40) }, { 'rev-list --count @{upstream}..HEAD': '1' }])('rejects invalid final Git identity %j', async values => {
    expect((await runOracle(fixture(), 0, values)).plannerExecutorAccepted).toBe(false)
  })
})
