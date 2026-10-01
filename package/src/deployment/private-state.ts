import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { SidecarRpcError } from '../sidecar/errors.ts'

export interface PrivateStateEvidence { verified: true; currentUserOnly: true; mechanism: 'windows-dacl' | 'posix-mode' }
const ownedFile = /^(?:delivery\.json|owner\.lock|reclaim\.lock|delivery-[a-f0-9-]{36}\.tmp)$/
const windowsScript = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:PLANNERBRIDGE_PRIVATE_DIRECTORY
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($env:PLANNERBRIDGE_PRIVATE_ACTION -eq 'protect') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
  if ([System.IO.Directory]::Exists($path)) {
    if (@(Get-ChildItem -LiteralPath $path -Force).Count -ne 0) { throw 'nonempty directory' }
    Set-Acl -LiteralPath $path -AclObject $acl
  } else { [System.IO.Directory]::CreateDirectory($path, $acl) | Out-Null }
}
$rootAcl = Get-Acl -LiteralPath $path
if (-not $rootAcl.AreAccessRulesProtected) { throw 'inheritance enabled' }
$items = @((Get-Item -LiteralPath $path)) + @(Get-ChildItem -LiteralPath $path -Force)
foreach ($item in $items) {
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
  $acl = Get-Acl -LiteralPath $item.FullName
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'foreign owner' }
  $allow = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' })
  if ($allow.Count -eq 0) { throw 'no access' }
  foreach ($rule in $allow) { if ($rule.IdentityReference.Value -ne $sid.Value) { throw 'foreign access' } }
  if (@($allow | Where-Object { ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl }).Count -eq 0) { throw 'insufficient owner access' }
}
Write-Output (@{verified=$true;currentUserOnly=$true;mechanism='windows-dacl'} | ConvertTo-Json -Compress)
`

function unavailable(): never { throw new SidecarRpcError('JOURNAL_UNAVAILABLE') }
async function validateLocation(directory: string): Promise<void> {
  if (!isAbsolute(directory) || resolve(directory) !== directory || dirname(directory) === directory) unavailable()
  let current = directory
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) unavailable() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}
async function entries(directory: string): Promise<string[]> {
  const root = await lstat(directory)
  if (!root.isDirectory() || root.isSymbolicLink()) unavailable()
  const files = await readdir(directory)
  if (files.length > 64) unavailable()
  for (const file of files) {
    if (!ownedFile.test(file)) unavailable()
    const info = await lstat(join(directory, file))
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) unavailable()
  }
  return files
}
async function windows(directory: string, action: 'protect' | 'verify'): Promise<PrivateStateEvidence> {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const { stdout } = await promisify(execFile)(executable, ['-NoProfile', '-NonInteractive', '-Command', windowsScript], {
    windowsHide: true, timeout: 10_000, maxBuffer: 4_096,
    env: { SystemRoot: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PLANNERBRIDGE_PRIVATE_DIRECTORY: directory, PLANNERBRIDGE_PRIVATE_ACTION: action },
  })
  const result = JSON.parse(stdout.trim())
  if (result.verified !== true || result.currentUserOnly !== true || result.mechanism !== 'windows-dacl') unavailable()
  return { verified: true, currentUserOnly: true, mechanism: 'windows-dacl' }
}

/** Deployment adapter only. Known workspace exclusions are supplied before launch.
 * Existing nonempty state must already be private; never rewrite unrelated ACLs.
 * Windows evidence comes from actual DACL inspection, not POSIX mode bits. */
export async function protectPrivateStateDirectory(directory: string, excludedRoots: readonly string[]): Promise<PrivateStateEvidence> {
  try {
    const normalized = process.platform === 'win32' ? directory.toLowerCase() : directory
    for (const root of excludedRoots) {
      if (!isAbsolute(root)) unavailable()
      const excluded = (process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)).replace(/[\\/]$/, '')
      if (normalized === excluded || normalized.startsWith(excluded + sep)) unavailable()
    }
    await validateLocation(directory)
    let files: string[] = []
    try { files = await entries(directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (files.length) return await verifyPrivateStateDirectory(directory)
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 })
    if (process.platform === 'win32') await windows(directory, 'protect')
    else { await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error }); await chmod(directory, 0o700) }
    return await verifyPrivateStateDirectory(directory)
  } catch { unavailable() }
}

export async function verifyPrivateStateDirectory(directory: string): Promise<PrivateStateEvidence> {
  try {
    await validateLocation(directory)
    const files = await entries(directory)
    if (process.platform === 'win32') return await windows(directory, 'verify')
    const uid = process.getuid?.()
    if (uid === undefined) unavailable()
    for (const file of [directory, ...files.map(file => join(directory, file))]) {
      const info = await lstat(file)
      if (info.uid !== uid || (info.mode & 0o077) !== 0) unavailable()
    }
    return { verified: true, currentUserOnly: true, mechanism: 'posix-mode' }
  } catch { unavailable() }
}
