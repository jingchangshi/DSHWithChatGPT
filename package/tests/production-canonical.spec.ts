import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
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

vi.mock('@deepseek-ai/dsh-execution-world/read-lease', { spy: true })
vi.mock('@deepseek-ai/dsh-execution-world/git-lease', { spy: true })
afterEach(() => vi.restoreAllMocks())

// Real registered tools/domain adapters; synthetic producer and browser only.
async function fixture(fixFirst = false, gitPolicy: 'worktree' | 'commit-push' = 'commit-push') {
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
  await ctx.plugin({ apply, Config, inject }, { browserMode: 'sidecar', tunnelMode: 'managed', gitRead: true, gitPolicy })
  const call = (name: string, args: Record<string, unknown> = {}) => tools.get(name).execute(args,
    { agent: { session: { header: { cwd: 'C:\\fixture' } } }, signal: new AbortController().signal })
  return { ctx, records, workspaceId, head, sent, acquired, call, get prompt() { return prompt }, bind: () => { captured = { ...baseline, conversationId: 'owned' } } }
}

describe('canonical production composition', () => {
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
