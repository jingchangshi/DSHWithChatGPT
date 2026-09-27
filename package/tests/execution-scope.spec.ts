import { describe, expect, it } from 'vitest'
import { CoordinatorState, createMemoryStore, type TaskState } from '../src/orchestrator/state.ts'
import { reviewOutputScope } from '../src/execution/scope.ts'

async function fixture(status: TaskState) {
  const state = new CoordinatorState(createMemoryStore())
  await state.saveTask({ taskId: 'task', iteration: 3, state: status, goal: 'test', waitingFor: 'none',
    conversationId: null, lastReviewedHead: null, createdAt: 1, updatedAt: 1, lastError: null })
  await state.bindWorkspace('workspace', { lastTaskId: 'task', workspaceRoot: 'display', conversationId: null })
  return state
}

describe('review execution authorization', () => {
  it.each(['planned', 'executing', 'executed', 'awaiting-review'] as const)('derives %s round from durable state', async status => {
    const state = await fixture(status)
    expect(await reviewOutputScope(state, 'workspace', 'task')).toEqual({ taskId: 'task', iteration: status === 'planned' || status === 'executing' ? 4 : 3 })
    expect(await reviewOutputScope(state, 'other', 'task')).toBeUndefined()
    expect(await reviewOutputScope(state, 'workspace', 'other')).toBeUndefined()
    await state.deleteTask('task')
    expect(await reviewOutputScope(state, 'workspace', 'task')).toBeUndefined()
  })
  it.each(['awaiting-plan', 'done', 'blocked', 'error'] as const)('does not authorize %s', async status => {
    expect(await reviewOutputScope(await fixture(status), 'workspace', 'task')).toBeUndefined()
  })
})
