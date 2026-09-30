$chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
$c2cProfile = "$env:LOCALAPPDATA\Google\Chrome-C2C"

& $chrome `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$c2cProfile" `
  https://chatgpt.com/