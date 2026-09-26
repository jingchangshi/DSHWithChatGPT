import type { ExecutionGitLease } from '@deepseek-ai/dsh-execution-world/git-lease'
import type { ExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease'
import { WorkspaceError } from './errors.ts'
import { createReadLeaseBackend } from './read-lease.ts'
import type { WorkspaceRuntimeIdentity, WorkspaceRuntimeRegistry } from './runtime.ts'

/** Own one collaboration operation's file and fixed-Git access and join cleanup before settlement. */
export async function withWorkspaceReadLease<Result>(
  registry: WorkspaceRuntimeRegistry,
  identity: WorkspaceRuntimeIdentity,
  acquire: (signal: AbortSignal) => Promise<ExecutionReadLease>,
  operation: (signal: AbortSignal) => Promise<Result>,
  signal?: AbortSignal,
  acquireGit?: (signal: AbortSignal) => Promise<ExecutionGitLease>,
): Promise<Result> {
  const lifetime = new AbortController()
  const active = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
  let lease: ExecutionReadLease | undefined
  let gitLease: ExecutionGitLease | undefined
  let release: (() => void) | undefined
  let failed = false
  try {
    active.throwIfAborted()
    lease = await acquire(active)
    active.throwIfAborted()
    if (lease.workspaceId !== identity.workspaceId) {
      throw new WorkspaceError('WORKSPACE_IDENTITY_MISMATCH', 'execution workspace changed during acquisition')
    }
    const backend = await createReadLeaseBackend(lease, active)
    if (acquireGit !== undefined) {
      try {
        gitLease = await acquireGit(active)
        active.throwIfAborted()
        if (gitLease.workspaceId !== identity.workspaceId) {
          throw new WorkspaceError('WORKSPACE_IDENTITY_MISMATCH', 'execution workspace changed during Git acquisition')
        }
      } catch (error) {
        if (error instanceof WorkspaceError && error.reason === 'WORKSPACE_IDENTITY_MISMATCH') throw error
        active.throwIfAborted()
        gitLease = undefined
      }
    }
    release = registry.acquire({
      identity, generation: Symbol(), signal: active, backend, git: gitLease?.git,
      capabilities: {
        workspaceContentRead: { available: true },
        gitRead: gitLease === undefined ? { available: false, reason: 'GIT_READ_UNAVAILABLE' } : { available: true },
        executionOutput: { available: false, reason: 'EXECUTION_OUTPUT_UNAVAILABLE' },
      },
    })
    const result = await operation(active)
    active.throwIfAborted()
    return result
  } catch (error) {
    failed = true
    throw error
  } finally {
    lifetime.abort()
    release?.()
    try {
      await Promise.all([lease?.dispose(), gitLease?.dispose()])
    } catch (cleanupError) {
      if (!failed) throw new WorkspaceError('WORKSPACE_CLEANUP_FAILED', 'execution workspace cleanup could not be confirmed')
      void cleanupError
    }
  }
}
