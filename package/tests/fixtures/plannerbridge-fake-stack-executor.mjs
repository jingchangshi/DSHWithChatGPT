import assert from 'node:assert/strict'
import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ChatGptCoordinator } from '../../lib/orchestrator/coordinator.js'
import { CoordinatorState } from '../../lib/orchestrator/state.js'
import { SidecarChatControlClient } from '../../lib/sidecar/client.js'
import { DshGitAuthorityAdapter } from '../../lib/adapters/dsh/git-authority.js'
import { WorkspaceRuntimeRegistry } from '../../lib/workspace/runtime.js'

// Explicit test StateStore/ExecutionWorkspacePort adapters. Host file/Git use
// stays in this fixture; production producer authorization is tested separately.
const config = JSON.parse(await readFile(process.env.PLANNERBRIDGE_FIXTURE_CONFIG, 'utf8'))
const { root, workspace, workspaceId, taskId } = config
const phase = process.argv[2]
const statePath = path.join(root, 'core.json')
let data = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'))
const persist = async () => {
  await writeFile(statePath + '.tmp', JSON.stringify(data))
  await rename(statePath + '.tmp', statePath)
}
const store = new CoordinatorState({
  get: async key => structuredClone(data[key]),
  put: async (key, value) => { data[key] = structuredClone(value); await persist() },
  delete: async key => { delete data[key]; await persist() },
})
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
const registry = new WorkspaceRuntimeRegistry()
let acquisitions = 0, releases = 0, queries = 0, snapshots = 0
const workspacePort = { withOperation: async (_request, callback) => {
  acquisitions++
  const abort = new AbortController()
  const release = registry.acquire({ identity: { workspaceId, displayRoot: workspace }, generation: Symbol(), signal: abort.signal,
    capabilities: { workspaceContentRead: { available: true }, gitRead: { available: true }, executionOutput: { available: false, reason: 'EXECUTION_OUTPUT_UNAVAILABLE' } },
    git: { signal: abort.signal, execute: async (args, options) => {
      queries++
      options.signal.throwIfAborted()
      const result = spawnSync('git', [...args], { cwd: workspace, encoding: 'utf8', windowsHide: true,
        timeout: options.timeoutMs, maxBuffer: options.maxBytes })
      if (result.error) throw result.error
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status }
    } },
  })
  try { return await callback({ identity: { workspaceId, displayRoot: workspace }, signal: abort.signal,
    require: capability => registry.require(workspaceId, capability),
    has: capability => registry.capabilities(workspaceId)[capability].available }) }
  finally { abort.abort(); release(); releases++ }
} }
const client = new SidecarChatControlClient({ endpoint: config.endpoint, authentication: config.authentication, requestTimeoutMs: 1_000 })
const gitAdapter = new DshGitAuthorityAdapter({ workspace: workspacePort, registry, locator: workspace, workspaceId })
// Count semantic fresh observations while delegating every observation to the
// actual adapter (including both of its real Git status reads).
const gitAuthority = { withAuthority: (callback, signal) => gitAdapter.withAuthority(authority => callback({
  ...authority, snapshot: async () => { snapshots++; return authority.snapshot() },
}), signal) }
const coordinator = new ChatGptCoordinator({ browser: client, store, workspaceRoot: workspace, workspaceId,
  canonicalProtocol: true, replyTimeoutMs: 2_000,
  gitAuthority })
async function tests(label) {
  const result = spawnSync(process.execPath, ['--test'], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  await writeFile(path.join(root, label + '.txt'), result.stdout + result.stderr)
  assert.equal(result.status, 0, result.stdout + result.stderr)
}
const review = () => coordinator.reportCanonicalExecuted(taskId, { head: git('rev-parse', 'HEAD'), changedFiles: ['double.js', 'double.test.js'], testsRecorded: true })
let result
if (phase === 'plan-fix') {
  await coordinator.startCanonicalTask(taskId, 'Synthetic workflow fixture: numeric doubling with invalid-input correction.')
  const planned = await coordinator.awaitPlan(taskId)
  assert.equal(planned.record.state, 'planned')
  assert.equal(planned.record.iteration, 1)
  await writeFile(path.join(workspace, 'double.js'), 'export const double = value => value * 2\n')
  await tests('first-tests')
  git('add', '.')
  git('commit', '-qm', 'feat: numeric doubling')
  git('push', '-q')
  const fix = await review()
  assert.equal(fix.record.state, 'planned')
  assert.equal(fix.record.iteration, 2)
  result = { identity: { taskId, workspaceId, iteration: 2, state: 'planned' }, firstTestsPassed: true }
} else if (phase === 'fix-publication-failure') {
  const saved = await coordinator.status(taskId)
  assert.equal(saved.state, 'planned')
  assert.equal(saved.iteration, 2)
  assert.equal(saved.workspaceId, workspaceId)
  await writeFile(path.join(workspace, 'double.js'), "export function double(value) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('finite number required'); return value * 2 }\n")
  await writeFile(path.join(workspace, 'double.test.js'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { double } from './double.js'; test('doubles finite numbers', () => { assert.equal(double(3), 6); assert.equal(double(-0.5), -1) }); test('rejects invalid input', () => { for (const value of ['3', NaN, Infinity, null]) assert.throws(() => double(value), TypeError) });\n")
  await tests('fix-tests')
  const before = await store.loadTaskSnapshot(taskId)
  const denied = []
  await assert.rejects(review(), error => { denied.push(error.code); return error.code === 'GIT_WORKTREE_DIRTY' })
  assert.deepEqual(await store.loadTaskSnapshot(taskId), before)
  git('add', '.')
  git('commit', '-qm', 'fix: reject invalid inputs')
  await assert.rejects(review(), error => { denied.push(error.code); return error.code === 'GIT_NOT_PUSHED' })
  assert.deepEqual(await store.loadTaskSnapshot(taskId), before)
  git('push', '-q')
  const commit = store.commitTask.bind(store)
  store.commitTask = async (id, revision, value) => {
    if (value.round?.kind === 'EXECUTED' && value.round.iteration === 2 && value.round.phase === 'observed-sent') throw new Error('FIXTURE_PUBLICATION_FAILURE')
    return commit(id, revision, value)
  }
  await assert.rejects(review(), /FIXTURE_PUBLICATION_FAILURE/)
  result = { ...await coordinator.status(taskId), denied }
} else if (phase === 'resume') {
  const pending = await coordinator.status(taskId)
  assert.equal(pending.round.phase, 'sending')
  assert.equal(pending.round.iteration, 2)
  const resumed = await review()
  result = resumed.record
  assert.equal(result.state, 'done')
} else throw new Error('Unknown fixture phase')
assert.equal(registry.capabilities(workspaceId).leaseBound, false)
assert.equal(acquisitions, releases)
assert.ok(queries >= 14, 'Actual Git status double-observation must run')
process.send({ event: 'result', pid: process.pid, ...result, leaseReleased: true, acquisitions, releases, queries, snapshots })
process.disconnect()
