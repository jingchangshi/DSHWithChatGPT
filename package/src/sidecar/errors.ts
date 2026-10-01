export const SIDECAR_ERROR_CODES = [
  'SIDECAR_INVALID_REQUEST', 'SIDECAR_AUTH_REQUIRED', 'SIDECAR_VERSION_UNSUPPORTED',
  'SIDECAR_GENERATION_CHANGED', 'SIDECAR_TIMEOUT', 'SIDECAR_UNAVAILABLE',
  'SIDECAR_RESPONSE_TOO_LARGE', 'SIDECAR_BUSY', 'SIDECAR_SHUTTING_DOWN',
  'REPLAY_CONFLICT', 'SEND_UNCERTAIN', 'JOURNAL_CAPACITY', 'JOURNAL_UNAVAILABLE',
  'OPERATION_CANCELLED', 'BROWSER_STALE', 'BROWSER_TARGET_CHANGED',
  'CHATGPT_LOGGED_OUT', 'CHATGPT_APP_UNAVAILABLE',
  'CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE',
] as const
export type SidecarErrorCode = typeof SIDECAR_ERROR_CODES[number]

/** Stable public errors never incorporate provider messages, paths or credentials. */
export class SidecarRpcError extends Error {
  readonly code: SidecarErrorCode
  constructor(code: SidecarErrorCode) { super(code); this.code = code; this.name = 'SidecarRpcError' }
}
