import type { Context } from '@deepseek-ai/cordis'
import type { AgentExecution, AgentMount } from '../../core/ports/agent.ts'

interface DshExecution {
  name?: string
  arguments?: Record<string, unknown>
  agent?: { session?: { header?: { cwd?: string } } }
  signal?: AbortSignal
}

function invocation(raw: DshExecution | undefined, name = '', arguments_: Record<string, unknown> = {}): AgentExecution {
  return {
    name: raw?.name ?? name,
    arguments: raw?.arguments ?? arguments_,
    sessionCwd: raw?.agent?.session?.header?.cwd,
    signal: raw?.signal,
    locator: raw,
  }
}

/** Inbound public DSH wiring; deployment injects use cases and evidence ownership. */
export class DshAgentAdapter {
  private mounted = false
  constructor(private readonly context: Context) {}

  mount<Owner>(options: AgentMount<Owner>): void {
    if (this.mounted) throw new Error('AGENT_ADAPTER_ALREADY_MOUNTED')
    const ctx = this.context
    const tools = ctx.get('tools')
    if (tools === undefined) throw new Error('PlannerBridge requires the tools service')
    this.mounted = true
    for (const tool of options.tools) {
      ctx.effect(() => tools.register({
        ...tool,
        async execute(args: Record<string, unknown>, raw: DshExecution | undefined) {
          for (const key of tool.parameters.required) {
            if (!Object.hasOwn(args, key) || args[key] === undefined) throw new Error('INVALID_TOOL_ARGUMENTS: missing ' + key)
          }
          return tool.execute(args, invocation(raw, tool.name, args))
        },
      }))
    }
    const prompt = ctx.get('systemPrompt')
    if (options.prompt && prompt && typeof prompt.section === 'function' && typeof prompt.getSectionOrder === 'function') {
      // The public prompt service owns its section effect under this caller's fiber.
      prompt.section({ ...options.prompt, order: prompt.getSectionOrder(options.prompt.order) })
    }
    if (options.evidence) {
      const evidence = options.evidence
      const owners = new WeakMap<object, Owner>()
      const events = ctx as unknown as {
        on(name: 'tools/execute', handler: (raw: DshExecution, next: () => Promise<unknown>) => Promise<unknown>): void
        on(name: 'tools/result', handler: (raw: DshExecution, result: unknown) => void): void
      }
      events.on('tools/execute', async (raw, next) => {
        try {
          const owner = await evidence.freeze(invocation(raw))
          if (owner !== undefined) owners.set(raw, owner)
        } catch {
          // Observation failure must not veto or replace the executor's outcome.
        }
        return next()
      })
      events.on('tools/result', (raw, result) => {
        const owner = owners.get(raw)
        if (owner === undefined) return
        owners.delete(raw)
        try { evidence.record(invocation(raw), result, owner) } catch {
          // Consume the ownership even on recorder failure; never attribute twice.
        }
      })
    }
  }
}
