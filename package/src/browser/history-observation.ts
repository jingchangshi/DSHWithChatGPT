import type { BrowserTransition } from './transitions.ts'

export interface HistoryObservation {
  token: string
  url: string
  sequence: number
  transitions: BrowserTransition[]
  unavailable?: boolean
}

/** Generic page-side fallback for providers without lifecycle event streaming.
 * Self-contained so Harness can evaluate it in its session-gated document.
 * No route parsing, application selectors or semantic input is introduced. */
export function captureBrowserHistory(root: any, since?: number): HistoryObservation {
  const doc = root.document
  const identityKey = '__plannerbridgeDocumentIdentity'
  const historyKey = '__plannerbridgeHistoryObservation'
  if (!doc[identityKey]) Object.defineProperty(doc, identityKey, { value: root.crypto.randomUUID() })
  if (!doc[historyKey]) {
    const state: any = { sequence: 0, floor: 0, bytes: 0, records: [], url: root.location.href, lastTime: Date.now(), unavailable: false }
    const prune = (now: number) => {
      while (state.records.length && (now - state.records[0].time > 600_000 || state.records.length > 1024 || state.bytes > 262_144)) {
        const first = state.records.shift()
        state.bytes -= first.bytes; state.floor = first.event.sequence
      }
    }
    const record = () => {
      const now = Date.now()
      if (now < state.lastTime || state.sequence >= Number.MAX_SAFE_INTEGER) { state.unavailable = true; return }
      state.lastTime = now
      const event = { sequence: ++state.sequence, beforeUrl: state.url, afterUrl: root.location.href }
      state.url = event.afterUrl
      const bytes = new TextEncoder().encode(JSON.stringify(event)).length
      if (bytes > 262_144) { state.records = []; state.bytes = 0; state.floor = state.sequence; return }
      state.records.push({ event, time: now, bytes }); state.bytes += bytes
      prune(now)
    }
    for (const name of ['pushState', 'replaceState']) {
      const original = root.history[name].bind(root.history)
      const wrapper = (...args: unknown[]) => { const value = original(...args); record(); return value }
      root.history[name] = wrapper
      state[name] = wrapper
    }
    root.addEventListener('popstate', record)
    root.addEventListener('hashchange', record)
    const read = (cursor?: number) => {
      const now = Date.now()
      if (now < state.lastTime) state.unavailable = true
      state.lastTime = now
      prune(now)
      const unavailable = state.unavailable || state.url !== root.location.href
        || root.history.pushState !== state.pushState || root.history.replaceState !== state.replaceState
        || !Number.isSafeInteger(state.sequence) || state.sequence < 0
        || (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < state.floor || cursor < 0 || cursor > state.sequence))
      return { token: doc[identityKey], url: root.location.href, sequence: state.sequence,
        transitions: unavailable || cursor === undefined ? [] : state.records.filter((item: any) => item.event.sequence > cursor).map((item: any) => ({ ...item.event })),
        ...(unavailable ? { unavailable: true } : {}) }
    }
    // Only a read-only closure escapes; page code cannot clear the retained
    // event array or rewrite its floor through the document property.
    Object.defineProperty(doc, historyKey, { value: Object.freeze({ read }) })
  }
  return doc[historyKey].read(since)
}

export function browserHistoryExpression(since?: number): string {
  return `(${captureBrowserHistory.toString()})(window, ${since === undefined ? 'undefined' : JSON.stringify(since)})`
}
