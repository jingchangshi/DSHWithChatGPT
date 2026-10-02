import { describe, expect, it } from 'vitest'
import { ManagedTunnelOwnership, type ManagedTunnelOwner } from '../src/orchestrator/ownership.ts'
import { CoordinatorState, createMemoryStore, type TaskState } from '../src/orchestrator/state.ts'

function fixture() {
  let owner: ManagedTunnelOwner | undefined
  const store = { get: async () => owner, put: async (value: ManagedTunnelOwner) => { owner = value }, delete: async () => { owner = undefined } }
  const state = new CoordinatorState(createMemoryStore())
  const manager = new ManagedTunnelOwnership(store, state)
  const save = async (status: TaskState = 'awaiting-plan') => {
    await state.saveTask({ taskId: 'task', goal: 'goal', state: status, iteration: 0, waitingFor: 'chatgpt-plan',
      conversationId: null, lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null })
    await state.bindWorkspace('workspace', { workspaceRoot: 'display', lastTaskId: 'task', conversationId: null })
    await state.saveTaskIndex(['task'])
  }
  return { state, store, manager, save }
}

describe('durable managed tunnel ownership', () => {
  it.each(['matching', 'unknown', 'changed-source', 'changed-owner', 'changed-binding', 'cancelled', 'publication-crash'] as const)('promotes pre-task ownership only after durable bootstrap proof: %s', async scenario => {
    const { manager, state, store } = fixture()
    const taskId = 'pb_' + 'a'.repeat(32)
    const owner = await manager.reserve('workspace', taskId)
    const baseline = { version: 1 as const, conversationId: null, assistantCount: 0, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) }
    const task: any = { protocolVersion: 2, taskId, workspaceId: 'workspace', goal: 'bootstrap', state: 'awaiting-plan', iteration: 0,
      waitingFor: 'chatgpt-plan', conversationId: null, lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null,
      round: { kind: 'INIT', iteration: 0, phase: 'sending', sendOperationId: 'send-owned', waitOperationId: 'wait-owned', controlDigest: 'c'.repeat(64), baseline } }
    const created = await state.createTask({ ...task, round: { ...task.round, phase: 'prepared' } })
    await state.commitTask(taskId, created.revision, task)
    await state.saveTaskIndex([taskId])
    await state.bindWorkspace('workspace', { workspaceRoot: 'display', lastTaskId: taskId, conversationId: null })
    const before = await state.loadTask(taskId)
    const abort = new AbortController()
    let probes = 0
    const recover = async () => {
      probes++
      expect((await store.get())?.phase).toBe('pre-task')
      if (scenario === 'unknown') throw new Error('SEND_UNCERTAIN')
      const snapshot = (await state.loadTaskSnapshot(taskId))!
      const saved = await state.commitTask(taskId, snapshot.revision, { ...snapshot.value, conversationId: 'owned',
        round: { ...task.round, ...(scenario === 'changed-source' ? { controlDigest: 'd'.repeat(64) } : {}), phase: 'observed-sent', baseline: { ...baseline, conversationId: 'owned' } } } as any)
      await state.bindWorkspace('workspace', { workspaceRoot: 'display', lastTaskId: scenario === 'changed-binding' ? 'foreign' : taskId, conversationId: 'owned' })
      if (scenario === 'changed-owner') await store.put({ ...owner, claimId: 'foreign' })
      if (scenario === 'cancelled') abort.abort()
      if (scenario === 'publication-crash') throw new Error('publication crash')
      return saved.value
    }
    if (scenario === 'matching') {
      expect(await manager.recoverPendingBootstrap('workspace', recover)).toMatchObject({ taskId, conversationId: 'owned' })
      const promoted = (await store.get())!
      expect({ ...promoted, updatedAt: owner.updatedAt }).toEqual({ ...owner, phase: 'task' })
      expect(promoted.updatedAt).toBeGreaterThanOrEqual(owner.updatedAt)
    } else {
      await expect(manager.recoverPendingBootstrap('workspace', recover, abort.signal)).rejects.toThrow()
      expect((await store.get())?.phase).toBe('pre-task')
      if (scenario === 'unknown') expect(await state.loadTask(taskId)).toEqual(before)
      if (scenario === 'publication-crash') {
        expect(await manager.recoverPendingBootstrap('workspace', async () => state.loadTask(taskId))).toMatchObject({ taskId, conversationId: 'owned' })
        expect((await store.get())?.phase).toBe('task')
      }
    }
    expect(probes).toBe(1)
  })
  it('blocks unowned runtime setup and new claims while a legacy task is pending', async () => {
    const { manager, save, store } = fixture()
    await save('planned')
    await expect(manager.reserve('other', 'next')).rejects.toThrow('TUNNEL_LEGACY_TASK_PENDING')
    let called = false
    await expect(manager.withWorkspace('workspace', async () => { called = true })).rejects.toThrow('TUNNEL_LEGACY_TASK_PENDING')
    expect(called).toBe(false)
    expect(await store.get()).toBeUndefined()
    await save('done')
    await expect(manager.reserve('other', 'next')).resolves.toMatchObject({ phase: 'pre-task' })
  })

  it('rejects ambiguous legacy adoption until competing tasks become terminal', async () => {
    const { manager, save, state, store } = fixture()
    await save()
    const first = (await state.loadTask('task'))!
    await state.saveTask({ ...first, taskId: 'competing' })
    await state.saveTaskIndex(['task', 'competing'])
    await expect(manager.requireTaskOwner('workspace', 'task')).rejects.toThrow('TUNNEL_LEGACY_TASK_CONFLICT')
    expect(await store.get()).toBeUndefined()
    await state.saveTask({ ...first, taskId: 'competing', state: 'done' })
    await expect(manager.requireTaskOwner('workspace', 'task')).resolves.toMatchObject({ taskId: 'task' })
  })
  it('keeps runtime rebinding atomic with respect to a new claim', async () => {
    const { manager } = fixture()
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const runtime = manager.withWorkspace('other', async () => { entered.resolve(); await finish.promise })
    await entered.promise
    let claimed = false
    const claim = manager.reserve('workspace', 'task').then(() => { claimed = true })
    await Promise.resolve()
    expect(claimed).toBe(false)
    finish.resolve()
    await runtime
    await claim
    await expect(manager.withWorkspace('other', async () => {})).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
  })
  it('serializes competing claims and never treats a missing pre-task as stale', async () => {
    const { manager, store } = fixture()
    const results = await Promise.allSettled([manager.reserve('workspace', 'task'), manager.reserve('other', 'other')])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    await expect(manager.reserve('workspace', 'second')).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
    await expect(manager.assertWorkspaceAllowed('other')).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
    await expect(manager.requireTaskOwner('workspace', 'task')).rejects.toThrow('TUNNEL_TASK_UNAVAILABLE')
    expect((await store.get())?.phase).toBe('pre-task')
  })

  it('fences promotion and cleanup by exact claim and retains nonterminal tasks after restart', async () => {
    const { manager, store, state, save } = fixture()
    const owner = await manager.reserve('workspace', 'task')
    await save()
    await expect(manager.promote({ ...owner, claimId: 'wrong' })).rejects.toThrow('TUNNEL_OWNER_CHANGED')
    await manager.settle({ ...owner, claimId: 'wrong' })
    await manager.promote(owner)
    await manager.settle(owner)
    const restarted = new ManagedTunnelOwnership(store, state)
    expect((await restarted.requireTaskOwner('workspace', 'task')).claimId).toBe(owner.claimId)
    await expect(restarted.assertWorkspaceAllowed('other')).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
    await save('done')
    await restarted.settle(owner)
    await expect(restarted.reserve('other', 'next')).resolves.toMatchObject({ workspaceId: 'other' })
  })

  it('rolls back an exact pre-task only before persistence', async () => {
    const { manager, store, save } = fixture()
    const first = await manager.reserve('workspace', 'task')
    await manager.settle(first)
    expect(await store.get()).toBeUndefined()
    const next = await manager.reserve('workspace', 'task')
    await manager.settle(first)
    expect((await store.get())?.claimId).toBe(next.claimId)
    await save()
    await manager.settle(next)
    expect((await store.get())?.phase).toBe('pre-task')
    await expect(manager.reconnect('workspace')).rejects.toThrow(/^PRETASK_RECOVERY_REQUIRED$/)
  })

  it('permits only same-workspace reconnect to clear an orphaned pre-task after restart', async () => {
    const { manager, state, store } = fixture()
    await manager.reserve('workspace', 'task')
    const restarted = new ManagedTunnelOwnership(store, state)
    await expect(restarted.reconnect('other')).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
    await expect(restarted.reconnect('workspace')).resolves.toBe('cleared')
    expect(await store.get()).toBeUndefined()
  })

  it.each(['awaiting-plan', 'planned', 'executing', 'executed', 'awaiting-review'] as const)('adopts only verified legacy %s tasks', async status => {
    const { manager, save } = fixture()
    await save(status)
    await expect(manager.requireTaskOwner('other', 'task')).rejects.toThrow('TUNNEL_TASK_UNAVAILABLE')
    await expect(manager.requireTaskOwner('workspace', 'task')).resolves.toMatchObject({ taskId: 'task', phase: 'task' })
  })

  it.each(['done', 'blocked', 'error'] as const)('rejects terminal legacy task %s', async status => {
    const { manager, save } = fixture()
    await save(status)
    await expect(manager.requireTaskOwner('workspace', 'task')).rejects.toThrow('TUNNEL_TASK_UNAVAILABLE')
  })
})
