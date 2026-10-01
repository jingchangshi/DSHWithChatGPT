import { CancellableBrowserPrimitives, type BrowserPrimitives, type BrowserMutationContext, type BrowserMutationAck } from './primitives.ts'
import { createHash } from 'node:crypto'
import type { ChatObservationControl, ControlOperation, ReplyObservationBaseline, ChatReply as BrowserReply } from '../core/ports/chat-control.ts'
import { BrowserTargetChangedError, sameBrowserTarget, type BrowserTargetIdentity } from './epoch.ts'
import type { BrowserTransition } from './transitions.ts'
import { abortableDelay, OperationCancelledError, throwIfCancelled } from '../cancellation.ts'
import {
  BrowserStaleError,
  ChatGptAppUnavailableError,
  ChatGptLoggedOutError,
} from './errors.ts'

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
  textDigest: string
}

interface ComposerDraft {
  texts: string[]
  preserve?: boolean
}

const composerSelector = '[data-plannerbridge-composer-target="1"]'
const COMPOSER_CLEANUP_TIMEOUT_MS = 2_000
const composerScript = String.raw`
const composerNodes = Array.from(document.querySelectorAll('#prompt-textarea, [role="textbox"][contenteditable]:not([contenteditable="false"])')).filter(element => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !element.closest('[aria-hidden="true"], [inert]');
});
const composer = composerNodes.length === 1 ? composerNodes[0] : null;
// contenteditable presents a leading separator as NBSP. Normalize only this
// browser spacing representation when comparing ownership, never the payload.
const draftText = text => String(text).replace(/\u00a0/g, ' ').trim();
`

/** Shared ChatGPT Web semantics, independent of transport and host. */
export class ChatGptWebDriver implements ChatObservationControl {
  private replyBaseline: ReplyBaseline | undefined
  private target: BrowserTargetIdentity | undefined
  private fenced = false
  private route: string | undefined
  private finalEnter: 'before' | 'dispatching' | 'acknowledged' = 'before'
  private readonly cleanupDeadlines = new WeakMap<AbortSignal, number>()

  private readonly browser: BrowserPrimitives
  constructor(primitives: BrowserPrimitives, private readonly appName: string) {
    this.browser = new CancellableBrowserPrimitives(primitives)
  }

  async ensureReady(signal?: AbortSignal): Promise<void> {
    const budget = [0, 500, 1500]
    let lastError: unknown
    for (const delay of budget) {
      await abortableDelay(delay, signal)
      try {
        const info = await this.browser.pageInfo(signal)
        if (typeof info?.url !== 'string' || !info.url.startsWith('https://chatgpt.com/')) {
          await this.browser.navigate('https://chatgpt.com/', signal)
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
    throw new BrowserStaleError('browser could not open ChatGPT: ' + String(lastError))
  }

  async openConversation(conversationId?: string, signal?: AbortSignal): Promise<string> {
    this.resetTarget()
    const target = conversationId !== undefined && conversationId !== ''
      ? 'https://chatgpt.com/c/' + conversationId
      : 'https://chatgpt.com/'
    await this.browser.navigate(target, signal)
    await this.browser.waitForLoad(15 * 1000, signal).catch(error => {
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

  async captureReplyBaseline(signal?: AbortSignal): Promise<ReplyObservationBaseline> {
    this.resetTarget()
    this.fenced = true
    const state = await this.inspectChatPage(signal)
    if (state.loggedOut) throw new ChatGptLoggedOutError()
    if (!state.composer) throw new BrowserStaleError('ChatGPT composer is missing or ambiguous')
    const conversationId = await this.currentConversation(signal)
    const target = await this.browser.currentTarget(signal)
    return { version: 1, conversationId: conversationId ?? null, assistantCount: state.assistantCount, textDigest: replyTextDigest(state.text), observationEpoch: observationEpoch(target) }
  }

  private async requireObservationBaseline(baseline: ReplyObservationBaseline, signal?: AbortSignal): Promise<void> {
    if (!baseline || baseline.version !== 1 || !Number.isSafeInteger(baseline.assistantCount) || baseline.assistantCount < 0
      || !/^[a-f0-9]{64}$/.test(baseline.textDigest) || !/^[a-f0-9]{64}$/.test(baseline.observationEpoch)
      || (baseline.conversationId !== null && (typeof baseline.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(baseline.conversationId)))) throw new BrowserTargetChangedError()
    if ((await this.currentConversation(signal) ?? null) !== baseline.conversationId
      || observationEpoch(await this.browser.currentTarget(signal)) !== baseline.observationEpoch) throw new BrowserTargetChangedError()
  }

  async sendControlMessage(text: string, signal?: AbortSignal, operation?: ControlOperation): Promise<void> {
    this.target = undefined
    this.route = undefined
    this.finalEnter = 'before'
    this.fenced = true
    const state = await this.inspectChatPage(signal)
    if (operation?.replyBaseline) {
      await this.requireObservationBaseline(operation.replyBaseline, signal)
      if (state.assistantCount !== operation.replyBaseline.assistantCount || replyTextDigest(state.text) !== operation.replyBaseline.textDigest) throw new BrowserTargetChangedError()
    }
    if (state.loggedOut) throw new ChatGptLoggedOutError()
    if (!state.composer) throw new BrowserStaleError('ChatGPT composer not found')
    await this.withComposerDraft(async draft => {
      this.replyBaseline = { assistantCount: state.assistantCount, textDigest: replyTextDigest(state.text) }
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
      await this.ensureCurrentTargetVisible(draft, signal)
      if (!(await this.resolveComposer(signal, { texts: [expected] }, true)).owned) throw new BrowserStaleError('ChatGPT control message changed before sending')
      await this.checkTarget(signal)
      this.finalEnter = 'dispatching'
      try {
        this.acceptMutation(await this.browser.press('Enter', undefined, await this.mutationContext(signal)))
        this.finalEnter = 'acknowledged'
      } catch (error) { this.finalEnter = 'before'; throw error }
    }, false, signal)
  }

  async waitForReply(timeoutMs: number, signal?: AbortSignal, operation?: ControlOperation): Promise<BrowserReply> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new BrowserStaleError('reply timeout must be positive and finite')
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), timeoutMs)
    const active = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
    try {
      if (operation?.replyBaseline) {
        this.fenced = true
        await this.requireObservationBaseline(operation.replyBaseline, active)
        this.replyBaseline = { assistantCount: operation.replyBaseline.assistantCount, textDigest: operation.replyBaseline.textDigest }
      }
      return await this.waitForReplyWithinDeadline(timeoutMs, active)
    } catch (error) {
      throwIfCancelled(signal)
      if (error instanceof BrowserTargetChangedError) throw error
      if (deadline.signal.aborted) throw new BrowserStaleError('ChatGPT reply did not settle within timeout')
      throw error
    } finally { clearTimeout(timer) }
  }

  private async waitForReplyWithinDeadline(timeoutMs: number, signal?: AbortSignal): Promise<BrowserReply> {
    const deadline = Date.now() + timeoutMs
    const baseline = this.replyBaseline ?? { assistantCount: -1, textDigest: replyTextDigest('') }
    let last = ''
    let lastChangedAt = 0
    let stableObservations = 0
    let sawStreaming = false
    let sawNewReply = false

    while (Date.now() < deadline) {
      await abortableDelay(1500, signal)
      try {
        const state = await this.inspectChatPage(signal)
        if (state.loggedOut) throw new ChatGptLoggedOutError()

        const changedFromBaseline =
          state.assistantCount > baseline.assistantCount
          || (state.text.trim() !== '' && replyTextDigest(state.text) !== baseline.textDigest)

        if (!changedFromBaseline) {
          stableObservations = 0
          continue
        }
        sawNewReply = true

        if (state.streaming) {
          sawStreaming = true
          stableObservations = 0
          last = state.text
          continue
        }

        const now = Date.now()
        if (state.text !== last || stableObservations === 0) {
          lastChangedAt = now
          stableObservations = 1
        } else {
          stableObservations++
        }
        last = state.text
        if (state.text.trim() !== '' && (sawStreaming
          ? stableObservations >= 2 && now - lastChangedAt >= 1500
          : stableObservations >= 3 && now - lastChangedAt >= 4500)) {
          this.replyBaseline = undefined
          return { text: state.text, complete: true }
        }
      } catch (error) {
        if (error instanceof ChatGptLoggedOutError || error instanceof OperationCancelledError || error instanceof BrowserTargetChangedError) throw error
      }
    }

    throw new BrowserStaleError(
      sawNewReply
        ? 'ChatGPT reply started but did not settle within timeout'
        : 'no new ChatGPT assistant reply appeared within timeout',
    )
  }

  async currentConversation(signal?: AbortSignal): Promise<string | undefined> {
    return this.conversationId(signal)
  }

  async conversationId(signal?: AbortSignal): Promise<string | undefined> {
    if (this.fenced) await this.checkTarget(signal)
    const url = this.fenced ? this.target?.url : (await this.browser.pageInfo(signal))?.url
    if (typeof url !== 'string') return undefined
    const match = /\/c\/([^/?#]+)/.exec(url)
    return match?.[1]
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const info = await this.browser.pageInfo(undefined)
      const url = info?.url ?? ''
      return url.includes('chatgpt.com')
        ? { ok: true, detail: 'ChatGPT tab reachable' }
        : { ok: false, detail: 'current browser tab is not ChatGPT' }
    } catch (error) {
      return { ok: false, detail: String(error) }
    }
  }

  async recover(signal?: AbortSignal): Promise<void> {
    this.resetTarget()
    await this.ensureReady(signal)
  }

  async readiness(signal?: AbortSignal): Promise<{ url: string; composer: boolean; loggedOut: boolean }> {
    const info = await this.browser.pageInfo(signal)
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
      if (error instanceof BrowserTargetChangedError) { draft.preserve = true; this.replyBaseline = undefined }
      throw error
    } finally {
      if ((clearOnSuccess || !succeeded) && !draft.preserve) {
        try {
          // Finalization owns a separate lifetime after the caller cancels.
          const cleanupSignal = AbortSignal.timeout(COMPOSER_CLEANUP_TIMEOUT_MS)
          this.cleanupDeadlines.set(cleanupSignal, Date.now() + COMPOSER_CLEANUP_TIMEOUT_MS)
          await this.clearComposer(draft, cleanupSignal)
        } catch (error) {
          if (originalError instanceof OperationCancelledError) throw originalError
          if (error instanceof OperationCancelledError) throw error
          throw new BrowserStaleError('App composer cleanup failed or draft ownership changed')
        }
      }
    }
  }

  private resetTarget(): void { this.target = undefined; this.fenced = false; this.replyBaseline = undefined; this.route = undefined; this.finalEnter = 'before' }

  private acceptTarget(target: BrowserTargetIdentity, transitions: BrowserTransition[] = []): void {
    if (this.fenced) {
      if (!Number.isSafeInteger(target.transitionSequence) || target.transitionSequence < 0) { this.replyBaseline = undefined; throw new BrowserTargetChangedError() }
      if (this.target) {
        if (!sameBrowserTarget(this.target, target)) { this.replyBaseline = undefined; throw new BrowserTargetChangedError() }
        let sequence = this.target.transitionSequence
        let url = this.target.url
        for (const transition of transitions) {
          if (transition.sequence !== ++sequence || transition.beforeUrl !== url) { this.replyBaseline = undefined; throw new BrowserTargetChangedError() }
          this.admitRoute(transition.afterUrl)
          url = transition.afterUrl
        }
        if (sequence !== target.transitionSequence || url !== target.url) { this.replyBaseline = undefined; throw new BrowserTargetChangedError() }
      }
      this.admitRoute(target.url)
    }
    this.target = target
  }
  private admitRoute(url: string): void {
    const route = classifyChatRoute(url)
    if (route === 'OTHER') { this.replyBaseline = undefined; throw new BrowserTargetChangedError() }
    if (this.route === undefined) this.route = route
    else if (route !== this.route) {
      if (this.route === 'NEW_CHAT' && route.startsWith('CONVERSATION:') && this.finalEnter !== 'before') this.route = route
      else { this.replyBaseline = undefined; throw new BrowserTargetChangedError() }
    }
  }
  private async mutationContext(signal?: AbortSignal): Promise<BrowserMutationContext> {
    if (!this.target) this.acceptTarget((await this.browser.observe('true', undefined, signal)).target)
    return { expected: this.target!, signal, deadlineMs: signal ? this.cleanupDeadlines.get(signal) : undefined }
  }
  private acceptMutation(ack: BrowserMutationAck): void { this.acceptTarget(ack.target, ack.transitions) }

  private async evaluate<T>(expression: string, signal?: AbortSignal): Promise<T> {
    if (!this.fenced) return this.browser.evaluate<T>(expression, signal)
    const observed = await this.browser.observe<T>(expression, this.target, signal)
    this.acceptTarget(observed.target, observed.transitions)
    return observed.value
  }

  private async checkTarget(signal?: AbortSignal): Promise<void> {
    if (this.fenced) await this.evaluate('true', signal)
  }

  private async activateAppMention(appName: string, draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    const initial = await this.resolveComposer(signal)
    if (!initial.empty) throw new BrowserStaleError('ChatGPT composer contains an existing draft')
    await this.typeComposer('', '@', draft, signal)
    if (await this.typeComposerExpected('@', appName, '@' + appName, draft, signal, appName)) return

    // ChatGPT may commit an exact App mention while the full name is typed,
    // without exposing a candidate menu. Accept only the same semantic atom
    // that the explicit candidate path verifies.
    if (await this.verifyAppMention(appName, signal)) {
      draft.texts.push(appName)
      return
    }

    for (let readiness = 0; readiness < 12; readiness++) {
      await this.requirePlainAppQuery(appName, signal)
      if ((await this.findAppCandidate(appName, signal)).found) break
      await abortableDelay(200, signal)
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensureCurrentTargetVisible(draft, signal)
      await this.requirePlainAppQuery(appName, signal)
      const candidate = await this.findAppCandidate(appName, signal)
      if (!candidate.found || typeof candidate.x !== 'number' || typeof candidate.y !== 'number') break
      await this.checkTarget(signal)
      this.acceptMutation(await this.browser.click(Math.round(candidate.x), Math.round(candidate.y), await this.mutationContext(signal)))
      for (let sample = 0; sample < 10; sample++) {
        await abortableDelay(150, signal)
        if (await this.verifyAppMention(appName, signal)) {
          draft.texts.push(appName)
          return
        }
        await this.requirePlainAppQuery(appName, signal)
        if (!(await this.findAppCandidate(appName, signal)).found) throw new ChatGptAppUnavailableError(appName)
      }
    }

    throw new ChatGptAppUnavailableError(appName)
  }

  private async requirePlainAppQuery(appName: string, signal?: AbortSignal): Promise<void> {
    const valid = await this.evaluate<unknown>([
      '(() => {', composerScript,
      'if (!composer) return false;',
      'const content = typeof composer.value === "string" ? composer.value : (composer.innerText || composer.textContent || "");',
      'return draftText(content) === draftText(' + JSON.stringify('@' + appName) + ') && !composer.querySelector(' + JSON.stringify('[contenteditable="false"], [data-lexical-decorator="true"], [data-mention], [app-mention-display-name]') + ');',
      '})()',
    ].join(' '), signal)
    if (valid !== true) throw new BrowserStaleError('ChatGPT App query changed before activation')
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
      'const x = Math.round(r.left + r.width / 2); const y = Math.round(r.top + r.height / 2);',
      'const hit = document.elementFromPoint(x, y);',
      'if (!hit || (hit !== match && !match.contains(hit))) return { found: false };',
      'return { found: true, x, y };',
      '})()',
    ].join(' ')
    return await this.evaluate<{ found: boolean; x?: number; y?: number }>(expression, signal)
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
    const result = await this.evaluate<unknown>(expression, signal)
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
      'const animated = latest?.getAttribute("data-markdown-text-style") === "assistant-message" && latest.hasAttribute("data-markdown-animated");',
      'const stop = Array.from(document.querySelectorAll("button")).some((button) => { const label = (button.getAttribute("aria-label") || button.textContent || "").toLowerCase(); return label.includes("stop streaming") || label === "stop"; });',
      // An anonymous ChatGPT page can still provide a composer. A visible
      // account-login control, outside message content, must fail closed.
      'const login = Array.from(document.querySelectorAll("a,button")).some((node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); if (r.width <= 0 || r.height <= 0 || s.display === "none" || s.visibility === "hidden" || node.closest(\'[aria-hidden="true"], [inert], [data-message-author-role], [data-markdown-text-style]\')) return false; const text = (node.textContent || "").trim().toLowerCase(); return ["log in", "login", "sign up", "登录", "注册"].includes(text); });',
      'return { text: latest ? (latest.innerText || latest.textContent || "") : "", assistantCount: messages.length, streaming: animated || stop, loggedOut: login, composer: !!composer, composerCount: composerNodes.length };',
      '})()',
    ].join(' ')
    const value = await this.evaluate<unknown>(expression, signal)
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
    const value = await this.evaluate<{ count?: number; empty?: boolean; owned?: boolean; focused?: boolean }>([
      '(() => {', composerScript,
      'for (const node of document.querySelectorAll(' + JSON.stringify(composerSelector) + ')) node.removeAttribute("data-plannerbridge-composer-target");',
      'if (!composer) return { count: composerNodes.length, empty: false };',
      'composer.setAttribute("data-plannerbridge-composer-target", "1");',
      'const draft = ' + JSON.stringify(draft ?? { texts: [] }) + ';',
      'const content = draftText(typeof composer.value === "string" ? composer.value : (composer.innerText || composer.textContent || ""));',
      String.raw`return { count: 1, empty: !content && !composer.querySelector('[contenteditable="false"], [data-lexical-decorator="true"], [data-mention]'), owned: draft.texts.some(text => draftText(text) === content), focused: document.activeElement === composer || composer.contains(document.activeElement) };`,
      '})()',
    ].join(' '), signal)
    if (value?.count !== 1 || typeof value.empty !== 'boolean') throw new BrowserStaleError('ChatGPT composer is missing or ambiguous')
    if (focus) {
      this.acceptMutation(await this.browser.focus(composerSelector, await this.mutationContext(signal)))
      const focused = await this.evaluate<boolean>(`(() => { const element = document.querySelector(${JSON.stringify(composerSelector)}); return !!element && (document.activeElement === element || element.contains(document.activeElement)) })()`, signal)
      if (!focused) throw new BrowserStaleError('ChatGPT composer focus could not be verified')
    }
    return { empty: value.empty, owned: value.owned === true }
  }

  private async ensureCurrentTargetVisible(draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), 1_000)
    const active = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
    const readVisibility = () => this.evaluate<{ visibility?: string; url?: string }>('({ visibility: document.visibilityState, url: location.href })', active)
    try {
      const initial = await readVisibility()
      if (initial?.visibility === 'visible') return
      if (initial?.visibility !== 'hidden') throw new BrowserStaleError('ChatGPT document visibility is unavailable')
      const page = await this.browser.pageInfo(active)
      const target = await this.browser.currentTarget(active)
      if (typeof page?.url !== 'string' || !page.url.startsWith('https://chatgpt.com/') || initial.url !== page.url
        || typeof target?.targetId !== 'string' || target.targetId.trim() === '' || target.url !== page.url) {
        throw new BrowserStaleError('ChatGPT current tab identity could not be verified')
      }
      const activated = await this.browser.activateTarget(target.targetId, active)
      if (typeof activated !== 'object' || activated === null || Array.isArray(activated) || 'error' in activated) {
        throw new BrowserStaleError('ChatGPT current tab activation failed')
      }
      while (true) {
        const current = await this.browser.currentTarget(active)
        const state = await readVisibility()
        if (current?.targetId !== target.targetId || current.url !== page.url || state?.url !== page.url) {
          throw new BrowserStaleError('ChatGPT current tab changed during visibility recovery')
        }
        if (state.visibility === 'visible') return
        if (state.visibility !== 'hidden') throw new BrowserStaleError('ChatGPT document visibility is unavailable')
        await abortableDelay(100, active)
      }
    } catch (error) {
      draft.preserve = true
      throwIfCancelled(signal)
      if (deadline.signal.aborted) throw new BrowserStaleError('ChatGPT current tab did not become visible')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async typeComposer(before: string, text: string, draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    await this.typeComposerExpected(before, text, before + text, draft, signal)
  }

  private async typeComposerExpected(before: string, text: string, expected: string, draft: ComposerDraft, signal?: AbortSignal, autoMention?: string): Promise<boolean> {
    const current = await this.resolveComposer(signal, { texts: [before] }, true)
    if (!current.owned) throw new BrowserStaleError('ChatGPT composer changed before typing')
    draft.texts.push(expected)
    await this.checkTarget(signal)
    this.acceptMutation(await this.browser.type(text, await this.mutationContext(signal)))
    if (autoMention !== undefined && await this.verifyAppMention(autoMention, signal)) {
      draft.texts.push(autoMention)
      return true
    }
    if (!(await this.resolveComposer(signal, { texts: [expected] })).owned) throw new BrowserStaleError('ChatGPT input could not be verified')
    return false
  }


  private async appSeparator(appName: string, signal?: AbortSignal): Promise<boolean> {
    const value = await this.evaluate<unknown>([
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
    ].join(' '), signal)
    if (typeof value !== 'boolean') throw new BrowserStaleError('ChatGPT App separator is not recognized')
    return value
  }

  private async clearComposer(draft: ComposerDraft, signal?: AbortSignal): Promise<void> {
    const current = await this.resolveComposer(signal, draft)
    if (current.empty) return
    if (!current.owned) throw new BrowserStaleError('ChatGPT composer draft is not owned by this operation')
    await this.ensureCurrentTargetVisible(draft, signal)
    if (!(await this.resolveComposer(signal, draft, true)).owned) throw new BrowserStaleError('ChatGPT composer changed before cleanup')
    await this.checkTarget(signal)
    this.acceptMutation(await this.browser.press('a', 2, await this.mutationContext(signal)))
    const selected = await this.evaluate<unknown>([
      '(() => {', composerScript,
      'if (!composer || document.activeElement !== composer) return false;',
      'const content = typeof composer.value === "string" ? composer.value : (composer.innerText || composer.textContent || "");',
      'const draft = ' + JSON.stringify(draft) + ';',
      'if (!draft.texts.some(text => draftText(text) === draftText(content))) return false;',
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
    ].join(' '), signal)
    if (selected !== true) throw new BrowserStaleError('ChatGPT composer selection is not complete and contained')
    await this.checkTarget(signal)
    this.acceptMutation(await this.browser.press('Backspace', undefined, await this.mutationContext(signal)))
    if (!(await this.resolveComposer(signal)).empty) throw new BrowserStaleError('ChatGPT composer cleanup could not be verified')
  }


}

function replyTextDigest(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
function observationEpoch(target: BrowserTargetIdentity): string {
  return createHash('sha256').update(JSON.stringify([target.targetId, target.documentId, target.epoch])).digest('hex')
}

function classifyChatRoute(value: string): string {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://chatgpt.com') return 'OTHER'
    if (url.pathname === '/') return 'NEW_CHAT'
    const match = /^\/c\/([^/]+)\/?$/.exec(url.pathname)
    return match ? 'CONVERSATION:' + match[1] : 'OTHER'
  } catch { return 'OTHER' }
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
