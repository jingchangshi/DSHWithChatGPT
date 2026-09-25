/** Observe completed DSH shell calls without changing their result. */
import { relative } from 'node:path'
import type { CoordinatorState } from '../orchestrator/state.ts'
import type { ExecutionRecorder } from './recorder.ts'

interface ShellCall {
  name: string
  arguments: Record<string, unknown>
  agent?: { session?: { header?: { cwd?: string } } }
}

interface ToolResult {
  isError: boolean
  value?: unknown
  error?: { message: string }
}

interface ShellOutput {
  kind: 'foreground'
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
  stdout: { text: string }
  stderr: { text: string }
}

function isShellOutput(value: unknown): value is ShellOutput {
  if (typeof value !== 'object' || value === null) return false
  const output = value as Partial<ShellOutput>
  return output.kind === 'foreground'
    && (typeof output.exitCode === 'number' || output.exitCode === null)
    && typeof output.timedOut === 'boolean'
    && typeof output.aborted === 'boolean'
    && typeof output.stdout?.text === 'string'
    && typeof output.stderr?.text === 'string'
}

/** Wrap one DSH tool dispatch and record foreground shell outcomes for the active task. */
export function captureShellExecution(
  state: CoordinatorState,
  recorderFor: (workspaceRoot: string) => ExecutionRecorder,
): (exec: ShellCall, next: () => Promise<ToolResult>) => Promise<ToolResult> {
  return async (exec, next) => {
    if (exec.name !== 'bash' && exec.name !== 'pwsh') return next()
    const command = exec.arguments['command']
    const workspaceRoot = exec.agent?.session?.header?.cwd
    if (typeof command !== 'string' || typeof workspaceRoot !== 'string') return next()

    // Resolve ownership before running the command; a task transition during
    // dispatch cannot attribute this result to a different task.
    let taskId: string | undefined
    let iteration = 0
    try {
      const binding = await state.loadWorkspace(workspaceRoot)
      if (binding?.lastTaskId !== null && binding?.lastTaskId !== undefined) {
        const task = await state.loadTask(binding.lastTaskId)
        if (task !== undefined && (task.state === 'planned' || task.state === 'executing')) {
          taskId = task.taskId
          iteration = task.iteration + 1
        }
      }
    } catch {
      // Recording is observational; storage errors cannot block execution.
    }
    const startedAt = Date.now()
    const result = await next()
    if (taskId === undefined) return result
    try {
      const cwd = typeof exec.arguments['workdir'] === 'string' ? exec.arguments['workdir'] : workspaceRoot
      if (result.isError) {
        recorderFor(workspaceRoot).record({
          taskId, iteration, command, cwd: relative(workspaceRoot, cwd) || '.',
          startedAt, endedAt: Date.now(), status: 'failure', exitCode: null,
          stdout: '', stderr: 'DSH tool dispatch failed before a foreground result: ' + (result.error?.message ?? 'unknown error'),
        })
        return result
      }
      const output = result.value
      if (!isShellOutput(output)) return result
      recorderFor(workspaceRoot).record({
        taskId,
        iteration,
        command,
        cwd: relative(workspaceRoot, cwd) || '.',
        startedAt,
        endedAt: Date.now(),
        status: output.aborted ? 'cancelled' : output.timedOut ? 'timeout' : output.exitCode === 0 ? 'success' : 'failure',
        exitCode: output.exitCode,
        stdout: output.stdout.text,
        stderr: output.stderr.text,
      })
    } catch {
      // Secrets and recorder failures are never allowed to alter shell results.
    }
    return result
  }
}
