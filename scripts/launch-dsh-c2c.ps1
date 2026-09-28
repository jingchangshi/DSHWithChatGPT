#Requires -Version 7
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgumentList)

$ErrorActionPreference = 'Stop'
$prepare = Join-Path $PSScriptRoot 'prepare-dsh-c2c.ps1'
& $prepare -Check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$stateRoot = Join-Path $env:LOCALAPPDATA 'dsh-with-chatgpt\product-c2c'
$productConfig = Get-Content -LiteralPath (Join-Path $stateRoot 'config.json') -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath (Join-Path $stateRoot 'secrets.dpapi.json') -Raw | ConvertFrom-Json
$env:CONTROL_PLANE_TUNNEL_ID = [string]$productConfig.tunnel.id
$secure = ConvertTo-SecureString -String ([string]$config.CONTROL_PLANE_API_KEY)
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

$dsh = if ($env:C2C_DSH_CLI) { $env:C2C_DSH_CLI } else { Join-Path $PSScriptRoot '..\..\deepseek-harness\apps\cli\lib\bin.js' }
if (-not (Test-Path -LiteralPath $dsh -PathType Leaf)) { throw 'DSH_CLI_NOT_BUILT: build deepseek-harness before product launch.' }
& node $dsh @ArgumentList
exit $LASTEXITCODE
