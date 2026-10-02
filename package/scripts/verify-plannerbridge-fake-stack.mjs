import assert from 'node:assert/strict'
import { fork, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Explicit test composition. The browser/planner and execution capabilities
// are fixture adapters; no model, ChatGPT page or product App is exercised.
const root = await mkdtemp(path.join(tmpdir(), 'plannerbridge-fake-stack-'))
const workspace = path.join(root, 'workspace')
await mkdir(workspace)
const configPath = path.join(root, 'fixture.json')
const config = { root, workspace, workspaceId: 'fixture-' + randomUUID(), taskId: 'pb_' + randomUUID().replaceAll('-', ''),
  authentication: randomUUID() + randomUUID(), endpoint: null }
await writeFile(configPath, JSON.stringify(config))
const children = new Set()
const env = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP', 'LOCALAPPDATA'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
env.PLANNERBRIDGE_FIXTURE_CONFIG = configPath
function git(...args) {
  const result = spawnSync('git', args, { cwd: workspace, env, encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
async function launch(role, phase) {
  const child = fork(fileURLToPath(new URL('../tests/fixtures/plannerbridge-fake-stack-' + role + '.mjs', import.meta.url)),
    phase ? [phase] : [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
  children.add(child)
  let raw = ''
  child.stdout.on('data', value => { raw += value })
  child.stderr.on('data', value => { raw += value })
  const terminal = new Promise(resolve => child.once('exit', code => { children.delete(child); resolve(code) }))
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(role + ' fixture deadline')) }, role === 'sidecar' ? 5_000 : 60_000)
    child.on('message', message => {
      if (message?.event === (role === 'sidecar' ? 'ready' : 'result')) { clearTimeout(timer); resolve(message) }
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(role + ' fixture exited ' + code + ': ' + raw)) })
  })
  try {
    const message = await ready
    assert.notEqual(message.pid, process.pid)
    if (role === 'executor') {
      assert.equal(await terminal, 0, raw)
      await writeFile(path.join(root, phase + '.log'), raw)
      return message
    }
    return { ...message, stop: async () => { child.kill(); await terminal } }
  } catch (error) {
    child.kill(); await terminal
    await writeFile(path.join(root, (phase ?? role) + '.log'), raw)
    throw error
  }
}
let success = false
try {
  git('init', '-q', '-b', 'plannerbridge/fixture')
  git('config', 'user.name', 'PlannerBridge fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }))
  await writeFile(path.join(workspace, 'double.js'), 'export const double = value => 0\n')
  await writeFile(path.join(workspace, 'double.test.js'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { double } from './double.js'; test('doubles finite numbers', () => assert.equal(double(3), 6));\n")
  git('add', '.')
  git('commit', '-qm', 'test: deterministic broken fixture')
  git('init', '--bare', '-q', path.join(root, 'remote.git'))
  git('remote', 'add', 'origin', path.join(root, 'remote.git'))
  git('push', '-qu', 'origin', 'plannerbridge/fixture')
  const broken = spawnSync(process.execPath, ['--test'], { cwd: workspace, env, encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  assert.ok(Number.isInteger(broken.status), 'Initial fixture must actually run to a test exit, not time out')
  assert.notEqual(broken.status, 0, 'Initial fixture must falsify the implementation')
  await writeFile(path.join(root, 'broken.log'), broken.stdout + broken.stderr)
  let sidecar = await launch('sidecar')
  config.endpoint = sidecar.endpoint
  await writeFile(configPath, JSON.stringify(config))
  const first = await launch('executor', 'plan-fix')
  assert.deepEqual(first.identity, { taskId: config.taskId, workspaceId: config.workspaceId, iteration: 2, state: 'planned' })
  assert.equal(first.firstTestsPassed, true)
  assert.equal(first.leaseReleased, true)
  const firstHead = git('rev-parse', 'HEAD')
  assert.equal(firstHead, git('rev-parse', '@{u}'))
  await sidecar.stop()
  const secondSidecar = await launch('sidecar')
  assert.notEqual(secondSidecar.pid, sidecar.pid)
  sidecar = secondSidecar
  config.endpoint = sidecar.endpoint
  await writeFile(configPath, JSON.stringify(config))
  const crashed = await launch('executor', 'fix-publication-failure')
  assert.notEqual(crashed.pid, first.pid)
  assert.equal(crashed.state, 'awaiting-review')
  assert.equal(crashed.round.phase, 'sending')
  assert.equal(crashed.round.iteration, 2)
  assert.deepEqual(crashed.denied, ['GIT_WORKTREE_DIRTY', 'GIT_NOT_PUSHED'])
  assert.equal(crashed.leaseReleased, true)
  const acceptedSendJournal = JSON.parse(await readFile(path.join(root, 'sidecar', 'delivery.json'), 'utf8'))
  assert.equal(acceptedSendJournal.entries.find(entry => entry.operationId === crashed.round.sendOperationId)?.phase, 'accepted',
    'Failure must follow real Sidecar ACK/journal acceptance, not precede delivery')
  const secondHead = git('rev-parse', 'HEAD')
  assert.notEqual(secondHead, firstHead)
  assert.equal(secondHead, git('rev-parse', '@{u}'))
  await sidecar.stop()
  sidecar = await launch('sidecar')
  assert.notEqual(sidecar.pid, secondSidecar.pid)
  config.endpoint = sidecar.endpoint
  await writeFile(configPath, JSON.stringify(config))
  const resumed = await launch('executor', 'resume')
  assert.notEqual(resumed.pid, crashed.pid)
  assert.equal(resumed.state, 'done')
  assert.equal(resumed.round.phase, 'accepted')
  assert.equal(resumed.round.sendOperationId, crashed.round.sendOperationId)
  assert.equal(resumed.round.waitOperationId, crashed.round.waitOperationId)
  assert.equal(resumed.round.controlDigest, crashed.round.controlDigest)
  assert.deepEqual(resumed.round.git, crashed.round.git)
  assert.deepEqual(resumed.round.baseline, crashed.round.baseline)
  assert.equal(resumed.round.outcome.head, secondHead)
  assert.equal(resumed.round.outcome.iteration, 2)
  assert.equal(resumed.round.outcome.inReplyTo, 2)
  assert.equal(resumed.leaseReleased, true)
  assert.equal(resumed.snapshots, 2, 'Resumed request must reacquire fresh Git proof before wait and before acceptance')
  const persisted = JSON.parse(await readFile(path.join(root, 'core.json'), 'utf8'))['task:' + config.taskId]
  assert.equal(persisted.state, 'done')
  assert.equal(persisted.iteration, 2)
  assert.deepEqual(persisted.round, resumed.round)
  const view = JSON.parse(await readFile(path.join(root, 'synthetic-browser.json'), 'utf8'))
  assert.equal(view.sends.length, 3, 'INIT + two EXECUTED only, no restart resends')
  assert.deepEqual(view.sends.map(item => [item.state, item.iteration]), [['INIT', 0], ['EXECUTED', 1], ['EXECUTED', 2]])
  assert.ok(view.sends.every(item => item.taskId === config.taskId && item.workspaceId === config.workspaceId))
  assert.equal(resumed.workspaceId, config.workspaceId)
  assert.equal(resumed.taskId, config.taskId)
  assert.equal(git('status', '--porcelain'), '')
  assert.equal(git('rev-list', '--count', '@{u}..HEAD'), '0')
  await sidecar.stop()
  const journal = await readFile(path.join(root, 'sidecar', 'delivery.json'), 'utf8')
  const strings = []
  function inspect(value) {
    if (typeof value === 'string') strings.push(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect)
  }
  inspect(JSON.parse(journal))
  assert.ok(view.sends.every(item => !strings.includes(item.text)), 'Production journal must not persist control bodies')
  success = true
  // Release actual test output before removing the disposable successful repo;
  // the independent reviewer need not trust boolean summaries alone.
  console.log('FAKE_STACK initial failing test output:\n' + await readFile(path.join(root, 'broken.log'), 'utf8'))
  console.log('FAKE_STACK first executor test output:\n' + await readFile(path.join(root, 'first-tests.txt'), 'utf8'))
  console.log('FAKE_STACK fix executor test output:\n' + await readFile(path.join(root, 'fix-tests.txt'), 'utf8'))
  console.log(JSON.stringify({ mode: 'FAKE_STACK', realModelApp: 'NOT_RUN', taskId: resumed.taskId, workspaceId: resumed.workspaceId,
    state: resumed.state, iteration: resumed.iteration,
    sidecarRestarts: 2, executorPids: [first.pid, crashed.pid, resumed.pid], sends: view.sends.length,
    head: secondHead, clean: true, pushed: true, denied: crashed.denied, publicationRecovery: true,
    sameSendOperationId: resumed.round.sendOperationId === crashed.round.sendOperationId,
    sameWaitOperationId: resumed.round.waitOperationId === crashed.round.waitOperationId,
    gitQueries: [first.queries, crashed.queries, resumed.queries],
    freshGitSnapshots: [first.snapshots, crashed.snapshots, resumed.snapshots] }))
} finally {
  for (const child of children) child.kill()
  if (success) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith('plannerbridge-fake-stack-')) throw new Error('Unsafe fixture cleanup target')
    await rm(root, { recursive: true, force: true })
  } else console.error('FAKE_STACK evidence retained: ' + root)
}
