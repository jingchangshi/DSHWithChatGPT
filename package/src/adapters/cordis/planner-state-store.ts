import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { legacyStateDomain, taskRecordSchema } from './state-store.ts'
import type { StateStore } from '../../orchestrator/state.ts'

/** Independent canonical storage format; released d2c_state remains frozen. */
export const plannerStateDomain = defineDomain({
  name: 'plannerbridge_state', version: 1,
  tables: {
    tasks: domainTable(taskRecordSchema.extend({
      protocolVersion: z.literal(2),
      taskId: z.string().regex(/^pb_[0-9a-f]{32,64}$/),
      iteration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }).strict()),
    bindings: legacyStateDomain.tables.bindings,
    index: legacyStateDomain.tables.index,
  },
})

/** Adapter only. Deployment does not enable v2 tasks until recovery is ready. */
export class PlannerCordisStateBackend implements StateStore {
  constructor(private readonly domain: Domain<typeof plannerStateDomain>) {}
  private table(key: string) {
    const [kind, ...rest] = key.split(':')
    const name = kind === 'task' ? 'tasks' : kind === 'workspace' ? 'bindings' : kind === 'index' ? 'index' : undefined
    if (!name) throw new Error('PROTOCOL_STATE_CONFLICT')
    return { table: this.domain.table(name), schema: plannerStateDomain.tables[name].valueSchema, recordKey: rest.join(':') }
  }
  async get<T>(key: string): Promise<T | undefined> { const { table, recordKey } = this.table(key); return table.get(recordKey) as T | undefined }
  async put<T>(key: string, value: T): Promise<void> {
    const { table, schema, recordKey } = this.table(key)
    const parsed = schema.parse(value)
    if (key.startsWith('task:') && (parsed as { taskId: string }).taskId !== recordKey) throw new Error('PROTOCOL_STATE_CONFLICT')
    await table.put(recordKey, parsed as never)
  }
  async delete(key: string): Promise<void> { const { table, recordKey } = this.table(key); await table.delete(recordKey) }
}
