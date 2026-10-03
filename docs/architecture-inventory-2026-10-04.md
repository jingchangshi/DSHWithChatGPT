# Architecture Inventory — 2026-10-04

This is a read-only inventory produced before any production behavior change.

## ChatGptWebDriver

`ChatGptWebDriver` currently represents one lifecycle through independent fields:

| Field | Conceptual responsibility | Main transitions observed |
| --- | --- | --- |
| `target` | browser target/document cursor | accept, reload replacement, reset |
| `fenced` | whether observations are ownership checked | capture baseline, reset |
| `route` / `temporaryRoute` | route admission and temporary-to-durable promotion | new chat → temporary conversation → durable conversation |
| `finalEnter` | outgoing send lifecycle | before → dispatching → acknowledged |
| `sentControlDigest` | exact outgoing proof | set during send, consumed by promotion/reconciliation |
| `replyBaseline` | assistant observation baseline | capture, invalidate on target changes |
| `materializationReloadUsed` | one fenced reload budget | set during promotion materialization |

The main event paths are:

1. `captureReplyBaseline` resets and fences a target, then captures conversation and assistant baseline.
2. `reconcileReplyBaseline` admits the current conversation, observes messages, permits only the classified `MISSING_BODY` state within one absolute deadline, optionally performs the existing single fenced materialization reload, and accepts only one exact last-user App/digest proof.
3. `sendControlMessage` and `proveTemporaryPromotion` share the route/document cursor, final Enter state, digest, and promotion proof.
4. `resetTarget`, `acceptTarget`, `admitRoute`, and `evaluate` jointly enforce target continuity and route transitions.

The primary consolidation candidate is an internal binding state value that groups the target cursor, route admission, send phase, and proof phase. It must first be specified as `FROM + EVENT -> TO / ERROR`; no new field or broad rewrite is authorized by this inventory alone.

## Sidecar lifecycle callers

The shared primitive in `sidecar-target-recovery.ts` owns replacement creation, source validation, replacement verification, replacement closure, and source retirement. Current callers are:

- `dsh-runtime.ts` bootstrap recovery around lines 634–655: create replacement, start supervisor, await health/readiness/recovery, commit supervisor map, retire source; close replacement on failure.
- `dsh-runtime.ts` App-proof recovery around lines 798–827: create replacement, start supervisor, await health and semantic readiness, run proof/reconciliation callback, commit, retire source; close replacement on failure.
- `readiness/doctor.ts` and its tests consume the recovery callback through the runtime composition.

The two runtime call sites visibly share the ownership transaction shape, but their readiness/proof callbacks and commit semantics differ. A future `OwnedSidecarHandoff` extraction is therefore plausible, but requires a characterization test and a caller-by-caller equivalence table first.

## dsh-runtime responsibility split

`dsh-runtime.ts` currently wires adapters, workspace/Git authority, coordinator, MCP exposure, browser/Sidecar control, supervisor lifecycle, doctor/readiness, and both recovery call sites. The file is a composition root with embedded lifecycle transactions. The first safe extraction target is an internal transaction helper around the already-existing replacement primitive, provided dependency direction improves and no public provider changes.

## Documentation and tests

`docs/status/current.md` is now the short current-status entry point. Historical handoffs and evidence remain separate. Existing tests already distinguish focused/native, frozen full, and real exposure evidence; no test weakening or diagnostic promotion is authorized by this inventory.

## Decision

The bounded target selected by independent review was the Sidecar handoff lifecycle. The internal `runOwnedSidecarHandoff` helper now centralizes source close, replacement start, health, semantic recovery, proof, commit, retirement, and replacement rollback for the App-proof recovery path. It adds no public port, protocol, retry, timeout, resend, or browser state.

Characterization evidence after extraction:

- `tests/doctor-owned-recovery.spec.ts` and `tests/production-canonical.spec.ts`: 36 passed.
- `tests/sidecar-target-recovery.spec.ts`, `tests/sidecar-target-recovery-native.spec.ts`, `tests/doctor-owned-recovery-native.spec.ts`, and `tests/production-canonical.spec.ts`: 57 passed.
- `pnpm typecheck`: passed.

Bootstrap recovery remains a separate caller until an additional equivalence review confirms that its callback and commit semantics can use the same transaction without weakening ownership or uncertainty handling.
