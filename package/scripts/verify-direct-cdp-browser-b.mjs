import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DirectCdpPrimitives, listCdpTargets, ChatGptWebDriver } from '../lib/browser/index.js'

// Standalone, explicit readiness gate. No Input or Planner message is sent.
async function main() {
assert.equal(process.platform, 'win32', 'Browser B gate requires the actual Windows deployment')
const endpoint = 'http://127.0.0.1:9222'
const profile = path.join(process.env.LOCALAPPDATA, 'DSHWithChatGPT', 'chrome-product')
const inspection = spawnSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 9222 -ErrorAction SilentlyContinue)
$owned = $false
if ($listeners.Count -eq 1 -and $listeners[0].LocalAddress -eq '127.0.0.1') {
  $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listeners[0].OwningProcess)
  $quote = [char]34
  $escapedProfile = [regex]::Escape($env:PLANNERBRIDGE_SMOKE_PROFILE)
  $profilePattern = '(?:' + $quote + '--user-data-dir=' + $escapedProfile + $quote + '|--user-data-dir=' + $quote + '?' + $escapedProfile + $quote + '?)(?=\\s|$)'
  $owned = $processInfo.Name -eq 'chrome.exe' -and $processInfo.CommandLine -match $profilePattern -and $processInfo.CommandLine -match '--remote-debugging-port=9222(?=\\s|$)'
}
@{ dedicatedProfileVerified = [bool]$owned; loopbackListenerVerified = [bool]($listeners.Count -eq 1 -and $listeners[0].LocalAddress -eq '127.0.0.1') } | ConvertTo-Json -Compress
`], { windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, env: { ...process.env, PLANNERBRIDGE_SMOKE_PROFILE: profile } })
assert.equal(inspection.status, 0, 'Browser B process ownership inspection failed')
const ownership = JSON.parse(inspection.stdout)
assert.equal(ownership.dedicatedProfileVerified, true, 'Dedicated Browser B profile/listener is not available')
assert.equal(ownership.loopbackListenerVerified, true, 'Browser B listener is not exclusively loopback')
console.log('REAL_BROWSER_B_READY_ONLY: dedicated profile and loopback listener VERIFIED')

async function request(route, method = 'GET') {
  const response = await fetch(endpoint + route, { method, redirect: 'error', signal: AbortSignal.timeout(5000) })
  assert.equal(response.ok, true, 'Browser B debugger request failed')
  return response
}
const version = await (await request('/json/version')).json()
assert.match(version.Browser, /^Chrome\//)
const before = new Set((await listCdpTargets(endpoint)).map(target => target.id))
let ownedId
let browser
let success = false
try {
  const target = await (await request('/json/new?about:blank', 'PUT')).json()
  assert.match(target.id, /^[A-Za-z0-9_-]{1,128}$/)
  assert.equal(before.has(target.id), false, 'New smoke target must be exclusively task-owned')
  ownedId = target.id
  browser = await DirectCdpPrimitives.connect({ endpoint, targetId: ownedId, commandTimeoutMs: 5000 })
  await browser.navigate('https://chatgpt.com/')
  await browser.waitForLoad(60_000)
  const identity = await browser.currentTarget()
  assert.equal(identity.targetId, ownedId)
  assert.ok(identity.documentId)
  assert.equal(new URL(identity.url).origin, 'https://chatgpt.com')
  const driver = new ChatGptWebDriver(browser, '')
  assert.equal((await driver.health()).ok, true)
  await driver.ensureReady()
  const readiness = await driver.readiness()
  assert.equal(readiness.composer, true, 'Browser B composer is missing')
  assert.equal(readiness.loggedOut, false, 'Browser B login is required')
  console.log('REAL_BROWSER_B_READY_ONLY: explicit owned target/document, real ChatGPT URL, health, composer, loggedOut=false VERIFIED')
  success = true
} finally {
  browser?.close()
  if (ownedId) await (await request('/json/close/' + ownedId)).text()
  let after = new Set((await listCdpTargets(endpoint)).map(target => target.id))
  const closeDeadline = Date.now() + 5000
  while (ownedId && after.has(ownedId) && Date.now() < closeDeadline) {
    await delay(50)
    after = new Set((await listCdpTargets(endpoint)).map(target => target.id))
  }
  for (const id of before) assert.ok(after.has(id), 'A pre-existing Browser B target disappeared')
  if (ownedId) assert.equal(after.has(ownedId), false, 'Owned smoke target was not closed')
  console.log('REAL_BROWSER_B_READY_ONLY: all pre-existing targets preserved; owned smoke target closed')
}
assert.equal(success, true)
console.log('REAL_BROWSER_B_READY_ONLY: PASS; Planner reply, App data-plane and DSH E2E remain NOT_RUN')
}
try { await main() }
catch (error) { console.error(error.name + ': ' + error.message); process.exitCode = 1 }
