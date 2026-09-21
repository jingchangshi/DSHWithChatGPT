# 架构 / Architecture

## 目标

运行时实现无人值守 C2C：一次性完成 ChatGPT 登录、自定义 MCP App 和 Secure MCP Tunnel 创建后，DSH 可以连续执行：

```
User goal
  → ChatGPT PLAN
  → GLM implement / test
  → commit + push task branch
  → ChatGPT independently reviews exact HEAD
  → DONE | fix PLAN
  → repeat until DONE / BLOCKED / maxIterations
```

ChatGPT 始终只负责 WHAT/WHY 与独立评审；DSH/GLM 始终拥有写代码、shell、测试、git 的执行权。

## 总体结构

```
                    ChatGPT Web
              Plan / Review / Reason
                    ▲         │
        @mention App│         │ read-only MCP
       every message│         ▼
             Browser Harness   OpenAI Secure MCP Tunnel
                    ▲         │
                    │         ▼
          ┌─────────────────────────────┐
          │       dsh-with-chatgpt      │
          │                             │
          │ ChatGptCoordinator          │
          │ BrowserHarnessAdapter       │
          │ TunnelSupervisor            │
          │ BridgeServer (127.0.0.1)    │
          │ ExecutionRecorder           │
          │ WorkspaceBoundary           │
          └──────────────┬──────────────┘
                         │ DSH public surfaces
                         ▼
                 DSH / GLM-5.3-Flash
             edit / shell / test / git
```

## Control plane

Browser Harness 控制 ChatGPT Web，但 composer 只传小型 D2C envelope，不传源码、diff 或日志。

每次 INIT / REVIEW 前：
1. 读取当前 assistant message 数量和最新文本，形成 reply baseline。
2. 输入 `@<chatgptAppName>`。
3. 在可见 autocomplete/menu 中查找精确 App 名，点击并验证 mention decorator。
4. 追加 D2C envelope 并发送。
5. 只接受 baseline 之后出现的新 assistant 回复；等待 streaming 停止且文本稳定。

App 找不到时 fail closed：不会退化成一个没有 workspace MCP 的“盲规划/盲评审”。

Browser Harness 工具调用始终绑定**当前 DSH agent/session**；coordinator 不再按 workspace 缓存旧 BrowserUse owner。

## Data plane

本地 BridgeServer：
- 只监听 `127.0.0.1`
- 仅注册固定十个只读 MCP 工具
- 每个 workspace 使用独立随机 Bearer
- 所有 path 工具经过 canonical realpath containment 与 sensitive-file policy
- execution output 经过 secret redaction 与大小限制

`workspace_info` 返回稳定、非秘密的 `workspaceId`。D2C 的 INIT/EXECUTED 携带 `WORKSPACE_ID`，ChatGPT 必须通过 MCP 确认后原样回显；错误 App/connector/workspace 会被 coordinator 机器拒绝。

## Secure MCP Tunnel

`TunnelSupervisor` 在 bundled `tunnelMode: managed` 下：
- 从 config/env 取得 tunnel id
- 从 `CONTROL_PLANE_API_KEY` 取得 runtime key
- 启动/监控 `tunnel-client run`
- 使用随机 localhost health endpoint + `/readyz`
- bridge 端 Bearer 保持开启
- Bearer 值写入本地 0600 文件
- 通过 `MCP_EXTRA_HEADERS` 与 `MCP_DISCOVERY_EXTRA_HEADERS` 的 `file:` value reference，仅在 tunnel-client → localhost MCP 最后一跳注入 Authorization
- workspace/local URL 变化时重建 managed tunnel binding
- 同一插件进程只允许一个 active managed-tunnel C2C workspace；另一个 workspace 不能静默抢占 tunnel
- plugin unload 时关闭 child process

模型可见状态不包含 runtime API key 或 Bearer。

## Review integrity

一次 committed review 同时绑定三层 identity：

```
TASK_ID + ITERATION
WORKSPACE_ID
HEAD
```

ChatGPT 返回 PLAN/DONE 时必须匹配 workspace；对 EXECUTED 的 review 还必须回显精确 HEAD。

bundled `gitPolicy: commit-push` 进一步要求：
- 当前必须是正常 git branch，不允许 detached HEAD
- 不允许 `main/master`
- worktree 必须 clean
- branch 必须配置 upstream
- `ahead == 0`
- upstream HEAD == local HEAD
- `chatgpt_review(head=...)` 必须等于当前 local HEAD

因此“只 commit 没 push”无法进入 ChatGPT review。

## Autonomous loop

插件本身不重写 DSH agent-loop。它通过 model-facing tools + system-prompt policy 驱动现有 GLM：

`chatgpt_plan` → GLM 实现/测试/git → `chatgpt_review`。

review 返回 PLAN 时，system prompt 要求 GLM 不询问用户而直接执行下一轮；返回 DONE 才结束。停止条件仅包括：
- DONE / BLOCKED
- `maxIterations`
- 登录/2FA/CAPTCHA 或授权问题
- tunnel/browser/connector 基础设施故障
- git 冲突/安全风险
- 必须由用户决定的产品选择

## 持久化与恢复

Durable storage 保存 task state、iteration、conversation id、last reviewed HEAD 与 workspace binding。DSH 重启后 `chatgpt_reconnect`：
1. 重建 bridge/tunnel runtime
2. rehydrate protocol state machine
3. 用保存的 conversation id 打开原 ChatGPT chat
4. 继续原任务

执行证据单独保存在 DSH state area，不写进项目 repo。

## 一次性人工边界

“无人值守”不意味着绕过账号安全。以下只做一次或按平台要求人工完成：
- ChatGPT 登录
- 2FA / CAPTCHA
- 创建/启用 ChatGPT custom MCP App
- 创建 Secure MCP Tunnel / 获取 runtime key

完成后，正常 C2C 回合不再需要人工选择 App、复制 prompt、启动 tunnel 或确认每轮是否继续。
