import { describe, expect, it } from 'vitest'
import { runDoctor } from '../src/readiness/doctor.ts'

describe('chatgpt_doctor', () => {
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
