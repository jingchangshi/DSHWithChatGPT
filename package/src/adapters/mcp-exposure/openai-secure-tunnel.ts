import type { McpExposureBinding, McpExposureProvider, McpExposureStatus } from '../../core/ports/mcp-exposure.ts'
import { TunnelSupervisor, type TunnelStatus, type TunnelSupervisorOptions } from '../../tunnel/supervisor.ts'
import { throwIfCancelled } from '../../cancellation.ts'

/** Legacy diagnostics remain available to inbound composition only. */
export class OpenAiSecureTunnelAdapter implements McpExposureProvider {
  private readonly supervisor: TunnelSupervisor
  private readonly diagnostics = new WeakMap<McpExposureStatus, TunnelStatus>()
  constructor(options: TunnelSupervisorOptions) { this.supervisor = new TunnelSupervisor(options) }
  effectiveMode(): 'managed' | 'external' { return this.supervisor.effectiveMode() }
  private summarize(legacy: TunnelStatus): McpExposureStatus {
    const status = { ready: legacy.ready, detail: legacy.detail }
    this.diagnostics.set(status, legacy)
    return status
  }
  compatibilityStatus(status: McpExposureStatus): TunnelStatus {
    const legacy = this.diagnostics.get(status)
    if (legacy === undefined) throw new Error('EXPOSURE_STATUS_NOT_OWNED')
    return legacy
  }
  async ensure(binding: McpExposureBinding, signal?: AbortSignal): Promise<McpExposureStatus> {
    const endpoint = new URL(binding.loopbackEndpoint)
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password || endpoint.pathname !== '/mcp' || endpoint.search || endpoint.hash) throw new Error('INVALID_LOOPBACK_MCP_ENDPOINT')
    const legacy = await this.supervisor.ensure({ workspaceId: binding.workspaceId, localUrl: binding.loopbackEndpoint, bearerValueFile: binding.authorizationReference }, signal)
    return this.summarize(legacy)
  }
  async status(signal?: AbortSignal): Promise<McpExposureStatus> {
    throwIfCancelled(signal)
    const legacy = await this.supervisor.status()
    throwIfCancelled(signal)
    return this.summarize(legacy)
  }
  rebind(binding: McpExposureBinding, signal?: AbortSignal): Promise<McpExposureStatus> { return this.ensure(binding, signal) }
  async close(signal?: AbortSignal): Promise<void> { throwIfCancelled(signal); await this.supervisor.close() }
}
