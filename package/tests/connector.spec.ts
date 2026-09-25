import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { ConnectorAuth } from '../src/connector/auth.ts'
import { startBridgeServer } from '../src/bridge/server.ts'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('ChatGPT connector authorization', () => {
  it('requires pairing and PKCE, then limits MCP to the issued token', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'd2c-oauth-'))
    directories.push(directory)
    const base = 'https://d2c.example.test'
    const auth = new ConnectorAuth(base, join(directory, 'auth.json'))
    const server = await startBridgeServer({ port: 0, tokens: new Map(), connectorAuth: auth }, [{
      name: 'workspace_info', description: 'read workspace', inputSchema: { type: 'object' },
      handler: async () => ({ name: 'workspace-a' }),
    }])
    const local = `http://127.0.0.1:${server.port}`
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workspace_info', arguments: {} } }
    try {
      const denied = await fetch(local + '/mcp', { method: 'POST', body: JSON.stringify(rpc) })
      expect(denied.status).toBe(401)
      expect(denied.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp')
      const metadata = await (await fetch(local + '/.well-known/oauth-protected-resource/mcp')).json() as { resource: string }
      expect(metadata.resource).toBe(base + '/mcp')

      const callback = 'https://chatgpt.com/connector/oauth/test'
      const client = await (await fetch(local + '/oauth/register', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [callback] }),
      })).json() as { client_id: string }
      const verifier = 'v'.repeat(43)
      const digest = createHash('sha256').update(verifier).digest('base64url')
      const query = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: callback,
        code_challenge_method: 'S256', code_challenge: digest, state: 'nonce', resource: base + '/mcp' })
      const page = await fetch(local + '/oauth/authorize?' + query)
      expect(page.status).toBe(200)
      const requestId = (await page.text()).match(/name="request_id" value="([^"]+)"/)?.[1]
      expect(requestId).toBeTruthy()
      const pairing = auth.newPairingCode()
      const wrong = await fetch(local + '/oauth/authorize', { method: 'POST', body: new URLSearchParams({ request_id: requestId!, pairing_code: 'WRONG' }) })
      expect(wrong.status).toBe(403)
      const approval = await fetch(local + '/oauth/authorize', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ request_id: requestId!, pairing_code: pairing }) })
      expect(approval.status).toBe(302)
      const target = new URL(approval.headers.get('location')!)
      expect(target.searchParams.get('state')).toBe('nonce')
      const code = target.searchParams.get('code')!
      const tokenRequest = (codeVerifier: string): Promise<Response> => fetch(local + '/oauth/token', { method: 'POST', body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback, code, code_verifier: codeVerifier,
      }) })
      expect((await tokenRequest('x'.repeat(43))).status).toBe(400)
      // An invalid verifier consumes the code; a fresh pairing must be approved.
      const page2 = await fetch(local + '/oauth/authorize?' + query)
      const request2 = (await page2.text()).match(/name="request_id" value="([^"]+)"/)?.[1]
      const approval2 = await fetch(local + '/oauth/authorize', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ request_id: request2!, pairing_code: auth.newPairingCode() }) })
      const code2 = new URL(approval2.headers.get('location')!).searchParams.get('code')!
      const issued = await (await fetch(local + '/oauth/token', { method: 'POST', body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback, code: code2, code_verifier: verifier,
      }) })).json() as { access_token: string; refresh_token: string }
      const allowed = await fetch(local + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + issued.access_token }, body: JSON.stringify(rpc) })
      expect(allowed.status).toBe(200)
      expect(await allowed.json()).toMatchObject({ result: { content: [{ text: expect.stringContaining('workspace-a') }] } })
      await fetch(local + '/oauth/revoke', { method: 'POST', body: new URLSearchParams({ token: issued.access_token, client_id: client.client_id }) })
      expect((await fetch(local + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + issued.access_token }, body: JSON.stringify(rpc) })).status).toBe(401)
    } finally {
      await server.close()
    }
  })
})
