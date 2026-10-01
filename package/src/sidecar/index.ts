/** OS-independent client entry. Concrete process and storage adapters are separate. */
export { SidecarChatControlClient, type SidecarClientConfig } from './client.ts'
export { SidecarRpcError, SIDECAR_ERROR_CODES, type SidecarErrorCode } from './errors.ts'
export { SIDECAR_RPC_VERSION, SIDECAR_METHODS } from './protocol.ts'
export type { ChatControl, ChatReply, ControlOperation } from '../core/ports/chat-control.ts'
