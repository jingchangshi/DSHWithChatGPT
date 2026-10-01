import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ChatControl } from '../core/ports/chat-control.ts'
import type { ChatControlDiagnostics } from '../core/ports/chat-diagnostics.ts'
import { verifyPrivateStateDirectory } from '../deployment/private-state.ts'
export { protectPrivateStateDirectory } from '../deployment/private-state.ts'
import { DeliveryJournal, type DeliveryEntry, type DeliveryPhase } from './journal.ts'
import { SIDECAR_ERROR_CODES, SidecarRpcError, type SidecarErrorCode } from './errors.ts'
import { parseSidecarRequest, SIDECAR_MAX_REPLY_BYTES, SIDECAR_MAX_REQUEST_BYTES, type SidecarRequest } from './protocol.ts'

export interface SidecarServerConfig {
  host: '127.0.0.1'; port: number; authentication: string; stateDirectory: string
  driver: ChatControl & Partial<ChatControlDiagnostics>; requestTimeoutMs?: number; maxRequestBytes?: number; maxReplyBytes?: number
  /** Trusted deployment binding; RPC callers cannot change the selected product App. */
  configuredAppName?: string
  /** Trusted deployment diagnostics; never exposed as an RPC method. */
  onDeliveryPhase?: (entry: DeliveryEntry, signal: AbortSignal) => void | Promise<void>
}
type Outcome = { ok: true; result: unknown } | { ok: false; error: { code: SidecarErrorCode } }
const failure = (code: SidecarErrorCode): Outcome => ({ ok: false, error: { code } })
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function providerError(error: unknown): SidecarErrorCode {
  if (error instanceof SidecarRpcError) return error.code
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'string' && SIDECAR_ERROR_CODES.includes(code as SidecarErrorCode)) return code as SidecarErrorCode
  // Compatibility providers have fixed public prefixes. Never forward their text.
  const prefix = error instanceof Error ? error.message.split(':', 1)[0] : undefined
  if (prefix === 'D2C_CANCELLED') return 'OPERATION_CANCELLED'
  if (prefix === 'ChatGPT_WEB_LOGGED_OUT') return 'CHATGPT_LOGGED_OUT'
  if (prefix && SIDECAR_ERROR_CODES.includes(prefix as SidecarErrorCode)) return prefix as SidecarErrorCode
  return 'SIDECAR_UNAVAILABLE'
}

/** Owns only semantic control and private delivery state; has no workspace handle. */
export async function startSidecar(config: SidecarServerConfig) {
  if (config.configuredAppName !== undefined && (!config.configuredAppName || config.configuredAppName.length > 256 || config.configuredAppName.trim() !== config.configuredAppName)) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  const timeoutMs = config.requestTimeoutMs ?? 30_000
  const maxRequestBytes = config.maxRequestBytes ?? SIDECAR_MAX_REQUEST_BYTES
  const maxReplyBytes = config.maxReplyBytes ?? SIDECAR_MAX_REPLY_BYTES
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 0 || config.port > 65_535 || !config.authentication || /[\r\n]/.test(config.authentication) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 || !Number.isInteger(maxRequestBytes) || maxRequestBytes < 1_024 || maxRequestBytes > SIDECAR_MAX_REQUEST_BYTES || !Number.isInteger(maxReplyBytes) || maxReplyBytes < 1_024 || maxReplyBytes > SIDECAR_MAX_REPLY_BYTES) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  await verifyPrivateStateDirectory(config.stateDirectory)
  const journal = await DeliveryJournal.open({ directory: config.stateDirectory, maxEntries: 512, maxBytes: 262_144, maxAgeMs: 86_400_000 })
  try { await verifyPrivateStateDirectory(config.stateDirectory) }
  catch (error) { await journal.close(); throw error }
  const generation = randomUUID()
  const authenticationDigest = createHash('sha256').update('Bearer ' + config.authentication).digest()
  const attempts = new Map<string, { digest: string; outcome: Promise<Outcome> }>()
  const operations = new Map<string, { digest: string; outcome: Promise<Outcome>; retryable: boolean }>()
  let shuttingDown = false
  let active: { operationId: string; controller: AbortController; settled: Promise<void> } | undefined
  const durable = (request: SidecarRequest) => ['sendControlMessage', 'waitForReply', 'openConversation', 'ensureReady', 'recover', 'probeApp'].includes(request.method)

  async function run(request: SidecarRequest): Promise<Outcome> {
    if (request.method === 'health') return { ok: true, result: { ok: !shuttingDown, detail: shuttingDown ? 'shutting down' : 'semantic service available' } }
    if (request.method === 'cancel') {
      if (active?.operationId === request.params.operationId) active.controller.abort(new SidecarRpcError('OPERATION_CANCELLED'))
      return { ok: true, result: null }
    }
    if (request.method === 'shutdown') {
      shuttingDown = true
      active?.controller.abort(new SidecarRpcError('SIDECAR_SHUTTING_DOWN'))
      // The authenticated RPC replies before bounded process transport teardown.
      setImmediate(() => { void close() })
      return { ok: true, result: null }
    }
    if (shuttingDown) return failure('SIDECAR_SHUTTING_DOWN')
    if (request.method === 'readiness' && !config.driver.readiness) return failure('CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE')
    if (request.method === 'probeApp') {
      if (!config.driver.probeApp || config.configuredAppName === undefined) return failure('CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE')
      if (request.params.appName !== config.configuredAppName) return failure('CHATGPT_APP_UNAVAILABLE')
    }
    if (active) return failure('SIDECAR_BUSY')
    const controller = new AbortController()
    let settle!: () => void
    const owner = { operationId: request.operationId, controller, settled: new Promise<void>(resolve => { settle = resolve }) }
    active = owner
    let invoked = false
    let providerSettled = false
    let operationSettled = false
    const releaseOwner = () => { if (providerSettled && operationSettled) { if (active === owner) active = undefined; settle() } }
    let timer: ReturnType<typeof setTimeout> | undefined
    let removeAbort = () => {}
    const operationTimeout = request.method === 'waitForReply' ? request.params.timeoutMs + timeoutMs : timeoutMs
    timer = setTimeout(() => controller.abort(new SidecarRpcError('SIDECAR_TIMEOUT')), operationTimeout)
    async function observe(entry: DeliveryEntry): Promise<void> {
      if (!config.onDeliveryPhase) return
      controller.signal.throwIfAborted()
      let cleanup = () => {}
      try { await new Promise<void>((resolve, reject) => {
        const abort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', abort, { once: true })
        cleanup = () => controller.signal.removeEventListener('abort', abort)
        Promise.resolve().then(() => { controller.signal.throwIfAborted(); return config.onDeliveryPhase!(entry, controller.signal) }).then(resolve, reject)
        if (controller.signal.aborted) abort()
      }) } finally { cleanup() }
    }
    async function publishPhase(phase: DeliveryPhase): Promise<void> { await observe(await journal.transition(request.operationId, phase)) }
    try {
      if (durable(request)) {
        const correlationIdentity = request.correlation ? { method: request.method, taskId: request.correlation.taskId, iteration: request.correlation.iteration, workspaceId: request.correlation.workspaceId, phase: request.correlation.phase } : undefined
        const entry = await journal.prepare({ operationId: request.operationId, payloadDigest: digest({ method: request.method, params: request.params, correlation: request.correlation }), method: request.method, createdAt: Date.now(), ...(correlationIdentity ? { correlationDigest: digest(correlationIdentity) } : {}) })
        if (entry.phase !== 'prepared') {
          if (entry.phase === 'accepted' && request.method === 'sendControlMessage') return { ok: true, result: null }
          return failure('SEND_UNCERTAIN')
        }
        await observe(entry)
        if (controller.signal.aborted) { await journal.transition(request.operationId, 'cancelled'); return failure('OPERATION_CANCELLED') }
        await publishPhase(request.method === 'sendControlMessage' ? 'sending' : request.method === 'probeApp' ? 'probing-app' : 'awaiting-reply')
      }
      controller.signal.throwIfAborted()
      invoked = true
      const provider = (async (): Promise<unknown> => {
        switch (request.method) {
          case 'ensureReady': await config.driver.ensureReady(controller.signal); return null
          case 'openConversation': return config.driver.openConversation(request.params.conversationId, controller.signal)
          case 'sendControlMessage': await config.driver.sendControlMessage(request.params.text, controller.signal, { operationId: request.operationId, correlation: request.correlation }); return null
          case 'waitForReply': return config.driver.waitForReply(request.params.timeoutMs, controller.signal, { operationId: request.operationId, correlation: request.correlation })
          case 'currentConversation': return await config.driver.currentConversation(controller.signal) ?? null
          case 'recover': await config.driver.recover(controller.signal); return null
          case 'readiness': return config.driver.readiness!(controller.signal)
          case 'probeApp': await config.driver.probeApp!(config.configuredAppName!, controller.signal, { operationId: request.operationId, correlation: request.correlation }); return null
        }
      })()
      // Retain ownership until even an abort-ignoring provider settles. Otherwise
      // an old invocation could enter the composer after a new operation begins.
      void provider.finally(() => { providerSettled = true; releaseOwner() }).catch(() => {})
      const interrupted = new Promise<never>((_resolve, reject) => {
        const abort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', abort, { once: true })
        removeAbort = () => controller.signal.removeEventListener('abort', abort)
        if (controller.signal.aborted) abort()
      })
      const result = await Promise.race([provider, interrupted])
      // Enforce the result bound before admitting it to the replay cache.
      if (Buffer.byteLength(JSON.stringify(result)) > maxReplyBytes - 256) throw new SidecarRpcError('SIDECAR_RESPONSE_TOO_LARGE')
      if (durable(request)) {
        if (request.method === 'sendControlMessage') await publishPhase('observed-sent')
        if (request.method === 'probeApp') await publishPhase('observed-app')
        await publishPhase('accepted')
      }
      return { ok: true, result }
    } catch (error) {
      if (durable(request)) {
        const entry = journal.lookup(request.operationId)
        if (entry?.phase === 'prepared') {
          try { await journal.transition(request.operationId, controller.signal.aborted ? 'cancelled' : 'failed') } catch { return failure('JOURNAL_UNAVAILABLE') }
        }
        if (entry && ['sending', 'observed-sent', 'probing-app', 'observed-app', 'awaiting-reply'].includes(entry.phase)) {
          try { await journal.transition(request.operationId, 'uncertain') } catch { return failure('JOURNAL_UNAVAILABLE') }
        }
      }
      return failure(providerError(error))
    } finally {
      if (timer) clearTimeout(timer)
      removeAbort()
      operationSettled = true
      releaseOwner()
      if (!invoked) { if (active === owner) active = undefined; settle() }
    }
  }
  function dispatch(request: SidecarRequest): Promise<Outcome> {
    if (request.method !== 'health' && request.generation !== generation) return Promise.resolve(failure('SIDECAR_GENERATION_CHANGED'))
    const attemptDigest = digest(request)
    const previousAttempt = attempts.get(request.requestId)
    if (previousAttempt) return previousAttempt.digest === attemptDigest ? previousAttempt.outcome : Promise.resolve(failure('REPLAY_CONFLICT'))
    if (attempts.size >= 2_048) return Promise.resolve(failure('JOURNAL_CAPACITY'))
    const operationDigest = digest({ method: request.method, params: request.params, correlation: request.correlation })
    const previousOperation = operations.get(request.operationId)
    let outcome: Promise<Outcome>
    if (previousOperation && (previousOperation.digest !== operationDigest || !previousOperation.retryable)) outcome = previousOperation.digest === operationDigest ? previousOperation.outcome : Promise.resolve(failure('REPLAY_CONFLICT'))
    else if (operations.size >= 1_024) outcome = Promise.resolve(failure('JOURNAL_CAPACITY'))
    else {
      outcome = run(request).catch(error => failure(providerError(error)))
      const entry = { digest: operationDigest, outcome, retryable: false }
      operations.set(request.operationId, entry)
      void outcome.then(result => { entry.retryable = !result.ok && result.error.code === 'SIDECAR_BUSY' })
    }
    attempts.set(request.requestId, { digest: attemptDigest, outcome })
    return outcome
  }
  function write(response: ServerResponse, outcome: Outcome, requestId = 'invalid-request', status = 200): void {
    if (!outcome.ok && outcome.error.code === 'SIDECAR_RESPONSE_TOO_LARGE') status = 413
    let body = JSON.stringify({ version: 1, requestId, generation, ...outcome })
    if (Buffer.byteLength(body) > maxReplyBytes) { body = JSON.stringify({ version: 1, requestId, generation, ...failure('SIDECAR_RESPONSE_TOO_LARGE') }); status = 413 }
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.end(body)
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.socket.remoteAddress !== '127.0.0.1' || !timingSafeEqual(authenticationDigest, createHash('sha256').update(request.headers.authorization ?? '').digest())) { write(response, failure('SIDECAR_AUTH_REQUIRED'), undefined, 401); return }
    if (request.method !== 'POST') { write(response, failure('SIDECAR_INVALID_REQUEST'), undefined, 405); return }
    if (request.url !== '/' || request.headers.origin || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) { write(response, failure('SIDECAR_INVALID_REQUEST'), undefined, 400); return }
    let length = 0
    const chunks: Buffer[] = []
    const timer = setTimeout(() => request.destroy(), timeoutMs)
    try {
      if (Number(request.headers['content-length']) > maxRequestBytes) { write(response, failure('SIDECAR_INVALID_REQUEST'), undefined, 413); return }
      for await (const value of request) {
        const chunk = Buffer.from(value)
        length += chunk.length
        if (length > maxRequestBytes) { write(response, failure('SIDECAR_INVALID_REQUEST'), undefined, 413); return }
        chunks.push(chunk)
      }
      clearTimeout(timer)
      let parsed: SidecarRequest
      try { parsed = parseSidecarRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) }
      catch (error) { write(response, failure(error instanceof SidecarRpcError ? error.code : 'SIDECAR_INVALID_REQUEST'), undefined, 400); return }
      write(response, await dispatch(parsed), parsed.requestId)
    } finally { clearTimeout(timer) }
  }
  const server = createServer((request, response) => { void handle(request, response).catch(() => { if (!response.headersSent) write(response, failure('SIDECAR_UNAVAILABLE'), undefined, 500); else response.destroy() }) })
  server.requestTimeout = timeoutMs
  server.headersTimeout = timeoutMs
  server.maxHeadersCount = 16
  let closing: Promise<void> | undefined
  function close(): Promise<void> {
    return closing ??= (async () => {
      shuttingDown = true
      active?.controller.abort(new SidecarRpcError('SIDECAR_SHUTTING_DOWN'))
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([active?.settled ?? Promise.resolve(), new Promise<void>(resolve => { shutdownTimer = setTimeout(resolve, 2_000) })])
      if (shutdownTimer) clearTimeout(shutdownTimer)
      server.closeAllConnections()
      await closed
      await journal.close()
    })()
  }
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve) }) }
  catch (error) { await journal.close(); throw new SidecarRpcError('SIDECAR_UNAVAILABLE') }
  const address = server.address() as AddressInfo
  return { endpoint: `http://127.0.0.1:${address.port}/`, generation, close }
}
