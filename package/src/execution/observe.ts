import type { WorkspaceRuntimeIdentity } from '../workspace/runtime.ts'
import type { CoordinatorState } from '../orchestrator/state.ts'
import type { ExecutionRecorder } from './recorder.ts'

export interface ObservedExecution {
  name: string
  arguments: Record<string, unknown>
  agent?: { session?: { header?: { cwd?: string } } }
  signal?: AbortSignal
}

export interface ObservedResult {
  isError?: boolean
  value?: unknown
  content?: Array<{ type?: string; text?: string }>
}

/** Task ownership captured before the shell tool executes. */
export interface FrozenExecutionContext {
  workspaceRoot: string
  workspaceId: string
  taskId: string
  iteration: number
  cwd: string
  startedAt: number
}

/** Shell work after PLAN iteration N belongs to the upcoming review iteration N+1. */
export function evidenceIteration(planIteration: number): number {
  return planIteration + 1
}

/** Resolve durable shell ownership before dispatch without affecting tool execution. */
export async function freezeShellExecution(
  exec: ObservedExecution,
  state: CoordinatorState,
  resolveWorkspace: (exec: ObservedExecution) => Promise<WorkspaceRuntimeIdentity>,
): Promise<FrozenExecutionContext | undefined> {
  if (exec.name !== 'bash' && exec.name !== 'pwsh') return undefined
  const command = exec.arguments['command']
  if (typeof command !== 'string' || command.trim() === '') return undefined
  const startedAt = Date.now()
  const { workspaceId, displayRoot: workspaceRoot } = await resolveWorkspace(exec)
  const binding = await state.loadWorkspace(workspaceId)
  if (binding === undefined || binding.lastTaskId === null) return undefined
  const task = await state.loadTask(binding.lastTaskId)
  if (task?.taskId !== binding.lastTaskId || (task.state !== 'planned' && task.state !== 'executing')) return undefined
  const workdir = exec.arguments['workdir']
  const cwd = typeof workdir === 'string' && workdir !== '' ? workdir : '.'
  return {
    workspaceRoot,
    workspaceId,
    taskId: task.taskId,
    iteration: evidenceIteration(task.iteration),
    cwd,
    startedAt,
  }
}

/** Record a foreground shell result only under its frozen start-time owner. */
export function observeShellResult(
  exec: ObservedExecution,
  result: ObservedResult,
  owner: FrozenExecutionContext | undefined,
  recorder: ExecutionRecorder,
): void {
  if (owner === undefined) return
  if (exec.name !== 'bash' && exec.name !== 'pwsh') return
  const command = exec.arguments['command']
  if (typeof command !== 'string' || command.trim() === '') return
  const value = result.value as {
    kind?: string
    exitCode?: number | null
    timedOut?: boolean
    aborted?: boolean
    stdout?: { text?: string }
    stderr?: { text?: string }
  } | undefined
  if (value?.kind === 'background') return
  const content = result.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? ''
  const timedOut = value?.timedOut === true
  const aborted = value?.aborted === true
  const exitCode = typeof value?.exitCode === 'number' || value?.exitCode === null ? value.exitCode : null
  const status = timedOut ? 'timeout' : aborted ? 'cancelled' : result.isError === true || exitCode !== 0 ? 'failure' : 'success'
  recorder.record({
    taskId: owner.taskId,
    iteration: owner.iteration,
    command,
    cwd: owner.cwd,
    startedAt: owner.startedAt,
    endedAt: Date.now(),
    status,
    exitCode,
    stdout: value?.stdout?.text ?? (result.isError === true ? '' : content),
    stderr: value?.stderr?.text ?? (result.isError === true ? content : ''),
  })
}
