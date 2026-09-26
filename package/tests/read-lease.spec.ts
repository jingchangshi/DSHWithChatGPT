import { describe, expect, it, vi } from 'vitest'
import type { ExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease'
import { createReadLeaseBackend } from '../src/workspace/read-lease.ts'
import { normalizeWorkspacePath, normalizeWorkspaceQuery } from '../src/workspace/query.ts'

function fixture(files: Record<string, string>) {
  const signal = new AbortController().signal
  const lease: ExecutionReadLease = {
    workspaceId: 'test-workspace' as ExecutionReadLease['workspaceId'],
    dispose: vi.fn(async () => {}),
    fs: {
      stat: vi.fn(async path => files[path] === undefined ? undefined : { type: 'file' as const, size: Buffer.byteLength(files[path]!) }),
      readText: vi.fn(async (path, maxBytes, active) => {
        active?.throwIfAborted()
        const content = files[path]
        if (content === undefined) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
        if (Buffer.byteLength(content) > maxBytes) throw Object.assign(new Error('large'), { code: 'FS_TOO_LARGE' })
        if (content.includes('\0')) throw Object.assign(new Error('binary'), { code: 'FS_NOT_TEXT' })
        return content
      }),
      listDir: vi.fn(async directory => {
        const prefix = directory === '' ? '' : directory + '/'
        const children = new Map<string, { path: string; name: string; type: 'file' | 'directory' }>()
        for (const file of Object.keys(files)) {
          if (!file.startsWith(prefix)) continue
          const suffix = file.slice(prefix.length)
          const name = suffix.split('/')[0]!
          children.set(name, { name, path: prefix + name, type: suffix.includes('/') ? 'directory' : 'file' })
        }
        return [...children.values()]
      }),
    },
  }
  return { lease, signal, backend: () => createReadLeaseBackend(lease, signal) }
}

describe('execution read lease backend', () => {
  it('uses one lease for ignore policy, reads, listings and search', async () => {
    const state = fixture({ '.d2cignore': 'private/', '.env': 'needle secret', '.env.example': 'needle public',
      'private/data.txt': 'needle private', 'node_modules/data.txt': 'needle noise', 'src/data.txt': 'needle public',
      'binary.bin': 'needle\0', 'large.txt': 'x'.repeat(512 * 1024 + 1) })
    const backend = await state.backend()
    const read = (operation: 'read_file' | 'list_directory' | 'search_workspace', args: Record<string, unknown>) =>
      backend.read(normalizeWorkspaceQuery(operation, args) as Parameters<typeof backend.read>[0], state.signal)
    await expect(read('read_file', { path: 'workspace:/src/data.txt' })).resolves.toMatchObject({ content: 'needle public' })
    await expect(read('read_file', { path: '.env' })).rejects.toMatchObject({ reason: 'ACCESS_DENIED_SENSITIVE_FILE' })
    await expect(read('read_file', { path: 'private/data.txt' })).rejects.toMatchObject({ reason: 'ACCESS_DENIED_SENSITIVE_FILE' })
    const listing = await read('list_directory', {}) as { entries: Array<{ name: string }> }
    for (const denied of ['.env', 'private', 'node_modules']) {
      expect(listing.entries.map(entry => entry.name)).not.toContain(denied)
    }
    await expect(read('search_workspace', { query: 'needle' })).resolves.toMatchObject({ matchCount: 2 })
    expect(state.lease.fs.readText).toHaveBeenCalledWith('.d2cignore', 128 * 1024, state.signal)
    expect(state.lease.dispose).not.toHaveBeenCalled()
  })

  it('fails closed when an existing ignore file cannot be read within its limit', async () => {
    const state = fixture({ '.d2cignore': 'x'.repeat(128 * 1024 + 1) })
    await expect(state.backend()).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
  })

  it('caps search matches and propagates cancellation', async () => {
    const state = fixture({ 'data.txt': 'needle\n'.repeat(250) })
    const backend = await state.backend()
    const query = { operation: 'search_workspace' as const, query: 'needle', isRegex: false, subdirectory: '.', maxMatches: 200, maxFileBytes: 512 * 1024 }
    await expect(backend.read(query, state.signal)).resolves.toMatchObject({ matchCount: 200, truncated: true })
    await expect(backend.read(query, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
  })

  it('fails oversized reads instead of returning a truncated head-tail result', async () => {
    const state = fixture({ 'large.txt': 'x'.repeat(128 * 1024 + 1) })
    const backend = await state.backend()
    await expect(backend.read({ operation: 'read_file', path: 'large.txt', maxBytes: 128 * 1024 }, state.signal))
      .rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
  })

  it.each(['../secret', '/absolute', 'C:/secret', 'a//b', 'a/./b', 'a\\b', 'https://host/file', 'a\0b'])('rejects %s before provider reads', async path => {
    const state = fixture({})
    const backend = await state.backend()
    await expect(backend.read({ operation: 'read_file', path, maxBytes: 32 }, state.signal)).rejects.toMatchObject({ reason: 'INVALID_PATH' })
    expect(state.lease.fs.readText).not.toHaveBeenCalled()
  })

  it('maps only logical root and workspace presentation paths', () => {
    expect(normalizeWorkspacePath('.')).toBe('')
    expect(normalizeWorkspacePath('workspace:/src/file')).toBe('src/file')
  })
})
