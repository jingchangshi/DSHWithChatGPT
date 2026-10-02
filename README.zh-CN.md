# PlannerBridge

**ChatGPT 负责规划与独立评审，DeepSeek Harness 负责执行。**

PlannerBridge 是 Planner/Reviewer 与 Executor 的协作运行时。当前唯一 P0
部署是 Windows 11、ChatGPT Web 与 DSH + DeepSeek-V4.1-Flash：
`provider: deepseek-official`、`model: deepseek-flash`，reasoning 使用
提供方默认值。仓库与已发布插件名 `DSHWithChatGPT`、`dsh-with-chatgpt`
保留兼容。

已有源码、安装包、安装后权限和模拟组合流程的局部验证证据。
**真实 Windows 模型/App 闭环和最终全局审查尚未完成。**
实际状态见[验收矩阵](docs/acceptance-plan.md)，不能将组件或模拟测试算作真实产品通过。

## Windows 主路径

```text
独立产品 Chrome 中的 ChatGPT Web
  ↕ ChatGptWebDriver / DirectCdpPrimitives
Chat Control Sidecar（本机语义服务）
  ↕ SidecarChatControlClient
PlannerBridge 协调器 / DSH adapter
  ↕ DeepSeek-V4.1-Flash Executor
Execution World → 工作区 / shell / tests / Git

ChatGPT 产品 App → 安全只读数据通道
  → 当前 ReadLease / GitLease / 任务执行证据
```

对话控制与事实读取分离。Sidecar 不提供工作区、shell、Git 或任意浏览器控制接口。
工作区 ID 是身份，不是权限；缺少或过期租约时拒绝访问，不能回退到 Host 文件或 shell。
Browser Harness 仅为明确选择的兼容路径，不是 Windows 主路径前置条件。
CodexWithChatGPT 只用于开发规划/审阅，产品运行时不依赖它。
未来 Linux 跨主机部署保持 **FUTURE**，不阻塞当前 Windows 交付。

## 安装与一次性配置

需要 Node.js ≥ 20、pnpm 和支持插件所需公开服务的 DSH profile，依赖版本以
[package.json](package/package.json) 为准。完整步骤见
[安装文档](docs/installation.md)和[Windows 部署](docs/windows-deployment.md)。

```powershell
cd DSHWithChatGPT\package
pnpm install
pnpm typecheck
pnpm test
pnpm build
dsh plugin --profile <你的profile> add <package目录的绝对路径>
```

插件 patch 使用 `browserMode: sidecar`、`gitPolicy: commit-push` 和 Windows
`gitReadPolicy: allow-hardened-windows`。安装插件本身不会启动 Chrome/Sidecar、
选择执行模型或授权产品 App。登录、2FA、CAPTCHA 和连接授权由用户完成。

规范产品入口是 `scripts/prepare-plannerbridge.ps1` 与
`scripts/launch-plannerbridge.ps1`。`DSH_CLI` 指定已构建的 DSH CLI；
旧产品入口与环境变量仅作明确兼容，见[迁移说明](docs/migration-plan.md)。
它们保留既有受保护配置位置，不代表完整部署已就绪。

## 协作与证据

在目标工作区的 DSH Session 中提出：

> 使用 ChatGPT 规划并实现任务，测试后在任务分支 commit/push，继续处理评审修正直到 DONE。

新主路径任务使用 v2 `[PLANNER_BRIDGE]` 协议：

```text
目标 → PLAN → 执行器修改/测试 → commit/push
     → EXECUTED → 独立 REVIEW → DONE 或下一轮 PLAN
```

回复必须绑定 TASK_ID、ITERATION、WORKSPACE_ID 与精确 HEAD。
规范评审要求非保护分支、工作区干净、已配置上游、ahead/behind 为零，
本地 HEAD 等于上游 HEAD。DONE 绑定同一执行轮次；修正 PLAN 才进入下一轮。
旧 `gitPolicy: worktree` 不会放宽规范流程，旧 v1 任务保留原协议与存储，不隐式升级。

五个 DSH 协作工具是 `chatgpt_plan`、`chatgpt_review`、`chatgpt_status`、
`chatgpt_doctor`、`chatgpt_reconnect`。Doctor 的本地就绪和显式 App proof
是不同结果；原始执行输出权限在非评审期间可能不可用。两者都不能证明完整产品闭环。
最终真实验收还要求 Reviewer 自行读取测试 stdout 中随机标记并回显，且完成修正、重启恢复与 DONE。
执行器不得经参数、文件或摘要转交标记值。

产品 App 只有十个只读工具：`workspace_info`、`list_directory`、`read_file`、
`search_workspace`、`git_status`、`git_diff`、`git_log`、`test_status`、
`execution_summary`、`execution_output`，没有 write、shell、commit 或 push。
根目录安全与租约生命周期由 producer 提供，consumer 保留敏感文件策略和查询/输出限额。
规范忽略文件为 `.plannerbridgeignore`；旧 `.d2cignore` 为追加兼容，不能撤销默认拒绝项。

规范任务存入 `plannerbridge_state`，旧 `d2c_state` 明确保留兼容。
卸载时使用 `dsh plugin --profile <你的profile> remove dsh-with-chatgpt`；
不要递归删除共享状态或凭据目录，未完成任务和连接配置需要保留。

## 验证与文档

`pnpm run test:plannerbridge-fake-stack` 组合真实 Git/测试/推送与独立进程恢复，
但 Planner/浏览器是模拟 fixture。安装后 profile 验证使用真实 DSH 与模拟 Sidecar。
两者都不能替代实际模型/App 的 `test:planner-executor-e2e`。
运行导入 `lib` 的子进程 fixture 前先构建，不与清理构建并发。
独立 producer 原生 Git 支持测试的超时失败仍在验收矩阵中保留。

- [目标架构](docs/target-architecture.md)
- [规范协议](docs/planner-executor-protocol.md)
- [Windows 部署](docs/windows-deployment.md)
- [安装](docs/installation.md)与[故障排查](docs/troubleshooting.md)
- [验收证据](docs/acceptance-plan.md)
- [迁移与兼容](docs/migration-plan.md)

## 许可

MIT。部分设计参考 [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)
（MIT），见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
