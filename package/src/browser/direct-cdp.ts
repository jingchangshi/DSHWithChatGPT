import { get } from 'node:http'
import WebSocket from 'ws'
import { abortableDelay, throwIfCancelled } from '../cancellation.ts'
import { BrowserStaleError } from './errors.ts'
import { BrowserTargetChangedError, BrowserMutationUncertainError, sameBrowserTarget, type BrowserTargetIdentity } from './epoch.ts'
import { CdpSession, CdpMutationGate, CdpCommandError } from './cdp-session.ts'
import { typingFocusExpression } from './focus-expression.ts'
import type { BrowserPrimitives, BrowserMutationContext, BrowserMutationAck } from './primitives.ts'

export interface CdpTarget { id: string; type: string; url: string; webSocketDebuggerUrl?: string }
interface CdpOptions { endpoint: string; targetId: string; commandTimeoutMs?: number; signal?: AbortSignal }
interface ExecutionContext { id: number; uniqueId: string; auxData: { frameId: string; isDefault?: boolean } }
const MAX_DISCOVERY_BYTES = 1024 * 1024

function endpointPort(endpoint: string): number {
  // Validate the raw spelling before URL normalization (integer/short IP aliases).
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(endpoint)
  const port = Number(match?.[1])
  if (!match || port > 65535) throw new Error('Invalid CDP endpoint: literal loopback HTTP and explicit port required')
  return port
}
function deadline(value = 5_000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) throw new Error('Invalid CDP command deadline')
  return value
}
export async function listCdpTargets(endpoint: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CdpTarget[]> {
  const port = endpointPort(endpoint)
  const timeoutMs = deadline(options.timeoutMs)
  throwIfCancelled(options.signal)
  const body = await new Promise<string>((resolve, reject) => {
    let settled = false
    let response: import('node:http').IncomingMessage | undefined
    const request = get({ hostname: '127.0.0.1', port, path: '/json/list', agent: false }, incoming => {
      response = incoming
      if (incoming.statusCode !== 200) { finish(new Error('CDP discovery rejected')); return }
      const chunks: Buffer[] = []
      let bytes = 0
      incoming.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_DISCOVERY_BYTES) { finish(new Error('CDP discovery capacity exceeded')); return }
        chunks.push(chunk)
      })
      incoming.on('end', () => finish(undefined, Buffer.concat(chunks).toString('utf8')))
      incoming.on('error', () => finish(new Error('CDP discovery failed')))
      incoming.on('aborted', () => finish(new Error('CDP discovery incomplete')))
    })
    const timer = setTimeout(() => finish(new Error('CDP discovery deadline exceeded')), timeoutMs)
    const abort = () => { try { throwIfCancelled(options.signal) } catch (error) { finish(error as Error) } }
    options.signal?.addEventListener('abort', abort, { once: true })
    request.on('error', () => finish(new Error('CDP discovery failed')))
    function finish(error?: Error, value?: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (error) { response?.destroy(); request.destroy(); reject(error) } else resolve(value!)
    }
    if (options.signal?.aborted) abort()
  })
  let targets: unknown
  try { targets = JSON.parse(body) } catch { throw new Error('CDP discovery invalid JSON') }
  if (!Array.isArray(targets) || targets.length > 1024) throw new Error('CDP discovery invalid targets')
  if (targets.some(target => !target || typeof target !== 'object' || typeof target.id !== 'string' || typeof target.type !== 'string' || typeof target.url !== 'string')) throw new Error('CDP discovery invalid target')
  return targets as CdpTarget[]
}

/** Explicit loopback page binding. No application selectors, draft policy or
 * model/data-plane protocol. All target-only mutation uncertainty is quarantined. */
export class DirectCdpPrimitives implements BrowserPrimitives {
  readonly settlesOnCancellation = true
  private session!: CdpSession
  private gate!: CdpMutationGate
  private context: ExecutionContext | undefined
  private readonly contexts = new Map<string, ExecutionContext>()
  private frameId = ''
  private loaderId = ''
  private url = ''
  private epoch = 0
  private generation = 0
  private documentId = ''
  private state: 'BOUND' | 'QUARANTINED' | 'CLOSED' = 'CLOSED'
  private constructor(private readonly options: CdpOptions) {}
  static async connect(options: CdpOptions): Promise<DirectCdpPrimitives> {
    endpointPort(options.endpoint)
    deadline(options.commandTimeoutMs)
    if (typeof options.targetId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(options.targetId)) throw new Error('Explicit CDP page target ID required')
    const binding = new DirectCdpPrimitives({ ...options })
    try { await binding.attach(options.signal); return binding }
    catch (error) { binding.close(); throw error }
  }
  get bindingState(): 'BOUND' | 'QUARANTINED' | 'CLOSED' {
    return this.gate?.quarantined ? 'QUARANTINED' : this.state
  }
  private assertBound(): void {
    if (this.bindingState !== 'BOUND') throw new BrowserTargetChangedError()
  }
  private snapshot(): BrowserTargetIdentity {
    this.assertBound()
    if (!this.context || !this.documentId) throw new BrowserTargetChangedError()
    return { targetId: this.options.targetId, documentId: this.documentId, epoch: this.epoch, url: this.url }
  }
  private establish(context: ExecutionContext): void {
    if (context.auxData.frameId !== this.frameId || !context.auxData.isDefault) return
    this.context = context
    const id = `${this.generation}:${context.uniqueId}`
    if (id !== this.documentId) { this.documentId = id; this.epoch++ }
  }
  private lifecycle = (method: string, params: any): void => {
    if (method === 'PlannerBridge.transportClosed' || method === 'Inspector.detached') { this.state = 'CLOSED'; this.context = undefined; return }
    if (method === 'Runtime.executionContextsCleared') { this.contexts.clear(); this.context = undefined }
    if (method === 'Runtime.executionContextDestroyed') {
      for (const [id, context] of this.contexts) if (context.id === params.executionContextId || context.uniqueId === params.executionContextUniqueId) this.contexts.delete(id)
      if (this.context?.id === params.executionContextId || this.context?.uniqueId === params.executionContextUniqueId) this.context = undefined
    }
    if (method === 'Runtime.executionContextCreated') {
      const context = params.context as ExecutionContext
      // Context IDs alone can be reused across processes. Require the concrete
      // uniqueContextId capability rather than silently weakening the fence.
      if (context?.auxData?.isDefault && typeof context.uniqueId === 'string') {
        if (this.contexts.size >= 256) throw new Error('Context capacity exceeded')
        this.contexts.set(context.uniqueId, context)
        this.establish(context)
      }
    }
    if (method === 'Page.frameNavigated' && params.frame && !params.frame.parentId) {
      const frame = params.frame
      if (this.loaderId && this.loaderId !== frame.loaderId) { this.context = undefined; this.contexts.clear() }
      this.frameId = frame.id
      this.loaderId = frame.loaderId
      this.url = frame.url
      for (const context of this.contexts.values()) this.establish(context)
    }
    if (method === 'Page.navigatedWithinDocument' && params.frameId === this.frameId) this.url = params.url
  }
  private async attach(signal?: AbortSignal): Promise<void> {
    throwIfCancelled(signal)
    const targets = await listCdpTargets(this.options.endpoint, { timeoutMs: this.options.commandTimeoutMs, signal })
    const matches = targets.filter(target => target.id === this.options.targetId)
    if (matches.length !== 1 || matches[0]!.type !== 'page') throw new Error('CDP explicit page target unavailable or ambiguous')
    const wsUrl = matches[0]!.webSocketDebuggerUrl
    const port = endpointPort(this.options.endpoint)
    if (wsUrl !== `ws://127.0.0.1:${port}/devtools/page/${this.options.targetId}`) throw new Error('CDP websocket ownership invalid')
    const socket = new WebSocket(wsUrl, { handshakeTimeout: deadline(this.options.commandTimeoutMs), maxPayload: MAX_DISCOVERY_BYTES, followRedirects: false, perMessageDeflate: false })
    await new Promise<void>((resolve, reject) => {
      const abort = () => { try { throwIfCancelled(signal) } catch (error) { finish(error as Error) } }
      const error = () => finish(new Error('CDP websocket connection failed'))
      const open = () => finish()
      const timer = setTimeout(() => finish(new Error('CDP websocket connection deadline exceeded')), deadline(this.options.commandTimeoutMs))
      function finish(failure?: Error) {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        socket.off('open', open); socket.off('error', error); socket.off('close', error)
        if (failure) { socket.on('error', () => {}); socket.terminate(); reject(failure) } else resolve()
      }
      socket.once('open', open); socket.once('error', error); socket.once('close', error)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
    this.generation++
    this.contexts.clear(); this.context = undefined; this.frameId = ''; this.loaderId = ''
    this.session = new CdpSession(socket, { timeoutMs: deadline(this.options.commandTimeoutMs) })
    this.session.subscribe(this.lifecycle)
    this.state = 'BOUND'
    this.gate = new CdpMutationGate(this.session, () => this.snapshot(), async (expected, signal, timeoutMs) => (await this.observe('true', expected, signal, timeoutMs)).target)
    await this.session.command('Page.enable', {}, { signal })
    await this.session.command('Runtime.enable', {}, { signal })
    const result = await this.session.command<any>('Page.getFrameTree', {}, { signal })
    const frame = result.frameTree?.frame
    if (!frame || typeof frame.id !== 'string' || typeof frame.url !== 'string' || typeof frame.loaderId !== 'string') throw new Error('CDP top frame unavailable')
    this.frameId = frame.id; this.loaderId = frame.loaderId; this.url = frame.url
    for (const context of this.contexts.values()) this.establish(context)
    await this.session.command('DOM.enable', {}, { signal })
    await this.waitForDocument(deadline(this.options.commandTimeoutMs), signal)
  }
  private async waitForDocument(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const until = Date.now() + timeoutMs
    while (!this.context) {
      this.assertBound()
      if (Date.now() >= until) throw new BrowserStaleError('CDP concrete default execution context unavailable')
      await abortableDelay(25, signal)
    }
  }
  async reconnect(signal?: AbortSignal): Promise<void> {
    this.close()
    try { await this.attach(signal) } catch (error) { this.close(); throw error }
  }
  close(): void { this.state = 'CLOSED'; this.context = undefined; this.session?.close() }
  async observe<T>(expression: string, expected?: BrowserTargetIdentity, signal?: AbortSignal, timeoutMs?: number): Promise<{ value: T; target: BrowserTargetIdentity }> {
    const target = this.snapshot()
    if (expected && !sameBrowserTarget(expected, target)) throw new BrowserTargetChangedError()
    const context = this.context!
    const result = await this.session.command<any>('Runtime.evaluate', {
      expression: `(async () => ({ value: await (${expression}), url: location.href }))()`,
      uniqueContextId: context.uniqueId, returnByValue: true, awaitPromise: true,
    }, { signal, timeoutMs }).catch(error => {
      if (error instanceof CdpCommandError && error.reason === 'provider rejected command') throw new BrowserTargetChangedError()
      throw error
    })
    if (!sameBrowserTarget(target, this.snapshot())) throw new BrowserTargetChangedError()
    if (result.exceptionDetails || result.result?.type !== 'object' || !result.result.value || typeof result.result.value.url !== 'string') throw new BrowserStaleError('CDP evaluation failed')
    this.url = result.result.value.url
    return { value: result.result.value.value as T, target: this.snapshot() }
  }
  async evaluate<T>(expression: string, signal?: AbortSignal): Promise<T> { return (await this.observe<T>(expression, undefined, signal)).value }
  async currentTarget(signal?: AbortSignal): Promise<BrowserTargetIdentity> { return (await this.observe('true', undefined, signal)).target }
  async pageInfo(signal?: AbortSignal): Promise<{ url?: string; title?: string }> { return await this.evaluate('({ url: location.href, title: document.title })', signal) }
  async activateTarget(targetId: string, signal?: AbortSignal): Promise<unknown> {
    if (targetId !== this.options.targetId) throw new BrowserTargetChangedError()
    await this.gate.execute('Page.bringToFront', {}, { expected: this.snapshot(), signal })
    return {}
  }
  async focus(selector: string, context: BrowserMutationContext): Promise<BrowserMutationAck> {
    await this.observe('true', context.expected, context.signal)
    const root = await this.session.command<any>('DOM.getDocument', { depth: 0 }, { signal: context.signal })
    await this.observe('true', context.expected, context.signal)
    const nodes = await this.session.command<any>('DOM.querySelectorAll', { nodeId: root.root?.nodeId, selector }, { signal: context.signal })
    if (!Array.isArray(nodes.nodeIds) || nodes.nodeIds.length !== 1) throw new BrowserStaleError('CDP focus target missing or ambiguous')
    const focused = await this.gate.execute('DOM.focus', { nodeId: nodes.nodeIds[0] }, context)
    try {
      return await this.gate.execute('Runtime.evaluate', { expression: typingFocusExpression(selector), uniqueContextId: this.context!.uniqueId, returnByValue: true }, { expected: focused.target, deadlineMs: context.deadlineMs })
    } catch { this.gate.quarantined = true; throw new BrowserMutationUncertainError() }
  }
  type(text: string, context: BrowserMutationContext): Promise<BrowserMutationAck> { return this.gate.execute('Input.insertText', { text }, context) }
  async press(key: string, modifiers: number | undefined, context: BrowserMutationContext): Promise<BrowserMutationAck> {
    const keys: Record<string, { code: string; windowsVirtualKeyCode: number; text?: string }> = {
      Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
      a: { code: 'KeyA', windowsVirtualKeyCode: 65 },
    }
    if (!keys[key] || !Number.isInteger(modifiers ?? 0) || (modifiers ?? 0) < 0 || (modifiers ?? 0) > 15) throw new Error('Unsupported CDP key')
    const params = { key, ...keys[key], modifiers: modifiers ?? 0 }
    const first = await this.gate.execute('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', ...params }, context)
    // Complete an admitted key gesture even if caller aborts after the first ack;
    // document reconciliation still prevents a key-up in a replacement document.
    try {
      return await this.gate.execute('Input.dispatchKeyEvent', { type: 'keyUp', ...params, text: undefined }, { expected: first.target, deadlineMs: context.deadlineMs })
    } catch { this.gate.quarantined = true; throw new BrowserMutationUncertainError() }
  }
  async click(x: number, y: number, context: BrowserMutationContext): Promise<BrowserMutationAck> {
    if (![x, y].every(Number.isFinite)) throw new Error('Invalid CDP coordinates')
    const first = await this.gate.execute('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, context)
    try {
      return await this.gate.execute('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, { expected: first.target, deadlineMs: context.deadlineMs })
    } catch { this.gate.quarantined = true; throw new BrowserMutationUncertainError() }
  }
  async navigate(url: string, signal?: AbortSignal): Promise<void> {
    this.assertBound(); throwIfCancelled(signal)
    const previousContext = this.context?.uniqueId
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('Unsupported navigation URL')
    let written = false
    try {
      const result = await this.session.command<any>('Page.navigate', { url }, { signal, settleAfterWrite: true, beforeWrite: () => this.assertBound(), onWritten: () => { written = true } })
      if (result.errorText) throw new Error('Navigation failed')
      // Page.navigate can acknowledge before context-destruction events arrive.
      // Do not let waitForLoad inspect the outgoing document in that interval.
      if (result.loaderId && this.context?.uniqueId === previousContext) this.context = undefined
    } catch (error) {
      if (written) { this.state = 'QUARANTINED'; throw new BrowserMutationUncertainError() }
      throw error
    }
  }
  async waitForLoad(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const until = Date.now() + deadline(timeoutMs)
    while (Date.now() < until) {
      try {
        if (this.context && (await this.observe('document.readyState === "complete"', undefined, signal, Math.max(1, Math.min(deadline(this.options.commandTimeoutMs), until - Date.now())))).value) return
      } catch (error) {
        // Explicit load waiting may span document destruction. Ordinary observe
        // and all fenced semantic operations still reject the replaced document.
        if (!(error instanceof BrowserTargetChangedError) || this.bindingState !== 'BOUND') throw error
      }
      this.assertBound()
      await abortableDelay(25, signal)
    }
    throw new BrowserStaleError('CDP page load deadline exceeded')
  }
  async waitForMutation(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    deadline(timeoutMs)
    await this.observe(`new Promise(resolve => { let timer; const observer = new MutationObserver(() => done()); const done = () => { observer.disconnect(); clearTimeout(timer); resolve(true) }; observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true }); timer = setTimeout(done, ${timeoutMs}) })`, undefined, signal, timeoutMs + 500)
  }
}
