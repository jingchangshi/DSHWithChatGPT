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
  /** Missing only on released v1 records; never infer a version from the ID. */
  protocolVersion?: 1 | 2
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

export function taskProtocolVersion(task: PersistedTask): 1 | 2 {
  const version = task.protocolVersion === undefined ? 1 : task.protocolVersion
  if (version !== 1 && version !== 2) throw Object.assign(new Error('PROTOCOL_STATE_CONFLICT'), { code: 'PROTOCOL_STATE_CONFLICT' })
  return version
}

/** Persisted workspace binding. */
export interface PersistedWorkspaceBinding {
  workspaceRoot: string
  conversationId: string | null
  lastTaskId: string | null
  updatedAt: number
}
