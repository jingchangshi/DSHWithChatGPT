import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { initializeAcceptanceWorkload, verifyAcceptanceWorkload } from './planner-executor-workload.mjs'
import { evaluateAcceptance } from './planner-executor-acceptance.mjs'
import { assertSidecarEndpointUnused, ownedSidecarConfig, phaseEnvironment, readTargetPointer, validateTargetId } from './planner-executor-owned-sidecar.mjs'
const [source, installation] = process.argv.slice(2)
const runId = randomUUID()
const cli = process.env.DSH_CLI
assert.ok(cli && path.isAbsolute(cli), 'DSH_CLI must name the built DSH CLI entry')
assert.ok(source && installation, 'Usage: node scripts/verify-planner-executor-e2e.mjs <DSH source> <packed installation>')
const schemaCheck = spawnSync(process.execPath, [fileURLToPath(new URL('./verify-dsh-tool-schemas.mjs', import.meta.url)), source, installation], { encoding: 'utf8', windowsHide: true })
assert.equal(schemaCheck.status, 0, schemaCheck.stdout + schemaCheck.stderr)
console.log(schemaCheck.stdout.trim())
for (const key of ['DSH_CLI', 'DEEPSEEK_API_KEY', 'CONTROL_PLANE_API_KEY', 'CONTROL_PLANE_TUNNEL_ID', 'MCP_EXPOSURE_CLIENT']) assert.ok(process.env[key], key + ' is required')
assert.equal(process.env.BROWSER_HARNESS_COMPAT_EXECUTABLE, undefined, 'Primary Planner-Executor acceptance must not mount Browser Harness')
const root = await mkdtemp(path.join(tmpdir(), 'planner-executor-live-'))
const workspace = path.join(root, 'workspace')
const home = path.join(root, 'home')
const profile = path.join(home, 'profiles', 'planner-executor-e2e')
const report = path.join(root, 'observed.jsonl')
await Promise.all([workspace, profile].map(directory => mkdir(directory, { recursive: true })))
function git(...args) {
  const child = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true })
  assert.equal(child.status, 0, child.stderr)
  return child.stdout.trim()
}
git('init', '-q', '-b', 'planner-executor/e2e')
git('config', 'user.name', 'PlannerBridge acceptance')
git('config', 'user.email', 'acceptance@example.invalid')
git('config', 'commit.gpgsign', 'false')
git('config', 'core.autocrlf', 'false')
const workload = await initializeAcceptanceWorkload(workspace)
await verifyAcceptanceWorkload(workspace, workload, 'initial')
git('add', '.')
git('commit', '-qm', 'test: initialize interval subtraction acceptance fixture')
git('init', '--bare', '-q', path.join(root, 'remote.git'))
git('remote', 'add', 'origin', path.join(root, 'remote.git'))
git('push', '-qu', 'origin', 'planner-executor/e2e')
assert.equal(git('status', '--porcelain'), '')
assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', '@{upstream}'))
const peers = { '@deepseek-ai/cordis': 'vendor/cordis', '@deepseek-ai/dsh-execution-world': 'packages/execution/execution-world', '@deepseek-ai/dsh-fs': 'packages/fs/fs', '@deepseek-ai/dsh-sandbox': 'packages/sandbox/sandbox', '@deepseek-ai/dsh-subprocess': 'packages/subprocess/subprocess', '@deepseek-ai/dsh-storage-domain': 'packages/storage/storage-domain' }
const overrides = Object.fromEntries(Object.entries(peers).map(([name, relative]) => [name, 'link:' + path.join(path.resolve(source), relative).replaceAll('\\', '/')]))
await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'planner-executor-e2e', private: true, packageManager: 'pnpm@10.34.5', dependencies: overrides, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } } }))
await writeFile(path.join(profile, 'pnpm-workspace.yaml'), JSON.stringify({ overrides }, null, 2))
const install = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'planner-executor-e2e', 'add', path.join(path.resolve(installation), 'dsh-with-chatgpt-0.1.0.tgz')], { cwd: workspace, env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true })
await writeFile(path.join(root, 'install.log'), install.stdout + install.stderr)
assert.equal(install.status, 0, 'Profile installation failed: ' + path.join(root, 'install.log'))
const installedManifestPath = createRequire(path.join(profile, 'package.json')).resolve('dsh-with-chatgpt/package.json')
const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
const nativeEntry = path.resolve(path.dirname(installedManifestPath), installedManifest.bin['chat-control-sidecar'])
assert.equal(nativeEntry, path.join(path.dirname(installedManifestPath), 'lib', 'deployment', 'sidecar-process-entry.js'))
await readFile(nativeEntry)
for (const key of ['PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE', 'PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY', 'PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS', 'PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'PLANNERBRIDGE_SIDECAR_TARGET_ID', 'PLANNERBRIDGE_SIDECAR_PORT', 'PLANNERBRIDGE_SIDECAR_APP_NAME']) assert.ok(process.env[key], key + ' required for owned native acceptance')
const initialTargetId = validateTargetId(process.env.PLANNERBRIDGE_SIDECAR_TARGET_ID)
const sidecarEndpoint = 'http://127.0.0.1:' + process.env.PLANNERBRIDGE_SIDECAR_PORT + '/'
const targetPointer = path.join(root, 'owned-target.json')
assert.equal(process.env.PLANNERBRIDGE_SIDECAR_APP_NAME, 'DSH with ChatGPT')
assert.equal(await readFile(path.join(process.env.PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY, 'delivery.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error }), false, 'Acceptance requires a fresh delivery journal')
await writeFile(path.join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash' } },
  { id: 'llm-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'session-title-llm', disabled: true },
  { insert: [
    { id: 'acceptance-observer', name: new URL('../tests/fixtures/planner-executor-e2e-observer.mjs', import.meta.url).href, config: { report, stopOnFix: true } }
  ] },
  { id: 'dsh-with-chatgpt', config: { ...ownedSidecarConfig(sidecarEndpoint, process.env.PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE, nativeEntry, targetPointer), tunnelMode: 'managed', tunnelClientPath: process.env.MCP_EXPOSURE_CLIENT, tunnelStartupTimeoutMs: 40000, replyTimeoutMs: 600000, gitPolicy: 'commit-push', gitReadPolicy: 'allow-hardened-windows', chatgptAppName: 'DSH with ChatGPT' } }
], null, 2))
const args = [cli, '--profile', 'planner-executor-e2e', '--json']
const task = 'Use PlannerBridge to implement REQUIREMENTS.md. First call chatgpt_doctor with mode=local and require localReady=true. Then separately call chatgpt_doctor with mode=app-proof and require appDataPlaneVerified=true. execution_output_access=false is EXPECTED outside an active review and is NOT a local/App readiness failure. An unrequested app-proof has not failed. Stop only if the respective readiness field fails after its explicit mode call. Then call chatgpt_plan with the requirements goal. Include this review requirement in the goal: reviewer must independently read raw execution_output and echo the latest successful npm test E2E_EVIDENCE marker in SUMMARY, never receive that value via executor prose. Follow the real PLAN and implement only REQUIREMENTS.md initially. A successful npm test activates an immutable acceptance-only RECOVERY_STAGE.md and intervals.recovery.test.js. Commit these activated files unchanged, but do not implement intervals.recovery.js before the first review. Require the reviewer to independently inspect this newly activated unmet requirement and return a real fix PLAN; unexpected DONE must stop. Edit and test with npm test, commit and push planner-executor/e2e, then chatgpt_review with exact HEAD and testsRecorded true. Never put the random marker in review arguments, files or messages. Do not modify REQUIREMENTS.md or weaken tests. If REVIEW gives a fix PLAN continue it; if DONE finish. Never fabricate protocol or evidence. Use pwsh for shell commands.'
const reconnectTask = 'Call chatgpt_reconnect and preserve the same task, iteration and workspace identity. Re-read the current plan and execution records, implement the requested fix, run npm test, commit and push planner-executor/e2e, then call chatgpt_review with the exact current HEAD and testsRecorded true. The reviewer must independently read raw execution_output and echo the latest successful E2E_EVIDENCE marker. Never put that marker in arguments, files or messages. Use pwsh for shell commands.'
async function runPhase(phase, prompt, targetId) {
  await assertSidecarEndpointUnused(sidecarEndpoint)
  const child = spawn(process.execPath, [...args, prompt], { cwd: workspace, env: { ...phaseEnvironment(process.env, targetId), DSH_HOME: home, PLANNER_EXECUTOR_RUN_ID: runId, PLANNER_EXECUTOR_PHASE: String(phase) }, windowsHide: true })
  console.log(JSON.stringify({ root, pid: child.pid, workspace, phase }))
  const chunks = []
  child.stdout.on('data', data => chunks.push(data))
  child.stderr.on('data', data => chunks.push(data))
  const code = await new Promise(resolve => child.on('close', resolve))
  await writeFile(path.join(root, `run-${phase}.log`), Buffer.concat(chunks))
  return code
}

const firstCode = await runPhase(1, task, initialTargetId)
const firstRecords = (await readFile(report, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line))
const restartPending = firstRecords.some(record => record.kind === 'restart-checkpoint')
if (restartPending) await verifyAcceptanceWorkload(workspace, workload, 'phase1')
const code = restartPending ? await runPhase(2, reconnectTask, await readTargetPointer(targetPointer)) : firstCode
if (restartPending) await verifyAcceptanceWorkload(workspace, workload, 'phase2')
{
  const observations = await readFile(report, 'utf8').catch(() => '')
  const records = observations.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const branch = git('branch', '--show-current')
  const head = git('rev-parse', 'HEAD')
  const upstream = (() => { try { return git('rev-parse', '@{upstream}') } catch { return '' } })()
  const ahead = upstream === '' ? null : Number(git('rev-list', '--count', '@{upstream}..HEAD'))
  const acceptance = evaluateAcceptance({ records, runId, code, restartPending, git: { branch, head, upstream, ahead, clean: git('status', '--porcelain') === '' } })
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ code, root, restartPending, ...acceptance }, null, 2))
  console.log(JSON.stringify({ code, root, ...acceptance }))
  process.exitCode = acceptance.exitCode
}
