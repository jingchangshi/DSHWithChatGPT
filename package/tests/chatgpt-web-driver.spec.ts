import './fixtures/browser-clock.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'
import { BrowserStaleError } from '../src/browser/adapter.ts'
import { OperationCancelledError } from '../src/cancellation.ts'
import { closeDomFixtures } from './fixtures/dom-browser.ts'
import { fakeBrowserFixture } from './fixtures/fake-browser-primitives.ts'
import { webSemanticContract } from './fixtures/web-semantic-contract.ts'

afterEach(async () => { vi.useRealTimers(); await closeDomFixtures() })
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
