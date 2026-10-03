import { randomUUID } from 'node:crypto'
import type { ChatControl, ChatSendObservationControl, ControlOperation } from '../core/ports/chat-control.ts'
import type { ChatControlDiagnostics } from '../core/ports/chat-diagnostics.ts'
import { BrowserStaleError, ChatGptLoggedOutError, ChatGptAppUnavailableError } from '../browser/adapter.ts'
import { BrowserTargetChangedError } from '../browser/epoch.ts'
import type { TunnelStatus } from '../tunnel/supervisor.ts'
import { OperationCancelledError, throwIfCancelled, withCancellation } from '../cancellation.ts'
import { appProofPrompt, gitFact, rootFact, verifyAppProof, type AppProof } from './app-proof.ts'

export interface ReadinessCheck {
  id: string
  ok: boolean
  detail: string
  code?: string
}

export interface DoctorResult {
  ready: boolean
  localReady: boolean
  appDataPlaneVerified: boolean
  fullC2CVerified: false
  checks: ReadinessCheck[]
}

export interface DoctorInputs {
  mode?: 'local' | 'app-proof'
  appProofTimeoutMs?: number
  workspaceRoot: string
  workspaceId: string
  appName: string
  browser: ChatControl & Partial<ChatControlDiagnostics & Pick<ChatSendObservationControl, 'captureReplyBaseline' | 'captureSendObservation'>>
  runtime: { tunnel: TunnelStatus; bridge: { workspaceId: string } }
  bridgeHttp: { port: number; token: string }
  probeApp?: (signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
  /** Deployment transaction; the only supplied semantic action resumes a wait
   * and verifies its proof. There is deliberately no send or doctor closure. */
  recoverAppProof?: (operation: AppProofWaitRecovery, resume: () => Promise<string | undefined>, signal?: AbortSignal) => Promise<string | undefined>
}

export interface AppProofWaitRecovery {
  sendOperationId: string
  waitOperation: ControlOperation
}

const BRIDGE_PROBE_TIMEOUT_MS = 5_000
const controlFailureCodes = new Set([
  'CHATGPT_LOGGED_OUT', 'CHATGPT_APP_UNAVAILABLE', 'CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE',
  'SIDECAR_UNAVAILABLE', 'SIDECAR_TIMEOUT', 'SIDECAR_BUSY', 'SIDECAR_GENERATION_CHANGED',
  'SIDECAR_AUTH_REQUIRED', 'SIDECAR_INVALID_REQUEST', 'SIDECAR_VERSION_UNSUPPORTED',
  'SEND_UNCERTAIN', 'BROWSER_STALE', 'BROWSER_TARGET_CHANGED', 'REPLAY_CONFLICT', 'JOURNAL_UNAVAILABLE',
])
function isControlCancelled(error: unknown): boolean {
  return error instanceof OperationCancelledError || (error as { code?: unknown } | null)?.code === 'OPERATION_CANCELLED'
}
function controlFailureCode(error: unknown): string {
  if (error instanceof BrowserTargetChangedError) return 'BROWSER_TARGET_CHANGED'
  if (error instanceof BrowserStaleError) return 'BROWSER_HARNESS_UNAVAILABLE' // Legacy provider result.
  if (error instanceof ChatGptLoggedOutError) return 'CHATGPT_LOGGED_OUT'
  if (error instanceof ChatGptAppUnavailableError) return 'CHATGPT_APP_UNAVAILABLE'
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && controlFailureCodes.has(code) ? code : 'CHAT_CONTROL_UNAVAILABLE'
}

const capabilityReasons = new Set([
  'RUNTIME_LEASE_UNAVAILABLE', 'ROOT_SAFE_READ_UNAVAILABLE', 'GIT_READ_UNAVAILABLE',
  'SUBPROCESS_CAPABILITY_UNAVAILABLE', 'EXECUTION_OUTPUT_UNAVAILABLE',
])

function dataPlaneCheck(id: string, capability: unknown, leaseBound: boolean): ReadinessCheck {
  const value = typeof capability === 'object' && capability !== null ? capability as Record<string, unknown> : undefined
  const ok = leaseBound && value?.available === true
  const reason = value?.reason
  return {
    id, ok,
    detail: ok ? 'execution workspace capability available' : 'execution workspace capability unavailable',
    ...(ok ? {} : { code: typeof reason === 'string' && capabilityReasons.has(reason) ? reason : 'WORKSPACE_CAPABILITY_UNAVAILABLE' }),
  }
}

async function probeBridge(inputs: DoctorInputs, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  inputs.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), BRIDGE_PROBE_TIMEOUT_MS)
  try {
    const response = await fetch('http://127.0.0.1:' + inputs.bridgeHttp.port + '/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + inputs.bridgeHttp.token, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('bridge request failed')
    const envelope = await response.json() as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: unknown }
    if (envelope.error !== undefined || envelope.result?.isError === true) throw new Error('bridge tool failed')
    const text = envelope.result?.content?.find(item => typeof item.text === 'string')?.text
    if (text === undefined) throw new Error('bridge tool returned no result')
    return JSON.parse(text) as unknown
  } finally {
    clearTimeout(timeout)
    inputs.signal?.removeEventListener('abort', onAbort)
  }
}
export async function runDoctor(inputs: DoctorInputs): Promise<DoctorResult> {
  throwIfCancelled(inputs.signal)
  let challenge: string | undefined
  let root: AppProof['root'] | undefined
  let git: AppProof['git'] | undefined
  const checks: ReadinessCheck[] = [
    { id: 'session_workspace', ok: inputs.workspaceRoot !== '', detail: inputs.workspaceRoot !== '' ? 'session workspace is available' : 'session workspace is unavailable', ...(inputs.workspaceRoot !== '' ? {} : { code: 'SESSION_WORKSPACE_MISSING' }) },
    { id: 'chatgpt_session', ok: false, detail: 'browser session probe not completed', code: 'BROWSER_SESSION_UNPROBED' },
    { id: 'chatgpt_app', ok: false, detail: `exact app probe is not destructive but requires browser app lookup: ${inputs.appName}`, code: 'CHATGPT_APP_UNPROBED' },
    { id: 'bridge', ok: false, detail: 'authenticated bridge probe not completed', code: 'BRIDGE_UNPROBED' },
    { id: 'workspace_identity', ok: inputs.workspaceId !== '', detail: inputs.workspaceId !== '' ? 'workspace identity available' : 'workspace identity unavailable', ...(inputs.workspaceId !== '' ? {} : { code: 'WORKSPACE_ID_MISSING' }) },
    { id: 'workspace_content_read', ok: false, detail: 'execution workspace capability not probed', code: 'WORKSPACE_CAPABILITY_UNAVAILABLE' },
    { id: 'workspace_git_read', ok: false, detail: 'execution workspace capability not probed', code: 'WORKSPACE_CAPABILITY_UNAVAILABLE' },
    { id: 'execution_output_access', ok: false, detail: 'execution workspace capability not probed', code: 'WORKSPACE_CAPABILITY_UNAVAILABLE' },
    { id: 'tunnel', ok: inputs.runtime.tunnel.configured && inputs.runtime.tunnel.ready, detail: inputs.runtime.tunnel.detail, ...(inputs.runtime.tunnel.ready ? {} : { code: 'TUNNEL_NOT_READY' }) },
    { id: 'remote_workspace_access', ok: false, detail: 'requires one real ChatGPT App MCP call; not verified by local doctor', code: 'REMOTE_ACCESS_REQUIRES_E2E' },
  ]
  try {
    const workspace = await probeBridge(inputs, 'workspace_info') as { workspaceId?: string; appProof?: { version?: unknown; challenge?: unknown }; capabilities?: { leaseBound?: unknown; workspaceContentRead?: unknown; gitRead?: unknown; executionOutput?: unknown } }
    if (workspace.appProof?.version === 1 && typeof workspace.appProof.challenge === 'string' && workspace.appProof.challenge.length > 0) challenge = workspace.appProof.challenge
    const bridge = checks.find(item => item.id === 'bridge')!
    bridge.ok = workspace?.workspaceId === inputs.workspaceId
    bridge.detail = bridge.ok ? 'authenticated loopback workspace_info identity matches session workspace' : 'workspace_info identity mismatch'
    if (bridge.ok) delete bridge.code
    else bridge.code = 'WORKSPACE_ID_MISMATCH'
    if (bridge.ok) {
      const capabilities = workspace?.capabilities
      const leaseBound = capabilities?.leaseBound === true
      for (const check of [
        dataPlaneCheck('workspace_content_read', capabilities?.workspaceContentRead, leaseBound),
        dataPlaneCheck('workspace_git_read', capabilities?.gitRead, leaseBound),
        dataPlaneCheck('execution_output_access', capabilities?.executionOutput, leaseBound),
      ]) checks[checks.findIndex(item => item.id === check.id)] = check
      for (const [id, name, args] of [
        ['workspace_content_read', 'list_directory', { path: '' }],
        ['workspace_git_read', 'git_status', {}],
      ] as const) {
        const check = checks.find(item => item.id === id)!
        if (!check.ok) continue
        try {
          const value = await probeBridge(inputs, name, args)
          if (inputs.mode === 'app-proof') {
            if (name === 'list_directory') root = rootFact(value)
            else git = gitFact(value)
          }
          throwIfCancelled(inputs.signal)
          check.detail = 'authenticated execution workspace operation succeeded'
        } catch (error) {
          if (inputs.signal?.aborted || isControlCancelled(error)) throw new OperationCancelledError()
          check.ok = false
          check.detail = 'authenticated execution workspace operation failed'
          check.code = 'WORKSPACE_OPERATION_FAILED'
        }
      }
    }
  } catch (error) {
    if (inputs.signal?.aborted || isControlCancelled(error)) throw new OperationCancelledError()
    const bridge = checks.find(item => item.id === 'bridge')!
    bridge.detail = 'authenticated workspace_info request failed'
    bridge.code = 'BRIDGE_PROBE_FAILED'
  }
  try {
    if (inputs.probeApp === undefined) throw new Error('browser adapter does not expose app probe')
    await inputs.probeApp(inputs.signal)
    const app = checks.find(item => item.id === 'chatgpt_app')!
    app.ok = true
    app.detail = `exact ChatGPT App is selectable and composer was cleaned: ${inputs.appName}`
    delete app.code
  } catch (error) {
    if (inputs.signal?.aborted || isControlCancelled(error)) throw new OperationCancelledError()
    const app = checks.find(item => item.id === 'chatgpt_app')!
    app.detail = 'exact ChatGPT App could not be selected; verify the app and browser session'
    app.code = controlFailureCode(error)
    if (error instanceof BrowserStaleError) app.detail = 'Browser Harness App probe or composer cleanup failed'
  }
  try {
    if (inputs.browser.readiness === undefined) throw new Error('browser adapter does not expose readiness probe')
    const browser = await inputs.browser.readiness(inputs.signal)
    const check = checks.find(item => item.id === 'chatgpt_session')!
    check.ok = browser.url.startsWith('https://chatgpt.com/') && browser.composer && !browser.loggedOut
    check.detail = check.ok ? 'ChatGPT page, composer, and login are available' : 'ChatGPT page is unavailable, logged out, or composer is missing'
    if (check.ok) delete check.code
    else check.code = browser.loggedOut ? 'CHATGPT_LOGGED_OUT' : 'CHATGPT_SESSION_NOT_READY'
  } catch (error) {
    if (inputs.signal?.aborted || isControlCancelled(error)) throw new OperationCancelledError()
    const check = checks.find(item => item.id === 'chatgpt_session')!
    check.detail = 'Chat session readiness probe failed; check the control provider and Session ownership'
    check.code = controlFailureCode(error)
  }
  throwIfCancelled(inputs.signal)
  const localReady = checks.filter(check => check.id !== 'remote_workspace_access' && check.id !== 'execution_output_access').every(check => check.ok)
  const remote = checks.find(check => check.id === 'remote_workspace_access')!
  if (inputs.mode === 'app-proof') {
    let code: string | undefined = 'APP_PROOF_PREREQUISITE_FAILED'
    if (localReady) {
      if (challenge === undefined || root === undefined || git === undefined) code = 'APP_PROOF_CHALLENGE_UNAVAILABLE'
      else code = await proveApp(inputs, { challenge, workspaceId: inputs.workspaceId, root, git })
    }
    remote.ok = code === undefined
    remote.detail = remote.ok ? 'current App workspace read verified' : 'current App workspace read not verified'
    if (code === undefined) delete remote.code
    else remote.code = code
  }
  return { ready: localReady, localReady, appDataPlaneVerified: remote.ok, fullC2CVerified: false, checks }
}

async function proveApp(inputs: DoctorInputs, expected: AppProof): Promise<string | undefined> {
  const timeoutMs = inputs.appProofTimeoutMs
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return 'APP_PROOF_PREREQUISITE_FAILED'
  const timeout = new AbortController()
  const signal = inputs.signal === undefined ? timeout.signal : AbortSignal.any([inputs.signal, timeout.signal])
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  let sent = false
  try {
    const observed = inputs.browser.captureReplyBaseline !== undefined && inputs.browser.captureSendObservation !== undefined
    const sendId = randomUUID()
    const waitId = randomUUID()
    const baseline = observed ? await withCancellation(() => inputs.browser.captureReplyBaseline!(signal), signal) : undefined
    if (observed && !baseline) return 'SEND_UNCERTAIN'
    await withCancellation(() => inputs.browser.sendControlMessage(appProofPrompt, signal,
      baseline === undefined ? undefined : { operationId: sendId, replyBaseline: baseline }), signal)
    sent = true
    const bound = observed ? await withCancellation(() => inputs.browser.captureSendObservation!(sendId, signal), signal) : undefined
    if (observed && !bound) return 'SEND_UNCERTAIN'
    if (bound && (!bound.conversationId || bound.assistantCount !== baseline!.assistantCount || bound.textDigest !== baseline!.textDigest
      || baseline!.conversationId !== null && bound.conversationId !== baseline!.conversationId)) return 'SEND_UNCERTAIN'
    const operation: ControlOperation | undefined = bound === undefined ? undefined : Object.freeze({
      operationId: waitId, replyBaseline: Object.freeze({ ...bound }), replyRecovery: Object.freeze({ sendOperationId: sendId }),
    })
    const resume = async () => {
      const reply = await withCancellation(() => inputs.browser.waitForReply(timeoutMs, signal, operation), signal)
      throwIfCancelled(signal)
      if (!reply.complete) return 'APP_PROOF_TIMEOUT'
      return verifyAppProof(reply.text, expected)
    }
    try { return await resume() }
    catch (error) {
      throwIfCancelled(signal)
      if (controlFailureCode(error) !== 'BROWSER_STALE' || !operation || !inputs.recoverAppProof) throw error
      // One transaction only. A failure from its resumed wait escapes to the
      // outer catch; it cannot re-enter this branch or renew the proof clock.
      return await withCancellation(() => inputs.recoverAppProof!({ sendOperationId: sendId, waitOperation: operation }, resume, signal), signal)
    }
  } catch (error) {
    if (inputs.signal?.aborted) throw new OperationCancelledError()
    if (timeout.signal.aborted) return 'APP_PROOF_TIMEOUT'
    if (isControlCancelled(error)) throw new OperationCancelledError()
    const providerCode = controlFailureCode(error)
    if (providerCode !== 'CHAT_CONTROL_UNAVAILABLE') return providerCode
    return sent ? 'APP_PROOF_REPLY_MISSING' : 'APP_PROOF_SEND_FAILED'
  } finally {
    clearTimeout(timer)
  }
}
