import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createProfileSidecarFixture } from './profile-sidecar-fixture.mjs'

const [source, installation] = process.argv.slice(2)
assert.ok(source && installation, 'Usage: pnpm test:profile <DSH source root> <isolated package installation>')
const sourceRoot = path.resolve(source)
const installationRoot = path.resolve(installation)
const schemaCheck = spawnSync(process.execPath, [fileURLToPath(new URL('./verify-dsh-tool-schemas.mjs', import.meta.url)), sourceRoot, installationRoot], { encoding: 'utf8', windowsHide: true })
assert.equal(schemaCheck.status, 0, schemaCheck.stdout + schemaCheck.stderr)
console.log(schemaCheck.stdout.trim())
const requireDsh = createRequire(path.join(sourceRoot, 'package.json'))
const root = await mkdtemp(path.join(tmpdir(), 'dsh-chatgpt-profile-'))
const home = path.join(root, 'home')
const profile = path.join(home, 'profiles', 'planner-executor-smoke')
const workspace = path.join(root, 'workspace')
const otherWorkspace = path.join(root, 'other-workspace')
const alias = path.join(root, 'alias')
await Promise.all([profile, workspace, otherWorkspace].map(directory => mkdir(directory, { recursive: true })))
function git(...args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
}
git('init', '-q', '-b', 'profile-fixture')
git('config', 'user.name', 'Profile fixture')
git('config', 'user.email', 'fixture@example.invalid')
git('config', 'commit.gpgsign', 'false')
git('config', 'core.autocrlf', 'false')
await writeFile(path.join(workspace, 'tracked.txt'), 'tracked baseline\n')
await writeFile(path.join(workspace, 'staged.txt'), 'staged baseline\n')
git('add', '.')
git('commit', '-qm', 'profile baseline')
await writeFile(path.join(workspace, 'tracked.txt'), 'tracked mutation marker\n')
await writeFile(path.join(workspace, 'staged.txt'), 'staged mutation marker\n')
git('add', 'staged.txt')
await writeFile(path.join(workspace, 'untracked.txt'), 'untracked mutation marker\n')
await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'planner-executor-smoke', private: true, dsh: { profile: { bundles: [] } } }))
const packageEntry = name => pathToFileURL(path.join(installationRoot, 'node_modules', name, 'lib', 'index.js')).href
const sidecar = await createProfileSidecarFixture(root, pathToFileURL(path.join(installationRoot, 'node_modules', 'dsh-with-chatgpt', 'lib', 'sidecar', 'server.js')).href)
console.log('Profile verification mode: composition-fixture; real Browser/App proof NOT_RUN')
try {
const rows = [
  ['logger', '@deepseek-ai/cordis-plugin-logger-console'],
  ['timer', '@deepseek-ai/cordis-plugin-timer'],
  ['llm', '@deepseek-ai/dsh-llm'],
  ['sessions', '@deepseek-ai/dsh-session'],
  ['session-projections', '@deepseek-ai/dsh-session-projection'],
  ['system-prompt', '@deepseek-ai/dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }],
  ['tools', '@deepseek-ai/dsh-tools'],
  ['agents', '@deepseek-ai/dsh-agent'],
  ['agent-loop', '@deepseek-ai/dsh-agent-loop', { agents: [] }],
  ['storage', '@deepseek-ai/dsh-storage'],
  ['storage-json', '@deepseek-ai/dsh-storage-json', { root: path.join(root, 'storage') }],
  ['storage-domain', '@deepseek-ai/dsh-storage-domain', { backend: 'json' }],
  ['filesystem', '@deepseek-ai/dsh-fs-local', { cwd: workspace }],
  ['subprocess', '@deepseek-ai/dsh-subprocess-local'],
  ['sandbox', '@deepseek-ai/dsh-sandbox-local'],
  ['identity', packageEntry('@deepseek-ai/dsh-execution-world'), { mode: 'persisted-local', allocationLockPath: path.join(root, 'identity.lock') }],
  // Pin the primary native Executor in the disposable profile. The provider
  // supplies its own reasoning defaults; do not add a reasoning override.
  ['agent-default-model', '@deepseek-ai/dsh-agent-default-model', { provider: 'deepseek-official', model: 'deepseek-flash' }],
  ['llm-deepseek', '@deepseek-ai/dsh-llm-deepseek', { apiKeyEnv: 'DEEPSEEK_API_KEY' }],
  // The profile smoke exercises the primary semantic Sidecar composition.
  ['collaboration', packageEntry('dsh-with-chatgpt'), { browserMode: 'sidecar', sidecarEndpoint: sidecar.endpoint, sidecarCredentialFile: sidecar.credentialFile, tunnelMode: 'external', gitPolicy: 'worktree', gitReadPolicy: 'allow-hardened-windows' }],
  ['probe', new URL('../tests/fixtures/profile-identity-probe.mjs', import.meta.url).href, { workspace, alias, otherWorkspace }],
].map(([id, name, config]) => ({ id, name, ...(config ? { config } : {}) }))
await writeFile(path.join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }], null, 2))
const args = ['--import', pathToFileURL(requireDsh.resolve('tsx/esm')).href, path.join(sourceRoot, 'apps/cli/src/bin.ts'), '--profile', 'planner-executor-smoke']
const reports = []
for (const iteration of [1, 2]) {
  const runId = randomUUID()
  const report = path.join(root, `report-${runId}.json`)
  const child = spawnSync(process.execPath, args, {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home, LOCALAPPDATA: path.join(root, 'state'), XDG_STATE_HOME: path.join(root, 'state'), TSX_TSCONFIG_PATH: path.join(sourceRoot, 'tsconfig.base.json'), DSH_PLANNER_EXECUTOR_SMOKE_RUN_ID: runId, DSH_PLANNER_EXECUTOR_SMOKE_REPORT: report },
    encoding: 'utf8', timeout: 90_000, windowsHide: true,
  })
  await writeFile(path.join(root, `boot-${iteration}.log`), child.stdout + child.stderr)
  const authentication = await readFile(sidecar.credentialFile, 'utf8')
  assert.equal((child.stdout + child.stderr).includes(authentication), false, 'Credential leaked into boot output')
  assert.equal((await readFile(path.join(profile, 'cordis.patch.yml'), 'utf8')).includes(authentication), false, 'Profile must contain only credential references')
  console.log(`Profile attempt ${iteration}: exit ${child.status}; evidence ${root}`)
  if (child.error) throw child.error
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(await readFile(report, 'utf8'))
  assert.equal(result.runId, runId, 'Each process must produce a report for its own invocation')
  assert.equal(result.pid, child.pid, 'The report must come from the launched DSH process')
  console.log(JSON.stringify(result))
  assert.equal(result.ok, true, result.error)
  assert.equal(result.gitAcceptance?.ok, true)
  assert.ok(['hardened-windows', 'full'].includes(result.gitAcceptance.assurance))
  reports.push(result)
}
assert.deepEqual(reports[0].statuses.map(status => status.workspaceId), reports[1].statuses.map(status => status.workspaceId))
assert.notEqual(reports[0].runId, reports[1].runId)
console.log('Real DSH profile: identity stable across aliases/restart/plugin reload; authenticated Git status/diff/log preserve repository state; execution output remains unavailable')
} finally { await sidecar.close() }
