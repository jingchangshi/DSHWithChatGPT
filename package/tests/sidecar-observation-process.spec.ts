import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sidecarProcess } from './fixtures/sidecar-process.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = [], directories: string[] = []
afterEach(async () => { await Promise.all(children.splice(0).map(child => child.close())); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function start(directory: string, options: Parameters<typeof sidecarProcess>[1]) {
  const child = await sidecarProcess(directory, options); children.push(child)
  expect(child.pid).not.toBe(process.pid)
  return { child, client: new SidecarChatControlClient({ endpoint: child.endpoint, authentication: child.authentication, requestTimeoutMs: 1_000 }) }
}
// Each scenario starts two Windows children (each has its existing 5s startup
// bound), protects private state and interrupts transport. Budget the complete
// scenario separately; RPC, provider, phase and startup deadlines stay fixed.
describe('separate-process fake-browser observation recovery', { timeout: 15_000 }, () => {
  it.each(['exact', 'missing', 'foreign'] as const)('crashes during a persisted wait and resumes only exact external fixture evidence (%s)', async recoveryView => {
    const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-observation-process-')); directories.push(directory)
    const first = await start(directory, { recoveryView: 'exact', pausePhase: 'awaiting-reply' })
    const baseline = await first.client.captureReplyBaseline()
    await first.client.sendControlMessage('owned recovery control', undefined, { operationId: 'owned-send', replyBaseline: baseline })
    const operation = { operationId: 'owned-wait', replyBaseline: baseline, replyRecovery: { sendOperationId: 'owned-send' } }
    const interrupted = first.client.waitForReply(2_000, undefined, operation).catch(error => error)
    await first.child.waitForPhase(operation.operationId, 'awaiting-reply')
    await first.child.crash(); expect(await interrupted).toBeInstanceOf(Error)
    const restarted = await start(directory, { recoveryView })
    expect(restarted.child.pid).not.toBe(first.child.pid)
    const result = restarted.client.waitForReply(2_000, undefined, operation)
    if (recoveryView === 'exact') expect(await result).toEqual({ text: 'reply to owned recovery control', complete: true })
    else await expect(result).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(first.child.sends).toEqual(['owned recovery control']); expect(restarted.child.sends).toEqual([])
    const disk = await readFile(join(directory, 'delivery.json'), 'utf8')
    expect(disk).not.toContain('owned recovery control')
  })
})
