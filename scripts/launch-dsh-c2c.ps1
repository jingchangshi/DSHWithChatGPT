#Requires -Version 7
# Deprecated public compatibility entry; canonical script owns all launch policy.
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgumentList)
$ErrorActionPreference = 'Stop'
Write-Warning 'Deprecated entry: use launch-plannerbridge.ps1.'
& (Join-Path $PSScriptRoot 'launch-plannerbridge.ps1') @ArgumentList
exit $LASTEXITCODE
