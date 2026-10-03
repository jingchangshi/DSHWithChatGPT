import { expect, it, vi } from 'vitest'
import { createServer as httpServer } from 'node:http'
import { createServer as netServer } from 'node:net'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, basename, sep } from 'node:path'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { syntheticCdpDocument } from './fixtures/synthetic-cdp-document.ts'
import { DirectCdpPrimitives, listCdpTargets } from '../src/browser/direct-cdp.ts'
import { SidecarSupervisor } from '../src/deployment/sidecar-supervisor.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'
import { protectPrivateStateDirectory } from '../src/deployment/private-state.ts'
import * as replacementMechanics from '../src/deployment/sidecar-target-recovery.ts'
import { recoverOwnedAppProof } from '../src/deployment/dsh-runtime.ts'
import { runDoctor } from '../src/readiness/doctor.ts'
import { appProofPrompt } from '../src/readiness/app-proof.ts'
import { startBridgeServer } from '../src/bridge/server.ts'
import { ownedSidecarConfig, readTargetPointer } from '../scripts/planner-executor-owned-sidecar.mjs'
const conversation = '6abfada1-f690-83ee-aedf-762de215604f'
async function unusedPort() {
  const server = netServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  await new Promise<void>(r => server.close(() => r())); return port
}
// Native compiled service + real CDP/Input + synthetic page. Never real ChatGPT
// or a final acceptance substitute. The production transaction commits only the
// proof result from the actual doctor; the synthetic donor is test-owned.
it.each(['valid', 'foreign-message', 'wrong-proof'] as const)('recovers the same native App wait without another send (%s)', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'plannerbridge-native-app-recovery-'))
  const browser = await localCdpBrowser()
  const source = await syntheticCdpDocument(browser.endpoint, browser.targetId)
  const direct = await DirectCdpPrimitives.connect({ endpoint: browser.endpoint, targetId: browser.targetId })
  const supervisors: SidecarSupervisor[] = []
  let replacementDocument: Awaited<ReturnType<typeof syntheticCdpDocument>> | undefined
  let replacementDirect: DirectCdpPrimitives | undefined
  let replacementId: string | undefined
  let replacementHandle: Awaited<ReturnType<typeof replacementMechanics.createOwnedSidecarReplacement>> | undefined
  let bridge: Awaited<ReturnType<typeof startBridgeServer>> | undefined
  const requests: Array<{ method: string; operationId: string; params: unknown; replyBaseline?: unknown; replyRecovery?: unknown }> = []
  const backend = 'http://127.0.0.1:' + await unusedPort() + '/'
  const authentication = randomBytes(32).toString('base64url')
  const rpc = httpServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString(); const parsed = JSON.parse(body)
    requests.push({ method: parsed.method, operationId: parsed.operationId, params: parsed.params, replyBaseline: parsed.replyBaseline, replyRecovery: parsed.replyRecovery })
    try {
      const response = await fetch(backend, { method: 'POST', headers: { authorization: 'Bearer ' + authentication, 'content-type': 'application/json' }, body })
      outgoing.statusCode = response.status; outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.statusCode = 503; outgoing.end('{}') }
  })
  await new Promise<void>(r => rpc.listen(0, '127.0.0.1', r))
  const endpoint = 'http://127.0.0.1:' + (rpc.address() as { port: number }).port + '/'
  try {
    source.serve({ apps: ['DSH with ChatGPT'], paragraphComposer: true })
    await direct.navigate('https://chatgpt.com/'); await direct.waitForLoad(5000)
    await direct.evaluate(`(() => {
      const push=history.pushState.bind(history);
      history.pushState=(state,title,url)=>push(state,title,url==='/c/promoted'?'/c/${conversation}':url);
      // The real App picker opens again for a new mention. This disposable
      // document's simple picker must reopen after the doctor's earlier probe.
      document.querySelector('[role=textbox]').addEventListener('input', () => {
        document.querySelector('[role=listbox]').hidden=false;
      });
      document.querySelector('[role=textbox]').addEventListener('keydown', e => {
        if(e.key==='Enter') {
          const user=document.createElement('article');user.dataset.messageAuthorRole='user';
          const app=document.createElement('a');app.href='/plugins/owned';app.textContent='DSH with ChatGPT';
          user.append(app,document.createTextNode(' '+${JSON.stringify(appProofPrompt)}));document.body.append(user);
        }
      });return true;
    })()`)
    const credentials = join(root, 'credentials'), journal = join(root, 'journal'), credentialFile = join(credentials, 'authentication.secret')
    await protectPrivateStateDirectory(credentials, [])
    await writeFile(credentialFile, authentication, { flag: 'wx', mode: 0o600 })
    const pointer = join(root, 'owned-target.json')
    // Separate compiled native composition with metadata-only phase telemetry.
    // Observe the separate append-only file, never race delivery.json renames.
    const telemetry = join(root, 'native-phases.jsonl')
    const deployment = ownedSidecarConfig(endpoint, credentialFile, resolve('tests/fixtures/app-proof-recovery-sidecar.mjs'), pointer)
    const env = { PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE: credentialFile, PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY: journal,
      PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS: '[]', PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT: browser.endpoint,
      PLANNERBRIDGE_SIDECAR_PORT: new URL(backend).port, PLANNERBRIDGE_SIDECAR_APP_NAME: 'DSH with ChatGPT', PLANNERBRIDGE_SIDECAR_TARGET_ID: browser.targetId,
      PLANNERBRIDGE_TEST_PHASE_TELEMETRY: telemetry }
    for (const [key,value] of Object.entries(env)) vi.stubEnv(key, value)
    const first = new SidecarSupervisor({ command: deployment.sidecarProcessCommand, args: deployment.sidecarProcessArgs, endpoint, authentication })
    supervisors.push(first); await first.start(); expect(first.pid).not.toBe(process.pid)
    const client = new SidecarChatControlClient({ endpoint, authentication })
    const challenge = 'native-proof-fixture-challenge'
    const proof = { challenge, workspaceId: 'native-proof-world', root: { path: '', visibleEntryCount: 0, truncated: false, firstVisibleEntry: null }, git: { isRepo: false, head: null, branch: null } }
    bridge = await startBridgeServer({ port: 0, tokens: new Map([['synthetic-bridge-token', 'workspace']]) }, [
      { name: 'workspace_info', description: '', inputSchema: {}, async handler() { return { workspaceId: proof.workspaceId, appProof: { version: 1, challenge }, capabilities: { leaseBound: true, workspaceContentRead: { available: true }, gitRead: { available: true }, executionOutput: { available: false } } } } },
      { name: 'list_directory', description: '', inputSchema: {}, async handler() { return { path: '', entries: [], truncated: false } } },
      { name: 'git_status', description: '', inputSchema: {}, async handler() { return proof.git } },
    ])
    const create = replacementMechanics.createOwnedSidecarReplacement
    const spy = vi.spyOn(replacementMechanics, 'createOwnedSidecarReplacement').mockImplementation(async (...args) => {
      const handle = await create(...args); replacementId = handle.replacementTargetId; replacementHandle = handle
      // Production mechanics supplied the sole trusted ID. Interception is
      // confined to this disposable fixture, never a user/product page.
      replacementDocument = await syntheticCdpDocument(browser.endpoint, replacementId)
      replacementDocument.serve({ apps: ['DSH with ChatGPT'], persistedControl: scenario === 'foreign-message' ? 'foreign control' : appProofPrompt, persistedApp: 'DSH with ChatGPT',
        persistedReply: '[D2C_APP_PROOF_V1]' + JSON.stringify(scenario === 'wrong-proof' ? { ...proof, challenge: 'wrong' } : proof) })
      replacementDirect = await DirectCdpPrimitives.connect({ endpoint: browser.endpoint, targetId: replacementId })
      await replacementDirect.navigate('https://chatgpt.com/c/' + conversation); await replacementDirect.waitForLoad(5000)
      vi.spyOn(handle, 'retireSource'); vi.spyOn(handle, 'closeReplacement')
      return handle
    })
    const commit = vi.fn((owned: { supervisor: SidecarSupervisor }) => { supervisors.push(owned.supervisor) })
    let recoveredOperation: Parameters<typeof recoverOwnedAppProof>[1] | undefined
    const pending = runDoctor({ mode: 'app-proof', appProofTimeoutMs: 40000, workspaceRoot: root, workspaceId: proof.workspaceId, appName: 'DSH with ChatGPT',
      browser: client, bridgeHttp: { port: bridge.port, token: 'synthetic-bridge-token' },
      runtime: { bridge: { workspaceId: proof.workspaceId }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'synthetic exposure fixture' } },
      probeApp: signal => client.probeApp('DSH with ChatGPT', signal),
      recoverAppProof: async (operation, resume, signal) => {
        recoveredOperation = operation
        const disk = JSON.parse(await readFile(join(journal, 'delivery.json'), 'utf8'))
        expect(disk.entries.find((entry: any) => entry.operationId === operation.sendOperationId)).toMatchObject({ phase: 'accepted', bootstrapBaseline: { conversationId: conversation } })
        expect(disk.entries.find((entry: any) => entry.operationId === operation.waitOperation.operationId)).toMatchObject({ phase: 'uncertain' })
        return recoverOwnedAppProof({ workspaceKey: proof.workspaceId, attempts: new Set(), owned: { supervisor: first, targetId: browser.targetId, cdpEndpoint: browser.endpoint },
          command: deployment.sidecarProcessCommand, args: deployment.sidecarProcessArgs, endpoint, credentialFile, excludedRoots: [], startupTimeoutMs: 10000,
          health: () => client.health(), commit,
        }, operation, resume, signal)
      },
    })
    let earlyOutcome: unknown
    const pendingOutcome = pending.then(value => { earlyOutcome = { value }; return {value} }, error => { earlyOutcome = { error }; return {error} })
    const until = Date.now() + 10000
    let admitted = false
    while (!admitted) {
      const phases = await readFile(telemetry, 'utf8').then(text => text.split('\n').filter(Boolean).map(line => JSON.parse(line))).catch(() => [])
      admitted = phases.some((entry: any) => entry.method === 'waitForReply' && entry.phase === 'awaiting-reply')
      if (!admitted && earlyOutcome) {
        console.log('Native pre-wait result:', JSON.stringify(earlyOutcome))
        console.log('Native pre-wait metadata:', JSON.stringify({ requests: requests.filter(r => r.operationId !== 'bootstrap').map(r => ({ method: r.method, operationId: r.operationId })), phases }))
        throw new Error('Native doctor settled before wait admission')
      }
      if (Date.now() >= until) throw new Error('Native doctor wait was never admitted')
      if (!admitted) await new Promise(r => setTimeout(r, 20))
    }
    expect(await direct.evaluate('window.enterCount')).toBe(1)
    await direct.evaluate('(() => { setTimeout(() => { while(true) {} }, 0); return true })()')
    const outcome = await pendingOutcome
    expect(outcome).toHaveProperty('value')
    const result = (outcome as { value: Awaited<ReturnType<typeof runDoctor>> }).value
    expect(result.localReady).toBe(true)
    expect(result.appDataPlaneVerified).toBe(scenario === 'valid')
    if (scenario !== 'valid') expect(result.checks.find(c => c.id === 'remote_workspace_access')?.code).toBe(scenario === 'foreign-message' ? 'SEND_UNCERTAIN' : 'APP_PROOF_CHALLENGE_MISMATCH')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(recoveredOperation).toBeDefined()
    const waits = requests.filter(r => r.method === 'waitForReply')
    expect(waits).toHaveLength(2)
    expect(waits[1]).toEqual(waits[0])
    expect(requests.filter(r => r.method === 'sendControlMessage')).toHaveLength(1)
    expect(requests.filter(r => r.method === 'cancel')).toHaveLength(0)
    const phases = (await readFile(telemetry, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(phases.filter(entry => entry.kind === 'invoke' && entry.method === 'sendControlMessage')).toHaveLength(1)
    expect(new Set(phases.filter(entry => entry.kind === 'invoke' && entry.method === 'waitForReply').map(entry => entry.operationId)).size).toBe(1)
    const disk = JSON.parse(await readFile(join(journal, 'delivery.json'), 'utf8'))
    expect(disk.entries.filter((entry: any) => entry.method === 'sendControlMessage')).toHaveLength(1)
    expect(disk.entries.find((entry: any) => entry.operationId === recoveredOperation!.waitOperation.operationId).phase).toBe(scenario === 'foreign-message' ? 'uncertain' : 'accepted')
    let targets = await listCdpTargets(browser.endpoint)
    if (scenario === 'valid') {
      expect(commit).toHaveBeenCalledTimes(1)
      expect(await readTargetPointer(pointer)).toBe(replacementId)
      expect(await replacementDirect!.evaluate('window.enterCount')).toBe(0)
      expect(await replacementDirect!.evaluate('window.sent.length')).toBe(0)
      expect(replacementHandle!.retireSource).toHaveBeenCalledTimes(1)
      expect(replacementHandle!.closeReplacement).not.toHaveBeenCalled()
      // Chrome's close acknowledgement is not an observed terminal state.
      // Observe only: never repeat the close command or renew the proof timer.
      const retirementStarted = Date.now()
      const retirementResult = replacementHandle!.retireSource as ReturnType<typeof vi.fn>
      console.log('Native retirement result:', retirementResult.mock.settledResults.map(result => ({ type: result.type, value: result.value instanceof Error ? result.value.message : result.value })))
      while (targets.some(t => t.id === browser.targetId) && Date.now() - retirementStarted < 5000) {
        await new Promise(resolve => setTimeout(resolve, 50))
        targets = await listCdpTargets(browser.endpoint)
      }
      console.log('Native source terminal observation:', JSON.stringify({ elapsedMs: Date.now() - retirementStarted, sourcePresent: targets.some(t => t.id === browser.targetId) }))
      expect(targets.some(t => t.id === browser.targetId)).toBe(false)
    } else {
      expect(commit).not.toHaveBeenCalled()
      expect(replacementHandle!.retireSource).not.toHaveBeenCalled()
      expect(replacementHandle!.closeReplacement).toHaveBeenCalledTimes(1)
      expect(targets.some(t => t.id === browser.targetId)).toBe(true)
      expect(targets.some(t => t.id === replacementId)).toBe(false)
    }
    console.log('Native App-proof transaction:', scenario, 'one send, same wait ID/digest, one trusted replacement, proof-gated commit/rollback')
  } finally {
    vi.restoreAllMocks(); vi.unstubAllEnvs()
    for (const child of supervisors) await child.close()
    await bridge?.close()
    await new Promise<void>(r => { rpc.closeAllConnections(); rpc.close(() => r()) })
    replacementDirect?.close(); replacementDocument?.close(); direct.close(); source.close(); await browser.close()
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('plannerbridge-native-app-recovery-')) throw new Error('Unexpected fixture cleanup target')
    await rm(root, { recursive: true, force: true })
  }
}, 45000)
