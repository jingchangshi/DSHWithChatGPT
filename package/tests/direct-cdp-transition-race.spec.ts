import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { CdpSession, CdpMutationGate } from '../src/browser/cdp-session.ts'
import { BrowserTransitionBuffer } from '../src/browser/transitions.ts'

class TransitionWire extends EventEmitter {
  readyState = 1
  sent: Array<{ id: number; method: string }> = []
  afterWrite?: () => void
  send(data: string, callback: (error?: Error) => void) { this.sent.push(JSON.parse(data)); callback(); this.afterWrite?.() }
  ack() { this.emit('message', JSON.stringify({ id: this.sent.at(-1)!.id, result: {} }), false) }
  terminate() { this.readyState = 3; this.emit('close') }
}

function setup(maxEvents = 1024) {
  const history = new BrowserTransitionBuffer({ maxEvents })
  const wire = new TransitionWire()
  const session = new CdpSession(wire, { timeoutMs: 30 })
  let url = 'https://example.test/A'
  const target = () => ({ targetId: 'owned', documentId: 'document', epoch: 1, url, transitionSequence: history.sequence })
  const fence = target()
  const gate = new CdpMutationGate(session, target, async expected => { history.since(expected.transitionSequence); return target() })
  const detour = () => { history.append(url, 'https://example.test/B'); url = 'https://example.test/B'; history.append(url, fence.url); url = fence.url }
  return { history, wire, session, fence, gate, detour }
}

it('rejects an unobserved detour before Input write even when the final URL matches', async () => {
  const f = setup()
  try {
    f.detour()
    await expect(f.gate.execute('Input.insertText', {}, { expected: f.fence })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
    expect(f.wire.sent).toEqual([])
  } finally { f.session.close() }
})

it('retains both post-write transitions for upper-layer admission after a trustworthy ACK', async () => {
  const f = setup()
  try {
    f.wire.afterWrite = () => { f.detour(); f.wire.ack() }
    const ack = await f.gate.execute('Input.dispatchKeyEvent', { key: 'Enter' }, { expected: f.fence })
    expect(ack.target).toMatchObject({ url: f.fence.url, transitionSequence: 2 })
    expect(f.history.since(f.fence.transitionSequence).map(event => event.afterUrl)).toEqual(['https://example.test/B', f.fence.url])
    expect(f.gate.quarantined).toBe(false)
    expect(f.wire.sent).toHaveLength(1)
  } finally { f.session.close() }
})

it.each(['lost-ack', 'overflow'] as const)('quarantines %s during a history-changing Input without replay', async fault => {
  const f = setup(fault === 'overflow' ? 1 : 1024)
  try {
    f.wire.afterWrite = () => { f.detour(); if (fault === 'overflow') f.wire.ack() }
    await expect(f.gate.execute('Input.dispatchKeyEvent', { key: 'Enter' }, { expected: f.fence })).rejects.toMatchObject({ name: 'BrowserMutationUncertainError' })
    expect(f.gate.quarantined).toBe(true)
    await expect(f.gate.execute('Input.dispatchKeyEvent', { key: 'Enter' }, { expected: f.fence })).rejects.toMatchObject({ name: 'BrowserTargetChangedError' })
    expect(f.wire.sent).toHaveLength(1)
    f.wire.ack()
    expect(f.gate.quarantined).toBe(true)
  } finally { f.session.close() }
})
