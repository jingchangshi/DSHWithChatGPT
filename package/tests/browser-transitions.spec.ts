import { expect, it } from 'vitest'

it('retains ordered detours even when the final URL returns', async () => {
  const { BrowserTransitionBuffer } = await import('../src/browser/transitions.ts')
  const buffer = new BrowserTransitionBuffer({ now: () => 0 })
  buffer.append('https://example.test/A', 'https://example.test/B')
  buffer.append('https://example.test/B', 'https://example.test/A')
  expect(buffer.since(0)).toEqual([
    { sequence: 1, beforeUrl: 'https://example.test/A', afterUrl: 'https://example.test/B' },
    { sequence: 2, beforeUrl: 'https://example.test/B', afterUrl: 'https://example.test/A' },
  ])
  expect(buffer.sequence).toBe(2)
})

it.each(['events', 'bytes', 'age'] as const)('fails closed for history lost to the %s bound', async bound => {
  const { BrowserTransitionBuffer } = await import('../src/browser/transitions.ts')
  let time = 0
  const buffer = new BrowserTransitionBuffer({ maxEvents: bound === 'events' ? 1 : 8, maxBytes: bound === 'bytes' ? 128 : 4096, maxAgeMs: 10, now: () => time })
  buffer.append('https://example.test/A', 'https://example.test/B')
  if (bound === 'events') buffer.append('https://example.test/B', 'https://example.test/A')
  if (bound === 'bytes') buffer.append('https://example.test/B', 'https://example.test/' + 'x'.repeat(128))
  if (bound === 'age') time = 11
  expect(() => buffer.since(0)).toThrow(expect.objectContaining({ name: 'BrowserTransitionHistoryUnavailableError' }))
})

it('returns isolated records so callers cannot rewrite provenance', async () => {
  const { BrowserTransitionBuffer } = await import('../src/browser/transitions.ts')
  const buffer = new BrowserTransitionBuffer()
  buffer.append('A', 'B')
  buffer.since(0)[0]!.afterUrl = 'forged'
  expect(buffer.since(0)[0]!.afterUrl).toBe('B')
})

it.each([-1, 0.5, NaN, Infinity, 2])('rejects invalid or future cursors %s', async cursor => {
  const { BrowserTransitionBuffer } = await import('../src/browser/transitions.ts')
  const buffer = new BrowserTransitionBuffer()
  buffer.append('A', 'B')
  expect(() => buffer.since(cursor)).toThrow(expect.objectContaining({ name: 'BrowserTransitionHistoryUnavailableError' }))
})

it('retains identical-URL history operations as provenance events', async () => {
  const { BrowserTransitionBuffer } = await import('../src/browser/transitions.ts')
  const buffer = new BrowserTransitionBuffer()
  buffer.append('A', 'A')
  expect(buffer.since(0)).toEqual([{ sequence: 1, beforeUrl: 'A', afterUrl: 'A' }])
})

it('fails closed on a clock rollback rather than extending retained history lifetime', async () => {
  const { BrowserTransitionBuffer } = await import('../src/browser/transitions.ts')
  let time = 10
  const buffer = new BrowserTransitionBuffer({ now: () => time })
  buffer.append('A', 'B')
  time = 9
  expect(() => buffer.since(0)).toThrow(expect.objectContaining({ name: 'BrowserTransitionHistoryUnavailableError' }))
})
