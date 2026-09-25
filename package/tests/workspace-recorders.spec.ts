import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildWorkspaceTools, loadWorkspaceSpec } from '../src/bridge/tools.ts'
import { WorkspaceRecorders } from '../src/execution/workspaces.ts'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function directory(): string {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-recorder-'))
  temporary.push(result)
  return result
}

describe('workspace execution recorder isolation', () => {
  it('keeps unfiltered ChatGPT-facing evidence and IDs within each workspace', async () => {
    const first = directory()
    const second = directory()
    const recorders = new WorkspaceRecorders(directory())
    const firstRecorder = recorders.forWorkspace(first)
    const secondRecorder = recorders.forWorkspace(second)
    expect(firstRecorder.logFile).not.toBe(secondRecorder.logFile)
    const record = (recorder: typeof firstRecorder, taskId: string) => recorder.record({
      taskId, iteration: 2, command: 'pnpm test', cwd: '.', startedAt: 1, endedAt: 2,
      status: 'success', exitCode: 0, stdout: 'passed', stderr: '',
    })
    const firstRecord = record(firstRecorder, 'd2c_first')
    const secondRecord = record(secondRecorder, 'd2c_second')
    expect(firstRecorder.get(secondRecord.id)).toBeUndefined()
    expect(secondRecorder.get(firstRecord.id)).toBeUndefined()

    const firstTools = buildWorkspaceTools(loadWorkspaceSpec(first, firstRecorder))
    const secondTools = buildWorkspaceTools(loadWorkspaceSpec(second, secondRecorder))
    const invoke = async (tools: typeof firstTools, name: string, args: Record<string, unknown>) => {
      const tool = tools.find(candidate => candidate.name === name)
      if (tool === undefined) throw new Error('missing tool ' + name)
      return await tool.handler(args)
    }
    for (const tools of [firstTools, secondTools]) {
      const own = tools === firstTools ? firstRecord : secondRecord
      const foreign = tools === firstTools ? secondRecord : firstRecord
      expect(await invoke(tools, 'test_status', {})).toMatchObject({ total: 1 })
      expect(await invoke(tools, 'execution_summary', {})).toMatchObject({ total: 1 })
      expect(await invoke(tools, 'execution_output', { execution_id: own.id })).toMatchObject({ id: own.id })
      await expect(invoke(tools, 'execution_output', { execution_id: foreign.id })).rejects.toThrow(/unknown execution id/)
    }
  })

  it('reuses one recorder for an alias of the same physical workspace', () => {
    const first = directory()
    const alias = path.join(directory(), 'alias')
    try {
      fs.symlinkSync(first, alias, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return
    }
    const recorders = new WorkspaceRecorders(directory())
    expect(recorders.forWorkspace(alias)).toBe(recorders.forWorkspace(first))
  })
})
