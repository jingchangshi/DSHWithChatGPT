/**
 * Read-only git snapshot helpers for the MCP data plane. Every command is
 * constructed with fixed arguments — the only variable part is the workspace
 * root, which is validated by the caller — and output is fail-closed: a git
 * error produces a typed result, never a shell or write path. Diff batching
 * (pathspec batches, argv caps) adapted from codex-with-chatgpt (MIT,
 * THIRD_PARTY_NOTICES.md).
 * @module workspace
 */

/** An execution-world-bound Git process; callers cannot select an executable or shell. */
export interface WorkspaceGitExecutor {
  readonly emptyFile?: 'NUL' | '/dev/null'
  readonly signal: AbortSignal
  execute(args: readonly string[], options: { maxBytes: number; timeoutMs: number; signal: AbortSignal }): Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>
}

/** Max argv bytes for one git invocation before batching (conservative). */
const MAX_ARGV_BYTES = 32 * 1024
/** Max paths per diff batch. */
const MAX_BATCH_PATHS = 50
/** Max total diff bytes returned. */
export const MAX_DIFF_BYTES = 256 * 1024

/** Typed git failure. */
export class GitError extends Error {
  readonly reason: string
  constructor(reason: string, message: string) {
    super('GIT_' + reason + ': ' + message)
    this.name = 'GitError'
    this.reason = reason
  }
}

/** Run one fixed-argument git command in the workspace. */
async function git(executor: WorkspaceGitExecutor, args: readonly string[], maxBytes = 4 * 1024 * 1024, allowDifferences = false): Promise<string> {
  if (executor.signal.aborted) throw new GitError('CANCELLED', 'execution cancelled')
  try {
    const { stdout, stderr, exitCode } = await executor.execute(['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
      maxBytes,
      timeoutMs: 20_000,
      signal: executor.signal,
    })
    if (executor.signal.aborted) throw new GitError('CANCELLED', 'execution cancelled')
    if (exitCode !== 0 && !(allowDifferences && exitCode === 1)) {
      if (/not a git repository/i.test(stderr)) throw new GitError('NOT_A_REPOSITORY', 'workspace is not a git repository')
      throw new GitError('COMMAND_FAILED', 'Git command failed')
    }
    return stdout
  } catch (error) {
    if (error instanceof GitError) throw error
    if (executor.signal.aborted) throw new GitError('CANCELLED', 'execution cancelled')
    throw new GitError('EXECUTION_FAILED', 'Git execution unavailable')
  }
}

function absentRef(error: unknown): null {
  if (error instanceof GitError && (error.reason === 'COMMAND_FAILED' || error.reason === 'NOT_A_REPOSITORY')) return null
  throw error
}

/** Shallow repository status. */
export interface GitStatusSnapshot {
  isRepo: boolean
  head: string | null
  branch: string | null
  dirty: boolean
  /** Tracking branch, when configured (for example origin/feature). */
  upstream: string | null
  /** Upstream commit currently observed. */
  upstreamHead: string | null
  /** Commits local HEAD is ahead of upstream; null when no upstream. */
  ahead: number | null
  /** Commits local HEAD is behind upstream; null when no upstream. */
  behind: number | null
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

/** Read git status (porcelain v1 with -z NUL separation). */
export async function gitStatus(executor: WorkspaceGitExecutor): Promise<GitStatusSnapshot> {
  const headOut = await git(executor, ['rev-parse', '--verify', 'HEAD']).catch(absentRef)
  if (headOut === null) {
    // Either not a repo, or a repo with no commits yet. Distinguish via
    // rev-parse --is-inside-work-tree, which succeeds in any repo.
    const isRepo = await git(executor, ['rev-parse', '--is-inside-work-tree']).catch(absentRef)
    if (isRepo === null) {
      return {
        isRepo: false, head: null, branch: null, dirty: false,
        upstream: null, upstreamHead: null, ahead: null, behind: null,
        staged: [], unstaged: [], untracked: [],
      }
    }
    const branch = await git(executor, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(absentRef)
    const statusOut = await git(executor, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const { staged, unstaged, untracked } = classifyStatus(statusOut)
    return {
      isRepo: true,
      head: null,
      branch: branch === 'HEAD' ? null : branch,
      dirty: staged.length + unstaged.length + untracked.length > 0,
      upstream: null,
      upstreamHead: null,
      ahead: null,
      behind: null,
      staged,
      unstaged,
      untracked,
    }
  }
  const branchOut = await git(executor, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
  const upstreamOut = await git(executor, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(absentRef)
  const upstream = upstreamOut?.trim() || null
  const upstreamHeadOut = upstream === null
    ? null
    : await git(executor, ['rev-parse', '--verify', '@{u}']).catch(absentRef)
  const countsOut = upstream === null
    ? null
    : await git(executor, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']).catch(absentRef)
  const counts = countsOut?.trim().split(/\s+/).map(Number)
  const ahead = counts !== undefined && counts.length >= 2 && Number.isSafeInteger(counts[0])
    ? counts[0]!
    : null
  const behind = counts !== undefined && counts.length >= 2 && Number.isSafeInteger(counts[1])
    ? counts[1]!
    : null
  const statusOut = await git(executor, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const { staged, unstaged, untracked } = classifyStatus(statusOut)
  return {
    isRepo: true,
    head: headOut.trim(),
    branch: branchOut.trim() || null,
    dirty: staged.length + unstaged.length + untracked.length > 0,
    upstream,
    upstreamHead: upstreamHeadOut?.trim() || null,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
  }
}

function classifyStatus(statusOut: string): Pick<GitStatusSnapshot, 'staged' | 'unstaged' | 'untracked'> {
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []
  for (const entry of parsePorcelainZ(statusOut)) {
    if (entry.x === '?' || entry.x === '!') untracked.push(entry.path)
    else {
      if (entry.x !== ' ') staged.push(entry.path)
      if (entry.y !== ' ') unstaged.push(entry.path)
    }
  }
  return { staged, unstaged, untracked }
}

/** One porcelain v1 -z entry. */
interface PorcelainEntry {
  x: string
  y: string
  path: string
}

/** Parse NUL-separated porcelain v1 entries defensively. */
function parsePorcelainZ(raw: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = []
  const segments = raw.split('\0')
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? ''
    if (segment.length < 4) continue
    const x = segment[0] ?? ' '
    const y = segment[1] ?? ' '
    const filePath = segment.slice(3)
    if (filePath === '') continue
    entries.push({ x, y, path: filePath })
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index++
  }
  return entries
}

/** Options for diff retrieval. */
export interface DiffOptions {
  /** Diff against this ref instead of HEAD (e.g. a reviewed SHA). */
  againstRef?: string
  /** Include staged + unstaged working tree (default true). */
  workingTree?: boolean
  /** Cap total bytes (default MAX_DIFF_BYTES). */
  maxBytes?: number
}

/** One batched diff result. */
export interface DiffResult {
  text: string
  truncated: boolean
  /** Ref or mode the diff was computed against. */
  against: string
  batches: number
}

/**
 * Working-tree diff, batched with literal pathspecs when the changed-path
 * list is large. Fail-closed: git errors become GitError, no shell involved.
 */
export async function gitDiff(executor: WorkspaceGitExecutor, options: DiffOptions = {}): Promise<DiffResult> {
  const against = options.againstRef ?? 'HEAD'
  const maxBytes = options.maxBytes ?? MAX_DIFF_BYTES
  const status = await gitStatus(executor)
  if (!status.isRepo) throw new GitError('NOT_A_REPOSITORY', 'workspace is not a git repository')

  const changed = options.againstRef === undefined ? [...new Set([...status.staged, ...status.unstaged])] : []
  const untracked = options.workingTree === false ? [] : status.untracked
  // With no commits yet there is no HEAD; git diff (no ref) diffs the index
  // against the worktree, which covers staged changes. Explicit refs pass
  // through untouched.
  const noCommits = status.head === null && options.againstRef === undefined
  const fixedDiff = ['diff', '--no-ext-diff', '--no-textconv']
  const baseArgs = options.workingTree === false
    ? (noCommits ? [...fixedDiff, '--cached'] : [...fixedDiff, against])
    : (noCommits ? fixedDiff : [...fixedDiff, against, '--'])
  // git diff (index/tree mode) never shows untracked content. If everything
  // changed is untracked, produce the diff with --no-index against the
  // Windows NUL device (empty baseline), keeping the same output format.
  const useNoIndex = changed.length === 0 && untracked.length > 0 && options.againstRef === undefined
  const diffAgainst = useNoIndex ? 'EMPTY_TREE' : against

  let text = ''
  let batches = 1
  let truncatedInternal = false
  if (useNoIndex) {
    const parts: string[] = []
    let acc = 0
    let anyTruncated = false
    for (const p of untracked) {
      const out = await gitNoIndex(executor, p, maxBytes + 1024)
      parts.push(out)
      acc += Buffer.byteLength(out, 'utf8')
      if (acc > maxBytes) {
        anyTruncated = true
        break
      }
    }
    text = parts.join('')
    truncatedInternal = anyTruncated
    batches = untracked.length
  } else if (changed.length === 0) {
    text = await git(executor, baseArgs, maxBytes + 1024)
  } else if (changed.length <= MAX_BATCH_PATHS) {
    const argvBytes = baseArgs.join(' ').length + changed.join(' ').length
    if (argvBytes <= MAX_ARGV_BYTES) {
      text = await git(executor, [...baseArgs, ...changed.map(p => ':(literal)' + p)], maxBytes + 1024)
    } else {
      text = await git(executor, baseArgs, maxBytes + 1024)
    }
  } else {
    // Batch pathspecs to keep argv bounded.
    batches = Math.ceil(changed.length / MAX_BATCH_PATHS)
    const chunks: string[][] = []
    for (let i = 0; i < changed.length; i += MAX_BATCH_PATHS) {
      chunks.push(changed.slice(i, i + MAX_BATCH_PATHS))
    }
    const parts: string[] = []
    let acc = 0
    for (const chunk of chunks) {
      const out = await git(executor, [...baseArgs, ...chunk.map(p => ':(literal)' + p)], maxBytes + 1024)
      parts.push(out)
      acc += Buffer.byteLength(out, 'utf8')
      if (acc > maxBytes) break
    }
    text = parts.join('')
  }

  if (noCommits && options.workingTree !== false && status.staged.length > 0) {
    const cached = await git(executor, [...fixedDiff, '--cached'], maxBytes + 1024)
    text = cached + text
    batches++
  }
  if (!useNoIndex && untracked.length > 0) {
    for (const filePath of untracked) {
      if (Buffer.byteLength(text, 'utf8') > maxBytes) { truncatedInternal = true; break }
      text += await gitNoIndex(executor, filePath, maxBytes + 1024)
      batches++
    }
  }

  let truncated = truncatedInternal
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const buf = Buffer.from(text, 'utf8')
    text = buf.subarray(0, maxBytes).toString('utf8')
    truncated = true
  }
  return { text, truncated, against: diffAgainst, batches }
}

/**
 * One untracked file's diff via --no-index against the empty device. Exit
 * code 1 means "differences found" and is expected; output is still returned.
 */
async function gitNoIndex(executor: WorkspaceGitExecutor, relPath: string, maxBytes: number): Promise<string> {
  if (executor.emptyFile === undefined) throw new GitError('EMPTY_FILE_UNAVAILABLE', 'provider empty-file capability unavailable')
  return git(executor, ['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', executor.emptyFile, relPath], maxBytes, true)
}

/** Recent commits (hash, subject) newest first. */
export async function gitLog(executor: WorkspaceGitExecutor, limit = 10): Promise<Array<{ hash: string; subject: string }>> {
  const out = await git(executor, ['log', '--max-count=' + limit, '--pretty=format:%H %s'])
  return out.split('\n').filter(l => l.trim() !== '').map(line => {
    const idx = line.indexOf(' ')
    return { hash: line.slice(0, idx), subject: line.slice(idx + 1) }
  })
}
