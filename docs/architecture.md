# 架构 / Architecture

> 中文为主，术语保留英文。

## 总览

```
             ChatGPT Web
        Reason / Plan / Review
             ▲           │
             │           │
   BrowserUse│           │Read-only MCP
   Control   │           │Data plane
   (control) │           │(loopback / tunneled)
             │           ▼
    ┌─────────────────────────┐
    │    dsh-with-chatgpt     │  (Cordis plugin, host side)
    │                         │
    │ ChatGptCoordinator      │  ← 状态机 + 持久化
    │ BrowserHarnessAdapter   │  ← BrowserUse 会话工具
    │ BridgeServer (node:http)│  ← 只读 MCP over Streamable HTTP
    │ ExecutionRecorder       │  ← 结构化执行记录
    │ WorkspaceBoundary       │  ← realpath 遏制 + 敏感策略
    └────────────┬────────────┘
                 │ Cordis services (tools / systemPrompt / storageDomain)
                 ▼
      DeepSeek Harness / GLM-5.3-Flash
      edit / shell / tests / git / commit / push
```

## 为什么这样切分

1. **Control plane（浏览器）只传小消息。** 协议 envelope 上限 8KiB，永远不通过 composer 传文件、diff、日志。ChatGPT 需要什么数据，自己通过 MCP 拉取。
2. **Data plane（MCP bridge）结构只读。** 工具注册表在注册时即拒绝任何非只读动词；没有 write/shell/commit 工具存在于进程中。
3. **执行权永远在 DSH。** 协调器只编排（发 envelope、等 envelope、折算状态机）；GLM 拥有全部实现动作。ChatGPT 的输出是 WHAT/WHY，不是脚本。
4. **状态不活在 context 里。** 任务记录落 `d2c_state` storage domain（KV，随 profile 持久），执行记录落 `%LOCALAPPDATA%\dsh-with-chatgpt\executions.jsonl`。DSH 重启后 `chatgpt_reconnect` 按 workspace 绑定恢复。

## 为什么这样切分

1. **Control plane（浏览器）只传小消息。** 协议 envelope 上限 8KiB，永远不通过 composer 传文件、diff、日志。ChatGPT 需要什么数据，自己通过 MCP 拉取。
2. **Data plane（MCP bridge）结构只读。** 工具注册表在注册时即拒绝任何非只读动词；没有 write/shell/commit 工具存在于进程中。
3. **执行权永远在 DSH。** 协调器只编排（发 envelope、等 envelope、折算状态机）；GLM 拥有全部实现动作。ChatGPT 的输出是 WHAT/WHY，不是脚本。
4. **状态不活在 context 里。** 任务记录落 `d2c_state` storage domain（KV，随 profile 持久），执行记录落 `%LOCALAPPDATA%\dsh-with-chatgpt\executions.jsonl`。DSH 重启后 `chatgpt_reconnect` 按 workspace 绑定恢复。
   已实测：headless profile 下 `chatgpt_plan` 建立任务 `d2c_90fb0d` 后，全新 DSH 进程的 `chatgpt_status` 从 `~/.dsh/storages/d2c_state.json` 完整恢复 goal/state/iteration/workspace 绑定。

## 真实 DSH 集成面（E2E 验证过）

| DSH public surface | 本插件用法 | 验证状态 |
| --- | --- | --- |
| `tools.register()` | 四个 model-facing 工具（plan/review/status/reconnect）。**output.schema 必须是 raw JSON Schema**：`register()` 直接跑 `assertSupportedJsonSchema`，不接受 author DSL 的 `required: true` 属性标记，也不接受 `type: 'json'`；对象级 `required` 数组才是合法形式。 | ✅ 全部四个工具在 headless profile 被 GLM 调用成功 |
| `ctx.get('storageDomain').open()` | `d2c_state` domain（tasks/bindings/index 三张表）。domain handle 由调用方持有，插件在 dispose 时 close。 | ✅ 重启持久化已实证 |
| `ctx.get('systemPrompt').section()` | `dsh-with-chatgpt:collaboration` 段，位于 `TOOL_WORKFLOW` 之后。 | ✅ 加载无报错 |
| `ctx.get('tools').execute()` | 调 `mcp__browser-harness__*` 浏览器工具。必须传 AbortSignal；上游 MCP 路径可能永久挂起，因此每次调用都额外加硬超时竞速，保证轮询循环不会卡死。 | ⚠️ 浏览器工具名/语义按 DSH browser-use provider 文档对齐，尚未在已登录 ChatGPT 的浏览器上跑完整轮 |
| profile 安装 | `dsh plugin --profile <name> add <path>`；包 manifest 声明 `dsh.bundle.patch` 即加入 layer stack。 | ✅ `--dump-config` 显示 `# == dsh-with-chatgpt` 行 |
| cordis.patch.yml user layer | 挂载 browser-use 服务与 Browser Harness provider（二者都没有 `dsh.bundle`，只能作为普通 plugin row 插入）。 | ✅ provider 成功激活并暴露 `mcp__browser-harness__*` |

## ESM 约束

Host 侧是 ESM：`require()` 不可用，所有 node 内置模块必须顶层 `import`。`apply()` 返回 disposer（同步或 promise）由插件自己包装。图

| 模块 | 文件 | 职责 |
|---|---|---|
| protocol | `src/protocol/envelope.ts` | `[D2C]` envelope 格式/解析/序列化，严格校验 |
| protocol | `src/protocol/state-machine.ts` | 任务生命周期状态机，拒绝 stale reply |
| orchestrator | `src/orchestrator/coordinator.ts` | INIT→PLAN→EXECUTED→REVIEW→DONE 编排，boot prompt，重连 |
| orchestrator | `src/orchestrator/state.ts` | 持久化任务/绑定记录（KV store 契约） |
| browser | `src/browser/adapter.ts` | `BrowserControl` 接口、重复发送防护、重试预算 |
| workspace | `src/workspace/boundary.ts` | canonical realpath 遏制、敏感文件策略、`.d2cignore` |
| workspace | `src/workspace/git.ts` | 只读 git 快照（status/diff/log，批处理、字节上限） |
| execution | `src/execution/recorder.ts` | JSONL 执行记录、secret 脱敏、私钥硬拒 |
| bridge | `src/bridge/server.ts` | loopback JSON-RPC/MCP 服务器，Bearer 鉴权 |
| bridge | `src/bridge/tools.ts` | 十个只读 MCP 工具（绑定 workspace spec） |
| 入口 | `src/index.ts` | Cordis apply：service + 4 tools + prompt section + bridge + storage |

## 运行时协议回合

```
chatgpt_plan(goal)
  ├─ browser.ensureReady() → chatgpt.com 可达
  ├─ 打开/复用持久 conversation
  ├─ 发送 boot prompt + [D2C] INIT envelope（8KiB 上限）
  └─ waitForReply → 提取最后一个 [D2C] → 状态机校验 → 持久化
       PLAN → planned（等 DSH 执行）
       BLOCKED/ERROR → 需要用户介入

（GLM 执行计划：编辑/构建/测试，正常 DSH 工具流）

chatgpt_review(taskId, changedFiles, head, testsRecorded)
  ├─ 状态机：planned → executing →（发 EXECUTED，iteration+1）→ awaiting-review
  ├─ EXECUTED envelope 附机器摘要（changed files / HEAD / tests_recorded）
  └─ waitForReply → DONE（完成）/ PLAN（修复回合，回到 planned）
```

## 恢复模型

- **浏览器刷新/失联**：`chatgpt_reconnect` → `browser.ensureReady()` + 复用 conversation id；任务状态在 storage domain 中未受影响。
- **DSH 重启**：插件随 profile 重新加载；`recover()` 用 workspace 绑定找到 `lastTaskId`，状态机记录原样恢复。
- **stale 回复**：状态机按 `TASK_ID` + `ITERATION` + `IN_REPLY_TO` 校验，旧回合重放被拒绝（`stale-iteration` / `unexpected-reply`）。

## 与 DSH 的接缝（全部公开 surface）

- `ctx.tools.register` — 4 个模型工具
- `ctx.get('systemPrompt').section` — 协作规则 section（TOOL_WORKFLOW 序）
- `ctx.get('storageDomain').open(defineDomain(...))` — 持久状态
- Browser Harness MCP（`mcp__browser-harness__*`，session 隔离）— 控制面
- 普通 Node 进程内 `node:http` loopback listener — 数据面
