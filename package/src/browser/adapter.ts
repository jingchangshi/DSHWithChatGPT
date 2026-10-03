import type { ChatControl, ChatReply, ChatSendObservationControl } from '../core/ports/chat-control.ts'
/** Legacy browser names retained for compatibility. */
export type BrowserReply = ChatReply
export interface BrowserControl extends ChatControl, Partial<Pick<ChatSendObservationControl, 'captureReplyBaseline' | 'captureSendObservation'>> {
  conversationId(signal?: AbortSignal): Promise<string | undefined>
  readiness?(signal?: AbortSignal): Promise<{ url: string; composer: boolean; loggedOut: boolean }>
  probeApp?(appName: string, signal?: AbortSignal): Promise<void>
}
export { DuplicateSendGuard } from '../orchestrator/legacy-send-guard.ts'
export { extractEnvelopeText } from '../protocol/legacy-reply.ts'

export { ChatGptLoggedOutError, ChatGptAppUnavailableError, BrowserStaleError } from './errors.ts'

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
