/**
 * Workspace boundary: canonical realpath containment, sensitive-file policy,
 * and the additive project ignore file (.d2cignore). Adapted from
 * codex-with-chatgpt's workspace/manager.ts algorithm (MIT, see
 * THIRD_PARTY_NOTICES.md) — realpath the deepest existing ancestor so symlinks
 * are resolved even for not-yet-existing leaf segments, and compare
 * case-insensitively where the platform filesystem does.
 * @module workspace
 */

import fs from 'node:fs'
import path from 'node:path'

/** Whether this platform's filesystem is case-insensitive in practice. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/** Normalize case on case-insensitive platforms for containment comparison. */
function normCase(value: string): string {
  return CASE_INSENSITIVE ? value.toLowerCase() : value
}

/** Machine error for boundary violations. */
export class WorkspaceError extends Error {
  /** Stable reason (PATH_OUTSIDE_WORKSPACE, INVALID_PATH, ACCESS_DENIED_SENSITIVE_FILE). */
  readonly reason: string

  constructor(reason: string, message: string) {
    super(reason + ': ' + message)
    this.name = 'WorkspaceError'
    this.reason = reason
  }
}

/** Sensitive deny patterns, gitignore semantics, evaluated with the matcher implemented below. */
const SENSITIVE_PATTERNS: readonly string[] = [
  '.env',
  '.env.*',
  '!.env.example',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa*',
  'id_ed25519*',
  'id_ecdsa*',
  'id_dsa*',
  '.ssh/',
  '.aws/',
  '.gnupg/',
  '.npmrc',
  '.netrc',
  '_netrc',
  '.git-credentials',
  '*.keychain',
  '*.keychain-db',
  '.cloudflared/',
  'credentials.json',
  'credentials.yaml',
  'credentials.yml',
  'service-account*.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'cookies.sqlite',
  'Cookies',
  '.dsh-credentials*',
  '.credentials.yaml',
  '.d2c-secrets*',
]

/** Noise directories/files hidden from listings (not errors). */
export const NOISE_PATTERNS: readonly string[] = [
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  'coverage/',
  '.cache/',
  '.turbo/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.pytest_cache/',
  '.mypy_cache/',
  'target/',
  '.gradle/',
  '.idea/',
  '.pnpm-store/',
  '.DS_Store',
  'lib/',
  'tsconfig.tsbuildinfo',
]

/**
 * Minimal gitignore-semantics matcher for the pattern vocabulary this module
 * declares (no external dependency): supports literal names, dir patterns
 * with a trailing slash, star/extension globs, double-star prefixes,
 * negation with a leading exclamation mark, and comments/blank lines.
 * Only what the deny-list and user .d2cignore realistically need.
 * Anything the matcher cannot interpret is treated as a literal name.
 */
export class IgnoreMatcher {
  private readonly rules: Array<{ pattern: string; negated: boolean; dirOnly: boolean; regex: RegExp }> = []

  constructor(patterns: readonly string[]) {
    for (const raw of patterns) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) continue
      const negated = line.startsWith('!')
      const body = negated ? line.slice(1) : line
      const dirOnly = body.endsWith('/')
      const clean = dirOnly ? body.slice(0, -1) : body
      this.rules.push({ pattern: clean, negated, dirOnly, regex: IgnoreMatcher.compile(clean, dirOnly) })
    }
  }

  /** Whether a workspace-relative posix path (file or dir) is matched. */
  matches(relPath: string, isDir = false): boolean {
    const normalized = relPath.split(path.sep).join('/').replace(/^\.\//, '')
    let matched = false
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir && !normalized.includes('/')) continue
      if (rule.regex.test(normalized)) matched = !rule.negated
    }
    return matched
  }

  private static compile(pattern: string, dirOnly: boolean): RegExp {
    // Translate gitignore vocabulary: double-star crosses directories,
    // star/question stay within one segment, everything else is escaped.
    let source = ''
    let index = 0
    while (index < pattern.length) {
      const ch = pattern[index]
      if (ch === '*') {
        if (pattern[index + 1] === '*') {
          source += '.*'
          index += 2
        } else {
          source += '[^/]*'
          index += 1
        }
        continue
      }
      if (ch === '?') {
        source += '[^/]'
        index += 1
        continue
      }
      if (ch === '$' || ch === '^' || ch === '+' || ch === '.' || ch === '{' || ch === '}'
        || ch === '(' || ch === ')' || ch === '|' || ch === '[' || ch === ']' || ch === '\\') {
        source += '\\' + ch
        index += 1
        continue
      }
      source += ch
      index += 1
    }
    const head = '(?:^|/)'
    const tail = dirOnly ? '(?:/.*)?$' : '$'
    return new RegExp(head + source + tail)
  }
}

/** Sensitive matcher: defaults + user .d2cignore (additive; cannot un-deny). */
export class SensitivePolicy {
  private readonly defaults: IgnoreMatcher
  private readonly extra: IgnoreMatcher

  constructor(extraPatterns: readonly string[] = []) {
    this.defaults = new IgnoreMatcher(SENSITIVE_PATTERNS)
    this.extra = new IgnoreMatcher(extraPatterns)
  }

  /** Whether the relative path is denied for ChatGPT reads. */
  isSensitive(relPath: string, isDir = false): boolean {
    return this.defaults.matches(relPath, isDir) || this.extra.matches(relPath, isDir)
  }
}

/** Realpath the deepest existing ancestor; joins the unresolved suffix back. */
export function canonicalize(abs: string): string {
  let current = abs
  const suffix: string[] = []
  for (;;) {
    try {
      const real = fs.realpathSync.native(current)
      return suffix.length > 0 ? path.join(real, ...suffix) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return abs
      suffix.unshift(path.basename(current))
      current = parent
    }
  }
}

/** Resolve + containment check. Returns the canonical absolute path and a posix relative path. */
export function resolveContained(
  root: string,
  requested: string,
): { abs: string; rel: string } {
  if (typeof requested !== 'string' || requested.includes('\0')) {
    throw new WorkspaceError('INVALID_PATH', 'path must be a string without null bytes')
  }
  let p = requested.trim()
  if (p === '' || p === '/' || p === '.') p = '.'
  p = p.replace(/\\/g, '/')
  p = p.replace(/^workspace:\/*/i, '')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) && !/^[a-zA-Z]:\//.test(p)) {
    // Remaining URL scheme (file://, http://): reject. Windows drive letters
    // were normalized above and are still accepted after containment check.
    const quoted = JSON.stringify(requested)
    throw new WorkspaceError('INVALID_PATH', 'refusing scheme-like path ' + quoted)
  }
  const abs = path.resolve(root, p)
  const canonical = canonicalize(abs)
  const r = normCase(root)
  const c = normCase(canonical)
  if (c !== r && !c.startsWith(r + path.sep)) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', String(requested) + ' resolves outside the workspace')
  }
  const rel = path.relative(root, canonical).split(path.sep).join('/')
  if (rel.startsWith('..')) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', String(requested) + ' resolves outside the workspace')
  }
  return { abs: canonical, rel }
}
