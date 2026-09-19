# Reference analysis: codex-with-chatgpt (C2C)

Study basis: full upstream source snapshot (MIT, v0.1.3, commit tree `9663b88…`) fetched into `cwc-research/`, plus its docs and 730-line skill. Every claim below was read from source, not inferred from the README alone.

## What C2C actually is

The upstream is **not** an orchestrator. `src/` contains no loop, no protocol parser, and no browser automation. The architecture is two clean pieces plus one prompt:

1. **Data plane (the real engineering):** a loopback-only Express bridge exposing 9 read-only MCP tools over stateless Streamable HTTP, protected by OAuth 2.1 (PKCE S256, DCR, rotating refresh tokens, hashes at rest) plus a one-time 8-char pairing code, published to ChatGPT through a Cloudflare Quick Tunnel. ChatGPT (developer-mode custom connector) **pulls** workspace data; nothing pushes.
2. **Control plane (zero code):** the agent itself types tiny `[C2C]` state envelopes (`[C2C]\nSTATE: INIT\nTASK_ID: …\nITERATION: 0\n\nGOAL:…`) into ChatGPT's web UI through Codex's built-in in-app browser, guided entirely by `skill/SKILL.md` promptware.
3. **State:** local JSON files under an OS state dir (`%LOCALAPPDATA%\codex-with-chatgpt`): session checkpoint, execution JSONL records, sanitized execution outputs, tunnel/token state — never inside the user's repo.

Stale-response protection is procedural (iteration ids in envelopes + the Skill checks each reply against the expected waiting state), not a code validator. That is C2C's weakest structural point and where our design should improve.

## A. Design ideas directly reusable

| Idea | C2C evidence | Why it holds for DSH |
|---|---|---|
| Control/data plane split; envelopes stay < 1 KB; no diffs/logs/file bodies through the browser | docs/architecture.md, protocol.md | Independent of Codex; prevents the browser channel from becoming a data bus |
| ChatGPT pulls via read-only MCP instead of being pushed content | 9 tools, all `readOnlyHint: true` | Same goal: independent review with GLM never pasting diffs |
| Canonical realpath-of-deepest-existing-ancestor containment + case-normalized compare on Windows/macOS + symlink coverage | `src/workspace/manager.ts` (code captured in report) | The correct algorithm for not-yet-existing leaf segments; testable as pure functions |
| Structural read-only guarantee: write/exec tools "do not exist on the server" | docs/security.md | Stronger than policy; keep it in DSH too |
| Sensitive deny-list as gitignore-semantics patterns enforced at resolve time, plus a project-local additive ignore file (`.c2cignore` can only deny more) | `src/workspace/ignore.ts` | Right layering; we rename the file `.d2cignore` |
| git diff fail-closed batching: inventory first, `:(literal)` pathspec batches ≤50 paths/≤32 KiB argv, any batch error ⇒ empty result, aggregate cap | `src/workspace/git.ts` | Prevents silent partial diffs and argv overflow on Windows |
| Execution records JSONL + opt-in sanitized output with hard private-key rejection and token-shaped redaction | `src/execution/*` | Review must not trust "tests passed" prose |
| OAuth 2.1 + pairing-code flow, tokens hashed at rest, refresh rotation, revoke-all | `src/auth/*`, `src/pairing/*` | Public URL ≠ authorization; required for any tunnel |
| Loopback-only bind; admin API guarded by loopback + random token + proxy-header rejection returning 404 | `src/bridge/server.ts` | Good pattern for a local bridge admin surface |
| Tunnel health = poll public /health until the payload names this bridge | `src/tunnel/cloudflared.ts` | Prevents "tunnel up, wrong service" false readiness |
| State under an OS state dir with 0600/0700, never in the user's repo | `config/paths.ts` | Matches our requirement to not pollute repos |
| Boot prompt with numbered rules; connector/workspace binding | docs/protocol.md §Boot Prompt | Directly adaptable with DSH naming |

## B. Codex-specific — must NOT be copied

- `skill/SKILL.md` as the whole loop and browser driver: it assumes Codex's built-in in-app browser API (`agent.browsers.get("iab")`, `tab.markHandoff()`), `~/.codex/skills`, and trust-order rules tied to Codex's memory. DSH's executor is GLM via the normal agent loop and DSH BrowserUse; a skill document may *guide* GLM but cannot be the only loop.
- `config/sandbox-allow.ts` editing `~/.codex/config.toml` writable_roots — Codex concept.
- The `c2c record` hidden CLI as the only way execution records get written: in C2C the agent must remember to call it after every iteration. DSH can observe real tool executions through the `tools/execute`/`tools/result` pipeline instead.
- One-paste installer assumptions (brew/winget, `~/.codex`), update-check via git pull.
- Codex conversation model (in-app browser tab discipline, `markHandoff`).

## C. Adapt to DSH-native

- **The loop:** C2C's loop lives in promptware. Ours must be a real service (`chatgptCoordinator`) + model-facing tools, with the state machine enforced in code (typed states, stale-iteration rejection) rather than Skill discipline.
- **Protocol parsing:** C2C never parses `[C2C]` replies. We will implement a real parser + validator (versioned envelopes, task/iteration ids, `in-reply-to`), with tests.
- **Browser control:** C2C uses Codex IAB. We must drive ChatGPT Web through DSH's browser-use provider (Browser Harness MCP attaching to the user's Chrome). The C2C DOM discipline (poll cheap DOM checks every 20–30 s, never resend on timeout, single tab, logged-out detection, composer detection) carries over as adapter behavior.
- **Execution records:** C2C relies on the agent self-reporting. We hook the real tool pipeline: shell/bash/pwsh tool results are recorded automatically with exit status and output metadata.
- **Conversation state:** same concept (per-workspace conversation URL/connector/task/iteration persisted outside the repo) but stored via DSH storage-domain or the plugin state dir, keyed by canonical workspace id.
- **CLI:** C2C is a standalone npm CLI; we expose setup/status/doctor as a model tool + skill + CLI entry inside the plugin package, and honor DSH's `dsh plugin --profile add` install path.

## D. Infrastructure portable with attribution

- Path containment algorithm (`canonicalize`/`contains`) — reimplement in TS for our package, provenance-noted.
- Sensitive pattern list + noise list — adapt names, keep `.env.example` exception.
- git batching approach — reimplement against DSH's shell service.
- Sanitizer pattern lists (token shapes, home-path redaction, private-key blocks) — adapt.
- OAuth/pairing state machine shapes (PKCE S256-only, 5-min code TTL, 5 attempts, one active pairing session, rotation) — reimplement; C2C's Express-based server itself will NOT be reused because our bridge targets Node's `node:http` inside the DSH host process and streamable-HTTP MCP can be served directly.
- Boot prompt text — adapt to DSH naming.

## E. Redesigned DSH integration

| Concern | C2C | DSH with ChatGPT |
|---|---|---|
| Plugin form | standalone CLI + skill file | real Cordis plugin package (`@deepseek-ai/dsh-with-chatgpt` style, installed via `dsh plugin --profile <name> add <package>`), plus optional CLI bin |
| Loop owner | Codex promptware | `chatgptCoordinator` service + 4 model tools; default agent-loop untouched |
| Prompt | SKILL.md + project instructions | `ctx.systemPrompt.section()` registered rules (concise) + boot prompt text owned by the coordinator |
| Browser | Codex IAB | DSH BrowserUse: one persistent Browser Harness session; provider attach; adapter interface `BrowserControl` |
| Execution evidence | agent-run `c2c record` | automatic recorder on `tools/result` for shell-class tools + explicit `record` API for build/test commands |
| Data plane process | separate daemon + tunnel | bridge service inside DSH host process (loopback bind) + Cloudflare quick tunnel child process |
| Tests | vitest upstream | our own vitest suites (parser, state machine, containment, deny-list, MCP tools, recorder, adapter-mocked, reload-safety) |

## Consequence for our protocol

C2C's envelope shape is proven minimal and worth keeping: `[D2C]` + `STATE/TASK_ID/ITERATION` headers + small sections. We add what C2C lacked: a strict parser, `PROTOCOL_VERSION`, `IN_REPLY_TO` echo, and machine rejection of stale/mismatched replies in the coordinator (not in a skill).

## Honest gaps in upstream (verified absent)

No orchestrator module, no protocol parser, no stale-response validator, no browser code, no SSE transport, no ngrok (Cloudflare only), no write/exec/commit tools anywhere. The "independent review" is real but its state consistency is entirely behavioral.
