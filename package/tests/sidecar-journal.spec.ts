import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const absolute = resolve(directory)
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('plannerbridge-journal-test-')) throw new Error('Unexpected journal cleanup target')
    await rm(absolute, { recursive: true, force: true })
  }
})
async function directory() { const path = await mkdtemp(join(tmpdir(), 'plannerbridge-journal-test-')); directories.push(path); return path }
const intent = () => ({ operationId: randomUUID(), payloadDigest: 'a'.repeat(64), method: 'sendControlMessage', createdAt: Date.now() })
describe('durable delivery dispositions', () => {
  it('rejects a concurrent store owner and protects snapshots from caller mutation', async () => {
    const { DeliveryJournal } = await import('../src/sidecar/journal.ts')
    const path = await directory()
    const config = { directory: path, maxEntries: 4, maxBytes: 16_384, maxAgeMs: 60_000 }
    const journal = await DeliveryJournal.open(config)
    await expect(DeliveryJournal.open(config)).rejects.toMatchObject({ code: 'SIDECAR_BUSY' })
    const original = intent()
    await journal.prepare(original)
    const snapshot = journal.lookup(original.operationId)!
    snapshot.payloadDigest = 'b'.repeat(64)
    expect(journal.lookup(original.operationId)?.payloadDigest).toBe(original.payloadDigest)
    await expect(journal.transition(original.operationId, 'accepted')).rejects.toThrow()
    expect(journal.lookup(original.operationId)?.phase).toBe('prepared')
    await journal.close()
  })
  it('bounds terminal retention without letting an expired operation send again', async () => {
    const { DeliveryJournal } = await import('../src/sidecar/journal.ts')
    let now = Date.now()
    const path = await directory()
    const config = { directory: path, maxEntries: 1, maxBytes: 16_384, maxAgeMs: 100, now: () => now }
    const journal = await DeliveryJournal.open(config)
    const completed = intent()
    await journal.prepare(completed)
    await journal.transition(completed.operationId, 'sending')
    await journal.transition(completed.operationId, 'observed-sent')
    await journal.transition(completed.operationId, 'accepted')
    now += 101
    const fresh = { ...intent(), createdAt: now }
    await journal.prepare(fresh)
    expect(journal.lookup(completed.operationId)).toBeUndefined()
    await expect(journal.prepare({ ...completed, createdAt: now })).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    await journal.close()
    const restarted = await DeliveryJournal.open(config)
    await expect(restarted.prepare({ ...completed, createdAt: now })).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(restarted.lookup(fresh.operationId)?.phase).toBe('prepared')
    await restarted.close()
  })
  it('retains prepared intent but marks an interrupted send uncertain on reopen', async () => {
    const { DeliveryJournal } = await import('../src/sidecar/journal.ts')
    const path = await directory()
    const first = await DeliveryJournal.open({ directory: path, maxEntries: 4, maxBytes: 16_384, maxAgeMs: 60_000 })
    const prepared = intent(); const sending = intent()
    await first.prepare(prepared); await first.prepare(sending)
    await first.transition(sending.operationId, 'sending')
    await first.close()
    const restarted = await DeliveryJournal.open({ directory: path, maxEntries: 4, maxBytes: 16_384, maxAgeMs: 60_000 })
    expect(restarted.lookup(prepared.operationId)).toMatchObject({ phase: 'prepared' })
    expect(restarted.lookup(sending.operationId)).toMatchObject({ phase: 'uncertain' })
    await restarted.close()
  })
  it('rejects digest conflicts and full unresolved capacity without eviction', async () => {
    const { DeliveryJournal } = await import('../src/sidecar/journal.ts')
    const journal = await DeliveryJournal.open({ directory: await directory(), maxEntries: 1, maxBytes: 16_384, maxAgeMs: 60_000 })
    const original = intent()
    await journal.prepare(original)
    await journal.transition(original.operationId, 'sending')
    await expect(journal.prepare({ ...original, payloadDigest: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    await expect(journal.prepare(intent())).rejects.toMatchObject({ code: 'JOURNAL_CAPACITY' })
    expect(journal.lookup(original.operationId)).toMatchObject({ payloadDigest: original.payloadDigest, phase: 'sending' })
    await journal.close()
  })
  it('stores minimal metadata and rejects message bodies or credentials', async () => {
    const { DeliveryJournal } = await import('../src/sidecar/journal.ts')
    const path = await directory()
    const journal = await DeliveryJournal.open({ directory: path, maxEntries: 4, maxBytes: 16_384, maxAgeMs: 60_000 })
    await expect(journal.prepare({ ...intent(), text: 'private-source-body', authentication: 'private-auth-value' })).rejects.toThrow()
    await journal.prepare(intent())
    await journal.close()
    for (const file of await readdir(path)) {
      const content = await readFile(join(path, file), 'utf8')
      expect(content).not.toContain('private-source-body')
      expect(content).not.toContain('private-auth-value')
    }
  })
})
