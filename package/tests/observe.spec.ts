import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ExecutionRecorder } from '../src/execution/recorder.ts'
import { freezeShellExecution as freezeWithIdentity, observeShellResult, type ObservedExecution } from '../src/execution/observe.ts'
import { CoordinatorState, createMemoryStore, type PersistedTask } from '../src/orchestrator/state.ts'
import { ChatGptCoordinator } from '../src/orchestrator/coordinator.ts'
import type { BrowserControl } from '../src/browser/adapter.ts'
import { formatEnvelope } from '../src/protocol/index.ts'
import { resolveExecutionWorkspace } from '../src/workspace/execution-identity.ts'
import type { ExecutionWorkspaceId } from '@deepseek-ai/dsh-execution-world'

const workspaceId = '12345678-1234-4234-8234-123456789abc' as ExecutionWorkspaceId
function freezeShellExecution(exec: ObservedExecution, state: CoordinatorState) {
  return freezeWithIdentity(exec, state, execution => resolveExecutionWorkspace(
    { resolve: async () => workspaceId }, execution.agent?.session?.header?.cwd, execution.signal,
  ))
}

let root: string
let recorder: ExecutionRecorder
let state: CoordinatorState
let store: ReturnType<typeof createMemoryStore>

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-observe-'))
  recorder = new ExecutionRecorder({ stateDir: path.join(root, 'records') })
  store = createMemoryStore()
  state = new CoordinatorState(store)
  await bindTask('d2c_task_a', 1)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

async function bindTask(taskId: string, iteration: number, taskState: PersistedTask['state'] = 'planned'): Promise<void> {
  const workspaceRoot = root
  await state.saveTask({
    taskId, goal: 'test', state: taskState, iteration,
    waitingFor: taskState === 'planned' ? 'dsh-execution' : 'chatgpt-review',
    conversationId: 'conversation', lastReviewedHead: null,
    createdAt: 1, updatedAt: 1, lastError: null,
  })
  await state.bindWorkspace(workspaceId, { workspaceRoot, conversationId: 'conversation', lastTaskId: taskId })
}

function shell(overrides: Partial<ObservedExecution> = {}): ObservedExecution {
  return {
    name: 'bash', arguments: { command: 'pnpm test' },
    agent: { session: { header: { cwd: root } } },
    ...overrides,
  }
}

describe('shell evidence observation', () => {
  it('does not attribute evidence to another world with the same cwd', async () => {
    const exec = shell()
    const otherId = '22345678-1234-4234-8234-123456789abc'
    expect(await freezeWithIdentity(exec, state, async () => ({ workspaceId: otherId, displayRoot: root }))).toBeUndefined()
    const owner = await freezeWithIdentity(exec, state, async () => ({ workspaceId, displayRoot: '/remote/alias' }))
    expect(owner).toMatchObject({ workspaceId, workspaceRoot: '/remote/alias', taskId: 'd2c_task_a' })
  })

  it('does not resume a legacy path-keyed binding under a provider ID', async () => {
    const legacy = new CoordinatorState(createMemoryStore())
    await legacy.bindWorkspace(root, { workspaceRoot: root, conversationId: 'legacy', lastTaskId: 'd2c_task_a' })
    expect(await freezeShellExecution(shell(), legacy)).toBeUndefined()
  })

  it('rejects missing Session cwd and skips missing bindings', async () => {
    await expect(freezeShellExecution(shell({ agent: undefined }), state)).rejects.toThrow('SESSION_WORKSPACE_UNAVAILABLE')
    expect(await freezeShellExecution(shell(), new CoordinatorState(createMemoryStore()))).toBeUndefined()
    expect(() => observeShellResult(shell(), { value: { kind: 'foreground', exitCode: 0 } }, undefined, recorder)).not.toThrow()
    await expect(freezeShellExecution(shell({ arguments: { command: 'pnpm test', workdir: '/remote/compiler/build' } }), state))
      .resolves.toMatchObject({ workspaceId, cwd: '/remote/compiler/build' })
    expect(recorder.list()).toEqual([])
  })

  it('freezes task A and review iteration before task B becomes active', async () => {
    const exec = shell({ arguments: { command: 'pnpm test', workdir: '.' } })
    const owner = await freezeShellExecution(exec, state)
    await bindTask('d2c_task_b', 8)
    observeShellResult(exec, { value: { kind: 'foreground', exitCode: 0, stdout: { text: 'passed' } } }, owner, recorder)
    expect(recorder.list()).toMatchObject([{
      taskId: 'd2c_task_a', iteration: 2, cwd: '.', status: 'success', command: 'pnpm test',
    }])
  })

  it('attributes from durable state after restart without reconnect', async () => {
    const restarted = new CoordinatorState(store)
    const exec = shell()
    const owner = await freezeShellExecution(exec, restarted)
    observeShellResult(exec, { value: { kind: 'foreground', exitCode: 1 } }, owner, recorder)
    expect(recorder.list()).toMatchObject([{ taskId: 'd2c_task_a', iteration: 2, status: 'failure' }])
  })

  it('excludes review-state and background commands', async () => {
    await bindTask('d2c_review', 2, 'executed')
    expect(await freezeShellExecution(shell(), state)).toBeUndefined()
    await bindTask('d2c_next', 2)
    const exec = shell()
    observeShellResult(exec, { value: { kind: 'background' } }, await freezeShellExecution(exec, state), recorder)
    expect(recorder.list()).toEqual([])
  })

  it('agrees with coordinator review iterations across a corrective PLAN', async () => {
    await bindTask('d2c_ab12cd', 1)
    const exec = shell()
    observeShellResult(exec, { value: { kind: 'foreground', exitCode: 0 } }, await freezeShellExecution(exec, state), recorder)
    const sent: string[] = []
    const browser: BrowserControl = {
      async ensureReady() {},
      async openConversation(id) { return id ?? 'conversation' },
      async sendControlMessage(text) { sent.push(text) },
      async waitForReply() { return { text: formatEnvelope({
        state: 'PLAN', sender: 'chatgpt', taskId: 'd2c_ab12cd', iteration: 2, inReplyTo: 2,
        headers: { WORKSPACE_ID: workspaceId },
        sections: { ACTIONS: 'Correct the test.' },
      }), complete: true } },
      async health() { return { ok: true, detail: 'ready' } },
      async conversationId() { return 'conversation' },
      async recover() {},
    }
    const coordinator = new ChatGptCoordinator({ workspaceId, browser, store: state, workspaceRoot: root })
    const review = await coordinator.reportExecuted('d2c_ab12cd', {
      changedFiles: [], head: null, testsRecorded: true,
    })
    expect(sent[0]).toContain('ITERATION: 2')
    expect(review.record).toMatchObject({ state: 'planned', iteration: 2 })
    expect(recorder.list().map(record => record.iteration)).toEqual([2])
    expect((await freezeShellExecution(exec, state))?.iteration).toBe(3)
  })

  it.each([
    [{ isError: true, content: [{ type: 'text', text: 'failed' }] }, 'failure'],
    [{ value: { kind: 'foreground', timedOut: true, exitCode: null } }, 'timeout'],
    [{ value: { kind: 'foreground', aborted: true, exitCode: null } }, 'cancelled'],
  ] as const)('retains frozen ownership for %s', async (result, status) => {
    const exec = shell()
    observeShellResult(exec, result, await freezeShellExecution(exec, state), recorder)
    expect(recorder.list()).toMatchObject([{ taskId: 'd2c_task_a', iteration: 2, status }])
  })
})
