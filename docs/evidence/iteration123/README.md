## D28 当前：本地native方法阶段诊断通过，真实拒绝子分支仍UNKNOWN

53为3PASS43.01s，54保留逐场景原方法调用阶段。仅修改既有native fixture的显式opt-in observer，委托原captureReplyBaseline/currentConversation/reconcileReplyBaseline调用；无新增浏览器请求，无生产源码变更，不输出正文/digest值/App identity hash/document ID/epoch。

合法250ms延迟成功绑定且baseline count/digest两项匹配；永久缺失在reconcileReplyBaseline约10127ms后抛SendUncertainError；错误digest在同方法17ms拒绝。此为synthetic mechanism诊断，不能确定real123同一子分支，不能据此普通重试。

原ChatGPT长度上限后，同IAB标签页续接至6ac11d08-2104-83ee-925d-32b3455370d0，经实际workspace_info确认DSHWithChatGPT0bc289c1cb51/b6a9061后保存会话，旧对话保留历史。D28已提交该独立审阅，请求基于实际server/driver源码的最小reason enum/boolean分类方案和唯一下一实验。生产修复、后续真实曝光及所有整体gates未通过。
## D27 当前结论：250ms合法延迟已被现有机制覆盖

D27隔离native实验使用编译Sidecar、实际Direct CDP和doctor原90000msproof预算。首次48是夹具错误：受限reload后合成历史及Enter计数未保留，不是生产RED。修正只在synthetic fixture增加显式D27 opt-in历史物化/跨reload计数。50为3PASS35.34s；51保留逐场景元数据；52 typecheck exit0。

合法延迟250ms：7386ms内成功，一次send/Enter，一次wait，无recovery。永久缺失：10819ms SEND_UNCERTAIN，无bound/wait/recovery；错误digest：891ms SEND_UNCERTAIN，无bound/wait/recovery。两者也只发送/Enter一次。51的materialized是fixture window.materialized标记与user存在的合取，不是生产messageObservation状态（wrong-digest在初始文档手动挂载时该标记仍false）。本实验没有记录prompt/reply/digest值。

结论：D27反驳“250ms合法延迟需要新增grace”的假设，未建立生产缺陷RED；不能给real123未知子分支归因，不能据此重复真实曝光。只有diagnostic tests/fixture/doc变更，生产未改。原对话已达到明确长度上限；续接需先真实workspace_info核实，未完成身份核实前保留旧session URL。
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


Independent source review submission was attempted once. CUA fill/click/state batch timed out, then the same-URL getTab observation timed out. Delivery is UNCONFIRMED; do not resend before reading the original conversation/draft. No frozen full, commit/push or real run yet.


Submission uncertainty reconciled: original same tab 1 existed; authoritative page showed review draft in composer (not sent). Clicked Send once after that observation; following snapshot showed the single REVIEW message, empty composer, ChatGPT thinking and Stop. Independent source review is now live. No reload/new chat/repeated send.

Current final focused is 17 (4 files/39 PASS), superseding 14 after EOF normalization; syntax16 hashes match current scripts. Corrected supplement was filled, draft observed, Send clicked once, and page confirmed the unique EXECUTED message with ongoing reasoning and Stop. Same tab1 retained. No product exposure/full yet.

Producer association supplement: 22 resolves five actual installed peer entries versus producer self-exports. 23 inventories 34 producer build JS outputs and has allMatch=false because unpublished types/*.js are absent from package files lists; this is an inventory-scope difference, not runtime failure. 24 retains the actual files/exports manifests and verifies all 12 installed peer JS modules against producer build: allMatch=true. The raw inventory difference is preserved. No producer source/build modification or deadline PASS is claimed.
