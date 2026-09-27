import { describe, expect, it } from 'vitest'
import { BrowserStaleError, ChatGptAppUnavailableError, ChatGptLoggedOutError } from '../src/browser/adapter.ts'
import { runDoctor } from '../src/readiness/doctor.ts'

describe('doctor browser failure classification', () => {
  it.each([
    [new BrowserStaleError('private detail'), 'BROWSER_HARNESS_UNAVAILABLE'],
    [new ChatGptAppUnavailableError('DSH with ChatGPT'), 'CHATGPT_APP_UNAVAILABLE'],
    [new ChatGptLoggedOutError(), 'CHATGPT_LOGGED_OUT'],
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
})
