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

## One-time setup

The runtime is unattended **after** account/app/tunnel setup. Login, 2FA/CAPTCHA, creating the ChatGPT custom app, and creating the Secure MCP Tunnel remain explicit user setup steps.

1. **Browser**: log into chatgpt.com in a dedicated Chrome/Edge profile that the DSH Browser Harness MCP provider can attach to.
2. **ChatGPT app**: create/enable one read-only custom MCP app named exactly `DSH with ChatGPT` (or set `chatgptAppName` to your chosen exact name). The app should expose only this plugin's ten read-only tools.
3. **Secure MCP Tunnel**: create a tunnel in OpenAI Platform, then provide its id and runtime key to the DSH process:

   ```powershell
   $env:CONTROL_PLANE_TUNNEL_ID="<tunnel_id>"
   $env:CONTROL_PLANE_API_KEY="<runtime_api_key>"
   ```

   Keep `tunnel-client` on `PATH`. In the default `managed` mode the plugin starts/restarts it automatically and injects the loopback Bearer header only on the final tunnel-client → localhost MCP hop.
4. **Verify once**: ask DSH to call `chatgpt_status`. Expect `tunnel.ready: true`, a stable `workspaceId`, the configured `chatgptAppName`, and `gitPolicy: commit-push`.

No per-round ChatGPT UI action is required after setup. The Browser Harness adapter activates the exact app with `@mention` before every INIT/REVIEW message and fails closed if the app cannot be selected.

## Usage

In a DSH session, inside the project you want to work on:

> 使用 ChatGPT 帮我规划并实现 <task>
> Use ChatGPT to implement <task>

With the bundled profile defaults, the agent runs the whole collaboration loop without pausing between rounds: `chatgpt_plan` → implementation/test → task-branch commit + push → `chatgpt_review` of the exact HEAD → fix PLAN if needed → repeat until DONE. Protected branches (`main`, `master`) are refused by the autonomous commit-push review gate. Regular development requests never enter the loop — the system-prompt section only activates on collaboration intent.

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

Working: protocol + restart recovery, workspace identity binding, execution evidence, read-only MCP bridge, managed Secure MCP Tunnel lifecycle, automatic per-message ChatGPT app activation, stale-reply fencing, exact-HEAD review integrity, current-session Browser Harness binding, and bounded autonomous PLAN→implement→commit/push→review loops.

Known limitations: one-time ChatGPT login/2FA/CAPTCHA, custom-app creation, and tunnel creation are not automated; the ChatGPT DOM adapter intentionally relies on semantic UI structure and may need maintenance when the Web UI changes; the plugin does not merge PRs or force-push, and it never gives ChatGPT write/shell capabilities.

## License

MIT. Adapted in part from [codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) (MIT) — see `THIRD_PARTY_NOTICES.md`.
