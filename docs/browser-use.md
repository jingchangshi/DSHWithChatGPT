# BrowserUse control plane

## Runtime model

One persistent ChatGPT conversation per workspace, driven through the **current DSH session's** Browser Harness MCP tools.

The plugin deliberately does **not** cache a BrowserUse-owning Agent across DSH sessions. Browser Harness tools are session-gated, so every `chatgpt_*` tool call builds its coordinator around the current caller while durable task state is rehydrated from storage.

```text
BrowserHarnessAdapter
  ensureReady()              browser_page_info / browser_goto
  openConversation(id)       browser_goto https://chatgpt.com/c/<id>
  sendControlMessage()       browser_fill + browser_press Enter
  currentConversationId()    browser_page_info -> /c/<id>
  waitForReply()             browser_js -> latest assistant message
  health()                   browser_page_info (non-destructive)
  recover()                  ensureReady + persisted conversation id
```

## DSH tool result handling

`ctx.tools.execute()` returns DSH `ToolExecutionResult`, not the raw MCP payload. The adapter first checks `isError`, then unwraps `value.content` / `structuredContent` before interpreting Browser Harness results.

Every nested Browser Harness dispatch includes a call id, owning agent, and AbortSignal. A hard 90-second adapter timeout bounds an upstream MCP stall.

## ChatGPT page strategy

- Composer: `#prompt-textarea`.
- Submission: `browser_press` with Enter; no fake coordinate click.
- Reply: `browser_js` reads the latest `[data-message-author-role="assistant"]` element only.
- Streaming completion: stop-button detection plus two stable non-empty reads.
- Conversation persistence: the `/c/<id>` route is captured after the first INIT and stored durably.

The adapter avoids generated CSS class names.

## Recovery

Durable state and browser ownership are separate:

- DSH restart: task state is loaded from the storage domain and rehydrated into a fresh protocol StateMachine.
- New DSH session in the same workspace: Browser Harness binds to the new session's Agent instead of reusing the old Agent.
- Browser refresh: `chatgpt_reconnect` reopens the persisted `/c/<id>`.
- Conversation-id capture failure after INIT is best-effort and never causes the already-sent INIT to be retried automatically.

## Known boundary

ChatGPT's DOM can change. The browser adapter is intentionally isolated behind `BrowserControl` so DOM/tool changes do not require protocol or workspace-bridge changes.