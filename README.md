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

1. **Browser**: log into chatgpt.com in a Chrome/Edge that DSH BrowserUse can attach to (the browser-harness MCP flow prompts you for the dedicated debugging Chrome on first use).
2. **Connector** (once per ChatGPT account): in ChatGPT Web → Settings → Connectors → add a custom MCP connector pointing at the bridge URL the plugin prints (loopback, or tunneled when remote review is needed). Paste the one-time pairing token when prompted.
3. **Verify**: run the `chatgpt_status` tool from any DSH session in the workspace — it reports coordinator state, bridge port, and the latest task.

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

Run `chatgpt_status`; it reports the latest persisted task and whether the local bridge is running. It does not check browser login or remote connector reachability. See `docs/troubleshooting.md` for the failure table.

## Docs

- `docs/architecture.md` — control/data plane split, module map
- `docs/protocol.md` — the [D2C] envelope spec
- `docs/security.md` — containment, deny list, auth, secrets
- `docs/installation.md` — detailed install + manual path
- `docs/browser-use.md` — browser session & recovery model
- `docs/troubleshooting.md`
- `docs/development.md` — building, testing, layout

## Status & limitations

Working: protocol + state machine, workspace security boundary, execution recorder, read-only local MCP bridge, coordinator with durable state, model tools, prompt section, profile install path. The coordinator restores unfinished tasks after a restart, captures new ChatGPT conversation IDs, and resumes an outstanding review without resending its execution message. Foreground DSH `bash` and `pwsh` results are recorded for the active task, with separate records per workspace. See `docs/` and the git log for evidence.

Known limitations: the BrowserHarness chatgpt.com adapter is a first cut (composer/reply heuristics may need adjustment as ChatGPT's DOM changes); the plugin's MCP bridge is loopback-only and accepts bearer tokens, while ChatGPT's custom connector needs a reachable OAuth connection, so the documented first-run connector setup is not yet functional; no CLI beyond the DSH tool surface yet. A full ChatGPT PLAN → DSH execution → ChatGPT review round has not been verified.

## License

MIT. Adapted in part from [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) (MIT) — see `THIRD_PARTY_NOTICES.md`.
