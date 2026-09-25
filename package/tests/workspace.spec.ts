import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  IgnoreMatcher,
  SensitivePolicy,
  WorkspaceError,
  canonicalize,
  resolveContained,
} from '../src/workspace/boundary.ts'

let root: string

/**
 * Whether this host lets the test process create symlinks. Windows requires
 * Developer Mode or an elevated process, and the escape tests are meaningless
 * without one, so they skip instead of failing for a missing host privilege.
 * @returns true when a probe symlink could be created.
 */
function canCreateSymlinks(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-symlink-probe-'))
  try {
    const target = path.join(probe, 'target.txt')
    fs.writeFileSync(target, 'probe')
    fs.symlinkSync(target, path.join(probe, 'link.txt'), 'file')
    return true
  } catch {
    return false
  } finally {
    fs.rmSync(probe, { recursive: true, force: true })
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-ws-'))
  root = fs.realpathSync(root)
  fs.writeFileSync(path.join(root, 'README.md'), 'hello')
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export {}')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveContained', () => {
  it('resolves simple relative paths', () => {
    const { rel } = resolveContained(root, 'src/index.ts')
    expect(rel).toBe('src/index.ts')
  })

  it('accepts workspace root itself', () => {
    const { rel } = resolveContained(root, '.')
    expect(rel).toBe('')
  })

  it('rejects ../ escape', () => {
    expect(() => resolveContained(root, '../outside.txt')).toThrow(WorkspaceError)
    expect(() => resolveContained(root, 'src/../../escape.txt')).toThrow(WorkspaceError)
  })

  it('rejects absolute escape', () => {
    expect(() => resolveContained(root, os.tmpdir())).toThrow(WorkspaceError)
  })

  it('rejects null bytes and URL-scheme tricks', () => {
    expect(() => resolveContained(root, 'a\0b')).toThrow(WorkspaceError)
    expect(() => resolveContained(root, 'file:///etc/passwd')).toThrow(WorkspaceError)
    expect(() => resolveContained(root, 'workspace:/src')).not.toThrow()
  })

  it('resolves symlink escape via deepest-existing-ancestor canonicalization', { skip: !canCreateSymlinks() }, () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-out-'))
    try {
      const secret = path.join(outside, 'secret.txt')
      fs.writeFileSync(secret, 'top secret')
      const link = path.join(root, 'leak')
      fs.symlinkSync(secret, link, 'file')
      expect(() => resolveContained(root, 'leak')).toThrow(WorkspaceError)

      // Nested: symlinked DIRECTORY inside a symlinked dir chain
      const dirLink = path.join(root, 'dirlink')
      fs.symlinkSync(outside, dirLink, 'dir')
      expect(() => resolveContained(root, 'dirlink/secret.txt')).toThrow(WorkspaceError)

      // Not-yet-existing leaf under a symlinked parent still resolves out.
      expect(() => resolveContained(root, 'dirlink/newfile.txt')).toThrow(WorkspaceError)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('allows paths through a symlink chain that stays inside', { skip: !canCreateSymlinks() }, () => {
    const realDir = path.join(root, 'real')
    fs.mkdirSync(realDir)
    const link = path.join(root, 'inside-link')
    fs.symlinkSync(realDir, link, 'dir')
    const { rel } = resolveContained(root, 'inside-link/file.txt')
    expect(rel).toBe(path.join('real', 'file.txt').split(path.sep).join('/'))
  })

  it('is case-insensitive on Windows', { skip: process.platform !== 'win32' }, () => {
    const { rel } = resolveContained(root, 'SRC\\INDEX.TS')
    expect(rel.toLowerCase()).toBe('src/index.ts')
  })
})

describe('canonicalize', () => {
  it('returns root unchanged when everything exists', () => {
    expect(canonicalize(root)).toBe(root)
  })

  it('resolves suffix for non-existing leaf', () => {
    const result = canonicalize(path.join(root, 'newdir', 'file.txt'))
    expect(result).toBe(path.join(root, 'newdir', 'file.txt'))
  })
})

describe('IgnoreMatcher', () => {
  it('matches literals, dirs, and globs', () => {
    const m = new IgnoreMatcher(['secret.txt', 'dist/', '*.pem', 'logs/**'])
    expect(m.matches('secret.txt')).toBe(true)
    expect(m.matches('a/secret.txt')).toBe(true)
    expect(m.matches('dist', true)).toBe(true)
    expect(m.matches('dist/x.js')).toBe(true)
    expect(m.matches('server.pem')).toBe(true)
    expect(m.matches('logs/a/b.txt')).toBe(true)
    expect(m.matches('src/index.ts')).toBe(false)
  })

  it('supports negation last-wins', () => {
    const m = new IgnoreMatcher(['*.md', '!README.md'])
    expect(m.matches('NOTES.md')).toBe(true)
    expect(m.matches('README.md')).toBe(false)
  })
})

describe('SensitivePolicy', () => {
  it('denies env files, keys, and credentials', () => {
    const policy = new SensitivePolicy()
    expect(policy.isSensitive('.env')).toBe(true)
    expect(policy.isSensitive('.env.local')).toBe(true)
    expect(policy.isSensitive('.env.example')).toBe(false)
    expect(policy.isSensitive('id_rsa')).toBe(true)
    expect(policy.isSensitive('certs/server.key')).toBe(true)
    expect(policy.isSensitive('.git-credentials')).toBe(true)
    expect(policy.isSensitive('config/service-account.json')).toBe(true)
    expect(policy.isSensitive('.credentials.yaml')).toBe(true)
    expect(policy.isSensitive('src/index.ts')).toBe(false)
  })

  it('merges user .d2cignore additively', () => {
    const policy = new SensitivePolicy(['internal/'])
    expect(policy.isSensitive('internal/notes.txt')).toBe(true)
    expect(policy.isSensitive('README.md')).toBe(false)
    // Cannot un-deny defaults.
    const policy2 = new SensitivePolicy(['!.env'])
    expect(policy2.isSensitive('.env')).toBe(true)
  })
})
