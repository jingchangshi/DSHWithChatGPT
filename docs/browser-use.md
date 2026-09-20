# BrowserUse control plane

## Model

One **persistent browser control session** + one **persistent ChatGPT conversation per workspace**. No new browser session per iteration (deliberate, per the compatibility notes on second-session failures in the current BrowserUse stack).

```
BrowserHarnessAdapter (implements BrowserControl)
  ensureReady()      chatgpt.com reachable (retry budget: 3 attempts, 0.5s/1.5s backoff)
  openConversation() reuse saved conversation id, else new chat
  sendControlMessage() semantic composer fill + submit
  waitForReply()     poll snapshot; completion = stable snapshot & no stop indicator; deadline = replyTimeoutMs
  health()           navigation probe
  recover()          ensureReady + conversation rebind
```

The interface is the seam: the orchestrator never touches DOM details. Swap the adapter without touching protocol/state machine.

## Element strategy

Semantic only — `role`, `aria-label`, visible text, contenteditable. No long generated CSS classes. Composer target is the known contenteditable (`#prompt-textarea`); reply detection is snapshot-text based with stability windows, not class matching.

## Failure handling

| Condition | Detection | Response |
|---|---|---|
| Browser not running | ensureReady fails | retry budget, then `BROWSER_UNAVAILABLE` → agent/user starts the browser |
| Logged out | snapshot contains login gate | `ChatGptLoggedOutError` → user logs in; task state persists |
| Page stale / navigation | send fails or snapshot empty | recover() rebinds conversation |
| Duplicate send | DuplicateSendGuard (identical text within 30s) | suppressed |
| Reply timeout | deadline exceeded | `BROWSER_STALE` → round can be retried; iteration state intact |
| Partial streaming | stop indicator present | keep polling until stable |

Browser-layer failures never touch workspace state: the durable task record in the storage domain is the source of truth, and `chatgpt_reconnect` re-establishes the control plane.
