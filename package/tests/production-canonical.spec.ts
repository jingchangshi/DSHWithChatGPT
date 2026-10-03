import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { apply, Config, inject } from '../src/index.ts'
import { DeploymentSidecarControl } from '../src/deployment/sidecar-control.ts'
import { TunnelSupervisor } from '../src/tunnel/supervisor.ts'
import * as reads from '@deepseek-ai/dsh-execution-world/read-lease'
import * as git from '@deepseek-ai/dsh-execution-world/git-lease'
import { parsePlannerEnvelope, formatPlannerEnvelope } from '../src/protocol/planner-envelope.ts'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'
import { freezeShellExecution } from '../src/execution/observe.ts'
import { reviewOutputScope } from '../src/execution/scope.ts'
import type { ReplyObservationBaseline } from '../src/core/ports/chat-control.ts'
import { SidecarSupervisor } from '../src/deployment/sidecar-supervisor.ts'
import * as credentials from '../src/deployment/sidecar-credential.ts'
import * as recovery from '../src/deployment/sidecar-target-recovery.ts'
import { BrowserMutationUncertainError } from '../src/browser/epoch.ts'

vi.mock('@deepseek-ai/dsh-execution-world/read-lease', { spy: true })
vi.mock('@deepseek-ai/dsh-execution-world/git-lease', { spy: true })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

// Real registered tools/domain adapters; synthetic producer and browser only.
async function fixture(fixFirst = false, gitPolicy: 'worktree' | 'commit-push' = 'commit-push', ownedSidecar = false) {
  const ctx = new Context(), records = new Map<string, any>(), tools = new Map<string, any>()
  const workspaceId = 'fixture-' + randomUUID(), head = 'a'.repeat(40)
  const baseline = { version: 1 as const, conversationId: null as string | null, assistantCount: 0, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) }
  // App-proof or a previous task may leave an existing conversation open.
  let captured: ReplyObservationBaseline = { ...baseline, conversationId: 'previous' }
  let outgoing: ReturnType<typeof parsePlannerEnvelope> | undefined
  const sent: string[] = [], acquired: AbortSignal[] = []
  let prompt = ''
  vi.mocked(reads.bindExecutionReadLease).mockImplementation(async () => ({ workspaceId: workspaceId as any,
    fs: { stat: async () => undefined, readText: async () => '', listDir: async () => [] }, dispose: async () => {} }))
  vi.mocked(git.bindExecutionGitLease).mockImplementation(async (_ctx, _root, signal) => {
    acquired.push(signal!)
    return { workspaceId: workspaceId as any, assurance: 'full', dispose: async () => {},
      git: { workspaceId: workspaceId as any, emptyFile: 'NUL', signal: signal!, execute: async args => ({ exitCode: 0, stderr: '',
        stdout: args.includes('status') ? '' : args.includes('HEAD...@{u}') ? '0\t0' : args.includes('--symbolic-full-name') ? 'origin/feature' : args.includes('--abbrev-ref') ? 'feature' : head }) } }
  })
  vi.spyOn(TunnelSupervisor.prototype, 'ensure').mockResolvedValue({ mode: 'managed', configured: true, ready: true, detail: 'synthetic' })
  vi.spyOn(DeploymentSidecarControl.prototype, 'health').mockResolvedValue({ ok: true, detail: 'synthetic' })
  vi.spyOn(DeploymentSidecarControl.prototype, 'ensureReady').mockResolvedValue()
  vi.spyOn(DeploymentSidecarControl.prototype, 'openConversation').mockImplementation(async id => {
    captured = { ...baseline, conversationId: id ?? null }
    return id ?? ''
  })
  vi.spyOn(DeploymentSidecarControl.prototype, 'captureReplyBaseline').mockImplementation(async () => captured)
  vi.spyOn(DeploymentSidecarControl.prototype, 'captureSendObservation').mockImplementation(async () => ({ ...captured, conversationId: 'owned' }))
  vi.spyOn(DeploymentSidecarControl.prototype, 'sendControlMessage').mockImplementation(async text => {
    sent.push(text); outgoing = parsePlannerEnvelope(text, { sender: 'executor' })
  })
  vi.spyOn(DeploymentSidecarControl.prototype, 'waitForReply').mockImplementation(async (_timeout, _signal, operation) => {
    expect(operation?.replyBaseline?.conversationId).toBe('owned')
    const request = outgoing!
    const plan = request.state === 'INIT' || fixFirst && request.iteration === 1
    return { complete: true, text: formatPlannerEnvelope({ sender: 'planner', state: plan ? 'PLAN' : 'DONE', taskId: request.taskId,
      workspaceId, iteration: plan ? request.iteration + 1 : request.iteration, inReplyTo: request.iteration,
      ...(request.state === 'INIT' ? {} : { head }), sections: plan ? { ACTIONS: 'Implement' } : { SUMMARY: 'Reviewed' } }) }
  })
  ctx.provide('storageDomain', { open: async (spec: { name: string }) => ({ close: async () => {}, table: (name: string) => ({
    get: (key: string) => records.get(spec.name + '/' + name + '/' + key),
    put: async (key: string, value: unknown) => { records.set(spec.name + '/' + name + '/' + key, structuredClone(value)) },
    delete: async (key: string) => { records.delete(spec.name + '/' + name + '/' + key) },
  }) }) })
  ctx.provide('executionWorldIdentity', { resolve: async () => workspaceId })
  for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
  ctx.provide('tools', { register: (tool: any) => { tools.set(tool.name, tool) } })
  ctx.provide('systemPrompt', { section: (value: { text: string }) => { prompt = value.text }, getSectionOrder: () => 0 })
  await ctx.plugin({ apply, Config, inject }, { browserMode: 'sidecar', tunnelMode: 'managed', gitRead: true, gitPolicy,
    ...(ownedSidecar ? { sidecarProcessCommand: process.execPath, sidecarCredentialFile: 'C:\\private\\test.secret' } : {}) })
  const call = (name: string, args: Record<string, unknown> = {}, signal = new AbortController().signal) => tools.get(name).execute(args,
    { agent: { session: { header: { cwd: 'C:\\fixture' } } }, signal })
  return { ctx, records, workspaceId, head, sent, acquired, call, get prompt() { return prompt }, bind: () => { captured = { ...baseline, conversationId: 'owned' } } }
}

describe('canonical production composition', () => {
  it('stops unknown creation without retry, send, ownership mutation or invented disposal cleanup', async () => {
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_TARGET_ID', 'old')
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'http://127.0.0.1:9222')
    vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue('test-only')
    const start = vi.spyOn(SidecarSupervisor.prototype, 'start').mockResolvedValue()
    const close = vi.spyOn(SidecarSupervisor.prototype, 'close').mockResolvedValue()
    const replace = vi.spyOn(recovery, 'createOwnedSidecarReplacement').mockRejectedValue(new BrowserMutationUncertainError())
    const f = await fixture(false, 'commit-push', true)
    const observe = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    const failure = Object.assign(new Error('BROWSER_TARGET_CHANGED'), { code: 'BROWSER_TARGET_CHANGED' })
    observe.mockRejectedValueOnce(failure)
    try {
      await expect(f.call('chatgpt_plan', { goal: 'uncertain page creation' })).rejects.toThrow()
      const before = structuredClone([...f.records.entries()])
      observe.mockRejectedValueOnce(failure)
      await expect(f.call('chatgpt_reconnect')).rejects.toBeInstanceOf(BrowserMutationUncertainError)
      expect(close).not.toHaveBeenCalled()
      expect(start).toHaveBeenCalledTimes(1)
      expect([...f.records.entries()]).toEqual(before)
      observe.mockRejectedValueOnce(failure)
      await expect(f.call('chatgpt_reconnect')).rejects.toMatchObject({ code: failure.code })
      expect(replace).toHaveBeenCalledTimes(1)
      expect(f.sent).toHaveLength(1)
      expect([...f.records.entries()]).toEqual(before)
    } finally { await f.ctx.fiber.dispose() }
    // No handle for an unknown page was acquired. Disposal closes only the
    // original concrete supervisor, never inventing target cleanup authority.
    expect(close).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(1)
  })
  it('never replaces an externally managed Sidecar despite a transport failure', async () => {
    const replace = vi.spyOn(recovery, 'createOwnedSidecarReplacement')
    const f = await fixture()
    const observe = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    const failure = Object.assign(new Error('BROWSER_TARGET_CHANGED'), { code: 'BROWSER_TARGET_CHANGED' })
    observe.mockRejectedValueOnce(failure)
    try {
      await expect(f.call('chatgpt_plan', { goal: 'external owner' })).rejects.toThrow()
      const before = structuredClone([...f.records.entries()])
      observe.mockRejectedValueOnce(failure)
      await expect(f.call('chatgpt_reconnect')).rejects.toMatchObject({ code: failure.code })
      expect(replace).not.toHaveBeenCalled()
      expect([...f.records.entries()]).toEqual(before)
      expect(f.sent).toHaveLength(1)
    } finally { await f.ctx.fiber.dispose() }
  })
  it('cleans a replacement whose new native process cannot start without changing the task', async () => {
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_TARGET_ID', 'old')
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'http://127.0.0.1:9222')
    vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue('test-only')
    const start = vi.spyOn(SidecarSupervisor.prototype, 'start').mockResolvedValue()
    vi.spyOn(SidecarSupervisor.prototype, 'close').mockResolvedValue()
    const closeReplacement = vi.fn(async () => {}), retireSource = vi.fn(async () => {})
    vi.spyOn(recovery, 'createOwnedSidecarReplacement').mockResolvedValue({ sourceTargetId: 'old', replacementTargetId: 'new', closeReplacement, retireSource })
    const f = await fixture(false, 'commit-push', true)
    const observe = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    const failure = Object.assign(new Error('BROWSER_TARGET_CHANGED'), { code: 'BROWSER_TARGET_CHANGED' })
    observe.mockRejectedValueOnce(failure)
    try {
      await expect(f.call('chatgpt_plan', { goal: 'native startup failure' })).rejects.toThrow()
      const before = structuredClone([...f.records.entries()])
      observe.mockRejectedValueOnce(failure)
      start.mockRejectedValueOnce(Object.assign(new Error('SIDECAR_UNAVAILABLE'), { code: 'SIDECAR_UNAVAILABLE' }))
      await expect(f.call('chatgpt_reconnect')).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
      expect(closeReplacement).toHaveBeenCalledTimes(1)
      expect(retireSource).not.toHaveBeenCalled()
      expect([...f.records.entries()]).toEqual(before)
      expect(f.sent).toHaveLength(1)
    } finally { await f.ctx.fiber.dispose() }
  })
  it('keeps the existing browser ownership gate for concurrent reconnects without an extra send', async () => {
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_TARGET_ID', 'old')
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'http://127.0.0.1:9222')
    vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue('test-only')
    vi.spyOn(SidecarSupervisor.prototype, 'start').mockResolvedValue()
    vi.spyOn(SidecarSupervisor.prototype, 'close').mockResolvedValue()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const replace = vi.spyOn(recovery, 'createOwnedSidecarReplacement').mockImplementation(async () => {
      await gate
      return { sourceTargetId: 'old', replacementTargetId: 'new', closeReplacement: async () => {}, retireSource: async () => {} }
    })
    const f = await fixture(false, 'commit-push', true)
    const observe = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    const failure = Object.assign(new Error('BROWSER_TARGET_CHANGED'), { code: 'BROWSER_TARGET_CHANGED' })
    observe.mockRejectedValueOnce(failure)
    let settled: Promise<PromiseSettledResult<any>[]> | undefined
    try {
      await expect(f.call('chatgpt_plan', { goal: 'concurrent recovery' })).rejects.toThrow()
      observe.mockRejectedValueOnce(failure)
      const first = f.call('chatgpt_reconnect'), second = f.call('chatgpt_reconnect')
      settled = Promise.allSettled([first, second])
      await expect.poll(() => replace.mock.calls.length).toBe(1)
      release()
      const outcomes = await settled
      expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: { recovered: true } })
      expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { message: 'CONTROL_BROWSER_BUSY' } })
      expect(replace).toHaveBeenCalledTimes(1)
      expect(f.sent).toHaveLength(1)
    } finally { release(); await settled; await f.ctx.fiber.dispose() }
  })
  it.each(['BROWSER_TARGET_CHANGED', 'SIDECAR_UNAVAILABLE'])('replaces an internally owned target once for pending bootstrap: %s', async code => {
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_TARGET_ID', 'owned-old-target')
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'http://127.0.0.1:9222')
    vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue('test-only-private-credential')
    const starts: any[] = []
    vi.spyOn(SidecarSupervisor.prototype, 'start').mockImplementation(async function () { starts.push((this as any).options) })
    const close = vi.spyOn(SidecarSupervisor.prototype, 'close').mockResolvedValue()
    const closeReplacement = vi.fn(async () => {}), retireSource = vi.fn(async () => {})
    const replace = vi.spyOn(recovery, 'createOwnedSidecarReplacement').mockResolvedValue({ sourceTargetId: 'owned-old-target', replacementTargetId: 'owned-new-target', closeReplacement, retireSource })
    const f = await fixture(false, 'commit-push', true)
    const observe = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    observe.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
    try {
      await expect(f.call('chatgpt_plan', { goal: 'single send pending bootstrap' })).rejects.toMatchObject({ code })
      const owner = structuredClone(f.records.get('d2c_control/managed_tunnel/owner'))
      const before = structuredClone(f.records.get('plannerbridge_state/tasks/' + owner.taskId))
      observe.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
      const result = await f.call('chatgpt_reconnect')
      expect(result).toMatchObject({ recovered: true, task: { taskId: owner.taskId, conversationId: 'owned' } })
      expect(result.task.round.sendOperationId).toBe(before.round.sendOperationId)
      expect(result.task.round.waitOperationId).toBe(before.round.waitOperationId)
      expect(result.task.round.controlDigest).toBe(before.round.controlDigest)
      expect(f.sent).toHaveLength(1)
      expect(replace).toHaveBeenCalledTimes(1)
      expect(starts).toHaveLength(2)
      expect(starts[1].env).toEqual({ PLANNERBRIDGE_SIDECAR_TARGET_ID: 'owned-new-target' })
      expect(close).toHaveBeenCalledTimes(1)
      expect(retireSource).toHaveBeenCalledTimes(1)
      expect(closeReplacement).not.toHaveBeenCalled()
      expect(f.records.get('d2c_control/managed_tunnel/owner')).toMatchObject({ claimId: owner.claimId, phase: 'task', taskId: owner.taskId })
    } finally { await f.ctx.fiber.dispose() }
  })
  it.each(['SEND_UNCERTAIN', 'CHATGPT_LOGGED_OUT', 'REPLAY_CONFLICT', 'SIDECAR_BUSY', 'OPERATION_CANCELLED', 'SIDECAR_TIMEOUT'])('does not replace on semantic or unclassified failure: %s', async code => {
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_TARGET_ID', 'owned-old-target')
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'http://127.0.0.1:9222')
    vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue('test-only')
    vi.spyOn(SidecarSupervisor.prototype, 'start').mockResolvedValue()
    vi.spyOn(SidecarSupervisor.prototype, 'close').mockResolvedValue()
    const replace = vi.spyOn(recovery, 'createOwnedSidecarReplacement')
    const f = await fixture(false, 'commit-push', true)
    const observe = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    observe.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
    try {
      await expect(f.call('chatgpt_plan', { goal: 'do not retry semantic failure' })).rejects.toThrow()
      const owner = structuredClone(f.records.get('d2c_control/managed_tunnel/owner'))
      observe.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
      await expect(f.call('chatgpt_reconnect')).rejects.toMatchObject({ code })
      expect(replace).not.toHaveBeenCalled()
      expect(f.records.get('d2c_control/managed_tunnel/owner')).toEqual(owner)
      expect(f.sent).toHaveLength(1)
    } finally { await f.ctx.fiber.dispose() }
  })
  it.each(['SEND_UNCERTAIN', 'BROWSER_TARGET_CHANGED', 'SIDECAR_UNAVAILABLE'])('closes failed replacement and refuses another target for the same pending task: %s', async failure => {
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_TARGET_ID', 'owned-old-target')
    vi.stubEnv('PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'http://127.0.0.1:9222')
    vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue('test-only')
    vi.spyOn(SidecarSupervisor.prototype, 'start').mockResolvedValue()
    const close = vi.spyOn(SidecarSupervisor.prototype, 'close').mockResolvedValue()
    const closeReplacement = vi.fn(async () => {}), retireSource = vi.fn(async () => {})
    const replace = vi.spyOn(recovery, 'createOwnedSidecarReplacement').mockResolvedValue({ sourceTargetId: 'owned-old-target', replacementTargetId: 'owned-new-target', closeReplacement, retireSource })
    const f = await fixture(false, 'commit-push', true)
    const observe = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    observe.mockRejectedValueOnce(Object.assign(new Error('BROWSER_TARGET_CHANGED'), { code: 'BROWSER_TARGET_CHANGED' }))
    try {
      await expect(f.call('chatgpt_plan', { goal: 'preserve pending task on wrong proof' })).rejects.toThrow()
      const before = structuredClone([...f.records.entries()])
      observe.mockRejectedValueOnce(Object.assign(new Error('BROWSER_TARGET_CHANGED'), { code: 'BROWSER_TARGET_CHANGED' }))
      observe.mockRejectedValueOnce(Object.assign(new Error(failure), { code: failure }))
      await expect(f.call('chatgpt_reconnect')).rejects.toMatchObject({ code: failure })
      expect([...f.records.entries()]).toEqual(before)
      expect(closeReplacement).toHaveBeenCalledTimes(1)
      expect(retireSource).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledTimes(2)
      observe.mockRejectedValueOnce(Object.assign(new Error('BROWSER_TARGET_CHANGED'), { code: 'BROWSER_TARGET_CHANGED' }))
      await expect(f.call('chatgpt_reconnect')).rejects.toMatchObject({ code: 'BROWSER_TARGET_CHANGED' })
      expect(replace).toHaveBeenCalledTimes(1)
      expect(f.sent).toHaveLength(1)
    } finally { await f.ctx.fiber.dispose() }
  })
  it.each(['matching', 'unknown'] as const)('registered reconnect preserves the pre-task claim until bootstrap proof: %s', async scenario => {
    const f = await fixture()
    const observation = vi.mocked(DeploymentSidecarControl.prototype.captureSendObservation)
    observation.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
    try {
      await expect(f.call('chatgpt_plan', { goal: 'recover bootstrap without duplicate send' })).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
      const ownerKey = 'd2c_control/managed_tunnel/owner'
      const before = structuredClone(f.records.get(ownerKey))
      expect(before.phase).toBe('pre-task')
      if (scenario === 'unknown') {
        observation.mockRejectedValueOnce(Object.assign(new Error('SEND_UNCERTAIN'), { code: 'SEND_UNCERTAIN' }))
        await expect(f.call('chatgpt_reconnect')).rejects.toMatchObject({ code: 'SEND_UNCERTAIN' })
        expect(f.records.get(ownerKey)).toEqual(before)
      } else {
        const recovered = await f.call('chatgpt_reconnect')
        expect(recovered).toMatchObject({ recovered: true, workspaceId: f.workspaceId, task: { taskId: before.taskId, conversationId: 'owned' } })
        expect(f.records.get(ownerKey)).toMatchObject({ claimId: before.claimId, phase: 'task', taskId: before.taskId })
        expect(recovered.task.round.phase).toBe('observed-sent')
      }
      expect(f.sent).toHaveLength(1)
    } finally { await f.ctx.fiber.dispose() }
  })
  it('uses a neutral fresh bearer with unchanged authentication and byte-identical live reuse', async () => {
    const f = await fixture()
    try {
      const first = await f.call('chatgpt_status')
      const config = JSON.parse(await readFile(first.connectorConfigPath, 'utf8'))
      const header = await readFile(config.authorization.tokenFile, 'utf8')
      // Boolean assertion keeps the random test credential out of failure output.
      expect(/^Bearer pb_auth_[a-f0-9]{64}\n$/.test(header)).toBe(true)
      expect(JSON.stringify(first).includes(header.trim())).toBe(false)
      const ping = (authorization?: string) => fetch(config.localUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      })
      expect((await ping(header.trim())).status).toBe(200)
      expect((await ping()).status).toBe(401)
      expect((await ping('Bearer pb_auth_' + '0'.repeat(64))).status).toBe(401)
      const second = await f.call('chatgpt_status')
      expect(second.connectorConfigPath).toBe(first.connectorConfigPath)
      expect(second.bridgePort).toBe(first.bridgePort)
      expect((await readFile(config.authorization.tokenFile, 'utf8')) === header).toBe(true)
    } finally { await f.ctx.fiber.dispose() }
  })
  it('advertises the mandatory canonical pushed-HEAD policy even with a legacy worktree setting', async () => {
    const f = await fixture(false, 'worktree')
    try {
      expect((await f.call('chatgpt_status')).gitPolicy).toBe('commit-push')
      expect(f.prompt).toContain('Current autonomous git policy: commit-push')
      expect(f.prompt).not.toContain('In worktree mode:')
    } finally { await f.ctx.fiber.dispose() }
  })
  it('continues a fix PLAN through registered reconnect and completes the same canonical task', async () => {
    const f = await fixture(true)
    try {
      const initial = await f.call('chatgpt_plan', { goal: 'Implement' })
      f.bind()
      const fix = await f.call('chatgpt_review', { taskId: initial.taskId, head: f.head, testsRecorded: true })
      expect(fix).toMatchObject({ protocolVersion: 2, state: 'planned', iteration: 2, taskId: initial.taskId })
      const reconnect = await f.call('chatgpt_reconnect')
      expect(reconnect.task).toMatchObject({ protocolVersion: 2, taskId: initial.taskId, iteration: 2, state: 'planned' })
      const done = await f.call('chatgpt_review', { taskId: initial.taskId, head: f.head, testsRecorded: true })
      expect(done).toMatchObject({ protocolVersion: 2, taskId: initial.taskId, iteration: 2, state: 'done' })
      expect(f.sent).toHaveLength(3)
    } finally { await f.ctx.fiber.dispose() }
  })
  it('registered tools persist v2 PLAN and exact same-round DONE using one producer lease per call', async () => {
    const f = await fixture()
    try {
      const plan = await f.call('chatgpt_plan', { goal: 'Implement the fixture' })
      expect(plan).toMatchObject({ protocolVersion: 2, iteration: 1, state: 'planned', workspaceId: f.workspaceId })
      expect(plan.taskId).toMatch(/^pb_[a-f0-9]{32}$/)
      expect(f.records.get('plannerbridge_state/tasks/' + plan.taskId).round.phase).toBe('accepted')
      expect(f.records.has('d2c_state/tasks/' + plan.taskId)).toBe(false)
      f.bind()
      const done = await f.call('chatgpt_review', { taskId: plan.taskId, head: f.head, testsRecorded: true })
      expect(done).toMatchObject({ protocolVersion: 2, state: 'done', iteration: 1, workspaceId: f.workspaceId, head: f.head })
      expect(f.sent).toHaveLength(2)
      expect(f.acquired).toHaveLength(2)
      expect(f.acquired.every(signal => signal.aborted)).toBe(true)
    } finally { await f.ctx.fiber.dispose() }
  })
  it('attributes canonical shell evidence and review output to the same execution iteration', async () => {
    const state = new CoordinatorState(createMemoryStore()), taskId = 'pb_' + 'a'.repeat(32)
    await state.createTask({ protocolVersion: 2, taskId, goal: 'work', state: 'planned', iteration: 2,
      waitingFor: 'dsh-execution', conversationId: 'owned', lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null })
    await state.bindWorkspace('world', { workspaceRoot: 'C:\\fixture', lastTaskId: taskId, conversationId: 'owned' })
    const owner = await freezeShellExecution({ name: 'pwsh', arguments: { command: 'npm test' } }, state,
      async () => ({ workspaceId: 'world', displayRoot: 'C:\\fixture' }))
    expect(owner?.iteration).toBe(2)
    expect(await reviewOutputScope(state, 'world', taskId)).toEqual({ taskId, iteration: 2 })
  })
})
