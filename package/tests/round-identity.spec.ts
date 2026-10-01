import { describe, expect, it } from 'vitest'
import { formatEnvelope, parseEnvelope } from '../src/protocol/index.ts'

describe('DSH round output exposes validated reviewer identity', () => {
  it('projects the reply identity including reviewed HEAD, not executor arguments', async () => {
    const { roundIdentity } = await import('../src/adapters/dsh/round-identity.ts')
    const envelope = parseEnvelope(formatEnvelope({ sender: 'chatgpt', state: 'DONE', taskId: 'd2c_fixture', iteration: 3, inReplyTo: 3, headers: { WORKSPACE_ID: 'workspace', HEAD: 'a'.repeat(40) }, sections: { SUMMARY: 'accepted' } }), { sender: 'chatgpt' })
    expect(roundIdentity(envelope)).toEqual({ workspaceId: 'workspace', head: 'a'.repeat(40) })
  })
  it('does not invent a workspace identity for incomplete envelopes', async () => {
    const { roundIdentity } = await import('../src/adapters/dsh/round-identity.ts')
    const envelope = parseEnvelope(formatEnvelope({ sender: 'chatgpt', state: 'PLAN', taskId: 'd2c_fixture', iteration: 1, inReplyTo: 0, sections: { ACTIONS: 'inspect' } }), { sender: 'chatgpt' })
    expect(() => roundIdentity(envelope)).toThrow('ROUND_IDENTITY_UNAVAILABLE')
  })
})


