import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { startSidecar } from '../../lib/sidecar/server.js'
import { protectPrivateStateDirectory } from '../../lib/deployment/private-state.js'
import { parsePlannerEnvelope, formatPlannerEnvelope } from '../../lib/protocol/planner-envelope.js'

// Test-only synthetic browser/planner. This child receives no workspace path
// authority and never reads the repository, tests or Git. The external view
// below simulates browser persistence; it is NOT a production journal.
const { root, authentication } = JSON.parse(await readFile(process.env.PLANNERBRIDGE_FIXTURE_CONFIG, 'utf8'))
const viewPath = path.join(root, 'synthetic-browser.json')
let view = JSON.parse(await readFile(viewPath, 'utf8').catch(() => '{"conversation":null,"sends":[],"replies":[]}'))
const digest = text => createHash('sha256').update(text).digest('hex')
const epoch = digest('fixture-document-' + process.pid)
const baseline = () => ({ version: 1, conversationId: view.conversation,
  assistantCount: view.replies.length, textDigest: digest(view.replies.at(-1) ?? ''), observationEpoch: epoch })
const stateDirectory = path.join(root, 'sidecar')
await mkdir(stateDirectory, { recursive: true })
await protectPrivateStateDirectory(stateDirectory, [])
const driver = {
  health: async () => ({ ok: true, detail: 'explicit synthetic planner' }),
  ensureReady: async () => {},
  openConversation: async id => {
    if (id !== undefined && id !== view.conversation) throw new Error('SEND_UNCERTAIN')
    if (id === undefined) view.conversation = null
    return id ?? ''
  },
  currentConversation: async () => view.conversation ?? undefined,
  captureReplyBaseline: async () => baseline(),
  reconcileReplyBaseline: async request => {
    const send = view.sends.findLast(item => item.digest === request.controlDigest)
    if (!send || request.conversationId !== 'fixture-owned') throw new Error('SEND_UNCERTAIN')
    return { ...send.baseline, conversationId: 'fixture-owned', observationEpoch: epoch }
  },
  sendControlMessage: async (text, signal) => {
    signal?.throwIfAborted()
    const envelope = parsePlannerEnvelope(text, { sender: 'executor' })
    const previous = baseline()
    view.conversation = 'fixture-owned'
    view.sends.push({ text, digest: digest(text), baseline: previous, taskId: envelope.taskId,
      workspaceId: envelope.headers.get('WORKSPACE_ID'), state: envelope.state, iteration: envelope.iteration })
    const plan = envelope.state === 'INIT' || envelope.iteration === 1
    view.replies.push(formatPlannerEnvelope({ sender: 'planner', state: plan ? 'PLAN' : 'DONE', taskId: envelope.taskId,
      workspaceId: envelope.headers.get('WORKSPACE_ID'), iteration: plan ? envelope.iteration + 1 : envelope.iteration,
      inReplyTo: envelope.iteration, ...(envelope.state === 'INIT' ? {} : { head: envelope.headers.get('HEAD') }),
      sections: plan ? { ACTIONS: envelope.state === 'INIT' ? 'Implement numeric doubling.' : 'Reject invalid input and add rejection tests.' }
        : { SUMMARY: 'Synthetic fixture review completed; not real model/App evidence.' } }))
    await writeFile(viewPath, JSON.stringify(view))
  },
  waitForReply: async () => ({ text: view.replies.at(-1), complete: true }),
  recover: async () => {},
}
const server = await startSidecar({ host: '127.0.0.1', port: 0, authentication,
  stateDirectory, driver, requestTimeoutMs: 1_000, maxRequestBytes: 65_536, maxReplyBytes: 65_536 })
process.send({ event: 'ready', endpoint: server.endpoint, pid: process.pid })
