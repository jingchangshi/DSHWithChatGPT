# DSHWithChatGPT Windows-first Development Environment

> 本次范围：只准备和核实开发前置环境；不实现产品功能、不修复产品逻辑。
> 本机核对日期：2026-09-30（Asia/Shanghai）。实测与源码存在性分别记录；NOT_RUN 不代表通过。
> 本文最初为未跟踪模板。本次仅补充环境事实并新增独立 Chrome 启动脚本。
> 用户已选择 DeepSeek-V4.1-Flash、默认 reasoning，并授权两个仓库使用文档指定 feature 分支。

## 0. Naming and scope

### Canonical terminology

New implementation, documentation, tests, modules, APIs and architecture descriptions MUST use these terms:

```text
DSHWithChatGPT
Planner–Executor Runtime
Planner–Executor Protocol
Planner
Reviewer
Executor
Chat Control
Workspace Data Plane
Planner–Executor E2E
```

The historical term `C2C` is deprecated.

Do NOT introduce new names containing:

```text
C2C
c2c
C2C Runtime
C2C Protocol
C2C acceptance
```

Existing identifiers containing `C2C` are legacy compatibility debt. They may temporarily remain only when required to preserve compatibility, but new code must not depend on the historical terminology.

When touched, migrate legacy identifiers toward neutral/product-oriented names with compatibility handling where necessary.

---

## 1. Current implementation scope

Current P0 target:

```text
Windows 11

ChatGPT Web
high-capability Planner / Reviewer
        ↕
DSHWithChatGPT
Planner–Executor Runtime
        ↕
Windows DSH
low-cost Executor
        ↕
workspace / shell / tests / git
```

Future deployment:

```text
FUTURE — MUST NOT BLOCK CURRENT WORK

Windows:
ChatGPT Web
Chat Control Sidecar

        ↕ secure transport

Linux:
DSH
Execution World
Workspace Data Plane
repo / build / tests / git
```

Rules:

- Windows single-host Planner–Executor E2E is the current P0 acceptance target.
- Linux cross-host deployment is FUTURE.
- Current work must not require a Linux server.
- Windows and future Linux deployment must share the same protocol and core runtime.
- Local vs remote Chat Control is a deployment concern, not a protocol distinction.
- Do not create separate Windows and Linux orchestration implementations.
- Future Linux acceptance must never be reported as verified until actually executed.

---

# 2. Development-time control chain

The system used to DEVELOP DSHWithChatGPT is separate from the product runtime.

Development chain:

```text
Windows Codex Desktop
        ↓
CodexWithChatGPT
        ↓
ChatGPT Web high-thinking model
        ↓
architecture / implementation planning / review
```

Product runtime:

```text
Windows DSH
        ↓
DSHWithChatGPT
        ↓
ChatGPT Web Planner / Reviewer
```

Critical rule:

```text
CodexWithChatGPT is a development-time tool.

It must NOT become a runtime dependency of DSHWithChatGPT.
```

---

# 3. Source repositories

## DSHWithChatGPT

Repository:

```text
https://github.com/jingchangshi/DSHWithChatGPT
```

Windows path:

```text
C:\Users\jingc\workspace\DSHWithChatGPT
```

Current branch:

```text
feat/complete-c2c-runtime
```

NOTE:

```text
The current branch name is historical.
Do not propagate "c2c" into new branch names, modules, APIs or documentation.
Future branch names should use planner-executor/runtime/chat-control terminology.
```

Permission:

```text
read-write
```

Git state:

```text
branch: feat/complete-c2c-runtime
HEAD: 64977d9f359ff6156a6a936c8541a34199a7e7f7
working tree clean: no (new environment document and scripts)
remote push available: NOT_RUN
```

---

## deepseek-harness

Repository:

```text
https://github.com/jingchangshi/deepseek-harness
```

Windows path:

```text
C:\Users\jingc\workspace\deepseek-harness
```

Current branch:

```text
feat/complete-c2c-runtime
```

NOTE:

```text
Branch name is legacy only.
New source terminology must not adopt "c2c".
```

Permission:

```text
read-write when required by architecture
```

Git state:

```text
branch: feat/complete-c2c-runtime
HEAD: 0afd708c288b079096affbfeff4626dcf9a19bf1
working tree clean: yes
```

Execution World package:

```text
packages/execution/execution-world
```

Known version:

```text
@deepseek-ai/dsh-execution-world 0.1.6-alpha.4
```

---

## codex-with-chatgpt

Repository:

```text
https://github.com/XiaoDuoYa/codex-with-chatgpt
```

Windows path:

```text
C:\Users\jingc\workspace\codex-with-chatgpt
```

Purpose:

```text
Development-time Planner / Reviewer support for Codex.
```

Permission:

```text
read-only unless modification is explicitly necessary
```

It is NOT part of the DSHWithChatGPT runtime dependency graph.

---

# 4. Windows host

OS:

```text
Windows 11
```

Architecture:

```text
x86_64
```

Windows build:

```text
10.0.26100; Microsoft Windows 11 家庭中文版
```

Primary shell:

```text
PowerShell 7
```

Tool versions:

```text
pwsh:     7.6.6
git:      2.55.0.windows.3
node:     24.16.0
pnpm:     PATH 11.19.0; Corepack project pins: plugin 10.34.5, DSH 11.7.0
corepack: 0.35.0
python:   missing from PATH; WindowsApps alias is not a Python installation
uv:       missing from PATH; optional for primary Node + Direct CDP development
ssh:      OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2
```

Collect with:

```powershell
$PSVersionTable.PSVersion
git --version
node --version
pnpm --version
corepack --version
python --version
uv --version
ssh -V
```

---

# 5. Codex development agent

Codex Desktop:

```text
installed: yes
platform: Windows 11
```

Capabilities:

```text
edit DSHWithChatGPT: VERIFIED (environment files created)
read deepseek-harness: VERIFIED
edit deepseek-harness if required: NOT_RUN (authorized; no source edits needed)
run PowerShell: VERIFIED
start child processes: VERIFIED
bind localhost ports: VERIFIED (dedicated Chrome on loopback)
create Git commits: NOT_RUN (authorized; no commit required for environment setup)
push task branches: NOT_RUN (authorized; no external push attempted)
```

CodexWithChatGPT:

```text
installed: yes
enabled: yes; local doctor VERIFIED
planning flow verified: VERIFIED; real environment PLAN received via this workspace connector
review flow verified: VERIFIED; independent environment review returned DONE
last verified: 2026-09-30 (local doctor + real environment PLAN/REVIEW)
```

Responsibilities:

```text
Codex:
- source inspection
- implementation
- shell execution
- tests
- Git

ChatGPT through CodexWithChatGPT:
- architecture planning
- stage planning
- architecture review
- implementation review
- exact-HEAD final review
```

---

# 6. Browser isolation

Two browser contexts SHOULD remain separated.

## Browser A — development

Purpose:

```text
CodexWithChatGPT development planning and review
```

Profile:

```text
Codex built-in in-app browser (separate managed context)
```

ChatGPT logged in:

```text
NOT_RUN
```

Automation owner:

```text
CodexWithChatGPT
```

Must NOT be used as product acceptance evidence.

---

## Browser B — product runtime

Purpose:

```text
DSHWithChatGPT Planner–Executor E2E
```

Dedicated Chrome profile:

```text
yes
```

Profile path:

```text
C:\Users\jingc\AppData\Local\DSHWithChatGPT\chrome-product
```

ChatGPT logged in:

```text
yes (user confirmed; DOM login check NOT_RUN)
```

DSH with ChatGPT App visible:

```text
NOT_RUN
```

Exact App name:

```text
DSH with ChatGPT
```

Automation owner:

```text
Chat Control Sidecar
```

Browser A / Browser B isolation verified:

```text
yes; separate profile and browser contexts
```

---

# 7. Chrome CDP for product browser

Enabled:

```text
yes
```

Bind:

```text
127.0.0.1
```

Port:

```text
9222
```

Dedicated user-data-dir:

```text
C:\Users\jingc\AppData\Local\DSHWithChatGPT\chrome-product
```

Chrome startup command:

```text
pwsh -NoProfile -File C:\Users\jingc\workspace\DSHWithChatGPT\scripts\start-product-browser.ps1
```

CDP version endpoint:

```text
http://127.0.0.1:9222/json/version
```

Verified:

```text
yes; listener verified at 127.0.0.1 only
```

Observed:

```text
Browser: Chrome/154.0.8037.93
Protocol-Version: 1.3
webSocketDebuggerUrl present: yes
```

ChatGPT tab visible through:

```text
http://127.0.0.1:9222/json
```

Verified:

```text
yes; /json lists a ChatGPT tab
```

Security invariant:

```text
CDP must remain loopback-only.
Never expose port 9222 to LAN, Internet or future Linux host.
```

---

# 8. Browser Harness compatibility provider

Browser Harness is a legacy-compatible/reference browser provider.

It is NOT the target primary Chat Control implementation.

Installed:

```text
no; command not found in PATH
```

Version:

```text
NOT_RUN — not configured or not independently verified
```

Python runtime:

```text
NOT_RUN — not configured or not independently verified
```

Executable:

```text
NOT_RUN — not configured or not independently verified
```

MCP executable:

```text
NOT_RUN — not configured or not independently verified
```

Doctor:

```text
NOT_RUN (compatibility dependency unavailable)
```

Expected state:

```text
chrome running: ok
daemon alive: ok
active browser connections: ok
Browser Use cloud auth: optional / not required
```

CDP target:

```text
http://127.0.0.1:9222
```

Legacy environment variable if still present:

```text
C2C_BROWSER_HARNESS: missing
```

Classification:

```text
LEGACY_IDENTIFIER
```

Target replacement:

```text
DSH_CHAT_BROWSER_HARNESS
or elimination if no longer required
```

Required for:

```text
Browser Harness compatibility tests only
```

Must NOT be required for:

```text
Sidecar + Direct CDP primary Planner–Executor E2E
```

---

# 9. DSH Windows runtime

DSH source path:

```text
C:\Users\jingc\workspace\deepseek-harness
```

Build on Windows:

```text
yes; corepack pnpm build completed successfully
```

Run on Windows:

```text
yes for CLI --help; live web/model execution NOT_RUN
```

Normal interactive profile:

```text
web
```

Current historical E2E profile:

```text
c2c-e2e
```

Classification:

```text
LEGACY_IDENTIFIER
```

Target profile name:

```text
planner-executor-e2e
```

Migration requirement:

```text
New implementation/tests should use planner-executor-e2e.

Keep c2c-e2e only temporarily if backward compatibility with an
existing script requires it.
```

DSH CLI invocation:

```text
corepack pnpm dsh --help (run in deepseek-harness repository)
```

DSH_HOME:

```text
not configured; use isolated task-owned home for acceptance
```

---

# 10. Execution World

Package present:

```text
yes (source present on selected feature branch; live behavior NOT_RUN)
```

Expected package:

```text
@deepseek-ai/dsh-execution-world
```

ExecutionWorldIdentity:

```text
yes (source present on selected feature branch; live behavior NOT_RUN)
```

ExecutionReadLease:

```text
yes (source present on selected feature branch; live behavior NOT_RUN)
```

bindExecutionReadLease:

```text
yes (source present on selected feature branch; live behavior NOT_RUN)
```

ExecutionGitLease:

```text
yes (source present on selected feature branch; live behavior NOT_RUN)
```

bindExecutionGitLease:

```text
yes (source present on selected feature branch; live behavior NOT_RUN)
```

Mandatory invariants:

```text
ExecutionWorkspaceId is identity only.

ExecutionWorkspaceId is NOT:
- a filesystem handle
- a permission
- an authorization token
- a shell capability

Workspace reads require a current ExecutionReadLease.

Git inspection requires a current ExecutionGitLease.

Provider generation / execution-world affinity must remain intact.

No Host filesystem fallback is allowed.
```

---

# 11. Windows sandbox

Status:

```text
NOT_RUN
```

Backend:

```text
@deepseek-ai/dsh-sandbox-windows-acl (source present)
```

Expected Windows assurance:

```text
hardened-windows
```

Git read policy:

```text
allow-hardened-windows
```

Smoke test performed:

```text
no
```

Result:

```text
NOT_RUN; package unit tests do not prove hardened execution
```

Known limitations:

```text
Live sandbox/lease/affinity acceptance still required; Codex itself runs without sandbox in this session.
```

Do not weaken sandbox, GitLease, ReadLease or affinity guarantees merely to make acceptance pass.

---

# 12. Executor model

This model belongs to DSH Executor execution.

It is independent from the ChatGPT Web Planner / Reviewer.

## Current legacy variables

```text
C2C_EXECUTION_BASE_URL: missing
C2C_EXECUTION_API_KEY:  missing
```

Classification:

```text
LEGACY_IDENTIFIER
```

Do not introduce new code using these names.

Preferred target naming:

```text
DSH_EXECUTION_BASE_URL
DSH_EXECUTION_API_KEY
```

Migration strategy:

```text
1. New code uses DSH_EXECUTION_*.
2. Transitional compatibility may read C2C_EXECUTION_* as fallback.
3. Emit a deprecation diagnostic without exposing values.
4. Remove legacy fallback in a later compatibility-breaking release.
```

Endpoint protocol:

```text
Official DeepSeek API; use native DSH llm-deepseek provider (messages default)
```

DSH provider id:

```text
deepseek-official
```

DSH model id:

```text
deepseek-flash (DeepSeek-V4.1-Flash)
```

Reasoning level:

```text
default; omit reasoningEffort (DSH provider default high)
```

Low-cost Executor intended:

```text
DeepSeek-V4.1-Flash (user choice)
```

Endpoint reachable from Windows:

```text
yes; authenticated GET /models passed
```

Authentication verified without printing secrets:

```text
yes; scripts/verify-executor-env.mjs passed
```

Model smoke test:

```text
not-run
```

---


Official configuration references (checked 2026-09-30):

- https://api-docs.deepseek.com/quick_start/pricing/
- DSH source: packages/llm/llm-deepseek/src/config.ts and README.md
- Public API root: https://api.deepseek.com; native default Messages root: https://api.deepseek.com/anthropic.
- Native credential variable: DEEPSEEK_API_KEY (Process/User/Machine missing; present in C:\Users\jingc\.env; loaded only into verification process).
- DSH_EXECUTION_BASE_URL and DSH_EXECUTION_API_KEY are also missing. No key values were read into output.
- Historical E2E fixture hardcodes another provider/model and must be adapted before DeepSeek acceptance.
# 13. ChatGPT Planner / Reviewer

Surface:

```text
ChatGPT Web
```

Authentication:

```text
existing browser login
```

Model policy:

```text
Use a high-capability / high-thinking ChatGPT model selected through
the ChatGPT Web product.

Do not encode a specific ChatGPT model name into the protocol.
```

Planner / Reviewer responsibilities:

```text
- independently inspect workspace evidence
- generate PLAN
- review exact HEAD
- inspect raw execution evidence
- return another PLAN when fixes are required
- return DONE only after verification
```

Executor responsibilities:

```text
- edit files
- execute shell commands
- run tests
- commit
- push
- report structured execution completion
```

---

# 14. ChatGPT App

Configured:

```text
NOT_RUN
```

Exact name:

```text
DSH with ChatGPT
```

Visible in Browser B:

```text
NOT_RUN
```

App mention/selection verified:

```text
not-tested
```

Real MCP-backed App invocation verified:

```text
not-tested
```

Last verified:

```text
not-run
```

---

# 15. Secure MCP exposure

Current legacy environment variables:

```text
CONTROL_PLANE_TUNNEL_ID: missing
CONTROL_PLANE_API_KEY:   missing
```

These names may remain if they are defined by the external tunnel product.

Do NOT rename externally owned protocol/config names merely for stylistic consistency.

Tunnel client installed:

```text
yes; bundled client directory present
```

Tunnel client path:

```text
C:\Users\jingc\Softwares\tunnel-client-v0.0.15-windows-amd64\tunnel-client.exe (product invocation NOT_RUN)
```

Managed tunnel starts on Windows:

```text
not-tested
```

Tunnel reaches local MCP Bridge:

```text
not-tested
```

ChatGPT App → Tunnel → MCP Bridge verified:

```text
not-tested
```

Workspace Data Plane:

```text
ChatGPT Planner / Reviewer
        ↓
DSH with ChatGPT App
        ↓
Secure MCP Tunnel
        ↓
Windows MCP Bridge
        ↓
WorkspaceRuntimeRegistry
        ↓
active ReadLease / GitLease / execution evidence
```

---

# 16. Chat Control Sidecar

Implementation status:

```text
not-implemented (no target Sidecar/DirectCdp classes in selected source)
```

Target component:

```text
chat-control-sidecar
```

Bind:

```text
127.0.0.1
```

Port:

```text
18765
```

CDP endpoint:

```text
http://127.0.0.1:9222
```

RPC version:

```text
not-yet-defined
```

Authentication:

```text
not-yet-defined
```

Primary runtime path:

```text
DSH
  ↓
Planner–Executor Runtime
  ↓
SidecarChatControlClient
  ↓
127.0.0.1:18765
  ↓
Chat Control Sidecar
  ↓
ChatGptWebDriver
  ↓
DirectCdpPrimitives
  ↓
Chrome / ChatGPT Web
```

Sidecar must NOT expose:

```text
- arbitrary shell
- arbitrary filesystem
- Git
- workspace access
- unrestricted CDP passthrough
- unrestricted browser_js
- generic browser-agent RPC
```

---

# 17. Chat Control abstractions

Target interface:

```text
ChatControl
```

Primary implementation:

```text
SidecarChatControlClient
```

Compatibility implementation:

```text
BrowserHarnessChatControl
```

Do NOT create platform-specific protocol implementations such as:

```text
WindowsChatControl
LinuxChatControl
LocalC2C
RemoteC2C
```

The same SidecarChatControlClient must be usable in both deployment modes.

---

# 18. ChatGPT Web driver

Existing behaviors that must be preserved:

```text
- exact App mention selection
- composer discovery
- assistant reply baseline fencing
- detection of a genuinely new assistant response
- streaming detection
- response settling/stability
- logged-out detection
- App unavailable fail-closed behavior
- conversation recovery/reconnect
- timeout
- cancellation
```

These semantics should live in:

```text
ChatGptWebDriver
```

Browser-specific primitives live below it:

```text
BrowserPrimitives
├─ BrowserHarnessPrimitives
└─ DirectCdpPrimitives
```

Primary path:

```text
ChatGptWebDriver
        ↓
DirectCdpPrimitives
```

Compatibility path:

```text
ChatGptWebDriver
        ↓
BrowserHarnessPrimitives
```

---

# 19. DSH profile configuration

Windows web profile:

```text
NOT_RUN — not configured or not independently verified
```

Mounted browser registry:

```text
@deepseek-ai/dsh-browser-use: NOT_RUN
```

Mounted Browser Harness compatibility provider:

```text
@deepseek-ai/dsh-experimental-browser-use-browser-harness-mcp:
NOT_RUN
```

Compatibility configuration:

```text
command: browser-harness-mcp
cdpUrl: http://127.0.0.1:9222
toolCallTimeoutMs: 30000
requireExistingDaemon: true
record: false
```

Effective config verified:

```text
NOT_RUN
```

DSHWithChatGPT plugin:

```text
installed: NOT_RUN
source: NOT_RUN; package built locally, not installed into a DSH product profile
```

---

# 20. Local ports

Expected ports:

```text
Chrome CDP:
127.0.0.1:9222

Chat Control Sidecar:
127.0.0.1:18765

DSH Web:
NOT_RUN; no DSH web service launched

MCP Bridge:
dynamic; product service NOT_RUN

Secure tunnel local endpoint:
dynamic; product service NOT_RUN
```

Codex may:

```text
bind temporary localhost ports: yes (task-owned only)
terminate task-owned temporary services: yes (task-owned only)
```

Codex must not terminate unrelated user processes.

---

# 21. Git acceptance environment

Planner–Executor E2E uses a disposable Git workspace.

Allowed:

```text
temporary local Git repo: yes (authorized for disposable acceptance)
temporary local bare remote: yes (authorized for disposable acceptance)
temporary task branch: yes (authorized for disposable acceptance)
```

Preferred E2E remote:

```text
local bare Git repository
```

GitHub is NOT required for product E2E acceptance.

Acceptance must prove:

```text
- branch is not protected
- working tree is clean before review
- upstream exists
- local HEAD == upstream HEAD
- Reviewer evaluates the exact submitted HEAD
```

Protected branches:

```text
main
master
No additional protected branches verified.
```

---

# 22. Planner–Executor E2E fixture

Existing historical script:

```text
DSHWithChatGPT/package/scripts/verify-live-c2c.mjs
```

Classification:

```text
LEGACY_IDENTIFIER
```

Target rename:

```text
verify-planner-executor-e2e.mjs
```

Current status:

```text
NOT_RUN
```

Known current limitation:

```text
Existing fixture hardcodes a different Executor provider/model and fullC2CAccepted=false. Sidecar + Direct CDP path is absent.
```

Historical example:

```text
fullC2CAccepted may currently be hardcoded false
```

Target status field:

```text
plannerExecutorAccepted
```

or:

```text
fullAcceptancePassed
```

Do NOT create new fields containing `C2C`.

---

# 23. Execution evidence

Successful tests emit a random evidence marker.

Current historical form may be:

```text
E2E_EVIDENCE=<random nonce>
```

This name is acceptable because it contains no legacy architecture terminology.

Invariant:

```text
The Executor must NOT transmit the evidence nonce through:

- Planner message
- review arguments
- workspace files
- execution summary
- control-plane prose
```

Reviewer must independently retrieve the nonce through:

```text
execution_output
```

This proves the Workspace Data Plane rather than trusting Executor claims.

---

# 24. Network / proxy

Windows network mode:

```text
Windows user-level system proxy enabled; exact proxy product not verified
```

Examples:

```text
direct
ClashParty rule mode
corporate proxy
```

Reachability:

```text
ChatGPT Web: NOT_RUN (shell HEAD unsuccessful; browser login pending)
GitHub: yes (HTTP HEAD 200)
Executor endpoint: yes (GET /models authenticated; deepseek-flash listed)
Secure MCP Tunnel: not-tested
```

Proxy environment:

```text
HTTP_PROXY:  missing
HTTPS_PROXY: missing
NO_PROXY:    missing
```

Do not record credentials.

Localhost bypass must contain:

```text
127.0.0.1
localhost
```

Verified:

```text
no; NO_PROXY missing in current process
```

---

# 25. Secrets policy

Never expose:

```text
DSH_EXECUTION_API_KEY
legacy C2C_EXECUTION_API_KEY
CONTROL_PLANE_API_KEY
bridge bearer tokens
Sidecar authentication tokens
ChatGPT cookies/session credentials
OAuth credentials
SSH private keys
proxy credentials
```

Codex may:

```text
- verify presence
- inherit existing environment values
- use product-approved secret storage
```

Codex may NOT:

```text
- print values
- write values to docs
- write values into fixtures
- commit values
- send values to ChatGPT
```

---

# 26. Codex autonomous permissions

Codex is authorized to:

```text
- inspect all relevant source
- modify DSHWithChatGPT
- inspect deepseek-harness
- modify deepseek-harness when architecture genuinely requires producer changes
- write architecture documentation
- run builds
- run unit tests
- run integration tests
- launch task-owned localhost services
- create disposable repositories
- create disposable local bare remotes
- create temporary branches
- use Browser Harness for compatibility verification
- use Direct CDP against Browser B
- use CodexWithChatGPT for architecture planning/review
- commit changes to the task branch
```

Human intervention is required only for:

```text
- ChatGPT login
- CAPTCHA
- 2FA
- missing real credentials
- irreversible external operations
- Windows administrator actions not already authorized
- genuinely unresolved product decisions
```

Do not ask the user to approve ordinary implementation decisions.

---

# 27. Primary Windows acceptance

Primary path:

```text
Windows DSH
      ↓
Planner–Executor Runtime
      ↓
SidecarChatControlClient
      ↓
Chat Control Sidecar
      ↓
Direct CDP
      ↓
ChatGPT Web
```

Browser Harness must NOT participate in this path.

Status:

```text
NOT_RUN
```

Required checks:

```text
[ ] real ChatGPT PLAN
[ ] low-cost DSH Executor follows PLAN
[ ] real source modification
[ ] real tests
[ ] random E2E_EVIDENCE produced
[ ] Git commit
[ ] push to disposable bare remote
[ ] exact HEAD submitted
[ ] Reviewer independently reads source
[ ] Reviewer independently reads Git data
[ ] Reviewer independently reads execution_output
[ ] Reviewer reports correct evidence nonce
[ ] REVIEW may return another PLAN
[ ] fix iteration executes
[ ] DONE binds exact TASK_ID
[ ] DONE binds exact ITERATION
[ ] DONE binds exact WORKSPACE_ID
[ ] DONE binds exact HEAD
[ ] DSH restart recovery
[ ] Sidecar restart recovery
[ ] Chrome reload handling
[ ] logged-out state fails closed
[ ] primary path requires no Browser Harness
```

---

# 28. Compatibility acceptance

Compatibility path:

```text
Windows DSH
      ↓
BrowserHarnessChatControl
      ↓
Browser Harness
      ↓
Chrome
      ↓
ChatGPT Web
```

Status:

```text
NOT_RUN
```

Purpose:

```text
Backward compatibility and behavior reference only.
```

It must not dictate the primary architecture.

---

# 29. Future Linux deployment

Linux server:

```text
NOT PROVIDED
```

Status:

```text
FUTURE
```

This must NOT block Windows implementation.

Future topology:

```text
Windows
├─ Chrome
└─ Chat Control Sidecar
          ↑
          │ secure forwarded localhost transport
          ↓
Linux
├─ SidecarChatControlClient
├─ Planner–Executor Runtime
├─ DSH
├─ Execution World
├─ MCP Bridge
└─ repo/build/tests/git
```

Required architectural property today:

```text
SidecarChatControlClient always talks to a configured localhost endpoint.

Current Windows:
localhost → local Sidecar

Future Linux:
localhost → securely forwarded Windows Sidecar
```

No platform-specific protocol semantics.

Future Linux must NOT require:

```text
Browser Harness
Linux Chrome
remote exposure of Windows CDP
```

---

# 30. Legacy terminology migration inventory

Codex must inventory existing identifiers containing:

```text
C2C
c2c
```

Classify each as one of:

```text
PUBLIC_COMPATIBILITY
PRIVATE_RENAME_NOW
TEST_RENAME_NOW
DOC_RENAME_NOW
BRANCH_HISTORY_ONLY
EXTERNAL_NAME_DO_NOT_CONTROL
```

Examples likely requiring migration:

```text
C2C_EXECUTION_BASE_URL
C2C_EXECUTION_API_KEY
C2C_BROWSER_HARNESS
C2C_DSH_CLI
C2C_E2E_RUN_ID
C2C_E2E_PHASE
c2c-e2e
verify-live-c2c.mjs
fullC2CAccepted
C2C_E2E_* test names
documentation headings containing C2C
internal classes/functions/types containing C2C
```

Preferred replacements should describe actual responsibility:

```text
DSH_EXECUTION_BASE_URL
DSH_EXECUTION_API_KEY
DSH_CHAT_BROWSER_HARNESS
DSH_CLI
PLANNER_EXECUTOR_RUN_ID
PLANNER_EXECUTOR_PHASE
planner-executor-e2e
verify-planner-executor-e2e.mjs
plannerExecutorAccepted
```

Do not perform blind global string replacement.

Names must reflect architectural ownership.

Compatibility shims must be explicit, documented and temporary.

---

# 31. Known verified facts

Only include actually verified facts.

```text
[VERIFIED] Windows x64 build 26100; Node 24.16.0 meets repository requirements.
[VERIFIED] Both repositories switched to feat/complete-c2c-runtime and dependencies installed.
[VERIFIED] Plugin build and typecheck pass.
[VERIFIED] Dedicated Chrome profile and loopback-only CDP 9222 are ready.
[VERIFIED] DeepSeek /models authentication passed using the local .env credential; deepseek-flash is listed.
[VERIFIED] Execution World 0.1.6-alpha.4 source and read/git lease bindings exist.
```

未执行的 Browser Harness、产品模型协作和真实 sandbox 验收不属于本节 VERIFIED 事实。

---

# 32. Known blockers

Use:

```text
BLOCKING_NOW
BLOCKING_FINAL_WINDOWS_ACCEPTANCE
FUTURE_LINUX_ONLY
NON_BLOCKING
```

Current Linux situation:

```text
FUTURE_LINUX_ONLY:
No Linux execution host is currently provided.

This must not block any Windows implementation, refactoring,
testing or primary acceptance work.
```

Other blockers:

```text
BLOCKING_FINAL_WINDOWS_ACCEPTANCE: product App/tunnel configuration, native Sidecar/Direct CDP implementation, live sandbox and E2E checks.
NON_BLOCKING: Browser Harness, PATH Python and uv absent (compatibility-only tooling).
NON_BLOCKING: prior in-app browser timeout recovered; real environment PLAN received.
FAILED: plugin suite has 1 reproducible failure (browser cancellation cleanup), 403 pass, 3 skip.
```

---

# 33. Status vocabulary

Use exactly:

```text
VERIFIED
FAILED
NOT_RUN
PARTIAL
BLOCKED
FUTURE
NOT_APPLICABLE
```

Never convert:

```text
NOT_RUN
PARTIAL
FUTURE
```

into success.

---

# 34. Goal-mode operating instruction

Before changing source:

1. Read this environment document completely.
2. Read the target architecture.
3. Inventory historical `C2C` terminology before adding new APIs.
4. Do not introduce any new `C2C`-named module, class, type, variable, test, document, protocol field or status.
5. Migrate touched legacy private identifiers to Planner–Executor / Chat Control / Workspace Data Plane terminology.
6. Preserve explicit compatibility only where existing users or external configuration require it.
7. Prioritize Windows Sidecar + Direct CDP + real Planner–Executor E2E.
8. Preserve Browser Harness compatibility without making it part of the primary architecture.
9. Do not require Linux.
10. Keep future cross-host operation possible through transport/deployment abstraction.
11. Use CodexWithChatGPT for architecture planning and staged exact-HEAD review.
12. Keep CodexWithChatGPT out of the product runtime.
13. Do not weaken security invariants for test convenience.
14. Continue all independent work when an external prerequisite is unavailable.
15. Report environment/test states using VERIFIED / FAILED / NOT_RUN / PARTIAL / BLOCKED / FUTURE / NOT_APPLICABLE.
## 35. 本次环境准备与复核

- 两个源码仓库依赖安装完成；使用 Corepack 遵循各自 packageManager，不使用 PATH 上的统一 pnpm 版本覆盖项目要求。
- 插件 build / typecheck：VERIFIED。单元测试：FAILED，403 passed / 3 skipped / 1 failed；browser.spec.ts:168 的取消清理断言独立复跑仍失败。未为本次环境任务修改产品逻辑。
- Chrome 启动：`pwsh -NoProfile -File scripts/start-product-browser.ps1`。保留独立 profile；若 9222 已占用，脚本退出并要求检查现有服务，不终止用户进程。
- DeepSeek 认证检查：`node scripts/verify-executor-env.mjs`；默认从用户主目录 .env 只读取 DEEPSEEK_API_KEY，输出存在性及认证状态，不持久化 key。生成 smoke test：NOT_RUN。
- Python/uv/Browser Harness 尚未安装；它们不是当前 Node + Direct CDP 主路径的前置阻塞。若开展兼容验收再准备这些工具。
- 开发插件本地 doctor：VERIFIED；内置页面控制已恢复，ChatGPT 环境 PLAN / REVIEW：VERIFIED，独立复核返回 DONE。

DSH build：VERIFIED（完整 corepack pnpm build，exit 0）；DSH CLI --help：VERIFIED。
产品服务、模型生成、Windows sandbox 实际执行、App 调用及完整 Planner–Executor E2E：NOT_RUN。

建议 Executor 配置（现有原生 DeepSeek provider；待安装产品 profile 后合并到相应用户层，当前尚未部署）：

```yaml
- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-flash
- id: llm-deepseek
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    # 省略 protocol/baseURL/thinking/reasoningEffort，沿用原生 provider 默认。
```

原生 provider 默认协议为 Messages，reasoningEffort 为 high；这来自当前 DSH 源码。官方文档确认 deepseek-flash 对应 V4.1 Flash 且默认开启 thinking。不将 DSH provider 默认值冒充官网已核实的默认 effort。凭据由启动进程继承，用户主目录 .env 不会自动成为 DSH 环境；运行 DSH 前需通过安全启动配置注入 DEEPSEEK_API_KEY。

## 36. 开发就绪与后续验收边界

Windows development readiness: VERIFIED（基础工具链、源码访问、依赖、构建、CLI、独立 Chrome/CDP 和 Executor 凭据已就绪；真实开发插件 PLAN / REVIEW 已完成，独立复核返回 DONE）。

产品单元测试基线：FAILED。1 个已复现的取消清理测试失败属于待开发修复的问题，不是工具链缺失；保留原始失败状态。

Future Windows product E2E acceptance prerequisites: NOT_RUN。产品 App/managed tunnel 配置、Sidecar 实现、真实 sandbox 和完整 E2E 不作为本轮开发就绪门槛；不声称产品已验收。

本机事实冲突处理：docs/environment-input.md 为历史环境输入，旧的 D:\workspace 路径与工具版本不适用于本机；以本文实测记录为准。

开发插件独立复核：VERIFIED。ChatGPT 通过当前 workspace connector 独立读取环境文件与 prerequisite audit 输出，返回 DONE；明确结论为 Windows development readiness: VERIFIED，未要求追加环境修复。
复核会话：https://chatgpt.com/c/6abd28e4-fb1c-83ee-8302-6daed06a5b2b （环境复核，非产品 E2E）。
本次未修改 package/src 或测试实现，未提交或推送源码。
