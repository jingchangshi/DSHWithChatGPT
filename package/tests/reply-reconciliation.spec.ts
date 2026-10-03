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
  const hydrationShell = '<div data-chatgpt-search-unit-key="hydrate:user" data-chatgpt-search-message-ids="hydrate-user"></div>'
  const hydrationFixture = () => {
    const f = fixture(hydrationShell)
    f.window.document.querySelector('[role="textbox"]')!.textContent = ''
    return f
  }
  it('waits for only the unique current-role missing body without input or reload', async () => {
    vi.useFakeTimers()
    const f = hydrationFixture()
    const pending = f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) })
    setTimeout(() => { f.window.document.querySelector('[data-chatgpt-search-unit-key]')!.innerHTML = `<div class="text-size-chat whitespace-pre-wrap"><a href="/plugins/owned">DSH with ChatGPT</a> ${control}</div>` }, 2000)
    await vi.advanceTimersByTimeAsync(2100)
    expect(await pending).toMatchObject({ conversationId: 'owned', assistantCount: 0 })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
  it('ends permanent missing-body observation at the single ten-second deadline', async () => {
    vi.useFakeTimers()
    const f = hydrationFixture()
    const started = Date.now()
    const outcome = f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) }).catch(error => error)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await outcome).toMatchObject({ code: 'SEND_UNCERTAIN', diagnosticReason: 'PROOF_NOT_FOUND' })
    expect(Date.now() - started).toBe(10_001)
    expect(f.keys).toEqual([])
  })
  it.each(['route', 'document', 'caller'] as const)('ends missing-body observation on %s change', async reason => {
    vi.useFakeTimers()
    const f = hydrationFixture()
    const controller = new AbortController()
    const outcome = f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) }, controller.signal).catch(error => error)
    await vi.advanceTimersByTimeAsync(400)
    if (reason === 'route') f.window.history.pushState(null, '', '/c/foreign')
    else if (reason === 'document') f.invalidateTarget()
    else controller.abort()
    await vi.advanceTimersByTimeAsync(300)
    expect(await outcome).toMatchObject({ name: reason === 'caller' ? 'OperationCancelledError' : 'BrowserTargetChangedError' })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
  it('does not refresh the deadline after slow initial observation', async () => {
    vi.useFakeTimers()
    const f = hydrationFixture()
    const original = f.primitives.observe.bind(f.primitives)
    vi.spyOn(f.primitives, 'observe').mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => setTimeout(resolve, 8000))
      return original(...args)
    })
    const outcome = f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) }).catch(error => error)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await outcome).toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.keys).toEqual([])
  })
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
  it.each([
    ['wrong digest', previous + user('foreign control'), 'DIGEST_MISMATCH'],
    ['wrong App', previous + user(control, 'Other App'), 'WRONG_APP'],
    ['duplicate exact user', previous + user() + user(), 'PROOF_AMBIGUOUS'],
    ['later foreign user', previous + user() + user('foreign'), 'NOT_LAST_USER'],
    ['unclassifiable assistant', previous + user() + '<div data-chatgpt-search-unit-key="turn:assistant"><h4 data-conversation-role="assistant">ChatGPT 说：</h4><div>unproven body</div></div>', 'OBSERVATION_MISSING'],
    ['missing user with foreign draft', previous, 'DRAFT_PRESENT'],
  ])('reports only the local enum for %s', async (_name, messages, diagnosticReason) => {
    const f = fixture(messages)
    await expect(f.driver.reconcileReplyBaseline({ conversationId: 'owned', controlDigest: hash(control) })).rejects.toMatchObject({
      code: 'SEND_UNCERTAIN', name: 'SendUncertainError', message: 'SEND_UNCERTAIN', diagnosticReason,
    })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
  it('distinguishes invalid request and changed conversation without exposing identities', async () => {
    const f = fixture(previous + user())
    await expect(f.driver.reconcileReplyBaseline({ conversationId: '', controlDigest: hash(control) })).rejects.toMatchObject({ diagnosticReason: 'REQUEST_INVALID' })
    await expect(f.driver.reconcileReplyBaseline({ conversationId: 'foreign', controlDigest: hash(control) })).rejects.toMatchObject({ diagnosticReason: 'CONVERSATION_CHANGED' })
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
})
