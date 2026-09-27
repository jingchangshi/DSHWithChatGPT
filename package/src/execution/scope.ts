import type { CoordinatorState } from '../orchestrator/state.ts'
import type { ExecutionOutputScope } from '../workspace/runtime.ts'
import { evidenceIteration } from './observe.ts'

export async function reviewOutputScope(
  state: CoordinatorState,
  workspaceId: string,
  taskId: string,
): Promise<ExecutionOutputScope | undefined> {
  const binding = await state.loadWorkspace(workspaceId)
  if (binding?.lastTaskId !== taskId) return undefined
  const task = await state.loadTask(taskId)
  if (task?.taskId !== taskId) return undefined
  switch (task.state) {
    case 'planned':
    case 'executing':
      return { taskId, iteration: evidenceIteration(task.iteration) }
    case 'executed':
    case 'awaiting-review':
      return { taskId, iteration: task.iteration }
    default:
      return undefined
  }
}
