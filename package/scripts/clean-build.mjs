import assert from 'node:assert/strict'
import { lstat, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)))
const output = path.join(root, 'lib')
const existing = await lstat(output).catch(error => {
  if (error.code === 'ENOENT') return undefined
  throw error
})
if (existing !== undefined) {
  assert.ok(existing.isDirectory() && !existing.isSymbolicLink(), 'Build output must be a local directory')
  assert.equal(await realpath(output), output, 'Build output must remain inside this package')
  await rm(output, { recursive: true })
}
