import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'

class Wire extends EventEmitter {
  readyState = 1
  sent: Array<{ id: number; method: string; params: unknown }> = []
  afterWrite?: () => void
  send(data: string, callback: (error?: Error) => void) {
    this.sent.push(JSON.parse(data))
    callback()
    this.afterWrite?.()
  }
  ack(index = 0) { this.emit('message', JSON.stringify({ id: this.sent[index]!.id, result: {} }), false) }
  terminate() { this.readyState = 3; this.emit('close') }
}

async function setup(timeoutMs = 100) {
  const { CdpSession, CdpMutationGate } = await import('../src/browser/cdp-session.ts')
  const { BrowserTargetChangedError } = await import('../src/browser/epoch.ts')
  const wire = new Wire()
  const session = new CdpSession(wire, { timeoutMs })
  const fence = { targetId: 'owned', documentId: 'document-A', epoch: 1, url: 'https://example.test/' }
  let current = { ...fence }
  const gate = new CdpMutationGate(session, () => current, async expected => {
    if (expected.documentId !== current.documentId || expected.epoch !== current.epoch) throw new BrowserTargetChangedError()
    return { ...current }
  })
  return { wire, session, fence, gate, route: () => { current = { ...current, url: 'https://example.test/foreign' } }, replace: () => { current = { ...current, documentId: 'document-B', epoch: 2 } } }
}

it('rejects an old document before writing any Input bytes', async () => {
  const f = await setup()
  try {
    f.replace()
    await expect(f.gate.execute('Input.insertText', { text: 'private draft' }, { expected: f.fence })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
    expect(f.wire.sent).toEqual([])
  } finally { f.session.close() }
})

it('rejects an unobserved route change before dispatch without assigning application meaning', async () => {
  const f = await setup()
  try {
    f.route()
    await expect(f.gate.execute('Input.insertText', { text: 'private draft' }, { expected: f.fence })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
    expect(f.wire.sent).toEqual([])
  } finally { f.session.close() }
})

it.each(['oversized', 'null-result', 'array-result', 'invalid-error'] as const)('rejects %s responses and releases the pending map', async fault => {
  const { CdpSession } = await import('../src/browser/cdp-session.ts')
  const wire = new Wire()
  const session = new CdpSession(wire, { timeoutMs: 100, maxMessageBytes: 128 })
  try {
    const pending = session.command('Input.insertText', { text: 'draft' }).catch(error => error)
    const id = wire.sent[0]!.id
    const message = fault === 'oversized' ? 'x'.repeat(129) : JSON.stringify(fault === 'invalid-error' ? { id, error: null } : { id, result: fault === 'array-result' ? [] : null })
    wire.emit('message', message, false)
    expect(await pending).toMatchObject({ name: 'CdpCommandError', written: true })
    expect(session.pendingCount).toBe(0)
  } finally { session.close() }
})

it.each(['replacement', 'disconnect', 'timeout'] as const)('quarantines a post-write %s without retry or subsequent Enter', async failure => {
  const f = await setup(30)
  try {
    f.wire.afterWrite = () => {
      if (failure === 'replacement') { f.replace(); f.wire.ack() }
      if (failure === 'disconnect') f.wire.terminate()
    }
    await expect(f.gate.execute('Input.insertText', { text: 'private draft' }, { expected: f.fence })).rejects.toMatchObject({ name: 'BrowserMutationUncertainError' })
    expect(f.gate.quarantined).toBe(true)
    await expect(f.gate.execute('Input.dispatchKeyEvent', { key: 'Enter' }, { expected: f.fence })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
    expect(f.wire.sent.map(command => command.method)).toEqual(['Input.insertText'])
    // A late acknowledgement cannot authorize input or undo quarantine.
    f.wire.ack()
    expect(f.gate.quarantined).toBe(true)
    expect(f.wire.sent).toHaveLength(1)
  } finally { f.session.close() }
})

it('proves zero dispatch when cancellation precedes write', async () => {
  const f = await setup()
  const controller = new AbortController()
  controller.abort()
  try {
    await expect(f.gate.execute('Input.dispatchKeyEvent', { key: 'Enter' }, { expected: f.fence, signal: controller.signal })).rejects.toMatchObject({ name: 'OperationCancelledError' })
    expect(f.wire.sent).toEqual([])
  } finally { f.session.close() }
})

it('rejects an expired cleanup lifetime before dispatch', async () => {
  const f = await setup()
  try {
    await expect(f.gate.execute('Input.dispatchKeyEvent', { key: 'Backspace' }, { expected: f.fence, deadlineMs: Date.now() - 1 })).rejects.toMatchObject({ name: 'OperationCancelledError' })
    expect(f.wire.sent).toEqual([])
  } finally { f.session.close() }
})

it('bounds post-write uncertainty by the original cleanup deadline, without granting a fresh lifetime', async () => {
  const f = await setup(5000)
  const started = Date.now()
  try {
    await expect(f.gate.execute('Input.dispatchKeyEvent', { key: 'a' }, { expected: f.fence, deadlineMs: started + 40 })).rejects.toMatchObject({ name: 'BrowserMutationUncertainError' })
    expect(Date.now() - started).toBeLessThan(500)
    expect(f.gate.quarantined).toBe(true)
    expect(f.wire.sent).toHaveLength(1)
  } finally { f.session.close() }
})

it('retains acknowledged success when cancellation follows dispatch', async () => {
  const f = await setup()
  const controller = new AbortController()
  try {
    f.wire.afterWrite = () => { controller.abort(); f.wire.ack() }
    await expect(f.gate.execute('Input.dispatchKeyEvent', { key: 'Enter' }, { expected: f.fence, signal: controller.signal })).resolves.toEqual({ target: f.fence })
    expect(f.wire.sent).toHaveLength(1)
    expect(f.gate.quarantined).toBe(false)
  } finally { f.session.close() }
})

it('bounds pending commands and rejects malformed provider data without retaining private contents', async () => {
  const { CdpSession } = await import('../src/browser/cdp-session.ts')
  const wire = new Wire()
  const session = new CdpSession(wire, { timeoutMs: 100, maxPending: 1, maxMessageBytes: 128 })
  try {
    const first = session.command('Runtime.evaluate').catch(error => error)
    await expect(session.command('Runtime.evaluate')).rejects.toMatchObject({ name: 'CdpCommandError' })
    wire.emit('message', '{private malformed data', false)
    const error = await first
    expect(error).toMatchObject({ name: 'CdpCommandError' })
    expect(error.message).not.toContain('private')
    expect(session.pendingCount).toBe(0)
  } finally { session.close() }
})
