import { withCancellation } from '../cancellation.ts'
import type { BrowserTargetIdentity } from './epoch.ts'
import type { BrowserTransition } from './transitions.ts'

export interface BrowserMutationContext {
  expected: BrowserTargetIdentity
  signal?: AbortSignal
  /** Absolute lifetime of a bounded finalizer; never extends after dispatch. */
  deadlineMs?: number
}
export interface BrowserMutationAck { target: BrowserTargetIdentity; transitions: BrowserTransition[] }

/** Browser mechanics only. Evaluation is an internal boundary, never a public RPC. */
export interface BrowserPrimitives {
  /** A transport may own cancellation linearization itself. Avoid racing its
   * already-terminal successful input acknowledgement against the same abort twice. */
  readonly settlesOnCancellation?: true
  /** Evaluate only in the expected document; fail before evaluation after navigation. */
  observe<T>(expression: string, expected?: BrowserTargetIdentity, signal?: AbortSignal): Promise<{ value: T; target: BrowserTargetIdentity; transitions: BrowserTransition[] }>
  pageInfo(signal?: AbortSignal): Promise<{ url?: string; title?: string }>
  currentTarget(signal?: AbortSignal): Promise<BrowserTargetIdentity>
  activateTarget(targetId: string, signal?: AbortSignal): Promise<unknown>
  evaluate<T>(expression: string, signal?: AbortSignal): Promise<T>
  /** Focus one element and place the typing caret after its existing content. */
  focus(selector: string, context: BrowserMutationContext): Promise<BrowserMutationAck>
  type(text: string, context: BrowserMutationContext): Promise<BrowserMutationAck>
  press(key: string, modifiers: number | undefined, context: BrowserMutationContext): Promise<BrowserMutationAck>
  click(x: number, y: number, context: BrowserMutationContext): Promise<BrowserMutationAck>
  navigate(url: string, signal?: AbortSignal): Promise<void>
  /** Optional atomic same-route reload. Reject intervening routes and bind the
   * replacement document to the acknowledged navigation, never replay input. */
  reloadCurrent?(expected: BrowserTargetIdentity, signal?: AbortSignal): Promise<BrowserTargetIdentity>
  waitForLoad(timeoutMs: number, signal?: AbortSignal): Promise<void>
  waitForMutation(timeoutMs: number, signal?: AbortSignal): Promise<void>
}

/** Never let a provider that ignores cancellation retain ownership of a caller. */
export class CancellableBrowserPrimitives implements BrowserPrimitives {
  constructor(private readonly delegate: BrowserPrimitives) {}
  private run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.delegate.settlesOnCancellation ? operation() : withCancellation(operation, signal)
  }
  observe<T>(expression: string, expected?: BrowserTargetIdentity, signal?: AbortSignal) { return this.run(() => this.delegate.observe<T>(expression, expected, signal), signal) }
  pageInfo(signal?: AbortSignal) { return this.run(() => this.delegate.pageInfo(signal), signal) }
  currentTarget(signal?: AbortSignal) { return this.run(() => this.delegate.currentTarget(signal), signal) }
  activateTarget(targetId: string, signal?: AbortSignal) { return this.run(() => this.delegate.activateTarget(targetId, signal), signal) }
  evaluate<T>(expression: string, signal?: AbortSignal): Promise<T> { return this.run(() => this.delegate.evaluate<T>(expression, signal), signal) }
  focus(selector: string, context: BrowserMutationContext) { return this.run(() => this.delegate.focus(selector, context), context.signal) }
  type(text: string, context: BrowserMutationContext) { return this.run(() => this.delegate.type(text, context), context.signal) }
  press(key: string, modifiers: number | undefined, context: BrowserMutationContext) { return this.run(() => this.delegate.press(key, modifiers, context), context.signal) }
  click(x: number, y: number, context: BrowserMutationContext) { return this.run(() => this.delegate.click(x, y, context), context.signal) }
  navigate(url: string, signal?: AbortSignal) { return this.run(() => this.delegate.navigate(url, signal), signal) }
  reloadCurrent(expected: BrowserTargetIdentity, signal?: AbortSignal) {
    if (!this.delegate.reloadCurrent) return Promise.reject(new Error('Same-route reload unavailable'))
    return this.run(() => this.delegate.reloadCurrent!(expected, signal), signal)
  }
  waitForLoad(timeoutMs: number, signal?: AbortSignal) { return this.run(() => this.delegate.waitForLoad(timeoutMs, signal), signal) }
  waitForMutation(timeoutMs: number, signal?: AbortSignal) { return this.run(() => this.delegate.waitForMutation(timeoutMs, signal), signal) }
}
