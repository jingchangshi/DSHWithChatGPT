import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import { plannerStateDomain } from '../src/adapters/cordis/planner-state-store.ts'
import { formatPlannerEnvelope } from '../src/protocol/planner-envelope.ts'
import type { PersistedTask } from '../src/core/model.ts'

const taskId = 'pb_' + 'd'.repeat(32)
const baseline = { version: 1, conversationId: null, assistantCount: 0, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) }
function prepared() {
  return { protocolVersion: 2, taskId, workspaceId: 'world', goal: 'implement', state: 'awaiting-plan', iteration: 0,
    waitingFor: 'chatgpt-plan', conversationId: null, lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null,
    round: { kind: 'INIT', iteration: 0, sendOperationId: 'send-1', waitOperationId: 'wait-1', controlDigest: 'c'.repeat(64), baseline, phase: 'prepared' } }
}
const typed = (value: unknown) => value as PersistedTask
async function awaiting() {
  const store = new CoordinatorState(createMemoryStore())
  let snapshot = await store.createTask(typed(prepared()))
  for (const phase of ['sending', 'observed-sent', 'awaiting-reply']) {
    const next = { ...snapshot.value, round: { ...(snapshot.value as ReturnType<typeof prepared>).round, phase } }
    snapshot = await store.commitTask(taskId, snapshot.revision, typed(next))
  }
  return { store, snapshot }
}
function accepted(value: PersistedTask) {
  const sections = { ACTIONS: '1. Implement\n2. Test' }
  const wire = formatPlannerEnvelope({ sender: 'planner', state: 'PLAN', taskId, workspaceId: 'world', iteration: 1, inReplyTo: 0, sections })
  return { ...value, state: 'planned', iteration: 1, waitingFor: 'dsh-execution',
    round: { ...(value as ReturnType<typeof prepared>).round, phase: 'accepted', outcome: {
      digest: createHash('sha256').update(wire).digest('hex'), state: 'PLAN', iteration: 1, inReplyTo: 0, sections,
    } } }
}

describe('canonical task aggregate persistence without runtime enablement', () => {
  it('admits bootstrap route and epoch promotion only once without relaxing semantic baseline identity', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const created = await store.createTask(typed(prepared()))
    const sending = await store.commitTask(taskId, created.revision, typed({ ...created.value, round: { ...prepared().round, phase: 'sending' } }))
    const next: any = { ...sending.value, conversationId: 'owned', round: { ...prepared().round, phase: 'observed-sent',
      baseline: { ...baseline, conversationId: 'owned', observationEpoch: 'e'.repeat(64) } } }
    for (const field of ['assistantCount', 'textDigest']) {
      const corrupt = structuredClone(next)
      corrupt.round.baseline[field] = field === 'assistantCount' ? 1 : 'f'.repeat(64)
      await expect(store.commitTask(taskId, sending.revision, corrupt)).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
      expect(await store.loadTaskSnapshot(taskId)).toEqual(sending)
    }
    const bound = await store.commitTask(taskId, sending.revision, next)
    await expect(store.commitTask(taskId, bound.revision, { ...bound.value, round: { ...next.round, phase: 'awaiting-reply',
      baseline: { ...next.round.baseline, observationEpoch: 'f'.repeat(64) } } } as any)).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(await store.loadTaskSnapshot(taskId)).toEqual(bound)
  })
  it('admits bounded v2 intent in the real canonical schema and never requires a bootstrap conversation', () => {
    expect(plannerStateDomain.tables.tasks.valueSchema.parse(prepared())).toEqual(prepared())
  })
  it('retains intent and baseline exactly through state repository reconstruction', async () => {
    const backend = createMemoryStore()
    const saved = await new CoordinatorState(backend).createTask(typed(prepared()))
    expect(await new CoordinatorState(backend).loadTaskSnapshot(taskId)).toEqual(saved)
  })
  it.each([
    ['duplicate operation IDs', (value: any) => { value.round.waitOperationId = value.round.sendOperationId }],
    ['invalid digest', (value: any) => { value.round.controlDigest = 'invalid' }],
    ['unknown raw body', (value: any) => { value.round.body = 'raw outgoing message' }],
    ['wrong pending round', (value: any) => { value.round.iteration = 1 }],
    ['wrong workspace', (value: any) => { value.workspaceId = '' }],
    ['outcome before acceptance', (value: any) => { value.round.outcome = accepted(typed(value)).round.outcome }],
    ['accepted without result', (value: any) => { value.round.phase = 'accepted' }],
    ['new task already sending', (value: any) => { value.round.phase = 'sending' }],
    ['legacy task with canonical round', (value: any) => { delete value.protocolVersion }],
  ])('rejects %s before publishing', async (_name, mutate) => {
    const backend = createMemoryStore(), store = new CoordinatorState(backend)
    const value = structuredClone(prepared()); mutate(value)
    await expect(store.createTask(typed(value))).rejects.toThrow()
    expect(await backend.get('task:' + taskId)).toBeUndefined()
  })
  it.each(['controlDigest', 'sendOperationId', 'waitOperationId', 'baseline'])('fences changed pending %s even at the correct revision', async field => {
    const store = new CoordinatorState(createMemoryStore())
    const saved = await store.createTask(typed(prepared()))
    const next: any = structuredClone(saved.value)
    next.round[field] = field === 'baseline' ? { ...baseline, observationEpoch: 'e'.repeat(64) } : field === 'controlDigest' ? 'e'.repeat(64) : 'changed-id'
    await expect(store.commitTask(taskId, saved.revision, next)).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(await store.loadTaskSnapshot(taskId)).toEqual(saved)
  })
  it('rejects a phase jump and preserves the prepared intent', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const saved = await store.createTask(typed(prepared()))
    await expect(store.commitTask(taskId, saved.revision, typed({ ...saved.value, round: { ...prepared().round, phase: 'awaiting-reply' } }))).rejects.toThrow()
    expect(await store.loadTaskSnapshot(taskId)).toEqual(saved)
  })
  it('atomically persists validated PLAN sections, canonical digest and lifecycle at one revision', async () => {
    const { store, snapshot } = await awaiting()
    const result = await store.commitTask(taskId, snapshot.revision, typed(accepted(snapshot.value)))
    expect(await store.loadTaskSnapshot(taskId)).toEqual(result)
    expect((result.value as any).round.outcome.sections.ACTIONS).toContain('Implement')
    expect(JSON.stringify(result.value)).not.toContain('raw ChatGPT wrapper')
  })
  it.each(['digest', 'identity', 'lifecycle', 'raw-wrapper'])('rejects corrupt accepted %s before replacing pending state', async corruption => {
    const { store, snapshot } = await awaiting()
    const next: any = accepted(snapshot.value)
    if (corruption === 'digest') next.round.outcome.digest = 'f'.repeat(64)
    if (corruption === 'identity') next.round.outcome.inReplyTo = 1
    if (corruption === 'lifecycle') next.state = 'done'
    if (corruption === 'raw-wrapper') next.round.outcome.rawReply = 'raw ChatGPT wrapper'
    await expect(store.commitTask(taskId, snapshot.revision, next)).rejects.toThrow()
    expect(await store.loadTaskSnapshot(taskId)).toEqual(snapshot)
  })
  it('refuses deletion of pending history through the administrative save API', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const saved = await store.createTask(typed(prepared()))
    const next: any = { ...saved.value }; delete next.round
    await expect(store.saveTask(next)).rejects.toThrow()
    expect(await store.loadTaskSnapshot(taskId)).toEqual(saved)
  })
  it('rejects a corrupt accepted aggregate on read without overwriting storage', async () => {
    const backend = createMemoryStore(), corrupt = { ...prepared(), round: { ...prepared().round, phase: 'accepted' } }
    await backend.put('task:' + taskId, corrupt)
    await expect(new CoordinatorState(backend).loadTask(taskId)).rejects.toThrow()
    expect(await backend.get('task:' + taskId)).toEqual(corrupt)
  })

  it('preserves the entire pending aggregate when the single storage publication fails', async () => {
    const { store, snapshot } = await awaiting()
    const backend = createMemoryStore()
    await backend.put('task:' + taskId, snapshot.value)
    let writes = 0
    const failing = new CoordinatorState({ ...backend, put: async () => { writes++; throw new Error('fixture publish failure') } })
    await expect(failing.commitTask(taskId, snapshot.revision, typed(accepted(snapshot.value)))).rejects.toThrow('fixture publish failure')
    expect(writes).toBe(1)
    expect(await backend.get('task:' + taskId)).toEqual(snapshot.value)
    expect((await store.loadTaskSnapshot(taskId))?.value).toEqual(snapshot.value)
  })
  it('admits exactly one result at a shared expected revision', async () => {
    const { store, snapshot } = await awaiting()
    const next = typed(accepted(snapshot.value))
    const results = await Promise.allSettled([
      store.commitTask(taskId, snapshot.revision, next), store.commitTask(taskId, snapshot.revision, next),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'STATE_REVISION_CONFLICT' })
    expect((await store.loadTask(taskId))?.state).toBe('planned')
  })
  it('accepts identical accepted replay but reports changed outcome digest as a replay conflict', async () => {
    const { store, snapshot } = await awaiting()
    const saved = await store.commitTask(taskId, snapshot.revision, typed(accepted(snapshot.value)))
    const replay = await store.commitTask(taskId, saved.revision, saved.value)
    const next: any = structuredClone(replay.value); next.round.outcome.digest = 'f'.repeat(64)
    await expect(store.commitTask(taskId, replay.revision, next)).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(await store.loadTaskSnapshot(taskId)).toEqual(replay)
  })
  it.each(['prepared', 'awaiting-reply', 'uncertain'])('does not adopt a conversation while %s', async phase => {
    const { store, snapshot } = phase === 'prepared'
      ? await (async () => { const store = new CoordinatorState(createMemoryStore()); return { store, snapshot: await store.createTask(typed(prepared())) } })()
      : await awaiting()
    let saved = snapshot
    if (phase === 'uncertain') saved = await store.commitTask(taskId, saved.revision, typed({ ...saved.value, round: { ...(saved.value as any).round, phase } }))
    await expect(store.commitTask(taskId, saved.revision, { ...saved.value, conversationId: 'foreign-chat' })).rejects.toThrow()
    expect(await store.loadTaskSnapshot(taskId)).toEqual(saved)
  })

  it('permits a route binding only together with the first send acknowledgement transition', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const preparedTask = await store.createTask(typed(prepared()))
    const sending = await store.commitTask(taskId, preparedTask.revision, typed({ ...preparedTask.value, round: { ...prepared().round, phase: 'sending' } }))
    const bound = await store.commitTask(taskId, sending.revision, typed({ ...sending.value, conversationId: 'owned-chat', round: { ...prepared().round, phase: 'observed-sent' } }))
    expect(bound.value.conversationId).toBe('owned-chat')
    await expect(store.commitTask(taskId, bound.revision, { ...bound.value, conversationId: 'foreign-chat' })).rejects.toThrow()
  })
  it('preserves historical canonical foundations without synthesizing any round', async () => {
    const backend = createMemoryStore(), value: any = prepared(); delete value.round; delete value.workspaceId
    await backend.put('task:' + taskId, value)
    expect(await new CoordinatorState(backend).loadTask(taskId)).toEqual(value)
    expect(Object.hasOwn((await backend.get<any>('task:' + taskId)), 'round')).toBe(false)
  })
  it('refuses deletion of an unresolved canonical round', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const saved = await store.createTask(typed(prepared()))
    await expect(store.deleteTask(taskId)).rejects.toThrow()
    expect(await store.loadTaskSnapshot(taskId)).toEqual(saved)
  })

  async function review() {
    const { store, snapshot } = await awaiting()
    const plan = await store.commitTask(taskId, snapshot.revision, typed(accepted(snapshot.value)))
    // Bootstrap ACK binding belongs to its transport integration; this fixture
    // starts the second round from an independently stored, bound accepted plan.
    const backend = createMemoryStore(), bound: any = { ...plan.value, conversationId: 'owned-chat' }
    await backend.put('task:' + taskId, bound)
    const current = new CoordinatorState(backend)
    const round = { ...prepared().round, kind: 'EXECUTED', iteration: 1, sendOperationId: 'send-2', waitOperationId: 'wait-2',
      baseline: { ...baseline, conversationId: 'owned-chat' },
      git: { head: 'a'.repeat(40), upstreamHead: 'a'.repeat(40), branch: 'feature', upstream: 'origin/feature', clean: true, ahead: 0, behind: 0 } }
    const value = { ...bound, state: 'awaiting-review', waitingFor: 'chatgpt-review', round }
    return { current, bound, value }
  }
  it('starts EXECUTED at the accepted PLAN iteration without advancing it', async () => {
    const { current, bound, value } = await review()
    const next = await current.commitTask(taskId, bound.updatedAt, typed(value))
    expect(next.value.iteration).toBe(1)
    expect((next.value as any).round.git.head).toBe('a'.repeat(40))
  })
  it.each(['head', 'clean', 'ahead', 'behind', 'round', 'reused-wait'])('rejects invalid next review %s without replacing the accepted PLAN', async corruption => {
    const { current, bound, value } = await review()
    const next: any = structuredClone(value)
    if (corruption === 'head') next.round.git.upstreamHead = 'b'.repeat(40)
    if (corruption === 'clean') next.round.git.clean = false
    if (corruption === 'ahead' || corruption === 'behind') next.round.git[corruption] = 1
    if (corruption === 'round') { next.round.iteration = 2; next.iteration = 2 }
    if (corruption === 'reused-wait') next.round.waitOperationId = bound.round.waitOperationId
    await expect(current.commitTask(taskId, bound.updatedAt, next)).rejects.toThrow()
    expect(await current.loadTask(taskId)).toEqual(bound)
  })
  it.each(['DONE', 'PLAN'])('accepts same-round %s review with exact submitted HEAD', async state => {
    const { current, bound, value } = await review()
    let snapshot = await current.commitTask(taskId, bound.updatedAt, typed(value))
    for (const phase of ['sending', 'observed-sent', 'awaiting-reply']) snapshot = await current.commitTask(taskId, snapshot.revision,
      typed({ ...snapshot.value, round: { ...(snapshot.value as any).round, phase } }))
    const iteration = state === 'PLAN' ? 2 : 1
    const sections = state === 'PLAN' ? { ACTIONS: 'Fix and retest' } : { SUMMARY: 'Independently verified' }
    const wire = formatPlannerEnvelope({ sender: 'planner', state: state as 'PLAN' | 'DONE', taskId, workspaceId: 'world', iteration, inReplyTo: 1, head: 'a'.repeat(40), sections })
    const result: any = { ...snapshot.value, state: state === 'PLAN' ? 'planned' : 'done', iteration,
      waitingFor: state === 'PLAN' ? 'dsh-execution' : 'none', lastReviewedHead: 'a'.repeat(40),
      round: { ...(snapshot.value as any).round, phase: 'accepted', outcome: {
        digest: createHash('sha256').update(wire).digest('hex'), state, iteration, inReplyTo: 1, head: 'a'.repeat(40), sections,
      } } }
    const saved = await current.commitTask(taskId, snapshot.revision, result)
    expect(saved.value.iteration).toBe(iteration)
    const corrupt: any = structuredClone(result); corrupt.round.outcome.head = 'b'.repeat(40)
    await expect(current.commitTask(taskId, saved.revision, corrupt)).rejects.toThrow()
  })
})
