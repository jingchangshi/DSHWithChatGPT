#Requires -Version 7
[CmdletBinding()]
param([switch]$BrowserCheck)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'prepare-development-chatgpt.ps1') -Check -Launch -BrowserCheck:$BrowserCheck
exit $LASTEXITCODE
