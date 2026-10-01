import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { sidecarProcess } from './fixtures/sidecar-process.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = []
afterEach(async () => { for (const child of children.splice(0).reverse()) await child.close() })
async function start(state?: string) { const child = await sidecarProcess(state); children.push(child); return child }
function envelope(sidecar: Awaited<ReturnType<typeof sidecarProcess>>, text: string, operationId = randomUUID()) {
  return { version: 1, generation: sidecar.generation, requestId: randomUUID(), operationId, method: 'sendControlMessage', params: { text } }
}
async function rpc(sidecar: Awaited<ReturnType<typeof sidecarProcess>>, body: unknown) {
  const response = await fetch(sidecar.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + sidecar.authentication, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return response.json()
}
describe('separate-process operation delivery lifecycle', () => {
  it('replays the same operation across different transport IDs without another send', async () => {
    const child = await start()
    const request = envelope(child, 'one logical send')
    const first = await rpc(child, request)
    const second = await rpc(child, { ...request, requestId: randomUUID() })
    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: true })
    expect(child.sends).toEqual(['one logical send'])
  })
  it('rejects both request-ID and operation-ID payload conflicts', async () => {
    const child = await start()
    const request = envelope(child, 'original payload')
    expect(await rpc(child, request)).toMatchObject({ ok: true })
    expect(await rpc(child, { ...request, params: { text: 'changed payload' } })).toMatchObject({ ok: false, error: { code: 'REPLAY_CONFLICT' } })
    expect(await rpc(child, { ...request, requestId: randomUUID(), params: { text: 'changed payload' } })).toMatchObject({ ok: false, error: { code: 'REPLAY_CONFLICT' } })
    expect(child.sends).toEqual(['original payload'])
  })
  it('records uncertain sends across a hard process crash and forbids automatic resend', async () => {
    const first = await start()
    const request = envelope(first, 'hang-before-ack')
    const pending = rpc(first, request).catch(error => error)
    const deadline = Date.now() + 2_000
    while (first.sends.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    expect(first.sends).toEqual(['hang-before-ack'])
    await first.crash()
    await pending
    const second = await start(first.stateDirectory)
    expect(second.pid).not.toBe(first.pid)
    expect(second.generation).not.toBe(first.generation)
    const response = await rpc(second, { ...request, requestId: randomUUID(), generation: second.generation })
    expect(response).toMatchObject({ ok: false, error: { code: 'SEND_UNCERTAIN' } })
    expect(second.sends).toEqual([])
  })
  it('uses a separate cancellation request for the logical operation while remaining responsive', async () => {
    const child = await start()
    const request = envelope(child, 'hang-before-ack')
    const pending = rpc(child, request).catch(error => error)
    const deadline = Date.now() + 2_000
    while (!child.sends.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    const cancel = { version: 1, requestId: randomUUID(), operationId: randomUUID(), generation: child.generation, method: 'cancel', params: { operationId: request.operationId } }
    expect(cancel.requestId).not.toBe(request.requestId)
    expect(await rpc(child, cancel)).toMatchObject({ ok: true })
    await pending
    expect(await rpc(child, { ...cancel, requestId: randomUUID(), operationId: randomUUID(), method: 'health', params: {} })).toMatchObject({ ok: true })
    expect(child.sends).toEqual(['hang-before-ack'])
  })
})
