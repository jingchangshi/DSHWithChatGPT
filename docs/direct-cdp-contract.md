# Direct CDP primitive contract

Status: PARTIAL — Stage E implementation candidate following the independent
PLAN 2 at `0630fffae54ad0108ffbb2680ff304577022df92`. The implementation, real local
Chrome tests and a separate Browser B readiness smoke now exist. Independent
exact-HEAD implementation review is still required. This refines the canonical architecture, without
changing the model envelope, Sidecar RPC allowlist or producer contracts.

## Identity and ownership

`BrowserTargetIdentity` carries `targetId`, `documentId`, `epoch` and observed
`url`. The first three identify a concrete owned page/document and local binding
generation. URL is metadata, not the document ownership predicate.

A History API transition preserves document identity and epoch while updating
URL. A top-level reload, even at the same URL, invalidates the document and reply
baseline. Disconnect/reconnect invalidates old fences. Explicit reconnect may
bind only the same selected page target; missing targets never authorize adopting
another tab. Multiple lifecycle events for one replacement must not increment
the epoch repeatedly.
The implementation requires the top-frame default context's `uniqueId` and uses
document-bound `Runtime.evaluate.uniqueContextId`; an unsupported browser fails
closed. A numeric context ID alone is never silently accepted across processes.

The shared driver alone owns ChatGPT routing policy and conversation correlation.
A same-document `/` to `/c/<id>` transition during the final Enter dispatch window
or after its acknowledged success preserves the captured assistant baseline.
Before final Enter dispatch the route must remain unchanged. Permit exactly one
promotion, then pin its conversation ID; query/hash changes in the same normalized
route are metadata. A send beginning in `/c/A` stays pinned to A throughout.
Arbitrary navigation to another conversation
must not become permission to accept an unrelated reply. Tests must distinguish
the permitted transition from document replacement and foreign conversation
changes; ignoring every URL change is insufficient.

## Mechanical focus and guarded mutation

### Transition provenance repair contract (PLAN 3; not yet implemented)

An observation of the final URL cannot prove that no foreign route was visited.
Each concrete binding must retain ordered, generic same-document URL transitions
with a monotonic sequence. A semantic fence includes the sequence it has already
admitted. Observations and mutation acknowledgements must expose every transition
since that fence, including changes inside a single Input acknowledgement and
between the components of a key, mouse or focus gesture. Returning to the original
URL must not erase a detour. The driver processes the complete sequence in order;
it alone interprets ChatGPT routes, admits one final-Enter promotion and rejects
foreign transitions before accepting a reply or issuing another semantic input.

History storage has explicit event, byte and age bounds. Missing, expired,
overflowed, malformed or discontinuous provenance fails closed as a target
failure; no fallback to final-URL equality is permitted. A fresh binding/document
cannot inherit an old sequence fence. Benign query/hash transitions remain
admissible only when every intermediate route retains the pinned conversation.
Fake and session-gated Harness mechanics must preserve the same contract without
copying route policy. Real Chrome evidence must cover both root-to-two-conversation
promotion and a conversation detour that returns to its original URL.

Complete same-document history plus a trustworthy Input acknowledgement is a
mechanical success, subject to semantic admission by the driver. Document loss,
lost acknowledgement or unavailable history after socket write remains uncertain
and quarantined. This preserves the existing distinction between transport
uncertainty and a known, semantically rejected route transition; it does not claim
atomic Input fencing or a proven zero mutation after dispatch.

BrowserPrimitives exposes `focus(selector, context)` alongside type, press and
click. Typing focus places the caret after the existing content; this is generic
element mechanics, including non-editable child atoms. A real Chrome regression
proved that focus alone can insert new text before an App atom. Context carries
optional caller signal and expected document identity.
Mutations acknowledge the current identity. The driver supplies its composer
selector and draft policy; no ChatGPT selector or App rule enters Direct CDP.
The driver uses the acknowledged identity, then verifies semantic ownership.

An old document fence must be rejected before dispatch. A separate driver-side
`checkTarget(); input()` sequence is insufficient. Runtime evaluation is bound to
the concrete execution context; mutations check their supplied fence at the
transport's dispatch boundary. Each multi-command input sequence rechecks its
binding before admitting a later command. No automatic input retry is allowed.
An unobserved URL change before a mutation write also requires fresh caller
inspection; the generic transport compares metadata without parsing conversation
meaning. URL changes after write are returned in the acknowledgement for the
shared driver's route policy, and do not become document replacement by themselves.

CDP Input commands address a page target and do not accept a document/context ID.
Consequently a command already written to the socket cannot be recalled if the
page navigates before processing it. A preflight alone is not proof of atomic
check-and-input. The independent PLAN 2 at `0630fffae54ad0108ffbb2680ff304577022df92`
requires PRE_DISPATCH -> DISPATCHED -> ACKNOWLEDGED disposition tracking. Any
replacement/disconnect or lost acknowledgement after dispatch is an uncertain
outcome: do not claim zero mutation, repeat Enter, or clean a new document. Keep
the binding QUARANTINED until an explicit same-target reconnect creates a new
epoch. A typed `BrowserMutationUncertainError` extends the existing document
failure classification without publishing page data or a generic Sidecar RPC.
After an Input acknowledgement, success additionally requires a document-bound
Runtime reconciliation proving the expected context survived. Late responses
cannot undo quarantine or authorize another command. Tests need
both replacement before dispatch (zero mutation) and replacement after dispatch
(no retry, no subsequent mutation, no fabricated success).

Before dispatch, caller cancellation means zero input. Once a command is written,
settle its bounded acknowledgement or connection failure without replay. A
successful acknowledgement followed immediately by caller abort remains success.
Fresh owned-draft cleanup retains its independent 2-second lifetime; foreign
drafts and replacement documents remain untouched.
The cleanup signal also carries its original absolute deadline into mechanical
commands and post-ack reconciliation, so waiting for acknowledgement cannot grant
cleanup a new lifetime. Failure after the first command of a key/click/focus
gesture quarantines the partial gesture; no later input is authorized.

## Discovery and transport

Accept only `http://127.0.0.1:<valid-port>` without credentials, query or fragment.
Discovery disables redirects, bounds bytes and deadlines, and validates returned
websocket ownership independently: `ws`, literal 127.0.0.1, the same port and the
selected exact DevTools page target path. Attachment requires an explicit unique
page target ID. No active/first/ChatGPT-looking target fallback exists.

The transport bounds pending commands and incoming messages, rejects malformed
responses and provider exceptions without exposing private page data, removes
timers/listeners on settlement, and rejects pending operations on disconnect.
Node >=20 remains supported through an explicit supported websocket dependency;
do not accidentally rely on Node 24 globals. No Puppeteer/Playwright, workspace,
shell, Git, producer, Sidecar RPC or model protocol dependency is introduced.

Primitives use Runtime, DOM, Input and Page domains. Mutation waiting uses a real
MutationObserver/event with a bounded lifetime, not a fixed delay masquerading as
observation. Screenshots are diagnostics only. Target activation is confined to
the already owned target. Navigation is internal mechanics, never public RPC.

## Falsification and evidence classes

| Evidence | Fixture and required observations | Current status |
|---|---|---|
| Boundary and semantic regressions | original reds retained; primary module/focus/document identity, transitive authority separation, same-document routing, final mutation fence, replacement and F0 guarantees | VERIFIED by candidate tests; independent review pending |
| Transport adversaries | wrong websocket ownership, malformed/oversized replies, abort before/after write, ack/abort ordering, late response, disconnect, bounded pending map and cleanup deadlines | VERIFIED: 14 deterministic dispatch tests, 18 discovery tests and 5 boundary tests; real Input-ack-loss proxy also exercised |
| Real local primitives | task-owned headless Chrome/profile + loopback HTTP page; actual focus/input/key/click events, mutations, navigation, target loss, cancellation, timeout and explicit reconnect | VERIFIED: 9 real Chrome tests; acknowledgement-loss proof observes actual mutation and forbids retry |
| Shared semantics over real CDP | real Chrome with Fetch-intercepted synthetic documents at ChatGPT-shaped routes; exact/missing/ambiguous App, owned/foreign drafts, baseline, streaming/settling, logout, routing, document fencing | VERIFIED: 9 synthetic-content tests; no real ChatGPT response |
| Browser B smoke | existing dedicated Chrome :9222; create one owned ChatGPT tab, health/readiness/document identity; preserve all pre-existing targets/login; close only owned tab; send no message | VERIFIED: separate readiness smoke; close acknowledgement followed by bounded target-disappearance verification |
| Product acceptance | real App/data-plane/Planner/DSH/DeepSeek/recovery/exact-HEAD task loop | NOT_RUN — later stages |

Local synthetic content is never real ChatGPT proof. Browser B readiness is
never a real Planner response, App proof, DSH execution or product E2E. The full
Stage E gate requires both real local-page behavior and separate real Browser B
smoke. Browser A remains outside product process/endpoint operations.

Run `corepack pnpm exec vitest run --maxWorkers=2`, `corepack pnpm typecheck`,
`corepack pnpm build` and `corepack pnpm test:package` from `package`. Run the
separate real-profile gate explicitly with
`node scripts/verify-direct-cdp-browser-b.mjs` after the build. Browser B readiness
is excluded from the ordinary test suite and never inserts a Planner message.

Candidate validation: 631 passed / 3 original skipped / 0 failed across 52 files;
typecheck, build and isolated package verification passed. These are scoped Stage E
observations, not a claim that the whole architecture or Windows product E2E is done.

Additional falsification at `d2211be0943a5bb18efbcd95bb0e9425ff395adc` found an
uncovered contract violation: root -> `/c/promoted` -> `/c/B` inside one keydown,
before the final Input acknowledgement, loses the intermediate route. Both fake
mechanics and real Chrome/real CDP with synthetic content accepted B's reply after
one Enter. The green baseline therefore does not prove the single-promotion
invariant. New expected-red regressions retain this counterexample. Stage E stays
PARTIAL/FAILED for this invariant, pending a reviewed transport-neutral transition
provenance contract and repair; conversation policy must remain in the driver.
