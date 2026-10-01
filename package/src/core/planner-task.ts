import type { PersistedTask } from './model.ts'
import type { ReplyObservationBaseline } from './ports/chat-control.ts'

/** Validated, bounded protocol data, not a raw website response or transcript. */
export interface PlannerAcceptedOutcome {
  digest: string
  state: 'PLAN' | 'DONE' | 'BLOCKED' | 'ERROR'
  iteration: number
  inReplyTo: number
  head?: string
  sections: Record<string, string>
}
/** An observed Git snapshot; obtaining fresh authority is a coordinator concern. */
export interface PlannerGitProof {
  head: string
  upstreamHead: string
  branch: string
  upstream: string
  clean: boolean
  ahead: number
  behind: number
}
export interface PlannerRound {
  kind: 'INIT' | 'EXECUTED'
  iteration: number
  sendOperationId: string
  waitOperationId: string
  controlDigest: string
  baseline: ReplyObservationBaseline
  phase: 'prepared' | 'sending' | 'observed-sent' | 'awaiting-reply' | 'uncertain' | 'accepted'
  git?: PlannerGitProof
  outcome?: PlannerAcceptedOutcome
}
/** The released task interface/schema stays frozen; only canonical storage adds fields. */
export interface PlannerTaskAggregate extends PersistedTask {
  protocolVersion: 2
  /** Foundation records may lack workspace/round; runtime cannot invent their history. */
  workspaceId?: string
  round?: PlannerRound
}
