import { describe, expect, it } from 'vitest'
import {
  BrowserStaleError,
  ChatGptLoggedOutError,
  ChatGptAppUnavailableError,
  DuplicateSendGuard,
  RetryBudget,
  extractEnvelopeText,
} from '../src/browser/adapter.ts'
import { decodeToolValue } from '../src/browser/harness.ts'

describe('DuplicateSendGuard', () => {
  it('flags identical text within cooldown', () => {
    const guard = new DuplicateSendGuard(1000)
    expect(guard.isDuplicate('INIT msg')).toBe(false)
    guard.record('INIT msg')
    expect(guard.isDuplicate('INIT msg')).toBe(true)
    expect(guard.isDuplicate('other msg')).toBe(false)
  })

  it('expires after cooldown', async () => {
    const guard = new DuplicateSendGuard(30)
    guard.record('x')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(guard.isDuplicate('x')).toBe(false)
  })
})

describe('RetryBudget', () => {
  it('enforces bounded attempts with capped backoff', () => {
    const budget = new RetryBudget(3, 100)
    expect(budget.canRetry()).toBe(true)
    expect(budget.nextDelayMs()).toBe(100)
    expect(budget.nextDelayMs()).toBe(200)
    expect(budget.nextDelayMs()).toBe(400)
    expect(budget.canRetry()).toBe(false)
    budget.reset()
    expect(budget.canRetry()).toBe(true)
    expect(budget.used).toBe(0)
  })

  it('caps backoff growth', () => {
    const budget = new RetryBudget(10, 1000)
    budget.nextDelayMs()
    budget.nextDelayMs()
    budget.nextDelayMs()
    budget.nextDelayMs()
    budget.nextDelayMs()
    expect(budget.nextDelayMs()).toBe(8000)
  })
})

describe('envelope extraction', () => {
  it('finds the LAST envelope in a conversational reply', () => {
    const reply = 'Here is my plan. [D2C] PLAN d2c_x ... old ... [D2C]\nSTATE: PLAN\nTASK_ID: d2c_ab12cd\nITERATION: 2'
    expect(extractEnvelopeText(reply)).toContain('ITERATION: 2')
  })

  it('returns null without envelope', () => {
    expect(extractEnvelopeText('just chatting')).toBeNull()
  })
})

describe('typed errors', () => {
  it('carries stable prefixes', () => {
    expect(new ChatGptLoggedOutError().message).toContain('ChatGPT_WEB_LOGGED_OUT')
    expect(new BrowserStaleError('composer gone').message).toContain('BROWSER_STALE')
    expect(new ChatGptAppUnavailableError('DSH with ChatGPT').message).toContain('CHATGPT_APP_UNAVAILABLE')
  })
})

describe('Browser Harness MCP result decoding', () => {
  it('unwraps canonical structured content', () => {
    expect(decodeToolValue<{ ok: boolean }>({
      value: { structuredContent: { ok: true } },
    })).toEqual({ ok: true })
  })

  it('unwraps nested MCP text content as JSON', () => {
    expect(decodeToolValue<{ url: string }>({
      value: { content: [{ type: 'text', text: '{"url":"https://chatgpt.com/"}' }] },
    })).toEqual({ url: 'https://chatgpt.com/' })
  })

  it('parses top-level DSH text results', () => {
    expect(decodeToolValue<{ found: boolean }>({
      content: [{ type: 'text', text: '{"found":true}' }],
    })).toEqual({ found: true })
  })
})
