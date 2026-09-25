/** OAuth authorization for one workspace's read-only ChatGPT connector. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const scopes = ['workspace.read', 'workspace.search', 'git.read', 'execution.read', 'offline_access']
const random = (): string => randomBytes(32).toString('base64url')
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const challenge = (value: string): string => createHash('sha256').update(value).digest('base64url')
const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

interface Client { id: string; redirects: string[] }
interface Token { hash: string; kind: 'access' | 'refresh'; clientId: string; expiresAt: number; scope: string }
interface Stored { clients: Client[]; tokens: Token[] }
interface Request { clientId: string; redirect: string; state: string; codeChallenge: string; scope: string; expiresAt: number }
interface Code extends Request { expiresAt: number }

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function redirectAllowed(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' && url.hostname === 'chatgpt.com' && url.pathname.startsWith('/connector/oauth/'))
      || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
  } catch {
    return false
  }
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += (chunk as Buffer).length
    if (bytes > 16_384) throw new Error('request too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** One workspace's client registration, consent, and token lifecycle. */
export class ConnectorAuth {
  private readonly clients = new Map<string, Client>()
  private readonly tokens = new Map<string, Token>()
  private readonly requests = new Map<string, Request>()
  private readonly codes = new Map<string, Code>()
  private pairingHash: string | null = null
  private pairingExpiresAt = 0
  private pairingAttempts = 0

  constructor(readonly baseUrl: string, readonly file: string) {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error('connector baseUrl must be an HTTPS origin')
    if (existsSync(file)) {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Stored
      for (const client of stored.clients ?? []) this.clients.set(client.id, client)
      for (const token of stored.tokens ?? []) if (token.expiresAt > Date.now()) this.tokens.set(token.hash, token)
    }
  }

  /** Generate a short-lived, single-use code shown only by explicit setup. */
  newPairingCode(): string {
    const code = randomBytes(8).toString('hex').toUpperCase()
    this.pairingHash = hash(code)
    this.pairingExpiresAt = Date.now() + 10 * 60_000
    this.pairingAttempts = 0
    return code
  }

  get pairingPending(): boolean { return this.pairingHash !== null && Date.now() < this.pairingExpiresAt }
  get authorized(): boolean { return [...this.tokens.values()].some(t => t.kind === 'refresh' && t.expiresAt > Date.now()) }

  /** Resolve a current access token to this auth instance's workspace. */
  verify(token: string): boolean {
    const found = this.tokens.get(hash(token))
    return found?.kind === 'access' && found.expiresAt > Date.now()
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const data: Stored = { clients: [...this.clients.values()], tokens: [...this.tokens.values()].filter(t => t.expiresAt > Date.now()) }
    const temp = this.file + '.tmp'
    writeFileSync(temp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.file)
  }

  private issue(clientId: string, scope: string): { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string } {
    const access_token = 'd2c_a_' + random()
    const refresh_token = 'd2c_r_' + random()
    this.tokens.set(hash(access_token), { hash: hash(access_token), kind: 'access', clientId, scope, expiresAt: Date.now() + 60 * 60_000 })
    this.tokens.set(hash(refresh_token), { hash: hash(refresh_token), kind: 'refresh', clientId, scope, expiresAt: Date.now() + 30 * 24 * 60 * 60_000 })
    this.save()
    return { access_token, token_type: 'Bearer', expires_in: 3600, refresh_token, scope }
  }

  /** Handle connector discovery and OAuth routes; return false for MCP routes. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', this.baseUrl)
    const pathname = url.pathname
    if (req.method === 'GET' && (pathname === '/.well-known/oauth-protected-resource/mcp' || pathname === '/.well-known/oauth-protected-resource')) {
      json(res, 200, { resource: this.baseUrl + '/mcp', authorization_servers: [this.baseUrl], scopes_supported: scopes, bearer_methods_supported: ['header'] })
      return true
    }
    if (req.method === 'GET' && (pathname === '/.well-known/oauth-authorization-server' || pathname === '/.well-known/openid-configuration')) {
      json(res, 200, {
        issuer: this.baseUrl, authorization_endpoint: this.baseUrl + '/oauth/authorize', token_endpoint: this.baseUrl + '/oauth/token',
        registration_endpoint: this.baseUrl + '/oauth/register', revocation_endpoint: this.baseUrl + '/oauth/revoke',
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: scopes,
      })
      return true
    }
    if (pathname === '/oauth/register' && req.method === 'POST') {
      try {
        const input = JSON.parse(await body(req)) as { redirect_uris?: unknown }
        if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0 || !input.redirect_uris.every(u => typeof u === 'string' && redirectAllowed(u))) throw new Error('invalid redirect_uris')
        const id = 'd2c_client_' + randomBytes(12).toString('base64url')
        this.clients.set(id, { id, redirects: input.redirect_uris })
        this.save()
        json(res, 201, { client_id: id, redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none' })
      } catch { json(res, 400, { error: 'invalid_client_metadata' }) }
      return true
    }
    if (pathname === '/oauth/authorize' && req.method === 'GET') {
      const clientId = url.searchParams.get('client_id') ?? ''
      const redirect = url.searchParams.get('redirect_uri') ?? ''
      const codeChallenge = url.searchParams.get('code_challenge') ?? ''
      const scope = url.searchParams.get('scope') ?? scopes.join(' ')
      const resource = url.searchParams.get('resource')
      const client = this.clients.get(clientId)
      if (url.searchParams.get('response_type') !== 'code' || !client?.redirects.includes(redirect)
        || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
        || (resource !== null && resource !== this.baseUrl + '/mcp')
        || scope.split(' ').some(s => !scopes.includes(s))) {
        json(res, 400, { error: 'invalid_request' })
        return true
      }
      const requestId = random()
      this.requests.set(requestId, { clientId, redirect, codeChallenge, state: url.searchParams.get('state') ?? '', scope, expiresAt: Date.now() + 5 * 60_000 })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" })
      res.end(`<!doctype html><meta charset="utf-8"><title>DSHWithChatGPT</title><style>body{font:16px system-ui;max-width:26rem;margin:5rem auto;padding:1rem}input,button{font:inherit;padding:.7rem;width:100%;box-sizing:border-box;margin:.5rem 0}</style><h1>Connect ChatGPT to this workspace</h1><p>Enter the one-time pairing code from DSH setup.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${requestId}"><label>Pairing code<input name="pairing_code" autocomplete="off" required></label><button>Authorize</button></form>`)
      return true
    }
    if (pathname === '/oauth/authorize' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req))
      const id = form.get('request_id') ?? ''
      const request = this.requests.get(id)
      const supplied = (form.get('pairing_code') ?? '').trim().toUpperCase()
      this.pairingAttempts++
      if (request === undefined || request.expiresAt < Date.now() || this.pairingHash === null
        || this.pairingExpiresAt < Date.now() || this.pairingAttempts > 5 || !equal(hash(supplied), this.pairingHash)) {
        json(res, 403, { error: 'access_denied' })
        return true
      }
      this.requests.delete(id)
      this.pairingHash = null
      const code = 'd2c_code_' + random()
      this.codes.set(hash(code), { ...request, expiresAt: Date.now() + 5 * 60_000 })
      const target = new URL(request.redirect)
      target.searchParams.set('code', code)
      if (request.state !== '') target.searchParams.set('state', request.state)
      res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' })
      res.end()
      return true
    }
    if (pathname === '/oauth/token' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req))
      const clientId = form.get('client_id') ?? ''
      const grant = form.get('grant_type')
      if (!this.clients.has(clientId)) { json(res, 400, { error: 'invalid_client' }); return true }
      if (grant === 'authorization_code') {
        const codeHash = hash(form.get('code') ?? '')
        const code = this.codes.get(codeHash)
        this.codes.delete(codeHash)
        const verifier = form.get('code_verifier') ?? ''
        if (code === undefined || code.expiresAt < Date.now() || code.clientId !== clientId
          || code.redirect !== form.get('redirect_uri') || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
          || !equal(challenge(verifier), code.codeChallenge)) {
          json(res, 400, { error: 'invalid_grant' }); return true
        }
        json(res, 200, this.issue(clientId, code.scope))
        return true
      }
      if (grant === 'refresh_token') {
        const tokenHash = hash(form.get('refresh_token') ?? '')
        const token = this.tokens.get(tokenHash)
        if (token?.kind !== 'refresh' || token.clientId !== clientId || token.expiresAt < Date.now()) {
          json(res, 400, { error: 'invalid_grant' }); return true
        }
        this.tokens.delete(tokenHash)
        json(res, 200, this.issue(clientId, token.scope))
        return true
      }
      json(res, 400, { error: 'unsupported_grant_type' })
      return true
    }
    if (pathname === '/oauth/revoke' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req))
      const tokenHash = hash(form.get('token') ?? '')
      const token = this.tokens.get(tokenHash)
      if (token !== undefined && token.clientId === form.get('client_id')) {
        this.tokens.delete(tokenHash)
        this.save()
      }
      json(res, 200, {})
      return true
    }
    return false
  }
}
