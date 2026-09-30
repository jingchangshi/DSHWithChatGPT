import type { PersistedTask, PersistedWorkspaceBinding } from '../model.ts'

export interface TaskSnapshot { value: PersistedTask; revision: number }
export interface TaskReader {
  loadTask(taskId: string): Promise<PersistedTask | undefined>
  listTaskIds(): Promise<string[]>
  loadWorkspace(workspaceId: string): Promise<PersistedWorkspaceBinding | undefined>
}
/** Expected revisions apply to the supported single writer, not distributed consensus. */
export interface StateStore extends TaskReader {
  loadTaskSnapshot(taskId: string): Promise<TaskSnapshot | undefined>
  createTask(task: PersistedTask): Promise<TaskSnapshot>
  commitTask(taskId: string, expectedRevision: number, task: PersistedTask): Promise<TaskSnapshot>
  saveTaskIndex(ids: string[]): Promise<void>
  bindWorkspace(workspaceId: string, binding: Omit<PersistedWorkspaceBinding, 'updatedAt'>): Promise<void>
}
export class StateRevisionConflictError extends Error {
  readonly code = 'STATE_REVISION_CONFLICT'
  constructor(taskId: string) {
    super(`STATE_REVISION_CONFLICT: ${taskId}`)
    this.name = 'StateRevisionConflictError'
  }
}
