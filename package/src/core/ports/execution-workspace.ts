export type WorkspaceCapability = 'workspaceContentRead' | 'gitRead' | 'executionOutput'
export interface WorkspaceIdentity { workspaceId: string; displayRoot: string }
export interface WorkspaceAuthority {
  readonly identity: WorkspaceIdentity
  readonly signal: AbortSignal
  has(capability: WorkspaceCapability): boolean
  require(capability: WorkspaceCapability): void
}
export interface WorkspaceOperation {
  locator: unknown
  capabilities: readonly WorkspaceCapability[]
  gitAssurance?: 'hardened'
}
/** Authority is scoped to the callback and revoked when it settles. */
export interface ExecutionWorkspacePort {
  withOperation<Result>(request: WorkspaceOperation, callback: (authority: WorkspaceAuthority) => Promise<Result>, signal?: AbortSignal): Promise<Result>
}
