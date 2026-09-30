/**
 * Duplicate-send protection: identical control text sent twice within the
 * cooldown window almost always means the first send never registered —
 * the coordinator should verify state before re-sending.
 */
export class DuplicateSendGuard {
  private readonly recent = new Map<string, number>()

  constructor(private readonly cooldownMs = 30_000) {}

  /** Whether sending this text now would be a suspicious duplicate. */
  isDuplicate(text: string): boolean {
    const last = this.recent.get(text)
    if (last === undefined) return false
    return Date.now() - last < this.cooldownMs
  }

  /** Record a send. */
  record(text: string): void {
    this.recent.set(text, Date.now())
    // GC old entries.
    const cutoff = Date.now() - this.cooldownMs * 4
    for (const [key, time] of this.recent) {
      if (time < cutoff) this.recent.delete(key)
    }
  }
}
