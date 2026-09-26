import type { BrowserControl } from '../browser/index.ts'
import type { TunnelStatus } from '../tunnel/supervisor.ts'
import { OperationCancelledError, throwIfCancelled } from '../cancellation.ts'

export interface ReadinessCheck {
  id: string
  ok: boolean
  detail: string
  code?: string
}

export interface DoctorResult {
  ready: boolean
  checks: ReadinessCheck[]
}

export interface DoctorInputs {
  workspaceRoot: string
  workspaceId: string
  appName: string
  browser: BrowserControl
  runtime: { tunnel: TunnelStatus; bridge: { workspaceId: string } }
  bridgeHttp: { port: number; token: string }
  probeApp?: (signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
}

const BRIDGE_PROBE_TIMEOUT_MS = 5_000

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

async function probeBridge(inputs: DoctorInputs): Promise<Response> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  inputs.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), BRIDGE_PROBE_TIMEOUT_MS)
  try {
    return await fetch('http://127.0.0.1:' + inputs.bridgeHttp.port + '/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + inputs.bridgeHttp.token, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workspace_info', arguments: {} } }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
    inputs.signal?.removeEventListener('abort', onAbort)
  }
}
export async function runDoctor(inputs: DoctorInputs): Promise<DoctorResult> {
  throwIfCancelled(inputs.signal)
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
    const response = await probeBridge(inputs)
    if (!response.ok) throw new Error(`bridge returned HTTP ${response.status}`)
    const envelope = await response.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } }
    if (envelope.error !== undefined) throw new Error(envelope.error.message ?? 'bridge workspace_info failed')
    const text = envelope.result?.content?.find(item => typeof item.text === 'string')?.text
    const workspace = text === undefined ? undefined : JSON.parse(text) as { workspaceId?: string; capabilities?: { leaseBound?: unknown; workspaceContentRead?: unknown; gitRead?: unknown; executionOutput?: unknown } }
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
    }
  } catch (error) {
    if (inputs.signal?.aborted || error instanceof OperationCancelledError) throw new OperationCancelledError()
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
    if (inputs.signal?.aborted || error instanceof OperationCancelledError) throw new OperationCancelledError()
    const app = checks.find(item => item.id === 'chatgpt_app')!
    app.detail = 'exact ChatGPT App could not be selected; verify the app and browser session'
    app.code = 'CHATGPT_APP_UNAVAILABLE'
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
    if (inputs.signal?.aborted || error instanceof OperationCancelledError) throw new OperationCancelledError()
    const check = checks.find(item => item.id === 'chatgpt_session')!
    check.detail = 'Browser Harness session probe failed; check the provider and Session ownership'
    check.code = 'BROWSER_HARNESS_UNAVAILABLE'
  }
  return { ready: checks.filter(check => check.id !== 'remote_workspace_access').every(check => check.ok), checks }
}
