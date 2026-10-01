# Direct CDP primitive contract

Status: PARTIAL — Stage E contract proposal following the independent PLAN at
`4dc427579936fe9aaf9370da1522f30534aa5a2e`. Implementation and real browser
acceptance remain NOT_RUN. This refines the canonical architecture, without
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

The shared driver alone owns ChatGPT routing policy and conversation correlation.
A same-document `/` to `/c/<id>` transition after one acknowledged Enter preserves
the captured assistant baseline. Arbitrary navigation to another conversation
must not become permission to accept an unrelated reply. Tests must distinguish
the permitted transition from document replacement and foreign conversation
changes; ignoring every URL change is insufficient.

## Mechanical focus and guarded mutation

BrowserPrimitives exposes `focus(selector, context)` alongside type, press and
click. Context carries optional caller signal and expected document identity.
Mutations acknowledge the current identity. The driver supplies its composer
selector and draft policy; no ChatGPT selector or App rule enters Direct CDP.
The driver uses the acknowledged identity, then verifies semantic ownership.

An old document fence must be rejected before dispatch. A separate driver-side
`checkTarget(); input()` sequence is insufficient. Runtime evaluation is bound to
the concrete execution context; mutations check their supplied fence at the
transport's dispatch boundary. Each multi-command input sequence rechecks its
binding before admitting a later command. No automatic input retry is allowed.

CDP Input commands address a page target and do not accept a document/context ID.
Consequently a command already written to the socket cannot be recalled if the
page navigates before processing it. A preflight alone is not proof of atomic
check-and-input. Architecture review must assess this race explicitly. Any
replacement/disconnect or lost acknowledgement after dispatch is an uncertain
outcome: do not claim zero mutation, repeat Enter, or clean a new document. Keep
the transport quarantined until an explicit rebind/reconciliation. Tests need
both replacement before dispatch (zero mutation) and replacement after dispatch
(no retry, no subsequent mutation, no fabricated success).

Before dispatch, caller cancellation means zero input. Once a command is written,
settle its bounded acknowledgement or connection failure without replay. A
successful acknowledgement followed immediately by caller abort remains success.
Fresh owned-draft cleanup retains its independent 2-second lifetime; foreign
drafts and replacement documents remain untouched.

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
| Boundary and semantic regressions | missing primary module/focus/document identity; same-document routing; fence passed to final input; existing replacement and F0 guarantees | FAILED — expected red, 5 failed / 18 passed before implementation |
| Transport adversaries | wrong websocket ownership, malformed/oversized replies, abort before/after write, ack/abort ordering, late response, disconnect, bounded pending map | NOT_RUN |
| Real local primitives | task-owned headless Chrome/profile + loopback HTTP page; actual focus/input/key/click events, mutations, navigation, target loss, cancellation, timeout and explicit reconnect | NOT_RUN |
| Shared semantics over real CDP | real Chrome with synthetic page; exact/missing/ambiguous App, owned/foreign drafts, baseline, streaming/settling, logout, routing, document fencing | NOT_RUN |
| Browser B smoke | existing dedicated Chrome :9222; create one owned ChatGPT tab, health/readiness/document identity; preserve all pre-existing targets/login; close only owned tab; send no message | NOT_RUN |
| Product acceptance | real App/data-plane/Planner/DSH/DeepSeek/recovery/exact-HEAD task loop | NOT_RUN — later stages |

Local synthetic content is never real ChatGPT proof. Browser B readiness is
never a real Planner response, App proof, DSH execution or product E2E. The full
Stage E gate requires both real local-page behavior and separate real Browser B
smoke. Browser A remains outside product process/endpoint operations.
