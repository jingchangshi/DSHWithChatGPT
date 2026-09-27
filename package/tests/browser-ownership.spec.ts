import { describe, expect, it } from 'vitest'
import { ControlBrowserOwnership } from '../src/browser/ownership.ts'

describe('collaboration browser ownership', () => {
  it('rejects overlapping operations and releases after settlement', async () => {
    const owner = new ControlBrowserOwnership()
    const pending = Promise.withResolvers<string>()
    const first = owner.run(() => pending.promise)
    await expect(owner.run(async () => 'overlap')).rejects.toThrow('CONTROL_BROWSER_BUSY')
    pending.resolve('complete')
    await expect(first).resolves.toBe('complete')
    await expect(owner.run(async () => 'next')).resolves.toBe('next')
  })

  it.each(['error', 'cancelled'])('releases after %s without swallowing the failure', async message => {
    const owner = new ControlBrowserOwnership()
    await expect(owner.run(async () => { throw new Error(message) })).rejects.toThrow(message)
    await expect(owner.run(async () => 'next')).resolves.toBe('next')
  })
})
