import './fixtures/browser-clock.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatGptWebDriver } from '../src/browser/chatgpt-web-driver.ts'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'
import { BrowserHarnessAdapter, BrowserHarnessPrimitives } from '../src/browser/harness.ts'
import { closeDomFixtures } from './fixtures/dom-browser.ts'
import { fakeBrowserFixture } from './fixtures/fake-browser-primitives.ts'
import { webSemanticContract } from './fixtures/web-semantic-contract.ts'

afterEach(async () => { vi.useRealTimers(); await closeDomFixtures() })

it.each(['fake', 'Harness'] as const)('%s rejects a hidden conversation detour after send', async provider => {
  vi.useFakeTimers()
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  fixture.window.history.replaceState(null, '', '/c/owned')
  const browser = provider === 'fake'
    ? new ChatGptWebDriver(fixture.primitives, '')
    : new BrowserHarnessAdapter({ get: () => ({ execute: fixture.execute }) } as never, undefined, '')
  await browser.sendControlMessage('owned request')
  fixture.window.history.pushState(null, '', '/c/foreign')
  fixture.window.history.replaceState(null, '', '/c/owned')
  fixture.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">untrusted reply after detour</article>')
  const reply = browser.waitForReply(8000).catch(error => error)
  await vi.runAllTimersAsync()
  expect(await reply).toBeInstanceOf(BrowserTargetChangedError)
  expect(fixture.keys).toEqual(['Enter'])
})

it.each(['fake', 'Harness'] as const)('%s rejects a hidden typing detour before Enter', async provider => {
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  fixture.window.history.replaceState(null, '', '/c/owned')
  fixture.window.document.addEventListener('composer-type', () => {
    fixture.window.history.pushState(null, '', '/c/foreign')
    fixture.window.history.replaceState(null, '', '/c/owned')
  })
  const browser = provider === 'fake'
    ? new ChatGptWebDriver(fixture.primitives, '')
    : new BrowserHarnessAdapter({ get: () => ({ execute: fixture.execute }) } as never, undefined, '')
  await expect(browser.sendControlMessage('owned request')).rejects.toBeInstanceOf(BrowserTargetChangedError)
  expect(fixture.keys).toEqual([])
  expect(fixture.window.document.querySelector('[role="textbox"]')!.textContent).toBe('owned request')
})

it.each(['fake', 'Harness'] as const)('%s quarantines history lost after typing and forbids subsequent input', async provider => {
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  const primitives = provider === 'fake' ? fixture.primitives
    : new BrowserHarnessPrimitives({ get: () => ({ execute: fixture.execute }) } as never, undefined)
  const expected = await primitives.currentTarget()
  await primitives.focus('[role="textbox"]', { expected })
  fixture.window.document.addEventListener('composer-type', () => {
    for (let index = 0; index < 1025; index++) fixture.window.history.replaceState(null, '', '/')
  })
  await expect(primitives.type('owned request', { expected })).rejects.toMatchObject({ name: 'BrowserMutationUncertainError' })
  await expect(primitives.press('Enter', undefined, { expected })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect(fixture.keys).toEqual([])
  expect(fixture.window.document.querySelector('[role="textbox"]')!.textContent).toBe('owned request')
})

it.each(['fake', 'Harness'] as const)('%s rejects an evicted detour even when the conversation URL is unchanged', async provider => {
  vi.useFakeTimers()
  const fixture = fakeBrowserFixture('<div role="textbox" contenteditable="true"></div>', { appName: '' })
  fixture.window.history.replaceState(null, '', '/c/owned')
  const browser = provider === 'fake' ? new ChatGptWebDriver(fixture.primitives, '')
    : new BrowserHarnessAdapter({ get: () => ({ execute: fixture.execute }) } as never, undefined, '')
  await browser.sendControlMessage('owned request')
  fixture.window.history.pushState(null, '', '/c/foreign')
  for (let index = 0; index < 1025; index++) fixture.window.history.replaceState(null, '', '/c/owned')
  fixture.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">untrusted reply after eviction</article>')
  const reply = browser.waitForReply(8000).catch(error => error)
  await vi.runAllTimersAsync()
  expect(await reply).toBeInstanceOf(BrowserTargetChangedError)
  expect(fixture.keys).toEqual(['Enter'])
})
webSemanticContract('same semantic contract over session-gated Harness', async (html, options) => {
  const fixture = fakeBrowserFixture(html, options)
  const execute = async (request: Parameters<typeof fixture.execute>[0]) => {
    if (request.name.endsWith('browser_page_info')) return { value: { url: fixture.window.location.href } }
    if (request.name.endsWith('browser_goto')) { await fixture.primitives.navigate(String(request.arguments.url)); return { value: {} } }
    return fixture.execute(request)
  }
  const browser = new BrowserHarnessAdapter({ get: () => ({ execute }) } as never, undefined, options?.appName ?? 'DSH with ChatGPT')
  return { ...fixture, get window() { return fixture.window }, browser }
})
