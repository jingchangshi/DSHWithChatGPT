import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { abortableDelay, throwIfCancelled, withCancellation } from '../cancellation.ts'

export type TunnelMode = 'auto' | 'managed' | 'external'

export interface TunnelSupervisorOptions {
  mode: TunnelMode
  clientPath: string
  configuredTunnelId?: string
  tunnelIdEnv: string
  runtimeApiKeyEnv: string
  startupTimeoutMs: number
  stateDir: string
}

export interface TunnelBinding {
  workspaceId: string
  localUrl: string
  bearerValueFile: string
}

export interface TunnelStatus {
  mode: 'managed' | 'external'
  configured: boolean
  ready: boolean
  tunnelId?: string
  pid?: number
  healthUrl?: string
  detail: string
}

interface RunningTunnel {
  bindingKey: string
  tunnelId: string
  child: ChildProcess
  healthFile: string
  healthUrl?: string
  detail: string
}

export class TunnelSupervisor {
  private running: RunningTunnel | undefined
  private serialized: Promise<void> = Promise.resolve()

  constructor(private readonly options: TunnelSupervisorOptions) {}

  effectiveMode(): 'managed' | 'external' {
    return this.resolveConfigured().mode
  }

  async ensure(binding: TunnelBinding, signal?: AbortSignal): Promise<TunnelStatus> {
    throwIfCancelled(signal)
    const prior = this.serialized
    let release!: () => void
    const turn = new Promise<void>(resolve => { release = resolve })
    this.serialized = prior.then(() => turn)
    try {
      await withCancellation(prior, signal)
    } catch (error) {
      release()
      throw error
    }
    try {
      return await this.ensureExclusive(binding, signal)
    } finally {
      release()
    }
  }

  async status(): Promise<TunnelStatus> {
    const configured = this.resolveConfigured()
    if (configured.mode === 'external') {
      return {
        mode: 'external',
        configured: true,
        ready: true,
        detail: 'external tunnel mode; lifecycle is managed outside dsh-with-chatgpt',
      }
    }
    if (configured.tunnelId === undefined || configured.apiKey === undefined) {
      return {
        mode: 'managed',
        configured: false,
        ready: false,
        detail: configured.missing,
      }
    }
    if (this.running === undefined) {
      return {
        mode: 'managed',
        configured: true,
        ready: false,
        tunnelId: configured.tunnelId,
        detail: 'managed tunnel is configured but not running',
      }
    }
    const ready = await this.probe(this.running.healthUrl)
    return {
      mode: 'managed',
      configured: true,
      ready,
      tunnelId: this.running.tunnelId,
      ...(this.running.child.pid !== undefined ? { pid: this.running.child.pid } : {}),
      ...(this.running.healthUrl !== undefined ? { healthUrl: this.running.healthUrl } : {}),
      detail: ready ? 'managed Secure MCP Tunnel is ready' : this.running.detail,
    }
  }

  async close(): Promise<void> {
    const running = this.running
    this.running = undefined
    if (running === undefined) return
    await stopChild(running.child)
    try { fs.unlinkSync(running.healthFile) } catch {}
  }

  private async ensureExclusive(binding: TunnelBinding, signal?: AbortSignal): Promise<TunnelStatus> {
    throwIfCancelled(signal)
    const configured = this.resolveConfigured()
    if (configured.mode === 'external') {
      await this.close()
      return {
        mode: 'external',
        configured: true,
        ready: true,
        detail: 'external tunnel mode; lifecycle is managed outside dsh-with-chatgpt',
      }
    }
    if (configured.tunnelId === undefined || configured.apiKey === undefined) {
      await this.close()
      throw new Error('TUNNEL_NOT_CONFIGURED: ' + configured.missing)
    }

    const bindingKey = [
      binding.workspaceId,
      configured.tunnelId,
      binding.localUrl,
      binding.bearerValueFile,
    ].join('|')

    if (
      this.running !== undefined
      && this.running.bindingKey === bindingKey
      && this.running.child.exitCode === null
      && this.running.child.signalCode === null
      && await this.probe(this.running.healthUrl, signal)
    ) {
      return {
        mode: 'managed',
        configured: true,
        ready: true,
        tunnelId: configured.tunnelId,
        ...(this.running.child.pid !== undefined ? { pid: this.running.child.pid } : {}),
        ...(this.running.healthUrl !== undefined ? { healthUrl: this.running.healthUrl } : {}),
        detail: 'managed Secure MCP Tunnel is ready',
      }
    }

    throwIfCancelled(signal)
    await this.close()
    throwIfCancelled(signal)

    const tunnelDir = path.join(this.options.stateDir, 'tunnel')
    fs.mkdirSync(tunnelDir, { recursive: true })
    const healthFile = path.join(tunnelDir, binding.workspaceId + '.health-url')
    try { fs.unlinkSync(healthFile) } catch {}

    const env = {
      ...process.env,
      CONTROL_PLANE_API_KEY: configured.apiKey,
      MCP_EXTRA_HEADERS: 'Authorization: file:' + binding.bearerValueFile,
      MCP_DISCOVERY_EXTRA_HEADERS: 'Authorization: file:' + binding.bearerValueFile,
    }
    const args = [
      'run',
      '--control-plane.tunnel-id', configured.tunnelId,
      '--mcp.server-url', binding.localUrl,
      '--health.listen-addr', '127.0.0.1:0',
      '--health.url-file', healthFile,
      '--log.level', 'warn',
      '--log.format', 'struct-text',
    ]
    const child = spawn(this.options.clientPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const running: RunningTunnel = {
      bindingKey,
      tunnelId: configured.tunnelId,
      child,
      healthFile,
      detail: 'waiting for tunnel-client readiness',
    }
    this.running = running

    let diagnostic = ''
    let spawnError: Error | undefined
    child.once('error', (error) => {
      spawnError = error
      running.detail = sanitizeDiagnostic(error.message)
    })
    const append = (chunk: unknown): void => {
      diagnostic = (diagnostic + String(chunk)).slice(-8192)
      running.detail = sanitizeDiagnostic(diagnostic)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const deadline = Date.now() + this.options.startupTimeoutMs
    try {
    while (Date.now() < deadline) {
      throwIfCancelled(signal)
      if (spawnError !== undefined) {
        this.running = undefined
        throw new Error('TUNNEL_START_FAILED: ' + sanitizeDiagnostic(spawnError.message))
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        const detail = sanitizeDiagnostic(diagnostic) || `tunnel-client exited with code ${String(child.exitCode)}`
        this.running = undefined
        throw new Error('TUNNEL_START_FAILED: ' + detail)
      }
      if (fs.existsSync(healthFile)) {
        const url = fs.readFileSync(healthFile, 'utf8').trim()
        if (url !== '') {
          running.healthUrl = url.replace(/\/+$/, '')
          if (await this.probe(running.healthUrl, signal)) {
            running.detail = 'managed Secure MCP Tunnel is ready'
            return {
              mode: 'managed',
              configured: true,
              ready: true,
              tunnelId: configured.tunnelId,
              ...(child.pid !== undefined ? { pid: child.pid } : {}),
              healthUrl: running.healthUrl,
              detail: running.detail,
            }
          }
          if (running.detail === 'TUNNEL_AUTH_FAILED') throw new Error('TUNNEL_AUTH_FAILED')
        }
      }
      await abortableDelay(200, signal)
    }
    } catch (error) {
      if (this.running === running) await this.close()
      throw error
    }

    const detail = running.detail || sanitizeDiagnostic(diagnostic) || `tunnel-client did not become ready within ${this.options.startupTimeoutMs} ms`
    await this.close()
    throw new Error('TUNNEL_START_TIMEOUT: ' + detail)
  }

  private resolveConfigured(): {
    mode: 'managed' | 'external'
    tunnelId?: string
    apiKey?: string
    missing: string
  } {
    const tunnelId = this.options.configuredTunnelId?.trim()
      || process.env[this.options.tunnelIdEnv]?.trim()
    const apiKey = process.env[this.options.runtimeApiKeyEnv]?.trim()
    if (this.options.mode === 'external') {
      return { mode: 'external', missing: '' }
    }
    if (this.options.mode === 'auto' && (tunnelId === undefined || tunnelId === '' || apiKey === undefined || apiKey === '')) {
      return { mode: 'external', missing: '' }
    }
    const missing: string[] = []
    if (tunnelId === undefined || tunnelId === '') {
      missing.push(`tunnel id missing (config tunnelId or env ${this.options.tunnelIdEnv})`)
    }
    if (apiKey === undefined || apiKey === '') {
      missing.push(`runtime API key missing (env ${this.options.runtimeApiKeyEnv})`)
    }
    return {
      mode: 'managed',
      ...(tunnelId !== undefined && tunnelId !== '' ? { tunnelId } : {}),
      ...(apiKey !== undefined && apiKey !== '' ? { apiKey } : {}),
      missing: missing.join('; '),
    }
  }

  private async probe(healthUrl: string | undefined, signal?: AbortSignal): Promise<boolean> {
    throwIfCancelled(signal)
    if (healthUrl === undefined || healthUrl === '') return false
    const running = this.running
    const unavailable = (detail: string): false => {
      if (running !== undefined && this.running === running) running.detail = detail
      return false
    }
    try {
      const url = new URL(healthUrl)
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) return unavailable('TUNNEL_HEALTH_UNAVAILABLE')
      const probeSignal = signal === undefined ? AbortSignal.timeout(1500) : AbortSignal.any([signal, AbortSignal.timeout(1500)])
      const response = await fetch(healthUrl.replace(/\/+$/, '') + '/readyz', {
        signal: probeSignal, redirect: 'error',
      })
      await response.body?.cancel()
      if (!response.ok) return unavailable('TUNNEL_LOCAL_PROBE_FAILED')
      const health = await fetch(healthUrl.replace(/\/+$/, '') + '/health?details=true', { signal: probeSignal, redirect: 'error' })
      if (!health.ok || health.body === null) return unavailable('TUNNEL_HEALTH_UNAVAILABLE')
      const reader = health.body.getReader()
      let size = 0
      const chunks: Uint8Array[] = []
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 65536) return unavailable('TUNNEL_HEALTH_UNAVAILABLE')
          chunks.push(part.value)
        }
      } finally { await reader.cancel() }
      // Interpret the tunnel-client's local operator schema, never its raw diagnostics.
      // /readyz gates startup only; it does not attest successful authenticated polling.
      const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (snapshot.schema_version !== 1 || snapshot.live !== true || snapshot.ready !== true) return unavailable('TUNNEL_HEALTH_UNAVAILABLE')
      const control = snapshot.components?.['control-plane']
      if ([401, 403].includes(control?.details?.http_status)) return unavailable('TUNNEL_AUTH_FAILED')
      if (control?.status !== 'ok' || control.details?.consecutive_failures !== 0
        || typeof control.details?.last_success !== 'string' || !Number.isFinite(Date.parse(control.details.last_success))) return unavailable('TUNNEL_CONTROL_PLANE_UNAVAILABLE')
      if (snapshot.components?.mcp?.details?.startup_probe?.state !== 'succeeded') return unavailable('TUNNEL_LOCAL_PROBE_FAILED')
      return true
    } catch {
      throwIfCancelled(signal)
      return unavailable('TUNNEL_HEALTH_UNAVAILABLE')
    }
  }
}

export function buildTunnelLaunchPreview(options: TunnelSupervisorOptions, binding: TunnelBinding): {
  clientPath: string
  args: string[]
  envKeys: string[]
} {
  const tunnelId = options.configuredTunnelId?.trim() || process.env[options.tunnelIdEnv]?.trim() || '<tunnel-id>'
  return {
    clientPath: options.clientPath,
    args: [
      'run',
      '--control-plane.tunnel-id', tunnelId,
      '--mcp.server-url', binding.localUrl,
      '--health.listen-addr', '127.0.0.1:0',
      '--health.url-file', path.join(options.stateDir, 'tunnel', binding.workspaceId + '.health-url'),
      '--log.level', 'warn',
      '--log.format', 'struct-text',
    ],
    envKeys: ['CONTROL_PLANE_API_KEY', 'MCP_EXTRA_HEADERS', 'MCP_DISCOVERY_EXTRA_HEADERS'],
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const settled = new Promise<void>(resolve => child.once('exit', () => resolve()))
  try { child.kill('SIGTERM') } catch { return }
  await Promise.race([settled, sleep(1500)])
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL') } catch {}
    await Promise.race([settled, sleep(1000)])
  }
}

function sanitizeDiagnostic(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, 'Bearer [REDACTED]')
    .trim()
    .slice(-2048)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
