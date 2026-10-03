import { z } from 'zod'
import type { ChatSendObservationControl, BoundReplyObservationBaseline, ChatReply, ControlOperation, ReplyObservationBaseline } from '../core/ports/chat-control.ts'
import type { ChatControlDiagnostics, ChatReadiness } from '../core/ports/chat-diagnostics.ts'
import { SIDECAR_ERROR_CODES, SidecarRpcError } from './errors.ts'
import { postRpc } from './rpc-http.ts'
import { parseControlOperation, parseSidecarRequest, replyBaselineSchema, SIDECAR_MAX_REQUEST_BYTES, type SidecarMethod, validateSidecarEndpoint } from './protocol.ts'

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
const responseSchema = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(1), requestId: identifier, generation: identifier, ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ version: z.literal(1), requestId: identifier, generation: identifier, ok: z.literal(false), error: z.object({ code: z.enum(SIDECAR_ERROR_CODES) }).strict() }).strict(),
])
const healthSchema = z.object({ ok: z.boolean(), detail: z.string().max(128) }).strict()
const replySchema = z.object({ text: z.string(), complete: z.boolean() }).strict()
const conversationSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const readinessSchema = z.object({ url: z.string().max(2048), composer: z.boolean(), loggedOut: z.boolean() }).strict()
// Internal distinction: a valid server refusal must not be treated as lost transport.
class InterruptedRpcError extends SidecarRpcError {
  constructor() { super('SIDECAR_UNAVAILABLE') }
}
export interface SidecarClientConfig { endpoint: string; authentication: string; requestTimeoutMs?: number }

/** A semantic HTTP client. Deployment, browser and workspace ownership stay elsewhere. */
export class SidecarChatControlClient implements ChatSendObservationControl, ChatControlDiagnostics {
  private readonly endpoint: string
  private readonly timeoutMs: number
  private generation: string | undefined
  constructor(private readonly config: SidecarClientConfig) {
    this.endpoint = validateSidecarEndpoint(config.endpoint)
    this.timeoutMs = config.requestTimeoutMs ?? 30_000
    if (!config.authentication || /[\r\n]/.test(config.authentication) || !Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 600_000) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  }
  private async rpc(method: SidecarMethod, params: unknown, operationId: string, signal?: AbortSignal, timeoutMs = this.timeoutMs, correlation?: ControlOperation['correlation'], replyBaseline?: ControlOperation['replyBaseline'], replyRecovery?: ControlOperation['replyRecovery']): Promise<unknown> {
    if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED')
    const requestId = crypto.randomUUID()
    const request = parseSidecarRequest({ version: 1, requestId, operationId, generation: this.generation, method, params, correlation, ...(replyBaseline === undefined ? {} : { replyBaseline }), ...(replyRecovery === undefined ? {} : { replyRecovery }) })
    const body = JSON.stringify(request)
    if (new TextEncoder().encode(body).byteLength > SIDECAR_MAX_REQUEST_BYTES) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    const deadline = AbortSignal.timeout(timeoutMs)
    const transportSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      const response = await postRpc(this.endpoint, this.config.authentication, body, transportSignal)
      let value: unknown
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)) } catch { throw new SidecarRpcError('SIDECAR_INVALID_REQUEST') }
      const parsed = responseSchema.safeParse(value)
      if (!parsed.success || parsed.data.requestId !== requestId) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
      if (method !== 'health' && parsed.data.generation !== this.generation) { this.generation = undefined; throw new SidecarRpcError('SIDECAR_GENERATION_CHANGED') }
      if (!parsed.data.ok) throw new SidecarRpcError(parsed.data.error.code)
      if (response.status < 200 || response.status >= 300) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
      if (method === 'health') this.generation = parsed.data.generation
      return parsed.data.result
    } catch (error) {
      if (error instanceof SidecarRpcError) throw error
      if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED')
      if (deadline.aborted) throw new SidecarRpcError('SIDECAR_TIMEOUT')
      throw new InterruptedRpcError()
    }
  }
  private async call(method: SidecarMethod, params: unknown, signal?: AbortSignal, timeoutMs = this.timeoutMs, suppliedOperation?: ControlOperation): Promise<unknown> {
    if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED')
    const operation = parseControlOperation(suppliedOperation ?? { operationId: crypto.randomUUID() })
    if (!this.generation) await this.healthWithSignal(signal)
    const operationId = operation.operationId
    try { return await this.rpc(method, params, operationId, signal, timeoutMs, operation.correlation, operation.replyBaseline, operation.replyRecovery) }
    catch (error) {
      if (error instanceof InterruptedRpcError || error instanceof SidecarRpcError && ['OPERATION_CANCELLED', 'SIDECAR_TIMEOUT'].includes(error.code)) {
        // Independent transport lifetime: an aborted caller cannot abort cleanup.
        await this.rpc('cancel', { operationId }, crypto.randomUUID(), undefined, Math.min(this.timeoutMs, 2_000)).catch(() => {})
      }
      throw error
    }
  }
  private async healthWithSignal(signal?: AbortSignal) {
    const value = await this.rpc('health', {}, crypto.randomUUID(), signal)
    const parsed = healthSchema.safeParse(value)
    if (!parsed.success) { this.generation = undefined; throw new SidecarRpcError('SIDECAR_INVALID_REQUEST') }
    return parsed.data
  }
  health() { return this.healthWithSignal() }
  async captureReplyBaseline(signal?: AbortSignal): Promise<ReplyObservationBaseline> {
    const result = replyBaselineSchema.safeParse(await this.call('captureReplyBaseline', {}, signal))
    if (!result.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    return result.data
  }
  async captureSendObservation(sendOperationId: string, signal?: AbortSignal): Promise<BoundReplyObservationBaseline> {
    const result = replyBaselineSchema.safeParse(await this.call('captureSendObservation', { sendOperationId }, signal))
    if (!result.success || result.data.conversationId === null) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    return { ...result.data, conversationId: result.data.conversationId }
  }
  async ensureReady(signal?: AbortSignal): Promise<void> { this.checkVoid(await this.call('ensureReady', {}, signal)) }
  async openConversation(conversationId?: string, signal?: AbortSignal): Promise<string> {
    const result = await this.call('openConversation', { conversationId }, signal)
    // The semantic driver's explicit new-chat route has no conversation ID
    // until the first owned send is observed. Known routes still require IDs.
    if (conversationId === undefined && result === '') return ''
    const parsed = conversationSchema.safeParse(result)
    if (!parsed.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    return parsed.data
  }
  async sendControlMessage(text: string, signal?: AbortSignal, operation?: ControlOperation): Promise<void> { this.checkVoid(await this.call('sendControlMessage', { text }, signal, this.timeoutMs, operation)) }
  async waitForReply(timeoutMs: number, signal?: AbortSignal, operation?: ControlOperation): Promise<ChatReply> {
    const parsed = replySchema.safeParse(await this.call('waitForReply', { timeoutMs }, signal, Math.min(timeoutMs + this.timeoutMs, 630_000), operation))
    if (!parsed.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    return parsed.data
  }
  async recover(signal?: AbortSignal): Promise<void> { this.checkVoid(await this.call('recover', {}, signal)) }
  async readiness(signal?: AbortSignal): Promise<ChatReadiness> {
    const parsed = readinessSchema.safeParse(await this.call('readiness', {}, signal))
    if (!parsed.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    return parsed.data
  }
  async probeApp(appName: string, signal?: AbortSignal, operation?: ControlOperation): Promise<void> {
    this.checkVoid(await this.call('probeApp', { appName }, signal, this.timeoutMs, operation))
  }
  async currentConversation(signal?: AbortSignal): Promise<string | undefined> {
    const value = await this.call('currentConversation', {}, signal)
    if (value === null) return undefined
    const parsed = conversationSchema.safeParse(value)
    if (!parsed.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    return parsed.data
  }
  private checkVoid(value: unknown): void { if (value !== null) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST') }
}
