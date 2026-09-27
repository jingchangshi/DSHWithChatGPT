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
  composerCount: number
}

interface ReplyBaseline {
  assistantCount: number
  text: string
}

interface ComposerDraft {
  texts: string[]
}

const composerSelector = '[data-d2c-composer-target="1"]'
const composerScript = String.raw`
const composerNodes = Array.from(document.querySelectorAll('#prompt-textarea, [role="textbox"][contenteditable]:not([contenteditable="false"])')).filter(element => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !element.closest('[aria-hidden="true"], [inert]');
});
const composer = composerNodes.length === 1 ? composerNodes[0] : null;
`

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
        if (!state.composer) throw new BrowserStaleError('ChatGPT composer is missing or ambiguous')
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
    await this.waitForSemanticComposerAfterNavigation(10_000, signal)
    return (await this.conversationId(signal)) ?? ''
  }

  private async waitForSemanticComposerAfterNavigation(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const deadline = new AbortController()
    const timeout = setTimeout(() => deadline.abort(), timeoutMs)
    const active = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
    try {
      while (true) {
        const state = await this.inspectChatPage(active)
        if (state.composerCount > 1) throw new BrowserStaleError('ChatGPT composer is ambiguous after navigation')
        if (state.loggedOut) throw new ChatGptLoggedOutError()
        if (state.composerCount === 1) return
        await abortableDelay(200, active)
      }
    } catch (error) {
      throwIfCancelled(signal)
      if (deadline.signal.aborted) throw new BrowserStaleError('ChatGPT composer not found after navigation')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async sendControlMessage(text: string, signal?: AbortSignal): Promise<void> {
    const state = await this.inspectChatPage(signal)
    if (state.loggedOut) throw new ChatGptLoggedOutError()
    if (!state.composer) throw new BrowserStaleError('ChatGPT composer not found')
    await this.withComposerDraft(async draft => {
      this.replyBaseline = { assistantCount: state.assistantCount, text: state.text }
      const appName = this.appName.trim()
      if (appName !== '') {
        await this.activateAppMention(appName, draft, signal)
        const separatorPresent = await this.appSeparator(appName, signal)
        await this.typeComposerExpected(appName, separatorPresent ? text : ' ' + text, appName + ' ' + text, draft, signal)
      } else {
        await this.typeComposer('', text, draft, signal)
      }
      const expected = appName === '' ? text : appName + ' ' + text
      const filled = await this.resolveComposer(signal, { texts: [expected] })
      if (!filled.owned) throw new BrowserStaleError('ChatGPT control message input could not be verified')
      await this.focusComposer(signal)
      await this.call<unknown>('browser_press', { key: 'Enter' }, signal)
    }, false, signal)
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

  async readiness(signal?: AbortSignal): Promise<{ url: string; composer: boolean; loggedOut: boolean }> {
    const info = await this.call<{ url?: string }>('browser_page_info', {}, signal)
    const state = await this.inspectChatPage(signal)
    return {
      url: typeof info.url === 'string' ? info.url : '',
      composer: state.composer,
      loggedOut: state.loggedOut,
    }
  }

  async probeApp(appName: string, signal?: AbortSignal): Promise<void> {
    await this.ensureReady(signal)
    await this.withComposerDraft(draft => this.activateAppMention(appName.trim(), draft, signal), true, signal)
  }

  private async withComposerDraft(operation: (draft: ComposerDraft) => Promise<void>, clearOnSuccess: boolean, signal?: AbortSignal): Promise<void> {
    const initial = await this.resolveComposer(signal)
    if (!initial.empty) throw new BrowserStaleError('ChatGPT composer contains an existing draft; clear it before probing')
    const draft: ComposerDraft = { texts: [''] }
    let originalError: unknown
    let succeeded = false
    try {
      await operation(draft)
      succeeded = true
    } catch (error) {
      originalError = error
      throw error
    } finally {
      if (clearOnSuccess || !succeeded) {
        try {
          await this.clearComposer(draft, AbortSignal.timeout(1_500))
        } catch (error) {
          if (!(originalError instanceof OperationCancelledError)) throw new BrowserStaleError('App composer cleanup failed or draft ownership changed')
        }
      }
    }
  }

  private async activateAppMention(appName: string, draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    const initial = await this.resolveComposer(signal)
    if (!initial.empty) throw new BrowserStaleError('ChatGPT composer contains an existing draft')
    await this.typeComposer('', '@', draft, signal)
    await this.typeComposer('@', appName, draft, signal)

    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = await this.findAppCandidate(appName, signal)
      if (candidate.found && typeof candidate.x === 'number' && typeof candidate.y === 'number') {
        await this.resolveComposer(signal)
        draft.texts.push(appName)
        await this.call<unknown>('browser_click', {
          x: Math.round(candidate.x),
          y: Math.round(candidate.y),
        }, signal)
        await abortableDelay(200, signal)
        if (await this.verifyAppMention(appName, signal)) return
      }
      await abortableDelay(200, signal)
    }

    throw new ChatGptAppUnavailableError(appName)
  }

  private async findAppCandidate(appName: string, signal?: AbortSignal): Promise<{ found: boolean; x?: number; y?: number }> {
    const wanted = JSON.stringify(appName)
    const expression = [
      '(() => {',
      'const wanted = ' + wanted + '.trim().toLowerCase();',
      'const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };',
      'const normalize = (text) => String(text || "").replace(/\\s+/g, " ").trim().toLowerCase();',
      String.raw`const roots = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]')).filter(visible);`,
      String.raw`const candidates = [...new Set([...roots.flatMap((root) => Array.from(root.querySelectorAll('[role="option"], [role="menuitem"], button, [data-radix-collection-item]'))), ...document.querySelectorAll('button[data-list-navigation-item="true"]')])];`,
      'const matches = candidates.filter((el) => {',
      'if (!visible(el)) return false;',
      String.raw`if (!el.matches('button[data-list-navigation-item="true"]')) return normalize(el.textContent) === wanted;`,
      String.raw`const rows = el.querySelectorAll('[data-menu-row-content="true"]');`,
      'if (rows.length !== 1 || !visible(rows[0])) return false;',
      String.raw`const titles = Array.from(rows[0].querySelectorAll('span')).filter(node => !node.querySelector('span') && visible(node) && !node.closest('[aria-hidden="true"], [inert]') && normalize(node.textContent) !== '');`,
      'return titles.length > 0 && normalize(titles[0].textContent) === wanted;',
      '});',
      'const match = matches.length === 1 ? matches[0] : null;',
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
      composerScript,
      'if (!composer) return false;',
      'const wanted = ' + wanted + '.trim().toLowerCase();',
      'const normalize = (text) => String(text || "").replace(/\\s+/g, " ").trim().toLowerCase();',
      String.raw`const decorators = Array.from(composer.querySelectorAll('[contenteditable="false"], [data-lexical-decorator="true"], [data-mention], button'));`,
      'return decorators.some((el) => normalize(el.textContent) === wanted);',
      '})()',
    ].join(' ')
    const result = await this.call<unknown>('browser_js', { expression }, signal)
    return result === true || result === 'true'
  }

  private async inspectChatPage(signal?: AbortSignal): Promise<ChatPageState> {
    const expression = [
      '(() => {',
      composerScript,
      String.raw`const assistantNodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]'));`,
      'const messages = [];',
      'for (const node of assistantNodes) {',
      'const current = node.getAttribute("data-markdown-text-style") === "assistant-message";',
      'const identity = node.closest("[data-chatgpt-selection-message-id]") ?? node;',
      'const existing = messages.find(message => message.identity === identity || (message.current !== current && (message.node.contains(node) || node.contains(message.node))));',
      'if (!existing) messages.push({ node, identity, current });',
      'else if (current && !existing.current) { existing.node = node; existing.identity = identity; existing.current = true; }',
      '}',
      'messages.sort((left, right) => left.node.compareDocumentPosition(right.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);',
      'const latest = messages.length > 0 ? messages[messages.length - 1].node : null;',
      'const stop = Array.from(document.querySelectorAll("button")).some((button) => { const label = (button.getAttribute("aria-label") || button.textContent || "").toLowerCase(); return label.includes("stop streaming") || label === "stop"; });',
      'const login = Array.from(document.querySelectorAll("a,button")).some((node) => { const text = (node.textContent || "").trim().toLowerCase(); return ["log in", "login", "sign up", "登录", "注册"].includes(text); });',
      'return { text: latest ? (latest.innerText || latest.textContent || "") : "", assistantCount: messages.length, streaming: stop, loggedOut: !composer && login, composer: !!composer, composerCount: composerNodes.length };',
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

  private async resolveComposer(signal?: AbortSignal, draft?: ComposerDraft, focus = false): Promise<{ empty: boolean; owned: boolean }> {
    const value = await this.call<{ count?: number; empty?: boolean; owned?: boolean; focused?: boolean }>('browser_js', { expression: [
      '(() => {', composerScript,
      'for (const node of document.querySelectorAll(' + JSON.stringify(composerSelector) + ')) node.removeAttribute("data-d2c-composer-target");',
      'if (!composer) return { count: composerNodes.length, empty: false };',
      'composer.setAttribute("data-d2c-composer-target", "1");',
      'const draft = ' + JSON.stringify(draft ?? { texts: [] }) + ';',
      'const content = (typeof composer.value === "string" ? composer.value : (composer.innerText || composer.textContent || "")).trim();',
      focus ? 'composer.focus();' : '',
      String.raw`return { count: 1, empty: !content && !composer.querySelector('[contenteditable="false"], [data-lexical-decorator="true"], [data-mention]'), owned: draft.texts.some(text => text.trim() === content), focused: document.activeElement === composer || composer.contains(document.activeElement) };`,
      '})()',
    ].join(' ') }, signal)
    if (value?.count !== 1 || typeof value.empty !== 'boolean') throw new BrowserStaleError('ChatGPT composer is missing or ambiguous')
    if (focus && value.focused !== true) throw new BrowserStaleError('ChatGPT composer focus could not be verified')
    return { empty: value.empty, owned: value.owned === true }
  }

  private async focusComposer(signal?: AbortSignal): Promise<void> {
    await this.resolveComposer(signal, undefined, true)
  }

  private async typeComposer(before: string, text: string, draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    await this.typeComposerExpected(before, text, before + text, draft, signal)
  }

  private async typeComposerExpected(before: string, text: string, expected: string, draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    const current = await this.resolveComposer(signal, { texts: [before] }, true)
    if (!current.owned) throw new BrowserStaleError('ChatGPT composer changed before typing')
    draft.texts.push(expected)
    await this.call<unknown>('browser_type', { text }, signal)
    if (!(await this.resolveComposer(signal, { texts: [expected] })).owned) throw new BrowserStaleError('ChatGPT input could not be verified')
  }


  private async appSeparator(appName: string, signal?: AbortSignal): Promise<boolean> {
    const value = await this.call<unknown>('browser_js', { expression: [
      '(() => {', composerScript,
      'if (!composer) return null;',
      'const appName = ' + JSON.stringify(appName) + ';',
      "const atomSelector = '[contenteditable=\"false\"], [data-lexical-decorator=\"true\"], [data-mention], [app-mention-display-name]';",
      'const atoms = Array.from(composer.querySelectorAll(atomSelector)).filter(node => !node.parentElement.closest(atomSelector));',
      'if (atoms.length !== 1 || atoms[0].getAttribute("app-mention-display-name") !== appName) return null;',
      'const atom = atoms[0];',
      'const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);',
      'const external = []; let node;',
      'while ((node = walker.nextNode())) { if (!atom.contains(node) && node.data.length) external.push(node); }',
      'if (external.length === 0) return false;',
      'if (external.length !== 1 || external[0].data !== " " || external[0] !== atom.nextSibling) return null;',
      'return true;',
      '})()',
    ].join(' ') }, signal)
    if (typeof value !== 'boolean') throw new BrowserStaleError('ChatGPT App separator is not recognized')
    return value
  }

  private async clearComposer(draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    const current = await this.resolveComposer(signal, draft)
    if (current.empty) return
    if (!current.owned) throw new BrowserStaleError('ChatGPT composer draft is not owned by this operation')
    if (!(await this.resolveComposer(signal, draft, true)).owned) throw new BrowserStaleError('ChatGPT composer changed before cleanup')
    await this.call<unknown>('browser_press', { key: 'a', modifiers: 2 }, signal)
    const selected = await this.call<unknown>('browser_js', { expression: [
      '(() => {', composerScript,
      'if (!composer || document.activeElement !== composer) return false;',
      'const content = typeof composer.value === "string" ? composer.value : (composer.innerText || composer.textContent || "");',
      'const draft = ' + JSON.stringify(draft) + ';',
      'if (!draft.texts.some(text => text.trim() === content.trim())) return false;',
      'if (typeof composer.value === "string") return composer.selectionStart === 0 && composer.selectionEnd === composer.value.length;',
      'const selection = window.getSelection();',
      'if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return false;',
      'const range = selection.getRangeAt(0);',
      'if (![selection.anchorNode, selection.focusNode, range.commonAncestorContainer].every(node => node && composer.contains(node))) return false;',
      String.raw`const atomSelector = '[contenteditable="false"], [data-lexical-decorator="true"], [data-mention], [app-mention-display-name]';`,
      'const atoms = Array.from(composer.querySelectorAll(atomSelector)).filter(node => !node.parentElement.closest(atomSelector));',
      'if (!atoms.every(node => { const identity = (node.getAttribute("app-mention-display-name") ?? node.textContent ?? "").trim(); return identity.length > 0 && draft.texts.some(text => text.trim() === identity) && selection.containsNode(node, false); })) return false;',
      'const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);',
      'const external = []; let node;',
      'while ((node = walker.nextNode())) { if (!atoms.some(atom => atom.contains(node))) { if (node.data.length) external.push(node); if (node.data.trim() && !selection.containsNode(node, false)) return false; } }',
      'if (atoms.length === 1 && atoms[0].hasAttribute("app-mention-display-name") && content.trim() === atoms[0].getAttribute("app-mention-display-name")) {',
      'if (external.length !== 0 && (external.length !== 1 || external[0].data !== " " || external[0] !== atoms[0].nextSibling)) return false;',
      '}',
      'return true;',
      '})()',
    ].join(' ') }, signal)
    if (selected !== true) throw new BrowserStaleError('ChatGPT composer selection is not complete and contained')
    await this.call<unknown>('browser_press', { key: 'Backspace' }, signal)
    if (!(await this.resolveComposer(signal)).empty) throw new BrowserStaleError('ChatGPT composer cleanup could not be verified')
  }

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
          callId: ('d2c-browser-' + process.pid + '-' + (++this.callSequence)) as never,
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
    composerCount: Number.isSafeInteger(candidate.composerCount) && Number(candidate.composerCount) >= 0 ? Number(candidate.composerCount) : 0,
  }
}
