/**
 * The nine read-only MCP tools ChatGPT calls through the bridge. Every tool
 * goes through the workspace boundary (containment + sensitive policy) and
 * returns bounded JSON. There is deliberately NO tool here (or anywhere) that
 * writes, deletes, executes, or commits.
 * @module bridge
 */

import fs from 'node:fs'
import path from 'node:path'
import { SensitivePolicy, WorkspaceError, NOISE_PATTERNS, IgnoreMatcher, resolveContained } from '../workspace/index.ts'
import { GitError, gitDiff, gitLog, gitStatus } from '../workspace/git.ts'
import type { ExecutionRecorder } from '../execution/recorder.ts'
import type { McpToolDefinition } from './server.ts'
import { workspaceIdentity } from '../workspace/identity.ts'

/** Workspace context every tool call is scoped to. */
export interface WorkspaceSpec {
  /** Canonical absolute workspace root. */
  root: string
  /** Sensitive policy (defaults + .d2cignore). */
  policy: SensitivePolicy
  /** Execution recorder backing test_status / execution_* tools. */
  recorder: ExecutionRecorder
}

/** Load .d2cignore from the workspace root (additive deny list). */
export function loadWorkspaceSpec(root: string, recorder: ExecutionRecorder): WorkspaceSpec {
  let extra: string[] = []
  try {
    const ignorePath = path.join(root, '.d2cignore')
    if (fs.existsSync(ignorePath)) {
      extra = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/)
    }
  } catch {
    extra = []
  }
  return { root, policy: new SensitivePolicy(extra), recorder }
}

/** Max bytes returned by read_file. */
const READ_FILE_CAP = 128 * 1024
/** Max files listed per directory. */
const LIST_CAP = 500
/** Max search matches. */
const SEARCH_CAP = 200
/** Max search file size. */
const SEARCH_FILE_CAP = 512 * 1024

/** Tool 1: workspace_info. */
export function workspaceInfoTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'workspace_info',
    description: 'Get workspace root info: name, git state summary, ignored-file policy. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const git = await gitStatus(spec.root).catch((error: unknown) => {
        if (error instanceof GitError && error.reason === 'NOT_A_REPOSITORY') return null
        throw error
      })
      return {
        workspaceId: workspaceIdentity(spec.root),
        name: path.basename(spec.root),
        isGitRepo: git !== null,
        ...(git !== null
          ? { head: git.head, branch: git.branch, dirty: git.dirty }
          : {}),
        ignoreFile: '.d2cignore',
        readOnly: true,
      }
    },
  }
}

/** Tool 2: list_directory. */
export function listDirectoryTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'list_directory',
    description: 'List one directory inside the workspace (relative path, "." for root). Skips noise dirs (node_modules, .git, dist...) and sensitive files. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path relative to workspace root; "." or "" for root.' } },
      additionalProperties: false,
    },
    async handler(args) {
      const requested = typeof args['path'] === 'string' && args['path'] !== '' ? args['path'] : '.'
      const { abs, rel } = resolveContained(spec.root, requested)
      const noise = new IgnoreMatcher(NOISE_PATTERNS)
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') throw new WorkspaceError('INVALID_PATH', 'directory not found: ' + rel)
        throw error
      }
      const listed: Array<{ name: string; type: 'file' | 'dir'; sensitive: boolean }> = []
      let hiddenSensitive = 0
      let truncated = false
      for (const entry of entries) {
        if (listed.length >= LIST_CAP) {
          truncated = true
          break
        }
        const relEntry = rel === '' ? entry.name : rel + '/' + entry.name
        const isDir = entry.isDirectory()
        if (noise.matches(relEntry, isDir)) continue
        if (spec.policy.isSensitive(relEntry, isDir)) {
          hiddenSensitive++
          continue
        }
        listed.push({ name: entry.name, type: isDir ? 'dir' : 'file', sensitive: false })
      }
      return { path: rel, entries: listed, hiddenSensitiveCount: hiddenSensitive, truncated }
    },
  }
}

/** Tool 3: read_file. */
export function readFileTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'read_file',
    description: 'Read one file inside the workspace (UTF-8, capped at 128KiB with head+tail). Sensitive files are denied. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to workspace root.' } },
      required: ['path'],
      additionalProperties: false,
    },
    async handler(args) {
      const requested = args['path']
      if (typeof requested !== 'string') throw new WorkspaceError('INVALID_PATH', 'path must be a string')
      const { abs, rel } = resolveContained(spec.root, requested)
      if (spec.policy.isSensitive(rel, false)) {
        throw new WorkspaceError('ACCESS_DENIED_SENSITIVE_FILE', rel + ' is denied by the sensitive-file policy')
      }
      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        throw new WorkspaceError('INVALID_PATH', 'file not found: ' + rel)
      }
      if (stat.isDirectory()) throw new WorkspaceError('INVALID_PATH', 'path is a directory: ' + rel)
      const cap = READ_FILE_CAP
      const truncated = stat.size > cap
      const fd = fs.openSync(abs, 'r')
      try {
        if (!truncated) {
          const content = Buffer.alloc(stat.size)
          fs.readSync(fd, content, 0, stat.size, 0)
          return { path: rel, sizeBytes: stat.size, truncated: false, content: content.toString('utf8') }
        }
        const head = Buffer.alloc(cap / 2)
        const tail = Buffer.alloc(cap / 2)
        fs.readSync(fd, head, 0, cap / 2, 0)
        fs.readSync(fd, tail, 0, cap / 2, stat.size - cap / 2)
        return {
          path: rel,
          sizeBytes: stat.size,
          truncated: true,
          content: head.toString('utf8') + '\n...[truncated]...\n' + tail.toString('utf8'),
        }
      } finally {
        fs.closeSync(fd)
      }
    },
  }
}

/** Tool 4: search_workspace (literal/regex text search, bounded). */
export function searchWorkspaceTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'search_workspace',
    description: 'Search file contents inside the workspace for a pattern (literal by default, regex with is_regex). Bounded: skips noise/sensitive/binary/huge files, max 200 matches. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex to search for.' },
        is_regex: { type: 'boolean', description: 'Treat query as a regular expression (default false).' },
        subdirectory: { type: 'string', description: 'Optional subdirectory scope.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async handler(args) {
      const query = args['query']
      if (typeof query !== 'string' || query === '') throw new WorkspaceError('INVALID_PATH', 'query must be a non-empty string')
      const isRegex = args['is_regex'] === true
      let matcher: RegExp
      try {
        matcher = new RegExp(isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      } catch (error) {
        throw new WorkspaceError('INVALID_PATH', 'invalid regex: ' + (error instanceof Error ? error.message : 'unknown'))
      }
      const { abs: scopeAbs } = resolveContained(spec.root, typeof args['subdirectory'] === 'string' && args['subdirectory'] !== '' ? args['subdirectory'] : '.')
      const noise = new IgnoreMatcher(NOISE_PATTERNS)
      const matches: Array<{ path: string; line: number; text: string }> = []
      const walk = (dir: string, relDir: string): void => {
        if (matches.length >= SEARCH_CAP) return
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (matches.length >= SEARCH_CAP) return
          const relEntry = relDir === '' ? entry.name : relDir + '/' + entry.name
          if (entry.isDirectory()) {
            if (!noise.matches(relEntry, true) && !spec.policy.isSensitive(relEntry, true)) {
              walk(path.join(dir, entry.name), relEntry)
            }
            continue
          }
          if (!entry.isFile()) continue
          if (noise.matches(relEntry, false) || spec.policy.isSensitive(relEntry, false)) continue
          let stat: fs.Stats
          try {
            stat = fs.statSync(path.join(dir, entry.name))
          } catch {
            continue
          }
          if (stat.size > SEARCH_FILE_CAP || stat.size === 0) continue
          let content: string
          try {
            content = fs.readFileSync(path.join(dir, entry.name), 'utf8')
          } catch {
            continue
          }
          if (content.includes('\0')) continue // binary
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length && matches.length < SEARCH_CAP; i++) {
            const lineText = lines[i] ?? ''
            matcher.lastIndex = 0
            if (matcher.test(lineText)) {
              matches.push({ path: relEntry, line: i + 1, text: lineText.slice(0, 300) })
            }
          }
        }
      }
      walk(scopeAbs, '')
      return { query, matches, matchCount: matches.length, truncated: matches.length >= SEARCH_CAP }
    },
  }
}

/** Tool 5: git_status. */
export function gitStatusTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'git_status',
    description: 'Git status snapshot: HEAD, branch, dirty flag, staged/unstaged/untracked file lists. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      return gitStatus(spec.root)
    },
  }
}

/** Tool 6: git_diff. */
export function gitDiffTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'git_diff',
    description: 'Working-tree diff vs HEAD (or an explicit ref), byte-capped. Includes untracked file content. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        against_ref: { type: 'string', description: 'Diff against this git ref instead of HEAD.' },
        max_bytes: { type: 'number', description: 'Cap diff size in bytes (default 262144).' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      const againstRef = typeof args['against_ref'] === 'string' && args['against_ref'] !== ''
        ? args['against_ref']
        : undefined
      const maxBytes = typeof args['max_bytes'] === 'number' && args['max_bytes'] > 0
        ? Math.min(args['max_bytes'], 1024 * 1024)
        : undefined
      return gitDiff(spec.root, { ...(againstRef !== undefined ? { againstRef } : {}), ...(maxBytes !== undefined ? { maxBytes } : {}) })
    },
  }
}

/** Tool 7: git_log. */
export function gitLogTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'git_log',
    description: 'Recent commits (hash + subject), newest first. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max commits (default 10, max 50).' } },
      additionalProperties: false,
    },
    async handler(args) {
      const limit = typeof args['limit'] === 'number' && args['limit'] > 0 ? Math.min(Math.floor(args['limit']), 50) : 10
      return { commits: await gitLog(spec.root, limit) }
    },
  }
}

/** Tool 8: test_status. */
export function testStatusTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'test_status',
    description: 'Execution-record summary focused on test runs: latest test command, status, exit code, plus overall counts. Backed by structured execution records, not natural-language claims. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Optional D2C task id filter.' } },
      additionalProperties: false,
    },
    async handler(args) {
      const taskId = typeof args['task_id'] === 'string' && args['task_id'] !== '' ? args['task_id'] : undefined
      const summary = spec.recorder.summarize(taskId !== undefined ? { taskId } : {})
      return summary
    },
  }
}

/** Tool 9: execution_summary. */
export function executionSummaryTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'execution_summary',
    description: 'Summary of recorded execution steps (kinds, statuses, latest entries). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Optional task id filter.' },
        iteration: { type: 'number', description: 'Optional iteration filter.' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      const taskId = typeof args['task_id'] === 'string' && args['task_id'] !== '' ? args['task_id'] : undefined
      const iteration = typeof args['iteration'] === 'number' ? Math.floor(args['iteration']) : undefined
      return spec.recorder.summarize({
        ...(taskId !== undefined ? { taskId } : {}),
        ...(iteration !== undefined ? { iteration } : {}),
      })
    },
  }
}

/** Tool 10: execution_output. */
export function executionOutputTool(spec: WorkspaceSpec): McpToolDefinition {
  return {
    name: 'execution_output',
    description: 'One execution record by id, including capped stdout/stderr tails (secrets redacted). Read-only.',
    inputSchema: {
      type: 'object',
      properties: { execution_id: { type: 'string', description: 'Execution record id.' } },
      required: ['execution_id'],
      additionalProperties: false,
    },
    async handler(args) {
      const id = args['execution_id']
      if (typeof id !== 'string') throw new WorkspaceError('INVALID_PATH', 'execution_id must be a string')
      const record = spec.recorder.get(id)
      if (record === undefined) throw new WorkspaceError('INVALID_PATH', 'unknown execution id: ' + id)
      return record
    },
  }
}

/** Assemble every read-only tool bound to one workspace. */
export function buildWorkspaceTools(spec: WorkspaceSpec): McpToolDefinition[] {
  const tools = [
    workspaceInfoTool(spec),
    listDirectoryTool(spec),
    readFileTool(spec),
    searchWorkspaceTool(spec),
    gitStatusTool(spec),
    gitDiffTool(spec),
    gitLogTool(spec),
    testStatusTool(spec),
    executionSummaryTool(spec),
    executionOutputTool(spec),
  ]
  for (const tool of tools) {
    if (!tool.name.startsWith('workspace_') && !tool.name.startsWith('list_') && !tool.name.startsWith('read_')
      && !tool.name.startsWith('search_') && !tool.name.startsWith('git_') && !tool.name.startsWith('test_')
      && !tool.name.startsWith('execution_')) {
      throw new Error('tool name outside read-only namespace: ' + tool.name)
    }
  }
  return tools
}
