import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'
import { startSidecar } from '../src/sidecar/server.ts'
import { protectPrivateStateDirectory } from '../src/deployment/private-state.ts'
import { SidecarRpcError } from '../src/sidecar/errors.ts'

const services: Awaited<ReturnType<typeof startSidecar>>[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()))
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('plannerbridge-diagnostics-test-')) throw new Error('Unexpected cleanup target')
    await rm(directory, { recursive: true, force: true })
  }
})
async function fixture(diagnostics = true) {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-diagnostics-test-'))
  directories.push(directory)
  await protectPrivateStateDirectory(directory, [])
  const probe = vi.fn(async (_app: string, _signal?: AbortSignal) => {})
  const readiness = vi.fn(async () => ({ url: 'https://chatgpt.com/', composer: false, loggedOut: true }))
  const phases: string[] = []
  const driver = {
    health: async () => ({ ok: true, detail: 'service' }), ensureReady: async () => {},
    openConversation: async () => 'conversation', currentConversation: async () => undefined,
    sendControlMessage: async () => {}, waitForReply: async () => ({ text: '', complete: true }), recover: async () => {},
    ...(diagnostics ? { readiness, probeApp: probe } : {}),
  }
  const options = { host: '127.0.0.1' as const, port: 0, authentication: 'diagnostic-test-only', stateDirectory: directory,
    driver, configuredAppName: 'Product App', requestTimeoutMs: 1000, onDeliveryPhase: (entry: { phase: string }) => { phases.push(entry.phase) } }
  const service = await startSidecar(options)
  services.push(service)
  const client = new SidecarChatControlClient({ endpoint: service.endpoint, authentication: options.authentication, requestTimeoutMs: 1000 })
  return { options, service, client, probe, readiness, phases }
}

// Windows can spend several seconds creating isolated child processes when this
// file runs after the full suite. This test-level budget does not change any
// production RPC or operation deadline.
describe('narrow semantic Sidecar diagnostics', { timeout: 15_000 }, () => {
  it('returns observed browser facts even while authenticated service health is good', async () => {
    const f = await fixture()
    expect((await f.client.health()).ok).toBe(true)
    expect(await f.client.readiness()).toEqual({ url: 'https://chatgpt.com/', composer: false, loggedOut: true })
    expect(f.probe).not.toHaveBeenCalled()
  })
  it('reports unsupported diagnostics instead of inferring them from health', async () => {
    const f = await fixture(false)
    expect((await f.client.health()).ok).toBe(true)
    await expect(f.client.readiness()).rejects.toMatchObject({ code: 'CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE' })
  })
  it('rejects another App before the provider can mutate the composer', async () => {
    const f = await fixture()
    await expect(f.client.probeApp('Other App')).rejects.toMatchObject({ code: 'CHATGPT_APP_UNAVAILABLE' })
    expect(f.probe).not.toHaveBeenCalled()
  })
  it('forwards only the exact configured App and joins replay without repeating selection', async () => {
    const f = await fixture()
    const operation = { operationId: 'diagnostic-probe-one' }
    await f.client.probeApp('Product App', undefined, operation)
    await f.client.probeApp('Product App', undefined, operation)
    expect(f.probe).toHaveBeenCalledOnce()
    expect(f.probe.mock.calls[0]![0]).toBe('Product App')
    expect(f.phases).toEqual(['prepared', 'probing-app', 'observed-app', 'accepted'])
  })
  it('does not replay a potentially written App probe after restart', async () => {
    const f = await fixture()
    f.probe.mockRejectedValueOnce(new SidecarRpcError('SEND_UNCERTAIN'))
    const operation = { operationId: 'diagnostic-uncertain-probe' }
    await expect(f.client.probeApp('Product App', undefined, operation)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    await f.service.close()
    const restarted = await startSidecar(f.options)
    services.push(restarted)
    const client = new SidecarChatControlClient({ endpoint: restarted.endpoint, authentication: f.options.authentication })
    await expect(client.probeApp('Product App', undefined, operation)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.probe).toHaveBeenCalledOnce()
  })
  it('rejects a cancelled probe before provider selection', async () => {
    const f = await fixture()
    const controller = new AbortController(); controller.abort()
    await expect(f.client.probeApp('Product App', controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(f.probe).not.toHaveBeenCalled()
  })
  it('cancels an in-flight selection and retains uncertainty across restart', async () => {
    const f = await fixture()
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    f.probe.mockImplementation(async (_app, signal) => {
      started()
      await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new SidecarRpcError('OPERATION_CANCELLED')), { once: true }))
    })
    const controller = new AbortController()
    const operation = { operationId: 'diagnostic-cancelled-probe' }
    const pending = f.client.probeApp('Product App', controller.signal, operation)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    await entered
    controller.abort()
    await rejection
    expect(f.phases).toContain('probing-app')
    expect(f.phases).not.toContain('accepted')
    await f.service.close()
    const restarted = await startSidecar(f.options)
    services.push(restarted)
    const client = new SidecarChatControlClient({ endpoint: restarted.endpoint, authentication: f.options.authentication })
    await expect(client.probeApp('Product App', undefined, operation)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.probe).toHaveBeenCalledOnce()
  })
  it('does not treat a previous generation accepted probe as fresh App availability', async () => {
    const f = await fixture()
    const operation = { operationId: 'diagnostic-accepted-old-generation' }
    await f.client.probeApp('Product App', undefined, operation)
    await f.service.close()
    const restarted = await startSidecar(f.options)
    services.push(restarted)
    const client = new SidecarChatControlClient({ endpoint: restarted.endpoint, authentication: f.options.authentication })
    await expect(client.probeApp('Product App', undefined, operation)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.probe).toHaveBeenCalledOnce()
    await client.probeApp('Product App')
    expect(f.probe).toHaveBeenCalledTimes(2)
  })
})
