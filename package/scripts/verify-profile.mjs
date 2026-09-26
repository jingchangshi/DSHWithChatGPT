import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [source, installation] = process.argv.slice(2)
assert.ok(source && installation, 'Usage: pnpm test:profile <DSH source root> <isolated package installation>')
const sourceRoot = path.resolve(source)
const installationRoot = path.resolve(installation)
const requireDsh = createRequire(path.join(sourceRoot, 'package.json'))
const root = await mkdtemp(path.join(tmpdir(), 'dsh-chatgpt-profile-'))
const home = path.join(root, 'home')
const profile = path.join(home, 'profiles', 'c2c-smoke')
const workspace = path.join(root, 'workspace')
const otherWorkspace = path.join(root, 'other-workspace')
const alias = path.join(root, 'alias')
await Promise.all([profile, workspace, otherWorkspace].map(directory => mkdir(directory, { recursive: true })))
await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'c2c-smoke', private: true, dsh: { profile: { bundles: [] } } }))
const packageEntry = name => pathToFileURL(path.join(installationRoot, 'node_modules', name, 'lib', 'index.js')).href
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
  ['identity', packageEntry('@deepseek-ai/dsh-execution-world'), { mode: 'persisted-local', allocationLockPath: path.join(root, 'identity.lock') }],
  ['collaboration', packageEntry('dsh-with-chatgpt'), { tunnelMode: 'external', gitPolicy: 'worktree' }],
  ['probe', new URL('../tests/fixtures/profile-identity-probe.mjs', import.meta.url).href, { workspace, alias, otherWorkspace }],
].map(([id, name, config]) => ({ id, name, ...(config ? { config } : {}) }))
await writeFile(path.join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }], null, 2))
const args = ['--import', pathToFileURL(requireDsh.resolve('tsx/esm')).href, path.join(sourceRoot, 'apps/cli/src/bin.ts'), '--profile', 'c2c-smoke']
const reports = []
for (const iteration of [1, 2]) {
  const runId = randomUUID()
  const report = path.join(root, `report-${runId}.json`)
  const child = spawnSync(process.execPath, args, {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home, LOCALAPPDATA: path.join(root, 'state'), XDG_STATE_HOME: path.join(root, 'state'), TSX_TSCONFIG_PATH: path.join(sourceRoot, 'tsconfig.base.json'), DSH_C2C_SMOKE_RUN_ID: runId, DSH_C2C_SMOKE_REPORT: report },
    encoding: 'utf8', timeout: 90_000, windowsHide: true,
  })
  await writeFile(path.join(root, `boot-${iteration}.log`), child.stdout + child.stderr)
  console.log(`Profile attempt ${iteration}: exit ${child.status}; evidence ${root}`)
  if (child.error) throw child.error
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(await readFile(report, 'utf8'))
  assert.equal(result.runId, runId, 'Each process must produce a report for its own invocation')
  assert.equal(result.pid, child.pid, 'The report must come from the launched DSH process')
  console.log(JSON.stringify(result))
  assert.equal(result.ok, true, result.error)
  reports.push(result)
}
assert.deepEqual(reports[0].statuses.map(status => status.workspaceId), reports[1].statuses.map(status => status.workspaceId))
assert.notEqual(reports[0].runId, reports[1].runId)
console.log('Real DSH profile: identity stable across aliases/restart/plugin reload, distinct workspaces isolated, content unavailable, PLAN/REVIEW denied without browser dispatch')
