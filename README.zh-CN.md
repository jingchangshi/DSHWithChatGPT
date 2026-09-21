# dsh-with-chatgpt

**ChatGPT 负责思考，DeepSeek Harness 负责执行。**

一个 DeepSeek Harness 插件：把你现有的 DSH 编码代理（GLM-5.3-Flash）与 ChatGPT Web 组成"规划/评审大脑 + 执行者"的协作闭环。走官方 ChatGPT 网页 UI —— 不需要 ChatGPT API key，不逆向私有 API。

## 这是什么？

你照常用 DeepSeek Harness。当任务需要"第二个大脑"时，代理会启动一个**协作回合**：

```
用户任务
  → DSH/GLM 通过浏览器控制面给 ChatGPT 发 INIT
  → ChatGPT 通过只读 MCP 连接器自己读取 workspace（数据面）
  → ChatGPT 回复结构化 [D2C] PLAN envelope
  → DSH/GLM 实现、构建、测试（全部执行留在本地）
  → DSH/GLM 发 EXECUTED（机器摘要，极小）
  → ChatGPT 通过 git_diff / test_status 等 MCP 工具独立核验
  → 回复 DONE 或 PLAN（修复要求）
  → 循环直到 DONE
```

## 为什么不直接调 ChatGPT API？

- **用你现有的 ChatGPT 账号与订阅**，控制面是官方 Web UI（BrowserUse 驱动），没有 API 计费与密钥管理。
- **独立评审需要文件访问能力，不是更长的 prompt。** 让 ChatGPT 自己读真实 diff 和真实测试记录，而不是靠 composer 粘贴。
- **信任边界是结构性的**：bridge 服务器在注册层面就拒绝任何非只读工具——写能力根本不存在。

## 为什么 ChatGPT 没有写权限？

因为它不需要，而且独立性要求遏制：

- bridge 只暴露十个只读工具（workspace_info、list_directory、read_file、search_workspace、git_status、git_diff、git_log、test_status、execution_summary、execution_output）。
- 所有路径访问经过 canonical realpath 遏制（symlink 逃逸有测试）+ 敏感文件默认拒绝（.env、密钥、凭据…）+ 项目级 `.d2cignore`。
- 测试结果是被核验的，不是被转述的：ChatGPT 读结构化执行记录（退出码、测试分类），不听"测试通过了"。

## 分工

| | ChatGPT Web | DSH / GLM-5.3-Flash |
|---|---|---|
| 架构推理、规划 | ✅ | |
| 独立代码评审 | ✅ | |
| 调试策略 | ✅ | |
| 文件编辑、shell、构建、测试 | | ✅ |
| git commit / push | | ✅ |
| 恢复、实现 | | ✅ |

## 安装

前置：Node.js ≥ 20、pnpm、可用的 DSH（支持 profile）。

```powershell
git clone https://github.com/jingchangshi/DSHWithChatGPT.git
cd DSHWithChatGPT\package
pnpm install
pnpm build && pnpm test

# 注册进 profile（读取包内 cordis.patch.yml）
dsh plugin --profile <你的profile> add D:\workspace\DSHWithChatGPT\package

# 重启 DSH —— 插件随 profile 加载
```

手动安装：把包放到任意持久目录，把它的 `cordis.patch.yml` 行（`id: dsh-with-chatgpt, name: dsh-with-chatgpt`）追加进 profile 的 `cordis.patch.yml`。

## 首次 setup

1. **浏览器控制面**：确保当前 DSH profile 已有可工作的 BrowserUse / Browser Harness MCP，并让它控制一个已经登录 chatgpt.com 的 Chrome/Edge。
2. **启动本地只读 bridge**：在目标 workspace 调用 `chatgpt_status`。这会提前启动 bridge；默认地址为 `http://127.0.0.1:43127/mcp`。
3. **Secure MCP Tunnel**：ChatGPT 不能直接访问本机 loopback MCP。请在 OpenAI Platform 创建 tunnel，并用官方 `tunnel-client` 把上述本地 URL 接入 tunnel：

```powershell
$env:CONTROL_PLANE_API_KEY="<OpenAI Platform runtime key>"
tunnel-client init --profile dsh-with-chatgpt --tunnel-id <tunnel_id> --mcp-server-url http://127.0.0.1:43127/mcp
tunnel-client doctor --profile dsh-with-chatgpt --explain
tunnel-client run --profile dsh-with-chatgpt
```

4. **ChatGPT 开发者模式 App**：在 ChatGPT 中创建开发者模式 App，Connection 选择 **Tunnel** 并选择上述 tunnel。确认可发现 `workspace_info`、`git_diff`、`test_status` 等只读工具。

插件 bridge 只监听 `127.0.0.1`；通过 Secure MCP Tunnel 时，外部认证和传输由 OpenAI tunnel 控制面承担。不要把 `127.0.0.1` 直接填成 ChatGPT 的远程 MCP URL。
## 使用

在 DSH 会话里、目标项目目录下：

> 使用 ChatGPT 帮我规划并实现 <任务>
> Use ChatGPT to implement <task>

代理会启动协作回合（`chatgpt_plan`），用自己的常规工具执行计划，然后请求独立评审（`chatgpt_review`）。普通开发请求不会进入该循环。

| 工具 | 用途 |
|---|---|
| `chatgpt_plan` | 发送目标，取回 ChatGPT 结构化计划 |
| `chatgpt_review` | 汇报执行结果，取回独立评审（DONE / 修复 PLAN） |
| `chatgpt_status` | 协调器 + bridge 状态、最近任务 |
| `chatgpt_reconnect` | 浏览器刷新 / DSH 重启后恢复 |

## 卸载

```powershell
dsh plugin --profile <你的profile> remove dsh-with-chatgpt
```

任务状态在 DSH storage 区（`d2c_state` domain），执行记录在 `%LOCALAPPDATA%\dsh-with-chatgpt`——删除后者即清除记录。

## 文档

`docs/architecture.md`（架构）、`docs/protocol.md`（[D2C] 协议）、`docs/security.md`（安全边界）、`docs/installation.md`（安装）、`docs/browser-use.md`（浏览器会话与恢复）、`docs/troubleshooting.md`（故障表）、`docs/development.md`（开发）。

## 状态与限制

已实现并测试：协议与状态机、workspace 安全边界、执行记录、只读 MCP bridge、持久化协调器、模型工具、prompt 注入、profile 安装路径。

已知限制（如实列出）：chatgpt.com 的 BrowserHarness 适配器仍依赖稳定 DOM 语义；默认一个 DSH 实例使用一个稳定 `bridgePort`，并发独立 workspace tunnel 应配置不同端口；自动执行证据目前覆盖前台 `bash` / `pwsh`，后台 job 的“已启动”不会被误记为测试完成；Secure MCP Tunnel 与 ChatGPT 开发者模式需要相应权限。

## 许可

MIT。部分设计参考 [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)（MIT），见 `THIRD_PARTY_NOTICES.md`。
