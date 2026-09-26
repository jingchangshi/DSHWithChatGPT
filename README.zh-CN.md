# dsh-with-chatgpt

**ChatGPT 负责思考，DeepSeek Harness 负责执行。**

这是一个 DeepSeek Harness 插件：ChatGPT Web 负责架构、规划和独立评审，DSH / GLM-5.3-Flash 负责修改代码、构建、测试、git commit/push 和故障恢复。

## 运行闭环

Provider-neutral 接入尚在进行中。生产 bridge 通过执行期 runtime registry 分派内容请求，不再调用 Host 工作区读取函数。每个工作区只允许一次有效获取；租约替换后，即使服务代次相同，未完成读取也不能发布结果。五个协作工具通过公开的 DSH execution-world identity 服务解析 Session cwd；bridge 命名空间与其 recorder 选择使用提供方返回的不透明 ID。缺少根目录安全读取授权时，Git 和原始执行输出也被拒绝；元数据不包含命令标签。PLAN/REVIEW 在读取和 Git 授权不足时拒绝发送消息。MCP 查询在后端分派前被规范化为有界 DTO；静态工具定义共享且不构造 Host handler。固定 Git 命令现使用注入的执行世界 executor；生产 Git helper 不再启动 Host 进程或按 Host 平台推测空设备。Coordinator 必须显式提供工作区 ID，不再回退到路径键。Doctor 将内容、Git 和执行输出授权纳入本地就绪判断，身份匹配本身不能报告 ready。生产 coordinator 绑定与 shell 证据现使用同一提供方 ID；shell workdir 仅为显示元数据，不再经 Host 路径解析来推导身份。生产启动要求持久存储与显式服务注入，不再自动回退到内存。DSH 内容/进程 adapter 仍未完成，因此尚未安装生产内容租约。远端隔离与完整产品闭环尚未验收。

```
用户目标
  → DSH 自动启动 bridge + Secure MCP Tunnel
  → Browser Harness 自动 @mention 指定 ChatGPT App 并发送 INIT
  → ChatGPT 通过只读 MCP 检查 workspace，返回 PLAN
  → GLM 实现 / 测试 / commit / push
  → DSH 发送带精确 HEAD 的 EXECUTED
  → ChatGPT 通过 MCP 独立核验 diff + test records
  → DONE，或返回修复 PLAN
  → GLM 自动继续下一轮，直到 DONE / BLOCKED / maxIterations
```

默认 profile 使用 `gitPolicy: commit-push`：不允许在 `main/master` 上进行无人值守 review 回合；GLM 应创建任务分支，测试成功后 commit、push 非保护分支，再用精确 HEAD 请求 ChatGPT 评审。插件不执行 force push，也不自动合并 PR。

## 安装

前置：Node.js ≥ 20、pnpm、DSH profile、DSH BrowserUse + Browser Harness MCP provider。

```powershell
git clone https://github.com/jingchangshi/DSHWithChatGPT.git
cd DSHWithChatGPT\package
pnpm install
pnpm typecheck
pnpm test
pnpm build

dsh plugin --profile <你的profile> add D:\workspace\DSHWithChatGPT\package
```

## 一次性 setup

目标 profile 除了 `tools` 和 `systemPrompt`，还必须挂载兼容 DSH 包提供的 `executionWorldIdentity` 与 `storageDomain`（最低 0.1.6-alpha.2）。安装插件包本身不会配置这些服务。开发依赖使用 producer 正式生成的 tarball，不依赖相邻 checkout；构建后执行 `pnpm test:package`，可验证独立目录中的安装与运行时导入。生产 execution-world adapter 尚未实现，内容访问仍不可用。

无人值守是指 **setup 完成后的运行时** 无需人工逐轮操作。以下仍属于显式一次性设置：

1. 在 Browser Harness 使用的 Chrome/Edge profile 中登录 ChatGPT；登录、2FA、CAPTCHA 不自动绕过。
2. 在 ChatGPT 创建/启用一个只读 MCP App，名字默认必须精确为 `DSH with ChatGPT`（也可修改 `chatgptAppName`）。
3. 在 OpenAI Platform 创建 Secure MCP Tunnel。
4. 让启动 DSH 的环境包含：

```powershell
$env:CONTROL_PLANE_TUNNEL_ID="<tunnel_id>"
$env:CONTROL_PLANE_API_KEY="<runtime_api_key>"
```

并确保 `tunnel-client` 在 `PATH`。
5. 在目标项目中让 DSH 调用一次 `chatgpt_status`。应看到 `tunnel.ready: true`、稳定的 `workspaceId`、正确的 `chatgptAppName` 和 `gitPolicy`。

bridge 仍只监听 `127.0.0.1` 并要求 Bearer。Bearer 不进入 ChatGPT prompt，也不放进 repo；插件把它保存到本地 0600 文件，由 `tunnel-client` 只在最后一跳注入。

## 使用

在 **Standard Mode + GLM-5.3-Flash** 的 DSH 会话中，进入目标 repo：

> 使用 ChatGPT 完全无人值守地完成：<任务>

插件注入的协作规则会要求 GLM 连续完成：

`chatgpt_plan → 实现 → 测试 → commit/push → chatgpt_review → 修复 PLAN → ... → DONE`

不会在每一轮结束后询问“是否继续”。仅在登录/授权、CAPTCHA、基础设施故障、冲突/安全风险、达到 `maxIterations`，或确实需要用户产品决策时停止。

## 安全边界

工作区身份检查和路径包含检查共享 `WorkspaceError` 构造器及稳定的 `reason` 错误码；错误定义模块不依赖文件系统。

ChatGPT 只有十个只读 MCP 工具：`workspace_info`、`list_directory`、`read_file`、`search_workspace`、`git_status`、`git_diff`、`git_log`、`test_status`、`execution_summary`、`execution_output`。没有 write、shell、commit、push 工具。

每次 D2C 回复还要同时通过：
- TASK_ID / ITERATION / IN_REPLY_TO
- `WORKSPACE_ID`
- review 时的精确 `HEAD`

任一不匹配都会拒绝该回复。

## 状态与限制

已实现：自动 App @mention、旧回复 fencing、当前 DSH session BrowserUse 绑定、managed Secure MCP Tunnel、自恢复 conversation、workspace identity、精确 HEAD 评审、执行证据、有限轮自动循环。

仍需人工的一次性边界：ChatGPT 登录/2FA/CAPTCHA、创建 ChatGPT App、创建 Secure MCP Tunnel。ChatGPT Web DOM 变化时，语义选择器可能需要维护。

## 许可

MIT。部分设计参考 [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)（MIT），见 `THIRD_PARTY_NOTICES.md`。
