import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function sidecarProcess(stateDirectory?: string) {
  const state = stateDirectory ?? await mkdtemp(join(tmpdir(), 'plannerbridge-sidecar-test-'))
  const authentication = randomUUID() + randomUUID()
  async function removeOwnedState() {
    if (stateDirectory) return
    const absolute = resolve(state)
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('plannerbridge-sidecar-test-')) throw new Error('Refusing cleanup outside the test-owned temporary directory')
    await rm(absolute, { recursive: true, force: true })
  }
  const child = fork(fileURLToPath(new URL('./fake-sidecar.mjs', import.meta.url)), [], {
    env: { ...process.env, PLANNERBRIDGE_TEST_AUTH: authentication, PLANNERBRIDGE_TEST_STATE: state },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
  })
  const sends: string[] = []
  let diagnostic = ''
  child.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-8_192) })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  child.on('message', value => {
    const message = value as { event?: string; text?: string }
    if (message.event === 'send') sends.push(message.text!)
  })
  const ready = await new Promise<{ endpoint: string; generation: string; pid: number }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Sidecar child startup deadline exceeded')) }, 5_000)
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Sidecar child exited before readiness: ' + diagnostic.replaceAll(authentication, '[redacted]'))) })
    child.on('message', value => {
      const message = value as { event?: string; endpoint: string; generation: string; pid: number }
      if (message.event === 'ready') { clearTimeout(timer); resolve(message) }
    })
  }).catch(async error => { child.kill(); await exited; await removeOwnedState(); throw error })
  return {
    ...ready, authentication, stateDirectory: state, sends,
    async crash() { child.kill(); await exited },
    async close() { child.kill(); await exited; await removeOwnedState() },
  }
}
