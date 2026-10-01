import { BrowserTargetChangedError } from './epoch.ts'

/** Generic same-document history; application route meaning belongs to the driver. */
export interface BrowserTransition {
  sequence: number
  beforeUrl: string
  afterUrl: string
}

export class BrowserTransitionHistoryUnavailableError extends BrowserTargetChangedError {
  constructor() {
    super()
    this.name = 'BrowserTransitionHistoryUnavailableError'
    this.message = 'BROWSER_TARGET_CHANGED: complete browser transition history unavailable'
  }
}

interface TransitionLimits {
  maxEvents?: number
  maxBytes?: number
  maxAgeMs?: number
  now?: () => number
}

/** Per-binding bounded history. Eviction advances a floor, never silently makes an
 * old cursor appear current. Document/reconnect generations are fenced separately. */
export class BrowserTransitionBuffer {
  private readonly maxEvents: number
  private readonly maxBytes: number
  private readonly maxAgeMs: number
  private readonly now: () => number
  private records: Array<{ event: BrowserTransition; bytes: number; time: number }> = []
  private bytes = 0
  private floor = 0
  private latest = 0
  private lastTime = -Infinity

  constructor(limits: TransitionLimits = {}) {
    this.maxEvents = limits.maxEvents ?? 1024
    this.maxBytes = limits.maxBytes ?? 256 * 1024
    this.maxAgeMs = limits.maxAgeMs ?? 10 * 60 * 1000
    this.now = limits.now ?? Date.now
    for (const limit of [this.maxEvents, this.maxBytes, this.maxAgeMs]) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid browser transition bound')
    }
  }

  get sequence(): number { return this.latest }

  private time(): number {
    const time = this.now()
    if (!Number.isFinite(time) || time < this.lastTime) throw new BrowserTransitionHistoryUnavailableError()
    this.lastTime = time
    return time
  }

  private evict(): void {
    const record = this.records.shift()!
    this.bytes -= record.bytes
    this.floor = record.event.sequence
  }

  private prune(time: number): void {
    while (this.records.length && time - this.records[0]!.time > this.maxAgeMs) this.evict()
  }

  append(beforeUrl: string, afterUrl: string): void {
    const time = this.time()
    this.prune(time)
    if (typeof beforeUrl !== 'string' || typeof afterUrl !== 'string' || this.latest >= Number.MAX_SAFE_INTEGER) throw new BrowserTransitionHistoryUnavailableError()
    const event = { sequence: ++this.latest, beforeUrl, afterUrl }
    const bytes = new TextEncoder().encode(JSON.stringify(event)).length
    // One oversized event is unavailable provenance too; retain its sequence
    // as the floor without retaining unbounded page-controlled URL data.
    if (bytes > this.maxBytes) {
      this.records = []; this.bytes = 0; this.floor = this.latest
      return
    }
    this.records.push({ event, bytes, time })
    this.bytes += bytes
    while (this.records.length > this.maxEvents || this.bytes > this.maxBytes) this.evict()
  }

  since(sequence: number): BrowserTransition[] {
    this.prune(this.time())
    if (!Number.isSafeInteger(sequence) || sequence < this.floor || sequence < 0 || sequence > this.latest) throw new BrowserTransitionHistoryUnavailableError()
    return this.records.filter(record => record.event.sequence > sequence).map(record => ({ ...record.event }))
  }
}
