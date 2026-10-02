# PlannerBridge Windows deployment

Status: PARTIAL — current Windows primary implementation has scoped source and installed/synthetic evidence. Real model/App acceptance and final global audit remain incomplete. Historical environment snapshots are in `env-win.md`; current evidence is in `acceptance-plan.md`.

| Component | Current configuration | Evidence/state |
|---|---|---|
| Browser A | Codex built-in browser, CodexWithChatGPT development connector | current scoped planning/reviews available; development only, not product evidence |
| Browser B | independent Chrome profile under LocalAppData/DSHWithChatGPT/chrome-product | loopback CDP infrastructure previously VERIFIED; recheck before live acceptance |
| Product CDP | 127.0.0.1:9222 | never expose or forward this port remotely |
| Sidecar | 127.0.0.1:18765 default; configurable literal-loopback port | semantic RPC and separate-process synthetic recovery verified; full live product loop incomplete |
| Windows DSH | related feature branch, Corepack pnpm 11.7.0 | previous build/CLI VERIFIED |
| Executor | deepseek-official / deepseek-flash; provider-default reasoning | real runner launched; no accepted model execution/PLAN chain |
| Plugin | package/, Corepack pnpm 10.34.5 | ordinary Windows suite: 83 files / 1040 pass / 3 original skips at b87c55d; separate producer Git support gate FAILED |
| MCP Bridge | loopback, dynamic private port, random bearer | installed two-process Read/Git boundaries passed with synthetic Sidecar; real Reviewer evidence pending |
| Secure exposure | installed tunnel-client; CONTROL_PLANE variables owned externally | real readiness succeeded; App probe BROWSER_STALE before PLAN; no App data-plane acceptance |

## Composition and startup

Primary Sidecar tasks use protocol v2 and always require a clean, non-protected
task branch with an exact committed HEAD pushed to its configured upstream
before review. Status and the Executor prompt advertise `commit-push` for this
primary path. The historical `gitPolicy: worktree` setting applies only to v1
compatibility review; it cannot relax canonical Git proof. Persisted v1 tasks
retain their original dispatch and evidence iteration semantics.

1. Start Browser B using `scripts/start-product-browser.ps1`; user performs login/2FA/CAPTCHA. Existing unrelated Chrome profiles and processes must not be changed. Verify the listener's actual address, dedicated profile and target before binding.
2. Supply a random Sidecar authentication secret via environment or private user-state credential file, never CLI argv or workspace. Sidecar uses a configured loopback CDP endpoint; the semantic client only knows its loopback RPC endpoint.
3. Start `chat-control-sidecar`, verifying RPC version, startup generation, target binding and authenticated health. No arbitrary methods/navigation/JS pass through RPC.

The packaged `chat-control-sidecar` executable is
`lib/deployment/sidecar-process-entry.js`. It requires deployment environment
references `PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE`,
`PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY`, `PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS`
(JSON array of workspace roots), `PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT`, and
`PLANNERBRIDGE_SIDECAR_TARGET_ID`. The target ID must identify the dedicated
product page; the entry never discovers or selects a first tab. Optional
`PLANNERBRIDGE_SIDECAR_PORT` defaults to 18765 and
`PLANNERBRIDGE_SIDECAR_APP_NAME` defaults to `DSH with ChatGPT`. Credentials
must already exist with protected permissions; the entry creates only its
private journal directory. It emits a bounded ready record without secrets,
and releases CDP on authenticated shutdown or process termination.

With these references supplied, run
`node package/scripts/verify-real-sidecar-entry.mjs <unpacked-package-directory>`
to verify an owned real process, authenticated health, browser readiness,
graceful shutdown and transport closure. This does not send a message or prove
App data access. Use the canonical Planner–Executor runner for that gate.
4. Compose a DSH product profile using supported `dsh` profile launch. Mount PlannerBridge plus native DeepSeek adapter, with `provider: deepseek-official`, `model: deepseek-flash`; omit reasoning overrides. Explicitly omit Browser Harness provider/executable for primary acceptance.
5. Inherit only required credentials from trusted local configuration into task-owned child environment. The existing verification script reads DEEPSEEK_API_KEY from the user's .env without publishing its value. Reading .env for a probe does not configure DSH automatically.
6. Acquire Execution World identity and current capabilities, bind authenticated Bridge and start exclusive secure exposure. Product Custom App must be exactly the configured App; development connector cannot substitute for it.
7. Check local readiness separately from actual App challenge proof, then run a genuine Planner–Executor task. A green doctor is never full acceptance.

The interactive Windows session hosting Browser B must be unlocked, with the
dedicated product page actually visible. Login, composer presence, normal window
bounds and an accepted activation command do not prove this prerequisite.
Read-only diagnostics on 2026-10-02 found foreground `LockApp` and WTS session
flags 0 (locked) while Chrome was visible/not minimized at the native window
level and its document remained hidden. This explains that observed preflight
failure; it is not evidence of a Direct CDP target or DOM extraction defect.
The user must unlock Windows. Never automate unlock credentials, disable the
lock policy, spoof visibility or replace the visibility fence with focus. Recheck
the explicit product target and preserve any existing draft after unlock before
running a no-send semantic preflight and starting real acceptance.

Sidecar deployment configuration is `endpoint`, `authentication`, `rpcVersion`, request/reply deadlines and body limits. When `sidecarProcessCommand` is configured, the deployment layer owns that child process through `SidecarSupervisor`: it starts only after protected credential resolution, waits for authenticated semantic health, fails closed on timeout/exit, and closes the child during runtime disposal. When omitted, the Sidecar remains externally managed. The client does not accept Chrome paths/CDP/Windows/SSH options. Credentials and Sidecar own-state journals stay outside repos; Bridge auth and exposure are distinct from Sidecar auth.

## RPC safety and supervision

Product acceptance remains PARTIAL. The DSH plugin now defaults to `browserMode:
sidecar`; Browser Harness requires the explicit legacy value
`browser-harness-mcp`. The deployment adapter resolves `sidecarEndpoint`
(default `http://127.0.0.1:18765`) and `sidecarCredentialFile` before using the
neutral HTTP client. The default credential reference is
`LOCALAPPDATA/PlannerBridge/credentials/authentication.secret`. It contains a
bare 43–128-character base64url token, with no prefix or newline. Its parent
directory and file must allow only the current owner; Windows verification
inspects actual DACLs. The reader rejects workspace locations, reparse points,
hard links, excessive content and unprotected permissions, and never repairs
an existing credential's ACLs. The delivery journal retains its own separate
filename allowlist. No secret is accepted through plugin tool arguments.

Sidecar credential and authenticated service health checks precede Bridge and
exposure startup. This client adapter does not implicitly launch, adopt or stop
another process. Private state no longer falls back to `process.cwd()` when the
OS state base is missing. The existing legacy state directory is retained until
explicit migration. The optional neutral diagnostic port now forwards browser
readiness facts and exact configured-App selection through authenticated RPC;
see [chat-control-diagnostics.md](chat-control-diagnostics.md) for its write and
restart rules. Real primary readiness and full product acceptance remain pending;
canonical wiring and installed synthetic profile composition have scoped evidence.
Diagnostic unit evidence does not prove Browser B,
native Executor or real App data access.

Sidecar authentication, Workspace Data Plane bearer and external CONTROL_PLANE credentials have independent scopes. Windows credential/state files require a current-user DACL or approved credential protection; POSIX mode 0600 alone proves no Windows isolation. Verify actual ACL protection. Secrets enter task-owned children only through required inherited environment or protected references, never argv/status. Private state paths are deployment-injected outside workspaces with no process.cwd() fallback.

Bind one explicitly selected target in the dedicated Browser B endpoint. Missing or ambiguous targets fail closed; never search other profiles. Full document navigation/reload, target replacement and reconnect invalidate old document fences and pending handles. Same-document History API routing updates URL without replacing the document; conversation policy remains in the shared driver. The proposed Stage E details and dispatch uncertainty limits are in [direct-cdp-contract.md](direct-cdp-contract.md).

Version 1 semantic RPC uses authenticated POST requests, finite method allowlist, bounded UTF-8 body (64 KiB request, bounded reply), string request ID, fixed response/error schema and no permissive CORS. Normal health/readiness/send requests default to a 30-second deadline. waitForReply has its own bounded multi-minute model deadline and separately bounded transport lifetime, not the ordinary short RPC timeout. Explicit cancel(controlOperationId) uses a fresh bounded request independent of the cancelled caller signal. Bind must be literal loopback; reject remote URLs and wildcard addresses. HTTP health discloses no tokens, profile paths or conversation contents; browser readiness remains a separate authenticated semantic fact.

Request IDs are single-use per payload digest; duplicates join/return stored results, conflicts fail. Busy conversation operations are serialized/rejected. Shutdown aborts and drains pending work; cleanup may touch only an owned draft. Restart generation changes invalidate client handles, while persistent delivery journal prevents forgotten sends.

Cancellation targets the durable logical ControlOperation via cancel(controlOperationId), not a transport attempt. The cancel RPC carries its own request ID. Transport retries may use different request IDs for the same operation; cancellation still reaches that operation across retries/reconnect.

Avoid starting a second Sidecar when port/health ownership is unclear. Services are task-owned; never terminate unrelated browser/server processes. Provide explicit start/stop/health commands and logs with secret redaction, no cookies/session storage or private ChatGPT APIs.

## Isolated profile composition verification

Canonical product entry scripts are `scripts/prepare-plannerbridge.ps1`
(`-Setup`, `-Check`, `-Clear`) and `scripts/launch-plannerbridge.ps1` (DSH
arguments forwarded unchanged). They reuse the released protected own-state
directory under `LOCALAPPDATA/dsh-with-chatgpt/product-c2c`; readiness and launch
do not move or rewrite existing DPAPI configuration. `DSH_CLI` selects the
built DSH CLI. Its deprecated `C2C_DSH_CLI` fallback is confined to the
deployment entry; canonical values win conflicts with a value-free warning.
Old product script names are thin compatibility aliases. These entry scripts
load product connection credentials; they do not create or authorize a ChatGPT
App, install a DSH profile, start Chrome/Sidecar, or certify their readiness.
Follow the composition steps above for those prerequisites. No development
connector is invoked by the product entries.

`package/scripts/verify-profile.mjs` owns a separate semantic Sidecar fixture on
an ephemeral loopback port. It generates a random credential in a disposable,
current-user-only directory outside the workspace, passes only the credential
file reference to the DSH profile, and keeps the journal in a separate protected
directory. The fixture deliberately exposes no browser readiness or App proof
and refuses conversation mutations. Its process is closed even on verification
failure. This checks real DSH startup, workspace identity, authenticated Git
reads and reload/restart composition; it does not verify ChatGPT or model
generation. Boot output and profile configuration are checked for token leaks.

## Managed exposure health

The tunnel-client startup `/readyz` endpoint does not attest authenticated
remote polling. Managed exposure readiness also requires its bounded local
`/health?details=true` version 1 snapshot: live/ready, control-plane status `ok`,
a successful poll timestamp, zero consecutive failures, and successful local
MCP startup probing. HTTP 401/403 maps to `TUNNEL_AUTH_FAILED` and startup closes
the owned child. Later degraded health reports not ready. Raw operator health
details are never returned to the model. This remains distinct from real App
tool invocation and independent challenge proof.

On this Windows machine, the product connection needed the existing system
proxy. A task-owned tunnel-client YAML reference can configure only
`control_plane.http_proxy`; the loopback Bridge stays direct. Do not disable
Bridge authentication or change global proxy settings. Configuration and keys
remain outside the workspace. Product App and development connector remain
independent.

## Future deployment scope

Linux execution is FUTURE. The same client talks to configured localhost after deployment-managed secure forwarding to the Windows Sidecar. No Linux Chrome/Browser Harness, remote :9222, SSH lifecycle manager or Linux acceptance is required now. Workspace Data Plane lives with the Executor, not the browser Sidecar.
