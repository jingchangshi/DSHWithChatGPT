import type { ExecutionWorkspacePort, WorkspaceAuthority } from '../../core/ports/execution-workspace.ts'
import type { GitAuthority, GitAuthorityPort } from '../../core/ports/git-authority.ts'
import { WorkspaceRuntimeRegistry } from '../../workspace/runtime.ts'
import { gitStatus } from '../../workspace/git.ts'
import { throwIfCancelled } from '../../cancellation.ts'

/** Uses producer-backed workspace acquisition; identity alone never grants Git. */
export class DshGitAuthorityAdapter implements GitAuthorityPort {
  constructor(private readonly options: {
    workspace: ExecutionWorkspacePort
    registry: WorkspaceRuntimeRegistry
    locator: unknown
    workspaceId: string
    gitAssurance?: 'hardened'
    /** Reuse the producer authority owned by the enclosing tool operation. */
    authority?: WorkspaceAuthority
  }) {}

  withAuthority<Result>(callback: (authority: GitAuthority) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
    const run = async (owner: WorkspaceAuthority): Promise<Result> => {
      if (owner.identity.workspaceId !== this.options.workspaceId) throw new Error('GIT_PROOF_UNAVAILABLE')
      owner.require('gitRead')
      const acquired = this.options.registry.require(this.options.workspaceId, 'gitRead')
      let settled = false
      const check = () => {
        if (settled) throw new Error('GIT_PROOF_UNAVAILABLE')
        throwIfCancelled(signal)
        throwIfCancelled(owner.signal)
        owner.require('gitRead')
        if (this.options.registry.require(this.options.workspaceId, 'gitRead').token !== acquired.token) throw new Error('GIT_PROOF_UNAVAILABLE')
      }
      try {
        return await callback({ workspaceId: owner.identity.workspaceId, signal: owner.signal, snapshot: async () => {
          check()
          const executor = acquired.lease.git
          if (!executor) throw new Error('GIT_PROOF_UNAVAILABLE')
          const first = await gitStatus(executor)
          check()
          const second = await gitStatus(executor)
          check()
          if (first.head !== second.head || first.branch !== second.branch || first.upstream !== second.upstream
            || first.upstreamHead !== second.upstreamHead || first.dirty !== second.dirty
            || first.ahead !== second.ahead || first.behind !== second.behind) throw new Error('GIT_STATE_CHANGED')
          if (!second.isRepo || !second.head || !second.branch || !second.upstream || !second.upstreamHead
            || second.ahead === null || second.behind === null) throw new Error('GIT_PROOF_UNAVAILABLE')
          return { head: second.head, branch: second.branch, upstream: second.upstream, upstreamHead: second.upstreamHead,
            clean: !second.dirty, ahead: second.ahead, behind: second.behind }
        } })
      } finally { settled = true }
    }
    if (this.options.authority) return run(this.options.authority)
    return this.options.workspace.withOperation({ locator: this.options.locator, capabilities: ['gitRead'],
      ...(this.options.gitAssurance ? { gitAssurance: this.options.gitAssurance } : {}) }, run, signal)
  }
}
