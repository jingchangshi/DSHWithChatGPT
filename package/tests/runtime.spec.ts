import { describe, expect, it } from 'vitest'
import { WorkspaceRuntimeRegistry, type WorkspaceRuntimeLease } from '../src/workspace/runtime.ts'

function runtime(workspaceId = 'world-a-root', generation = Symbol(), controller = new AbortController()): WorkspaceRuntimeLease {
  return {
    identity: { workspaceId, displayRoot: '/workspace/same-path' },
    generation,
    signal: controller.signal,
    capabilities: {
      workspaceContentRead: { available: true },
      gitRead: { available: true },
      executionOutput: { available: true },
    },
  }
}

describe('execution workspace runtime leases', () => {
  it('denies every content category without an active lease', () => {
    const registry = new WorkspaceRuntimeRegistry()
    for (const category of ['workspaceContentRead', 'gitRead', 'executionOutput'] as const) {
      expect(() => registry.require('missing', category)).toThrow('RUNTIME_LEASE_UNAVAILABLE')
    }
    expect(registry.capabilities('missing').leaseBound).toBe(false)
  })

  it('keeps identical textual paths in different worlds independent', () => {
    const registry = new WorkspaceRuntimeRegistry()
    const first = runtime()
    const second = runtime('world-b-root')
    const release = registry.acquire(first)
    registry.acquire(second)
    release()
    expect(() => registry.require(first.identity.workspaceId, 'gitRead')).toThrow()
    expect(registry.require(second.identity.workspaceId, 'gitRead').lease).toBe(second)
  })

  it('rejects a conflicting generation without replacing the current owner', () => {
    const registry = new WorkspaceRuntimeRegistry()
    const first = runtime()
    registry.acquire(first)
    expect(() => registry.acquire(runtime())).toThrow('RUNTIME_LEASE_CONFLICT')
    expect(registry.require(first.identity.workspaceId, 'gitRead').lease).toBe(first)
  })

  it('rejects concurrent owners even with an identical service generation', () => {
    const registry = new WorkspaceRuntimeRegistry()
    const lease = runtime()
    const releaseFirst = registry.acquire(lease)
    expect(() => registry.acquire(lease)).toThrow('RUNTIME_LEASE_CONFLICT')
    expect(registry.capabilities(lease.identity.workspaceId).leaseBound).toBe(true)
    releaseFirst()
    releaseFirst()
    expect(registry.capabilities(lease.identity.workspaceId).leaseBound).toBe(false)
  })

  it('does not let a stale release remove a replacement generation', () => {
    const registry = new WorkspaceRuntimeRegistry()
    const first = runtime()
    const release = registry.acquire(first)
    release()
    const replacement = runtime()
    registry.acquire(replacement)
    release()
    expect(registry.require(first.identity.workspaceId, 'gitRead').lease).toBe(replacement)
  })

  it('revokes cancellation immediately and refuses an already aborted lease', () => {
    const registry = new WorkspaceRuntimeRegistry()
    const controller = new AbortController()
    const lease = runtime('workspace', Symbol(), controller)
    registry.acquire(lease)
    controller.abort(new Error('execution ended'))
    expect(registry.capabilities('workspace').leaseBound).toBe(false)
    expect(() => registry.acquire(lease)).toThrow('execution ended')
  })

  it('denies Git and execution output when root-safe reads are unavailable', () => {
    const registry = new WorkspaceRuntimeRegistry()
    const lease = runtime()
    registry.acquire({ ...lease, capabilities: {
      ...lease.capabilities,
      workspaceContentRead: { available: false, reason: 'ROOT_SAFE_READ_UNAVAILABLE' },
    } })
    for (const category of ['workspaceContentRead', 'gitRead', 'executionOutput'] as const) {
      expect(() => registry.require(lease.identity.workspaceId, category)).toThrow('ROOT_SAFE_READ_UNAVAILABLE')
    }
  })

  it('enforces each content category independently under one owner', () => {
    const registry = new WorkspaceRuntimeRegistry()
    const lease = runtime()
    const release = registry.acquire({ ...lease, capabilities: {
      ...lease.capabilities,
      gitRead: { available: false, reason: 'SUBPROCESS_CAPABILITY_UNAVAILABLE' },
    } })
    expect(() => registry.require(lease.identity.workspaceId, 'gitRead')).toThrow('SUBPROCESS_CAPABILITY_UNAVAILABLE')
    expect(registry.require(lease.identity.workspaceId, 'workspaceContentRead').lease.generation).toBe(lease.generation)
    release()
    expect(() => registry.require(lease.identity.workspaceId, 'gitRead')).toThrow('RUNTIME_LEASE_UNAVAILABLE')
  })
})
