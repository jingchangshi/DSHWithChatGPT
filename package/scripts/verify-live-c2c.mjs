import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const [source, installation] = process.argv.slice(2)
const runId = randomUUID()
const cli = process.env.C2C_DSH_CLI
assert.ok(cli && path.isAbsolute(cli), 'C2C_DSH_CLI must name the built DSH CLI entry')
assert.ok(source && installation, 'Usage: node scripts/verify-live-c2c.mjs <DSH source> <packed installation>')
for (const key of ['C2C_EXECUTION_API_KEY', 'C2C_EXECUTION_BASE_URL', 'CONTROL_PLANE_API_KEY', 'CONTROL_PLANE_TUNNEL_ID', 'C2C_TUNNEL_CLIENT', 'C2C_BROWSER_HARNESS']) assert.ok(process.env[key], key + ' is required')
const root = await mkdtemp(path.join(tmpdir(), 'dsh-c2c-live-'))
const workspace = path.join(root, 'workspace')
const home = path.join(root, 'home')
const profile = path.join(home, 'profiles', 'c2c-e2e')
const report = path.join(root, 'observed.jsonl')
await Promise.all([workspace, profile].map(directory => mkdir(directory, { recursive: true })))
function git(...args) {
  const child = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true })
  assert.equal(child.status, 0, child.stderr)
  return child.stdout.trim()
}
git('init', '-q', '-b', 'd2c/e2e')
git('config', 'user.name', 'C2C acceptance')
git('config', 'user.email', 'acceptance@example.invalid')
git('config', 'commit.gpgsign', 'false')
git('config', 'core.autocrlf', 'false')
await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'interval-acceptance', private: true, type: 'module', scripts: { test: 'node run-tests.mjs' } }, null, 2) + '\n')
await writeFile(path.join(workspace, 'run-tests.mjs'), "import { spawnSync } from 'node:child_process'\nimport { randomBytes } from 'node:crypto'\nconst run = spawnSync(process.execPath, ['--test'], { stdio: 'inherit' })\nif (run.status === 0) console.log('E2E_EVIDENCE=' + randomBytes(16).toString('hex'))\nprocess.exitCode = run.status ?? 1\n")
await writeFile(path.join(workspace, 'intervals.js'), 'export function subtractIntervals(available, blocked) { return available }\n')
await writeFile(path.join(workspace, 'intervals.test.js'), "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { subtractIntervals } from './intervals.js'\ntest('splits blocked interval', () => assert.deepEqual(subtractIntervals([[0, 10]], [[3, 7]]), [[0, 3], [7, 10]]))\n")
await writeFile(path.join(workspace, 'REQUIREMENTS.md'), '# Interval subtraction\n\nImplement subtractIntervals(available, blocked) for finite numeric half-open intervals. Reject non-array inputs, malformed pairs, non-finite endpoints, and start >= end with TypeError. Validate blocked intervals even when available is empty. Do not coerce values or mutate inputs. Sort and union overlapping or touching available intervals and blocked intervals independently, subtract their union, return sorted disjoint nonempty intervals, coalescing touching output. Preserve negative and fractional values. Add tests for these requirements. No dependencies. Keep the random E2E_EVIDENCE stdout test marker; never persist its values in workspace files.\n')
git('add', '.')
git('commit', '-qm', 'test: initialize interval subtraction acceptance fixture')
git('init', '--bare', '-q', path.join(root, 'remote.git'))
git('remote', 'add', 'origin', path.join(root, 'remote.git'))
git('push', '-qu', 'origin', 'd2c/e2e')
assert.equal(git('status', '--porcelain'), '')
assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', '@{upstream}'))
const peers = { '@deepseek-ai/cordis': 'vendor/cordis', '@deepseek-ai/dsh-execution-world': 'packages/execution/execution-world', '@deepseek-ai/dsh-fs': 'packages/fs/fs', '@deepseek-ai/dsh-sandbox': 'packages/sandbox/sandbox', '@deepseek-ai/dsh-subprocess': 'packages/subprocess/subprocess', '@deepseek-ai/dsh-storage-domain': 'packages/storage/storage-domain' }
const overrides = Object.fromEntries(Object.entries(peers).map(([name, relative]) => [name, 'link:' + path.join(path.resolve(source), relative).replaceAll('\\', '/')]))
await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'c2c-e2e', private: true, packageManager: 'pnpm@10.34.5', dependencies: overrides, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } } }))
await writeFile(path.join(profile, 'pnpm-workspace.yaml'), JSON.stringify({ overrides }, null, 2))
const install = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'c2c-e2e', 'add', path.join(path.resolve(installation), 'dsh-with-chatgpt-0.1.0.tgz'), 'link:' + path.join(path.resolve(source), 'packages/browser-use/browser-use'), 'link:' + path.join(path.resolve(source), 'packages/experimental/browser-use-browser-harness-mcp')], { cwd: workspace, env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true })
await writeFile(path.join(root, 'install.log'), install.stdout + install.stderr)
assert.equal(install.status, 0, 'Profile installation failed: ' + path.join(root, 'install.log'))
await writeFile(path.join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', config: { provider: 'c2c-sub2api', model: 'gpt-6-sol', reasoningEffort: 'low' } },
  { id: 'llm-pi-ai', config: { providers: { 'c2c-sub2api': { api: 'openai-responses', baseURL: process.env.C2C_EXECUTION_BASE_URL, apiKeyEnv: 'C2C_EXECUTION_API_KEY', reasoning: 'low', models: [{ id: 'gpt-6-sol', contextWindow: 200000, maxTokens: 16000, reasoningEfforts: { low: 'low' } }] } } } },
  { id: 'session-title-llm', disabled: true },
  { insert: [
    { id: 'browser-use', name: '@deepseek-ai/dsh-browser-use' },
    { id: 'browser-harness', name: '@deepseek-ai/dsh-experimental-browser-use-browser-harness-mcp', config: { command: process.env.C2C_BROWSER_HARNESS, record: false, cdpUrl: 'http://127.0.0.1:9222', toolCallTimeoutMs: 30000, requireExistingDaemon: true } },
    { id: 'acceptance-observer', name: new URL('../tests/fixtures/c2c-e2e-observer.mjs', import.meta.url).href, config: { report, stopOnFix: true } }
  ] },
  { id: 'dsh-with-chatgpt', config: { tunnelMode: 'managed', tunnelClientPath: process.env.C2C_TUNNEL_CLIENT, tunnelStartupTimeoutMs: 40000, replyTimeoutMs: 600000, gitPolicy: 'commit-push', gitReadPolicy: 'allow-hardened-windows', chatgptAppName: 'DSH with ChatGPT' } }
], null, 2))
const args = [cli, '--profile', 'c2c-e2e', '--json']
const task = 'Use C2C to implement REQUIREMENTS.md. First call chatgpt_doctor with mode=local and require localReady=true. Then separately call chatgpt_doctor with mode=app-proof and require appDataPlaneVerified=true. execution_output_access=false is EXPECTED outside an active review and is NOT a local/App readiness failure. An unrequested app-proof has not failed. Stop only if the respective readiness field fails after its explicit mode call. Then call chatgpt_plan with the requirements goal. Include this review requirement in the goal: reviewer must independently read raw execution_output and echo the latest successful npm test E2E_EVIDENCE marker in SUMMARY, never receive that value via executor prose. Follow the real PLAN, edit and test with npm test, commit and push d2c/e2e, then chatgpt_review with exact HEAD and testsRecorded true. Never put the random marker in review arguments, files or messages. Do not modify REQUIREMENTS.md or weaken tests. If REVIEW gives a fix PLAN continue it; if DONE finish. Never fabricate protocol or evidence. Use pwsh for shell commands.'
const child = spawn(process.execPath, [...args, task], { cwd: workspace, env: { ...process.env, DSH_HOME: home, C2C_E2E_RUN_ID: runId, C2C_E2E_PHASE: '1' }, windowsHide: true })
console.log(JSON.stringify({ root, pid: child.pid, workspace }))
const chunks = []
child.stdout.on('data', data => chunks.push(data))
child.stderr.on('data', data => chunks.push(data))
child.on('close', async code => {
  await writeFile(path.join(root, 'run-1.log'), Buffer.concat(chunks))
  const observations = await readFile(report, 'utf8').catch(() => '')
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ code, root, fullC2CAccepted: false, restartPending: observations.includes('restart-checkpoint') }, null, 2))
  console.log(JSON.stringify({ code, root, fullC2CAccepted: false }))
  process.exitCode = code ?? 1
})
