# DSH integration notes (verified against this checkout)

All statements below were read from `D:\workspace\deepseek-harness` source and, where marked **[runtime-verified]**, confirmed against the live Cordis runtime via the session's Inspect providers. This file is the ground truth for the plugin implementation.

## 1. Plugin form (packages/AGENTS.md, cookbook/adding-a-package.md)

- Function plugin: named exports `name`, `inject`, `Config` (schemastery `z` object), `apply(ctx, config)`; **no default export** (a default export makes the Loader discard the namespace — postmortem 0001).
- Service class plugin: `class X extends Service` (or `TypertRemoteService` for remote-capable), `static inject`, `static Config`, default export.
- Optional services: `ctx.get('x')` with undefined check; `inject: ['x']` only for hard dependencies. Undeclared `ctx.x` property access is rejected.
- **Registrations are effects**: `ctx.tools.register` / `ctx.systemPrompt.section` / `ctx.on` / `ctx.effect` all return disposers; disposal unregisters. HMR-safety test must prove dispose ⇒ removal.
- Package invariants: `private: true`, version matches root, `type: module`, `main: lib/index.js`, `exports["."]` types+default, `@deepseek-ai/cordis` in both peer+devDeps, schemastery in `dependencies`, `files` limited to `lib/index.js` + `lib/types/**/*.d.ts`, `.ts` specifiers for in-package relative imports, tests under `tests/`.

## 2. Tools (packages/core/tools/src, cookbook/adding-a-tool.md) **[runtime-verified: tools registry + `tools/execute` waterfall exist with these signatures]**

```ts
ctx.tools.register(defineTool({
  name: 'chatgpt_plan',                      // snake_case model-facing name
  description: '…',                          // what the model sees
  parameters: { plan: { type: 'string', required: true, description: '…' } },
  output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
  async execute(args, exec) { … },           // args typed/validated; exec.signal, exec.agent
}))
```

- `exec.agent?: Agent` — the session that made the call; `exec.agent.session.header.cwd` is the session workspace.
- Execution pipeline extension points: `tools/pre-execute` (allow/deny/ask decision), `tools/execute` (around-dispatch; **may replace `exec.signal`** — this is the recorder hook), `tools/post-execute`, `tools/result` (frozen immutable outcome, emit mode).
- Waterfall listeners must call and return `next()`.
- Raw JSON-Schema definitions are also accepted (that's how MCP tools register).

## 3. System prompt (packages/core/system-prompt/src/index.ts) **[runtime-verified: `section`, `getSectionOrder`, order constants exist]**

```ts
ctx.systemPrompt.section({ name: 'chatgpt-collaboration', order: ctx.systemPrompt.getSectionOrder('TOOL_WORKFLOW'), text: '…' })
```

- Sections concatenate by ascending `order`; names unique; `{{var}}` interpolation strict (unknown variable throws) — keep text literal or register variables via `ctx.systemPrompt.variable(name, provider)`.
- Runtime dynamic context: `ctx.systemPrompt.context({ name, order, text })` renders into the "Current runtime context" snapshot.

## 4. Agent & session (packages/core/agent, agent-loop)

- `ctx.agents`: `get(id)`, `list()`, `currentInitiator()`, `requireInitiator()`, `withInitiator(agent, op)`, `create/resume` returning `AgentHandle` (dispose = stop+drain).
- `Agent`: `id: SessionId`, `session` (durable log; `session.append(type, data)`, `session.header.cwd`), driver methods `followup(message)` / `steer(message)` / `inject(message)` (typed `UserMessage` via `@deepseek-ai/dsh-llm` `createUserMessage`), `status`.
- Events: `agent/created` (serial, awaited during creation — browser/provider init happens here), `agent/status`, `agent/assistant-stream`, `agent/disposed`, `session/event` (post-commit feed), `tools/change`.

## 5. BrowserUse **[runtime-verified: `browserUse.register(name)` is the sole registration seam]**

- `ctx.browserUse.register(BrowserUseProviderName('…'))` — one provider per process; second registration fails.
- Providers are built on `@deepseek-ai/dsh-experimental-browser-use-runtime` `mountSessionMcp(ctx, { name, exclusive, command, args, env, toolCallTimeoutMs })` which:
  - registers the provider slot,
  - on each `agent/created` opens a per-Session MCP stdio client (e.g. `browser-harness-mcp`),
  - registers its upstream tools as `mcp__<name>__<tool>` on `ctx.tools`,
  - gates every browser-tool dispatch in `tools/execute` to the exact owning Session (`exec.agent` must match; others throw "browser tool belongs to another Session").
- **Consequence for us:** the coordinator drives ChatGPT Web by calling the browser MCP tools through `ctx.tools.execute({ name: 'mcp__browser-harness__browser_fill', arguments, agent, signal })` with the agent that owns the browser session. No private browser API is used.
- Browser Harness setup facts (from the provider README + Agent Note 2026-09-17): attach over CDP to a **dedicated Chrome instance** started with `--remote-debugging-port` **and** `--user-data-dir`; `BU_CDP_URL` must be set explicitly for a non-default profile; known upstream stall on `browser_screenshot` (retry); `browser_fill`/`browser_upload_file` take CSS selectors, `browser_click` takes x/y, `browser_js` evaluates JS — DOM-first operations via `browser_js` + semantic queries are our control surface.

## 6. Storage (packages/storage) **[runtime-verified: `storage` hub + `storageDomain.open(spec)` mounted in base profile]**

```ts
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
const domain = await ctx.storageDomain.open(defineDomain({
  name: 'chatgpt_bridge',   // must match UNIT_NAME_RE /^[a-z][a-z0-9_]*$/
  version: 1,
  tables: { sessions: domainTable(sessionRecordSchema) },
}))
await domain.table('sessions').put(key, value)   // durable, write-chained, emits domain/changed
```

- Backend `json` rooted at `dshHomePath('storages')` in the base profile — state lands under `$DSH_HOME/storages`, never in the user's repo. Record schemas are zod; misconfiguration fails loud at load.

## 7. Jobs (optional, for long waits)

- `ctx.get('jobs')` → `start({ kind, label, owner, run })`, `read`, `wait(id, timeoutMs)` — used for the browser reply-wait so a model-facing tool can return a job handle instead of blocking.

## 8. Profiles & install (apps/cli/src/plugin.ts, packages/boot/app-boot/src/profile.ts)

- Profile = directory under `$DSH_HOME/profiles/<name>` with `package.json` (manifest with `dsh.profile.bundles`) + user layer `cordis.patch.yml`.
- `dsh plugin --profile <name> add <package-spec>` → runs pnpm inside the profile dir, then reconciles: any installed dependency whose package.json declares `dsh.bundle.patch` joins the layer stack; removed ones leave.
- Bundle = a package with `dsh: { bundle: { patch: "./cordis.patch.yml" } }`; the patch is an overlay of entries (`- insert:` to add rows, `- id:` to override config of earlier layers' rows; a patch replaces the targeted row's whole `config`).
- Plain (non-bundle) plugin packages can be added as profile dependencies and mounted by naming them in a patch row (`- name: '<pkg>'`) — that is how our plugin will mount when installed standalone.
- Row-plane rule: a row that publishes a service must sit on the host plane (or behind an isolate realm in a preset). Our service-providing rows are host-plane. Model-facing tools registered by a host row appear to all sessions of that profile (same as base TUI); acceptable for v1, documented.

## 9. Models / GLM-5.3-Flash

- Base default: `agent-default-model` row `provider: deepseek-official, model: deepseek-flash`.
- The `llm-pi-ai` adapter row is mounted dormant in base and activates provider profiles from the user's `settings.yaml` (`llm-pi-ai:` section, managed by the web Models page); credentials resolve per request through `apiKeyEnv` references via `ctx.credentials` (`$DSH_HOME/.credentials.yaml`).
- GLM-5.3-Flash therefore rides the existing provider-profile mechanism (an OpenAI-compatible `llm-pi-ai` profile pointing at the GLM endpoint). No code in our plugin references a model id or key; verification during E2E confirms a profile selection where the session model is GLM-5.3-Flash. **[partially verified — final E2E confirms]**

## 10. What we deliberately do NOT touch

- No changes to `agent-loop`, `dsh core` packages, or DSH source. If a hard blocker appears, a minimal upstream patch is proposed separately (none found so far).
- No second browser-automation framework: ChatGPT Web is driven through the registered BrowserUse provider's MCP tools.
- No private ChatGPT API calls: official Web UI only, via DOM.

## 11. Live-runtime capability map (Inspect, this session)

- Host services available to a dynamic plugin include: `tools`, `systemPrompt`, `agents`, `browserUse`, `storage`/`storageDomain`, `jobs`, `timer`, `fs`, `shell`, `web`, `settings`, `credentials`, `webServer` (`register(route)` — the local bridge can serve MCP over the existing webserver carrier when present, or bind its own loopback listener when not).
- Host builtins for dynamic halves: `ctx`, `harness` (`handle`, `defineTool`, `registerTool`), `console`, `btoa/atob`, `TextEncoder/TextDecoder`.
- Relevant events: `agent/created` (serial), `tools/execute` (waterfall), `tools/result` (emit), `session/event`, `system-prompt/assemble` (waterfall), `tools/change`.

## 12. Bridge hosting decision

The C2C-style bridge (OAuth + streamable-HTTP MCP) binds its own `node:http` server on `127.0.0.1` with an ephemeral port by default. Mounting it inside the DSH `webServer` carrier would tie it to the Web GUI deployment; a standalone loopback listener works in every profile (TUI, headless, web) and keeps the C2C security posture (loopback-only, admin-guard). Decision: **own loopback listener inside the plugin process**, with `webServer` left unused for now.
