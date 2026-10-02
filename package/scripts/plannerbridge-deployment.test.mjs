import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const temp = await mkdtemp(join(tmpdir(), 'plannerbridge-deployment-'))
const localAppData = join(temp, 'local-app-data')
const state = join(localAppData, 'dsh-with-chatgpt', 'product-c2c') // retained released own-state
const canonicalPrepare = join(repo, 'scripts', 'prepare-plannerbridge.ps1')
const canonicalLaunch = join(repo, 'scripts', 'launch-plannerbridge.ps1')
const legacyPrepare = join(repo, 'scripts', 'prepare-dsh-c2c.ps1')
const legacyLaunch = join(repo, 'scripts', 'launch-dsh-c2c.ps1')
const report = join(temp, 'child-report.json')
const cli = join(temp, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
await mkdir(join(temp, 'deepseek-harness', 'apps', 'cli', 'lib'), { recursive: true })
await mkdir(join(localAppData, 'dsh-with-chatgpt', 'unrelated'), { recursive: true })
await writeFile(join(localAppData, 'dsh-with-chatgpt', 'unrelated', 'keep.txt'), 'keep')
await writeFile(cli, `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ argv:process.argv.slice(2), id:process.env.CONTROL_PLANE_TUNNEL_ID, key:process.env.CONTROL_PLANE_API_KEY })); process.exit(17);`)
const env = { ...process.env, LOCALAPPDATA: localAppData,
  CONTROL_PLANE_TUNNEL_ID: 'fixture-id', CONTROL_PLANE_API_KEY: 'fixture-key', DSH_CLI: cli }
const run = (script, args = [], overrides = {}) => spawnSync('pwsh.exe', ['-NoProfile', '-File', script, ...args],
  { env: { ...env, ...overrides }, encoding: 'utf8', windowsHide: true })
const output = result => result.stdout + result.stderr
try {
  const setup = run(canonicalPrepare, ['-Setup'])
  assert.equal(setup.status, 0, output(setup))
  const secret = await readFile(join(state, 'secrets.dpapi.json'), 'utf8')
  assert.doesNotMatch(secret, /fixture-key/)
  const acl = spawnSync('icacls.exe', [state], { encoding: 'utf8', windowsHide: true })
  assert.equal(acl.status, 0, output(acl))
  assert.doesNotMatch(acl.stdout, /\(I\)/, 'Private state must not inherit permissions')
  const check = run(canonicalPrepare, ['-Check'])
  assert.equal(check.status, 0, output(check))
  assert.match(check.stdout, /"allProductPrerequisitesPresent": true/)
  assert.doesNotMatch(output(check), /fixture-key|fixture-id/)
  const legacyCheck = run(legacyPrepare, ['-Check'])
  assert.equal(legacyCheck.status, 0, output(legacyCheck))
  assert.match(legacyCheck.stdout, /"allProductC2CPrerequisitesPresent": true/)
  const checkedAcl = spawnSync('icacls.exe', [state], { encoding: 'utf8', windowsHide: true })
  assert.equal(checkedAcl.status, 0, output(checkedAcl))
  assert.equal(checkedAcl.stdout, acl.stdout, 'Readiness checks must not change protected-state ACL')
  assert.equal(await readFile(join(state, 'secrets.dpapi.json'), 'utf8'), secret,
    'Legacy check must not move, rewrite or re-encrypt existing state')
  for (const launcher of [canonicalLaunch, legacyLaunch]) {
    for (const cliMode of ['canonical', 'legacy', 'conflict']) {
      const overrides = { CONTROL_PLANE_TUNNEL_ID: 'parent-id', CONTROL_PLANE_API_KEY: 'parent-key',
        DSH_CLI: cliMode === 'legacy' ? '' : cli,
        C2C_DSH_CLI: cliMode === 'conflict' ? join(temp, 'invalid.js') : cliMode === 'legacy' ? cli : '' }
      const launched = run(launcher, ['argument with spaces', 'literal;$()', '--json'], overrides)
      assert.equal(launched.status, 17, output(launched))
      assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), {
        argv: ['argument with spaces', 'literal;$()', '--json'], id: 'fixture-id', key: 'fixture-key' })
      assert.doesNotMatch(output(launched), /fixture-key|parent-key/)
      if (cliMode === 'conflict') assert.match(output(launched), /C2C_DSH_CLI ignored because DSH_CLI/)
      if (cliMode === 'legacy') assert.match(output(launched), /C2C_DSH_CLI used/)
    }
  }
  const rejected = run(canonicalLaunch, [], { DSH_CLI: join(temp, 'src', 'bin.ts') })
  assert.notEqual(rejected.status, 0)
  assert.match(output(rejected), /DSH_CLI_NOT_BUILT/)
  const clear = run(legacyPrepare, ['-Clear'])
  assert.equal(clear.status, 0, output(clear))
  await assert.rejects(readFile(join(state, 'config.json')))
  assert.equal(await readFile(join(localAppData, 'dsh-with-chatgpt', 'unrelated', 'keep.txt'), 'utf8'), 'keep')
  await mkdir(state, { recursive: true })
  await writeFile(join(state, 'config.json'), JSON.stringify({ version: 1, tunnel: { id: 'fixture-id' } }))
  await writeFile(join(state, 'secrets.dpapi.json'), JSON.stringify({ CONTROL_PLANE_API_KEY: 'corrupt' }))
  assert.notEqual(run(canonicalPrepare, ['-Check']).status, 0)
  for (const alias of [legacyPrepare, legacyLaunch]) {
    const source = await readFile(alias, 'utf8')
    assert.doesNotMatch(source, /ProcessStartInfo|ConvertTo-SecureString|Read-Json|Protect-Value/,
      'Legacy entries must delegate all deployment/security policy')
  }
} finally {
  // Only the resolved disposable fixture root is deleted.
  spawnSync('icacls.exe', [temp, '/reset', '/t', '/c'], { stdio: 'ignore', windowsHide: true })
  await rm(temp, { recursive: true, force: true })
}
console.log('PlannerBridge deployment parity and protected-state checks passed')
