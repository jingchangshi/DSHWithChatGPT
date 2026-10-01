/** Semantic control plane; implementations own their transport and UI. */
export interface ChatReply { text: string; complete: boolean }
/** Non-secret observation metadata; never an authority or model envelope field. */
export interface ReplyObservationBaseline {
  version: 1
  conversationId: string | null
  assistantCount: number
  textDigest: string
  observationEpoch: string
}
/** Durable semantic invocation identity; each HTTP attempt has a separate ID. */
export interface ControlOperation {
  operationId: string
  replyBaseline?: ReplyObservationBaseline
  /** Wait-only binding to a previously journaled semantic send. */
  replyRecovery?: { sendOperationId: string }
  correlation?: { taskId: string; iteration: number; workspaceId: string; phase: 'INIT' | 'PLAN' | 'EXECUTED' | 'DONE'; head?: string }
}
/** Additive semantic observation capability; legacy transports may omit it. */
export interface ChatObservationControl extends ChatControl {
  captureReplyBaseline(signal?: AbortSignal): Promise<ReplyObservationBaseline>
}
export interface ReplyReconciliationRequest { conversationId: string; controlDigest: string }
export interface ChatRecoveryControl extends ChatObservationControl {
  reconcileReplyBaseline(request: ReplyReconciliationRequest, signal?: AbortSignal): Promise<ReplyObservationBaseline>
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
