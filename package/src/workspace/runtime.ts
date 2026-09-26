import { WorkspaceError } from './errors.ts'
import type { WorkspaceQuery } from './query.ts'
import type { WorkspaceGitExecutor } from './git.ts'
export type { WorkspaceReadOperation } from './query.ts'

/** Public access categories; execution output is a content channel too. */
export type WorkspaceContentCapability = 'workspaceContentRead' | 'gitRead' | 'executionOutput'

/** Consumer-facing adapter; implementations must enforce provider-side root isolation. */
export interface WorkspaceReadBackend {
  read(query: Exclude<WorkspaceQuery, { operation: 'git_status' | 'git_diff' | 'git_log' }>, signal: AbortSignal): Promise<unknown>
}

/** Provider-confirmed access, never inferred from filesystem service presence. */
export type WorkspaceCapability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: WorkspaceUnavailableReason }

/** Stable public diagnostics exclude provider paths and transport errors. */
export type WorkspaceUnavailableReason = 'RUNTIME_LEASE_UNAVAILABLE' | 'ROOT_SAFE_READ_UNAVAILABLE'
  | 'GIT_READ_UNAVAILABLE' | 'SUBPROCESS_CAPABILITY_UNAVAILABLE' | 'EXECUTION_OUTPUT_UNAVAILABLE'

/** One acquisition, distinct from the lifetime of its underlying service generation. */
export interface WorkspaceRuntimeSnapshot {
  readonly token: symbol
  readonly lease: WorkspaceRuntimeLease
}

/** Identity already allocated by the execution-world provider. */
export interface WorkspaceRuntimeIdentity {
  readonly workspaceId: string
  readonly displayRoot: string
}

/** Ephemeral service ownership for one executing collaboration tool. */
export interface WorkspaceRuntimeLease {
  readonly identity: WorkspaceRuntimeIdentity
  readonly generation: symbol
  readonly signal: AbortSignal
  readonly capabilities: Readonly<Record<WorkspaceContentCapability, WorkspaceCapability>>
  readonly backend?: WorkspaceReadBackend
  readonly git?: WorkspaceGitExecutor
}

/** Metadata excludes service tokens, provider IDs, and transport details. */
export interface WorkspaceRuntimeCapabilities {
  readonly leaseBound: boolean
  readonly workspaceContentRead: WorkspaceCapability
  readonly gitRead: WorkspaceCapability
  readonly executionOutput: WorkspaceCapability
}

/** Active leases only; durable task state must not serialize this registry. */
export class WorkspaceRuntimeRegistry {
  private readonly entries = new Map<string, WorkspaceRuntimeSnapshot>()

  /**
   * Acquire matching runtime ownership; overlapping service generations are rejected.
   * @param lease - runtime captured from the current execution, including its cancellation.
   * @returns idempotent release function for this acquisition only.
   */
  acquire(lease: WorkspaceRuntimeLease): () => void {
    lease.signal.throwIfAborted()
    const workspaceId = lease.identity.workspaceId
    if (this.entries.has(workspaceId)) throw new WorkspaceError('RUNTIME_LEASE_CONFLICT', 'workspace already has an active execution owner')
    const token = Symbol()
    this.entries.set(workspaceId, { token, lease })
    const release = () => {
      lease.signal.removeEventListener('abort', release)
      if (this.entries.get(workspaceId)?.token === token) this.entries.delete(workspaceId)
    }
    lease.signal.addEventListener('abort', release, { once: true })
    return release
  }

  /**
   * Report the active owner's permissions without probing files or Git.
   * @param workspaceId - durable execution workspace identity.
   * @returns metadata suitable for the MCP capability response.
   */
  capabilities(workspaceId: string): WorkspaceRuntimeCapabilities {
    const lease = this.entries.get(workspaceId)?.lease
    const unavailable: WorkspaceCapability = { available: false, reason: 'RUNTIME_LEASE_UNAVAILABLE' }
    if (lease === undefined) {
      return { leaseBound: false, workspaceContentRead: unavailable, gitRead: unavailable, executionOutput: unavailable }
    }
    const workspaceContentRead = lease.capabilities.workspaceContentRead
    return {
      leaseBound: true,
      workspaceContentRead,
      gitRead: workspaceContentRead.available ? lease.capabilities.gitRead : workspaceContentRead,
      executionOutput: workspaceContentRead.available ? lease.capabilities.executionOutput : workspaceContentRead,
    }
  }

  /**
   * Require current authorization before accessing any content-bearing backend.
   * @param workspaceId - durable execution workspace identity.
   * @param capability - requested content channel.
   * @returns an active lease whose lifetime must also constrain the operation.
   */
  require(workspaceId: string, capability: WorkspaceContentCapability): WorkspaceRuntimeSnapshot {
    const access = this.capabilities(workspaceId)[capability]
    if (!access.available) throw new WorkspaceError('WORKSPACE_CAPABILITY_UNAVAILABLE', access.reason)
    const snapshot = this.entries.get(workspaceId)
    if (!snapshot) throw new WorkspaceError('WORKSPACE_CAPABILITY_UNAVAILABLE', 'RUNTIME_LEASE_UNAVAILABLE')
    if (snapshot.lease.signal.aborted) throw new WorkspaceError('WORKSPACE_OPERATION_CANCELLED', 'execution cancelled')
    return snapshot
  }
}
