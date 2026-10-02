#Requires -Version 7
[CmdletBinding()]
param([switch]$Setup, [switch]$Check, [switch]$Launch, [switch]$ClearLocalConfig, [switch]$ResetSecrets, [switch]$BrowserCheck)
$ErrorActionPreference = 'Stop'
Write-Warning 'Deprecated entry: use prepare-development-chatgpt.ps1.'
& (Join-Path $PSScriptRoot 'prepare-development-chatgpt.ps1') @PSBoundParameters -LegacyOutput
exit $LASTEXITCODE
