你正在 Windows 11 Codex Desktop 的 Goal 模式中工作。

你拥有并必须主动使用 `codex-with-chatgpt` 插件。你的职责是持续推进实现、测试、Git 和真实验收；ChatGPT Web 高思考模型负责独立规划、架构/安全审阅和最终 exact-HEAD 审阅。

除非遇到登录、2FA、CAPTCHA、缺失真实 credential、不可逆外部操作或确实必须由用户决定的产品选择，否则不要停下来询问用户。发现普通实现问题时继续分析、修复、测试和审阅。

## 2026-10-03 目标刷新：以真实产品闭环为唯一交付主线

本节为当前执行依据，优先于后续历史步骤。依据 codex-with-chatgpt 独立 ARCHITECTURE_PLAN、iteration115/117/120 exact-HEAD DONE_SCOPED 和 iteration121 RECONCILIATION_FIX_PLAN / COLD_REPLACEMENT_HANDOFF_FIX_PLAN 刷新。历史证据保留于 docs/current-delivery-plan.md 与 docs/browser-platform-investigation.md；不再执行过期运行指令。

**最终目标：Windows 上真实、可恢复、证据闭环的 ChatGPT Planner/Reviewer + DSH/DeepSeek Executor 产品工作流。** Codex负责执行，ChatGPT独立规划和审阅。连接成功、局部测试、App proof或有效PLAN均非完成条件。整体active/incomplete。

**用户审阅暂停要求（2026-10-03）：** 完成本轮iteration122冷页面交接修复的剩余冻结验证、整理全部修改/信息、规范commit并push后，暂停整体目标实施，等待用户仔细审阅并明确恢复。此次明确授权提交全部修改，包含此前用户拥有而未自动提交的goal.md。不得启动新的真实canonical123、锁屏实验或producer修复。下一步方案见review-checkpoint-2026-10-03.md，恢复前须重新核对实际Git/包/运行状态。

**本轮交付检查点：** iteration122已获独立SOURCE_REVIEW_PASS_PENDING_FULL，后续冻结全量90files1239PASS/3original skips909.66s，197hashes全部未变；fresh package3ZkHDf、profile18xaSF两次组合验证及10个built/packed模块关联PASS。代码、用户已有goal修改、复盘与原始证据随本次提交交付，SHA以Git为准。当前只完成本轮交付和推送后的scoped复核，之后按用户要求暂停。没有新的真实123验收；整体目标未完成。下一步只形成方案，待用户明确恢复再实施。

### 已冻结基线与真实证据

- 本候选修复前已冻结的主库base HEAD：163ea98413343e2c7f1372d08820281e8d40e86a；producer：0afd708c288b079096affbfeff4626dcf9a19bf1。
- M1传输、页面失响应分类及iteration120一次owned App-proof恢复已获scoped exact-HEAD接受。只有具体新反例才重开对应边界。
- Frozen120：90files1231PASS/3original skips773.15s，197源码/测试哈希未变；typecheck/build、fresh package qhd1m2、installed profile CrfKSV两次组合验证、10个built/packed模块关联PASS。全量进程已终态，不重复运行；native synthetic GREEN不证明真实产品验收。
- Real121原canonical：localReady PASS；唯一accepted send绑定durable conversation，原wait变uncertain；一次trusted replacement创建，恢复在resumeObservation之前失败，最终SEND_UNCERTAIN并回滚。具体reconciliation子分支未知，不追认为proof mismatch。
- Real121 WTS15/15可用/解锁/Chrome前台；失败前独立页面连接/命令为0。事后probe指向已回滚replacement，未执行页面命令，不证明新renderer超时。Executor/观察进程终止、服务无监听；journal18与源浏览器保留。无INIT/PLAN/重发，exit1、全false oracle；九份原始输出已发布。
- Real119零连续独立页面观察时同源target仍有页面命令超时；支持页面控制故障，不证明renderer崩溃或OpenAI根本禁止流程。Real121的新边界是恢复交接，不应继续泛归因锁屏或传输。

**iteration122当前检查点：** cold native RED已复现；最小semantic handoff修复已实施。最终focused6files73PASS（含9个native恢复场景）、doctor兼容4files55PASS、typecheck/build PASS。稳定歧义在readiness阶段BROWSER_STALE且零resume；exact消息/App/digest错误仍SEND_UNCERTAIN，错误最终proof仍对应mismatch并回滚。当前下一步为独立source review；尚未执行本候选full/package/profile/push/exact-HEAD或真实验收。原fixture失败已保留并纳入复盘，不追认为real121根因已确认。


Independent122 SOURCE_REVIEW_PASS_PENDING_FULL received: actual production diff, causal RED raw638, focused raw641 and regression outputs independently reviewed; no concrete source fix remains. Cold synthetic handoff topology and native negative coverage accepted with stated limits. No preemptive telemetry patch: existing recover method/phase separates pre-handoff, semantic-ready failure, pre-resume reconciliation failure and resumed wait. Exact real121 subbranch remains unknown. Frozen full122 now running on unchanged candidate; no production/test edits during it. Next: full terminal/hash equality → fresh package/profile/association → push/exact-HEAD supplement → one fresh original canonical closure run.

### 当前关键路径：冷页面交接RED → 最小修复 → 产品闭环

独立121源码分析指出：trusted target + durable URL + fresh Sidecar health不足以证明会话内容已就绪。现有事务从health直接进入exact reconciliation；native120却预先加载/物化donor，遗漏cold-handoff拓扑。**这是源码与覆盖缺口；是否为real121实际原因，仍须受控RED/GREEN及后续真实证据确认。**

1. **先deterministic native RED，暂不运行canonical122。** trusted replacement正常返回，URL正确、root健康、health可通过，初始消息观察不可用；恢复收到target后才延迟物化exact原发送和有效回复。不得提前navigate/waitForLoad/物化。记录当前HEAD的SEND_UNCERTAIN/回滚，并证明一次send/Enter、唯一wait、零cancel/重发/第二replacement、bound source与uncertain wait。
2. **严格负例。** 稳定语义歧义、foreign user、错误App label/digest保持SEND_UNCERTAIN；错误最终challenge/root/Git proof保持对应APP_PROOF mismatch。semantic handoff失败须零resume/commit/source retirement，并清理exact known replacement。
3. **RED证实后最小修复。** 首选owned部署事务的 fresh Sidecar health → existing ChatControl.recover()/ensureReady → same exact reconciliation → same wait。使用现有readiness预算及原App-proof绝对期限，不增加deadline。cold GREEN必须证明该组合足够；否则发布具体缺口并请求独立新方案，不扩大reconciliation容忍度。
4. **GREEN不变量。** same sendId/waitId/baseline/timeout，一次send/Enter/replacement、零resend/cancel；wait由uncertain恢复并accepted；完整proof通过才commit/退役source。负例仍fail closed。优先只改dsh-runtime.ts、owned recovery测试及必要fixture；不先修改browser/Sidecar proof、journal schema或canonical recovery。
5. **有界诊断。** metadata类别可为replacement_semantic_ready_failed、reconcile_driver_send_uncertain、reconcile_baseline_mismatch、reconcile_success。不得记录prompt/reply/body/control digest/challenge，不补写real121未观测的分支。保留全部原始RED/失败。
6. **候选一次冻结。** focused recovery/native/adversarial、M1/page-classification、typecheck/build → 独立source review → PASS后一次frozen full → fresh package/profile/关联 → commit/push（排除goal.md）→ exact pushed scoped review。纯目标刷新/诊断无需全量回归。
7. **冻结后一次fresh原canonical完整验收。** fresh Chrome、明确target、credential、journal、DSH_HOME、workspace/task；连续独立观察仅root/WTS/health/journal metadata。App PASS后同run直接推进完整闭环，不在PLAN处停止。首次未建模失败冻结证据，按metadata独立分析，不普通重试、第二replacement或提前扩展canonical recovery。

### 必须完成的整体交付节点

1. **真实Windows闭环：** App → INIT → PLAN → DeepSeek真实实现/测试 → fresh stdout-only nonce → commit/push → 独立读取source/Git/raw output的REVIEW → mandatory fix PLAN → actual DSH restart/受控target handoff → same-task reconnect → 第二轮实现/测试/提交/审阅 → same-round exact identity/HEAD DONE → 原独立oracle全部required项true，包括plannerExecutorAccepted=true。
2. **Windows锁屏能力资格：** 解锁闭环优先，随后权威WTS受控lock/unlock实验。先验证锁屏暂停新页面操作、保留uncertainty、解锁后验证并恢复same wait；不得标为已支持。锁屏继续执行所需headless/专用browser host须独立真实验收原identity/visibility/proof及App/PLAN/REVIEW/restart；不伪造可见性、不关闭锁屏保护、不以API替换Web目标。无人值守扩展不替代本轮解锁闭环。
3. **Producer Windows Git gate：** 产品闭环后处理deepseek-harness原deadline gate，保持Git和安全覆盖，不延长期限掩盖问题。
4. **最终global exact-HEAD审阅：** 架构、协议、源码、安全、恢复、打包、真实Windows和producer证据全部核对，执行具体fix PLAN并重新审阅。所有required gates真实通过才宣布完成。

### 防止局部重试循环

用户要求持续回顾并总结实现中出现的各种错误。docs/browser-platform-investigation.md 的 Current implementation lessons 是当前复盘记录：每个新失败写入证据、原因/不确定性、修复、回归保护和停止条件；每次真实验收前核对，禁止无新假设地重复已失败做法。


- 一个因果假设至多一次受控真实曝光；必须有可证伪实验和退出条件。无新证据不再重复置前台/解锁/刷新/重启/增加超时。
- 保持strict parser/proof/oracle、delivery uncertainty、target ownership、原deadline；未知创建结果不猜cleanup，不盲重发。health PASS不证明operation结束或conversation ready。
- 公开讨论/他人代码仅用于当前具体缺口的可验证实验；不当作OpenAI限制的证据，不无限调研。
- 原浏览器/journal未明确ownership及uncertainty前不清理；历史失败不改写成功。goal.md用户拥有，不自动stage/commit。
- 仅登录、2FA、CAPTCHA、缺失真实凭据、不可逆外部操作或确需用户选择时请求介入；普通实现问题持续执行。必须介入时立即通知并给出一个明确操作。

# 0. 当前仓库

主项目：

```text
C:\Users\jingc\workspace\DSHWithChatGPT
branch: feat/complete-c2c-runtime
remote reference HEAD at task creation:
16df18bcaf2b90020b88b2a02471660453870525
```

producer：

```text
C:\Users\jingc\workspace\deepseek-harness
branch: feat/complete-c2c-runtime
remote reference HEAD at task creation:
0afd708c288b079096affbfeff4626dcf9a19bf1
```

开始时必须重新：

```text
git status
git log -n 20
git fetch
```

确认本地真实 HEAD。

不要 hard reset。
不要覆盖未提交修改。
如果远端又有更新，以当前实际源码重新判断，不机械依赖上述 SHA。

---

# 1. 权威目标

完整阅读：

```text
docs/goal.md
docs/current-delivery-plan.md
docs/target-architecture.md
docs/planner-executor-protocol.md
docs/acceptance-plan.md
docs/direct-cdp-contract.md
docs/windows-deployment.md
docs/env-win.md
docs/migration-plan.md
```

以及与当前 critical path 直接相关的源码和测试。

`docs/goal.md` 是完整目标规范。

`docs/current-delivery-plan.md` 是当前 delivery 状态，但它只是已记录证据；源码和本轮实际运行结果优先。

不要重新开始已经完成并经过 scoped review 的 Stage A-H 工作。

只有新的反例、当前源码与 contract 不一致或真实产品运行暴露问题时，才重新打开已接受的 foundation。

---

# 2. 当前架构事实

PlannerBridge 的主要架构已经存在。

不要再实施“只抽接口”的伪进展。

当前源码已经包含至少：

```text
core/ports/*
DshAgentAdapter
DshExecutionWorkspaceAdapter
McpExposureProvider adapter
canonical Planner–Executor protocol v2
ChatGptWebDriver
BrowserPrimitives
DirectCdpPrimitives
SidecarChatControlClient
Sidecar server/journal/protocol
Direct Sidecar deployment
DSH production deployment
Planner–Executor E2E runner
independent acceptance oracle
```

`package/src/index.ts` 已基本退化为 deployment export。

主 Windows 产品路径已经应为：

```text
Windows DSH
   ↓
PlannerBridge canonical runtime
   ↓
SidecarChatControlClient
   ↓
loopback authenticated RPC
   ↓
Chat Control Sidecar
   ↓
ChatGptWebDriver
   ↓
DirectCdpPrimitives
   ↓
dedicated Chrome / ChatGPT Web
```

Workspace Data Plane：

```text
ChatGPT Web
   ↓
DSH with ChatGPT App
   ↓
Secure MCP exposure
   ↓
Windows MCP Bridge
   ↓
WorkspaceRuntimeRegistry
   ↓
live ReadLease / GitLease / execution-output authority
```

Browser Harness 只是 compatibility path。

最终 Windows primary acceptance 必须在 Browser Harness 不存在的情况下成功。

---

# 3. 不要重新设计这些安全不变量

以下已经是架构基础，除非反例证明有问题，不要重新发明：

```text
ExecutionWorkspaceId != authority
```

workspace ID 只是 durable identity。

实际读取必须来自 live capability：

```text
ExecutionReadLease
ExecutionGitLease
execution-output scope
```

保持：

```text
no Host filesystem fallback
provider generation / affinity binding
root containment
fixed Git argv
sanitized Git environment
bounded timeout/output
Windows hardened Git assurance
secret redaction
task/workspace/round scoped execution evidence
```

`deepseek-harness` 当前 producer contract 已经具备：

```text
ExecutionWorldIdentity
bindExecutionReadLease
bindExecutionGitLease
Windows native root reader
Windows Job containment
allow-hardened-windows Git policy
```

不要因为 consumer 方便而复制 producer 实现。

---

# 4. 当前真正的 delivery 状态

过去的 architecture foundation 不再是首要瓶颈。

当前真实状态按最新证据是：

```text
ARCHITECTURE       PARTIAL only because final global audit remains
PROTOCOL           substantial implementation exists
CHAT_CONTROL       real App proof exists; real send path previously failed
DIRECT_CDP         implemented and heavily tested
SIDECAR            implemented with auth/journal/recovery contracts
DSH_ADAPTER        installed composition evidence exists
WORKSPACE_DATA_PLANE real App workspace proof exists
PACKAGING          repeated isolated package/profile evidence exists
WINDOWS_E2E        FAILED / not yet closed
FUTURE_LINUX       FUTURE
```

之前真实 Windows run 已经达到：

```text
localReady=true
appDataPlaneVerified=true
```

随后 INIT 发送失败。

此后已经实现多轮针对真实失败的修复，包括：

```text
logical paragraph composer extraction
preservation of spaces/tabs/blank lines
hidden/inert/aria-hidden/CSS-hidden payload rejection
durable bootstrap baseline fencing
unknown send fail-closed
message observation semantic line-break handling
zero-area visible BR preservation
```

最新 HEAD `16df18bc` 又修复了 current ChatGPT DOM 中 zero-area `<br>` 的语义换行。

这些修复之后的真实完整产品 run 尚未形成最终 PASS。

因此当前目标不是继续 speculative hardening。

当前目标是：

**用最新 candidate 完成真实 Windows Planner–Executor 闭环，并只修真实运行中继续暴露的有限问题。**

---

# 5. 历史失败任务的处理原则

现有历史失败 INIT/task/journal 有 SEND_UNCERTAIN evidence。

必须保留它作为 recovery/fail-closed evidence。

禁止：

```text
自动假定旧 INIT 未发送
自动重发旧 INIT
自动把 SEND_UNCERTAIN 晋升为 sent
删除历史 journal 以让测试通过
清除 foreign / uncertain ownership
用人工观察猜测 durable delivery
```

如果旧状态不适合继续最终验收：

**不要修饰旧事实。**

创建新的、隔离的：

```text
DSH_HOME
PlannerBridge state
Sidecar state/journal
acceptance workspace
task
Git remote
```

运行一个 fresh acceptance。

旧任务继续保持 SEND_UNCERTAIN 即可。

新的 successful E2E 不需要“洗白”旧的不确定操作。

---

# 6. 第一阶段：冻结当前 exact HEAD 并重新建立 baseline

先不要修改源码。

读取最近至少 20 个 commits 和：

```text
package/src/browser/message-observation.ts
package/src/browser/chatgpt-web-driver.ts
package/src/browser/direct-cdp.ts
package/src/browser/transitions.ts
package/src/browser/history-observation.ts

package/src/sidecar/*
package/src/deployment/direct-sidecar.ts
package/src/deployment/sidecar-control.ts
package/src/deployment/sidecar-supervisor.ts
package/src/deployment/dsh-runtime.ts

package/src/orchestrator/*
package/src/protocol/*
package/src/core/*
package/src/adapters/*

package/scripts/verify-planner-executor-e2e.mjs
package/scripts/planner-executor-acceptance.mjs
package/scripts/verify-real-sidecar-entry.mjs
package/scripts/verify-plannerbridge-fake-stack.mjs
```

然后运行当前 exact HEAD 的：

```text
typecheck
build
ordinary full pnpm test
package verification
profile verification
real-sidecar-entry verification where environment permits
```

不要引用旧的 “1051 passed” 当作当前 HEAD 的结果。

最新 HEAD 增加了测试，因此必须获得新的实际数字。

记录：

```text
HEAD
test files
passed
failed
skipped
duration
exit code
```

保留失败原始输出。

不要为了让 full suite 通过而：

```text
增加 timeout
删除断言
skip
降低 security check
删除 race/adversarial fixture
```

Windows worker bound 可以保持当前已接受策略。

---

# 7. 第一次使用 CodexWithChatGPT：只做“当前 critical-path review”

完成 baseline 后，调用 CodexWithChatGPT。

不要要求 ChatGPT 从头重新设计 PlannerBridge。

要求它独立读取：

```text
docs/goal.md
docs/current-delivery-plan.md
docs/acceptance-plan.md

最新 HEAD
最近真实 product evidence
最近 browser/message/recovery commits
当前 E2E runner + acceptance oracle
```

让 ChatGPT回答：

```text
1. 最新 HEAD 距离完整 Windows acceptance 还缺哪些“必须闭合”的证据？
2. 当前代码里有没有会阻止下一次真实 acceptance 的已知 source-level bug？
3. 是否应先修源码，还是已经应该直接运行 fresh real E2E？
4. 哪些 foundation 已经有足够 evidence，不应再次打开？
```

要求它输出一个非常有限的：

```text
NEXT_DELIVERY_PLAN
```

不要让它重新提出大规模架构重构，除非它能指出当前源码中的具体反例。

---

# 8. 在真实 acceptance 前，只允许关闭有证据的 blocker

如果 baseline / ChatGPT review 显示最新：

```text
message observation
composer ownership
bootstrap recovery
Sidecar auth
schema
packaging
```

仍有确定问题，则：

1. 先写/找到 reproducer；
2. 证明 RED；
3. 做最小修复；
4. focused tests；
5. full regression；
6. package/profile check；
7. commit；
8. CodexWithChatGPT independent source review；
9. DONE 后继续。

不要开始下一轮 speculative hardening。

一个修复必须能够回答：

```text
具体哪个真实/反例 failure？
最小错误机制是什么？
哪个 test 在修复前 RED？
修复后什么 evidence 变 GREEN？
为什么没有降低原 security/recovery guarantee？
```

回答不了就不要改。

---

# 9. 生成 fresh product candidate

真实运行前：

```text
pnpm build
pnpm test
package artifact
isolated package import
Sidecar executable verification
installed DSH profile verification
DSH tool schema consumer verification
```

fresh candidate 必须来自当前 exact HEAD。

不能运行旧 tgz / 旧 lib / 旧 Sidecar。

记录 artifact 与源码 HEAD 的对应关系。

---

# 10. Fresh Windows real E2E

然后运行真正的：

```text
verify-planner-executor-e2e.mjs
```

不得使用 legacy：

```text
verify-live-c2c.mjs
```

除了验证 legacy delegation 本身。

必须满足：

```text
BROWSER_HARNESS_COMPAT_EXECUTABLE undefined
```

主 acceptance 中不得 mount Browser Harness provider。

Executor 必须是当前选定：

```text
provider: deepseek-official
model: deepseek-flash
DeepSeek-V4.1-Flash
```

Planner / Reviewer 是真实 ChatGPT Web。

使用：

```text
dedicated Browser B
real Direct CDP
real native Sidecar
real installed DSH
real DeepSeek call
real Secure MCP exposure
real Custom App
real disposable Git workspace
real local bare upstream
```

不能用 fake Sidecar / fake browser / mock model 关闭 WINDOWS_E2E。

---

# 11. Real E2E 必须实际走完

必须观察：

```text
doctor(local)
  localReady=true

doctor(app-proof)
  appDataPlaneVerified=true

chatgpt_plan
  real PLAN accepted

DeepSeek Executor
  follows PLAN
  edits source
  runs real tests

successful test stdout:
  E2E_EVIDENCE=<fresh random nonce>

commit

push

chatgpt_review
  exact current HEAD
```

Reviewer 必须独立通过 Workspace Data Plane 阅读：

```text
workspace source
Git status/diff/log
raw execution_output
```

并在 REVIEW SUMMARY 中回显最新 successful stdout nonce。

Nonce 绝不能通过：

```text
executor prose
review arguments
protocol envelope
workspace file
summary passed from Executor
```

泄露给 Reviewer。

Acceptance oracle 必须继续机器验证该关系。

---

# 12. Recovery 是真实 acceptance 的一部分

最终 E2E 不是：

```text
PLAN → perfect implementation → DONE
```

就结束。

Goal 要求真实 recovery / fix path。

必须实际证明：

```text
initial PLAN
 ↓
execution
 ↓
review returns real fix PLAN
 ↓
durable restart checkpoint
 ↓
DSH process exits/restarts
 ↓
chatgpt_reconnect
 ↓
same task/workspace/iteration
 ↓
continue fix
 ↓
new test
 ↓
new commit + push
 ↓
review
 ↓
DONE
```

不得用 synthetic fixture 替代这一 product proof。

如果当前 acceptance fixture 无法可靠要求真实 fix/restart path：

不要通过硬编码 observer event 或 fake PLAN 来伪造。

分析如何设计一个**可证伪且真实由 Reviewer 发现问题**的 acceptance fixture。

任何改变必须先让 CodexWithChatGPT 审阅其 oracle integrity。

---

# 13. Acceptance oracle 不得降级

当前：

```text
planner-executor-acceptance.mjs
```

已经机器验证：

```text
readinessVerified
identityVerified
nonceVerified
recoveryVerified
plannerExecutorAccepted
```

并要求：

```text
TASK_ID
WORKSPACE_ID
ITERATION
HEAD
```

一致。

保持这些条件。

最终：

```text
plannerExecutorAccepted=true
```

只能由实际 events + real Git state 算出。

绝不允许：

```text
hardcoded true
environment override
manual pass flag
fake records
跳过 recovery
borrowed old nonce
borrowed old doctor result
borrowed old DONE
```

---

# 14. Exact identity

最终 DONE 必须证明：

```text
same TASK_ID
same WORKSPACE_ID
same canonical protocol v2
correct same-round ITERATION
exact pushed HEAD
```

Git 必须：

```text
normal branch
not main/master
clean worktree
upstream exists
local HEAD == upstream HEAD
ahead == 0
reviewed HEAD == local HEAD
```

只 commit 没 push 不算。

---

# 15. Message/input/recovery 失败的调试原则

如果新的 real run 又在 ChatGPT Web 层失败：

优先捕获**只读、无秘密、最小的实际事实**：

```text
DOM shape
semantic message observations
composer structure
target identity
route
observation epoch
transition history
assistant count
text digest
App identity
Sidecar journal metadata
coordinator durable state
```

不要读取/打印：

```text
ChatGPT cookies
OAuth
bearer
API key
full sensitive browser state
```

如果输入失败：

必须保留 foreign/unknown draft。

如果发送 ACK 不确定：

必须 fail closed。

如果当前 route / document / baseline 不匹配：

不得自动 resend。

如果 browser transition history unavailable：

不得基于 URL 猜 provenance。

所有新修复必须继续遵守 current Direct CDP contract。

---

# 16. 最新 message semantics 必须特别验证

最新 HEAD 修改了 visible zero-area `<br>` 的 message semantic extraction。

在下一次 real acceptance 前，至少执行：

```text
message-observation focused tests
ChatGptWebDriver composer/input tests
Direct CDP semantic/input tests
bootstrap/recovery focused tests
```

并考虑针对当前真实 ChatGPT DOM 做一个只读 smoke：

```text
user message multiline extraction
assistant message extraction
App mention identity
line-break preservation
spaces/tabs preservation
hidden content exclusion
```

不能通过改变真实 conversation 内容来做只读 smoke。

---

# 17. Producer deepseek-harness 的处理

Producer HEAD：

```text
0afd708c288b079096affbfeff4626dcf9a19bf1
```

当前 producer 已经有：

```text
ExecutionWorldIdentity
ReadLease
GitLease
Windows hardened Git
native root-relative reads
Windows Job process ownership
Git redirect environment tombstones
```

DSHWithChatGPT 应继续作为 consumer。

不要为了 PlannerBridge 再增加 producer API，除非满足全部：

```text
1. 当前 real/consumer test 明确无法表达必要 guarantee；
2. 有 RED consumer test；
3. 能指出缺失的 public contract；
4. CodexWithChatGPT architecture review 同意 producer change；
5. 修改最小；
6. producer 自己增加对应 tests。
```

---

# 18. Producer Windows Git deadline gate

当前仍记录一个独立 producer native Git support timeout failure。

不要在真实 E2E 前把主要时间花在它上面，除非它直接阻止 acceptance。

真实 Windows PlannerBridge E2E 闭环后再处理它。

重新在 producer exact HEAD：

```text
0afd708c
```

复现原始测试。

不得：

```text
增加 timeout
删除测试
skip Windows
降低 Job/ACL enforcement
减少 Git queries 只为通过
```

如果失败：

区分：

```text
actual correctness/security bug
resource/scheduling bug
test orchestration bug
```

若需要修改 producer，先让 CodexWithChatGPT 独立 review 原始 failure 和 proposed fix。

最终不能把一个真实 FAILED gate写成 VERIFIED。

---

# 19. 历史命名

新的代码继续禁止新建：

```text
C2C
c2c
```

历史：

```text
branch names
legacy compatibility entries
old public aliases
released state domains
```

可以保留。

不要为了“清理名称”破坏：

```text
released storage compatibility
legacy CLI compatibility
historical migration tests
```

当前 delivery priority 是真实产品闭环，不是 cosmetic rename。

---

# 20. 不要重新打开已经 scoped DONE 的 foundation

除非出现新的矛盾证据，不要重新进行：

```text
Core ports extraction
ChatControl abstraction设计
BrowserPrimitives abstraction设计
Sidecar protocol从零设计
ExecutionWorkspacePort从零设计
McpExposureProvider从零设计
StateStore从零设计
Protocol v2从零设计
Workspace capability architecture从零设计
```

当前阶段最容易失败的方式就是：

```text
真实 E2E 尚未完成
→ 又开始增加新 abstraction
→ scoped unit tests更多
→ 但产品仍然不工作
```

避免这个循环。

---

# 21. 每次使用 CodexWithChatGPT 的节奏

从现在开始，不必每个小 commit 都让 ChatGPT 重新审阅整个架构。

使用四种 review：

## A. Delivery-plan review

本任务开始时一次。

目标：

```text
确认当前下一步真的是 real delivery critical path
```

## B. Bounded bug review

只有 real run / adversarial test 暴露新问题时。

给 ChatGPT：

```text
exact HEAD
原始 failure evidence
RED test
修改范围
focused/full test evidence
```

要求只审该 bounded scope。

## C. Producer change review

仅当确实准备修改 deepseek-harness。

要求证明 missing contract。

## D. Final global review

真实 E2E 完成后。

让 ChatGPT 从头独立阅读：

```text
goal.md
final source
final tests
current-delivery-plan
acceptance-plan
real E2E result
producer result
Git exact HEAD
```

要求逐项审：

```text
ARCHITECTURE
SOURCE
PROTOCOL
CHAT_CONTROL
DIRECT_CDP
SIDECAR
DSH_ADAPTER
WORKSPACE_DATA_PLANE
SECURITY
RECOVERY
PACKAGING
TESTS
WINDOWS_E2E
FUTURE_LINUX
```

---

# 22. Final global review 之前必须更新事实文档

只根据实际 evidence 更新：

```text
docs/current-delivery-plan.md
docs/acceptance-plan.md
```

不要修改 `goal.md` 来降低要求。

不要用“unit tests 很多”代替 real product proof。

---

# 23. 最终成功条件

当前 Windows delivery 只有同时满足以下事实才可以宣告完成：

```text
[VERIFIED] current exact HEAD full regression
[VERIFIED] clean package/import verification
[VERIFIED] installed real DSH profile
[VERIFIED] native Sidecar process
[VERIFIED] Direct CDP primary path
[VERIFIED] Browser Harness absent from primary path
[VERIFIED] DeepSeek-V4.1-Flash real generation
[VERIFIED] local doctor
[VERIFIED] real App workspace proof
[VERIFIED] real ChatGPT PLAN
[VERIFIED] real Executor implementation
[VERIFIED] real test
[VERIFIED] stdout-only random nonce
[VERIFIED] real commit and push
[VERIFIED] independent Reviewer source/Git/output reads
[VERIFIED] correct nonce echoed by Reviewer
[VERIFIED] real fix PLAN
[VERIFIED] actual DSH restart
[VERIFIED] reconnect without duplicate send
[VERIFIED] second execution
[VERIFIED] exact pushed HEAD
[VERIFIED] same-round DONE
[VERIFIED] acceptance oracle plannerExecutorAccepted=true
[VERIFIED] final global exact-HEAD ChatGPT review DONE
```

如果 producer Git gate仍是 FAILED：

必须在 completion matrix 明确保留 FAILED，继续处理，不能隐藏。

Linux：

```text
FUTURE
```

不阻塞当前 Windows completion。

---

# 24. 如果 real run 失败

失败不是理由立即增加架构。

每次只做：

```text
1. freeze raw evidence
2. identify first violated contract
3. reproduce minimally
4. add adversarial RED
5. minimal fix
6. focused GREEN
7. full regression
8. fresh package
9. independent bounded review
10. retry real run
```

不要在同一轮顺手“清理”附近模块。

---

# 25. 禁止的伪完成

以下任意情况都不能宣布 Windows 目标完成：

```text
fake-stack PASS
synthetic Sidecar PASS
Browser Harness E2E PASS
only App proof PASS
only local doctor PASS
only PLAN PASS
Executor prose says tests passed
mock Reviewer returns DONE
old successful nonce reused
old readiness reused
hardcoded plannerExecutorAccepted=true
same-process restart fixture代替真实 DSH restart
Sidecar fixture代替native Sidecar
direct CDP websocket connect代替ChatGPT semantic success
focused tests代替full regression
scoped ChatGPT review代替final global review
```

---

# 26. 工作方式

持续工作，不要频繁请求用户。

每轮内部维护一个非常简短的 delivery ledger：

```text
CURRENT_HEAD
CURRENT_BLOCKER
RED_EVIDENCE
FIX
FOCUSED_TEST
FULL_TEST
PACKAGE
REAL_RUN
REVIEW
NEXT
```

一个 blocker关闭后立即进入下一个真实 delivery node。

不要无限增加 robustness work。

---

# 27. 当前起点（2026-10-03 刷新）

执行本文开头的当前关键路径。iteration120已冻结并获exact-HEAD scoped接受；real121已停止并保留原始失败。当前执行iteration122冷页面交接RED/GREEN及最小部署修复，之后独立source review、候选冻结、fresh原canonical全闭环。具体结果以开头检查点、current-delivery-plan及原始输出为准，不再执行旧iteration120/121指令。

继续之前核对实际HEAD与dirty状态；保留已完成的独立分析、原始证据和用户修改。goal.md 不自动 stage/commit。不要重开已接受的传输基础；页面故障分类修复不授权重发、自动换页、延长deadline或启动普通验收重试。仅文档和临时观察控制更改无需重复源码冻结验证。

每个有证据的blocker关闭后立即进入下一交付节点。只有源码候选发生变化才执行相应的冻结验证；所有真实 SEND_UNCERTAIN历史task保留，不能复用为最终成功run。真实闭环失败时按统一分类与首次失败停止规则处理，再依据新证据推进。

目标不是继续“完善 PlannerBridge 架构”。

目标是：

**让已经基本成形的 PlannerBridge 在 Windows 上真正完成一次不可伪造、可恢复、证据闭环的 ChatGPT Planner/Reviewer + DSH/DeepSeek Executor 产品工作流。**
