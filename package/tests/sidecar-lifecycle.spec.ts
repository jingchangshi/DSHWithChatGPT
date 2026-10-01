import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sidecarProcess } from './fixtures/sidecar-process.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = []
// Two independently bounded 5s process starts, plus IPC and RPC assertions.
// This budget does not change the 1s operation or 2s phase/cleanup deadlines.
const restartTestBudget = 15_000
afterEach(async () => { for (const child of children.splice(0).reverse()) await child.close() })
async function start(state?: string, options?: Parameters<typeof sidecarProcess>[1]) { const child = await sidecarProcess(state, options); children.push(child); return child }
function envelope(sidecar: Awaited<ReturnType<typeof sidecarProcess>>, text: string, operationId = randomUUID()) {
  return { version: 1, generation: sidecar.generation, requestId: randomUUID(), operationId, method: 'sendControlMessage', params: { text } }
}
async function rpc(sidecar: Awaited<ReturnType<typeof sidecarProcess>>, body: unknown) {
  const response = await fetch(sidecar.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + sidecar.authentication, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return response.json()
}
describe('separate-process operation delivery lifecycle', () => {
  it('binds observation metadata into durable replay identity across restart', async () => {
    const first = await start()
    const replyBaseline = { version: 1, conversationId: 'owned', assistantCount: 1, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) }
    const request = { ...envelope(first, 'owned baseline send'), replyBaseline }
    expect(await rpc(first, request)).toMatchObject({ ok: true })
    await first.crash()
    const second = await start(first.stateDirectory)
    expect(await rpc(second, { ...request, generation: second.generation, requestId: randomUUID() })).toMatchObject({ ok: true })
    expect(await rpc(second, { ...request, generation: second.generation, requestId: randomUUID(), replyBaseline: { ...replyBaseline, assistantCount: 2 } })).toMatchObject({ ok: false, error: { code: 'REPLAY_CONFLICT' } })
    expect(second.sends).toEqual([])
  }, restartTestBudget)
  it('bounds an abort-ignoring driver and keeps the uncertain operation quarantined', async () => {
    const child = await start()
    const request = envelope(child, 'hang-before-ack')
    expect(await rpc(child, request)).toMatchObject({ ok: false, error: { code: 'SIDECAR_TIMEOUT' } })
    const stored = JSON.parse(await readFile(join(child.stateDirectory, 'delivery.json'), 'utf8'))
    expect(stored.entries.find((entry: any) => entry.operationId === request.operationId).phase).toBe('uncertain')
    expect(await rpc(child, envelope(child, 'must not enter after timeout'))).toMatchObject({ ok: false, error: { code: 'SIDECAR_BUSY' } })
    expect(child.sends).toEqual(['hang-before-ack'])
  })
  it('applies the operation deadline before browser mutation begins', async () => {
    const child = await start(undefined, { pausePhase: 'prepared' })
    const request = envelope(child, 'must not enter after preparation timeout')
    expect(await rpc(child, request)).toMatchObject({ ok: false, error: { code: 'SIDECAR_TIMEOUT' } })
    const stored = JSON.parse(await readFile(join(child.stateDirectory, 'delivery.json'), 'utf8'))
    expect(stored.entries.find((entry: any) => entry.operationId === request.operationId).phase).toBe('cancelled')
    expect(child.sends).toEqual([])
  })
  it('admits only one new writer when two processes reclaim a dead owner concurrently', async () => {
    const original = await start()
    await original.crash()
    const results = await Promise.allSettled([sidecarProcess(original.stateDirectory), sidecarProcess(original.stateDirectory)])
    const winners = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof sidecarProcess>>> => result.status === 'fulfilled')
    for (const winner of winners) children.push(winner.value)
    expect(winners).toHaveLength(1)
    const loser = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(String(loser.reason)).toMatch(/SIDECAR_BUSY|JOURNAL_UNAVAILABLE/)
    expect(await rpc(winners[0]!.value, envelope(winners[0]!.value, 'single writer after crash'))).toMatchObject({ ok: true })
    expect(winners[0]!.value.sends).toEqual(['single writer after crash'])
  }, restartTestBudget)
  it.each(['prepared', 'sending', 'observed-sent', 'accepted'])('reconciles a hard crash at durable phase %s without forgotten sends', async phase => {
    const first = await start(undefined, { pausePhase: phase })
    const request = envelope(first, 'crash boundary')
    const pending = rpc(first, request).catch(error => error)
    await first.waitForPhase(request.operationId, phase)
    expect(first.sends.length).toBe(['prepared', 'sending'].includes(phase) ? 0 : 1)
    await first.crash(); await pending
    const second = await start(first.stateDirectory)
    const result = await rpc(second, { ...request, requestId: randomUUID(), generation: second.generation })
    if (phase === 'prepared') { expect(result).toMatchObject({ ok: true }); expect(second.sends).toEqual(['crash boundary']) }
    else if (phase === 'accepted') { expect(result).toMatchObject({ ok: true }); expect(second.sends).toEqual([]) }
    else { expect(result).toMatchObject({ ok: false, error: { code: 'SEND_UNCERTAIN' } }); expect(second.sends).toEqual([]) }
  }, restartTestBudget)
  it('retains an interrupted reply observation without resending a control message', async () => {
    const first = await start(undefined, { pausePhase: 'awaiting-reply' })
    const request = { ...envelope(first, 'unused'), method: 'waitForReply', params: { timeoutMs: 100 } }
    const pending = rpc(first, request).catch(error => error)
    await first.waitForPhase(request.operationId, 'awaiting-reply')
    await first.crash(); await pending
    const second = await start(first.stateDirectory)
    expect(await rpc(second, { ...request, requestId: randomUUID(), generation: second.generation })).toMatchObject({ ok: false, error: { code: 'SEND_UNCERTAIN' } })
    expect(second.sends).toEqual([])
  }, restartTestBudget)
  it('cancels at the prepared boundary before invoking the semantic send', async () => {
    const child = await start(undefined, { pausePhase: 'prepared' })
    const request = envelope(child, 'must not mutate')
    const pending = rpc(child, request)
    await child.waitForPhase(request.operationId, 'prepared')
    expect(await rpc(child, { ...request, requestId: randomUUID(), operationId: randomUUID(), method: 'cancel', params: { operationId: request.operationId } })).toMatchObject({ ok: true })
    expect(await pending).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } })
    const stored = JSON.parse(await readFile(join(child.stateDirectory, 'delivery.json'), 'utf8'))
    expect(stored.entries.find((entry: any) => entry.operationId === request.operationId).phase).toBe('cancelled')
    expect(child.sends).toEqual([])
  })
  it('joins simultaneous attempts of one logical operation before completion', async () => {
    const child = await start(undefined, { pausePhase: 'prepared' })
    const request = envelope(child, 'one in-flight operation')
    const first = rpc(child, request)
    await child.waitForPhase(request.operationId, 'prepared')
    const second = rpc(child, { ...request, requestId: randomUUID() })
    child.resume(request.operationId)
    expect(await first).toMatchObject({ ok: true })
    expect(await second).toMatchObject({ ok: true })
    expect(child.sends).toEqual(['one in-flight operation'])
  })
  describe('bounded shutdown after process readiness', () => {
    let child: Awaited<ReturnType<typeof start>>
    // Startup has its own 5s bound. Keep it outside the shutdown assertion budget.
    beforeEach(async () => { child = await start() })
    it('shuts down the transport and flushes uncertainty while a driver ignores abort', async () => {
      const request = envelope(child, 'hang-before-ack')
      const pending = rpc(child, request).catch(error => error)
      await child.waitForPhase(request.operationId, 'sending')
      expect(await rpc(child, { ...request, requestId: randomUUID(), operationId: randomUUID(), method: 'shutdown', params: {} })).toMatchObject({ ok: true })
      expect(await pending).toMatchObject({ ok: false, error: { code: 'SIDECAR_SHUTTING_DOWN' } })
      const deadline = Date.now() + 3_000
      while (Date.now() < deadline) { try { await stat(join(child.stateDirectory, 'owner.lock')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error } await new Promise(resolve => setTimeout(resolve, 20)) }
      await expect(stat(join(child.stateDirectory, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
      const stored = JSON.parse(await readFile(join(child.stateDirectory, 'delivery.json'), 'utf8'))
      expect(stored.entries.find((entry: any) => entry.operationId === request.operationId).phase).toBe('uncertain')
      await expect(fetch(child.endpoint)).rejects.toThrow()
    })
  })
  it('allows a fresh attempt of the same operation after BUSY refused admission', async () => {
    const child = await start()
    const first = envelope(child, 'abortable-send')
    const pending = rpc(child, first)
    const deadline = Date.now() + 2_000
    while (!child.sends.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    const refused = envelope(child, 'retry after busy')
    expect(await rpc(child, refused)).toMatchObject({ ok: false, error: { code: 'SIDECAR_BUSY' } })
    expect(await rpc(child, { ...first, requestId: randomUUID(), operationId: randomUUID(), method: 'cancel', params: { operationId: first.operationId } })).toMatchObject({ ok: true })
    await pending
    expect(await rpc(child, { ...refused, requestId: randomUUID() })).toMatchObject({ ok: true })
    expect(child.sends).toEqual(['abortable-send', 'retry after busy'])
  })
  it('replays through caller-supplied client identity without another semantic send', async () => {
    const child = await start()
    const { SidecarChatControlClient } = await import('../src/sidecar/client.ts')
    const client = new SidecarChatControlClient({ endpoint: child.endpoint, authentication: child.authentication })
    const operation = { operationId: randomUUID() }
    await client.sendControlMessage('stable client send', undefined, operation)
    await client.sendControlMessage('stable client send', undefined, operation)
    expect(child.sends).toEqual(['stable client send'])
  })
  it('rejects a new operation ID for the same correlated task round', async () => {
    const child = await start()
    const request = { ...envelope(child, 'one task round'), correlation: { taskId: 'task-one', iteration: 1, workspaceId: 'workspace-one', phase: 'EXECUTED' } }
    expect(await rpc(child, request)).toMatchObject({ ok: true })
    expect(await rpc(child, { ...request, requestId: randomUUID(), operationId: randomUUID() })).toMatchObject({ ok: false, error: { code: 'REPLAY_CONFLICT' } })
    expect(child.sends).toEqual(['one task round'])
  })
  it('quarantines a cancelled driver that ignores abort from incompatible work', async () => {
    const child = await start()
    const request = envelope(child, 'hang-before-ack')
    const pending = rpc(child, request)
    const deadline = Date.now() + 2_000
    while (!child.sends.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    expect(await rpc(child, { ...request, requestId: randomUUID(), operationId: randomUUID(), method: 'cancel', params: { operationId: request.operationId } })).toMatchObject({ ok: true })
    expect(await pending).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } })
    expect(await rpc(child, envelope(child, 'must not enter'))).toMatchObject({ ok: false, error: { code: 'SIDECAR_BUSY' } })
    expect(child.sends).toEqual(['hang-before-ack'])
  })
  it('replays the same operation across different transport IDs without another send', async () => {
    const child = await start()
    const request = envelope(child, 'one logical send')
    const first = await rpc(child, request)
    const second = await rpc(child, { ...request, requestId: randomUUID() })
    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: true })
    expect(child.sends).toEqual(['one logical send'])
  })
  it('rejects both request-ID and operation-ID payload conflicts', async () => {
    const child = await start()
    const request = envelope(child, 'original payload')
    expect(await rpc(child, request)).toMatchObject({ ok: true })
    expect(await rpc(child, { ...request, params: { text: 'changed payload' } })).toMatchObject({ ok: false, error: { code: 'REPLAY_CONFLICT' } })
    expect(await rpc(child, { ...request, requestId: randomUUID(), params: { text: 'changed payload' } })).toMatchObject({ ok: false, error: { code: 'REPLAY_CONFLICT' } })
    expect(child.sends).toEqual(['original payload'])
  })
  it('records uncertain sends across a hard process crash and forbids automatic resend', async () => {
    const first = await start()
    const request = envelope(first, 'hang-before-ack')
    const pending = rpc(first, request).catch(error => error)
    const deadline = Date.now() + 2_000
    while (first.sends.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    expect(first.sends).toEqual(['hang-before-ack'])
    await first.crash()
    await pending
    const second = await start(first.stateDirectory)
    expect(second.pid).not.toBe(first.pid)
    expect(second.generation).not.toBe(first.generation)
    const response = await rpc(second, { ...request, requestId: randomUUID(), generation: second.generation })
    expect(response).toMatchObject({ ok: false, error: { code: 'SEND_UNCERTAIN' } })
    expect(second.sends).toEqual([])
  }, restartTestBudget)
  it('uses a separate cancellation request for the logical operation while remaining responsive', async () => {
    const child = await start()
    const request = envelope(child, 'hang-before-ack')
    const pending = rpc(child, request).catch(error => error)
    const deadline = Date.now() + 2_000
    while (!child.sends.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    const cancel = { version: 1, requestId: randomUUID(), operationId: randomUUID(), generation: child.generation, method: 'cancel', params: { operationId: request.operationId } }
    expect(cancel.requestId).not.toBe(request.requestId)
    expect(await rpc(child, cancel)).toMatchObject({ ok: true })
    await pending
    expect(await rpc(child, { ...cancel, requestId: randomUUID(), operationId: randomUUID(), method: 'health', params: {} })).toMatchObject({ ok: true })
    expect(child.sends).toEqual(['hang-before-ack'])
  })
})
