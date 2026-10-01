import { describe, expect, it } from 'vitest'

const request = () => ({ version: 1, requestId: 'transport-attempt-1', operationId: 'logical-operation-1', generation: 'sidecar-generation-1', method: 'health', params: {} })
describe('strict semantic RPC protocol', () => {
  it('allows only bounded diagnostic arguments and no primitive passthrough', async () => {
    const { parseSidecarRequest } = await import('../src/sidecar/protocol.ts')
    expect(parseSidecarRequest({ ...request(), method: 'readiness', params: {} })).toMatchObject({ method: 'readiness' })
    expect(parseSidecarRequest({ ...request(), method: 'probeApp', params: { appName: 'Product App' } })).toMatchObject({ method: 'probeApp' })
    for (const params of [{ expression: 'JS' }, { url: 'https://example.com' }, { cdp: 'Input.dispatchKeyEvent' }]) {
      expect(() => parseSidecarRequest({ ...request(), method: 'readiness', params })).toThrow()
      expect(() => parseSidecarRequest({ ...request(), method: 'probeApp', params: { appName: 'Product App', ...params } })).toThrow()
    }
    for (const appName of ['', 'x'.repeat(257)]) expect(() => parseSidecarRequest({ ...request(), method: 'probeApp', params: { appName } })).toThrow()
  })
  it('retains transport and operation identities as distinct fields', async () => {
    const { parseSidecarRequest } = await import('../src/sidecar/protocol.ts')
    expect(parseSidecarRequest(request())).toMatchObject({ requestId: 'transport-attempt-1', operationId: 'logical-operation-1' })
  })
  it.each(['evaluate', 'cdp', 'shell', 'filesystem', 'git', 'navigate'])('rejects unrestricted method %s', async method => {
    const { parseSidecarRequest } = await import('../src/sidecar/protocol.ts')
    expect(() => parseSidecarRequest({ ...request(), method })).toThrow()
  })
  it('rejects unknown envelope and parameter fields', async () => {
    const { parseSidecarRequest } = await import('../src/sidecar/protocol.ts')
    expect(() => parseSidecarRequest({ ...request(), arbitraryScript: 'JS' })).toThrow()
    expect(() => parseSidecarRequest({ ...request(), params: { arbitraryScript: 'JS' } })).toThrow()
  })
  it.each([undefined, 0, 2, '1'])('has no implicit version downgrade (%s)', async version => {
    const { parseSidecarRequest } = await import('../src/sidecar/protocol.ts')
    expect(() => parseSidecarRequest({ ...request(), version })).toThrow(expect.objectContaining({ code: 'SIDECAR_VERSION_UNSUPPORTED' }))
  })
  it('bounds wait duration independently from ordinary transport attempts', async () => {
    const { parseSidecarRequest } = await import('../src/sidecar/protocol.ts')
    expect(parseSidecarRequest({ ...request(), method: 'waitForReply', params: { timeoutMs: 120_000 } })).toMatchObject({ params: { timeoutMs: 120_000 } })
    for (const timeoutMs of [-1, 0, Infinity, 600_001]) expect(() => parseSidecarRequest({ ...request(), method: 'waitForReply', params: { timeoutMs } })).toThrow()
  })
  it('accepts literal loopback only and rejects URL credential/query channels', async () => {
    const { validateSidecarEndpoint } = await import('../src/sidecar/protocol.ts')
    expect(validateSidecarEndpoint('http://127.0.0.1:18765')).toBe('http://127.0.0.1:18765/')
    for (const endpoint of ['http://2130706433:18765', 'http://localhost:18765', 'http://0.0.0.0:18765', 'http://127.0.0.1:65536', 'http://127.0.0.1:18765/?auth=secret', 'http://user:secret@127.0.0.1:18765']) expect(() => validateSidecarEndpoint(endpoint)).toThrow()
  })
})
