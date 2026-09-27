# Installation

## Build and install

The build removes the package's previous lib directory before compilation, so removed source modules do not remain in packed artifacts.

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

5. Restart/reload DSH, create a new Session in the workspace, and call `chatgpt_doctor` before starting a collaboration round.

`chatgpt_doctor {}` uses local mode: it checks Browser Harness login and exact App selection without sending a message, authenticated loopback workspace reads, and tunnel readiness. `ready` equals `localReady`; neither proves remote App access. Explicit `chatgpt_doctor { mode: "app-proof" }` sends one diagnostic message through the configured App and compares a fresh operation-scoped challenge plus workspace/root/Git facts. Only a matching reply sets `appDataPlaneVerified`; `fullC2CVerified` remains false because doctor does not execute a collaboration round. The diagnostic browser operation is bounded by the smaller of replyTimeoutMs and 90 seconds. Use `chatgpt_status` for task and runtime state.

Expected status from `chatgpt_status`:
- `bridgeRunning: true`
- a stable `workspaceId`
- `chatgptAppName` equals the ChatGPT app
- `gitPolicy: commit-push`
- `tunnel.configured: true`
- `tunnel.ready: true`

The local bridge remains Bearer-protected. The complete Authorization header value is written outside the repository to a mode-0600 file with one trailing LF. Connector metadata is a separate, LF-terminated JSON document. Managed `tunnel-client` receives the header through `MCP_EXTRA_HEADERS` / `MCP_DISCOVERY_EXTRA_HEADERS`; the token is not returned in model-facing status output.

## Browser session

Use a persistent, dedicated Chrome/Edge profile. Login/2FA/CAPTCHA is intentionally human-owned setup. Runtime D2C messages do not require manual App selection: the browser adapter enters `@<chatgptAppName>`, selects the exact visible App candidate, verifies the mention, and only then appends/sends the control envelope.

## Verify the full loop

The browser adapter requires exactly one visible composer, supporting both the legacy input ID and the editable textbox. Missing or ambiguous inputs stop browser actions. Probes and sends refuse an existing draft; clear it manually without sending before retrying. Probes verify a structural App mention, never App-name text alone. Typing and sending require verified composer focus. Failed operations clear only recognized operation-owned text, preserve foreign drafts, and verify empty cleanup. Cleanup or provider failures report an unavailable Browser Harness rather than an absent App. Cancellation keeps cleanup bounded; a successful send is not undone.

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
