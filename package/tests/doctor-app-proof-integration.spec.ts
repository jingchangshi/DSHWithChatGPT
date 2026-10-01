import { legacyBrowserObservation } from './fixtures/legacy-browser-observation.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, inject } from '../src/index.ts'
import { TunnelSupervisor, type TunnelBinding } from '../src/tunnel/supervisor.ts'
import { rootFact, gitFact } from '../src/readiness/app-proof.ts'
import * as reads from '@deepseek-ai/dsh-execution-world/read-lease'
import * as git from '@deepseek-ai/dsh-execution-world/git-lease'

vi.mock('@deepseek-ai/dsh-execution-world/read-lease', { spy: true })
vi.mock('@deepseek-ai/dsh-execution-world/git-lease', { spy: true })
afterEach(() => vi.restoreAllMocks())

describe('registered doctor App proof', () => {
  it.each(['valid', 'wrong', 'malformed', 'delayed'])('uses the production bridge through the browser provider (%s)', async scenario => {
    const ctx = new Context()
    const workspaceId = randomUUID()
    const records = new Map<string, unknown>()
    const tools = new Map<string, { execute(args: Record<string, unknown>, exec: unknown): Promise<unknown> }>()
    let binding: TunnelBinding | undefined
    let reply = ''
    let replyReads = 0
    let challenge = ''
    let prompt = ''
    const mcp = async (name: string) => {
      const raw = await readFile(binding!.bearerValueFile, 'utf8')
      expect(/^Bearer d2c_[A-Za-z0-9_-]+\n$/.test(raw)).toBe(true)
      expect(raw.endsWith('\\n')).toBe(false)
      expect(raw.includes('\r')).toBe(false)
      const header = raw.slice(0, -1)
      const response = await fetch(binding!.localUrl, { method: 'POST', headers: { authorization: header, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: name === 'list_directory' ? { path: '' } : {} } }) })
      const envelope = await response.json() as { result: { content: Array<{ text: string }> } }
      return JSON.parse(envelope.result.content[0]!.text)
    }
    vi.mocked(reads.bindExecutionReadLease).mockImplementation(async () => ({ workspaceId: workspaceId as reads.ExecutionReadLease['workspaceId'], fs: { stat: async () => undefined, readText: async () => '', listDir: async () => [] }, dispose: async () => {} }))
    vi.mocked(git.bindExecutionGitLease).mockImplementation(async (_ctx, _root, signal) => ({ workspaceId: workspaceId as git.ExecutionGitLease['workspaceId'], assurance: 'full', dispose: async () => {}, git: { workspaceId: workspaceId as git.ExecutionGitLease['workspaceId'], emptyFile: 'NUL', signal, execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }) } }))
    vi.spyOn(TunnelSupervisor.prototype, 'ensure').mockImplementation(async value => { binding = value; return { mode: 'managed', configured: true, ready: true, detail: 'fixture' } })
    ctx.provide('storageDomain', { open: async (spec: { name: string }) => ({ close: async () => {}, table: (name: string) => ({ get: (key: string) => records.get(spec.name + '/' + name + '/' + key), put: async (key: string, value: unknown) => { records.set(spec.name + '/' + name + '/' + key, value) }, delete: async (key: string) => { records.delete(spec.name + '/' + name + '/' + key) } }) }) })
    ctx.provide('executionWorldIdentity', { resolve: async () => workspaceId })
    for (const service of ['fs', 'subprocess', 'sandbox']) ctx.provide(service, {})
    ctx.provide('tools', {
      register: (tool: { name: string; execute(args: Record<string, unknown>, exec: unknown): Promise<unknown> }) => { tools.set(tool.name, tool) },
      execute: async (request: { name: string; arguments: { expression?: string; text?: string; key?: string } }) => {
        const name = request.name.replace('mcp__browser-harness__', '')
        if (name === 'browser_page_info') return { value: { url: 'https://chatgpt.com/c/fixture' } }
        if (name === 'browser_current_tab') return { value: { targetId: 'owned-target', url: 'https://chatgpt.com/c/fixture' } }
        if (name === 'browser_type' && request.arguments.text?.includes('[D2C_APP_PROOF_V1]')) prompt = request.arguments.text
        if (name === 'browser_press' && request.arguments.key === 'Enter') {
          const workspace = await mcp('workspace_info')
          challenge = workspace.appProof.challenge
          expect(prompt).not.toContain(challenge)
          reply = '[D2C_APP_PROOF_V1]' + JSON.stringify({ challenge: scenario === 'wrong' ? 'wrong' : challenge, workspaceId: workspace.workspaceId, root: rootFact(await mcp('list_directory')), git: gitFact(await mcp('git_status')) })
          if (scenario === 'malformed') reply = reply.slice(0, -1)
        }
        if (name === 'browser_js') {
          const expression = request.arguments.expression!
          if (expression.includes('value: (true)')) return { value: legacyBrowserObservation(expression, true, 'https://chatgpt.com/c/fixture') }
          if (expression.includes('composer.setAttribute')) return { value: legacyBrowserObservation(String(request.arguments.expression), { count: 1, empty: true, owned: true, focused: true }, 'https://chatgpt.com/c/fixture') }
          if (expression.includes('visibility: document.visibilityState')) return { value: legacyBrowserObservation(String(request.arguments.expression), { visibility: 'visible', url: 'https://chatgpt.com/c/fixture' }, 'https://chatgpt.com/c/fixture') }
          if (expression.includes('return draftText(content) ===')) return { value: legacyBrowserObservation(String(request.arguments.expression), true, 'https://chatgpt.com/c/fixture') }
          if (expression.includes('const matches = candidates.filter')) return { value: legacyBrowserObservation(String(request.arguments.expression), { found: true, x: 1, y: 1 }, 'https://chatgpt.com/c/fixture') }
          if (expression.includes('const decorators')) return { value: legacyBrowserObservation(String(request.arguments.expression), true, 'https://chatgpt.com/c/fixture') }
          if (expression.includes('const external =')) return { value: legacyBrowserObservation(String(request.arguments.expression), true, 'https://chatgpt.com/c/fixture') }
          if (reply !== '') replyReads++
          const text = scenario === 'delayed' && replyReads <= 3 ? reply.slice(0, 32) : reply
          return { value: legacyBrowserObservation(String(request.arguments.expression), { text, assistantCount: reply ? 1 : 0, streaming: false, loggedOut: false, composer: true }, 'https://chatgpt.com/c/fixture') }
        }
        return { value: {} }
      },
    })
    ctx.provide('systemPrompt', { section: () => {}, getSectionOrder: () => 0 })
    try {
      await ctx.plugin({ apply, Config, inject }, { browserMode: 'browser-harness-mcp',  tunnelMode: 'managed', gitRead: true, gitPolicy: 'worktree' })
      const exec = { agent: { session: { header: { cwd: workspaceId } } }, signal: new AbortController().signal }
      const status = await tools.get('chatgpt_status')!.execute({}, exec) as { connectorConfigPath: string }
      const metadata = await readFile(status.connectorConfigPath, 'utf8')
      expect(metadata.endsWith('\n')).toBe(true)
      expect(metadata.endsWith('\\n')).toBe(false)
      expect(JSON.parse(metadata)).toMatchObject({ authorization: { type: 'bearer-file', tokenFile: binding!.bearerValueFile } })
      const result = await tools.get('chatgpt_doctor')!.execute({ mode: 'app-proof' }, exec)
      expect(result).toMatchObject({ localReady: true, appDataPlaneVerified: scenario === 'valid' || scenario === 'delayed', fullC2CVerified: false })
      if (scenario === 'malformed') expect(result).toMatchObject({ checks: expect.arrayContaining([expect.objectContaining({ code: 'APP_PROOF_MALFORMED' })]) })
      expect(challenge).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(result)).not.toContain(challenge)
      expect(JSON.stringify([...records])).not.toContain(challenge)
      expect(await mcp('workspace_info')).not.toHaveProperty('appProof')
      expect(records.has('d2c_control/managed_tunnel/owner')).toBe(false)
      await expect(tools.get('chatgpt_doctor')!.execute({ mode: 'invalid' }, exec)).rejects.toThrow('INVALID_DOCTOR_MODE')
      expect(await tools.get('chatgpt_doctor')!.execute({}, exec)).toMatchObject({ localReady: true, appDataPlaneVerified: false })
    } finally { await ctx.fiber.dispose() }
  }, 15_000)
})
