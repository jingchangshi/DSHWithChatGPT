/** Lifecycle-owned Cloudflare named tunnel for the loopback connector server. */
import { spawn, type ChildProcess } from 'node:child_process'

/** Start a previously provisioned named tunnel and wait for a connection. */
export function startNamedTunnel(name: string, port: number): Promise<{ close: () => void }> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) throw new Error('invalid named tunnel')
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn('cloudflared', [
      'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`, 'run', name,
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let settled = false
    const timer = setTimeout(() => finish(new Error('named connector tunnel did not connect')), 45_000)
    function finish(error?: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error !== undefined) { child.kill(); reject(error) }
      else resolve({ close: () => { child.kill() } })
    }
    child.once('error', error => finish(error))
    child.once('exit', code => finish(new Error(`named connector tunnel exited (${code ?? 'signal'})`)))
    child.stderr?.on('data', (chunk: Buffer) => {
      if (/registered tunnel connection/i.test(chunk.toString('utf8'))) finish()
    })
  })
}
