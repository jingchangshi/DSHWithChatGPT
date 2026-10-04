import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import http from 'node:http'

// Execution record: an authenticated real bridge with no workspace tools.
// The private environment file, client and evidence root are explicit inputs.
const [packageRoot, privateEnvFile, clientPath, evidenceRoot] = process.argv.slice(2)
assert.ok(packageRoot && privateEnvFile && clientPath && evidenceRoot, 'explicit diagnostic inputs required')
for (const line of fs.readFileSync(privateEnvFile, 'utf8').split(/\r?\n/)) {
  const match = /^\s*(CONTROL_PLANE_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (match) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
}
for (const key of ['CONTROL_PLANE_API_KEY', 'CONTROL_PLANE_TUNNEL_ID', 'CONTROL_PLANE_HTTP_PROXY']) assert.ok(process.env[key], key + ' required')
const { TunnelSupervisor, buildTunnelLaunchPreview } = await import(pathToFileURL(path.join(packageRoot, 'lib/tunnel/supervisor.js')))
const { startBridgeServer } = await import(pathToFileURL(path.join(packageRoot, 'lib/bridge/server.js')))
const { Config } = await import(pathToFileURL(path.join(packageRoot, 'lib/index.js')))
const config = Config.parse({ tunnelMode: 'managed', tunnelClientPath: clientPath })
assert.equal(config.tunnelStartupTimeoutMs, 20000)
assert.equal(config.tunnelControlPlaneHttpProxyEnv, 'CONTROL_PLANE_HTTP_PROXY')
const runId = randomUUID()
const stateDir = path.join(evidenceRoot, 'supervisor-' + runId)
fs.mkdirSync(stateDir)
const token = randomBytes(32).toString('base64url')
const bearerValueFile = path.join(stateDir, 'bridge.bearer')
fs.writeFileSync(bearerValueFile, 'Bearer ' + token + '\n', { mode: 0o600 })
let authenticatedBridgeRequests = 0
const createServer = http.createServer
http.createServer = (...args) => {
  const server = Reflect.apply(createServer, http, args)
  server.on('request', (req, res) => res.once('finish', () => {
    if (req.method === 'POST' && req.url === '/mcp' && req.headers.authorization === 'Bearer ' + token && res.statusCode === 200) authenticatedBridgeRequests++
  }))
  return server
}
const bridge = await startBridgeServer({ port: 0, tokens: new Map([[token, 'diagnostic-only']]) }, [])
http.createServer = createServer
const options = { mode: config.tunnelMode, clientPath: config.tunnelClientPath, tunnelIdEnv: config.tunnelIdEnv,
  runtimeApiKeyEnv: config.tunnelRuntimeApiKeyEnv, controlPlaneHttpProxyEnv: config.tunnelControlPlaneHttpProxyEnv,
  startupTimeoutMs: config.tunnelStartupTimeoutMs, stateDir }
const binding = { workspaceId: 'diagnostic-' + runId, localUrl: 'http://127.0.0.1:' + bridge.port + '/mcp', bearerValueFile }
const supervisor = new TunnelSupervisor(options)
const preview = buildTunnelLaunchPreview(options, binding)
const secrets = [token, process.env.CONTROL_PLANE_API_KEY, process.env.CONTROL_PLANE_HTTP_PROXY]
for (const secret of secrets) assert.equal(preview.args.join(' ').includes(secret), false, 'argv secret leak')
const started = Date.now()
const result = { runId, started: new Date(started).toISOString(), packageRoot, startupTimeoutMs: options.startupTimeoutMs,
  initialPollRequestedWait: preview.args[preview.args.indexOf('--control-plane.initial-poll-timeout') + 1],
  controlPlaneProxyReference: preview.args[preview.args.indexOf('--control-plane.http-proxy') + 1],
  productMessages: 0, workspaceTools: 0, successful: false }
let healthUrl
try {
  const status = await supervisor.ensure(binding)
  result.readinessElapsedMs = Date.now() - started
  assert.ok(result.readinessElapsedMs < options.startupTimeoutMs)
  assert.equal(status.ready, true)
  result.childPid = status.pid
  healthUrl = status.healthUrl
  const health = await (await fetch(healthUrl + '/health?details=true', { signal: AbortSignal.timeout(1500) })).json()
  const control = health.components?.['control-plane']
  result.health = { schema: health.schema_version, live: health.live, ready: health.ready,
    controlStatus: control?.status, consecutiveFailures: control?.details?.consecutive_failures,
    lastSuccessValid: Number.isFinite(Date.parse(control?.details?.last_success)),
    configuredPollWaitSeconds: control?.details?.configured_wait_seconds,
    effectivePollWaitSeconds: control?.details?.effective_wait_seconds,
    pollDeadlineSeconds: control?.details?.deadline_seconds,
    localProbeState: health.components?.mcp?.details?.startup_probe?.state }
  assert.equal(result.health.schema, 1)
  assert.equal(result.health.live, true)
  assert.equal(result.health.ready, true)
  assert.equal(result.health.controlStatus, 'ok')
  assert.equal(result.health.consecutiveFailures, 0)
  assert.equal(result.health.lastSuccessValid, true)
  assert.equal(result.health.localProbeState, 'succeeded')
  result.tunnelAuthenticatedBridgeRequests = authenticatedBridgeRequests
  const request = { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'auth-probe', method: 'initialize' }), signal: AbortSignal.timeout(1500) }
  assert.equal((await fetch(binding.localUrl, request)).status, 401)
  const authenticated = await fetch(binding.localUrl, { ...request, headers: { ...request.headers, authorization: 'Bearer ' + token } })
  assert.equal(authenticated.status, 200)
  assert.equal((await authenticated.json()).result?.serverInfo?.name, 'dsh-with-chatgpt')
  result.bridgeAuthEnforced = true
  assert.equal((await supervisor.status()).ready, true)
  result.successful = true
} catch (error) {
  // Preserve the supervisor's bounded finite diagnostic, never raw child output.
  result.failureCode = String(error?.message).split(':')[0]
  const failureFile = path.join(stateDir, 'tunnel', binding.workspaceId + '.failure.json')
  if (fs.existsSync(failureFile)) result.failureFacts = JSON.parse(fs.readFileSync(failureFile, 'utf8'))
  process.exitCode = 1
} finally {
  await supervisor.close()
  await bridge.close()
  result.authenticatedBridgeRequests = authenticatedBridgeRequests
  result.healthPointerRemoved = !fs.existsSync(path.join(stateDir, 'tunnel', binding.workspaceId + '.health-url'))
  result.supervisorStopped = (await supervisor.status()).ready === false
  try { process.kill(result.childPid, 0); result.childStopped = false } catch { result.childStopped = true }
  result.healthEndpointClosed = healthUrl ? await fetch(healthUrl + '/readyz', { signal: AbortSignal.timeout(1500) }).then(() => false, () => true) : null
  result.bridgeEndpointClosed = await fetch(binding.localUrl, { signal: AbortSignal.timeout(1500) }).then(() => false, () => true)
  assert.equal(result.childStopped, true)
  assert.equal(result.healthPointerRemoved, true)
  assert.equal(result.healthEndpointClosed, true)
  assert.equal(result.bridgeEndpointClosed, true)
  fs.unlinkSync(bearerValueFile)
  const output = JSON.stringify(result, null, 2) + '\n'
  for (const secret of secrets) assert.equal(output.includes(secret), false, 'result secret leak')
  fs.writeFileSync(path.join(evidenceRoot, 'supervisor-' + runId + '.json'), output)
  console.log(output)
}
