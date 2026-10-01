import { z } from 'zod'
import { SidecarRpcError } from './errors.ts'

export const SIDECAR_RPC_VERSION = 1 as const
export const SIDECAR_MAX_REQUEST_BYTES = 65_536
export const SIDECAR_MAX_REPLY_BYTES = 65_536
export const SIDECAR_MAX_WAIT_MS = 600_000
export const SIDECAR_METHODS = ['health', 'ensureReady', 'openConversation', 'sendControlMessage', 'waitForReply', 'currentConversation', 'recover', 'readiness', 'probeApp', 'cancel', 'shutdown'] as const
export type SidecarMethod = typeof SIDECAR_METHODS[number]
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
const conversation = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const replyBaselineSchema = z.object({ version: z.literal(1), conversationId: conversation.nullable(), assistantCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), textDigest: z.string().regex(/^[a-f0-9]{64}$/), observationEpoch: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const correlation = z.object({
  taskId: identifier,
  iteration: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  workspaceId: identifier,
  phase: z.enum(['INIT', 'PLAN', 'EXECUTED', 'DONE']),
  head: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional(),
}).strict()
const operationSchema = z.object({ operationId: identifier, correlation: correlation.optional(), replyBaseline: replyBaselineSchema.optional() }).strict()
export function parseControlOperation(value: unknown): z.infer<typeof operationSchema> {
  const parsed = operationSchema.safeParse(value)
  if (!parsed.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  return parsed.data
}
const envelope = {
  version: z.literal(SIDECAR_RPC_VERSION),
  requestId: identifier,
  operationId: identifier,
  generation: identifier.optional(),
  correlation: correlation.optional(),
}
const empty = z.object({}).strict()
const observationEnvelope = { ...envelope, replyBaseline: replyBaselineSchema.optional() }
const requestSchema = z.discriminatedUnion('method', [
  z.object({ ...envelope, method: z.literal('health'), params: empty }).strict(),
  z.object({ ...envelope, method: z.literal('ensureReady'), params: empty }).strict(),
  z.object({ ...envelope, method: z.literal('openConversation'), params: z.object({ conversationId: conversation.optional() }).strict() }).strict(),
  z.object({ ...observationEnvelope, method: z.literal('sendControlMessage'), params: z.object({ text: z.string().min(1).max(SIDECAR_MAX_REQUEST_BYTES) }).strict() }).strict(),
  z.object({ ...observationEnvelope, method: z.literal('waitForReply'), params: z.object({ timeoutMs: z.number().int().positive().max(SIDECAR_MAX_WAIT_MS) }).strict() }).strict(),
  z.object({ ...envelope, method: z.literal('currentConversation'), params: empty }).strict(),
  z.object({ ...envelope, method: z.literal('recover'), params: empty }).strict(),
  z.object({ ...envelope, method: z.literal('readiness'), params: empty }).strict(),
  z.object({ ...envelope, method: z.literal('probeApp'), params: z.object({ appName: z.string().min(1).max(256) }).strict() }).strict(),
  z.object({ ...envelope, method: z.literal('cancel'), params: z.object({ operationId: identifier }).strict() }).strict(),
  z.object({ ...envelope, method: z.literal('shutdown'), params: empty }).strict(),
])
export type SidecarRequest = z.infer<typeof requestSchema>

export function parseSidecarRequest(value: unknown): SidecarRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  if ((value as { version?: unknown }).version !== SIDECAR_RPC_VERSION) throw new SidecarRpcError('SIDECAR_VERSION_UNSUPPORTED')
  const parsed = requestSchema.safeParse(value)
  if (!parsed.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  return parsed.data
}

/** Reject normalization aliases, credentials and query/fragment secret channels. */
export function validateSidecarEndpoint(endpoint: string): string {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(endpoint)
  if (!match || Number(match[1]) > 65_535) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  return endpoint.endsWith('/') ? endpoint : endpoint + '/'
}
