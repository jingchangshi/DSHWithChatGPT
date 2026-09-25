import { describe, expect, it } from 'vitest'
import { ChatGptLoggedOutError } from '../src/browser/adapter.ts'
import {
  BrowserHarnessAdapter,
  conversationIdFromUrl,
  composerFillExpression,
  unwrapJsValue,
  type BrowserHarnessOptions,
} from '../src/browser/harness.ts'

/** One dispatched call, as the plugin hands it to the tools service. */
interface Dispatched {
  callId: string
  name: string
  arguments: Record<string, unknown>
  agent: unknown
  signal: AbortSignal
}

/** Scripted tools service: one queued response per upstream tool call. */
function scriptedTools(responses: Array<{ text: string; isError?: boolean }>) {
  const dispatched: Dispatched[] = []
  const service = {
    async execute(input: Dispatched) {
      dispatched.push(input)
      const next = responses.shift() ?? { text: '{}' }
      return {
        isError: next.isError === true,
        content: [{ type: 'text', text: next.text }],
        ...next.isError === true ? { error: { message: next.text } } : {},
      }
    },
  }
  return { dispatched, service, ctx: { get: (name: string) => name === 'tools' ? service : undefined } }
}

/** One adapter over a scripted tools service, with fast polling. */
function makeAdapter(
  responses: Array<{ text: string; isError?: boolean }>,
  options: BrowserHarnessOptions = { callTimeoutMs: 2000, replyPollMs: 5 },
): { adapter: BrowserHarnessAdapter; dispatched: Dispatched[]; agent: { sessionId: string } } {
  const scripted = scriptedTools(responses)
  const agent = { sessionId: 'session-1' }
  return {
    adapter: new BrowserHarnessAdapter(scripted.ctx, agent, options),
    dispatched: scripted.dispatched,
    agent,
  }
}

/** The upstream tool names one dispatch sequence names, without the namespace prefix. */
const toolNames = (dispatched: Dispatched[]): string[] =>
  dispatched.map(call => call.name.replace('mcp__browser-harness__', ''))

describe('call identity', () => {
  it('dispatches through the session-gated namespace with an identity, agent, and signal', async () => {
    const { adapter, dispatched, agent } = makeAdapter([{ text: '{"ok":true}' }])
    await expect(adapter.call('browser_page_info', {})).resolves.toEqual({ ok: true })
    expect(dispatched).toHaveLength(1)
    const call = dispatched[0] as Dispatched
    expect(call.name).toBe('mcp__browser-harness__browser_page_info')
    expect(call.agent).toBe(agent)
    expect(call.callId).toMatch(/^d2c-browser-browser_page_info-/u)
    expect(call.signal).toBeInstanceOf(AbortSignal)
    expect(call.signal.aborted).toBe(false)
  })

  it('raises upstream error payloads and failed results as errors', async () => {
    const payload = makeAdapter([{ text: '{"error":"no such tab"}' }])
    await expect(payload.adapter.call('browser_goto', { url: 'https://x/' })).rejects.toThrow('browser_goto failed: no such tab')
    const failed = makeAdapter([{ text: 'transport down', isError: true }])
    await expect(failed.adapter.call('browser_goto', { url: 'https://x/' })).rejects.toThrow('browser_goto failed: transport down')
  })

  it('fails loud when the tools service is absent', async () => {
    const adapter = new BrowserHarnessAdapter({ get: () => undefined }, undefined)
    await expect(adapter.call('browser_page_info', {})).rejects.toThrow('tools service unavailable for browser control')
  })
})

describe('ChatGPT control flow', () => {
  it('opens ChatGPT with the real provider tools and rejects a signed-out session', async () => {
    const signedOut = '{"composer":true,"signedOut":true}'
    const { adapter, dispatched } = makeAdapter([
      { text: '{"ok":true}' },
      { text: '{"loaded":true}' },
      { text: signedOut },
      { text: '{"ok":true}' },
      { text: '{"loaded":true}' },
      { text: signedOut },
      { text: '{"ok":true}' },
      { text: '{"loaded":true}' },
      { text: signedOut },
    ])
    await expect(adapter.ensureReady()).rejects.toThrow(ChatGptLoggedOutError)
    expect(toolNames(dispatched)).toEqual([
      'browser_goto', 'browser_wait_for_load', 'browser_js',
      'browser_goto', 'browser_wait_for_load', 'browser_js',
    ])
    expect(dispatched[0]?.arguments).toEqual({ url: 'https://chatgpt.com/' })
    expect(dispatched[1]?.arguments).toEqual({ timeout: 30 })
  })

  it('fills the composer and submits with Enter', async () => {
    const { adapter, dispatched } = makeAdapter([
      { text: '{"ok":true}' },
      { text: '{"ok":true}' },
      { text: '{"present":true,"text":""}' },
    ])
    await adapter.sendControlMessage('INIT text')
    expect(toolNames(dispatched)).toEqual(['browser_fill', 'browser_press', 'browser_js'])
    expect(dispatched[0]?.arguments).toEqual({ selector: '#prompt-textarea', text: 'INIT text', clear_first: true })
    expect(dispatched[1]?.arguments).toEqual({ key: 'Enter' })
  })

  it('falls back to explicit insertion when the upstream fill misses the editable composer', async () => {
    const { adapter, dispatched } = makeAdapter([
      { text: '{"error":"no input matched"}' },
      { text: 'true' },
      { text: '{"ok":true}' },
      { text: '{"present":true,"text":""}' },
    ])
    await adapter.sendControlMessage('EXECUTED text')
    expect(toolNames(dispatched)).toEqual(['browser_fill', 'browser_js', 'browser_press', 'browser_js'])
    expect(dispatched[1]?.arguments).toEqual({ expression: composerFillExpression('EXECUTED text') })
  })

  it('reports a missing composer when the fallback insertion also fails', async () => {
    const { adapter } = makeAdapter([
      { text: '{"error":"no input matched"}' },
      { text: 'false' },
    ])
    await expect(adapter.sendControlMessage('x')).rejects.toThrow('BROWSER_STALE')
  })

  it('fails when the composer still holds the message after Enter', async () => {
    const { adapter } = makeAdapter([
      { text: '{"ok":true}' },
      { text: '{"ok":true}' },
      { text: '{"present":true,"text":"INIT text"}' },
    ])
    await expect(adapter.sendControlMessage('INIT text')).rejects.toThrow('still holds the message after Enter')
  })

  it('fails when the composer disappears after Enter', async () => {
    const { adapter } = makeAdapter([
      { text: '{"ok":true}' },
      { text: '{"ok":true}' },
      { text: '{"present":false,"text":""}' },
    ])
    await expect(adapter.sendControlMessage('INIT text')).rejects.toThrow('composer disappeared after Enter')
  })

  it('waits for a settled, non-streaming reply and reports reachability', async () => {
    const { adapter, dispatched } = makeAdapter([
      { text: '{"text":"partial","streaming":true}' },
      { text: '{"text":"[D2C] STATE: PLAN","streaming":false}' },
      { text: '{"text":"[D2C] STATE: PLAN","streaming":false}' },
      { text: '{"ok":true}' },
      { text: '{"loaded":true}' },
      { text: '{"composer":true,"signedOut":false}' },
    ])
    await expect(adapter.waitForReply(5_000)).resolves.toEqual({ text: '[D2C] STATE: PLAN', complete: true })
    await expect(adapter.health()).resolves.toEqual({ ok: true, detail: 'chatgpt.com reachable and signed in' })
    // Three reply probes plus the sign-in probe inside health().
    expect(toolNames(dispatched).filter(name => name === 'browser_js')).toHaveLength(4)
  })

  it('reports a signed-out session instead of a healthy one', async () => {
    const { adapter } = makeAdapter([
      { text: '{"ok":true}' },
      { text: '{"loaded":true}' },
      { text: '{"composer":true,"signedOut":true}' },
    ])
    await expect(adapter.health()).resolves.toEqual({ ok: false, detail: 'chatgpt.com reachable but signed out' })
  })

  it('times out with the stale-browser error when no reply settles', async () => {
    const { adapter } = makeAdapter([{ text: '{"text":"still streaming","streaming":true}' }])
    await expect(adapter.waitForReply(30)).rejects.toThrow('BROWSER_STALE')
  })
})

describe('browser_js payload shapes', () => {
  it('accepts both the bare value and the wrapped result', () => {
    expect(unwrapJsValue(true)).toBe(true)
    expect(unwrapJsValue({ result: { text: 'x' } })).toEqual({ text: 'x' })
    expect(unwrapJsValue({ text: 'x' })).toEqual({ text: 'x' })
  })
})

describe('conversation identity', () => {
  it('reads direct and Project conversation URLs through browser_js', async () => {
    const id = '6ab6419b-6d8c-83e8-8b4c-d32346cac683'
    const { adapter, dispatched } = makeAdapter([{ text: JSON.stringify(`https://chatgpt.com/g/g-p-demo/c/${id}`) }])
    await expect(adapter.currentConversationId()).resolves.toBe(id)
    expect(dispatched[0]?.name).toBe('mcp__browser-harness__browser_js')
    expect(dispatched[0]?.arguments).toEqual({ expression: 'location.href' })
    expect(conversationIdFromUrl(`https://chatgpt.com/c/${id}`)).toBe(id)
    expect(conversationIdFromUrl(`https://chatgpt.com/g/g-p-demo/c/${id}`)).toBe(id)
    expect(conversationIdFromUrl('https://chatgpt.com/')).toBeUndefined()
    expect(conversationIdFromUrl('https://other.example/c/' + id)).toBeUndefined()
  })
})
