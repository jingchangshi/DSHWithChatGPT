#Requires -Version 7
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Check,
    [switch]$Clear,
    [switch]$LegacyOutput # released readiness field, compatibility entry only
)

$ErrorActionPreference = 'Stop'
# Released protected own-state location; no implicit migration.
$StateRoot = Join-Path $env:LOCALAPPDATA 'dsh-with-chatgpt\product-c2c'
$ConfigPath = Join-Path $StateRoot 'config.json'
$SecretPath = Join-Path $StateRoot 'secrets.dpapi.json'
$TunnelKeys = @('CONTROL_PLANE_API_KEY')

function Fail([string]$Code, [string]$Message) { throw "${Code}: ${Message}" }

function Set-PrivateAcl([string]$Path) {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $item = Get-Item -LiteralPath $Path
    $rights = if ($item.PSIsContainer) { '(OI)(CI)F' } else { 'F' }
    & icacls.exe $Path /inheritance:r /grant:r "${identity}:${rights}" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'PLANNERBRIDGE_ACL_FAILED' 'Could not restrict product state to the current user.' }
}

function Protect-Value([string]$Value) {
    ConvertTo-SecureString -String $Value -AsPlainText -Force | ConvertFrom-SecureString
}

function Unprotect-Value([string]$Value) {
    $secure = ConvertTo-SecureString -String $Value
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    catch { Fail 'PLANNERBRIDGE_CONFIG_INVALID' 'PlannerBridge product state is unreadable.' }
}

function Write-Json([string]$Path, $Value) {
    $temp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    $Value | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temp -Encoding utf8NoBOM
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function New-ProductSetup {
    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
    Set-PrivateAcl $StateRoot
    $tunnelId = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_TUNNEL_ID', 'Process')
    if ([string]::IsNullOrWhiteSpace($tunnelId)) { $tunnelId = Read-Host 'Enter CONTROL_PLANE_TUNNEL_ID' }
    if ([string]::IsNullOrWhiteSpace($tunnelId)) { Fail 'PLANNERBRIDGE_TUNNEL_ID_REQUIRED' 'Tunnel id cannot be empty.' }
    $config = [ordered]@{ version = 1; tunnel = [ordered]@{ id = $tunnelId } }
    $secrets = [ordered]@{}
    foreach ($key in $TunnelKeys) {
        $inherited = [Environment]::GetEnvironmentVariable($key, 'Process')
        if ([string]::IsNullOrWhiteSpace($inherited)) {
            Write-Host "A DSH-owned Secure MCP Tunnel is required. Complete the one-time authorized setup, then enter ${key}." -ForegroundColor Yellow
            $secure = Read-Host "Enter ${key} (hidden input)" -AsSecureString
            if ($secure.Length -le 0) { Fail 'PLANNERBRIDGE_API_KEY_REQUIRED' 'Tunnel API key cannot be empty.' }
            $secrets[$key] = $secure | ConvertFrom-SecureString
        } else {
            $secrets[$key] = Protect-Value $inherited
        }
    }
    Write-Json $ConfigPath $config
    Write-Json $SecretPath $secrets
    Set-PrivateAcl $StateRoot
    Set-PrivateAcl $ConfigPath
    Set-PrivateAcl $SecretPath
    Write-Host 'PlannerBridge product setup completed. Protected connection state is independent of the development connection.'
}

function Test-ProductReady {
    $config = Read-Json $ConfigPath
    $secrets = Read-Json $SecretPath
    $checks = [ordered]@{
        productConfig = $null -ne $config -and $config.version -eq 1
        productSecretStore = $null -ne $secrets
        tunnelIdConfigured = $false
        tunnelKeyConfigured = $false
    }
    if ($config) { $checks.tunnelIdConfigured = -not [string]::IsNullOrWhiteSpace([string]$config.tunnel.id) }
    if ($secrets -and -not [string]::IsNullOrWhiteSpace([string]$secrets.CONTROL_PLANE_API_KEY)) {
        try { $checks.tunnelKeyConfigured = -not [string]::IsNullOrWhiteSpace((Unprotect-Value ([string]$secrets.CONTROL_PLANE_API_KEY))) }
        catch { $checks.tunnelKeyConfigured = $false }
    }
    $ready = ($checks.Values -notcontains $false)
    $checks.allProductPrerequisitesPresent = $ready
    if ($LegacyOutput) { $checks.allProductC2CPrerequisitesPresent = $ready } # released JSON compatibility
    $checks | ConvertTo-Json
    if (-not $ready) { Fail 'PLANNERBRIDGE_NOT_CONFIGURED' 'Run -Setup after the one-time Tunnel authorization.' }
}

if ($Clear) { if (Test-Path -LiteralPath $StateRoot) { Remove-Item -LiteralPath $StateRoot -Recurse -Force }; Write-Host 'PlannerBridge product state removed.'; exit 0 }
if ($Setup) { New-ProductSetup; if (-not $Check) { exit 0 } }
if ($Check) { Test-ProductReady; exit 0 }
Fail 'USAGE' 'Use -Setup, -Check, or -Clear.'
