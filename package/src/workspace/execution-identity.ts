import type { ExecutionWorldIdentity } from '@deepseek-ai/dsh-execution-world'
import type { WorkspaceRuntimeIdentity } from './runtime.ts'
import { WorkspaceError } from './errors.ts'

/**
 * Resolve the Session cwd in the execution provider, without Host filesystem interpretation.
 * @param source - the mounted public execution-world identity service.
 * @param cwd - Session header cwd passed verbatim to the provider.
 * @param signal - cancellation of the current execution.
 * @returns the producer's opaque workspace ID and display-only original cwd.
 */
export async function resolveExecutionWorkspace(
  source: Pick<ExecutionWorldIdentity, 'resolve'> | undefined,
  cwd: unknown,
  signal?: AbortSignal,
): Promise<WorkspaceRuntimeIdentity> {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new WorkspaceError('SESSION_WORKSPACE_UNAVAILABLE', 'executing Session has no workspace cwd')
  }
  if (!source) throw new WorkspaceError('EXECUTION_WORLD_IDENTITY_UNAVAILABLE', 'execution identity service is required')
  if (signal?.aborted) throw new WorkspaceError('WORKSPACE_OPERATION_CANCELLED', 'execution cancelled')
  try {
    const workspaceId = await source.resolve(cwd, signal)
    if (signal?.aborted) throw new WorkspaceError('WORKSPACE_OPERATION_CANCELLED', 'execution cancelled')
    return { workspaceId, displayRoot: cwd }
  } catch {
    if (signal?.aborted) throw new WorkspaceError('WORKSPACE_OPERATION_CANCELLED', 'execution cancelled')
    throw new WorkspaceError('EXECUTION_WORLD_IDENTITY_UNAVAILABLE', 'execution identity resolution failed')
  }
}
