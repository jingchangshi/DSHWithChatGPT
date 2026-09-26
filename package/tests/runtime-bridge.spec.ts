import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRuntimeWorkspaceTools } from '../src/bridge/tools.ts'
import { WorkspaceRuntimeRegistry, type WorkspaceRuntimeLease } from '../src/workspace/runtime.ts'
import { ExecutionRecorder } from '../src/execution/recorder.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function setup() {
  const registry = new WorkspaceRuntimeRegistry()
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-runtime-bridge-'))
  directories.push(stateDir)
  const recorder = new ExecutionRecorder({ stateDir })
  const summary = vi.spyOn(recorder, 'summarize').mockReturnValue({
    total: 1, byKind: { test: 1 }, byStatus: { success: 1 },
    latestTest: { id: 'run-1', status: 'success', exitCode: 0, endedAt: 10, label: 'PRIVATE_WORKSPACE_CONTENT' },
  })
  const tools = buildRuntimeWorkspaceTools({ workspaceId: 'remote-workspace', registry, recorder })
  const call = (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find(tool => tool.name === name)
    if (!tool) throw new Error('missing tool')
    return tool.handler(args, { subject: 'workspace:remote-workspace' })
  }
  return { registry, tools, call, summary }
}

function lease(): WorkspaceRuntimeLease {
  return {
    identity: { workspaceId: 'remote-workspace', displayRoot: '/remote/not/on/host' },
    generation: Symbol(), signal: new AbortController().signal,
    capabilities: {
      workspaceContentRead: { available: true }, gitRead: { available: true }, executionOutput: { available: true },
    },
    backend: { read: vi.fn().mockResolvedValue({ content: 'REMOTE_ONLY' }) },
  }
}

describe('runtime-bound MCP bridge', () => {
  it('keeps ten stable tools and denies all seven content channels without a lease', async () => {
    const { tools, call } = setup()
    expect(tools).toHaveLength(10)
    for (const name of ['list_directory', 'read_file', 'search_workspace', 'git_status', 'git_diff', 'git_log', 'execution_output']) {
      await expect(call(name)).rejects.toThrow('RUNTIME_LEASE_UNAVAILABLE')
    }
  })

  it('serves identity and capabilities without a Host root or Git probe', async () => {
    const { call } = setup()
    const result = await call('workspace_info')
    expect(result).toMatchObject({ workspaceId: 'remote-workspace', capabilities: { leaseBound: false } })
    expect(result).not.toHaveProperty('isGitRepo')
    expect(JSON.stringify(result)).not.toContain('/remote/')
  })

  it('exposes summary metadata without free-text command labels', async () => {
    const { call, summary } = setup()
    for (const name of ['test_status', 'execution_summary']) {
      const result = await call(name, { task_id: 'task', iteration: 2 })
      expect(result).toMatchObject({ total: 1, latestTest: { id: 'run-1', status: 'success' } })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_WORKSPACE_CONTENT')
    }
    expect(summary).toHaveBeenLastCalledWith({ taskId: 'task', iteration: 2 })
  })

  it('routes authorized reads only to the active execution backend', async () => {
    const { registry, call } = setup()
    const current = lease()
    registry.acquire(current)
    expect(await call('read_file', { path: 'same.txt' })).toEqual({ content: 'REMOTE_ONLY' })
    expect(current.backend!.read).toHaveBeenCalledWith({ operation: 'read_file', path: 'same.txt', maxBytes: 128 * 1024 }, current.signal)
  })

  it('refuses an absent backend rather than falling back to Host helpers', async () => {
    const { registry, call } = setup()
    registry.acquire({ ...lease(), backend: undefined })
    await expect(call('git_status')).rejects.toThrow('SUBPROCESS_CAPABILITY_UNAVAILABLE')
    await expect(call('read_file', { path: 'file' })).rejects.toThrow('WORKSPACE_BACKEND_UNAVAILABLE')
  })

  it('denies every content route when root-safe read is unavailable', async () => {
    const { registry, call } = setup()
    const current = lease()
    registry.acquire({ ...current, capabilities: {
      ...current.capabilities,
      workspaceContentRead: { available: false, reason: 'ROOT_SAFE_READ_UNAVAILABLE' },
    } })
    for (const name of ['list_directory', 'read_file', 'search_workspace', 'git_status', 'git_diff', 'git_log', 'execution_output']) {
      await expect(call(name)).rejects.toThrow('ROOT_SAFE_READ_UNAVAILABLE')
    }
    expect(current.backend!.read).not.toHaveBeenCalled()
  })

  it('discards a pending read after cancellation', async () => {
    const { registry, call } = setup()
    const controller = new AbortController()
    registry.acquire({ ...lease(), signal: controller.signal, backend: {
      async read() { controller.abort(new Error('execution cancelled')); return 'unpublishable' },
    } })
    await expect(call('read_file', { path: 'file' })).rejects.toThrow('execution cancelled')
  })

  it('discards results from a replaced service generation', async () => {
    const { registry, call } = setup()
    let release: () => void
    release = registry.acquire({ ...lease(), backend: {
      async read() { release(); registry.acquire(lease()); return 'stale' },
    } })
    await expect(call('read_file', { path: 'file' })).rejects.toThrow('RUNTIME_LEASE_CHANGED')
  })

  it('discards results after same-generation reacquisition', async () => {
    const { registry, call } = setup()
    const current = lease()
    let release: () => void
    release = registry.acquire({ ...current, backend: {
      async read() { release(); registry.acquire(current); return 'stale' },
    } })
    await expect(call('read_file', { path: 'file' })).rejects.toThrow('RUNTIME_LEASE_CHANGED')
  })

  it('does not expose provider failure details', async () => {
    const { registry, call } = setup()
    registry.acquire({ ...lease(), backend: {
      async read() { throw new Error('ssh PRIVATE_PATH PRIVATE_CREDENTIAL') },
    } })
    await expect(call('read_file', { path: 'file' })).rejects.toThrow('WORKSPACE_BACKEND_FAILED: workspace read failed')
  })

  it('rejects unvalidated input before calling the backend', async () => {
    const { registry, call } = setup()
    const current = lease()
    registry.acquire(current)
    await expect(call('read_file', { path: 'safe', command: 'sh' })).rejects.toThrow('INVALID_WORKSPACE_QUERY')
    await expect(call('search_workspace', { query: '[', is_regex: true })).rejects.toThrow('INVALID_WORKSPACE_QUERY')
    expect(current.backend!.read).not.toHaveBeenCalled()
  })

  it('constructs fixed Git commands instead of dispatching Git to the content backend', async () => {
    const { registry, call } = setup()
    const current = lease()
    const execute = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'abcdef commit subject', stderr: '' })
    registry.acquire({ ...current, git: { signal: current.signal, execute } })
    await expect(call('git_log', { limit: 4 })).resolves.toEqual({ commits: [{ hash: 'abcdef', subject: 'commit subject' }] })
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'log', '--max-count=4', '--pretty=format:%H %s'],
      expect.objectContaining({ maxBytes: 4194304, timeoutMs: 20000 }),
    )
    expect(current.backend!.read).not.toHaveBeenCalled()
  })
})
