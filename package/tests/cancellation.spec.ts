import { describe, expect, it } from 'vitest'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import type { BrowserControl } from '../src/browser/adapter.ts'
import { OperationCancelledError } from '../src/cancellation.ts'
import { ChatGptCoordinator } from '../src/orchestrator/coordinator.ts'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import { formatEnvelope } from '../src/protocol/index.ts'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'

describe('caller cancellation', () => {
  it('aborts an in-flight Browser Harness dispatch without classifying it as stale', async () => {
    const controller = new AbortController()
    let providerSignal: AbortSignal | undefined
    let dispatchStarted!: () => void
    const dispatched = new Promise<void>(resolve => { dispatchStarted = resolve })
    const browser = new BrowserHarnessAdapter({
      get: () => ({
        execute: ({ signal }: { signal: AbortSignal }) => {
          providerSignal = signal
          dispatchStarted()
          return new Promise(() => {})
        },
      }),
    } as never, undefined, '')
    const pending = browser.ensureReady(controller.signal)
    await dispatched
    expect(providerSignal?.aborted).toBe(false)
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError)
    expect(providerSignal?.aborted).toBe(true)
  })

  it('stops reply polling before the next browser inspection', async () => {
    const controller = new AbortController()
    const browser = new BrowserHarnessAdapter({ get: () => { throw new Error('unexpected browser call') } } as never, undefined, '')
    const pending = browser.waitForReply(60_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError)
  })

  it('does not retract a successful final browser press when the caller aborts immediately afterward', async () => {
    const controller = new AbortController()
    const browser = new BrowserHarnessAdapter({
      get: () => ({
        execute: ({ name }: { name: string }) => {
          if (name.endsWith('browser_js')) {
            return Promise.resolve({ value: { text: '', assistantCount: 0, streaming: false, loggedOut: false, composer: true } })
          }
          if (name.endsWith('browser_press')) {
            return new Promise(resolve => {
              resolve({ value: {} })
              controller.abort()
            })
          }
          return Promise.resolve({ value: {} })
        },
      }),
    } as never, undefined, '')
    await expect(browser.sendControlMessage('EXECUTED', controller.signal)).resolves.toBeUndefined()
    expect(controller.signal.aborted).toBe(true)
  })

  it('keeps PLAN resumable and does not resend EXECUTED after cancelling REVIEW', async () => {
    const state = new CoordinatorState(createMemoryStore())
    const sent: string[] = []
    let reply: ((signal?: AbortSignal) => Promise<{ text: string; complete: true }>) | undefined
    const browser: BrowserControl = {
      async ensureReady() {},
      async openConversation(id) { return id ?? 'conversation' },
      async sendControlMessage(text) { sent.push(text) },
      async waitForReply(_timeout, signal) { return await reply!(signal) },
      async health() { return { ok: true, detail: 'ready' } },
      async conversationId() { return 'conversation' },
      async recover() {},
    }
    const makeCoordinator = () => new ChatGptCoordinator({ workspaceId: 'test-workspace', browser, store: state, workspaceRoot: 'workspace', replyTimeoutMs: 60_000 })
    const coordinator = makeCoordinator()
    const started = await coordinator.startTask('test cancellation')
    const planController = new AbortController()
    reply = signal => new Promise((_, reject) => {
      if (signal?.aborted) reject(new OperationCancelledError())
      else signal?.addEventListener('abort', () => reject(new OperationCancelledError()), { once: true })
    })
    const pendingPlan = coordinator.awaitPlan(started.taskId, planController.signal)
    planController.abort()
    await expect(pendingPlan).rejects.toBeInstanceOf(OperationCancelledError)
    expect((await state.loadTask(started.taskId))?.waitingFor).toBe('chatgpt-plan')

    reply = async () => ({ text: formatEnvelope({ headers: { WORKSPACE_ID: 'test-workspace' },
      state: 'PLAN', sender: 'chatgpt', taskId: started.taskId, iteration: 1, inReplyTo: 0,
      sections: { ACTIONS: 'Execute focused tests.' },
    }), complete: true })
    expect((await coordinator.awaitPlan(started.taskId)).record.state).toBe('planned')

    const reviewController = new AbortController()
    let reviewWaitStarted!: () => void
    const reviewWait = new Promise<void>(resolve => { reviewWaitStarted = resolve })
    reply = signal => new Promise((_, reject) => {
      reviewWaitStarted()
      if (signal?.aborted) reject(new OperationCancelledError())
      else signal?.addEventListener('abort', () => reject(new OperationCancelledError()), { once: true })
    })
    const pendingReview = coordinator.reportExecuted(started.taskId, {
      changedFiles: ['src/example.ts'], head: 'head123', testsRecorded: true,
    }, reviewController.signal)
    await reviewWait
    reviewController.abort()
    await expect(pendingReview).rejects.toBeInstanceOf(OperationCancelledError)
    expect(await state.loadTask(started.taskId)).toMatchObject({
      state: 'executed', iteration: 2, waitingFor: 'chatgpt-review', lastReviewedHead: 'head123',
    })

    reply = async () => ({ text: formatEnvelope({
      state: 'DONE', sender: 'chatgpt', taskId: started.taskId, iteration: 2, inReplyTo: 2,
      headers: { HEAD: 'head123', WORKSPACE_ID: 'test-workspace' }, sections: { SUMMARY: 'Reviewed.' },
    }), complete: true })
    const completed = await makeCoordinator().reportExecuted(started.taskId, {
      changedFiles: [], head: 'different-caller-head', testsRecorded: false,
    })
    expect(completed.record.state).toBe('done')
    expect(completed.record.lastReviewedHead).toBe('head123')
    expect(sent).toHaveLength(2)
  })

  it('persists the sent review posture even when cancellation follows browser success', async () => {
    const state = new CoordinatorState(createMemoryStore())
    const controller = new AbortController()
    let taskId = ''
    let sendCount = 0
    const browser: BrowserControl = {
      async ensureReady() {},
      async openConversation(id) { return id ?? 'conversation' },
      async sendControlMessage(text) {
        sendCount++
        if (text.includes('STATE: EXECUTED')) controller.abort()
      },
      async waitForReply(_timeout, signal) {
        if (signal?.aborted) throw new OperationCancelledError()
        return { text: formatEnvelope({ headers: { WORKSPACE_ID: 'test-workspace' },
          state: 'PLAN', sender: 'chatgpt', taskId, iteration: 1, inReplyTo: 0,
          sections: { ACTIONS: 'Execute.' },
        }), complete: true }
      },
      async health() { return { ok: true, detail: 'ready' } },
      async conversationId() { return 'conversation' },
      async recover() {},
    }
    const coordinator = new ChatGptCoordinator({ workspaceId: 'test-workspace', browser, store: state, workspaceRoot: 'workspace' })
    taskId = (await coordinator.startTask('boundary')).taskId
    await coordinator.awaitPlan(taskId)
    await expect(coordinator.reportExecuted(taskId, {
      changedFiles: [], head: 'sent-head', testsRecorded: true,
    }, controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
    expect(await state.loadTask(taskId)).toMatchObject({
      state: 'executed', iteration: 2, waitingFor: 'chatgpt-review', lastReviewedHead: 'sent-head',
    })
    expect(sendCount).toBe(2)
  })

  it('rejects a pre-cancelled external tunnel ensure without changing lifecycle', async () => {
    const supervisor = new TunnelSupervisor({
      mode: 'external', clientPath: 'unused', tunnelIdEnv: 'UNUSED_TUNNEL',
      runtimeApiKeyEnv: 'UNUSED_KEY', startupTimeoutMs: 1000, stateDir: 'unused',
    })
    const controller = new AbortController()
    controller.abort()
    await expect(supervisor.ensure({ workspaceId: 'ws', localUrl: 'http://127.0.0.1/mcp', bearerValueFile: 'unused' }, controller.signal))
      .rejects.toBeInstanceOf(OperationCancelledError)
  })
})
