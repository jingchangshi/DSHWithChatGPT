import type { ChatControl, ControlOperation } from '../core/ports/chat-control.ts'
import type { ChatControlDiagnostics } from '../core/ports/chat-diagnostics.ts'
import { SidecarChatControlClient } from '../sidecar/client.ts'
import { SidecarRpcError } from '../sidecar/errors.ts'
import { validateSidecarEndpoint } from '../sidecar/protocol.ts'
import { readSidecarCredential } from './sidecar-credential.ts'

export interface SidecarDeploymentConfig {
  endpoint: string
  credentialFile: string
  excludedRoots: readonly string[]
  requestTimeoutMs?: number
}

/** Deployment resolves private credentials; the neutral client sees only RPC.
 * No service is launched, adopted, shut down or replaced implicitly here. */
export class DeploymentSidecarControl implements ChatControl, ChatControlDiagnostics {
  #client: Promise<SidecarChatControlClient> | undefined
  constructor(private readonly options: SidecarDeploymentConfig) { validateSidecarEndpoint(options.endpoint) }

  private async client(signal?: AbortSignal): Promise<SidecarChatControlClient> {
    if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED')
    this.#client ??= readSidecarCredential(this.options.credentialFile, this.options.excludedRoots).then(authentication =>
      new SidecarChatControlClient({ endpoint: this.options.endpoint, authentication, requestTimeoutMs: this.options.requestTimeoutMs }))
    const client = await this.#client
    if (signal?.aborted) throw new SidecarRpcError('OPERATION_CANCELLED')
    return client
  }
  async health() { return (await this.client()).health() }
  async ensureReady(signal?: AbortSignal) { return (await this.client(signal)).ensureReady(signal) }
  async openConversation(id?: string, signal?: AbortSignal) { return (await this.client(signal)).openConversation(id, signal) }
  async sendControlMessage(text: string, signal?: AbortSignal, operation?: ControlOperation) {
    return (await this.client(signal)).sendControlMessage(text, signal, operation)
  }
  async waitForReply(timeoutMs: number, signal?: AbortSignal, operation?: ControlOperation) {
    return (await this.client(signal)).waitForReply(timeoutMs, signal, operation)
  }
  async recover(signal?: AbortSignal) { return (await this.client(signal)).recover(signal) }
  async readiness(signal?: AbortSignal) { return (await this.client(signal)).readiness(signal) }
  async probeApp(appName: string, signal?: AbortSignal, operation?: ControlOperation) {
    return (await this.client(signal)).probeApp(appName, signal, operation)
  }
  async currentConversation(signal?: AbortSignal) { return (await this.client(signal)).currentConversation(signal) }
  /** Compatibility alias for the existing readiness adapter contract. */
  conversationId(signal?: AbortSignal) { return this.currentConversation(signal) }
}
