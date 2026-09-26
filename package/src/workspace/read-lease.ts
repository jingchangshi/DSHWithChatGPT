import type { ExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease'
import { IgnoreMatcher, NOISE_PATTERNS, SensitivePolicy } from './boundary.ts'
import { WorkspaceError } from './errors.ts'
import { normalizeWorkspacePath } from './query.ts'
import type { WorkspaceReadBackend } from './runtime.ts'

/** Adapt one producer-owned filesystem; callers retain acquisition and disposal ownership. */
export async function createReadLeaseBackend(lease: ExecutionReadLease, signal: AbortSignal): Promise<WorkspaceReadBackend> {
  signal.throwIfAborted()
  const ignore = await lease.fs.stat('.d2cignore', signal)
  if (ignore !== undefined && ignore.type !== 'file') {
    throw new WorkspaceError('WORKSPACE_POLICY_UNAVAILABLE', 'workspace ignore policy is not a regular file')
  }
  const policyText = ignore === undefined ? '' : await lease.fs.readText('.d2cignore', 128 * 1024, signal)
  const policy = new SensitivePolicy(policyText.split(/\r?\n/))
  const noise = new IgnoreMatcher(NOISE_PATTERNS)
  const authorize = (path: string, directory: boolean): void => {
    if (policy.isSensitive(path, directory)) {
      throw new WorkspaceError('ACCESS_DENIED_SENSITIVE_FILE', 'workspace path is denied')
    }
  }
  return {
    async read(query, operationSignal) {
      const active = AbortSignal.any([signal, operationSignal])
      active.throwIfAborted()
      if (query.operation === 'read_file') {
        const path = normalizeWorkspacePath(query.path)
        authorize(path, false)
        const info = await lease.fs.stat(path, active)
        if (info?.type !== 'file') throw new WorkspaceError('INVALID_PATH', 'expected a regular workspace file')
        const content = await lease.fs.readText(path, query.maxBytes, active)
        active.throwIfAborted()
        return { path, sizeBytes: info.size ?? Buffer.byteLength(content), truncated: false, content }
      }
      const path = normalizeWorkspacePath(query.operation === 'list_directory' ? query.path : query.subdirectory)
      authorize(path, true)
      if (query.operation === 'list_directory') {
        const entries: Array<{ name: string; type: 'file' | 'dir'; sensitive: boolean }> = []
        let hiddenSensitiveCount = 0
        let truncated = false
        for (const entry of await lease.fs.listDir(path, active)) {
          active.throwIfAborted()
          if (entry.type === 'other' || noise.matches(entry.path, entry.type === 'directory')) continue
          if (policy.isSensitive(entry.path, entry.type === 'directory')) { hiddenSensitiveCount++; continue }
          if (entries.length >= query.maxEntries) { truncated = true; break }
          entries.push({ name: entry.name, type: entry.type === 'directory' ? 'dir' : 'file', sensitive: false })
        }
        return { path, entries, hiddenSensitiveCount, truncated }
      }
      const matches: Array<{ path: string; line: number; text: string }> = []
      const matcher = query.isRegex ? new RegExp(query.query) : undefined
      const pending = [path]
      while (pending.length > 0 && matches.length < query.maxMatches) {
        active.throwIfAborted()
        const directory = pending.pop()!
        for (const entry of await lease.fs.listDir(directory, active)) {
          active.throwIfAborted()
          if (matches.length >= query.maxMatches) break
          const isDirectory = entry.type === 'directory'
          if (entry.type === 'other' || noise.matches(entry.path, isDirectory) || policy.isSensitive(entry.path, isDirectory)) continue
          if (isDirectory) { pending.push(entry.path); continue }
          const info = await lease.fs.stat(entry.path, active)
          if (info?.type !== 'file' || info.size === undefined || info.size > query.maxFileBytes) continue
          let content: string
          try {
            content = await lease.fs.readText(entry.path, query.maxFileBytes, active)
          } catch (error) {
            active.throwIfAborted()
            if (typeof error === 'object' && error !== null && 'code' in error
              && (error.code === 'FS_NOT_TEXT' || error.code === 'FS_TOO_LARGE' || error.code === 'FS_NOT_FOUND')) continue
            throw error
          }
          if (content.includes('\0')) continue
          const lines = content.split(/\r?\n/)
          for (const [index, line] of lines.entries()) {
            active.throwIfAborted()
            if (matches.length >= query.maxMatches) break
            if (matcher ? matcher.test(line) : line.includes(query.query)) {
              matches.push({ path: entry.path, line: index + 1, text: line.slice(0, 300) })
            }
          }
        }
      }
      active.throwIfAborted()
      return { query: query.query, matches, matchCount: matches.length, truncated: matches.length >= query.maxMatches }
    },
  }
}
