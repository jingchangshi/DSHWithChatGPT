import { isAbsolute } from 'node:path'
import { DirectCdpPrimitives } from '../browser/direct-cdp.ts'
import { ChatGptWebDriver } from '../browser/chatgpt-web-driver.ts'
import { startSidecar } from '../sidecar/server.ts'
import { readSidecarCredential } from './sidecar-credential.ts'
import { protectPrivateStateDirectory } from './private-state.ts'

export interface DirectSidecarConfig {
  credentialFile: string
  stateDirectory: string
  excludedRoots: readonly string[]
  cdpEndpoint: string
  targetId: string
  appName: string
  port: number
}

/** Deployment-owned composition. No browser discovery, workspace lease or shell. */
export async function startDirectSidecar(config: DirectSidecarConfig) {
  if (!isAbsolute(config.credentialFile) || !isAbsolute(config.stateDirectory)
    || !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.test(config.cdpEndpoint)
    || Number(new URL(config.cdpEndpoint).port) > 65535
    || !/^[A-Za-z0-9_-]{1,128}$/.test(config.targetId)
    || !config.appName || config.appName.trim() !== config.appName || config.appName.length > 256
    || !Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('SIDECAR_DEPLOYMENT_INVALID')
  const authentication = await readSidecarCredential(config.credentialFile, config.excludedRoots)
  await protectPrivateStateDirectory(config.stateDirectory, config.excludedRoots)
  const primitives = await DirectCdpPrimitives.connect({ endpoint: config.cdpEndpoint, targetId: config.targetId })
  try {
    const page = await primitives.pageInfo()
    if (!page.url || new URL(page.url).origin !== 'https://chatgpt.com') throw new Error('SIDECAR_PRODUCT_TARGET_REQUIRED')
    const driver = new ChatGptWebDriver(primitives, config.appName)
    const server = await startSidecar({ host: '127.0.0.1', port: config.port, authentication, stateDirectory: config.stateDirectory, driver, configuredAppName: config.appName })
    const closed = server.closed.then(() => { primitives.close() })
    return { endpoint: server.endpoint, generation: server.generation, closed, close: async () => { await server.close(); await closed } }
  } catch (error) { primitives.close(); throw error }
}
