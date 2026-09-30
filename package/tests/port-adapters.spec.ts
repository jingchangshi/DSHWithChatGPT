import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as reads from '@deepseek-ai/dsh-execution-world/read-lease'
import * as git from '@deepseek-ai/dsh-execution-world/git-lease'
import { DshExecutionWorkspaceAdapter } from '../src/adapters/dsh/execution-workspace.ts'
import { OpenAiSecureTunnelAdapter } from '../src/adapters/mcp-exposure/openai-secure-tunnel.ts'
import { WorkspaceRuntimeRegistry } from '../src/workspace/runtime.ts'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'
import type { WorkspaceAuthority } from '../src/core/ports/execution-workspace.ts'

vi.mock('@deepseek-ai/dsh-execution-world/read-lease', { spy: true })
vi.mock('@deepseek-ai/dsh-execution-world/git-lease', { spy: true })
afterEach(() => vi.restoreAllMocks())

describe('production workspace port delegates authority to producer leases', () => {
  it.each([true, false])('gates Git requirements and revokes escaped handles (git=%s)', async allowed => {
    const context = new Context()
    const registry = new WorkspaceRuntimeRegistry()
    const disposeRead = vi.fn(async () => {})
    const disposeGit = vi.fn(async () => {})
    const read = vi.mocked(reads.bindExecutionReadLease).mockResolvedValue({ workspaceId: 'world' as reads.ExecutionReadLease['workspaceId'], fs: { stat: async () => undefined, readText: async () => '', listDir: async () => [] }, dispose: disposeRead })
    const acquireGit = vi.mocked(git.bindExecutionGitLease).mockResolvedValue({ workspaceId: 'world' as git.ExecutionGitLease['workspaceId'], assurance: 'full', git: { workspaceId: 'world' as git.ExecutionGitLease['workspaceId'], emptyFile: 'NUL', signal: new AbortController().signal, execute: vi.fn() }, dispose: disposeGit })
    read.mockClear(); acquireGit.mockClear()
    const resolve = vi.fn(async () => ({ workspaceId: 'world', displayRoot: 'opaque-display' }))
    const adapter = new DshExecutionWorkspaceAdapter({ context, registry, resolve, gitReadPolicy: allowed ? 'require-full' : 'disabled' })
    let escaped: WorkspaceAuthority | undefined
    const operation = vi.fn(async (authority: WorkspaceAuthority) => {
      escaped = authority
      authority.require('workspaceContentRead')
      expect(authority.has('gitRead')).toBe(true)
      return 'settled'
    })
    const locator = Symbol('execution locator')
    const pending = adapter.withOperation({ locator, capabilities: ['gitRead'] }, operation)
    if (allowed) {
      await expect(pending).resolves.toBe('settled')
      expect(acquireGit).toHaveBeenCalledWith(context, 'opaque-display', expect.any(AbortSignal), 'require-full')
      expect(escaped!.signal.aborted).toBe(true)
      expect(escaped!.has('workspaceContentRead')).toBe(false)
      expect(() => escaped!.require('gitRead')).toThrow('RUNTIME_LEASE_UNAVAILABLE')
      expect(disposeGit).toHaveBeenCalledOnce()
    } else {
      await expect(pending).rejects.toThrow('GIT_READ_DISABLED')
      expect(operation).not.toHaveBeenCalled()
      expect(acquireGit).not.toHaveBeenCalled()
    }
    expect(resolve).toHaveBeenCalledWith(locator, undefined)
    expect(read).toHaveBeenCalledWith(context, 'opaque-display', expect.any(AbortSignal))
    expect(disposeRead).toHaveBeenCalledOnce()
    expect(registry.capabilities('world').leaseBound).toBe(false)
    await context.fiber.dispose()
  })
})

describe('network-only exposure adapter', () => {
  it('preserves same-operation legacy diagnostics without exposing them through the neutral result', async () => {
    const legacy = { mode: 'external' as const, configured: true, ready: true, detail: 'ready' }
    const ensure = vi.spyOn(TunnelSupervisor.prototype, 'ensure').mockResolvedValue(legacy)
    const status = vi.spyOn(TunnelSupervisor.prototype, 'status')
    const adapter = new OpenAiSecureTunnelAdapter({ mode: 'external', clientPath: 'unused', tunnelIdEnv: 'UNUSED', runtimeApiKeyEnv: 'UNUSED', startupTimeoutMs: 1000, stateDir: 'unused' })
    const binding = { workspaceId: 'world', loopbackEndpoint: 'http://127.0.0.1:1234/mcp', authorizationReference: 'opaque-bearer-file' }
    const result = await adapter.ensure(binding)
    expect(result).toEqual({ ready: true, detail: 'ready' })
    expect(adapter.compatibilityStatus(result)).toBe(legacy)
    expect(status).not.toHaveBeenCalled()
    expect(ensure).toHaveBeenCalledWith({ workspaceId: 'world', localUrl: binding.loopbackEndpoint, bearerValueFile: binding.authorizationReference }, undefined)
    expect(() => adapter.compatibilityStatus({ ready: true })).toThrow('EXPOSURE_STATUS_NOT_OWNED')
  })
  it.each(['https://remote.example/mcp', 'http://127.0.0.1:1234/other', 'http://user:password@127.0.0.1:1234/mcp'])('rejects an unbound endpoint %s before invoking transport', async endpoint => {
    const ensure = vi.spyOn(TunnelSupervisor.prototype, 'ensure')
    const adapter = new OpenAiSecureTunnelAdapter({ mode: 'external', clientPath: 'unused', tunnelIdEnv: 'UNUSED', runtimeApiKeyEnv: 'UNUSED', startupTimeoutMs: 1000, stateDir: 'unused' })
    await expect(adapter.ensure({ workspaceId: 'world', loopbackEndpoint: endpoint, authorizationReference: 'reference' })).rejects.toThrow('INVALID_LOOPBACK_MCP_ENDPOINT')
    expect(ensure).not.toHaveBeenCalled()
  })
})
