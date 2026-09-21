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

Prereqs: Node.js ≥ 20, pnpm, a DSH checkout or installed DSH with profile support, and a BrowserUse/Browser Harness MCP provider available in the target DSH profile. This repository carries matching 0.1.6-alpha.1 provider tarballs under `package/tarballs/` for local installation when your profile does not already provide them.

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

1. **Browser**: log into chatgpt.com in a Chrome/Edge that the DSH Browser Harness MCP provider can attach to.
2. **Start the read-only bridge**: ask DSH to run `chatgpt_status`. Status now starts the workspace bridge lazily and returns `bridgePort` plus `connectorConfigPath`. The referenced local JSON file contains the loopback URL and bearer token; the token is intentionally not returned to the model.
3. **Expose the local bridge safely**: ChatGPT cannot connect directly to a localhost MCP server. Use OpenAI Secure MCP Tunnel (preferred) or another trusted authenticated remote MCP endpoint that forwards to the loopback URL in the connector config.
4. **Create/enable the ChatGPT custom app**: in ChatGPT Web developer/app settings, configure the remote MCP endpoint and authentication, scan the ten read-only tools, and keep the app read-only.
5. **Browser control**: keep the logged-in ChatGPT tab available to Browser Harness. The plugin reuses one conversation per workspace and persists its `/c/<conversation-id>` after the first reply.

> Current platform caveat: ChatGPT custom-app selection is message-scoped. If your ChatGPT workspace requires explicitly selecting or @mentioning the custom app for each message, that UI selection is still a manual prerequisite for MCP-backed PLAN/REVIEW rounds; this PR does not pretend that a loopback bridge alone makes the app ambient.

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

Run `chatgpt_status` first. It proves the plugin is loaded, starts the local bridge, and reports the connector-config path and latest task. Browser/login health is then exercised by `chatgpt_plan` / `chatgpt_reconnect`. See `docs/troubleshooting.md` for the failure table.

## Docs

- `docs/architecture.md` — control/data plane split, module map
- `docs/protocol.md` — the [D2C] envelope spec
- `docs/security.md` — containment, deny list, auth, secrets
- `docs/installation.md` — detailed install + manual path
- `docs/browser-use.md` — browser session & recovery model
- `docs/troubleshooting.md`
- `docs/development.md` — building, testing, layout

## Status & limitations

Working: protocol + restart-rehydratable state machine, workspace security boundary, execution recorder wired to real DSH bash/pwsh outcomes, loopback read-only MCP bridge, durable coordinator, model tools, prompt section, and a Browser Harness adapter using the upstream MCP tool contract. CI verifies typecheck + unit tests + build.

Known limitations: ChatGPT cannot consume the loopback bridge directly, so a Secure MCP Tunnel/remote MCP endpoint must still be configured outside this package; custom-app selection may be message-scoped in ChatGPT Web and is not yet automated by the Browser Harness adapter; the ChatGPT DOM adapter remains heuristic and may need updates as the Web UI changes; there is intentionally no standalone `d2c` CLI yet.

## License

MIT. Adapted in part from [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) (MIT) — see `THIRD_PARTY_NOTICES.md`.
