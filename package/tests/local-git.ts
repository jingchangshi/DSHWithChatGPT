import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkspaceGitExecutor } from '../src/workspace/git.ts'

const execute = promisify(execFile)

export function localGitExecutor(root: string): WorkspaceGitExecutor {
  return {
    emptyFile: process.platform === 'win32' ? 'NUL' : '/dev/null',
    signal: new AbortController().signal,
    async execute(args, options) {
      try {
        const result = await execute('git', ['-C', root, ...args], {
          maxBuffer: options.maxBytes, timeout: options.timeoutMs, signal: options.signal, windowsHide: true,
        })
        return { ...result, exitCode: 0 }
      } catch (error) {
        const failure = error as { code?: number | string; stdout?: string; stderr?: string }
        if (typeof failure.code === 'number') return { exitCode: failure.code, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
        if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && args.includes('--no-index')) {
          return { exitCode: 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
        }
        throw error
      }
    },
  }
}
