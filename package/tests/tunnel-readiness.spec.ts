import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TunnelSupervisor, buildTunnelLaunchPreview } from '../src/tunnel/supervisor.ts'

const childState = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: childState.spawn }))

const healthy = () => ({ schema_version: 1, live: true, ready: true, components: {
  'control-plane': { status: 'ok', state: 'polling', details: { last_success: new Date().toISOString(), consecutive_failures: 0 } },
  mcp: { details: { startup_probe: { state: 'succeeded' } } },
} })

function fakeChild(pid = 123) {
  const child = Object.assign(new EventEmitter(), { pid, exitCode: null as number | null, signalCode: null as string | null,
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => { child.signalCode = 'SIGTERM'; child.emit('exit'); return true }) })
  return child
}

describe('managed exposure readiness against real tunnel health semantics', () => {
  const directories: string[] = []
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

  function fixture(snapshot: unknown, startupTimeoutMs = 10) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plannerbridge-tunnel-health-'))
    directories.push(dir)
    vi.stubEnv('PLANNERBRIDGE_TEST_RUNTIME_KEY', 'private-fixture-key')
    const child = fakeChild()
    childState.spawn.mockImplementation((_command, args: string[]) => {
      fs.writeFileSync(args[args.indexOf('--health.url-file') + 1]!, 'http://127.0.0.1:9999')
      return child
    })
    let current = snapshot
    const fetchMock = vi.fn(async (url: string) => new Response(url.endsWith('/readyz') ? 'ready' : JSON.stringify(current)))
    vi.stubGlobal('fetch', fetchMock)
    const options = { mode: 'managed' as const, clientPath: 'fixture', configuredTunnelId: 'fixture-id', tunnelIdEnv: 'PLANNERBRIDGE_TEST_TUNNEL_ID', runtimeApiKeyEnv: 'PLANNERBRIDGE_TEST_RUNTIME_KEY', startupTimeoutMs, stateDir: dir }
    const supervisor = new TunnelSupervisor(options)
    const binding = { workspaceId: 'workspace', localUrl: 'http://127.0.0.1:1/mcp', bearerValueFile: path.join(dir, 'bearer') }
    return { supervisor, options, binding, child, fetchMock, dir, setSnapshot: (value: unknown) => { current = value } }
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

  it('launches the previewed scoped proxy reference and short initial poll with private local-hop headers', async () => {
    vi.stubEnv('CONTROL_PLANE_HTTP_PROXY', 'http://operator:private-proxy-password@127.0.0.1:7893')
    const f = fixture(healthy())
    try {
      expect((await f.supervisor.ensure(f.binding)).ready).toBe(true)
      const [command, args, { env }] = childState.spawn.mock.calls[0]!
      const preview = buildTunnelLaunchPreview(f.options, f.binding)
      expect(command).toBe(preview.clientPath)
      expect(args).toEqual(preview.args)
      expect(args).toContain('--control-plane.initial-poll-timeout')
      expect(args).toContain('--control-plane.http-proxy')
      expect(args).toContain('env:CONTROL_PLANE_HTTP_PROXY')
      expect(args.join(' ')).not.toMatch(/private-proxy-password|private-fixture-key|Authorization/)
      expect(env.CONTROL_PLANE_HTTP_PROXY).toBe(process.env.CONTROL_PLANE_HTTP_PROXY)
      expect(env.MCP_EXTRA_HEADERS).toBe('Authorization: file:' + f.binding.bearerValueFile)
      expect(env.MCP_DISCOVERY_EXTRA_HEADERS).toBe(env.MCP_EXTRA_HEADERS)
    } finally { await f.supervisor.close() }
  })

  it('retains a network category and poll timing facts without copying raw control-plane errors', async () => {
    const data = healthy()
    data.components['control-plane'].status = 'degraded'
    data.components['control-plane'].details.consecutive_failures = 1
    Object.assign(data.components['control-plane'].details, { failure_category: 'network_error',
      configured_wait_seconds: 30, effective_wait_seconds: 30, deadline_seconds: 35,
      error: 'private-fixture-key http://private-host.invalid' })
    const f = fixture(data)
    await expect(f.supervisor.ensure(f.binding)).rejects.toThrow('TUNNEL_START_TIMEOUT: TUNNEL_CONTROL_PLANE_UNAVAILABLE')
    const text = fs.readFileSync(path.join(f.dir, 'tunnel', 'workspace.failure.json'), 'utf8')
    expect(JSON.parse(text).lastParsedHealth).toMatchObject({ controlNetworkError: true,
      configuredPollWaitSeconds: 30, effectivePollWaitSeconds: 30, pollDeadlineSeconds: 35 })
    expect(text).not.toMatch(/private-fixture-key|private-host/)
  })

  it('closes the old child and applies a changed explicit proxy on rebind', async () => {
    vi.stubEnv('CONTROL_PLANE_HTTP_PROXY', '')
    const f = fixture(healthy())
    const next = fakeChild(124)
    try {
      expect((await f.supervisor.ensure(f.binding)).pid).toBe(123)
      expect(childState.spawn.mock.calls[0]![1]).not.toContain('--control-plane.http-proxy')
      vi.stubEnv('CONTROL_PLANE_HTTP_PROXY', 'http://127.0.0.1:7893')
      childState.spawn.mockImplementation((_command, args: string[]) => {
        expect(f.child.kill).toHaveBeenCalledOnce()
        fs.writeFileSync(args[args.indexOf('--health.url-file') + 1]!, 'http://127.0.0.1:9999')
        return next
      })
      expect((await f.supervisor.ensure(f.binding)).pid).toBe(124)
      expect(childState.spawn).toHaveBeenCalledTimes(2)
      expect(childState.spawn.mock.calls[1]![1]).toContain('env:CONTROL_PLANE_HTTP_PROXY')
      expect((await f.supervisor.ensure(f.binding)).pid).toBe(124)
      expect(childState.spawn).toHaveBeenCalledTimes(2)
    } finally { await f.supervisor.close() }
    expect(next.kill).toHaveBeenCalledOnce()
  })

  it('rejects unknown categories and unbounded poll timing without copying their values', async () => {
    const data = healthy()
    data.components['control-plane'].status = 'degraded'
    Object.assign(data.components['control-plane'].details, { failure_category: 'private-category',
      configured_wait_seconds: 'private-duration', effective_wait_seconds: -1, deadline_seconds: 86401 })
    const f = fixture(data)
    await expect(f.supervisor.ensure(f.binding)).rejects.toThrow('TUNNEL_START_TIMEOUT')
    const text = fs.readFileSync(path.join(f.dir, 'tunnel', 'workspace.failure.json'), 'utf8')
    expect(JSON.parse(text).lastParsedHealth).toMatchObject({ controlNetworkError: false,
      configuredPollWaitSeconds: null, effectivePollWaitSeconds: null, pollDeadlineSeconds: null })
    expect(text).not.toMatch(/private-category|private-duration/)
  })

  it('redacts runtime keys and proxy credentials from early-exit errors as well as failure files', async () => {
    vi.stubEnv('CONTROL_PLANE_HTTP_PROXY', 'http://operator:private-proxy-password@127.0.0.1:7893')
    const f = fixture(undefined, 1000)
    const spawn = childState.spawn.getMockImplementation()!
    childState.spawn.mockImplementation((...args) => {
      const child = spawn(...args)
      queueMicrotask(() => {
        child.stderr.emit('data', 'private-fixture-key ' + process.env.CONTROL_PLANE_HTTP_PROXY + ' http://other:other-password@proxy.invalid')
        child.exitCode = 1
      })
      return child
    })
    const error = await f.supervisor.ensure(f.binding).catch(error => error as Error)
    expect(error.message).toContain('TUNNEL_START_FAILED: [REDACTED]')
    expect(error.message).not.toMatch(/private-fixture-key|private-proxy-password|other-password/)
    expect(fs.readFileSync(path.join(f.dir, 'tunnel', 'workspace.failure.json'), 'utf8')).not.toMatch(/private-fixture-key|private-proxy-password|other-password/)
  })

  it('captures only bounded predicate facts before a failed tunnel is stopped', async () => {
    const data = healthy()
    data.components['control-plane'].details.consecutive_failures = 2
    Object.assign(data.components['control-plane'].details, { http_status: 503, api_key: 'private-fixture-key', diagnostic: 'Bearer private-raw-body' })
    const f = fixture(data)
    const file = path.join(f.dir, 'tunnel', 'workspace.failure.json')
    const kill = f.child.kill.getMockImplementation()!
    f.child.kill.mockImplementation(() => { expect(fs.existsSync(file)).toBe(true); return kill() })
    await expect(f.supervisor.ensure(f.binding)).rejects.toThrow('TUNNEL_START_TIMEOUT: TUNNEL_CONTROL_PLANE_UNAVAILABLE')
    const text = fs.readFileSync(file, 'utf8')
    expect(JSON.parse(text)).toMatchObject({ version: 1, failure: 'TUNNEL_START_TIMEOUT', classification: 'TUNNEL_CONTROL_PLANE_UNAVAILABLE', lastParsedHealth: {
      schemaSupported: true, controlStatusOk: true, consecutiveFailures: 2, lastSuccessValid: true, httpStatus: 503, localProbeSucceeded: true,
    } })
    expect(text).not.toMatch(/private-fixture-key|private-raw-body|http:\/\/|Bearer/)
    expect((await f.supervisor.status()).ready).toBe(false)
  })

  it.each(['spawn-error', 'early-exit'])('retains a safe startup diagnostic and removes the health pointer after %s', async scenario => {
    const f = fixture(healthy(), 1000)
    const spawn = childState.spawn.getMockImplementation()!
    childState.spawn.mockImplementation((...args) => {
      const child = spawn(...args)
      if (scenario === 'early-exit') child.exitCode = 1
      else {
        fs.unlinkSync(args[1][args[1].indexOf('--health.url-file') + 1])
        queueMicrotask(() => child.emit('error', new Error('private-fixture-key')))
      }
      return child
    })
    await expect(f.supervisor.ensure(f.binding)).rejects.toThrow('TUNNEL_START_FAILED')
    const text = fs.readFileSync(path.join(f.dir, 'tunnel', 'workspace.failure.json'), 'utf8')
    expect(JSON.parse(text).failure).toBe('TUNNEL_START_FAILED')
    expect(text).not.toContain('private-fixture-key')
    expect(fs.existsSync(path.join(f.dir, 'tunnel', 'workspace.health-url'))).toBe(false)
    expect((await f.supervisor.status()).ready).toBe(false)
  })
})
