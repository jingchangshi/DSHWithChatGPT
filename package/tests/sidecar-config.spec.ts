import { describe, expect, it } from 'vitest'
import { startSidecar } from '../src/sidecar/server.ts'
import type { ChatControl } from '../src/core/ports/chat-control.ts'

const unused = async (): Promise<never> => { throw new Error('Invalid configuration must fail before driver access') }
const driver: ChatControl = { health: unused, ensureReady: unused, openConversation: unused, sendControlMessage: unused, waitForReply: unused, recover: unused, currentConversation: unused }
describe('Sidecar configuration bounds', () => {
  for (const field of ['maxRequestBytes', 'maxReplyBytes'] as const) it.each([NaN, 1_024.5, '65536'])('rejects non-integer ' + field + ' (%s) before private state access', async value => {
    await expect(startSidecar({ host: '127.0.0.1', port: 0, authentication: 'configuration-test-only', stateDirectory: 'must-not-touch', driver, [field]: value as number })).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' })
  })
})
