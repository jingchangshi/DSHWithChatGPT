import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Composition fixture only: authenticated transport, no browser or App proof. */
export async function createProfileSidecarFixture(root, serverEntry) {
  const { protectPrivateStateDirectory } = await import(serverEntry)
  const credentialDirectory = path.join(root, 'private-credentials')
  const stateDirectory = path.join(root, 'sidecar-journal')
  await protectPrivateStateDirectory(credentialDirectory, [])
  await protectPrivateStateDirectory(stateDirectory, [])
  const credentialFile = path.join(credentialDirectory, 'authentication.secret')
  await writeFile(credentialFile, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' })
  const child = fork(new URL('../tests/fixtures/profile-sidecar-process.mjs', import.meta.url), [], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      PLANNERBRIDGE_PROFILE_SERVER_ENTRY: serverEntry,
      PLANNERBRIDGE_PROFILE_CREDENTIAL_FILE: credentialFile,
      PLANNERBRIDGE_PROFILE_STATE_DIRECTORY: stateDirectory },
  })
  const exited = new Promise(resolve => child.once('exit', resolve))
  let closing
  const close = () => closing ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    if (child.connected) child.send({ event: 'close' })
    const timer = setTimeout(() => child.kill(), 5000)
    try { await exited } finally { clearTimeout(timer) }
  })()
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Profile Sidecar fixture startup timed out')), 15000)
      const fail = () => { clearTimeout(timer); reject(new Error('Profile Sidecar fixture startup failed')) }
      child.once('error', fail)
      child.once('exit', fail)
      child.once('message', value => {
        clearTimeout(timer)
        if (value?.pid !== child.pid || !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(value?.endpoint ?? '')) fail()
        else resolve(value)
      })
    })
    return { endpoint: ready.endpoint, pid: ready.pid, credentialFile, mode: 'composition-fixture', close }
  } catch (error) { await close(); throw error }
}
