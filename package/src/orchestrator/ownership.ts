import { randomUUID } from 'node:crypto'
import type { CoordinatorState, PersistedTask } from './state.ts'

export interface ManagedTunnelOwner {
  workspaceId: string
  taskId: string
  claimId: string
  phase: 'pre-task' | 'task'
  createdAt: number
  updatedAt: number
}

export interface TunnelOwnerStore {
  get(): Promise<ManagedTunnelOwner | undefined>
  put(owner: ManagedTunnelOwner): Promise<void>
  delete(): Promise<void>
}

function terminal(task: PersistedTask | undefined): boolean {
  return task !== undefined && ['done', 'blocked', 'error'].includes(task.state)
}

export class ManagedTunnelOwnership {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: TunnelOwnerStore, private readonly state: CoordinatorState) {}

  private serialized<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => {})
    return result
  }

  private matches(current: ManagedTunnelOwner | undefined, expected: ManagedTunnelOwner): boolean {
    return current?.workspaceId === expected.workspaceId && current.taskId === expected.taskId && current.claimId === expected.claimId
  }

  private async pendingTasks(): Promise<string[]> {
    const ids = await this.state.listTaskIds()
    const pending: string[] = []
    for (const id of ids) {
      const task = await this.state.loadTask(id)
      if (task !== undefined && !terminal(task)) pending.push(id)
    }
    return pending
  }

  reserve(workspaceId: string, taskId: string): Promise<ManagedTunnelOwner> {
    return this.serialized(async () => {
      const current = await this.store.get()
      if (current !== undefined) throw new Error('TUNNEL_WORKSPACE_BUSY')
      if ((await this.pendingTasks()).length > 0) throw new Error('TUNNEL_LEGACY_TASK_PENDING')
      const owner: ManagedTunnelOwner = { workspaceId, taskId, claimId: randomUUID(), phase: 'pre-task', createdAt: Date.now(), updatedAt: Date.now() }
      await this.store.put(owner)
      return owner
    })
  }

  assertWorkspaceAllowed(workspaceId: string): Promise<void> {
    return this.withWorkspace(workspaceId, async () => {})
  }

  withWorkspace<Result>(workspaceId: string, operation: () => Promise<Result>): Promise<Result> {
    return this.serialized(async () => {
      const owner = await this.store.get()
      if (owner !== undefined && owner.workspaceId !== workspaceId) throw new Error('TUNNEL_WORKSPACE_BUSY')
      if (owner === undefined && (await this.pendingTasks()).length > 0) throw new Error('TUNNEL_LEGACY_TASK_PENDING')
      return operation()
    })
  }

  promote(owner: ManagedTunnelOwner): Promise<void> {
    return this.serialized(async () => {
      const current = await this.store.get()
      if (!this.matches(current, owner)) throw new Error('TUNNEL_OWNER_CHANGED')
      if (await this.state.loadTask(owner.taskId) === undefined) throw new Error('TUNNEL_TASK_UNAVAILABLE')
      await this.store.put({ ...owner, phase: 'task', updatedAt: Date.now() })
    })
  }

  requireTaskOwner(workspaceId: string, taskId: string): Promise<ManagedTunnelOwner> {
    return this.serialized(async () => {
      const binding = await this.state.loadWorkspace(workspaceId)
      const task = await this.state.loadTask(taskId)
      if (binding?.lastTaskId !== taskId || task?.taskId !== taskId || terminal(task)) throw new Error('TUNNEL_TASK_UNAVAILABLE')
      const current = await this.store.get()
      if (current !== undefined) {
        if (current.workspaceId !== workspaceId || current.taskId !== taskId) throw new Error('TUNNEL_WORKSPACE_BUSY')
        if (current.phase !== 'task') throw new Error('C2C_PRETASK_RECOVERY_REQUIRED')
        return current
      }
      if ((await this.pendingTasks()).some(id => id !== taskId)) throw new Error('TUNNEL_LEGACY_TASK_CONFLICT')
      const owner: ManagedTunnelOwner = { workspaceId, taskId, claimId: randomUUID(), phase: 'task', createdAt: Date.now(), updatedAt: Date.now() }
      await this.store.put(owner)
      return owner
    })
  }

  settle(owner: ManagedTunnelOwner): Promise<void> {
    return this.serialized(async () => {
      const current = await this.store.get()
      if (!this.matches(current, owner)) return
      const task = await this.state.loadTask(owner.taskId)
      if (terminal(task) || current?.phase === 'pre-task' && task === undefined) await this.store.delete()
    })
  }

  reconnect(workspaceId: string): Promise<'cleared' | 'continue'> {
    return this.serialized(async () => {
      const current = await this.store.get()
      if (current === undefined) return 'continue'
      if (current.workspaceId !== workspaceId) throw new Error('TUNNEL_WORKSPACE_BUSY')
      const task = await this.state.loadTask(current.taskId)
      if (terminal(task)) {
        await this.store.delete()
        return 'continue'
      }
      if (current.phase === 'pre-task') {
        if (task !== undefined) throw new Error('C2C_PRETASK_RECOVERY_REQUIRED')
        await this.store.delete()
        return 'cleared'
      }
      const binding = await this.state.loadWorkspace(workspaceId)
      if (task === undefined || binding?.lastTaskId !== current.taskId) throw new Error('TUNNEL_TASK_UNAVAILABLE')
      return 'continue'
    })
  }
}
