# Acceptance contract

Current results and next action live only in [status/current.md](status/current.md). Historical stages, original failures and reviews are retained [verbatim](history/2026-10-04-pre-consolidation/acceptance-plan.md); none is upgraded by a later PASS.

Run from package/ with the pinned pnpm 10.34.5 (npx --yes pnpm@10.34.5 may be used). Select checks by the changed boundary; the full suite still includes every existing regression and its original skips.

| Level | Command | Evidence and limit |
| --- | --- | --- |
| Pure invariants | pnpm run test:invariants | Protocol/aggregate, full route chain and exact outgoing proof; no browser or model acceptance |
| Components | pnpm run test:components | Driver DOM/parity, reconciliation, owned handoff, doctor, tunnel and composition |
| Native boundary | pnpm run test:native | Real temporary Chrome/CDP/process mechanics with synthetic page content; no real App/model closure |
| Observer | pnpm run test:planner-executor-observer | Readiness fail-stop, event attribution and nonce provenance |
| Build | pnpm typecheck; pnpm build | Typed source and emitted artifact |
| Frozen regression | pnpm test | Once after source/tests/scripts/config freeze; retain complete output and manifest; changed boundaries or failures justify further checks |
| Package/profile | pnpm test:package; pnpm test:profile <producer> <isolated install> | Packed import, installed authority and Windows Git composition; hash all consumer lib files and relevant producer artifacts |
| Real Windows | pnpm test:planner-executor-e2e <producer> <isolated install> | Explicit owned target and private fresh journal, real DeepSeek and ChatGPT App, original independent oracle |

## Required real result

Explicit local doctor must return localReady=true before explicit App proof, which must return appDataPlaneVerified=true before PLAN. A failed readiness result closes tool admission immediately, requests graceful shutdown and prevents phase two. The oracle rejects that run even if later success records exist. An unrequested App proof and unavailable execution-output access outside review are not readiness failures.

Real acceptance requires PLAN → authentic execution/tests → commit/push → independent review of raw execution_output → real fix PLAN → actual DSH process restart → same task/workspace/iteration reconnect → fix/tests/commit/push → exact-HEAD review → same-round DONE. Reviewer must echo the random successful-test marker read from raw stdout; Executor prose, tool arguments and files must not disclose it. Workload requirements and tests remain immutable. Parent workload and Git checks must pass; every original oracle field must be true.

Stop the controlled exposure on readiness failure or uncertainty. Preserve terminal exit, observations, oracle result and bounded pre-shutdown diagnostic. A tunnel classification describes predicate failure, not network/auth/server root cause. Do not infer historical causes from a later run or retry to replace retained failure evidence.

## Remaining global gates

Producer Windows Git tests must pass their existing per-query and fixture deadlines without weakening argv, environment, tripwire, snapshot, affinity or generation checks. Profile PASS is separate evidence. Windows lock/pause/resume requires actual WTS state, no new page action while locked, revalidation after unlock and no renewal of an expired operation. Tests alone cannot certify a real lock/unlock cycle.

Global closure records both exact repository SHAs, source/build/packed/installed association, real nonce/fix/restart/DONE evidence and every required gate. Report VERIFIED, FAILED, NOT_RUN, BLOCKED or FUTURE by scope. Autonomous source review is permitted for this development task; product independent review remains part of the real workflow.
