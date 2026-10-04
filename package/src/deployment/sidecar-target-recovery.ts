import { listCdpTargets } from '../browser/direct-cdp.ts'
import { throwIfCancelled } from '../cancellation.ts'
import { SidecarRpcError } from '../sidecar/errors.ts'
import { BrowserMutationUncertainError } from '../browser/epoch.ts'

const targetId = /^[A-Za-z0-9_-]{1,128}$/
const durablePath = /^\/c\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const invalid = () => new SidecarRpcError('BROWSER_TARGET_CHANGED')

export interface OwnedSidecarReplacement {
  sourceTargetId: string
  replacementTargetId: string
  closeReplacement(): Promise<void>
  retireSource(): Promise<void>
}

/**
 * Owns both provisional resources until the synchronous commit. A constructed
 * process is registered before start, including partial startup failures.
 * Rollback drains that process before closing its target. Semantic proof stays
 * caller-specific; retirement cannot undo committed ownership.
 */
export async function runOwnedSidecarHandoff<P extends { start(signal?: AbortSignal): Promise<void>; close(): Promise<void> }, T>(options: {
  replacement: OwnedSidecarReplacement
  closeSource(): Promise<void>
  prepareReplacement(): Promise<P>
  health(): Promise<{ ok: boolean }>
  prove(): Promise<{ kind: 'proved' | 'rejected'; value: T }>
  commit(process: P): void
  signal?: AbortSignal
}): Promise<T> {
  let process: P | undefined
  let committed = false
  try {
    throwIfCancelled(options.signal)
    await options.closeSource()
    throwIfCancelled(options.signal)
    process = await options.prepareReplacement()
    throwIfCancelled(options.signal)
    await process.start(options.signal)
    throwIfCancelled(options.signal)
    const health = await options.health()
    throwIfCancelled(options.signal)
    if (!health.ok) throw new SidecarRpcError('SIDECAR_UNAVAILABLE')
    const proof = await options.prove()
    throwIfCancelled(options.signal)
    if (proof.kind === 'rejected') return proof.value
    options.commit(process)
    committed = true
    await options.replacement.retireSource().catch(() => {})
    return proof.value
  } finally {
    if (!committed) {
      await process?.close().catch(() => {})
      await options.replacement.closeReplacement().catch(() => {})
    }
  }
}

/** Deployment mechanics only. The handle confers no conversation/task authority;
 * a fresh Sidecar must independently reconcile the unchanged persisted journal. */
export async function createOwnedSidecarReplacement(endpoint: string, ownedTargetId: string, signal?: AbortSignal): Promise<OwnedSidecarReplacement> {
  const endpointMatch = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(endpoint)
  if (!endpointMatch || Number(endpointMatch[1]) > 65535 || !targetId.test(ownedTargetId)) throw invalid()
  throwIfCancelled(signal)
  const base = endpoint.replace(/\/$/, '')
  const targets = await listCdpTargets(endpoint, { signal })
  const candidates = targets.filter(target => target.id === ownedTargetId && target.type === 'page')
  if (candidates.length !== 1) throw invalid()
  const source = candidates[0]!
  let url: URL
  try { url = new URL(source.url) } catch { throw invalid() }
  if (url.origin !== 'https://chatgpt.com' || url.username || url.password || url.search || url.hash || !durablePath.test(url.pathname)) throw invalid()
  const request = async (path: string, method: string, active?: AbortSignal) => {
    const deadline = AbortSignal.timeout(5000)
    const response = await fetch(base + path, { method, redirect: 'error', signal: active ? AbortSignal.any([active, deadline]) : deadline })
    if (!response.ok) { await response.body?.cancel(); throw invalid() }
    const reader = response.body?.getReader()
    if (!reader) throw invalid()
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 1024 * 1024) { await reader.cancel(); throw invalid() }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    return Buffer.concat(chunks).toString('utf8')
  }
  let replacementId: string | undefined
  let creationIssued = false
  const close = async (id: string) => { await request('/json/close/' + encodeURIComponent(id), 'GET') }
  try {
    throwIfCancelled(signal)
    creationIssued = true
    const response: unknown = JSON.parse(await request('/json/new?' + encodeURIComponent(source.url), 'PUT', signal))
    if (!response || typeof response !== 'object' || !('id' in response) || typeof response.id !== 'string'
      || !targetId.test(response.id) || response.id === ownedTargetId || targets.some(target => target.id === response.id)) throw invalid()
    replacementId = response.id
    throwIfCancelled(signal)
    const current = await listCdpTargets(endpoint, { signal })
    const replacement = current.filter(target => target.id === replacementId && target.type === 'page' && target.url === source.url)
    const unchangedSource = current.filter(target => target.id === ownedTargetId && target.type === 'page' && target.url === source.url)
    if (replacement.length !== 1 || unchangedSource.length !== 1) throw invalid()
    throwIfCancelled(signal)
    const created = replacementId
    let closed = false
    return {
      sourceTargetId: ownedTargetId, replacementTargetId: created,
      async closeReplacement() { if (!closed) { await close(created); closed = true } },
      async retireSource() {
        const matches = (await listCdpTargets(endpoint)).filter(target => target.id === ownedTargetId)
        if (matches.length === 1 && matches[0]!.type === 'page' && matches[0]!.url === source.url) await close(ownedTargetId)
      },
    }
  } catch (error) {
    if (replacementId) await close(replacementId).catch(() => {})
    // A written creation with no trusted response ID confers no ownership.
    // Target-list differences (even one exact-URL page) may belong to another
    // actor. Preserve uncertainty instead of guessing cleanup or retrying.
    if (creationIssued && !replacementId) throw new BrowserMutationUncertainError()
    throwIfCancelled(signal)
    throw error
  }
}
