import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationCancelledError } from '../src/cancellation.ts'
import { BrowserMutationUncertainError } from '../src/browser/epoch.ts'
import { SidecarRpcError } from '../src/sidecar/errors.ts'
import { recoverOwnedAppProof } from '../src/deployment/dsh-runtime.ts'
import type { SidecarSupervisor } from '../src/deployment/sidecar-supervisor.ts'
const calls = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), close: vi.fn(), credential: vi.fn() }))
vi.mock('../src/deployment/sidecar-target-recovery.ts', () => ({ createOwnedSidecarReplacement: calls.create }))
vi.mock('../src/deployment/sidecar-credential.ts', () => ({ readSidecarCredential: calls.credential }))
vi.mock('../src/deployment/sidecar-supervisor.ts', () => ({ SidecarSupervisor: class {
  constructor(readonly options: unknown) {}
  start(signal?: AbortSignal) { return calls.start(this.options, signal) }
  close() { return calls.close() }
} }))
const operation = { sendOperationId: 'proof-send', waitOperation: { operationId: 'proof-wait', replyBaseline: { version: 1 as const, conversationId: 'owned-conversation', assistantCount: 0, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) }, replyRecovery: { sendOperationId: 'proof-send' } } }
beforeEach(() => { vi.resetAllMocks(); calls.credential.mockResolvedValue('synthetic-authentication'); calls.start.mockResolvedValue(undefined); calls.close.mockResolvedValue(undefined) })
function fixture() {
  const replacement = { sourceTargetId: 'source', replacementTargetId: 'replacement', closeReplacement: vi.fn(async () => {}), retireSource: vi.fn(async () => {}) }
  calls.create.mockResolvedValue(replacement)
  const oldClose = vi.fn(async () => {})
  const options: Parameters<typeof recoverOwnedAppProof>[0] = {
    workspaceKey: 'world\0root', attempts: new Set(), owned: { supervisor: { close: oldClose } as unknown as SidecarSupervisor, targetId: 'source', cdpEndpoint: 'http://127.0.0.1:9222' },
    command: 'node', args: ['native-sidecar-entry'], endpoint: 'http://127.0.0.1:18765/', credentialFile: 'private-reference', excludedRoots: ['world-root'], startupTimeoutMs: 1000,
    health: vi.fn(async () => ({ ok: true })), recover: vi.fn(async () => {}), commit: vi.fn(),
  }
  return { options, replacement, oldClose }
}
describe('owned App-proof recovery transaction', () => {
  it('commits and retires source only after the supplied same-wait proof succeeds', async () => {
    const f = fixture()
    const resume = vi.fn(async () => { expect(f.options.commit).not.toHaveBeenCalled(); expect(f.replacement.retireSource).not.toHaveBeenCalled(); return undefined })
    await expect(recoverOwnedAppProof(f.options, operation, resume)).resolves.toBeUndefined()
    expect(calls.create).toHaveBeenCalledWith('http://127.0.0.1:9222', 'source', undefined)
    expect(f.oldClose).toHaveBeenCalledTimes(1)
    expect(calls.start.mock.calls[0]![0]).toMatchObject({ command: 'node', args: ['native-sidecar-entry'], endpoint: 'http://127.0.0.1:18765/', authentication: 'synthetic-authentication', env: { PLANNERBRIDGE_SIDECAR_TARGET_ID: 'replacement' } })
    expect(resume).toHaveBeenCalledTimes(1)
    expect(f.options.recover).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(vi.mocked(f.options.health).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.options.recover).mock.invocationCallOrder[0]!)
    expect(vi.mocked(f.options.recover).mock.invocationCallOrder[0]).toBeLessThan(resume.mock.invocationCallOrder[0]!)
    expect(f.options.commit).toHaveBeenCalledTimes(1)
    expect(f.replacement.retireSource).toHaveBeenCalledTimes(1)
    expect(f.replacement.closeReplacement).not.toHaveBeenCalled()
    expect(calls.close).not.toHaveBeenCalled()
    expect(f.options.attempts.size).toBe(1)
    await expect(recoverOwnedAppProof(f.options, operation, resume)).rejects.toMatchObject({ code: 'BROWSER_STALE' })
    expect(calls.create).toHaveBeenCalledTimes(1)
  })
  it.each(['APP_PROOF_CHALLENGE_MISMATCH', 'APP_PROOF_ROOT_MISMATCH', 'APP_PROOF_GIT_MISMATCH'])('rolls back a recovered proof failure: %s', async code => {
    const f = fixture()
    await expect(recoverOwnedAppProof(f.options, operation, async () => code)).resolves.toBe(code)
    expect(f.options.commit).not.toHaveBeenCalled()
    expect(f.replacement.retireSource).not.toHaveBeenCalled()
    expect(calls.close).toHaveBeenCalledTimes(1)
    expect(f.replacement.closeReplacement).toHaveBeenCalledTimes(1)
  })
  it.each(['startup', 'health', 'semantic-ready', 'reconcile'] as const)('cleans exactly the known replacement on %s failure, with no second attempt', async stage => {
    const f = fixture(), resume = vi.fn(async () => undefined)
    if (stage === 'startup') calls.start.mockRejectedValue(new SidecarRpcError('SIDECAR_UNAVAILABLE'))
    if (stage === 'health') vi.mocked(f.options.health).mockResolvedValue({ ok: false })
    if (stage === 'semantic-ready') vi.mocked(f.options.recover).mockRejectedValue(new SidecarRpcError('BROWSER_STALE'))
    if (stage === 'reconcile') resume.mockRejectedValue(new SidecarRpcError('SEND_UNCERTAIN'))
    await expect(recoverOwnedAppProof(f.options, operation, resume)).rejects.toMatchObject({ code: stage === 'reconcile' ? 'SEND_UNCERTAIN' : stage === 'semantic-ready' ? 'BROWSER_STALE' : 'SIDECAR_UNAVAILABLE' })
    if (stage !== 'reconcile') expect(resume).not.toHaveBeenCalled()
    if (stage === 'startup' || stage === 'health') expect(f.options.recover).not.toHaveBeenCalled()
    expect(calls.create).toHaveBeenCalledTimes(1)
    expect(f.options.commit).not.toHaveBeenCalled()
    expect(f.replacement.retireSource).not.toHaveBeenCalled()
    expect(f.replacement.closeReplacement).toHaveBeenCalledTimes(1)
    expect(calls.close).toHaveBeenCalledTimes(1)
    await expect(recoverOwnedAppProof(f.options, operation, resume)).rejects.toMatchObject({ code: 'BROWSER_STALE' })
    expect(calls.create).toHaveBeenCalledTimes(1)
  })
  it('preserves unknown creation uncertainty without guessed cleanup or another creation', async () => {
    const f = fixture(), resume = vi.fn(async () => undefined)
    calls.create.mockRejectedValue(new BrowserMutationUncertainError())
    await expect(recoverOwnedAppProof(f.options, operation, resume)).rejects.toBeInstanceOf(BrowserMutationUncertainError)
    expect(f.oldClose).not.toHaveBeenCalled()
    expect(f.replacement.closeReplacement).not.toHaveBeenCalled()
    expect(f.replacement.retireSource).not.toHaveBeenCalled()
    await expect(recoverOwnedAppProof(f.options, operation, resume)).rejects.toMatchObject({ code: 'BROWSER_STALE' })
    expect(calls.create).toHaveBeenCalledTimes(1)
  })
  it.each(['external', 'unbound', 'wrong-send'] as const)('refuses mutation without internally owned exact binding: %s', async mode => {
    const f = fixture()
    if (mode === 'external') f.options.owned = undefined
    const invalid = mode === 'unbound' ? { ...operation, waitOperation: { ...operation.waitOperation, replyBaseline: undefined } } : mode === 'wrong-send' ? { ...operation, sendOperationId: 'other' } : operation
    await expect(recoverOwnedAppProof(f.options, invalid, async () => undefined)).rejects.toMatchObject({ code: 'BROWSER_STALE' })
    expect(calls.create).not.toHaveBeenCalled()
  })
  it('rolls back when cancellation happens during the provisional resumed proof', async () => {
    const f = fixture(), controller = new AbortController()
    await expect(recoverOwnedAppProof(f.options, operation, async () => { controller.abort(); return undefined }, controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
    expect(f.options.commit).not.toHaveBeenCalled()
    expect(f.replacement.retireSource).not.toHaveBeenCalled()
    expect(f.replacement.closeReplacement).toHaveBeenCalledTimes(1)
  })
  it('preserves cancellation during semantic handoff without resuming the wait', async () => {
    const f = fixture(), controller = new AbortController(), resume = vi.fn(async () => undefined)
    vi.mocked(f.options.recover).mockImplementation(async signal => { expect(signal).toBe(controller.signal); controller.abort() })
    await expect(recoverOwnedAppProof(f.options, operation, resume, controller.signal)).rejects.toBeInstanceOf(OperationCancelledError)
    expect(resume).not.toHaveBeenCalled()
    expect(f.options.commit).not.toHaveBeenCalled()
    expect(f.replacement.retireSource).not.toHaveBeenCalled()
    expect(f.replacement.closeReplacement).toHaveBeenCalledTimes(1)
    expect(calls.create).toHaveBeenCalledTimes(1)
  })
})
