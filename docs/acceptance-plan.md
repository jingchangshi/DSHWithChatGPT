# PlannerBridge acceptance and falsification plan

Status: PARTIAL — the full Windows deployment remains unfinished. Stage E is independently accepted at `0f8f91c1b466fb0c836c7c2193a3dc7765239421`; Stage F composition is tests-first work in progress. Earlier rows retain their original baseline snapshot unless explicitly updated below. Every gate uses Goal, Fixture, Action, Expected evidence, Failure condition and Status. Unit/fake evidence never substitutes for browser/model/Windows integration. Only VERIFIED / FAILED / NOT_RUN / PARTIAL / BLOCKED / FUTURE / NOT_APPLICABLE are result statuses.

## Baseline and stages

After architecture DONE, isolated F0 repair and exact-HEAD review must pass before Stage B ports extraction or abstraction restructuring. Source baseline and document-review HEAD are separate evidence.

Stage A records baseline, target/deployment/protocol/migration documents, commits and obtains architecture DONE before structural changes. Stages B–H use tests-first commits with independent exact-HEAD review. Stage I requires real product evidence and final global review. No stage claims success solely from an in-process fake.

| Gate / stage | Goal | Fixture | Action | Expected evidence | Failure condition | Status |
|---|---|---|---|---|---|---|
| Baseline / A | retain observed source baseline | source 5d303f5 and raw output | full original suite | 403 passed / 3 skipped / 1 failed | reproduction mislabeled repair | VERIFIED |
| Architecture / A | freeze reviewed target contracts | target documents and inventory | exact-HEAD review after fix PLAN | DONE for submitted document HEAD | PLAN or unreviewed HEAD counted as approval | PARTIAL |
| F0 / before B | repair cancellation ownership guarantee | original browser.spec plus adversarial hung provider/foreign draft | regression before isolated repair and review | fresh bounded cleanup signal, no extra Enter, foreign draft untouched | weakened/skipped assertion, enlarged timeout, unsafe late mutation | FAILED |
| F1 / B | isolate core ports | import-graph tests and fake ports | run orchestrator with fake ChatControl/StateStore/ExecutionWorkspace/McpExposure | no concrete browser or Cordis dependencies; behavior/reply errors retained | hidden transitive concrete imports or production memory fallback | NOT_RUN |
| F2 / C | one shared Web semantic driver | happy-dom fixture + both primitives adapters | exact/ambiguous/missing App, draft change, old/new replies, streaming/settling, logout, abort, recovery | both adapters run the same semantic suite | transport-specific duplicate DOM logic or permissive App matching | NOT_RUN |
| F3 / E | real DOM/input/event CDP behavior | local non-ChatGPT HTTP page + task-owned tab | connect/list/evaluate/focus/type/click/keyboard/mutation/navigation/close/reconnect | observable page outcomes and invalidated stale handles, bounded abort/timeouts | websocket-only smoke, screenshot normal path, hanging call or unrelated target mutation | VERIFIED |
| F4 / D | narrow authenticated RPC | FakeChatGptWebDriver and separate spawned Sidecar | auth/version/ID/body/deadline/cancel/replay/concurrency/restart/shutdown adversaries | typed errors, bounded results, no arbitrary CDP/JS/FS/shell/Git methods | side effects before auth/validation, duplicate send, leaked secrets, loose passthrough | NOT_RUN |
| F5 / D | same neutral client semantics | identical ChatControl contract suite over fake and HTTP client | execute operation suite and server failure cases | same behavior, only localhost endpoint known to client | client knows OS/CDP/Chrome/SSH, inconsistent cancellation | NOT_RUN |
| F6 / C+H | retain reference compatibility | fake session-gated Browser Harness tools | run shared semantic contract and packaging compatibility | session ownership and exact App semantics retained | compatibility coupled into core/primary path | VERIFIED |
| F6-real | verify installed compatibility executable | real Browser Harness if available | attach only Browser B and run compatibility smoke | genuine upstream process/tool results | mock mislabeled real or primary blocked by missing executable | NOT_RUN |
| F7 / F | isolate DSH integration | real Cordis lifecycle/profile + fake core | tools/prompts/cwd/events/storage mount/unload, native DeepSeek config | disposers remove wiring; valid Session attribution; default provider config | core imports DSH lifecycle; hardcoded old model; missing cwd Host fallback | PARTIAL |
| F8 / G | preserve content authority | current producer leases and hostile boundary fixtures | workspace ID only/missing/stale generation/replacement/traversal/symlink/Git injection/output caps/evidence scopes | denial before provider read; fixed argv/environment; redacted scoped evidence | Host read fallback, stale authority, arbitrary shell, nonce or secrets outside scope | NOT_RUN |
| F9 / G | isolate exposure ownership | fake tunnel child + authenticated Bridge HTTP | start/rebind/failure/abort/restart cleanup/workspace conflict | no key in args/status; matching reservation cleanup; protocol preserved | child leak, key leak, workspace takeover, failure advances protocol | NOT_RUN |
| F10 / G | durable restart/reconciliation | persistent task/journal + independently spawned processes | crash before/after send/ack, DSH/Sidecar restart, Chrome reload, cancelled PLAN/REVIEW | identical IDs/HEAD, reacquired lease, no duplicate INIT/EXECUTED, SEND_UNCERTAIN when proof absent | resend after observation timeout or forgotten in-memory cooldown | NOT_RUN |
| F11 / H | migrate names without hidden compatibility debt | inventory + import/export/script/package checks | scan canonical source/test/docs and invoke explicit old aliases | canonical identifiers neutral; old public edges documented and bounded | blind replace, silently retained private coupling, externally-owned rename | NOT_RUN |
| Package / H | usable installed artifacts | packed tarball + isolated supported DSH profiles | build/typecheck/pack/export/import/profile/sidecar executable checks | all runtime closure included; no development bridge dependency | source-only success, missing files or runtime Codex dependency | NOT_RUN |
| Windows sandbox / G+I | real hardened execution authority | real Windows ACL provider + task workspace | execute root-contained reads and fixed Git queries with hostile escapes | hardened-windows assurance and actual deny evidence | mere mock/metadata, relaxed security for green tests | NOT_RUN |
| Fake-stack / H | workflow under adversarial boundaries | separate Sidecar + fake driver + real Git fixture + persisted core | full plan/fix/review, faults and restart | deterministic identities and commit/push verified | fake result reported as real Web/model acceptance | NOT_RUN |
| Product App proof / I | live Workspace Data Plane | Browser B, real App/exposure, active task lease | remote memory-only challenge + source/Git/output reads | App independently reads challenge and expected workspace facts | expected values pasted into prompt, development connector substituted | NOT_RUN |
| Windows primary / I | genuine Planner–Executor task and fix loop | deterministic broken disposable Git repo + local bare remote + real DSH/DeepSeek/ChatGPT | real PLAN/edit/test/commit/push/exact-HEAD REVIEW/fix/DONE with restarts | machine-verifiable full trace and stdout-only random proof nonce | any prohibited shortcut or missing identity/recovery assertion | NOT_RUN |
| Final review / I | independently audit exact submitted code | all commits/tests/evidence + exact final HEAD | ChatGPT reads source/tests/Git/raw output and full matrix | independent DONE with exact HEAD and scoped remaining FUTURE items | review prose without source/evidence or wrong HEAD | NOT_RUN |
| Cross-host Linux | verify future topology on real hosts | Linux host + secure localhost forwarding | only when hosts provided | same client/protocol, no remote CDP | Windows-only evidence counted as Linux verification | FUTURE |

## Baseline evidence

Stage E independent source audit completed on 2026-10-01 at implementation HEAD
`0f8f91c1b466fb0c836c7c2193a3dc7765239421`. The development reviewer initially
issued a partial approval, which was rejected until all critical browser source,
test suites, real/fake fixtures, contract and readiness script were independently
read. The final scoped DONE belongs to development task `c2c_e7b4`, iteration 5.
Execution records 126–130 retain exact-HEAD full suite (55 files, 668 pass,
3 original skip, 0 fail), typecheck/build, candidate isolated packaging and actual
Browser B readiness. Packaging/readiness preceded the commit, followed only by
source indentation and documentation changes. Real Chrome with synthetic page
content and explicitly injected lifecycle faults remains distinct from real
ChatGPT product acceptance. F6-real and all Planner/App/DSH E2E gates remain
NOT_RUN. See `direct-cdp-contract.md` for the accepted provenance/uncertainty rules.

Stage F first contract run on 2026-10-01: the new DSH composition boundary suite
failed all 3 cases (entry still owns concrete wiring, inbound adapter absent,
primary Sidecar configuration unsupported); all 3 existing neutral core boundary
cases passed. These are expected pre-implementation failures, not regressions
fixed by weakening assertions.

Stage F inbound adapter foundation on 2026-10-01: `dsh-agent.spec.ts` first
failed all 5 cases because the adapter was absent. A neutral agent port and
`DshAgentAdapter` then made these cases pass: argument validation, explicit
Session cwd, pre-dispatch ownership capture, same-object/one-time result
attribution, non-vetoing observation failures, and plugin-fiber unload with
the host still running. The public prompt service owns its contribution effect;
the fixture models this contract rather than requiring duplicate registration.
The product composition now mounts this adapter and remains separate from
Cordis persistence and the outbound execution workspace adapter. The package
entry delegates to `deployment/dsh-runtime.ts`. Observation regressions cover
all inactive task states and unrelated/background commands. These are scoped
contract/integration proofs, not real native Executor or product E2E evidence.
The Sidecar configuration boundary remains intentionally failing until primary
deployment composition is implemented. Stage F remains PARTIAL and unaccepted.
The post-extraction scoped run reports 54 pass / 1 expected failure across
7 files, exit 1; typecheck and build pass. The isolated packed artifact imports
and separate Sidecar process checks also pass. These results do not claim a
full-suite run or primary DSH profile acceptance for this foundation.

2026-10-01, HEAD `5d303f5d3a17ec66e1250432368c09bf88ec0d63`, command `corepack pnpm test` in package/: 31 files, 403 passed / 3 skipped / 1 failed, exit 1. Failing test: browser cancellation cleanup at `tests/browser.spec.ts:168`. Output retained outside workspace and released to development review via CodexWithChatGPT execution_output. Reproduction is not a repair.

## Required adversarial cases

Each row expands into executable cases before its implementation. F1 rejects direct and transitive forbidden imports. F2 covers duplicate visible exact App candidates, auto-completed mention decorators, dirty/foreign composer, stale assistant reply, streaming that pauses longer than settling threshold, logout during wait, cancellation during each mutation and navigation recovery. F3 exercises detached targets and navigation epochs, not just successful connection. F4 includes invalid token, wrong HTTP method, excessive/chunked body, unknown methods/fields, reused ID/different payload and restart after irreversible send. F8 tests provider replacement during an in-flight read and Git output overflow/timeout/environment contamination. F10 crashes independently spawned processes at every delivery journal boundary.

## Real Windows fixture and independent evidence

F1 rejects DSH/Cordis, Browser Harness, CDP, Windows and tunnel imports transitively from core. DshAgentAdapter invokes core use cases; CordisStateStore implements a separate port. F4/F5 test same-ID/payload in-flight joins and replay, conflicts, cancellation races, journal retention and crashes before mutation/Enter, after Enter/acknowledgement/reply observation. F8 distinguishes consumer-local acquisition fences from actual producer lease affinity, without fictional generation metadata. Windows secret protection requires actual DACL inspection.

The new `verify-planner-executor-e2e.mjs` must create an isolated temporary workspace, ordinary non-protected branch, temporary local bare remote and deterministic requirements/tests. Launch only supported DSH profile with real native DeepSeek Executor, product App and Sidecar + Direct CDP. Deliberately omit Browser Harness executable/provider; record profile closure and invoked adapter path.

Successful fixture tests print a freshly random E2E_EVIDENCE nonce to stdout. Observer captures nonce only from attributed test output, outside workspace; never transmit it in PLAN/REVIEW arguments/control message/summary/file. Reviewer obtains it through scoped execution_output and echoes it in SUMMARY. Compare latest successful execution's nonce, reject stale/fabricated values, record which execution ID was independently read. Failed test output cannot generate accepted proof.

Before review and at acceptance, require clean worktree, normal non-protected branch, configured upstream, ahead/behind zero, local HEAD == upstream HEAD == submitted HEAD == reviewed HEAD. DONE also binds exact TASK_ID/ITERATION/WORKSPACE_ID. Include a genuine fix PLAN iteration, DSH restart, Sidecar restart, Chrome reload and logged-out fail-closed check. Restart must preserve round identity and avoid duplicate messages. An observer cannot drive collaboration tools or perform fixture edits on the Executor's behalf.

Acceptance result is derived from recorded assertions, not hardcoded true/false. Unknown/missing/failed critical evidence prevents `plannerExecutorAccepted=true`. Raw secret-bearing values are never published. Runtime nonce is not itself an authentication secret, but must remain confined until independently read to preserve the falsification proof.

## External prerequisites and reporting

Run the logged-out fail-closed check in a task-owned temporary no-login profile, preserving persistent Browser B login. Record actual native DeepSeek generation and the invoked client → Sidecar → shared driver → Direct CDP path. Dependency/profile inspection must prove Browser Harness absent; sandbox assurance requires actual hardened Windows enforcement.

Finish independent architecture/unit/contract/integration/packaging work before asking for real product credentials. At a genuinely external gate, record BLOCKED for that gate with exact prerequisite, continue other work and request only login/2FA/CAPTCHA/real credential input when necessary. Overall goal remains active until full required Windows scope is proven or repeated genuine impasse meets goal blocked policy.

Final matrix includes ARCHITECTURE, SOURCE, PROTOCOL, CHAT_CONTROL, DIRECT_CDP, SIDECAR, DSH_ADAPTER, WORKSPACE_DATA_PLANE, SECURITY, RECOVERY, PACKAGING, TESTS, WINDOWS_E2E, FUTURE_LINUX plus final HEAD, commits, run/pass/fail/skip counts, real evidence, blockers, retained aliases and future work.
