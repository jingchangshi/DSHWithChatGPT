import { expect, it, vi } from 'vitest'
import { createServer } from 'node:net'
import { mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, basename, sep } from 'node:path'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { syntheticCdpDocument } from './fixtures/synthetic-cdp-document.ts'
import { DirectCdpPrimitives } from '../src/browser/direct-cdp.ts'
import { SidecarSupervisor } from '../src/deployment/sidecar-supervisor.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'
import { protectPrivateStateDirectory } from '../src/deployment/private-state.ts'
import { startBridgeServer } from '../src/bridge/server.ts'
import { runDoctor } from '../src/readiness/doctor.ts'
import { appProofPrompt } from '../src/readiness/app-proof.ts'
import { ownedSidecarConfig } from '../scripts/planner-executor-owned-sidecar.mjs'

// D27: isolated native composition, not a real ChatGPT exposure or historical
// diagnosis. The production driver/server/doctor are unmodified. Only the
// disposable page schedules its outgoing-message materialization.
it.each(['delayed-valid', 'permanent-missing', 'wrong-digest'] as const)('D27 native bind boundary (%s)', async scenario => {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-d27-'))
  const browser = await localCdpBrowser()
  const document = await syntheticCdpDocument(browser.endpoint, browser.targetId)
  const direct = await DirectCdpPrimitives.connect({ endpoint: browser.endpoint, targetId: browser.targetId })
  let supervisor: SidecarSupervisor | undefined
  let bridge: Awaited<ReturnType<typeof startBridgeServer>> | undefined
  try {
    const conversation = '6abfada1-f690-83ee-aedf-762de215604f'
    const proof = { challenge: 'd27-test-only', workspaceId: 'd27-world', root: { path: '', visibleEntryCount: 0, truncated: false, firstVisibleEntry: null }, git: { isRepo: false, head: null, branch: null } }
    document.serve({ apps: ['DSH with ChatGPT'], paragraphComposer: true, d27RetainEnterCount: true, d27PersistOnDurableRoute: true,
      persistedControl: scenario === 'permanent-missing' ? undefined : scenario === 'wrong-digest' ? 'foreign control' : appProofPrompt,
      persistedReply: scenario === 'permanent-missing' ? undefined : '[D2C_APP_PROOF_V1]' + JSON.stringify(proof), persistedMountDelayMs: scenario === 'delayed-valid' ? 250 : undefined })
    await direct.navigate('https://chatgpt.com/'); await direct.waitForLoad(5000)
    await direct.evaluate(`(() => {
      const push = history.pushState.bind(history);
      history.pushState = (state,title,url) => push(state,title,url === '/c/promoted' ? '/c/${conversation}' : url);
      document.querySelector('[role=textbox]').addEventListener('input', () => { document.querySelector('[role=listbox]').hidden=false; });
      window.bindMaterializedAt = null;
      document.querySelector('[role=textbox]').addEventListener('keydown', event => {
        if (event.key !== 'Enter' || ${JSON.stringify(scenario)} === 'permanent-missing') return;
        const mount = () => {
          const user = document.createElement('article'); user.dataset.messageAuthorRole='user';
          const app = document.createElement('a'); app.href='/plugins/owned'; app.textContent='DSH with ChatGPT';
          user.append(app,document.createTextNode(' ' + ${JSON.stringify(scenario === 'wrong-digest' ? 'foreign control' : appProofPrompt)}));
          document.body.append(user); window.bindMaterializedAt=performance.now();
          window.addReply(${JSON.stringify('[D2C_APP_PROOF_V1]' + JSON.stringify(proof))});
        };
        setTimeout(mount, ${scenario === 'delayed-valid' ? 250 : 0});
      }); return true;
    })()`)
    const credentials = join(directory, 'credentials'), credentialFile = join(credentials, 'authentication.secret')
    await protectPrivateStateDirectory(credentials, [])
    const authentication = randomBytes(32).toString('base64url')
    await writeFile(credentialFile, authentication, { flag: 'wx', mode: 0o600 })
    const portServer = createServer(); await new Promise<void>(r => portServer.listen(0, '127.0.0.1', r))
    const port = (portServer.address() as { port: number }).port
    await new Promise<void>(r => portServer.close(() => r()))
    const endpoint = `http://127.0.0.1:${port}/`, journal = join(directory, 'journal'), telemetry = join(directory, 'phases.jsonl')
    const deployment = ownedSidecarConfig(endpoint, credentialFile, resolve('tests/fixtures/app-proof-recovery-sidecar.mjs'), join(directory, 'target.json'))
    for (const [key, value] of Object.entries({ PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE: credentialFile, PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY: journal,
      PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS: '[]', PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT: browser.endpoint, PLANNERBRIDGE_SIDECAR_TARGET_ID: browser.targetId,
      PLANNERBRIDGE_SIDECAR_PORT: String(port), PLANNERBRIDGE_SIDECAR_APP_NAME: 'DSH with ChatGPT', PLANNERBRIDGE_TEST_PHASE_TELEMETRY: telemetry,
      PLANNERBRIDGE_TEST_BIND_PROVENANCE: '1' })) vi.stubEnv(key, value)
    supervisor = new SidecarSupervisor({ command: deployment.sidecarProcessCommand, args: deployment.sidecarProcessArgs, endpoint, authentication })
    await supervisor.start(); expect(supervisor.pid).not.toBe(process.pid)
    const client = new SidecarChatControlClient({ endpoint, authentication })
    bridge = await startBridgeServer({ port: 0, tokens: new Map([['d27-test-token', 'workspace']]) }, [
      { name: 'workspace_info', description: '', inputSchema: {}, async handler() { return { workspaceId: proof.workspaceId, appProof: { version: 1, challenge: proof.challenge }, capabilities: { leaseBound: true, workspaceContentRead: { available: true }, gitRead: { available: true }, executionOutput: { available: false } } } } },
      { name: 'list_directory', description: '', inputSchema: {}, async handler() { return { path: '', entries: [], truncated: false } } },
      { name: 'git_status', description: '', inputSchema: {}, async handler() { return proof.git } },
    ])
    const recover = vi.fn(async () => { throw new Error('D27 must not recover') })
    const started = performance.now()
    const result = await runDoctor({ mode: 'app-proof', appProofTimeoutMs: 90000, workspaceRoot: directory, workspaceId: proof.workspaceId, appName: 'DSH with ChatGPT', browser: client,
      bridgeHttp: { port: bridge.port, token: 'd27-test-token' }, runtime: { bridge: { workspaceId: proof.workspaceId }, tunnel: { mode: 'managed', configured: true, ready: true, detail: 'synthetic diagnostic' } },
      probeApp: signal => client.probeApp('DSH with ChatGPT', signal), recoverAppProof: recover })
    const code = result.checks.find(c => c.id === 'remote_workspace_access')?.code
    const disk = JSON.parse(await readFile(join(journal, 'delivery.json'), 'utf8'))
    const phases = (await readFile(telemetry, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const sends = disk.entries.filter((e: any) => e.method === 'sendControlMessage')
    const bound = !!sends[0]?.bootstrapBaseline
    const metadata = { scenario, elapsedMs: Math.round(performance.now()-started), proofBudgetMs: 90000, code: code ?? null,
      localReady: result.localReady, appVerified: result.appDataPlaneVerified, sendCount: sends.length, accepted: sends[0]?.phase === 'accepted', bound,
      waitCount: disk.entries.filter((e: any) => e.method === 'waitForReply').length, recoveryCount: recover.mock.calls.length,
      driverSendCount: phases.filter((e: any) => e.kind === 'invoke' && e.method === 'sendControlMessage').length, pageEnterCount: await direct.evaluate('window.enterCount'),
      materialized: await direct.evaluate('window.materialized && document.querySelectorAll("[data-message-author-role=user]").length > 0'),
      provenance: phases.filter((e: any) => e.kind === 'bind-provenance') }
    console.log('D27 metadata:', JSON.stringify(metadata))
    if (process.env.PLANNERBRIDGE_D27_OUTPUT_PATH) await appendFile(process.env.PLANNERBRIDGE_D27_OUTPUT_PATH, JSON.stringify(metadata) + '\n')
    expect(result.localReady).toBe(true)
    expect(sends).toHaveLength(1); expect(sends[0].phase).toBe('accepted')
    expect(await direct.evaluate('window.enterCount')).toBe(1)
    expect(recover).not.toHaveBeenCalled()
    expect(result.appDataPlaneVerified).toBe(scenario === 'delayed-valid')
    expect(bound).toBe(scenario === 'delayed-valid')
    if (scenario !== 'delayed-valid') { expect(code).toBe('SEND_UNCERTAIN'); expect(disk.entries.filter((e: any) => e.method === 'waitForReply')).toHaveLength(0) }
  } finally {
    await supervisor?.close(); await bridge?.close(); vi.unstubAllEnvs()
    direct.close(); document.close(); await browser.close()
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('plannerbridge-d27-')) throw new Error('Unexpected D27 cleanup target')
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
