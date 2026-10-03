import { DirectCdpPrimitives } from '../../lib/browser/direct-cdp.js'
import { ChatGptWebDriver } from '../../lib/browser/chatgpt-web-driver.js'
import { startSidecar, protectPrivateStateDirectory } from '../../lib/sidecar/server.js'

// Separate native process using the actual compiled composition. Synthetic page
// only; no real App/login, recovery or product acceptance evidence is claimed.
const primitives = await DirectCdpPrimitives.connect({ endpoint: process.env.PLANNERBRIDGE_TEST_CDP, targetId: process.env.PLANNERBRIDGE_TEST_TARGET, commandTimeoutMs: 300 })
const driver = new ChatGptWebDriver(primitives, '')
for (const method of ['sendControlMessage', 'waitForReply']) {
  const original = driver[method].bind(driver)
  driver[method] = (...args) => { process.send?.({ event: 'invoked', method }); return original(...args) }
}
await protectPrivateStateDirectory(process.env.PLANNERBRIDGE_TEST_STATE, [])
const server = await startSidecar({ host: '127.0.0.1', port: 0, authentication: process.env.PLANNERBRIDGE_TEST_AUTH,
  stateDirectory: process.env.PLANNERBRIDGE_TEST_STATE, driver,
  onDeliveryPhase: entry => { process.send?.({ event: 'phase', operationId: entry.operationId, phase: entry.phase }) },
})
process.send?.({ event: 'ready', endpoint: server.endpoint, pid: process.pid })
process.on('message', message => { if (message?.event === 'close') void server.close() })
await server.closed
primitives.close()
process.disconnect()
