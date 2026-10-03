import { afterAll, beforeAll, expect, it } from 'vitest'
import WebSocket from 'ws'
import { CdpSession } from '../src/browser/cdp-session.ts'
import { DirectCdpPrimitives } from '../src/browser/direct-cdp.ts'
import { BrowserPageUnavailableError } from '../src/browser/errors.ts'
import { BrowserTargetChangedError } from '../src/browser/epoch.ts'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { cdpPageCommandProxy } from './fixtures/cdp-page-command-proxy.ts'
import { syntheticCdpDocument } from './fixtures/synthetic-cdp-document.ts'
import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'

let fixture: Awaited<ReturnType<typeof localCdpBrowser>>
beforeAll(async () => { fixture = await localCdpBrowser() }, 15_000)
afterAll(async () => { await fixture?.close() }, 10_000)

async function rootHealthy() {
  const version = await (await fetch(fixture.endpoint + '/json/version')).json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  const session = new CdpSession(socket, { timeoutMs: 1000 })
  try {
    expect(await session.command('Browser.getVersion')).toHaveProperty('product')
    const targets = await session.command<any>('Target.getTargets')
    expect(targets.targetInfos.some((target: any) => target.targetId === fixture.targetId)).toBe(true)
  } finally { session.close() }
}

it.each(['stall', 'disconnect'] as const)('classifies a written read-only %s as page unavailable without touching the target', async mode => {
  const proxy = await cdpPageCommandProxy(fixture.endpoint, fixture.targetId)
  const primitives = await DirectCdpPrimitives.connect({ endpoint: proxy.endpoint, targetId: fixture.targetId, commandTimeoutMs: 300 })
  try {
    proxy.commands.length = 0
    proxy.fault('Runtime.evaluate', mode)
    const failure = await primitives.evaluate('1').catch(error => error)
    await rootHealthy()
    expect(failure).toBeInstanceOf(BrowserPageUnavailableError)
    expect(proxy.commands).toEqual(['Runtime.evaluate'])
  } finally { primitives.close(); await proxy.close() }
})

it.each(['Page.enable', 'Runtime.enable', 'Page.getFrameTree', 'DOM.enable'])('classifies failed %s during attach consistently', async method => {
  const proxy = await cdpPageCommandProxy(fixture.endpoint, fixture.targetId)
  proxy.fault(method)
  try {
    const failure = await DirectCdpPrimitives.connect({ endpoint: proxy.endpoint, targetId: fixture.targetId, commandTimeoutMs: 300 }).catch(error => error)
    await rootHealthy()
    expect(failure).toBeInstanceOf(BrowserPageUnavailableError)
    expect(proxy.commands.filter(value => value === method)).toHaveLength(1)
  } finally { await proxy.close() }
})

it('preserves provider-rejected read observations as target changes', async () => {
  const proxy = await cdpPageCommandProxy(fixture.endpoint, fixture.targetId)
  const primitives = await DirectCdpPrimitives.connect({ endpoint: proxy.endpoint, targetId: fixture.targetId, commandTimeoutMs: 300 })
  try {
    proxy.fault('Runtime.evaluate', 'reject')
    await expect(primitives.evaluate('1')).rejects.toBeInstanceOf(BrowserTargetChangedError)
  } finally { primitives.close(); await proxy.close() }
})

it('settles an admitted native wait as uncertain and releases its owner without cancel or resend', async () => {
  const document = await syntheticCdpDocument(fixture.endpoint, fixture.targetId)
  const direct = await DirectCdpPrimitives.connect({ endpoint: fixture.endpoint, targetId: fixture.targetId, commandTimeoutMs: 1000 })
  const state = await mkdtemp(join(tmpdir(), 'plannerbridge-page-failure-'))
  const authentication = randomUUID() + randomUUID()
  document.serve()
  await direct.navigate('https://chatgpt.com/c/6abfada1-f690-83ee-aedf-762de215604f')
  await direct.waitForLoad(2000)
  const proxy = await cdpPageCommandProxy(fixture.endpoint, fixture.targetId)
  const child = fork(fileURLToPath(new URL('./fixtures/page-failure-sidecar.mjs', import.meta.url)), [], {
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      PLANNERBRIDGE_TEST_CDP: proxy.endpoint, PLANNERBRIDGE_TEST_TARGET: fixture.targetId,
      PLANNERBRIDGE_TEST_STATE: state, PLANNERBRIDGE_TEST_AUTH: authentication },
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  const invoked: string[] = [], phases: Array<{ operationId: string; phase: string }> = []
  child.on('message', (message: any) => {
    if (message.event === 'invoked') invoked.push(message.method)
    if (message.event === 'phase') phases.push(message)
  })
  let rpcProxy: ReturnType<typeof createServer> | undefined
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native page fixture startup deadline')), 5000)
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Native page fixture startup failed')) })
      child.on('message', (message: any) => { if (message.event === 'ready') { clearTimeout(timer); resolve(message.endpoint) } })
    })
    const requests: string[] = []
    rpcProxy = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString()
      requests.push(JSON.parse(body).method)
      const response = await fetch(endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + authentication, 'content-type': 'application/json' }, body })
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })
    await new Promise<void>(resolve => rpcProxy!.listen(0, '127.0.0.1', resolve))
    const client = new SidecarChatControlClient({ endpoint: `http://127.0.0.1:${(rpcProxy.address() as { port: number }).port}`, authentication })
    const baseline = await client.captureReplyBaseline()
    await client.sendControlMessage('one owned control', undefined, { operationId: 'page-send', replyBaseline: baseline })
    const pending = client.waitForReply(12_000, undefined, { operationId: 'page-wait', replyBaseline: baseline, replyRecovery: { sendOperationId: 'page-send' } }).catch(error => error)
    const until = Date.now() + 2000
    while (!phases.some(entry => entry.operationId === 'page-wait' && entry.phase === 'awaiting-reply')) {
      if (Date.now() >= until) throw new Error('Native wait never admitted')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    proxy.commands.length = 0
    proxy.fault('Runtime.evaluate')
    const began = Date.now()
    expect(await pending).toMatchObject({ code: 'BROWSER_STALE' })
    expect(Date.now() - began).toBeLessThan(3000)
    expect(proxy.commands).toEqual(['Runtime.evaluate'])
    await rootHealthy()
    const journal = JSON.parse(await readFile(join(state, 'delivery.json'), 'utf8'))
    expect(journal.entries.find((entry: any) => entry.operationId === 'page-wait')).toMatchObject({ phase: 'uncertain', observation: { sendOperationId: 'page-send', replyBaseline: baseline } })
    expect(journal.entries.find((entry: any) => entry.operationId === 'page-send')).toMatchObject({ phase: 'accepted' })
    expect(await client.health()).toMatchObject({ ok: true })
    proxy.clearFault()
    expect(await client.currentConversation()).toBe(baseline.conversationId) // Non-health read proves owner released.
    expect(await direct.evaluate('window.enterCount')).toBe(1)
    expect(invoked).toEqual(['sendControlMessage', 'waitForReply'])
    expect(requests.filter(method => method === 'cancel')).toEqual([])
    expect(requests.filter(method => method === 'sendControlMessage')).toHaveLength(1)
    expect(requests.filter(method => method === 'waitForReply')).toHaveLength(1)
  } finally {
    child.kill(); await exited
    if (rpcProxy) await new Promise<void>(resolve => { rpcProxy!.closeAllConnections(); rpcProxy!.close(() => resolve()) })
    await proxy.close(); direct.close(); document.close()
    await rm(state, { recursive: true, force: true }) // Exact mkdtemp-owned fixture directory.
  }
}, 15_000)
