import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.ts'

/** One `tools.register()` definition, as the plugin hands it to the registry. */
interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown> }
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<Record<string, unknown>>
}

/** Every tool the plugin registers, in registration order. */
function captureRegistrations(): { tools: RegisteredTool[]; service: { register: (tool: RegisteredTool) => () => void; execute: () => never } } {
  const tools: RegisteredTool[] = []
  return {
    tools,
    service: {
      register: (tool: RegisteredTool) => {
        tools.push(tool)
        return () => {
          const index = tools.indexOf(tool)
          if (index >= 0) tools.splice(index, 1)
        }
      },
      execute: () => { throw new Error('the contract test never dispatches tools') },
    },
  }
}

/** Minimal system-prompt stub: the plugin only appends one section. */
function promptStub(): { sections: Array<{ name: string; order: number; text: string }>; section: (value: never) => () => void; getSectionOrder: () => number } {
  const sections: Array<{ name: string; order: number; text: string }> = []
  return {
    sections,
    section: (value: never) => {
      sections.push(value)
      return () => {
        const index = sections.indexOf(value)
        if (index >= 0) sections.splice(index, 1)
      }
    },
    getSectionOrder: () => 10,
  }
}

/** Minimal storage-domain stub: one table-backed domain, no persistence. */
function storageStub(): { opened: string[]; closed: string[]; open: (spec: { name: string }) => Promise<{ table: () => { get: () => undefined; put: () => Promise<void>; delete: () => Promise<void> }; close: () => Promise<void> }> } {
  const opened: string[] = []
  const closed: string[] = []
  return {
    opened,
    closed,
    async open(spec: { name: string }) {
      opened.push(spec.name)
      return {
        table: () => ({
          get: () => undefined,
          put: async () => {},
          delete: async () => {},
        }),
        close: async () => { closed.push(spec.name) },
      }
    },
  }
}

/** Settle one microtask turn plus a macrotask, so fiber transitions observe. */
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 25) })

describe('required services', () => {
  it('declares the services its startup reads without a fallback', () => {
    expect(plugin.inject).toEqual(['tools', 'systemPrompt', 'storageDomain'])
  })
})

describe('Cordis lifecycle', () => {
  it('stays pending until every injected service is published, then registers the tools', async () => {
    const ctx = new Context()
    const captured = captureRegistrations()
    const prompt = promptStub()
    const storage = storageStub()

    // Mounted before its services exist: Cordis must hold `apply` back.
    const fiber = ctx.plugin({
      name: plugin.name,
      inject: plugin.inject,
      apply: plugin.apply as never,
    }, { bridgePort: 0, replyTimeoutMs: 1000, browserMode: 'browser-harness-mcp' })
    await settle()
    expect(captured.tools).toHaveLength(0)

    await ctx.plugin({ name: 'tools-stub', apply: (c: Context) => { c.provide('tools', captured.service) } })
    await settle()
    expect(captured.tools).toHaveLength(0)

    await ctx.plugin({ name: 'prompt-stub', apply: (c: Context) => { c.provide('systemPrompt', prompt) } })
    await settle()
    expect(captured.tools).toHaveLength(0)

    await ctx.plugin({ name: 'storage-stub', apply: (c: Context) => { c.provide('storageDomain', storage) } })
    await fiber

    expect(captured.tools.map(tool => tool.name)).toEqual([
      'chatgpt_plan',
      'chatgpt_review',
      'chatgpt_setup',
      'chatgpt_status',
      'chatgpt_reconnect',
    ])
    expect(storage.opened).toEqual(['d2c_state'])
    expect(prompt.sections.map(section => section.name)).toEqual(['dsh-with-chatgpt:collaboration'])
    await fiber.dispose()
    expect(captured.tools).toEqual([])
    expect(prompt.sections).toEqual([])
    expect(storage.closed).toEqual(['d2c_state'])
  })
})

/**
 * Assert one node stays inside the enforced JSON Schema subset the registry
 * and the DeepSeek wire schema both require: a scalar `type`, array `items`,
 * object `properties`/`required`, and no unsupported keyword.
 */
function assertWireSchema(node: Record<string, unknown>, path: string): void {
  const supported = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])
  for (const key of Object.keys(node)) {
    expect(supported.has(key), `${path} uses unsupported keyword ${key}`).toBe(true)
  }
  const type = node['type']
  if (node['properties'] !== undefined) {
    expect(type, `${path} declares properties without type: object`).toBe('object')
    const properties = node['properties'] as Record<string, Record<string, unknown>>
    for (const [name, child] of Object.entries(properties)) {
      assertWireSchema(child, `${path}.${name}`)
    }
    for (const name of (node['required'] ?? []) as string[]) {
      expect(Object.hasOwn(properties, name), `${path}.required names undeclared ${name}`).toBe(true)
    }
  }
  if (node['items'] !== undefined) {
    expect(type, `${path} declares items without type: array`).toBe('array')
    assertWireSchema(node['items'] as Record<string, unknown>, `${path}[]`)
  }
}

describe('model-facing tool schemas', () => {
  it('registers object-rooted wire schemas the DeepSeek API accepts', async () => {
    const ctx = new Context()
    const captured = captureRegistrations()
    const prompt = promptStub()
    const storage = storageStub()
    await ctx.plugin({ name: 'tools-stub', apply: (c: Context) => { c.provide('tools', captured.service) } })
    await ctx.plugin({ name: 'prompt-stub', apply: (c: Context) => { c.provide('systemPrompt', prompt) } })
    await ctx.plugin({ name: 'storage-stub', apply: (c: Context) => { c.provide('storageDomain', storage) } })
    await ctx.plugin({
      name: plugin.name,
      inject: plugin.inject,
      apply: plugin.apply as never,
    }, { bridgePort: 0, replyTimeoutMs: 1000, browserMode: 'browser-harness-mcp' })

    const byName = new Map(captured.tools.map(tool => [tool.name, tool]))
    for (const [name, tool] of byName) {
      expect(tool.parameters['type'], `${name} parameters must be object-rooted`).toBe('object')
      expect(tool.parameters['additionalProperties'], `${name} parameters must reject undeclared keys`).toBe(false)
      assertWireSchema(tool.parameters, `${name}.parameters`)
      expect(tool.output.schema['type'], `${name} output schema must be object-rooted`).toBe('object')
      assertWireSchema(tool.output.schema, `${name}.output.schema`)
    }

    expect(byName.get('chatgpt_plan')?.parameters['required']).toEqual(['goal'])
    const planProperties = byName.get('chatgpt_plan')?.parameters['properties'] as Record<string, { type?: string }>
    expect(planProperties['goal']?.type).toBe('string')

    const reviewParameters = byName.get('chatgpt_review')?.parameters as {
      required: string[]
      properties: Record<string, { type?: string; items?: { type?: string } }>
    }
    expect(reviewParameters.required).toEqual(['taskId'])
    expect(reviewParameters.properties['changedFiles']?.type).toBe('array')
    expect(reviewParameters.properties['changedFiles']?.items?.type).toBe('string')
    expect(reviewParameters.properties['testsRecorded']?.type).toBe('boolean')

    for (const name of ['chatgpt_status', 'chatgpt_reconnect']) {
      const parameters = byName.get(name)?.parameters as { properties: Record<string, unknown> }
      expect(Object.keys(parameters.properties)).toEqual([])
    }
    await ctx.fiber.dispose()
  })
})
