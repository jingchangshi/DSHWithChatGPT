## 当前执行依据：D28c 窄修复已实现，交接审阅，整体目标未完成

当前候选、双仓库状态、证据适用范围和未完成门槛见 [2026-10-04 交接说明](review-handoff-2026-10-04.md)。下文待实现状态为历史；本候选尚无最终独立源码审阅、冻结全量或真实曝光通过。

## HISTORY / SUPERSEDED：D28c 窄可用性 RED 已获实际源码审阅，待实现缺失正文专用收敛

已在原会话实际选择DSHWithChatGPT工具，68/69/76保留独立源码审阅。76明确读取workspace/source/message-observation/tests/70–75和execution_output674，确认visible current-role single-ID missing-body可用性RED，并授权仅MISSING_BODY bounded observation。69已明确unknown-role pending不是生产RED；11s只证明deadline tradeoff。禁止把所有null或OBSERVATION_MISSING转为等待。

D28c原始70/71为零高度shell被visibility排除，existing机制绑定成功但预期拒绝断言失败；非生产RED。73/74使用可见20px、正确current user marker、唯一ID、无正文/冲突/重复/multiple body：749ms拒绝，reconcile3ms OBSERVATION_MISSING；2s后在same target/document/route实际exact，一次accepted send/Enter、无bind/wait/recovery。72为22PASS，保留所有歧义负例。

唯一下一实现：同一次message observation返回窄missing-body分类，扫描完整树确保其他矛盾不能被pending掩盖；reconcile只对该状态进行同target/document/route/conversation的只读观察，一次absolute10s不刷新、原outer signal、maximum1既有fenced reload。duplicate/roles/bodies/limits/explicit App/digest及route/document变化仍立即失败。正例、永久pending时间上界、caller取消、期限不刷新、混合hostile+pending、reload次数与native负例需验证后再独立source review。尚未修改生产等待行为；full/real exposure均未授权，real123原因及lock/producer/global gates仍OPEN。
## HISTORY / SUPERSEDED：D28b 分类及等价性通过，等待独立可用性判断

D28 Web 既有审阅已真实读取并保存56，未重发原请求。D28b摘要63及原始57–64保留：9s exact绑定；11s exact约10.7s拒绝PROOF_NOT_FOUND；瞬时真实messageObservationScript不可判定结构约0.63s拒绝OBSERVATION_MISSING。后两者在终止后本地只读验证中实际成为same document/route exact proof，均one send/Enter、no bind/wait/recovery。此为mechanism evidence，生产可接受性及real123历史cause仍UNKNOWN，不能据此自行修复或真实曝光。

首次native58是8PASS/1夹具route场景FAIL，未触发预期route变化；修正后61三项PASS，其余六项为过滤排除。60是Windows命令引用失败、无实验。等价性62两文件32PASS覆盖原方法/browser调用序列、返回/错误及实际RPC/journal outcomes；64 typecheck PASS。诊断写入非等待、sync/async失败忽略，永久pending sink不阻塞；异步metadata可能缺失或乱序，不作为journal权威。

下一步独立读取目标文档、55deadline map、63和实际candidate源码，判断合法transient及deadline策略后给唯一FIX_PLAN。九项最终统一native65/66已9PASS113.61s。新EXECUTED124已确认发送并取得完成回复67，但Reviewer明确未提供可调用workspace工具，判断仅基于摘要；此回复不是独立source审阅或修复授权。须先选择已连接的workspace工具再要求实际读取。未创建新对话、未重复请求或改变安全连接。当前正在恢复composer工作区工具选择，@草稿操作观察超时，需先读同一标签页，不得盲目重复发送。生产行为修复、freeze/exact-HEAD、真实闭环及lock/producer/global gates仍OPEN。
## HISTORY / SUPERSEDED：当前执行依据：App-proof 嵌套期限图已建立，等待同一 ChatGPT 审阅回复

已按当前 `bf5a0bec` 源码建立 `docs/evidence/iteration123/55-app-proof-deadline-map.md`：记录 outer 90s、Sidecar 生命周期、Direct CDP 单命令期限、post-navigation 10s、reconcile materialization 10s、promotion 2s+10s 以及一次 recovery 的实际调用关系。此项仅为架构诊断，没有修改 timeout 或生产行为。保存的 D28 审阅会话目前浏览器读取连续超时，页面是否生成尚未确认，未读取到真实回复，未重发请求；因此 reason enum/boolean 方案和下一次矩阵仍待该回复或同等独立审阅证据。不得进行 real124 或把 D27/D28 合成历史根因。

## HISTORY / SUPERSEDED：D28 当前：本地native方法阶段诊断通过，真实拒绝子分支仍UNKNOWN

53为3PASS43.01s，54保留逐场景原方法调用阶段。仅修改既有native fixture的显式opt-in observer，委托原captureReplyBaseline/currentConversation/reconcileReplyBaseline调用；无新增浏览器请求，无生产源码变更，不输出正文/digest值/App identity hash/document ID/epoch。

合法250ms延迟成功绑定且baseline count/digest两项匹配；永久缺失在reconcileReplyBaseline约10127ms后抛SendUncertainError；错误digest在同方法17ms拒绝。此为synthetic mechanism诊断，不能确定real123同一子分支，不能据此普通重试。

原ChatGPT长度上限后，同IAB标签页续接至6ac11d08-2104-83ee-925d-32b3455370d0，经实际workspace_info确认DSHWithChatGPT0bc289c1cb51/b6a9061后保存会话，旧对话保留历史。D28已提交该独立审阅，请求基于实际server/driver源码的最小reason enum/boolean分类方案和唯一下一实验。生产修复、后续真实曝光及所有整体gates未通过。
## HISTORY / SUPERSEDED：D27 当前结论：250ms合法延迟已被现有机制覆盖

D27隔离native实验使用编译Sidecar、实际Direct CDP和doctor原90000msproof预算。首次48是夹具错误：受限reload后合成历史及Enter计数未保留，不是生产RED。修正只在synthetic fixture增加显式D27 opt-in历史物化/跨reload计数。50为3PASS35.34s；51保留逐场景元数据；52 typecheck exit0。

合法延迟250ms：7386ms内成功，一次send/Enter，一次wait，无recovery。永久缺失：10819ms SEND_UNCERTAIN，无bound/wait/recovery；错误digest：891ms SEND_UNCERTAIN，无bound/wait/recovery。两者也只发送/Enter一次。51的materialized是fixture window.materialized标记与user存在的合取，不是生产messageObservation状态（wrong-digest在初始文档手动挂载时该标记仍false）。本实验没有记录prompt/reply/digest值。

结论：D27反驳“250ms合法延迟需要新增grace”的假设，未建立生产缺陷RED；不能给real123未知子分支归因，不能据此重复真实曝光。只有diagnostic tests/fixture/doc变更，生产未改。原对话已达到明确长度上限；续接需先真实workspace_info核实，未完成身份核实前保留旧session URL。
## HISTORY / SUPERSEDED：当前执行依据：real123 在 app-proof 绑定前失败，停止该次曝光

冻结提交 b6a9061cc7d13c70d3f1d35c49537008424c2845 在原 ChatGPT 对话取得实际工具读取后的 EXACT_HEAD_SCOPED_REVIEW_PASS，获准一次 fresh real123。此前未读取源码的摘要批准及 REVIEW_BLOCKED 均不能作为通过依据。

real123（run39158fe5-bf88-4a21-972b-9d806ce32fb0）已终止：local doctor localReady=true；app-proof 的 remote_workspace_access 返回 SEND_UNCERTAIN，appDataPlaneVerified=false。耗时12936ms，原proof预算90000ms。journal只有一次 accepted bootstrap send，无 bootstrapBaseline，无 wait、replacement、PLAN、实现或review。具体拒绝子分支 UNKNOWN，不能推定renderer/锁屏/历史Real121根因。

控制器停止该次执行并冻结证据40–47。20个WTS样本可用；停机前仅root/health/journal观察，独立page命令0。停机后单次page probe成功只证明该时点可执行。DSH与两个观察器已确认退出，Sidecar监听0。原oracle五项false、exitCode1。首次观察文件未创建的guard-read-unavailable记录完整保留。

下一行动：将本次accepted但未绑定的失败边界提交原ChatGPT独立复核，先获得唯一可证伪的本地/native实验和停止条件；无普通重试、新target或放宽timeout/身份检查。真实闭环及lock/producer/global gates仍未完成。下文旧状态为历史。
## HISTORY / SUPERSEDED：当前执行依据：post-D26 冻结全量 PASS，等待提交与 exact-HEAD 审阅

2026-10-03 22:38（Asia/Shanghai），获独立方案批准的 post-D26 原命令 pnpm test 已终止，exit0：91 files / 1246 PASS / 3 原有 skips / 777.68s。原始输出见 docs/evidence/iteration123/37-frozen-full-after-d26.txt；终态38确认225个冻结文件哈希与路径无变化，39确认两次冻结清单一致。full 未加载 D26 observer，未改变源码、fixture、timeout 或安全检查。

首次失败19/20仍为 FAILED，原启动失败 cause UNKNOWN；D26只证明本次有限诊断未复现。当前候选源码审阅及全量已通过，但提交/推送、exact-HEAD scoped 审阅、真实产品闭环和后续 lock/producer/global gates 尚未完成。下文运行中和待诊断状态均为历史记录，不能作为当前执行依据。
## HISTORY / SUPERSEDED：当前：D26 完成，按独立方案进行一次 post-D26 冻结全量

原 ChatGPT Web 已给出 FIX_PLAN_PRE_FULL：分类为独立测试启动生命周期失败，保持 staged harness 的源码审阅通过；先做 D26，未复现源码缺陷时允许一次冻结全量复核。未修改任何生产、测试、fixture、timeout 或 ACL 检查。

D26 原始记录 26–35：26 是测试开始前的 Windows import 路径调用错误；28/29 虽6PASS但只观察主进程，时间线不完整，不用于启动分类。30/31 的实际工作进程观察覆盖12个真实 fixture 子进程，6PASS17.40s；32–34 两个不同状态的并发启动均成功。35 汇总14个 ready/exit、0个启动超时、原5000ms计时器及225原哈希不变。native entry 精确加载时间和独立 health 未被现有接口观察；不将 preload 当 entry。诊断脚本及同步 metadata 开销已留存并注明。结论只为 STARTUP_BOUNDARY_UNREPRODUCED_IN_D26；原失败 cause 仍 UNKNOWN。

现按该独立方案的条件启动了一次原命令 pnpm test，未在 full 中加载 D26 observer。冻结36为225文件，和18相同（39），输出37；终态及哈希核对将在38。同一 live shell session77736，不能因观察超时重启。原失败full19/20永久保留，不改写成通过。提交/推送、exact-HEAD harness 审阅和真实产品闭环仍未发生；后续 lock/producer/global gates 仍打开。下文旧待诊断状态作为历史保留。
## Iteration123 frozen full FAILED; isolated diagnostic PASS

The one authorized frozen full is terminal, exit1: 91 files (90 PASS/1 FAIL), 1245 PASS/1 FAIL/3 original skips, 833.66s. All225 candidate hashes and path inventory are unchanged (18/20). The failing unchanged test is sidecar-bootstrap-process.spec.ts, never resends after a crash at after-bound: Sidecar child startup deadline exceeded at the existing 5000ms limit. The original output does not identify first versus restarted child or startup substage. This is a test-fixture readiness failure before recovery assertions, not evidence of real ChatGPT/App/recovery failure. No real product run occurred.

One bounded diagnostic of the unchanged entire bootstrap-process test file passed all6 tests in16.07s (25), with the original5s child/15s case/1s RPC/2s observation budgets and real ACL checks unchanged. This does not erase the failed full or prove environmental causality. Source inspection shows the synthetic child calls private-state provisioning and actual Sidecar startup, which performs pre/post-journal private-state verification; no timing or stage evidence was retained by the failed run. Source/fixture root cause remains UNKNOWN. Do not rerun full or alter budgets/security to obtain green. Next: independent bounded debug review of raw19/20/25 and current unchanged source before a causal experiment or repair.

Full session76423 and diagnostic92807 are terminal. Commit/push, exact-HEAD harness freeze and real product exposure remain NOT_RUN. All later lock/producer/global gates remain open. Earlier running/PASS-pending-full headers below are historical.
## Iteration 123 source supplement PASS; frozen full running

The original ChatGPT Web conversation returned SOURCE_REVIEW_PASS_PENDING_FULL on the corrected candidate. It independently accepted evidence11 as three causal REDs, evidence12 as serialization-only failure, final focused17 as 4 files/39 PASS, typecheck and retained syntax records, self-contained workspace execution, ordinary Node test discovery and the parent in-memory verifier. Production/oracle/observer remain unchanged. It authorizes exactly one frozen full and explicitly keeps overall acceptance open.

One pnpm test was started on the corrected candidate, after freezing 225 source/test/script/config files in evidence18. Running shell session: 76423. Raw output: evidence19. The shell will write evidence20 only after terminal test exit and hash/path recheck. Do not restart or rerun on observation timeout. No package/profile regeneration for harness-only changes; formal push/exact-HEAD and real product run remain pending.
## Iteration 123 corrected candidate after independent FIX

Independent ChatGPT Web returned FIX_PLAN_PRE_FULL in the original conversation. The first candidate had two harness defects: external runtime helper/ordinary writable sibling contract, and narrowed top-level test discovery. Three concrete REDs are retained in 11; 10 retains the first two. File 12 is an implementation/serialization failure, not an architectural RED.

The corrected candidate generates a self-contained workspace test script using only Node built-ins. It embeds canonical literals, as explicitly required by the new FIX plan; this replaces the initial PLAN's suggestion to keep the payload outside the workspace. Recovery files still activate only after the first successful base test. Ordinary node --test discovery is restored; a repeated phase-one test now fails on the intentionally absent recovery implementation. The parent runner holds a frozen in-memory contract, verifies initialization, verifies phase one before launching phase two, and verifies phase two before the unchanged oracle. It checks package.json as well so a changed test entry cannot silently bypass the runner.

Current focused: 4 files / 39 PASS (14), typecheck PASS (15), two explicit syntax checks with command/exit/empty output/SHA in 16. These prove isolated workload behavior, not real DSH/ChatGPT closure. Corrected source supplement is required before one frozen full; no full, commit/push, exact-HEAD or product run has happened. Earlier iteration123 candidate descriptions below are superseded historical records.
## Iteration 123: isolated recovery workload candidate

Real ChatGPT Web startup PLAN is received in the original c2c_c035 conversation. It approves the retained production candidate and requests only a deterministic acceptance workload extension. No product source, original oracle, restart observer, or producer edits are authorized by this scoped plan.

The original subtraction requirements and initial fixture are retained. The first successful base test emits a stdout-only nonce, then activates immutable recovery requirements/tests. Phase one cannot implement the recovery module; phase two must pass both original and recovery tests. The stage is explicitly acceptance-only. The test runner imports the external harness helper and validates an external contract; external-path execution compatibility remains to be independently reviewed and demonstrated in the real DSH run.

Evidence: 03/04 are scaffold failures with zero tests, not behavioral RED. 05 is causal RED (base PASS but missing activation). 09 focused candidate: four files, 34 tests PASS. Typecheck PASS in 08; both changed scripts pass node --check. Independent source review, frozen full, commit/push/exact-HEAD and real product run remain pending. No product readiness or overall completion is claimed.
# Review checkpoint — 2026-10-03 / iteration122

## Current execution basis — explicit resumption / iteration123

The user explicitly resumed the overall goal via the updated goal.md. The
pause below is historical and no longer controls execution. Fetch confirmed
DSHWithChatGPT HEAD d931979050b41871555fd7968897078f742fb12c and producer HEAD
0afd708c288b079096affbfeff4626dcf9a19bf1 on feat/complete-c2c-runtime, both
equal to upstream (0 ahead / 0 behind). Only goal.md had user-owned edits.

The original review conversation was read directly: iteration122 returned
DONE_SCOPED_PAUSED with REVIEWED_HEAD_PREFIX d931979. It accepted the frozen
cold-handoff scope and raw644–649; the connector exposed only the short SHA,
which is consistent with the locally verified full SHA. No supplemental full
regression or cold-handoff development is justified by this resumption alone.

One iteration123 startup review has been sent in the same development chat
with the visible highest reasoning setting (极高). Its PLAN is pending. It
must assess deterministic real fix/restart workload coverage before exposure;
an initial DONE does not satisfy the original recovery oracle. Real closure,
Windows lock qualification, producer Git gate and global review remain open.

## Historical iteration122 delivery and review hold

本轮交付：修复替代页面在会话内容尚未就绪时过早进入严格核对的问题。已通过独立源码审阅；冻结全量、安装包及两次安装配置验证均已通过；全部修改与证据随本提交交付，整体实施按用户要求暂停，等待仔细审阅及明确恢复。

审阅重点：生产改动仅在部署事务中增加已有的有界就绪交接；不增加重发或第二次换页，不放宽消息/App/最终证明，也不延长原期限。原生合成测试通过不等于真实产品闭环成功，real121的具体失败分支仍未知。

错误复盘已区分产品缺陷、夹具问题、观察方法误判和本地调用错误，并为每类错误设置后续防复发检查。以下记录验证、边界及明确恢复后的执行顺序。

User requested completion of the latest task, publication of all changes, then
suspension of the overall goal for manual review. The latest task is the owned
App-proof cold-replacement semantic handoff. No new real canonical run is part
of this checkpoint. goal.md is explicitly authorized for inclusion in this commit.

## Change and independent review

The deployment transaction now establishes existing bounded semantic readiness
on the owned replacement after fresh-service health and before the SAME strict
reconciliation/wait. It retains the original proof signal/deadline, one trusted
replacement, one original send/Enter, exact baseline/identity and proof-gated
commit/source retirement. No browser proof/parser/journal/transport/oracle change.

Independent ChatGPT iteration122: SOURCE_REVIEW_PASS_PENDING_FULL. The causal
RED is raw638; earlier raw628–637 are fixture-development failures, not proof of
real121 cause. Final native topology and fail-closed negatives are accepted.

## Verification at this checkpoint

| Gate | Status |
|---|---|
| Causal cold native RED | SEND_UNCERTAIN on unchanged recovery, one bound send/same wait, one rollback/no commit/source retirement |
| Focused native/adversarial | 6 files / 73 PASS / 232.72s, including nine native App recovery scenarios |
| Doctor compatibility | 4 actual files / 55 PASS / 32.69s; nonexistent fifth filter did not run |
| Typecheck/build | PASS |
| Frozen full | 90 files / 1239 PASS / 3 original skips / 909.66s; exit0 and all197 source/test hashes unchanged |
| Fresh package/profile/association | Package3ZkHDf PASS; profile18xaSF two native composition attempts PASS; ten compiled/packed modules byte-identical; real Browser/App NOT_RUN |
| Exact pushed scoped review | Post-push supplement for this commit; live verdict retained in the original C2C review conversation |
| Real product closure | Not run for this candidate; previous real121 failed with original all-false oracle |

Original outputs, including the initial fixture failures, are archived in [verification evidence](evidence/iteration122/README.md). Independent review conversation: https://chatgpt.com/c/6abe16fa-354c-83ee-a7db-b8ebe269ac48 (task c2c_c035, iteration122). This commit includes all main-repository modifications; producer and codex-with-chatgpt checkouts are clean. Private credentials/journals are not Git artifacts.

## Honest remaining gap

The cold handoff is a proven source/coverage gap. Its precise causal role in
real121 remains unproven; the exact pre-resume SEND_UNCERTAIN subbranch was not
logged. Local/native synthetic checks do not establish real App/PLAN/execution/
REVIEW/fix/restart/second round/DONE/oracle closure. Windows lock capability,
producer Windows Git gate and final global exact-HEAD audit remain open.

## Next plan after the user's review and explicit resumption

1. Revalidate reviewed/pushed HEAD, clean worktree, matching package and private
   configuration; preserve old uncertain task/journal/source evidence.
2. If scoped freeze is accepted, one fresh original acceptance-capable run with
   authoritative WTS and continuous root/health/journal observers only. No
   independent page commands before first product failure.
3. If App succeeds, continue SAME run through INIT/PLAN, actual DeepSeek changes/
   tests/stdout-only nonce, push, independent REVIEW, mandatory fix, actual DSH
   restart/reconnect, second execution/review, exact same-round DONE/all-true oracle.
4. If failure occurs, stop once. Existing recover method/phase distinguishes
   pre-handoff, semantic-ready failure, pre-resume reconciliation failure and
   resumed wait. Only recover=accepted with wait still uncertain can justify a
   later bounded diagnostic distinguishing driver uncertainty vs baseline mismatch.
   No ordinary retry, speculative canonical expansion or preemptive telemetry.
5. After unlocked closure, qualify WTS lock/pause/revalidation and recovery;
   handle producer Windows Git gate; complete final global exact-HEAD audit.

## Review navigation and recurrence controls

- [Authoritative goal](goal.md)
- [Current delivery checkpoint and retained history](current-delivery-plan.md)
- [Error lessons, evidence limits and recurrence checks](browser-platform-investigation.md)
- Production diff: package/src/deployment/dsh-runtime.ts.
- Cold/native and controlled coverage: package/tests/doctor-owned-recovery-native.spec.ts,
  package/tests/doctor-owned-recovery.spec.ts and synthetic-cdp-document fixture.

Each new failure must preserve originals, distinguish product/fixture/observer
boundaries, document cause vs uncertainty and add a concrete recurrence check.
No repeat of an already-failed approach without a new falsifiable hypothesis.

Prepared iteration123 scripts are temporary, syntax-checked only, never executed.
They explicitly label source vs replacement pointers and whether a post-failure
page command was actually issued. They are not new production behavior or proof.
