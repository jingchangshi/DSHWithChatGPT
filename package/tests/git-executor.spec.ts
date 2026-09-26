import { describe, expect, it, vi } from 'vitest'
import { gitDiff, gitLog, gitStatus, type WorkspaceGitExecutor } from '../src/workspace/git.ts'

function executor(): WorkspaceGitExecutor {
  return { signal: new AbortController().signal, execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) }
}

describe('execution-world Git command construction', () => {
  it('uses argv-only execution with bounded output, timeout, and cancellation', async () => {
    const target = executor()
    await gitLog(target, 5)
    expect(target.execute).toHaveBeenCalledExactlyOnceWith(
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'log', '--max-count=5', '--pretty=format:%H %s'],
      { maxBytes: 4194304, timeoutMs: 20000, signal: target.signal },
    )
  })

  it('does not reinterpret a missing execution provider as a non-repository', async () => {
    const target = executor()
    vi.mocked(target.execute).mockRejectedValue(new Error('PRIVATE_REMOTE_ENDPOINT'))
    await expect(gitStatus(target)).rejects.toThrow('GIT_EXECUTION_FAILED: Git execution unavailable')
  })

  it('does not swallow cancellation during optional HEAD lookup', async () => {
    const controller = new AbortController()
    const target = { ...executor(), signal: controller.signal }
    vi.mocked(target.execute).mockImplementation(async () => {
      controller.abort(new Error('PRIVATE_ERROR'))
      return { exitCode: 0, stdout: 'head', stderr: '' }
    })
    await expect(gitStatus(target)).rejects.toThrow('GIT_CANCELLED')
    expect(target.execute).toHaveBeenCalledTimes(1)
  })

  it('uses the provider empty-file value and accepts no-index exit one', async () => {
    const target = { ...executor(), emptyFile: '/dev/null' as const }
    vi.mocked(target.execute).mockImplementation(async args => {
      if (args.includes('--no-index')) return { exitCode: 1, stdout: 'REMOTE_DIFF', stderr: '' }
      if (args.includes('status')) return { exitCode: 0, stdout: '?? remote.txt\0', stderr: '' }
      return { exitCode: 0, stdout: 'value', stderr: '' }
    })
    await expect(gitDiff(target)).resolves.toMatchObject({ text: 'REMOTE_DIFF', against: 'EMPTY_TREE' })
    expect(target.execute).toHaveBeenLastCalledWith(
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', 'remote.txt'],
      { maxBytes: 263168, timeoutMs: 20000, signal: target.signal },
    )
  })

  it('does not guess the empty device from the Host platform', async () => {
    const target = executor()
    vi.mocked(target.execute).mockImplementation(async args => ({ exitCode: 0, stdout: args.includes('status') ? '?? remote.txt\0' : 'value', stderr: '' }))
    await expect(gitDiff(target)).rejects.toThrow('GIT_EMPTY_FILE_UNAVAILABLE')
    expect(vi.mocked(target.execute).mock.calls.some(([args]) => args.includes('--no-index'))).toBe(false)
  })
})
