#Requires -Version 7
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Check,
    [switch]$Launch,
    [switch]$ClearLocalConfig,
    [switch]$ResetSecrets,
    [switch]$BrowserCheck
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateRoot = Join-Path $env:LOCALAPPDATA 'dsh-with-chatgpt\c2c-launcher'
$ConfigPath = Join-Path $StateRoot 'config.json'
$SensitiveKeys = @('C2C_EXECUTION_BASE_URL','C2C_EXECUTION_API_KEY','CONTROL_PLANE_API_KEY','CONTROL_PLANE_TUNNEL_ID')
$ExecutableKeys = @('C2C_DSH_CLI','C2C_TUNNEL_CLIENT','C2C_BROWSER_HARNESS')
$SetupHints = @{
    C2C_EXECUTION_BASE_URL = 'Sub2API 的 OpenAI-compatible execution endpoint'
    C2C_EXECUTION_API_KEY = 'Sub2API provider API key'
    CONTROL_PLANE_API_KEY = 'Secure MCP Tunnel control-plane API key'
    CONTROL_PLANE_TUNNEL_ID = 'Secure MCP Tunnel id'
}

function Fail([string]$Code, [string]$Message) { throw "${Code}: ${Message}" }

function Set-PrivateAcl([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Unprotect-Value([string]$Value) {
    $secure = ConvertTo-SecureString -String $Value
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Protect-Value([string]$Value) {
    ConvertTo-SecureString -String $Value -AsPlainText -Force | ConvertFrom-SecureString
}

function Resolve-Executable([string[]]$Candidates, [string]$Name) {
    foreach ($candidate in $Candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        $path = if ([IO.Path]::IsPathRooted($candidate)) { $candidate } else { $command = Get-Command $candidate -ErrorAction SilentlyContinue; if ($command) { $command.Source } }
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return [IO.Path]::GetFullPath($path) }
    }
    Fail "${Name}_NOT_FOUND" 'Required executable was not found.'
}

function Discover-Executables {
    $dsh = @($env:C2C_DSH_CLI, (Join-Path $RepoRoot '..\deepseek-harness\apps\cli\lib\bin.js'), (Join-Path $RepoRoot '..\deepseek-harness\apps\cli\dist\bin.js'), (Join-Path $RepoRoot '..\deepseek-harness\apps\cli\src\bin.ts'))
    $tunnel = @($env:C2C_TUNNEL_CLIENT, (Join-Path $env:LOCALAPPDATA 'OpenAI\tunnel-client\v0.0.15\tunnel-client.exe'), 'tunnel-client.exe')
    $browser = @($env:C2C_BROWSER_HARNESS, (Join-Path $env:USERPROFILE '.local\bin\browser-harness-mcp.exe'), (Join-Path $env:USERPROFILE '.local\bin\browser-harness.exe'), 'browser-harness-mcp.exe')
    [ordered]@{ C2C_DSH_CLI = Resolve-Executable $dsh 'DSH_CLI'; C2C_TUNNEL_CLIENT = Resolve-Executable $tunnel 'TUNNEL_CLIENT'; C2C_BROWSER_HARNESS = Resolve-Executable $browser 'BROWSER_HARNESS' }
}

function Read-Config { if (-not (Test-Path -LiteralPath $ConfigPath)) { return $null }; try { Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json } catch { Fail 'LOCAL_CONFIG_INVALID' 'Launcher configuration could not be read.' } }

function Write-Config($Values) {
    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
    $Values | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigPath -Encoding utf8NoBOM
    Set-PrivateAcl $StateRoot
    Set-PrivateAcl $ConfigPath
}

function Read-Secrets($Config) {
    $result = [ordered]@{}
    foreach ($key in $SensitiveKeys) {
        $encrypted = $Config.secrets.$key
        if ([string]::IsNullOrWhiteSpace($encrypted)) { Fail 'MISSING_C2C_CONFIGURATION' 'A required encrypted value is missing.' }
        $result[$key] = Unprotect-Value $encrypted
    }
    $result
}

function New-Setup {
    $executables = Discover-Executables
    $config = Read-Config
    $secrets = [ordered]@{}
    foreach ($key in $SensitiveKeys) {
        if (-not $ResetSecrets -and $config -and $config.secrets.$key) { $secrets[$key] = $config.secrets.$key; continue }
        $inherited = [Environment]::GetEnvironmentVariable($key, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($inherited)) {
            $secrets[$key] = Protect-Value $inherited
            continue
        }
        Write-Host "Missing ${key}: ${SetupHints[$key]}" -ForegroundColor Yellow
        $secure = Read-Host "Enter ${key} (hidden input)" -AsSecureString
        $secrets[$key] = $secure | ConvertFrom-SecureString
    }
    Write-Config ([ordered]@{ version = 1; executables = $executables; secrets = $secrets })
    Write-Host 'C2C launcher setup completed. Secrets were stored with Windows DPAPI.'
}

function Get-LaunchEnvironment {
    $config = Read-Config
    if (-not $config) { Fail 'MISSING_C2C_CONFIGURATION' 'Run -Setup first.' }
    $executables = Discover-Executables
    foreach ($key in $ExecutableKeys) { if (-not $config.executables.$key) { $config.executables | Add-Member -NotePropertyName $key -NotePropertyValue $executables[$key] } }
    foreach ($key in $ExecutableKeys) { if (-not (Test-Path -LiteralPath $config.executables.$key -PathType Leaf)) { Fail "${key}_NOT_FOUND" 'Configured executable does not exist.' } }
    $secrets = Read-Secrets $config
    $envMap = [ordered]@{}
    foreach ($key in $ExecutableKeys) { $envMap[$key] = [IO.Path]::GetFullPath($config.executables.$key) }
    foreach ($key in $SensitiveKeys) { $envMap[$key] = $secrets[$key] }
    $envMap
}

function Test-Ready {
    $config = Read-Config
    $checks = [ordered]@{}
    foreach ($key in $ExecutableKeys) {
        $configured = if ($config) { [string]$config.executables.$key } else { '' }
        $checks[($key + 'Present')] = -not [string]::IsNullOrEmpty($configured)
        $checks[($key + 'Absolute')] = if ($configured) { [IO.Path]::IsPathRooted($configured) } else { $false }
        $checks[($key + 'Exists')] = if ($configured) { Test-Path -LiteralPath $configured -PathType Leaf } else { $false }
    }
    foreach ($key in $SensitiveKeys) {
        $encrypted = if ($config) { [string]$config.secrets.$key } else { '' }
        $checks[($key + 'Present')] = -not [string]::IsNullOrEmpty($encrypted)
    }
    $checks['allAcceptancePrerequisitesPresent'] = ($checks.Values -notcontains $false)
    $checks | ConvertTo-Json
    if (-not $checks['allAcceptancePrerequisitesPresent']) { Fail 'MISSING_C2C_CONFIGURATION' 'Acceptance prerequisites are incomplete.' }
}

function Test-CodexClosed { if (@(Get-Process -Name codex -ErrorAction SilentlyContinue).Count -gt 0) { Fail 'CODEX_ALREADY_RUNNING' 'Close existing Codex windows before launching a fresh environment.' } }

function Start-Codex {
    Test-CodexClosed
    $envMap = Get-LaunchEnvironment
    foreach ($entry in $envMap.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
    $codex = Resolve-Executable @($env:CODEX_EXE, 'codex.exe', 'codex') 'CODEX'
    Start-Process -FilePath $codex -WorkingDirectory $RepoRoot
    Write-Host 'Fresh Codex started with the prepared C2C environment.'
}

if ($ClearLocalConfig) { if (Test-Path -LiteralPath $StateRoot) { Remove-Item -LiteralPath $StateRoot -Recurse -Force }; Write-Host 'Launcher-owned local configuration removed.'; exit 0 }
if ($Setup) { New-Setup; if (-not $Check -and -not $Launch) { exit 0 } }
if ($Check) { Test-Ready; if ($BrowserCheck) { & (Join-Path $RepoRoot '..\deepseek-harness\scripts\browser-ready.ps1') }; exit 0 }
if ($Launch) { Start-Codex; exit 0 }
Fail 'USAGE' 'Use -Setup, -Check, -Launch, or -ClearLocalConfig.'
