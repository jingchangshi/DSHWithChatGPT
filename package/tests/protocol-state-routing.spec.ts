import { describe, expect, it } from 'vitest'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import type { PersistedTask } from '../src/core/model.ts'

const task = (taskId = 'd2c_old'): PersistedTask => ({ taskId, goal: 'resume', state: 'executed', iteration: 1, waitingFor: 'chatgpt-review', conversationId: 'existing', lastReviewedHead: 'a'.repeat(40), createdAt: 1, updatedAt: 2, lastError: null })

describe('explicit protocol state routing, without runtime enablement', () => {
  it.each([null, 0, 3, '2'])('rejects corrupt version %s rather than defaulting to v1', async version => {
    const backend = createMemoryStore()
    const corrupt = { ...task(), protocolVersion: version } as unknown as PersistedTask
    const store = new CoordinatorState(backend)
    await expect(store.createTask(corrupt)).rejects.toMatchObject({ code: 'PROTOCOL_STATE_CONFLICT' })
    await backend.put('task:' + corrupt.taskId, corrupt)
    await expect(store.loadTask(corrupt.taskId)).rejects.toMatchObject({ code: 'PROTOCOL_STATE_CONFLICT' })
  })
  it('rejects tied conflicting bindings and unknown keys without deleting data', async () => {
    const { ProtocolStateBackend } = await import('../src/orchestrator/protocol-state-backend.ts')
    const legacy = createMemoryStore(), canonical = createMemoryStore()
    const old = { workspaceRoot: '/world', lastTaskId: 'old', conversationId: 'old-chat', updatedAt: 2 }
    await legacy.put('workspace:world', old)
    await canonical.put('workspace:world', { ...old, lastTaskId: 'other' })
    const router = new ProtocolStateBackend(legacy, canonical)
    await expect(router.get('workspace:world')).rejects.toMatchObject({ code: 'PROTOCOL_STATE_CONFLICT' })
    await expect(router.delete('workspace:world')).rejects.toMatchObject({ code: 'PROTOCOL_STATE_CONFLICT' })
    await expect(router.put('unknown:key', {})).rejects.toMatchObject({ code: 'PROTOCOL_STATE_CONFLICT' })
    expect(await legacy.get('workspace:world')).toEqual(old)
  })
  it('deletes only the selected canonical task and preserves the legacy record', async () => {
    const { ProtocolStateBackend } = await import('../src/orchestrator/protocol-state-backend.ts')
    const legacy = createMemoryStore(), canonical = createMemoryStore()
    await legacy.put('task:d2c_old', task())
    const current = { ...task('pb_' + 'b'.repeat(32)), protocolVersion: 2 as const }
    const router = new ProtocolStateBackend(legacy, canonical)
    await router.put('task:' + current.taskId, current)
    await router.delete('task:' + current.taskId)
    expect(await router.get('task:' + current.taskId)).toBeUndefined()
    expect(await legacy.get('task:d2c_old')).toEqual(task())
  })
  it('reads a released missing-version task unchanged across reconstruction', async () => {
    const { ProtocolStateBackend } = await import('../src/orchestrator/protocol-state-backend.ts')
    const legacy = createMemoryStore(), canonical = createMemoryStore()
    const old = task()
    await legacy.put('task:' + old.taskId, old)
    const store = new CoordinatorState(new ProtocolStateBackend(legacy, canonical))
    expect(await store.loadTask(old.taskId)).toEqual(old)
    const next = new CoordinatorState(new ProtocolStateBackend(legacy, canonical))
    expect(await next.loadTask(old.taskId)).toEqual(old)
    expect(await canonical.get('task:' + old.taskId)).toBeUndefined()
    expect(await legacy.get('task:' + old.taskId)).toEqual(old)
  })
  it('persists explicit v2 only in the canonical domain', async () => {
    const { ProtocolStateBackend } = await import('../src/orchestrator/protocol-state-backend.ts')
    const legacy = createMemoryStore(), canonical = createMemoryStore()
    const current = { ...task('pb_' + 'b'.repeat(32)), protocolVersion: 2 as const }
    const router = new ProtocolStateBackend(legacy, canonical)
    const saved = await new CoordinatorState(router).createTask(current)
    expect(await canonical.get('task:' + current.taskId)).toEqual(saved.value)
    expect(await legacy.get('task:' + current.taskId)).toBeUndefined()
    expect(await new CoordinatorState(new ProtocolStateBackend(legacy, canonical)).loadTask(current.taskId)).toEqual(saved.value)
  })
  it('rejects same task identity in both domains instead of choosing a winner', async () => {
    const { ProtocolStateBackend } = await import('../src/orchestrator/protocol-state-backend.ts')
    const legacy = createMemoryStore(), canonical = createMemoryStore()
    await legacy.put('task:collision', task('collision'))
    await canonical.put('task:collision', { ...task('collision'), protocolVersion: 2 })
    await expect(new ProtocolStateBackend(legacy, canonical).get('task:collision')).rejects.toMatchObject({ code: 'PROTOCOL_STATE_CONFLICT' })
  })
  it.each([undefined, 1, 2] as const)('rejects changing persisted version %s and retains the last revision', async version => {
    const backend = createMemoryStore(), store = new CoordinatorState(backend)
    const original = { ...task(version === 2 ? 'pb_' + 'c'.repeat(32) : 'd2c_old'), ...(version === undefined ? {} : { protocolVersion: version }) }
    const saved = await store.createTask(original)
    await expect(store.commitTask(original.taskId, saved.revision, { ...saved.value, protocolVersion: version === 2 ? 1 : 2 })).rejects.toMatchObject({ code: 'PROTOCOL_VERSION_IMMUTABLE' })
    expect(await store.loadTaskSnapshot(original.taskId)).toEqual(saved)
  })
  it('rejects administrative save that changes the protocol version', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const saved = await store.createTask(task())
    await expect(store.saveTask({ ...saved.value, protocolVersion: 2 })).rejects.toMatchObject({ code: 'PROTOCOL_VERSION_IMMUTABLE' })
    expect(await store.loadTaskSnapshot(saved.value.taskId)).toEqual(saved)
  })
  it('rejects corrupt version placement without repairing or copying records', async () => {
    const { ProtocolStateBackend } = await import('../src/orchestrator/protocol-state-backend.ts')
    for (const canonicalPlacement of [true, false]) {
      const legacy = createMemoryStore(), canonical = createMemoryStore()
      await (canonicalPlacement ? canonical : legacy).put('task:bad', { ...task('bad'), protocolVersion: canonicalPlacement ? 1 : 2 })
      await expect(new ProtocolStateBackend(legacy, canonical).get('task:bad')).rejects.toMatchObject({ code: 'PROTOCOL_STATE_CONFLICT' })
    }
  })
  it('merges indexes and chooses latest binding while preserving legacy data', async () => {
    const { ProtocolStateBackend } = await import('../src/orchestrator/protocol-state-backend.ts')
    const legacy = createMemoryStore(), canonical = createMemoryStore()
    await legacy.put('index:tasks', { ids: ['old'] })
    await canonical.put('index:tasks', { ids: ['new', 'old'] })
    const old = { workspaceRoot: '/world', lastTaskId: 'old', conversationId: 'old-chat', updatedAt: 2 }
    const next = { ...old, lastTaskId: 'new', updatedAt: 3 }
    await legacy.put('workspace:world', old)
    await canonical.put('workspace:world', next)
    const router = new ProtocolStateBackend(legacy, canonical)
    expect(await router.get('index:tasks')).toEqual({ ids: ['old', 'new'] })
    expect(await router.get('workspace:world')).toEqual(next)
    expect(await legacy.get('workspace:world')).toEqual(old)
  })
  it('declares a separate schema and keeps the released schema unchanged', async () => {
    const { plannerStateDomain } = await import('../src/adapters/cordis/planner-state-store.ts')
    const { legacyStateDomain } = await import('../src/adapters/cordis/state-store.ts')
    expect([legacyStateDomain.name, legacyStateDomain.version]).toEqual(['d2c_state', 1])
    expect(legacyStateDomain.tables.tasks.valueSchema.parse(task())).toEqual(task())
    expect([plannerStateDomain.name, plannerStateDomain.version]).toEqual(['plannerbridge_state', 1])
    expect(() => plannerStateDomain.tables.tasks.valueSchema.parse(task())).toThrow()
    const current = { ...task('pb_' + 'b'.repeat(32)), protocolVersion: 2 }
    expect(plannerStateDomain.tables.tasks.valueSchema.parse(current)).toEqual(current)
  })
})
