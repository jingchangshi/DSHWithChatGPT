你正在 Windows 11 Codex Desktop 的 Goal 模式中工作。

当前开发仓库：

- `C:\Users\jingc\workspace\DSHWithChatGPT`
- branch: `feat/complete-c2c-runtime`

关联 producer 仓库：

- `C:\Users\jingc\workspace\deepseek-harness`
- branch: `feat/complete-c2c-runtime`

开发期高能力规划/评审工具：

- CodexWithChatGPT 已安装并已完成真实 PLAN 和独立 REVIEW。
- 你负责源码分析、编辑、shell、测试、Git。
- ChatGPT Web 高思考模型通过 CodexWithChatGPT 负责架构规划、阶段审阅和最终独立评审。

首先完整阅读：

- `docs/env-win.md`
- 当前所有 architecture / protocol / security / browser / DSH integration 文档
- `package/src/**`
- `package/tests/**`
- `package/scripts/**`
- `package/package.json`
- deepseek-harness 中 execution-world / sandbox / DSH plugin/runtime 的相关公共接口
- CodexWithChatGPT 仅用于理解开发期协作能力，不得成为产品运行时依赖

不要根据旧文档假设目标架构。源码和 `env-win.md` 是当前 baseline。

---

# 一、最终目标

本项目新的架构名称使用：

**PlannerBridge**

当前 GitHub 仓库可以暂时继续叫 `DSHWithChatGPT`，本轮不要为了名称迁移阻塞功能开发。

理解为：

```text
PlannerBridge
= generic Planner / Reviewer ↔ Executor collaboration runtime

当前第一个 deployment：

Planner / Reviewer = ChatGPT Web
Executor           = DSH + DeepSeek-V4.1-Flash
```

不要再把历史 `C2C` 当成新架构概念。

新的源码、文档、模块、测试、协议、状态字段、环境变量和脚本名称不得继续创造新的：

```text
C2C
c2c
```

历史 identifier 可以在 compatibility layer 中暂时存在，但：

1. 必须明确标为 legacy；
2. 新实现不得继续依赖历史命名；
3. touched private identifiers 应逐步迁移；
4. 不允许盲目全局字符串替换；
5. externally-owned 名称不得擅自修改。

---

# 二、当前阶段唯一 P0 deployment

现在只实现和完整验收：

```text
Windows 11

ChatGPT Web
high-capability Planner / Reviewer
        ↕
PlannerBridge
        ↕
Windows DSH
        ↕
DeepSeek-V4.1-Flash Executor
        ↕
workspace / shell / tests / git
```

当前没有 Linux server。

Linux cross-host deployment 是 FUTURE，绝不能阻塞 Windows 工作。

未来拓扑必须可以自然扩展成：

```text
Windows
Chrome + Chat Control Sidecar
               ↑
               │ secure localhost forwarding
               ↓
Linux
SidecarChatControlClient
PlannerBridge
DSH
Execution World
Workspace Data Plane
repo / build / tests / git
```

但是当前阶段：

- 不实现 Linux deployment automation；
- 不实现 SSH lifecycle manager；
- 不要求 Linux Browser Harness；
- 不远程暴露 Chrome CDP；
- 不因为 Linux 不存在而停止开发。

未来远程部署必须复用与 Windows 本地部署完全相同的 `SidecarChatControlClient` 和协议。

---

# 三、开发链与产品链必须完全分离

开发链：

```text
Codex Desktop
   ↓
CodexWithChatGPT
   ↓
ChatGPT Web high-thinking
   ↓
指导你开发 PlannerBridge
```

产品链：

```text
DSH
 ↓
PlannerBridge
 ↓
ChatGPT Web Planner / Reviewer
```

硬约束：

**CodexWithChatGPT 永远不得成为 PlannerBridge 产品运行时依赖。**

不要通过调用 CodexWithChatGPT 来伪造产品 E2E。

---

# 四、目标架构

最终依赖方向应接近：

```text
                 ChatGPT Web
                 /        \
          Chat Control   Workspace Data Plane
               |                |
               |          ChatGPT Custom App
               |                |
               |        Secure MCP Exposure
               |                |
        Chat Control Sidecar     |
               |                |
               +-------+--------+
                       |
               PlannerBridge Runtime
                       |
                Planner–Executor
                  Orchestrator
                       |
        +--------------+--------------+
        |              |              |
     Protocol       StateStore     AgentAdapter
                                      |
                                  DSH Adapter
                                      |
                              Execution World
                                      |
                   +------------------+------------------+
                   |                                     |
             Read capability                        Git capability
                   |                                     |
                   +------------------+------------------+
                                      |
                           workspace / test / git
```

核心原则：

> Chat Control 只负责对话。
>
> Workspace Data Plane 只负责模型读取事实。
>
> Execution World 只负责执行发生在哪里。
>
> Lease 只负责当前操作被授权访问什么。
>
> Orchestrator 只负责状态机和工作流。
>
> Agent Adapter 只负责谁来执行。
>
> Deployment transport 不得污染核心协议。

---

# 五、必须形成的抽象边界

目标代码必须形成清晰的 ports / adapters 边界。

## 1. Planner–Executor Protocol

只认识：

```text
TASK_ID
ITERATION
WORKSPACE_ID
HEAD

PLAN
EXECUTED
REVIEW
DONE
BLOCKED
```

协议层不得 import：

```text
DSH
Cordis
Browser Harness
Chrome
CDP
Windows
Linux
SSH
Secure MCP Tunnel implementation
```

---

## 2. ChatControl

定义 provider-neutral contract，例如：

```text
health
ensureReady
openConversation
sendControlMessage
waitForReply
recover
currentConversation
```

主实现：

```text
SidecarChatControlClient
```

兼容实现：

```text
BrowserHarnessChatControl
```

禁止设计：

```text
WindowsChatControl
LinuxChatControl
LocalChatControl
RemoteChatControl
```

local / remote 是 deployment concern。

---

## 3. ChatGptWebDriver

现有 Browser Harness 实现中这些高价值语义必须保留：

```text
exact App mention
composer discovery
exact autocomplete selection
mention decorator verification
assistant baseline fencing
new assistant reply detection
streaming detection
reply settling
logged-out detection
App unavailable fail-closed
conversation reconnect
timeout
cancellation
```

将它们从 Browser Harness transport 中抽离为：

```text
ChatGptWebDriver
```

其下只依赖：

```text
BrowserPrimitives
```

实现：

```text
BrowserHarnessPrimitives   # compatibility
DirectCdpPrimitives        # primary
```

不要把现有 ChatGPT DOM/settling 逻辑复制两份。

---

## 4. Chat Control Sidecar

Windows 独立小进程：

```text
chat-control-sidecar
```

目标：

```text
127.0.0.1:18765
        ↓
ChatGptWebDriver
        ↓
DirectCdpPrimitives
        ↓
127.0.0.1:9222
        ↓
dedicated product Chrome
```

Sidecar RPC 必须：

- loopback-only；
- versioned；
- authenticated；
- bounded body；
- request id；
- timeout；
- cancellation；
- duplicate/replay protection；
- typed errors；
- clean shutdown；
- deterministic health semantics。

Sidecar 不得暴露：

```text
arbitrary CDP
arbitrary browser_js
arbitrary navigation
shell
filesystem
Git
workspace
MCP
generic computer-use
```

这是 narrow semantic sidecar，不是 browser remote-control daemon。

---

## 5. Workspace Data Plane

保留并加强当前成熟能力：

```text
MCP Bridge
 → WorkspaceRuntimeRegistry
 → active capabilities
 → ExecutionReadLease
 → ExecutionGitLease
 → execution evidence
```

硬约束：

```text
ExecutionWorkspaceId != authority
```

Workspace ID 只是 durable identity。

绝不允许：

```text
workspaceId → Host path
workspaceId → filesystem permission
workspaceId → shell capability
```

禁止 Host filesystem fallback。

ReadLease / GitLease 必须绑定正确的 execution-world provider generation / affinity。

---

## 6. Agent Adapter

把当前 `index.ts` 中 DSH/Cordis-specific wiring 收敛成：

```text
DshAgentAdapter
```

至少隔离：

```text
tool registration
system prompt contribution
Session cwd
shell execution observation
execution evidence attribution
Cordis storage integration
```

PlannerBridge core 不应直接理解 Cordis plugin 生命周期。

---

## 7. MCP Exposure

把当前 Secure MCP Tunnel implementation 放到：

```text
McpExposureProvider
```

当前实现：

```text
OpenAiSecureMcpTunnelProvider
```

Tunnel 是网络 transport，不是：

```text
Planner–Executor protocol
browser reply transport
execution backend
authorization model
```

---

## 8. StateStore

Orchestrator 依赖 generic async state store。

当前 Cordis persistence 是 adapter，而不是 core contract。

---

# 六、第一步必须先写架构文档，不要直接大规模修改源码

在任何结构性产品重构前，创建或重写下面文档：

```text
docs/target-architecture.md
docs/windows-deployment.md
docs/planner-executor-protocol.md
docs/acceptance-plan.md
docs/migration-plan.md
```

已有旧文档可以链接或改写，但最终不得存在两个互相矛盾的“当前架构”。

## `target-architecture.md`

必须包含：

- PlannerBridge 定位；
- 当前 Windows deployment；
- 未来 Windows-browser + Linux-executor deployment；
- control plane；
- Workspace Data Plane；
- ports/adapters；
- dependency rules；
- security boundaries；
- lifecycle；
- ownership；
- failure domains；
- recovery；
- 明确哪些组件与 OS 无关；
- 明确哪些只是 deployment detail。

必须画出：

1. Windows primary topology；
2. Future cross-host topology；
3. control plane；
4. Workspace Data Plane；
5. package/module dependency DAG。

---

## `planner-executor-protocol.md`

必须冻结：

- envelope；
- state machine；
- TASK_ID；
- ITERATION；
- WORKSPACE_ID；
- HEAD；
- PLAN / EXECUTED / REVIEW / DONE；
- retry；
- replay；
- duplicate；
- timeout；
- cancellation；
- reconnect；
- idempotency；
- exact-HEAD verification。

不得保留新的历史 `C2C` 协议命名。

---

## `windows-deployment.md`

必须准确对应 `docs/env-win.md`：

```text
Product Chrome
  127.0.0.1:9222

Chat Control Sidecar
  127.0.0.1:18765

Windows DSH
  DeepSeek-V4.1-Flash

MCP Bridge
Secure MCP exposure
```

同时区分：

```text
Browser A = CodexWithChatGPT development
Browser B = PlannerBridge product runtime
```

---

## `acceptance-plan.md`

在实现之前先定义每一个 acceptance gate。

每一项必须有：

```text
Goal
Fixture
Action
Expected evidence
Failure condition
Status
```

状态只能是：

```text
VERIFIED
FAILED
NOT_RUN
PARTIAL
BLOCKED
FUTURE
NOT_APPLICABLE
```

禁止把 NOT_RUN 当成成功。

---

## `migration-plan.md`

对现有所有 `C2C/c2c` identifier 做 inventory，分类为：

```text
PUBLIC_COMPATIBILITY
PRIVATE_RENAME_NOW
TEST_RENAME_NOW
DOC_RENAME_NOW
BRANCH_HISTORY_ONLY
EXTERNAL_NAME_DO_NOT_CONTROL
```

不要盲目全局替换。

---

# 七、架构文档完成后，必须先让 ChatGPT 独立审阅

在开始结构性源码重构前：

1. commit 架构文档；
2. 使用 CodexWithChatGPT 请求 ChatGPT 高思考模型；
3. 让它直接读取仓库中的：
   - 文档；
   - 当前实现；
   - `env-win.md`；
   - Execution World contract；
4. 要求它检查：
   - dependency direction；
   - 是否真正支持未来跨 host；
   - security boundaries；
   - acceptance 是否足以证伪错误实现；
   - 是否错误继承了 Browser Harness / historical C2C coupling；
5. 不要把源码大段复制进 prompt；
6. 让 ChatGPT 独立读取 source；
7. 如果 REVIEW 返回修改项，先改文档并再次 REVIEW；
8. 直到架构文档 REVIEW = DONE。

在架构冻结前，不进入大规模实现。

---

# 八、先建立测试，再开发每个功能

遵守：

**test / falsification first**

每个阶段先建立能证明目标、也能击穿错误实现的测试，然后再实现。

不能：

```text
先实现
→ 再写一个只证明自己实现的测试
```

---

# 九、功能点和验收矩阵

## F0. Baseline 与已知失败

当前 baseline 已记录：

```text
403 passed
3 skipped
1 failed
```

已知失败：

```text
browser cancellation cleanup
```

首先：

- 独立复现；
- 记录原始 baseline；
- 判断其是否落在本次 Chat Control 重构路径。

由于本次必然修改 browser/cancellation lifecycle，如果该失败涉及同一 ownership / cleanup contract：

**在抽象重构之前先建立明确 regression test 并修复。**

不得通过删除断言、延时扩大、skip 或降低 cleanup guarantee 来消灭失败。

---

## F1. Core ports extraction

先测试：

```text
orchestrator imports no Browser Harness
protocol imports no DSH/Cordis/browser/CDP
ChatControl contract can run fake provider
StateStore can run in-memory fake
ExecutionWorkspacePort can be faked
McpExposureProvider can be faked
```

然后抽接口。

要求：

- 行为不变；
- 现有 tests 尽量保持；
- 不做 big-bang rewrite。

---

## F2. ChatGPT semantics extraction

先建立 contract/fixture tests：

```text
exact App selection
ambiguous App fails
missing App fails closed
composer changed unexpectedly fails
old assistant message ignored
new assistant detected
streaming waits
settling requires stability
logout recognized
timeout works
abort works
conversation recovery works
```

再把语义从：

```text
BrowserHarnessAdapter
```

迁入：

```text
ChatGptWebDriver
```

Browser Harness 只保留 primitives。

---

## F3. Direct CDP primitives

先用非 ChatGPT 本地 test page 验证：

```text
connect
list/find target
evaluate semantic DOM query
focus
type
click
keyboard
observe DOM mutation
navigation detection
target disappearance
abort
timeout
disconnect
reconnect
```

不得依赖 screenshot/vision 作为正常控制路径。

正常路径应该：

```text
DOM
Runtime
Input
MutationObserver / event-driven observation
```

截图仅用于 diagnostic。

然后使用 Browser B 的：

```text
127.0.0.1:9222
```

做真实 CDP smoke test。

不要污染 Browser A。

---

## F4. Chat Control Sidecar RPC

先使用 FakeChatGptWebDriver。

建立 tests：

```text
health
version mismatch
auth success/failure
request id
body limit
timeout
cancel
duplicate request
restart
clean shutdown
concurrent incompatible request rejection
typed error mapping
```

安全测试必须证明不存在：

```text
arbitrary CDP RPC
arbitrary JS RPC
filesystem RPC
shell RPC
Git RPC
```

再实现 Sidecar。

---

## F5. SidecarChatControlClient

contract test 要对同一个 ChatControl suite 验证：

```text
FakeChatControl
SidecarChatControlClient
```

客户端只看到：

```text
http://127.0.0.1:18765
```

不能知道：

```text
Chrome
CDP
Windows
future SSH
```

这样未来 Linux 通过 localhost forwarding 即可复用。

---

## F6. Browser Harness compatibility

Browser Harness 是 compatibility/reference provider，不是 primary path。

当前 `env-win.md` 表明它不是当前 P0 环境依赖。

要求：

- existing BrowserHarness implementation 不阻塞主路径；
- contract-level compatibility tests 保留；
- 若真实 Browser Harness executable 当前不可用，标记其 real E2E 为 NOT_RUN；
- 不因此停止 Sidecar + Direct CDP 工作；
- 禁止为了 compatibility 把 Browser Harness dependency重新塞进 core。

---

## F7. DSH Agent Adapter

先写测试证明 PlannerBridge core 不直接依赖：

```text
Cordis tool registry
DSH Session implementation
DSH prompt implementation
DSH shell event implementation
```

再将这些 wiring 收入 DshAgentAdapter。

DeepSeek Executor 使用当前已经选择并验证 credential reachability 的：

```text
DeepSeek-V4.1-Flash
provider = deepseek-official
reasoning = provider default
```

不要继续复用旧 E2E 中硬编码的其他 provider/model。

---

## F8. Workspace Data Plane preservation

不要重写已经正确的 capability architecture。

建立 regression tests：

```text
workspaceId alone cannot read
missing lease fails
stale generation fails
provider replacement invalidates capability
no Host fallback
ReadLease root containment
GitLease fixed argv only
Git environment sanitized
timeout bounded
output bounded
execution evidence workspace/task scoped
secret redaction
```

如果生产代码已有这些 guarantees，应优先保留和适配，而不是重新设计。

---

## F9. MCP Exposure abstraction

将 TunnelSupervisor 收敛在 provider adapter 后面。

测试：

```text
runtime key not exposed
bridge bearer not exposed
localhost bridge only
workspace rebinding controlled
restart cleanup
cancellation cleanup
provider failure does not corrupt protocol state
```

当前环境若尚无真实 Custom App / Tunnel credential：

- unit/integration implementation继续；
- final live Workspace Data Plane acceptance 标记 BLOCKED；
- 不要停下询问用户，直到所有不依赖真实 credential 的工作全部完成。

---

## F10. Durable state / recovery

测试：

```text
DSH restart
Sidecar restart
Chrome reload
conversation reopen
cancel while waiting PLAN
cancel while waiting REVIEW
no duplicate EXECUTED
no duplicate message after reconnect
exact iteration retained
exact HEAD retained
workspace binding retained
```

Linux 不需要参与这些测试。

---

## F11. Historical naming migration

新代码不得出现新的 `C2C/c2c`。

优先迁移 private/test/docs：

```text
c2c-e2e
verify-live-c2c.mjs
fullC2CAccepted
C2C_E2E_RUN_ID
C2C_E2E_PHASE
C2C_DSH_CLI
内部 class / type / test names
```

目标示例：

```text
planner-executor-e2e
verify-planner-executor-e2e.mjs
plannerExecutorAccepted
PLANNER_EXECUTOR_RUN_ID
PLANNER_EXECUTOR_PHASE
DSH_CLI
```

legacy public environment aliases可以暂时 fallback，但新 canonical name 必须优先。

不得改 externally-owned：

```text
CONTROL_PLANE_TUNNEL_ID
CONTROL_PLANE_API_KEY
```

除非外部产品本身要求。

---

# 十、最终 Windows Planner–Executor E2E

旧的：

```text
verify-live-c2c.mjs
```

最终应该由新的：

```text
verify-planner-executor-e2e.mjs
```

取代。

不能只是 rename；必须重新设计为 Windows primary architecture acceptance。

创建真实 disposable Git fixture：

```text
temporary workspace
temporary normal task branch
temporary local bare remote
```

fixture 初始存在 deterministic bug / requirements。

真实流程：

```text
User goal
 ↓
ChatGPT Web PLAN
 ↓
DSH / DeepSeek-V4.1-Flash implement
 ↓
real tests
 ↓
successful test prints random E2E_EVIDENCE=<nonce>
 ↓
commit
 ↓
push
 ↓
exact HEAD
 ↓
ChatGPT REVIEW
 ↓
DONE or another PLAN
 ↓
repeat
```

Reviewer 必须独立：

```text
read workspace
read Git data
read raw execution_output
```

并在 REVIEW SUMMARY 中回显最新成功：

```text
E2E_EVIDENCE=<nonce>
```

Executor 不得通过：

```text
control message
review arguments
summary
workspace file
protocol envelope
```

把 nonce 告诉 Reviewer。

这条是 Workspace Data Plane 的 falsification proof。

---

# 十一、最终 E2E 必须验证 exact identity

DONE 必须同时绑定：

```text
TASK_ID
ITERATION
WORKSPACE_ID
HEAD
```

并证明：

```text
worktree clean
normal branch
not main/master
upstream configured
ahead == 0
local HEAD == upstream HEAD
reviewed HEAD == local HEAD
```

只 commit 没 push 不得进入最终 review。

---

# 十二、最终 primary acceptance 禁止 Browser Harness

真实 Windows primary E2E 必须是：

```text
Windows DSH
 ↓
PlannerBridge Runtime
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
Chrome :9222
 ↓
ChatGPT Web
```

启动验收时故意不给 Browser Harness executable/provider。

如果主流程仍然工作，才算证明架构解耦成功。

---

# 十三、实现阶段与 commit/review 节奏

不要把所有改动塞进一个巨大 commit。

建议阶段：

### Stage A — Architecture freeze

只做：

```text
target architecture
protocol
deployment
acceptance matrix
migration plan
baseline
```

commit。

然后 CodexWithChatGPT independent REVIEW。

必须 DONE 才进入结构性实现。

---

### Stage B — Core ports

```text
protocol/core interfaces
ChatControl contract
StateStore port
ExecutionWorkspacePort
McpExposureProvider
AgentAdapter boundaries
```

tests → implementation → commit → ChatGPT REVIEW。

---

### Stage C — ChatGPT Web semantics extraction

```text
fix relevant cancellation regression
ChatGptWebDriver
BrowserPrimitives
BrowserHarness compatibility primitives
```

tests → implementation → commit → REVIEW。

---

### Stage D — Sidecar transport

```text
Sidecar RPC contract
Sidecar process
SidecarChatControlClient
fake-driver integration
```

tests → implementation → commit → REVIEW。

---

### Stage E — Direct CDP

```text
DirectCdpPrimitives
local fixture
real Browser B smoke test
ChatGptWebDriver + Direct CDP
```

tests → implementation → commit → REVIEW。

---

### Stage F — DSH composition

```text
DshAgentAdapter
DeepSeek-V4.1-Flash executor config
new profile naming
Windows runtime composition
```

tests → implementation → commit → REVIEW。

---

### Stage G — Workspace Data Plane / MCP exposure / recovery

```text
capability regressions
MCP exposure adapter
restart/reconnect
evidence integrity
```

tests → implementation → commit → REVIEW。

---

### Stage H — Naming migration + packaging

```text
remove new historical terminology
compatibility aliases
scripts
docs
package exports
profile/package verification
```

tests → implementation → commit → REVIEW。

---

### Stage I — Real Windows E2E

运行真实 Planner–Executor E2E。

只有真正通过才允许：

```text
plannerExecutorAccepted = true
```

绝不允许：

```text
hardcoded true
mock result
same-process fake result
skipped critical assertion
```

最终 exact HEAD 再交给 ChatGPT 独立 REVIEW。

---

# 十四、每次调用 CodexWithChatGPT 的要求

不要只是问：

```text
review this
```

每次都要求 ChatGPT：

1. 独立读取当前仓库；
2. 查看 exact HEAD；
3. 查看本阶段 architecture contract；
4. 查看本阶段 tests；
5. 检查是否存在为了让测试通过而降低保证；
6. 检查 dependency direction；
7. 检查安全边界；
8. 检查未来 cross-host portability；
9. 给出：
   - DONE
   - 或具体 fix PLAN。

如果返回 fix PLAN：

```text
直接执行
→ tests
→ commit
→ 再 review
```

不要因为普通实现问题询问用户。

---

# 十五、避免 Goal 模式“自己开发自己证明”

以下均不算可靠验收：

```text
实现 sidecar 后只调用 sidecar 自己写的 mock
实现 protocol 后只跑 happy path
实现 Direct CDP 后只检查 websocket 能连
实现 E2E 后把 acceptance=true 写死
Executor 在 summary 中告诉 Reviewer 测试通过
Executor 直接把 evidence nonce 传给 Reviewer
same-process fake 被描述成 real E2E
Browser Harness 路径被描述成 Direct CDP path
```

必须建立独立 falsification evidence。

---

# 十六、禁止的伪完成

以下任意一项出现都不能宣布完成：

- 只是把 `BrowserControl` rename 成 `ChatControl`；
- Sidecar 内部仍调用 Browser Harness；
- Linux/远程机器需要直接访问 Windows :9222；
- Sidecar暴露 unrestricted CDP；
- Sidecar拥有 repo/filesystem/shell；
- workspaceId 被当作权限；
- GitLease 被 generic shell 替代；
- Host filesystem fallback；
- Reviewer相信 Executor prose；
- primary E2E 仍需要 Browser Harness；
- historical `C2C` 继续出现在新模块/测试/API；
- `full acceptance` 由 hardcoded boolean 决定；
- skipped tests 被算作 VERIFIED；
- future Linux 模式没有真实运行却标成 pass。

---

# 十七、当前环境事实

以 `docs/env-win.md` 为准，不重复向用户询问已经记录的信息。

特别注意：

```text
Windows build environment: ready
CodexWithChatGPT PLAN/REVIEW: VERIFIED
Plugin build/typecheck: VERIFIED
Current unit baseline: 403 pass / 3 skip / 1 fail
Dedicated product Chrome CDP :9222: VERIFIED
DeepSeek authentication: VERIFIED
DeepSeek-V4.1-Flash: selected Executor
Execution World source/contracts: present
Chat Control Sidecar: not implemented
Direct CDP implementation: not implemented
Real Windows Planner–Executor E2E: not run
Linux: FUTURE
```

Browser Harness 不属于 P0 prerequisite。

---

# 十八、缺失外部前置条件时的行为

如果最终 real App/Tunnel/login 等前置条件缺失：

不要提前停下来。

先完成所有：

```text
architecture
unit tests
contract tests
integration tests
Sidecar
Direct CDP
DSH adapter
DeepSeek integration
Workspace Data Plane
recovery
packaging
fake-stack E2E
```

只有真正走到必须使用该 external prerequisite 的 acceptance gate 时：

```text
标记 BLOCKED
记录精确原因
继续所有其他独立工作
```

只有以下情况可以要求用户介入：

```text
login
2FA
CAPTCHA
missing real credential
irreversible external operation
必须由用户决定且架构无法自行推导的产品选择
```

普通设计和实现选择不要停下来询问用户。

---

# 十九、deepseek-harness 修改原则

优先把改动留在 DSHWithChatGPT。

只有当现有 Execution World / DSH public API 明确不足时才能修改：

```text
C:\Users\jingc\workspace\deepseek-harness
```

修改前：

1. 明确缺失 public contract；
2. 写 failing consumer test；
3. 请求 ChatGPT architecture review；
4. 做最小 producer API change；
5. 不复制 execution-world source 到 DSHWithChatGPT。

---

# 二十、最终完成标准

最终报告必须分别列：

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

每项只能使用：

```text
VERIFIED
FAILED
NOT_RUN
PARTIAL
BLOCKED
FUTURE
NOT_APPLICABLE
```

最终必须给出：

```text
final HEAD
commits
tests run
tests passed/failed/skipped
real E2E result
remaining blockers
legacy compatibility retained
future work
```

Linux 必须保持：

```text
FUTURE
```

除非真的在 Linux 环境运行过。

---

# 二十一、现在开始执行

执行顺序严格如下：

1. 读取 `docs/env-win.md` 和当前源码；
2. 建立 baseline；
3. 分析现有实现与目标架构差距；
4. 先写五份目标架构/协议/验收/迁移文档；
5. 使用 CodexWithChatGPT 进行第一次 architecture PLAN/REVIEW；
6. 根据 review 修订直到 DONE；
7. 建立完整 feature → falsification test → implementation mapping；
8. 从 Stage B 开始逐阶段实施；
9. 每阶段先测试后实现；
10. 每阶段独立 commit；
11. 每阶段通过 CodexWithChatGPT 做 exact-HEAD review；
12. fix PLAN 自动执行并重新 review；
13. 最终运行 Windows primary Planner–Executor E2E；
14. 最终 exact HEAD 再做一次全局 architecture/security/acceptance review；
15. 输出完整完成矩阵。

不要为了快速交付跳过 architecture freeze、测试先行或独立 review。

目标不是“让现有测试变绿”。

目标是：

**把当前历史实现演进成一套边界清晰、证据驱动、Windows 上真实可运行，并能自然扩展到未来 cross-host deployment 的 PlannerBridge。**