import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../..', import.meta.url))
const canonical = join(root, 'scripts', 'prepare-development-chatgpt.ps1')
const legacy = join(root, 'scripts', 'prepare-c2c-codex.ps1')
// Missing canonical entry is the initial falsification; no real user state used.
await readFile(canonical, 'utf8')
const temp = await mkdtemp(join(tmpdir(), 'development-chatgpt-entry-'))
const state = join(temp, 'dsh-with-chatgpt', 'c2c-launcher')
const bin = join(temp, 'bin')
const keys = {
  DSH_EXECUTION_BASE_URL: 'https://fixture.invalid/v1',
  DSH_EXECUTION_API_KEY: 'fixture-execution-key',
  CONTROL_PLANE_API_KEY: 'fixture-control-key',
  CONTROL_PLANE_TUNNEL_ID: 'fixture-tunnel-id',
}
try {
  await mkdir(bin, { recursive: true })
  for (const name of ['dsh.js', 'tunnel.exe', 'browser.exe', 'alternate.js']) await writeFile(join(bin, name), '')
  const env = { ...process.env, LOCALAPPDATA: temp, ...keys,
    DSH_CLI: join(bin, 'dsh.js'), MCP_EXPOSURE_CLIENT: join(bin, 'tunnel.exe'),
    BROWSER_HARNESS_COMPAT_EXECUTABLE: join(bin, 'browser.exe') }
  for (const key of ['C2C_EXECUTION_BASE_URL','C2C_EXECUTION_API_KEY','C2C_DSH_CLI','C2C_TUNNEL_CLIENT','C2C_BROWSER_HARNESS']) delete env[key]
  const run = (script, args, overrides = {}) => spawnSync('pwsh.exe', ['-NoProfile','-File',script,...args], { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 30000 })
  const output = result => `${result.stdout}\n${result.stderr}`
  const setup = run(canonical, ['-Setup'])
  assert.equal(setup.status, 0, output(setup))
  const configPath = join(state, 'config.json')
  const original = await readFile(configPath, 'utf8')
  for (const value of Object.values(keys)) assert.ok(!original.includes(value), 'DPAPI config leaked plaintext')
  const parsed = JSON.parse(original)
  assert.equal(parsed.version, 1)
  assert.equal(parsed.executables.C2C_DSH_CLI, resolve(bin, 'dsh.js'), 'released schema retained')
  const acl = spawnSync('pwsh.exe', ['-NoProfile','-Command', `Get-Acl -LiteralPath '${configPath.replaceAll("'", "''")}' | Select-Object -ExpandProperty Sddl`], { encoding:'utf8' })
  assert.equal(acl.status, 0)
  const protection = spawnSync('pwsh.exe', ['-NoProfile','-Command', `$acl=Get-Acl -LiteralPath '${configPath.replaceAll("'", "''")}'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; @{ protected=$acl.AreAccessRulesProtected; foreign=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference -ne $sid }).Count } | ConvertTo-Json`], { encoding:'utf8' })
  assert.equal(protection.status,0)
  const protectedAcl=JSON.parse(protection.stdout)
  assert.equal(protectedAcl.protected,true)
  assert.equal(protectedAcl.foreign,0)
  for (const entry of [canonical, legacy]) {
    const check = run(entry, ['-Check'])
    assert.equal(check.status, 0, output(check))
    assert.match(check.stdout, entry === canonical ? /"allDevelopmentPrerequisitesPresent": true/ : /"allAcceptancePrerequisitesPresent": true/)
    assert.equal(await readFile(configPath, 'utf8'), original, 'check rewrote ciphertext')
    for (const value of Object.values(keys)) assert.ok(!output(check).includes(value))
  }
  const afterAcl = spawnSync('pwsh.exe', ['-NoProfile','-Command', `Get-Acl -LiteralPath '${configPath.replaceAll("'", "''")}' | Select-Object -ExpandProperty Sddl`], { encoding:'utf8' })
  assert.equal(afterAcl.stdout, acl.stdout, 'check changed ACL')
  const conflict = run(canonical, ['-Setup'], { C2C_DSH_CLI: join(bin,'alternate.js'), C2C_EXECUTION_API_KEY:'legacy-key' })
  assert.equal(conflict.status, 0, output(conflict))
  assert.match(output(conflict), /Deprecated C2C_DSH_CLI ignored/)
  assert.match(output(conflict), /Deprecated C2C_EXECUTION_API_KEY ignored/)
  assert.ok(!output(conflict).includes('legacy-key'))
  assert.equal(JSON.parse(await readFile(configPath,'utf8')).executables.C2C_DSH_CLI, resolve(bin,'dsh.js'))
  const oldEnv = { ...env }
  const aliases = { DSH_CLI:'C2C_DSH_CLI', MCP_EXPOSURE_CLIENT:'C2C_TUNNEL_CLIENT', BROWSER_HARNESS_COMPAT_EXECUTABLE:'C2C_BROWSER_HARNESS', DSH_EXECUTION_BASE_URL:'C2C_EXECUTION_BASE_URL', DSH_EXECUTION_API_KEY:'C2C_EXECUTION_API_KEY' }
  for(const [name,alias] of Object.entries(aliases)) { oldEnv[alias]=oldEnv[name]; delete oldEnv[name] }
  const oldSetup = spawnSync('pwsh.exe',['-NoProfile','-File',legacy,'-Setup'],{env:oldEnv,encoding:'utf8',timeout:30000})
  assert.equal(oldSetup.status,0,output(oldSetup))
  assert.match(output(oldSetup),/Deprecated C2C_DSH_CLI used/)
  // Process discovery is the explicit test fixture, not the production script.
  // A second tripwire ensures even a broken guard cannot launch the desktop app.
  const launchPath = join(root,'scripts','launch-development-chatgpt.ps1').replaceAll("'", "''")
  const launch = spawnSync('pwsh.exe', ['-NoProfile','-Command', `function global:Get-Process { param([string]$Name) if ($Name -eq 'codex') { [pscustomobject]@{ Id = 123 } } }; function global:Start-Process { throw 'UNEXPECTED_PROCESS_START' }; & '${launchPath}'`], { env, encoding:'utf8',timeout:30000 })
  assert.notEqual(launch.status,0,'-Check must not short circuit -Launch')
  assert.match(output(launch), /CODEX_ALREADY_RUNNING/)
  const report = join(temp, 'launch-report.json').replaceAll("'", "''")
  const simulatedLaunch = spawnSync('pwsh.exe', ['-NoProfile','-Command', `function global:Get-Process { param([string]$Name) }; function global:Start-Process { param($FilePath,$WorkingDirectory,$WindowStyle) @{ file=$FilePath; cwd=$WorkingDirectory; window=$WindowStyle; key=$env:DSH_EXECUTION_API_KEY; client=$env:MCP_EXPOSURE_CLIENT; legacyKey=$env:C2C_EXECUTION_API_KEY } | ConvertTo-Json | Set-Content -LiteralPath '${report}' }; & '${launchPath}'`], { env: { ...env, CODEX_EXE:join(bin,'dsh.js') }, encoding:'utf8',timeout:30000 })
  assert.equal(simulatedLaunch.status,0,output(simulatedLaunch))
  const launched=JSON.parse(await readFile(report,'utf8'))
  assert.equal(launched.file,resolve(bin,'dsh.js'))
  assert.equal(launched.cwd,resolve(root))
  assert.equal(launched.window,'Hidden')
  assert.equal(launched.key,keys.DSH_EXECUTION_API_KEY)
  assert.equal(launched.client,resolve(bin,'tunnel.exe'))
  assert.ok(!launched.legacyKey,'canonical launch must not introduce legacy environment input')
  for(const value of Object.values(keys))assert.ok(!output(simulatedLaunch).includes(value))
  await writeFile(configPath, '{broken')
  const corrupt = run(canonical,['-Check'])
  assert.notEqual(corrupt.status,0)
  assert.match(output(corrupt), /LOCAL_CONFIG_INVALID/)
  await mkdir(join(temp,'dsh-with-chatgpt','unrelated'),{recursive:true})
  const keep=join(temp,'dsh-with-chatgpt','unrelated','keep.txt')
  await writeFile(keep,'keep')
  const clear=run(legacy,['-ClearLocalConfig'])
  assert.equal(clear.status,0,output(clear))
  assert.equal(await readFile(keep,'utf8'),'keep')
  await assert.rejects(readFile(configPath))
  console.log('Development ChatGPT canonical/legacy entry and launch guard checks passed; no real Codex launch')
} finally { await rm(temp,{recursive:true,force:true}) }
