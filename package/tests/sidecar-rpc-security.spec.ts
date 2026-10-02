import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sidecarProcess } from './fixtures/sidecar-process.ts'

describe('separate-process semantic RPC security', () => {
  let sidecar: Awaited<ReturnType<typeof sidecarProcess>>
  beforeEach(async () => { sidecar = await sidecarProcess(); expect(sidecar.pid).not.toBe(process.pid) })
  afterEach(async () => { await sidecar?.close() })
  const envelope = (method: string, generation: string) => ({ version: 1, requestId: randomUUID(), operationId: randomUUID(), generation, method, params: {} })
  function rpc(body: unknown, token = sidecar.authentication, method = 'POST') {
    return fetch(sidecar.endpoint, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
  }
  it('authenticates health without revealing credentials or private state', async () => {
    const response = await rpc(envelope('health', sidecar.generation))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({ version: 1, ok: true })
    expect(text).not.toContain(sidecar.authentication)
    expect(text).not.toContain(sidecar.stateDirectory)
  })
  it('maps legacy semantic errors without exposing provider detail', async () => {
    const response = await rpc({ ...envelope('sendControlMessage', sidecar.generation), params: { text: 'logged-out' } })
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ ok: false, error: { code: 'CHATGPT_LOGGED_OUT' } })
    expect(body).not.toContain('private provider detail')
  })
  it('retains the old provider cancellation mapping without exposing provider text', async () => {
    const response = await rpc({ ...envelope('sendControlMessage', sidecar.generation), params: { text: 'legacy-cancelled' } })
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } })
    expect(body).not.toContain('private provider detail')
    expect(body).not.toContain('D2C_CANCELLED')
  })
  it('bounds semantic reply bodies returned by the driver', async () => {
    expect((await rpc({ ...envelope('sendControlMessage', sidecar.generation), params: { text: 'large-reply' } })).status).toBe(200)
    const response = await rpc({ ...envelope('waitForReply', sidecar.generation), params: { timeoutMs: 100 } })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'SIDECAR_RESPONSE_TOO_LARGE' } })
  })
  it('rejects browser-origin requests without permissive CORS', async () => {
    const response = await fetch(sidecar.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + sidecar.authentication, 'content-type': 'application/json', origin: 'https://example.com' }, body: JSON.stringify(envelope('health', sidecar.generation)) })
    expect(response.status).toBe(400)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
  it.each(['', 'wrong-token'])('rejects invalid authentication before invoking driver (%s)', async token => {
    const response = await rpc({ ...envelope('sendControlMessage', sidecar.generation), params: { text: 'must not send' } }, token)
    expect(response.status).toBe(401)
    expect(sidecar.sends).toEqual([])
    expect(await response.text()).not.toContain(sidecar.authentication)
  })
  it.each(['evaluate', 'browser_js', 'cdp', 'shell', 'git', 'filesystem', 'navigate', 'MCP'])('rejects forbidden RPC method %s', async method => {
    const response = await rpc(envelope(method, sidecar.generation))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'SIDECAR_INVALID_REQUEST' } })
    expect(sidecar.sends).toEqual([])
  })
  it.each([0, 2, null])('rejects unsupported version %s without downgrade', async version => {
    const response = await rpc({ ...envelope('health', sidecar.generation), version })
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'SIDECAR_VERSION_UNSUPPORTED' } })
  })
  it('rejects unknown fields and malformed JSON', async () => {
    expect((await rpc({ ...envelope('health', sidecar.generation), script: 'arbitrary JS' })).status).toBe(400)
    expect((await rpc('{')).status).toBe(400)
    expect(sidecar.sends).toEqual([])
  })
  it('enforces the UTF-8 request bound and HTTP method allowlist', async () => {
    expect((await rpc('x'.repeat(65_537))).status).toBe(413)
    expect((await rpc(undefined, sidecar.authentication, 'GET')).status).toBe(405)
    expect(sidecar.sends).toEqual([])
  })
  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const response = await rpc({ ...envelope('sendControlMessage', sidecar.generation), params: { text: '界'.repeat(22_000) } })
    expect(response.status).toBe(413)
    expect(sidecar.sends).toEqual([])
  })
  it('bounds chunked request bodies without trusting Content-Length', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(40_000))); controller.enqueue(new TextEncoder().encode('x'.repeat(40_000))); controller.close() } })
    const response = await fetch(sidecar.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + sidecar.authentication, 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit & { duplex: string })
    expect(response.status).toBe(413)
    expect(sidecar.sends).toEqual([])
  })
  it('rejects stale process generations before side effects', async () => {
    const response = await rpc({ ...envelope('sendControlMessage', 'old-generation'), params: { text: 'must not send' } })
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'SIDECAR_GENERATION_CHANGED' } })
    expect(sidecar.sends).toEqual([])
  })
})
