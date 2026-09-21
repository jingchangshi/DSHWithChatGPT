# dsh-with-chatgpt

**ChatGPT thinks. DeepSeek Harness works.**

A DeepSeek Harness plugin that pairs your DSH coding agent (GLM-5.3-Flash) with ChatGPT Web as an independent planning and review brain — over the official ChatGPT Web UI you already use in your browser. No ChatGPT API key, no private-API reverse engineering.

## What is this?

You keep working in DeepSeek Harness exactly as before. When a task deserves a second brain, the agent starts a **collaboration round**:

```
USER TASK
  → DSH/GLM sends INIT to ChatGPT Web (browser control plane)
  → ChatGPT reads your workspace ITSELF via a read-only MCP connector (data plane)
  → ChatGPT replies with a structured [D2C] PLAN envelope
  → DSH/GLM implements, builds, tests (all execution stays local)
  → DSH/GLM sends EXECUTED (machine summary, tiny)
  → ChatGPT independently verifies via git_diff + test_status MCP tools
  → ChatGPT replies DONE or PLAN (fix request)
  → repeat until DONE
```

## Why not just call the ChatGPT API?

- **Your existing ChatGPT account, models and subscription.** The control plane is the official Web UI driven through DSH BrowserUse — no API billing, no key management.
- **Independent review needs file access, not prompts.** ChatGPT must read the real diff and the real test records itself. Uploading diffs through the composer is slow, lossy, and unreviewable. The plugin gives ChatGPT a **read-only MCP data plane** instead.
- **Trust boundary by construction.** The bridge server structurally has no write/execute capability — there is no tool to register one.

## Why does ChatGPT have no write access?

Because it doesn't need it, and independence requires containment:

- The MCP bridge exposes exactly ten read-only tools (workspace_info, list_directory, read_file, search_workspace, git_status, git_diff, git_log, test_status, execution_summary, execution_output). The tool registry **rejects any name outside the read-only allowlist at registration time**.
- All path access goes through canonical realpath containment (symlink-escape tested) plus a sensitive-file deny list (.env, keys, credentials...) and a project-level `.d2cignore`.
- Execution is verified, not narrated: ChatGPT reads structured execution records (exit codes, classified test runs), never "trust me, tests pass".

## Division of labor

| | ChatGPT Web | DSH / GLM-5.3-Flash |
|---|---|---|
| Architecture reasoning, planning | ✅ | |
| Independent code review | ✅ | |
| Debugging strategy | ✅ | |
| File edits, shell, build, tests | | ✅ |
| git commit / push | | ✅ |
| Recovery, implementation | | ✅ |

## Install

Prereqs: Node.js ≥ 20, pnpm, a DSH checkout or installed DSH with profile support.

```powershell
# 1. Build the plugin package
git clone https://github.com/jingchangshi/DSHWithChatGPT.git
cd DSHWithChatGPT\package
pnpm install
pnpm build && pnpm test

# 2. Add it to a DSH profile (registers the cordis.patch.yml row)
dsh plugin --profile <your-profile> add D:\workspace\DSHWithChatGPT\package

# 3. Restart DSH (or reload the profile) — the plugin loads with the profile
```

Manual install: copy the package anywhere permanent and append its `cordis.patch.yml` row (`id: dsh-with-chatgpt, name: dsh-with-chatgpt`) to your profile's `cordis.patch.yml`.

## First-time setup

1. **Browser control plane**: make sure the active DSH profile already has working BrowserUse / Browser Harness MCP and controls a Chrome/Edge session logged into chatgpt.com.
2. **Bootstrap the local read-only bridge**: call `chatgpt_status` in the target workspace. This starts the bridge before the first plan; the default URL is `http://127.0.0.1:43127/mcp`.
3. **Secure MCP Tunnel**: ChatGPT cannot directly reach a loopback MCP server. Create an OpenAI tunnel and run the official `tunnel-client`:

```powershell
$env:CONTROL_PLANE_API_KEY="<OpenAI Platform runtime key>"
tunnel-client init --profile dsh-with-chatgpt --tunnel-id <tunnel_id> --mcp-server-url http://127.0.0.1:43127/mcp
tunnel-client doctor --profile dsh-with-chatgpt --explain
tunnel-client run --profile dsh-with-chatgpt
```

4. **ChatGPT developer-mode app**: create an app in ChatGPT, choose **Tunnel** as the connection, select the tunnel, and verify that the read-only workspace tools are discoverable.

The bridge listens only on `127.0.0.1`; Secure MCP Tunnel supplies the external transport/authentication boundary. Do not configure ChatGPT with `127.0.0.1` as a remote MCP URL.
## Usage

In a DSH session, inside the project you want to work on:

> 使用 ChatGPT 帮我规划并实现 <task>
> Use ChatGPT to implement <task>

The agent will start a collaboration round (`chatgpt_plan`), execute the plan with its normal tools, then request independent review (`chatgpt_review`). Regular development requests never enter the loop — the system-prompt section only activates on collaboration intent.

Useful tools:

| Tool | Purpose |
|---|---|
| `chatgpt_plan` | Send a goal, get ChatGPT's structured plan |
| `chatgpt_review` | Report execution, get independent review (DONE / fix PLAN) |
| `chatgpt_status` | Coordinator + bridge status, latest task |
| `chatgpt_reconnect` | Recover after browser reload / DSH restart |

## Uninstall

```powershell
dsh plugin --profile <your-profile> remove dsh-with-chatgpt
```

Task state lives in the DSH storage area (`d2c_state` domain) and `%LOCALAPPDATA%\dsh-with-chatgpt` — delete the latter to drop execution records.

## Doctor / troubleshooting

Run `chatgpt_status`; its output distinguishes: plugin loaded, browser reachable, ChatGPT logged in, bridge running, MCP reachable, conversation bound. See `docs/troubleshooting.md` for the failure table.

## Docs

- `docs/architecture.md` — control/data plane split, module map
- `docs/protocol.md` — the [D2C] envelope spec
- `docs/security.md` — containment, deny list, auth, secrets
- `docs/installation.md` — detailed install + manual path
- `docs/browser-use.md` — browser session & recovery model
- `docs/troubleshooting.md`
- `docs/development.md` — building, testing, layout

## Status & limitations

Working: protocol + state machine, workspace security boundary, execution recorder, read-only MCP bridge, coordinator with durable state, model tools, prompt section, profile install path. See `docs/` and the git log for evidence.

Known limitations: the BrowserHarness adapter still depends on stable ChatGPT DOM semantics; one stable `bridgePort` is assumed per DSH instance, so simultaneous independent workspace tunnels should use distinct ports; automatic execution evidence currently covers foreground `bash` / `pwsh` only and never treats a background job start as a completed test; Secure MCP Tunnel and ChatGPT developer-mode permissions are required for the data plane.

## License

MIT. Adapted in part from [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) (MIT) — see `THIRD_PARTY_NOTICES.md`.
