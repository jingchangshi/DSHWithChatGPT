import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { SidecarRpcError } from '../sidecar/errors.ts'

export interface SidecarSupervisorOptions {
  command: string
  args?: readonly string[]
  endpoint: string
  authentication: string
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  env?: NodeJS.ProcessEnv
}

/** Deployment-only owner for a semantic Sidecar process. */
export class SidecarSupervisor {
  #child: ChildProcess | undefined
  #closing: Promise<void> | undefined
  constructor(private readonly options: SidecarSupervisorOptions) {
    const url = new URL(options.endpoint)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    if (!options.command || !options.authentication) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
  }

  get pid(): number | undefined { return this.#child?.pid }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.#child) return
    if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED')
    const timeout = this.options.startupTimeoutMs ?? 10_000
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) throw new SidecarRpcError('SIDECAR_INVALID_REQUEST')
    const child = spawn(this.options.command, [...(this.options.args ?? [])], { env: { ...process.env, ...this.options.env }, stdio: 'ignore', windowsHide: true })
    this.#child = child
    const deadline = Date.now() + timeout
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED')
        if (child.exitCode !== null) throw new SidecarRpcError('SIDECAR_UNAVAILABLE')
        try {
          const response = await fetch(this.options.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + this.options.authentication, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, requestId: 'bootstrap', operationId: 'bootstrap', generation: 'bootstrap', method: 'health', params: {} }), signal: AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now()))) })
          if (response.ok) { const value = await response.json() as { ok?: boolean }; if (value.ok === true) return }
        } catch {}
        await delay(50, undefined, { signal: signal ?? undefined }).catch(error => { if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED'); throw error })
      }
      throw new SidecarRpcError('SIDECAR_TIMEOUT')
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closing = (async () => {
      const child = this.#child
      this.#child = undefined
      if (!child || child.exitCode !== null) return
      child.kill()
      const timeout = this.options.shutdownTimeoutMs ?? 2_000
      await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), delay(timeout)])
      if (child.exitCode === null) child.kill('SIGKILL')
    })()
    return this.#closing
  }
}
