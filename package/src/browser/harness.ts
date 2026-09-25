/**
 * BrowserControl over the DSH Browser Harness provider's session MCP tools.
 *
 * Tool calls go through the session-gated `mcp__browser-harness__<tool>`
 * catalog published by
 * `@deepseek-ai/dsh-experimental-browser-use-browser-harness-mcp`, with the
 * calling DSH session's `Agent` as the scope: the provider rejects a call whose
 * agent does not own the browser activation. The provider receives one
 * `tools.execute` input per call, so this module owns the call identity
 * (`callId`), the per-call abort signal, and the result decoding.
 *
 * Upstream answers in JSON text and reports a failed helper as
 * `{"error": "..."}` inside a SUCCESSFUL tool result, so every call here
 * re-encodes that convention as a thrown error the coordinator can classify.
 * @module browser/harness
 */

import { BrowserStaleError, ChatGptLoggedOutError, type BrowserControl, type BrowserReply } from './adapter.ts'

/** Namespace the browser provider applies to the upstream MCP catalog. */
export const BROWSER_TOOL_PREFIX = 'mcp__browser-harness__'

/** ChatGPT Web entry point. */
export const CHATGPT_URL = 'https://chatgpt.com/'

/** Conversation URL prefix; the id is the segment after it. */
const CHATGPT_CONVERSATION_PREFIX = 'https://chatgpt.com/c/'

/** Parse direct and Project conversation URLs without using ChatGPT APIs. */
export function conversationIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://chatgpt.com') return undefined
    const match = /^\/(?:g\/g-p-[^/]+\/)?c\/([0-9a-f-]{36})\/?$/u.exec(url.pathname)
    return match?.[1]
  } catch {
    return undefined
  }
}

/** CSS selector of the ChatGPT composer (a contenteditable ProseMirror node). */
const COMPOSER_SELECTOR = '#prompt-textarea'

/** Hard per-call ceiling; the upstream MCP path can stall without ever answering. */
const DEFAULT_CALL_TIMEOUT_MS = 90_000

/** Page-load budget passed to `browser_wait_for_load`, in upstream seconds. */
const PAGE_LOAD_TIMEOUT_SECONDS = 30

/** Delay between reply polls. */
const REPLY_POLL_MS = 4_000

/** Identical consecutive polls that mark a reply as settled. */
const SETTLED_POLLS = 2

/**
 * Page probe returning the last assistant message and whether ChatGPT is still
 * streaming. Semantic selectors only: a data attribute and a test id, never a
 * generated CSS class.
 */
const ASSISTANT_STATE_EXPRESSION = `(() => {
  const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
  const last = nodes[nodes.length - 1];
  return {
    text: last instanceof HTMLElement ? last.innerText : '',
    streaming: document.querySelector('[data-testid="stop-button"]') !== null,
  };
})()`

/**
 * Page probe for the sign-in state.
 *
 * The composer alone does not prove a session: the signed-out landing page
 * renders one too, and a control message sent from it is swallowed by the
 * sign-in redirect instead of reaching a model — which the coordinator would
 * only notice after a full reply timeout. A visible login affordance is what
 * distinguishes the two.
 */
const LOGIN_STATE_EXPRESSION = `(() => {
  const composer = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
  const login = document.querySelector(
    '[data-testid="login-button"], [data-testid="signup-button"], a[href^="/auth/login"], a[href^="/auth/signup"]'
  );
  return { composer: composer !== null, signedOut: login !== null };
})()`

/** Page probe returning the composer's current text, so a swallowed send is visible. */
const COMPOSER_TEXT_EXPRESSION = `(() => {
  const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
  if (el === null || !(el instanceof HTMLElement)) return { present: false, text: '' };
  return { present: true, text: el.innerText };
})()`

/** One registered tool's outcome, as much of it as this adapter reads. */
interface ToolCallOutcome {
  isError: boolean
  content: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

/** One `tools.execute` input, in the order the registry documents it. */
interface ToolCallInput {
  callId: string
  name: string
  arguments: Record<string, unknown>
  agent: unknown
  signal: AbortSignal
}

/** The slice of the DSH tools service this adapter consumes. */
interface ToolsService {
  execute: (input: ToolCallInput) => Promise<ToolCallOutcome>
}

/** The slice of a Cordis context this adapter consumes. */
interface ServiceContainer {
  get: (name: string) => unknown
}

/** Adapter tuning; both fields default to the production values. */
export interface BrowserHarnessOptions {
  /** Hard per-call ceiling in milliseconds. */
  callTimeoutMs?: number
  /** Delay between reply polls in milliseconds. */
  replyPollMs?: number
}

/** Whether a decoded JSON payload is a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** First JSON value of an upstream text result, or the text itself when it is not JSON. */
function parseUpstreamText(text: string): unknown {
  const firstLine = text.split('\n', 1)[0] ?? ''
  if (firstLine.trim() === '') return text
  try {
    return JSON.parse(firstLine) as unknown
  } catch {
    return text
  }
}

/**
 * Unwrap a `browser_js` payload. Upstream returns the expression value
 * directly in the versions this adapter targets and wraps it as `{ result }`
 * in others, so both readings are accepted and the raw payload is returned
 * when neither applies.
 * @param payload - decoded `browser_js` result.
 * @returns the expression value when the payload exposes one.
 */
export function unwrapJsValue(payload: unknown): unknown {
  return isRecord(payload) && 'result' in payload ? payload['result'] : payload
}

/**
 * Build the fallback composer-fill expression.
 *
 * ChatGPT's composer is a contenteditable editor rather than an input, so an
 * upstream value-setting fill can miss it. This inserts the text through the
 * editing command the browser applies to a focused editable element and
 * notifies the framework that owns the node.
 * @param text - control message to insert.
 * @returns a JavaScript expression returning whether the composer was found.
 */
export function composerFillExpression(text: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
    if (el === null || !(el instanceof HTMLElement)) return false;
    el.focus();
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  })()`
}

/**
 * BrowserControl over the Browser Harness provider.
 *
 * One adapter instance is bound to one executing DSH session, because the
 * provider resolves the browser activation from that session's agent; a
 * differently-scoped call is refused by the provider's own `tools/execute`
 * listener.
 */
export class BrowserHarnessAdapter implements BrowserControl {
  private readonly callTimeoutMs: number
  private readonly replyPollMs: number

  /**
   * Create one session-bound adapter.
   * @param ctx - plugin context whose `tools` service dispatches the calls.
   * @param execAgent - the executing session's agent, used as the call scope.
   * @param options - call ceiling and reply-poll interval.
   */
  constructor(
    private readonly ctx: ServiceContainer,
    private readonly execAgent: unknown,
    options: BrowserHarnessOptions = {},
  ) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.replyPollMs = options.replyPollMs ?? REPLY_POLL_MS
  }

  /** The registered tools service, or a loud failure when it is unavailable. */
  private toolsService(): ToolsService {
    const tools = this.ctx.get('tools') as ToolsService | undefined
    if (tools === undefined) throw new Error('tools service unavailable for browser control')
    return tools
  }

  /**
   * Call one provider tool and return its decoded upstream payload.
   *
   * Every call carries its own call id, the session agent, and an abort signal
   * that the provider's transport observes; a call that never answers is
   * bounded by {@link callTimeoutMs} so the coordinator's polling loops always
   * make progress.
   * @param tool - upstream tool name without the `mcp__browser-harness__` prefix.
   * @param args - upstream arguments, verbatim.
   * @returns the decoded payload.
   * @throws when the call fails, stalls, or upstream reports an error payload.
   */
  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const tools = this.toolsService()
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), this.callTimeoutMs)
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    const payload = new Promise<never>((_resolve, reject) => {
      stallTimer = setTimeout(
        () => reject(new Error(`browser tool ${tool} timed out after ${this.callTimeoutMs}ms`)),
        this.callTimeoutMs,
      )
    })
    try {
      const outcome = await Promise.race([
        tools.execute({
          callId: 'd2c-browser-' + tool + '-' + Math.random().toString(16).slice(2, 10),
          name: BROWSER_TOOL_PREFIX + tool,
          arguments: args,
          agent: this.execAgent,
          signal: controller.signal,
        }),
        payload,
      ])
      return this.decode(tool, outcome)
    } finally {
      clearTimeout(abortTimer)
      // Leaving this timer armed would reject `payload` after the race has
      // already settled, surfacing as an unhandled rejection.
      clearTimeout(stallTimer)
    }
  }

  /** Decode one tool outcome, raising upstream's in-band error payload as a failure. */
  private decode(tool: string, outcome: ToolCallOutcome): unknown {
    const text = outcome.content
      .map(block => block.type === 'text' ? block.text ?? '' : '')
      .join('\n')
      .trim()
    if (outcome.isError) {
      throw new Error(`${tool} failed: ${outcome.error?.message ?? (text === '' ? 'unknown error' : text)}`)
    }
    const decoded = parseUpstreamText(text)
    if (isRecord(decoded) && 'error' in decoded) throw new Error(`${tool} failed: ${String(decoded['error'])}`)
    return decoded
  }

  /** Navigate the current tab and wait for the page to finish loading. */
  private async goto(url: string): Promise<void> {
    await this.call('browser_goto', { url })
    await this.call('browser_wait_for_load', { timeout: PAGE_LOAD_TIMEOUT_SECONDS })
  }

  /** Read the sign-in probe. */
  private async signInState(): Promise<{ composer: boolean; signedOut: boolean }> {
    const value = unwrapJsValue(await this.call('browser_js', { expression: LOGIN_STATE_EXPRESSION }))
    if (!isRecord(value)) throw new BrowserStaleError('ChatGPT sign-in probe returned an unexpected payload')
    return { composer: value['composer'] === true, signedOut: value['signedOut'] === true }
  }

  /** Read the composer's presence and text. */
  private async composerState(): Promise<{ present: boolean; text: string }> {
    const value = unwrapJsValue(await this.call('browser_js', { expression: COMPOSER_TEXT_EXPRESSION }))
    if (!isRecord(value)) throw new BrowserStaleError('ChatGPT composer probe returned an unexpected payload')
    return { present: value['present'] === true, text: typeof value['text'] === 'string' ? value['text'] : '' }
  }

  /** Read the last assistant message and ChatGPT's streaming state. */
  private async readAssistantState(): Promise<{ text: string; streaming: boolean }> {
    const value = unwrapJsValue(await this.call('browser_js', { expression: ASSISTANT_STATE_EXPRESSION }))
    if (!isRecord(value)) throw new BrowserStaleError('ChatGPT reply probe returned an unexpected payload')
    return {
      text: typeof value['text'] === 'string' ? value['text'] : '',
      streaming: value['streaming'] === true,
    }
  }

  /**
   * Open ChatGPT and confirm the session is signed in, retrying a bounded
   * number of times for a browser or daemon that is still starting.
   */
  async ensureReady(): Promise<void> {
    // Two attempts ride out a daemon that is still starting; a browser this
    // host cannot drive fails on the first one. Each attempt is bounded by
    // {@link callTimeoutMs} per call, so a stalled transport surfaces as an
    // error within a few minutes rather than blocking the tool forever.
    const budget = [0, 750]
    let lastError: unknown
    for (const delay of budget) {
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      try {
        await this.goto(CHATGPT_URL)
        const state = await this.signInState()
        if (state.signedOut || !state.composer) throw new ChatGptLoggedOutError()
        return
      } catch (error) {
        lastError = error
      }
    }
    // A signed-out page answers every retry the same way; report it as the
    // typed failure callers classify instead of as a generic unreachable one.
    if (lastError instanceof ChatGptLoggedOutError) throw lastError
    throw new Error('BROWSER_UNAVAILABLE: browser harness could not open ChatGPT: ' + String(lastError))
  }

  /**
   * Reopen the bound conversation, or leave the current tab on ChatGPT for a
   * new one. The conversation id of a fresh conversation is read back from the
   * URL by {@link health}; the coordinator persists whatever it can observe.
   * @param conversationId - existing conversation id, when the task has one.
   * @returns the conversation id this call is bound to.
   */
  async openConversation(conversationId?: string): Promise<string> {
    if (conversationId !== undefined && conversationId !== '') {
      await this.goto(CHATGPT_CONVERSATION_PREFIX + conversationId)
      return conversationId
    }
    return ''
  }

  /** Read the URL through Browser Harness' existing browser_js operation. */
  async currentConversationId(): Promise<string | undefined> {
    const value = unwrapJsValue(await this.call('browser_js', { expression: 'location.href' }))
    return typeof value === 'string' ? conversationIdFromUrl(value) : undefined
  }

  /**
   * Send one control message: fill the composer, then submit with Enter.
   * @param text - message text, sent verbatim.
   */
  async sendControlMessage(text: string): Promise<void> {
    await this.fillComposer(text)
    await this.call('browser_press', { key: 'Enter' })
    // A send that did not register leaves the text in the composer (or the
    // page navigates, taking the composer with it). Both must fail loud here:
    // otherwise the coordinator waits out its full reply timeout for an answer
    // that no model was ever asked for.
    const after = await this.composerState()
    if (!after.present) throw new BrowserStaleError('ChatGPT composer disappeared after Enter (sign-in or navigation)')
    if (after.text.trim() !== '') throw new BrowserStaleError('ChatGPT composer still holds the message after Enter')
  }

  /** Fill the composer, falling back to explicit insertion for the editable node. */
  private async fillComposer(text: string): Promise<void> {
    try {
      await this.call('browser_fill', { selector: COMPOSER_SELECTOR, text, clear_first: true })
      return
    } catch {
      // Upstream fill targets input values; the ChatGPT composer is a
      // contenteditable editor, so fall through to the explicit insertion.
    }
    if (unwrapJsValue(await this.call('browser_js', { expression: composerFillExpression(text) })) !== true) {
      throw new BrowserStaleError('ChatGPT composer not found')
    }
  }

  /**
   * Wait for a settled assistant reply.
   * @param timeoutMs - total budget for the reply.
   * @returns the reply text once two consecutive polls agree and streaming stopped.
   */
  async waitForReply(timeoutMs: number): Promise<BrowserReply> {
    const deadline = Date.now() + timeoutMs
    let last = ''
    let settled = 0
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, this.replyPollMs))
      try {
        const state = await this.readAssistantState()
        if (state.streaming || state.text.trim() === '') {
          last = ''
          settled = 0
          continue
        }
        settled = state.text === last ? settled + 1 : 0
        last = state.text
        if (settled >= SETTLED_POLLS - 1) return { text: state.text, complete: true }
      } catch (error) {
        if (error instanceof BrowserStaleError) throw error
        // Transient page or transport state: keep polling until the deadline.
      }
    }
    throw new BrowserStaleError('no completed reply within timeout')
  }

  /** Reachability and sign-in probe. */
  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.goto(CHATGPT_URL)
      const state = await this.signInState()
      if (state.signedOut) return { ok: false, detail: 'chatgpt.com reachable but signed out' }
      if (!state.composer) return { ok: false, detail: 'chatgpt.com reachable but the composer is absent' }
      return { ok: true, detail: 'chatgpt.com reachable and signed in' }
    } catch (error) {
      return { ok: false, detail: String(error) }
    }
  }

  /** Recover after a reload or restart by re-entering ChatGPT. */
  async recover(): Promise<void> {
    await this.ensureReady()
  }
}
