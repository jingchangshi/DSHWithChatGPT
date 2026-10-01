import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProfileSidecarFixture } from './profile-sidecar-fixture.mjs'
import { readSidecarCredential } from '../lib/deployment/sidecar-credential.js'
import { SidecarChatControlClient } from '../lib/sidecar/client.js'

test('isolated bootstrap uses protected references, authenticated separate process and owned shutdown', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plannerbridge-profile-test-'))
  let fixture
  try {
    fixture = await createProfileSidecarFixture(root, new URL('../lib/sidecar/server.js', import.meta.url).href)
    assert.notEqual(fixture.pid, process.pid)
    const authentication = await readSidecarCredential(fixture.credentialFile, [])
    assert.match(authentication, /^[A-Za-z0-9_-]{43,128}$/)
    assert.equal(JSON.stringify(fixture).includes(authentication), false)
    await assert.rejects(readSidecarCredential(fixture.credentialFile, [root]), { code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
    await assert.rejects(readSidecarCredential(path.join(root, 'missing.secret'), []), { code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
    const client = new SidecarChatControlClient({ endpoint: fixture.endpoint, authentication })
    assert.equal((await client.health()).ok, true)
    await assert.rejects(client.readiness(), { code: 'CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE' })
    const foreign = new SidecarChatControlClient({ endpoint: fixture.endpoint, authentication: 'wrong-token' })
    await assert.rejects(foreign.health())
    assert.equal(await readFile(fixture.credentialFile, 'utf8'), authentication)
    await fixture.close()
    await fixture.close()
    await assert.rejects(client.health())
  } finally {
    await fixture?.close()
    await rm(root, { recursive: true, force: true })
  }
})
