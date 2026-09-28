import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const prepare = await readFile(join(root, 'scripts', 'prepare-c2c-codex.ps1'), 'utf8')
const launch = await readFile(join(root, 'scripts', 'launch-c2c-codex.ps1'), 'utf8')
const cmd = await readFile(join(root, 'scripts', 'launch-c2c-codex.cmd'), 'utf8')
const doc = await readFile(join(root, 'docs', 'windows-c2c-launcher.zh-CN.md'), 'utf8')

assert.match(prepare, /ConvertTo-SecureString|ConvertFrom-SecureString/)
assert.match(prepare, /SetAccessRuleProtection\(\$true, \$false\)/)
assert.match(prepare, /CODEX_ALREADY_RUNNING/)
assert.match(prepare, /ClearLocalConfig/)
assert.match(prepare, /Start-Process -FilePath \$codex -WorkingDirectory \$RepoRoot/)
assert.match(prepare, /C2C_EXECUTION_API_KEY/)
assert.match(prepare, /GetEnvironmentVariable\(\$key, 'Process'\)/)
assert.doesNotMatch(prepare, /auth\.json|cookie|session storage/i)
assert.doesNotMatch(prepare, /Write-Host.*\$(?:envMap|secrets|Value)/i)
assert.match(launch, /-Check -Launch/)
assert.match(cmd, /pwsh\.exe -NoProfile/)
assert.match(doc, /DPAPI/)
assert.match(doc, /ClearLocalConfig/)
const temp = await mkdtemp(join(tmpdir(), 'c2c-launcher-test-'))
try {
  const bin = join(temp, 'bin')
  await mkdir(bin)
  const names = ['dsh.js', 'tunnel.exe', 'browser-harness-mcp.exe']
  for (const name of names) await writeFile(join(bin, name), '')
  const state = join(temp, 'dsh-with-chatgpt', 'c2c-launcher')
  await mkdir(state, { recursive: true })
  await writeFile(join(state, 'config.json'), JSON.stringify({
    version: 1,
    executables: {
      C2C_DSH_CLI: join(bin, 'dsh.js'),
      C2C_TUNNEL_CLIENT: join(bin, 'tunnel.exe'),
      C2C_BROWSER_HARNESS: join(bin, 'browser-harness-mcp.exe')
    },
    secrets: {
      C2C_EXECUTION_BASE_URL: 'dummy',
      C2C_EXECUTION_API_KEY: 'dummy',
      CONTROL_PLANE_API_KEY: 'dummy',
      CONTROL_PLANE_TUNNEL_ID: 'dummy'
    }
  }))
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-File', join(root, 'scripts', 'prepare-c2c-codex.ps1'), '-Check'], {
    encoding: 'utf8',
    env: { ...process.env, LOCALAPPDATA: temp }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"allAcceptancePrerequisitesPresent": true/)
  assert.doesNotMatch(result.stdout, /dummy/)

  const setupEnv = {
    ...process.env,
    LOCALAPPDATA: temp,
    C2C_DSH_CLI: join(bin, 'dsh.js'),
    C2C_TUNNEL_CLIENT: join(bin, 'tunnel.exe'),
    C2C_BROWSER_HARNESS: join(bin, 'browser-harness-mcp.exe'),
    C2C_EXECUTION_BASE_URL: 'https://dummy.invalid/v1',
    C2C_EXECUTION_API_KEY: 'dummy-execution-key',
    CONTROL_PLANE_API_KEY: 'dummy-control-key',
    CONTROL_PLANE_TUNNEL_ID: 'dummy-tunnel-id'
  }
  const setup = spawnSync('pwsh.exe', ['-NoProfile', '-File', join(root, 'scripts', 'prepare-c2c-codex.ps1'), '-Setup'], {
    encoding: 'utf8',
    env: setupEnv
  })
  assert.equal(setup.status, 0, setup.stderr)
  const encryptedConfig = await readFile(join(state, 'config.json'), 'utf8')
  assert.doesNotMatch(encryptedConfig, /dummy-(?:execution|control|tunnel)/)
} finally {
  await rm(temp, { recursive: true, force: true })
}

console.log('c2c launcher tests passed')
