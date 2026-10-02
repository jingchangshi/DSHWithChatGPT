import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { sidecarProcess } from './fixtures/sidecar-process.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = [], directories: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) await child.close()
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('plannerbridge-bootstrap-process-')) throw new Error('Unexpected fixture cleanup target')
    await rm(directory, { recursive: true, force: true })
  }
})
async function start(directory: string, options: Parameters<typeof sidecarProcess>[1]) {
  const child = await sidecarProcess(directory, options); children.push(child)
  expect(child.pid).not.toBe(process.pid)
  return { child, client: new SidecarChatControlClient({ endpoint: child.endpoint, authentication: child.authentication, requestTimeoutMs: 1_000 }) }
}
// Two separate Windows children with unchanged 5s startup / RPC / phase limits.
// The external browser view and ACK are synthetic, never real ChatGPT evidence.
describe('bootstrap observation across independent Sidecar processes', { timeout: 15_000 }, () => {
  it.each(['exact', 'missing', 'foreign'] as const)('reconciles a canonical lost ACK from %s proof across separate processes', async recoveryView => {
    const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-bootstrap-process-')); directories.push(directory)
    const first = await start(directory, { recoveryView: 'exact', bootstrap: true, pausePhase: 'observed-sent' })
    const baseline = await first.client.captureReplyBaseline()
    const operation = { operationId: 'canonical-bootstrap-send', replyBaseline: baseline,
      correlation: { taskId: 'pb_' + 'a'.repeat(32), iteration: 0, workspaceId: 'world', phase: 'INIT' as const } }
    const pending = first.client.sendControlMessage('owned recovery control', undefined, operation).catch(error => error)
    await first.child.waitForPhase(operation.operationId, 'observed-sent')
    await first.child.crash(); expect(await pending).toBeInstanceOf(Error)
    const restarted = await start(directory, { recoveryView })
    const file = join(directory, 'delivery.json'), before = await readFile(file, 'utf8')
    if (recoveryView === 'exact') {
      const recovered = await restarted.client.captureSendObservation(operation.operationId)
      expect(recovered).toMatchObject({ conversationId: 'owned', assistantCount: baseline.assistantCount, textDigest: baseline.textDigest })
      expect(JSON.parse(await readFile(file, 'utf8')).entries.find((e: any) => e.operationId === operation.operationId)).toMatchObject({ phase: 'accepted', bootstrapBaseline: recovered })
    } else {
      await expect(restarted.client.captureSendObservation(operation.operationId)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
      expect(await readFile(file, 'utf8')).toBe(before)
    }
    expect(first.child.sends).toEqual(['owned recovery control'])
    expect(restarted.child.sends).toEqual([])
  })
  it.each(['before-ack', 'after-ack-unbound', 'after-bound'] as const)('never resends after a crash at %s', async boundary => {
    const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-bootstrap-process-')); directories.push(directory)
    const first = await start(directory, { recoveryView: 'exact', bootstrap: true, ...(boundary === 'before-ack' ? { pausePhase: 'sending' } : {}) })
    const baseline = await first.client.captureReplyBaseline()
    expect(baseline.conversationId).toBeNull()
    const operation = { operationId: 'bootstrap-send', replyBaseline: baseline }
    const pending = first.client.sendControlMessage('owned recovery control', undefined, operation).catch(error => error)
    let observed
    if (boundary === 'before-ack') {
      await first.child.waitForPhase(operation.operationId, 'sending')
      await first.child.crash(); expect(await pending).toBeInstanceOf(Error)
    } else {
      expect(await pending).toBeUndefined()
      if (boundary === 'after-bound') observed = await first.client.captureSendObservation(operation.operationId)
      await first.child.crash()
    }
    const restarted = await start(directory, { recoveryView: 'exact' })
    expect(restarted.child.pid).not.toBe(first.child.pid)
    // The synthetic restarted browser route deliberately looks owned. It is
    // insufficient to bind either unbound source after the ACK witness was lost.
    expect(await restarted.client.currentConversation()).toBe('owned')
    if (boundary === 'after-bound') {
      const recovered = await restarted.client.captureSendObservation(operation.operationId)
      expect(recovered).toEqual(observed)
      expect(await restarted.client.waitForReply(2_000, undefined, { operationId: 'bootstrap-wait', replyBaseline: recovered,
        replyRecovery: { sendOperationId: operation.operationId } })).toEqual({ text: 'reply to owned recovery control', complete: true })
    } else await expect(restarted.client.captureSendObservation(operation.operationId)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(first.child.sends).toEqual(boundary === 'before-ack' ? [] : ['owned recovery control'])
    expect(restarted.child.sends).toEqual([])
    const disk = await readFile(join(directory, 'delivery.json'), 'utf8')
    expect(disk).not.toContain('owned recovery control')
  })
})
