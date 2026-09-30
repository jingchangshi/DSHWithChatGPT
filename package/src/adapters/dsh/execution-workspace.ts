import type { Context } from '@deepseek-ai/cordis'
import { bindExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease'
import { bindExecutionGitLease } from '@deepseek-ai/dsh-execution-world/git-lease'
import type { ExecutionWorkspacePort, WorkspaceAuthority, WorkspaceIdentity, WorkspaceOperation } from '../../core/ports/execution-workspace.ts'
import { withWorkspaceReadLease } from '../../workspace/with-read-lease.ts'
import type { ExecutionOutputScope, WorkspaceRuntimeRegistry } from '../../workspace/runtime.ts'
import { WorkspaceError } from '../../workspace/errors.ts'
import { throwIfCancelled } from '../../cancellation.ts'

export interface DshWorkspaceOptions {
  context: Context
  registry: WorkspaceRuntimeRegistry
  resolve(locator: unknown, signal?: AbortSignal): Promise<WorkspaceIdentity>
  gitReadPolicy: 'require-full' | 'allow-hardened-windows' | 'disabled'
  authorizeOutput?(identity: WorkspaceIdentity): Promise<ExecutionOutputScope | undefined>
  createAppProofChallenge?(): string | undefined
}

/** Consumer adapter: all producer authority acquisition and disposal stay delegated. */
export class DshExecutionWorkspaceAdapter implements ExecutionWorkspacePort {
  constructor(private readonly options: DshWorkspaceOptions) {}

  async withOperation<Result>(request: WorkspaceOperation, callback: (authority: WorkspaceAuthority) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
    throwIfCancelled(signal)
    const identity = await this.options.resolve(request.locator, signal)
    const { context, registry, gitReadPolicy } = this.options
    const policy = request.gitAssurance === 'hardened' ? 'allow-hardened-windows' : gitReadPolicy
    if (request.gitAssurance === 'hardened' && gitReadPolicy !== 'allow-hardened-windows') throw new Error('GIT_ASSURANCE_POLICY_CONFLICT')
    return withWorkspaceReadLease(registry, identity,
      active => bindExecutionReadLease(context, identity.displayRoot, active),
      async active => {
        let settled = false
        const requireActive = () => {
          if (settled) throw new WorkspaceError('WORKSPACE_CAPABILITY_UNAVAILABLE', 'RUNTIME_LEASE_UNAVAILABLE')
          throwIfCancelled(active)
        }
        const authority: WorkspaceAuthority = {
          identity: Object.freeze({ ...identity }), signal: active,
          has: capability => !settled && !active.aborted && registry.capabilities(identity.workspaceId)[capability].available,
          require: capability => { requireActive(); registry.require(identity.workspaceId, capability) },
        }
        try {
          for (const capability of request.capabilities) authority.require(capability)
          return await callback(authority)
        } finally { settled = true }
      }, signal,
      active => policy === 'disabled' ? Promise.reject(new Error('Git read authorization is disabled'))
        : bindExecutionGitLease(context, identity.displayRoot, active, policy),
      policy === 'disabled' ? undefined : policy,
      policy === 'disabled' ? 'GIT_READ_DISABLED' : policy === 'require-full' ? 'GIT_FULL_CONFINEMENT_REQUIRED' : 'GIT_HARDENED_WINDOWS_UNAVAILABLE',
      this.options.authorizeOutput === undefined ? undefined : () => this.options.authorizeOutput!(identity),
      this.options.createAppProofChallenge)
  }
}
