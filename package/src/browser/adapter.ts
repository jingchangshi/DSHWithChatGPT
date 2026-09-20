/**
 * Browser control plane abstraction. The orchestrator depends only on the
 * BrowserControl interface; concrete adapters bind DSH BrowserUse /
 * Browser Harness MCP session tools to ChatGPT Web. DOM strategy: semantic
 * selectors (role, aria-label, placeholder, contenteditable) — never long
 * generated CSS classes.
 * @module browser
 */

/** Reply-wait result. */
export interface BrowserReply {
  /** Full latest assistant message text (envelope extracted elsewhere). */
  text: string
  /** Whether the reply looked complete (composer idle, no stop button). */
  complete: boolean
}

/** Abstract ChatGPT-Web-capable browser control. */
export interface BrowserControl {
  /** Ensure a browser session exists and ChatGPT is reachable+logged in. */
  ensureReady(): Promise<void>
  /** Open (or reuse) the persistent conversation; returns conversation id/url. */
  openConversation(conversationId?: string): Promise<string>
  /** Send one control message. Throws on duplicate-send suspicion. */
  sendControlMessage(text: string): Promise<void>
  /** Wait for and read the latest assistant reply. */
  waitForReply(timeoutMs: number): Promise<BrowserReply>
  /** Health probe. */
  health(): Promise<{ ok: boolean; detail: string }>
  /** Best-effort recovery (reload page, re-find composer). */
  recover(): Promise<void>
}

/** ChatGPT-not-logged-in detection error. */
export class ChatGptLoggedOutError extends Error {
  constructor() {
    super('ChatGPT_WEB_LOGGED_OUT: the browser session is not logged in to ChatGPT')
    this.name = 'ChatGptLoggedOutError'
  }
}

/** Composer-not-found / page-stale error. */
export class BrowserStaleError extends Error {
  constructor(detail: string) {
    super('BROWSER_STALE: ' + detail)
    this.name = 'BrowserStaleError'
  }
}

/**
 * Duplicate-send protection: identical control text sent twice within the
 * cooldown window almost always means the first send never registered —
 * the coordinator should verify state before re-sending.
 */
export class DuplicateSendGuard {
  private readonly recent = new Map<string, number>()

  constructor(private readonly cooldownMs = 30_000) {}

  /** Whether sending this text now would be a suspicious duplicate. */
  isDuplicate(text: string): boolean {
    const last = this.recent.get(text)
    if (last === undefined) return false
    return Date.now() - last < this.cooldownMs
  }

  /** Record a send. */
  record(text: string): void {
    this.recent.set(text, Date.now())
    // GC old entries.
    const cutoff = Date.now() - this.cooldownMs * 4
    for (const [key, time] of this.recent) {
      if (time < cutoff) this.recent.delete(key)
    }
  }
}

/**
 * Retry budget with bounded attempts and backoff, used by the browser
 * adapter so transient stalls (e.g. screenshot hiccups) don't cascade.
 */
export class RetryBudget {
  private attempts = 0

  constructor(private readonly maxAttempts: number, private readonly baseDelayMs = 500) {}

  /** Whether another attempt is allowed. */
  canRetry(): boolean {
    return this.attempts < this.maxAttempts
  }

  /** Record an attempt and return the delay before the next one. */
  nextDelayMs(): number {
    this.attempts++
    return Math.min(this.baseDelayMs * 2 ** (this.attempts - 1), 8000)
  }

  /** Reset after success. */
  reset(): void {
    this.attempts = 0
  }

  /** Current attempt count. */
  get used(): number {
    return this.attempts
  }
}

/** Extract the last [D2C] envelope from a conversational reply. */
export function extractEnvelopeText(reply: string): string | null {
  const index = reply.lastIndexOf('[D2C]')
  if (index < 0) return null
  return reply.slice(index)
}
