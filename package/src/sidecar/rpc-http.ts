import { request } from 'node:http'
import { SidecarRpcError } from './errors.ts'
import { SIDECAR_MAX_REPLY_BYTES } from './protocol.ts'

/** Literal-loopback transport: the caller's signal owns the entire HTTP lifetime. */
export function postRpc(endpoint: string, authentication: string, body: string, signal: AbortSignal): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(endpoint, {
      method: 'POST', agent: false, signal,
      headers: { authorization: 'Bearer ' + authentication, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, incoming => {
      // Never follow redirects or forward authentication outside this endpoint.
      if (incoming.statusCode! >= 300 && incoming.statusCode! < 400) {
        reject(new Error('RPC redirect refused')); incoming.destroy(); return
      }
      if (Number(incoming.headers['content-length']) > SIDECAR_MAX_REPLY_BYTES) {
        reject(new SidecarRpcError('SIDECAR_RESPONSE_TOO_LARGE')); incoming.destroy(); return
      }
      const chunks: Buffer[] = []
      let length = 0
      incoming.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > SIDECAR_MAX_REPLY_BYTES) {
          reject(new SidecarRpcError('SIDECAR_RESPONSE_TOO_LARGE')); incoming.destroy(); return
        }
        chunks.push(chunk)
      })
      incoming.on('error', reject)
      incoming.on('end', () => resolve({ status: incoming.statusCode!, body: Buffer.concat(chunks, length) }))
    })
    outgoing.on('error', reject)
    // No socket-idle/header timer may shorten the explicit operation budget.
    outgoing.setTimeout(0)
    outgoing.end(body)
  })
}
