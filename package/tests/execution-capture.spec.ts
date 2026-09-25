import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureShellExecution } from '../src/execution/capture.ts'
import { ExecutionRecorder } from '../src/execution/recorder.ts'
import { CoordinatorState, createMemoryStore } from '../src/orchestrator/state.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('DSH shell execution capture', () => {
  it('records a foreground test result for the active task without changing it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'd2c-capture-'))
    directories.push(root)
    const state = new CoordinatorState(createMemoryStore())
    await state.saveTask({
      taskId: 'task-1', goal: 'test', state: 'planned', iteration: 2,
      waitingFor: 'dsh-execution', conversationId: null, lastReviewedHead: null,
      createdAt: 1, updatedAt: 1, lastError: null,
    })
    await state.bindWorkspace(root, { workspaceRoot: root, conversationId: null, lastTaskId: 'task-1' })
    const recorder = new ExecutionRecorder({ stateDir: root })
    const capture = captureShellExecution(state, () => recorder)
    const result = { isError: false, value: {
      kind: 'foreground', exitCode: 0, timedOut: false, aborted: false,
      stdout: { text: 'passed' }, stderr: { text: '' },
    } }
    const observed = await capture({ name: 'pwsh', arguments: { command: 'pnpm test' }, agent: { session: { header: { cwd: root } } } }, async () => result)
    expect(observed).toBe(result)
    expect(recorder.list({ taskId: 'task-1' })).toMatchObject([{
      taskId: 'task-1', iteration: 3, kind: 'test', command: 'pnpm test', status: 'success', exitCode: 0,
    }])
  })

  it('ignores unrelated and background calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'd2c-capture-'))
    directories.push(root)
    const state = new CoordinatorState(createMemoryStore())
    const recorder = new ExecutionRecorder({ stateDir: root })
    const capture = captureShellExecution(state, () => recorder)
    let calls = 0
    const next = async () => { calls++; return { isError: false, value: { kind: 'background' } } }
    await capture({ name: 'read_file', arguments: {} }, next)
    await capture({ name: 'bash', arguments: { command: 'test' }, agent: { session: { header: { cwd: root } } } }, next)
    expect(calls).toBe(2)
    expect(recorder.list()).toEqual([])
  })

  it('records a dispatch failure without inventing an exit code', async () => {
    const root = mkdtempSync(join(tmpdir(), 'd2c-capture-'))
    directories.push(root)
    const state = new CoordinatorState(createMemoryStore())
    await state.saveTask({
      taskId: 'task-2', goal: 'test', state: 'executing', iteration: 1,
      waitingFor: 'dsh-execution', conversationId: null, lastReviewedHead: null,
      createdAt: 1, updatedAt: 1, lastError: null,
    })
    await state.bindWorkspace(root, { workspaceRoot: root, conversationId: null, lastTaskId: 'task-2' })
    const recorder = new ExecutionRecorder({ stateDir: root })
    const capture = captureShellExecution(state, () => recorder)
    const failure = { isError: true, error: { message: 'spawn failed' } }
    expect(await capture({ name: 'bash', arguments: { command: 'pnpm test' }, agent: { session: { header: { cwd: root } } } }, async () => failure)).toBe(failure)
    expect(recorder.list({ taskId: 'task-2' })).toMatchObject([{
      status: 'failure', exitCode: null, stderrTail: expect.stringContaining('spawn failed'),
    }])
  })
})
