import { createServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { listCdpTargets } from '../../src/browser/direct-cdp.ts'

/** Task-owned wire fault over a real Chrome target: input is delivered but its
 * ack is lost. This proves uncertainty may accompany an actual page mutation. */
export async function cdpInputAckProxy(endpoint: string, targetId: string, options: { dropAck?: boolean; onInput?: () => void } = {}) {
  const targets = (await listCdpTargets(endpoint)).filter(target => target.id === targetId)
  if (targets.length !== 1 || targets[0]!.webSocketDebuggerUrl !== endpoint.replace('http:', 'ws:') + '/devtools/page/' + targetId) throw new Error('Owned proxy target unavailable')
  const target = targets[0]!
  const commands: string[] = []
  const upstreams = new Set<WebSocket>()
  const server = createServer((_request, response) => {
    response.end(JSON.stringify([{ ...target, webSocketDebuggerUrl: proxyEndpoint.replace('http:', 'ws:') + '/devtools/page/' + targetId }]))
  })
  const sockets = new WebSocketServer({ server, path: '/devtools/page/' + targetId, maxPayload: 1024 * 1024, perMessageDeflate: false })
  sockets.on('connection', client => {
    const upstream = new WebSocket(target.webSocketDebuggerUrl!, { handshakeTimeout: 2000, maxPayload: 1024 * 1024, perMessageDeflate: false })
    upstreams.add(upstream)
    const queue: string[] = []
    const dropped = new Set<number>()
    client.on('message', raw => {
      const payload = raw.toString()
      const command = JSON.parse(payload)
      if (command.method.startsWith('Input.')) { commands.push(command.method); if (options.dropAck !== false) dropped.add(command.id); options.onInput?.() }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(payload)
      else if (queue.length < 64) queue.push(payload)
      else client.terminate()
    })
    upstream.on('open', () => { for (const payload of queue) upstream.send(payload); queue.length = 0 })
    upstream.on('message', raw => {
      const payload = raw.toString()
      const message = JSON.parse(payload)
      if (dropped.has(message.id)) return
      if (client.readyState === WebSocket.OPEN) client.send(payload)
    })
    upstream.on('error', () => client.terminate())
    client.on('error', () => upstream.terminate())
    client.on('close', () => { upstream.terminate(); upstreams.delete(upstream) })
    upstream.on('close', () => client.terminate())
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const proxyEndpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    endpoint: proxyEndpoint, commands,
    async close() {
      for (const client of sockets.clients) client.terminate()
      for (const upstream of upstreams) upstream.terminate()
      await new Promise<void>(resolve => sockets.close(() => resolve()))
      await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
    },
  }
}
