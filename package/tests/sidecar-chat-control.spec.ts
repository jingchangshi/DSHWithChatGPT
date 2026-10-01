import { afterEach, describe, expect, it } from 'vitest'
import type { ChatControl } from '../src/core/ports/chat-control.ts'
import { sidecarProcess } from './fixtures/sidecar-process.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = []
afterEach(async () => { await Promise.all(children.splice(0).map(child => child.close())) })
const factories: Record<string, () => Promise<ChatControl>> = {
  'in-process fake semantic port': async () => {
    let conversation: string | undefined
    let text = ''
    const error = (code: string) => Object.assign(new Error(code), { code })
    const check = (signal?: AbortSignal) => { if (signal?.aborted) throw error('OPERATION_CANCELLED') }
    return {
      health: async () => ({ ok: true, detail: 'ready' }), ensureReady: async signal => { check(signal) }, recover: async signal => { check(signal) },
      openConversation: async (id, signal) => { check(signal); conversation = id ?? 'created-conversation'; return conversation }, currentConversation: async signal => { check(signal); return conversation },
      sendControlMessage: async (value, signal) => { check(signal); if (value === 'logged-out') throw error('CHATGPT_LOGGED_OUT'); if (value === 'app-unavailable') throw error('CHATGPT_APP_UNAVAILABLE'); text = 'reply to ' + value },
      waitForReply: async (timeoutMs, signal) => {
        check(signal)
        if (text) return { text, complete: true }
        await new Promise<never>((_resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(error('OPERATION_CANCELLED')) }
          const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); reject(error('BROWSER_STALE')) }, timeoutMs)
          signal?.addEventListener('abort', abort, { once: true })
        })
        throw new Error('Unreachable fixture state')
      },
    }
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
  it('reports no conversation before one is opened', async () => { expect(await (await create()).currentConversation()).toBeUndefined() })
  it('creates a conversation when no identity is supplied', async () => { const control = await create(); expect(await control.openConversation()).toBe('created-conversation'); expect(await control.currentConversation()).toBe('created-conversation') })
  it('refuses a pre-aborted send without producing a reply', async () => {
    const control = await create(); const controller = new AbortController(); controller.abort()
    await expect(control.sendControlMessage('must not send', controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    await expect(control.waitForReply(20)).rejects.toMatchObject({ code: 'BROWSER_STALE' })
  })
  it('times out without a reply while preserving service availability', async () => { const control = await create(); await expect(control.waitForReply(20)).rejects.toMatchObject({ code: 'BROWSER_STALE' }); expect((await control.health()).ok).toBe(true) })
  it('cancels reply observation with the same semantic error', async () => {
    const control = await create(); await control.ensureReady(); const controller = new AbortController()
    const pending = control.waitForReply(1_000, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    const timer = setTimeout(() => controller.abort(), 25)
    try { await rejected } finally { clearTimeout(timer) }
    expect((await control.health()).ok).toBe(true)
  })
  it.each([['logged-out', 'CHATGPT_LOGGED_OUT'], ['app-unavailable', 'CHATGPT_APP_UNAVAILABLE']])('fails closed for %s', async (text, code) => { await expect((await create()).sendControlMessage(text)).rejects.toMatchObject({ code }) })
  it('implements health and semantic readiness', async () => { const control = await create(); expect((await control.health()).ok).toBe(true); await control.ensureReady() })
  it('preserves conversation identity across recovery', async () => { const control = await create(); expect(await control.openConversation('test-conversation')).toBe('test-conversation'); await control.recover(); expect(await control.currentConversation()).toBe('test-conversation') })
  it('returns the same semantic reply shape', async () => { const control = await create(); await control.ensureReady(); await control.sendControlMessage('requested work'); expect(await control.waitForReply(3_000)).toEqual({ text: 'reply to requested work', complete: true }) })
})
