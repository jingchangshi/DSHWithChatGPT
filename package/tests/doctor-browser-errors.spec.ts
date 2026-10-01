import { describe, expect, it } from 'vitest'
import { BrowserStaleError, ChatGptAppUnavailableError, ChatGptLoggedOutError } from '../src/browser/adapter.ts'
import { runDoctor } from '../src/readiness/doctor.ts'
import { SidecarRpcError } from '../src/sidecar/errors.ts'
import { OperationCancelledError } from '../src/cancellation.ts'

describe('doctor browser failure classification', () => {
  it('propagates a neutral provider cancellation instead of returning a readiness report', async () => {
    await expect(runDoctor({
      workspaceRoot: '/execution/world', workspaceId: 'world', appName: 'Product App',
      browser: { readiness: async () => ({ url: 'https://chatgpt.com/', composer: true, loggedOut: false }) },
      probeApp: async () => { throw new SidecarRpcError('OPERATION_CANCELLED') }, bridgeHttp: { port: 1, token: 'test' },
      runtime: { bridge: { workspaceId: 'world' }, tunnel: { mode: 'external', configured: true, ready: true, detail: 'fixture' } },
    })).rejects.toBeInstanceOf(OperationCancelledError)
  })
  it.each([
    [new BrowserStaleError('private detail'), 'BROWSER_HARNESS_UNAVAILABLE'],
    [new ChatGptAppUnavailableError('DSH with ChatGPT'), 'CHATGPT_APP_UNAVAILABLE'],
    [new ChatGptLoggedOutError(), 'CHATGPT_LOGGED_OUT'],
    [new SidecarRpcError('CHATGPT_LOGGED_OUT'), 'CHATGPT_LOGGED_OUT'],
    [new SidecarRpcError('CHATGPT_APP_UNAVAILABLE'), 'CHATGPT_APP_UNAVAILABLE'],
    [new SidecarRpcError('SIDECAR_TIMEOUT'), 'SIDECAR_TIMEOUT'],
    [new SidecarRpcError('CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE'), 'CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE'],
    [new SidecarRpcError('SEND_UNCERTAIN'), 'SEND_UNCERTAIN'],
    [Object.assign(new Error('private detail'), { code: 'PRIVATE_PROVIDER_CODE' }), 'CHAT_CONTROL_UNAVAILABLE'],
  ] as const)('classifies %s without exposing provider details', async (error, code) => {
    const result = await runDoctor({
      workspaceRoot: 'C:/workspace/demo', workspaceId: 'workspace-demo', appName: 'DSH with ChatGPT',
      browser: { readiness: async () => ({ url: 'https://chatgpt.com/', composer: true, loggedOut: false }) },
      bridgeHttp: { port: 1, token: 'test' },
      probeApp: async () => { throw error },
      runtime: { bridge: { workspaceId: 'workspace-demo' }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'ready' } },
    })
    expect(result.checks.find(check => check.id === 'chatgpt_app')).toMatchObject({ ok: false, code })
    expect(JSON.stringify(result)).not.toContain('private detail')
  })
  it('preserves a typed semantic session failure without claiming a Harness failure', async () => {
    const result = await runDoctor({
      workspaceRoot: '/execution/world', workspaceId: 'world', appName: 'Product App',
      browser: { readiness: async () => { throw new SidecarRpcError('SIDECAR_UNAVAILABLE') } },
      probeApp: async () => {}, bridgeHttp: { port: 1, token: 'test' },
      runtime: { bridge: { workspaceId: 'world' }, tunnel: { mode: 'external', configured: true, ready: true, detail: 'fixture' } },
    })
    expect(result.checks.find(check => check.id === 'chatgpt_session')).toMatchObject({ ok: false, code: 'SIDECAR_UNAVAILABLE' })
    expect(result.localReady).toBe(false)
  })
})
