import { Context } from '@deepseek-ai/cordis'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { plannerStateDomain, PlannerCordisStateBackend } from '../src/adapters/cordis/planner-state-store.ts'
import { legacyStateDomain, CordisStateBackend } from '../src/adapters/cordis/state-store.ts'
import { ProtocolStateBackend } from '../src/orchestrator/protocol-state-backend.ts'
import { CoordinatorState } from '../src/orchestrator/state.ts'

const directories: string[] = []
const facilities: DomainFacility[] = []
afterEach(async () => {
  for (const facility of facilities.splice(0)) await facility.closeAll()
  for (const path of directories.splice(0)) {
    const absolute = resolve(path)
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('plannerbridge-domain-test-')) throw new Error('Unexpected fixture cleanup target')
    await rm(absolute, { recursive: true, force: true })
  }
})

// Test-only file medium; production domain validation and adapters remain real.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-domain-test-')); directories.push(directory)
  function facility() {
    const context = new Context()
    context.provide('storage', { backend: { get: () => ({ kv: { open: async (descriptor: { name: string }) => {
      const file = join(directory, descriptor.name + '.json')
      let snapshot: { global: null; tables: Record<string, Record<string, unknown>> }
      try { snapshot = JSON.parse(await readFile(file, 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; snapshot = { global: null, tables: {} } }
      return {
        loadAll: async () => structuredClone(snapshot),
        putRecord: async (table: string, key: string, value: unknown) => {
          const next = structuredClone(snapshot); (next.tables[table] ??= {})[key] = value
          await writeFile(file, JSON.stringify(next)); snapshot = next
        },
        deleteRecord: async (table: string, key: string) => { const next = structuredClone(snapshot); delete next.tables[table]?.[key]; await writeFile(file, JSON.stringify(next)); snapshot = next },
        close: async () => {},
      }
    } } }) } } as never)
    const result = new DomainFacility(context, { backend: 'fixture' }); facilities.push(result); return result
  }
  async function open() {
    const current = facility()
    const legacy = await current.open(legacyStateDomain), canonical = await current.open(plannerStateDomain)
    return { facility: current, legacy, canonical, store: new CoordinatorState(new ProtocolStateBackend(new CordisStateBackend(legacy), new PlannerCordisStateBackend(canonical))) }
  }
  return { directory, open }
}
const old = { taskId: 'd2c_old', goal: 'resume', state: 'executed' as const, iteration: 1, waitingFor: 'chatgpt-review' as const, conversationId: 'same-chat', lastReviewedHead: 'a'.repeat(40), createdAt: 1, updatedAt: 2, lastError: null }
const current = { ...old, taskId: 'pb_' + 'b'.repeat(32), protocolVersion: 2 as const }

describe('real Cordis domain layer with independent persisted fixture medium', () => {
  it('reopens both domains without changing released task bytes or canonical version', async () => {
    const fixtureState = await fixture(), first = await fixtureState.open()
    await first.legacy.table('tasks').put(old.taskId, old)
    const before = await readFile(join(fixtureState.directory, 'd2c_state.json'), 'utf8')
    const saved = await first.store.createTask(current)
    await first.facility.closeAll()
    const reopened = await fixtureState.open()
    expect(await reopened.store.loadTask(old.taskId)).toEqual(old)
    expect(await reopened.store.loadTaskSnapshot(current.taskId)).toEqual(saved)
    expect(await readFile(join(fixtureState.directory, 'd2c_state.json'), 'utf8')).toBe(before)
  })
  it('rejects invalid writes at the canonical adapter before touching the medium', async () => {
    const { canonical } = await (await fixture()).open()
    const backend = new PlannerCordisStateBackend(canonical)
    await expect(backend.put('task:' + current.taskId, { ...current, protocolVersion: 1 })).rejects.toThrow()
    expect(canonical.table('tasks').get(current.taskId)).toBeUndefined()
  })
  it('rejects a corrupt persisted canonical record at real domain reopen', async () => {
    const fixtureState = await fixture()
    await writeFile(join(fixtureState.directory, 'plannerbridge_state.json'), JSON.stringify({ global: null, tables: { tasks: { [current.taskId]: { ...current, protocolVersion: 1 } } } }))
    await expect(fixtureState.open()).rejects.toMatchObject({ code: 'invalid-record' })
    const snapshot = JSON.parse(await readFile(join(fixtureState.directory, 'plannerbridge_state.json'), 'utf8'))
    expect(snapshot.tables.tasks[current.taskId].protocolVersion).toBe(1)
  })
})
