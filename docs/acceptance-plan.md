# PlannerBridge acceptance and falsification plan

Status: PARTIAL — the full Windows deployment remains unfinished. Stage E is independently accepted at `0f8f91c1b466fb0c836c7c2193a3dc7765239421`; Stage F composition is tests-first work in progress. Earlier rows retain their original baseline snapshot unless explicitly updated below. Every gate uses Goal, Fixture, Action, Expected evidence, Failure condition and Status. Unit/fake evidence never substitutes for browser/model/Windows integration. Only VERIFIED / FAILED / NOT_RUN / PARTIAL / BLOCKED / FUTURE / NOT_APPLICABLE are result statuses.

## Baseline and stages

After architecture DONE, isolated F0 repair and exact-HEAD review must pass before Stage B ports extraction or abstraction restructuring. Source baseline and document-review HEAD are separate evidence.

Stage A records baseline, target/deployment/protocol/migration documents, commits and obtains architecture DONE before structural changes. Stages B–H use tests-first commits with independent exact-HEAD review. Stage I requires real product evidence and final global review. No stage claims success solely from an in-process fake.

| Gate / stage | Goal | Fixture | Action | Expected evidence | Failure condition | Status |
|---|---|---|---|---|---|---|
| Baseline / A | retain observed source baseline | source 5d303f5 and raw output | full original suite | 403 passed / 3 skipped / 1 failed | reproduction mislabeled repair | VERIFIED |
| Architecture / A | freeze reviewed target contracts | target documents and inventory | exact-HEAD review after fix PLAN | DONE for submitted document HEAD | PLAN or unreviewed HEAD counted as approval | PARTIAL |
| F0 / before B | repair cancellation ownership guarantee | original browser.spec plus adversarial hung provider/foreign draft | regression before isolated repair and review | fresh bounded cleanup signal, no extra Enter, foreign draft untouched | weakened/skipped assertion, enlarged timeout, unsafe late mutation | VERIFIED |
| F1 / B | isolate core ports | import-graph tests and fake ports | run orchestrator with fake ChatControl/StateStore/ExecutionWorkspace/McpExposure | no concrete browser or Cordis dependencies; behavior/reply errors retained | hidden transitive concrete imports or production memory fallback | VERIFIED |
| F2 / C | one shared Web semantic driver | happy-dom fixture + both primitives adapters | exact/ambiguous/missing App, draft change, old/new replies, streaming/settling, logout, abort, recovery | both adapters run the same semantic suite | transport-specific duplicate DOM logic or permissive App matching | VERIFIED |
| F3 / E | real DOM/input/event CDP behavior | local non-ChatGPT HTTP page + task-owned tab | connect/list/evaluate/focus/type/click/keyboard/mutation/navigation/close/reconnect | observable page outcomes and invalidated stale handles, bounded abort/timeouts | websocket-only smoke, screenshot normal path, hanging call or unrelated target mutation | VERIFIED |
| F4 / D | narrow authenticated RPC | FakeChatGptWebDriver and separate spawned Sidecar | auth/version/ID/body/deadline/cancel/replay/concurrency/restart/shutdown adversaries | typed errors, bounded results, no arbitrary CDP/JS/FS/shell/Git methods | side effects before auth/validation, duplicate send, leaked secrets, loose passthrough | VERIFIED |
| F5 / D | same neutral client semantics | identical ChatControl contract suite over fake and HTTP client | execute operation suite and server failure cases | same behavior, only localhost endpoint known to client | client knows OS/CDP/Chrome/SSH, inconsistent cancellation | VERIFIED |
| F6 / C+H | retain reference compatibility | fake session-gated Browser Harness tools | run shared semantic contract and packaging compatibility | session ownership and exact App semantics retained | compatibility coupled into core/primary path | VERIFIED |
| F6-real | verify installed compatibility executable | real Browser Harness if available | attach only Browser B and run compatibility smoke | genuine upstream process/tool results | mock mislabeled real or primary blocked by missing executable | NOT_RUN |
| F7 / F | isolate DSH integration | real Cordis lifecycle/profile + fake core | tools/prompts/cwd/events/storage mount/unload, native DeepSeek config | disposers remove wiring; valid Session attribution; default provider config | core imports DSH lifecycle; hardcoded old model; missing cwd Host fallback | PARTIAL |
| F8 / G | preserve content authority | current producer leases and hostile boundary fixtures | workspace ID only/missing/stale generation/replacement/traversal/symlink/Git injection/output caps/evidence scopes | denial before provider read; fixed argv/environment; redacted scoped evidence | Host read fallback, stale authority, arbitrary shell, nonce or secrets outside scope | VERIFIED |
| F9 / G | isolate exposure ownership | fake tunnel child + authenticated Bridge HTTP | start/rebind/failure/abort/restart cleanup/workspace conflict | no key in args/status; matching reservation cleanup; protocol preserved | child leak, key leak, workspace takeover, failure advances protocol | PARTIAL |
| F10 / G | durable restart/reconciliation | persistent task/journal + independently spawned processes | crash before/after send/ack, DSH/Sidecar restart, Chrome reload, cancelled PLAN/REVIEW | identical IDs/HEAD, reacquired lease, no duplicate INIT/EXECUTED, SEND_UNCERTAIN when proof absent | resend after observation timeout or forgotten in-memory cooldown | PARTIAL |
| F11 / H | migrate names without hidden compatibility debt | inventory + import/export/script/package checks | scan canonical source/test/docs and invoke explicit old aliases | canonical identifiers neutral; old public edges documented and bounded | blind replace, silently retained private coupling, externally-owned rename | PARTIAL |
| Package / H | usable installed artifacts | packed tarball + isolated supported DSH profiles | build/typecheck/pack/export/import/profile/sidecar executable checks | all runtime closure included; no development bridge dependency | source-only success, missing files or runtime Codex dependency | PARTIAL |
| Windows sandbox / G+I | real hardened execution authority | real Windows ACL provider + task workspace | execute root-contained reads and fixed Git queries with hostile escapes | hardened-windows assurance and actual deny evidence | mere mock/metadata, relaxed security for green tests | NOT_RUN |
| Fake-stack / H | workflow under adversarial boundaries | separate Sidecar + fake driver + real Git fixture + persisted core | full plan/fix/review, faults and restart | deterministic identities and commit/push verified | fake result reported as real Web/model acceptance | NOT_RUN |
| Product App proof / I | live Workspace Data Plane | Browser B, real App/exposure, active task lease | remote memory-only challenge + source/Git/output reads | App independently reads challenge and expected workspace facts | expected values pasted into prompt, development connector substituted | NOT_RUN |
| Windows primary / I | genuine Planner–Executor task and fix loop | deterministic broken disposable Git repo + local bare remote + real DSH/DeepSeek/ChatGPT | real PLAN/edit/test/commit/push/exact-HEAD REVIEW/fix/DONE with restarts | machine-verifiable full trace and stdout-only random proof nonce | any prohibited shortcut or missing identity/recovery assertion | NOT_RUN |
| Final review / I | independently audit exact submitted code | all commits/tests/evidence + exact final HEAD | ChatGPT reads source/tests/Git/raw output and full matrix | independent DONE with exact HEAD and scoped remaining FUTURE items | review prose without source/evidence or wrong HEAD | NOT_RUN |
| Cross-host Linux | verify future topology on real hosts | Linux host + secure localhost forwarding | only when hosts provided | same client/protocol, no remote CDP | Windows-only evidence counted as Linux verification | FUTURE |

## Baseline evidence

Current regression evidence (2026-10-01): F0 browser cancellation and cleanup
tests pass `21/21`; F1 core dependency/port boundaries and F2 shared Web
semantic parity suites pass `132/132` in a single-worker run. These local gates
are verified independently of the final ChatGPT exact-HEAD review.

The F8 Workspace Data Plane boundary suites pass `48/48`, covering producer
lease authority, stale/replaced capabilities, containment, fixed Git queries,
bounded output and scoped evidence. The separate real Windows ACL gate remains
`NOT_RUN` until an actual hardened provider denial is observed.

F9/F10 supporting suites pass `74/74`: authenticated loopback Bridge and tunnel
credential boundaries, coordinator restart/recovery, Sidecar crash/replay and
uncertainty handling. These remain `PARTIAL` because live tunnel ownership and
the complete DSH/Chrome reload sequence are not exercised here.

2026-10-01 current HEAD evidence: the authenticated semantic RPC, separate
Sidecar lifecycle and neutral client suites run serially with 13 files and 140
passing tests. The packaged artifact verification also passed after the pnpm 11
workspace override fix; the real DSH profile smoke and native model generation
remain unrun. These results support F4/F5 but do not promote any live product
or Windows E2E gate.

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
At this foundation commit the Sidecar configuration boundary remained an
expected failure pending primary composition. Stage F remained PARTIAL and
unaccepted.
The post-extraction scoped run reports 54 pass / 1 expected failure across
7 files, exit 1; typecheck and build pass. The isolated packed artifact imports
and separate Sidecar process checks also pass. These results do not claim a
full-suite run or primary DSH profile acceptance for this foundation.

Stage F primary client candidate on 2026-10-01: 10 credential tests first failed
on the missing reader; client/default-path tests then reported 8 expected
failures and 2 preserved boundary passes. The actual plugin also failed a new
startup-order test because it tried exposure before a missing credential was
detected. Implemented deployment-owned credential verification, neutral
Sidecar client forwarding, explicit compatibility opt-in and health-before-
exposure ordering made these gates pass. A Windows PowerShell parameter-set
error in the initial ACL verifier and a TypeScript return-type error were fixed
without relaxing checks. Credential evidence includes actual Windows DACL
inspection and rejection after broadening file access. The old delivery-journal
filename allowlist remains unchanged.

The bounded full suite (`corepack pnpm exec vitest run --maxWorkers=2`) reports
59 files, 707 pass / 3 original skip / 0 fail, duration 155.87 seconds. An initial
command misforwarded `--`, leaving the worker limit inactive; its 703 pass /
4 process-startup failures / 3 skip result is retained separately. No test
timeout or assertion was weakened. Typecheck/build and isolated package checks
pass. Two supported DSH launches from the explicit legacy identity fixture
also pass alias/restart/reload and hardened Windows fixed Git checks; its
browser-tool fixture is not primary Browser B or native model evidence.

After that full run, an additional bundle-closure test exposed the profile
patch's silent compatibility override (1 fail / 4 pass). Changing that patch
to explicit Sidecar mode and endpoint yields 5 boundary passes. The full-suite
count above predates this additional case. Canonical Sidecar process/profile
bootstrap and neutral browser/App diagnostic forwarding remain pending;
independent PLAN4 is planning input, not Stage F acceptance. Native Executor
generation and the complete primary Planner/App/DSH E2E remain NOT_RUN.

Stage F optional diagnostics candidate on 2026-10-01: tests first recorded six
missing-interface failures, six typed-error classification failures (three
legacy cases preserved), and a neutral-cancellation failure before their fixes.
The optional core diagnostics port and authenticated `readiness`/`probeApp`
methods now preserve observed facts, exact deployment App binding, bounded
arguments, active-provider exclusion and owned composer semantics. App probes
use separate `probing-app`/`observed-app` journal states: cancellation/restart
cannot authorize repeated selection, and accepted old-generation probes cannot
claim fresh App availability. Doctor retains typed failures and propagates
cancellation while preserving existing App proof prerequisites.

The final candidate full run reports 60 files, 725 pass / 3 original skip /
0 fail, duration 146.78 seconds. The earlier 724-pass run predates the neutral
cancellation regression. Typecheck/build pass. Isolated packaging first found
two missing diagnostic type exports (TS2305); after adding them, the installed
artifact passes strict type compilation, isolated imports and separate Sidecar
replay/shutdown checks. These are candidate source/contract proofs, not Stage F
acceptance. The canonical owned process and native DSH profile, real primary
doctor/App verification and complete Windows E2E still require execution.

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

Real product attempt (2026-10-02): the canonical Planner–Executor runner
launched a real native DeepSeek Executor, protected authenticated Sidecar with
the shared semantic driver/Direct CDP, and managed product exposure. The first
local doctor reported `localReady=true`; subsequent App proof did not return
verified facts, followed by `BROWSER_TARGET_CHANGED` / `BROWSER_STALE`.
`plannerExecutorAccepted=false`; no implementation/test/commit/review loop was
accepted. A factless browser reply and a failed reply observation remain
distinct evidence; the transport cause must not be inferred from the reply.
The development connection remains separate and working. An external App
probe after the DSH child exited returned HTTP 429; this is not proof of the
original App failure's cause.

The packaged canonical `chat-control-sidecar` entry was then run as an owned
real process: authenticated health, real logged-in browser readiness,
authenticated shutdown, zero process exit and transport closure passed. This
proves executable composition/lifecycle only, not App data-plane or planning
acceptance. Diagnostic regression cases preserve typed transport/target
failures during proof without automatic resend; missing facts do not corrupt
a subsequent local probe. Generic operation-state additions are deferred until
a reproducing test demonstrates a need; existing target fencing stays intact.

Profile bootstrap repair evidence (2026-10-01): the canonical isolated DSH
runner initially failed with `SIDECAR_CREDENTIAL_UNAVAILABLE`. The runner now
owns a protected disposable credential reference and a separate semantic
Sidecar fixture. Two real DSH launches passed identity preservation across
aliases/restart and plugin reload, authenticated workspace/Git reads, unchanged
repository contents and Bridge closure. The fixture lifecycle/authentication
test passed; 12 focused profile/credential tests passed, including actual
Windows permission rejection. This is composition evidence only: real Browser
B, product App proof, native model generation and full Windows E2E remain
NOT_RUN. Stage F and Package stay PARTIAL pending independent review and the
remaining product gates.

Run the logged-out fail-closed check in a task-owned temporary no-login profile, preserving persistent Browser B login. Record actual native DeepSeek generation and the invoked client → Sidecar → shared driver → Direct CDP path. Dependency/profile inspection must prove Browser Harness absent; sandbox assurance requires actual hardened Windows enforcement.

Finish independent architecture/unit/contract/integration/packaging work before asking for real product credentials. At a genuinely external gate, record BLOCKED for that gate with exact prerequisite, continue other work and request only login/2FA/CAPTCHA/real credential input when necessary. Overall goal remains active until full required Windows scope is proven or repeated genuine impasse meets goal blocked policy.

Final matrix includes ARCHITECTURE, SOURCE, PROTOCOL, CHAT_CONTROL, DIRECT_CDP, SIDECAR, DSH_ADAPTER, WORKSPACE_DATA_PLANE, SECURITY, RECOVERY, PACKAGING, TESTS, WINDOWS_E2E, FUTURE_LINUX plus final HEAD, commits, run/pass/fail/skip counts, real evidence, blockers, retained aliases and future work.

Product rebuild evidence (2026-10-02): under explicit user authorization, the
stale product App was deleted and a new `DSH with ChatGPT` App was created with
the selected connection independently matched to local configuration. Direct
remote polling had 60 network failures while `/readyz` still returned 200.
Task-only proxy configuration restored reachability and exposed HTTP 401.
After the user updated the local runtime credential, authenticated polling
became healthy with successful timestamps and zero failures. New product App
creation/connection and discovery of ten tools passed. This is PARTIAL App
evidence, not independent workspace challenge proof or Windows E2E acceptance.

Exposure false-ready regression gate:
- Goal: refuse remote exposure readiness based only on local startup health.
- Fixture: owned fake child and actual tunnel-client operator schema, including
  readyz=200 with auth rejection, unobserved/incomplete/oversized health,
  degraded polling and failed local MCP startup probe.
- Action: ensure/status/close; separately run doctor with exposure not ready.
- Expected evidence: auth rejection fails startup and closes owned child;
  incomplete state never reports ready; later degradation invalidates status;
  doctor local/App/full flags remain false without ready exposure.
- Failure condition: any false-ready result or leaked owned child.
- Status: PARTIAL pending exact-HEAD independent review and real updated runtime.

Exact-identity E2E oracle gate:
- Goal: refuse stale DONE, old successful nonce, borrowed readiness and successful
  executor exits without independently accepted final evidence.
- Fixture: execute the real runner's final reporting/exit block against ordered
  independent observer events and adversarial task/workspace/iteration/HEAD data.
- Action: correlate final review result with its unique dispatch, the latest
  successful test result and its frozen pre-dispatch identity, plus a matching
  persisted phase-one checkpoint and phase-two reconnect before new execution.
- Expected evidence: exact reviewed/pushed HEAD, clean ordinary branch, zero
  ahead count, same task/workspace/round, latest random output marker, explicit
  local and App proof from the planner's session; all failures exit nonzero.
- Failure condition: any stale, missing, mismatched or leaked evidence accepted.
- Status: PARTIAL pending implementation verification and independent review.

DSH plan/review results now carry workspaceId and head projected only from the
coordinator-validated reviewer envelope. Reconnect reports its resolved
workspaceId. These additive result fields let the external observer verify the
full identity without treating executor-supplied arguments as reviewer facts.

DSH schema compatibility regression (2026-10-02): the real packed run at
`73eb429` finished with `plannerExecutorAccepted=false` and exit 1. Its boot
log identifies an unsupported `head.type` array; the collaboration plugin did
not activate, and no local/App readiness, PLAN or REVIEW was executed. The
previous mock registration contract did not enforce the consumer's schema
subset. A packed-plugin consumer check now loads the actual built DSH schema
validator and reproduced the same failure before the repair. Nullable HEAD
uses disjoint string/null `oneOf` branches. The check validates all five input
and output schemas and rejects a numeric HEAD, and runs before both profile
smoke and live model launch. This adds consumer compatibility evidence without
changing the producer API or weakening exact reviewer identity requirements.
Validation: 67 files / 775 passed / 3 original skipped / 0 failed with one
worker; typecheck/build and configured pnpm 10 packed import/Sidecar checks
passed. A default-parallel attempt timed out and remains recorded separately.
Two real DSH composition-fixture launches passed tool registration, stable
workspace identity across restart/aliases, authenticated Git reads and unchanged
repository state. Real product App proof and full Windows acceptance remain
unverified; this repair still requires independent exact-HEAD review.

Stage H incremental migration: the private pre-task recovery error is neutral,
and the released legacy live-runner entry delegates to the canonical actual
Planner–Executor runner instead of maintaining a second model/browser policy or
hardcoded result. Tests-first evidence covers exact ownership diagnostics and
real child-process argument/environment/exit parity; 33 focused ownership and
registration tests plus 4 alias tests passed. Typecheck/build and configured
isolated package checks passed. These are migration/packaging checks, not a new
full-suite or real product acceptance claim. F11 stays PARTIAL pending launcher,
test-name/documentation migration and exact-HEAD review.

Logged-out semantic regression (2026-10-02): a public composer accompanied by
a visible English/Chinese login control must not imply an authenticated user.
Four shared-contract cases failed against the prior driver across both fake DOM
and session-gated compatibility primitives. The shared driver now rejects that
state before input; hidden/inert controls and message-content buttons do not
count as account-login surfaces. Focused semantic/doctor tests passed 169/169.
This is fixture evidence only. Starting a separate real no-login browser was
rejected by automatic approval (`blocked by policy`, no more specific reason);
real logged-out website acceptance remains NOT_RUN. The logged-in product
browser's separate visibility prerequisite still needs user activation.
Final bounded suite for this candidate: 67 files, 783 passed / 3 original
skipped / 0 failed; typecheck/build and configured isolated package import and
separate Sidecar lifecycle checks passed. Real website logout proof and final
goal acceptance are not implied by this result.

Protocol foundation (2026-10-02): canonical v2 codec is additive and separately
reviewed at HEAD `2b8e782`. Red evidence: 33 missing-module cases, then two
delimiter-injection/separator cases. Green evidence: 72 canonical and released
protocol cases; 68 files / 823 passed / 3 original skipped / 0 failed with two
workers. The unconstrained run had 42 failures involving process startup,
permissions and browser deadlines; its output is retained rather than replaced
by the successful bounded run. Typecheck/build and configured isolated package
verification passed, including public protocol type imports.

Storage foundation: separate canonical schema and explicit dual-domain routing
have tests-first evidence (10 initial failures, four corrupt-version failures,
one invalid domain-write failure). Focused 35 cases pass, including real Cordis
domain close/reopen over a disposable fixture file medium and unchanged released
record bytes. This does not establish production storage, coordinator v2, durable
send/reply recovery, or full Windows acceptance. The deployment still uses v1;
the new storage adapter and router are additive foundations awaiting integration.

Reply observation foundation: six red-first driver cases demonstrate missing
baseline capture/reconstruction fencing, one RPC contract case demonstrates
missing bounded metadata support, and two filtered transport/lifecycle cases
demonstrate missing propagation/replay binding. Final focused driver checks:
63 pass. After rebuilding the packed-runtime entry used by independent process
fixtures, 50 driver/RPC/transport/lifecycle cases pass. The earlier stale-build
run (1 failed, 49 passed) is retained separately. Typecheck/build and isolated
public type export/package/lifecycle checks pass. The baseline contains count,
text digest, conversation and opaque document epoch, with no assistant body.
This is reconstruction and replay-metadata proof only: coordinator persistence,
Sidecar baseline capture, resumed journal waits, new-conversation bootstrap,
whole-browser reconciliation and full recovery acceptance remain unimplemented.

Current message semantics and read-only reconciliation (2026-10-02): a shared
extractor handles released author-role/markdown bodies and current search/content
units with explicit assistant role headings. Nested render markers deduplicate;
conflicting roles, duplicate identities and ambiguous/unproven bodies fail closed.
Visible body traversal preserves literal line breaks and excludes role labels,
hidden/inert content and action controls. Reconciliation requires the exact
configured App mention and latest unique user control digest in the requested
conversation; it derives the preceding reply baseline without input. This is
an internal driver capability, not yet a Sidecar RPC or coordinator recovery.
Read-only explicit product-target inspection recognizes one user and one
assistant message on the real current page. Its visibility remains hidden and
its historical outgoing message has no proven App mention. This evidence is
DOM compatibility only, not real App acceptance or crash-recovery acceptance.

Journal-bound observation extension (2026-10-02): bounded baseline capture is
available through the neutral Sidecar client. Known-conversation sends retain
hash-only observation facts and optional task/round/workspace/HEAD binding. Opt-in
waits bind to the original send, reject changed metadata, and reconcile uncertain
delivery through the internal semantic driver before read-only resumed waiting.
Completed waits retain a reply digest atomically with acceptance. Replays after
restart reobserve the reply and reject digest changes; no reply body is stored.
Old journal records load without fabricated observation history. This extension
does not wire coordinator persistence or establish real browser restart or
full product recovery acceptance. Separate-process cases use an explicitly fake
external browser view; they must not be reported as real ChatGPT proof.
