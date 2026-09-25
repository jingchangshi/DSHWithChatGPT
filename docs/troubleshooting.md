# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `chatgpt_status` missing | plugin not in active profile | check plugin/profile installation, rebuild, restart DSH |
| `chatgpt_doctor` reports `BROWSER_HARNESS_UNAVAILABLE` | current Session lacks the provider, its command is unavailable, or startup failed | mount BrowserUse and Browser Harness in the profile, ensure `browser-harness-mcp` is on PATH, then create a new Session |
| `chatgpt_doctor` reports `CHATGPT_APP_UNAVAILABLE` | exact App mention cannot be selected | check the enabled App name and login in the Browser Harness-controlled profile |
| `chatgpt_doctor` reports `BRIDGE_PROBE_FAILED` | authenticated loopback MCP request failed | inspect local bridge startup; do not paste the bearer token into logs or chat |
| `TUNNEL_NOT_CONFIGURED` | managed mode lacks tunnel id or runtime key | set `CONTROL_PLANE_TUNNEL_ID` and `CONTROL_PLANE_API_KEY`, restart/reload |
| `TUNNEL_START_FAILED` | `tunnel-client` missing or rejected configuration | verify executable on PATH and tunnel/runtime-key validity |
| `TUNNEL_WORKSPACE_BUSY` | another workspace has an active managed-tunnel C2C task | finish/block that task first; then start the next workspace C2C task |
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

1. Run `chatgpt_doctor` in a new DSH Session; require all local checks to pass. It verifies Session-owned browser tools, ChatGPT login, exact App selection without sending, authenticated loopback workspace identity, and local tunnel readiness.
2. Treat `remote_workspace_access` as unverified until the App calls `workspace_info` through the remote path and the returned `workspaceId` matches this Session.
3. On a non-protected branch, a real C2C task must reach PLAN, local test, commit/push, exact-HEAD REVIEW, and DONE without manual App selection.

Component tests can use a simulated browser and are not proof of a working DSH Session. `chatgpt_doctor` in a real Session proves local prerequisites but not remote App access. Only an actual ChatGPT App call and subsequent PLAN/REVIEW round verify the end-to-end path.
