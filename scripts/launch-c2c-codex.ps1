#Requires -Version 7
[CmdletBinding()]
param([switch]$BrowserCheck)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'prepare-c2c-codex.ps1') -Check -Launch -BrowserCheck:$BrowserCheck
exit $LASTEXITCODE
