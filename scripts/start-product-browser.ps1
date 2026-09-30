param(
    [string]$ProfilePath = (Join-Path $env:LOCALAPPDATA 'DSHWithChatGPT\chrome-product'),
    [int]$Port = 9222
)
$ErrorActionPreference = 'Stop'
$chromePath = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw 'Google Chrome is not installed.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Inspect the existing service before continuing."
}
$resolvedProfile = [IO.Path]::GetFullPath($ProfilePath)
New-Item -ItemType Directory -Path $resolvedProfile -Force | Out-Null
Start-Process -FilePath $chromePath -ArgumentList @(
    ('--user-data-dir="' + $resolvedProfile + '"'),
    '--remote-debugging-address=127.0.0.1',
    "--remote-debugging-port=$Port",
    '--no-first-run', '--no-default-browser-check', 'https://chatgpt.com/'
) -WindowStyle Normal
$version = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $version = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        break
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $version) { throw 'Chrome started, but its local debugging endpoint could not be verified.' }
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port)
if ($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }) {
    throw 'The debugging listener is not restricted to loopback. Stop this browser before continuing.'
}
[pscustomobject]@{
    Status = 'VERIFIED'
    Profile = $resolvedProfile
    Browser = $version.Browser
    ProtocolVersion = $version.'Protocol-Version'
    DebuggerEndpointPresent = [bool]$version.webSocketDebuggerUrl
}
Write-Host 'Please sign in to ChatGPT manually in this dedicated Chrome window.'
