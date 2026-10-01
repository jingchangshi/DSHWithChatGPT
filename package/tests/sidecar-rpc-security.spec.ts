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
  it('rejects stale process generations before side effects', async () => {
    const response = await rpc({ ...envelope('sendControlMessage', 'old-generation'), params: { text: 'must not send' } })
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'SIDECAR_GENERATION_CHANGED' } })
    expect(sidecar.sends).toEqual([])
  })
})
