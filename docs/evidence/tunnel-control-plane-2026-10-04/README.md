# Tunnel control-plane acceptance evidence

Candidate: a4679a4f3a93aef9f4cdeec62970c0dffd8ad139. Date: 2026-10-04.
Producer: 0afd708c288b079096affbfeff4626dcf9a19bf1, unchanged.
Client: 0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0.

| Evidence | Result and scope |
|---|---|
| direct.json | Embedded stub; direct poll transport network_error; no authenticated success within unchanged 40-second budget; child stopped |
| proxy.json | Same credentials/client/tunnel; explicit control-plane proxy; authenticated poll succeeded at 31.299 seconds; child stopped |
| built-verifier-failed.json | Built supervisor health passed at 5.529 seconds; verifier then failed its incorrect bridge log counter; retained as FAILED |
| installed-supervisor.json | Corrected real HTTP observer; packed installed supervisor READY at 5.553 seconds within default 20 seconds; 3 tunnel-to-bridge authenticated requests; no workspace tools/product messages; exact child/listeners closed |
| report-687fbc8b-32a6-4aa7-bdf3-3264c02f2094.json | Installed DSH composition fixture, first process PASS |
| report-f7a4ebc6-d93c-49aa-9053-9d8f5ea2aa39.json | Installed DSH composition fixture, second process PASS; stable identity and guarded read/Git boundaries |
| artifact-association.json | 228 tracked source/test/script/config inputs match the clean candidate; all 174 built/packed/installed runtime modules and the profile patch have equal SHA-256 hashes |

Final focused command:

```powershell
npx --yes pnpm@10.34.5 exec vitest run tests/tunnel.spec.ts tests/tunnel-readiness.spec.ts tests/dsh-composition-boundary.spec.ts tests/plugin-contract.spec.ts tests/production-canonical.spec.ts
```

Result: 5 files / 70 tests passed. Before implementation the corrected tunnel
RED was 5 failed / 17 passed. The first RED attempt also contained an incorrect
preview assertion; it was corrected before recording the causal RED. Typecheck,
build, test:package and test:profile all exited 0. The profile verifier uses
synthetic browser/exposure composition and does not establish App proof.

The retained .mjs files are diagnostic execution records. diagnose.mjs uses the
original machine's explicit private credential/client references. The corrected
verify-supervisor.mjs accepts package root, private environment file, client path
and a protected evidence root as arguments. It starts the production read-only
bridge with no workspace tools, uses the real installed supervisor, observes
HTTP response completion and verifies cleanup. The candidate was frozen before
packaging; no package inputs changed during acceptance.

Raw private credentials, bearer files and tunnel ID are absent. Retained client
log tails have credential values and URLs redacted. The original failed product
run and its false oracle fields remain in the prior consolidation evidence.
These records verify the tunnel prerequisite; no new product PLAN/App-proof or
complete Planner–Executor acceptance is claimed.

See [incident](../../incidents/tunnel-control-plane-2026-10-04.md) for the cause,
change and verifier correction, and [current status](../../status/current.md)
for the remaining work. New-server setup is described in
[installation](../../installation.md): build from source with the pinned pnpm,
provide private credentials and an installed compatible tunnel-client, and
set CONTROL_PLANE_HTTP_PROXY only when that server requires an explicit proxy.
The original machine's loopback proxy is not a repository default.
