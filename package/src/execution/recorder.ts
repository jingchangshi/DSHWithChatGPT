/**
 * Execution recorder: structured, append-only record of DSH execution steps so
 * ChatGPT can independently verify claims like "tests passed" through the
 * read-only MCP data plane. Adapted from codex-with-chatgpt's execution
 * recorder (MIT, THIRD_PARTY_NOTICES.md): JSONL storage, secret redaction,
 * hard rejection of private-key material, output size caps.
 * @module execution
 */

import fs from 'node:fs'
import path from 'node:path'

/** Semantic classification of a recorded command. */
export type CommandKind =
  | 'build'
  | 'test'
  | 'lint'
  | 'typecheck'
  | 'git'
  | 'package-manager'
  | 'file-op'
  | 'other'

/** Execution outcome. */
export type ExecutionStatus = 'success' | 'failure' | 'timeout' | 'cancelled'

/** One recorded execution step. */
export interface ExecutionRecord {
  /** Monotonic id within the recorder (uuid-ish string). */
  id: string
  /** Task this step belongs to (D2C task id or 'adhoc'). */
  taskId: string
  /** Protocol iteration the step belongs to. */
  iteration: number
  /** Semantic kind. */
  kind: CommandKind
  /** Human-readable label, e.g. "vitest run". */
  label: string
  /** Sanitized command line (no env values, secrets redacted). */
  command: string
  /** Working directory relative to the workspace. */
  cwd: string
  startedAt: number
  endedAt: number
  status: ExecutionStatus
  exitCode: number | null
  /** Truncated stdout tail (capped). */
  stdoutTail: string
  /** Truncated stderr tail (capped). */
  stderrTail: string
  /** Whether output was truncated. */
  truncated: boolean
}

/** Recorder options. */
export interface RecorderOptions {
  /** Directory for the JSONL log (plugin state dir, NOT the workspace). */
  stateDir: string
  /** Max bytes of stdout/stderr tail kept per record (default 16 KiB). */
  outputCapBytes?: number
  /** Max output lines kept (default 200). */
  outputCapLines?: number
}

/** Token-shape patterns redacted from command lines and output. */
const REDACT_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  { name: 'github-pat', regex: /gh[pousr]_[A-Za-z0-9]{16,}/g, replacement: 'gh_*REDACTED*' },
  { name: 'aws-key', regex: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA*REDACTED*' },
  { name: 'bearer', regex: /[Bb]earer\s+[A-Za-z0-9\-_.~+/]+=*/g, replacement: 'Bearer *REDACTED*' },
  { name: 'sk-key', regex: /sk-[A-Za-z0-9]{16,}/g, replacement: 'sk-*REDACTED*' },
  { name: 'api-key-param', regex: /(api[_-]?key|token|secret|password|passwd|pwd)([=:])\s*[^\s&"']+/gi, replacement: '$1$2*REDACTED*' },
  { name: 'slack-token', regex: /xox[baprs]-[A-Za-z0-9\-]+/g, replacement: 'xox*REDACTED*' },
  { name: 'google-key', regex: /AIza[0-9A-Za-z\-_]{20,}/g, replacement: 'AIza*REDACTED*' },
  { name: 'npm-token', regex: /npm_[A-Za-z0-9]{16,}/g, replacement: 'npm_*REDACTED*' },
]

/** Private-key markers: records containing these are REJECTED, not redacted. */
const PRIVATE_KEY_MARKERS = [
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN DSA PRIVATE KEY-----',
  '-----BEGIN PGP PRIVATE KEY BLOCK-----',
]

/** Redact token-shaped secrets from a string. */
export function redact(text: string): string {
  let out = text
  for (const { regex, replacement } of REDACT_PATTERNS) {
    out = out.replace(regex, replacement)
  }
  return out
}

/** Whether text contains private-key material (hard reject, never stored). */
export function containsPrivateKey(text: string): boolean {
  const lower = text.toLowerCase()
  return PRIVATE_KEY_MARKERS.some(marker => lower.includes(marker.toLowerCase()))
}

/** Cap output to the last N bytes and last N lines. */
function capOutput(text: string, capBytes: number, capLines: number): { tail: string; truncated: boolean } {
  const lines = text.split(/\r?\n/)
  let truncated = lines.length > capLines
  let kept = truncated ? lines.slice(-capLines) : lines
  let out = kept.join('\n')
  if (Buffer.byteLength(out, 'utf8') > capBytes) {
    truncated = true
    const buf = Buffer.from(out, 'utf8')
    out = buf.subarray(buf.length - capBytes).toString('utf8')
    // Drop a possibly-split first line.
    const firstNewline = out.indexOf('\n')
    if (firstNewline >= 0) out = out.slice(firstNewline + 1)
  }
  return { tail: out, truncated }
}

/** Classify a command line into a semantic kind. */
export function classifyCommand(commandLine: string): CommandKind {
  const lower = commandLine.toLowerCase()
  if (/(^|\s|")(vitest|jest|mocha|pytest|go test|cargo test|dotnet test|mvn test|gradle test)/.test(lower)) return 'test'
  if (/(^|\s|")(tsc|typecheck|pyright|mypy|vue-tsc)/.test(lower)) return 'typecheck'
  if (/(^|\s|")(eslint|biome|prettier|flake8|ruff|clippy)/.test(lower)) return 'lint'
  if (/(^|\s|")(git)\s/.test(lower)) return 'git'
  if (/(^|\s|")(npm|pnpm|yarn|bun|pip|uv|cargo|dotnet)\s/.test(lower)) return 'package-manager'
  if (/(^|\s|")(vite|webpack|esbuild|rollup|turbopack|make|cmake|ninja|go build|cargo build)/.test(lower)) return 'build'
  if (/^(cp|mv|rm|mkdir|touch|echo)\s/.test(lower)) return 'file-op'
  return 'other'
}

let recordCounter = 0

/** Mint a record id. */
function mintRecordId(): string {
  recordCounter = (recordCounter + 1) % 1_000_000
  const ts = Date.now().toString(36)
  return `exec_${ts}_${recordCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`
}

/**
 * Append-only JSONL execution recorder. Lives in the plugin state dir
 * (outside any workspace) and is exposed read-only through the MCP bridge.
 */
export class ExecutionRecorder {
  private readonly logPath: string
  private readonly capBytes: number
  private readonly capLines: number

  constructor(options: RecorderOptions) {
    this.logPath = path.join(options.stateDir, 'executions.jsonl')
    this.capBytes = options.outputCapBytes ?? 16 * 1024
    this.capLines = options.outputCapLines ?? 200
    fs.mkdirSync(options.stateDir, { recursive: true })
  }

  /** Where the JSONL log lives. */
  get logFile(): string {
    return this.logPath
  }

  /**
   * Record a completed execution. Throws (and records NOTHING) when the
   * command line or output contains private-key material.
   */
  record(input: {
    taskId: string
    iteration: number
    command: string
    cwd: string
    startedAt: number
    endedAt: number
    status: ExecutionStatus
    exitCode: number | null
    stdout: string
    stderr: string
    kind?: CommandKind
  }): ExecutionRecord {
    if (containsPrivateKey(input.command) || containsPrivateKey(input.stdout) || containsPrivateKey(input.stderr)) {
      throw new Error('execution output contains private-key material; refusing to record')
    }
    const stdout = capOutput(redact(input.stdout), this.capBytes, this.capLines)
    const stderr = capOutput(redact(input.stderr), this.capBytes, this.capLines)
    const record: ExecutionRecord = {
      id: mintRecordId(),
      taskId: input.taskId,
      iteration: input.iteration,
      kind: input.kind ?? classifyCommand(input.command),
      label: input.command.split(/\s+/).slice(0, 3).join(' '),
      command: redact(input.command),
      cwd: redact(input.cwd),
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      status: input.status,
      exitCode: input.exitCode,
      stdoutTail: stdout.tail,
      stderrTail: stderr.tail,
      truncated: stdout.truncated || stderr.truncated,
    }
    fs.appendFileSync(this.logPath, JSON.stringify(record) + '\n', 'utf8')
    return record
  }

  /** List records, newest last, optionally filtered by task. */
  list(filter?: { taskId?: string; kind?: CommandKind; limit?: number }): ExecutionRecord[] {
    if (!fs.existsSync(this.logPath)) return []
    const raw = fs.readFileSync(this.logPath, 'utf8')
    const records: ExecutionRecord[] = []
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        records.push(JSON.parse(line) as ExecutionRecord)
      } catch {
        // Corrupt line: skip, never fail the read path.
      }
    }
    let out = records
    if (filter?.taskId !== undefined) out = out.filter(r => r.taskId === filter.taskId)
    if (filter?.kind !== undefined) out = out.filter(r => r.kind === filter.kind)
    const limit = filter?.limit ?? 100
    return out.slice(-limit)
  }

  /** One record by id. */
  get(id: string): ExecutionRecord | undefined {
    return this.list({ limit: 10_000 }).find(r => r.id === id)
  }

  /** Compact summary for MCP test_status / execution_summary. */
  summarize(filter?: { taskId?: string; iteration?: number; limit?: number }): {
    total: number
    byKind: Record<string, number>
    byStatus: Record<string, number>
    latestTest?: { id: string; status: ExecutionStatus; exitCode: number | null; label: string; endedAt: number }
  } {
    let records = this.list({ taskId: filter?.taskId, limit: filter?.limit ?? 500 })
    if (filter?.iteration !== undefined) records = records.filter(r => r.iteration === filter.iteration)
    const byKind: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    for (const r of records) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    }
    const latestTest = [...records].reverse().find(r => r.kind === 'test')
    return {
      total: records.length,
      byKind,
      byStatus,
      ...(latestTest !== undefined
        ? {
            latestTest: {
              id: latestTest.id,
              status: latestTest.status,
              exitCode: latestTest.exitCode,
              label: latestTest.label,
              endedAt: latestTest.endedAt,
            },
          }
        : {}),
    }
  }
}
