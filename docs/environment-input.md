# DSHWithChatGPT Goal Mode Environment Input

> HISTORICAL INPUT — 2026-09-30 已核对：本文件的 D:\workspace 路径、工具版本及 Browser Harness 等预置状态不代表当前 Windows 主机。当前开发环境事实、实测状态与就绪结论请使用 [env-win.md](env-win.md)。本文件保留历史输入，不得把未复核的旧断言作为 VERIFIED 证据。

## 0. Usage rules

- 这是当前任务可使用的真实环境信息。
- 不要假设模板中未填写的能力存在。
- 不要打印、读取、提交或回显任何 secret 的实际值。
- 对 credential 只允许记录：
  - `present`
  - `missing`
  - `unknown`
- 如果某项环境缺失：
  - 若只阻塞最终真实跨机 acceptance，标记 `EXTERNAL_ACCEPTANCE_BLOCKED`，继续其余实现和测试。
  - 若阻塞当前阶段，先自动尝试安全修复。
  - 只有登录、2FA/CAPTCHA、真实凭证、SSH server 管理权限等必须人工介入的问题才询问用户。
- 不要把“环境未提供”解释成“架构不需要该能力”。

---

# 1. Source repositories

## DSHWithChatGPT

- Local OS: Windows 11
- Local path:
  `D:\workspace\DSHWithChatGPT`
- Repository:
  `https://github.com/jingchangshi/DSHWithChatGPT`
- Working branch:
  `feat/complete-c2c-runtime`
- Permission:
  `read-write`

## deepseek-harness

- Local path:
  `D:\workspace\deepseek-harness`
- Repository:
  `https://github.com/jingchangshi/deepseek-harness`
- Working branch/ref:
  `feat/complete-c2c-runtime`
- Permission:
  `read-write`

## codex-with-chatgpt

- Local path:
  `D:\workspace\codex-with-chatgpt`
- Repository:
  `https://github.com/XiaoDuoYa/codex-with-chatgpt`
- Permission:
  `read-only unless plugin self-update is required`

---

# 2. Windows development/control host

## OS

- OS:
  `Windows 11`
- Architecture:
  `x86_64`
- PowerShell:
  `PowerShell 7.6.6`
- Current shell:
  `PowerShell 7`

## Toolchain

```text
git:      <git --version = git version 2.55.0.windows.3>
node:     <node --version = v24.19.0>
corepack: <corepack --version = 0.36.0>
pnpm:     <pnpm --version = 11.7.0>
ssh:      <ssh -V = OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2>
python:   <python --version = Python 3.14.6>
```

## Codex

- Codex Desktop installed:
  `yes`
- Codex can edit DSHWithChatGPT:
  `yes`
- Codex can execute local shell:
  `yes`
- Codex can use localhost networking:
  `yes`
- Codex with ChatGPT installed:
  `yes`
- Codex with ChatGPT current PLAN/REVIEW flow verified:
  `yes`
- Last verified date:
  `2026-09-30`

---

# 3. Windows ChatGPT browser environment

## Dedicated Chrome

- Dedicated Chrome profile:
  `yes`
- Profile purpose:
  `DSHWithChatGPT C2C only`
- ChatGPT Web logged in:
  `yes`
- ChatGPT URL reachable:
  `yes`
- ChatGPT Custom App visible:
  `yes`
- Custom App exact name:
  `DSH with ChatGPT`

## CDP

- CDP enabled:
  `yes`
- CDP bind address:
  `127.0.0.1`
- CDP port:
  `9222`
- `http://127.0.0.1:9222/json/version` verified:
  `yes`

Observed fields:

```text
Browser:          Chrome/153.0.8010.53
Protocol-Version: 1.3
webSocketDebuggerUrl present: yes
```

## Browser Harness compatibility provider

- Browser Harness installed:
  `yes`
- Browser Harness doctor:
  `pass`
- Required only for:
  `local-browser-harness compatibility path`
- Must NOT be required for:
  `remote-sidecar Linux acceptance`

---

# 4. Linux execution host

## SSH endpoint

- Host alias:
  `blueDevX86`
- Host/IP:
  `123.60.231.48`
- SSH port:
  `1208`
- SSH user:
  `shijingchang`
- Authentication:
  `SSH key`
- Passwordless/non-interactive login verified:
  `yes`

Example verified command:

```text
ssh blueDevX86 'uname -a && node --version && git --version'
```

## Linux OS

```text
distribution: ubuntu
version:      24.04
kernel:       6.8.0-100-generic
architecture: x86_64
```

## Linux toolchain

```text
git:      <git --version = 2.43.0>
node:     <node --version = v22.22.2>
corepack: <corepack --version = 0.34.6>
pnpm:     <pnpm --version = 11.24.0>
bash:     <bash --version = GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)>
curl:     <curl --version = curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13 zlib/1.3 brotli/1.1.0 zstd/1.5.5 libidn2/2.3.7 libpsl/0.21.2 (+libidn2/2.3.7) libssh/0.10.6/openssl/zlib nghttp2/1.59.0 librtmp/2.3 OpenLDAP/2.6.10>
bwrap:    <bwrap --version = bubblewrap 0.9.0>
socat:    <socat version = socat version 1.8.0.0 on 03 Jul 2026 12:45:49>
```

## Linux workspace

- Base writable workspace:
  `/home/shijingchang/workspace`
- DSHWithChatGPT path:
  `/home/shijingchang/workspace/DSHWithChatGPT`
- deepseek-harness path:
  `/home/shijingchang/workspace/deepseek-harness`
- Acceptance temp workspace allowed:
  `yes`
- Local bare Git remote creation allowed:
  `yes`
- Can bind loopback ports:
  `yes`

---

# 5. SSH forwarding capability

Effective sshd configuration:

```text
gatewayports no
allowtcpforwarding yes
disableforwarding no
permitopen any
permitlisten any
```

## Local forwarding

Windows → Linux `ssh -L`:

- Verified:
  `yes`
- Example:
  `ssh -L 3091:127.0.0.1:3091 blueDevX86`

## Reverse forwarding

Windows → Linux `ssh -R`:

- Verified:
  `yes`

Verified topology:

```text
Linux 127.0.0.1:18765
        |
        | SSH reverse forwarding
        v
Windows 127.0.0.1:18765
```

Verified command:

```powershell
ssh -NT `
  -o ExitOnForwardFailure=yes `
  -R 127.0.0.1:18765:127.0.0.1:18765 `
  blueDevX86
```

Verification result:

```text
Linux curl reached the Windows loopback HTTP server successfully.
Request to /health returned application-level HTTP 404 from
python -m http.server, proving the TCP reverse forwarding path works.
```

Security expectation:

```text
GatewayPorts=no
Linux forwarded listener remains loopback-only.
```

---

# 6. DSH runtime

- DSH can build on Linux:
  `yes`
- DSH can run on Linux:
  `yes`
- DSH profile intended for acceptance:
  `c2c-e2e`
- Execution World available:
  `yes`
- ExecutionWorldIdentity available:
  `yes`
- ExecutionReadLease available:
  `yes`
- ExecutionGitLease available:
  `yes`
- Linux sandbox available:
  `yes`
- `bwrap` usable:
  `yes`

Known DSH constraints:

```text
- ExecutionWorldId is identity only and must not be treated as authorization.
- Workspace access must be acquired through live ExecutionReadLease /
  ExecutionGitLease capabilities; no Host filesystem fallback is allowed.
- Linux sandbox must fail closed if no enforcing backend is available.
- Browser Harness is required only for the legacy/local-browser-harness
  compatibility path; the final Linux remote-sidecar acceptance must not
  depend on Browser Harness being installed on Linux.
- One Browser Harness provider owns one live browser Session at a time.
- Final cross-host acceptance requires Windows Chat Control Sidecar +
  SSH reverse forwarding; current local-browser-harness acceptance is not
  sufficient evidence for the final architecture.
```

---

# 7. DSH execution model

Do NOT include credential values.

```text
C2C_EXECUTION_BASE_URL: present
C2C_EXECUTION_API_KEY: present
```

- Execution provider/model:
  `<FILL_ME>`
- Endpoint reachable from Linux:
  `<yes/no/not-tested>`
- Low-cost executor intended:
  `<FILL_ME>`

---

# 8. ChatGPT MCP data plane

## Custom App

- Exact App name:
  `DSH with ChatGPT`
- App configured in ChatGPT:
  `yes`
- App visible from current ChatGPT account:
  `yes`

## Secure MCP Tunnel

Do NOT include values.

```text
CONTROL_PLANE_TUNNEL_ID: present
CONTROL_PLANE_API_KEY:   present
```

- `tunnel-client` available on Linux:
  `yes`
- `tunnel-client` path:
  `/home/shijingchang/Software/tunnel-client/tunnel-client`
- Managed tunnel can start from Linux:
  `yes`
- Linux outbound connectivity for tunnel:
  `yes`

Expected data path:

```text
ChatGPT
→ Custom App
→ OpenAI Secure MCP Tunnel
→ Linux MCP Bridge
→ Execution capabilities
→ Linux Execution World
```

---

# 9. Chat Control target deployment

Target architecture for final acceptance:

```text
Windows
  Dedicated Chrome
        ^
        |
  Direct CDP
        |
  Chat Control Sidecar
        ^
        |
  localhost RPC endpoint
        ^
        |
  SSH reverse forwarding
        |
Linux
  RemoteChatControlClient
        |
  C2C Orchestrator
        |
  DSH
```

Target sidecar bind:

```text
Windows: 127.0.0.1:18765
```

Target Linux view:

```text
Linux: 127.0.0.1:18765
```

Current sidecar implementation status:

```text
not implemented yet
```

Temporary reverse-forward verification server used:

```powershell
python -m http.server 18765 --bind 127.0.0.1
```

---

# 10. Git acceptance environment

Final acceptance must be able to verify:

```text
working branch
commit
push
upstream
exact local HEAD
exact upstream HEAD
clean worktree
non-protected branch
```

Preferred acceptance remote:

```text
Linux local bare repository
```

Example:

```bash
git init --bare /tmp/d2c-acceptance-remote.git
```

- Git commit permitted:
  `yes`
- Git local push permitted:
  `yes`
- GitHub push required for acceptance:
  `no`
- Protected branches:
  `main, master`

---

# 11. Network availability

## Windows

```text
ChatGPT Web reachable: yes
GitHub reachable:      yes
Linux SSH reachable:   yes
```

## Linux

```text
GitHub reachable:                  yes
execution model endpoint reachable:<yes/no>
Secure MCP Tunnel reachable:       <yes/no>
```

Proxy/VPN notes:

```text
后台运行了代理程序
shijing+ 2813538  0.0  0.0 5289812 34992 ?       Sl   Aug26  49:34 sing-box run -c /home/shijingchang/SoftwareProfiles/sing-box/config_jp.json
通过source /home/shijingchang/set_proxy.sh可以设定走这个代理的http_proxy, https_proxy
```

---

# 12. Secrets policy

The following may exist in environment or secret storage, but their values MUST NOT be:

- printed
- logged
- pasted into ChatGPT
- committed
- written to documentation
- copied into test fixtures

Protected values include at least:

```text
CONTROL_PLANE_API_KEY
CONTROL_PLANE_TUNNEL_ID if considered sensitive in current deployment
C2C_EXECUTION_API_KEY
SSH private keys
bridge bearer tokens
sidecar auth tokens
OAuth tokens
cookies/session credentials
```

Tools may only check whether required variables/files are present and usable.

---

# 13. Human-intervention boundaries

The agent should continue autonomously except for:

```text
- ChatGPT login
- CAPTCHA
- 2FA
- missing real credentials
- sudo/server administration not already authorized
- irreversible external action
- product decision with multiple materially different outcomes
```

Do NOT ask for confirmation for:

```text
- code refactors
- unit tests
- integration tests
- temporary local test repos
- localhost ports
- temporary branches
- normal build/debug iterations
- ChatGPT architecture/review rounds
```

---

# 14. Acceptance classification

Every environment/test item must use exactly one status:

```text
VERIFIED
FAILED
NOT_RUN
EXTERNAL_ACCEPTANCE_BLOCKED
NOT_APPLICABLE
```

Never treat `NOT_RUN` as success.

---

# 15. Known verified facts before Goal starts

```text
[VERIFIED] sshd allowtcpforwarding=yes
[VERIFIED] sshd disableforwarding=no
[VERIFIED] sshd permitlisten=any
[VERIFIED] sshd permitopen=any
[VERIFIED] sshd gatewayports=no
[VERIFIED] Windows -> Linux SSH reverse forwarding works
[VERIFIED] Linux loopback request reaches Windows 127.0.0.1 service through ssh -R
```

Additional verified facts:

```text
<FILL_ME>
```

Known blockers:

```text
<FILL_ME or "none known">
```