import { appendFile } from 'node:fs/promises'
import { DirectCdpPrimitives } from '../../lib/browser/direct-cdp.js'
import { ChatGptWebDriver } from '../../lib/browser/chatgpt-web-driver.js'
import { startSidecar } from '../../lib/sidecar/server.js'
import { readSidecarCredential } from '../../lib/deployment/sidecar-credential.js'
import { protectPrivateStateDirectory } from '../../lib/deployment/private-state.js'
const env = process.env
const excludedRoots = JSON.parse(env.PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS)
const authentication = await readSidecarCredential(env.PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE, excludedRoots)
await protectPrivateStateDirectory(env.PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY, excludedRoots)
const primitives = await DirectCdpPrimitives.connect({ endpoint: env.PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT, targetId: env.PLANNERBRIDGE_SIDECAR_TARGET_ID })
const driver = new ChatGptWebDriver(primitives, env.PLANNERBRIDGE_SIDECAR_APP_NAME)
const emit = value => appendFile(env.PLANNERBRIDGE_TEST_PHASE_TELEMETRY, JSON.stringify({ pid: process.pid, ...value }) + '\n')
for (const method of ['sendControlMessage', 'waitForReply']) {
  const original = driver[method].bind(driver)
  driver[method] = async (...args) => { await emit({ kind: 'invoke', method, operationId: args[2]?.operationId }); return original(...args) }
}
const server = await startSidecar({ host: '127.0.0.1', port: Number(env.PLANNERBRIDGE_SIDECAR_PORT), authentication,
  stateDirectory: env.PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY, driver, configuredAppName: env.PLANNERBRIDGE_SIDECAR_APP_NAME,
  onDeliveryPhase: entry => emit({ kind: 'phase', operationId: entry.operationId, method: entry.method, phase: entry.phase }),
})
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void server.close() })
await server.closed
primitives.close()
