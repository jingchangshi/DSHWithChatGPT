# PlannerBridge installation (Windows primary)

The primary deployment is DSH with native DeepSeek, a dedicated product Chrome,
Chat Control Sidecar / Direct CDP, and the product ChatGPT App. Browser Harness
is an explicit legacy provider, not a primary prerequisite. Product acceptance
is still incomplete; see [acceptance-plan.md](acceptance-plan.md).

## Build and install

Use Node.js >= 20 and pnpm (package declares pnpm 10.34.5). The supported DSH
profile must expose these public peers from `package/package.json`:

| Peer | Minimum version |
|---|---|
| @deepseek-ai/cordis | 4.0.0 |
| @deepseek-ai/dsh-execution-world | 0.1.6-alpha.4 |
| @deepseek-ai/dsh-fs | 0.1.6-alpha.2 |
| @deepseek-ai/dsh-sandbox | 0.1.6-alpha.2 |
| @deepseek-ai/dsh-storage-domain | 0.1.6-alpha.2 |
| @deepseek-ai/dsh-subprocess | 0.1.6-alpha.2 |

```powershell
cd DSHWithChatGPT\package
pnpm install
pnpm typecheck
pnpm test
pnpm build
dsh plugin --profile <your-profile> add <absolute-path-to-package>
```

Use the supported DSH profile workflow to mount its native model adapter with
`provider: deepseek-official` and `model: deepseek-flash`; leave reasoning at
the provider default. Supply `DEEPSEEK_API_KEY` privately to the DSH environment.
Installing this plugin does not configure that model, start Chrome/Sidecar, or
create/authorize the product App. Do not substitute a generic legacy model key.

## Compose the product deployment

Follow [windows-deployment.md](windows-deployment.md) for process startup and
configuration references. Start the dedicated product browser using
`scripts/start-product-browser.ps1`; complete login/2FA/CAPTCHA manually.
Explicitly bind its intended product target. Do not adopt another profile/tab.

The package defaults to `browserMode: sidecar`, semantic endpoint
`http://127.0.0.1:18765`, and exact App name `DSH with ChatGPT`.
Direct CDP is deployment-owned at `http://127.0.0.1:9222`; never expose it remotely.
Sidecar must be running and authenticated before DSH collaboration starts.
The optional managed process is owned by `SidecarSupervisor`; otherwise deployment
owns the separate process. Neither client configuration nor RPC accepts arbitrary
browser scripts, shell, navigation or workspace access.

Keep the three credential scopes separate:

| Scope | Protected input |
|---|---|
| Semantic Sidecar | `sidecarCredentialFile`, default `%LOCALAPPDATA%\PlannerBridge\credentials\authentication.secret` |
| Workspace read-only bridge | runtime-managed independent bearer and protected exposure header reference |
| External secure connection | `CONTROL_PLANE_TUNNEL_ID` and `CONTROL_PLANE_API_KEY` inherited into the owned child |

Use tunnel-client 0.0.15 or a compatible version exposing
`--control-plane.initial-poll-timeout` and `--control-plane.http-proxy`.
If the control plane requires a proxy, supply `CONTROL_PLANE_HTTP_PROXY` in
the DSH launch environment. For example, with an already verified local proxy:

```powershell
$env:CONTROL_PLANE_HTTP_PROXY = 'http://127.0.0.1:7893'
```

The optional `tunnelControlPlaneHttpProxyEnv` config selects another environment
variable name. Its value is a proxy URL; any proxy credentials stay in that
private variable. The owned child receives an `env:` reference for control-plane
requests. The local MCP hop keeps its existing transport and authorization.
Windows desktop proxy settings alone do not configure this child. Loading a
private `.env` remains the launcher's responsibility.

Managed startup requests a 1-second first long-poll wait so an idle tunnel can
prove successful authentication within the existing 20-second startup budget.
Steady polling and its HTTP deadline retain the client's defaults/explicit
operator settings. Readiness still requires a successful authenticated poll,
zero consecutive failures and a successful local MCP probe.

The Sidecar credential file contains a bare 43-128-character base64url secret,
without a prefix or newline. Its file and parent require protected current-user
Windows DACLs outside every workspace. Workspace paths, reparse points, hard
links and unprotected permissions are rejected; the reader never repairs an
existing credential's ACL. Keep credentials out of argv, tool arguments, status,
source control and chat. The model key is another private Executor input.

Windows journal protection verifies the resulting owner and DACL in the same
PowerShell invocation. Sidecar startup independently verifies the directory
before opening its journal and again after acquiring journal ownership.

Canonical product connection entries are `scripts/prepare-plannerbridge.ps1`
(`-Setup`, `-Check`, `-Clear`) and `scripts/launch-plannerbridge.ps1`.
They retain released DPAPI state at
`%LOCALAPPDATA%\dsh-with-chatgpt\product-c2c` without moving or rewriting it
on check/launch. `DSH_CLI` selects the supported built DSH CLI; deprecated
aliases are described in [migration-plan.md](migration-plan.md).
These entries only prepare/load connection state. They do not install a profile,
start Chrome/Sidecar or authorize the App. Launch forwards DSH arguments unchanged
and starts its child in this repository root. Establish the Session's intended
project root through the supported DSH workflow; launch is not a workspace selector.

## Verify readiness and collaboration

In a new DSH Session rooted in the intended workspace, call `chatgpt_doctor`.
Local mode checks authenticated local services, browser/App readiness, workspace
identity and secure exposure. `localReady` is not remote App verification.
Explicit `chatgpt_doctor { mode: "app-proof" }` sends a bounded challenge;
only independently matching App reads establish `appDataPlaneVerified`.
The retained compatibility field `fullC2CVerified` stays false: doctor does not
execute a full task. `execution_output_access=false` outside active review is
expected and does not justify broadening access.

New primary tasks use protocol v2 `[PLANNER_BRIDGE]`. Work on a clean,
non-protected task branch with configured upstream. Test, commit and push before
review; local HEAD must equal upstream HEAD with zero ahead/behind. Historical
`gitPolicy: worktree` only applies to explicit v1 compatibility and cannot relax
primary review. Persisted v1 tasks remain v1.

Ask DSH to obtain PLAN, implement/test/commit/push, report EXECUTED and apply
review fixes until same-round DONE. Replies must bind TASK_ID, ITERATION,
WORKSPACE_ID and exact HEAD. Real acceptance additionally requires independent
raw successful-stdout nonce reads, a fix PLAN and restart/reconnect/DONE without
duplicate sends. Component, installed synthetic profile and fake-stack checks
prove only their stated scope; the real product gate remains pending.

## Uninstall

```powershell
dsh plugin --profile <your-profile> remove dsh-with-chatgpt
```

Preserve shared state, credentials and pending tasks. Do not recursively delete
shared user-state directories to uninstall. Explicit connection clear is scoped
to the product entry's owned directory and should follow task/recovery resolution.
