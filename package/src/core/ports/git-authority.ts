import type { PlannerGitProof } from '../planner-task.ts'

/** Fresh metadata from a currently owned Git capability, never durable authority. */
export interface GitAuthority {
  readonly workspaceId: string
  readonly signal: AbortSignal
  snapshot(): Promise<PlannerGitProof>
}

/** Deployment owns acquisition, provider affinity and joined cleanup.
 * Authority is usable only inside the callback and revoked on settlement. */
export interface GitAuthorityPort {
  withAuthority<Result>(callback: (authority: GitAuthority) => Promise<Result>, signal?: AbortSignal): Promise<Result>
}
