/** Semantic control plane; implementations own their transport and UI. */
export interface ChatReply { text: string; complete: boolean }
/** Durable semantic invocation identity; each HTTP attempt has a separate ID. */
export interface ControlOperation {
  operationId: string
  correlation?: { taskId: string; iteration: number; workspaceId: string; phase: 'INIT' | 'PLAN' | 'EXECUTED' | 'DONE'; head?: string }
}
export interface ChatControl {
  health(): Promise<{ ok: boolean; detail: string }>
  ensureReady(signal?: AbortSignal): Promise<void>
  openConversation(conversationId?: string, signal?: AbortSignal): Promise<string>
  sendControlMessage(text: string, signal?: AbortSignal, operation?: ControlOperation): Promise<void>
  waitForReply(timeoutMs: number, signal?: AbortSignal, operation?: ControlOperation): Promise<ChatReply>
  recover(signal?: AbortSignal): Promise<void>
  currentConversation(signal?: AbortSignal): Promise<string | undefined>
}
