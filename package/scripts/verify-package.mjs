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
const dependencies = { [manifest.name]: `file:${pluginArchive}` }
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
await writeFile(path.join(isolated, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }, null, 2) + '\n')
run(['install', '--ignore-scripts', '--strict-peer-dependencies'], isolated)
const probe = `
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
for (const name of ${JSON.stringify(Object.keys(dependencies))}) {
  const resolved = realpathSync(fileURLToPath(import.meta.resolve(name)));
  const relative = path.relative(realpathSync(process.cwd()), resolved);
  assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), name + ' escaped isolated installation');
  await import(name);
  console.log(name + ': isolated import OK');
}
const plugin = await import('dsh-with-chatgpt');
assert.equal(typeof plugin.apply, 'function');
assert.deepEqual(plugin.inject, ['tools', 'systemPrompt', 'storageDomain', 'executionWorldIdentity']);
`
await writeFile(path.join(isolated, 'probe.mjs'), probe)
const probeResult = spawnSync(process.execPath, ['probe.mjs'], { cwd: isolated, stdio: 'inherit', windowsHide: true })
if (probeResult.error) throw probeResult.error
assert.equal(probeResult.status, 0, 'Packed plugin failed isolated runtime import')
console.log('Packed plugin resolves without a sibling checkout; retained fixture: ' + isolated)
