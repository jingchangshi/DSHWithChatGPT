# PlannerBridge Windows deployment

Status: PARTIAL — Stage A target; environment snapshot and command results are in `env-win.md`. Product deployment is not yet accepted.

| Component | Current configuration | Evidence/state |
|---|---|---|
| Browser A | Codex built-in browser, CodexWithChatGPT development connector | previous environment PLAN/REVIEW VERIFIED; architecture review pending |
| Browser B | independent Chrome profile under LocalAppData/DSHWithChatGPT/chrome-product | loopback CDP infrastructure previously VERIFIED; recheck before live acceptance |
| Product CDP | 127.0.0.1:9222 | never expose or forward this port remotely |
| Sidecar | 127.0.0.1:18765 default; configurable literal-loopback port | NOT_RUN; implementation absent at baseline |
| Windows DSH | related feature branch, Corepack pnpm 11.7.0 | previous build/CLI VERIFIED |
| Executor | deepseek-official / deepseek-flash; provider-default reasoning | authentication VERIFIED; generation NOT_RUN |
| Plugin | package/, Corepack pnpm 10.34.5 | previous build/typecheck VERIFIED; current suite FAILED baseline |
| MCP Bridge | loopback, dynamic private port, random bearer | current lease architecture retained; live product proof NOT_RUN |
| Secure exposure | installed tunnel-client; CONTROL_PLANE variables owned externally | real product credentials/App NOT_RUN |

## Composition and startup

1. Start Browser B using `scripts/start-product-browser.ps1`; user performs login/2FA/CAPTCHA. Existing unrelated Chrome profiles and processes must not be changed. Verify the listener's actual address, dedicated profile and target before binding.
2. Supply a random Sidecar authentication secret via environment or private user-state credential file, never CLI argv or workspace. Sidecar uses a configured loopback CDP endpoint; the semantic client only knows its loopback RPC endpoint.
3. Start `chat-control-sidecar`, verifying RPC version, startup generation, target binding and authenticated health. No arbitrary methods/navigation/JS pass through RPC.
4. Compose a DSH product profile using supported `dsh` profile launch. Mount PlannerBridge plus native DeepSeek adapter, with `provider: deepseek-official`, `model: deepseek-flash`; omit reasoning overrides. Explicitly omit Browser Harness provider/executable for primary acceptance.
5. Inherit only required credentials from trusted local configuration into task-owned child environment. The existing verification script reads DEEPSEEK_API_KEY from the user's .env without publishing its value. Reading .env for a probe does not configure DSH automatically.
6. Acquire Execution World identity and current capabilities, bind authenticated Bridge and start exclusive secure exposure. Product Custom App must be exactly the configured App; development connector cannot substitute for it.
7. Check local readiness separately from actual App challenge proof, then run a genuine Planner–Executor task. A green doctor is never full acceptance.

Sidecar deployment configuration is `endpoint`, `authentication`, `rpcVersion`, request/reply deadlines and body limits. The client does not accept Chrome paths/CDP/Windows/SSH options. Credentials and Sidecar own-state journals stay outside repos; Bridge auth and exposure are distinct from Sidecar auth.

## RPC safety and supervision

Stage F implementation is PARTIAL. The DSH plugin now defaults to `browserMode:
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
explicit migration. Canonical profile/process bootstrap and neutral doctor
readiness integration are still pending: the old doctor requires optional
browser-specific readiness/App probes that the current semantic RPC does not
expose. Its failure must not be reported as successful primary readiness.

Sidecar authentication, Workspace Data Plane bearer and external CONTROL_PLANE credentials have independent scopes. Windows credential/state files require a current-user DACL or approved credential protection; POSIX mode 0600 alone proves no Windows isolation. Verify actual ACL protection. Secrets enter task-owned children only through required inherited environment or protected references, never argv/status. Private state paths are deployment-injected outside workspaces with no process.cwd() fallback.

Bind one explicitly selected target in the dedicated Browser B endpoint. Missing or ambiguous targets fail closed; never search other profiles. Full document navigation/reload, target replacement and reconnect invalidate old document fences and pending handles. Same-document History API routing updates URL without replacing the document; conversation policy remains in the shared driver. The proposed Stage E details and dispatch uncertainty limits are in [direct-cdp-contract.md](direct-cdp-contract.md).

Version 1 semantic RPC uses authenticated POST requests, finite method allowlist, bounded UTF-8 body (64 KiB request, bounded reply), string request ID, fixed response/error schema and no permissive CORS. Normal health/readiness/send requests default to a 30-second deadline. waitForReply has its own bounded multi-minute model deadline and separately bounded transport lifetime, not the ordinary short RPC timeout. Explicit cancel(controlOperationId) uses a fresh bounded request independent of the cancelled caller signal. Bind must be literal loopback; reject remote URLs and wildcard addresses. HTTP health discloses no tokens, profile paths or conversation contents; browser readiness remains a separate authenticated semantic fact.

Request IDs are single-use per payload digest; duplicates join/return stored results, conflicts fail. Busy conversation operations are serialized/rejected. Shutdown aborts and drains pending work; cleanup may touch only an owned draft. Restart generation changes invalidate client handles, while persistent delivery journal prevents forgotten sends.

Cancellation targets the durable logical ControlOperation via cancel(controlOperationId), not a transport attempt. The cancel RPC carries its own request ID. Transport retries may use different request IDs for the same operation; cancellation still reaches that operation across retries/reconnect.

Avoid starting a second Sidecar when port/health ownership is unclear. Services are task-owned; never terminate unrelated browser/server processes. Provide explicit start/stop/health commands and logs with secret redaction, no cookies/session storage or private ChatGPT APIs.

## Future deployment

Linux execution is FUTURE. The same client talks to configured localhost after deployment-managed secure forwarding to the Windows Sidecar. No Linux Chrome/Browser Harness, remote :9222, SSH lifecycle manager or Linux acceptance is required now. Workspace Data Plane lives with the Executor, not the browser Sidecar.
