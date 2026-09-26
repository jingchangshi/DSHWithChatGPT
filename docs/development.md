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
  scripts/              isolated packed-package verification
  tarballs/             producer-built DSH development artifacts
docs/                   architecture, protocol, security, ...
```

## Commands

Use the package's pinned pnpm 10.34.5, also selected by CI. If the global launcher cannot select that version, invoke `npx --yes pnpm@10.34.5` in place of `pnpm`. Packed-package verification installs with strict peer dependencies; incompatible peers fail the check rather than being treated as successful imports.

```powershell
cd package
pnpm install
pnpm build          # tsc -> lib/
pnpm test           # vitest run (all suites)
pnpm typecheck      # tsc --noEmit
pnpm test:package   # pack, isolated install, and runtime import (after build)
pnpm test:profile <DSH-source-root> <isolated-installation-from-test:package>
```

## Style constraints learned the hard way

- This codebase is parsed by oxc/vite-family tooling: no trailing backslash in single-quoted strings, no template literals with `${}` in thrown messages (use `+` concat), no backticks anywhere in comments, no `*/` inside block comments.
- Test ids must match `d2c_[0-9a-z]{4,32}`.
- NodeNext ESM: relative imports carry the `.ts` extension in source (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`); builds rewrite to `.js`.

## Test conventions

- Integration tests use real HTTP against an ephemeral bridge port and a real temp git repo (with `.env`, `.env.example`, `server.key`, `node_modules` fixtures).
- Browser tests use a fake `BrowserControl` — no network.
- Coordinator tests drive the real state machine with scripted replies.

`test:profile` launches the supported DSH CLI twice in a disposable Windows/POSIX profile, using the packed plugin installation and real agents, tool dispatch, storage, and execution identity services. Each invocation writes an exclusive report with its own random run ID and process ID. It checks status, alias/restart identity, plugin unload/reload, closure of every prior bridge listener, separate workspace bridges, doctor JSON output, and rejection of PLAN/REVIEW before browser dispatch when no content lease is available. It makes no model requests and does not mount a browser provider or a real tunnel; this is an identity/lifecycle smoke, not real C2C acceptance. Evidence and the isolated state directory remain in the printed temporary location.

## Releasing

The execution-world and storage-domain development dependencies use producer-generated 0.1.6-alpha.2 tarballs. Both are explicit runtime peers. No dependency requires a sibling checkout. The package check copies the plugin and peer artifacts into a fresh OS temporary directory, installs them there, and verifies that their resolved entrypoints remain inside that installation. It does not verify profile activation, browser authentication, or workspace content access. The temporary directory is retained and printed for inspection.

`pnpm pack` from `package/` produces the installable tarball; the `dsh.bundle.patch` field in package.json points the DSH plugin manager at `cordis.patch.yml`.
