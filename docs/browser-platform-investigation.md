# Browser platform investigation — 2026-10-03

Status: investigation, not acceptance. Runtime HEAD remains `b43e4a0`.

## Findings and limits

The repeated live failures justify checking the platform boundary before another
source repair. They do not yet demonstrate an OpenAI prohibition or rate limit.
The last canonical run `VlgEmy` ended at the original App-proof deadline without
an accepted PLAN. The development conversation separately shows `Unknown error`
for iteration82, with its control present both in message history and the draft.
Neither is a documented 403, 429, CAPTCHA or explicit account-policy rejection.
Current doctor reports healthy development connectivity; this does not prove
product App execution or ChatGPT generation.

Sources actually fetched:

1. [OpenAI: connect and test a plugin](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt).
   Supports custom tool connections and recommends separate tool, selection and
   complete-plugin evaluations. Developer-mode availability depends on account
   and workspace policy. It does not promise unattended web-composer automation,
   a browser automation SLA, or locked Windows operation.
2. [OpenAI: MCP server](https://developers.openai.com/apps-sdk/concepts/mcp-server).
   Tool discovery and authorization are supported. A functioning data connection
   is distinct from initiation/completion of a model turn in the web UI.
3. [Chrome: Page Lifecycle API](https://developer.chrome.com/blog/page-lifecycle-api).
   Hidden, frozen and discarded are distinct states. Frozen pages suspend
   freezable tasks, including timers and fetch callbacks. Hidden alone does not
   establish frozen; current or later lock does not prove historical causation.
4. [Puppeteer issue4131](https://github.com/puppeteer/puppeteer/issues/4131)
   and its comments. Reports headed-browser execution pausing in the background.
   Proposed background flags have counterreports on Windows/minimized windows;
   the issue was closed as unconfirmed, not as a universally verified fix.
5. [Playwright Chromium switches source](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts).
   Includes background timer/renderer/occlusion switches. This is useful donor
   code evidence, not proof those switches fix our failure or permit locked work.
6. [revChatGPT issue1431](https://github.com/acheong08/ChatGPT/issues/1431).
   Historical 2023 unofficial HTTP-client failure explicitly reported unusual
   activity/403 through a third-party endpoint. Its old model/token workarounds
   are not applicable to our current normal browser/App flow and are not adopted.

## Finite diagnostic decision

Preserve old uncertain messages and journals; do not replay iteration82 or the
product proof. Ask development ChatGPT for a new, explicitly distinct review of
these findings and current code. If that fails, capture the visible error without
claiming review completion. Do not rebuild healthy connectivity to fix a UI error.

For the next product experiment, use unchanged frozen packaged runtime and one
fresh explicit target/journal. Collect bounded metadata that distinguishes:

- browser-level responsiveness from target renderer responsiveness;
- actual desktop session lock state from process/window presence;
- Page lifecycle changes from route/document changes;
- visible service refusal from absence of an assistant response;
- accepted input from exact persisted outgoing-message proof.

Network status/error classification may be observed only without headers,
credentials, cookies, request/response bodies or interception. No private
ChatGPT endpoint is invoked directly. A known explicit service refusal ends the
experiment and determines the next supported recovery action. A renderer stall
requires lifecycle evidence; a proof failure requires an exact first mismatch.
No timeout extension, visibility spoofing, repeated Enter or weaker proof gate.

## Current no-send comparison

At 2026-10-02T22:22–22:23Z, browser-level `Browser.getVersion` responded in
7–14ms. The preserved VlgEmy target's `Page.getFrameTree` repeatedly exceeded a
separate five-second diagnostic bound. A fresh explicit target responded to
read-only DOM queries in 2–11ms, reached `https://chatgpt.com/`, and reported
`visibilityState=visible`. It has a visible `role=textbox`, `contenteditable=true`
composer with the expected label and no `prompt-textarea` ID. The existing driver
already supports this role-based selector; this is not a demonstrated source bug.
No send, login change, profile restart or browser flag change was performed.

Development review83 failed with visible `Unknown error` and a model-loading
error. Reloading the same conversation left the control in the draft and removed
both failed82/83 from visible persisted history. Later control calls timed out.
No new independent review was obtained. These UI failures do not establish an
explicit OpenAI policy rejection, nor the cause of the earlier product timeout.

Fresh unchanged-runtime diagnostic `kp2FCM` on explicit target/new journal9
passed both local readiness and **real App data-plane proof**. Its App-proof
wait completed after one acknowledged fenced reload. Next canonical INIT send
received the driver's ACK on a temporary route; the sidecar journal records
accepted bootstrap send but no bound bootstrap baseline or INIT reply wait.
`chatgpt_plan` returned `SEND_UNCERTAIN`, then Executor retries produced busy/
target errors. The operator stopped owned Executor27732; original exit4294967295
and all-false oracle result are preserved. Authenticated generation-fenced
Sidecar4400 shutdown succeeded. This is diagnostic evidence, not acceptance.

Observed model, sentinel and conversation-category network responses were200;
no observed403/429. Only status/lifecycle metadata was observed, not response
bodies; a200 cannot prove model success or rule out application-level errors.
The first local integration boundary to investigate is `captureSendObservation`:
it requests a durable `currentConversation` immediately after send ACK, while
driver temporary-to-durable proof currently happens in `waitForReply`. The trace
and accepted-but-unbound journal identify this as a concrete hypothesis for a
bootstrap ordering gap. Reproduce it through the server/client plus real-CDP
fixture before changing code. Do not bind a temporary route or weaken proof.

Iteration85 adds that integration regression to
`chatgpt-web-driver-direct-cdp.spec.ts`: real Chrome/CDP with synthetic page,
real authenticated Sidecar HTTP client/server and protected journal, one send,
delayed permanent route, exact outgoing App message, and no assistant reply.
Current runtime is RED at `captureSendObservation` with `SEND_UNCERTAIN`.
This is synthetic integration evidence, not a live acceptance result. The44
other tests were filtered out by the focused invocation, not newly skipped.

Minimal proposal pending independent review: make the driver's semantic
conversation lookup resolve an owned acknowledged temporary send under the
existing caller deadline, using the already implemented exact transition and
App/control proof. A temporary identifier must never become a bound baseline.
Keep HTTP schemas, journal authority and coordinator order unchanged. Alternative
server polling would put browser-specific temporary-ID knowledge into the
neutral server and is less desirable. Required adversaries: never-permanent
route, cancellation, foreign route/document, wrong/duplicate outgoing proof,
and no second Enter. Independent review is not yet available.

Iteration86 implements a local, unreviewed candidate in `currentConversation`.
Only the live acknowledged send with a recorded control digest and an owned
new-chat/temporary route can enter the wait. It uses existing fenced observation
and promotion proof under both the caller signal and the existing ten-second
semantic cap. No HTTP schema, coordinator or journal changes. The previously
failing integration now passes; six exact/cancellation/permanent-temporary/
wrong-digest/duplicate/document-replacement cases pass, and typecheck passes.
Related focused regression passed3files/83tests,230.41s,exit0. Build passed.
Frozen-candidate ordinary full regression passed83files/1118tests with3original
skips,663.11s,exit0. Fresh package r3jZQe passed isolated imports and separate
native Sidecar replay/shutdown verification. Installed DSH profile9b6b1J passed
both native attempts for schema, identity, hardened Git and containment checks.
This is a composition fixture; actual Browser/App proof is NOT_RUN. Packaged
driver JS matches the frozen build and source hash remains unchanged. Candidate
is not deployed or independently reviewed; frozen product runtime remains b43e4a0.

## Locked operation

Source work, tests, packaging and shell diagnostics can continue while Windows
is locked, provided the machine remains awake. The current headed browser
contract requires a genuinely visible unlocked interactive session. Preserve
in-flight delivery uncertainty and resume only after revalidation; do not
silently create a replacement send. Existing deadlines are not extended.

Headless execution or a separately hosted interactive browser are candidate
future transports, not current support. They need separate authenticated profile
setup, lifecycle/identity proofs and real App/model acceptance. Never disable
Windows locking or expose raw browser debugging remotely. Changing the product
to API-based planning would change the current ChatGPT Web goal and requires a
product decision rather than being counted as acceptance of this architecture.
