#Requires -Version 7
[CmdletBinding()]
param([switch]$BrowserCheck)
$ErrorActionPreference = 'Stop'
Write-Warning 'Deprecated entry: use launch-development-chatgpt.ps1.'
& (Join-Path $PSScriptRoot 'launch-development-chatgpt.ps1') @PSBoundParameters
exit $LASTEXITCODE
