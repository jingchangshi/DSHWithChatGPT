import { describe, expect, it, vi } from 'vitest'
import type { ExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease'
import type { ExecutionGitLease } from '@deepseek-ai/dsh-execution-world/git-lease'
import { WorkspaceRuntimeRegistry } from '../src/workspace/runtime.ts'
import { withWorkspaceReadLease } from '../src/workspace/with-read-lease.ts'

function fixture() {
  const registry = new WorkspaceRuntimeRegistry()
  const identity = { workspaceId: 'workspace', displayRoot: '/workspace' }
  const lease: ExecutionReadLease = {
    workspaceId: identity.workspaceId as ExecutionReadLease['workspaceId'],
    fs: { stat: vi.fn(async () => undefined), readText: vi.fn(async () => ''), listDir: vi.fn(async () => []) },
    dispose: vi.fn(async () => {}),
  }
  return { registry, identity, lease }
}

describe('workspace operation read lease', () => {
  it('does not settle until provider cleanup completes', async () => {
    const { registry, identity, lease } = fixture()
    const cleanup = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.mocked(lease.dispose).mockImplementation(async () => {
      entered.resolve()
      await cleanup.promise
    })
    let settled = false
    const result = withWorkspaceReadLease(registry, identity, async () => lease, async () => 'done')
      .finally(() => { settled = true })
    await entered.promise
    expect(settled).toBe(false)
    expect(registry.capabilities(identity.workspaceId).leaseBound).toBe(false)
    cleanup.resolve()
    await expect(result).resolves.toBe('done')
  })

  it('publishes file-only access during the operation and joins cleanup', async () => {
    const { registry, identity, lease } = fixture()
    let active: AbortSignal | undefined
    await expect(withWorkspaceReadLease(registry, identity, async () => lease, async signal => {
      active = signal
      expect(registry.require(identity.workspaceId, 'workspaceContentRead').lease.backend).toBeDefined()
      expect(() => registry.require(identity.workspaceId, 'gitRead')).toThrow('GIT_READ_UNAVAILABLE')
      return 'result'
    })).resolves.toBe('result')
    expect(active?.aborted).toBe(true)
    expect(registry.capabilities(identity.workspaceId).leaseBound).toBe(false)
    expect(lease.dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects mismatching identity before policy reads and still disposes', async () => {
    const { registry, identity, lease } = fixture()
    const operation = vi.fn()
    await expect(withWorkspaceReadLease(registry, { ...identity, workspaceId: 'changed' }, async () => lease, operation)).rejects.toThrow('WORKSPACE_IDENTITY_MISMATCH')
    expect(lease.fs.stat).not.toHaveBeenCalled()
    expect(operation).not.toHaveBeenCalled()
    expect(lease.dispose).toHaveBeenCalledTimes(1)
  })

  it('publishes Git only with an acquired matching lease', async () => {
    const { registry, identity, lease } = fixture()
    const gitLease: ExecutionGitLease = {
      workspaceId: lease.workspaceId,
      git: { workspaceId: lease.workspaceId, emptyFile: '/dev/null', signal: new AbortController().signal, execute: vi.fn() },
      dispose: vi.fn(async () => {}),
    }
    await withWorkspaceReadLease(registry, identity, async () => lease, async () => {
      expect(registry.require(identity.workspaceId, 'gitRead').lease.git).toBe(gitLease.git)
    }, undefined, async () => gitLease)
    expect(gitLease.dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects a Git lease from another execution workspace and disposes it', async () => {
    const { registry, identity, lease } = fixture()
    const gitLease: ExecutionGitLease = {
      workspaceId: 'other' as ExecutionGitLease['workspaceId'],
      git: { workspaceId: 'other' as ExecutionGitLease['workspaceId'], emptyFile: '/dev/null', signal: new AbortController().signal, execute: vi.fn() },
      dispose: vi.fn(async () => {}),
    }
    const operation = vi.fn()
    await expect(withWorkspaceReadLease(registry, identity, async () => lease, operation, undefined, async () => gitLease)).rejects.toThrow('WORKSPACE_IDENTITY_MISMATCH')
    expect(operation).not.toHaveBeenCalled()
    expect(gitLease.dispose).toHaveBeenCalledTimes(1)
    expect(lease.dispose).toHaveBeenCalledTimes(1)
  })

  it('preserves the primary failure when cleanup also fails', async () => {
    const { registry, identity, lease } = fixture()
    const primary = new Error('operation failed')
    vi.mocked(lease.dispose).mockRejectedValue(new Error('/private/transport'))
    await expect(withWorkspaceReadLease(registry, identity, async () => lease, async () => { throw primary })).rejects.toBe(primary)
    expect(registry.capabilities(identity.workspaceId).leaseBound).toBe(false)
  })

  it('sanitizes a cleanup-only failure', async () => {
    const { registry, identity, lease } = fixture()
    vi.mocked(lease.dispose).mockRejectedValue(new Error('/private/transport'))
    await expect(withWorkspaceReadLease(registry, identity, async () => lease, async () => 'done')).rejects.toMatchObject({ reason: 'WORKSPACE_CLEANUP_FAILED' })
  })

  it('disposes an acquisition completed after cancellation without running the operation', async () => {
    const { registry, identity, lease } = fixture()
    const controller = new AbortController()
    const operation = vi.fn()
    await expect(withWorkspaceReadLease(registry, identity, async () => {
      controller.abort(new Error('cancelled'))
      return lease
    }, operation, controller.signal)).rejects.toThrow('cancelled')
    expect(operation).not.toHaveBeenCalled()
    expect(lease.dispose).toHaveBeenCalledTimes(1)
  })
})
