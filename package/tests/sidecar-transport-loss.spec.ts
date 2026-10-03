import { createServer, request, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sidecarProcess } from './fixtures/sidecar-process.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = [], proxies: Server[] = []
afterEach(async () => {
  for (const proxy of proxies.splice(0)) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())) }
  for (const child of children.splice(0).reverse()) await child.close()
})
async function start(state?: string, options?: Parameters<typeof sidecarProcess>[1]) {
  const child = await sidecarProcess(state, options); children.push(child); return child
}
async function interrupt(child: Awaited<ReturnType<typeof start>>, method: string, phase: string, operationId: string) {
  const received: any[] = []
  const proxy = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks), value = JSON.parse(body.toString()); received.push(value)
    const upstream = request(child.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + child.authentication, 'content-type': 'application/json' } }, response => response.pipe(outgoing))
    upstream.on('error', () => outgoing.destroy()); upstream.end(body)
    // Deliberately sever only the downstream response. Production server keeps
    // owning the operation until the client's independent cancel arrives.
    if (value.method === method) void child.waitForPhase(operationId, phase).then(() => outgoing.destroy())
  })
  proxies.push(proxy)
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const port = (proxy.address() as import('node:net').AddressInfo).port
  return { received, client: new SidecarChatControlClient({ endpoint: `http://127.0.0.1:${port}`, authentication: child.authentication, requestTimeoutMs: 1_000 }) }
}
async function entry(child: Awaited<ReturnType<typeof start>>, operationId: string) {
  return JSON.parse(await readFile(join(child.stateDirectory, 'delivery.json'), 'utf8')).entries.find((value: any) => value.operationId === operationId)
}
async function observeReleased(client: SidecarChatControlClient) {
  // Cancel ACK signals abort; it does not claim provider/journal cleanup settled.
  // Observe a non-health, read-only RPC rather than adding a durable test operation.
  const deadline = Date.now() + 2_000
  while (true) {
    try { return await client.currentConversation() }
    catch (error) {
      if ((error as { code?: string }).code !== 'SIDECAR_BUSY' || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}
async function holdBeforeAdmission(child: Awaited<ReturnType<typeof start>>, method: string) {
  let held: any, cancelAcknowledged = false
  const proxy = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const value = JSON.parse(Buffer.concat(chunks).toString())
    if (value.method === method) { held = value; outgoing.destroy(); return }
    const response = await fetch(child.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + child.authentication, 'content-type': 'application/json' }, body: JSON.stringify(value) })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (value.method === 'cancel') cancelAcknowledged = JSON.parse(bytes.toString()).ok === true
    outgoing.end(bytes)
  })
  proxies.push(proxy); await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const port = (proxy.address() as import('node:net').AddressInfo).port
  return {
    client: new SidecarChatControlClient({ endpoint: `http://127.0.0.1:${port}`, authentication: child.authentication }),
    async deliver() {
      expect(cancelAcknowledged).toBe(true); expect(held).toBeDefined()
      const response = await fetch(child.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + child.authentication, 'content-type': 'application/json' }, body: JSON.stringify(held) })
      return response.json()
    },
  }
}

describe('transport interruption against a separate compiled Sidecar', { timeout: 15_000 }, () => {
  it('fences a cancelled operation previously refused admission as BUSY', async () => {
    const child = await start(undefined, { pausePhase: 'sending' })
    const rpc = async (body: unknown) => (await fetch(child.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + child.authentication, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
    const envelope = { version: 1, generation: child.generation, method: 'sendControlMessage', params: { text: 'first admitted' }, operationId: 'active-first', requestId: 'first-attempt' }
    const first = rpc(envelope)
    await child.waitForPhase(envelope.operationId, 'sending')
    const refused = { ...envelope, operationId: 'refused', requestId: 'refused-attempt', params: { text: 'must never enter' } }
    expect(await rpc(refused)).toMatchObject({ ok: false, error: { code: 'SIDECAR_BUSY' } })
    expect(await rpc({ ...envelope, operationId: 'cancel-refused', requestId: 'cancel-attempt', method: 'cancel', params: { operationId: 'refused' } })).toMatchObject({ ok: true })
    child.resume(envelope.operationId); expect(await first).toMatchObject({ ok: true })
    expect(await rpc({ ...refused, requestId: 'late-attempt' })).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } })
    expect(child.sends).toEqual(['first admitted'])
  })
  it.each([false, true])('does not poison accepted send replay with a later cancel (restart=%s)', async restart => {
    const first = await start()
    const operation = { operationId: 'already-accepted' }
    const initial = new SidecarChatControlClient({ endpoint: first.endpoint, authentication: first.authentication })
    await initial.sendControlMessage('existing proof', undefined, operation)
    if (restart) await first.crash()
    const live = restart ? await start(first.stateDirectory) : first
    const response = await fetch(live.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + live.authentication, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, generation: live.generation, requestId: 'later-cancel-attempt', operationId: 'later-cancel', method: 'cancel', params: { operationId: operation.operationId } }) })
    expect(await response.json()).toMatchObject({ ok: true })
    const resumed = new SidecarChatControlClient({ endpoint: live.endpoint, authentication: live.authentication })
    await resumed.sendControlMessage('existing proof', undefined, operation)
    expect(first.sends).toEqual(['existing proof'])
    if (restart) expect(live.sends).toEqual([])
    expect(await entry(live, operation.operationId)).toMatchObject({ phase: 'accepted' })
  })
  it('rejects delayed old-generation requests after a pre-admission cancel and restart', async () => {
    const first = await start()
    const rpc = async (child: typeof first, body: unknown) => (await fetch(child.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + child.authentication, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
    expect(await rpc(first, { version: 1, generation: first.generation, requestId: 'cancel-request', operationId: 'cancel-operation', method: 'cancel', params: { operationId: 'delayed-original' } })).toMatchObject({ ok: true })
    await first.crash()
    const second = await start(first.stateDirectory)
    expect(await rpc(second, { version: 1, generation: first.generation, requestId: 'old-original', operationId: 'delayed-original', method: 'sendControlMessage', params: { text: 'must never enter' } })).toMatchObject({ ok: false, error: { code: 'SIDECAR_GENERATION_CHANGED' } })
    expect(second.sends).toEqual([])
  })
  it.each(['sendControlMessage', 'waitForReply'])('fences late %s admission when independent cancellation arrives first', async method => {
    const child = await start()
    const p = await holdBeforeAdmission(child, method)
    const operation = { operationId: 'cancel-before-original' }
    const pending = method === 'sendControlMessage'
      ? p.client.sendControlMessage('must never enter', undefined, operation)
      : p.client.waitForReply(50, undefined, operation)
    await expect(pending).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
    expect(await p.deliver()).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } })
    expect(child.sends).toEqual([])
    expect(await entry(child, operation.operationId)).toBeUndefined()
    const direct = new SidecarChatControlClient({ endpoint: child.endpoint, authentication: child.authentication })
    await direct.sendControlMessage('different operation', undefined, { operationId: 'unaffected' })
    expect(child.sends).toEqual(['different operation'])
  })
  it('cancels a persisted wait, releases ownership, and resumes its exact identity after restart without another send', async () => {
    const first = await start(undefined, { recoveryView: 'exact', pausePhase: 'awaiting-reply' })
    const direct = new SidecarChatControlClient({ endpoint: first.endpoint, authentication: first.authentication })
    const baseline = await direct.captureReplyBaseline()
    await direct.sendControlMessage('owned recovery control', undefined, { operationId: 'owned-send', replyBaseline: baseline })
    const operation = { operationId: 'owned-wait', replyBaseline: baseline, replyRecovery: { sendOperationId: 'owned-send' } }
    const p = await interrupt(first, 'waitForReply', 'awaiting-reply', operation.operationId)
    await expect(p.client.waitForReply(2_000, undefined, operation)).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
    expect(p.received.filter(value => value.method === 'cancel').map(value => value.params.operationId)).toEqual(['owned-wait'])
    expect(await observeReleased(direct)).toBe('owned')
    expect(await entry(first, operation.operationId)).toMatchObject({ phase: 'uncertain' })
    await first.crash()
    const second = await start(first.stateDirectory, { recoveryView: 'exact' })
    const resumed = new SidecarChatControlClient({ endpoint: second.endpoint, authentication: second.authentication })
    expect(await resumed.waitForReply(2_000, undefined, operation)).toEqual({ text: 'reply to owned recovery control', complete: true })
    expect(first.sends).toEqual(['owned recovery control']); expect(second.sends).toEqual([])
    expect(await entry(second, operation.operationId)).toMatchObject({ phase: 'accepted' })
    expect(p.received.filter(value => value.method === 'waitForReply')).toHaveLength(1)
  })
  it('preserves an admitted send as uncertain after transport loss and refuses to duplicate it after restart', async () => {
    const first = await start(undefined, { pausePhase: 'observed-sent' })
    const operation = { operationId: 'owned-send' }
    const p = await interrupt(first, 'sendControlMessage', 'observed-sent', operation.operationId)
    await expect(p.client.sendControlMessage('already entered', undefined, operation)).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
    const direct = new SidecarChatControlClient({ endpoint: first.endpoint, authentication: first.authentication })
    expect(await observeReleased(direct)).toBeUndefined()
    expect(await entry(first, operation.operationId)).toMatchObject({ phase: 'uncertain' })
    expect(first.sends).toEqual(['already entered'])
    expect(p.received.filter(value => value.method === 'cancel')).toHaveLength(1)
    await first.crash()
    const second = await start(first.stateDirectory)
    const resumed = new SidecarChatControlClient({ endpoint: second.endpoint, authentication: second.authentication })
    await expect(resumed.sendControlMessage('already entered', undefined, operation)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(second.sends).toEqual([])
  })
})
