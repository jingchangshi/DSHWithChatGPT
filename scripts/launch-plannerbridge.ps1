#Requires -Version 7
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgumentList)

$ErrorActionPreference = 'Stop'
$prepare = Join-Path $PSScriptRoot 'prepare-plannerbridge.ps1'
& $prepare -Check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Retained released own-state compatibility location.
$stateRoot = Join-Path $env:LOCALAPPDATA 'dsh-with-chatgpt\product-c2c'
$productConfig = Get-Content -LiteralPath (Join-Path $stateRoot 'config.json') -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath (Join-Path $stateRoot 'secrets.dpapi.json') -Raw | ConvertFrom-Json
$tunnelId = [string]$productConfig.tunnel.id
$secure = ConvertTo-SecureString -String ([string]$config.CONTROL_PLANE_API_KEY)
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

# Released environment alias is consumed only at this deployment entry edge.
if ($env:DSH_CLI -and $env:C2C_DSH_CLI -and $env:DSH_CLI -ne $env:C2C_DSH_CLI) {
    Write-Warning 'Deprecated C2C_DSH_CLI ignored because DSH_CLI is configured.'
}
$dsh = if ($env:DSH_CLI) { $env:DSH_CLI } elseif ($env:C2C_DSH_CLI) {
    Write-Warning 'Deprecated C2C_DSH_CLI used; configure DSH_CLI instead.'
    $env:C2C_DSH_CLI
} else { Join-Path $PSScriptRoot '..\..\deepseek-harness\apps\cli\lib\bin.js' }
if (-not (Test-Path -LiteralPath $dsh -PathType Leaf)) { throw 'DSH_CLI_NOT_BUILT: build deepseek-harness before product launch.' }
if ([IO.Path]::GetFileName($dsh) -ne 'bin.js' -or $dsh -notmatch '[\\/]apps[\\/]cli[\\/]lib[\\/]') { throw 'DSH_CLI_NOT_BUILT: product launch requires apps\\cli\\lib\\bin.js.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$psi = [Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $node
$psi.WorkingDirectory = (Split-Path -Parent $PSScriptRoot)
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.ArgumentList.Add($dsh)
foreach ($argument in $ArgumentList) { $psi.ArgumentList.Add($argument) }
$psi.Environment['CONTROL_PLANE_TUNNEL_ID'] = $tunnelId
$psi.Environment['CONTROL_PLANE_API_KEY'] = $apiKey
$child = [Diagnostics.Process]::Start($psi)
$child.WaitForExit()
$exitCode = $child.ExitCode
$child.Dispose()
$apiKey = $null
exit $exitCode
