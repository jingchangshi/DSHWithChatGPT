import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Use the consumer's actual validator, rather than accepting arbitrary schema
// objects in a mock registry. This also checks the packed plugin entry point.
const [source, installation] = process.argv.slice(2)
assert.ok(source && installation, 'Usage: node scripts/verify-dsh-tool-schemas.mjs <DSH source root> <isolated package installation>')
const entry = path.join(path.resolve(installation), 'node_modules', 'dsh-with-chatgpt', 'lib', 'index.js')
const requirePlugin = createRequire(entry)
const { Context } = await import(pathToFileURL(requirePlugin.resolve('@deepseek-ai/cordis')).href)
const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(pathToFileURL(path.join(path.resolve(source), 'packages/core/tools/lib/index.js')).href)
const { apply, Config, inject } = await import(pathToFileURL(entry).href)
const ctx = new Context()
const tools = new Map()
ctx.provide('storageDomain', { open: async () => ({ close: async () => {} }) })
ctx.provide('executionWorldIdentity', { resolve: async () => 'workspace' })
for (const name of ['fs', 'subprocess', 'sandbox']) ctx.provide(name, {})
ctx.provide('tools', { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } })
ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
try {
  await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp' })
  assert.equal(tools.size, 5)
  for (const tool of tools.values()) {
    assertSupportedJsonSchema(tool.parameters)
    assertSupportedJsonSchema(tool.output.schema)
  }
  for (const name of ['chatgpt_plan', 'chatgpt_review']) {
    const head = tools.get(name).output.schema.properties.head
    assert.deepEqual(validateJsonSchemaValue(head, null), [])
    assert.deepEqual(validateJsonSchemaValue(head, 'a'.repeat(40)), [])
    assert.notDeepEqual(validateJsonSchemaValue(head, 42), [])
  }
  console.log('VERIFIED: all five packed collaboration tools satisfy the real DSH schema subset; nullable HEAD enforces string/null')
} finally {
  await ctx.fiber.dispose()
}
