# Development

## Layout

```
package/
  src/
    index.ts            Cordis apply(): service, tools, prompt, bridge, storage
    protocol/           [D2C] envelope + state machine
    orchestrator/       coordinator, persisted state contracts
    browser/            BrowserControl abstraction + guards
    workspace/          boundary (containment/sensitive), git snapshots
    execution/          recorder (JSONL, redaction)
    bridge/             loopback MCP server + read-only tools
  tests/                vitest suites (protocol, workspace, git, bridge, execution, browser, coordinator)
  cordis.patch.yml      profile patch row
  tarballs/             vendored @deepseek-ai/dsh-storage-domain (dev typecheck)
docs/                   architecture, protocol, security, ...
```

## Commands

```powershell
cd package
pnpm install
pnpm build          # tsc -> lib/
pnpm test           # vitest run (all suites)
pnpm typecheck      # tsc --noEmit
```

## Style constraints learned the hard way

- This codebase is parsed by oxc/vite-family tooling: no trailing backslash in single-quoted strings, no template literals with `${}` in thrown messages (use `+` concat), no backticks anywhere in comments, no `*/` inside block comments.
- Test ids must match `d2c_[0-9a-z]{4,32}`.
- NodeNext ESM: relative imports carry the `.ts` extension in source (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`); builds rewrite to `.js`.

## Test conventions

- Integration tests use real HTTP against an ephemeral bridge port and a real temp git repo (with `.env`, `.env.example`, `server.key`, `node_modules` fixtures).
- Browser tests use a fake `BrowserControl` — no network.
- Coordinator tests drive the real state machine with scripted replies.

## Releasing

`pnpm pack` from `package/` produces the installable tarball; the `dsh.bundle.patch` field in package.json points the DSH plugin manager at `cordis.patch.yml`.
