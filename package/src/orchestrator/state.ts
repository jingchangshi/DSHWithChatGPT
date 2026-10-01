import type { PersistedTask, PersistedWorkspaceBinding } from '../core/model.ts'
import { taskProtocolVersion } from '../core/model.ts'
import type { PlannerTaskAggregate } from '../core/planner-task.ts'
import { requirePlannerTaskTransition, validatePlannerTask } from './planner-task.ts'
export type { TaskState, PersistedTask, PersistedWorkspaceBinding } from '../core/model.ts'
import { StateRevisionConflictError, type StateStore as RevisionedStateStore, type TaskSnapshot } from '../core/ports/state-store.ts'

/** Minimal async KV contract for an explicitly selected state store. */
export interface StateStore {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

/** In-memory StateStore for explicit test composition, never a production fallback. */
export function createMemoryStore(): StateStore {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return structuredClone(map.get(key)) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      map.set(key, structuredClone(value))
    },
    async delete(key: string): Promise<void> {
      map.delete(key)
    },
  }
}

const TASK_KEY = (taskId: string): string => 'task:' + taskId
const WORKSPACE_KEY = (workspaceId: string): string => 'workspace:' + workspaceId

/** State repository over a StateStore. */
export class CoordinatorState implements RevisionedStateStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: StateStore) {}

  private serialized<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => {})
    return result
  }

  async loadTaskSnapshot(taskId: string): Promise<TaskSnapshot | undefined> {
    const value = await this.loadTask(taskId)
    return value === undefined ? undefined : { value, revision: value.updatedAt }
  }

  createTask(task: PersistedTask): Promise<TaskSnapshot> {
    return this.serialized(async () => {
      taskProtocolVersion(task)
      requirePlannerTaskTransition(undefined, task)
      if (await this.loadTask(task.taskId) !== undefined) throw new StateRevisionConflictError(task.taskId)
      return this.writeTask(task, 0)
    })
  }

  commitTask(taskId: string, expectedRevision: number, task: PersistedTask): Promise<TaskSnapshot> {
    return this.serialized(async () => {
      const previous = await this.loadTask(taskId)
      if (task.taskId !== taskId || previous === undefined || previous.updatedAt !== expectedRevision) throw new StateRevisionConflictError(taskId)
      this.requireSameProtocol(previous, task)
      requirePlannerTaskTransition(previous, task)
      return this.writeTask(task, expectedRevision)
    })
  }

  private async writeTask(task: PersistedTask, previousRevision: number): Promise<TaskSnapshot> {
    const value = structuredClone({ ...task, updatedAt: Math.max(Date.now(), previousRevision + 1) })
    await this.store.put(TASK_KEY(task.taskId), value)
    return { value: structuredClone(value), revision: value.updatedAt }
  }

  async saveTask(task: PersistedTask): Promise<void> {
    // Legacy administrative API. Canonical task transitions use commitTask.
    await this.serialized(async () => {
      const previous = await this.loadTask(task.taskId)
      if (previous !== undefined) this.requireSameProtocol(previous, task)
      else taskProtocolVersion(task)
      requirePlannerTaskTransition(previous, task)
      const saved = await this.writeTask(task, previous?.updatedAt ?? 0)
      task.updatedAt = saved.revision
    })
  }

  private requireSameProtocol(previous: PersistedTask, next: PersistedTask): void {
    if (taskProtocolVersion(previous) !== taskProtocolVersion(next)) throw Object.assign(new Error('PROTOCOL_VERSION_IMMUTABLE'), { code: 'PROTOCOL_VERSION_IMMUTABLE' })
  }

  async loadTask(taskId: string): Promise<PersistedTask | undefined> {
    const task = await this.store.get<PersistedTask>(TASK_KEY(taskId))
    if (task !== undefined) taskProtocolVersion(task)
    if (task !== undefined) validatePlannerTask(task)
    return structuredClone(task)
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.serialized(async () => {
      const task = await this.loadTask(taskId)
      if (task && taskProtocolVersion(task) === 2 && (task as PlannerTaskAggregate).round
        && !['done', 'blocked', 'error'].includes(task.state)) throw Object.assign(new Error('RECOVERY_REQUIRED'), { code: 'RECOVERY_REQUIRED' })
      await this.store.delete(TASK_KEY(taskId))
    })
  }

  async listTaskIds(): Promise<string[]> {
    // The KV contract does not expose prefix listing; the coordinator keeps an
    // index key updated on every save.
    const index = await this.store.get<{ ids: string[] }>('index:tasks')
    return [...(index?.ids ?? [])]
  }

  async saveTaskIndex(ids: string[]): Promise<void> {
    await this.store.put('index:tasks', { ids })
  }

  async bindWorkspace(workspaceId: string, binding: Omit<PersistedWorkspaceBinding, 'updatedAt'>): Promise<void> {
    await this.store.put(WORKSPACE_KEY(workspaceId), { ...binding, updatedAt: Date.now() })
  }

  async loadWorkspace(workspaceId: string): Promise<PersistedWorkspaceBinding | undefined> {
    return structuredClone(await this.store.get<PersistedWorkspaceBinding>(WORKSPACE_KEY(workspaceId)))
  }
}
