import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

// Import inside each case so the pre-implementation run reports every missing contract.
async function fixture() {
  const { DshAgentAdapter } = await import('../src/adapters/dsh/agent.ts')
  const root = new Context()
  const tools = new Map<string, any>()
  const prompts = new Map<string, any>()
  const freeze = vi.fn(async (_execution: unknown) => ({ taskId: 'planner_task_a', iteration: 2 }))
  const record = vi.fn()
  const execute = vi.fn(async (_args: unknown, _execution: unknown) => 'tool result')
  let mounted!: Context
  // Public registration contracts: tools return a disposer; prompt contributions
  // already register their own effect with the caller's Cordis fiber.
  root.provide('tools', { register(tool: any) {
    tools.set(tool.name, tool)
    return () => { tools.delete(tool.name) }
  } })
  root.provide('systemPrompt', {
    getSectionOrder: () => 2600,
    section(section: any) {
      return mounted.effect(() => {
        prompts.set(section.name, section)
        return () => { prompts.delete(section.name) }
      })
    },
  })
  const plugin = await root.plugin({
    inject: ['tools', 'systemPrompt'],
    apply(ctx: Context) {
      mounted = ctx
      new DshAgentAdapter(ctx).mount({
        tools: [{ name: 'planner_plan', description: 'Plan',
          parameters: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'], additionalProperties: false },
          output: { schema: {}, render: () => [] }, execute }],
        prompt: { name: 'plannerbridge:collaboration', order: 'TOOL_WORKFLOW', text: 'Use the planner.' },
        evidence: { freeze, record },
      })
    },
  })
  const events = root as unknown as {
    waterfall(name: string, execution: object, next: () => Promise<unknown>): Promise<unknown>
    emit(name: string, execution: object, result: unknown): void
  }
  const invocation = () => ({ name: 'pwsh', arguments: { command: 'Write-Output evidence' },
    agent: { session: { header: { cwd: '/execution/world' } } }, signal: new AbortController().signal })
  return { root, plugin, mounted, tools, prompts, freeze, record, execute, events, invocation }
}

describe('DSH inbound adapter lifecycle', () => {
  it('validates required arguments before invoking a runtime use case', async () => {
    const f = await fixture()
    try {
      await expect(f.tools.get('planner_plan').execute({}, f.invocation())).rejects.toThrow('INVALID_TOOL_ARGUMENTS')
      expect(f.execute).not.toHaveBeenCalled()
      const raw = f.invocation()
      expect(await f.tools.get('planner_plan').execute({ goal: 'Inspect' }, raw)).toBe('tool result')
      expect(f.execute).toHaveBeenCalledWith({ goal: 'Inspect' }, expect.objectContaining({
        sessionCwd: '/execution/world', signal: raw.signal, locator: raw,
      }))
    } finally { await f.root.fiber.dispose() }
  })

  it('does not infer a missing session cwd from the process working directory', async () => {
    const f = await fixture()
    try {
      await f.tools.get('planner_plan').execute({ goal: 'Inspect' }, { signal: new AbortController().signal })
      expect(f.execute.mock.calls[0]![1]).toMatchObject({ sessionCwd: undefined })
    } finally { await f.root.fiber.dispose() }
  })

  it('freezes ownership before dispatch and consumes it once for the same execution object', async () => {
    const f = await fixture()
    try {
      const raw = f.invocation()
      const result = { value: { kind: 'foreground', exitCode: 0 } }
      const next = vi.fn(async () => {
        expect(f.freeze).toHaveBeenCalledOnce()
        expect(f.record).not.toHaveBeenCalled()
        return result
      })
      expect(await f.events.waterfall('tools/execute', raw, next)).toBe(result)
      f.events.emit('tools/result', { ...raw }, result)
      expect(f.record).not.toHaveBeenCalled()
      f.events.emit('tools/result', raw, result)
      f.events.emit('tools/result', raw, result)
      expect(next).toHaveBeenCalledOnce()
      expect(f.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ locator: raw }), result,
        { taskId: 'planner_task_a', iteration: 2 })
    } finally { await f.root.fiber.dispose() }
  })

  it('preserves the actual shell outcome if evidence capture or recording fails', async () => {
    const f = await fixture()
    try {
      const result = { isError: true, value: { exitCode: 1 } }
      f.freeze.mockRejectedValueOnce(new Error('identity unavailable'))
      const first = f.invocation()
      expect(await f.events.waterfall('tools/execute', first, async () => result)).toBe(result)
      f.events.emit('tools/result', first, result)
      expect(f.record).not.toHaveBeenCalled()
      const second = f.invocation()
      await f.events.waterfall('tools/execute', second, async () => result)
      f.record.mockImplementation(() => { throw new Error('recorder unavailable') })
      expect(() => f.events.emit('tools/result', second, result)).not.toThrow()
      expect(() => f.events.emit('tools/result', second, result)).not.toThrow()
      expect(f.record).toHaveBeenCalledOnce()
    } finally { await f.root.fiber.dispose() }
  })

  it('unloads registrations and event listeners with the plugin fiber while the host remains live', async () => {
    const f = await fixture()
    try {
      expect([...f.tools.keys()]).toEqual(['planner_plan'])
      expect(f.prompts.get('plannerbridge:collaboration')).toMatchObject({ order: 2600 })
      const raw = f.invocation()
      await f.events.waterfall('tools/execute', raw, async () => ({ value: { exitCode: 0 } }))
      await f.plugin.dispose()
      expect(f.tools.size).toBe(0)
      expect(f.prompts.size).toBe(0)
      f.freeze.mockClear()
      f.events.emit('tools/result', raw, { value: { exitCode: 0 } })
      const next = vi.fn(async () => 'host still live')
      expect(await f.events.waterfall('tools/execute', f.invocation(), next)).toBe('host still live')
      expect(next).toHaveBeenCalledOnce()
      expect(f.freeze).not.toHaveBeenCalled()
      expect(f.record).not.toHaveBeenCalled()
    } finally { await f.root.fiber.dispose() }
  })
})
