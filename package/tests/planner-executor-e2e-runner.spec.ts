import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('canonical Planner-Executor E2E runner', () => {
  const script = readFileSync(resolve(import.meta.dirname, '../scripts/verify-planner-executor-e2e.mjs'), 'utf8')

  it('uses native DeepSeek and refuses Browser Harness on the primary path', () => {
    expect(script).toContain("provider: 'deepseek-official'")
    expect(script).toContain("model: 'deepseek-flash'")
    expect(script).toContain("id: 'llm-deepseek'")
    expect(script).toContain('Primary Planner-Executor acceptance must not mount Browser Harness')
    expect(script).not.toContain('browser-harness-mcp')
    expect(script).not.toContain("@deepseek-ai/dsh-browser-use")
    expect(script).not.toContain('C2C_EXECUTION_')
  })

  it('derives acceptance from recorded nonce and independent review evidence', () => {
    expect(script).toContain('successfulNonces.size > 0')
    expect(script).toContain('successfulNonces.has(review.reviewNonce)')
    expect(script).toContain('reviewArgumentNonceLeak === true')
    expect(script).not.toContain('plannerExecutorAccepted: false')
  })
})
