import './fixtures/browser-clock.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { fakeBrowserFixture } from './fixtures/fake-browser-primitives.ts'
import { closeDomFixtures } from './fixtures/dom-browser.ts'
import { ChatGptWebDriver } from '../src/browser/chatgpt-web-driver.ts'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'
const composer = '<div role="textbox" contenteditable="true"></div>'
const oldReply = '<article data-message-author-role="assistant">private old reply</article>'
afterEach(async () => { vi.useRealTimers(); await closeDomFixtures() })
async function fixture() {
  const f = fakeBrowserFixture(composer + oldReply, { appName: '' })
  f.window.history.replaceState(null, '', '/c/owned')
  return { ...f, driver: new ChatGptWebDriver(f.primitives, '') }
}
describe('durable semantic reply observation baseline', () => {
  it('captures only bounded identity, count and digest without mutation or bodies', async () => {
    const f = await fixture()
    const baseline = await f.driver.captureReplyBaseline()
    expect(baseline).toMatchObject({ version: 1, conversationId: 'owned', assistantCount: 1, textDigest: createHash('sha256').update('private old reply').digest('hex') })
    expect(baseline.observationEpoch).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(baseline)).not.toContain('private old reply')
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
  it('restores the baseline after driver reconstruction without accepting an old reply', async () => {
    vi.useFakeTimers()
    const f = await fixture(), baseline = await f.driver.captureReplyBaseline()
    const restarted = new ChatGptWebDriver(f.primitives, '')
    const result = restarted.waitForReply(6_000, undefined, { operationId: 'wait-owned', replyBaseline: baseline }).catch(error => error)
    await vi.runAllTimersAsync()
    expect(await result).toBeInstanceOf(Error)
    expect(f.keys).toEqual([])
  })
  it('observes a stable new reply after reconstruction without another Enter', async () => {
    vi.useFakeTimers()
    const f = await fixture(), baseline = await f.driver.captureReplyBaseline()
    await f.driver.sendControlMessage('owned prompt', undefined, { operationId: 'send-owned', replyBaseline: baseline })
    f.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">new settled reply</article>')
    const restarted = new ChatGptWebDriver(f.primitives, '')
    const result = restarted.waitForReply(12_000, undefined, { operationId: 'wait-owned', replyBaseline: JSON.parse(JSON.stringify(baseline)) })
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ text: 'new settled reply', complete: true })
    expect(f.keys.filter(key => key === 'Enter')).toHaveLength(1)
  })
  it.each(['conversation', 'document'])('rejects changed %s before resumed observation', async kind => {
    const f = await fixture(), baseline = await f.driver.captureReplyBaseline()
    if (kind === 'conversation') f.window.history.pushState(null, '', '/c/foreign')
    else f.invalidateTarget()
    const restarted = new ChatGptWebDriver(f.primitives, '')
    await expect(restarted.waitForReply(12_000, undefined, { operationId: 'wait-owned', replyBaseline: baseline })).rejects.toBeInstanceOf(BrowserTargetChangedError)
    expect(f.keys).toEqual([])
  })
  it('rejects a changed baseline before sending rather than resetting it silently', async () => {
    const f = await fixture(), baseline = await f.driver.captureReplyBaseline()
    f.window.document.body.insertAdjacentHTML('beforeend', '<article data-message-author-role="assistant">unexpected reply</article>')
    await expect(f.driver.sendControlMessage('must not send', undefined, { operationId: 'send-owned', replyBaseline: baseline })).rejects.toBeInstanceOf(BrowserTargetChangedError)
    expect(f.keys).toEqual([]); expect(f.inputs).toEqual([])
  })
})
