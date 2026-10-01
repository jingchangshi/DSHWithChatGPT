import { domFixture } from './dom-browser.ts'
import { BrowserTargetChangedError, sameBrowserTarget, type BrowserTargetIdentity } from '../../src/browser/epoch.ts'
import type { BrowserMutationContext } from '../../src/browser/primitives.ts'
import { typingFocusExpression } from '../../src/browser/focus-expression.ts'

// No ChatGPT policy lives here. Input mechanics and actual DOM evaluation are shared
// with the session-gated transport fixture; navigation identities remain observable.
export function fakeBrowserFixture(html: string, options: Parameters<typeof domFixture>[1] = {}) {
  const fixture = domFixture(html, options)
  let epoch = 0
  const identity = () => ({ targetId: 'owned-target', documentId: 'document-' + epoch, url: fixture.window.location.href, epoch })
  const guard = (context: BrowserMutationContext) => {
    context.signal?.throwIfAborted()
    if (!sameBrowserTarget(context.expected, identity())) throw new BrowserTargetChangedError()
  }
  const mutation = async (context: BrowserMutationContext, operation: () => Promise<unknown>) => {
    guard(context)
    await operation()
    if (!sameBrowserTarget(context.expected, identity())) throw new BrowserTargetChangedError()
    return { target: identity() }
  }
  const call = async (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const result = await fixture.execute({ name: `mcp__browser-harness__${name}`, arguments: args })
    if (result.isError || (result.value as { isError?: boolean })?.isError) throw new Error('provider failed')
    return result.value
  }
  const primitives = {
    observe: async <T>(expression: string, expected?: BrowserTargetIdentity, signal?: AbortSignal) => {
      const target = identity()
      if (expected && !sameBrowserTarget(expected, target)) throw new BrowserTargetChangedError()
      const value = await call('browser_js', { expression }, signal) as T
      if (!sameBrowserTarget(identity(), target)) throw new BrowserTargetChangedError()
      return { value, target: identity() }
    },
    pageInfo: async (signal?: AbortSignal) => { await call('browser_page_info', {}, signal); return { url: fixture.window.location.href } },
    currentTarget: async (signal?: AbortSignal) => { await call('browser_current_tab', {}, signal); return identity() },
    evaluate: async <T>(expression: string, signal?: AbortSignal): Promise<T> => await call('browser_js', { expression }, signal) as T,
    focus: async (selector: string, context: BrowserMutationContext) => mutation(context, () => call('browser_js', { expression: typingFocusExpression(selector) }, context.signal)),
    type: async (text: string, context: BrowserMutationContext) => mutation(context, () => call('browser_type', { text }, context.signal)),
    press: async (key: string, modifiers: number | undefined, context: BrowserMutationContext) => mutation(context, () => call('browser_press', { key, ...(modifiers === undefined ? {} : { modifiers }) }, context.signal)),
    click: async (x: number, y: number, context: BrowserMutationContext) => mutation(context, () => call('browser_click', { x, y }, context.signal)),
    activateTarget: async (targetId: string, signal?: AbortSignal) => { await call('browser_cdp', { method: 'Target.activateTarget', params: { targetId } }, signal) },
    navigate: async (url: string, signal?: AbortSignal) => { signal?.throwIfAborted(); fixture.window.location.href = url; epoch++ },
    waitForLoad: async (_timeoutMs: number, signal?: AbortSignal) => { signal?.throwIfAborted() },
    waitForMutation: async (timeoutMs: number, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, timeoutMs)
        function done() { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve() }
        function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason) }
        signal?.addEventListener('abort', abort, { once: true })
      })
    },
  }
  return { ...fixture, get window() { return fixture.window }, primitives, invalidateTarget: () => { epoch++; fixture.replaceDocument() } }
}
