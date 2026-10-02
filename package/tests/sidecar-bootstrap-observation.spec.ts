import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSidecar } from '../src/sidecar/server.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'
import { protectPrivateStateDirectory } from '../src/deployment/private-state.ts'
import { parseSidecarRequest } from '../src/sidecar/protocol.ts'
import { ChatGptCoordinator } from '../src/orchestrator/coordinator.ts'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import type { ReplyObservationBaseline } from '../src/core/ports/chat-control.ts'
import { formatPlannerEnvelope } from '../src/protocol/planner-envelope.ts'

const services: Awaited<ReturnType<typeof startSidecar>>[] = [], directories: string[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('plannerbridge-bootstrap-rpc-')) throw new Error('Unexpected fixture cleanup target')
    await rm(directory, { recursive: true, force: true })
  }
})
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const original = { version: 1 as const, conversationId: null, assistantCount: 0, textDigest: hash(''), observationEpoch: 'a'.repeat(64) }
const bound = { ...original, conversationId: 'owned', observationEpoch: 'b'.repeat(64) }
const correlation = { taskId: 'pb_' + 'd'.repeat(32), iteration: 0, workspaceId: 'world', phase: 'INIT' as const }
const send = { operationId: 'bootstrap-send', replyBaseline: original, correlation }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-bootstrap-rpc-')); directories.push(directory)
  await protectPrivateStateDirectory(directory, [])
  const message = vi.fn(async () => {})
  const current = vi.fn(async (): Promise<string | undefined> => 'owned')
  const reconcile = vi.fn(async () => bound)
  const reply = vi.fn(async () => ({ text: 'private planner reply', complete: true }))
  const driver = { health: async () => ({ ok: true, detail: 'synthetic fixture' }), ensureReady: async () => {},
    openConversation: async (id?: string) => id ?? 'owned', currentConversation: current, recover: async () => {}, sendControlMessage: message,
    waitForReply: reply, captureReplyBaseline: async (): Promise<ReplyObservationBaseline> => original, reconcileReplyBaseline: reconcile }
  const config = { host: '127.0.0.1' as const, port: 0, authentication: 'test-only', stateDirectory: directory, driver, requestTimeoutMs: 1_000 }
  async function start() { const service = await startSidecar(config); services.push(service); return { service,
    client: new SidecarChatControlClient({ endpoint: service.endpoint, authentication: config.authentication, requestTimeoutMs: 1_000 }) as any } }
  return { ...(await start()), start, directory, message, current, reconcile, reply, driver }
}
describe('journal-derived send observation, synthetic provider only', () => {
  it('allows an empty new-conversation route through the client only for an explicit bootstrap open', async () => {
    const f = await fixture()
    f.driver.openConversation = async () => ''
    expect(await f.client.openConversation()).toBe('')
    await expect(f.client.openConversation('owned')).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' })
  })
  it('binds the coordinator aggregate to the real Sidecar RPC observation with a changed epoch', async () => {
    const f = await fixture()
    const state = new CoordinatorState(createMemoryStore())
    const coordinator = new ChatGptCoordinator({ browser: f.client, store: state,
      workspaceRoot: 'C:\\ws\\canonical', workspaceId: 'world', canonicalProtocol: true })
    const taskId = 'pb_' + 'e'.repeat(32)
    await coordinator.startCanonicalTask(taskId, 'bootstrap epoch fidelity')
    const saved = await coordinator.status(taskId) as any
    expect(saved.round.phase).toBe('observed-sent')
    expect(saved.round.baseline).toEqual(bound)
    const disk = JSON.parse(await readFile(join(f.directory, 'delivery.json'), 'utf8'))
    const source = disk.entries.find((entry: any) => entry.operationId === saved.round.sendOperationId)
    expect(source.bootstrap.replyBaseline).toEqual(original)
    expect(source.bootstrapBaseline).toEqual(bound)
    expect(f.message).toHaveBeenCalledOnce()
  })
  it('recovers an ACKed EXECUTED after Sidecar restart using its journal and publishes DONE atomically', async () => {
    const f = await fixture()
    const store = new CoordinatorState(createMemoryStore())
    const proof = { head: 'a'.repeat(40), upstreamHead: 'a'.repeat(40), branch: 'feature', upstream: 'origin/feature', clean: true, ahead: 0, behind: 0 }
    const gitAuthority = { async withAuthority<T>(callback: (authority: any) => Promise<T>, signal?: AbortSignal) {
      return callback({ workspaceId: 'world', signal: signal ?? new AbortController().signal, snapshot: async () => proof })
    } }
    const options = { store, workspaceRoot: 'C:\\ws\\canonical', workspaceId: 'world', canonicalProtocol: true, gitAuthority }
    const coordinator = new ChatGptCoordinator({ ...options, browser: f.client })
    const taskId = 'pb_' + 'f'.repeat(32)
    await coordinator.startCanonicalTask(taskId, 'recover review')
    f.reply.mockResolvedValueOnce({ complete: true, text: formatPlannerEnvelope({ sender: 'planner', state: 'PLAN', taskId,
      workspaceId: 'world', iteration: 1, inReplyTo: 0, sections: { ACTIONS: 'Implement' } }) })
    await coordinator.awaitPlan(taskId)
    f.driver.captureReplyBaseline = async () => bound
    const commit = store.commitTask.bind(store)
    let fail = true
    store.commitTask = async (id, revision, value) => {
      if (fail && (value as any).round?.kind === 'EXECUTED' && (value as any).round.phase === 'observed-sent') throw new Error('publication crash')
      return commit(id, revision, value)
    }
    const crash = await coordinator.reportCanonicalExecuted(taskId, { changedFiles: [], head: proof.head, testsRecorded: true }).catch(error => error)
    expect(crash.message, crash.stack).toBe('publication crash')
    const pending = (await store.loadTask(taskId)) as any
    expect(pending.round.phase).toBe('sending')
    fail = false
    await f.service.close()
    const restarted = new ChatGptCoordinator({ ...options, browser: (await f.start()).client })
    f.reply.mockResolvedValueOnce({ complete: true, text: formatPlannerEnvelope({ sender: 'planner', state: 'DONE', taskId,
      workspaceId: 'world', iteration: 1, inReplyTo: 1, head: proof.head, sections: { SUMMARY: 'Reviewed' } }) })
    const result = await restarted.reportCanonicalExecuted(taskId, { changedFiles: [], head: proof.head, testsRecorded: true })
    expect(result.record.state).toBe('done')
    expect((result.record as any).round).toMatchObject({ phase: 'accepted', sendOperationId: pending.round.sendOperationId,
      outcome: { state: 'DONE', head: proof.head, sections: { SUMMARY: 'Reviewed' } } })
    expect(f.message).toHaveBeenCalledTimes(2)
  })
  it('retains the input owner and refuses capture until provider ACK returns', async () => {
    const f = await fixture()
    let release!: () => void
    f.message.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const pending = f.client.sendControlMessage('private INIT control', undefined, send)
    await vi.waitFor(() => expect(f.message).toHaveBeenCalledOnce())
    try {
      await expect(f.client.captureSendObservation(send.operationId)).rejects.toMatchObject({ code: 'SIDECAR_BUSY' })
      expect(f.current).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled()
    } finally { release(); await pending }
    expect(await f.client.captureSendObservation(send.operationId)).toEqual(bound)
  })
  it('does not publish late proof after cancellation and retains its owner until settlement', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    let release!: () => void
    f.reconcile.mockImplementationOnce(() => new Promise<typeof bound>(resolve => { release = () => resolve(bound) }))
    const controller = new AbortController()
    const pending = f.client.captureSendObservation(send.operationId, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    await vi.waitFor(() => expect(f.reconcile).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
    try {
      await expect(f.client.currentConversation()).rejects.toMatchObject({ code: 'SIDECAR_BUSY' })
      expect(JSON.parse(await readFile(join(f.directory, 'delivery.json'), 'utf8')).entries[0].bootstrapBaseline).toBeUndefined()
    } finally { release() }
    await vi.waitFor(async () => expect(await f.client.currentConversation()).toBe('owned'))
    expect(JSON.parse(await readFile(join(f.directory, 'delivery.json'), 'utf8')).entries[0].bootstrapBaseline).toBeUndefined()
    expect(f.message).toHaveBeenCalledOnce()
  })
  it('journals a null-conversation bootstrap intent before input without storing bodies', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    const disk = await readFile(join(f.directory, 'delivery.json'), 'utf8')
    const source = JSON.parse(disk).entries.find((entry: any) => entry.operationId === send.operationId)
    expect(source.bootstrap).toEqual({ controlDigest: hash('private INIT control'), replyBaseline: original,
      binding: { taskId: correlation.taskId, iteration: 0, workspaceId: 'world' } })
    expect(source.bootstrapBaseline).toBeUndefined()
    expect(disk).not.toContain('private INIT control')
  })
  it('binds only after the live provider ACK and exact source-derived semantic proof', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    expect(await f.client.captureSendObservation(send.operationId)).toEqual(bound)
    expect(f.reconcile.mock.calls[0]?.[0]).toEqual({ conversationId: 'owned', controlDigest: hash('private INIT control') })
    expect(f.message).toHaveBeenCalledOnce()
    const disk = JSON.parse(await readFile(join(f.directory, 'delivery.json'), 'utf8'))
    expect(disk.entries[0].bootstrap.replyBaseline).toEqual(original)
    expect(disk.entries[0].bootstrapBaseline).toEqual(bound)
    expect(await f.client.captureSendObservation(send.operationId)).toEqual(bound)
    expect(f.reconcile).toHaveBeenCalledOnce()
  })
  it('returns a known accepted send baseline without adopting any current route', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('known control', undefined, { ...send, replyBaseline: bound })
    f.current.mockResolvedValue('foreign')
    expect(await f.client.captureSendObservation(send.operationId)).toEqual(bound)
    expect(f.current).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled()
  })
  it('refuses missing and legacy sources before reading the current browser', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('legacy control', undefined, { operationId: 'legacy-send' })
    for (const id of ['missing', 'legacy-send']) await expect(f.client.captureSendObservation(id)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.current).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled()
  })
  it('refuses an uncertain send that did not return an owned ACK', async () => {
    const f = await fixture()
    f.message.mockRejectedValueOnce(Object.assign(new Error('uncertain'), { code: 'BROWSER_MUTATION_UNCERTAIN' }))
    await expect(f.client.sendControlMessage('private INIT control', undefined, send)).rejects.toThrow()
    await expect(f.client.captureSendObservation(send.operationId)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.current).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled()
  })
  it('does not promote an unbound source after service restart even if the current route looks exact', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    await f.service.close()
    await expect((await f.start()).client.captureSendObservation(send.operationId)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.current).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled()
    expect(f.message).toHaveBeenCalledOnce()
  })
  it('returns a previously bound source after restart without inventing a new binding', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    await f.client.captureSendObservation(send.operationId)
    await f.service.close(); f.current.mockResolvedValue('foreign')
    expect(await (await f.start()).client.captureSendObservation(send.operationId)).toEqual(bound)
    expect(f.current).toHaveBeenCalledOnce(); expect(f.message).toHaveBeenCalledOnce()
  })
  it.each(['count', 'text', 'conversation', 'missing'])('refuses mismatched post-ACK %s before publishing a binding', async mismatch => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    if (mismatch === 'count') f.reconcile.mockResolvedValueOnce({ ...bound, assistantCount: 1 })
    if (mismatch === 'text') f.reconcile.mockResolvedValueOnce({ ...bound, textDigest: 'f'.repeat(64) })
    if (mismatch === 'conversation') f.reconcile.mockResolvedValueOnce({ ...bound, conversationId: 'foreign' })
    if (mismatch === 'missing') f.current.mockResolvedValueOnce(undefined)
    await expect(f.client.captureSendObservation(send.operationId)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(JSON.parse(await readFile(join(f.directory, 'delivery.json'), 'utf8')).entries[0].bootstrapBaseline).toBeUndefined()
    expect(f.message).toHaveBeenCalledOnce()
  })
  it.each(['SEND_UNCERTAIN', 'BROWSER_TARGET_CHANGED'])('preserves %s from semantic proof without another send', async code => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    f.reconcile.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
    await expect(f.client.captureSendObservation(send.operationId)).rejects.toMatchObject({ code })
    expect(f.message).toHaveBeenCalledOnce()
  })
  it('reconciles a bound bootstrap before the first wait after service restart', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('private INIT control', undefined, send)
    await f.client.captureSendObservation(send.operationId)
    await f.service.close()
    const restarted = await f.start()
    const result = await restarted.client.waitForReply(2_000, undefined, { operationId: 'bootstrap-wait', replyBaseline: bound,
      replyRecovery: { sendOperationId: send.operationId }, correlation })
    expect(result.text).toBe('private planner reply')
    expect(f.reconcile).toHaveBeenCalledTimes(2); expect(f.message).toHaveBeenCalledOnce()
    expect(await readFile(join(f.directory, 'delivery.json'), 'utf8')).not.toContain('private planner reply')
  })
  it('reconciles a known accepted source before a never-journaled wait after restart', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('known control', undefined, { ...send, replyBaseline: bound })
    await f.service.close()
    await (await f.start()).client.waitForReply(2_000, undefined, { operationId: 'known-first-wait', replyBaseline: bound,
      replyRecovery: { sendOperationId: send.operationId }, correlation })
    expect(f.reconcile).toHaveBeenCalledOnce(); expect(f.message).toHaveBeenCalledOnce()
  })
  it('accepts only a source ID in the narrow observation RPC', () => {
    const request = { version: 1, requestId: 'read', operationId: 'capture', method: 'captureSendObservation', params: { sendOperationId: send.operationId } }
    expect(parseSidecarRequest(request)).toEqual(request)
    for (const field of ['conversationId', 'controlDigest', 'observationEpoch', 'expression', 'path', 'text']) {
      expect(() => parseSidecarRequest({ ...request, params: { ...request.params, [field]: 'forged' } })).toThrow()
    }
  })
})
