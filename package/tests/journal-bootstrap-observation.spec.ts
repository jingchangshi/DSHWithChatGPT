import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { DeliveryJournal } from '../src/sidecar/journal.ts'

const paths: string[] = [], journals: DeliveryJournal[] = []
afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close()
  for (const path of paths.splice(0)) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep) || !basename(path).startsWith('plannerbridge-bootstrap-journal-')) throw new Error('Unexpected fixture cleanup target')
    await rm(path, { recursive: true, force: true })
  }
})
const original = { version: 1 as const, conversationId: null, assistantCount: 0, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) }
const bound = { ...original, conversationId: 'owned', observationEpoch: 'c'.repeat(64) }
const bootstrap = { controlDigest: 'd'.repeat(64), replyBaseline: original }
const intent = () => ({ operationId: 'bootstrap-send', payloadDigest: 'e'.repeat(64), method: 'sendControlMessage', createdAt: Date.now(), bootstrap })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-bootstrap-journal-')); paths.push(directory)
  const config = { directory, maxEntries: 8, maxBytes: 32768, maxAgeMs: 60000 }
  const journal = await DeliveryJournal.open(config); journals.push(journal)
  return { journal, config, directory }
}
async function accepted() {
  const f = await fixture(), source = intent()
  await f.journal.prepare(source)
  for (const phase of ['sending', 'observed-sent', 'accepted'] as const) await f.journal.transition(source.operationId, phase)
  return { ...f, source }
}
describe('body-free initial and bound bootstrap journal metadata', () => {
  it('publishes independently reconciled uncertainty and binding atomically across reopen', async () => {
    const f = await fixture()
    const source = { ...intent(), bootstrap: { ...bootstrap, binding: { taskId: 'pb_' + 'a'.repeat(32), iteration: 0, workspaceId: 'world' } } }
    await f.journal.prepare(source)
    await f.journal.transition(source.operationId, 'sending')
    await f.journal.transition(source.operationId, 'uncertain')
    const originalIntent = f.journal.lookup(source.operationId)!
    const reconciled = await f.journal.reconcileBootstrap(source.operationId, bound)
    expect(reconciled).toMatchObject({ phase: 'accepted', bootstrapBaseline: bound, bootstrap: originalIntent.bootstrap, payloadDigest: originalIntent.payloadDigest })
    await f.journal.close()
    const reopened = await DeliveryJournal.open(f.config); journals.push(reopened)
    expect(reopened.lookup(source.operationId)).toEqual(reconciled)
    await expect(reopened.reconcileBootstrap(source.operationId, { ...bound, textDigest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(reopened.lookup(source.operationId)).toEqual(reconciled)
  })
  it.each(['prepared', 'sending', 'unbound', 'count', 'text', 'wrong-task'] as const)('refuses uncertainty reconciliation with %s without rewriting disk', async scenario => {
    const f = await fixture()
    const source = { ...intent(), bootstrap: { ...bootstrap,
      ...(scenario === 'unbound' ? {} : { binding: { taskId: scenario === 'wrong-task' ? 'legacy' : 'pb_' + 'a'.repeat(32), iteration: 0, workspaceId: 'world' } }) } }
    await f.journal.prepare(source)
    if (scenario !== 'prepared') await f.journal.transition(source.operationId, 'sending')
    if (!['prepared', 'sending'].includes(scenario)) await f.journal.transition(source.operationId, 'uncertain')
    const file = join(f.directory, 'delivery.json'), before = await readFile(file, 'utf8')
    await expect(f.journal.reconcileBootstrap(source.operationId, { ...bound,
      ...(scenario === 'count' ? { assistantCount: 1 } : {}), ...(scenario === 'text' ? { textDigest: 'f'.repeat(64) } : {}) })).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(await readFile(file, 'utf8')).toBe(before)
  })
  it('publishes a bound result separately and preserves original intent/replay identity across reopen', async () => {
    const f = await accepted()
    const first = await f.journal.bindBootstrap(f.source.operationId, bound)
    expect(first.bootstrap).toEqual(bootstrap)
    expect(first.bootstrapBaseline).toEqual(bound)
    expect(await f.journal.prepare(f.source)).toEqual(first)
    expect(await f.journal.bindBootstrap(f.source.operationId, bound)).toEqual(first)
    await f.journal.close()
    const next = await DeliveryJournal.open(f.config); journals.push(next)
    expect(next.lookup(f.source.operationId)).toEqual(first)
  })
  it.each(['controlDigest', 'replyBaseline'])('refuses changed initial %s under a reused payload digest', async field => {
    const f = await accepted()
    const changed: any = structuredClone(f.source)
    changed.bootstrap[field] = field === 'controlDigest' ? 'f'.repeat(64) : { ...original, observationEpoch: 'f'.repeat(64) }
    await expect(f.journal.prepare(changed)).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(f.journal.lookup(f.source.operationId)?.bootstrap).toEqual(bootstrap)
  })
  it('refuses changed bound metadata after the first binding', async () => {
    const f = await accepted()
    await f.journal.bindBootstrap(f.source.operationId, bound)
    await expect(f.journal.bindBootstrap(f.source.operationId, { ...bound, observationEpoch: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' })
    expect(f.journal.lookup(f.source.operationId)?.bootstrapBaseline).toEqual(bound)
  })
  it.each(['prepared', 'sending', 'uncertain'])('does not bind a %s source', async phase => {
    const f = await fixture(), source = intent()
    await f.journal.prepare(source)
    if (phase !== 'prepared') await f.journal.transition(source.operationId, 'sending')
    if (phase === 'uncertain') await f.journal.transition(source.operationId, 'uncertain')
    await expect(f.journal.bindBootstrap(source.operationId, bound)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.journal.lookup(source.operationId)?.bootstrapBaseline).toBeUndefined()
  })
  it.each([
    { ...bound, conversationId: null }, { ...bound, assistantCount: 1 }, { ...bound, textDigest: 'f'.repeat(64) },
    { ...bound, rawBody: 'private body' },
  ])('refuses invalid derived metadata %j before publication', async value => {
    const f = await accepted()
    await expect(f.journal.bindBootstrap(f.source.operationId, value)).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
    expect(f.journal.lookup(f.source.operationId)?.bootstrapBaseline).toBeUndefined()
  })
  it.each([
    { method: 'waitForReply', bootstrap },
    { bootstrapBaseline: bound },
    { bootstrap: { ...bootstrap, text: 'private body' } },
    { observation: { controlDigest: 'd'.repeat(64), replyBaseline: bound } },
  ])('refuses forged or misplaced bootstrap intent %j', async changes => {
    const f = await fixture()
    await expect(f.journal.prepare({ ...intent(), ...changes })).rejects.toMatchObject({ code: 'SIDECAR_INVALID_REQUEST' })
    expect(f.journal.lookup('bootstrap-send')).toBeUndefined()
  })
  it('refuses corrupt bound metadata on reopen without overwriting the original corrupt bytes', async () => {
    const f = await accepted()
    await f.journal.bindBootstrap(f.source.operationId, bound)
    await f.journal.close()
    const file = join(f.directory, 'delivery.json'), value = JSON.parse(await readFile(file, 'utf8'))
    value.entries[0].bootstrapBaseline.assistantCount = 1
    const corrupt = JSON.stringify(value)
    await writeFile(file, corrupt)
    await expect(DeliveryJournal.open(f.config)).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' })
    expect(await readFile(file, 'utf8')).toBe(corrupt)
  })
})
