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
    const saved = result.record as any
    expect(saved.state).toBe('planned')
    expect(saved.round.phase).toBe('accepted')
    expect(saved.round.outcome.sections.ACTIONS).toBe('Implement and test')
    expect(saved.round.outcome.digest).toMatch(/^[a-f0-9]{64}$/)
  })
})
