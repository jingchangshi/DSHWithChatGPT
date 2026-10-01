import { createServer } from 'node:http'
import { expect, it } from 'vitest'

it.each(['http://localhost:9222', 'http://0.0.0.0:9222', 'http://127.1:9222', 'http://2130706433:9222', 'https://127.0.0.1:9222', 'http://user@127.0.0.1:9222', 'http://127.0.0.1:9222/?x=1', 'http://127.0.0.1:9222#fragment', 'http://127.0.0.1:0', 'http://127.0.0.1:65536'])('rejects non-canonical endpoint before discovery: %s', async endpoint => {
  const { listCdpTargets } = await import('../src/browser/direct-cdp.ts')
  await expect(listCdpTargets(endpoint)).rejects.toThrow('CDP endpoint')
})

it.each(['remote', 'port', 'target', 'credentials', 'query', 'browser', 'duplicate', 'redirect'] as const)('rejects unowned discovery: %s', async fault => {
  const { DirectCdpPrimitives } = await import('../src/browser/direct-cdp.ts')
  const server = createServer((_req, res) => {
    if (fault === 'redirect') { res.writeHead(302, { Location: 'http://example.test/' }); res.end(); return }
    const address = server.address() as { port: number }
    let url = `ws://127.0.0.1:${address.port}/devtools/page/owned`
    if (fault === 'remote') url = 'ws://example.test/devtools/page/owned'
    if (fault === 'port') url = 'ws://127.0.0.1:1/devtools/page/owned'
    if (fault === 'target') url = `ws://127.0.0.1:${address.port}/devtools/page/other`
    if (fault === 'credentials') url = `ws://user@127.0.0.1:${address.port}/devtools/page/owned`
    if (fault === 'query') url += '?secret=x'
    if (fault === 'browser') url = `ws://127.0.0.1:${address.port}/devtools/browser/owned`
    const target = { id: 'owned', type: 'page', url: 'https://example.test/', webSocketDebuggerUrl: url }
    res.end(JSON.stringify(fault === 'duplicate' ? [target, target] : [target]))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await expect(DirectCdpPrimitives.connect({ endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, targetId: 'owned', commandTimeoutMs: 100 })).rejects.toThrow()
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
