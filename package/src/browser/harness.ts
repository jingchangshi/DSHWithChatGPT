import type { Context } from '@deepseek-ai/cordis'
import { abortableDelay, OperationCancelledError, throwIfCancelled, withCancellation } from '../cancellation.ts'
import { BrowserStaleError } from './errors.ts'
import { ChatGptWebDriver } from './chatgpt-web-driver.ts'
import { typingFocusExpression } from './focus-expression.ts'
import { captureBrowserHistory } from './history-observation.ts'
import { BrowserTransitionHistoryUnavailableError, type BrowserTransition } from './transitions.ts'
import type { BrowserPrimitives, BrowserMutationContext, BrowserMutationAck } from './primitives.ts'
import { BrowserTargetChangedError, BrowserMutationUncertainError, sameBrowserTarget, type BrowserTargetIdentity } from './epoch.ts'

interface ToolResultBlock {
  type?: string
  text?: string
}

interface ToolResultLike {
  isError?: boolean
  value?: unknown
  error?: { message?: string }
  content?: ToolResultBlock[]
}


/** Session-gated Browser Harness mechanics; contains no ChatGPT DOM policy. */
export class BrowserHarnessPrimitives implements BrowserPrimitives {
  readonly settlesOnCancellation = true
  private callSequence = 0
  private epoch = 0
  private previousTarget: { targetId: string; url: string } | undefined
  private documentToken: string | undefined
  private quarantined = false
  constructor(private readonly ctx: Context, private readonly execAgent: { session: { header: { cwd: string } } } | undefined) {}
  async observe<T>(expression: string, expected?: BrowserTargetIdentity, signal?: AbortSignal): Promise<{ value: T; target: BrowserTargetIdentity; transitions: BrowserTransition[] }> {
    if (this.quarantined) throw new BrowserTargetChangedError()
    if (expected && expected.epoch !== this.epoch) throw new BrowserTargetChangedError()
    const native = await this.call<{ targetId?: string; url?: string }>('browser_current_tab', {}, signal)
    if (typeof native?.targetId !== 'string') throw new BrowserStaleError('browser target identity unavailable')
    if (expected && expected.targetId !== native.targetId) throw new BrowserTargetChangedError()
    const result = await this.evaluate<{ value: T; token?: string; url?: string; sequence?: number; transitions?: BrowserTransition[]; targetChanged?: boolean; unavailable?: boolean }>(`(() => {
      const doc = document;
      const key = '__plannerbridgeDocumentIdentity';
      if (!doc[key]) Object.defineProperty(doc, key, { value: crypto.randomUUID() });
      const token = doc[key];
      const expected = ${JSON.stringify(expected ?? null)};
      if (expected && expected.documentId !== token) return { targetChanged: true };
      const capture = ${captureBrowserHistory.toString()};
      const before = capture(window, expected?.transitionSequence);
      if (before.unavailable) return before;
      const observed = { value: (${expression}) };
      return { ...observed, ...capture(window, expected?.transitionSequence) };
    })()`, signal)
    if (result?.targetChanged) throw new BrowserTargetChangedError()
    if (result?.unavailable || !Number.isSafeInteger(result?.sequence) || !Array.isArray(result?.transitions)) throw new BrowserTransitionHistoryUnavailableError()
    if (typeof result?.token !== 'string' || typeof result.url !== 'string') throw new BrowserStaleError('browser document identity unavailable')
    if (this.documentToken !== undefined && this.documentToken !== result.token) this.epoch++
    this.documentToken = result.token
    if (this.previousTarget && this.previousTarget.targetId !== native.targetId) this.epoch++
    this.previousTarget = { targetId: native.targetId, url: result.url }
    const target = { targetId: native.targetId, documentId: result.token, url: result.url, epoch: this.epoch, transitionSequence: result.sequence! }
    if (expected && !sameBrowserTarget(expected, target)) throw new BrowserTargetChangedError()
    return { value: result.value, target, transitions: result.transitions! }
  }
  pageInfo(signal?: AbortSignal): Promise<{ url?: string; title?: string }> { return this.call('browser_page_info', {}, signal) }
  async currentTarget(signal?: AbortSignal): Promise<BrowserTargetIdentity> {
    return (await this.observe('true', undefined, signal)).target
  }
  activateTarget(targetId: string, signal?: AbortSignal): Promise<unknown> { return this.call('browser_cdp', { method: 'Target.activateTarget', params: { targetId } }, signal) }
  evaluate<T>(expression: string, signal?: AbortSignal): Promise<T> { return this.call('browser_js', { expression }, signal) }
  private async mutate(context: BrowserMutationContext, operation: () => Promise<unknown>): Promise<BrowserMutationAck> {
    const before = await this.observe('true', context.expected, context.signal)
    if (before.target.transitionSequence !== context.expected.transitionSequence || before.target.url !== context.expected.url) throw new BrowserTargetChangedError()
    await operation()
    try { const after = await this.observe('true', context.expected); return { target: after.target, transitions: after.transitions } }
    catch { this.quarantined = true; throw new BrowserMutationUncertainError() }
  }
  async focus(selector: string, context: BrowserMutationContext): Promise<BrowserMutationAck> {
    return this.mutate(context, () => this.evaluate(typingFocusExpression(selector), context.signal))
  }
  async type(text: string, context: BrowserMutationContext): Promise<BrowserMutationAck> { return this.mutate(context, () => this.call('browser_type', { text }, context.signal)) }
  async press(key: string, modifiers: number | undefined, context: BrowserMutationContext): Promise<BrowserMutationAck> { return this.mutate(context, () => this.call('browser_press', { key, ...(modifiers === undefined ? {} : { modifiers }) }, context.signal)) }
  async click(x: number, y: number, context: BrowserMutationContext): Promise<BrowserMutationAck> { return this.mutate(context, () => this.call('browser_click', { x, y }, context.signal)) }
  async navigate(url: string, signal?: AbortSignal): Promise<void> { this.epoch++; await this.call('browser_goto', { url }, signal) }
  async waitForLoad(timeoutMs: number, signal?: AbortSignal): Promise<void> { await this.call('browser_wait_for_load', { timeout: timeoutMs / 1000 }, signal) }
  async waitForMutation(timeoutMs: number, signal?: AbortSignal): Promise<void> { await abortableDelay(timeoutMs, signal) }

  private async call<T>(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    throwIfCancelled(signal)
    const tools = this.ctx.get('tools')
    if (tools === undefined) throw new BrowserStaleError('tools service unavailable for browser control')

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    let rejectTimer: ReturnType<typeof setTimeout> | undefined
    const guard = new Promise<never>((_, reject) => {
      rejectTimer = setTimeout(() => {
        reject(new BrowserStaleError('browser tool ' + tool + ' timed out after 90s'))
        controller.abort()
      }, 90_000)
    })

    try {
      const raw = await Promise.race([
        withCancellation(() => tools.execute({
          callId: ('plannerbridge-browser-' + process.pid + '-' + (++this.callSequence)) as never,
          name: 'mcp__browser-harness__' + tool,
          arguments: args,
          agent: this.execAgent as never,
          signal: controller.signal,
        } as never), signal),
        guard,
      ]) as ToolResultLike

      if (raw.isError === true) {
        throw new BrowserStaleError('browser tool ' + tool + ' returned an error')
      }
      if (typeof raw.value === 'object' && raw.value !== null && (raw.value as ToolResultLike).isError === true) {
        throw new BrowserStaleError('browser tool ' + tool + ' returned an error')
      }
      return decodeToolValue<T>(raw)
    } catch (error) {
      if (signal?.aborted || error instanceof OperationCancelledError) {
        throw new OperationCancelledError()
      }
      if (error instanceof BrowserStaleError) throw error
      throw new BrowserStaleError('browser tool ' + tool + ' failed')
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (rejectTimer !== undefined) clearTimeout(rejectTimer)
    }
  }
}

/** Legacy public composition retained for existing deployments. */
export class BrowserHarnessChatControl extends ChatGptWebDriver {
  constructor(ctx: Context, execAgent: { session: { header: { cwd: string } } } | undefined, appName: string) {
    super(new BrowserHarnessPrimitives(ctx, execAgent), appName)
  }
}

/** Released name retained as a composition alias. */
export class BrowserHarnessAdapter extends BrowserHarnessChatControl {}

export function decodeToolValue<T>(raw: ToolResultLike): T {
  const value = raw.value
  if (value !== undefined) {
    if (typeof value === 'string') {
      try { return JSON.parse(value) as T } catch { return value as T }
    }
    if (typeof value === 'object' && value !== null) {
      const wrapped = value as {
        structuredContent?: unknown
        content?: Array<{ type?: string; text?: string }>
      }
      if (wrapped.structuredContent !== undefined) return wrapped.structuredContent as T
      const nestedText = wrapped.content?.find(block => block.type === 'text' && typeof block.text === 'string')?.text
      if (nestedText !== undefined) {
        try { return JSON.parse(nestedText) as T } catch { return nestedText as T }
      }
    }
    return value as T
  }

  const text = raw.content
    ?.filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
    .trim() ?? ''
  if (text === '') return undefined as T
  try { return JSON.parse(text) as T } catch { return text as T }
}
