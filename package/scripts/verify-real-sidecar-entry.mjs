import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Run against the unpacked package directory, optionally an isolated install.
// All deployment references must be supplied; this verifier never picks a tab.
const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)))
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const entry = path.join(root, manifest.bin['chat-control-sidecar'])
const { readSidecarCredential } = await import(pathToFileURL(path.join(root, 'lib/deployment/sidecar-credential.js')))
const { SidecarChatControlClient } = await import(pathToFileURL(path.join(root, 'lib/sidecar/client.js')))
const references = ['PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE', 'PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY', 'PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS', 'PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT', 'PLANNERBRIDGE_SIDECAR_TARGET_ID', 'PLANNERBRIDGE_SIDECAR_PORT', 'PLANNERBRIDGE_SIDECAR_APP_NAME']
for (const name of references.slice(0, 5)) assert.ok(process.env[name], name + ' required')
const authentication = await readSidecarCredential(process.env.PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE, JSON.parse(process.env.PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS))
const env = Object.fromEntries(['SystemRoot', 'TEMP', 'TMP', ...references].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]))
const child = spawn(process.execPath, [entry], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = new Promise(resolve => child.once('close', resolve))
try {
  const ready = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Canonical Sidecar startup timed out')), 15000)
    const fail = () => { clearTimeout(timer); reject(new Error('Canonical Sidecar startup failed')) }
    child.once('error', fail)
    child.once('close', fail)
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (output.length > 4096) return fail()
      if (!output.includes('\n')) return
      clearTimeout(timer)
      try { resolve(JSON.parse(output.trim())) } catch { fail() }
    })
  })
  assert.equal(ready.event, 'ready')
  assert.equal(ready.pid, child.pid)
  assert.match(ready.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/$/)
  const client = new SidecarChatControlClient({ endpoint: ready.endpoint, authentication })
  assert.equal((await client.health()).ok, true)
  const readiness = await client.readiness()
  assert.ok(readiness.composer && !readiness.loggedOut)
  console.log(JSON.stringify({ mode: 'canonical-real-direct-cdp', pid: child.pid, authenticatedHealth: true, browserReady: true, appDataPlaneVerified: false }))
  const response = await fetch(ready.endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + authentication, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, requestId: 'owned-stop', operationId: 'owned-stop', generation: ready.generation, method: 'shutdown', params: {} }) })
  assert.equal(response.ok, true)
  const timer = setTimeout(() => child.kill(), 5000)
  try { assert.equal(await exited, 0) } finally { clearTimeout(timer) }
  await assert.rejects(client.health())
  console.log('Canonical real entry shutdown and transport closure verified; App/planner acceptance NOT_RUN')
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill()
    await exited
  }
}
