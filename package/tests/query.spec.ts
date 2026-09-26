import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceQuery } from '../src/workspace/query.ts'

describe('workspace query normalization', () => {
  it('adds fixed file, directory, and search bounds', () => {
    expect(normalizeWorkspaceQuery('list_directory', {})).toEqual({ operation: 'list_directory', path: '.', maxEntries: 500 })
    expect(normalizeWorkspaceQuery('read_file', { path: 'src/a.ts' })).toEqual({ operation: 'read_file', path: 'src/a.ts', maxBytes: 131072 })
    expect(normalizeWorkspaceQuery('search_workspace', { query: 'needle' })).toEqual({
      operation: 'search_workspace', query: 'needle', isRegex: false, subdirectory: '.', maxMatches: 200, maxFileBytes: 524288,
    })
  })

  it('caps caller-requested Git sizes and commit counts', () => {
    expect(normalizeWorkspaceQuery('git_diff', { max_bytes: 9000000 })).toEqual({ operation: 'git_diff', maxBytes: 1048576 })
    expect(normalizeWorkspaceQuery('git_log', { limit: 100 })).toEqual({ operation: 'git_log', limit: 50 })
    expect(normalizeWorkspaceQuery('git_status', {})).toEqual({ operation: 'git_status' })
  })

  it('rejects invalid paths and arbitrary provider controls', () => {
    for (const args of [{}, { path: null }, { path: 1 }, { path: '' }, { path: 'a\0b' }, { path: 'safe', executable: 'sh' }]) {
      expect(() => normalizeWorkspaceQuery('read_file', args)).toThrow('INVALID_WORKSPACE_QUERY')
    }
    expect(() => normalizeWorkspaceQuery('git_status', { argv: ['reset', '--hard'] })).toThrow('INVALID_WORKSPACE_QUERY')
  })

  it('rejects malformed search arguments without echoing the query', () => {
    for (const args of [{ query: '' }, { query: 'needle', is_regex: 'yes' }, { query: 'needle', subdirectory: 1 }, { query: 'PRIVATE[', is_regex: true }]) {
      expect(() => normalizeWorkspaceQuery('search_workspace', args)).toThrow('INVALID_WORKSPACE_QUERY: invalid workspace query arguments')
    }
  })

  it('rejects non-integral, non-finite and non-positive limits', () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity, '10', null]) {
      expect(() => normalizeWorkspaceQuery('git_log', { limit })).toThrow('INVALID_WORKSPACE_QUERY')
      expect(() => normalizeWorkspaceQuery('git_diff', { max_bytes: limit })).toThrow('INVALID_WORKSPACE_QUERY')
    }
  })

  it('does not accept Git option injection in a ref', () => {
    for (const against_ref of ['', '--output=/private/file', 5, null, 'bad\0ref']) {
      expect(() => normalizeWorkspaceQuery('git_diff', { against_ref })).toThrow('INVALID_WORKSPACE_QUERY')
    }
    expect(() => normalizeWorkspaceQuery('git_diff', { against_ref: 'HEAD~1' })).toThrow('INVALID_WORKSPACE_QUERY')
    expect(normalizeWorkspaceQuery('git_diff', { against_ref: 'a'.repeat(40) })).toEqual({ operation: 'git_diff', againstRef: 'a'.repeat(40), maxBytes: 262144 })
  })
})
