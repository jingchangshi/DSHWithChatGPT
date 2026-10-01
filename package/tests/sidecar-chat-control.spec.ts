import { afterEach, describe, expect, it } from 'vitest'
import type { ChatControl } from '../src/core/ports/chat-control.ts'
import { sidecarProcess } from './fixtures/sidecar-process.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = []
afterEach(async () => { await Promise.all(children.splice(0).map(child => child.close())) })
const factories: Record<string, () => Promise<ChatControl>> = {
  'in-process fake semantic port': async () => {
    let conversation: string | undefined
    let text = ''
    return { health: async () => ({ ok: true, detail: 'ready' }), ensureReady: async () => {}, recover: async () => {}, openConversation: async id => { conversation = id ?? 'created-conversation'; return conversation }, currentConversation: async () => conversation, sendControlMessage: async value => { text = 'reply to ' + value }, waitForReply: async () => ({ text, complete: true }) }
  },
  'semantic client over separate Sidecar process': async () => {
    const { SidecarChatControlClient } = await import('../src/sidecar/client.ts')
    const child = await sidecarProcess()
    children.push(child)
    expect(child.pid).not.toBe(process.pid)
    return new SidecarChatControlClient({ endpoint: child.endpoint, authentication: child.authentication, requestTimeoutMs: 1_000 })
  },
}
for (const [name, create] of Object.entries(factories)) describe(name, () => {
  it('implements health and semantic readiness', async () => { const control = await create(); expect((await control.health()).ok).toBe(true); await control.ensureReady() })
  it('preserves conversation identity across recovery', async () => { const control = await create(); expect(await control.openConversation('test-conversation')).toBe('test-conversation'); await control.recover(); expect(await control.currentConversation()).toBe('test-conversation') })
  it('returns the same semantic reply shape', async () => { const control = await create(); await control.ensureReady(); await control.sendControlMessage('requested work'); expect(await control.waitForReply(3_000)).toEqual({ text: 'reply to requested work', complete: true }) })
})
