import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, inject } from '../src/index.ts'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'
import * as reads from '@deepseek-ai/dsh-execution-world/read-lease'
import * as git from '@deepseek-ai/dsh-execution-world/git-lease'

vi.mock('@deepseek-ai/dsh-execution-world/read-lease', { spy: true })
vi.mock('@deepseek-ai/dsh-execution-world/git-lease', { spy: true })

type Tool = { execute(args: Record<string, unknown>, exec: unknown): Promise<unknown> }
afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const ctx = new Context()
  const records = new Map<string, unknown>()
  const tools = new Map<string, Tool>()
  vi.mocked(reads.bindExecutionReadLease).mockImplementation(async (_ctx, root) => ({
    workspaceId: root as reads.ExecutionReadLease['workspaceId'],
    fs: { stat: async () => undefined, readText: async () => '', listDir: async () => [] }, dispose: async () => {},
  }))
  vi.mocked(git.bindExecutionGitLease).mockImplementation(async (_ctx, root, signal) => ({
    workspaceId: root as git.ExecutionGitLease['workspaceId'], assurance: 'full', dispose: async () => {},
    git: { workspaceId: root as git.ExecutionGitLease['workspaceId'], emptyFile: 'NUL', signal,
      execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  }))
  const tunnel = vi.spyOn(TunnelSupervisor.prototype, 'ensure').mockResolvedValue({ mode: 'managed', configured: true, ready: true, detail: 'fixture' })
  const ready = vi.spyOn(BrowserHarnessAdapter.prototype, 'ensureReady').mockResolvedValue()
  vi.spyOn(BrowserHarnessAdapter.prototype, 'openConversation').mockResolvedValue('fixture-conversation')
  vi.spyOn(BrowserHarnessAdapter.prototype, 'sendControlMessage').mockResolvedValue()
  ctx.provide('storageDomain', { open: async (spec: { name: string }) => ({ close: async () => {}, table: (name: string) => ({
    get: (key: string) => records.get(spec.name + '/' + name + '/' + key),
    put: async (key: string, value: unknown) => { records.set(spec.name + '/' + name + '/' + key, value) },
    delete: async (key: string) => { records.delete(spec.name + '/' + name + '/' + key) },
  }) }) })
  ctx.provide('executionWorldIdentity', { resolve: async (root: string) => root })
  for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
  ctx.provide('tools', { register: (tool: Tool & { name: string }) => { tools.set(tool.name, tool) } })
  ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
  await ctx.plugin({ apply, Config, inject }, { tunnelMode: 'managed', gitRead: true, gitPolicy: 'worktree' })
  const call = (name: string, workspace = 'owner-fixture-a', signal = new AbortController().signal, args: Record<string, unknown> = {}) =>
    tools.get(name)!.execute(args, { agent: { session: { header: { cwd: workspace } } }, signal })
  return { ctx, records, tunnel, ready, call }
}

describe('registered ownership enforcement', () => {
  it('rejects status and a new PLAN before tunnel startup when legacy tasks are pending', async () => {
    const current = await fixture()
    current.records.set('d2c_state/index/tasks', { ids: ['legacy'] })
    current.records.set('d2c_state/tasks/legacy', { taskId: 'legacy', state: 'planned' })
    current.records.set('d2c_state/bindings/owner-fixture-a', { lastTaskId: 'legacy' })
    try {
      for (const tool of ['chatgpt_status', 'chatgpt_plan']) {
        await expect(current.call(tool, 'owner-fixture-b')).rejects.toThrow('TUNNEL_LEGACY_TASK_PENDING')
      }
      expect(current.records.has('d2c_control/managed_tunnel/owner')).toBe(false)
      expect(current.tunnel).not.toHaveBeenCalled()
      expect(current.ready).not.toHaveBeenCalled()
    } finally { await current.ctx.fiber.dispose() }
  })
  it('retains the task owner after PLAN cancellation and rejects overlapping browser operations', async () => {
    const current = await fixture()
    const entered = Promise.withResolvers<void>()
    vi.spyOn(BrowserHarnessAdapter.prototype, 'waitForReply').mockImplementation(async (_timeout, signal) => {
      entered.resolve()
      return new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    })
    const controller = new AbortController()
    try {
      const pending = current.call('chatgpt_plan', 'owner-fixture-a', controller.signal, { goal: 'fixture' })
      const rejected = expect(pending).rejects.toThrow('cancelled')
      await entered.promise
      expect(current.records.get('d2c_control/managed_tunnel/owner')).toMatchObject({ phase: 'task', workspaceId: 'owner-fixture-a' })
      for (const tool of ['chatgpt_review', 'chatgpt_doctor', 'chatgpt_reconnect']) {
        await expect(current.call(tool)).rejects.toThrow('CONTROL_BROWSER_BUSY')
      }
      await expect(current.call('chatgpt_status', 'owner-fixture-b')).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
      controller.abort()
      await rejected
      expect(current.records.get('d2c_control/managed_tunnel/owner')).toMatchObject({ phase: 'task' })
      const calls = current.tunnel.mock.calls.length
      for (const tool of ['chatgpt_plan', 'chatgpt_doctor', 'chatgpt_reconnect', 'chatgpt_status']) {
        await expect(current.call(tool, 'owner-fixture-b')).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
      }
      expect(current.tunnel).toHaveBeenCalledTimes(calls)
    } finally { controller.abort(); await current.ctx.fiber.dispose() }
  })

  it('clears an orphan only through same-workspace reconnect without tunnel startup', async () => {
    const current = await fixture()
    current.records.set('d2c_control/managed_tunnel/owner', { workspaceId: 'owner-fixture-a', taskId: 'missing', claimId: 'claim', phase: 'pre-task', createdAt: 1, updatedAt: 1 })
    try {
      await expect(current.call('chatgpt_reconnect', 'owner-fixture-b')).rejects.toThrow('TUNNEL_WORKSPACE_BUSY')
      await expect(current.call('chatgpt_reconnect')).resolves.toMatchObject({ recovered: false, task: null })
      expect(current.records.has('d2c_control/managed_tunnel/owner')).toBe(false)
      expect(current.tunnel).not.toHaveBeenCalled()
      expect(current.ready).not.toHaveBeenCalled()
    } finally { await current.ctx.fiber.dispose() }
  })
})
