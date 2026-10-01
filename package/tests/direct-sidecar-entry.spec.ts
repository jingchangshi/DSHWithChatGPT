import { expect, it, vi } from 'vitest'
import { startDirectSidecar } from '../src/deployment/direct-sidecar.ts'
import { DirectCdpPrimitives } from '../src/browser/direct-cdp.ts'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { protectPrivateStateDirectory } from '../src/deployment/private-state.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'

it.each(['https://chatgpt.com/c/owned', 'https://example.invalid/'])('owns transport teardown for explicit target %s', async url => {
  const root = await mkdtemp(join(tmpdir(), 'plannerbridge-entry-'))
  const credentialDirectory = join(root, 'credentials')
  await protectPrivateStateDirectory(credentialDirectory, [])
  const credentialFile = join(credentialDirectory, 'authentication.secret')
  const authentication = randomBytes(32).toString('base64url')
  await writeFile(credentialFile, authentication, { flag: 'wx', mode: 0o600 })
  const close = vi.fn()
  const connect = vi.spyOn(DirectCdpPrimitives, 'connect').mockResolvedValue({ pageInfo: async () => ({ url }), close } as unknown as DirectCdpPrimitives)
  const config = { credentialFile, stateDirectory: join(root, 'journal'), excludedRoots: [], cdpEndpoint: 'http://127.0.0.1:9222', targetId: 'explicit-target', appName: 'DSH with ChatGPT', port: 0 }
  try {
    if (url.startsWith('https://chatgpt.com/')) {
      const server = await startDirectSidecar(config)
      expect(JSON.stringify(server)).not.toContain(authentication)
      const client = new SidecarChatControlClient({ endpoint: server.endpoint, authentication })
      try {
        expect(await client.health()).toMatchObject({ ok: true })
        const response = await fetch(server.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + authentication, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, requestId: 'owned-stop', operationId: 'owned-stop', generation: server.generation, method: 'shutdown', params: {} }) })
        expect(response.ok).toBe(true)
        await server.closed
        await server.close()
        expect(close).toHaveBeenCalledTimes(1)
        await expect(client.health()).rejects.toThrow()
      } finally { await server.close() }
    } else {
      await expect(startDirectSidecar(config)).rejects.toThrow('SIDECAR_PRODUCT_TARGET_REQUIRED')
      expect(close).toHaveBeenCalledTimes(1)
    }
    expect(connect).toHaveBeenCalledWith({ endpoint: config.cdpEndpoint, targetId: config.targetId })
  } finally { connect.mockRestore(); await rm(root, { recursive: true, force: true }) }
}, 15_000)

it('rejects missing deployment references before attempting browser discovery', async () => {
  const connect = vi.spyOn(DirectCdpPrimitives, 'connect')
  try {
    await expect(startDirectSidecar({ credentialFile: '', stateDirectory: '', excludedRoots: [], cdpEndpoint: 'http://127.0.0.1:9222', targetId: '', appName: 'DSH with ChatGPT', port: 18765 })).rejects.toThrow('SIDECAR_DEPLOYMENT_INVALID')
    expect(connect).not.toHaveBeenCalled()
  } finally { connect.mockRestore() }
})

it('rejects a missing credential before opening a real browser connection', async () => {
  const connect = vi.spyOn(DirectCdpPrimitives, 'connect')
  try {
    await expect(startDirectSidecar({ credentialFile: 'C:/missing/authentication.secret', stateDirectory: 'C:/missing/journal', excludedRoots: [], cdpEndpoint: 'http://127.0.0.1:9222', targetId: 'explicit-target', appName: 'DSH with ChatGPT', port: 18765 })).rejects.toThrow('SIDECAR_CREDENTIAL_UNAVAILABLE')
    expect(connect).not.toHaveBeenCalled()
  } finally { connect.mockRestore() }
})
