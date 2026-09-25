import { describe, expect, it } from 'vitest'
import { runDoctor } from '../src/readiness/doctor.ts'
import { OperationCancelledError } from '../src/cancellation.ts'

describe('chatgpt_doctor', () => {
  it('propagates cancellation instead of misreporting a failed readiness check', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runDoctor({
      workspaceRoot: 'C:/workspace/demo', workspaceId: 'workspace-demo', appName: 'DSH with ChatGPT',
      browser: {}, bridgeHttp: { port: 1, token: 'private-token' },
      runtime: { bridge: { workspaceId: 'workspace-demo' }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'ready' } },
      signal: controller.signal,
    })).rejects.toBeInstanceOf(OperationCancelledError)
  })

  it('does not put provider or bridge errors into model-visible diagnostics', async () => {
    const result = await runDoctor({
      workspaceRoot: 'C:/workspace/demo', workspaceId: 'workspace-demo', appName: 'DSH with ChatGPT',
      browser: { readiness: async () => { throw new Error('private-browser-cookie') } },
      bridgeHttp: { port: 1, token: 'private-bridge-token' },
      probeApp: async () => { throw new Error('private-app-secret') },
      runtime: { bridge: { workspaceId: 'workspace-demo' }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'ready' } },
    })
    expect(JSON.stringify(result)).not.toMatch(/private-browser-cookie|private-bridge-token|private-app-secret/)
    expect(result.checks.find(check => check.id === 'bridge')).toMatchObject({ code: 'BRIDGE_PROBE_FAILED' })
  })

  it('keeps remote ChatGPT access unverified while accepting local proofs', async () => {
    const result = await runDoctor({
      workspaceRoot: 'C:/workspace/demo',
      workspaceId: 'workspace-demo',
      appName: 'DSH with ChatGPT',
      browser: {
        readiness: async () => ({ url: 'https://chatgpt.com/c/demo', composer: true, loggedOut: false }),
      },
      bridgeHttp: { port: 1, token: 'test' },
      probeApp: async () => undefined,
      runtime: {
        bridge: { workspaceId: 'workspace-demo' },
        tunnel: { mode: 'managed', configured: true, ready: true, detail: 'ready' },
      },
    })
    expect(result.ready).toBe(false)
    expect(result.checks.find(check => check.id === 'remote_workspace_access')).toMatchObject({ ok: false, code: 'REMOTE_ACCESS_REQUIRES_E2E' })
    expect(result.checks.find(check => check.id === 'chatgpt_session')).toMatchObject({ ok: true })
    expect(result.checks.find(check => check.id === 'chatgpt_app')).toMatchObject({ ok: true })
  })
})
