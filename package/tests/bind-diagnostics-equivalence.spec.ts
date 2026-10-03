import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ChatGptWebDriver } from '../src/browser/chatgpt-web-driver.ts'
import { fakeBrowserFixture } from './fixtures/fake-browser-primitives.ts'
import { closeDomFixtures } from './fixtures/dom-browser.ts'
import { installBindDiagnostics } from './fixtures/bind-diagnostics.mjs'

afterEach(closeDomFixtures)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

it.each(['success', 'digest', 'ambiguous'] as const)('keeps browser calls and outcome identical with each diagnostic sink: %s', async scenario => {
  const html = '<div role="textbox" contenteditable="true"></div>'
    + `<article data-message-author-role="user"><a href="/plugins/owned">DSH with ChatGPT</a> ${scenario === 'digest' ? 'foreign' : 'control'}</article>`
    + (scenario === 'ambiguous' ? '<article data-message-author-role="pending">hydrating</article>' : '')
  const outcomes = []
  for (const sink of [undefined, () => {}, () => { throw new Error('sink failed') }, () => Promise.reject(new Error('sink failed')), () => new Promise<void>(() => {})]) {
    const f = fakeBrowserFixture(html)
    f.window.history.replaceState(null, '', '/c/owned')
    const calls: string[] = []
    for (const method of ['observe', 'currentTarget', 'evaluate', 'pageInfo'] as const) {
      const original = f.primitives[method].bind(f.primitives)
      vi.spyOn(f.primitives, method).mockImplementation((...args: unknown[]) => {
        calls.push(method)
        return Reflect.apply(original, f.primitives, args)
      })
    }
    const driver = new ChatGptWebDriver(f.primitives, 'DSH with ChatGPT')
    const reconcile = vi.spyOn(driver, 'reconcileReplyBaseline')
    const conversation = vi.spyOn(driver, 'currentConversation')
    if (sink) installBindDiagnostics(driver, sink)
    let outcome
    try {
      const value = await driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash('control') })
      outcome = { assistantCount: value.assistantCount, textDigest: value.textDigest, conversationId: value.conversationId }
    } catch (error) {
      const failure = error as Error & { code?: string; diagnosticReason?: string }
      outcome = { name: failure.name, message: failure.message, code: failure.code, diagnosticReason: failure.diagnosticReason }
    }
    outcomes.push({ outcome, calls, reconcileCount: reconcile.mock.calls.length, conversationCount: conversation.mock.calls.length })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  }
  for (const outcome of outcomes.slice(1)) expect(outcome).toEqual(outcomes[0])
})
