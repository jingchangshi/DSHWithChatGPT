import { describe, expect, it, vi } from 'vitest'
import type { ExecutionWorkspaceId } from '@deepseek-ai/dsh-execution-world'
import { resolveExecutionWorkspace } from '../src/workspace/execution-identity.ts'

const firstId = '12345678-1234-4234-8234-123456789abc' as ExecutionWorkspaceId
const secondId = '22345678-1234-4234-8234-123456789abc' as ExecutionWorkspaceId

describe('execution-provider workspace identity', () => {
  it('passes remote cwd and cancellation verbatim to the published resolver', async () => {
    const resolve = vi.fn().mockResolvedValue(firstId)
    const signal = new AbortController().signal
    const cwd = '/remote/linux/path/not/present/on/windows'
    await expect(resolveExecutionWorkspace({ resolve }, cwd, signal)).resolves.toEqual({ workspaceId: firstId, displayRoot: cwd })
    expect(resolve).toHaveBeenCalledExactlyOnceWith(cwd, signal)
  })

  it('keeps provider IDs stable without deriving identity from cwd', async () => {
    const resolve = vi.fn().mockResolvedValue(firstId)
    const first = await resolveExecutionWorkspace({ resolve }, '/one/alias')
    const second = await resolveExecutionWorkspace({ resolve }, '/other/alias')
    expect(first.workspaceId).toBe(second.workspaceId)
    const otherWorld = await resolveExecutionWorkspace({ resolve: vi.fn().mockResolvedValue(secondId) }, '/one/alias')
    expect(first.workspaceId).not.toBe(otherWorld.workspaceId)
  })

  it('rejects absent identity service without a Host fallback', async () => {
    await expect(resolveExecutionWorkspace(undefined, '/workspace')).rejects.toThrow('EXECUTION_WORLD_IDENTITY_UNAVAILABLE')
  })

  it('rejects missing Session cwd before contacting the provider', async () => {
    const resolve = vi.fn()
    for (const cwd of [undefined, null, '', '   ', 1]) {
      await expect(resolveExecutionWorkspace({ resolve }, cwd)).rejects.toThrow('SESSION_WORKSPACE_UNAVAILABLE')
    }
    expect(resolve).not.toHaveBeenCalled()
  })

  it('does not publish provider errors containing paths or credentials', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('PRIVATE_PATH PRIVATE_CREDENTIAL'))
    await expect(resolveExecutionWorkspace({ resolve }, '/workspace')).rejects.toThrow('EXECUTION_WORLD_IDENTITY_UNAVAILABLE: execution identity resolution failed')
  })

  it('discards an identity returned after cancellation', async () => {
    const controller = new AbortController()
    const resolve = vi.fn(async () => { controller.abort(new Error('PRIVATE_ERROR')); return firstId })
    await expect(resolveExecutionWorkspace({ resolve }, '/workspace', controller.signal)).rejects.toThrow('WORKSPACE_OPERATION_CANCELLED: execution cancelled')
    await expect(resolveExecutionWorkspace({ resolve }, '/workspace', controller.signal)).rejects.toThrow('WORKSPACE_OPERATION_CANCELLED')
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})
