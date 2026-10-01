import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function sidecarProcess(stateDirectory?: string, options: { protect?: boolean; pausePhase?: string; recoveryView?: 'exact' | 'missing' | 'foreign' | 'changed-reply'; bootstrap?: boolean } = {}) {
  const state = stateDirectory ?? await mkdtemp(join(tmpdir(), 'plannerbridge-sidecar-test-'))
  const authentication = randomUUID() + randomUUID()
  async function removeOwnedState() {
    if (stateDirectory) return
    const absolute = resolve(state)
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('plannerbridge-sidecar-test-')) throw new Error('Refusing cleanup outside the test-owned temporary directory')
    await rm(absolute, { recursive: true, force: true })
  }
  const child = fork(fileURLToPath(new URL('./fake-sidecar.mjs', import.meta.url)), [], {
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PLANNERBRIDGE_TEST_AUTH: authentication, PLANNERBRIDGE_TEST_STATE: state, PLANNERBRIDGE_TEST_PROTECT_STATE: options.protect === false ? 'false' : 'true', PLANNERBRIDGE_TEST_PAUSE_PHASE: options.pausePhase, PLANNERBRIDGE_TEST_RECOVERY_VIEW: options.recoveryView, PLANNERBRIDGE_TEST_BOOTSTRAP: options.bootstrap ? 'true' : 'false' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
  })
  const sends: string[] = []
  const phases: { operationId: string; phase: string }[] = []
  let diagnostic = ''
  child.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-8_192) })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  child.on('message', value => {
    const message = value as { event?: string; text?: string; operationId: string; phase: string }
    if (message.event === 'send') sends.push(message.text!)
    if (message.event === 'phase') phases.push({ operationId: message.operationId, phase: message.phase })
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
    ...ready, authentication, stateDirectory: state, sends, phases,
    async waitForPhase(operationId: string, phase: string) {
      if (phases.some(entry => entry.operationId === operationId && entry.phase === phase)) return
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { child.off('message', observed); reject(new Error('Expected delivery phase not observed: ' + phase)) }, 2_000)
        function observed(value: unknown) { const message = value as { event?: string; operationId?: string; phase?: string }; if (message.event === 'phase' && message.operationId === operationId && message.phase === phase) { clearTimeout(timer); child.off('message', observed); resolve() } }
        child.on('message', observed)
      })
    },
    resume(operationId: string) { child.send({ event: 'resume', operationId }) },
    async crash() { child.kill(); await exited },
    async close() { child.kill(); await exited; await removeOwnedState() },
  }
}
