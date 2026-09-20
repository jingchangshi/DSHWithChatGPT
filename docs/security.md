# Security

## Read-only boundary (structural, not policy)

- The bridge tool registry has a fixed allowlist (`READONLY_VERBS`); registering any tool outside `workspace_* / list_* / read_* / search_* / git_* / test_* / execution_*` throws at startup. There is no write, shell, or git-mutation tool anywhere in the package.
- Every path-bearing tool call goes through `resolveContained` **before** touching the filesystem.

## Path containment

`src/workspace/boundary.ts`:

1. Reject null bytes, URL-scheme-like inputs (`file://`, `http://`); `workspace:/` prefixes are normalized.
2. Resolve to an absolute path, then **canonicalize the deepest existing ancestor** via `fs.realpathSync.native` and rejoin the unresolved suffix — symlinks are resolved even when the leaf does not exist yet (creation-after-check attacks fail).
3. Compare case-insensitively on win32/darwin against the canonical workspace root; anything equal to or under the root passes; else `PATH_OUTSIDE_WORKSPACE`.
4. Symlink escape, nested symlinks, `../`, absolute escapes, and inside-symlink chains are all unit-tested (`tests/workspace.spec.ts`).

## Sensitive files

Deny list with gitignore semantics (`SENSITIVE_PATTERNS`): `.env*` (but **not** `.env.example`), `*.pem/key/p12/pfx/jks`, `id_rsa/ed25519/ecdsa/dsa`, `.ssh/`, `.aws/`, `.gnupg/`, `.npmrc`, `.netrc`, `.git-credentials`, keychains, `.cloudflared/`, `credentials.*`, `service-account*.json`, `secrets.*`, `.dsh-credentials*`, cookies. Projects extend it additively with `.d2cignore` — **negation in `.d2cignore` cannot un-deny defaults** (two independent matchers).

## Execution records & secrets

- Every recorded command and output passes `redact()` (GitHub PATs, AWS keys, bearer tokens, `sk-`, `xox`, `AIza`, `npm_`, `api_key=/token=/password=` shapes).
- Any record containing private-key block markers is **rejected entirely** (never stored, never returned).
- Output tails capped at 16KiB / 200 lines with a truncation flag; the recorder lives in `%LOCALAPPDATA%\dsh-with-chatgpt` (outside every workspace).
- Environment values are never captured — only the sanitized command line.

## Bridge auth

- Binds `127.0.0.1` only. A public URL (e.g. a tunnel) is never authorization: every request needs a Bearer token from the token→workspace map; comparison is length-checked and constant-time-ish (no early content exit).
- Non-POST rejected; request bodies capped at 1MiB; `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- Tokens are random per bridge instance (32 bytes hex). Rotation/revoke = restart of the bridge (future: persisted pairing store with TTL).
- The ChatGPT connector stores the token in ChatGPT's connector settings — no long-lived credential is ever written to the workspace or the repo.

## Git review modes

- Workspace mode (default): working-tree diff vs HEAD, byte-capped.
- Committed mode: diff against an explicit ref (audited HEAD SHA).
- No automatic push to main/master, no force push, no reset — the plugin never runs git mutations at all (git tools are read-only; commits/pushes remain the agent's normal DSH tools, i.e. the user-visible agent action).

## Known gaps

- Loopback-only auth is bearer-token; full OAuth 2.1 + pairing (upstream C2C style) is scaffolded but not yet wired for the remote/tunnel path. Do not expose the bridge publicly until that lands.
- `.d2cignore` supports the documented pattern vocabulary (literals, `dir/`, `*`, `**`, `?`, negation last-wins); exotic gitignore spellings degrade to literal matching (documented behavior).
