#Requires -Version 7
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Check,
    [switch]$Clear
)

$ErrorActionPreference = 'Stop'
$StateRoot = Join-Path $env:LOCALAPPDATA 'dsh-with-chatgpt\product-c2c'
$ConfigPath = Join-Path $StateRoot 'config.json'
$SecretPath = Join-Path $StateRoot 'secrets.dpapi.json'
$TunnelKeys = @('CONTROL_PLANE_API_KEY')

function Fail([string]$Code, [string]$Message) { throw "${Code}: ${Message}" }

function Set-PrivateAcl([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
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
    catch { Fail 'PRODUCT_C2C_CONFIG_INVALID' 'DSH product C2C state is unreadable.' }
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
    if ([string]::IsNullOrWhiteSpace($tunnelId)) { Fail 'PRODUCT_C2C_TUNNEL_ID_REQUIRED' 'Tunnel id cannot be empty.' }
    $config = [ordered]@{ version = 1; tunnel = [ordered]@{ id = $tunnelId } }
    $secrets = [ordered]@{}
    foreach ($key in $TunnelKeys) {
        $inherited = [Environment]::GetEnvironmentVariable($key, 'Process')
        if ([string]::IsNullOrWhiteSpace($inherited)) {
            Write-Host "A DSH-owned Secure MCP Tunnel is required. Complete the one-time authorized setup, then enter ${key}." -ForegroundColor Yellow
            $secure = Read-Host "Enter ${key} (hidden input)" -AsSecureString
            if ($secure.Length -le 0) { Fail 'PRODUCT_C2C_API_KEY_REQUIRED' 'Tunnel API key cannot be empty.' }
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
    Write-Host 'DSH product C2C setup completed. Tunnel state is independent of CodexWithChatGPT.'
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
    $checks.allProductC2CPrerequisitesPresent = ($checks.Values -notcontains $false)
    $checks | ConvertTo-Json
    if (-not $checks.allProductC2CPrerequisitesPresent) { Fail 'PRODUCT_C2C_NOT_CONFIGURED' 'Run -Setup after the one-time Tunnel authorization.' }
}

if ($Clear) { if (Test-Path -LiteralPath $StateRoot) { Remove-Item -LiteralPath $StateRoot -Recurse -Force }; Write-Host 'DSH product C2C state removed.'; exit 0 }
if ($Setup) { New-ProductSetup; if (-not $Check) { exit 0 } }
if ($Check) { Test-ProductReady; exit 0 }
Fail 'USAGE' 'Use -Setup, -Check, or -Clear.'
