/**
 * The D2C coordinator: drives INIT → PLAN → EXECUTED → REVIEW → DONE with
 * the state machine, browser control plane, and durable state. GLM (the DSH
 * agent) drives this service through model-facing tools; ChatGPT only ever
 * answers through the browser and reads through the read-only MCP bridge.
 * @module orchestrator
 */

import { ProtocolError, StateMachine, mintTaskId } from '../protocol/index.ts'
import type { Envelope } from '../protocol/index.ts'
import type { BrowserControl } from '../browser/index.ts'
import { DuplicateSendGuard, extractEnvelopeText } from '../browser/index.ts'
import { parseEnvelope } from '../protocol/index.ts'
import { CoordinatorState, createMemoryStore, type PersistedTask, type TaskState } from './state.ts'

/** Coordinator configuration. */
export interface CoordinatorOptions {
  /** Browser control plane implementation. */
  browser: BrowserControl
  /** Durable state backing (Cordis storage table). */
  store?: CoordinatorState
  /** Reply wait timeout (default 4 min — ChatGPT thinking time). */
  replyTimeoutMs?: number
  /** Workspace root the coordinator is bound to. */
  workspaceRoot: string
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

/** Boot prompt injected into the ChatGPT conversation on INIT. */
export const CHATGPT_BOOT_PROMPT = [
  'You are the planning/review layer of a DeepSeek Harness coding session ("DSH with ChatGPT").',
  'DeepSeek Harness / GLM owns ALL execution: edits, shell, tests, git. You own architecture reasoning, planning, review, and debugging strategy.',
  'You read the workspace yourself through the "DSH with ChatGPT" MCP connector (read-only): git_status, git_diff, read_file, search_workspace, test_status, execution_summary.',
  'Rules:',
  '1. Never ask DSH to paste files or diffs you can read via MCP.',
  '2. Read only what the current task needs.',
  '3. Before PLAN, inspect the relevant code via MCP.',
  '4. After EXECUTED, independently verify with git_diff + test_status; never trust prose claims like "tests pass".',
  '5. Never request workspace write operations; you have none.',
  '6. Plans are WHAT/WHY, never HOW bindings; GLM decides implementation.',
  '7. Answer ONLY through a [D2C] envelope with the correct STATE, TASK_ID, ITERATION and IN_REPLY_TO headers.',
  '8. PLAN replies iterate on the plan instead of infinite TODO lists; DONE means you verified the result.',
].join('\n')

/** The coordinator service published as `chatgptCoordinator`. */
export class ChatGptCoordinator {
  private readonly machine = new StateMachine()
  private readonly state: CoordinatorState
  private readonly sendGuard = new DuplicateSendGuard()
  private readonly replyTimeoutMs: number

  constructor(private readonly options: CoordinatorOptions) {
    this.state = options.store ?? new CoordinatorState(createMemoryStore())
    this.replyTimeoutMs = options.replyTimeoutMs ?? 4 * 60 * 1000
  }

  /** Durable state handle (for tools and doctor). */
  get stateHandle(): CoordinatorState {
    return this.state
  }

  /**
   * Start a task: mint id, persist INIT state, open/reuse the conversation,
   * send INIT + boot prompt. Does NOT wait for the plan (the model tool
   * returns; the plan arrives via chatgpt_status polling or review tool).
   */
  async startTask(goal: string, opts: { resumeConversationId?: string } = {}): Promise<StartResult> {
    await this.options.browser.ensureReady()
    const conversationId = await this.options.browser.openConversation(opts.resumeConversationId)
    const taskId = mintTaskId()
    const record = this.machine.startTask(taskId, goal)
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
    await this.state.saveTask(persisted)
    const ids = await this.state.listTaskIds()
    if (!ids.includes(taskId)) await this.state.saveTaskIndex([...ids, taskId])
    await this.state.bindWorkspace(this.options.workspaceRoot, {
      workspaceRoot: this.options.workspaceRoot,
      conversationId,
      lastTaskId: taskId,
    })
    const initEnvelope = [
      CHATGPT_BOOT_PROMPT,
      '',
      'New task:',
      '[D2C]',
      'VERSION: 1',
      'STATE: INIT',
      `TASK_ID: ${taskId}`,
      'ITERATION: 0',
      '',
      'GOAL:',
      goal,
    ].join('\n')
    if (this.sendGuard.isDuplicate(initEnvelope)) {
      throw new ProtocolError('duplicate-send', 'INIT envelope just sent; verify browser state before re-sending')
    }
    await this.options.browser.sendControlMessage(initEnvelope)
    this.sendGuard.record(initEnvelope)
    return { taskId, sentEnvelope: initEnvelope }
  }

  /**
   * Wait for the ChatGPT reply to the latest send and fold it into the
   * machine. Rejects stale/mismatched envelopes (ProtocolError).
   */
  async awaitPlan(taskId: string): Promise<RoundResult> {
    const persisted = await this.requireTask(taskId)
    const record = this.restoreMachine(persisted)
    if (record === undefined || record.waitingFor !== 'chatgpt-plan') {
      throw new ProtocolError('unexpected-reply', `task ${taskId} is not waiting for a plan`)
    }
    const reply = await this.options.browser.waitForReply(this.replyTimeoutMs)
    const envelopeText = extractEnvelopeText(reply.text)
    if (envelopeText === null) {
      throw new ProtocolError('no-marker', 'ChatGPT reply contained no [D2C] envelope')
    }
    const envelope = parseEnvelope(envelopeText, { sender: 'chatgpt' })
    const folded = this.machine.applyReply(envelope)
    const conversationId = await this.options.browser.conversationId().catch(() => undefined)
    const merged: typeof persisted = {
      ...persisted,
      conversationId: conversationId ?? persisted.conversationId,
      state: folded.state as TaskState,
      iteration: folded.iteration,
      waitingFor: folded.waitingFor,
    }
    await this.state.saveTask(merged)
    return { taskId, envelope, record: merged }
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
  }): Promise<RoundResult> {
    const persisted = await this.requireTask(taskId)
    this.restoreMachine(persisted)
    this.machine.applyLocal(taskId, 'executing')
    this.machine.advanceIteration(taskId)
    const record = this.machine.get(taskId)
    const iteration = record?.iteration ?? persisted.iteration + 1
    const inReplyTo = persisted.iteration
    const envelopeText = [
      '[D2C]',
      'VERSION: 1',
      'STATE: EXECUTED',
      `TASK_ID: ${taskId}`,
      `ITERATION: ${iteration}`,
      `IN_REPLY_TO: ${inReplyTo}`,
      '',
      'RESULT:',
      `Implementation executed by DeepSeek Harness. Changed files: ${summary.changedFiles.length > 0 ? summary.changedFiles.join(', ') : '(none)'}`,
      `Git HEAD: ${summary.head ?? '(no commits)'}`,
      `Tests recorded: ${summary.testsRecorded ? 'yes — verify via test_status MCP tool' : 'no'}`,
      ...(summary.note !== undefined ? ['', 'NOTE:', summary.note] : []),
      '',
      'Independently review via MCP (git_diff, test_status), then reply DONE or PLAN (fix).',
    ].join('\n')
    if (this.sendGuard.isDuplicate(envelopeText)) {
      throw new ProtocolError('duplicate-send', 'EXECUTED envelope just sent')
    }
    await this.options.browser.sendControlMessage(envelopeText)
    this.sendGuard.record(envelopeText)
    // The EXECUTED send moves the machine to the reviewing posture: the
    // record now waits for ChatGPT's independent review of iteration N.
    this.machine.applyLocal(taskId, 'executed')
    const reply = await this.options.browser.waitForReply(this.replyTimeoutMs)
    const envelopeReply = extractEnvelopeText(reply.text)
    if (envelopeReply === null) {
      throw new ProtocolError('no-marker', 'ChatGPT review contained no [D2C] envelope')
    }
    const envelope = parseEnvelope(envelopeReply, { sender: 'chatgpt' })
    const folded = this.machine.applyReply(envelope)
    const conversationId = await this.options.browser.conversationId().catch(() => undefined)
    const merged: typeof persisted = {
      ...persisted,
      conversationId: conversationId ?? persisted.conversationId,
      state: folded.state as TaskState,
      iteration: folded.iteration,
      waitingFor: folded.waitingFor,
      lastReviewedHead: summary.head,
    }
    await this.state.saveTask(merged)
    return { taskId, envelope, record: merged }
  }

  /** Status snapshot for chatgpt_status tool / doctor. */
  async status(taskId: string): Promise<PersistedTask | undefined> {
    return this.state.loadTask(taskId)
  }

  /** Latest task id for the bound workspace (restart recovery entry). */
  async latestTaskId(): Promise<string | undefined> {
    const binding = await this.state.loadWorkspace(this.options.workspaceRoot)
    return binding?.lastTaskId ?? undefined
  }

  /** Recover after restart/reload: rebind conversation, re-check task. */
  async recover(): Promise<PersistedTask | undefined> {
    const taskId = await this.latestTaskId()
    if (taskId === undefined) return undefined
    const task = await this.state.loadTask(taskId)
    if (task === undefined) return undefined
    this.restoreMachine(task)
    await this.options.browser.ensureReady()
    await this.options.browser.openConversation(task.conversationId ?? undefined)
    return task
  }


  /** Rebuild the in-memory protocol machine from durable state on demand. */
  private restoreMachine(task: PersistedTask) {
    return this.machine.restore({
      taskId: task.taskId,
      state: task.state,
      iteration: task.iteration,
      waitingFor: task.waitingFor,
      goal: task.goal,
      updatedAt: task.updatedAt,
    })
  }

  private async requireTask(taskId: string): Promise<PersistedTask> {
    const task = await this.state.loadTask(taskId)
    if (task === undefined) throw new ProtocolError('unknown-task', `task ${taskId} not found in durable state`)
    return task
  }
}
