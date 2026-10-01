import { describe, expect, it, vi } from 'vitest'
import { BrowserStaleError, ChatGptAppUnavailableError, ChatGptLoggedOutError } from '../../src/browser/adapter.ts'
import { OperationCancelledError } from '../../src/cancellation.ts'
import { BrowserTargetChangedError } from '../../src/browser/epoch.ts'
import type { ChatControl } from '../../src/core/ports/chat-control.ts'
import type { fakeBrowserFixture } from './fake-browser-primitives.ts'

type Fixture = ReturnType<typeof fakeBrowserFixture> & { browser: ChatControl }
type Factory = (html: string, options?: Parameters<typeof fakeBrowserFixture>[1]) => Promise<Fixture>
const composer = '<div role="textbox" contenteditable="true"></div>'
const app = '<div role="listbox"><button>DSH with ChatGPT</button></div>'
const oldReply = '<article data-message-author-role="assistant" data-message-id="old">old reply</article>'

export function webSemanticContract(name: string, create: Factory): void {
  describe(name, () => {
    it('selects the exact App and sends one owned prompt', async () => {
      const f = await create(composer + app, { mention: true })
      await f.browser.sendControlMessage('requested work')
      expect(f.enteredText()).toBe('DSH with ChatGPT requested work')
      expect(f.keys.filter(key => key === 'Enter')).toHaveLength(1)
    })
    it.each(['missing', 'duplicate'])('fails closed for %s App', async kind => {
      vi.useFakeTimers()
      const f = await create(composer + (kind === 'duplicate' ? app + app : ''))
      const result = f.browser.sendControlMessage('requested work').catch(error => error)
      await vi.runAllTimersAsync()
      expect(await result).toBeInstanceOf(ChatGptAppUnavailableError)
      expect(f.keys).not.toContain('Enter')
    })
    it.each([false, true])('cancels and preserves foreign drafts (foreign=%s)', async foreign => {
      const f = await create(composer, { appName: '' })
      const controller = new AbortController()
      f.window.document.addEventListener('composer-type', () => {
        controller.abort()
        if (foreign) f.window.document.querySelector('[role="textbox"]')!.textContent = 'foreign draft'
      })
      await expect(f.browser.sendControlMessage('owned prompt', controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
      expect(f.window.document.querySelector('[role="textbox"]')!.textContent).toBe(foreign ? 'foreign draft' : '')
      expect(f.keys).toEqual(foreign ? [] : ['a', 'Backspace'])
    })
    it('ignores a pre-existing assistant reply until timeout', async () => {
      vi.useFakeTimers()
      const f = await create(composer + oldReply, { appName: '' })
      await f.browser.sendControlMessage('owned prompt')
      const result = f.browser.waitForReply(6_000).catch(error => error)
      await vi.runAllTimersAsync()
      expect(await result).toBeInstanceOf(BrowserStaleError)
    })
    it('requires a new reply to remain stable before returning', async () => {
      vi.useFakeTimers()
      const f = await create(composer + oldReply, { appName: '' })
      await f.browser.sendControlMessage('owned prompt')
      f.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant" data-message-id="new">new reply</article>')
      let settled = false
      const pending = f.browser.waitForReply(12_000).then(reply => { settled = true; return reply })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(settled).toBe(false)
      await vi.runAllTimersAsync()
      expect(await pending).toEqual({ text: 'new reply', complete: true })
    })
    it('does not settle while streaming and settles after streaming ends', async () => {
      vi.useFakeTimers()
      const f = await create(composer, { appName: '' })
      await f.browser.sendControlMessage('owned prompt')
      f.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant" data-message-id="new">streamed reply</article><button aria-label="Stop streaming"></button>')
      let settled = false
      const pending = f.browser.waitForReply(15_000).then(reply => { settled = true; return reply })
      await vi.advanceTimersByTimeAsync(4_000)
      expect(settled).toBe(false)
      f.window.document.querySelector('button')!.remove()
      await vi.runAllTimersAsync()
      expect((await pending).text).toBe('streamed reply')
    })
    it('reports logout while waiting', async () => {
      vi.useFakeTimers()
      const f = await create('<button>Log in</button>', { appName: '' })
      const result = f.browser.waitForReply(2_000).catch(error => error)
      await vi.runAllTimersAsync()
      expect(await result).toBeInstanceOf(ChatGptLoggedOutError)
    })
    it('reopens a conversation and restores semantic readiness', async () => {
      const f = await create(composer, { appName: '' })
      expect(await f.browser.openConversation('conversation-123')).toBe('conversation-123')
      await f.browser.recover()
      expect(await f.browser.currentConversation()).toBe('conversation-123')
    })
    it('rejects same-URL document replacement instead of accepting an unrelated reply', async () => {
      vi.useFakeTimers()
      const f = await create(composer, { appName: '' })
      await f.browser.sendControlMessage('owned prompt')
      f.invalidateTarget()
      f.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">unrelated reply</article>')
      const result = f.browser.waitForReply(10_000).catch(error => error)
      await vi.runAllTimersAsync()
      expect(await result).toBeInstanceOf(BrowserTargetChangedError)
      expect(f.keys.filter(key => key === 'Enter')).toHaveLength(1)
    })
    it('preserves the replacement document during a failed send', async () => {
      const f = await create(composer, { appName: '' })
      f.window.document.addEventListener('composer-type', () => {
        f.invalidateTarget()
        f.window.document.querySelector('[role="textbox"]')!.textContent = 'foreign new document draft'
      })
      await expect(f.browser.sendControlMessage('owned prompt')).rejects.toBeInstanceOf(BrowserTargetChangedError)
      expect(f.keys).toEqual([])
      expect(f.window.document.querySelector('[role="textbox"]')!.textContent).toBe('foreign new document draft')
    })
    it('times out endless streaming without treating it as a completed reply', async () => {
      vi.useFakeTimers()
      const f = await create(composer, { appName: '' })
      await f.browser.sendControlMessage('owned prompt')
      f.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">unfinished reply</article><button aria-label="Stop streaming"></button>')
      const result = f.browser.waitForReply(6_000).catch(error => error)
      await vi.runAllTimersAsync()
      expect(await result).toBeInstanceOf(BrowserStaleError)
    })
  })
}
