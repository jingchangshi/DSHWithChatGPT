$chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
$legacyBrowserProfile = "$env:LOCALAPPDATA\Google\Chrome-C2C"

& $chrome `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$legacyBrowserProfile" `
  https://chatgpt.com/
