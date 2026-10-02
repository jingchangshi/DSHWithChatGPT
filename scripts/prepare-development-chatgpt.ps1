#Requires -Version 7
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Check,
    [switch]$Launch,
    [switch]$ClearLocalConfig,
    [switch]$ResetSecrets,
    [switch]$BrowserCheck,
    [switch]$LegacyOutput
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

# Released DPAPI field names and state path are an explicit compatibility schema.
# Canonical environment inputs are resolved only at this deployment edge.
$CanonicalInputs = @{
    C2C_DSH_CLI = 'DSH_CLI'
    C2C_TUNNEL_CLIENT = 'MCP_EXPOSURE_CLIENT'
    C2C_BROWSER_HARNESS = 'BROWSER_HARNESS_COMPAT_EXECUTABLE'
    C2C_EXECUTION_BASE_URL = 'DSH_EXECUTION_BASE_URL'
    C2C_EXECUTION_API_KEY = 'DSH_EXECUTION_API_KEY'
}
function Read-Input([string]$ReleasedKey) {
    $canonical = $CanonicalInputs[$ReleasedKey]
    if (-not $canonical) { return [Environment]::GetEnvironmentVariable($ReleasedKey, 'Process') }
    $preferred = [Environment]::GetEnvironmentVariable($canonical, 'Process')
    $old = [Environment]::GetEnvironmentVariable($ReleasedKey, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($preferred)) {
        if (-not [string]::IsNullOrWhiteSpace($old) -and $preferred -ne $old) { Write-Warning "Deprecated $ReleasedKey ignored because $canonical is configured." }
        return $preferred
    }
    if (-not [string]::IsNullOrWhiteSpace($old)) { Write-Warning "Deprecated $ReleasedKey used; configure $canonical instead." }
    return $old
}

function Fail([string]$Code, [string]$Message) { throw "${Code}: ${Message}" }

function Set-PrivateAcl([string]$Path) {
    # Only the DACL is being changed; do not request/write an unrelated SACL.
    $item = Get-Item -LiteralPath $Path
    $acl = [System.IO.FileSystemAclExtensions]::GetAccessControl($item, [System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    [System.IO.FileSystemAclExtensions]::SetAccessControl($item, $acl)
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
    $dsh = @((Read-Input 'C2C_DSH_CLI'), (Join-Path $RepoRoot '..\deepseek-harness\apps\cli\lib\bin.js'), (Join-Path $RepoRoot '..\deepseek-harness\apps\cli\dist\bin.js'), (Join-Path $RepoRoot '..\deepseek-harness\apps\cli\src\bin.ts'))
    $tunnel = @((Read-Input 'C2C_TUNNEL_CLIENT'), (Join-Path $env:LOCALAPPDATA 'OpenAI\tunnel-client\v0.0.15\tunnel-client.exe'), 'tunnel-client.exe')
    $browser = @((Read-Input 'C2C_BROWSER_HARNESS'), (Join-Path $env:USERPROFILE '.local\bin\browser-harness-mcp.exe'), (Join-Path $env:USERPROFILE '.local\bin\browser-harness.exe'), 'browser-harness-mcp.exe')
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
        if ([string]::IsNullOrWhiteSpace($encrypted)) { Fail 'MISSING_DEVELOPMENT_CONFIGURATION' 'A required encrypted value is missing.' }
        $result[$key] = Unprotect-Value $encrypted
    }
    $result
}

function New-Setup {
    $executables = Discover-Executables
    $config = Read-Config
    $secrets = [ordered]@{}
    foreach ($key in $SensitiveKeys) {
        $inherited = Read-Input $key
        if (-not $ResetSecrets -and $config -and $config.secrets.$key) { $secrets[$key] = $config.secrets.$key; continue }
        if (-not [string]::IsNullOrWhiteSpace($inherited)) {
            $secrets[$key] = Protect-Value $inherited
            continue
        }
        $inputName = if ($CanonicalInputs[$key]) { $CanonicalInputs[$key] } else { $key }
        Write-Host "Missing ${inputName}: ${SetupHints[$key]}" -ForegroundColor Yellow
        $secure = Read-Host "Enter ${inputName} (hidden input)" -AsSecureString
        $secrets[$key] = $secure | ConvertFrom-SecureString
    }
    Write-Config ([ordered]@{ version = 1; executables = $executables; secrets = $secrets })
    Write-Host 'Development ChatGPT launcher setup completed. Secrets were stored with Windows DPAPI.'
}

function Get-LaunchEnvironment {
    $config = Read-Config
    if (-not $config) { Fail 'MISSING_DEVELOPMENT_CONFIGURATION' 'Run -Setup first.' }
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
    $readinessKey = if ($LegacyOutput) { 'allAcceptancePrerequisitesPresent' } else { 'allDevelopmentPrerequisitesPresent' }
    $checks[$readinessKey] = ($checks.Values -notcontains $false)
    $checks | ConvertTo-Json
    if (-not $checks[$readinessKey]) { Fail 'MISSING_DEVELOPMENT_CONFIGURATION' 'Development prerequisites are incomplete.' }
}

function Test-CodexClosed { if (@(Get-Process -Name codex -ErrorAction SilentlyContinue).Count -gt 0) { Fail 'CODEX_ALREADY_RUNNING' 'Close existing Codex windows before launching a fresh environment.' } }

function Start-Codex {
    Test-CodexClosed
    $envMap = Get-LaunchEnvironment
    foreach ($entry in $envMap.GetEnumerator()) {
        $key = if ($CanonicalInputs[$entry.Key]) { $CanonicalInputs[$entry.Key] } else { $entry.Key }
        [Environment]::SetEnvironmentVariable($key, $entry.Value, 'Process')
    }
    $codex = Resolve-Executable @($env:CODEX_EXE, 'codex.exe', 'codex') 'CODEX'
    Start-Process -FilePath $codex -WorkingDirectory $RepoRoot -WindowStyle Hidden
    Write-Host 'Fresh Codex started with the prepared development ChatGPT environment.'
}

if ($ClearLocalConfig) { if (Test-Path -LiteralPath $StateRoot) { Remove-Item -LiteralPath $StateRoot -Recurse -Force }; Write-Host 'Launcher-owned local configuration removed.'; exit 0 }
if ($Setup) { New-Setup; if (-not $Check -and -not $Launch) { exit 0 } }
if ($Check) { Test-Ready; if ($BrowserCheck) { & (Join-Path $RepoRoot '..\deepseek-harness\scripts\browser-ready.ps1'); if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }; if (-not $Launch) { exit 0 } }
if ($Launch) { Start-Codex; exit 0 }
Fail 'USAGE' 'Use -Setup, -Check, -Launch, or -ClearLocalConfig.'
