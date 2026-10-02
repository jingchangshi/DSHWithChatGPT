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
import type { StateStore, TaskSnapshot } from '../core/ports/state-store.ts'
import { OperationCancelledError, throwIfCancelled } from '../cancellation.ts'
import { createHash, randomUUID } from 'node:crypto'
import type { PlannerTaskAggregate } from '../core/planner-task.ts'
import type { ChatRecoveryControl, ChatSendObservationControl } from '../core/ports/chat-control.ts'
import { formatPlannerEnvelope, parsePlannerEnvelope, plannerEnvelopeDigest } from '../protocol/planner-envelope.ts'
import type { PlannerEnvelope } from '../protocol/planner-envelope.ts'
import type { GitAuthority, GitAuthorityPort } from '../core/ports/git-authority.ts'
import type { PlannerGitProof } from '../core/planner-task.ts'

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
  /** Explicit production gate for the canonical v2 coordinator path. */
  canonicalProtocol?: boolean
  /** Current capability owner; durable Git metadata is never authority. */
  gitAuthority?: GitAuthorityPort
}

/** Result of starting a task (INIT sent). */
export interface StartResult {
  taskId: string
  sentEnvelope: string
}

/** Result of one ChatGPT round-trip. */
export interface RoundResult {
  taskId: string
  envelope: Envelope | PlannerEnvelope
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
   * Start the canonical v2 path. This is deliberately separate from the
   * released v1 entry point and requires an explicit deployment opt-in.
   * Intent is published before browser delivery; route binding is accepted
   * only from the transport's send acknowledgement observation.
   */
  async startCanonicalTask(taskId: string, goal: string, opts: { signal?: AbortSignal } = {}): Promise<StartResult> {
    throwIfCancelled(opts.signal)
    if (this.options.canonicalProtocol !== true) {
      throw Object.assign(new Error('CANONICAL_PROTOCOL_DISABLED'), { code: 'CANONICAL_PROTOCOL_DISABLED' })
    }
    if (!/^pb_[0-9a-f]{32,64}$/.test(taskId) || goal.trim() === '' || await this.state.loadTask(taskId) !== undefined) {
      throw new ProtocolError('task-id-unavailable', 'canonical task identity is unavailable')
    }
    await this.options.browser.ensureReady(opts.signal)
    const observation = this.options.browser as Partial<ChatSendObservationControl>
    if (typeof observation.captureReplyBaseline !== 'function' || typeof observation.captureSendObservation !== 'function') {
      throw Object.assign(new Error('CANONICAL_OBSERVATION_UNAVAILABLE'), { code: 'CANONICAL_OBSERVATION_UNAVAILABLE' })
    }
    const baseline = await observation.captureReplyBaseline(opts.signal)
    throwIfCancelled(opts.signal)
    if (baseline.conversationId !== null) {
      throw Object.assign(new Error('CANONICAL_BOOTSTRAP_ROUTE_BOUND'), { code: 'CANONICAL_BOOTSTRAP_ROUTE_BOUND' })
    }
    const sendOperationId = `send-${randomUUID()}`
    const waitOperationId = `wait-${randomUUID()}`
    const envelope = formatPlannerEnvelope({
      sender: 'executor', state: 'INIT', taskId, iteration: 0,
      workspaceId: this.options.workspaceId,
      sections: { GOAL: goal, INSTRUCTION: this.options.plannerInstructions ?? 'Plan this task using the canonical protocol.' },
    })
    const aggregate: PlannerTaskAggregate = {
      protocolVersion: 2, taskId, workspaceId: this.options.workspaceId, goal,
      state: 'awaiting-plan', iteration: 0, waitingFor: 'chatgpt-plan', conversationId: null,
      lastReviewedHead: null, createdAt: Date.now(), updatedAt: Date.now(), lastError: null,
      round: {
        kind: 'INIT', iteration: 0, sendOperationId, waitOperationId,
        controlDigest: createHash('sha256').update(envelope, 'utf8').digest('hex'),
        baseline, phase: 'prepared',
      },
    }
    let snapshot = await this.state.createTask(aggregate)
    const ids = await this.state.listTaskIds()
    if (!ids.includes(taskId)) await this.state.saveTaskIndex([...ids, taskId])
    await this.state.bindWorkspace(this.options.workspaceId, {
      workspaceRoot: this.options.workspaceRoot, conversationId: null, lastTaskId: taskId,
    })
    snapshot = await this.state.commitTask(taskId, snapshot.revision, {
      ...snapshot.value, round: { ...aggregate.round!, phase: 'sending' },
    } as PlannerTaskAggregate)
    await this.options.browser.sendControlMessage(envelope, opts.signal, {
      operationId: sendOperationId,
      correlation: { taskId, iteration: 0, workspaceId: this.options.workspaceId, phase: 'INIT' },
      replyBaseline: baseline,
    })
    throwIfCancelled(opts.signal)
    const bound = await observation.captureSendObservation(sendOperationId, opts.signal)
    throwIfCancelled(opts.signal)
    snapshot = await this.state.commitTask(taskId, snapshot.revision, {
      ...snapshot.value, conversationId: bound.conversationId,
      round: { ...((snapshot.value as PlannerTaskAggregate).round!), baseline: bound, phase: 'observed-sent' },
    } as PlannerTaskAggregate)
    await this.state.bindWorkspace(this.options.workspaceId, {
      workspaceRoot: this.options.workspaceRoot, conversationId: bound.conversationId, lastTaskId: taskId,
    })
    return { taskId, sentEnvelope: envelope }
  }

  /**
   * Wait for the ChatGPT reply to the latest send and fold it into the
   * machine. Rejects stale/mismatched envelopes (ProtocolError).
   */
  async awaitPlan(taskId: string, signal?: AbortSignal): Promise<RoundResult> {
    throwIfCancelled(signal)
    const snapshot = await this.requireTask(taskId)
    if (taskProtocolVersion(snapshot.value) === 2 && (snapshot.value as PlannerTaskAggregate).round !== undefined) {
      return this.awaitCanonicalPlan(taskId, snapshot, signal)
    }
    this.requireLegacyTask(snapshot.value)
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

  private async awaitCanonicalPlan(taskId: string, snapshot: TaskSnapshot, signal?: AbortSignal): Promise<RoundResult> {
    const persisted = snapshot.value as PlannerTaskAggregate
    const round = persisted.round
    if (!round || !['observed-sent', 'awaiting-reply', 'uncertain'].includes(round.phase)) {
      throw new ProtocolError('unexpected-reply', `task ${taskId} is not waiting for a canonical plan`)
    }
    let current = snapshot
    if (round.phase === 'uncertain') {
      const recovery = this.options.browser as Partial<ChatRecoveryControl>
      if (typeof recovery.reconcileReplyBaseline !== 'function' || persisted.conversationId === null) {
        throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
      }
      const reconciled = await recovery.reconcileReplyBaseline({
        conversationId: persisted.conversationId, controlDigest: round.controlDigest,
      }, signal)
      throwIfCancelled(signal)
      if (reconciled.version !== round.baseline.version || reconciled.conversationId !== persisted.conversationId
        || reconciled.assistantCount !== round.baseline.assistantCount || reconciled.textDigest !== round.baseline.textDigest) {
        throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
      }
      current = await this.state.commitTask(taskId, current.revision, {
        ...persisted, round: { ...round, phase: 'awaiting-reply' },
      } as PlannerTaskAggregate)
    }
    if (round.phase === 'observed-sent') {
      current = await this.state.commitTask(taskId, current.revision, {
        ...persisted, round: { ...round, phase: 'awaiting-reply' },
      } as PlannerTaskAggregate)
    }
    const active = current.value as PlannerTaskAggregate
    const activeRound = active.round!
    const reply = await this.options.browser.waitForReply(this.replyTimeoutMs, signal, {
      operationId: activeRound.waitOperationId,
      replyBaseline: activeRound.baseline,
      replyRecovery: { sendOperationId: activeRound.sendOperationId },
      correlation: { taskId, iteration: activeRound.iteration, workspaceId: this.options.workspaceId, phase: 'PLAN' },
    })
    throwIfCancelled(signal)
    const envelope = parsePlannerEnvelope(reply.text, { sender: 'planner' })
    if (envelope.taskId !== taskId || envelope.headers.get('WORKSPACE_ID') !== this.options.workspaceId
      || envelope.state !== 'PLAN' || envelope.iteration !== 1 || envelope.inReplyTo !== 0) {
      throw new ProtocolError('unexpected-reply', 'canonical plan reply does not match the active round')
    }
    const sections = Object.fromEntries(envelope.sections)
    const outcome = { digest: plannerEnvelopeDigest(envelope), state: 'PLAN' as const, iteration: 1, inReplyTo: 0, sections }
    const saved = await this.state.commitTask(taskId, current.revision, {
      ...active, state: 'planned', iteration: 1, waitingFor: 'dsh-execution', lastReviewedHead: null,
      round: { ...activeRound, phase: 'accepted', outcome },
    } as PlannerTaskAggregate)
    return { taskId, envelope, record: saved.value }
  }

  /** Canonical review owns fresh Git authority until delivery/acceptance settles. */
  async reportCanonicalExecuted(taskId: string, summary: {
    changedFiles: string[]; head: string; testsRecorded: boolean; note?: string
  }, signal?: AbortSignal): Promise<RoundResult> {
    throwIfCancelled(signal)
    if (this.options.canonicalProtocol !== true || !this.options.gitAuthority) {
      throw Object.assign(new Error('GIT_PROOF_UNAVAILABLE'), { code: 'GIT_PROOF_UNAVAILABLE' })
    }
    return this.options.gitAuthority.withAuthority(async authority => {
      this.requireGitAuthority(authority, signal)
      const activeSignal = signal ? AbortSignal.any([signal, authority.signal]) : authority.signal
      let snapshot = await this.requireTask(taskId)
      let aggregate = snapshot.value as PlannerTaskAggregate
      if (taskProtocolVersion(aggregate) !== 2 || aggregate.workspaceId !== this.options.workspaceId || !aggregate.round) {
        throw new ProtocolError('unexpected-reply', 'canonical task history unavailable')
      }
      const resuming = aggregate.round.kind === 'EXECUTED' && ['sending', 'observed-sent', 'awaiting-reply', 'uncertain'].includes(aggregate.round.phase)
      if (resuming) {
        const round = aggregate.round
        const proof = this.requireGitProof(await authority.snapshot(), round.git!.head)
        this.requireGitAuthority(authority, activeSignal)
        if (summary.head !== round.git!.head || proof.branch !== round.git!.branch || proof.upstream !== round.git!.upstream) {
          throw Object.assign(new Error('GIT_STATE_CHANGED'), { code: 'GIT_STATE_CHANGED' })
        }
        if (round.phase === 'sending' || round.phase === 'uncertain') {
          const observation = this.options.browser as Partial<ChatSendObservationControl>
          if (typeof observation.captureSendObservation !== 'function') {
            throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
          }
          // Source-derived proof only. The current browser route and caller's
          // summary cannot establish that this immutable intent was delivered.
          const bound = await observation.captureSendObservation(round.sendOperationId, activeSignal)
          this.requireGitAuthority(authority, activeSignal)
          if (bound.version !== round.baseline.version || bound.conversationId !== round.baseline.conversationId
            || bound.assistantCount !== round.baseline.assistantCount || bound.textDigest !== round.baseline.textDigest
            || bound.observationEpoch !== round.baseline.observationEpoch) {
            throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
          }
          snapshot = await this.state.commitTask(taskId, snapshot.revision, {
            ...aggregate, round: { ...round, phase: round.phase === 'sending' ? 'observed-sent' : 'awaiting-reply' },
          } as PlannerTaskAggregate)
        }
      }
      if (!resuming) {
        if (aggregate.round.phase !== 'accepted' || aggregate.round.outcome?.state !== 'PLAN') {
          throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
        }
        if (aggregate.iteration > this.maxIterations) throw new ProtocolError('iteration-limit', 'canonical round limit reached')
        const proof = this.requireGitProof(await authority.snapshot(), summary.head)
        this.requireGitAuthority(authority, activeSignal)
        const observation = this.options.browser as Partial<ChatSendObservationControl>
        if (typeof observation.captureReplyBaseline !== 'function' || typeof observation.captureSendObservation !== 'function') {
          throw Object.assign(new Error('CANONICAL_OBSERVATION_UNAVAILABLE'), { code: 'CANONICAL_OBSERVATION_UNAVAILABLE' })
        }
        await this.options.browser.ensureReady(activeSignal)
        await this.options.browser.openConversation(aggregate.conversationId ?? undefined, activeSignal)
        const baseline = await observation.captureReplyBaseline(activeSignal)
        this.requireGitAuthority(authority, activeSignal)
        if (baseline.conversationId === null || baseline.conversationId !== aggregate.conversationId) {
          throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
        }
        const beforeSend = this.requireGitProof(await authority.snapshot(), proof.head)
        this.requireGitAuthority(authority, activeSignal)
        if (beforeSend.branch !== proof.branch || beforeSend.upstream !== proof.upstream) {
          throw Object.assign(new Error('GIT_STATE_CHANGED'), { code: 'GIT_STATE_CHANGED' })
        }
        const text = formatPlannerEnvelope({ sender: 'executor', state: 'EXECUTED', taskId,
          workspaceId: this.options.workspaceId, iteration: aggregate.iteration, inReplyTo: aggregate.iteration,
          head: proof.head, sections: { RESULT: 'Execution completed. Independently inspect workspace, Git and raw execution evidence.',
            CHANGED_FILES: summary.changedFiles.length ? summary.changedFiles.join(', ') : '(none)',
            TESTS: summary.testsRecorded ? 'Read raw execution evidence.' : 'No execution evidence recorded.',
            ...(summary.note ? { NOTE: summary.note } : {}) } })
        const round = { kind: 'EXECUTED' as const, iteration: aggregate.iteration, sendOperationId: `send-${randomUUID()}`,
          waitOperationId: `wait-${randomUUID()}`, controlDigest: createHash('sha256').update(text).digest('hex'),
          baseline, phase: 'prepared' as const, git: proof }
        snapshot = await this.state.commitTask(taskId, snapshot.revision, {
          ...aggregate, state: 'awaiting-review', waitingFor: 'chatgpt-review', round,
        } as PlannerTaskAggregate)
        this.requireGitAuthority(authority, activeSignal)
        snapshot = await this.state.commitTask(taskId, snapshot.revision, {
          ...snapshot.value, round: { ...round, phase: 'sending' },
        } as PlannerTaskAggregate)
        this.requireGitAuthority(authority, activeSignal)
        await this.options.browser.sendControlMessage(text, activeSignal, { operationId: round.sendOperationId, replyBaseline: baseline,
          correlation: { taskId, iteration: round.iteration, workspaceId: this.options.workspaceId, phase: 'EXECUTED', head: proof.head } })
        this.requireGitAuthority(authority, activeSignal)
        const bound = await observation.captureSendObservation(round.sendOperationId, activeSignal)
        this.requireGitAuthority(authority, activeSignal)
        if (bound.version !== baseline.version || bound.conversationId !== baseline.conversationId
          || bound.assistantCount !== baseline.assistantCount || bound.textDigest !== baseline.textDigest
          || bound.observationEpoch !== baseline.observationEpoch) {
          throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
        }
        snapshot = await this.state.commitTask(taskId, snapshot.revision, {
          ...snapshot.value, round: { ...round, phase: 'observed-sent' },
        } as PlannerTaskAggregate)
      }
      aggregate = snapshot.value as PlannerTaskAggregate
      let round = aggregate.round!
      if (round.phase === 'observed-sent') {
        snapshot = await this.state.commitTask(taskId, snapshot.revision, { ...aggregate, round: { ...round, phase: 'awaiting-reply' } } as PlannerTaskAggregate)
        aggregate = snapshot.value as PlannerTaskAggregate
        round = aggregate.round!
      }
      const reply = await this.options.browser.waitForReply(this.replyTimeoutMs, activeSignal, {
        operationId: round.waitOperationId, replyBaseline: round.baseline, replyRecovery: { sendOperationId: round.sendOperationId },
        correlation: { taskId, workspaceId: this.options.workspaceId, iteration: round.iteration, phase: 'DONE', head: round.git!.head },
      })
      this.requireGitAuthority(authority, activeSignal)
      const envelope = parsePlannerEnvelope(reply.text, { sender: 'planner' })
      if (envelope.taskId !== taskId || envelope.headers.get('WORKSPACE_ID') !== this.options.workspaceId
        || envelope.headers.get('HEAD') !== round.git!.head || envelope.inReplyTo !== round.iteration
        || !['PLAN', 'DONE', 'BLOCKED', 'ERROR'].includes(envelope.state)
        || envelope.iteration !== round.iteration + (envelope.state === 'PLAN' ? 1 : 0)) {
        throw new ProtocolError('unexpected-reply', 'canonical review identity mismatch')
      }
      const currentProof = this.requireGitProof(await authority.snapshot(), round.git!.head)
      this.requireGitAuthority(authority, activeSignal)
      if (currentProof.branch !== round.git!.branch || currentProof.upstream !== round.git!.upstream) {
        throw Object.assign(new Error('GIT_STATE_CHANGED'), { code: 'GIT_STATE_CHANGED' })
      }
      const state = envelope.state as 'PLAN' | 'DONE' | 'BLOCKED' | 'ERROR'
      const saved = await this.state.commitTask(taskId, snapshot.revision, {
        ...aggregate, state: state === 'PLAN' ? 'planned' : state === 'DONE' ? 'done' : state === 'BLOCKED' ? 'blocked' : 'error',
        iteration: envelope.iteration, waitingFor: state === 'PLAN' ? 'dsh-execution' : state === 'DONE' ? 'none' : 'user',
        lastReviewedHead: round.git!.head, round: { ...round, phase: 'accepted', outcome: {
          digest: plannerEnvelopeDigest(envelope), state, iteration: envelope.iteration, inReplyTo: round.iteration,
          head: round.git!.head, sections: Object.fromEntries(envelope.sections),
        } },
      } as PlannerTaskAggregate)
      return { taskId, envelope, record: saved.value }
    }, signal)
  }

  private requireGitAuthority(authority: GitAuthority, signal?: AbortSignal): void {
    throwIfCancelled(signal)
    throwIfCancelled(authority.signal)
    if (authority.workspaceId !== this.options.workspaceId) throw Object.assign(new Error('GIT_PROOF_UNAVAILABLE'), { code: 'GIT_PROOF_UNAVAILABLE' })
  }

  private requireGitProof(proof: PlannerGitProof, expectedHead: string): PlannerGitProof {
    const fail = (code: string): never => { throw Object.assign(new Error(code), { code }) }
    if (!proof || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(proof.head) || !proof.branch || !proof.upstream
      || ['HEAD', 'main', 'master'].includes(proof.branch)) fail('GIT_PROOF_UNAVAILABLE')
    if (proof.clean !== true) fail('GIT_WORKTREE_DIRTY')
    if (proof.ahead !== 0 || proof.behind !== 0 || proof.upstreamHead !== proof.head) fail('GIT_NOT_PUSHED')
    if (proof.head !== expectedHead) fail('GIT_STATE_CHANGED')
    return { ...proof }
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
    this.requireLegacyTask(snapshot.value)
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
    if (taskProtocolVersion(task) === 2 && (task as PlannerTaskAggregate).round !== undefined) {
      const aggregate = task as PlannerTaskAggregate
      if (aggregate.conversationId === null) {
        const observation = this.options.browser as Partial<ChatSendObservationControl>
        if (aggregate.round?.phase !== 'sending' || typeof observation.captureSendObservation !== 'function') {
          throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
        }
        const bound = await observation.captureSendObservation(aggregate.round.sendOperationId, signal)
        throwIfCancelled(signal)
        const saved = await this.state.commitTask(taskId, task.updatedAt, {
          ...aggregate, conversationId: bound.conversationId,
          round: { ...aggregate.round, baseline: bound, phase: 'observed-sent' },
        } as PlannerTaskAggregate)
        await this.state.bindWorkspace(this.options.workspaceId, {
          workspaceRoot: this.options.workspaceRoot, conversationId: bound.conversationId, lastTaskId: taskId,
        })
        return saved.value
      }
      await this.options.browser.ensureReady(signal)
      await this.options.browser.openConversation(aggregate.conversationId, signal)
      return task
    }
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
    return task
  }

  private requireLegacyTask(task: PersistedTask): void {
    if (taskProtocolVersion(task) !== 1) throw Object.assign(new Error('PROTOCOL_COORDINATOR_UNAVAILABLE'), { code: 'PROTOCOL_COORDINATOR_UNAVAILABLE' })
  }
}
