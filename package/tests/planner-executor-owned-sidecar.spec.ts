import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'

describe('acceptance owned Sidecar deployment', () => {
  it('records only explicit launch targets and hands replacement to phase2 with identical state', async () => {
    const { readTargetPointer, phaseEnvironment, ownedSidecarConfig } = await import('../scripts/planner-executor-owned-sidecar.mjs')
    const root = await mkdtemp(path.join(tmpdir(), 'owned-acceptance-'))
    const pointer = path.join(root, 'target.json')
    const entry = path.join(root, 'entry.mjs')
    const output = path.join(root, 'entry.json')
    await writeFile(entry, "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.TEST_OUTPUT, JSON.stringify({target:process.env.PLANNERBRIDGE_SIDECAR_TARGET_ID,state:process.env.PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY}))")
    const launcher = path.resolve(import.meta.dirname, 'fixtures/planner-executor-owned-sidecar.mjs')
    const base = { ...process.env, PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY: root, TEST_OUTPUT: output }
    for (const target of ['INITIAL_OWNED', 'REPLACEMENT_OWNED']) {
      const child = spawnSync(process.execPath, [launcher, entry, pointer], { env: { ...base, PLANNERBRIDGE_SIDECAR_TARGET_ID: target }, encoding: 'utf8' })
      expect(child.status, child.stderr).toBe(0)
      expect(await readTargetPointer(pointer)).toBe(target)
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ target, state: root })
    }
    const second = phaseEnvironment(base, await readTargetPointer(pointer))
    expect(second.PLANNERBRIDGE_SIDECAR_TARGET_ID).toBe('REPLACEMENT_OWNED')
    expect(second.PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY).toBe(root)
    const config = ownedSidecarConfig('http://127.0.0.1:18765/', 'private.secret', entry, pointer)
    expect(config.sidecarProcessCommand).toBe(process.execPath)
    expect(config.sidecarProcessArgs).toEqual([launcher, entry, pointer])
    expect(config.browserMode).toBe('sidecar')
    expect(config.sidecarCredentialFile).toBe('private.secret')
    const bad = spawnSync(process.execPath, [launcher, entry, pointer], { env: { ...base, PLANNERBRIDGE_SIDECAR_TARGET_ID: '../foreign' }, encoding: 'utf8' })
    expect(bad.status).not.toBe(0)
    expect(await readTargetPointer(pointer)).toBe('REPLACEMENT_OWNED')
    await writeFile(pointer, JSON.stringify({ targetId: 'bad/url' }))
    await expect(readTargetPointer(pointer)).rejects.toThrow()
  })

  it('refuses an occupied endpoint without using its health or closing its listener', async () => {
    const { assertSidecarEndpointUnused } = await import('../scripts/planner-executor-owned-sidecar.mjs')
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    try {
      await expect(assertSidecarEndpointUnused(`http://127.0.0.1:${port}/`)).rejects.toThrow()
      expect(server.listening).toBe(true)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
    await expect(assertSidecarEndpointUnused(`http://127.0.0.1:${port}/`)).resolves.toBeUndefined()
    await expect(assertSidecarEndpointUnused('http://example.com:1234/')).rejects.toThrow()
  })
})
