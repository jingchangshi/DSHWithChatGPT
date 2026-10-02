# PlannerBridge

**ChatGPT plans and reviews. DeepSeek Harness executes.**

PlannerBridge is a Planner/Reviewer–Executor collaboration runtime. Its current
P0 deployment is Windows 11, ChatGPT Web and DSH with DeepSeek-V4.1-Flash
(`deepseek-official` / `deepseek-flash`, provider-default reasoning).
The repository and released DSH package remain named `DSHWithChatGPT` and
`dsh-with-chatgpt` for compatibility.

The Windows implementation has scoped source, packaging, installed-authority
and synthetic workflow evidence. **The real Windows model/App loop and final
global audit are not complete.** See [acceptance-plan](docs/acceptance-plan.md)
for actual results; component and fake-stack passes do not imply product acceptance.

## Windows deployment

```text
ChatGPT Web in dedicated product Chrome
  ↕ ChatGptWebDriver / DirectCdpPrimitives
Chat Control Sidecar (loopback semantic RPC)
  ↕ SidecarChatControlClient
PlannerBridge coordinator / DSH adapter
  ↕ DeepSeek-V4.1-Flash Executor
Execution World → workspace / shell / tests / Git

ChatGPT Custom App
  → secure read-only workspace exposure
  → active ExecutionReadLease / ExecutionGitLease / scoped execution evidence
```

Chat Control carries conversation messages. The workspace data plane lets the
Planner independently read files, Git and raw execution output. Sidecar exposes
no workspace, shell, Git or arbitrary browser-control RPC. Workspace identity
is not authorization: missing, replaced or expired capabilities deny access,
without Host filesystem or shell fallback.

The primary path uses dedicated Chrome and Sidecar; Browser Harness is an
explicit compatibility provider. CodexWithChatGPT is a separate development
planning/review tool and is never a product runtime dependency. Future Linux
execution with the same neutral Sidecar client is **FUTURE**, not a Windows prerequisite.

## Install and configure

Use Node.js ≥ 20, pnpm and a supported DSH profile exposing the public services
required by [package/package.json](package/package.json). See
[installation](docs/installation.md) and [Windows deployment](docs/windows-deployment.md)
for the profile, protected credentials, dedicated browser and Sidecar setup.

```powershell
cd DSHWithChatGPT\package
pnpm install
pnpm typecheck
pnpm test
pnpm build
dsh plugin --profile <your-profile> add <absolute-path-to-package>
```

The package patch configures `browserMode: sidecar`, `gitPolicy: commit-push`
and the Windows `gitReadPolicy: allow-hardened-windows`. Installing it does
not start Chrome/Sidecar, select the Executor model or authorize the product
ChatGPT App. Login, 2FA, CAPTCHA and connection authorization remain user-owned.

Canonical product connection entries are `scripts/prepare-plannerbridge.ps1`
and `scripts/launch-plannerbridge.ps1`. `DSH_CLI` selects the built DSH CLI;
deprecated product entries and environment aliases are documented in the
[migration plan](docs/migration-plan.md). These entries preserve the released
protected state location; they do not install or certify the complete deployment.

## Collaboration flow

In a DSH Session rooted in the intended workspace, request:

> Use ChatGPT to plan and implement this task, test it, commit and push on a task branch, and apply review fixes until DONE.

New primary tasks use the canonical v2 `[PLANNER_BRIDGE]` envelope:

```text
goal → PLAN → Executor edit/test → commit/push
     → EXECUTED → independent REVIEW → DONE or another PLAN
```

Review and DONE bind TASK_ID, ITERATION, WORKSPACE_ID and exact HEAD. The primary
path requires a clean non-protected branch, configured upstream, zero ahead/behind
and local HEAD equal to upstream HEAD. DONE uses the same execution iteration;
a fix PLAN advances it. The old `gitPolicy: worktree` option cannot relax
canonical review. Released v1 tasks keep explicit compatibility dispatch and
their original storage/protocol; they are not silently upgraded.

| DSH tool | Purpose |
|---|---|
| `chatgpt_plan` | Start a task and obtain a plan |
| `chatgpt_review` | Request independent exact-HEAD review |
| `chatgpt_status` | Inspect task and runtime state |
| `chatgpt_doctor` | Check local prerequisites or explicit App proof |
| `chatgpt_reconnect` | Recover the persisted task and conversation |

Local doctor readiness is distinct from `appDataPlaneVerified`, which requires
an explicit live App challenge. Execution-output access can be unavailable
outside an active review. Neither doctor result proves the full product loop.
The final real acceptance additionally requires the Reviewer to independently
read and echo a random successful-test marker found only in raw stdout, plus
the required fix/restart/DONE flow.

## Read-only evidence and compatibility

The product App exposes ten read-only tools: `workspace_info`,
`list_directory`, `read_file`, `search_workspace`, `git_status`,
`git_diff`, `git_log`, `test_status`, `execution_summary` and
`execution_output`. It has no write, shell, commit or push tool. Producer
leases enforce root-safe authority and lifecycle; consumer policy excludes
sensitive files and bounds queries/output. `.plannerbridgeignore` is canonical;
the released `.d2cignore` policy remains additive and cannot un-deny defaults.
Persisted task metadata never grants a capability.

Canonical task state uses `plannerbridge_state`; released `d2c_state` and
other compatibility boundaries remain explicit. To uninstall the plugin, use
`dsh plugin --profile <your-profile> remove dsh-with-chatgpt`. Do not delete
shared state/credential directories to uninstall; preserve pending tasks and
connection state until their ownership and recovery needs are resolved.

## Documents and verification

- [Target architecture](docs/target-architecture.md)
- [Canonical protocol](docs/planner-executor-protocol.md)
- [Windows deployment](docs/windows-deployment.md)
- [Installation](docs/installation.md) and [troubleshooting](docs/troubleshooting.md)
- [Acceptance/evidence matrix](docs/acceptance-plan.md)
- [Migration and legacy compatibility](docs/migration-plan.md)

Build before running child fixtures that import `lib`. The combined
`pnpm run test:plannerbridge-fake-stack` checks actual Git/test/push and
process recovery with a synthetic Planner/browser. The installed profile
verifier checks real DSH composition with a synthetic Sidecar. Neither replaces
`test:planner-executor-e2e` with actual DSH/DeepSeek/ChatGPT App evidence.
The separate native producer Git support timeout remains FAILED in the matrix.

## License

MIT. Adapted in part from [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)
(MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
