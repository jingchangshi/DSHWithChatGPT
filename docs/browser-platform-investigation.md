# Browser platform investigation — 2026-10-03

## Iteration113: consolidated lifecycle review input

Iteration113 diagnostic baseline HEAD: `6b92ead1d82341578ae23015cde15d52068ed9db`.
This is an investigation, not acceptance. Sections below this consolidated input
retain dated historical snapshots (including b43e4a0), not current HEAD claims.
User requests a complete solution rather than another isolated retry/patch.
No new production edit or canonical rerun is authorized by the evidence alone.

### Goal and present gap

The goal is the actual Windows DSH Planner–Executor loop: real accepted PLAN,
DeepSeek execution/tests with fresh stdout-only nonce evidence, commit/push,
independent raw/source/Git REVIEW, mandatory fix PLAN, actual DSH restart and
owned target handoff/reconnect, second execution/review, same-round exact-HEAD
DONE and all-true machine oracle. Producer native Git deadline gate and final
global audit remain open. An App proof or a scoped code DONE is not this goal.

Frozen validation108: focused 4 files/33 PASS; typecheck/build PASS; full 86
files/1176 PASS/3 original skips (699.43s); package RiYgOh import/native process/
private journal/replay/shutdown PASS; installed profile yRX0QD schema/Git/
containment/restart identity PASS twice. Real Browser/App was NOT_RUN in those
package/profile checks. Exact pushed HEAD109 received DONE_SCOPED only.

### Failure catalogue: facts, disposition and remaining uncertainty

| Iterations | Observed boundary | Evidence/disposition | Unresolved limit |
|---|---|---|---|
| 58–62 | Composer paragraph/BR ownership and persisted outgoing proof mismatch | Exact proof rejected omitted line breaks; 16df18b/d0e64ee/d81193e addressed text/baseline/journal fences | Old uncertain messages remain bound; never resend them |
| 64–67 | Target hidden while document complete, focus true, bounds normal | 17 hidden samples; foreground LockApp plus WTS sample established a locked sample | Hidden is not frozen; positioning is not demonstrated fix; no whole-run causality |
| 71–81 | Send ACK on temporary route; durable conversation/history materialization lag; raw App slug offset differed from settled link | One-time exact user/App proof promotion and fenced reload; 23ae394/b43e4a0 scoped accepted | App proof timeout alone cannot identify send versus wait stage |
| 81, 83–88 | Product App wait timeout; separate development page Unknown error/model loading/timeouts | VlgEmy App 90s timeout then renderer 5s timeout; development connectivity green; kp2FCM App PASS exposed bootstrap ordering gap, fixed658bdfe | Healthy connection does not guarantee a web model turn; no explicit service-policy refusal |
| 89–90 | One page unresponsive while browser root/other page healthy | Fresh root-attached page Runtime/Page commands still 5s timeout; scheduling flag A/B/B2/A2 trials inconclusive/failed variants | Not merely stale probe socket; renderer root cause unknown; do not repeat flag tuning |
| 91–94 | Second reconciliation after durable promotion lacked materialized users at 341ms | Zero-user-only fenced reload08cdc41 scoped accepted; foreign drafts retain protection | Never weaken outgoing proof or reload arbitrary draft |
| 95–97 | App-only passive diagnostic PASS; later real PLAN arrived but syntax invalid | App PASS22s/306 commands no errors; real PLAN run548 commands no crash, bare section names lacked colons | 9b1d25f instruction repair accepted; parser remains strict; limited PASS did not prove stable lifecycle |
| 101–109 | Diagnostic wrapper failure; target replacement and external deployment recovery gap | Wrapper instrumentation must fail open;107 local/App PASS but target changed before PLAN; d895807 ownership repair and6b92ead internally supervised acceptance launcher/handoff scoped accepted | Preserve trusted explicit target identity; no target discovery or external process adoption |
| 110 | Fresh supervised local PASS, first App proof about91.6s timeout, later stale/unavailable |73nmpo; zero bootstrap/PLAN; original all-false oracle preserved; stopped owned executor | Post-run foreground LockApp proves that sample only, not cause of first timeout |
| 111 | Fresh unlocked no-send control |120s same visible complete responsive target; initial/final App probe PASS; zero send/wait journal entries; Chrome foreground | Proves idle readiness, not post-send lifecycle or locked operation |
| 112 | App PASS20.6s, INIT accepted and durable baseline bound, real PLAN wait failed after304.142s |xYcfBE; native authenticated health PASS; journal wait still awaiting-reply; reconnect BUSY; same target fresh CDP5s timeout; original all-false oracle retained | Potential hidden HTTP cutoff plus renderer degradation; original transport cause code and degradation onset not captured |

### Iteration112 exact evidence and competing mechanisms

Run `694ea624-eb58-4017-9d9c-64000960cc62`, target
`61ECB1DCCA730E07A7E283745C75EDD8`, durable conversation
`6ac08ebe-0af4-83e8-8d49-567c31ee7672`, fresh journal26.
First PLAN dispatch1791004345133, wait journal creation1791004356150,
first error1791004660292. Native13548/Executor16176 stopped after evidence capture;
shutdown following owned Executor stop is not proof of a native service crash.
Chrome16244 was retained. No resend/replay/journal modification.

Published raw record112 includes `%TEMP%/plannerbridge-iteration112-real.txt`,
`planner-executor-live-xYcfBE/observed.jsonl`, read-only health/journal/CDP summary,
desktop witness JSONL and post-failure sample. Record111 includes no-send-JmdSNw
evidence and raw. The 5s desktop series covers only early180s, not the late failure.
Foreground Chrome post-failure is another sample, not continuous unlocked proof.
LockApp process presence alone is explicitly invalid as a lock detector.

Source `package/src/sidecar/client.ts`: global fetch plus explicit AbortSignal;
reply semantic wait600000ms receives RPC budget up to630000ms; unclassified
fetch error maps to SIDECAR_UNAVAILABLE; independent cancellation currently only
on OPERATION_CANCELLED/SIDECAR_TIMEOUT. Thus a transport cutoff can leave the
server owner active and make reconnect BUSY. Undici defaults headers/body timeout
300e3 (source ref f850c68967e3591b70f2f4f96ed6f4d58c76d10a). This is a
source-supported hypothesis, not confirmation that112 had UND_ERR_HEADERS_TIMEOUT.
Renderer unresponsiveness is a separate axis and may precede that cutoff.

Independent review112 has now been read: DIAGNOSTIC_PLAN calls for (A) compiled
client plus disposable transport termination fixture proving classification/no
cancel/live logical operation, then (B) one actual default Node fetch no-header
probe capped310–320s with cause.code, explicit abort state and server-alive
timestamps. No Chrome is needed. If confirmed, align transport with the existing
semantic contract or deterministically cancel/quarantine, without enlarging
semantic deadlines. A later read-only timeline may order renderer versus
transport failure. This input asks for the broader system plan before implementation.

### Unified lifecycle and solution questions for ChatGPT

1. Map development planning availability separately from product execution:
   environment/session → supervised service → explicit browser target/document →
   exact persisted send → durable baseline → reply wait → strict PLAN → executor →
   REVIEW/fix → restart/reconnect → DONE/oracle. For each stage specify owner,
   deadline, evidence, safe stop/recovery and the outcome when transport disappears.
2. Replace blind retry loops with a single failure taxonomy: environment invalid,
   renderer unresponsive, service refusal, proof uncertain, transport cutoff,
   operation busy, invalid protocol. What can be reconciled without resend? What
   requires preserving uncertainty and a fresh task? Do not expand replacement
   scope without evidence:112 already had a baseline and BUSY is not replacement.
3. Specify one finite diagnostic campaign that first proves the local transport
   mechanism, then fills missing whole-wait desktop/root/page/operation timelines.
   Instrumentation must be metadata-only, independent and fail open; no credentials,
   prompt bodies, private endpoint calls or instrumentation-induced failure.
4. Explain why idle control PASS and post-send stalls can coexist. Distinguish
   hidden/frozen/discarded, Windows locked/minimized/RDP disconnect, and service
   generation failure. Define evidence required before choosing a code change.
5. Assess unattended locked Windows feasibility honestly: current headed mutation
   contract requires visible document. Compare supported pause/resume with a
   separately validated noninteractive/headless execution capability. Never spoof
   visibility, disable Windows security, or claim lock-safe operation from flags.
6. Provide ordered milestones to complete real closure, with finite stop rules and
   explicit scope for tests/review. Preserve accepted foundations; prioritize
   full-loop progress over repeated full suites for speculative small changes.

Public research shows custom ChatGPT Apps/tool authorization is supported, but
no documented web automation or Windows lock-screen SLA. No observed403/429,
CAPTCHA, or explicit OpenAI policy rejection establishes a fundamental block.
Puppeteer flags/headless donor code is a lead, not a verified solution here.
Current acceptance-plan tables include historical NOT_RUN snapshots; current
source/raw evidence and this consolidated status take precedence.

### Independent113 ARCHITECTURE_PLAN received

ChatGPT read consolidated docs, current client/server/driver/deployment recovery
and raw records; returned ARCHITECTURE_PLAN on current6b92ead. It separates
HTTP transport, renderer lifecycle and Windows session availability, plus a
conditional bound-conversation recovery gap. These are different evidence gates,
not permission to implement all four speculatively.

Ordered milestones: M0 preserve accepted baseline; M1 compiled-client terminated
transport A1 then exact-runtime no-header A2; M2 one fail-open whole-wait timeline;
M3 only if demonstrated, quiesce old wait and recover bound conversation using
exact existing send/baseline/wait identities with zero resend; M4 controlled WTS
lock/unlock qualification (does not block unlocked acceptance); M5 candidate
focused/typecheck/build/full/package/profile/commit/push/exact review; M6 actual
canonical PLAN/execution/REVIEW/fix/restart/second review/DONE/all-true oracle;
M7 producer Git gate; M8 global exact-HEAD architecture/security/acceptance audit.

Threshold A requires A1 stranded-operation behavior plus A2 actual deterministic
transport cutoff. Preferred contingent fix: dependency-free internal node:http
transport owning the existing RPC deadline; transport loss after possible admission
independently cancels, preserves uncertainty and never reissues semantic request.
No new public error code unless tests show a control-flow need.
Threshold B requires full-wait usable-session/root-healthy/page-failure evidence;
then test and fix indefinite swallowing of typed CDP failures in reply polling.
Threshold C requires native bound-wait RED and zero-send exact recovery GREEN,
only after old logical wait is quiescent; BUSY never triggers target replacement.
Threshold D requires controlled authoritative WTS lock/disconnect evidence before
adding a deployment-specific interactive-session gate. No Windows details in core.

Stop on first real failure, freeze evidence, do not ordinary-loop reconnect.
No semantic deadline increases, weaker proof, foreign process/target adoption,
visibility spoofing, speculative flags or historical causality claims.
Headed locked mode is a proposed pause/revalidate/resume capability, not an
already proven feature. Truly unattended Headless or dedicated browser host
requires separate login/App/PLAN/REVIEW/restart/recovery acceptance.

### Executed113 causal campaign results

A1 compiled current client: disposable loopback fixture admitted wait, deliberately
destroyed HTTP socket before headers. Client returned SIDECAR_UNAVAILABLE in73ms;
cancel count0; fixture logical work stayed active. Fixture intentionally models
socket-independent work; production112 awaiting-reply is the independent actual
server observation. No claim that the fixture proves server implementation alone.

A2 exact acceptance Node executable `C:/Program Files/nodejs/node.exe`, Node24.16.0,
Undici7.25.0; no dispatcher; no-response-header POST admitted at
2026-10-03T05:40:02.021Z. Actual global fetch rejected at05:45:06.236Z after
304236ms with TypeError/cause UND_ERR_HEADERS_TIMEOUT. Explicit340s AbortSignal
had not fired; server remained listening; client closed socket (openSockets0).
320s watchdog did not fire. Thus threshold A is met for actual runtime transport
budget conflict plus client no-cancel policy. This does NOT prove112's missing
original cause code or renderer onset, and does not resolve lock-screen capability.

Raw `%TEMP%/plannerbridge-iteration113-A1.txt`, `...-A2.txt`; standalone diagnostic
`...-transport.mjs`. Production source, tests, package, historical journals and
goal.md remain unchanged. No real ChatGPT send/canonical exposure occurred.
Next source milestone is transport RED then minimal explicit-lifetime/cancellation
repair under113 architecture plan, followed by its bounded review/validation;
whole-wait renderer/environment observation remains separate.

### M1 candidate115 implementation and frozen evidence

Client uses bounded internal node:http transport and existing operation signal,
without fetch's implicit header deadline. Transport interruption independently
cancels exact operation ID; valid server UNAVAILABLE remains distinguishable.
Independent114 found cancel-before-original admission race. Native proxy RED
reproduced late send/wait admission. Server now fences pre-admission cancellations
in a bounded generation-local set, preserves existing journal/accepted outcomes,
and fences BUSY-refused identities. No protocol/journal schema/browser/recovery/
oracle change or semantic resend. Independent115 source review PASS after reading
actual source/tests and raw545–555, no concrete fix requested.

Native final8PASS covers both orderings, admitted uncertainty, exact wait restart,
accepted replay same generation/after restart, unrelated ID, BUSY cancel, old
generation rejection. Frozen full87files1192PASS/3originalskip738.48s;
typecheck/buildPASS; package nWOq2g isolated imports/native process/private state/
replay/shutdownPASS; installed profile KtDOnj two attempts schema/Git/containment/
restart identityPASS (real Browser/App NOT_RUN). Packed client/server/helper match
frozen built bytes. Compiled client310s headerless responsePASS310066ms,1wait/
0cancel/noabort. Exact-pushed supplement and M2 whole-wait diagnosis still open.

## Historical investigation snapshots

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

## 2026-10-03 follow-up: target responsiveness

Exact658bdfe received independent source and raw-evidence DONE_SCOPED. Fresh
canonical r8kDd5 passed real App workspace proof, then INIT was uncertain;
accepted bootstrap remained unbound. A separate unchanged-runtime diagnostic
9QNvEf reached an exact App/digest promotion ACK before renderer-backed commands
stopped responding. Browser root and another target stayed responsive. Fresh
root-attached sessions reproduced the same distinction: healthy target1–2ms,
failed target Page.getFrameTree and Runtime.evaluate each5s timeout. This rules
out merely retaining a stale diagnostic socket; it does not identify the native
renderer cause or establish an OpenAI rejection. No response body was captured.

Independent review prescribed at most four App-proof-only exposures, sequential
fresh Chrome processes with the same dedicated profile and binary. The B variant
adds only disable-background-timer-throttling, disable-backgrounding-occluded-windows,
and disable-renderer-backgrounding. Original visibility, ownership, authentication,
proof and command/outer deadlines remain enforced. No INIT is sent in this experiment.
A and reverse-order A2 succeeded; B and B2 reproduced target-only command timeouts
while their blank controls stayed responsive. The A control was created during
reply waiting, whereas later controls were created before preflight, so this is
not proof of a specific native scheduling cause. The switches are therefore
not a demonstrated fix and are not added to the product launcher. Historical
target URLs/journals are preserved before closing owned browser processes.

Additional community sources actually read:

- https://github.com/puppeteer/puppeteer/issues/9047 : headed Windows navigation
  hangs, reporter-specific failure; closed without a reproducible test. A separate
  comment's library upgrade fixed a different lifecycle-wait problem, while the
  original reporter still failed. This is a lead, not a transferable fix.
- https://github.com/puppeteer/puppeteer/issues/12423 : Linux standby detached-frame
  report. Its standby and platform conditions differ from the current unlocked
  Windows target timeout; it cannot establish this incident's cause.

Fresh default diagnostic1c5zPI subsequently passed real App proof and exact
durable-route promotion. Its immediate second reconciliation read no messages
and returned SEND_UNCERTAIN in341ms; this is a distinct semantic materialization
failure, not the previous renderer timeout. Independent iteration92 reviewed
raw441/source and prescribed extending the existing fenced one-load recovery to
that boundary. Later readonly442 was classified as present UI evidence only,
never authority for the historical send. No general OpenAI platform prohibition
is demonstrated by these observations.

## 2026-10-03 M2 whole-wait diagnostic and independent classification

Iteration116 ran once against the matching M1 package nWOq2g, with fresh default
Chrome, explicit target EB104C353444BFB29024939F6E9179EC, private journal and
independent metadata observers. Local readiness passed. App proof dispatched;
its send was accepted and wait durably awaiting-reply. No canonical INIT/PLAN.
All16 authoritative WTS samples were active/unlocked, Chrome foreground. Page
samples0–12 were responsive; sample12 was complete/visible/focused. Sample13
browser-root commands succeeded and listed the same target, but fresh Page.enable
was written then timed out5005ms. Immediate subsequent Browser.getVersion
succeeded1ms; authenticated Sidecar health remained PASS. First-failure control
stopped Executor8036. No target change/reconnect/resend; oracle remained allfalse.
Post-stop Executor and observers are absent, no Sidecar listener, durable wait
still awaiting-reply. That retained journal state is uncertainty, not permission
to resend. Raw563–566 expose original run, full timeline, WTS and post-stop state.

Independent ChatGPT iteration116 read raw evidence and actual source, classified
threshold B as met narrowly: PAGE_COMMAND_UNRESPONSIVE, not a proven renderer
crash, Windows lock cause, service prohibition, or product-returned browser error.
The first failure belongs to the observer; product had not yet returned an error.
Source independently demonstrates that DirectCdp read timeout/session loss leaks
as CdpCommandError and reply polling suppresses it. Generic semantic stale errors
are intentionally tolerated, so broadly propagating all BrowserStale is rejected.

Iteration117 prescribed internal BrowserPageUnavailableError (public BROWSER_STALE),
mapping definite non-mutating page-command availability failures and propagating
that subtype immediately in reply polling. Keep mutation gate uncertainty,
provider rejection/target changes, polling cadence, semantic deadlines and
transient DOM tolerance. Existing Sidecar error handling saves admitted waits as
uncertain and releases ownership after settlement; no server source change or
extra cancel is required. No recovery or target replacement change is justified.
Initial RED7fail/31pass proves classification and suppression; focused initial
GREEN38pass. Separate compiled Sidecar with real Chrome/CDP/synthetic page GREEN
8pass proves wait uncertain, healthy root/same target, owner release, one send/
wait/Enter and zero cancel/resend. These fixtures are not real ChatGPT acceptance.
Typecheck initially found an internal parameter type mismatch; corrected build
and final typecheck PASS. Related regression and independent source review remain
pending at this checkpoint; no new real exposure during implementation.

Final117 related regression10files177PASS264.84s. First broad run's two old raw
error assertions caused three shared-fixture cascade failures; only those two
type expectations updated, preserving deadline/reconnect/old-fence/no-replay.
Independent117 SOURCE_REVIEW_PASS_PENDING_FULL accepted actual source/tests/raw
with no concrete fix. Frozen full88files1202PASS/3original skips645.00s;194 source/
test hashes unchanged. Fresh package qLepRq and installed profile eQFPvt (two
native attempts) PASS; packed browser/M1 modules match build. Actual App/PLAN/
recovery acceptance still absent. Next exact pushed review, then one bounded
first-failure real diagnostic with the independently prescribed observer planes.
