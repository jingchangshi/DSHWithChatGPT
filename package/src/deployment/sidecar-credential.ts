import { execFile } from 'node:child_process'
import { lstat, open } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

export class SidecarCredentialError extends Error {
  readonly code = 'SIDECAR_CREDENTIAL_UNAVAILABLE'
  constructor() { super('SIDECAR_CREDENTIAL_UNAVAILABLE'); this.name = 'SidecarCredentialError' }
}
const fail = (): never => { throw new SidecarCredentialError() }
const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
const verifyAcl = String.raw`
$ErrorActionPreference='Stop'
$path=$env:PLANNERBRIDGE_CREDENTIAL_REFERENCE
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$parent=[System.IO.Path]::GetDirectoryName($path)
$directoryAcl=Get-Acl -LiteralPath $parent
if (-not $directoryAcl.AreAccessRulesProtected) { throw 'unprotected directory' }
foreach ($target in @($parent,$path)) {
  $acl=Get-Acl -LiteralPath $target
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'foreign owner' }
  $allow=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' })
  if ($allow.Count -eq 0) { throw 'missing access' }
  foreach ($rule in $allow) { if ($rule.IdentityReference.Value -ne $sid.Value) { throw 'foreign access' } }
}
$current=$path
while ($current) {
  $item=Get-Item -LiteralPath $current -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
  $next=[System.IO.Path]::GetDirectoryName($current)
  if ($next -eq $current) { break }
  $current=$next
}
Write-Output 'verified'
`

/** Read only a bounded, private deployment credential, never a workspace file.
 * This deliberately does not broaden the delivery journal's owned-file allowlist. */
export async function readSidecarCredential(file: string, excludedRoots: readonly string[]): Promise<string> {
  try {
    if (!isAbsolute(file) || resolve(file) !== file) fail()
    const location = normalize(file)
    for (const root of excludedRoots) {
      if (!isAbsolute(root)) fail()
      const excluded = normalize(root).replace(/[\\/]$/, '')
      if (location === excluded || location.startsWith(excluded + sep)) fail()
    }
    let current = file
    while (true) {
      if ((await lstat(current)).isSymbolicLink()) fail()
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    const before = await lstat(file)
    const parent = await lstat(dirname(file))
    if (!before.isFile() || before.nlink !== 1 || before.size < 43 || before.size > 128 || !parent.isDirectory()) fail()
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      const { stdout } = await promisify(execFile)(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', verifyAcl], {
          windowsHide: true, timeout: 10000, maxBuffer: 4096,
          env: { SystemRoot: systemRoot, PLANNERBRIDGE_CREDENTIAL_REFERENCE: file },
        })
      if (stdout.trim() !== 'verified') fail()
    } else {
      if (before.uid !== process.getuid?.() || parent.uid !== process.getuid?.() || (before.mode & 0o077) !== 0 || (parent.mode & 0o077) !== 0) fail()
    }
    const handle = await open(file, 'r')
    try {
      const opened = await handle.stat()
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== before.size || opened.ctimeMs !== before.ctimeMs) fail()
      const bytes = Buffer.alloc(129)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      const after = await lstat(file)
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1 || after.size !== opened.size || after.ctimeMs !== opened.ctimeMs || after.mtimeMs !== opened.mtimeMs || bytesRead !== opened.size) fail()
      const value = bytes.subarray(0, bytesRead).toString('utf8')
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) fail()
      return value
    } finally { await handle.close() }
  } catch { return fail() }
}
