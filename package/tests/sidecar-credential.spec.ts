import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { protectPrivateStateDirectory, verifyPrivateStateDirectory } from '../src/deployment/private-state.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const path = resolve(directory)
    if (!path.startsWith(resolve(tmpdir()) + sep) || !basename(path).startsWith('plannerbridge-credential-test-')) throw new Error('Unexpected cleanup target')
    await rm(path, { recursive: true, force: true })
  }
})
async function fixture(privateDirectory = true) {
  const directory = await mkdtemp(join(tmpdir(), 'plannerbridge-credential-test-'))
  directories.push(directory)
  if (privateDirectory) await protectPrivateStateDirectory(directory, [])
  const file = join(directory, 'authentication.secret')
  const value = randomBytes(32).toString('base64url')
  await writeFile(file, value, { mode: 0o600 })
  return { directory, file, value }
}

describe('deployment Sidecar credential reference', () => {
  it('reads a bounded protected credential without broadening journal filenames', async () => {
    const { readSidecarCredential } = await import('../src/deployment/sidecar-credential.ts')
    const f = await fixture()
    expect(await readSidecarCredential(f.file, [])).toBe(f.value)
    await expect(verifyPrivateStateDirectory(f.directory)).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' })
  })
  it('rejects missing and relative references using a stable secret-free error', async () => {
    const { readSidecarCredential } = await import('../src/deployment/sidecar-credential.ts')
    const f = await fixture()
    for (const file of [join(f.directory, 'missing.secret'), 'authentication.secret']) {
      await expect(readSidecarCredential(file, [])).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE', message: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
    }
  })
  it('rejects credentials inside the execution workspace without changing contents', async () => {
    const { readSidecarCredential } = await import('../src/deployment/sidecar-credential.ts')
    const f = await fixture()
    await expect(readSidecarCredential(f.file, [f.directory])).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
    expect(await readFile(f.file, 'utf8')).toBe(f.value)
  })
  it('rejects an unprotected directory even when the file has restrictive POSIX mode bits', async () => {
    const { readSidecarCredential } = await import('../src/deployment/sidecar-credential.ts')
    const f = await fixture(false)
    if (process.platform !== 'win32') await chmod(f.directory, 0o755)
    await expect(readSidecarCredential(f.file, [])).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
  })
  it('rejects a hard-linked credential', async () => {
    const { readSidecarCredential } = await import('../src/deployment/sidecar-credential.ts')
    const f = await fixture()
    await link(f.file, join(f.directory, 'copy.secret'))
    await expect(readSidecarCredential(f.file, [])).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
  })
  it.each(['', 'x'.repeat(8192), 'Bearer invalid token', 'x'.repeat(43) + '\r\n'])('rejects malformed or excessive token content', async value => {
    const { readSidecarCredential } = await import('../src/deployment/sidecar-credential.ts')
    const f = await fixture()
    await writeFile(f.file, value)
    await expect(readSidecarCredential(f.file, [])).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
  })
  it('rejects actual broadened file permissions', async () => {
    const { readSidecarCredential } = await import('../src/deployment/sidecar-credential.ts')
    const f = await fixture()
    if (process.platform === 'win32') {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:PLANNERBRIDGE_TEST_CREDENTIAL; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:PLANNERBRIDGE_TEST_CREDENTIAL -AclObject $acl"],
      { env: { SystemRoot: process.env.SystemRoot, PLANNERBRIDGE_TEST_CREDENTIAL: f.file }, windowsHide: true, timeout: 10000 })
    } else await chmod(f.file, 0o644)
    await expect(readSidecarCredential(f.file, [])).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
  })
})
