import { describe, expect, it } from 'vitest'
import { DshGitAuthorityAdapter } from '../src/adapters/dsh/git-authority.ts'
import { WorkspaceRuntimeRegistry } from '../src/workspace/runtime.ts'
import type { ExecutionWorkspacePort } from '../src/core/ports/execution-workspace.ts'
import type { GitAuthority } from '../src/core/ports/git-authority.ts'

function fixture() {
  const registry = new WorkspaceRuntimeRegistry()
  const controller = new AbortController()
  const identity = { workspaceId: 'world', displayRoot: 'opaque-provider-root' }
  let calls = 0, disposed = 0
  let head = 'a'.repeat(40)
  const git = { signal: controller.signal, async execute(args: readonly string[]) {
    calls++
    if (args.includes('HEAD...@{u}')) return { stdout: '0\t0', stderr: '', exitCode: 0 }
    if (args.includes('--symbolic-full-name')) return { stdout: 'origin/feature', stderr: '', exitCode: 0 }
    if (args.includes('--abbrev-ref')) return { stdout: 'feature', stderr: '', exitCode: 0 }
    if (args.includes('status')) return { stdout: '', stderr: '', exitCode: 0 }
    return { stdout: head, stderr: '', exitCode: 0 }
  } }
  const lease = { identity, signal: controller.signal, generation: Symbol(), git, capabilities: {
    workspaceContentRead: { available: true as const }, gitRead: { available: true as const, assurance: 'hardened-windows' as const },
    executionOutput: { available: false as const, reason: 'EXECUTION_OUTPUT_UNAVAILABLE' as const },
  } }
  let release: (() => void) | undefined
  const workspace: ExecutionWorkspacePort = { async withOperation(request, callback) {
    expect(request.capabilities).toContain('gitRead')
    release = registry.acquire(lease)
    try { return await callback({ identity, signal: controller.signal,
      has: () => registry.capabilities('world').gitRead.available,
      require: () => { registry.require('world', 'gitRead') },
    }) } finally { release?.(); disposed++ }
  } }
  const adapter = new DshGitAuthorityAdapter({ workspace, registry, locator: {}, workspaceId: 'world' })
  return { adapter, registry, controller, git, get calls() { return calls }, get disposed() { return disposed },
    setHead(value: string) { head = value }, replace() { release?.(); release = registry.acquire({ ...lease, generation: Symbol() }) } }
}

describe('Git authority lifetime and provider affinity', () => {
  it('obtains fresh metadata and joins disposal after callback settlement', async () => {
    const f = fixture()
    await f.adapter.withAuthority(async authority => {
      const a = await authority.snapshot()
      expect(a).toMatchObject({ head: 'a'.repeat(40), clean: true, ahead: 0, behind: 0 })
      f.setHead('b'.repeat(40))
      expect((await authority.snapshot()).head).toBe('b'.repeat(40))
      expect(f.disposed).toBe(0)
    })
    expect(f.disposed).toBe(1)
    expect(f.registry.capabilities('world').gitRead.available).toBe(false)
  })
  it('refuses a saved authority after callback settlement without invoking Git', async () => {
    const f = fixture()
    let escaped!: GitAuthority
    await f.adapter.withAuthority(async authority => { escaped = authority })
    await expect(escaped.snapshot()).rejects.toThrow('GIT_PROOF_UNAVAILABLE')
    expect(f.calls).toBe(0)
  })
  it('refuses a replaced provider generation without invoking the replacement executor', async () => {
    const f = fixture()
    await f.adapter.withAuthority(async authority => {
      f.replace()
      await expect(authority.snapshot()).rejects.toThrow('GIT_PROOF_UNAVAILABLE')
    })
    expect(f.calls).toBe(0)
    expect(f.disposed).toBe(1)
  })
  it('rejects cancellation from an executor that ignores abort, then joins disposal', async () => {
    const f = fixture()
    f.git.execute = async () => {
      f.controller.abort()
      return { stdout: 'a'.repeat(40), stderr: '', exitCode: 0 }
    }
    await expect(f.adapter.withAuthority(authority => authority.snapshot())).rejects.toThrow()
    expect(f.disposed).toBe(1)
  })
})
