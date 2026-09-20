/**
 * Coordinator state machine for the D2C protocol. Machine-enforced (unlike
 * upstream C2C, whose state consistency is skill discipline): every
 * transition validates the expected state, task id, and iteration, so stale
 * or mismatched ChatGPT replies are rejected by code, not by attention.
 * @module protocol
 */

import { ProtocolError, type Envelope, type EnvelopeState } from './envelope.ts'

/** What the coordinator is waiting for after a transition. */
export type WaitingFor = 'none' | 'chatgpt-plan' | 'chatgpt-review' | 'dsh-execution' | 'user'

/** Task lifecycle state kept durably by the coordinator. */
export type CoordinatorState =
  | 'idle'
  | 'awaiting-plan'
  | 'planned'
  | 'executing'
  | 'executed'
  | 'awaiting-review'
  | 'done'
  | 'blocked'
  | 'error'

/** Which envelope states satisfy a wait. */
const SATISFIED_BY: Record<Exclude<WaitingFor, 'none' | 'user'>, readonly EnvelopeState[]> = {
  'chatgpt-plan': ['PLAN', 'BLOCKED', 'ERROR'],
  'chatgpt-review': ['DONE', 'PLAN', 'BLOCKED', 'ERROR'],
  'dsh-execution': ['EXECUTED'],
}

/** Local task record the machine folds events into. */
export interface TaskRecord {
  taskId: string
  state: CoordinatorState
  iteration: number
  waitingFor: WaitingFor
  goal: string
  lastReviewedIteration?: number
  updatedAt: number
}

/** Pure transition evaluator: throws ProtocolError on illegal replies. */
export class StateMachine {
  private readonly tasks = new Map<string, TaskRecord>()

  /** Start a task (INIT sent). */
  startTask(taskId: string, goal: string, iteration = 0): TaskRecord {
    if (this.tasks.has(taskId)) {
      throw new ProtocolError('duplicate-task', `task ${taskId} already exists`)
    }
    const record: TaskRecord = {
      taskId,
      state: 'awaiting-plan',
      iteration,
      waitingFor: 'chatgpt-plan',
      goal,
      updatedAt: Date.now(),
    }
    this.tasks.set(taskId, record)
    return record
  }

  /** Read one task record. */
  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId)
  }

  /** Apply a local transition (DSH side moved). */
  applyLocal(taskId: string, next: 'executing' | 'executed' | 'done' | 'blocked' | 'error'): TaskRecord {
    const record = this.require(taskId)
    const legal: Record<typeof next, readonly CoordinatorState[]> = {
      executing: ['planned', 'executed'],
      executed: ['executing'],
      done: ['executed', 'awaiting-review'],
      blocked: ['awaiting-plan', 'planned', 'executing', 'executed', 'awaiting-review'],
      error: ['awaiting-plan', 'planned', 'executing', 'executed', 'awaiting-review'],
    }
    if (!legal[next].includes(record.state)) {
      throw new ProtocolError('illegal-transition', `cannot move task ${taskId} from ${record.state} to ${next}`)
    }
    record.state = next
    record.waitingFor = next === 'executed' ? 'chatgpt-review' : 'none'
    record.updatedAt = Date.now()
    return record
  }

  /**
   * Apply a ChatGPT reply envelope: verifies sender state, task id, waiting
   * state, and iteration currency. Returns the folded record.
   */
  applyReply(envelope: Envelope): TaskRecord {
    const record = this.tasks.get(envelope.taskId)
    if (record === undefined) {
      throw new ProtocolError('unknown-task', `reply for unknown task ${envelope.taskId}`)
    }
    if (record.waitingFor === 'none' || record.waitingFor === 'user' || record.waitingFor === 'dsh-execution') {
      throw new ProtocolError('unexpected-reply', `task ${envelope.taskId} is not waiting for ChatGPT (state ${record.state})`)
    }
    const satisfying = SATISFIED_BY[record.waitingFor]
    if (!satisfying.includes(envelope.state)) {
      throw new ProtocolError('stale-reply', `waiting ${record.waitingFor} but got ${envelope.state}`)
    }
    // Iteration currency: a reply must reference the iteration we are at or
    // the one we asked about (IN_REPLY_TO), never an older one.
    const expected = envelope.inReplyTo ?? record.iteration
    if (envelope.iteration < expected) {
      throw new ProtocolError('stale-iteration', `reply iteration ${envelope.iteration} < expected ${expected}`)
    }
    record.iteration = envelope.iteration
    record.updatedAt = Date.now()
    switch (envelope.state) {
      case 'PLAN': {
        record.state = 'planned'
        record.waitingFor = 'dsh-execution'
        break
      }
      case 'DONE': {
        record.state = 'done'
        record.waitingFor = 'none'
        record.lastReviewedIteration = envelope.inReplyTo
        break
      }
      case 'BLOCKED': {
        record.state = 'blocked'
        record.waitingFor = 'user'
        break
      }
      case 'ERROR': {
        record.state = 'error'
        record.waitingFor = 'user'
        break
      }
      default:
        throw new ProtocolError('unexpected-reply', `unhandled state ${envelope.state}`)
    }
    return record
  }

  /** Bump the iteration when DSH sends EXECUTED. */
  advanceIteration(taskId: string): TaskRecord {
    const record = this.require(taskId)
    record.iteration += 1
    record.updatedAt = Date.now()
    return record
  }

  /** Remove a finished task from tracking. */
  forget(taskId: string): void {
    this.tasks.delete(taskId)
  }

  private require(taskId: string): TaskRecord {
    const record = this.tasks.get(taskId)
    if (record === undefined) throw new ProtocolError('unknown-task', `unknown task ${taskId}`)
    return record
  }
}
