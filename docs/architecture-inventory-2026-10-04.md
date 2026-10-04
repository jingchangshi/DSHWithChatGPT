# Architecture consolidation inventory — 2026-10-04

This records the resulting boundaries; delivery results live only in [status/current.md](status/current.md). The prior inventory is [retained](history/2026-10-04-pre-consolidation/architecture-inventory.md).

## Browser mechanism

The driver retains browser actions, target cursor, send phase, reply baseline and the existing materialization budget. Internal conversation-binding.ts owns a pure route transition plan and one exact outgoing-control proof classifier shared by reconciliation and temporary promotion. It owns no durable state, browser I/O, timers or public provider.

| Route/event | Decision |
| --- | --- |
| Initial admissible route or same route | retain binding |
| NEW_CHAT → conversation during dispatch/acknowledged Enter | admit root promotion; remember temporary route if present |
| owned temporary → durable after acknowledged Enter | preview requires proof; commit requires exact outgoing proof |
| changed target/document/epoch, missing cursor, foreign intermediate route, second promotion | fail closed |
| unresolved App renderer | wait condition only; cannot prove delivery |
| exact App + digest in unique last user | proof; caller retains its original error mapping |

The plan consumes every transition and checks sequence/beforeUrl/final cursor. Admission updates route state only after the complete plan succeeds, avoiding partially published route state on rejected chains. MISSING_BODY remains a local observation under one absolute reconciliation deadline. No resend, extra reload budget or new field is added.

## Sidecar caller equivalence

| Property | Pending bootstrap | App-proof recovery |
| --- | --- | --- |
| Guard/attempt key | current owned task; reserve task attempt before creation | owned acknowledged send and wait; reserve send attempt before creation |
| Target creation | same createOwnedSidecarReplacement primitive; no guessed cleanup on lost response | same |
| Process lifecycle | shared handoff owns prepared supervisor before start | same |
| Health/semantic proof | existing coordinator recovery; missing task is SEND_UNCERTAIN | existing recover(signal), then strict original resume; failure rejects commit |
| Identity | task, send/wait IDs, digest, baseline and workspace owner unchanged | original App proof send/wait IDs, digest and baseline unchanged |
| Commit | synchronous supervisor-map publication | synchronous owned-supervisor publication |
| Rollback | process close before known target close; preserve original error | same |
| After commit | best-effort source retirement; no ownership rollback | same |

One helper now owns both callers' resource transaction. Deployment wiring, guards and caller-specific proof remain in dsh-runtime.ts; no third lifecycle copy or public recovery abstraction is introduced. Durable task/journal proofs are separate stores and are never undone by deployment cleanup.

## Acceptance and context

Readiness failure synchronously closes run-level tool admission; restored observers retain the latch for that run. Parent restart and the oracle independently reject raw readiness failure, including logs without an acceptance-stop event. Tunnel startup failure retains only bounded predicate facts before shutdown, including spawn/early-exit paths; diagnostics never grant readiness or infer root cause.

Default documentation has one dynamic entry and three stable contracts. Full previous documents are archived verbatim. Test tiers select existing suites for feedback; full coverage and original deadlines/skips remain intact. One-off diagnostics are dated evidence unless they establish a lasting invariant.

## Autonomous source review

Review focused on production design before counting test results: duplicate route interpretation and proof filters were removed; two handoff resource owners became one; no public provider, protocol field, retry or mutable browser field was added. Internal proof preview cannot commit route authority. Handoff cleanup cannot mask failure, and cancellation at asynchronous phase boundaries prevents later proof/commit. Existing shared driver/transport and producer capability boundaries are preserved. This is autonomous review, not an external ChatGPT verdict or real product acceptance.
