/**
 * PlannerBridge coordinator using the legacy v1 protocol. Inbound executors
 * invoke use cases; outbound ports provide chat control and durable state.
 * @module orchestrator
 */

import { ProtocolError, StateMachine } from '../protocol/index.ts'
import type { Envelope } from '../protocol/index.ts'
import type { ChatControl } from '../core/ports/chat-control.ts'
import { DuplicateSendGuard } from './legacy-send-guard.ts'
import { extractEnvelopeText } from '../protocol/legacy-reply.ts'
export { CHATGPT_BOOT_PROMPT } from '../protocol/legacy-planner-policy.ts'
import { formatEnvelope, parseEnvelope } from '../protocol/index.ts'
import type { PersistedTask, TaskState } from '../core/model.ts'
import { taskProtocolVersion } from '../core/model.ts'
import type { StateStore } from '../core/ports/state-store.ts'
import { OperationCancelledError, throwIfCancelled } from '../cancellation.ts'

/** Coordinator configuration. */
export interface CoordinatorOptions {
  /** Browser control plane implementation. */
  browser: ChatControl
  /** Revisioned durable task state supplied by the deployment. */
  store: StateStore
  /** Reply wait timeout (default 4 min — ChatGPT thinking time). */
  replyTimeoutMs?: number
  /** Workspace root the coordinator is bound to. */
  workspaceRoot: string
  /** Non-secret workspace identity echoed through D2C replies. */
  workspaceId: string
  /** Hard safety bound for autonomous review/fix rounds. */
  maxIterations?: number
  /** Instructions supplied by inbound deployment composition. */
  plannerInstructions?: string
}

/** Result of starting a task (INIT sent). */
export interface StartResult {
  taskId: string
  sentEnvelope: string
}

/** Result of one ChatGPT round-trip. */
export interface RoundResult {
  taskId: string
  envelope: Envelope
  record: PersistedTask
}

/** The coordinator service published as `chatgptCoordinator`. */
export class ChatGptCoordinator {
  private readonly state: StateStore
  private readonly sendGuard = new DuplicateSendGuard()
  private readonly replyTimeoutMs: number
  private readonly maxIterations: number

  constructor(private readonly options: CoordinatorOptions) {
    this.state = options.store
    this.replyTimeoutMs = options.replyTimeoutMs ?? 4 * 60 * 1000
    this.maxIterations = options.maxIterations ?? 12
  }

  /** Durable state handle (for tools and doctor). */
  get stateHandle(): StateStore {
    return this.state
  }

  /**
   * Start a caller-identified task: open the conversation, persist INIT state,
   * send INIT + boot prompt. Does NOT wait for the plan (the model tool
   * returns; the plan arrives via chatgpt_status polling or review tool).
   */
  async startTask(taskId: string, goal: string, opts: { resumeConversationId?: string; signal?: AbortSignal } = {}): Promise<StartResult> {
    throwIfCancelled(opts.signal)
    if (taskId.trim() === '' || await this.state.loadTask(taskId) !== undefined) throw new Error('TASK_ID_UNAVAILABLE')
    await this.options.browser.ensureReady(opts.signal)
    const conversationId = await this.options.browser.openConversation(opts.resumeConversationId, opts.signal)
    throwIfCancelled(opts.signal)
    const record = new StateMachine().startTask(taskId, goal)
    const persisted: PersistedTask = {
      taskId,
      goal,
      state: record.state as TaskState,
      iteration: record.iteration,
      waitingFor: record.waitingFor,
      conversationId,
      lastReviewedHead: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastError: null,
    }
    await this.state.createTask(persisted)
    const ids = await this.state.listTaskIds()
    if (!ids.includes(taskId)) await this.state.saveTaskIndex([...ids, taskId])
    await this.state.bindWorkspace(this.options.workspaceId, {
      workspaceRoot: this.options.workspaceRoot,
      conversationId,
      lastTaskId: taskId,
    })
    const initEnvelope = [
      this.options.plannerInstructions ?? 'You are the planner and reviewer. Reply using the supplied protocol and identity.',
      '',
      'New task:',
      formatEnvelope({
        state: 'INIT', sender: 'dsh', taskId, iteration: 0,
        headers: { WORKSPACE_ID: this.options.workspaceId }, sections: { GOAL: goal },
      }),
    ].join('\n')
    if (this.sendGuard.isDuplicate(initEnvelope)) {
      throw new ProtocolError('duplicate-send', 'INIT envelope just sent; verify browser state before re-sending')
    }
    await this.options.browser.sendControlMessage(initEnvelope, opts.signal)
    this.sendGuard.record(initEnvelope)
    return { taskId, sentEnvelope: initEnvelope }
  }

  /**
   * Wait for the ChatGPT reply to the latest send and fold it into the
   * machine. Rejects stale/mismatched envelopes (ProtocolError).
   */
  async awaitPlan(taskId: string, signal?: AbortSignal): Promise<RoundResult> {
    throwIfCancelled(signal)
    const snapshot = await this.requireTask(taskId)
    const persisted = snapshot.value
    const machine = this.restoreMachine(persisted)
    const record = machine.get(taskId)
    if (record === undefined || record.waitingFor !== 'chatgpt-plan') {
      throw new ProtocolError('unexpected-reply', `task ${taskId} is not waiting for a plan`)
    }
    const reply = await this.options.browser.waitForReply(this.replyTimeoutMs, signal)
    const envelopeText = extractEnvelopeText(reply.text)
    if (envelopeText === null) {
      throw new ProtocolError('no-marker', 'ChatGPT reply contained no [D2C] envelope')
    }
    const envelope = parseEnvelope(envelopeText, { sender: 'chatgpt' })
    this.validateTaskReply(envelope, taskId)
    this.validateWorkspaceReply(envelope)
    const folded = machine.applyReply(envelope)
    const conversationId = await this.options.browser.currentConversation(signal).catch(error => {
      if (error instanceof OperationCancelledError) throw error
      return undefined
    })
    const merged: typeof persisted = {
      ...persisted,
      conversationId: conversationId ?? persisted.conversationId,
      state: folded.state as TaskState,
      iteration: folded.iteration,
      waitingFor: folded.waitingFor,
    }
    const saved = await this.state.commitTask(taskId, snapshot.revision, merged)
    return { taskId, envelope, record: saved.value }
  }

  /**
   * Mark execution done, advance iteration, send EXECUTED with a machine
   * summary, and wait for ChatGPT's independent review.
   */
  async reportExecuted(taskId: string, summary: {
    changedFiles: string[]
    head: string | null
    testsRecorded: boolean
    note?: string
  }, signal?: AbortSignal): Promise<RoundResult> {
    throwIfCancelled(signal)
    let snapshot = await this.requireTask(taskId)
    const persisted = snapshot.value
    const machine = this.restoreMachine(persisted)
    if (persisted.iteration > this.maxIterations) {
      throw new ProtocolError('iteration-limit', `task ${taskId} exceeded maxIterations=${this.maxIterations}`)
    }
    await this.options.browser.ensureReady(signal)
    await this.options.browser.openConversation(persisted.conversationId ?? undefined, signal)
    const resumingReview = persisted.state === 'executed' && persisted.waitingFor === 'chatgpt-review'
    let reviewHead = persisted.lastReviewedHead
    if (!resumingReview) {
      machine.applyLocal(taskId, 'executing')
      machine.advanceIteration(taskId)
      const record = machine.get(taskId)
      const iteration = record?.iteration ?? persisted.iteration + 1
      const inReplyTo = persisted.iteration
      const envelopeText = formatEnvelope({
        state: 'EXECUTED', sender: 'dsh', taskId, iteration, inReplyTo,
        headers: { WORKSPACE_ID: this.options.workspaceId, ...(summary.head !== null ? { HEAD: summary.head } : {}) },
        sections: {
          RESULT: [
            `Implementation executed by the executor. Changed files: ${summary.changedFiles.length > 0 ? summary.changedFiles.join(', ') : '(none)'}`,
            `Git HEAD: ${summary.head ?? '(no commits)'}`,
            `Tests recorded: ${summary.testsRecorded ? 'yes — verify via test_status MCP tool' : 'no'}`,
            'Independently review via MCP (git_diff, test_status), then reply DONE or PLAN (fix).',
          ].join('\n'),
          ...(summary.note !== undefined ? { NOTE: summary.note } : {}),
        },
      })
      if (this.sendGuard.isDuplicate(envelopeText)) {
        throw new ProtocolError('duplicate-send', 'EXECUTED envelope just sent')
      }
      await this.options.browser.sendControlMessage(envelopeText, signal)
      this.sendGuard.record(envelopeText)
      const sent = machine.applyLocal(taskId, 'executed')
      reviewHead = summary.head
      snapshot = await this.state.commitTask(taskId, snapshot.revision, {
        ...persisted,
        state: sent.state as TaskState,
        iteration: sent.iteration,
        waitingFor: sent.waitingFor,
        lastReviewedHead: reviewHead,
      })
    }
    const reply = await this.options.browser.waitForReply(this.replyTimeoutMs, signal)
    const envelopeReply = extractEnvelopeText(reply.text)
    if (envelopeReply === null) {
      throw new ProtocolError('no-marker', 'ChatGPT review contained no [D2C] envelope')
    }
    const envelope = parseEnvelope(envelopeReply, { sender: 'chatgpt' })
    this.validateTaskReply(envelope, taskId)
    this.validateWorkspaceReply(envelope)
    if (reviewHead !== null && envelope.headers.get('HEAD') !== reviewHead) {
      throw new ProtocolError(
        'review-head-mismatch',
        `ChatGPT review HEAD ${JSON.stringify(envelope.headers.get('HEAD') ?? null)} != executed HEAD ${JSON.stringify(reviewHead)}`,
      )
    }
    const folded = machine.applyReply(envelope)
    const conversationId = await this.options.browser.currentConversation(signal).catch(error => {
      if (error instanceof OperationCancelledError) throw error
      return undefined
    })
    const merged: typeof persisted = {
      ...snapshot.value,
      conversationId: conversationId ?? persisted.conversationId,
      state: folded.state as TaskState,
      iteration: folded.iteration,
      waitingFor: folded.waitingFor,
      lastReviewedHead: reviewHead,
    }
    const saved = await this.state.commitTask(taskId, snapshot.revision, merged)
    return { taskId, envelope, record: saved.value }
  }

  /** Status snapshot for chatgpt_status tool / doctor. */
  async status(taskId: string): Promise<PersistedTask | undefined> {
    return this.state.loadTask(taskId)
  }

  /** Latest task id for the bound workspace (restart recovery entry). */
  async latestTaskId(): Promise<string | undefined> {
    const binding = await this.state.loadWorkspace(this.options.workspaceId)
    return binding?.lastTaskId ?? undefined
  }

  /** Recover after restart/reload: rebind conversation, re-check task. */
  async recover(signal?: AbortSignal): Promise<PersistedTask | undefined> {
    throwIfCancelled(signal)
    const taskId = await this.latestTaskId()
    if (taskId === undefined) return undefined
    const task = await this.state.loadTask(taskId)
    if (task === undefined) return undefined
    this.requireLegacyTask(task)
    this.restoreMachine(task)
    await this.options.browser.ensureReady(signal)
    await this.options.browser.openConversation(task.conversationId ?? undefined, signal)
    return task
  }


  private validateTaskReply(envelope: Envelope, taskId: string): void {
    if (envelope.taskId !== taskId) {
      throw new ProtocolError('task-mismatch', 'reply does not match the awaited task')
    }
  }

  private validateWorkspaceReply(envelope: Envelope): void {
    const expected = this.options.workspaceId
    const actual = envelope.headers.get('WORKSPACE_ID')
    if (actual !== expected) {
      throw new ProtocolError(
        'workspace-mismatch',
        `ChatGPT reply WORKSPACE_ID ${JSON.stringify(actual ?? null)} != expected ${JSON.stringify(expected)}`,
      )
    }
  }

  /** Rebuild the in-memory protocol machine from durable state on demand. */
  private restoreMachine(task: PersistedTask) {
    const machine = new StateMachine()
    machine.restore({
      taskId: task.taskId,
      state: task.state,
      iteration: task.iteration,
      waitingFor: task.waitingFor,
      goal: task.goal,
      updatedAt: task.updatedAt,
    })
    return machine
  }

  private async requireTask(taskId: string) {
    const task = await this.state.loadTaskSnapshot(taskId)
    if (task === undefined) throw new ProtocolError('unknown-task', `task ${taskId} not found in durable state`)
    this.requireLegacyTask(task.value)
    return task
  }

  private requireLegacyTask(task: PersistedTask): void {
    if (taskProtocolVersion(task) !== 1) throw Object.assign(new Error('PROTOCOL_COORDINATOR_UNAVAILABLE'), { code: 'PROTOCOL_COORDINATOR_UNAVAILABLE' })
  }
}
