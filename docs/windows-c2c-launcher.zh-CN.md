# Windows C2C Codex Launcher

本工具把 live C2C 所需的本地环境准备封装为首次 setup、检查和日常启动。它只管理自己的本地配置，不创建仓库 `.env`，也不删除 ChatGPT OAuth、connector、Tunnel、Browser Harness、Chrome 或 DSH 状态。

## 首次 setup

在 `DSHWithChatGPT` 根目录运行：

```powershell
.\scripts\prepare-c2c-codex.ps1 -Setup
```

脚本自动发现已经存在的 DSH CLI、Tunnel Client 和 Browser Harness 可执行文件。若启动 setup 的父进程已经带有 C2C 环境变量，四个敏感值会被自动读取并加密保存；否则脚本只对缺失项显示其来源说明，再通过隐藏输入录入。它们使用当前 Windows 用户的 DPAPI 加密保存到 `%LOCALAPPDATA%\dsh-with-chatgpt\c2c-launcher\config.json`。配置目录和文件只授予当前用户访问权限。

四个敏感值不能从 ChatGPT 登录、`.codex/auth.json` 或浏览器会话安全推导。`C2C_EXECUTION_BASE_URL` 和 `C2C_EXECUTION_API_KEY` 来自 Sub2API provider；`CONTROL_PLANE_API_KEY` 和 `CONTROL_PLANE_TUNNEL_ID` 来自 Secure MCP Tunnel 配置。若已有父进程环境，setup 会自动完成，不需要再次知道这些值。

## 日常启动

先关闭已有 Codex（脚本不会强制终止可能含有未保存工作的进程），然后双击：

```text
scripts\launch-c2c-codex.cmd
```

或运行：

```powershell
.\scripts\launch-c2c-codex.ps1
```

launcher 会先检查完整配置、可执行文件和 Codex 单实例状态，再在同一父进程环境中启动新的 Codex。它不会启动模型请求、Tunnel 或 Browser Harness daemon；Browser Harness 的 Chrome/CDP 准备仍由现有 `deepseek-harness\scripts\chrome-agent.ps1` 和 `browser-ready.ps1` 负责。

## 检查与清理

```powershell
.\scripts\prepare-c2c-codex.ps1 -Check
.\scripts\prepare-c2c-codex.ps1 -Check -BrowserCheck
.\scripts\prepare-c2c-codex.ps1 -Setup -ResetSecrets
.\scripts\prepare-c2c-codex.ps1 -ClearLocalConfig
```

`-ClearLocalConfig` 只删除 launcher 创建的 DPAPI 配置。它不删除 OAuth、connector、Tunnel 服务配置、Browser Harness profile、DSH state 或 Chrome profile。

## 边界

launcher ready 不等于 full C2C accepted。完成 live acceptance 仍需要在新 Codex 中执行既定的 doctor、App proof、PLAN、实施、测试、提交推送和独立 REVIEW 流程；本 launcher 阶段不运行这些真实模型验收。
