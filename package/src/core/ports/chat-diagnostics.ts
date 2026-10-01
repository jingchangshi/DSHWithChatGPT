import type { ControlOperation } from './chat-control.ts'

/** Optional semantic facts, distinct from transport health and data-plane proof. */
export interface ChatReadiness { url: string; composer: boolean; loggedOut: boolean }
export interface ChatControlDiagnostics {
  readiness(signal?: AbortSignal): Promise<ChatReadiness>
  /** Selection may write an owned composer draft; it must not submit a message. */
  probeApp(appName: string, signal?: AbortSignal, operation?: ControlOperation): Promise<void>
}
