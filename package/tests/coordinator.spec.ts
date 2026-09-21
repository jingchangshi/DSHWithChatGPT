import { describe, expect, it } from 'vitest'
import { ChatGptCoordinator, CHATGPT_BOOT_PROMPT } from '../src/orchestrator/coordinator.ts'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import { parseEnvelope, formatEnvelope, ProtocolError } from '../src/protocol/index.ts'
import { BrowserStaleError, type BrowserControl, type BrowserReply } from '../src/browser/index.ts'

/** Scripted fake browser: queued replies, duplicate-send aware. */
function fakeBrowser(replies: string[]): BrowserControl & { sent: string[] } {
  const sent: string[] = []
  let replyIndex = 0
  return {
    sent,
    async ensureReady() {},
    async openConversation(id) {
      return id ?? 'conv-1'
    },
    async sendControlMessage(text) {
      if (sent.includes(text)) throw new BrowserStaleError('duplicate send detected by fake browser')
      sent.push(text)
    },
    async waitForReply(): Promise<BrowserReply> {
      const text = replies[replyIndex] ?? ''
      replyIndex++
      return { text, complete: true }
    },
    async health() {
      return { ok: true, detail: 'fake' }
    },
    async conversationId() {
      return 'conv-1'
    },
    async recover() {},
  }
}

function planReply(taskId: string, iteration: number, inReplyTo: number, workspaceId?: string): string {
  return 'I inspected the workspace via MCP. My plan:\n' + formatEnvelope({
    state: 'PLAN', sender: 'chatgpt', taskId, iteration, inReplyTo,
    ...(workspaceId !== undefined ? { headers: { WORKSPACE_ID: workspaceId } } : {}),
    sections: { ACTIONS: '1. Add function\n2. Add tests' },
  }) + '\nReady for execution.'
}

function doneReply(
  taskId: string,
  iteration: number,
  inReplyTo: number,
  head = 'abc123',
  workspaceId?: string,
): string {
  return 'I verified the diff and test records myself.\n' + formatEnvelope({
    state: 'DONE', sender: 'chatgpt', taskId, iteration, inReplyTo,
    headers: { HEAD: head, ...(workspaceId !== undefined ? { WORKSPACE_ID: workspaceId } : {}) },
    sections: { SUMMARY: 'Verified via git_diff + test_status.' },
  })
}

function makeCoordinator(replies: string[]): { coordinator: ChatGptCoordinator; browser: ReturnType<typeof fakeBrowser>; taskIdSeed: () => string } {
  const browser = fakeBrowser(replies)
  const coordinator = new ChatGptCoordinator({
    browser,
    store: new CoordinatorState(createMemoryStore()),
    workspaceRoot: 'C:\\ws\\demo',
    replyTimeoutMs: 1000,
  })
  return { coordinator, browser, taskIdSeed: () => 'x' }
}

describe('coordinator happy path', () => {
  it('runs INIT → PLAN → EXECUTED → DONE with durable state', async () => {
    // Note: taskId is minted inside startTask, so replies must be produced
    // lazily. We run startTask first, capture the id from sent INIT, then
    // queue matching replies. Simplest: derive from the sent message.
    const browser = fakeBrowser([])
    const coordinator = new ChatGptCoordinator({
      browser,
      store: new CoordinatorState(createMemoryStore()),
      workspaceRoot: 'C:\\ws\\demo',
      replyTimeoutMs: 500,
    })
    // Patch waitForReply to fabricate replies based on the last send.
    const dynamic = coordinator as unknown as { options: { browser: BrowserControl } }
    let taskId = ''
    let round = 0
    dynamic.options.browser.waitForReply = async () => {
      round++
      if (round === 1) {
        // Plan arrives before we know the id inside this closure; the send
        // interceptor captured it before waitForReply is called.
        return { text: planReply(taskId, 1, 0), complete: true }
      }
      return { text: doneReply(taskId, 2, 2), complete: true }
    }
    // Start with a placeholder: we need the real id before the reply parse.
    // Send INIT manually via startTask, but intercept the id first:
    const originalSend = dynamic.options.browser.sendControlMessage.bind(dynamic.options.browser)
    dynamic.options.browser.sendControlMessage = async (text: string) => {
      const match = /TASK_ID: (d2c_[0-9a-z]+)/.exec(text)
      if (match?.[1] !== undefined) taskId = match[1]
      await originalSend(text)
    }
    const started = await coordinator.startTask('add a multiply function')
    taskId = started.taskId
    const plan = await coordinator.awaitPlan(started.taskId)
    expect(plan.envelope.state).toBe('PLAN')
    expect(plan.record.state).toBe('planned')
    const review = await coordinator.reportExecuted(started.taskId, {
      changedFiles: ['src/mul.ts'],
      head: 'abc123',
      testsRecorded: true,
    })
    expect(review.envelope.state).toBe('DONE')
    expect(review.record.state).toBe('done')
    expect(review.record.lastReviewedHead).toBe('abc123')
    const status = await coordinator.status(started.taskId)
    expect(status?.state).toBe('done')
    // INIT and EXECUTED were sent, plus boot prompt on INIT.
    expect(browser.sent[0]).toContain(CHATGPT_BOOT_PROMPT)
    expect(browser.sent[1]).toContain('STATE: EXECUTED')
    expect(browser.sent[1]).toContain('verify via test_status')
  })
})

describe('coordinator review integrity', () => {
  it('rejects a review that does not acknowledge the executed HEAD', async () => {
    const browser = fakeBrowser([])
    const coordinator = new ChatGptCoordinator({
      browser,
      store: new CoordinatorState(createMemoryStore()),
      workspaceRoot: 'C:\\ws\\head-check',
      replyTimeoutMs: 500,
    })
    let taskId = ''
    let round = 0
    browser.sendControlMessage = async (text: string) => {
      const match = /TASK_ID: (d2c_[0-9a-z]+)/.exec(text)
      if (match?.[1] !== undefined) taskId = match[1]
      browser.sent.push(text)
    }
    browser.waitForReply = async () => {
      round++
      if (round === 1) return { text: planReply(taskId, 1, 0), complete: true }
      return { text: doneReply(taskId, 2, 2, 'stale-head'), complete: true }
    }

    const started = await coordinator.startTask('verify exact head')
    await coordinator.awaitPlan(started.taskId)
    await expect(coordinator.reportExecuted(started.taskId, {
      changedFiles: ['src/a.ts'],
      head: 'expected-head',
      testsRecorded: true,
    })).rejects.toThrow(/review-head-mismatch/)
    expect((await coordinator.status(started.taskId))?.lastReviewedHead).toBeNull()
  })
})

describe('coordinator workspace binding', () => {
  it('requires ChatGPT to echo the exact workspace id', async () => {
    const browser = fakeBrowser([])
    const workspaceId = 'ws_0123456789abcdef'
    const coordinator = new ChatGptCoordinator({
      browser,
      store: new CoordinatorState(createMemoryStore()),
      workspaceRoot: 'C:\\ws\\bound',
      workspaceId,
      replyTimeoutMs: 500,
    })
    let taskId = ''
    browser.sendControlMessage = async (text: string) => {
      const match = /TASK_ID: (d2c_[0-9a-z]+)/.exec(text)
      if (match?.[1] !== undefined) taskId = match[1]
      browser.sent.push(text)
    }
    browser.waitForReply = async () => ({
      text: planReply(taskId, 1, 0, 'ws_wrongworkspace0'),
      complete: true,
    })

    const started = await coordinator.startTask('bound task')
    expect(browser.sent[0]).toContain('WORKSPACE_ID: ' + workspaceId)
    await expect(coordinator.awaitPlan(started.taskId)).rejects.toThrow(/workspace-mismatch/)
  })

  it('accepts a matching workspace id', async () => {
    const browser = fakeBrowser([])
    const workspaceId = 'ws_0123456789abcdef'
    const coordinator = new ChatGptCoordinator({
      browser,
      store: new CoordinatorState(createMemoryStore()),
      workspaceRoot: 'C:\\ws\\bound-ok',
      workspaceId,
      replyTimeoutMs: 500,
    })
    let taskId = ''
    browser.sendControlMessage = async (text: string) => {
      const match = /TASK_ID: (d2c_[0-9a-z]+)/.exec(text)
      if (match?.[1] !== undefined) taskId = match[1]
      browser.sent.push(text)
    }
    browser.waitForReply = async () => ({
      text: planReply(taskId, 1, 0, workspaceId),
      complete: true,
    })
    const started = await coordinator.startTask('bound task')
    expect((await coordinator.awaitPlan(started.taskId)).record.state).toBe('planned')
  })
})

describe('coordinator autonomous safety bound', () => {
  it('stops review loops at maxIterations', async () => {
    const browser = fakeBrowser([])
    const coordinator = new ChatGptCoordinator({
      browser,
      store: new CoordinatorState(createMemoryStore()),
      workspaceRoot: 'C:\\ws\\bounded-loop',
      maxIterations: 1,
      replyTimeoutMs: 500,
    })
    let taskId = ''
    browser.sendControlMessage = async (text: string) => {
      const match = /TASK_ID: (d2c_[0-9a-z]+)/.exec(text)
      if (match?.[1] !== undefined) taskId = match[1]
      browser.sent.push(text)
    }
    let reviewCount = 0
    browser.waitForReply = async () => {
      reviewCount++
      if (reviewCount === 1) return { text: planReply(taskId, 1, 0), complete: true }
      return { text: planReply(taskId, 2, 2), complete: true }
    }

    const started = await coordinator.startTask('bounded loop')
    await coordinator.awaitPlan(started.taskId)
    const firstReview = await coordinator.reportExecuted(started.taskId, {
      changedFiles: ['src/a.ts'],
      head: null,
      testsRecorded: true,
    })
    expect(firstReview.record.state).toBe('planned')
    await expect(coordinator.reportExecuted(started.taskId, {
      changedFiles: ['src/a.ts'],
      head: null,
      testsRecorded: true,
    })).rejects.toThrow(/iteration-limit/)
  })
})

describe('coordinator rejects stale replies', () => {
  it('a reply with an old iteration is rejected and state unchanged', async () => {
    const browser = fakeBrowser([])
    const coordinator = new ChatGptCoordinator({
      browser,
      store: new CoordinatorState(createMemoryStore()),
      workspaceRoot: 'C:\\ws\\demo',
      replyTimeoutMs: 500,
    })
    let taskId = ''
    let round = 0
    const dynamic = coordinator as unknown as { options: { browser: BrowserControl } }
    dynamic.options.browser.waitForReply = async () => {
      round++
      if (round === 1) {
        // Round 1: a valid plan at iteration 1 (IN_REPLY_TO 0) → machine moves
        // to planned at iteration 1.
        return { text: planReply(taskId, 1, 0), complete: true }
      }
      // Round 2: a SECOND plan pretending to answer an older round
      // (iteration 1, IN_REPLY_TO 0) — stale, because the machine is already
      // at iteration 1 and waiting for execution, and even if it were
      // waiting, replaying an answered round is stale. Drive that through a
      // fresh plan reply for the same round.
      return { text: planReply(taskId, 1, 0), complete: true }
    }
    dynamic.options.browser.sendControlMessage = async (text: string) => {
      const match = /TASK_ID: (d2c_[0-9a-z]+)/.exec(text)
      if (match?.[1] !== undefined) taskId = match[1]
      browser.sent.push(text)
    }
    const started = await coordinator.startTask('g')
    taskId = started.taskId
    const plan = await coordinator.awaitPlan(started.taskId)
    expect(plan.record.state).toBe('planned')
    // The task now waits for DSH execution; a replayed plan reply is
    // unexpected (machine no longer waiting on ChatGPT).
    await expect(coordinator.awaitPlan(started.taskId)).rejects.toThrow(ProtocolError)
    const status = await coordinator.status(started.taskId)
    expect(status?.state).toBe('planned')
  })

  it('duplicate INIT send is blocked', async () => {
    const replies: string[] = []
    const { coordinator } = makeCoordinator(replies)
    const browser = fakeBrowser([])
    const coordinator2 = new ChatGptCoordinator({
      browser,
      store: new CoordinatorState(createMemoryStore()),
      workspaceRoot: 'C:\\ws\\demo',
      replyTimeoutMs: 500,
    })
    await coordinator2.startTask('g')
    // Manually re-send the same text through the browser: fake throws.
    await expect(browser.sendControlMessage(browser.sent[0])).rejects.toThrow(/duplicate/)
    expect(replies).toHaveLength(0)
  })
})

describe('state recovery', () => {
  it('can continue a waiting plan after coordinator restart', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const browser = fakeBrowser([])
    let taskId = ''
    const first = new ChatGptCoordinator({ browser, store, workspaceRoot: 'C:\\ws\\resume', replyTimeoutMs: 500 })
    const originalSend = browser.sendControlMessage.bind(browser)
    browser.sendControlMessage = async (text: string) => {
      const match = /TASK_ID: (d2c_[0-9a-z]+)/.exec(text)
      if (match?.[1] !== undefined) taskId = match[1]
      await originalSend(text)
    }
    const started = await first.startTask('resume me')
    taskId = started.taskId

    const second = new ChatGptCoordinator({ browser, store, workspaceRoot: 'C:\\ws\\resume', replyTimeoutMs: 500 })
    await second.recover()
    browser.waitForReply = async () => ({ text: planReply(taskId, 1, 0), complete: true })
    const plan = await second.awaitPlan(taskId)
    expect(plan.record.state).toBe('planned')
    expect(plan.record.conversationId).toBe('conv-1')
  })

  it('survives a coordinator restart with the same store', async () => {
    const store = new CoordinatorState(createMemoryStore())
    const browser = fakeBrowser([])
    const first = new ChatGptCoordinator({ browser, store, workspaceRoot: 'C:\\ws\\r', replyTimeoutMs: 500 })
    const started = await first.startTask('task across restarts')
    // "Restart": new coordinator instance over the same store.
    const second = new ChatGptCoordinator({ browser, store, workspaceRoot: 'C:\\ws\\r', replyTimeoutMs: 500 })
    const recovered = await second.recover()
    expect(recovered?.taskId).toBe(started.taskId)
    expect(recovered?.state).toBe('awaiting-plan')
    const latest = await second.latestTaskId()
    expect(latest).toBe(started.taskId)
  })
})
