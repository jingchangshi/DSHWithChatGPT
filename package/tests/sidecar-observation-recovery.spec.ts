import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSidecar } from '../src/sidecar/server.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'
import { protectPrivateStateDirectory } from '../src/deployment/private-state.ts'

const services: Awaited<ReturnType<typeof startSidecar>>[] = [], directories: string[] = []
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const baseline = { version: 1 as const, conversationId: 'owned', assistantCount: 1, textDigest: hash('previous'), observationEpoch: 'a'.repeat(64) }
const send = { operationId: 'send-owned', replyBaseline: baseline }
const wait = { operationId: 'wait-owned', replyBaseline: baseline, replyRecovery: { sendOperationId: send.operationId } }
async function fixture(capable = true) {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-observation-rpc-')); directories.push(directory)
  await protectPrivateStateDirectory(directory, [])
  const capture = vi.fn(async () => baseline)
  const reconcile = vi.fn(async () => ({ ...baseline, observationEpoch: 'b'.repeat(64) }))
  const sendMessage = vi.fn(async () => {})
  const reply = vi.fn(async () => ({ text: 'private settled reply', complete: true }))
  const driver = { health: async () => ({ ok: true, detail: 'fixture' }), ensureReady: async () => {}, openConversation: async () => 'owned', currentConversation: async () => 'owned', recover: async () => {}, sendControlMessage: sendMessage, waitForReply: reply, ...(capable ? { captureReplyBaseline: capture, reconcileReplyBaseline: reconcile } : {}) }
  const config = { host: '127.0.0.1' as const, port: 0, authentication: 'test-only', stateDirectory: directory, driver, requestTimeoutMs: 1_000 }
  async function start() { const service = await startSidecar(config); services.push(service); return { service, client: new SidecarChatControlClient({ endpoint: service.endpoint, authentication: config.authentication, requestTimeoutMs: 1_000 }) as any } }
  return { ...(await start()), start, capture, reconcile, sendMessage, reply, directory }
}
describe('semantic Sidecar observation recovery', () => {
  it('captures bounded metadata through the neutral client without sending', async () => {
    const f = await fixture()
    expect(await f.client.captureReplyBaseline()).toEqual(baseline)
    expect(f.capture).toHaveBeenCalledOnce(); expect(f.sendMessage).not.toHaveBeenCalled()
  })
  it('does not infer unsupported observation from service health', async () => {
    const f = await fixture(false)
    await expect(f.client.captureReplyBaseline()).rejects.toMatchObject({ code: 'CHAT_CONTROL_OBSERVATION_UNAVAILABLE' })
    expect(f.sendMessage).not.toHaveBeenCalled()
  })
  it('resumes an uncertain wait using journal-bound outgoing proof without another send', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('owned control', undefined, send)
    f.reply.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
    await expect(f.client.waitForReply(2_000, undefined, wait)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    await f.service.close()
    const restarted = await f.start()
    expect(await restarted.client.waitForReply(2_000, undefined, wait)).toEqual({ text: 'private settled reply', complete: true })
    expect(f.reconcile.mock.calls[0]?.[0]).toEqual({ conversationId: 'owned', controlDigest: hash('owned control') })
    expect(f.sendMessage).toHaveBeenCalledOnce()
    const disk = await readFile(join(f.directory, 'delivery.json'), 'utf8')
    expect(disk).not.toContain('private settled reply'); expect(disk).not.toContain('owned control')
    expect(JSON.parse(disk).entries.find((entry: any) => entry.operationId === wait.operationId)).toMatchObject({ phase: 'accepted', replyDigest: hash('private settled reply') })
  })
  it.each(['SEND_UNCERTAIN', 'BROWSER_TARGET_CHANGED'])('preserves %s after failed read-only proof', async code => {
    const f = await fixture()
    await f.client.sendControlMessage('owned control', undefined, send)
    f.reply.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
    await expect(f.client.waitForReply(2_000, undefined, wait)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    await f.service.close(); f.reconcile.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
    await expect((await f.start()).client.waitForReply(2_000, undefined, wait)).rejects.toMatchObject({ code })
    expect(f.reply).toHaveBeenCalledOnce(); expect(f.sendMessage).toHaveBeenCalledOnce()
  })
  it('rejects missing send binding before entering the reply provider', async () => {
    const f = await fixture()
    await expect(f.client.waitForReply(2_000, undefined, wait)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.reply).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled()
  })
  it('rejects changed replay metadata before semantic reconciliation', async () => {
    const f = await fixture()
    await f.client.sendControlMessage('owned control', undefined, send)
    f.reply.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
    await expect(f.client.waitForReply(2_000, undefined, wait)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    await f.service.close()
    await expect((await f.start()).client.waitForReply(2_000, undefined, { ...wait, replyBaseline: { ...baseline, textDigest: 'f'.repeat(64) } })).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(f.reconcile).not.toHaveBeenCalled(); expect(f.sendMessage).toHaveBeenCalledOnce()
  })
  it('reconciles an uncertain send before the first resumed wait without sending again', async () => {
    const f = await fixture()
    f.sendMessage.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
    await expect(f.client.sendControlMessage('owned control', undefined, send)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    await f.service.close()
    expect(await (await f.start()).client.waitForReply(2_000, undefined, wait)).toEqual({ text: 'private settled reply', complete: true })
    expect(f.reconcile).toHaveBeenCalledOnce(); expect(f.sendMessage).toHaveBeenCalledOnce()
  })
  it.each([false, true])('replays an accepted wait only if its independently reobserved digest is unchanged (%s)', async changed => {
    const f = await fixture()
    await f.client.sendControlMessage('owned control', undefined, send)
    await f.client.waitForReply(2_000, undefined, wait)
    await f.service.close()
    if (changed) f.reply.mockResolvedValueOnce({ text: 'foreign changed reply', complete: true })
    const pending = (await f.start()).client.waitForReply(2_000, undefined, wait)
    if (changed) await expect(pending).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    else expect(await pending).toEqual({ text: 'private settled reply', complete: true })
    expect(f.reconcile).toHaveBeenCalledOnce(); expect(f.sendMessage).toHaveBeenCalledOnce()
  })
  it.each([
    { taskId: 'foreign-task' }, { iteration: 2 }, { workspaceId: 'foreign-world' }, { head: 'f'.repeat(40) },
  ])('rejects changed task/round/workspace/HEAD binding before observing replies (%j)', async changed => {
    const f = await fixture()
    const correlation = { taskId: 'owned-task', iteration: 1, workspaceId: 'owned-world', phase: 'INIT' as const }
    await f.client.sendControlMessage('owned control', undefined, { ...send, correlation })
    await expect(f.client.waitForReply(2_000, undefined, { ...wait, correlation: { ...correlation, ...changed, phase: 'PLAN' } })).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(f.reply).not.toHaveBeenCalled(); expect(f.reconcile).not.toHaveBeenCalled()
  })
  it.each(['assistantCount', 'textDigest', 'conversationId'])('rejects changed preceding baseline %s from reconciliation', async field => {
    const f = await fixture()
    await f.client.sendControlMessage('owned control', undefined, send)
    f.reply.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
    await expect(f.client.waitForReply(2_000, undefined, wait)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    await f.service.close()
    f.reconcile.mockResolvedValueOnce({ ...baseline, [field]: field === 'assistantCount' ? 99 : field === 'textDigest' ? 'f'.repeat(64) : 'foreign' })
    await expect((await f.start()).client.waitForReply(2_000, undefined, wait)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.reply).toHaveBeenCalledOnce(); expect(f.sendMessage).toHaveBeenCalledOnce()
  })
})
