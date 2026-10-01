import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { syntheticCdpDocument } from './fixtures/synthetic-cdp-document.ts'
import { DirectCdpPrimitives } from '../src/browser/direct-cdp.ts'
import { ChatGptWebDriver } from '../src/browser/chatgpt-web-driver.ts'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'

// REAL CHROME / REAL CDP / SYNTHETIC CHATGPT-SHAPED PAGE.
// Fetch interception supplies local test content, never real ChatGPT evidence.
let fixture: Awaited<ReturnType<typeof localCdpBrowser>>
let document: Awaited<ReturnType<typeof syntheticCdpDocument>>
let primitives: DirectCdpPrimitives
beforeAll(async () => {
  fixture = await localCdpBrowser()
  document = await syntheticCdpDocument(fixture.endpoint, fixture.targetId)
  primitives = await DirectCdpPrimitives.connect({ endpoint: fixture.endpoint, targetId: fixture.targetId, commandTimeoutMs: 2000 })
}, 15_000)
afterAll(async () => { primitives?.close(); document?.close(); await fixture?.close() }, 10_000)
async function page(options: Parameters<typeof document.serve>[0] = {}, route = '/') {
  document.serve(options)
  await primitives.navigate('https://chatgpt.com' + route)
  await primitives.waitForLoad(5000)
  return new ChatGptWebDriver(primitives, '')
}
beforeEach(async () => { await page() })

it('selects one exact App and dispatches the control message exactly once', async () => {
  await page({ apps: ['Different App', 'DSH with ChatGPT'] })
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  await driver.sendControlMessage('owned request')
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
  expect(await primitives.evaluate('window.sent.map(text => text.replace(/\u00a0/g, " "))')).toEqual(['DSH with ChatGPT owned request'])
  expect(await driver.currentConversation()).toBe('promoted')
})

it.each([[], ['DSH with ChatGPT', 'DSH with ChatGPT']])('rejects missing or ambiguous App without sending', async apps => {
  await page({ apps })
  const driver = new ChatGptWebDriver(primitives, 'DSH with ChatGPT')
  await expect(driver.sendControlMessage('owned request')).rejects.toMatchObject({ name: 'ChatGptAppUnavailableError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('')
})

it('preserves a foreign draft and rejects conversation switching during input', async () => {
  let driver = await page({ draft: 'existing draft' })
  await expect(driver.sendControlMessage('owned request')).rejects.toMatchObject({ name: 'BrowserStaleError' })
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('existing draft')
  driver = await page({ foreignOnInput: true }, '/c/owned')
  await expect(driver.sendControlMessage('owned request')).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('foreign draft')
})

it('keeps the baseline during new-chat promotion and waits for streaming to settle', async () => {
  const driver = await page({ baseline: true })
  await driver.sendControlMessage('owned request')
  await primitives.evaluate('window.addReply("partial", true)')
  let settled = false
  const reply = driver.waitForReply(12_000).then(value => { settled = true; return value })
  await new Promise(resolve => setTimeout(resolve, 2000))
  expect(settled).toBe(false)
  await primitives.evaluate('(() => { const node = document.querySelector("[data-markdown-animated]"); node.textContent = "complete reply"; node.removeAttribute("data-markdown-animated"); return true })()')
  expect(await reply).toEqual({ text: 'complete reply', complete: true })
  expect(await primitives.evaluate('window.enterCount')).toBe(1)
}, 15_000)

it('rejects unrelated same-document replies and same-URL replacement', async () => {
  let driver = await page({}, '/c/owned')
  await driver.sendControlMessage('owned request')
  await primitives.evaluate('(() => { history.pushState(null, "", "/c/foreign"); window.addReply("foreign reply"); return true })()')
  await expect(driver.waitForReply(5000)).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
  driver = await page({}, '/c/owned')
  await driver.sendControlMessage('owned request')
  await primitives.navigate('https://chatgpt.com/c/owned')
  await primitives.waitForLoad(5000)
  await primitives.evaluate('window.addReply("replacement reply")')
  await expect(driver.waitForReply(5000)).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
}, 10_000)

it('detects logout without synthetic success', async () => {
  const driver = await page({ logout: true })
  await expect(driver.ensureReady()).rejects.toMatchObject({ name: 'ChatGptLoggedOutError' })
})

it('stops a send on real document replacement during typing and preserves the replacement draft', async () => {
  const driver = await page({ replaceOnInput: true }, '/c/owned')
  await expect(driver.sendControlMessage('owned request')).rejects.toBeInstanceOf(BrowserTargetChangedError)
  if (primitives.bindingState !== 'BOUND') await primitives.reconnect()
  await primitives.waitForLoad(5000)
  expect(await primitives.evaluate('window.enterCount')).toBe(0)
  expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('replacement draft')
})

it('cleans only acknowledged owned input after cancellation without late Enter', async () => {
  const driver = await page()
  const controller = new AbortController()
  const type = primitives.type.bind(primitives)
  primitives.type = async (text, context) => {
    const ack = await type(text, context)
    controller.abort()
    return ack
  }
  try {
    await expect(driver.sendControlMessage('owned request', controller.signal)).rejects.toMatchObject({ name: 'OperationCancelledError' })
    expect(await primitives.evaluate('window.enterCount')).toBe(0)
    expect(await primitives.evaluate('document.querySelector("[role=textbox]").textContent')).toBe('')
    expect(await primitives.evaluate('window.keys')).toEqual(['a', 'Backspace'])
  } finally { primitives.type = type }
})
