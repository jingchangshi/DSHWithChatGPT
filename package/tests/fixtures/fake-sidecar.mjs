import { startSidecar } from '../../lib/sidecar/server.js'

// Test-owned child process. No Browser Harness, Chrome or workspace authority.
let conversation
let reply = ''
const driver = {
  health: async () => ({ ok: true, detail: 'fake driver ready' }),
  ensureReady: async () => {},
  openConversation: async id => { conversation = id ?? 'created-conversation'; return conversation },
  currentConversation: async () => conversation,
  sendControlMessage: async (text, signal) => {
    signal?.throwIfAborted()
    process.send?.({ event: 'send', text })
    if (text === 'hang-before-ack') await new Promise(() => {})
    reply = 'reply to ' + text
  },
  waitForReply: async (timeoutMs, signal) => {
    if (reply) return { text: reply, complete: true }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('BROWSER_STALE: no reply')), timeoutMs)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('D2C_CANCELLED: cancelled')) }, { once: true })
    })
  },
  recover: async () => {},
}
const server = await startSidecar({
  host: '127.0.0.1', port: 0,
  authentication: process.env.PLANNERBRIDGE_TEST_AUTH,
  stateDirectory: process.env.PLANNERBRIDGE_TEST_STATE,
  driver,
  requestTimeoutMs: 1_000,
  maxRequestBytes: 65_536,
  maxReplyBytes: 65_536,
})
process.send?.({ event: 'ready', endpoint: server.endpoint, generation: server.generation, pid: process.pid })
process.on('message', async message => {
  if (message?.event === 'stop') { await server.close(); process.exit(0) }
})
