import { describe, expect, it, vi } from 'vitest'
import { runDoctor, type DoctorInputs } from '../src/readiness/doctor.ts'
import { startBridgeServer } from '../src/bridge/server.ts'
import { OperationCancelledError } from '../src/cancellation.ts'
import { SidecarRpcError } from '../src/sidecar/errors.ts'
import type { ControlOperation } from '../src/core/ports/chat-control.ts'

const challenge = 'TEST_CHALLENGE_MUST_NOT_LEAK'
const root = { path: '', visibleEntryCount: 0, truncated: false, firstVisibleEntry: null }
const git = { isRepo: false, head: null, branch: null }
const proof = { challenge, workspaceId: 'doctor-proof-workspace', root, git }

async function fixture() {
  const server = await startBridgeServer({ port: 0, tokens: new Map([['test-token', 'workspace']]) }, [
    { name: 'workspace_info', description: '', inputSchema: {}, async handler() { return { workspaceId: proof.workspaceId, appProof: { version: 1, challenge }, capabilities: { leaseBound: true, workspaceContentRead: { available: true }, gitRead: { available: true }, executionOutput: { available: false } } } } },
    { name: 'list_directory', description: '', inputSchema: {}, async handler() { return { path: '', entries: [], truncated: false } } },
    { name: 'git_status', description: '', inputSchema: {}, async handler() { return git } },
  ])
  const send = vi.fn(async () => {})
  const wait = vi.fn(async () => ({ text: '[D2C_APP_PROOF_V1]' + JSON.stringify(proof), complete: true }))
  const inputs = {
    mode: 'app-proof', appProofTimeoutMs: 1000, workspaceRoot: 'fixture', workspaceId: proof.workspaceId, appName: 'exact App',
    bridgeHttp: { port: server.port, token: 'test-token' },
    runtime: { bridge: { workspaceId: proof.workspaceId }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'fixture' } },
    browser: { readiness: async () => ({ url: 'https://chatgpt.com/c/fixture', composer: true, loggedOut: false }), sendControlMessage: send, waitForReply: wait },
    probeApp: async () => {},
  } as unknown as DoctorInputs
  return { server, inputs, send, wait }
}

async function observedFixture() {
  const current = await fixture()
  const baseline = { version: 1 as const, conversationId: null, assistantCount: 0, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) }
  const bound = { ...baseline, conversationId: 'owned-proof-conversation', observationEpoch: 'c'.repeat(64) }
  const capture = vi.fn(async () => baseline)
  const bind = vi.fn(async (_sendId: string) => bound)
  Object.assign(current.inputs.browser, { captureReplyBaseline: capture, captureSendObservation: bind })
  // This internal transaction returns the unchanged semantic proof result. It
  // must never repeat the doctor invocation or own a send closure.
  const recover = vi.fn(async (_operation: { sendOperationId: string; waitOperation: ControlOperation }, resume: () => Promise<string | undefined>, _signal?: AbortSignal) => resume())
  const inputs = { ...current.inputs, recoverAppProof: recover }
  return { ...current, inputs, baseline, bound, capture, bind, recover }
}

describe('doctor App proof orchestration', () => {
  it.each(['BROWSER_TARGET_CHANGED', 'SEND_UNCERTAIN', 'SIDECAR_UNAVAILABLE'] as const)('preserves %s during proof without resending', async code => {
    const current = await fixture()
    current.wait.mockRejectedValue(new SidecarRpcError(code))
    try {
      const result = await runDoctor(current.inputs)
      expect(result.checks.find(check => check.id === 'remote_workspace_access')?.code).toBe(code)
      expect(result.appDataPlaneVerified).toBe(false)
      expect(current.send).toHaveBeenCalledTimes(1)
      expect(current.wait).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(result)).not.toContain(challenge)
    } finally { await current.server.close() }
  })
  it('rejects a factless reply while keeping later local probes read-only', async () => {
    const current = await fixture()
    current.wait.mockResolvedValue({ text: 'No tools available', complete: true })
    try {
      const result = await runDoctor(current.inputs)
      expect(result.checks.find(check => check.id === 'remote_workspace_access')?.code).toBe('APP_PROOF_REPLY_MISSING')
      expect(await runDoctor({ ...current.inputs, mode: 'local' })).toMatchObject({ localReady: true, appDataPlaneVerified: false })
      expect(current.send).toHaveBeenCalledTimes(1)
    } finally { await current.server.close() }
  })
  it('verifies remote facts without leaking the challenge or claiming full product acceptance', async () => {
    const current = await fixture()
    try {
      const result = await runDoctor(current.inputs)
      expect(result).toMatchObject({ ready: true, localReady: true, appDataPlaneVerified: true, fullC2CVerified: false })
      expect(JSON.stringify(result)).not.toContain(challenge)
      expect(JSON.stringify(current.send.mock.calls)).not.toContain(challenge)
    } finally { await current.server.close() }
  })
  it.each([undefined, 'local'] as const)('does not send in local mode %s', async mode => {
    const current = await fixture()
    try {
      expect(await runDoctor({ ...current.inputs, mode })).toMatchObject({ localReady: true, appDataPlaneVerified: false, fullC2CVerified: false })
      expect(current.send).not.toHaveBeenCalled()
    } finally { await current.server.close() }
  })
  it.each([
    [{ ...proof, challenge: 'old' }, 'APP_PROOF_CHALLENGE_MISMATCH'],
    [{ ...proof, workspaceId: 'other' }, 'APP_PROOF_WORKSPACE_MISMATCH'],
    [{ ...proof, root: { ...root, visibleEntryCount: 1 } }, 'APP_PROOF_ROOT_MISMATCH'],
    [{ ...proof, git: { isRepo: true, head: 'other', branch: null } }, 'APP_PROOF_GIT_MISMATCH'],
    [{}, 'APP_PROOF_MALFORMED'],
  ])('rejects mismatched proof %#', async (value, code) => {
    const current = await fixture()
    current.wait.mockResolvedValue({ text: '[D2C_APP_PROOF_V1]' + JSON.stringify(value), complete: true })
    try {
      const result = await runDoctor(current.inputs)
      expect(result).toMatchObject({ localReady: true, appDataPlaneVerified: false, fullC2CVerified: false })
      expect(result.checks.find(check => check.id === 'remote_workspace_access')?.code).toBe(code)
    } finally { await current.server.close() }
  })
  it('skips sending when local prerequisites fail', async () => {
    const current = await fixture()
    current.inputs.runtime.tunnel.ready = false
    try {
      expect((await runDoctor(current.inputs)).checks.find(check => check.id === 'remote_workspace_access')?.code).toBe('APP_PROOF_PREREQUISITE_FAILED')
      expect(current.send).not.toHaveBeenCalled()
    } finally { await current.server.close() }
  })
  it('bounds an unresponsive browser without exposing provider errors', async () => {
    const current = await fixture()
    current.wait.mockImplementation(() => new Promise(() => {}))
    try {
      const result = await runDoctor({ ...current.inputs, appProofTimeoutMs: 20 })
      expect(result.checks.find(check => check.id === 'remote_workspace_access')?.code).toBe('APP_PROOF_TIMEOUT')
      expect(result.localReady).toBe(true)
    } finally { await current.server.close() }
  })
  it('propagates cancellation during reply wait', async () => {
    const current = await fixture()
    const controller = new AbortController()
    current.wait.mockImplementation(() => { controller.abort(); return new Promise(() => {}) })
    try {
      await expect(runDoctor({ ...current.inputs, signal: controller.signal })).rejects.toBeInstanceOf(OperationCancelledError)
    } finally { await current.server.close() }
  })
})

describe('proof-bound App wait recovery', () => {
  it.each(['baseline', 'binding'] as const)('does not fall back to an unbound wait when the provider omits %s', async missing => {
    const current = await observedFixture()
    if (missing === 'baseline') current.capture.mockResolvedValue(undefined as never)
    else current.bind.mockResolvedValue(undefined as never)
    try {
      const result = await runDoctor(current.inputs)
      expect(result.appDataPlaneVerified).toBe(false)
      expect(result.checks.find(c => c.id === 'remote_workspace_access')?.code).toBe('SEND_UNCERTAIN')
      expect(current.send).toHaveBeenCalledTimes(missing === 'baseline' ? 0 : 1)
      expect(current.wait).not.toHaveBeenCalled()
      expect(current.recover).not.toHaveBeenCalled()
    } finally { await current.server.close() }
  })
  it('binds one explicit send before waiting with its exact durable observation', async () => {
    const current = await observedFixture()
    try {
      expect((await runDoctor(current.inputs)).appDataPlaneVerified).toBe(true)
      expect(current.capture).toHaveBeenCalledTimes(1)
      expect(current.send).toHaveBeenCalledTimes(1)
      const send = (current.send.mock.calls[0] as unknown as [string, AbortSignal, ControlOperation])[2]
      const wait = (current.wait.mock.calls[0] as unknown as [number, AbortSignal, ControlOperation])[2]
      expect(send.operationId).toEqual(expect.any(String))
      expect(send.replyBaseline).toEqual(current.baseline)
      expect(current.bind).toHaveBeenCalledWith(send.operationId, expect.any(AbortSignal))
      expect(wait.operationId).not.toBe(send.operationId)
      expect(wait.replyBaseline).toEqual(current.bound)
      expect(wait.replyRecovery).toEqual({ sendOperationId: send.operationId })
      expect(current.bind.mock.invocationCallOrder[0]).toBeLessThan(current.wait.mock.invocationCallOrder[0]!)
      expect(current.recover).not.toHaveBeenCalled()
    } finally { await current.server.close() }
  })
  it('resumes only the same wait once after BROWSER_STALE with one send', async () => {
    const current = await observedFixture()
    current.wait.mockRejectedValueOnce(new SidecarRpcError('BROWSER_STALE'))
    try {
      expect((await runDoctor(current.inputs)).appDataPlaneVerified).toBe(true)
      expect(current.send).toHaveBeenCalledTimes(1)
      expect(current.bind).toHaveBeenCalledTimes(1)
      expect(current.wait).toHaveBeenCalledTimes(2)
      expect(current.wait.mock.calls[1]).toEqual(current.wait.mock.calls[0])
      expect(current.recover).toHaveBeenCalledTimes(1)
      const operation = current.recover.mock.calls[0]![0]
      expect(operation.waitOperation).toEqual((current.wait.mock.calls[0] as unknown as [number, AbortSignal, ControlOperation])[2])
    } finally { await current.server.close() }
  })
  it('does not retry recovery when the resumed wait is also unavailable', async () => {
    const current = await observedFixture()
    current.wait.mockRejectedValue(new SidecarRpcError('BROWSER_STALE'))
    try {
      const result = await runDoctor(current.inputs)
      expect(result.checks.find(c => c.id === 'remote_workspace_access')?.code).toBe('BROWSER_STALE')
      expect(current.recover).toHaveBeenCalledTimes(1)
      expect(current.wait).toHaveBeenCalledTimes(2)
      expect(current.send).toHaveBeenCalledTimes(1)
    } finally { await current.server.close() }
  })
  it.each(['BROWSER_STALE', 'SEND_UNCERTAIN'] as const)('fails closed before waiting when send binding returns %s', async code => {
    const current = await observedFixture()
    current.bind.mockRejectedValue(new SidecarRpcError(code))
    try {
      const result = await runDoctor(current.inputs)
      expect(result.checks.find(c => c.id === 'remote_workspace_access')?.code).toBe(code)
      expect(current.send).toHaveBeenCalledTimes(1)
      expect(current.wait).not.toHaveBeenCalled()
      expect(current.recover).not.toHaveBeenCalled()
    } finally { await current.server.close() }
  })
  it.each(['SEND_UNCERTAIN', 'BROWSER_TARGET_CHANGED', 'SIDECAR_TIMEOUT', 'CHATGPT_LOGGED_OUT', 'CHATGPT_APP_UNAVAILABLE'] as const)('does not recover other initial wait errors: %s', async code => {
    const current = await observedFixture()
    current.wait.mockRejectedValue(new SidecarRpcError(code))
    try {
      const result = await runDoctor(current.inputs)
      expect(result.checks.find(c => c.id === 'remote_workspace_access')?.code).toBe(code)
      expect(current.recover).not.toHaveBeenCalled()
      expect(current.send).toHaveBeenCalledTimes(1)
    } finally { await current.server.close() }
  })
  it('verifies the recovered proof before reporting transaction success', async () => {
    const current = await observedFixture()
    current.wait.mockRejectedValueOnce(new SidecarRpcError('BROWSER_STALE')).mockResolvedValueOnce({ text: '[D2C_APP_PROOF_V1]' + JSON.stringify({ ...proof, challenge: 'wrong' }), complete: true })
    try {
      const result = await runDoctor(current.inputs)
      expect(result.appDataPlaneVerified).toBe(false)
      expect(result.checks.find(c => c.id === 'remote_workspace_access')?.code).toBe('APP_PROOF_CHALLENGE_MISMATCH')
      expect(current.recover).toHaveReturnedTimes(1)
      await expect(current.recover.mock.results[0]!.value).resolves.toBe('APP_PROOF_CHALLENGE_MISMATCH')
      expect(current.send).toHaveBeenCalledTimes(1)
    } finally { await current.server.close() }
  })
  it('keeps the original absolute deadline while replaying the unchanged wait payload', async () => {
    const current = await observedFixture()
    const ready = current.inputs.browser.readiness!
    current.inputs.browser.readiness = async signal => { const value = await ready(signal); vi.useFakeTimers(); return value }
    let rejectFirst!: (error: Error) => void
    let entered!: () => void
    const firstWait = new Promise<void>(resolve => { entered = resolve })
    current.wait.mockImplementationOnce(() => { entered(); return new Promise((_resolve, reject) => { rejectFirst = reject }) })
      .mockImplementation(() => new Promise(() => {}))
    try {
      let settled = false
      const pending = runDoctor({ ...current.inputs, appProofTimeoutMs: 100 }).then(result => { settled = true; return result })
      await firstWait
      await vi.advanceTimersByTimeAsync(80)
      rejectFirst(new SidecarRpcError('BROWSER_STALE'))
      await vi.advanceTimersByTimeAsync(0)
      expect(current.recover).toHaveBeenCalledTimes(1)
      expect(current.wait.mock.calls[1]).toEqual(current.wait.mock.calls[0])
      await vi.advanceTimersByTimeAsync(19)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await pending).checks.find(c => c.id === 'remote_workspace_access')?.code).toBe('APP_PROOF_TIMEOUT')
      expect(current.send).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers(); await current.server.close() }
  })
})
