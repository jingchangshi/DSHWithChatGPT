/**
 * Coordinator durable state: persisted via a Cordis storage domain so tasks
 * survive DSH restarts and browser reloads. Nothing task-critical lives only
 * in the GLM context window.
 * @module orchestrator
 */

/** Task lifecycle states persisted by the coordinator (no 'idle' — a persisted task always exists). */
export type TaskState =
  | 'awaiting-plan'
  | 'planned'
  | 'executing'
  | 'executed'
  | 'awaiting-review'
  | 'done'
  | 'blocked'
  | 'error'

/** Persisted task state. */
export interface PersistedTask {
  taskId: string
  goal: string
  state: TaskState
  iteration: number
  waitingFor: 'none' | 'chatgpt-plan' | 'chatgpt-review' | 'dsh-execution' | 'user'
  /** Conversation identity for the browser control plane. */
  conversationId: string | null
  /** Last git HEAD reviewed by ChatGPT. */
  lastReviewedHead: string | null
  createdAt: number
  updatedAt: number
  /** Last error detail, when state === 'error'. */
  lastError: string | null
}

/** Persisted workspace binding. */
export interface PersistedWorkspaceBinding {
  workspaceRoot: string
  conversationId: string | null
  lastTaskId: string | null
  updatedAt: number
}

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
      return map.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      map.set(key, value)
    },
    async delete(key: string): Promise<void> {
      map.delete(key)
    },
  }
}

const TASK_KEY = (taskId: string): string => 'task:' + taskId
const WORKSPACE_KEY = (workspaceId: string): string => 'workspace:' + workspaceId

/** State repository over a StateStore. */
export class CoordinatorState {
  constructor(private readonly store: StateStore) {}

  async saveTask(task: PersistedTask): Promise<void> {
    task.updatedAt = Date.now()
    await this.store.put(TASK_KEY(task.taskId), task)
  }

  async loadTask(taskId: string): Promise<PersistedTask | undefined> {
    return this.store.get<PersistedTask>(TASK_KEY(taskId))
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.store.delete(TASK_KEY(taskId))
  }

  async listTaskIds(): Promise<string[]> {
    // The KV contract does not expose prefix listing; the coordinator keeps an
    // index key updated on every save.
    const index = await this.store.get<{ ids: string[] }>('index:tasks')
    return index?.ids ?? []
  }

  async saveTaskIndex(ids: string[]): Promise<void> {
    await this.store.put('index:tasks', { ids })
  }

  async bindWorkspace(workspaceId: string, binding: Omit<PersistedWorkspaceBinding, 'updatedAt'>): Promise<void> {
    await this.store.put(WORKSPACE_KEY(workspaceId), { ...binding, updatedAt: Date.now() })
  }

  async loadWorkspace(workspaceId: string): Promise<PersistedWorkspaceBinding | undefined> {
    return this.store.get<PersistedWorkspaceBinding>(WORKSPACE_KEY(workspaceId))
  }
}
