# BrowserUse control plane

> Legacy implementation reference at the Stage A baseline. The canonical PlannerBridge target is [target-architecture.md](target-architecture.md), with [planner-executor-protocol.md](planner-executor-protocol.md), [windows-deployment.md](windows-deployment.md) and [acceptance-plan.md](acceptance-plan.md). Target components are not claimed implemented by this legacy document.

## Runtime model

This section describes the legacy Browser Harness compatibility path. The target extracts these App/composer/baseline/reply semantics once into ChatGptWebDriver. DirectCdpPrimitives and Session-gated BrowserHarnessPrimitives supply transport/input/target activation beneath the same driver; they must not copy this semantic algorithm. Sidecar exposes only semantic operations, never generic evaluation or navigation.

One persistent logged-in browser profile + one persisted ChatGPT conversation per workspace. A new DSH session does **not** reuse an old session-gated Browser Harness owner: every model-facing call creates a coordinator bound to the current agent/session.

```
sendControlMessage()
  → capture assistant-count/latest-text baseline
  → type @<exact app name>
  → locate exact visible autocomplete candidate
  → click + verify the App mention decorator
  → append D2C envelope
  → Enter
  → wait only for a NEW assistant response
  → wait for streaming to stop and text to stabilize
```

## Why @mention

ChatGPT App availability is message-scoped. The adapter therefore activates the configured App for every MCP-dependent INIT/REVIEW message instead of assuming an App selected on a previous message remains active.

The adapter fails closed with `CHATGPT_APP_UNAVAILABLE` if it cannot find and verify the exact App. It will not send a workspace-blind review request.

## Browser Harness contract

The adapter uses:
- `browser_page_info`
- `browser_goto`
- `browser_wait_for_load`
- `browser_wait_for_element`
- `browser_fill`
- `browser_type`
- `browser_press`
- `browser_click`
- `browser_wait`
- `browser_js`

Every tool call has a unique call id, the current DSH agent/session, an abort signal, and a hard timeout. DSH ToolExecutionResult / MCP wrappers are normalized before use.

## Reply fencing

Before a send, the adapter stores `assistantCount` + latest assistant text. `waitForReply()` ignores the pre-existing assistant message. The latest current assistant body’s `data-markdown-animated` attribute signals generation; legacy English stop controls remain supported. After observed generation ends, two identical non-streaming observations at least 1.5 seconds apart are required. If generation was never observed, at least three identical observations and 4.5 seconds without text changes are required. A text change resets settling; message identity attributes do not establish completion. Existing reply timeouts and caller cancellation still apply, and proof validation remains strict.

## Failure handling

| Condition | Behavior |
|---|---|
| browser unavailable | bounded retries then `BROWSER_STALE` |
| ChatGPT logged out | `ChatGptLoggedOutError`; user logs in, durable task remains |
| exact App unavailable | `CHATGPT_APP_UNAVAILABLE`; message is not sent |
| old assistant reply still visible | ignored by baseline fencing |
| streaming reply | polling continues |
| reply timeout | task remains durable; reconnect can rebind saved conversation |
| DSH restart | `chatgpt_reconnect` loads task state and saved conversation id |

Long generated CSS class names are deliberately avoided; the adapter relies on semantic roles, the stable composer id, message-author attributes, and visible autocomplete/menu structures.
