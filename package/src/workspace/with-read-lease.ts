import { ExecutionGitCleanupError, type ExecutionGitLease } from '@deepseek-ai/dsh-execution-world/git-lease'
import type { ExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease'
import { WorkspaceError } from './errors.ts'
import { createReadLeaseBackend } from './read-lease.ts'
import type { ExecutionOutputScope, WorkspaceRuntimeIdentity, WorkspaceRuntimeRegistry } from './runtime.ts'

/** Own one collaboration operation's file and fixed-Git access and join cleanup before settlement. */
export async function withWorkspaceReadLease<Result>(
  registry: WorkspaceRuntimeRegistry,
  identity: WorkspaceRuntimeIdentity,
  acquire: (signal: AbortSignal) => Promise<ExecutionReadLease>,
  operation: (signal: AbortSignal) => Promise<Result>,
  signal?: AbortSignal,
  acquireGit?: (signal: AbortSignal) => Promise<ExecutionGitLease>,
  gitReadPolicy: 'require-full' | 'allow-hardened-windows' = 'require-full',
  gitUnavailableReason: 'GIT_READ_DISABLED' | 'GIT_FULL_CONFINEMENT_REQUIRED' | 'GIT_HARDENED_WINDOWS_UNAVAILABLE' | 'GIT_READ_UNAVAILABLE' = 'GIT_READ_UNAVAILABLE',
  authorizeOutput?: () => Promise<ExecutionOutputScope | undefined>,
  createAppProofChallenge?: () => string | undefined,
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
        if (gitLease.assurance !== 'full' && gitLease.assurance !== 'hardened-windows'
          || gitReadPolicy === 'require-full' && gitLease.assurance !== 'full') {
          throw new WorkspaceError('GIT_READ_UNAVAILABLE', 'execution Git assurance does not satisfy the requested policy')
        }
      } catch (error) {
        if (error instanceof WorkspaceError && (error.reason === 'WORKSPACE_IDENTITY_MISMATCH' || error.reason === 'GIT_READ_UNAVAILABLE')) throw error
        if (error instanceof ExecutionGitCleanupError) {
          throw new WorkspaceError('WORKSPACE_CLEANUP_FAILED', 'execution workspace cleanup could not be confirmed')
        }
        active.throwIfAborted()
        gitLease = undefined
      }
    }
    const executionOutputScope = await authorizeOutput?.()
    active.throwIfAborted()
    release = registry.acquire({
      identity, generation: Symbol(), signal: active, backend, git: gitLease?.git,
      executionOutputScope,
      appProofChallenge: createAppProofChallenge?.(),
      capabilities: {
        workspaceContentRead: { available: true },
        gitRead: gitLease === undefined ? { available: false, reason: gitUnavailableReason } : { available: true, assurance: gitLease.assurance },
        executionOutput: executionOutputScope === undefined
          ? { available: false, reason: 'EXECUTION_OUTPUT_UNAVAILABLE' } : { available: true },
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
      const outcomes = await Promise.allSettled([lease?.dispose(), gitLease?.dispose()])
      if (outcomes.some(outcome => outcome.status === 'rejected')) {
        throw new WorkspaceError('WORKSPACE_CLEANUP_FAILED', 'execution workspace cleanup could not be confirmed')
      }
    } catch (cleanupError) {
      if (!failed) throw new WorkspaceError('WORKSPACE_CLEANUP_FAILED', 'execution workspace cleanup could not be confirmed')
      void cleanupError
    }
  }
}
