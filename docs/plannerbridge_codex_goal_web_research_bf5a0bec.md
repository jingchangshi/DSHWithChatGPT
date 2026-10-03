# PlannerBridge Goal：从 bf5a0bec / D28 继续，先关闭 accepted-but-unbound 绑定边界，再完成 Windows 产品闭环

你正在 Windows 11 Codex Desktop 的 Goal 模式中工作。必须主动使用本机已安装的 codex-with-chatgpt 插件，让 ChatGPT Web 高思考模型负责独立规划、源码/证据审阅、关键修复授权和最终 exact-HEAD 审阅；Codex 负责代码、测试、Git、运行与证据整理。

普通工程问题不要停下来询问用户。只有登录/2FA/CAPTCHA、缺失真实 credential、不可逆外部操作或必须由用户决定的产品范围时才请求一次明确操作。

本轮最终目标不变：

Windows DSH / DeepSeek Executor
→ ChatGPT Web Planner
→ 实现与测试
→ commit/push
→ ChatGPT Web Reviewer 独立读取 source/Git/raw execution_output
→ 真实 fix PLAN
→ 实际 DSH restart + same-task reconnect
→ 第二轮实现/测试/提交/审阅
→ exact same-round DONE
→ 原 acceptance oracle 所有 required gates 通过。

Linux cross-host 仍为 FUTURE；Browser Harness 仍仅为 compatibility path。不得用 API Planner、假 Reviewer、Codex 自己的判断或 synthetic Browser/App 结果替代真实 ChatGPT Web 产品链路。

---

## 0. 当前 Git 基线：开始时重新核对，禁止机械依赖历史 SHA

仓库：

C:\Users\jingc\workspace\DSHWithChatGPT
C:\Users\jingc\workspace\deepseek-harness

目标分支均为：

feat/complete-c2c-runtime

本提示词生成时 GitHub feature HEAD：

DSHWithChatGPT:
bf5a0bec82261f1e82695cd4126515b35ca4dd5f

deepseek-harness:
0afd708c288b079096affbfeff4626dcf9a19bf1

开始时实际执行：

git status
git fetch
git rev-parse HEAD
git rev-parse @{upstream}
git log -n 20 --oneline

不得 hard reset，不覆盖未提交修改。如果远端 HEAD 又变化，先阅读新提交与证据，再更新判断。

重要事实：从 d931979 到当前 bf5a0bec，产品生产路径没有新的 src 行为修复；后续主要新增了真实 recovery acceptance workload、测试/fixture、D26-D28 诊断与证据。不要把测试夹具变化误描述为产品行为已经修复。

---

## 1. 先完整读取当前权威证据，不重新开始已完成工作

优先阅读：

docs/review-checkpoint-2026-10-03.md
docs/current-delivery-plan.md
docs/browser-platform-investigation.md
docs/acceptance-plan.md
docs/evidence/iteration123/README.md

重点原始证据：

docs/evidence/iteration123/37-frozen-full-after-d26.txt
docs/evidence/iteration123/40-real123-stdout.txt
docs/evidence/iteration123/41-real123-observed.jsonl
docs/evidence/iteration123/42-real123-control.jsonl
docs/evidence/iteration123/43-real123-root-timeline.jsonl
docs/evidence/iteration123/44-real123-wts.jsonl
docs/evidence/iteration123/45-real123-post-failure-probe.jsonl
docs/evidence/iteration123/46-real123-terminal.json
docs/evidence/iteration123/47-real123-failure-summary.json
docs/evidence/iteration123/50-d27-retained.txt
docs/evidence/iteration123/51-d27-metadata.jsonl
docs/evidence/iteration123/53-d28-provenance-native.txt
docs/evidence/iteration123/54-d28-provenance.jsonl

重点源码：

package/src/readiness/doctor.ts
package/src/sidecar/{client,rpc-http,server,journal}.ts
package/src/browser/{chatgpt-web-driver,message-observation,direct-cdp,cdp-session,transitions}.ts
package/src/deployment/{dsh-runtime,sidecar-control,sidecar-supervisor,sidecar-target-recovery}.ts

重点测试/acceptance：

package/scripts/planner-executor-workload.mjs
package/scripts/verify-planner-executor-e2e.mjs
package/scripts/planner-executor-acceptance.mjs
package/tests/fixtures/planner-executor-e2e-observer.mjs
package/tests/planner-executor-recovery-stage.spec.ts
package/tests/doctor-bind-boundary-native.spec.ts
package/tests/fixtures/app-proof-recovery-sidecar.mjs
package/tests/fixtures/synthetic-cdp-document.ts

producer：

packages/execution/execution-world/src/git-lease.ts
packages/execution/execution-world/tests/git-lease-windows.spec.ts
以及其 FS/subprocess/sandbox/affinity/Windows Job 依赖。

只在实际源码或新反例要求时重开已 scoped-accepted 的 transport、cold replacement、page classification、workspace authority foundation。

---

## 2. 当前已经完成的内容：不要重复实现

### A. iteration122 product foundation

已冻结并 scoped review：
- cold replacement semantic handoff；
- one-send / same-wait / strict identity/proof / commit-or-rollback；
- transport cancellation/admission fencing；
- page-unavailable classification；
- package/profile/build association。

这些不是总体产品 PASS，但没有新反例不得重新设计。

### B. deterministic fix/restart acceptance workload

当前已经有自包含 staged workload：

phase1：
- 实现原 subtractIntervals；
- 原测试成功后产生 stdout-only nonce；
- 激活 immutable recovery requirement/tests；
- phase1 禁止提前实现 recovery module。

真实 Reviewer 因工作区新增、真实未满足的 recovery requirement 应给出 fix PLAN。

phase2：
- 必须实际 restart/reconnect；
- 实现 recovery module；
- 原要求和 recovery 要求均通过；
- 产生新的 stdout-only nonce；
- exact HEAD 再 REVIEW。

父 runner 持有独立 in-memory contract，并已有 bypass/discovery/premature-implementation tests。

不要重新设计“如何强制产生 fix/restart”；先让当前 App-proof 前置阻塞关闭后实际验证这条路径。

### C. D26

首次 frozen full 曾有 Sidecar child 5s startup failure；D26 没有复现，随后同一候选原 pnpm test：
91 files / 1246 PASS / 3 original skips / 777.68s。

原失败 cause 仍 UNKNOWN，后一次 PASS 不改写前一次失败。

没有新的 startup 反例时，不再扩大 D26，不增加 timeout。

---

## 3. 当前唯一产品 critical blocker：real123 accepted-but-unbound

real123：

run:
39158fe5-bf88-4a21-972b-9d806ce32fb0

consumer:
b6a9061cc7d13c70d3f1d35c49537008424c2845

producer:
0afd708c288b079096affbfeff4626dcf9a19bf1

事实：

- local doctor localReady=true。
- app-proof 失败为 remote_workspace_access SEND_UNCERTAIN。
- app-proof 总耗时约 12936ms；外层 proof budget 90000ms。
- journal 有且只有一个 accepted bootstrap send。
- bootstrapPresent=true。
- bootstrapBaselinePresent=false。
- 没有 waitForReply entry。
- 没有 replacement。
- 没有 PLAN、Executor implementation、REVIEW。
- failure 前 independent page command=0。
- WTS 20/20 usable，Chrome foreground。
- failure 后单次 page probe 成功只能证明该时点可执行，不能证明历史根因。
- oracle 五项 false，exitCode=1。

所以当前问题发生在：

send ACK / accepted
→ captureSendObservation / bootstrap durable binding
→ FAIL

不是 Real121 的：

bound send
→ wait uncertain
→ owned replacement recovery

不得把 Real123 归因为 cold replacement、Windows lock、renderer crash 或 Real121 相同根因。

---

## 4. D27/D28 已经证明什么、没有证明什么

D27/D28 使用 actual compiled Sidecar + actual Direct CDP + original driver/server/doctor，在 synthetic page 中诊断当前绑定路径。

结果：

delayed-valid（250ms）：
- 成功；
- one send/Enter；
- one wait；
- no recovery；
- baseline count/digest 匹配。

permanent-missing：
- SEND_UNCERTAIN；
- reconcileReplyBaseline 约 10.1s 后抛 SendUncertainError；
- no bound baseline；
- no wait/recovery。

wrong-digest：
- SEND_UNCERTAIN；
- reconcileReplyBaseline 很快拒绝；
- no bound baseline；
- no wait/recovery。

因此：

1. “只需给 250ms grace”已被反驳。
2. D27/D28 仍不能说明 real123 属于 permanent-missing、wrong-digest 或其他分支。
3. 不能普通重试 real123。
4. 当前需要的是能改变后续修复决策的最小分类证据，不是更多泛化 telemetry。

---

## 5. 本轮新增的架构检查：建立 App-proof deadline/budget map

这是本轮必须新增的检查，不等于立刻修改 timeout。

过去已经发生过：
600s semantic wait
被 Undici 隐式约 300s transport headers timeout 提前截断。

当前 App proof 又有类似的“嵌套期限”结构：

- outer appProofTimeoutMs：90s；
- Sidecar/request 生命周期；
- ChatGptWebDriver currentConversation 的 POST_NAVIGATION_SEMANTIC_TIMEOUT_MS：10s；
- reconcileReplyBaseline 内 materialization 窗口：10s；
- promotion proof 内部等待/reload/materialization 窗口；
- Direct CDP 单 command 默认约 5s；
- page load / composer readiness 各自还有局部预算。

先画出一张实际调用路径的 **deadline/budget table**：

阶段
→ owner
→ timeout/deadline 来源
→ 是否 absolute / relative
→ 是否会刷新
→ 超时公开错误
→ 超时后 journal phase
→ 是否留下 owner
→ 是否还能安全 reconcile
→ 与外层 90s 的关系。

目标不是“把所有 timeout 调大”，而是找出：
**是否存在一个比外层 90s 更短、且会拒绝仍可能合法进展的隐藏子期限。**

每个短子期限都必须说明它保护什么安全属性；不能因为外层更长就直接删除。

---

## 6. 优先读取 D28 独立审阅回复，然后执行一个新的本地 falsification matrix

D28 已经提交独立 ChatGPT 审阅。先在已保存的续接会话中读取真实回复；不要因为网页观察 timeout 重发。

如果回复已明确给出 reason enum / boolean 方案，优先使用它。

如果回复不可获得，重新提交前先确认同一会话是否已有已发送消息、draft 或正在生成状态；保证只发一次。

下一本地实验必须至少覆盖：

A. exact valid，短延迟（已知 control）
B. exact valid，接近当前 10s semantic 子期限但仍小于它
C. exact valid，在当前 10s 子期限之后但仍远小于 outer 90s
D. transient structurally ambiguous → 随后 exact valid
E. permanent missing
F. explicit foreign/wrong digest
G. duplicate/ambiguous user
H. wrong App identity
I. target/document/route change

其中 D 的“ambiguous”必须来自真实 `messageObservationScript` 当前会返回 null/不可判定的结构，而不是虚构一个生产永远不会出现的状态。

实验目标不是让 C/D 必须 PASS，而是确定：

- 当前代码究竟在哪个 reason 分支失败；
- explicit mismatch 是否能与 transient unclassifiable/absence 区分；
- 10s 内部窗口是否是真正的可用性截断点；
- 哪些状态可以在不降低 identity/proof 安全性的前提下继续观察。

保留：
- one send/Enter；
- same control digest identity；
- no resend；
- no second target；
- original outer proof signal；
- strict wrong-App/wrong-digest/foreign/duplicate rejection。

---

## 7. reason classification 的要求：行为不变、无正文、无额外 browser command

目前 `messageObservationScript` 将很多结构异常统一折叠为 null，而 `reconcileReplyBaseline` 之后统一变成 SEND_UNCERTAIN。

如果独立审阅认可，加入最小 typed classification，例如概念上区分：

- no_user_yet
- app_render_pending
- observation_structurally_ambiguous
- explicit_foreign_user
- explicit_wrong_app
- explicit_wrong_digest
- duplicate_or_not_last_user
- conversation_mismatch
- baseline_count_mismatch
- baseline_digest_mismatch
- target_or_document_changed
- semantic_ready

实际 enum 命名以源码审阅结果为准，不机械使用上面的名字。

要求：

- 不记录 prompt/reply/body。
- 不记录实际 digest。
- 不记录 credential/cookie/challenge。
- 不记录 App identity hash、document ID、epoch 的原值。
- 可以记录 boolean match 和 reason enum。
- 不新增浏览器请求；复用原一次 observation 的结果。
- diagnostic logging 失败不能改变 provider return/throw。
- observer 不得 `await` 一个可能阻塞产品调用的文件写入路径，除非已经通过测试证明它是行为等价且有界的。
- diagnostics disabled/enabled 必须有等价性测试：原方法调用次数、浏览器命令次数、journal outcome、return/error type 完全一致。

D28 当前 wrapper 在调用前后有 await emit；因此把它带入真实产品前，必须先证明不会改变时序/失败语义。诊断缺失只能记为 INCOMPLETE，不能变成产品失败。

---

## 8. 只有 causal RED 后才允许产品行为修复

若本地实验出现：

transient unclassifiable / no-user-yet
→ 后续在同一 target/document/durable conversation 上成为 exact valid
→ 当前实现却提前 SEND_UNCERTAIN

这才形成一个新的 availability RED。

独立 ChatGPT 审阅必须判断它是否代表生产可接受状态。

若授权修复，原则是：

1. 不重发。
2. 不重新激活 App。
3. 不换 target。
4. 不改变 exact App/control digest/last-user proof。
5. explicit mismatch 立即 fail closed，不等待它“变正确”。
6. 只允许真正的 absence/unclassifiable/pending state 在同一 target/document/route 下继续只读观察。
7. 保持 outer app-proof absolute deadline；不得重新起一个新的 90s。
8. 不把无限 DOM churn 当进展。
9. 最多保留现有一次受控 materialization reload，不增加普通 retry。
10. mismatch/error 仍然维持现有 public error contract，除非协议级变更有独立必要性。

deadline 修复不要默认采用“把 10s 改成 30s”。

优先要求独立 Reviewer 比较：

- 固定 10s 子期限；
- 使用 outer cancellation signal 但限定合法 transient state；
- progress-aware/no-progress 子预算；
- 显式从上层传递 absolute deadline。

选择侵入最小、不会延长身份不确定窗口到不必要程度的方案。

任何方案都必须有 permanent-missing 和 hostile mismatch 的时间上界测试。

如果 C（>10s exact valid）失败，但 D（transient ambiguity）并不是生产可接受状态，只能记录 deadline tradeoff，不得为了通过测试擅自放宽安全 gate。

---

## 9. 网络公开讨论带来的三个辅助诊断，只在对应反例出现时启用

### A. JS modal dialog 可导致 renderer command 挂起

公开 Chrome DevTools MCP 问题表明：
一个未处理的 alert/confirm/prompt 可以暂停 renderer，使 evaluate 一直挂到 protocol timeout，而 browser-level 连接仍然正常。

当前 Direct CDP 已经 Page.enable。

因此如果以后再次出现：
Browser.getVersion/root healthy
+
same target page Runtime/Page command timeout

可以考虑只被动订阅已有 Page domain 的：
Page.javascriptDialogOpening
Page.javascriptDialogClosed

记录：
dialogOpen boolean / type enum / timestamp
不记录 dialog message/body。

不要为了 Real123 accepted-but-unbound 预先加入此功能；它属于 page-unresponsive 再现时的低扰动分类手段。

### B. background/occlusion throttling 是真实现象，但 flags 不是可靠证明

公开 Puppeteer/Playwright Windows/headful 讨论有：
后台 tab/occluded window 变慢甚至命令 timeout，
foreground 后恢复，
若干 `--disable-background-*` flags 在不同 Chrome 版本并不稳定。

所以保持当前原则：
- flags 不作为根因证明或正式修复；
- 解锁 canonical closure 优先；
- WTS authoritative；
- Chrome foreground/visibility 只作为不同层级证据；
- 不把“bringToFront 后成功”写成因果结论。

### C. Windows lock/unlock 后续改用事件级权威证据

最终 lock qualification 时优先使用 Windows 官方 WTS session change：
WTS_SESSION_LOCK / WTS_SESSION_UNLOCK（或对应服务通知），
而不是 LockApp 进程存在、窗口是否可见或一次性采样来推断整个区间。

此项在 unlocked product closure 之后做，不阻塞当前 accepted-but-unbound 修复。

---

## 10. 若 Sidecar child 5s startup flake 再次出现，改进诊断而非改 timeout

公开 Vitest/Windows 讨论存在：
loaded Windows 上 worker/process startup 在并发 full suite 中偶发超时、隔离运行通过的模式。

这只能说明 D26 的“全量失败、隔离通过、后续未复现”有同类环境可能性，不能证明当前历史失败原因。

如果它再次出现，优先在 test fixture 子进程增加显式 opt-in IPC phase timestamps：

parent_spawn_called
child_process_entry
private_state_precheck_done
journal_open_done
private_state_postcheck_done
server_listen_done
health_ready
child_exit

不得修改 production Sidecar 行为。
不得把 5s 改大来获得绿色。
不得用 preload 时间假装 native entry 时间。
诊断必须能区分：
process creation delay
vs module/import
vs ACL/private-state
vs journal
vs listen/health。

只有重复 RED 指向固定阶段后才修复。

---

## 11. producer Windows Git gate 暂不抢占当前 blocker，但后续诊断要阶段化

producer HEAD 当前仍为 0afd708。

保留：
- 13 个允许 Git query 的完整语义覆盖；
- hardened-windows assurance；
- hostile helper/env tripwire；
- repository snapshot；
- Job/process-tree quiescence；
- argv/env sanitization；
- 不延长 20s per-command ceiling 来掩盖问题。

产品闭环成功后再处理原 producer deadline gate。

届时先记录阶段耗时：

lease acquisition
terminalEnvironment
sandbox/Job setup
spawn accepted
git process exit
waitForExit/quiescence
stdout/stderr collect
per-operation snapshot verification
lease dispose

公开 Node/Windows 历史问题说明 child_process 在某些 Windows 环境下可能有显著启动差异；它只能作为“应测量 process-start boundary”的理由，不是根因结论。

---

## 12. 新真实曝光的授权规则

不能把 real123 的一次授权自动延续为 real124。

本地/native：
- causal RED；
- minimal behavior fix（如有）；
- hostile negatives；
- typecheck/build；
- 独立 source review；
- 如改 production source，按审阅要求一次 frozen full/package/profile/association；
- exact pushed HEAD scoped review；

全部满足后，再请求独立 ChatGPT 明确批准 **一次** 新 real product exposure。

若只增加 behavior-neutral diagnostic：
- 做 equivalence/fail-open tests；
- focused/typecheck；
- 独立 review；
- 是否需要 full/package 由 reviewer 根据实际变更决定，不机械跑全套。

真实 exposure：
- fresh explicit target/journal/workspace/task；
- matching installed artifact；
- WTS continuous authoritative samples；
- pre-failure observer 仅 root/health/journal/WTS metadata；
- 不建立独立 page command stream；
- 第一未建模产品 failure 停止新的 business send；
- existing already-authorized recovery transaction 可以按 contract 完成；
- 保存原始证据；
- 不 ordinary retry。

如果 App proof PASS，绝不能停在 PLAN：
继续同一 run 完成 phase1 implementation/test/nonce/push/REVIEW/fix，
actual DSH restart/reconnect，
phase2 implementation/test/new nonce/push/REVIEW，
exact same-round DONE/oracle。

---

## 13. Web/SPA 的公开经验应转化为可证伪规则，而不是换框架

公开 Playwright hydration 文档/issue指出：
页面元素可已经可见，但应用 hydration/event handlers 仍未完全就绪。

公开 Puppeteer issue也记录：
History API 的 URL 变化可能出现跟踪时序问题。

因此当前 Direct CDP 的这些设计应保留：

- URL 不是唯一 truth；
- `Page.navigatedWithinDocument` provenance；
- `location.href` cross-check；
- transition sequence；
- unique execution context/document identity；
- exact persisted outgoing message proof。

不要因为网络讨论改用“URL 已变=发送成功”。

真正需要验证的是：
**durable URL 已存在之后，语义 DOM 是否仍可能处于合法 transient state，而当前 observation 把它误归为 terminal uncertainty。**

这正是第 6–8 节 falsification 的核心。

不要因此切换 Playwright/Puppeteer 或引入第二套 browser stack；网络经验只用于验证当前 Direct CDP contract。

---

## 14. 证据与文档纪律

每个 checkpoint 的顶部必须只有一个“当前执行依据”。

历史状态保留，但明确 HISTORY / SUPERSEDED，避免 Agent 重新执行旧步骤。

每个失败记录：

- exact consumer/producer/package identity；
- run/task/iteration；
- last success；
- first failure；
- elapsed vs every relevant nested deadline；
- journal entries/phases；
- browser target/document/route classification；
- WTS；
- observer contamination；
- processes/listeners terminal state；
- known / unknown；
- excluded claims；
- unique next falsification。

不要把：
PASS after retry
改写成
original failure resolved。

不要把：
mechanism reproduced
改写成
historical root cause proven。

不要把：
local/native synthetic PASS
改写成
real product PASS。

不要把：
DONE_SCOPED
累加成
overall DONE。

---

## 15. 现在立即执行的顺序

1. 核对两个仓库最新 HEAD/upstream/worktree。
2. 阅读 bf5a0bec 新增全部 evidence 与相关 source。
3. 读取 D28 独立 ChatGPT review 的真实回复。
4. 建立 App-proof nested deadline/budget table。
5. 按 Reviewer 方案实现 behavior-neutral reason classification/equivalence tests。
6. 做第 6 节 transient/delay/mismatch native falsification matrix。
7. 根据 RED：
   - 有真实 availability defect → 独立 FIX_PLAN → 最小修复；
   - 无 defect → 不改 production，提交分类结果并请求唯一下一实验；
   - 证据仍不足 → 只补能改变决策的分类，不真实重试。
8. 满足 freeze/exact-HEAD gate 后，才进行一次 fresh real exposure。
9. App PASS 后一直推进完整 staged recovery E2E，不停在 PLAN。
10. unlocked product closure 后再做 lock qualification。
11. 再处理 producer Windows Git deadline gate。
12. 最终对两个 exact HEAD 做 global review。

不要只输出计划后停止。通过 codex-with-chatgpt 持续推进规划→实现→审阅闭环；但每个真实浏览器暴露都必须遵循“一次假设、一次可证伪 exposure、首个未建模失败即停”的规则。
