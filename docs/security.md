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

## Bridge transport and auth

- The MCP server binds **only** to `127.0.0.1`; it is never a public listener.
- Default plugin mode uses an empty local token map because the supported ChatGPT path is **OpenAI Secure MCP Tunnel**: `tunnel-client` runs inside the same local trust boundary, reaches the loopback server, and authenticates the external tunnel/control plane to OpenAI.
- Direct local/test clients can still start the bridge with a non-empty Bearer token map. In that mode every request requires an exact token match.
- Non-POST requests are rejected; bodies are capped at 1 MiB; responses set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- The absence of a local Bearer in tunnel mode does **not** make the bridge remotely reachable: binding remains hard-coded to `127.0.0.1`. A user must not proxy/expose this port directly to the public internet.
## Git review modes

- Workspace mode (default): working-tree diff vs HEAD, byte-capped.
- Committed mode: diff against an explicit ref (audited HEAD SHA).
- No automatic push to main/master, no force push, no reset — the plugin never runs git mutations at all (git tools are read-only; commits/pushes remain the agent's normal DSH tools, i.e. the user-visible agent action).

## Known gaps

- Secure MCP Tunnel is the supported ChatGPT transport. Public/plugin distribution would need a stable public HTTPS endpoint and its own production authentication model; this repository does not provide that.
- `.d2cignore` supports the documented pattern vocabulary (literals, `dir/`, `*`, `**`, `?`, negation last-wins); exotic gitignore spellings degrade to literal matching (documented behavior).
