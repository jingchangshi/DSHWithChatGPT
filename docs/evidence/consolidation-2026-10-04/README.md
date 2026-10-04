# Architecture consolidation evidence — 2026-10-04

Consumer production candidate: 2fef84407d1e2c41e2b093b683345a56987530bd, based on b83e31ce647866c5b7a1b4b0a76e91b414f8b982. Producer: 0afd708c288b079096affbfeff4626dcf9a19bf1, unchanged. This task uses autonomous implementation/review as explicitly authorized by the user; it does not claim an independent ChatGPT development verdict.

## Implemented and reviewed

[Architecture inventory](../../architecture-inventory-2026-10-04.md) records the full route transition table and two-caller handoff equivalence. Readiness closes admission synchronously, the parent refuses restart and the oracle rejects an earlier failure. Tunnel failures preserve only bounded predicate facts before shutdown. No new mutable browser field/public provider, deadline increase, resend or regression removal was introduced.

## Raw verification

| Artifact | Outcome/scope |
| --- | --- |
| readiness-observer-red.txt / readiness-oracle-red.txt | Original observer admitted tools after failure; original oracle accepted later-success overwrite. 5 / 4 causal failures retained |
| handoff-red.txt | Four rollback-order failures and recovery entered after health completed on a cancelled caller; 5 causal failures retained |
| consolidation-fixture-failure.txt | 6 failures in newly written test fixtures, corrected parameter-table shape and spawn-error fixture timing; not production defect evidence |
| consolidation-focused.txt | 7 files / 120 PASS |
| invariants.txt | 7 files / 187 PASS, 1.29 s |
| components.txt | 10 files / 262 PASS, 24.39 s |
| native.txt | 6 files / 97 PASS, 548.42 s; real Chrome/CDP/processes with synthetic content |
| observer-final.txt | 10 PASS, including restored same-run fail-stop |
| typecheck.txt / build.txt | PASS |
| frozen-manifest.json | 230 source/test/script/config inputs; unchanged after full |
| frozen-full.txt / frozen-full-result.json | 94 files / 1,327 PASS / 3 original skips / 979.14 s; exit 0 |
| producer-windows-git.txt | Original Producer gate FAIL: 1 failed / 2 passed; unchanged 5,000 ms fixture deadline |
| producer-toolchain-launch-failure.txt | Initial pnpm mismatch; no test executed. Actual Producer gate used pinned 11.7.0 |
| producer-source-emit-association.json | 41 type-aware in-memory TypeScript emissions match existing compiled modules; not full Producer typecheck or bundled-entry rebuild |
| producer-transpile-only-diagnostic.json | Transpile-only comparison cannot inline cross-file const enums; retained diagnostic differences, superseded by type-aware emission |
| product-preflight.json / wts-preflight.json | Explicit owned target; logged in, visible empty composer and WTS unlocked; no App send, no real lock/unlock cycle |
| historical-live/ | Prior failed exposure retained: executor continued after local readiness failure, then operator stopped it; all oracle fields false |
| structure.json | Default document context reduced from 3,026 to 245 lines; prior documents retained verbatim |

Package verification PASS; two composition profile attempts PASS. artifact-association.json records 174 consumer lib files equal across build/packed/isolated install, 28 Producer runtime files equal, and unchanged frozen inputs; cordis.patch.yml also matches. live-installed-association.json proves all 174 actual live-installed files match the candidate. Initial verifier errors assumed transitive packages were hoisted and failed to resolve from symlink contexts; both are retained as fixture errors. The corrected verifier resolves real installed dependency contexts and preserves all peer checks.

The controlled real run FAILED before PLAN with TUNNEL_START_TIMEOUT: TUNNEL_CONTROL_PLANE_UNAVAILABLE. live-stop-verification.json proves automatic stop with zero later dispatches, zero App proof/PLAN/phase-two activity, executor exit 0 and oracle exit 1. No operator stop or retry occurred; all product oracle fields are false. live-tunnel-failure.json retains bounded pre-shutdown facts; root cause remains UNKNOWN. The complete raw run is retained in live/. [Incident](../../incidents/consolidation-live-2026-10-04.md) describes scope and limitations. The two local diagnostic .mjs files are execution records using private credential references, not new runtime mechanisms or permission to repeat exposure. Source/native/fake/installed checks never certify real PLAN → fix → process restart → reconnect → same-round DONE. Producer Git and real lock/unlock remain distinct global gates.

Use [current status](../../status/current.md) for the latest gate and next action. Prior real failure details are [retained](../../incidents/clean-live-2026-10-04.md); Producer gate details are [separate](../../incidents/producer-windows-git-2026-10-04.md). Known credentials were checked against retained evidence without printing their values.
