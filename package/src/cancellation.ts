import { setTimeout as delay } from 'node:timers/promises'

/** Cancellation of a caller-owned collaboration operation. */
export class OperationCancelledError extends Error {
  constructor() {
    super('D2C_CANCELLED: collaboration operation cancelled')
    this.name = 'OperationCancelledError'
  }
}

/** Reject before starting another asynchronous operation after caller cancellation. */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationCancelledError()
}

/** Wait without retaining a timer after cancellation. */
export async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfCancelled(signal)
  try {
    await delay(milliseconds, undefined, signal === undefined ? {} : { signal })
  } catch (error) {
    if (signal?.aborted) throw new OperationCancelledError()
    throw error
  }
}

/** Race an operation against the caller signal without leaking an abort listener. */
export async function withCancellation<T>(operation: Promise<T> | (() => Promise<T>), signal?: AbortSignal): Promise<T> {
  throwIfCancelled(signal)
  if (signal === undefined) return typeof operation === 'function' ? operation() : operation
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => queueMicrotask(() => reject(new OperationCancelledError()))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const pending = typeof operation === 'function' ? operation() : operation
    return await Promise.race([pending, cancelled])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}
