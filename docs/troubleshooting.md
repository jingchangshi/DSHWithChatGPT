# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `chatgpt_status` missing | plugin not in active profile | check `dsh plugin --profile <p> list`; re-add; restart |
| `BROWSER_UNAVAILABLE` | browser not running / harness not attached | open the DSH-driven Chrome, log into chatgpt.com, call `chatgpt_reconnect` |
| `ChatGptLoggedOutError` | session expired | log in manually; state persists; reconnect |
| `stale-iteration` errors in log | ChatGPT replayed an old round | call `chatgpt_reconnect`; continue with a fresh review round |
| Review never arrives | reply timeout (240s default) | raise `replyTimeoutMs` in the patch row config; check the conversation tab manually |
| ChatGPT can't read workspace | connector not paired / bridge stopped | run a `chatgpt_plan` round (starts bridge), re-paste bridge URL+token into the connector settings |
| `PATH_OUTSIDE_WORKSPACE` in bridge logs | connector hitting wrong workspace root | the bridge binds per workspace; reconnect from the right project session |
| Sensitive file 403 (`SENSITIVE_FILE`) | deny list hit | intended; use `.env.example`-style samples; extend via `.d2cignore` (cannot un-deny defaults) |
| Duplicate INIT warnings | same boot text within 30s | benign, DuplicateSendGuard suppressed it |
| Tasks missing after restart | storage domain unavailable | plugin falls back to memory store; check DSH storage service in the profile |

## Doctor checklist (manual, via tools)

1. `chatgpt_status` → plugin loaded? latest task plausible?
2. Run a `chatgpt_plan` on a trivial goal → browser reachable, conversation opens?
3. Bridge URL from status → reachable from ChatGPT connector (curl `POST /ping` with token)?
4. In ChatGPT, ask the connector for `workspace_info` → matches your project?
5. `chatgpt_review` after a no-op change → DONE or concrete fix plan?
