import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const legacy = await readFile(new URL('./verify-live-c2c.mjs', import.meta.url), 'utf8')
test('legacy acceptance entry cannot retain a separate model, browser or result policy', () => {
  assert.match(legacy, /verify-planner-executor-e2e\.mjs/)
  assert.doesNotMatch(legacy, /fullC2CAccepted|C2C_EXECUTION_BASE_URL|C2C_EXECUTION_API_KEY|C2C_BROWSER_HARNESS/)
})
for (const mode of ['canonical', 'legacy-only', 'conflict']) {
  test(`legacy entry forwards arguments, selected environment and exit status: ${mode}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plannerbridge-legacy-entry-'))
    try {
      // Run the unchanged wrapper against a child at its canonical sibling URL.
      // The child records fake references only; no real credential is inherited.
      await writeFile(path.join(root, 'legacy.mjs'), legacy)
      await writeFile(path.join(root, 'verify-planner-executor-e2e.mjs'), `
import {writeFileSync} from 'node:fs';
writeFileSync(process.env.PLANNERBRIDGE_ENTRY_REPORT, JSON.stringify({args:process.argv.slice(2),cli:process.env.DSH_CLI,exposure:process.env.MCP_EXPOSURE_CLIENT,native:process.env.DEEPSEEK_API_KEY}));
process.exit(17);
`)
      const env = { ...process.env, PLANNERBRIDGE_ENTRY_REPORT: path.join(root, 'report.json'), DEEPSEEK_API_KEY: 'fake-native' }
      for (const key of ['DSH_CLI', 'MCP_EXPOSURE_CLIENT', 'C2C_DSH_CLI', 'C2C_TUNNEL_CLIENT', 'CONTROL_PLANE_API_KEY', 'CONTROL_PLANE_TUNNEL_ID']) delete env[key]
      if (mode !== 'legacy-only') Object.assign(env, { DSH_CLI: 'canonical-cli', MCP_EXPOSURE_CLIENT: 'canonical-exposure' })
      if (mode !== 'canonical') Object.assign(env, { C2C_DSH_CLI: 'legacy-cli', C2C_TUNNEL_CLIENT: 'legacy-exposure' })
      const child = spawnSync(process.execPath, [path.join(root, 'legacy.mjs'), 'source with spaces', 'installation with spaces'], { env, encoding: 'utf8', windowsHide: true, timeout: 5000 })
      assert.equal(child.status, 17, child.stderr)
      assert.deepEqual(JSON.parse(await readFile(env.PLANNERBRIDGE_ENTRY_REPORT, 'utf8')), {
        args: ['source with spaces', 'installation with spaces'],
        cli: mode === 'legacy-only' ? 'legacy-cli' : 'canonical-cli',
        exposure: mode === 'legacy-only' ? 'legacy-exposure' : 'canonical-exposure', native: 'fake-native',
      })
      assert.doesNotMatch(child.stdout + child.stderr, /fake-native/)
    } finally {
      const absolute = path.resolve(root)
      assert.ok(absolute.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(absolute).startsWith('plannerbridge-legacy-entry-'))
      await rm(absolute, { recursive: true, force: true })
    }
  })
}
