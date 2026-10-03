import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export function validateTargetId(value) {
  assert.equal(typeof value, 'string', 'Explicit owned target required')
  assert.match(value, /^[A-Za-z0-9_-]{1,128}$/, 'Invalid explicit owned target')
  return value
}

// Records a concrete ID supplied by the deployment owner; never discovers tabs.
export async function recordTargetPointer(pointer, targetId) {
  validateTargetId(targetId)
  const temporary = pointer + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify({ targetId }) + '\n', { flag: 'wx', mode: 0o600 })
  await rename(temporary, pointer)
}

export async function readTargetPointer(pointer) {
  return validateTargetId(JSON.parse(await readFile(pointer, 'utf8')).targetId)
}

export function phaseEnvironment(base, targetId) {
  return { ...base, PLANNERBRIDGE_SIDECAR_TARGET_ID: validateTargetId(targetId) }
}

export function ownedSidecarConfig(endpoint, credentialFile, entry, pointer) {
  return { browserMode: 'sidecar', sidecarEndpoint: endpoint, sidecarCredentialFile: credentialFile,
    sidecarProcessCommand: process.execPath,
    sidecarProcessArgs: [fileURLToPath(new URL('../tests/fixtures/planner-executor-owned-sidecar.mjs', import.meta.url)), entry, pointer] }
}

export async function assertSidecarEndpointUnused(endpoint) {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/$/.exec(endpoint)
  assert.ok(match && Number(match[1]) <= 65535, 'Explicit loopback Sidecar endpoint required')
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(match[1]), '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
