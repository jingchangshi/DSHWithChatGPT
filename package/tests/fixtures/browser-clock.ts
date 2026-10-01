import { vi } from 'vitest'

vi.mock('node:timers/promises', () => ({
  setTimeout: (milliseconds: number, value: unknown, options: { signal?: AbortSignal } = {}) => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(new Error('aborted')) }
    const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve(value) }, milliseconds)
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
  }),
}))
