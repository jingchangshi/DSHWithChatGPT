import type { Envelope } from '../../protocol/index.ts'

/** Project identities only from the coordinator-validated reviewer envelope. */
export function roundIdentity(envelope: Envelope): { workspaceId: string; head: string | null } {
  const workspaceId = envelope.headers.get('WORKSPACE_ID')
  if (!workspaceId) throw new Error('ROUND_IDENTITY_UNAVAILABLE')
  return { workspaceId, head: envelope.headers.get('HEAD') ?? null }
}
