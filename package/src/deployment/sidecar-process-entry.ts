#!/usr/bin/env node
import { startDirectSidecar } from './direct-sidecar.ts'

// References/configuration only. Authentication is resolved through the private
// production reader; no secret, browser mechanics or workspace tools are RPCs.
try {
  const excludedRoots: unknown = JSON.parse(process.env.PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS ?? 'null')
  if (!Array.isArray(excludedRoots) || excludedRoots.some(root => typeof root !== 'string')) throw new Error('invalid exclusions')
  const server = await startDirectSidecar({
    credentialFile: process.env.PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE ?? '',
    stateDirectory: process.env.PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY ?? '',
    excludedRoots,
    cdpEndpoint: process.env.PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT ?? '',
    targetId: process.env.PLANNERBRIDGE_SIDECAR_TARGET_ID ?? '',
    appName: process.env.PLANNERBRIDGE_SIDECAR_APP_NAME ?? 'DSH with ChatGPT',
    port: Number(process.env.PLANNERBRIDGE_SIDECAR_PORT ?? '18765'),
  })
  console.log(JSON.stringify({ event: 'ready', pid: process.pid, endpoint: server.endpoint, generation: server.generation }))
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void server.close().catch(() => { process.exitCode = 1 }) })
  await server.closed
} catch {
  // Never forward filesystem/browser/provider errors or environment contents.
  console.error('SIDECAR_START_FAILED')
  process.exitCode = 1
}
