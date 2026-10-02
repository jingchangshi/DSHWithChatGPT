import { startSidecar } from '../../lib/sidecar/server.js'
import { protectPrivateStateDirectory } from '../../lib/deployment/private-state.js'
import { createHash } from 'node:crypto'

// Test-owned child process. No Browser Harness, Chrome or workspace authority.
let conversation
let reply = ''
const barriers = new Map()
const recoveryView = process.env.PLANNERBRIDGE_TEST_RECOVERY_VIEW
const bootstrapMode = process.env.PLANNERBRIDGE_TEST_BOOTSTRAP === 'true'
const emptyDigest = createHash('sha256').update('').digest('hex')
const observationBaseline = { version: 1, conversationId: 'owned', assistantCount: 0, textDigest: emptyDigest, observationEpoch: 'a'.repeat(64) }
const driver = {
  health: async () => ({ ok: true, detail: 'fake driver ready' }),
  ensureReady: async () => {},
  openConversation: async id => { conversation = id ?? 'created-conversation'; return conversation },
  currentConversation: async () => conversation ?? (recoveryView && !bootstrapMode
    ? recoveryView === 'missing' ? undefined : recoveryView === 'foreign' ? 'foreign' : 'owned' : undefined),
  sendControlMessage: async (text, signal) => {
    signal?.throwIfAborted()
    if (text === 'legacy-cancelled') throw new Error('D2C_CANCELLED: private provider detail')
    if (text === 'logged-out') throw new Error('ChatGPT_WEB_LOGGED_OUT: private provider detail')
    if (text === 'app-unavailable') throw new Error('CHATGPT_APP_UNAVAILABLE: private provider detail')
    process.send?.({ event: 'send', text })
    if (text === 'hang-before-ack') await new Promise(() => {})
    if (text === 'abortable-send') await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    reply = text === 'large-reply' ? 'a'.repeat(65_537) : 'reply to ' + text
    // Synthetic post-ACK route for bootstrap tests; no real browser is used.
    if (bootstrapMode && recoveryView && text === 'owned recovery control') conversation = 'owned'
  },
  waitForReply: async (timeoutMs, signal) => {
    // Independent-process fake browser state supplied by the fixture, never a
    // production journal body or evidence of a real ChatGPT page.
    if (!reply && recoveryView) return { text: recoveryView === 'changed-reply' ? 'foreign changed reply' : 'reply to owned recovery control', complete: true }
    if (reply) return { text: reply, complete: true }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('BROWSER_STALE: no reply')), timeoutMs)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('D2C_CANCELLED: cancelled')) }, { once: true })
    })
  },
  recover: async () => {},
}
if (recoveryView) Object.assign(driver, {
  captureReplyBaseline: async () => bootstrapMode && conversation === undefined
    ? { ...observationBaseline, conversationId: null } : observationBaseline,
  reconcileReplyBaseline: async request => {
    const controlDigest = createHash('sha256').update('owned recovery control').digest('hex')
    if (!['exact', 'changed-reply'].includes(recoveryView) || request.conversationId !== 'owned' || request.controlDigest !== controlDigest) throw Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' })
    return { ...observationBaseline, observationEpoch: 'b'.repeat(64) }
  },
})
if (process.env.PLANNERBRIDGE_TEST_PROTECT_STATE !== 'false') await protectPrivateStateDirectory(process.env.PLANNERBRIDGE_TEST_STATE, [])
const server = await startSidecar({
  host: '127.0.0.1', port: 0,
  authentication: process.env.PLANNERBRIDGE_TEST_AUTH,
  stateDirectory: process.env.PLANNERBRIDGE_TEST_STATE,
  driver,
  requestTimeoutMs: 1_000,
  maxRequestBytes: 65_536,
  maxReplyBytes: 65_536,
  onDeliveryPhase: async (entry, signal) => {
    process.send?.({ event: 'phase', operationId: entry.operationId, phase: entry.phase })
    if (entry.phase !== process.env.PLANNERBRIDGE_TEST_PAUSE_PHASE) return
    await new Promise((resolve, reject) => {
      const abort = () => { barriers.delete(entry.operationId); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      barriers.set(entry.operationId, () => { signal.removeEventListener('abort', abort); barriers.delete(entry.operationId); resolve() })
      if (signal.aborted) abort()
    })
  },
})
process.send?.({ event: 'ready', endpoint: server.endpoint, generation: server.generation, pid: process.pid })
process.on('message', async message => {
  if (message?.event === 'resume') barriers.get(message.operationId)?.()
  if (message?.event === 'stop') { await server.close(); process.exit(0) }
})
