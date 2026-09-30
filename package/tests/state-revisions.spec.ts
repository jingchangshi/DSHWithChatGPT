import { describe, expect, it } from 'vitest'
import { CoordinatorState, createMemoryStore, type PersistedTask } from '../src/orchestrator/state.ts'

describe('revisioned task persistence', () => {
  const makeTask = (): PersistedTask => ({ taskId: 'revision-test', goal: 'state isolation', state: 'planned', iteration: 1, waitingFor: 'dsh-execution', conversationId: null, lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null })
  it('serializes simultaneous commits and keeps exactly one winner', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const initial = await store.createTask(makeTask())
    const outcomes = await Promise.allSettled([
      store.commitTask(initial.value.taskId, initial.revision, { ...initial.value, state: 'executing' }),
      store.commitTask(initial.value.taskId, initial.revision, { ...initial.value, state: 'blocked' }),
    ])
    expect(outcomes.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
    expect((outcomes[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'STATE_REVISION_CONFLICT' })
    expect((await store.loadTask(initial.value.taskId))!.state).toBe('executing')
  })
  it('reads untouched v1 records and leaves state unchanged after failed durability', async () => {
    const backend = createMemoryStore()
    const original = { ...makeTask(), updatedAt: 123 }
    await backend.put('task:revision-test', original)
    const store = new CoordinatorState({ ...backend, async put() { throw new Error('durability failed') } })
    expect(await store.loadTaskSnapshot(original.taskId)).toEqual({ value: original, revision: 123 })
    await expect(store.commitTask(original.taskId, 123, { ...original, state: 'done' })).rejects.toThrow('durability failed')
    expect(await store.loadTask(original.taskId)).toEqual(original)
    expect(original.updatedAt).toBe(123)
  })
  it('rejects stale writes and preserves revisions across adapter reconstruction', async () => {
    const backend = createMemoryStore()
    const store = new CoordinatorState(backend)
    const task: PersistedTask = { taskId: 'revision-test', goal: 'state isolation', state: 'planned', iteration: 1, waitingFor: 'dsh-execution', conversationId: null, lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null }
    // Runtime assertions retain a useful red result before the port exists.
    const revisioned = store as unknown as {
      createTask(value: PersistedTask): Promise<{ value: PersistedTask; revision: number }>
      loadTaskSnapshot(id: string): Promise<{ value: PersistedTask; revision: number }>
      commitTask(id: string, revision: number, value: PersistedTask): Promise<{ value: PersistedTask; revision: number }>
    }
    expect(typeof revisioned.createTask).toBe('function')
    const first = await revisioned.createTask(task)
    const second = await revisioned.commitTask(task.taskId, first.revision, { ...task, state: 'executing' })
    expect(second.revision).toBeGreaterThan(first.revision)
    await expect(revisioned.commitTask(task.taskId, first.revision, task)).rejects.toMatchObject({ code: 'STATE_REVISION_CONFLICT' })
    expect(await revisioned.loadTaskSnapshot(task.taskId)).toEqual(second)
    const restarted = new CoordinatorState(backend) as unknown as typeof revisioned
    expect(await restarted.loadTaskSnapshot(task.taskId)).toEqual(second)
    second.value.state = 'done'
    expect((await restarted.loadTaskSnapshot(task.taskId)).value.state).toBe('executing')
  })
})
