# PlannerBridge migration plan

Status: PARTIAL — Stage A candidate. Inventory is generated from tracked source/config/tests/docs/scripts at baseline; binary tarballs, generated lib and dependency trees are excluded from canonical-name edits. `goal.md` and dated environment snapshots are requirements/evidence, not product API.

Reference snapshots under cwc-research/**, historical e2e logs and retained review dumps are non-actionable evidence and excluded from the ledger. Released product protocol/storage/ignore/App-proof identifiers remain owned compatibility boundaries even when historical documentation mentions them. External attribution and external control-plane/header names retain their exact values.

## Inventory classes and actions

| Occurrence family | Location | Class | Action / canonical responsibility |
|---|---|---|---|
| current feature branch name | both repositories' Git refs, environment snapshots | BRANCH_HISTORY_ONLY | keep user-selected branch; don't introduce new names from it |
| development c2c CLI and skill/connector names | development-only docs/scripts, upstream research/notices | EXTERNAL_NAME_DO_NOT_CONTROL | preserve exact external names; no runtime dependency |
| CONTROL_PLANE_TUNNEL_ID / CONTROL_PLANE_API_KEY | tunnel adapter/config | EXTERNAL_NAME_DO_NOT_CONTROL | retain external product names; provider consumes them only |
| upstream [C2C] attribution | THIRD_PARTY_NOTICES.md / reference-analysis.md | EXTERNAL_NAME_DO_NOT_CONTROL | preserve license/source attribution; not target protocol |
| C2C_EXECUTION_BASE_URL / C2C_EXECUTION_API_KEY | existing Windows launcher scripts + historical runner | PUBLIC_COMPATIBILITY | explicit deprecated launcher fallback only; canonical native Executor uses DEEPSEEK_API_KEY; generic overrides use DSH_EXECUTION_* |
| C2C_DSH_CLI | existing launcher/environment input | PUBLIC_COMPATIBILITY | prefer DSH_CLI; validate exact supported built CLI; temporary alias with safe diagnostic |
| C2C_BROWSER_HARNESS / C2C_TUNNEL_CLIENT | old prepare/launch scripts | PUBLIC_COMPATIBILITY | compatibility-only harness setting and exposure client alias; primary composition does not require harness |
| prepare-c2c-codex.ps1 | repository scripts | PUBLIC_COMPATIBILITY | repository-owned deprecated development launcher alias; canonical prepare-development-chatgpt.ps1; never product dependency |
| prepare-dsh-c2c.ps1 / launch-dsh-c2c.ps1 | existing public user launch scripts | PUBLIC_COMPATIBILITY | thin deprecated aliases to canonical product deployment launcher after parity tests |
| fullC2CVerified | readiness/doctor.ts, tests, installation docs | PUBLIC_COMPATIBILITY | explicit legacy always-false field at adapter edge; new local/App/product acceptance statuses separate |
| C2C_PRETASK_RECOVERY_REQUIRED | orchestrator/ownership.ts + ownership.spec | PRIVATE_RENAME_NOW | neutral PRETASK_RECOVERY_REQUIRED core error; old diagnostic mapping only if public callers require it |
| C2C_E2E_RUN_ID / C2C_E2E_PHASE | runner and evidence observer fixture | TEST_RENAME_NOW | PLANNER_EXECUTOR_RUN_ID / PLANNER_EXECUTOR_PHASE; no hidden legacy dependency |
| DSH_C2C_SMOKE_RUN_ID / DSH_C2C_SMOKE_REPORT | profile verifier/fixture | TEST_RENAME_NOW | PLANNERBRIDGE_PROFILE_RUN_ID / PLANNERBRIDGE_PROFILE_REPORT |
| C2C_TEST_TUNNEL_ID / C2C_TEST_TUNNEL_KEY | tunnel.spec.ts | TEST_RENAME_NOW | EXPOSURE_TEST_TUNNEL_ID / EXPOSURE_TEST_TUNNEL_KEY |
| c2c-e2e/c2c-smoke/profile probe/observer names | verifier scripts, fixtures, temporary dirs/manifests | TEST_RENAME_NOW | planner-executor-e2e / plannerbridge-profile-smoke and responsibility-based fixture names |
| verify-live-c2c.mjs / fullC2CAccepted | package/scripts and package.json | TEST_RENAME_NOW | replace incomplete runner with genuine verify-planner-executor-e2e.mjs; derive plannerExecutorAccepted from assertions |
| c2c-launcher.test.mjs / dsh-product-c2c.test.mjs / c2c-e2e-observer.test.mjs | package/scripts and package.json | TEST_RENAME_NOW | neutral launcher, product deployment and evidence observer test names |
| test:live-c2c / test:product-c2c / test:live-c2c-observer | package.json scripts | PUBLIC_COMPATIBILITY | canonical script names plus temporary documented npm aliases; no new legacy implementation |
| product-c2c state-directory naming | existing Windows product launcher state | PUBLIC_COMPATIBILITY | explicit migration of own-state files; never orphan credentials/pending state |
| C2C prose/comments | source comments/docs/tests | DOC_RENAME_NOW | PlannerBridge / Planner–Executor / Chat Control by actual responsibility |

Full line-level occurrence ledger: `migration-inventory.tsv`, generated with filename/line/identifier/class. Re-run when new touched files appear. Each classified public alias needs owner, removal condition and test; public compatibility is not permission to preserve private coupling.

Deployment canonical inputs are DSH_CLI, DSH_EXECUTION_BASE_URL / DSH_EXECUTION_API_KEY for optional generic overrides, MCP_EXPOSURE_CLIENT, and BROWSER_HARNESS_COMPAT_EXECUTABLE only for the compatibility path. Native DeepSeek uses DEEPSEEK_API_KEY. Canonical development launch wrappers are prepare-development-chatgpt.ps1 and launch-development-chatgpt.ps1/.cmd; product wrappers are prepare-plannerbridge.ps1 and launch-plannerbridge.ps1. Canonical verifier scripts are test:planner-executor-e2e, test:planner-executor-observer and test:plannerbridge-deployment. Cancellation classification is OPERATION_CANCELLED. These names describe target migration, not already implemented aliases.

## Additional legacy boundaries

The ledger covers C2C/c2c and D2C/d2c, including filenames, markers, task prefixes, ignore policies, storage/tool names, App-proof names, cancellation errors, auth headers/realms, DOM attributes and call IDs. Exclude generated artifacts, requirements and retained historical evidence explicitly; preserve external attribution. Public aliases need an owner, canonical replacement, recovery/parity test and removal condition before implementation.

Canonical ignore policy is .plannerbridgeignore. Legacy .d2cignore remains additive; neither policy can un-deny default sensitive paths. Persisted unfinished v1 tasks remain v1 across restart; new tasks use v2. Explicit adapters preserve released storage/control records without mid-task protocol upgrade or destructive overwrite.

`[D2C]`, `d2c_`, `.d2cignore`, `d2c_state` and `d2c_control` are not new canonical architecture names. Preserve released protocol/storage/ignore behavior under explicit compatibility adapters. New wire protocol/version/task IDs are defined in planner-executor-protocol.md. Durable unfinished tasks remain on their original protocol; migrations cannot silently change provider identity, persisted generation or authorization.

DSH package name `dsh-with-chatgpt`, current public collaboration tools and Custom App name `DSH with ChatGPT` remain installer/App compatibility surfaces for this iteration. PlannerBridge product core and module names are neutral; repository rename is deferred. Existing BrowserControl exports remain compatibility aliases only after extraction parity tests.

## Stages and constraints

1. Stage A: document baseline/interfaces/target/inventory; mark old architecture documents as legacy rather than making source claims prematurely. Commit and independent architecture review.
2. Stage B: add falsification import/port tests, then extract provider-neutral core contracts; preserve public behavior and storage adapter semantics.
3. Before Stage B: failing owned-cancellation regression, then isolated bounded cleanup repair and exact-HEAD review without weaker assertions. Stage C extracts the shared driver and BrowserPrimitives with parity tests.
4. Stages D/E: authenticated narrow Sidecar and neutral client; actual local CDP DOM/input tests. Keep RPC allowlist and delivery journal recovery explicit.
5. Stages F/G: DSH adapter, native DeepSeek composition, capability-preserving data plane/exposure adapters and durable reconciliation. No copied producer implementation. A producer change requires consumer failing test + independent review.
6. Stage H: replace private/test identifiers, add public compatibility wrappers and package/profile tests. Old aliases resolve only at entry points; conflicting old/new config is rejected or canonical wins with explicit safe warning, never silent ambiguity.
7. Stage I: independently validate genuine Windows primary E2E and final exact HEAD. Remove acceptance hardcoded booleans instead of relabeling partial output.

No blind global replace, speculative API deletion, historical branch rewrite, forced push, released-state overwrite, externally-owned rename or security weakening. Every stage is a separate commit and review. Compatibility removal is a later documented breaking release after old task/state/profile recovery coverage and migration evidence.

## Stage H incremental evidence (2026-10-02)

The private pre-task recovery diagnostic is now `PRETASK_RECOVERY_REQUIRED`;
its exact-message regression failed before the rename and ownership/integration
contracts passed afterward. Workspace evidence comments and the current DSH
collaboration prompt use responsibility-based names. Upstream license/protocol
attribution and the released always-false `fullC2CVerified` field remain explicit
compatibility boundaries.

The released `verify-live-c2c.mjs` entry is now a thin process alias for
`verify-planner-executor-e2e.mjs`, with the canonical runner as the sole owner of
model, browser, evidence and acceptance policy. It no longer implements a
parallel Browser Harness/generic-model run or a hardcoded acceptance result.
Only `C2C_DSH_CLI` and `C2C_TUNNEL_CLIENT` fall back to `DSH_CLI` and
`MCP_EXPOSURE_CLIENT` when their canonical values are absent. Canonical values
win conflicts; the deprecated entry prints no values. It forwards argument
boundaries and exit status, requires the native `DEEPSEEK_API_KEY`, and does
not reinterpret an old generic provider key as a DeepSeek credential. Four
tests execute the unchanged alias against an independently spawned canonical
child, covering canonical-only, legacy-only and conflicting references plus
forbidden duplicate policy. All four failed against the original entry and
passed after migration. Removal is deferred to a documented breaking release.

F11 remains PARTIAL: legacy deployment launchers, test filenames and outdated
product documentation still require migration/parity and independent review.
