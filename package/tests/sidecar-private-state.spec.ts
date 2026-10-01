import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { sidecarProcess } from './fixtures/sidecar-process.ts'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) { const absolute = resolve(directory); if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('plannerbridge-private-test-')) throw new Error('Unexpected private-state cleanup target'); await rm(absolute, { recursive: true, force: true }) } })
async function directory() { const path = await mkdtemp(join(tmpdir(), 'plannerbridge-private-test-')); directories.push(path); return path }
describe('deployment-owned private state', () => {
  it('refuses real Sidecar process startup with an unprotected state directory', async () => {
    let unexpected: Awaited<ReturnType<typeof sidecarProcess>> | undefined
    try { await expect(sidecarProcess(undefined, { protect: false }).then(child => { unexpected = child; return child })).rejects.toThrow('JOURNAL_UNAVAILABLE') }
    finally { await unexpected?.close() }
  })
  it('protects and independently verifies files created under the private directory', async () => {
    const { protectPrivateStateDirectory, verifyPrivateStateDirectory } = await import('../src/deployment/private-state.ts')
    const path = await directory()
    await protectPrivateStateDirectory(path, [])
    await writeFile(join(path, 'delivery.json'), '{}')
    expect(await verifyPrivateStateDirectory(path)).toEqual({ verified: true, currentUserOnly: true, mechanism: process.platform === 'win32' ? 'windows-dacl' : 'posix-mode' })
    if (process.platform === 'win32') {
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[System.IO.File]::GetAccessControl([System.IO.Path]::Combine($env:PLANNERBRIDGE_TEST_DIRECTORY,'delivery.json')); @($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference -ne $sid }).Count"], { env: { SystemRoot: process.env.SystemRoot, PLANNERBRIDGE_TEST_DIRECTORY: path }, windowsHide: true })
      expect(stdout.trim()).toBe('0')
    }
  })
  it('rejects a workspace location before touching its contents', async () => {
    const { protectPrivateStateDirectory } = await import('../src/deployment/private-state.ts')
    const workspace = await directory()
    await writeFile(join(workspace, 'source.txt'), 'preserved')
    await expect(protectPrivateStateDirectory(join(workspace, 'state'), [workspace])).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' })
    expect(await readFile(join(workspace, 'source.txt'), 'utf8')).toBe('preserved')
  })
  it('does not repurpose a nonempty unrelated directory', async () => {
    const { protectPrivateStateDirectory } = await import('../src/deployment/private-state.ts')
    const path = await directory()
    await writeFile(join(path, 'source.txt'), 'preserved')
    await expect(protectPrivateStateDirectory(path, [])).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' })
    expect(await readFile(join(path, 'source.txt'), 'utf8')).toBe('preserved')
  })
  it('fails verification after permissions are broadened', async () => {
    const { protectPrivateStateDirectory, verifyPrivateStateDirectory } = await import('../src/deployment/private-state.ts')
    const path = await directory()
    await protectPrivateStateDirectory(path, [])
    if (process.platform === 'win32') {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $acl=[System.IO.Directory]::GetAccessControl($env:PLANNERBRIDGE_TEST_DIRECTORY); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($env:PLANNERBRIDGE_TEST_DIRECTORY,$acl)"], { env: { SystemRoot: process.env.SystemRoot, PLANNERBRIDGE_TEST_DIRECTORY: path }, windowsHide: true })
    } else { const { chmod } = await import('node:fs/promises'); await chmod(path, 0o755) }
    await expect(verifyPrivateStateDirectory(path)).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' })
  })
})
