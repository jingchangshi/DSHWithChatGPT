import './fixtures/browser-clock.ts'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowserFixture } from './fixtures/fake-browser-primitives.ts'
import { closeDomFixtures } from './fixtures/dom-browser.ts'
import { ChatGptWebDriver } from '../src/browser/chatgpt-web-driver.ts'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const control = '[PLANNER_BRIDGE]\nVERSION: 2\nSTATE: INIT\nTASK_ID: pb_' + 'a'.repeat(32) + '\nITERATION: 0\nWORKSPACE_ID: owned-world\n\nGOAL:\nowned outgoing control'
const composer = '<div role="textbox" contenteditable="true">foreign unsent draft</div>'
const previous = '<article data-message-author-role="assistant">previous reply</article>'
const user = (text = control, app = 'DSH with ChatGPT') => `<article data-message-author-role="user"><a href="/plugins/owned">${app}</a> ${text}</article>`
afterEach(async () => { vi.useRealTimers(); await closeDomFixtures() })
function fixture(messages: string) {
  const f = fakeBrowserFixture(composer + messages, { appName: 'DSH with ChatGPT' })
  f.window.history.replaceState(null, '', '/c/owned')
  return { ...f, get window() { return f.window }, driver: new ChatGptWebDriver(f.primitives, 'DSH with ChatGPT') }
}
describe('explicit read-only outgoing-message reconciliation', () => {
  it('reconciles current search-unit messages and resumes the shared current reply reader', async () => {
    vi.useFakeTimers()
    const assistant = (text: string, id: string) => `<div data-chatgpt-search-unit-key="turn:${id}:assistant" data-content-search-unit-key="turn:${id}:assistant"><h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：</h4><div data-chatgpt-selection-message-id="${id}"><div data-markdown-text-style="assistant-message">${text}</div><button>Copy</button></div></div>`
    const outgoing = `<div data-chatgpt-search-unit-key="turn:user" data-chatgpt-search-message-ids="user"><div data-content-search-unit-key="turn:user"><div class="text-size-chat whitespace-pre-wrap"><a href="/plugins/owned">DSH with ChatGPT</a> ${control}</div></div></div>`
    const f = fixture(assistant('previous reply', 'old') + outgoing + assistant('current reply', 'new'))
    const baseline = await f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) })
    expect(baseline).toMatchObject({ assistantCount: 1, textDigest: hash('previous reply') })
    const pending = f.driver.waitForReply(12_000, undefined, { operationId: 'current-resumed-wait', replyBaseline: baseline })
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ text: 'current reply', complete: true })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
  it('derives the preceding assistant baseline and resumes a visible reply without input', async () => {
    vi.useFakeTimers()
    const f = fixture(previous + user(control) + '<article data-message-author-role="assistant">current reply</article>')
    const baseline = await f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) })
    expect(baseline).toMatchObject({ assistantCount: 1, textDigest: hash('previous reply'), conversationId: 'owned' })
    const pending = f.driver.waitForReply(12_000, undefined, { operationId: 'resumed-wait', replyBaseline: baseline })
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ text: 'current reply', complete: true })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
    expect(f.window.document.querySelector('[role="textbox"]')!.textContent).toBe('foreign unsent draft')
  })
  it('permits explicit rebind to a changed document only after exact outgoing-message proof', async () => {
    const f = fixture(previous + user())
    const old = await f.driver.captureReplyBaseline()
    f.invalidateTarget()
    const baseline = await new ChatGptWebDriver(f.primitives, 'DSH with ChatGPT').reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) })
    expect(baseline.observationEpoch).not.toBe(old.observationEpoch)
    expect(baseline.assistantCount).toBe(1)
    expect(f.keys).toEqual([])
  })
  it.each([
    ['missing outgoing message', previous],
    ['different digest', previous + user('foreign control')],
    ['foreign latest user message', previous + user() + user('later foreign message')],
    ['duplicate candidate', previous + user() + user()],
    ['ambiguous current message body', previous + user() + '<div data-chatgpt-search-unit-key="turn:assistant"><h4 data-conversation-role="assistant">ChatGPT 说：</h4><div>unproven body</div></div>'],
    ['wrong configured App', previous + user(control, 'Other App')],
    ['fake App prose without mention', previous + `<article data-message-author-role="user">DSH with ChatGPT ${control}</article>`],
    ['hidden App mention', previous + `<article data-message-author-role="user"><a href="/plugins/owned" style="display:none">DSH with ChatGPT</a> ${control}</article>`],
    ['hidden outgoing control', previous + `<article data-message-author-role="user"><a href="/plugins/owned">DSH with ChatGPT</a> <span style="display:none">${control}</span></article>`],
  ])('refuses %s without touching the draft', async (_name, messages) => {
    const f = fixture(messages)
    await expect(f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) })).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
  it('refuses a different conversation even if its message body is identical', async () => {
    const f = fixture(previous + user())
    f.window.history.pushState(null, '', '/c/foreign')
    await expect(f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) })).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.keys).toEqual([])
  })
})
