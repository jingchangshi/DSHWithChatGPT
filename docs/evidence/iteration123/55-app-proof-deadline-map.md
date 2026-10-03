# App-proof nested deadline map

This map records the current Windows App-proof call path at commit `bf5a0bec`.
It is an architecture diagnostic only; it does not change a timeout or claim a
root cause for real123.

| Stage | Owner | Budget source | Clock kind | Refreshes? | Public failure | Journal/ownership effect | Relation to outer 90s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Doctor proof transaction | `proveApp` | `appProofTimeoutMs`, normally `min(replyTimeoutMs, 90_000)` | One absolute `AbortController` deadline | Never | `APP_PROOF_TIMEOUT`, or the mapped provider code | The same signal fences send, bind, wait and recovery; no second proof clock | Governing deadline |
| Initial baseline capture | `ChatGptWebDriver.captureReplyBaseline` | caller signal only | Relative work bounded by outer signal and each CDP command | No | `BROWSER_STALE`, logged-out, cancellation | No send journal entry yet | Must finish before send under outer clock |
| Send admission and semantic send | Sidecar RPC + driver | Sidecar request lifetime and outer signal | Relative to request; admission is fenced | No | `SEND_UNCERTAIN`, transport/provider error | Journal may be `prepared`, `sending`, `accepted`, or `uncertain`; send is never repeated here | Nested inside outer clock |
| Accepted bootstrap binding | `captureSendObservation` → `reconcileReplyBaseline` | Outer signal; `reconcileReplyBaseline` has its own materialization window | Relative 10s semantic window after one observation/reload path | One existing durable-route reload only | `SEND_UNCERTAIN` or target-change error | Binding is published only after exact count/digest/identity proof; no wait entry on failure | Hidden short deadline observed in D27/D28 |
| Pending new-chat conversation promotion | `ChatGptWebDriver.currentConversation` | `POST_NAVIGATION_SEMANTIC_TIMEOUT_MS = 10_000` plus outer signal | Relative abort deadline encompassing promotion checks | No | `SEND_UNCERTAIN` when the child deadline expires | Retains the acknowledged-send fence; does not bind bootstrap | Can terminate before 90s; applies only while the acknowledged new-chat route remains pending |
| Individual target checks | `currentTarget`, `checkTarget` | Direct CDP command default 5s plus outer signal | Per-command relative deadline | No | Browser/target error | Keeps the existing target fence | Can terminate before 90s |
| Sidecar client/server request | `SidecarChatControlClient` / `startSidecarServer` | Default 30s each; wait requests add their requested reply timeout | Per-request relative abort deadlines | New clock for each request, never renews the outer signal | `SIDECAR_TIMEOUT` / cancellation | Server retains active provider ownership until it settles; client cancellation is bounded by 2s | Ordinary bind requests can end before 90s; actual deployment overrides still require verification |
| Post-navigation composer readiness | `openConversation` | `POST_NAVIGATION_SEMANTIC_TIMEOUT_MS = 10_000` | Relative semantic deadline | No | `BROWSER_STALE` | No ownership is adopted | Independent 10s child deadline |
| Reconciliation materialization | `reconcileReplyBaseline` | `POST_NAVIGATION_SEMANTIC_TIMEOUT_MS = 10_000` after the optional reload | Relative semantic deadline | No | `SEND_UNCERTAIN` | No bootstrap bind and no wait on failure | Independent 10s child deadline |
| Promotion proof materialization | `sendControlMessage` | 2s pre-reload wait, then `POST_NAVIGATION_SEMANTIC_TIMEOUT_MS = 10_000` | Two relative windows | No | `BROWSER_TARGET_CHANGED` | Send remains single; replacement is provisional until exact proof | Independent child deadlines |
| Reply wait | `ChatGptWebDriver.waitForReply` through Sidecar | Remaining outer signal plus requested timeout | Relative request timeout fenced by outer absolute deadline | No | `APP_PROOF_TIMEOUT`, stale/recovery code | Wait owns the accepted operation; recovery may resume once without renewing proof clock | Cannot exceed outer clock |
| Recovery transaction | `recoverAppProof` / deployment recovery | Same outer signal | One bounded transaction | No second entry | Recovery/provider error | Existing send/wait operation only; no resend or new target | Must fit remaining outer clock |

The map exposes the key falsification question: the 10s reconciliation and
promotion windows can reject a state that later becomes exact while the outer
90s proof clock is still live. That is a hypothesis only. A valid RED requires
the same target/document/route to move from a genuinely transient observation
to the exact proof without a resend, and an independent review must decide
whether that transient state is production-acceptable.

The current implementation also has per-command CDP deadlines and a separate
15s page-load wait. These are safety limits for individual browser operations;
raising them merely because the outer proof budget is larger would change the
failure and identity-fencing behavior without causal evidence.
