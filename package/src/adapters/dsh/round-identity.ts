import type { Envelope } from '../../protocol/index.ts'
import type { PlannerEnvelope } from '../../protocol/planner-envelope.ts'

/** Project identities only from the coordinator-validated reviewer envelope. */
export function roundIdentity(envelope: Envelope | PlannerEnvelope): { workspaceId: string; head: string | null } {
  const workspaceId = envelope.headers.get('WORKSPACE_ID')
  if (!workspaceId) throw new Error('ROUND_IDENTITY_UNAVAILABLE')
  return { workspaceId, head: envelope.headers.get('HEAD') ?? null }
}
