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
    // The executable oracle cases test the criteria; this gate checks runner wiring.
    expect(script).toContain("import { evaluateAcceptance, readinessFailure } from './planner-executor-acceptance.mjs'")
    expect(script).toContain('evaluateAcceptance({ records, runId, code, restartPending, git:')
    expect(script).toContain('process.exitCode = acceptance.exitCode')
    expect(script).not.toContain('plannerExecutorAccepted: false')
  })

  it('verifies the parent-owned workload at initialization, before restart, and before the oracle', () => {
    expect(script).toContain('initializeAcceptanceWorkload, verifyAcceptanceWorkload')
    const initial = script.indexOf("verifyAcceptanceWorkload(workspace, workload, 'initial')")
    const first = script.indexOf("runPhase(1, task, initialTargetId)")
    const boundary = script.indexOf("verifyAcceptanceWorkload(workspace, workload, 'phase1')")
    const second = script.indexOf('runPhase(2, reconnectTask, await readTargetPointer(targetPointer))')
    const final = script.indexOf("verifyAcceptanceWorkload(workspace, workload, 'phase2')")
    const oracle = script.indexOf('evaluateAcceptance({ records, runId, code, restartPending, git:')
    expect(initial).toBeGreaterThan(0)
    expect(first).toBeGreaterThan(initial)
    expect(boundary).toBeGreaterThan(first)
    expect(second).toBeGreaterThan(boundary)
    expect(final).toBeGreaterThan(second)
    expect(oracle).toBeGreaterThan(final)
  })

  it('supervises the installed native entry and passes the concrete owned target on phase restart', () => {
    expect(script).toContain(".resolve('dsh-with-chatgpt/package.json')")
    expect(script).toContain('...ownedSidecarConfig(sidecarEndpoint,')
    expect(script).toContain('await assertSidecarEndpointUnused(sidecarEndpoint)')
    expect(script).toContain('...phaseEnvironment(process.env, targetId)')
    expect(script).toContain('runPhase(2, reconnectTask, await readTargetPointer(targetPointer))')
    expect(script).not.toContain('/json/list')
    expect(script).not.toContain('/json/new')
  })
})
