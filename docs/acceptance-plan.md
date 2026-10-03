## 当前执行依据：real123 在 app-proof 绑定前失败，停止该次曝光

冻结提交 b6a9061cc7d13c70d3f1d35c49537008424c2845 在原 ChatGPT 对话取得实际工具读取后的 EXACT_HEAD_SCOPED_REVIEW_PASS，获准一次 fresh real123。此前未读取源码的摘要批准及 REVIEW_BLOCKED 均不能作为通过依据。

real123（run39158fe5-bf88-4a21-972b-9d806ce32fb0）已终止：local doctor localReady=true；app-proof 的 remote_workspace_access 返回 SEND_UNCERTAIN，appDataPlaneVerified=false。耗时12936ms，原proof预算90000ms。journal只有一次 accepted bootstrap send，无 bootstrapBaseline，无 wait、replacement、PLAN、实现或review。具体拒绝子分支 UNKNOWN，不能推定renderer/锁屏/历史Real121根因。

控制器停止该次执行并冻结证据40–47。20个WTS样本可用；停机前仅root/health/journal观察，独立page命令0。停机后单次page probe成功只证明该时点可执行。DSH与两个观察器已确认退出，Sidecar监听0。原oracle五项false、exitCode1。首次观察文件未创建的guard-read-unavailable记录完整保留。

下一行动：将本次accepted但未绑定的失败边界提交原ChatGPT独立复核，先获得唯一可证伪的本地/native实验和停止条件；无普通重试、新target或放宽timeout/身份检查。真实闭环及lock/producer/global gates仍未完成。下文旧状态为历史。
## 当前执行依据：post-D26 冻结全量 PASS，等待提交与 exact-HEAD 审阅

2026-10-03 22:38（Asia/Shanghai），获独立方案批准的 post-D26 原命令 pnpm test 已终止，exit0：91 files / 1246 PASS / 3 原有 skips / 777.68s。原始输出见 docs/evidence/iteration123/37-frozen-full-after-d26.txt；终态38确认225个冻结文件哈希与路径无变化，39确认两次冻结清单一致。full 未加载 D26 observer，未改变源码、fixture、timeout 或安全检查。

首次失败19/20仍为 FAILED，原启动失败 cause UNKNOWN；D26只证明本次有限诊断未复现。当前候选源码审阅及全量已通过，但提交/推送、exact-HEAD scoped 审阅、真实产品闭环和后续 lock/producer/global gates 尚未完成。下文运行中和待诊断状态均为历史记录，不能作为当前执行依据。
## 当前：D26 完成，按独立方案进行一次 post-D26 冻结全量

原 ChatGPT Web 已给出 FIX_PLAN_PRE_FULL：分类为独立测试启动生命周期失败，保持 staged harness 的源码审阅通过；先做 D26，未复现源码缺陷时允许一次冻结全量复核。未修改任何生产、测试、fixture、timeout 或 ACL 检查。

D26 原始记录 26–35：26 是测试开始前的 Windows import 路径调用错误；28/29 虽6PASS但只观察主进程，时间线不完整，不用于启动分类。30/31 的实际工作进程观察覆盖12个真实 fixture 子进程，6PASS17.40s；32–34 两个不同状态的并发启动均成功。35 汇总14个 ready/exit、0个启动超时、原5000ms计时器及225原哈希不变。native entry 精确加载时间和独立 health 未被现有接口观察；不将 preload 当 entry。诊断脚本及同步 metadata 开销已留存并注明。结论只为 STARTUP_BOUNDARY_UNREPRODUCED_IN_D26；原失败 cause 仍 UNKNOWN。

现按该独立方案的条件启动了一次原命令 pnpm test，未在 full 中加载 D26 observer。冻结36为225文件，和18相同（39），输出37；终态及哈希核对将在38。同一 live shell session77736，不能因观察超时重启。原失败full19/20永久保留，不改写成通过。提交/推送、exact-HEAD harness 审阅和真实产品闭环仍未发生；后续 lock/producer/global gates 仍打开。下文旧待诊断状态作为历史保留。
## Iteration123 frozen full FAILED; isolated diagnostic PASS

The one authorized frozen full is terminal, exit1: 91 files (90 PASS/1 FAIL), 1245 PASS/1 FAIL/3 original skips, 833.66s. All225 candidate hashes and path inventory are unchanged (18/20). The failing unchanged test is sidecar-bootstrap-process.spec.ts, never resends after a crash at after-bound: Sidecar child startup deadline exceeded at the existing 5000ms limit. The original output does not identify first versus restarted child or startup substage. This is a test-fixture readiness failure before recovery assertions, not evidence of real ChatGPT/App/recovery failure. No real product run occurred.

One bounded diagnostic of the unchanged entire bootstrap-process test file passed all6 tests in16.07s (25), with the original5s child/15s case/1s RPC/2s observation budgets and real ACL checks unchanged. This does not erase the failed full or prove environmental causality. Source inspection shows the synthetic child calls private-state provisioning and actual Sidecar startup, which performs pre/post-journal private-state verification; no timing or stage evidence was retained by the failed run. Source/fixture root cause remains UNKNOWN. Do not rerun full or alter budgets/security to obtain green. Next: independent bounded debug review of raw19/20/25 and current unchanged source before a causal experiment or repair.

Full session76423 and diagnostic92807 are terminal. Commit/push, exact-HEAD harness freeze and real product exposure remain NOT_RUN. All later lock/producer/global gates remain open. Earlier running/PASS-pending-full headers below are historical.
## 当前执行状态：iteration123 已通过补充源码审阅，冻结全量运行中

原 ChatGPT Web 会话已给出 SOURCE_REVIEW_PASS_PENDING_FULL：自包含夹具、父 runner 内存契约、普通 Node 测试发现及阶段边界通过；三个审查因果 RED 已接受。当前一次 pnpm test 正在运行，225 个源码/测试/脚本/配置哈希已冻结（evidence123/18），输出在 19，终态及跨运行哈希核对将在 20。未取得终态前不得写成 PASS 或重启全量。

保留 package3ZkHDf 的十个生产 built/installed 模块重新核对全部对应（21）。此改动只涉及 harness/tests/docs，按独立审阅复用保留生产包，不为文档或夹具重新做 package/profile。两仓库 fetch 后仍分别为 d931979050b41871555fd7968897078f742fb12c 与 0afd708c288b079096affbfeff4626dcf9a19bf1，上游 0/0。

| 必需节点 | 当前证据状态 |
|---|---|
| iteration122 生产 foundation / 冷交接 scoped freeze | VERIFIED，保留原范围及历史未知根因 |
| iteration123 夹具源码补充审阅 / focused39 / typecheck / syntax | VERIFIED，仍不是产品闭环 |
| iteration123 冻结全量 | RUNNING，同一 shell session76423 |
| 正式 commit/push + exact-HEAD harness 审阅 | NOT_RUN，等待全量终态 |
| fresh Windows DeepSeek → real PLAN → fix/restart/reconnect → second DONE → 原 oracle | NOT_RUN |
| Windows lock/pause/resume 资格 | NOT_RUN，解锁闭环后执行 |
| producer 原 Windows Git deadline gate | 未解决，保留原失败，不以安装 profile PASS 替代 |
| 最终双仓库 global exact-HEAD | NOT_RUN |

下文 iteration123 初始候选/FIX 待审阅描述和更早暂停状态均作为历史记录保留，以上为当前执行依据。
## Iteration 123 corrected candidate after independent FIX

Independent ChatGPT Web returned FIX_PLAN_PRE_FULL in the original conversation. The first candidate had two harness defects: external runtime helper/ordinary writable sibling contract, and narrowed top-level test discovery. Three concrete REDs are retained in 11; 10 retains the first two. File 12 is an implementation/serialization failure, not an architectural RED.

The corrected candidate generates a self-contained workspace test script using only Node built-ins. It embeds canonical literals, as explicitly required by the new FIX plan; this replaces the initial PLAN's suggestion to keep the payload outside the workspace. Recovery files still activate only after the first successful base test. Ordinary node --test discovery is restored; a repeated phase-one test now fails on the intentionally absent recovery implementation. The parent runner holds a frozen in-memory contract, verifies initialization, verifies phase one before launching phase two, and verifies phase two before the unchanged oracle. It checks package.json as well so a changed test entry cannot silently bypass the runner.

Current focused: 4 files / 39 PASS (14), typecheck PASS (15), two explicit syntax checks with command/exit/empty output/SHA in 16. These prove isolated workload behavior, not real DSH/ChatGPT closure. Corrected source supplement is required before one frozen full; no full, commit/push, exact-HEAD or product run has happened. Earlier iteration123 candidate descriptions below are superseded historical records.
## Iteration 123: isolated recovery workload candidate

Real ChatGPT Web startup PLAN is received in the original c2c_c035 conversation. It approves the retained production candidate and requests only a deterministic acceptance workload extension. No product source, original oracle, restart observer, or producer edits are authorized by this scoped plan.

The original subtraction requirements and initial fixture are retained. The first successful base test emits a stdout-only nonce, then activates immutable recovery requirements/tests. Phase one cannot implement the recovery module; phase two must pass both original and recovery tests. The stage is explicitly acceptance-only. The test runner imports the external harness helper and validates an external contract; external-path execution compatibility remains to be independently reviewed and demonstrated in the real DSH run.

Evidence: 03/04 are scaffold failures with zero tests, not behavioral RED. 05 is causal RED (base PASS but missing activation). 09 focused candidate: four files, 34 tests PASS. Typecheck PASS in 08; both changed scripts pass node --check. Independent source review, frozen full, commit/push/exact-HEAD and real product run remain pending. No product readiness or overall completion is claimed.
# PlannerBridge acceptance and falsification plan

Status: PARTIAL — the full Windows deployment remains unfinished. Scoped canonical wiring, installed authority and fake-stack evidence are recorded below; real model/App/recovery acceptance and final global review remain incomplete. Earlier rows retain their original dated snapshot unless explicitly updated below. Every gate uses Goal, Fixture, Action, Expected evidence, Failure condition and Status. Unit/fake evidence never substitutes for browser/model/Windows integration. Only VERIFIED / FAILED / NOT_RUN / PARTIAL / BLOCKED / FUTURE / NOT_APPLICABLE are result statuses.

Iteration87 unreviewed bootstrap-order candidate: real-CDP/RPC regression RED on
b43e4a0 at captureSendObservation SEND_UNCERTAIN, then six exact/hostile/deadline
cases GREEN. Focused3files83tests PASS; typecheck/build PASS; frozen full83files
1118PASS3original skips663.11s. Package r3jZQe PASS; installed DSH profile9b6b1J
PASS in both native attempts. These are composition fixtures (Browser/App
NOT_RUN). Earlier unchanged-runtime diagnostic kp2FCM passed real App proof but
failed INIT bootstrap binding; owned operator termination4294967295/all-false
oracle retained. No canonical PLAN/execution/recovery/DONE acceptance or
independent review of this candidate is claimed. See browser-platform-investigation.md.

## Baseline and stages

The latest whole-goal priority refresh is [current-delivery-plan.md](current-delivery-plan.md).
It preserves all original requirements and separates the successful real App
proof from the still-failed INIT/product acceptance gate.

### Current goal audit and delivery priority (2026-10-02)

Latest full fake-stack delivery checkpoint: `189222b`; latest bounded
cancellation/auth source supplement: `fd8a61b`. The current runtime candidate
was packaged after `d172c4b` source changes and passed isolated installation.
Its ordinary full regression is 83 files / 1043 passed / three original skips;
the previous stale-prefix fixture failure remains recorded below.
Iteration-51 whole-goal planning
independently read goal.md, this plan and Git status and confirmed that the
remaining critical path is finite installed-product acceptance. Accepted
foundations are not reopened without contradictory evidence. The ordinary
Windows `pnpm test` gate passed 1040 tests / 3 original skips at `b87c55d`;
the separate producer native Git support test remains FAILED at its unchanged
deadline. Its 13 distinct allowed queries are not duplicate consumer snapshots.

Priority is the real installed DSH + DeepSeek + product ChatGPT App loop,
followed by required fix/restart/DONE evidence and final global exact-HEAD audit.
The installed Read/Git authority verifier has passed its bounded scope below;
it does not substitute for real model acceptance. The evidence marker must be generated by the successful test,
remain stdout-only, and be independently read and echoed by the Reviewer.
Do not change goal.md to lower these requirements.

A third real attempt (`planner-executor-live-Ccuuw4`) failed before PLAN:
content/Git/exposure readiness succeeded, but App probing returned BROWSER_STALE.
Read-only product-page inspection still found the existing plain-text
`@DSH with ChatGPT` draft with no decorator. User reported clearing a page;
the dedicated product Chrome conversation differs from the development IAB
conversation, so assistance was requested for the exact product page. No
automatic deletion of the unowned draft or repeated identical launch is allowed.
The product gate is BLOCKED pending that prerequisite; whole-goal work remains
active and no real PLAN, nonce, recovery or DONE is claimed.

Installed authority verification subsequently passed in two independent real
DSH processes using the validated packed runtime and synthetic Sidecar. Positive
contained reads succeeded; traversal, absolute outside paths, native junction
escape and use after lease release returned no result or outside fixture
content. Hostile Git-helper tripwire and complete repository snapshots remained
unchanged while authenticated status/diff/log succeeded with hardened-windows
assurance. Initial verifier failure expected unsanitized provider error names;
the final check matches the existing exact sanitized bridge error and retains
the denial/no-content/positive-control assertions. This closes that bounded
installed authority case only; the producer support timeout stays FAILED and
the real model/App/nonce/recovery gates remain unverified.

Iteration-52 bounded F11 product-entry migration has tests-first evidence:
the canonical entry was missing in the initial failing behavioral run. The
canonical prepare/launch entries now own policy and old product entries
delegate. Real PowerShell children cover canonical-only, legacy-only and
conflicting CLI references, literal argument boundaries, child exit propagation,
environment-only secrets, existing DPAPI state, readiness ACL/ciphertext
preservation, corrupt configuration rejection and owned-clear scope. This is
launcher evidence only, not real DSH model/App execution or final F11 completion.

Source checkpoint: `f719163`. Independent iteration-48 re-reading returned
scoped DONE for production canonical wiring, legacy compatibility, Git authority
composition and observer/oracle alignment. This is not overall acceptance.
The latest frozen single-worker run has 1040 passing tests and 3 existing skips,
with build/package/two DSH-profile checks passing. The uncapped default run
still failed; iteration-49's Windows scheduling candidate passed the ordinary
default `pnpm test` command with 1040 pass / 3 existing skips.
Historical stage counts below are dated evidence, not current completion claims.

The remaining critical path is product integration and real acceptance:

| Goal boundary | Current state | Concrete remaining result |
|---|---|---|
| Neutral protocol, Chat Control, Direct CDP and Sidecar | PARTIAL: substantial scoped source/contract evidence | exercise these exact implementations in the installed Windows product |
| DSH production composition | PARTIAL: canonical registered tools and Git authority wired; synthetic plan/fix/reconnect/DONE integration accepted at f719163 | installed real-model canonical plan/review/reconnect |
| Recovery | PARTIAL: accepted-send publication recovery and atomic-result tests pass | required product restart/fix loop, fail-closed uncertain delivery without duplicate input |
| Workspace Data Plane and security | PARTIAL: capability and scoped-output boundaries exist | real reviewer independently reads workspace/Git/raw output under the active producer lease |
| Packaging and regression | PARTIAL: installed artifact/profile/authority proofs and ordinary Windows full suite 1040 pass / 3 original skips exist | validate any changed final runtime candidate without weakened assertions/deadlines |
| Windows primary E2E | NOT_RUN for the final canonical architecture | real DSH/DeepSeek/ChatGPT task, pushed exact HEAD, stdout-only nonce independently echoed, required restart/fix/DONE |
| Final global review | NOT_RUN | audit final HEAD against every goal requirement and actual evidence |
| Linux cross-host | FUTURE | no Linux implementation prerequisite for this Windows delivery |

#### Goal refocus after production integration candidate (2026-10-02)

The committed iteration-48 candidate wires Sidecar production start/review to v2,
borrows the enclosing producer Git authority, and makes execution observation
and the acceptance oracle use canonical same-round review identity. These are
source changes with focused synthetic integration evidence, not full installed
product acceptance. Build, regression under one worker, packaging, profile and
independent exact-HEAD scoped review passed for f719163. The in-development full
run reported a bootstrap-client test failure and must not be described as passing.

The delivery bottleneck is now proving the installed Windows chain, rather than
adding more protocol abstractions. The next deliverables remain the four nodes
below. A new repair must name a demonstrated failure or an unmet mandatory goal
gate, its bounded fix, and the evidence that closes it. Once the relevant checks
pass, advance to the next delivery node instead of opening another speculative
hardening round. Do not reopen accepted foundations without new contradictory
evidence, weaken security or assertions, or substitute synthetic DONE for real
product completion.

Overall completion requires the actual DSH/DeepSeek/ChatGPT loop, independent
workspace/Git/raw-output reads including the stdout-only nonce, required recovery,
matching task/workspace/iteration/pushed HEAD, and final global exact-HEAD review.
Development connector health and scoped review counts do not close those gates.

Iteration-48 candidate validation: after source freeze and a completed build,
the full single-worker regression passed 83 files / 1040 tests, with 3 existing
skips and no failures. This is not proof that earlier default-concurrency
instability is resolved. The focused production/Git-authority/bootstrap RPC
run passed 29 tests, and the observer's separate Node suite passed 3 tests.
The isolated packed artifact passed import/type/runtime closure and separate
synthetic Sidecar checks. Two actual DSH profile processes passed identity,
reload/restart and authenticated Git-read checks with a synthetic Sidecar;
they do not exercise the real Planner/Executor model loop. The development-time
run remains recorded as 1037 pass / 2 fail / 3 skip: one failure loaded the old
client during edits, and one child could not import a built file while a clean
build overlapped the run. Independent exact-HEAD review and real primary E2E
remain pending. Raw outputs are released as iteration-48 development records.

Delivery order:

1. Wire the canonical coordinator, producer-backed Git authority and matching
   planner instructions into registered production tools. Preserve released v1
   records through explicit compatibility dispatch. Update the observer and
   acceptance policy: its current review `iteration + 1` rule is legacy and
   cannot validate canonical same-round DONE. Prove the tool-to-runtime path
   with a focused failing integration test before implementation.
2. Complete one product-shaped disposable Git fixture loop, including the
   required restart and fix review. Add only missing boundary tests required by
   that path or a demonstrated failure; do not expand into an unbounded crash
   permutation project. Synthetic evidence remains separate from real product
   evidence and cannot close the Windows E2E row.
3. Verify the installed package/profile and resolve the demonstrated full-suite
   failures. Preserve failure output and security checks; neither focused passes
   nor timeout inflation substitute for the regression gate.
4. Run the real Windows primary chain without Browser Harness or the development
   connector, then obtain final exact-HEAD global review and completion matrix.

Local scoped reviews close their stated work only. Further review requests must
name the next delivery result and the actual blocking gap, rather than reopen
already accepted foundations or add unrelated abstraction work.

Iteration-49 regression falsification: with frozen `f719163` source and no
overlapping build, the uncapped default run produced 956 pass / 84 fail / 3 skip
on a Windows host reporting 22 available processors. Failures cluster around
real process/ACL fixture startup and teardown deadlines. Iteration-48's same
suite passed 1040 / 3 skips with one worker. Independent planning read the raw
failure record and selected a Windows-only worker bound. The candidate changes
only Vitest file scheduling (`maxWorkers: 1` on Windows), retaining full suite
membership, isolation, all deadlines, DACL verification, replay/cleanup and
security assertions. The acceptance check is the ordinary `pnpm test` command
without a command-line worker override; configuration itself is not pass evidence.
Non-Windows default scheduling remains unchanged and Linux remains FUTURE.
The ordinary `pnpm test` candidate run passed all 83 files / 1040 tests, with
3 original skips, in 438.14 seconds, exit 0. No test deadline or assertion
changed. Independent exact-HEAD review of the scheduling change is pending.

Two real iteration-49 product attempts remain FAILED before PLAN. The first
deployment launcher omitted the previously verified task-owned network config;
it was terminated at that demonstrated readiness failure and its output retained.
With that reference restored, secure exposure, workspace content and Git reads
were ready, but exact App probing failed `BROWSER_STALE`. An independent read of
the dedicated product page confirmed a nonempty composer; the preexisting draft
is preserved and user assistance to clear it has been requested. No nonce,
canonical model round or recovery acceptance is claimed for either attempt.

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
| Windows sandbox / G+I | real hardened execution authority | real Windows ACL provider + task workspace | execute root-contained reads and fixed Git queries with hostile escapes | hardened-windows assurance and actual deny evidence | mere mock/metadata, relaxed security for green tests | FAILED |
| Fake-stack / H | workflow under adversarial boundaries | separate Sidecar + fake driver + real Git fixture + persisted core | full plan/fix/review, faults and restart | deterministic identities and commit/push verified | fake result reported as real Web/model acceptance | VERIFIED: combined fixture and scoped supplement at 189222b; no real product claim |
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
incomplete until all mandatory actual provider denial/read checks pass.

Iteration-50 native Windows evidence (producer source HEAD
`0afd708c288b079096affbfeff4626dcf9a19bf1`, clean checkout): the existing
`fs-local/tests/root-read-win32.spec.ts` passed 14 tests, including junction
denial, namespace replacement, bounded reads and cancelled handle cleanup.
These use the actual native filesystem implementation, with deterministic race
hooks, and are source-plane evidence rather than installed consumer acceptance.
The existing `execution-world/tests/git-lease-windows.spec.ts` uses actual local
sandbox/subprocess providers and Windows Job containment; 2 tests passed for
hostile inherited Git/output environment and rejection of require-full before
spawn. Its multi-command repository/helper-tripwire test hit the unchanged
5000 ms test deadline and failed again when isolated. No deadline, assertion,
producer source or permission guarantee was changed. Consequently the Windows
sandbox gate is FAILED, not VERIFIED. Raw success and both failures are released
as iteration-50 records; installed DSH profile Git-read checks remain distinct.

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

Iteration-53 fake-stack composition uses the real Sidecar server/client,
canonical coordinator, revisioned repository and DshGitAuthorityAdapter in
separate children. Its file medium, ExecutionWorkspacePort and external browser
view are explicitly test adapters; the synthetic planner does not read workspace
or raw outputs and is not an independent product Reviewer. A disposable real
Git branch and bare remote begin with a failing test, then pass actual executor
tests/commit/push, receive a synthetic fix PLAN, and repeat with stronger tests.
Dirty and unpushed review attempts must leave the persisted task unchanged.
After Sidecar ACK/journal acceptance, injected coordinator publication failure
leaves the round in sending. Two Sidecar restarts and three executor processes
recover the same task/workspace/iteration, send/wait IDs, baseline, digest and
Git proof, reacquiring fresh double-observed Git snapshots before waiting and
accepting same-round DONE. The external synthetic view contains only three
sends (INIT plus two EXECUTED); production journal contains no control bodies.
Actual failing/successful test output is released with the final fixture result.
This establishes the combined fake-stack case only, not producer sandbox
authority, actual browser input/Enter behavior, real App reads, DeepSeek,
stdout-only nonce proof or final Windows E2E. Initial missing-fixture failure
and a later incorrect verifier command-count assumption remain retained raw
records. Final counts measure actual semantic snapshots delegated to the real
GitAuthority adapter, not a fixture-generated HEAD or cached proof.

Run `pnpm run test:plannerbridge-fake-stack` after `pnpm build` from `package`.
Do not run a clean build concurrently with process fixtures importing `lib`.

The fake-stack case received independent scoped review and supplement at
`189222b`: the parent, both current child fixtures, coordinator and GitAuthority
contracts were read, together with raw 292 and focused evidence 293. Its scoped
status is VERIFIED; real model/App/nonce/restart acceptance remains unverified.

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
send/reply recovery, or full Windows acceptance. Production activation now opens
both task domains and uses the explicit router, including combined pending-task
ownership checks and mixed-domain collision refusal. All three acquired domains
are closed by the deployment lifecycle; tools wait for canonical storage readiness.
Task creation and protocol execution still use v1. The legacy coordinator rejects
v2 plan/review/recovery before browser activity, pending canonical coordinator
integration; status remains a read-only task lookup. No existing record is copied
or upgraded by opening the router.

Canonical aggregate foundation adds a nested round only in the independent v2
task schema. Red-first cases expose malformed/changed intent, phase jumps,
accepted-result corruption, administrative history deletion, wrong replay error
classification and unowned route changes. Repository checks cover a single
publication failure and two contenders at the same expected revision. Real
Cordis domain close/reopen with the test-owned file medium preserves the nested
intent and unchanged released task bytes. This proves schema/repository behavior,
not an independent process crash, production storage durability, browser ACK,
fresh GitLease acquisition or a canonical coordinator flow. Accepted results
contain bounded validated protocol sections and their canonical envelope digest;
the Sidecar journal still stores no message bodies. Canonical task creation
remains disabled in production.

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

Bootstrap observation transport (2026-10-02): the source-only
`captureSendObservation(sendOperationId)` capability derives all proof inputs
from an accepted Sidecar send record. Callers cannot supply a conversation,
digest, epoch, expression, path or message body. Original null-conversation
intent remains immutable; a separate bounded binding is published once only
after the same live service witnessed a successful provider ACK and the owned
driver proved the exact configured App and outgoing control digest. Derived
assistant count and text digest must match the original baseline. An unbound
bootstrap after restart fails closed even when the current route looks exact;
it is neither adopted nor resent. Previously bound metadata survives restart,
but the first resumed wait still requires read-only semantic reconciliation.
Accepted known-conversation sources also reconcile before their first wait in
a restarted service. Cancelled late proof cannot publish a binding, and an
abort-ignoring provider retains exclusive ownership until it settles.

Journal contract and RPC fixtures cover immutable metadata, mismatches,
corruption preservation and refusal before browser reads. Three separate-process
cases cover pre-ACK, ACK-but-unbound and already-bound crash boundaries with
different child PIDs and an explicitly synthetic external browser view. The
initial process-fixture failure reflects missing fake-provider bootstrap
support, not a production-source regression. These checks do not establish
real ChatGPT ACK or full recovery acceptance. Aggregate bound-baseline
persistence, canonical coordinator wiring, fresh GitLease acquisition and
production v2 task creation remain pending.

Iteration-57 naming/authentication regression evidence (2026-10-02): the actual
registered production status creates a protected fresh credential reference,
authenticated bridge ping succeeds, missing/wrong values are denied, and live
reuse retains identical bytes and endpoint. An independently configured legacy
opaque bearer remains accepted. Separate-process RPC normalizes the old provider
cancellation error without exposing provider details. Focused suites: 57 passed;
typecheck/build and isolated package imports/Sidecar process checks passed.
These are source/package contracts, not real App or stdout-nonce acceptance.
The current package candidate has been refreshed for the next actual product run.

Final iteration-57 ordinary full rerun: 83 files passed, 1043 tests passed,
three original skips. The initial 4 failures / 1039 passes / three skips are
retained as stale fresh-prefix fixture evidence, followed by its four passing
cases. Actual-source independent supplement is pending: the review page reported
unavailable connector tools even though local connection diagnostics were green.
No real Windows acceptance or global completion follows from these results.

The same-connector availability confirmation restored actual tool calls. At
`fd8a61b` the independent supplement read cancellation, deployment ensureBridge,
Sidecar normalization and the production/cancellation/bridge tests, and read the
red/focused/final-full outputs. It accepted only that bounded source scope.
The earlier unavailable-tool response is retained as a resolved review transport
interruption, not source approval or a product App failure. The next product
candidate is the refreshed isolated installation, not the earlier runtime pack.
Read-only revalidation still finds the dedicated product page hidden with its
preexisting plain-text App draft. No live acceptance process or reviewer wait
exists; user page intervention remains necessary before that run can begin.

Iteration-64 current-source baseline (2026-10-02), source HEAD `e520ef6`:
typecheck/build VERIFIED; ordinary full regression VERIFIED, 83 files,
1082 passed, three original skips, 423.47 seconds, exit 0. Fresh isolated
package `q2GYTb` and installed composition profile `fVdIt7` VERIFIED, including
two separate native DSH processes. Canonical packaged native Sidecar entry
with a fresh verifier journal VERIFIED for authentication, readiness observation
and owned shutdown only. Initial noncanonical credential-reference failure is
retained; only the diagnostic launcher's path spelling was corrected.

Real mutation visibility remains FAILED: activation of a separately created
same-profile product window returned a stable explicit target and normal
window bounds, but all 17 read-only samples reported document hidden despite
focus=true and normal loading lifecycle. This does not prove the native cause.
No new product INIT or fresh E2E was launched. The original target/draft/task
and failed-run evidence remain preserved. Fresh real App/PLAN/execution/nonce/
fix PLAN/restart/second execution/pushed-HEAD DONE are NOT_RUN in this iteration.
Producer Git gate remains open/FAILED; final global audit remains NOT_RUN.

Iterations-71 through80 current correction (2026-10-02): desktop unlock and
side-by-side positioning resolved the previously observed visibility
prerequisite. The user authorized operator clearing of unsent drafts in the
explicit dedicated acceptance window; original failure journals remain intact.
Pushed source23ae394 and matching runtime packageKMPR5Q have VERIFIED ordinary
full regression (83 files/1106 passed/3 original skips,525.64s), typecheck/build,
isolated imports/native Sidecar and installed DSH profile rdCHcq. Independent
actual-source/adversarial/exact-HEAD review returned DONE_SCOPED for the bounded
temporary-to-durable route/materialization repair, not whole-goal completion.

Fresh canonical mKVL1f is FAILED: local doctor and exact App selection passed,
App-proof send accepted, reply observation uncertain BROWSER_TARGET_CHANGED.
Every acceptance oracle flag remains false; no valid PLAN was accepted. Later
read-only exact App/control observation is not historical provenance. A separate
unchanged-runtime diagnostic iBfXrV passed real App workspace proof, then INIT
capture failed after fenced reload before exact semantic App proof. Diagnostic
irYTmi captured raw unresolved App slug rendering with exact control digest,
followed later by the exact App link. Neither diagnostic substitutes for E2E.
The initial diagnostic launcher path failure and both terminated attempts retain
their original evidence/status. Native diagnostic services were shut down via
authenticated generation-fenced requests.

Iteration80 raw-slug pending-render candidate has a behavioral RED on23ae394,
94 focused GREEN tests and successful typecheck/build. Source review found no
concrete safety defect. Frozen ordinary full81 passed83 files/1112 tests/3 original
skips,584.52s,exit0. Package/profile/committed-HEAD gates remain pending. Raw slug
permits bounded waiting only, never ownership; final
exact App link/prefix/control digest/latest user proof and original caller
deadline remain required. Real PLAN, executor tests/stdout nonce, fix PLAN,
actual DSH restart/reconnect, second execution, pushed same-round DONE/oracle and
final global audit remain unverified. Producer Git gate remains FAILED/open.

Iteration81 fresh packageUw4AM9 and installed DSH profile nLJRqI VERIFIED:
isolated imports, native Sidecar replay/shutdown, tool schema, stable identity,
hardened Git and containment checks passed. Profile mode is composition-fixture;
actual Browser/App proof is NOT_RUN. Exact committed-HEAD supplement and fresh
canonical real E2E remain required.

Iteration82 canonical VlgEmy on exact b43e4a0/Uw4AM9/new native journal8 FAILED:
local readiness passed, one App-proof send accepted, original90s wait uncertain
APP_PROOF_TIMEOUT. No second send or valid PLAN; oracle flags remain false.
DSH exited0 before operator stop, oracle exit1. Service shutdown was authenticated
and generation-fenced. Current OS observation at15:20:59Z found LockApp; this is
a present environment prerequisite, not evidence of the earlier timeout cause.
Unlock was requested, no deadline/source/proof/oracle change made. Fresh real
acceptance remains required after visible unlocked revalidation.
