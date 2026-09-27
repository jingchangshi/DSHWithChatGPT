import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { setImmediate } from 'node:timers/promises'
import { apply, Config, inject, resolveGitReadPolicy } from '../src/index.ts'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'
import * as readLeases from '@deepseek-ai/dsh-execution-world/read-lease'
import * as gitLeases from '@deepseek-ai/dsh-execution-world/git-lease'

vi.mock('@deepseek-ai/dsh-execution-world/read-lease', { spy: true })
vi.mock('@deepseek-ai/dsh-execution-world/git-lease', { spy: true })

interface RegisteredTool {
  name: string
  execute(args: Record<string, unknown>, execution: {
    agent: { session: { header: { cwd: string } } }
    signal: AbortSignal
  }): Promise<unknown>
}

describe('production collaboration service requirements', () => {
  it('denies review without a durable evidence owner before any browser or tunnel calls', async () => {
    const ctx = new Context()
    const tools = new Map<string, RegisteredTool>()
    const workspaceId = 'fixture-execution-workspace'
    const disposeRead = vi.fn(async () => {})
    const disposeGit = vi.fn(async () => {})
    const read = vi.spyOn(readLeases, 'bindExecutionReadLease').mockResolvedValue({
      workspaceId: workspaceId as readLeases.ExecutionReadLease['workspaceId'],
      fs: { stat: async () => undefined, readText: async () => '', listDir: async () => [] }, dispose: disposeRead,
    })
    const git = vi.spyOn(gitLeases, 'bindExecutionGitLease').mockResolvedValue({
      workspaceId: workspaceId as gitLeases.ExecutionGitLease['workspaceId'], assurance: 'full', dispose: disposeGit,
      git: { workspaceId: workspaceId as gitLeases.ExecutionGitLease['workspaceId'], emptyFile: 'NUL', signal: new AbortController().signal, execute: vi.fn() },
    })
    const ready = vi.spyOn(BrowserHarnessAdapter.prototype, 'ensureReady')
    const send = vi.spyOn(BrowserHarnessAdapter.prototype, 'sendControlMessage')
    const tunnel = vi.spyOn(TunnelSupervisor.prototype, 'ensure')
    try {
      ctx.provide('storageDomain', { open: async () => ({ close: async () => {}, table: () => ({ get: async () => undefined }) }) })
      ctx.provide('executionWorldIdentity', { resolve: async () => workspaceId })
      ctx.provide('fs', {})
      ctx.provide('subprocess', {})
      ctx.provide('sandbox', {})
      ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.set(tool.name, tool) } })
      ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
      await ctx.plugin({ apply, Config, inject }, { tunnelMode: 'external', gitRead: true })
      await expect(tools.get('chatgpt_review')!.execute({ taskId: 'unbound' }, {
        agent: { session: { header: { cwd: '/fixture' } } }, signal: new AbortController().signal,
      })).rejects.toThrow('EXECUTION_OUTPUT_UNAVAILABLE')
      expect(ready).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      expect(tunnel).not.toHaveBeenCalled()
      expect(disposeRead).toHaveBeenCalledOnce()
      expect(disposeGit).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
      for (const spy of [read, git, ready, send, tunnel]) spy.mockRestore()
    }
  })
  it('normalizes Git read policy with legacy compatibility and default denial', () => {
    expect(resolveGitReadPolicy(Config.parse({}))).toBe('disabled')
    expect(resolveGitReadPolicy(Config.parse({ gitRead: true }))).toBe('require-full')
    expect(resolveGitReadPolicy(Config.parse({ gitRead: false }))).toBe('disabled')
    expect(resolveGitReadPolicy(Config.parse({ gitReadPolicy: 'allow-hardened-windows' }))).toBe('allow-hardened-windows')
    expect(resolveGitReadPolicy(Config.parse({ gitRead: true, gitReadPolicy: 'require-full' }))).toBe('require-full')
    expect(() => resolveGitReadPolicy(Config.parse({ gitRead: true, gitReadPolicy: 'disabled' }))).toThrow('gitRead and gitReadPolicy conflict')
  })

  it('declares tool, prompt, durability and execution identity dependencies', () => {
    expect(inject).toEqual(['tools', 'systemPrompt', 'storageDomain', 'executionWorldIdentity', 'fs', 'subprocess', 'sandbox'])
  })

  it('refuses direct activation without durable storage', async () => {
    const ctx = new Context()
    await expect(apply(ctx, Config.parse({}))).rejects.toThrow('DURABLE_STORAGE_UNAVAILABLE')
  })

  it('waits for storage activation before publishing the plugin', async () => {
    const ctx = new Context()
    const started = Promise.withResolvers<void>()
    const storage = Promise.withResolvers<void>()
    const close = vi.fn(async () => {})
    const register = vi.fn()
    let settled = false
    ctx.provide('storageDomain', { open: async () => { started.resolve(); await storage.promise; return { close } } })
    ctx.provide('executionWorldIdentity', { resolve: async () => 'fixture-id' })
    ctx.provide('fs', {})
    ctx.provide('subprocess', {})
    ctx.provide('sandbox', {})
    ctx.provide('tools', { register })
    ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
    const loading = ctx.plugin({ apply, Config, inject }, {}).then(() => { settled = true })
    try {
      await started.promise
      await setImmediate()
      expect(settled).toBe(false)
      expect(register).not.toHaveBeenCalled()
      storage.resolve()
      await loading
      expect(register).toHaveBeenCalledTimes(5)
    } finally {
      storage.resolve()
      await loading
      await ctx.fiber.dispose()
    }
    expect(close).toHaveBeenCalledOnce()
  })

  it.each(['chatgpt_plan', 'chatgpt_review'])('%s refuses unavailable content before browser or tunnel activity', async (toolName) => {
    const ctx = new Context()
    const tools = new Map<string, RegisteredTool>()
    const close = vi.fn(async () => {})
    const table = vi.fn(() => { throw new Error('unexpected task state access') })
    const resolve = vi.fn(async () => 'fixture-execution-workspace')
    const send = vi.spyOn(BrowserHarnessAdapter.prototype, 'sendControlMessage').mockRejectedValue(new Error('unexpected browser send'))
    const ready = vi.spyOn(BrowserHarnessAdapter.prototype, 'ensureReady').mockRejectedValue(new Error('unexpected browser activation'))
    const tunnel = vi.spyOn(TunnelSupervisor.prototype, 'ensure').mockRejectedValue(new Error('unexpected tunnel activation'))
    try {
      ctx.provide('storageDomain', { open: async () => ({ close, table }) })
      ctx.provide('executionWorldIdentity', { resolve })
      ctx.provide('fs', {})
      ctx.provide('subprocess', {})
      ctx.provide('sandbox', {})
      ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.set(tool.name, tool) } })
      ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
      await ctx.plugin({ apply, Config, inject }, { tunnelMode: 'external' })
      const tool = tools.get(toolName)
      expect(tool).toBeDefined()
      const signal = new AbortController().signal
      const cwd = '/remote-only/project'
      await expect(tool!.execute({ goal: 'inspect fixture', taskId: 'fixture-task' }, {
        agent: { session: { header: { cwd } } }, signal,
      })).rejects.toThrow()
      expect(resolve).toHaveBeenCalledExactlyOnceWith(cwd, signal)
      expect(send).not.toHaveBeenCalled()
      expect(ready).not.toHaveBeenCalled()
      expect(tunnel).not.toHaveBeenCalled()
      expect(table).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      send.mockRestore()
      ready.mockRestore()
      tunnel.mockRestore()
    }
    expect(close).toHaveBeenCalledOnce()
  })
})
