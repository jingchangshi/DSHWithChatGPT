import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const servers: Server[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } })
async function fixture(handler: (body: any, response: import('node:http').ServerResponse) => void) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    handler(JSON.parse(Buffer.concat(chunks).toString()), response)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const { SidecarChatControlClient } = await import('../src/sidecar/client.ts')
  return new SidecarChatControlClient({ endpoint: `http://127.0.0.1:${address.port}`, authentication: 'test-token', requestTimeoutMs: 200 })
}
function success(body: any, result: unknown) { return JSON.stringify({ version: 1, requestId: body.requestId, generation: 'test-generation', ok: true, result }) }
describe('bounded neutral client transport', () => {
  it('keeps a delayed-header reply within its explicit budget despite an ambient fetch cutoff', async () => {
    const client = await fixture((body, response) => {
      if (body.method === 'waitForReply') { setTimeout(() => response.end(success(body, { text: 'settled', complete: true })), 80); return }
      response.end(success(body, body.method === 'health' ? { ok: true, detail: 'ready' } : null))
    })
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init: RequestInit) => originalFetch(input, {
      ...init, signal: JSON.parse(String(init.body)).method === 'waitForReply'
        ? AbortSignal.any([init.signal!, AbortSignal.timeout(20)]) : init.signal,
    }))
    expect(await client.waitForReply(300)).toEqual({ text: 'settled', complete: true })
  })
  it.each(['headers', 'body'])('independently cancels the admitted wait after interrupted %s without another wait', async phase => {
    const received: any[] = []
    const client = await fixture((body, response) => {
      received.push(body)
      if (body.method === 'waitForReply') {
        if (phase === 'body') { response.writeHead(200, { 'content-length': '1000' }); response.write('{'); setTimeout(() => response.destroy(), 10) }
        else response.destroy()
        return
      }
      response.end(success(body, body.method === 'health' ? { ok: true, detail: 'ready' } : null))
    })
    await expect(client.waitForReply(300, undefined, { operationId: 'owned-wait' })).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
    expect(received.filter(body => body.method === 'waitForReply')).toHaveLength(1)
    const cancel = received.filter(body => body.method === 'cancel')
    expect(cancel).toHaveLength(1)
    expect(cancel[0].params).toEqual({ operationId: 'owned-wait' })
  })
  it('does not cancel a valid server refusal classified as unavailable', async () => {
    const received: any[] = []
    const client = await fixture((body, response) => {
      received.push(body)
      if (body.method === 'health') response.end(success(body, { ok: true, detail: 'ready' }))
      else response.end(JSON.stringify({ version: 1, requestId: body.requestId, generation: 'test-generation', ok: false, error: { code: 'SIDECAR_UNAVAILABLE' } }))
    })
    await expect(client.waitForReply(300)).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
    expect(received.map(body => body.method)).toEqual(['health', 'waitForReply'])
  })
  it('preserves caller operation identity and correlation across fresh transport attempts', async () => {
    const received: any[] = []
    const client = await fixture((body, response) => { received.push(body); response.end(success(body, body.method === 'health' ? { ok: true, detail: 'ready' } : null)) })
    const operation = { operationId: 'durable-send', correlation: { taskId: 'task-one', iteration: 1, workspaceId: 'workspace-one', phase: 'EXECUTED' as const, head: 'a'.repeat(40) }, replyBaseline: { version: 1 as const, conversationId: 'owned', assistantCount: 1, textDigest: 'b'.repeat(64), observationEpoch: 'c'.repeat(64) } }
    await client.sendControlMessage('same control', undefined, operation)
    await client.sendControlMessage('same control', undefined, operation)
    const sends = received.filter(body => body.method === 'sendControlMessage')
    expect(sends.map(body => body.operationId)).toEqual(['durable-send', 'durable-send'])
    expect(sends[0].correlation).toEqual(operation.correlation)
    expect(sends[0].replyBaseline).toEqual(operation.replyBaseline)
    expect(sends[1].requestId).not.toBe(sends[0].requestId)
  })
  it('handshakes a generation and validates semantic replies', async () => {
    const received: any[] = []
    const client = await fixture((body, response) => { received.push(body); response.end(success(body, body.method === 'health' ? { ok: true, detail: 'ready' } : { text: 'answer', complete: true })) })
    expect(await client.waitForReply(300)).toEqual({ text: 'answer', complete: true })
    expect(received.map(body => body.method)).toEqual(['health', 'waitForReply'])
    expect(received[1].generation).toBe('test-generation')
    expect(received[1].requestId).not.toBe(received[1].operationId)
  })
  it('rejects oversized streamed responses', async () => {
    const client = await fixture((_body, response) => { response.write('x'.repeat(40_000)); response.end('x'.repeat(40_000)) })
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_RESPONSE_TOO_LARGE' })
  })
  it('rejects an oversized declared response before waiting for its body', async () => {
    const client = await fixture((_body, response) => { response.writeHead(200, { 'content-length': '65537' }); response.flushHeaders() })
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_RESPONSE_TOO_LARGE' })
  })
  it('applies the same absolute deadline to a response that stalls after headers', async () => {
    const client = await fixture((_body, response) => { response.writeHead(200); response.write('{') })
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_TIMEOUT' })
  })
  it('never follows a redirect or forwards authentication to its destination', async () => {
    let destinationRequests = 0
    const destination = createServer((_request, response) => { destinationRequests++; response.end() })
    servers.push(destination)
    await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve))
    const port = (destination.address() as import('node:net').AddressInfo).port
    const client = await fixture((_body, response) => { response.writeHead(307, { location: `http://127.0.0.1:${port}/` }); response.end() })
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
    expect(destinationRequests).toBe(0)
  })
  it('rejects invalid UTF-8 rather than repairing protocol data', async () => {
    const client = await fixture((body, response) => {
      const valid = success(body, { ok: true, detail: 'ready' })
      response.end(Buffer.concat([Buffer.from(valid.slice(0, -1)), Buffer.from([0xff]), Buffer.from('}')]))
    })
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' })
  })
  it('bounds a provider that never returns headers', async () => {
    const client = await fixture(() => {})
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_TIMEOUT' })
  })
  it('rejects response IDs that do not match the attempt', async () => {
    const client = await fixture((body, response) => response.end(success({ ...body, requestId: 'wrong-id' }, { ok: true, detail: 'ready' })))
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' })
  })
  it('maps only allowed error codes without disclosing provider messages', async () => {
    const client = await fixture((body, response) => response.end(JSON.stringify({ version: 1, requestId: body.requestId, generation: 'test-generation', ok: false, error: { code: 'CHATGPT_LOGGED_OUT' } })))
    await expect(client.health()).rejects.toMatchObject({ code: 'CHATGPT_LOGGED_OUT', message: 'CHATGPT_LOGGED_OUT' })
  })
  it('sends cancellation with a fresh request and logical target after caller abort', async () => {
    const received: any[] = []
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const client = await fixture((body, response) => {
      received.push(body)
      if (body.method === 'sendControlMessage') { started(); return }
      response.end(success(body, body.method === 'health' ? { ok: true, detail: 'ready' } : null))
    })
    const controller = new AbortController()
    const pending = client.sendControlMessage('control', controller.signal)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    await entered; controller.abort(); await rejection
    const send = received.find(body => body.method === 'sendControlMessage')
    const cancel = received.find(body => body.method === 'cancel')
    expect(cancel.params.operationId).toBe(send.operationId)
    expect(cancel.requestId).not.toBe(send.requestId)
    expect(cancel.operationId).not.toBe(send.operationId)
  })
  it('rejects malformed semantic results', async () => {
    const client = await fixture((body, response) => response.end(success(body, { ok: 'yes', detail: 'ready' })))
    await expect(client.health()).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' })
  })
})
