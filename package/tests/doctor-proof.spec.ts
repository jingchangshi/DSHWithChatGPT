import { describe, expect, it, vi } from 'vitest'
import { runDoctor, type DoctorInputs } from '../src/readiness/doctor.ts'
import { startBridgeServer } from '../src/bridge/server.ts'
import { OperationCancelledError } from '../src/cancellation.ts'

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

describe('doctor App proof orchestration', () => {
  it('verifies remote facts without leaking the challenge or claiming full C2C', async () => {
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
