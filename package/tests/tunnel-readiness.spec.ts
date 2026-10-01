import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'

const childState = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: childState.spawn }))

const healthy = () => ({ schema_version: 1, live: true, ready: true, components: {
  'control-plane': { status: 'ok', state: 'polling', details: { last_success: new Date().toISOString(), consecutive_failures: 0 } },
  mcp: { details: { startup_probe: { state: 'succeeded' } } },
} })

describe('managed exposure readiness against real tunnel health semantics', () => {
  const directories: string[] = []
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

  function fixture(snapshot: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plannerbridge-tunnel-health-'))
    directories.push(dir)
    vi.stubEnv('PLANNERBRIDGE_TEST_RUNTIME_KEY', 'private-fixture-key')
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null as number | null, signalCode: null as string | null, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => { child.signalCode = 'SIGTERM'; child.emit('exit'); return true }) })
    childState.spawn.mockImplementation((_command, args: string[]) => {
      fs.writeFileSync(args[args.indexOf('--health.url-file') + 1]!, 'http://127.0.0.1:9999')
      return child
    })
    let current = snapshot
    const fetchMock = vi.fn(async (url: string) => new Response(url.endsWith('/readyz') ? 'ready' : JSON.stringify(current)))
    vi.stubGlobal('fetch', fetchMock)
    const supervisor = new TunnelSupervisor({ mode: 'managed', clientPath: 'fixture', configuredTunnelId: 'fixture-id', tunnelIdEnv: 'PLANNERBRIDGE_TEST_TUNNEL_ID', runtimeApiKeyEnv: 'PLANNERBRIDGE_TEST_RUNTIME_KEY', startupTimeoutMs: 10, stateDir: dir })
    const binding = { workspaceId: 'workspace', localUrl: 'http://127.0.0.1:1/mcp', bearerValueFile: path.join(dir, 'bearer') }
    return { supervisor, binding, child, fetchMock, setSnapshot: (value: unknown) => { current = value } }
  }

  it('rejects remote authentication failure despite readyz=200 and closes its child', async () => {
    const data = healthy()
    data.components['control-plane'] = { status: 'degraded', state: 'backoff', details: { last_success: '', consecutive_failures: 8, http_status: 401 } } as typeof data.components['control-plane']
    const f = fixture(data)
    await expect(f.supervisor.ensure(f.binding)).rejects.toThrow('TUNNEL_AUTH_FAILED')
    expect(f.child.kill).toHaveBeenCalledOnce()
    expect((await f.supervisor.status()).ready).toBe(false)
  })

  it.each([undefined, null, { schema_version: 1, live: true, ready: true, components: {} }, { ...healthy(), schema_version: 2 }, { ...healthy(), padding: 'x'.repeat(65537) }])('never accepts incomplete, unsupported or oversized remote health', async data => {
    const f = fixture(data)
    await expect(f.supervisor.ensure(f.binding)).rejects.toThrow('TUNNEL_START_TIMEOUT')
    expect(f.child.kill).toHaveBeenCalledOnce()
  })

  it('accepts successful authenticated polling and detects later degradation without restarting', async () => {
    const f = fixture(healthy())
    try {
      expect((await f.supervisor.ensure(f.binding)).ready).toBe(true)
      expect(f.fetchMock.mock.calls.some(([url]) => url.endsWith('/health?details=true'))).toBe(true)
      const data = healthy()
      data.components['control-plane'].status = 'degraded'
      data.components['control-plane'].details.consecutive_failures = 1
      f.setSnapshot(data)
      expect(await f.supervisor.status()).toMatchObject({ ready: false, detail: 'TUNNEL_CONTROL_PLANE_UNAVAILABLE' })
      expect(childState.spawn).toHaveBeenCalledOnce()
    } finally { await f.supervisor.close() }
  })

  it('requires successful local MCP probing as well as authenticated polling', async () => {
    const data = healthy()
    data.components.mcp.details.startup_probe.state = 'failed'
    const f = fixture(data)
    await expect(f.supervisor.ensure(f.binding)).rejects.toThrow('TUNNEL_START_TIMEOUT')
    expect(f.child.kill).toHaveBeenCalledOnce()
  })
})
