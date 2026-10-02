import { describe, expect, it } from 'vitest'
import { ChatGptCoordinator } from '../src/orchestrator/coordinator.ts'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import type { ChatSendObservationControl, ControlOperation, ReplyObservationBaseline } from '../src/core/ports/chat-control.ts'
import { formatPlannerEnvelope } from '../src/protocol/planner-envelope.ts'

const baseline: ReplyObservationBaseline = {
  version: 1, conversationId: null, assistantCount: 0,
  textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64),
}

function browser() {
  const sent: Array<{ text: string; operation?: ControlOperation }> = []
  const value: ChatSendObservationControl & { sent: typeof sent } = {
    sent,
    async health() { return { ok: true, detail: 'fake' } },
    async ensureReady() {},
    async openConversation(id) { return id ?? 'owned-chat' },
    async sendControlMessage(text, _signal, operation) { sent.push({ text, operation }) },
    async waitForReply() { return { text: '', complete: true } },
    async recover() {},
    async currentConversation() { return 'owned-chat' },
    async captureReplyBaseline() { return baseline },
    async captureSendObservation() { return { ...baseline, conversationId: 'owned-chat' } },
    async reconcileReplyBaseline() { return { ...baseline, conversationId: 'owned-chat' } },
  }
  return value
}

function make(options: { canonicalProtocol?: boolean } = {}) {
  const b = browser()
  const c = new ChatGptCoordinator({
    browser: b, store: new CoordinatorState(createMemoryStore()),
    workspaceRoot: 'C:\\ws\\canonical', workspaceId: 'world', ...options,
  })
  return { c, b }
}

describe('canonical coordinator v2 creation gate', () => {
  it('recovers an ACK-to-aggregate publication failure using the same source without resending', async () => {
    const { c, b } = make({ canonicalProtocol: true })
    const taskId = 'pb_' + '9'.repeat(32)
    const store = c.stateHandle
    const commit = store.commitTask.bind(store)
    let failBinding = true
    store.commitTask = async (id, revision, value) => {
      if (failBinding && (value as any).round?.phase === 'observed-sent') throw new Error('publication crash')
      return commit(id, revision, value)
    }
    await expect(c.startCanonicalTask(taskId, 'crash')).rejects.toThrow('publication crash')
    const pending = (await store.loadTask(taskId)) as any
    expect(pending.round.phase).toBe('sending')
    expect(pending.conversationId).toBeNull()
    failBinding = false
    const restarted = new ChatGptCoordinator({ browser: b, store, workspaceRoot: 'C:\\ws\\canonical', workspaceId: 'world', canonicalProtocol: true })
    const recovered = await restarted.recover() as any
    expect(recovered.taskId).toBe(taskId)
    expect(recovered.round.phase).toBe('observed-sent')
    expect(recovered.round.sendOperationId).toBe(pending.round.sendOperationId)
    expect(recovered.conversationId).toBe('owned-chat')
    expect(b.sent).toHaveLength(1)
  })
  it('does not publish a late bootstrap proof after caller cancellation', async () => {
    const { c, b } = make({ canonicalProtocol: true })
    const abort = new AbortController()
    const taskId = 'pb_' + '6'.repeat(32)
    b.captureSendObservation = async () => {
      abort.abort()
      return { ...baseline, conversationId: 'owned-chat' }
    }
    await expect(c.startCanonicalTask(taskId, 'cancel', { signal: abort.signal })).rejects.toThrow()
    const saved = await c.status(taskId) as any
    expect(saved.conversationId).toBeNull()
    expect(saved.round.phase).toBe('sending')
    expect(b.sent).toHaveLength(1)
  })

  it('resumes an uncertain wait with a fresh epoch while preserving original intent', async () => {
    const { c, b } = make({ canonicalProtocol: true })
    const taskId = 'pb_' + '7'.repeat(32)
    await c.startCanonicalTask(taskId, 'resume')
    const snapshot = (await c.stateHandle.loadTaskSnapshot(taskId))!
    const pending = snapshot.value as any
    await c.stateHandle.commitTask(taskId, snapshot.revision, { ...pending, round: { ...pending.round, phase: 'uncertain' } })
    const fence = structuredClone(pending.round.baseline)
    ;(b as any).reconcileReplyBaseline = async () => ({ ...fence, observationEpoch: 'f'.repeat(64) })
    b.waitForReply = async () => ({ complete: true, text: formatPlannerEnvelope({
      sender: 'planner', state: 'PLAN', taskId, iteration: 1, inReplyTo: 0,
      workspaceId: 'world', sections: { ACTIONS: 'Resume without resending' },
    }) })
    await c.awaitPlan(taskId)
    const saved = await c.status(taskId) as any
    expect(saved.round.baseline).toEqual(fence)
    expect(saved.round.phase).toBe('accepted')
    expect(b.sent).toHaveLength(1)
  })

  it.each(['conversationId', 'assistantCount', 'textDigest'])('rejects changed %s in uncertain recovery before wait or publication', async field => {
    const { c, b } = make({ canonicalProtocol: true })
    const taskId = 'pb_' + '8'.repeat(32)
    await c.startCanonicalTask(taskId, 'resume')
    const snapshot = (await c.stateHandle.loadTaskSnapshot(taskId))!
    const value = snapshot.value as any
    const uncertain = await c.stateHandle.commitTask(taskId, snapshot.revision, {
      ...value, round: { ...value.round, phase: 'uncertain' },
    })
    ;(b as any).reconcileReplyBaseline = async () => ({ ...value.round.baseline,
      [field]: field === 'assistantCount' ? 1 : field === 'conversationId' ? 'foreign-chat' : 'f'.repeat(64) })
    let waits = 0
    b.waitForReply = async () => { waits++; throw new Error('unexpected wait') }
    await expect(c.awaitPlan(taskId)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(await c.stateHandle.loadTaskSnapshot(taskId)).toEqual(uncertain)
    expect(waits).toBe(0)
    expect(b.sent).toHaveLength(1)
  })

  it('keeps the released v1 start path as the default', async () => {
    const { c } = make()
    const result = await c.startTask('d2c_1abc', 'legacy')
    expect(result.taskId).toBe('d2c_1abc')
    expect((await c.status(result.taskId))?.protocolVersion).toBeUndefined()
  })

  it('requires explicit opt-in before creating a canonical aggregate', async () => {
    const { c } = make()
    await expect(c.startCanonicalTask('pb_' + '1'.repeat(32), 'canonical'))
      .rejects.toMatchObject({ code: 'CANONICAL_PROTOCOL_DISABLED' })
  })

  it('persists prepared intent before sending and correlates the semantic operation', async () => {
    const { c, b } = make({ canonicalProtocol: true })
    const taskId = 'pb_' + '2'.repeat(32)
    const result = await c.startCanonicalTask(taskId, 'canonical')
    const saved = await c.status(taskId) as any
    expect(saved.protocolVersion).toBe(2)
    expect(saved.round.phase).toBe('observed-sent')
    expect(saved.round.sendOperationId).toBeTruthy()
    expect(saved.round.waitOperationId).toBeTruthy()
    expect(b.sent).toHaveLength(1)
    expect(b.sent[0]?.operation?.correlation).toEqual({
      taskId, iteration: 0, workspaceId: 'world', phase: 'INIT',
    })
    expect(result.sentEnvelope).toContain('TASK_ID: ' + taskId)
    expect(saved.conversationId).toBe('owned-chat')
  })

  it('moves the same aggregate through wait and atomically accepts the PLAN', async () => {
    const { c, b } = make({ canonicalProtocol: true })
    const taskId = 'pb_' + '3'.repeat(32)
    await c.startCanonicalTask(taskId, 'canonical')
    b.waitForReply = async (_timeout, _signal, operation) => {
      expect(operation?.replyRecovery?.sendOperationId).toBe((await c.status(taskId) as any).round.sendOperationId)
      return { complete: true, text: formatPlannerEnvelope({ sender: 'planner', state: 'PLAN', taskId, iteration: 1,
        inReplyTo: 0, workspaceId: 'world', sections: { ACTIONS: 'Implement and test' } }) }
    }
    const result = await c.awaitPlan(taskId)
    expect(result.envelope).toMatchObject({ version: 2, sender: 'planner' })
    const saved = result.record as any
    expect(saved.state).toBe('planned')
    expect(saved.round.phase).toBe('accepted')
    expect(saved.round.outcome.sections.ACTIONS).toBe('Implement and test')
    expect(saved.round.outcome.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('recovers a bound canonical task without sending and rejects an unbound bootstrap route', async () => {
    const { c, b } = make({ canonicalProtocol: true })
    const taskId = 'pb_' + '4'.repeat(32)
    await c.startCanonicalTask(taskId, 'canonical')
    const recovered = await c.recover()
    expect(recovered?.taskId).toBe(taskId)
    expect(b.sent).toHaveLength(1)

    const unbound = make({ canonicalProtocol: true })
    const pending: any = {
      protocolVersion: 2, taskId: 'pb_' + '5'.repeat(32), workspaceId: 'world', goal: 'pending',
      state: 'awaiting-plan', iteration: 0, waitingFor: 'chatgpt-plan', conversationId: null,
      lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null,
      round: { kind: 'INIT', iteration: 0, sendOperationId: 'send-pending', waitOperationId: 'wait-pending',
        controlDigest: 'c'.repeat(64), baseline, phase: 'prepared' },
    }
    const created = await unbound.c.stateHandle.createTask(pending)
    await unbound.c.stateHandle.commitTask(pending.taskId, created.revision, { ...pending, round: { ...pending.round, phase: 'sending' } })
    await unbound.c.stateHandle.bindWorkspace('world', { workspaceRoot: 'C:\\ws\\canonical', conversationId: null, lastTaskId: pending.taskId })
    unbound.b.captureSendObservation = async () => { throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }) }
    await expect(unbound.c.recover()).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(unbound.b.sent).toHaveLength(0)
  })
})
