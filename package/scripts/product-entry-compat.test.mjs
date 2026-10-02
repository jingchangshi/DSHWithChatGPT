import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const repoUrl = new URL('../..', import.meta.url).pathname
const repo = resolve(decodeURIComponent(repoUrl).replace(/^\/([A-Za-z]:)/, '$1').replaceAll('/', '\\'))
const setupScript = join(repo, 'scripts', 'prepare-dsh-c2c.ps1')
const launchScript = join(repo, 'scripts', 'launch-dsh-c2c.ps1')
const temp = await mkdtemp(join(tmpdir(), 'product-entry-compat-'))
const localAppData = join(temp, 'local-app-data')
const fakeRoot = join(temp, 'deepseek-harness', 'apps', 'cli', 'lib')
const fakeCli = join(fakeRoot, 'bin.js')
const report = join(temp, 'child-report.json')
await mkdir(fakeRoot, { recursive: true })
await mkdir(join(localAppData, 'dsh-with-chatgpt', 'unrelated'), { recursive: true })
await writeFile(join(localAppData, 'dsh-with-chatgpt', 'unrelated', 'keep.txt'), 'keep', 'utf8')
await writeFile(fakeCli, `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ tunnelId: process.env.CONTROL_PLANE_TUNNEL_ID, apiKey: process.env.CONTROL_PLANE_API_KEY, argvHasSecret: process.argv.includes(process.env.CONTROL_PLANE_API_KEY) })); process.exit(17);`, 'utf8')

const env = { ...process.env, LOCALAPPDATA: localAppData, CONTROL_PLANE_TUNNEL_ID: 'fixture-tunnel-id', CONTROL_PLANE_API_KEY: 'fixture-api-key', C2C_DSH_CLI: fakeCli }
const run = (script, args, extraEnv = env) => spawnSync('pwsh.exe', ['-NoProfile', '-File', script, ...args], { env: extraEnv, encoding: 'utf8' })
const combined = (result) => `${result.stdout}\n${result.stderr}`

try {
  const setup = run(setupScript, ['-Setup'])
  assert.equal(setup.status, 0, combined(setup))
  const state = join(localAppData, 'dsh-with-chatgpt', 'product-c2c')
  const configPath = join(state, 'config.json')
  const secretPath = join(state, 'secrets.dpapi.json')
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).tunnel.id, 'fixture-tunnel-id')
  const ciphertext = await readFile(secretPath, 'utf8')
  assert.doesNotMatch(ciphertext, /fixture-api-key|fixture-tunnel-id/)
  const check = run(setupScript, ['-Check'])
  assert.equal(check.status, 0, combined(check))
  assert.doesNotMatch(combined(check), /fixture-api-key/)

  const launch = run(launchScript, [], { ...env, CONTROL_PLANE_TUNNEL_ID: 'parent-id', CONTROL_PLANE_API_KEY: 'parent-key' })
  assert.equal(launch.status, 17, combined(launch))
  assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), { tunnelId: 'fixture-tunnel-id', apiKey: 'fixture-api-key', argvHasSecret: false })

  const sourceCli = fakeCli.replace(/[\\/]lib[\\/]bin\.js$/, `${'\\'}src${'\\'}bin.ts`)
  const rejected = run(launchScript, [], { ...env, C2C_DSH_CLI: sourceCli })
  assert.notEqual(rejected.status, 0)
  assert.match(combined(rejected), /DSH_CLI_NOT_BUILT/)

  const clear = run(setupScript, ['-Clear'])
  assert.equal(clear.status, 0, combined(clear))
  await assert.rejects(readFile(configPath, 'utf8'))
  assert.equal(await readFile(join(localAppData, 'dsh-with-chatgpt', 'unrelated', 'keep.txt'), 'utf8'), 'keep')

  await mkdir(state, { recursive: true })
  await writeFile(configPath, JSON.stringify({ version: 1, tunnel: { id: 'fixture-tunnel-id' } }), 'utf8')
  await writeFile(secretPath, JSON.stringify({ CONTROL_PLANE_API_KEY: 'corrupt' }), 'utf8')
  const corrupt = run(setupScript, ['-Check'])
  assert.notEqual(corrupt.status, 0)
} finally {
  spawnSync('icacls.exe', [temp, '/reset', '/t', '/c'], { stdio: 'ignore' })
  await rm(temp, { recursive: true, force: true })
}

console.log('Product entry compatibility behavioral checks passed')
