import { afterEach, describe, expect, it, vi } from 'vitest'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'
import path from 'node:path'
import { buildTunnelLaunchPreview, type TunnelSupervisorOptions } from '../src/tunnel/index.ts'

describe('Secure MCP Tunnel launch contract', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('resolves auto and explicit ownership modes with the same credential policy as startup', () => {
    const options: TunnelSupervisorOptions = { mode: 'auto', clientPath: 'unused', tunnelIdEnv: 'EXPOSURE_TEST_TUNNEL_ID',
      runtimeApiKeyEnv: 'EXPOSURE_TEST_TUNNEL_KEY', startupTimeoutMs: 1, stateDir: 'unused' }
    vi.stubEnv('EXPOSURE_TEST_TUNNEL_ID', '')
    vi.stubEnv('EXPOSURE_TEST_TUNNEL_KEY', '')
    expect(new TunnelSupervisor(options).effectiveMode()).toBe('external')
    expect(new TunnelSupervisor({ ...options, mode: 'managed' }).effectiveMode()).toBe('managed')
    vi.stubEnv('EXPOSURE_TEST_TUNNEL_ID', 'fixture-id')
    vi.stubEnv('EXPOSURE_TEST_TUNNEL_KEY', 'fixture-key')
    expect(new TunnelSupervisor(options).effectiveMode()).toBe('managed')
    expect(new TunnelSupervisor({ ...options, mode: 'external' }).effectiveMode()).toBe('external')
  })
  it('keeps bearer material out of argv and injects it through local-hop env', () => {
    const options: TunnelSupervisorOptions = {
      mode: 'managed',
      clientPath: 'tunnel-client',
      configuredTunnelId: 'tun_test_123',
      tunnelIdEnv: 'CONTROL_PLANE_TUNNEL_ID',
      runtimeApiKeyEnv: 'CONTROL_PLANE_API_KEY',
      startupTimeoutMs: 20_000,
      stateDir: path.join('tmp', 'exposure-state'),
    }
    const binding = {
      workspaceId: 'ws_0123456789abcdef',
      localUrl: 'http://127.0.0.1:43127/mcp',
      bearerValueFile: path.join('tmp', 'exposure-state', 'connectors', 'secret.bearer'),
    }
    const preview = buildTunnelLaunchPreview(options, binding)
    const argv = preview.args.join(' ')

    expect(argv).toContain('--control-plane.tunnel-id tun_test_123')
    expect(argv).toContain('--mcp.server-url http://127.0.0.1:43127/mcp')
    expect(argv).not.toContain('Authorization')
    expect(argv).not.toContain('secret.bearer')
    expect(preview.envKeys).toContain('MCP_EXTRA_HEADERS')
    expect(preview.envKeys).toContain('MCP_DISCOVERY_EXTRA_HEADERS')
    expect(preview.envKeys).toContain('CONTROL_PLANE_API_KEY')
  })

  it('binds health state to the workspace identity', () => {
    const options: TunnelSupervisorOptions = {
      mode: 'managed',
      clientPath: 'tunnel-client',
      configuredTunnelId: 'tun_test_123',
      tunnelIdEnv: 'CONTROL_PLANE_TUNNEL_ID',
      runtimeApiKeyEnv: 'CONTROL_PLANE_API_KEY',
      startupTimeoutMs: 20_000,
      stateDir: path.join('tmp', 'exposure-state'),
    }
    const preview = buildTunnelLaunchPreview(options, {
      workspaceId: 'ws_fedcba9876543210',
      localUrl: 'http://127.0.0.1:54321/mcp',
      bearerValueFile: 'ignored-in-preview',
    })
    expect(preview.args.join(' ')).toContain('ws_fedcba9876543210.health-url')
  })
})
