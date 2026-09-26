import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { WorkspaceError } from './errors.ts'

/** Canonical directory and stable lookup key for one checkout. */
export function canonicalWorkspaceRoot(input: string): { root: string; key: string; id: string } {
  let real: string
  try {
    real = fs.realpathSync.native(input)
    if (!fs.statSync(real).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new WorkspaceError('INVALID_WORKSPACE_ROOT', 'workspace root must be an accessible directory')
  }
  const root = process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real
  const key = path.normalize(root)
  return { root, key, id: 'ws_' + createHash('sha256').update(key).digest('hex').slice(0, 16) }
}

/** Require the executing Session's workspace; never use the host process cwd. */
export function sessionWorkspaceRoot(cwd: unknown): string {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new WorkspaceError('SESSION_WORKSPACE_UNAVAILABLE', 'executing Session has no workspace cwd')
  }
  return canonicalWorkspaceRoot(cwd).root
}

/** A shell observation without a valid Session workspace cannot own C2C evidence. */
export function observedWorkspaceRoot(cwd: unknown): string | undefined {
  try {
    return sessionWorkspaceRoot(cwd)
  } catch (_invalidSessionWorkspace) {
    return undefined
  }
}

/**
 * Stable, non-secret identity for one local workspace checkout.
 * The absolute path itself is never sent to ChatGPT; only this hash is.
 */
export function workspaceIdentity(root: string): string {
  return canonicalWorkspaceRoot(root).id
}
