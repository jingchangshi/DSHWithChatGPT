import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeliveryJournal } from '../src/sidecar/journal.ts'

const paths: string[] = []
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-observation-journal-'))
  paths.push(directory)
  const config = { directory, maxEntries: 8, maxBytes: 32_768, maxAgeMs: 60_000 }
  return { config, journal: await DeliveryJournal.open(config) }
}
const baseline = () => ({ version: 1, conversationId: 'owned', assistantCount: 1, textDigest: 'b'.repeat(64), observationEpoch: 'c'.repeat(64) })
const observation = () => ({ controlDigest: 'd'.repeat(64), replyBaseline: baseline() })
const intent = () => ({ operationId: 'send-owned', payloadDigest: 'a'.repeat(64), method: 'sendControlMessage', createdAt: Date.now(), observation: observation() })

describe('journal-bound observation facts', () => {
  it('retains immutable send observation across close/reopen without bodies', async () => {
    const f = await fixture(), original = intent()
    await f.journal.prepare(original)
    await f.journal.transition(original.operationId, 'sending')
    await f.journal.close()
    const restarted = await DeliveryJournal.open(f.config)
    expect(restarted.lookup(original.operationId)).toMatchObject({ phase: 'uncertain', observation: original.observation })
    await restarted.close()
    expect(await readFile(join(f.config.directory, 'delivery.json'), 'utf8')).not.toContain('private body')
  })
  it('rejects observation mutation even when caller reuses the payload digest', async () => {
    const f = await fixture(), original = intent()
    try {
      await f.journal.prepare(original)
      await expect(f.journal.prepare({ ...original, observation: { ...observation(), controlDigest: 'e'.repeat(64) } })).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
      expect(f.journal.lookup(original.operationId)).toMatchObject({ observation: original.observation })
    } finally { await f.journal.close() }
  })
  it.each([
    { ...observation(), text: 'private body' },
    { ...observation(), controlDigest: 'bad' },
    { ...observation(), replyBaseline: { ...baseline(), conversationId: null } },
    { ...observation(), replyBaseline: { ...baseline(), text: 'private body' } },
  ])('refuses invalid or body-bearing observation metadata', async value => {
    const f = await fixture()
    try { await expect(f.journal.prepare({ ...intent(), observation: value })).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' }) }
    finally { await f.journal.close() }
  })
  it('does not invent observation metadata for released v1 records', async () => {
    const f = await fixture(), { observation: _unused, ...legacy } = intent()
    await f.journal.prepare(legacy); await f.journal.close()
    const restarted = await DeliveryJournal.open(f.config)
    expect(restarted.lookup(legacy.operationId)).not.toHaveProperty('observation')
    await restarted.close()
  })
  it.each([
    { ...intent(), method: 'ensureReady' },
    { ...intent(), method: 'waitForReply' },
    { ...intent(), observation: { ...observation(), sendOperationId: 'foreign' } },
  ])('refuses observation metadata on an incompatible journal method', async invalid => {
    const f = await fixture()
    try { await expect(f.journal.prepare(invalid)).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' }) }
    finally { await f.journal.close() }
  })
  it('resumes only a bound uncertain observation, never an uncertain send', async () => {
    const f = await fixture(), send = intent(), wait = { ...intent(), operationId: 'wait-owned', method: 'waitForReply', observation: { ...observation(), sendOperationId: 'send-owned' } }
    await f.journal.prepare(send); await f.journal.prepare(wait)
    await f.journal.transition(send.operationId, 'sending'); await f.journal.transition(wait.operationId, 'awaiting-reply')
    await f.journal.close()
    const restarted = await DeliveryJournal.open(f.config)
    try {
      await expect(restarted.resumeObservation(send.operationId)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
      expect(await restarted.resumeObservation(wait.operationId)).toMatchObject({ phase: 'awaiting-reply', payloadDigest: wait.payloadDigest, observation: wait.observation })
    } finally { await restarted.close() }
  })
  it('atomically persists a completed wait digest and rejects changed outcome on replay', async () => {
    const f = await fixture(), wait = { ...intent(), operationId: 'wait-owned', method: 'waitForReply', observation: { ...observation(), sendOperationId: 'send-owned' } }
    await f.journal.prepare(wait)
    await f.journal.transition(wait.operationId, 'awaiting-reply')
    await f.journal.completeReply(wait.operationId, 'f'.repeat(64))
    await f.journal.close()
    const restarted = await DeliveryJournal.open(f.config)
    try {
      expect(restarted.lookup(wait.operationId)).toMatchObject({ phase: 'accepted', replyDigest: 'f'.repeat(64) })
      await expect(restarted.completeReply(wait.operationId, 'e'.repeat(64))).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    } finally { await restarted.close() }
  })
  it('cannot bypass atomic outcome persistence through an ordinary phase transition', async () => {
    const f = await fixture(), wait = { ...intent(), operationId: 'wait-owned', method: 'waitForReply', observation: { ...observation(), sendOperationId: 'send-owned' } }
    try {
      await f.journal.prepare(wait); await f.journal.transition(wait.operationId, 'awaiting-reply')
      await expect(f.journal.transition(wait.operationId, 'accepted')).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' })
      expect(f.journal.lookup(wait.operationId)?.phase).toBe('awaiting-reply')
    } finally { await f.journal.close() }
  })
  it('rejects a corrupt accepted observation without a reply digest without overwriting it', async () => {
    const f = await fixture(), wait = { ...intent(), operationId: 'wait-owned', method: 'waitForReply', observation: { ...observation(), sendOperationId: 'send-owned' } }
    await f.journal.prepare(wait); await f.journal.close()
    const path = join(f.config.directory, 'delivery.json'), store = JSON.parse(await readFile(path, 'utf8'))
    store.entries[0].phase = 'accepted'
    const corrupted = JSON.stringify(store)
    await writeFile(path, corrupted)
    await expect(DeliveryJournal.open(f.config).then(async journal => { await journal.close(); return journal })).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' })
    expect(await readFile(path, 'utf8')).toBe(corrupted)
  })
})
