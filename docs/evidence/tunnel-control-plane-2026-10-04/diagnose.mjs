import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const mode = process.argv[2] ?? 'direct'
if (!['direct', 'proxy'].includes(mode)) throw new Error('unsupported diagnostic mode')
const env = { ...process.env }
for (const line of fs.readFileSync('C:/Users/jingc/.env', 'utf8').split(/\r?\n/)) {
  const match = /^\s*(CONTROL_PLANE_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
}
if (!env.CONTROL_PLANE_API_KEY || !env.CONTROL_PLANE_TUNNEL_ID) throw new Error('missing credentials')
const secretValues = [env.CONTROL_PLANE_API_KEY, env.CONTROL_PLANE_TUNNEL_ID]
const redact = value => {
  let text = String(value)
  for (const secret of secretValues) text = text.split(secret).join('[REDACTED]')
  return text.replace(/https?:\/\/[^\s"']+/g, '[URL]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').slice(-2000)
}
const healthFile = path.join(root, mode + '.health-url')
try { fs.unlinkSync(healthFile) } catch {}
const args = ['run', '--embedded-mcp-stub', '--control-plane.tunnel-id', env.CONTROL_PLANE_TUNNEL_ID,
  '--health.listen-addr', '127.0.0.1:0', '--health.url-file', healthFile, '--log.level', 'warn', '--log.format', 'json']
if (mode === 'proxy') args.push('--control-plane.http-proxy', 'http://127.0.0.1:7893')
env.LOG_HTTP_RAW_UNSAFE = 'false'
const started = Date.now()
const child = spawn('C:/Users/jingc/Softwares/tunnel-client-v0.0.15-windows-amd64/tunnel-client.exe', args,
  { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-32000) })
child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-32000) })
const result = { mode, started: new Date(started).toISOString(), startupTimeoutMs: 40000, embeddedStub: true,
  productMessages: 0, successful: false, snapshots: [] }
let prior = ''
try {
  while (Date.now() - started < 40000 && child.exitCode === null) {
    if (fs.existsSync(healthFile)) {
      try {
        const url = fs.readFileSync(healthFile, 'utf8').trim()
        const response = await fetch(url + '/health?details=true', { signal: AbortSignal.timeout(1500) })
        const snapshot = await response.json()
        const control = snapshot.components?.['control-plane']
        const facts = { elapsedMs: Date.now() - started, schema: snapshot.schema_version,
          live: snapshot.live, ready: snapshot.ready, controlStatus: control?.status, controlState: control?.state,
          controlDetailKeys: Object.keys(control?.details ?? {}), controlDetails: {},
          localProbeState: snapshot.components?.mcp?.details?.startup_probe?.state }
        for (const key of ['consecutive_failures', 'last_success', 'http_status', 'last_error', 'error', 'last_failure', 'failure_category']) {
          const value = control?.details?.[key]
          if (value !== undefined && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) facts.controlDetails[key] = typeof value === 'string' ? redact(value) : value
        }
        const marker = JSON.stringify({ ...facts, elapsedMs: 0 })
        if (marker !== prior) { result.snapshots.push(facts); prior = marker }
        if (snapshot.schema_version === 1 && snapshot.live === true && snapshot.ready === true && control?.status === 'ok'
          && control.details?.consecutive_failures === 0 && Number.isFinite(Date.parse(control.details?.last_success))
          && facts.localProbeState === 'succeeded') { result.successful = true; break }
      } catch { /* bounded local polling */ }
    }
    await delay(200)
  }
} finally {
  const exited = new Promise(resolve => child.once('exit', resolve))
  if (child.exitCode === null) child.kill()
  await Promise.race([exited, delay(1500)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  result.durationMs = Date.now() - started
  result.childStopped = child.exitCode !== null || child.signalCode !== null
  result.safeLogTail = redact(logs)
  fs.writeFileSync(path.join(root, mode + '.json'), JSON.stringify(result, null, 2) + '\n')
  try { fs.unlinkSync(healthFile) } catch {}
  console.log(JSON.stringify(result, null, 2))
}
