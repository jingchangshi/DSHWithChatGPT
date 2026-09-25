/**
 * Fail when `lib/` no longer matches what `src/` compiles to.
 *
 * `package.json` points DSH at `lib/index.js`, so a stale `lib/` silently runs
 * the previous revision after a source edit. This check compiles into a
 * temporary directory and compares it with the on-disk build output instead of
 * comparing timestamps, so a checkout that never built fails here rather than
 * shipping an artifact nothing regenerated.
 *
 * Usage: `pnpm run check:lib` (after `pnpm install`).
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const libDir = join(packageDir, 'lib')
const scratch = mkdtempSync(join(tmpdir(), 'd2c-lib-check-'))

/** Every file under `dir`, as paths relative to `root`, sorted. */
function filesUnder(dir, root = dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(full, root))
    else if (entry.isFile()) found.push(relative(root, full))
  }
  return found.sort()
}

/** Content digest of one file, so a mismatch names the file rather than a timestamp. */
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

try {
  execFileSync(
    process.execPath,
    [join(packageDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(packageDir, 'tsconfig.json'), '--outDir', scratch],
    { cwd: packageDir, stdio: 'inherit' },
  )
  const expected = filesUnder(scratch)
  const actual = filesUnder(libDir)
  const missing = expected.filter(file => !actual.includes(file))
  const stale = expected.filter(file => actual.includes(file) && digest(join(scratch, file)) !== digest(join(libDir, file)))
  const extra = actual.filter(file => !expected.includes(file))
  if (missing.length > 0 || stale.length > 0 || extra.length > 0) {
    process.stderr.write('dsh-with-chatgpt: lib/ is stale relative to src/ — run `pnpm run build`\n')
    for (const file of missing) process.stderr.write(`  missing from lib/: ${file}\n`)
    for (const file of stale) process.stderr.write(`  differed from src/: ${file}\n`)
    for (const file of extra) process.stderr.write(`  present only in lib/ (delete or rebuild): ${file}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`dsh-with-chatgpt: lib/ matches src/ (${expected.length} files)\n`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
