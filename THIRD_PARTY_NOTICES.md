# THIRD_PARTY_NOTICES

This project borrows design ideas and, where noted, adapted infrastructure from:

## codex-with-chatgpt

- Source: https://github.com/XiaoDuoYa/codex-with-chatgpt
- License: MIT
- Used: the control-plane/data-plane separation concept, the `[C2C]` envelope
  shape (re-implemented here as `[D2C]` with stricter machine validation),
  boot-prompt role separation, execution-record review philosophy, and the
  `.d2cignore` additive-ignore semantics.
- Not used: Codex CLI integration, its Node MCP SDK server, its OAuth/pairing
  implementation (replaced by a loopback bearer-token bridge in this plugin),
  and any Codex-specific branding or protocol strings.

All borrowed code paths were re-implemented against DeepSeek Harness (Cordis)
APIs; nothing was copied wholesale. The envelope parser, state machine,
workspace boundary, git snapshot layer, recorder, and bridge in
`package/src/` are original to this repository.

## DeepSeek Harness

- Source: https://github.com/deepseek-ai/deepseek-harness
- This is a plugin for that host; it links `@deepseek-ai/cordis` and the
  `@deepseek-ai/dsh-storage-domain` type surface at development time.
- A vendored development tarball of `@deepseek-ai/dsh-storage-domain` is kept
  in `package/tarballs/` for typechecking only; at runtime the host provides
  the service.
