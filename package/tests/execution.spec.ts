import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ExecutionRecorder,
  classifyCommand,
  containsPrivateKey,
  redact,
} from '../src/execution/recorder.ts'

let stateDir: string

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-rec-'))
})

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true })
})

function makeRecorder(): ExecutionRecorder {
  return new ExecutionRecorder({ stateDir })
}

const base = {
  taskId: 'd2c_ab12cd',
  iteration: 1,
  command: 'pnpm vitest run',
  cwd: '.',
  startedAt: 1000,
  endedAt: 2000,
  status: 'success' as const,
  exitCode: 0,
  stdout: 'all tests passed',
  stderr: '',
}

describe('redact', () => {
  it('redacts common token shapes', () => {
    const out = redact('deploy with ghp_abcdefghijklmnopqrst and sk-abcdefghijklmnopqrstuvwx')
    expect(out).not.toContain('ghp_abcdefghijklmnopqrst')
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    expect(out).toContain('REDACTED')
  })

  it('redacts key=value style secrets', () => {
    const out = redact('curl -H "api_key: supersecret123" https://x')
    expect(out).not.toContain('supersecret123')
  })

  it('leaves normal text alone', () => {
    expect(redact('pnpm vitest run --coverage')).toBe('pnpm vitest run --coverage')
  })
})

describe('private key handling', () => {
  it('detects private-key markers', () => {
    expect(containsPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nMIIE')).toBe(true)
    expect(containsPrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true)
    expect(containsPrivateKey('hello world')).toBe(false)
  })

  it('refuses to record private-key output entirely', () => {
    const recorder = makeRecorder()
    expect(() => recorder.record({
      ...base,
      stdout: 'oops -----BEGIN RSA PRIVATE KEY----- leaked',
    })).toThrow(/private-key/)
    expect(recorder.list()).toHaveLength(0)
  })
})

describe('recorder', () => {
  it('records and lists executions', () => {
    const recorder = makeRecorder()
    const rec = recorder.record(base)
    expect(rec.kind).toBe('test')
    expect(recorder.list()).toHaveLength(1)
    expect(recorder.get(rec.id)?.command).toBe('pnpm vitest run')
  })

  it('classifies command kinds', () => {
    expect(classifyCommand('pnpm vitest run')).toBe('test')
    expect(classifyCommand('pnpm exec tsc --noEmit')).toBe('typecheck')
    expect(classifyCommand('git status --porcelain')).toBe('git')
    expect(classifyCommand('pnpm build')).toBe('build')
    expect(classifyCommand('pnpm test')).toBe('test')
    expect(classifyCommand('echo hello')).toBe('file-op')
  })

  it('caps oversized output and flags truncation', () => {
    const recorder = makeRecorder()
    const rec = recorder.record({
      ...base,
      stdout: Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n'),
    })
    expect(rec.truncated).toBe(true)
    expect(rec.stdoutTail.split('\n').length).toBeLessThanOrEqual(200)
    expect(rec.stdoutTail).toContain('line 499')
  })

  it('summarizes by kind and status with latest test', () => {
    const recorder = makeRecorder()
    recorder.record(base)
    recorder.record({ ...base, command: 'pnpm build', status: 'failure', exitCode: 1, stdout: 'boom', stderr: 'err' })
    const summary = recorder.summarize()
    expect(summary.total).toBe(2)
    expect(summary.byKind.test).toBe(1)
    expect(summary.byStatus.failure).toBe(1)
    expect(summary.latestTest?.label).toContain('vitest')
  })

  it('survives corrupt lines in the log', () => {
    const recorder = makeRecorder()
    recorder.record(base)
    fs.appendFileSync(path.join(stateDir, 'executions.jsonl'), '{corrupt\n')
    expect(recorder.list()).toHaveLength(1)
  })
})
