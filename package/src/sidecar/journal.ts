import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, unlink, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { SidecarRpcError } from './errors.ts'

const phases = ['prepared', 'sending', 'observed-sent', 'awaiting-reply', 'accepted', 'uncertain', 'cancelled', 'failed'] as const
export type DeliveryPhase = typeof phases[number]
const intentSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  method: z.enum(['sendControlMessage', 'waitForReply', 'openConversation', 'ensureReady', 'recover']),
  createdAt: z.number().int().nonnegative(),
  correlationDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()
const entrySchema = intentSchema.extend({ phase: z.enum(phases), updatedAt: z.number().int().nonnegative() }).strict()
export type DeliveryIntent = z.infer<typeof intentSchema>
export type DeliveryEntry = z.infer<typeof entrySchema>
const storeSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), retired: z.string().regex(/^[a-f0-9]{128}$/), entries: z.array(entrySchema) }).strict()
type Store = z.infer<typeof storeSchema>
export interface DeliveryJournalConfig { directory: string; maxEntries: number; maxBytes: number; maxAgeMs: number; now?: () => number }
const terminal = new Set<DeliveryPhase>(['accepted', 'cancelled', 'failed'])
const transitions: Record<DeliveryPhase, readonly DeliveryPhase[]> = {
  prepared: ['sending', 'awaiting-reply', 'cancelled', 'failed'],
  sending: ['observed-sent', 'uncertain'],
  'observed-sent': ['accepted', 'awaiting-reply', 'uncertain'],
  'awaiting-reply': ['accepted', 'cancelled', 'failed', 'uncertain'],
  accepted: [], uncertain: [], cancelled: [], failed: [],
}

/** Own-state only. Deployment must inject and protect this directory outside workspaces.
 * No message/source bodies are persisted. Disk publication precedes memory publication.
 * A fixed-size retired-ID filter permits false-positive refusal, never false-negative
 * re-entry after terminal eviction. Saturation fails admission safely. */
export class DeliveryJournal {
  private store: Store = { version: 1, revision: 0, retired: '0'.repeat(128), entries: [] }
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private closing = false
  private readonly token = randomUUID()
  private lock: FileHandle | undefined
  private readonly file: string
  private readonly lockFile: string
  private readonly now: () => number
  private constructor(private readonly config: DeliveryJournalConfig) {
    this.file = join(config.directory, 'delivery.json')
    this.lockFile = join(config.directory, 'owner.lock')
    this.now = config.now ?? Date.now
  }
  static async open(config: DeliveryJournalConfig): Promise<DeliveryJournal> {
    if (!isAbsolute(config.directory) || resolve(config.directory) !== config.directory || !Number.isInteger(config.maxEntries) || config.maxEntries < 1 || config.maxEntries > 10_000 || !Number.isInteger(config.maxBytes) || config.maxBytes < 1_024 || !Number.isInteger(config.maxAgeMs) || config.maxAgeMs < 1) throw new SidecarRpcError('JOURNAL_UNAVAILABLE')
    const journal = new DeliveryJournal(config)
    try {
      await mkdir(config.directory, { recursive: true, mode: 0o700 })
      if ((await lstat(config.directory)).isSymbolicLink()) throw new SidecarRpcError('JOURNAL_UNAVAILABLE')
      await journal.acquire()
      try {
        const info = await lstat(journal.file)
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > config.maxBytes) throw new SidecarRpcError('JOURNAL_UNAVAILABLE')
        const parsed = storeSchema.safeParse(JSON.parse(await readFile(journal.file, 'utf8')))
        if (!parsed.success || parsed.data.entries.length > config.maxEntries || new Set(parsed.data.entries.map(entry => entry.operationId)).size !== parsed.data.entries.length) throw new SidecarRpcError('JOURNAL_UNAVAILABLE')
        journal.store = parsed.data
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await journal.reclaimStaging()
      const next = structuredClone(journal.store)
      for (const entry of next.entries) if (['sending', 'observed-sent', 'awaiting-reply'].includes(entry.phase)) { entry.phase = 'uncertain'; entry.updatedAt = journal.now() }
      await journal.publish(next)
      return journal
    } catch (error) {
      await journal.release()
      if (error instanceof SidecarRpcError) throw error
      throw new SidecarRpcError('JOURNAL_UNAVAILABLE')
    }
  }
  lookup(operationId: string): DeliveryEntry | undefined {
    const entry = this.store.entries.find(entry => entry.operationId === operationId)
    return entry ? structuredClone(entry) : undefined
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing || this.closed) return Promise.reject(new SidecarRpcError('JOURNAL_UNAVAILABLE'))
    const result = this.queue.then(async () => { if (this.closed) throw new SidecarRpcError('JOURNAL_UNAVAILABLE'); return operation() })
    this.queue = result.catch(() => {})
    return result
  }
  prepare(value: unknown): Promise<DeliveryEntry> {
    return this.serialize(async () => {
      const parsed = intentSchema.safeParse(value)
      if (!parsed.success) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
      const intent = parsed.data
      const existing = this.lookup(intent.operationId)
      if (existing) {
        if (existing.payloadDigest !== intent.payloadDigest || existing.method !== intent.method || existing.correlationDigest !== intent.correlationDigest) throw new SidecarRpcError('REPLAY_CONFLICT')
        return existing
      }
      const next = structuredClone(this.store)
      if (intent.correlationDigest && next.entries.some(entry => entry.correlationDigest === intent.correlationDigest && entry.operationId !== intent.operationId)) throw new SidecarRpcError('REPLAY_CONFLICT')
      this.retireExpired(next)
      if (this.retired(next, intent.operationId)) throw new SidecarRpcError('REPLAY_CONFLICT')
      if (intent.correlationDigest && this.retired(next, 'correlation:' + intent.correlationDigest)) throw new SidecarRpcError('REPLAY_CONFLICT')
      if (intent.createdAt < this.now() - this.config.maxAgeMs || intent.createdAt > this.now() + 5_000) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
      if (next.entries.length >= this.config.maxEntries) throw new SidecarRpcError('JOURNAL_CAPACITY')
      const entry: DeliveryEntry = { ...intent, phase: 'prepared', updatedAt: this.now() }
      next.entries.push(entry)
      await this.publish(next)
      return structuredClone(entry)
    })
  }
  transition(operationId: string, phase: DeliveryPhase): Promise<DeliveryEntry> {
    return this.serialize(async () => {
      const next = structuredClone(this.store)
      const entry = next.entries.find(entry => entry.operationId === operationId)
      if (!entry || !phases.includes(phase) || (entry.phase !== phase && !transitions[entry.phase].includes(phase))) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
      entry.phase = phase; entry.updatedAt = this.now()
      await this.publish(next)
      return structuredClone(entry)
    })
  }
  private filterBits(operationId: string): number[] {
    const hash = createHash('sha256').update(operationId).digest()
    return [0, 4, 8, 12].map(offset => hash.readUInt32BE(offset) % 512)
  }
  private retired(store: Store, operationId: string): boolean {
    const bytes = Buffer.from(store.retired, 'hex')
    return this.filterBits(operationId).every(bit => ((bytes[Math.floor(bit / 8)] ?? 0) & (1 << bit % 8)) !== 0)
  }
  private retireExpired(store: Store): void {
    const bytes = Buffer.from(store.retired, 'hex')
    store.entries = store.entries.filter(entry => {
      if (!terminal.has(entry.phase) || entry.updatedAt >= this.now() - this.config.maxAgeMs) return true
      for (const bit of this.filterBits(entry.operationId)) bytes[Math.floor(bit / 8)] = (bytes[Math.floor(bit / 8)] ?? 0) | 1 << bit % 8
      if (entry.correlationDigest) for (const bit of this.filterBits('correlation:' + entry.correlationDigest)) bytes[Math.floor(bit / 8)] = (bytes[Math.floor(bit / 8)] ?? 0) | 1 << bit % 8
      return false
    })
    store.retired = bytes.toString('hex')
  }
  private async acquire(): Promise<void> {
    try { this.lock = await open(this.lockFile, 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const lockInfo = await lstat(this.lockFile)
      if (!lockInfo.isFile() || lockInfo.isSymbolicLink() || lockInfo.nlink !== 1 || lockInfo.size > 1_024) throw new SidecarRpcError('SIDECAR_BUSY')
      const owner = JSON.parse(await readFile(this.lockFile, 'utf8')) as { pid?: number; token?: string }
      if (!Number.isInteger(owner.pid) || owner.pid! < 1 || typeof owner.token !== 'string') throw new SidecarRpcError('SIDECAR_BUSY')
      try { process.kill(owner.pid!, 0); throw new SidecarRpcError('SIDECAR_BUSY') }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw new SidecarRpcError('SIDECAR_BUSY') }
      // Serialize stale-owner reclamation. A crashed reclaimer leaves this
      // guard for explicit operator reconciliation; never delete it on a guess.
      const reclaimPath = join(this.config.directory, 'reclaim.lock')
      let reclaim: FileHandle
      try { reclaim = await open(reclaimPath, 'wx', 0o600) }
      catch { throw new SidecarRpcError('SIDECAR_BUSY') }
      try {
        const current = JSON.parse(await readFile(this.lockFile, 'utf8')) as { token?: string }
        if (current.token !== owner.token) throw new SidecarRpcError('SIDECAR_BUSY')
        await unlink(this.lockFile)
        this.lock = await open(this.lockFile, 'wx', 0o600)
      } finally { await reclaim.close(); await unlink(reclaimPath) }
    }
    await this.lock.writeFile(JSON.stringify({ pid: process.pid, token: this.token }))
    await this.lock.sync()
  }
  private async assertOwner(): Promise<void> {
    const owner = JSON.parse(await readFile(this.lockFile, 'utf8')) as { token?: string }
    if (!this.lock || owner.token !== this.token) throw new SidecarRpcError('JOURNAL_UNAVAILABLE')
  }
  private async reclaimStaging(): Promise<void> {
    const files = (await readdir(this.config.directory)).filter(file => /^delivery-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(file))
    if (files.length > 64) throw new SidecarRpcError('JOURNAL_CAPACITY')
    for (const file of files) {
      const path = join(this.config.directory, file)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > this.config.maxBytes) throw new SidecarRpcError('JOURNAL_UNAVAILABLE')
      await this.assertOwner()
      await unlink(path)
    }
  }
  private async publish(next: Store): Promise<void> {
    next.revision = this.store.revision + 1
    const serialized = JSON.stringify(next) + '\n'
    if (Buffer.byteLength(serialized) > this.config.maxBytes) throw new SidecarRpcError('JOURNAL_CAPACITY')
    const temporary = join(this.config.directory, 'delivery-' + randomUUID() + '.tmp')
    let file: FileHandle | undefined
    try {
      await this.assertOwner()
      file = await open(temporary, 'wx', 0o600)
      await file.writeFile(serialized); await file.sync(); await file.close(); file = undefined
      await this.assertOwner()
      await rename(temporary, this.file)
      this.store = structuredClone(next)
    } catch (error) { if (error instanceof SidecarRpcError) throw error; throw new SidecarRpcError('JOURNAL_UNAVAILABLE') }
    finally { await file?.close(); await unlink(temporary).catch(() => {}) }
  }
  private async release(): Promise<void> {
    if (!this.lock) return
    try { await this.assertOwner(); await this.lock.close(); this.lock = undefined; await unlink(this.lockFile) }
    catch { await this.lock?.close(); this.lock = undefined }
  }
  async close(): Promise<void> { this.closing = true; await this.queue; this.closed = true; await this.release() }
}
