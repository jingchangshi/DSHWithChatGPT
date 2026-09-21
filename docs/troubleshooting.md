# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `chatgpt_status` missing | plugin not in active profile | check plugin/profile installation, rebuild, restart DSH |
| `TUNNEL_NOT_CONFIGURED` | managed mode lacks tunnel id or runtime key | set `CONTROL_PLANE_TUNNEL_ID` and `CONTROL_PLANE_API_KEY`, restart/reload |
| `TUNNEL_START_FAILED` | `tunnel-client` missing or rejected configuration | verify executable on PATH and tunnel/runtime-key validity |
| `tunnel.ready: false` | health endpoint not ready | run status again after checking tunnel-client/platform state; plugin will restart stale bindings |
| `CHATGPT_APP_UNAVAILABLE` | exact configured App did not appear in @mention autocomplete | verify App exists/enabled and `chatgptAppName` matches exactly |
| `ChatGptLoggedOutError` | ChatGPT browser session expired | log in manually; then call `chatgpt_reconnect` |
| `workspace-mismatch` | ChatGPT used the wrong App/connector/workspace | verify App points at this tunnel and workspace_info returns the expected `workspaceId` |
| `review-head-mismatch` | stale/wrong review reply or wrong git state | do not accept review; reconnect and review current exact HEAD |
| `AUTONOMOUS_GIT_POLICY` protected branch | commit-push mode is on main/master | create/use a task branch, then implement/commit/push |
| `AUTONOMOUS_GIT_POLICY` dirty worktree | review requested before committing | test, commit intended changes, ensure clean status, pass current HEAD |
| `iteration-limit` | repeated fix plans exceeded `maxIterations` | inspect remaining review findings and decide whether to raise the bound |
| reply timeout | no genuinely new settled assistant response | inspect browser/tunnel/App health; old visible replies are intentionally ignored |
| `PATH_OUTSIDE_WORKSPACE` / sensitive-file denial | read-only boundary blocked access | expected security behavior; do not work around it |

## Unattended doctor checklist

1. `chatgpt_status` reports `tunnel.ready: true`.
2. `workspaceId` is stable for the same checkout.
3. `chatgptAppName` exactly matches the enabled ChatGPT App.
4. Browser Harness controls a logged-in ChatGPT tab.
5. On a non-protected branch, a trivial C2C task reaches PLAN, local test, commit/push, exact-HEAD REVIEW, and DONE without manual App selection.
