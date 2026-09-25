import type { Context } from '@deepseek-ai/cordis'
import { abortableDelay, OperationCancelledError, throwIfCancelled, withCancellation } from '../cancellation.ts'
import {
  BrowserStaleError,
  ChatGptAppUnavailableError,
  ChatGptLoggedOutError,
  type BrowserControl,
  type BrowserReply,
} from './adapter.ts'

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

interface ChatPageState {
  text: string
  assistantCount: number
  streaming: boolean
  loggedOut: boolean
  composer: boolean
}

interface ReplyBaseline {
  assistantCount: number
  text: string
}

/**
 * BrowserControl backed by DSH's session-gated Browser Harness MCP tools.
 * Each outgoing C2C message can activate one exact ChatGPT app via @mention.
 */
export class BrowserHarnessAdapter implements BrowserControl {
  private callSequence = 0
  private replyBaseline: ReplyBaseline | undefined

  constructor(
    private readonly ctx: Context,
    private readonly execAgent: { session: { header: { cwd: string } } } | undefined,
    private readonly appName: string,
  ) {}

  async ensureReady(signal?: AbortSignal): Promise<void> {
    const budget = [0, 500, 1500]
    let lastError: unknown
    for (const delay of budget) {
      await abortableDelay(delay, signal)
      try {
        const info = await this.call<{ url?: string }>('browser_page_info', {}, signal)
        if (typeof info?.url !== 'string' || !info.url.startsWith('https://chatgpt.com/')) {
          await this.call<unknown>('browser_goto', { url: 'https://chatgpt.com/' }, signal)
        }
        const state = await this.inspectChatPage(signal)
        if (state.loggedOut) throw new ChatGptLoggedOutError()
        if (!state.composer) {
          await this.call<unknown>('browser_wait_for_element', {
            selector: '#prompt-textarea',
            timeout: 10,
            visible: true,
          }, signal)
        }
        return
      } catch (error) {
        if (error instanceof ChatGptLoggedOutError || error instanceof OperationCancelledError) throw error
        lastError = error
      }
    }
    throw new BrowserStaleError('browser harness could not open ChatGPT: ' + String(lastError))
  }

  async openConversation(conversationId?: string, signal?: AbortSignal): Promise<string> {
    const target = conversationId !== undefined && conversationId !== ''
      ? 'https://chatgpt.com/c/' + conversationId
      : 'https://chatgpt.com/'
    await this.call<unknown>('browser_goto', { url: target }, signal)
    await this.call<unknown>('browser_wait_for_load', { timeout: 15 }, signal).catch(error => {
      if (error instanceof OperationCancelledError) throw error
    })
    const state = await this.inspectChatPage(signal)
    if (state.loggedOut) throw new ChatGptLoggedOutError()
    if (!state.composer) throw new BrowserStaleError('ChatGPT composer not found after navigation')
    return (await this.conversationId(signal)) ?? ''
  }

  async sendControlMessage(text: string, signal?: AbortSignal): Promise<void> {
    const state = await this.inspectChatPage(signal)
    if (state.loggedOut) throw new ChatGptLoggedOutError()
    if (!state.composer) throw new BrowserStaleError('ChatGPT composer not found')
    this.replyBaseline = { assistantCount: state.assistantCount, text: state.text }

    if (this.appName.trim() !== '') {
      await this.activateAppMention(this.appName.trim(), signal)
      await this.call<unknown>('browser_type', { text: ' ' + text }, signal)
    } else {
      await this.call<unknown>('browser_fill', {
        selector: '#prompt-textarea',
        text,
        clear_first: true,
      }, signal)
    }
    await this.call<unknown>('browser_press', { key: 'ENTER' }, signal)
  }

  async waitForReply(timeoutMs: number, signal?: AbortSignal): Promise<BrowserReply> {
    const deadline = Date.now() + timeoutMs
    const baseline = this.replyBaseline ?? { assistantCount: -1, text: '' }
    let last = ''
    let unchanged = 0
    let sawNewReply = false

    while (Date.now() < deadline) {
      await abortableDelay(1500, signal)
      try {
        const state = await this.inspectChatPage(signal)
        if (state.loggedOut) throw new ChatGptLoggedOutError()

        const changedFromBaseline =
          state.assistantCount > baseline.assistantCount
          || (state.text.trim() !== '' && state.text !== baseline.text)

        if (!changedFromBaseline) {
          unchanged = 0
          continue
        }
        sawNewReply = true

        if (state.streaming) {
          unchanged = 0
          last = state.text
          continue
        }

        unchanged = state.text === last && state.text.trim() !== '' ? unchanged + 1 : 0
        last = state.text
        if (unchanged >= 1) {
          this.replyBaseline = undefined
          return { text: state.text, complete: true }
        }
      } catch (error) {
        if (error instanceof ChatGptLoggedOutError || error instanceof OperationCancelledError) throw error
      }
    }

    throw new BrowserStaleError(
      sawNewReply
        ? 'ChatGPT reply started but did not settle within timeout'
        : 'no new ChatGPT assistant reply appeared within timeout',
    )
  }

  async conversationId(signal?: AbortSignal): Promise<string | undefined> {
    const info = await this.call<{ url?: string }>('browser_page_info', {}, signal)
    const url = info?.url
    if (typeof url !== 'string') return undefined
    const match = /\/c\/([^/?#]+)/.exec(url)
    return match?.[1]
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const info = await this.call<{ url?: string; title?: string }>('browser_page_info', {})
      const url = info?.url ?? ''
      return url.includes('chatgpt.com')
        ? { ok: true, detail: 'ChatGPT tab reachable' }
        : { ok: false, detail: 'current browser tab is not ChatGPT' }
    } catch (error) {
      return { ok: false, detail: String(error) }
    }
  }

  async recover(signal?: AbortSignal): Promise<void> {
    await this.ensureReady(signal)
  }

  private async activateAppMention(appName: string, signal?: AbortSignal): Promise<void> {
    await this.call<unknown>('browser_fill', {
      selector: '#prompt-textarea',
      text: '@',
      clear_first: true,
    }, signal)
    await this.call<unknown>('browser_type', { text: appName }, signal)

    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = await this.findAppCandidate(appName, signal)
      if (candidate.found && typeof candidate.x === 'number' && typeof candidate.y === 'number') {
        await this.call<unknown>('browser_click', {
          x: Math.round(candidate.x),
          y: Math.round(candidate.y),
        }, signal)
        await abortableDelay(200, signal)
        if (await this.verifyAppMention(appName, signal)) return
      }
      await abortableDelay(200, signal)
    }

    await this.call<unknown>('browser_fill', {
      selector: '#prompt-textarea',
      text: '',
      clear_first: true,
    }, signal).catch(error => {
      if (error instanceof OperationCancelledError) throw error
    })
    throw new ChatGptAppUnavailableError(appName)
  }

  private async findAppCandidate(appName: string, signal?: AbortSignal): Promise<{ found: boolean; x?: number; y?: number }> {
    const wanted = JSON.stringify(appName)
    const expression = [
      '(() => {',
      'const wanted = ' + wanted + '.trim().toLowerCase();',
      'const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };',
      'const normalize = (text) => String(text || "").replace(/\\s+/g, " ").trim().toLowerCase();',
      'const roots = Array.from(document.querySelectorAll("[role=\"listbox\"], [role=\"menu\"], [data-radix-popper-content-wrapper]")).filter(visible);',
      'const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll("[role=\"option\"], [role=\"menuitem\"], button, [data-radix-collection-item]")));',
      'const match = candidates.find((el) => { if (!visible(el)) return false; const full = normalize(el.textContent); if (full === wanted) return true; const lines = String(el.textContent || "").split(/\\n+/).map(normalize).filter(Boolean); return lines.includes(wanted) || full.startsWith(wanted + " "); });',
      'if (!match) return { found: false };',
      'const r = match.getBoundingClientRect();',
      'return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };',
      '})()',
    ].join(' ')
    return await this.call<{ found: boolean; x?: number; y?: number }>('browser_js', { expression }, signal)
  }

  private async verifyAppMention(appName: string, signal?: AbortSignal): Promise<boolean> {
    const wanted = JSON.stringify(appName)
    const expression = [
      '(() => {',
      'const composer = document.querySelector("#prompt-textarea");',
      'if (!composer) return false;',
      'const wanted = ' + wanted + '.trim().toLowerCase();',
      'const normalize = (text) => String(text || "").replace(/\\s+/g, " ").trim().toLowerCase();',
      'const decorators = Array.from(composer.querySelectorAll("[contenteditable=\"false\"], [data-lexical-decorator=\"true\"], [data-mention], button"));',
      'if (decorators.some((el) => normalize(el.textContent).includes(wanted))) return true;',
      'const raw = normalize(composer.textContent);',
      'return raw.includes(wanted) && !raw.startsWith("@" + wanted);',
      '})()',
    ].join(' ')
    const result = await this.call<unknown>('browser_js', { expression }, signal)
    return result === true || result === 'true'
  }

  private async inspectChatPage(signal?: AbortSignal): Promise<ChatPageState> {
    const expression = [
      '(() => {',
      'const composer = document.querySelector("#prompt-textarea");',
      'const messages = Array.from(document.querySelectorAll("[data-message-author-role=\"assistant\"]"));',
      'const latest = messages.length > 0 ? messages[messages.length - 1] : null;',
      'const stop = Array.from(document.querySelectorAll("button")).some((button) => { const label = (button.getAttribute("aria-label") || button.textContent || "").toLowerCase(); return label.includes("stop streaming") || label === "stop"; });',
      'const login = Array.from(document.querySelectorAll("a,button")).some((node) => { const text = (node.textContent || "").trim().toLowerCase(); return text === "log in" || text === "login" || text === "sign up"; });',
      'return { text: latest ? (latest.innerText || latest.textContent || "") : "", assistantCount: messages.length, streaming: stop, loggedOut: !composer && login, composer: !!composer };',
      '})()',
    ].join(' ')
    const value = await this.call<unknown>('browser_js', { expression }, signal)
    if (typeof value === 'string') {
      try {
        return normalizePageState(JSON.parse(value))
      } catch {
        throw new BrowserStaleError('unexpected browser_js response')
      }
    }
    if (typeof value === 'object' && value !== null) return normalizePageState(value)
    throw new BrowserStaleError('unexpected browser_js response')
  }

  private async call<T>(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    throwIfCancelled(signal)
    const tools = this.ctx.get('tools')
    if (tools === undefined) throw new Error('tools service unavailable for browser control')

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
          callId: ('d2c-browser-' + process.pid + '-' + (++this.callSequence)) as never,
          name: 'mcp__browser-harness__' + tool,
          arguments: args,
          agent: this.execAgent as never,
          signal: controller.signal,
        } as never), signal),
        guard,
      ]) as ToolResultLike

      if (raw.isError === true) {
        const detail = raw.error?.message
          ?? raw.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
          ?? tool
        throw new BrowserStaleError(detail)
      }
      return decodeToolValue<T>(raw)
    } catch (error) {
      if (signal?.aborted && error instanceof Error && error.name === 'AbortError') {
        throw new OperationCancelledError()
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (rejectTimer !== undefined) clearTimeout(rejectTimer)
    }
  }
}

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

function normalizePageState(value: unknown): ChatPageState {
  const candidate = value as Partial<ChatPageState>
  return {
    text: typeof candidate.text === 'string' ? candidate.text : '',
    assistantCount: Number.isSafeInteger(candidate.assistantCount) ? Number(candidate.assistantCount) : 0,
    streaming: candidate.streaming === true,
    loggedOut: candidate.loggedOut === true,
    composer: candidate.composer === true,
  }
}
