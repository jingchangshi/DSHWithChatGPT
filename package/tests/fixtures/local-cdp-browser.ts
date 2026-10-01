import { createServer } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import { listCdpTargets } from '../../src/browser/direct-cdp.ts'

const html = `<!doctype html><meta charset="utf-8"><title>Owned CDP fixture</title>
<textarea id="edit" style="width:300px;height:80px"></textarea><button id="button">Click</button>
<div id="result"></div><script>
window.events = [];
for (const name of ['focus', 'input', 'keydown', 'keyup', 'click']) document.addEventListener(name, event => {
  window.events.push({ name, key: event.key, target: event.target.id, value: event.target.value });
}, true);
document.querySelector('#button').onclick = () => document.querySelector('#result').textContent = 'clicked';
</script>`

/** Owns one disposable process/profile/server. Never discovers user profiles or
 * touches the dedicated product browser. Browser.close targets this process only. */
export async function localCdpBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'plannerbridge-cdp-test-'))
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(html.replace('Owned CDP fixture', req.url === '/second' ? 'Replacement CDP fixture' : 'Owned CDP fixture'))
  })
  let child: ChildProcess | undefined
  let endpoint = ''
  let browserPath = ''
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    if (endpoint && browserPath && child?.exitCode === null) {
      const socket = new WebSocket(endpoint.replace('http:', 'ws:') + browserPath, { handshakeTimeout: 2000, perMessageDeflate: false })
      await new Promise<void>(resolve => {
        const timer = setTimeout(done, 2500)
        function done() { clearTimeout(timer); socket.on('error', () => {}); socket.terminate(); resolve() }
        socket.on('error', done); socket.on('close', done)
        socket.on('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })))
      })
    }
    for (let count = 0; child?.exitCode === null && count < 40; count++) await delay(50)
    if (child?.exitCode === null) { child.kill(); await new Promise<void>(resolve => { child!.once('exit', () => resolve()); setTimeout(resolve, 2000).unref() }) }
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
    // This is the exact directory returned by mkdtemp, never a discovered profile.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const candidates = [process.env.PLANNERBRIDGE_TEST_CHROME, join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe')].filter((value): value is string => !!value)
    let executable: string | undefined
    for (const path of candidates) { try { await access(path); executable = path; break } catch {} }
    if (!executable) throw new Error('Real local Chrome fixture requires an installed Chrome executable')
    child = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, baseUrl + '/input'], { windowsHide: true, stdio: 'ignore' })
    let spawnError: Error | undefined
    child.on('error', error => { spawnError = error })
    const until = Date.now() + 10_000
    while (!endpoint && Date.now() < until) {
      if (spawnError || child.exitCode !== null) throw spawnError ?? new Error('Owned Chrome exited during startup')
      try {
        const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
        if (/^[1-9][0-9]{0,4}$/.test(port ?? '') && Number(port) <= 65535 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(path ?? '')) { endpoint = 'http://127.0.0.1:' + port; browserPath = path! }
      } catch {}
      if (!endpoint) await delay(50)
    }
    if (!endpoint) throw new Error('Owned Chrome debugger startup deadline exceeded')
    let targetId = ''
    while (!targetId && Date.now() < until) {
      const targets = (await listCdpTargets(endpoint)).filter(target => target.type === 'page' && target.url === baseUrl + '/input')
      if (targets.length > 1) throw new Error('Owned Chrome fixture target ambiguous')
      if (targets.length === 1) targetId = targets[0]!.id
      else await delay(50)
    }
    if (!targetId) throw new Error('Owned Chrome fixture page missing')
    return { endpoint, targetId, baseUrl, profile, close }
  } catch (error) { await close(); throw error }
}
