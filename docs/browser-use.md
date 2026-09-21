# BrowserUse control plane

## Model

One **persistent browser control session** + one **persistent ChatGPT conversation per workspace**. No new browser session per iteration (deliberate, per the compatibility notes on second-session failures in the current BrowserUse stack).

```
BrowserHarnessAdapter (implements BrowserControl)
  ensureReady()      browser_goto(chatgpt.com) + composer/login probe
  openConversation() browser_goto(saved /c/<id>) or a fresh chat
  sendControlMessage() browser_fill(#prompt-textarea) + browser_press(ENTER)
  waitForReply()     browser_js semantic DOM probe until assistant text is stable and streaming stops
  conversationId()  browser_page_info() → persisted /c/<id>
  health()           non-destructive browser_page_info probe
  recover()          ensureReady + conversation rebind
```

The interface is the seam: the orchestrator never touches DOM details. Swap the adapter without touching protocol/state machine.

## Element strategy

The adapter follows the upstream Browser Harness MCP contract: `browser_goto`, `browser_fill`, `browser_press`, `browser_page_info`, and `browser_js`. DOM lookup is intentionally narrow: the stable composer id and ChatGPT's `data-message-author-role="assistant"` attribute, plus semantic button text/aria labels for streaming/login state. It does not depend on generated CSS class names.

## Failure handling

| Condition | Detection | Response |
|---|---|---|
| Browser not running | ensureReady fails | retry budget, then `BROWSER_UNAVAILABLE` → agent/user starts the browser |
| Logged out | DOM probe contains login gate | `ChatGptLoggedOutError` → user logs in; task state persists |
| Page stale / navigation | send fails or DOM probe empty | recover() rebinds conversation |
| Duplicate send | DuplicateSendGuard (identical text within 30s) | suppressed |
| Reply timeout | deadline exceeded | `BROWSER_STALE` → round can be retried; iteration state intact |
| Partial streaming | stop indicator present | keep polling until stable |

Browser-layer failures never touch workspace state: the durable task record in the storage domain is the source of truth, and `chatgpt_reconnect` re-establishes the control plane.
