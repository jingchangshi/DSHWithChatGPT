import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { setImmediate } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  it('fails the primary deployment before exposure when the protected Sidecar credential is missing', async () => {
    const ctx = new Context()
    const tools = new Map<string, RegisteredTool>()
    const workspaceId = 'plannerbridge-primary-fixture'
    const read = vi.spyOn(readLeases, 'bindExecutionReadLease').mockResolvedValue({
      workspaceId: workspaceId as readLeases.ExecutionReadLease['workspaceId'],
      fs: { stat: async () => undefined, readText: async () => '', listDir: async () => [] }, dispose: async () => {},
    })
    const tunnel = vi.spyOn(TunnelSupervisor.prototype, 'ensure').mockRejectedValue(new Error('unexpected exposure startup'))
    const browser = vi.spyOn(BrowserHarnessAdapter.prototype, 'ensureReady')
    try {
      ctx.provide('storageDomain', { open: async () => ({ close: async () => {}, table: () => ({ get: async () => undefined }) }) })
      ctx.provide('executionWorldIdentity', { resolve: async () => workspaceId })
      for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
      ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.set(tool.name, tool) } })
      ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
      await ctx.plugin({ apply, Config, inject }, { sidecarCredentialFile: join(tmpdir(), 'plannerbridge-no-such-credential.secret'), tunnelMode: 'managed' })
      await expect(tools.get('chatgpt_status')!.execute({}, {
        agent: { session: { header: { cwd: '/execution/world' } } }, signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
      expect(tunnel).not.toHaveBeenCalled()
      expect(browser).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      read.mockRestore(); tunnel.mockRestore(); browser.mockRestore()
    }
  })
  it.each([
    ['chatgpt_plan', {}], ['chatgpt_plan', { goal: undefined }],
    ['chatgpt_review', {}], ['chatgpt_review', { taskId: undefined }],
  ])('rejects missing required arguments for %s before side effects', async (name, args) => {
    const ctx = new Context()
    const tools = new Map<string, RegisteredTool>()
    const resolve = vi.fn(async () => 'workspace')
    const read = vi.spyOn(readLeases, 'bindExecutionReadLease')
    const git = vi.spyOn(gitLeases, 'bindExecutionGitLease')
    const tunnel = vi.spyOn(TunnelSupervisor.prototype, 'ensure')
    const ready = vi.spyOn(BrowserHarnessAdapter.prototype, 'ensureReady')
    const send = vi.spyOn(BrowserHarnessAdapter.prototype, 'sendControlMessage')
    for (const spy of [read, git, tunnel, ready, send]) spy.mockClear()
    ctx.provide('storageDomain', { open: async () => ({ close: async () => {} }) })
    ctx.provide('executionWorldIdentity', { resolve })
    for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
    ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.set(tool.name, tool) } })
    ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
    try {
      await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp', })
      await expect(tools.get(name)!.execute(args, {
        agent: { session: { header: { cwd: '/fixture' } } }, signal: new AbortController().signal,
      })).rejects.toThrow('INVALID_TOOL_ARGUMENTS')
      expect(resolve).not.toHaveBeenCalled()
      for (const spy of [read, git, tunnel, ready, send]) expect(spy).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      for (const spy of [read, git, tunnel, ready, send]) spy.mockRestore()
    }
  })
  it('publishes object JSON Schemas for all five collaboration tools', async () => {
    const ctx = new Context()
    const tools = new Map<string, { name: string; parameters: Record<string, unknown>; output: { schema: Record<string, any> } }>()
    ctx.provide('storageDomain', { open: async () => ({ close: async () => {} }) })
    ctx.provide('executionWorldIdentity', { resolve: async () => 'workspace' })
    for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
    ctx.provide('tools', { register: (tool: { name: string; parameters: Record<string, unknown>; output: { schema: Record<string, any> } }) => { tools.set(tool.name, tool) } })
    ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
    try {
      await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp', })
      expect(tools.size).toBe(5)
      for (const tool of tools.values()) {
        expect(tool.parameters.type).toBe('object')
        expect(tool.parameters.additionalProperties).toBe(false)
        expect(tool.parameters.properties).toBeTypeOf('object')
        expect(Array.isArray(tool.parameters.required)).toBe(true)
      }
      expect(tools.get('chatgpt_plan')!.parameters).toMatchObject({ properties: { goal: { type: 'string' } }, required: ['goal'] })
      expect(tools.get('chatgpt_review')!.parameters).toMatchObject({ properties: { taskId: { type: 'string' }, changedFiles: { type: 'array', items: { type: 'string' } }, testsRecorded: { type: 'boolean' } }, required: ['taskId'] })
      expect(tools.get('chatgpt_doctor')!.parameters).toMatchObject({ properties: { mode: { type: 'string', enum: ['local', 'app-proof'] } }, required: [] })
      for (const name of ['chatgpt_plan', 'chatgpt_review']) {
        expect(tools.get(name)!.output.schema.properties).toMatchObject({ workspaceId: { type: 'string' }, head: { type: ['string', 'null'] } })
        expect(tools.get(name)!.output.schema.required).toEqual(expect.arrayContaining(['workspaceId', 'head']))
      }
      expect(tools.get('chatgpt_reconnect')!.output.schema.properties.workspaceId).toMatchObject({ type: 'string' })
      for (const name of ['chatgpt_status', 'chatgpt_reconnect']) expect(tools.get(name)!.parameters).toMatchObject({ properties: {}, required: [] })
      expect(JSON.stringify([...tools.values()].map(tool => tool.parameters))).not.toContain('"required":true')
      expect(JSON.stringify([...tools.values()].map(tool => tool.parameters))).not.toContain('"type":"json"')
    } finally { await ctx.fiber.dispose() }
  })
  it('preserves task storage v1 and opens a separate control domain', async () => {
    const ctx = new Context()
    const specs: Array<{ name: string; version: number; tables: Record<string, unknown> }> = []
    const close = vi.fn(async () => {})
    ctx.provide('storageDomain', { open: async (spec: typeof specs[number]) => { specs.push(spec); return { close } } })
    ctx.provide('executionWorldIdentity', { resolve: async () => 'workspace' })
    for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
    ctx.provide('tools', { register: () => {} })
    ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
    try {
      await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp', })
      expect(specs.map(spec => ({ name: spec.name, version: spec.version, tables: Object.keys(spec.tables).sort() }))).toEqual([
        { name: 'd2c_state', version: 1, tables: ['bindings', 'index', 'tasks'] },
        { name: 'd2c_control', version: 1, tables: ['managed_tunnel'] },
      ])
    } finally { await ctx.fiber.dispose() }
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('persists a pre-task claim before tunnel startup and rolls it back on startup failure', async () => {
    const ctx = new Context()
    const tools = new Map<string, RegisteredTool>()
    const records = new Map<string, unknown>()
    const workspaceId = 'fixture-execution-workspace'
    const read = vi.spyOn(readLeases, 'bindExecutionReadLease').mockResolvedValue({
      workspaceId: workspaceId as readLeases.ExecutionReadLease['workspaceId'],
      fs: { stat: async () => undefined, readText: async () => '', listDir: async () => [] }, dispose: async () => {},
    })
    const git = vi.spyOn(gitLeases, 'bindExecutionGitLease').mockResolvedValue({
      workspaceId: workspaceId as gitLeases.ExecutionGitLease['workspaceId'], assurance: 'full', dispose: async () => {},
      git: { workspaceId: workspaceId as gitLeases.ExecutionGitLease['workspaceId'], emptyFile: 'NUL', signal: new AbortController().signal, execute: vi.fn() },
    })
    const ready = vi.spyOn(BrowserHarnessAdapter.prototype, 'ensureReady')
    const tunnel = vi.spyOn(TunnelSupervisor.prototype, 'ensure').mockImplementation(async () => {
      expect(records.get('d2c_control/managed_tunnel/owner')).toMatchObject({ workspaceId, phase: 'pre-task' })
      throw new Error('fixture tunnel failure')
    })
    try {
      ctx.provide('storageDomain', { open: async (spec: { name: string }) => ({ close: async () => {}, table: (name: string) => ({
        get: (key: string) => records.get(spec.name + '/' + name + '/' + key),
        put: async (key: string, value: unknown) => { records.set(spec.name + '/' + name + '/' + key, value) },
        delete: async (key: string) => { records.delete(spec.name + '/' + name + '/' + key) },
      }) }) })
      ctx.provide('executionWorldIdentity', { resolve: async () => workspaceId })
      for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
      ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.set(tool.name, tool) } })
      ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
      await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp',  tunnelMode: 'managed', gitRead: true })
      await expect(tools.get('chatgpt_plan')!.execute({ goal: 'fixture' }, {
        agent: { session: { header: { cwd: '/fixture' } } }, signal: new AbortController().signal,
      })).rejects.toThrow('fixture tunnel failure')
      expect(ready).not.toHaveBeenCalled()
      expect(records.has('d2c_control/managed_tunnel/owner')).toBe(false)
    } finally {
      await ctx.fiber.dispose()
      for (const spy of [read, git, ready, tunnel]) spy.mockRestore()
    }
  })
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
      await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp',  tunnelMode: 'external', gitRead: true })
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
    const loading = ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp', }).then(() => { settled = true })
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
    expect(close).toHaveBeenCalledTimes(2)
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
      await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp',  tunnelMode: 'external' })
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
    expect(close).toHaveBeenCalledTimes(2)
  })
})
