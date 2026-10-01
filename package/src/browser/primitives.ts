import { withCancellation } from '../cancellation.ts'
import type { BrowserTargetIdentity } from './epoch.ts'

/** Browser mechanics only. Evaluation is an internal boundary, never a public RPC. */
export interface BrowserPrimitives {
  /** A transport may own cancellation linearization itself. Avoid racing its
   * already-terminal successful input acknowledgement against the same abort twice. */
  readonly settlesOnCancellation?: true
  /** Evaluate only in the expected document; fail before evaluation after navigation. */
  observe<T>(expression: string, expected?: BrowserTargetIdentity, signal?: AbortSignal): Promise<{ value: T; target: BrowserTargetIdentity }>
  pageInfo(signal?: AbortSignal): Promise<{ url?: string; title?: string }>
  currentTarget(signal?: AbortSignal): Promise<BrowserTargetIdentity>
  activateTarget(targetId: string, signal?: AbortSignal): Promise<unknown>
  evaluate<T>(expression: string, signal?: AbortSignal): Promise<T>
  type(text: string, signal?: AbortSignal): Promise<void>
  press(key: string, modifiers?: number, signal?: AbortSignal): Promise<void>
  click(x: number, y: number, signal?: AbortSignal): Promise<void>
  navigate(url: string, signal?: AbortSignal): Promise<void>
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
  type(text: string, signal?: AbortSignal) { return this.run(() => this.delegate.type(text, signal), signal) }
  press(key: string, modifiers?: number, signal?: AbortSignal) { return this.run(() => this.delegate.press(key, modifiers, signal), signal) }
  click(x: number, y: number, signal?: AbortSignal) { return this.run(() => this.delegate.click(x, y, signal), signal) }
  navigate(url: string, signal?: AbortSignal) { return this.run(() => this.delegate.navigate(url, signal), signal) }
  waitForLoad(timeoutMs: number, signal?: AbortSignal) { return this.run(() => this.delegate.waitForLoad(timeoutMs, signal), signal) }
  waitForMutation(timeoutMs: number, signal?: AbortSignal) { return this.run(() => this.delegate.waitForMutation(timeoutMs, signal), signal) }
}
