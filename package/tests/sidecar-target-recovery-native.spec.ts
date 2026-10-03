import { expect, it } from 'vitest'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, basename, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { localCdpBrowser } from './fixtures/local-cdp-browser.ts'
import { syntheticCdpDocument } from './fixtures/synthetic-cdp-document.ts'
import { DirectCdpPrimitives } from '../src/browser/direct-cdp.ts'
import { protectPrivateStateDirectory } from '../src/deployment/private-state.ts'
import { SidecarSupervisor } from '../src/deployment/sidecar-supervisor.ts'
import { SidecarChatControlClient } from '../src/sidecar/client.ts'
import { createOwnedSidecarReplacement } from '../src/deployment/sidecar-target-recovery.ts'
import { listCdpTargets } from '../src/browser/direct-cdp.ts'

const conversation = '6abfada1-f690-83ee-aedf-762de215604f'
const control = '[PLANNER_BRIDGE]\nVERSION: 2\nSTATE: INIT\nTASK_ID: pb_' + 'a'.repeat(32) + '\nITERATION: 0\nWORKSPACE_ID: owned-world\n\nGOAL:\nNative persisted bootstrap recovery'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
async function port() {
  const server = createServer()
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const value = (server.address() as { port: number }).port
  await new Promise<void>(r => server.close(() => r()))
  return value
}

// Real disposable Chrome + compiled native Sidecar child + authenticated HTTP.
// Synthetic document is NOT a real ChatGPT or final acceptance claim.
it('proves native old-target recovery failure and same-journal replacement oracle without resend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plannerbridge-native-target-'))
  const browser = await localCdpBrowser()
  const source = await syntheticCdpDocument(browser.endpoint, browser.targetId)
  const primitives = await DirectCdpPrimitives.connect({ endpoint: browser.endpoint, targetId: browser.targetId })
  let replacementDocument: Awaited<ReturnType<typeof syntheticCdpDocument>> | undefined
  let replacementPrimitives: DirectCdpPrimitives | undefined
  const children: SidecarSupervisor[] = []
  try {
    source.serve({ apps: ['DSH with ChatGPT'], paragraphComposer: true })
    await primitives.navigate('https://chatgpt.com/')
    await primitives.waitForLoad(5000)
    await primitives.evaluate(`(() => {
      const push=history.pushState.bind(history);
      history.pushState=(state,title,url)=>push(state,title,url==='/c/promoted'?'/c/${conversation}':url);
      document.querySelector('[role=textbox]').addEventListener('keydown', e => {
        if(e.key === 'Enter') {
          const user=document.createElement('article');user.dataset.messageAuthorRole='user';
          const app=document.createElement('a');app.href='/plugins/owned';app.textContent='DSH with ChatGPT';
          user.append(app,document.createTextNode(' '+${JSON.stringify(control)}));document.body.append(user);
        }
      });return true;
    })()`)
    const credentials = join(root, 'credentials'), journal = join(root, 'journal')
    await protectPrivateStateDirectory(credentials, [])
    const authentication = randomBytes(32).toString('base64url'), credentialFile = join(credentials, 'authentication.secret')
    await writeFile(credentialFile, authentication, { flag: 'wx', mode: 0o600 })
    const endpoint = 'http://127.0.0.1:' + await port() + '/'
    const env = { PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE: credentialFile, PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY: journal,
      PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS: '[]', PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT: browser.endpoint,
      PLANNERBRIDGE_SIDECAR_PORT: new URL(endpoint).port, PLANNERBRIDGE_SIDECAR_APP_NAME: 'DSH with ChatGPT' }
    const start = async (targetId: string) => {
      const child = new SidecarSupervisor({ command: process.execPath, args: [resolve('lib/deployment/sidecar-process-entry.js')],
        endpoint, authentication, env: { ...env, PLANNERBRIDGE_SIDECAR_TARGET_ID: targetId } })
      children.push(child); await child.start(); expect(child.pid).not.toBe(process.pid)
      return { child, client: new SidecarChatControlClient({ endpoint, authentication, requestTimeoutMs: 10000 }) }
    }
    const first = await start(browser.targetId)
    const baseline = await first.client.captureReplyBaseline()
    expect(baseline.conversationId).toBeNull()
    const operation = { operationId: 'native-owned-send', replyBaseline: baseline,
      correlation: { taskId: 'pb_' + 'a'.repeat(32), iteration: 0, workspaceId: 'owned-world', phase: 'INIT' as const } }
    await first.client.sendControlMessage(control, undefined, operation)
    expect(await primitives.evaluate('window.enterCount')).toBe(1)
    const file = join(journal, 'delivery.json'), before = await readFile(file, 'utf8')
    const entry = JSON.parse(before).entries.find((e: any) => e.operationId === operation.operationId)
    expect(entry).toMatchObject({ phase: 'accepted', bootstrap: { controlDigest: hash(control), replyBaseline: baseline } })
    expect(entry.bootstrapBaseline).toBeUndefined()
    // Deliberately block only this disposable renderer; root CDP stays available.
    await primitives.evaluate('(() => { setTimeout(() => { while (true) {} }, 0); return true; })()')
    await expect(first.client.captureSendObservation(operation.operationId)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(before)
    console.log('RED behavior: current native recovery cannot bind the unresponsive owned target; journal and one-send evidence preserved')
    const replacement = await createOwnedSidecarReplacement(browser.endpoint, browser.targetId)
    expect(replacement.replacementTargetId).not.toBe(browser.targetId)
    expect((await listCdpTargets(browser.endpoint)).some(target => target.id === browser.targetId)).toBe(true)
    replacementDocument = await syntheticCdpDocument(browser.endpoint, replacement.replacementTargetId)
    replacementDocument.serve({ apps: ['DSH with ChatGPT'], persistedControl: control, persistedApp: 'DSH with ChatGPT' })
    replacementPrimitives = await DirectCdpPrimitives.connect({ endpoint: browser.endpoint, targetId: replacement.replacementTargetId })
    await replacementPrimitives.navigate('https://chatgpt.com/c/' + conversation)
    await replacementPrimitives.waitForLoad(5000)
    await first.child.close()
    const second = await start(replacement.replacementTargetId)
    const bound = await second.client.captureSendObservation(operation.operationId)
    expect(bound).toMatchObject({ conversationId: conversation, assistantCount: baseline.assistantCount, textDigest: baseline.textDigest })
    const saved = JSON.parse(await readFile(file, 'utf8')).entries.find((e: any) => e.operationId === operation.operationId)
    expect(saved).toMatchObject({ phase: 'accepted', bootstrap: entry.bootstrap, bootstrapBaseline: bound })
    expect(await replacementPrimitives.evaluate('window.enterCount')).toBe(0)
    expect(await replacementPrimitives.evaluate('window.sent.length')).toBe(0)
    await replacement.retireSource()
    await expect.poll(async () => (await listCdpTargets(browser.endpoint)).some(target => target.id === browser.targetId), { timeout: 2000 }).toBe(false)
    console.log('Native architecture oracle PASS: same journal/task/send/digest and assistant baseline bound through fresh target and fresh Sidecar; zero second send')
  } finally {
    for (const child of children) await child.close()
    replacementPrimitives?.close(); replacementDocument?.close(); primitives.close(); source.close(); await browser.close()
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('plannerbridge-native-target-')) throw new Error('Unexpected fixture cleanup target')
    await rm(root, { recursive: true, force: true })
  }
}, 45000)
