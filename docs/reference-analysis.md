# Reference analysis: codex-with-chatgpt (C2C)

Study of the upstream community project [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)
— a Codex CLI + ChatGPT Web bridge — as it relates to our DeepSeek Harness port
`dsh-with-chatgpt`. Facts below come from the upstream `README.md`,
`docs/architecture.md`, `docs/protocol.md` and `docs/security.md`. Where a
detail could not be verified from those files, it is marked **unverified**.

## A. Reusable design ideas

- **"ChatGPT thinks, the harness works."** The bridge never re-implements a
  coding agent; the executor keeps all write, shell, build, test, git and push
  rights, and ChatGPT only plans and reviews. This is the load-bearing idea and
  it ports unchanged.
- **Strict control plane / data plane split.** The control plane is Computer Use
  with tiny `[C2C]` state messages; the data plane is a read-only MCP server the
  model pulls from itself. Never mix the two: control messages carry state,
  never content.
- **No pasting.** No file bodies, diffs or logs are ever typed into the
  composer. The model re-reads what it needs through the connector, which also
  keeps the browser interaction short and robust.
- **Envelope protocol with iteration ids.** `INIT → PLAN → EXECUTED → REVIEW →
  DONE`, with `BLOCKED`, `ERROR` and a `HANDOFF` continuation brief. Every
  message carries `TASK_ID` and `ITERATION`; a reply whose iteration is older
  than the state the executor waits on is rejected as stale.
- **Independent review.** After `EXECUTED`, ChatGPT inspects the real git diff
  and the recorded test results instead of trusting an "all tests passed"
  claim. Execution records exist precisely so review has evidence.
- **Boot prompt + trust order.** One boot prompt per conversation states the
  division of labour; upstream also publishes a trust order (connector code >
  HANDOFF > Project instructions > Project memory).
- **Read-only by construction, not by policy.** Write/delete/shell/commit tools
  simply do not exist on the server, so no prompt injection or scope bug can
  enable them.
- **Workspace as the security unit.** One bridge = one workspace = one token
  audience; containment uses canonical `realpath` (symlinks, `..`, absolute and
  backslash escapes, null bytes); sensitive files are denied by default with
  `.env.example` allowed and a project ignore file (`.c2cignore`) for user
  rules; output is capped by bytes and lines.
- **Secret hygiene.** Only a short-lived pairing code ever touches a browser;
  tokens are stored as SHA-256 hashes; logs redact token-shaped strings.

## B. Codex-specific, not directly reusable

- The `~/.codex/skills/codex-with-chatgpt/SKILL.md` install path, the
  "paste one paragraph to Codex" installer, and the `c2c sandbox-allow`
  allowlist for Codex on macOS/Windows.
- `c2c` CLI verbs tied to Codex's own settings directory and to Codex session
  checkpoint fields (`--clear-checkpoint`, `protocolState`, `waitingFor`).
- The Cloudflare Quick/Named tunnel flow with its `cloudflared` login,
  connector delete-and-recreate repair, and `C2C_TUNNEL_PROTOCOL=http2`.
- ChatGPT *Projects* (collections) as the durable per-workspace identity store,
  plus project-only memory and the "Organize by project" UI ritual.
- The Express loopback server, port 48765 preference with `/health` occupant
  detection, and the admin API with a random 0600 token file.
- Upstream's exact nine MCP tool names and their scope strings are a Codex-side
  contract we may rename, provided the read-only guarantee holds.

## C. Parts that must be redesigned DSH-natively

- **Conversation management.** Upstream's long-chat vs. project modes and
  HANDOFF-to-a-new-chat become a DSH-side binding table: workspace root →
  conversation id → last task id, persisted by the plugin, with recovery
  through a `chatgpt_reconnect` tool instead of deleting and recreating a
  ChatGPT connector.
- **State durability.** The Codex session checkpoint becomes durable DSH
  storage (`d2c_state` unit with `tasks`, `bindings` and `index` tables), so a
  full DSH restart resumes a task — verified in this project.
- **Pairing and OAuth.** A DSH port should expose setup through the plugin's
  own tools and CLI rather than an HTML authorization page driven by Computer
  Use; our OAuth 2.1 scaffold exists but the pairing/tunnel UX is deliberately
  narrower, since the bridge binds loopback and the public surface is optional.
- **CLI surface.** `c2c setup/status/doctor/pair/unpair/logs/stop` maps onto a
  `d2c` binary plus model-facing `chatgpt_status` / `chatgpt_reconnect` tools;
  the "ask the user for exactly one action" installer ritual belongs to the
  agent preset, not to the plugin.
- **Executor identity.** "Codex" is replaced by DSH + GLM-5.3-Flash, and the
  control-plane driver is DSH's browser-use stack rather than Codex's Computer
  Use.

## D. Standalone infrastructure that can be referenced/ported

- The MCP tool set itself: `workspace_info`, `list_directory`, `read_file`,
  `search_workspace`, `git_status`, `git_diff`, `test_status`,
  `execution_summary`, `execution_output` — a small, read-only, paginated
  surface behind a single path gate.
- Path containment, the sensitive-file deny list, the ignore-file layer, and
  the output/line/byte caps: almost pure functions, directly testable.
- Execution records (JSONL per iteration: changed files, test counts, exit
  status, optional sanitized command output) and the sanitizer that redacts
  tokens and home paths and refuses private-key blocks entirely.
- The envelope parser/serializer and the stale-iteration rejection rule, which
  tolerate prose around the envelope.
- Pairing-code generation (CSPRNG alphabet, TTL, attempt limit, one-time use)
  and token hashing.
- The test matrix itself: traversal, symlink escape, `.env` vs `.env.example`,
  ignore-file rules, redaction, and size caps.

## E. DSH integration that had to be redesigned

- **Tool registration.** Tools are registered through the DSH `tools` service
  (`ctx.get('tools').register`). Its output contract is *raw* JSON Schema —
  object-level `required` arrays, no author-DSL per-property markers — and
  every tool needs an `output.render` returning content blocks; execute results
  are schema-validated and frozen. Passing DSL-shaped schemas is a hard boot
  failure, which we hit and fixed.
- **Durable state.** `ctx.get('storageDomain').open(...)` yields typed tables
  (`d2c_state`: `tasks`, `bindings`, `index`); the caller owns the handle and
  closes it on dispose. Restart persistence was verified end-to-end in a
  headless profile.
- **Browser control.** DSH exposes browser-use MCP providers whose tools appear
  per-Session as `mcp__<name>__<tool>`. Neither the browser-use registry nor
  the provider declares a `dsh.bundle`, so both mount as plain plugin rows
  (`browserUse` plus the Experimental Browser Harness MCP provider), not as
  profile bundle layers.
- **Distribution.** The plugin is installed as a profile dependency
  (`dsh plugin --profile <name> add <pkg>`) whose `package.json` declares
  `dsh.bundle.patch`; that row enters the profile layer stack after
  `@deepseek-ai/dsh-base`, so a plain `dsh --profile <name>` boot loads it.
- **Protocol ownership.** DSH remains the executor; ChatGPT's only channels are
  the browser control plane and the loopback read-only bridge, so the
  read-only boundary is structural exactly as upstream intends.

Word count: 1037.
