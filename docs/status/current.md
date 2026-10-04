# Current delivery status

Updated 2026-10-04. This is the only dynamic execution entry.

- Consumer production candidate: 2fef84407d1e2c41e2b093b683345a56987530bd, branch feat/complete-c2c-runtime. Subsequent documentation/evidence commits preserve its frozen inputs; use git rev-parse HEAD for the delivery revision.
- Producer: 0afd708c288b079096affbfeff4626dcf9a19bf1, unchanged worktree.
- Implemented: run-level readiness fail-stop; safe pre-shutdown tunnel predicate facts; one Sidecar handoff for bootstrap and App-proof; shared pure route/proof rules; one status entry, archived history and test tiers.
- VERIFIED: 187 invariant, 262 component, 97 native and 10 observer tests; typecheck/build; one frozen full (94 files / 1,327 PASS / 3 original skips / 979.14 s); all 230 frozen input hashes unchanged; package and two profile runs; 174 consumer built/packed/installed files and 28 Producer installed runtime files match. Actual live-installed consumer files also match.
- VERIFIED in the real run: failed readiness closed tool admission, recorded stop, exited DSH gracefully and prevented App proof, PLAN and phase two; no manual stop/retry, no owned child/listener remained.
- FAILED: controlled real product acceptance before PLAN, TUNNEL_START_TIMEOUT: TUNNEL_CONTROL_PLANE_UNAVAILABLE. All original oracle fields false. Last parsed facts show control status not ok, one failure, no valid last success, null HTTP status, successful local probe. Network/credential/server root cause remains UNKNOWN; historical causes remain UNKNOWN.
- FAILED separately: Producer original Windows Git suite, 1 failed / 2 passed at unchanged 5,000 ms total fixture deadline. Profile PASS does not supersede it.
- NOT VERIFIED: real PLAN → independent nonce/fix review → actual restart/reconnect → same-round DONE. Actual Windows lock/unlock qualification NOT_RUN; WTS unlocked preflight alone is insufficient. Global product DONE is not claimed.
- Review: user authorized autonomous implementation/review without codex-with-chatgpt; no external development-review verdict is claimed.
- Next action: diagnose the exposure control-plane prerequisite using retained bounded facts and operator/control-plane evidence, then justify a new controlled run. Preserve the failed run; do not extend deadlines, resend or infer a historical cause. Producer timing/lifecycle and real lock/unlock gates remain separate required work.

Evidence: [consolidation](../evidence/consolidation-2026-10-04/README.md), [new real incident](../incidents/consolidation-live-2026-10-04.md), [historical real incident](../incidents/clean-live-2026-10-04.md), [Producer gate](../incidents/producer-windows-git-2026-10-04.md), [architecture inventory](../architecture-inventory-2026-10-04.md). Stable contracts: [goal](../goal.md), [architecture](../target-architecture.md), [acceptance](../acceptance-plan.md). Superseded default context remains [verbatim](../history/2026-10-04-pre-consolidation/README.md).
