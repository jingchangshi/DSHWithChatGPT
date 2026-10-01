import { throwIfCancelled, OperationCancelledError } from '../cancellation.ts'
import { BrowserMutationUncertainError, BrowserTargetChangedError, sameBrowserTarget, type BrowserTargetIdentity } from './epoch.ts'

/** The supported subset of a websocket, also usable by deterministic wire tests. */
export interface CdpSocket {
  readyState: number
  on(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  send(data: string, callback: (error?: Error) => void): void
  terminate(): void
}
export class CdpCommandError extends Error {
  constructor(readonly written: boolean, readonly reason: string) { super('CDP_COMMAND_FAILED: ' + reason); this.name = 'CdpCommandError' }
}
interface CommandOptions {
  signal?: AbortSignal
  timeoutMs?: number
  beforeWrite?: () => void
  onWritten?: () => void
  /** Input cannot be recalled: caller cancellation after admission waits for ack. */
  settleAfterWrite?: boolean
}
interface Pending {
  written: boolean
  finish(error?: Error, value?: unknown): void
}

/** Bounded transport only; no browser or application policy and no replay. */
export class CdpSession {
  private sequence = 0
  private closed = false
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Set<(method: string, params: any) => void>()
  private readonly timeoutMs: number
  private readonly maxPending: number
  private readonly maxMessageBytes: number
  constructor(private readonly socket: CdpSocket, options: { timeoutMs?: number; maxPending?: number; maxMessageBytes?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.maxPending = options.maxPending ?? 64
    this.maxMessageBytes = options.maxMessageBytes ?? 1024 * 1024
    for (const value of [this.timeoutMs, this.maxPending, this.maxMessageBytes]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid CDP transport bound')
    }
    socket.on('message', this.onMessage)
    socket.on('close', this.onClose)
    socket.on('error', this.onClose)
  }
  get pendingCount() { return this.pending.size }
  get commandTimeoutMs() { return this.timeoutMs }
  subscribe(listener: (method: string, params: any) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  command<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, options: CommandOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try { throwIfCancelled(options.signal) } catch (error) { reject(error); return }
      if (this.closed || this.socket.readyState !== 1) { reject(new CdpCommandError(false, 'connection closed')); return }
      if (this.pending.size >= this.maxPending || this.sequence === Number.MAX_SAFE_INTEGER) { reject(new CdpCommandError(false, 'capacity exceeded')); return }
      const timeoutMs = options.timeoutMs ?? this.timeoutMs
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) { reject(new CdpCommandError(false, 'invalid deadline')); return }
      const id = ++this.sequence
      let settled = false
      const timer = setTimeout(() => entry.finish(new CdpCommandError(entry.written, 'deadline exceeded')), timeoutMs)
      const onAbort = () => {
        if (!(entry.written && options.settleAfterWrite)) entry.finish(new OperationCancelledError())
      }
      const entry: Pending = {
        written: false,
        finish: (error, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', onAbort)
          this.pending.delete(id)
          if (error) reject(error); else resolve(value as T)
        },
      }
      this.pending.set(id, entry)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        // All admission checks run synchronously immediately before send().
        const payload = JSON.stringify({ id, method, params })
        if (Buffer.byteLength(payload) > this.maxMessageBytes) throw new CdpCommandError(false, 'outgoing message too large')
        options.beforeWrite?.()
        throwIfCancelled(options.signal)
        entry.written = true
        options.onWritten?.()
        // Admission to ws.send is conservative: queued bytes may already escape.
        this.socket.send(payload, error => { if (error) entry.finish(new CdpCommandError(true, 'write failed')) })
      } catch (error) { entry.finish(error instanceof Error ? error : new CdpCommandError(entry.written, 'write failed')) }
    })
  }
  private onMessage = (raw: unknown, binary?: boolean): void => {
    if (this.closed) return
    if (binary || !(typeof raw === 'string' || Buffer.isBuffer(raw))) { this.fail('invalid message'); return }
    if (Buffer.byteLength(raw) > this.maxMessageBytes) { this.fail('incoming message too large'); return }
    let value: any
    try { value = JSON.parse(raw.toString()) } catch { this.fail('invalid JSON'); return }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { this.fail('invalid envelope'); return }
    if ('id' in value) {
      if (!Number.isSafeInteger(value.id) || value.id <= 0 || ('result' in value) === ('error' in value)
        || ('result' in value && (!value.result || typeof value.result !== 'object' || Array.isArray(value.result)))
        || ('error' in value && (!value.error || typeof value.error !== 'object' || typeof value.error.code !== 'number' || typeof value.error.message !== 'string'))) { this.fail('invalid response'); return }
      const entry = this.pending.get(value.id)
      if (!entry) return // timed out/aborted responses never resurrect commands
      if ('error' in value) entry.finish(new CdpCommandError(entry.written, 'provider rejected command'))
      else entry.finish(undefined, value.result)
    } else if (typeof value.method === 'string' && (!('params' in value) || (value.params && typeof value.params === 'object' && !Array.isArray(value.params)))) {
      for (const listener of this.listeners) {
        try { listener(value.method, value.params ?? {}) } catch { this.fail('invalid lifecycle event'); return }
      }
    } else this.fail('invalid event')
  }
  private onClose = (): void => { this.fail('connection lost') }
  private fail(reason: string): void {
    if (this.closed) return
    this.closed = true
    for (const entry of [...this.pending.values()]) entry.finish(new CdpCommandError(entry.written, reason))
    this.socket.off('message', this.onMessage)
    this.socket.off('close', this.onClose)
    this.socket.off('error', this.onClose)
    for (const listener of this.listeners) { try { listener('PlannerBridge.transportClosed', {}) } catch {} }
    this.listeners.clear()
    this.socket.terminate()
  }
  close(): void { this.fail('connection closed') }
}

/** Document fencing around target-only Input. Post-write uncertainty is terminal
 * for this binding, including a successful ack whose old context disappeared. */
export class CdpMutationGate {
  quarantined = false
  constructor(private readonly session: CdpSession,
    private readonly current: () => BrowserTargetIdentity,
    private readonly reconcile: (expected: BrowserTargetIdentity, signal?: AbortSignal, timeoutMs?: number) => Promise<BrowserTargetIdentity>) {}
  private check(expected: BrowserTargetIdentity, admission = false): void {
    const current = this.current()
    if (this.quarantined || !sameBrowserTarget(expected, current) || (admission && (expected.url !== current.url || expected.transitionSequence !== current.transitionSequence))) throw new BrowserTargetChangedError()
  }
  async execute(method: string, params: Record<string, unknown>, context: { expected: BrowserTargetIdentity; signal?: AbortSignal; deadlineMs?: number }): Promise<{ target: BrowserTargetIdentity }> {
    throwIfCancelled(context.signal)
    const remaining = () => {
      if (context.deadlineMs === undefined) return this.session.commandTimeoutMs
      if (!Number.isSafeInteger(context.deadlineMs) || context.deadlineMs <= Date.now()) throw new OperationCancelledError()
      return Math.min(this.session.commandTimeoutMs, context.deadlineMs - Date.now())
    }
    remaining()
    this.check(context.expected, true)
    await this.reconcile(context.expected, context.signal, remaining())
    let written = false
    try {
      const result = await this.session.command<any>(method, params, {
        signal: context.signal,
        timeoutMs: remaining(),
        settleAfterWrite: true,
        // URL is not document identity. However an unobserved URL transition
        // before writing requires the semantic caller to inspect policy again.
        beforeWrite: () => { remaining(); this.check(context.expected, true) },
        onWritten: () => { written = true },
      })
      if (method.startsWith('Runtime.') && result?.exceptionDetails) throw new CdpCommandError(true, 'runtime mutation rejected')
      // An abort after dispatch must not retract an acknowledged success.
      const target = await this.reconcile(context.expected, undefined, remaining())
      this.check(context.expected)
      return { target }
    } catch (error) {
      if (written) { this.quarantined = true; throw new BrowserMutationUncertainError() }
      throw error
    }
  }
}
