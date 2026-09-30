/** Semantic control plane; implementations own their transport and UI. */
export interface ChatReply { text: string; complete: boolean }
export interface ChatControl {
  health(): Promise<{ ok: boolean; detail: string }>
  ensureReady(signal?: AbortSignal): Promise<void>
  openConversation(conversationId?: string, signal?: AbortSignal): Promise<string>
  sendControlMessage(text: string, signal?: AbortSignal): Promise<void>
  waitForReply(timeoutMs: number, signal?: AbortSignal): Promise<ChatReply>
  recover(signal?: AbortSignal): Promise<void>
  currentConversation(signal?: AbortSignal): Promise<string | undefined>
}
