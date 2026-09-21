# Installation

## Build and install

```powershell
cd <repo>\package
pnpm install
pnpm typecheck
pnpm test
pnpm build

dsh plugin --profile <your-profile> add D:\workspace\DSHWithChatGPT\package
```

The target profile must also expose DSH BrowserUse + the Browser Harness MCP provider. Matching DSH 0.1.6-alpha.1 provider tarballs are kept under `package/tarballs/`.

## Unattended profile defaults

The bundled `cordis.patch.yml` enables:

```yaml
chatgptAppName: DSH with ChatGPT
maxIterations: 12
gitPolicy: commit-push
protectedBranches: [main, master]
tunnelMode: managed
tunnelClientPath: tunnel-client
tunnelIdEnv: CONTROL_PLANE_TUNNEL_ID
tunnelRuntimeApiKeyEnv: CONTROL_PLANE_API_KEY
```

Use `gitPolicy: worktree` if you want ChatGPT review without mandatory commit/push rounds. Use `tunnelMode: external` only when another process already owns a healthy Secure MCP Tunnel lifecycle.

## One-time ChatGPT / Tunnel setup

1. Log into ChatGPT in the Chrome/Edge profile controlled by Browser Harness.
2. Create/enable a read-only custom MCP app. Its exact name must match `chatgptAppName` (default `DSH with ChatGPT`).
3. Create an OpenAI Secure MCP Tunnel and make `tunnel-client` available on `PATH`.
4. Set the tunnel id and runtime API key in the environment that launches DSH:

```powershell
$env:CONTROL_PLANE_TUNNEL_ID="<tunnel_id>"
$env:CONTROL_PLANE_API_KEY="<runtime_api_key>"
```

5. Restart/reload DSH, enter a workspace, and ask it to call `chatgpt_status`.

Expected status:
- `bridgeRunning: true`
- a stable `workspaceId`
- `chatgptAppName` equals the ChatGPT app
- `gitPolicy: commit-push`
- `tunnel.configured: true`
- `tunnel.ready: true`

The local bridge remains Bearer-protected. The secret value is written outside the repository to a mode-0600 file. Managed `tunnel-client` receives it through `MCP_EXTRA_HEADERS` / `MCP_DISCOVERY_EXTRA_HEADERS`; the token is not returned in model-facing status output.

## Browser session

Use a persistent, dedicated Chrome/Edge profile. Login/2FA/CAPTCHA is intentionally human-owned setup. Runtime D2C messages do not require manual App selection: the browser adapter enters `@<chatgptAppName>`, selects the exact visible App candidate, verifies the mention, and only then appends/sends the control envelope.

## Verify the full loop

In a non-protected task branch, ask:

> Use ChatGPT to implement a trivial change, run tests, commit and push it, and keep applying ChatGPT review fixes until DONE.

A successful unattended run should show:
1. INIT with `WORKSPACE_ID`
2. PLAN from ChatGPT with the same `WORKSPACE_ID`
3. local implementation/tests
4. commit + push on a non-protected branch
5. EXECUTED with exact `HEAD`
6. DONE or fix PLAN echoing both `WORKSPACE_ID` and `HEAD`
7. automatic continuation on fix PLAN.

## Uninstall

```powershell
dsh plugin --profile <your-profile> remove dsh-with-chatgpt
Remove-Item "$env:LOCALAPPDATA\dsh-with-chatgpt" -Recurse -Force
```
