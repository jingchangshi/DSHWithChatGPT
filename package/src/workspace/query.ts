import { WorkspaceError } from './errors.ts'

/** Normalized, bounded consumer operations; no executable or shell arguments are accepted. */
export type WorkspaceQuery =
  | { operation: 'list_directory'; path: string; maxEntries: number }
  | { operation: 'read_file'; path: string; maxBytes: number }
  | { operation: 'search_workspace'; query: string; isRegex: boolean; subdirectory: string; maxMatches: number; maxFileBytes: number }
  | { operation: 'git_status' }
  | { operation: 'git_diff'; againstRef?: string; maxBytes: number }
  | { operation: 'git_log'; limit: number }

/** Fixed read-only query names exposed by the workspace bridge. */
export type WorkspaceReadOperation = WorkspaceQuery['operation']

/** Convert a display path to logical components without consulting the Host filesystem. */
export function normalizeWorkspacePath(value: string): string {
  const logical = value.startsWith('workspace:/') ? value.slice('workspace:/'.length) : value
  if (logical.includes('\0') || logical.includes('\\') || logical.startsWith('/') || logical.includes(':')) {
    throw new WorkspaceError('INVALID_PATH', 'expected a workspace-relative path')
  }
  if (logical === '.' || logical === '') return ''
  const parts = logical.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new WorkspaceError('INVALID_PATH', 'invalid workspace path components')
  }
  return parts.join('/')
}

function invalid(): never {
  throw new WorkspaceError('INVALID_WORKSPACE_QUERY', 'invalid workspace query arguments')
}

function text(value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || value.includes('\0')) return invalid()
  return value
}

function positiveInteger(value: unknown, fallback: number, ceiling: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid()
  return Math.min(value, ceiling)
}

/**
 * Validate wire arguments and attach consumer-owned output limits before provider dispatch.
 * @param operation - one fixed MCP operation, not a provider command.
 * @param args - untrusted MCP arguments.
 * @returns a normalized query with no unknown caller-controlled fields.
 */
export function normalizeWorkspaceQuery(operation: WorkspaceReadOperation, args: Record<string, unknown>): WorkspaceQuery {
  const allowed: Record<WorkspaceReadOperation, readonly string[]> = {
    list_directory: ['path'], read_file: ['path'], search_workspace: ['query', 'is_regex', 'subdirectory'],
    git_status: [], git_diff: ['against_ref', 'max_bytes'], git_log: ['limit'],
  }
  if (Object.keys(args).some(key => !allowed[operation].includes(key))) return invalid()
  switch (operation) {
    case 'list_directory': return { operation, path: text(args.path, '.') || '.', maxEntries: 500 }
    case 'read_file': {
      const path = text(args.path)
      if (path === '') return invalid()
      return { operation, path, maxBytes: 128 * 1024 }
    }
    case 'search_workspace': {
      const query = text(args.query)
      if (query === '' || (args.is_regex !== undefined && typeof args.is_regex !== 'boolean')) return invalid()
      const isRegex = args.is_regex === true
      if (isRegex) {
        try { new RegExp(query, 'g') } catch { return invalid() }
      }
      return { operation, query, isRegex, subdirectory: text(args.subdirectory, '.') || '.', maxMatches: 200, maxFileBytes: 512 * 1024 }
    }
    case 'git_status': return { operation }
    case 'git_diff': {
      const againstRef = args.against_ref === undefined ? undefined : text(args.against_ref)
      if (againstRef !== undefined && !/^(?:HEAD|@\{u\}|HEAD\.\.\.@\{u\}|[0-9a-f]{7,64})$/u.test(againstRef)) return invalid()
      return { operation, ...(againstRef === undefined ? {} : { againstRef }), maxBytes: positiveInteger(args.max_bytes, 256 * 1024, 1024 * 1024) }
    }
    case 'git_log': return { operation, limit: positiveInteger(args.limit, 10, 50) }
  }
}
