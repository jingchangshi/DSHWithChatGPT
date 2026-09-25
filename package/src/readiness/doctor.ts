import type { BrowserControl } from '../browser/index.ts'
import type { TunnelStatus } from '../tunnel/supervisor.ts'

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
  signal?: AbortSignal
}

export async function runDoctor(inputs: DoctorInputs): Promise<DoctorResult> {
  const checks: ReadinessCheck[] = [
    { id: 'session_workspace', ok: inputs.workspaceRoot !== '', detail: inputs.workspaceRoot !== '' ? 'session workspace is canonicalized' : 'session workspace is unavailable', code: inputs.workspaceRoot !== '' ? undefined : 'SESSION_WORKSPACE_MISSING' },
    { id: 'chatgpt_session', ok: false, detail: 'browser session probe not completed', code: 'BROWSER_SESSION_UNPROBED' },
    { id: 'chatgpt_app', ok: false, detail: `exact app probe is not destructive but requires browser app lookup: ${inputs.appName}`, code: 'CHATGPT_APP_UNPROBED' },
    { id: 'bridge', ok: false, detail: 'authenticated bridge probe not completed', code: 'BRIDGE_UNPROBED' },
    { id: 'workspace_identity', ok: inputs.workspaceId !== '', detail: inputs.workspaceId !== '' ? 'workspace identity available' : 'workspace identity unavailable', code: inputs.workspaceId !== '' ? undefined : 'WORKSPACE_ID_MISSING' },
    { id: 'tunnel', ok: inputs.runtime.tunnel.configured && inputs.runtime.tunnel.ready, detail: inputs.runtime.tunnel.detail, code: inputs.runtime.tunnel.ready ? undefined : 'TUNNEL_NOT_READY' },
    { id: 'remote_workspace_access', ok: false, detail: 'requires one real ChatGPT App MCP call; not verified by local doctor', code: 'REMOTE_ACCESS_REQUIRES_E2E' },
  ]
  try {
    const response = await fetch(`http://127.0.0.1:${inputs.bridgeHttp.port}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${inputs.bridgeHttp.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workspace_info', arguments: {} } }),
      signal: inputs.signal,
    })
    if (!response.ok) throw new Error(`bridge returned HTTP ${response.status}`)
    const envelope = await response.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } }
    if (envelope.error !== undefined) throw new Error(envelope.error.message ?? 'bridge workspace_info failed')
    const text = envelope.result?.content?.find(item => typeof item.text === 'string')?.text
    const workspace = text === undefined ? undefined : JSON.parse(text) as { workspaceId?: string }
    const bridge = checks.find(item => item.id === 'bridge')!
    bridge.ok = workspace?.workspaceId === inputs.workspaceId
    bridge.detail = bridge.ok ? 'authenticated loopback workspace_info identity matches session workspace' : 'workspace_info identity mismatch'
    bridge.code = bridge.ok ? undefined : 'WORKSPACE_ID_MISMATCH'
  } catch (error) {
    const bridge = checks.find(item => item.id === 'bridge')!
    bridge.detail = error instanceof Error ? error.message : String(error)
    bridge.code = 'BRIDGE_PROBE_FAILED'
  }
  try {
    if (inputs.browser.readiness === undefined) throw new Error('browser adapter does not expose readiness probe')
    const browser = await inputs.browser.readiness(inputs.signal)
    const check = checks.find(item => item.id === 'chatgpt_session')!
    check.ok = browser.url.startsWith('https://chatgpt.com/') && browser.composer && !browser.loggedOut
    check.detail = check.ok ? 'ChatGPT page, composer, and login are available' : 'ChatGPT page is unavailable, logged out, or composer is missing'
    check.code = check.ok ? undefined : browser.loggedOut ? 'CHATGPT_LOGGED_OUT' : 'CHATGPT_SESSION_NOT_READY'
  } catch (error) {
    const check = checks.find(item => item.id === 'chatgpt_session')!
    check.detail = error instanceof Error ? error.message : String(error)
    check.code = 'BROWSER_HARNESS_UNAVAILABLE'
  }
  return { ready: checks.filter(check => check.id !== 'remote_workspace_access').every(check => check.ok), checks }
}
