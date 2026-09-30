import type { ChatControl, ChatReply } from '../core/ports/chat-control.ts'
/** Legacy browser names retained for compatibility. */
export type BrowserReply = ChatReply
export interface BrowserControl extends ChatControl {
  conversationId(signal?: AbortSignal): Promise<string | undefined>
  readiness?(signal?: AbortSignal): Promise<{ url: string; composer: boolean; loggedOut: boolean }>
  probeApp?(appName: string, signal?: AbortSignal): Promise<void>
}
export { DuplicateSendGuard } from '../orchestrator/legacy-send-guard.ts'
export { extractEnvelopeText } from '../protocol/legacy-reply.ts'

/** ChatGPT-not-logged-in detection error. */
export class ChatGptLoggedOutError extends Error {
  constructor() {
    super('ChatGPT_WEB_LOGGED_OUT: the browser session is not logged in to ChatGPT')
    this.name = 'ChatGptLoggedOutError'
  }
}

/** Configured ChatGPT app could not be activated for the outgoing message. */
export class ChatGptAppUnavailableError extends Error {
  constructor(appName: string, detail = 'no exact app mention candidate appeared') {
    super(`CHATGPT_APP_UNAVAILABLE: ${JSON.stringify(appName)}: ${detail}`)
    this.name = 'ChatGptAppUnavailableError'
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
