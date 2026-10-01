import './fixtures/browser-clock.ts'
import { afterEach, vi } from 'vitest'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import { closeDomFixtures } from './fixtures/dom-browser.ts'
import { fakeBrowserFixture } from './fixtures/fake-browser-primitives.ts'
import { webSemanticContract } from './fixtures/web-semantic-contract.ts'

afterEach(async () => { vi.useRealTimers(); await closeDomFixtures() })
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
