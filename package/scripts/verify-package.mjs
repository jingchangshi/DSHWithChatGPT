import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const pnpm = process.env.npm_execpath
assert.ok(pnpm, 'Run this check through pnpm run test:package')
const isolated = await mkdtemp(path.join(tmpdir(), 'dsh-chatgpt-package-'))

function run(args, cwd) {
  const executable = pnpm.endsWith('.exe') ? pnpm : process.execPath
  const commandArgs = executable === pnpm ? args : [pnpm, ...args]
  const result = spawnSync(executable, commandArgs, { cwd, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Package check failed: ${args.join(' ')}`)
}

console.log(`Isolated package verification: ${isolated}`)
run(['pack', '--pack-destination', isolated], root)
const pluginArchive = (await readdir(isolated)).find(name => name.endsWith('.tgz'))
assert.ok(pluginArchive, 'pnpm pack must produce a plugin archive')
const dependencies = { [manifest.name]: `file:${pluginArchive}`, typescript: manifest.devDependencies.typescript, '@types/node': manifest.devDependencies['@types/node'] }
for (const [name, range] of Object.entries(manifest.peerDependencies)) {
  const development = manifest.devDependencies[name]
  assert.ok(!development?.startsWith('link:'), `${name} must not depend on a sibling checkout`)
  if (development?.startsWith('file:tarballs/')) {
    const archive = path.basename(development.slice(5))
    await copyFile(path.join(root, development.slice(5)), path.join(isolated, archive))
    dependencies[name] = `file:${archive}`
  } else {
    dependencies[name] = range
  }
}
const overrides = {}
for (const [name, reference] of Object.entries(manifest.pnpm?.overrides ?? {})) {
  assert.ok(reference.startsWith('file:tarballs/'), `${name} override must use a packaged artifact`)
  const archive = path.basename(reference.slice(5))
  await copyFile(path.join(root, reference.slice(5)), path.join(isolated, archive))
  overrides[name] = `file:${archive}`
}
await writeFile(path.join(isolated, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies, pnpm: { overrides } }, null, 2) + '\n')
// pnpm 11 ignores package.json.pnpm; keep the isolated verifier aligned with
// the workspace configuration used by the development checkout.
await writeFile(path.join(isolated, 'pnpm-workspace.yaml'), [
  'allowBuilds:',
  '  koffi: true',
  'overrides:',
  ...Object.entries(overrides).map(([name, reference]) => `  ${JSON.stringify(name)}: ${reference}`),
  '',
].join('\n'))
run(['install', '--ignore-scripts', '--strict-peer-dependencies', '--config.registry=https://registry.npmjs.org'], isolated)
await writeFile(path.join(isolated, 'probe.ts'), `
import { bindExecutionReadLease, type ExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease';
import { bindExecutionGitLease, type ExecutionGitLease } from '@deepseek-ai/dsh-execution-world/git-lease';
import type { FsReadRootOpenOptions } from '@deepseek-ai/dsh-fs';
import { SidecarChatControlClient, type ControlOperation, type ChatControlDiagnostics, type ChatReadiness, type ReplyObservationBaseline } from 'dsh-with-chatgpt/sidecar';
import { startSidecar, protectPrivateStateDirectory } from 'dsh-with-chatgpt/sidecar/server';
import { DirectCdpPrimitives, type BrowserPrimitives, type BrowserMutationContext } from 'dsh-with-chatgpt/browser';
import { mintPlannerTaskId, formatPlannerEnvelope, parsePlannerEnvelope, plannerEnvelopeDigest, type PlannerEnvelopeInput } from 'dsh-with-chatgpt/protocol';

const init: PlannerEnvelopeInput = { sender: 'executor', state: 'INIT', taskId: mintPlannerTaskId(), iteration: 0, workspaceId: 'package-probe', sections: { GOAL: 'verify exports' } };
const parsed = parsePlannerEnvelope(formatPlannerEnvelope(init), { sender: 'executor' });
const digest: string = plannerEnvelopeDigest(parsed);
void digest;
declare const primitives: BrowserPrimitives;
declare const mutationContext: BrowserMutationContext;
const focused = primitives.focus('#type-probe', mutationContext);
const connect: typeof DirectCdpPrimitives.connect = DirectCdpPrimitives.connect;
void [focused, connect];
const baseline: ReplyObservationBaseline = { version: 1, conversationId: 'package-probe', assistantCount: 0, textDigest: 'a'.repeat(64), observationEpoch: 'b'.repeat(64) };
const operation: ControlOperation = { operationId: 'packaged-send', replyBaseline: baseline };
const control = new SidecarChatControlClient({ endpoint: 'http://127.0.0.1:18765', authentication: 'type-probe-only' });
const diagnostics: ChatControlDiagnostics = control;
const readiness: Promise<ChatReadiness> = diagnostics.readiness();
void readiness;
const send: Promise<void> = control.sendControlMessage('control', undefined, operation);
void [send, startSidecar, protectPrivateStateDirectory];
const options: FsReadRootOpenOptions = { aliasPolicy: 'deny' };
const bind: typeof bindExecutionReadLease = bindExecutionReadLease;
const bindGit: typeof bindExecutionGitLease = bindExecutionGitLease;
const policy: Parameters<typeof bindExecutionGitLease>[3] = 'allow-hardened-windows';
declare const lease: ExecutionReadLease;
declare const gitLease: ExecutionGitLease;
const assurance: 'full' | 'hardened-windows' = gitLease.assurance;
const read: Promise<string> = lease.fs.readText('README.md', 1024);
void [options, bind, bindGit, policy, assurance, read, gitLease];
`)
run(['exec', 'tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2024', 'probe.ts'], isolated)
const probe = `
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
for (const name of ${JSON.stringify(Object.keys(dependencies))}) {
  if (name === 'typescript' || name === '@types/node') continue;
  const resolved = realpathSync(fileURLToPath(import.meta.resolve(name)));
  const relative = path.relative(realpathSync(process.cwd()), resolved);
  assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), name + ' escaped isolated installation');
  await import(name);
  console.log(name + ': isolated import OK');
}
const plugin = await import('dsh-with-chatgpt');
const browser = await import('dsh-with-chatgpt/browser');
assert.equal(typeof browser.ChatGptWebDriver, 'function');
assert.equal(typeof browser.DirectCdpPrimitives, 'function');
assert.equal(typeof browser.listCdpTargets, 'function');
assert.equal(typeof browser.BrowserHarnessPrimitives, 'function');
assert.equal(typeof browser.BrowserHarnessChatControl, 'function');
assert.ok(browser.BrowserHarnessAdapter.prototype instanceof browser.BrowserHarnessChatControl);
const lease = await import('@deepseek-ai/dsh-execution-world/read-lease');
const gitLease = await import('@deepseek-ai/dsh-execution-world/git-lease');
assert.equal(typeof lease.bindExecutionReadLease, 'function');
assert.equal(typeof gitLease.bindExecutionGitLease, 'function');
assert.equal(typeof plugin.apply, 'function');
assert.deepEqual(plugin.inject, ['tools', 'systemPrompt', 'storageDomain', 'executionWorldIdentity', 'fs', 'subprocess', 'sandbox']);
const { SidecarChatControlClient } = await import('dsh-with-chatgpt/sidecar');
const authentication = randomUUID() + randomUUID();
const child = fork('./sidecar-probe.mjs', [], { cwd: process.cwd(), env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PLANNERBRIDGE_PACKAGE_AUTH: authentication, PLANNERBRIDGE_PACKAGE_STATE: path.join(process.cwd(), 'sidecar-state') }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
const exited = new Promise(resolve => child.once('exit', resolve));
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Packaged Sidecar startup timed out')), 5000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Packaged Sidecar exited before ready')); });
    child.once('message', value => { clearTimeout(timer); resolve(value); });
  });
  assert.notEqual(ready.pid, process.pid);
  const client = new SidecarChatControlClient({ endpoint: ready.endpoint, authentication });
  assert.equal((await client.health()).ok, true);
  await client.ensureReady();
  const operation = { operationId: 'packaged-stable-send' };
  await client.sendControlMessage('packaged semantic operation', undefined, operation);
  await client.sendControlMessage('packaged semantic operation', undefined, operation);
  assert.deepEqual(await client.waitForReply(1000), { text: 'packaged sends: 1', complete: true });
  child.send({ event: 'close' });
  await Promise.race([exited, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Packaged Sidecar shutdown timed out')), 5000).unref())]);
  console.log('Packaged Sidecar: separate process, neutral client, private state, stable replay and clean shutdown OK');
} finally { child.kill(); await exited; }
`
await writeFile(path.join(isolated, 'sidecar-probe.mjs'), `
import { startSidecar, protectPrivateStateDirectory } from 'dsh-with-chatgpt/sidecar/server';
await protectPrivateStateDirectory(process.env.PLANNERBRIDGE_PACKAGE_STATE, []);
let sends = 0;
let conversation;
const driver = {
  health: async () => ({ ok: true, detail: 'ready' }), ensureReady: async () => {}, recover: async () => {},
  openConversation: async id => conversation = id ?? 'packaged-conversation', currentConversation: async () => conversation,
  sendControlMessage: async (_text, signal) => { signal?.throwIfAborted(); sends++; },
  waitForReply: async () => ({ text: 'packaged sends: ' + sends, complete: true }),
};
const service = await startSidecar({ host: '127.0.0.1', port: 0, authentication: process.env.PLANNERBRIDGE_PACKAGE_AUTH, stateDirectory: process.env.PLANNERBRIDGE_PACKAGE_STATE, driver });
process.send({ endpoint: service.endpoint, pid: process.pid });
process.on('message', async message => { if (message?.event === 'close') { await service.close(); process.exit(0); } });
`)
await writeFile(path.join(isolated, 'probe.mjs'), probe)
const probeResult = spawnSync(process.execPath, ['probe.mjs'], { cwd: isolated, stdio: 'inherit', windowsHide: true })
if (probeResult.error) throw probeResult.error
assert.equal(probeResult.status, 0, 'Packed plugin failed isolated runtime import')
console.log('Packed plugin resolves without a sibling checkout; retained fixture: ' + isolated)
