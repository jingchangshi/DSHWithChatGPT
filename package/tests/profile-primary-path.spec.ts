import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('primary DSH profile verification', () => {
  it('uses the canonical Planner-Executor profile and Sidecar transport', () => {
    const script = readFileSync(resolve(import.meta.dirname, '../scripts/verify-profile.mjs'), 'utf8')
    expect(script).toContain("profiles', 'planner-executor-smoke")
    expect(script).toContain("name: 'planner-executor-smoke'")
    expect(script).toContain("browserMode: 'sidecar'")
    expect(script).toContain('sidecarEndpoint: sidecar.endpoint')
    expect(script).toContain('sidecarCredentialFile: sidecar.credentialFile')
    expect(script).toContain("provider: 'deepseek-official'")
    expect(script).toContain("model: 'deepseek-flash'")
    expect(script).toContain("apiKeyEnv: 'DEEPSEEK_API_KEY'")
    expect(script).not.toContain('reasoningEffort')
    expect(script).toContain('DSH_PLANNER_EXECUTOR_SMOKE_RUN_ID')
    expect(script).toContain('DSH_PLANNER_EXECUTOR_SMOKE_REPORT')
    expect(script).not.toContain('browserMode: \'browser-harness-mcp\'')
    expect(script).not.toContain('DSH_C2C_SMOKE_')
  })

  it('keeps the profile fixture identity neutral', () => {
    const fixture = readFileSync(resolve(import.meta.dirname, 'fixtures/profile-identity-probe.mjs'), 'utf8')
    expect(fixture).toContain("planner-executor-profile-identity-probe")
    expect(fixture).toContain('DSH_PLANNER_EXECUTOR_SMOKE_RUN_ID')
    expect(fixture).not.toContain('DSH_C2C_SMOKE_')
  })
})
