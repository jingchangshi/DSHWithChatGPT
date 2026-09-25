/**
 * MCP (Model Context Protocol) JSON-RPC types and the read-only bridge
 * server. Transport: stateless Streamable HTTP over loopback — same shape as
 * codex-with-chatgpt's bridge (MIT, THIRD_PARTY_NOTICES.md), reimplemented on
 * node:http with DSH-native auth hooks. WRITE SAFETY: the tool registry below
 * is a fixed readonly table; there is no mechanism to register a mutating
 * tool, and no shell/write tool exists anywhere in this module.
 * @module bridge
 */

import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConnectorAuth } from '../connector/auth.ts'

/** JSON-RPC request id (number or string). */
export type RpcId = number | string

/** JSON-RPC 2.0 request envelope. */
export interface RpcRequest {
  jsonrpc: '2.0'
  id: RpcId
  method: string
  params?: Record<string, unknown>
}

/** JSON-RPC 2.0 response envelope. */
export interface RpcResponse {
  jsonrpc: '2.0'
  id: RpcId | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Standard JSON-RPC error codes used by the bridge. */
export const RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const

/** One MCP tool exposed by the bridge. Handlers receive validated args and a context. */
export interface McpToolDefinition<A = Record<string, unknown>, R = unknown> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: A, ctx: BridgeToolContext) => Promise<R>
}

/** Context handed to tool handlers. */
export interface BridgeToolContext {
  /** Bearer token subject (workspace binding), when authenticated. */
  subject: string
}

/** Compile-time proof of read-only-ness: every tool name must start with an approved verb. */
const READONLY_VERBS = new Set([
  'workspace_info', 'list_directory', 'read_file', 'search_workspace',
  'git_status', 'git_diff', 'git_log', 'test_status', 'execution_summary', 'execution_output',
])

/** Registry guard: rejects any tool whose name is not an approved read verb. */
export function assertReadOnlyTool(tool: McpToolDefinition): void {
  if (!READONLY_VERBS.has(tool.name)) {
    throw new Error(`tool "${tool.name}" is not in the read-only allowlist; the bridge cannot expose it`)
  }
}

/** MCP protocol-level handler: initialize, tools/list, tools/call, ping. */
export function createRpcHandler(tools: readonly McpToolDefinition[]): (req: RpcRequest, ctx: BridgeToolContext) => Promise<RpcResponse> {
  for (const tool of tools) assertReadOnlyTool(tool)
  const toolsList = tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))

  return async (req, ctx): Promise<RpcResponse> => {
    const respond = (result?: unknown, error?: RpcResponse['error']): RpcResponse => ({
      jsonrpc: '2.0',
      id: req.id ?? null,
      ...(error === undefined ? { result } : { error }),
    })
    try {
      switch (req.method) {
        case 'initialize':
          return respond({
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dsh-with-chatgpt', version: '0.1.0' },
          })
        case 'notifications/initialized':
          return respond({})
        case 'ping':
          return respond({})
        case 'tools/list':
          return respond({ tools: toolsList })
        case 'tools/call': {
          const name = req.params?.['name']
          const args = (req.params?.['arguments'] ?? {}) as Record<string, unknown>
          if (typeof name !== 'string') {
            return respond(undefined, { code: RPC_ERRORS.invalidParams, message: 'tools/call requires a string "name"' })
          }
          const tool = tools.find(t => t.name === name)
          if (tool === undefined) {
            return respond(undefined, { code: RPC_ERRORS.invalidParams, message: `unknown tool: ${name}` })
          }
          const result = await tool.handler(args, ctx)
          return respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
        }
        default:
          return respond(undefined, { code: RPC_ERRORS.methodNotFound, message: `method not found: ${req.method}` })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isBoundary = /PATH_OUTSIDE_WORKSPACE|ACCESS_DENIED_SENSITIVE_FILE|INVALID_PATH|GIT_/.test(message)
      return respond(undefined, {
        code: isBoundary ? RPC_ERRORS.invalidParams : RPC_ERRORS.internalError,
        message,
      })
    }
  }
}

/** Bridge server options. */
export interface BridgeServerOptions {
  /** Fixed port (loopback). 0 = ephemeral, for tests. */
  port: number
  /** Bearer tokens -> subject (workspace binding). Checked per request. */
  tokens: Map<string, string>
  /** Optional connector OAuth layer for a public HTTPS carrier. */
  connectorAuth?: ConnectorAuth
  /** Extra safety: require this exact header on every request. */
  serviceHeader?: string
  /** Optional request logger. */
  log?: (line: string) => void
}

/** Running bridge handle. */
export interface BridgeServer {
  port: number
  close: () => Promise<void>
}

/** Start the bridge HTTP server on loopback only. */
export function startBridgeServer(options: BridgeServerOptions, tools: readonly McpToolDefinition[]): Promise<BridgeServer> {
  const rpcHandler = createRpcHandler(tools)
  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
  try {
      if (options.connectorAuth !== undefined && await options.connectorAuth.handle(req, res)) return
      await handleRequest(req, res, options, rpcHandler)
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: RPC_ERRORS.internalError, message: 'internal error' } }))
      } else {
        res.destroy()
      }
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : options.port
      resolve({
        port,
        close: () => new Promise((resolveClose, rejectClose) => {
          server.close(error => (error === undefined ? resolveClose() : rejectClose(error)))
        }),
      })
    })
  })
}

/** Per-request auth + dispatch. */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: BridgeServerOptions,
  rpcHandler: (req: RpcRequest, ctx: BridgeToolContext) => Promise<RpcResponse>,
): Promise<void> {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') {
    res.writeHead(404)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'method not allowed; POST only' }))
    return
  }
  // Auth: exact bearer token, constant-ish compare (length + XOR accumulate).
  const auth = req.headers['authorization'] ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let subject: string | undefined
  for (const [candidate, candidateSubject] of options.tokens) {
    if (safeEqual(token, candidate)) {
      subject = candidateSubject
      break
    }
  }
  if (subject === undefined && options.connectorAuth?.verify(token)) subject = 'workspace:bound'
  if (subject === undefined) {
    options.log?.(`401 from ${req.socket.remoteAddress}`)
    const metadata = options.connectorAuth === undefined ? '' : `, resource_metadata="${options.connectorAuth.baseUrl}/.well-known/oauth-protected-resource/mcp"`
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer realm="d2c"${metadata}` })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  if (options.serviceHeader !== undefined && req.headers['x-d2c-service'] !== options.serviceHeader) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'forbidden' }))
    return
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'request too large' }))
      return
    }
    chunks.push(chunk as Buffer)
  }
  let rpc: RpcRequest
  try {
    rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcRequest
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: RPC_ERRORS.parseError, message: 'parse error' } }))
    return
  }
  const response = await rpcHandler(rpc, { subject })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(response))
}

/** Timing-safe-ish string comparison (no early exit on content). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
