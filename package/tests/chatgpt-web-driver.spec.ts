import './fixtures/browser-clock.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'
import { BrowserStaleError } from '../src/browser/adapter.ts'
import { OperationCancelledError } from '../src/cancellation.ts'
import { closeDomFixtures } from './fixtures/dom-browser.ts'
import { fakeBrowserFixture } from './fixtures/fake-browser-primitives.ts'
import { webSemanticContract } from './fixtures/web-semantic-contract.ts'

afterEach(async () => { vi.useRealTimers(); await closeDomFixtures() })

it('retains the reply baseline across an acknowledged same-document new-chat route', async () => {
  vi.useFakeTimers()
  const { ChatGptWebDriver } = await import('../src/browser/chatgpt-web-driver.ts')
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  fixture.window.history.replaceState(null, '', 'https://chatgpt.com/')
  const press = fixture.primitives.press
  fixture.primitives.press = async (key, modifiers, signal) => {
    await press(key, modifiers, signal)
    if (key === 'Enter') fixture.window.history.pushState(null, '', '/c/new-conversation')
  }
  const browser = new ChatGptWebDriver(fixture.primitives, '')
  await browser.sendControlMessage('owned request')
  expect(fixture.keys.filter(key => key === 'Enter')).toHaveLength(1)
  expect(await browser.currentConversation()).toBe('new-conversation')
  fixture.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">new conversation reply</article>')
  const result = browser.waitForReply(12_000).catch(error => error)
  await vi.runAllTimersAsync()
  expect(await result).toEqual({ text: 'new conversation reply', complete: true })
})

it('passes the captured document fence to the final input mutation', async () => {
  const { ChatGptWebDriver } = await import('../src/browser/chatgpt-web-driver.ts')
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  const press = fixture.primitives.press
  let receivedFence = false
  fixture.primitives.press = async (key, modifiers, context: any) => {
    if (key === 'Enter') {
      receivedFence = context?.expected !== undefined
      fixture.invalidateTarget()
      fixture.window.document.querySelector('[role="textbox"]')!.textContent = 'replacement document draft'
      // The transport learns about replacement after the driver's preflight.
      // A supplied old fence must prevent dispatch; preflight alone cannot.
      if (receivedFence) throw new BrowserTargetChangedError()
    }
    await press(key, modifiers, context?.signal ?? context)
  }
  const browser = new ChatGptWebDriver(fixture.primitives, '')
  await expect(browser.sendControlMessage('owned request')).rejects.toBeInstanceOf(BrowserTargetChangedError)
  expect(receivedFence).toBe(true)
  expect(fixture.keys).not.toContain('Enter')
  expect(fixture.window.document.querySelector('[role="textbox"]')!.textContent).toBe('replacement document draft')
})

webSemanticContract('semantic driver over fake DOM primitives', async (html, options) => {
  const { ChatGptWebDriver } = await import('../src/browser/chatgpt-web-driver.ts')
  const fixture = fakeBrowserFixture(html, options)
  return { ...fixture, get window() { return fixture.window }, browser: new ChatGptWebDriver(fixture.primitives, options?.appName ?? 'DSH with ChatGPT') }
})

it('rejects an epoch change during typing without cleanup or late Enter in the new document', async () => {
  const { ChatGptWebDriver } = await import('../src/browser/chatgpt-web-driver.ts')
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  const browser = new ChatGptWebDriver(fixture.primitives, '')
  fixture.window.document.addEventListener('composer-type', () => {
    fixture.invalidateTarget()
    fixture.window.document.querySelector('[role="textbox"]')!.textContent = 'new document draft'
  })
  await expect(browser.sendControlMessage('owned request')).rejects.toBeInstanceOf(BrowserTargetChangedError)
  expect(fixture.keys).toEqual([])
  expect(fixture.window.document.querySelector('[role="textbox"]')!.textContent).toBe('new document draft')
})

it('rejects a previous reply baseline after same-URL navigation', async () => {
  vi.useFakeTimers()
  const { ChatGptWebDriver } = await import('../src/browser/chatgpt-web-driver.ts')
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  const browser = new ChatGptWebDriver(fixture.primitives, '')
  await browser.sendControlMessage('owned request')
  fixture.invalidateTarget()
  fixture.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">unrelated new document reply</article>')
  const result = browser.waitForReply(10_000).catch(error => error)
  await vi.runAllTimersAsync()
  expect(await result).toBeInstanceOf(BrowserTargetChangedError)
})

it('bounds fresh cleanup when a primitive never answers and prevents continuation after settlement', async () => {
  const { ChatGptWebDriver } = await import('../src/browser/chatgpt-web-driver.ts')
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  const controller = new AbortController()
  fixture.window.document.addEventListener('composer-type', () => controller.abort())
  let cleanupSignal: AbortSignal | undefined
  let initiallyLive = false
  let resolveLate: (() => void) | undefined
  const press = fixture.primitives.press
  fixture.primitives.press = async (key, modifiers, signal) => {
    cleanupSignal = signal
    initiallyLive = !signal?.aborted
    await press(key, modifiers, signal)
    await new Promise<void>(resolve => { resolveLate = resolve })
  }
  const browser = new ChatGptWebDriver(fixture.primitives, '')
  const started = Date.now()
  await expect(browser.sendControlMessage('owned request', controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
  expect(Date.now() - started).toBeLessThan(3_500)
  expect(initiallyLive).toBe(true)
  expect(cleanupSignal?.aborted).toBe(true)
  expect(fixture.keys).toEqual(['a'])
  resolveLate!()
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(fixture.keys).toEqual(['a'])
}, 5_000)

it('bounds reply waiting even if document observation never answers', async () => {
  const { ChatGptWebDriver } = await import('../src/browser/chatgpt-web-driver.ts')
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  const browser = new ChatGptWebDriver(fixture.primitives, '')
  await browser.sendControlMessage('owned request')
  fixture.primitives.observe = () => new Promise<never>(() => {})
  const started = Date.now()
  await expect(browser.waitForReply(2_000)).rejects.toBeInstanceOf(BrowserStaleError)
  expect(Date.now() - started).toBeLessThan(3_500)
}, 5_000)
