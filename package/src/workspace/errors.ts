/** Workspace access failures shared by identity and containment checks. */
export class WorkspaceError extends Error {
  /** Stable machine-readable reason for rejecting workspace access. */
  readonly reason: string

  /**
   * @param reason - stable workspace failure code.
   * @param message - explanation safe for the caller.
   */
  constructor(reason: string, message: string) {
    super(reason + ': ' + message)
    this.name = 'WorkspaceError'
    this.reason = reason
  }
}
