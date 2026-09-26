import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { setImmediate } from 'node:timers/promises'
import { apply, Config, inject } from '../src/index.ts'
import { BrowserHarnessAdapter } from '../src/browser/harness.ts'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'

interface RegisteredTool {
  name: string
  execute(args: Record<string, unknown>, execution: {
    agent: { session: { header: { cwd: string } } }
    signal: AbortSignal
  }): Promise<unknown>
}

describe('production collaboration service requirements', () => {
  it('declares tool, prompt, durability and execution identity dependencies', () => {
    expect(inject).toEqual(['tools', 'systemPrompt', 'storageDomain', 'executionWorldIdentity'])
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
      ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.set(tool.name, tool) } })
      ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
      await ctx.plugin({ apply, Config, inject }, { tunnelMode: 'external' })
      const tool = tools.get(toolName)
      expect(tool).toBeDefined()
      const signal = new AbortController().signal
      const cwd = '/remote-only/project'
      await expect(tool!.execute({ goal: 'inspect fixture', taskId: 'fixture-task' }, {
        agent: { session: { header: { cwd } } }, signal,
      })).rejects.toMatchObject({ reason: 'WORKSPACE_CAPABILITY_UNAVAILABLE' })
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
