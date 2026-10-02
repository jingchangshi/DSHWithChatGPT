#Requires -Version 7
# Deprecated public compatibility entry; canonical script owns all state policy.
[CmdletBinding()]
param([switch]$Setup, [switch]$Check, [switch]$Clear)
$ErrorActionPreference = 'Stop'
Write-Warning 'Deprecated entry: use prepare-plannerbridge.ps1.'
& (Join-Path $PSScriptRoot 'prepare-plannerbridge.ps1') -Setup:$Setup -Check:$Check -Clear:$Clear -LegacyOutput
exit $LASTEXITCODE
