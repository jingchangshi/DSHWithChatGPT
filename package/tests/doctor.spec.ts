import { localGitExecutor } from './local-git.ts'
import { describe, expect, it } from 'vitest'
import { runDoctor } from '../src/readiness/doctor.ts'
import { OperationCancelledError } from '../src/cancellation.ts'
import { startBridgeServer } from '../src/bridge/server.ts'
import { loadWorkspaceSpec, workspaceInfoTool } from '../src/bridge/tools.ts'
import { ExecutionRecorder } from '../src/execution/recorder.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { workspaceIdentity } from '../src/workspace/identity.ts'

describe('chatgpt_doctor', () => {
  it.each([
    [false, 'RUNTIME_LEASE_UNAVAILABLE', 'RUNTIME_LEASE_UNAVAILABLE'],
    [false, 'PRIVATE_PROVIDER_DETAIL', 'WORKSPACE_CAPABILITY_UNAVAILABLE'],
    [true, undefined, undefined],
  ] as const)('checks data-plane availability independently of matching identity (%s)', async (available, reason, expectedCode) => {
    const capability = available ? { available: true } : { available: false, reason }
    const token = 'doctor-runtime-token'
    const server = await startBridgeServer({ port: 0, tokens: new Map([[token, 'workspace']]) }, [{
      name: 'workspace_info', description: 'test metadata', inputSchema: { type: 'object' },
      async handler() { return { workspaceId: 'opaque-id', capabilities: {
        leaseBound: available, workspaceContentRead: capability, gitRead: capability, executionOutput: capability,
      } } },
    }])
    try {
      const result = await runDoctor({
        workspaceRoot: '/remote/workspace', workspaceId: 'opaque-id', appName: 'DSH with ChatGPT',
        browser: { readiness: async () => ({ url: 'https://chatgpt.com/c/test', composer: true, loggedOut: false }) },
        bridgeHttp: { port: server.port, token }, probeApp: async () => undefined,
        runtime: { bridge: { workspaceId: 'opaque-id' }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'ready' } },
      })
      expect(result.checks.find(check => check.id === 'bridge')?.ok).toBe(true)
      expect(result.ready).toBe(available)
      for (const id of ['workspace_content_read', 'workspace_git_read', 'execution_output_access']) {
        expect(result.checks.find(check => check.id === id)?.ok).toBe(available)
        expect(result.checks.find(check => check.id === id)?.code).toBe(expectedCode)
      }
      expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
      expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_DETAIL')
      expect(result.checks.find(check => check.id === 'remote_workspace_access')?.ok).toBe(false)
    } finally { await server.close() }
  })

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
  it('proves local readiness through the authenticated ephemeral bridge', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-doctor-'))
    const recorder = new ExecutionRecorder({ stateDir: path.join(root, 'records') })
    const spec = loadWorkspaceSpec(root, recorder, localGitExecutor(root))
    const token = 'doctor-test-token'
    const server = await startBridgeServer({ port: 0, tokens: new Map([[token, 'workspace']]) }, [workspaceInfoTool(spec)])
    try {
      const result = await runDoctor({
        workspaceRoot: root,
        workspaceId: workspaceIdentity(root),
        appName: 'DSH with ChatGPT',
        browser: { readiness: async () => ({ url: 'https://chatgpt.com/c/test', composer: true, loggedOut: false }) },
        bridgeHttp: { port: server.port, token },
        probeApp: async () => undefined,
        runtime: { bridge: { workspaceId: workspaceIdentity(root) }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'ready' } },
      })
      expect(result.checks.find(check => check.id === 'bridge')).toMatchObject({ ok: true })
      expect(result.ready).toBe(false)
      expect(result.checks.find(check => check.id === 'workspace_content_read')).toMatchObject({ ok: false, code: 'WORKSPACE_CAPABILITY_UNAVAILABLE' })
      expect(result.checks.find(check => check.id === 'remote_workspace_access')).toMatchObject({ ok: false, code: 'REMOTE_ACCESS_REQUIRES_E2E' })
      expect(JSON.stringify(result)).not.toContain(token)
    } finally {
      await server.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
