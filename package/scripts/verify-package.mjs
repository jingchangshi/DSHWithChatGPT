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
run(['install', '--ignore-scripts', '--strict-peer-dependencies'], isolated)
await writeFile(path.join(isolated, 'probe.ts'), `
import { bindExecutionReadLease, type ExecutionReadLease } from '@deepseek-ai/dsh-execution-world/read-lease';
import { bindExecutionGitLease, type ExecutionGitLease } from '@deepseek-ai/dsh-execution-world/git-lease';
import type { FsReadRootOpenOptions } from '@deepseek-ai/dsh-fs';
const options: FsReadRootOpenOptions = { aliasPolicy: 'deny' };
const bind: typeof bindExecutionReadLease = bindExecutionReadLease;
const bindGit: typeof bindExecutionGitLease = bindExecutionGitLease;
declare const lease: ExecutionReadLease;
declare const gitLease: ExecutionGitLease;
const read: Promise<string> = lease.fs.readText('README.md', 1024);
void [options, bind, bindGit, read, gitLease];
`)
run(['exec', 'tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2024', 'probe.ts'], isolated)
const probe = `
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
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
const lease = await import('@deepseek-ai/dsh-execution-world/read-lease');
const gitLease = await import('@deepseek-ai/dsh-execution-world/git-lease');
assert.equal(typeof lease.bindExecutionReadLease, 'function');
assert.equal(typeof gitLease.bindExecutionGitLease, 'function');
assert.equal(typeof plugin.apply, 'function');
assert.deepEqual(plugin.inject, ['tools', 'systemPrompt', 'storageDomain', 'executionWorldIdentity', 'fs', 'subprocess', 'sandbox']);
`
await writeFile(path.join(isolated, 'probe.mjs'), probe)
const probeResult = spawnSync(process.execPath, ['probe.mjs'], { cwd: isolated, stdio: 'inherit', windowsHide: true })
if (probeResult.error) throw probeResult.error
assert.equal(probeResult.status, 0, 'Packed plugin failed isolated runtime import')
console.log('Packed plugin resolves without a sibling checkout; retained fixture: ' + isolated)
