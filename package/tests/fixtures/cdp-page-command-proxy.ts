import { createServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { listCdpTargets } from '../../src/browser/direct-cdp.ts'

/** Wire faults on one disposable fixture target. No user/product target access. */
export async function cdpPageCommandProxy(endpoint: string, targetId: string) {
  const targets = (await listCdpTargets(endpoint)).filter(target => target.id === targetId)
  if (targets.length !== 1) throw new Error('Owned fixture target unavailable')
  const target = targets[0]!
  let fault: { method: string; mode: 'stall' | 'disconnect' | 'reject' } | undefined
  const commands: string[] = []
  const upstreams = new Set<WebSocket>()
  const server = createServer((_request, response) => response.end(JSON.stringify([
    { ...target, webSocketDebuggerUrl: proxyEndpoint.replace('http:', 'ws:') + '/devtools/page/' + targetId },
  ])))
  const sockets = new WebSocketServer({ server, path: '/devtools/page/' + targetId, maxPayload: 1024 * 1024, perMessageDeflate: false })
  sockets.on('connection', client => {
    const upstream = new WebSocket(target.webSocketDebuggerUrl!, { handshakeTimeout: 2000, maxPayload: 1024 * 1024, perMessageDeflate: false })
    upstreams.add(upstream)
    const queue: string[] = []
    client.on('message', raw => {
      const payload = raw.toString(), command = JSON.parse(payload)
      commands.push(command.method)
      if (command.method === fault?.method) {
        if (fault.mode === 'disconnect') client.terminate()
        if (fault.mode === 'reject') client.send(JSON.stringify({ id: command.id, error: { code: -32000, message: 'fixture rejected' } }))
        return // Command was written by the client, but receives no response in stall mode.
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(payload)
      else if (queue.length < 64) queue.push(payload)
      else client.terminate()
    })
    upstream.on('open', () => { for (const payload of queue) upstream.send(payload); queue.length = 0 })
    upstream.on('message', raw => { if (client.readyState === WebSocket.OPEN) client.send(raw.toString()) })
    upstream.on('error', () => client.terminate())
    client.on('error', () => upstream.terminate())
    client.on('close', () => { upstream.terminate(); upstreams.delete(upstream) })
    upstream.on('close', () => client.terminate())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const proxyEndpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    endpoint: proxyEndpoint, commands,
    fault(method: string, mode: 'stall' | 'disconnect' | 'reject' = 'stall') { fault = { method, mode } },
    clearFault() { fault = undefined },
    async close() {
      for (const client of sockets.clients) client.terminate()
      for (const upstream of upstreams) upstream.terminate()
      await new Promise<void>(resolve => sockets.close(() => resolve()))
      await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
    },
  }
}
