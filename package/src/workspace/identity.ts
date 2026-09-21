import fs from 'node:fs'
import { createHash } from 'node:crypto'

/**
 * Stable, non-secret identity for one local workspace checkout.
 * The absolute path itself is never sent to ChatGPT; only this hash is.
 */
export function workspaceIdentity(root: string): string {
  let canonical = root
  try {
    canonical = fs.realpathSync.native(root)
  } catch {
    canonical = root
  }
  const normalized = process.platform === 'win32' || process.platform === 'darwin'
    ? canonical.toLowerCase()
    : canonical
  return 'ws_' + createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}
