import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { PersistedTask } from '../core/model.ts'
import { taskProtocolVersion } from '../core/model.ts'
import type { PlannerRound, PlannerTaskAggregate } from '../core/planner-task.ts'
import { formatPlannerEnvelope, parsePlannerEnvelope, plannerEnvelopeDigest } from '../protocol/planner-envelope.ts'

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const head = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const roundNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const plannerRoundSchema = z.object({
  kind: z.enum(['INIT', 'EXECUTED']), iteration: roundNumber,
  sendOperationId: identifier, waitOperationId: identifier, controlDigest: sha,
  baseline: z.object({ version: z.literal(1), conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
    assistantCount: roundNumber, textDigest: sha, observationEpoch: sha }).strict(),
  phase: z.enum(['prepared', 'sending', 'observed-sent', 'awaiting-reply', 'uncertain', 'accepted']),
  git: z.object({ head, upstreamHead: head, branch: z.string().min(1).max(512), upstream: z.string().min(1).max(512),
    clean: z.literal(true), ahead: z.literal(0), behind: z.literal(0) }).strict().optional(),
  outcome: z.object({ digest: sha, state: z.enum(['PLAN', 'DONE', 'BLOCKED', 'ERROR']), iteration: roundNumber,
    inReplyTo: roundNumber, head: head.optional(), sections: z.record(z.string(), z.string().max(4096)) }).strict().optional(),
}).strict()

function fail(code = 'PROTOCOL_STATE_CONFLICT'): never { throw Object.assign(new Error(code), { code }) }

/** Read/write validation independent of storage/transport; never repairs corrupt data. */
export function validatePlannerTask(task: PersistedTask): void {
  const value = task as PlannerTaskAggregate
  if (taskProtocolVersion(task) !== 2) {
    if (Object.hasOwn(task, 'round') || Object.hasOwn(task, 'workspaceId')) fail()
    return
  }
  if (!/^pb_[0-9a-f]{32,64}$/.test(task.taskId) || !Number.isSafeInteger(task.iteration) || task.iteration < 0) fail()
  if (value.workspaceId !== undefined && !identifier.safeParse(value.workspaceId).success) fail()
  if (value.round === undefined) return // Historical foundations retain absent history.
  const parsed = plannerRoundSchema.safeParse(value.round)
  if (!parsed.success || value.workspaceId === undefined) fail()
  const round = parsed.data
  if (task.conversationId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(task.conversationId)) fail()
  if (round.sendOperationId === round.waitOperationId || (round.phase === 'accepted') !== (round.outcome !== undefined)) fail()
  if (round.kind === 'INIT') {
    if (round.iteration !== 0 || round.git !== undefined) fail()
  } else if (round.iteration < 1 || !round.git || round.git.head !== round.git.upstreamHead || round.baseline.conversationId === null) fail()
  if (round.baseline.conversationId !== null && round.baseline.conversationId !== task.conversationId) fail()
  if (!round.outcome) {
    if (task.iteration !== round.iteration || task.state !== (round.kind === 'INIT' ? 'awaiting-plan' : 'awaiting-review')
      || task.waitingFor !== (round.kind === 'INIT' ? 'chatgpt-plan' : 'chatgpt-review')) fail()
    return
  }
  const result = round.outcome
  if (result.inReplyTo !== round.iteration || result.iteration !== (result.state === 'PLAN' ? round.iteration + 1 : round.iteration)) fail()
  if (round.kind === 'EXECUTED' && result.head !== round.git?.head) fail()
  try {
    const wire = formatPlannerEnvelope({ sender: 'planner', state: result.state, taskId: task.taskId, workspaceId: value.workspaceId,
      iteration: result.iteration, inReplyTo: result.inReplyTo, head: result.head, sections: result.sections })
    if (plannerEnvelopeDigest(parsePlannerEnvelope(wire, { sender: 'planner' })) !== result.digest) fail()
  } catch { fail() }
  const expected = result.state === 'PLAN' ? ['planned', 'dsh-execution'] : result.state === 'DONE' ? ['done', 'none'] : [result.state === 'BLOCKED' ? 'blocked' : 'error', 'user']
  if (task.iteration !== result.iteration || task.state !== expected[0] || task.waitingFor !== expected[1]
    || task.lastReviewedHead !== (result.head ?? null)) fail()
}

const transitions: Record<PlannerRound['phase'], readonly PlannerRound['phase'][]> = {
  prepared: ['prepared', 'sending', 'uncertain'], sending: ['sending', 'observed-sent', 'uncertain'],
  'observed-sent': ['observed-sent', 'awaiting-reply', 'uncertain'],
  'awaiting-reply': ['awaiting-reply', 'accepted', 'uncertain'],
  uncertain: ['uncertain', 'awaiting-reply'], accepted: ['accepted'],
}

/** Enforce immutable intent and atomic outcome on the supported single-writer revision seam. */
export function requirePlannerTaskTransition(previous: PersistedTask | undefined, next: PersistedTask): void {
  const before = previous as PlannerTaskAggregate | undefined, current = next as PlannerTaskAggregate
  if (before?.round?.outcome && current.round?.sendOperationId === before.round.sendOperationId
    && !isDeepStrictEqual(before.round.outcome, current.round.outcome)) fail('REPLAY_CONFLICT')
  validatePlannerTask(next)
  if (taskProtocolVersion(next) !== 2) return
  const round = current.round, old = before?.round
  if (before && (before.goal !== current.goal || before.workspaceId !== current.workspaceId)) fail('REPLAY_CONFLICT')
  if (before && before.conversationId !== current.conversationId
    && !(before.conversationId === null && current.conversationId !== null && old?.phase === 'sending'
      && round?.phase === 'observed-sent' && round.sendOperationId === old.sendOperationId)) fail('REPLAY_CONFLICT')
  if (!old) {
    if (round && (round.kind !== 'INIT' || round.phase !== 'prepared' || round.iteration !== 0
      || (before !== undefined && before.iteration !== 0))) fail()
    return
  }
  if (!round) fail('REPLAY_CONFLICT')
  if (round.sendOperationId !== old.sendOperationId) {
    if (old.phase !== 'accepted' || old.outcome?.state !== 'PLAN' || round.kind !== 'EXECUTED'
      || round.phase !== 'prepared' || round.iteration !== old.outcome.iteration
      || [old.sendOperationId, old.waitOperationId].includes(round.sendOperationId)
      || [old.sendOperationId, old.waitOperationId].includes(round.waitOperationId)) fail('REPLAY_CONFLICT')
    return
  }
  const identity = ({ phase: _phase, outcome: _outcome, ...intent }: PlannerRound) => intent
  if (!isDeepStrictEqual(identity(old), identity(round))) fail('REPLAY_CONFLICT')
  if (!transitions[old.phase].includes(round.phase)) fail('REPLAY_CONFLICT')
  if (old.outcome && !isDeepStrictEqual(old.outcome, round.outcome)) fail('REPLAY_CONFLICT')
  if (old.phase === 'accepted' && !isDeepStrictEqual(previous, next)) {
    // Administrative timestamp changes do not alter the accepted result.
    const { updatedAt: _oldRevision, ...oldValue } = previous!
    const { updatedAt: _newRevision, ...newValue } = next
    if (!isDeepStrictEqual(oldValue, newValue)) fail('REPLAY_CONFLICT')
  }
}
