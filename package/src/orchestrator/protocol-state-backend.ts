import { isDeepStrictEqual } from 'node:util'
import { taskProtocolVersion, type PersistedTask, type PersistedWorkspaceBinding } from '../core/model.ts'
import type { StateStore } from './state.ts'

function conflict(): never { throw Object.assign(new Error('PROTOCOL_STATE_CONFLICT'), { code: 'PROTOCOL_STATE_CONFLICT' }) }

/** Explicit dual-domain reader/writer. No copying, history synthesis or task upgrade. */
export class ProtocolStateBackend implements StateStore {
  constructor(private readonly legacy: StateStore, private readonly canonical: StateStore) {}

  private async taskLocation(key: string): Promise<{ value?: PersistedTask; backend?: StateStore }> {
    const old = await this.legacy.get<PersistedTask>(key)
    const current = await this.canonical.get<PersistedTask>(key)
    if (old !== undefined && current !== undefined) conflict()
    if (old !== undefined && (taskProtocolVersion(old) !== 1 || key !== 'task:' + old.taskId)) conflict()
    if (current !== undefined && (taskProtocolVersion(current) !== 2 || key !== 'task:' + current.taskId)) conflict()
    return old !== undefined ? { value: old, backend: this.legacy } : current !== undefined ? { value: current, backend: this.canonical } : {}
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (key.startsWith('task:')) return (await this.taskLocation(key)).value as T | undefined
    if (key === 'index:tasks') {
      const old = await this.legacy.get<{ ids: string[] }>(key), current = await this.canonical.get<{ ids: string[] }>(key)
      return { ids: [...new Set([...(old?.ids ?? []), ...(current?.ids ?? [])])] } as T
    }
    if (key.startsWith('workspace:')) {
      const old = await this.legacy.get<PersistedWorkspaceBinding>(key), current = await this.canonical.get<PersistedWorkspaceBinding>(key)
      if (old && current && old.updatedAt === current.updatedAt && !isDeepStrictEqual(old, current)) conflict()
      return (old && (!current || old.updatedAt > current.updatedAt) ? old : current) as T | undefined
    }
    conflict()
  }

  async put<T>(key: string, value: T): Promise<void> {
    if (key.startsWith('task:')) {
      const task = value as PersistedTask
      if (key !== 'task:' + task.taskId) conflict()
      const previous = await this.taskLocation(key)
      const version = taskProtocolVersion(task)
      if (previous.value && taskProtocolVersion(previous.value) !== version) throw Object.assign(new Error('PROTOCOL_VERSION_IMMUTABLE'), { code: 'PROTOCOL_VERSION_IMMUTABLE' })
      await (version === 2 ? this.canonical : this.legacy).put(key, task)
      return
    }
    if (key.startsWith('workspace:') || key === 'index:tasks') { await this.canonical.put(key, value); return }
    conflict()
  }

  async delete(key: string): Promise<void> {
    if (!key.startsWith('task:')) conflict()
    const location = await this.taskLocation(key)
    await location.backend?.delete(key)
  }
}
