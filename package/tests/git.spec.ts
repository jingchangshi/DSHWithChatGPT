import { localGitExecutor } from './local-git.ts'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitError, gitDiff, gitLog, gitStatus } from '../src/workspace/git.ts'

let root: string

function git(args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString()
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; status?: number }
    const stderr = err.stderr ? err.stderr.toString() : '(no stderr)'
    throw new Error('git ' + args.join(' ') + ' -> exit ' + String(err.status) + ' stderr: ' + stderr)
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-git-'))
  root = fs.realpathSync(root)
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(root, 'README.md'), '# demo\n')
  git(['add', '.'])
  git(['commit', '-m', 'init'])
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('gitStatus', () => {
  it('reports clean tree at HEAD', async () => {
    const status = await gitStatus(localGitExecutor(root))
    expect(status.isRepo).toBe(true)
    expect(status.branch).toBe('main')
    expect(status.dirty).toBe(false)
    expect(status.head).toMatch(/^[0-9a-f]{40}$/)
  })

  it('reports whether local HEAD is fully pushed to its upstream', async () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-git-remote-'))
    try {
      execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' })
      git(['remote', 'add', 'origin', remote])
      git(['push', '-u', 'origin', 'main'])
      const synced = await gitStatus(localGitExecutor(root))
      expect(synced.upstream).toBe('origin/main')
      expect(synced.upstreamHead).toBe(synced.head)
      expect(synced.ahead).toBe(0)
      expect(synced.behind).toBe(0)

      fs.writeFileSync(path.join(root, 'local.txt'), 'local\n')
      git(['add', 'local.txt'])
      git(['commit', '-m', 'local only'])
      const ahead = await gitStatus(localGitExecutor(root))
      expect(ahead.ahead).toBe(1)
      expect(ahead.upstreamHead).not.toBe(ahead.head)
    } finally {
      fs.rmSync(remote, { recursive: true, force: true })
    }
  })

  it('reports staged, unstaged, and untracked separately', async () => {
    fs.writeFileSync(path.join(root, 'staged.txt'), 's')
    git(['add', 'staged.txt'])
    fs.writeFileSync(path.join(root, 'README.md'), '# changed\n')
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'u')
    const status = await gitStatus(localGitExecutor(root))
    expect(status.staged).toContain('staged.txt')
    expect(status.unstaged).toContain('README.md')
    expect(status.untracked).toContain('untracked.txt')
    expect(status.dirty).toBe(true)
  })

  it('degrades to isRepo=false for non-repositories', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-plain-'))
    try {
      const status = await gitStatus(localGitExecutor(plain))
      expect(status.isRepo).toBe(false)
      await expect(gitDiff(localGitExecutor(plain))).rejects.toThrow(GitError)
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe('gitDiff', () => {
  it('returns empty diff for clean tree', async () => {
    const diff = await gitDiff(localGitExecutor(root))
    expect(diff.text.trim()).toBe('')
    expect(diff.truncated).toBe(false)
    expect(diff.against).toBe('HEAD')
  })

  it('returns working-tree diff for modifications', async () => {
    fs.writeFileSync(path.join(root, 'README.md'), '# demo changed\n')
    const diff = await gitDiff(localGitExecutor(root))
    expect(diff.text).toContain('README.md')
    expect(diff.text).toContain('+')
  })

  it('includes untracked file content by diffing against the empty tree', async () => {
    fs.writeFileSync(path.join(root, 'new.txt'), 'brand new\n')
    const diff = await gitDiff(localGitExecutor(root))
    expect(diff.against).toBe('EMPTY_TREE')
    expect(diff.text).toContain('new.txt')
    expect(diff.text).toContain('brand new')
  })

  it('diffs against an explicit ref', async () => {
    fs.writeFileSync(path.join(root, 'README.md'), '# demo v2\n')
    git(['add', '.'])
    git(['commit', '-m', 'second'])
    const head = (await gitStatus(localGitExecutor(root))).head
    const diff = await gitDiff(localGitExecutor(root), { againstRef: 'HEAD~1' })
    expect(diff.against).toBe('HEAD~1')
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    expect(diff.text).toContain('README.md')
  })

  it('truncates oversized diffs', async () => {
    fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(100_000) + '\nend\n')
    const diff = await gitDiff(localGitExecutor(root), { maxBytes: 1024 })
    expect(diff.truncated).toBe(true)
    expect(Buffer.byteLength(diff.text, 'utf8')).toBeLessThanOrEqual(1024)
  })
})

describe('gitLog', () => {
  it('lists commits newest first', async () => {
    git(['commit', '--allow-empty', '-m', 'second'])
    const log = await gitLog(localGitExecutor(root), 5)
    expect(log.length).toBeGreaterThanOrEqual(2)
    expect(log[0]?.subject).toBe('second')
    expect(log[1]?.subject).toBe('init')
  })
})
