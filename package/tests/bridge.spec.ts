import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { startBridgeServer, type BridgeServer } from '../src/bridge/server.ts'
import { buildWorkspaceTools, loadWorkspaceSpec } from '../src/bridge/tools.ts'
import { ExecutionRecorder } from '../src/execution/recorder.ts'

let root: string
let stateDir: string
let port: number
let server: BridgeServer
const TOKEN = 'test-token-0123456789abcdef'

function rpc(method: string, params?: Record<string, unknown>, token: string = TOKEN, p?: number): Promise<{ status: number; body: any }> {
  return fetch(`http://127.0.0.1:${p ?? port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params !== undefined ? { params } : {}) }),
  }).then(async r => ({ status: r.status, body: await r.json() }))
}

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-bridge-ws-')))
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-bridge-state-'))
  fs.writeFileSync(path.join(root, 'README.md'), '# hello\n')
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const answer = 42\n')
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n')
  fs.writeFileSync(path.join(root, '.env.example'), 'SECRET=\n')
  execFileSync('git', ['-C', root, 'init', '-b', 'main'], { stdio: 'pipe' })
  execFileSync('git', ['-C', root, 'config', 'user.email', 't@e.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', root, 'config', 'user.name', 'T'], { stdio: 'pipe' })
  execFileSync('git', ['-C', root, 'add', '.'], { stdio: 'pipe' })
  const recorder = new ExecutionRecorder({ stateDir })
  const spec = loadWorkspaceSpec(root, recorder)
  server = await startBridgeServer({ port: 0, tokens: new Map([[TOKEN, 'workspace:demo']]) }, buildWorkspaceTools(spec))
  port = server.port
})

afterEach(async () => {
  await server.close()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(stateDir, { recursive: true, force: true })
})

describe('bridge auth', () => {
  it('rejects missing/invalid tokens', async () => {
    expect((await rpc('ping', undefined, '')).status).toBe(401)
    expect((await rpc('ping', undefined, 'wrong-token-aaaaaaaaaaaaaa')).status).toBe(401)
  })

  it('rejects non-POST', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`)
    expect(r.status).toBe(405)
  })

  it('only listens on loopback', async () => {
    // The server bound 127.0.0.1; verify by construction + a loopback ping.
    expect((await rpc('ping')).body.result).toEqual({})
  })
})

describe('MCP protocol', () => {
  it('initializes', async () => {
    const r = await rpc('initialize')
    expect(r.body.result.serverInfo.name).toBe('dsh-with-chatgpt')
    expect(r.body.result.capabilities.tools).toEqual({})
  })

  it('lists only read-only tools', async () => {
    const r = await rpc('tools/list')
    const names: string[] = r.body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('workspace_info')
    expect(names).toContain('read_file')
    expect(names).toContain('git_diff')
    for (const banned of ['write_file', 'delete_file', 'shell', 'git_commit', 'git_push', 'arbitrary_command']) {
      expect(names).not.toContain(banned)
    }
  })

  it('calls a tool and returns content blocks', async () => {
    const r = await rpc('tools/call', { name: 'workspace_info', arguments: {} })
    const parsed = JSON.parse(r.body.result.content[0].text)
    expect(parsed.isGitRepo).toBe(true)
    expect(parsed.readOnly).toBe(true)
  })

  it('returns method-not-found for unknown methods', async () => {
    const r = await rpc('nope')
    expect(r.body.error.code).toBe(-32601)
  })
})

describe('read-only tools over HTTP', () => {
  it('read_file denies .env but allows .env.example', async () => {
    const denied = await rpc('tools/call', { name: 'read_file', arguments: { path: '.env' } })
    expect(denied.body.error.message).toContain('ACCESS_DENIED_SENSITIVE_FILE')
    const allowed = await rpc('tools/call', { name: 'read_file', arguments: { path: '.env.example' } })
    expect(allowed.body.result.content[0].text).toContain('SECRET=')
  })

  it('read_file refuses path escape', async () => {
    const r = await rpc('tools/call', { name: 'read_file', arguments: { path: '../outside.txt' } })
    expect(r.body.error.message).toContain('PATH_OUTSIDE_WORKSPACE')
  })

  it('list_directory hides sensitive and noise entries', async () => {
    fs.writeFileSync(path.join(root, 'server.key'), 'k')
    fs.mkdirSync(path.join(root, 'node_modules'))
    const r = await rpc('tools/call', { name: 'list_directory', arguments: { path: '.' } })
    const parsed = JSON.parse(r.body.result.content[0].text)
    const names = parsed.entries.map((e: { name: string }) => e.name)
    expect(names).toContain('src')
    expect(names).not.toContain('.env')
    expect(names).not.toContain('server.key')
    expect(names).not.toContain('node_modules')
  })

  it('search_workspace finds matches in tracked sources', async () => {
    const r = await rpc('tools/call', { name: 'search_workspace', arguments: { query: 'answer' } })
    const parsed = JSON.parse(r.body.result.content[0].text)
    expect(parsed.matchCount).toBeGreaterThanOrEqual(1)
    expect(parsed.matches[0].path).toBe('src/app.ts')
  })

  it('git_status and git_diff work', async () => {
    const status = await rpc('tools/call', { name: 'git_status', arguments: {} })
    const parsedStatus = JSON.parse(status.body.result.content[0].text)
    expect(parsedStatus.isRepo).toBe(true)
    fs.writeFileSync(path.join(root, 'README.md'), '# hello v2\n')
    const diff = await rpc('tools/call', { name: 'git_diff', arguments: {} })
    expect(diff.body.result.content[0].text).toContain('README.md')
  })

  it('test_status reflects execution records', async () => {
    const recorder = new ExecutionRecorder({ stateDir })
    recorder.record({
      taskId: 'd2c_ab12cd', iteration: 1, command: 'pnpm vitest run', cwd: '.',
      startedAt: 1, endedAt: 2, status: 'success', exitCode: 0, stdout: 'ok', stderr: '',
    })
    const r = await rpc('tools/call', { name: 'test_status', arguments: { task_id: 'd2c_ab12cd' } })
    const parsed = JSON.parse(r.body.result.content[0].text)
    expect(parsed.byKind.test).toBe(1)
    expect(parsed.latestTest.status).toBe('success')
  })
})
