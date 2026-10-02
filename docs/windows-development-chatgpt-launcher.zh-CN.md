# Windows 开发期 ChatGPT 启动入口

这是开发期 Codex 环境的兼容工具，不是 PlannerBridge 产品部署入口。
它保留旧开发配置的 generic execution 与 Browser Harness 依赖；真实产品
使用原生 DeepSeek、独立 Chrome 与 Sidecar，见 [Windows 部署](windows-deployment.md)。

```powershell
.\scripts\prepare-development-chatgpt.ps1 -Setup
.\scripts\prepare-development-chatgpt.ps1 -Check
.\scripts\launch-development-chatgpt.ps1
```

也可使用 `scripts\launch-development-chatgpt.cmd`。先关闭已有 Codex；
脚本检查单实例，不终止现有进程。启动会检查配置，解密必要值到当前进程环境，
再从仓库根目录启动 Codex。启动不代表完整产品验收，不创建或授权产品 App，
也不启动模型请求、浏览器或连接服务。新启动使用隐藏窗口选项。

环境输入规范名称为 `DSH_CLI`、`MCP_EXPOSURE_CLIENT`、
`BROWSER_HARNESS_COMPAT_EXECUTABLE`、`DSH_EXECUTION_BASE_URL`、
`DSH_EXECUTION_API_KEY`，以及外部连接的 `CONTROL_PLANE_TUNNEL_ID` / `CONTROL_PLANE_API_KEY`。
前五项各自兼容旧 `C2C_DSH_CLI`、`C2C_TUNNEL_CLIENT`、`C2C_BROWSER_HARNESS`、
`C2C_EXECUTION_BASE_URL`、`C2C_EXECUTION_API_KEY`。读取环境时规范值优先；
旧值仅作缺省回退，冲突/回退会告警且不打印值。启动输出规范环境键；
旧持久化键只在部署边界解释。不要把 generic provider 密钥当成 `DEEPSEEK_API_KEY`。

setup 对缺失值使用继承环境或隐藏输入，使用当前用户 DPAPI 加密。
保留已发布 `%LOCALAPPDATA%\dsh-with-chatgpt\c2c-launcher\config.json`
路径及 version 1 字段；check/launch 不移动、不重写或重新加密配置。
已配置的可执行文件仍按保存的配置启动；修改它们需显式 setup。
`-Setup -ResetSecrets` 才显式替换已保存的密钥；普通 setup 复用已有密文。
ACL 仅修改当前用户 DACL，不请求写入无关 SACL。check 不修改 ACL 或密文。

```powershell
.\scripts\prepare-development-chatgpt.ps1 -Check -BrowserCheck
.\scripts\prepare-development-chatgpt.ps1 -Setup -ResetSecrets
.\scripts\prepare-development-chatgpt.ps1 -ClearLocalConfig
```

BrowserCheck 仅调用旧开发 Browser Harness 准备检查。
ClearLocalConfig 只删除这个入口拥有的配置目录，保留其他连接、浏览器、DSH
和产品状态。不要删除共享状态目录。产品连接使用独立的
`prepare-plannerbridge.ps1` / `launch-plannerbridge.ps1`。

旧 prepare-c2c-codex.ps1、launch-c2c-codex.ps1/.cmd 为带弃用告警的薄包装。
旧 prepare 的 readiness 字段 allAcceptancePrerequisitesPresent 仅为兼容；
规范输出 allDevelopmentPrerequisitesPresent。两者只说明配置项存在，
不证明密钥有效、连接成功、产品 App 可读或完整 Planner-Executor 流程通过。
旧 -Check -Launch 的检查后提前退出已修复，启动现在进入单实例保护。
