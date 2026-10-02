# PlannerBridge troubleshooting

These remedies apply to the Windows primary Sidecar/Direct CDP deployment.
Browser Harness setup belongs only to explicit `browser-harness-mcp` compatibility.
See [windows-deployment.md](windows-deployment.md) for protected configuration.

| Symptom | Check and recovery |
|---|---|
| `chatgpt_status` missing | Check the active profile, supported peers, built plugin and new DSH Session. |
| `SIDECAR_UNAVAILABLE` / `SIDECAR_AUTH_REQUIRED` | Verify the owned service and protected credential reference. Do not start a second service when port ownership is unclear or disclose its secret. |
| Credential resolution fails | Verify current-user DACLs, absolute private location, bare token format and absence of links. Preserve the failing credential; do not silently repair ACLs or fall back to workspace files. |
| `SIDECAR_VERSION_UNSUPPORTED` / `SIDECAR_GENERATION_CHANGED` | Use compatible client/server versions and recover persisted operations against fresh authenticated service health; old handles are invalid. |
| `BROWSER_STALE` / `BROWSER_TARGET_CHANGED` | Check the explicitly bound dedicated product target and document. Recover using fresh fences; never select a different first tab or trust cached readiness. |
| Existing draft or App-only text | On the correct product page, manually clear the unowned draft without sending and keep that page visible. Clearing the development review page has no effect on the product page. Runtime cleanup may remove only proven operation-owned input. |
| `CHATGPT_LOGGED_OUT` | Complete login/2FA/CAPTCHA in the dedicated product browser, then reconnect. |
| `CHATGPT_APP_UNAVAILABLE` | Confirm the enabled product App and exact configured title. Plain App-name text is not proof of structural App attachment. |
| `CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE` | Confirm the configured provider supports authenticated diagnostics. Do not fabricate readiness from health alone. |
| `SEND_UNCERTAIN` / `CHAT_CONTROL_OBSERVATION_UNAVAILABLE` | Preserve journal and task evidence; reconcile the exact owned operation. Do not resend or invent an observation binding. |
| `REPLAY_CONFLICT` / `JOURNAL_UNAVAILABLE` | Preserve conflicting/corrupt records and diagnose ownership/digests. Never delete journals to force a green run. |
| `SIDECAR_BUSY` / `SIDECAR_SHUTTING_DOWN` | Resolve the owned active operation or shutdown; do not terminate unrelated browser/server processes. |
| `SIDECAR_TIMEOUT` / reply timeout | Inspect fresh service/browser/App facts and latest settled reply. Preserve deadlines; old replies do not establish a new result. |
| `BRIDGE_PROBE_FAILED` | Inspect authenticated local bridge startup and active workspace lease. Never expose its bearer. |
| `TUNNEL_NOT_CONFIGURED` / `TUNNEL_START_FAILED` | Check protected connection references and the configured executable. |
| `TUNNEL_AUTH_FAILED` | Verify both external credentials belong to the same connection; owned exposure fails closed on 401/403. |
| `TUNNEL_WORKSPACE_BUSY` | Resolve the other owned active task before acquiring exclusive exposure. |
| Exposure not ready | Startup readiness alone is insufficient: authenticated control-plane polling health must also succeed. Keep loopback traffic direct; use only deployment-owned proxy configuration if required. |
| Workspace/HEAD/iteration mismatch | Reject the reply. Independently verify the exact active workspace, current pushed HEAD and same execution round before accepting review. |
| Dirty/protected/unpushed Git rejection | Use a normal task branch, test/commit/push intended changes and require clean upstream equality. Do not switch primary policy to worktree. |
| Workspace boundary denial / expired lease | Expected fail-closed behavior. Reacquire supported authority where appropriate; never add Host filesystem or shell fallback. |
| Execution output unavailable outside review | Expected scoped evidence access. Open the legitimate active review scope, not unrestricted historical access. |

## Evidence boundaries

Local `chatgpt_doctor` readiness, explicit live `appDataPlaneVerified` and full
Planner-Executor acceptance are distinct. The actual product App must independently
read workspace/Git/raw output; the development CodexWithChatGPT connector cannot
substitute for it. The real task must reach PLAN, execution/tests/commit/push,
review fix, restart/reconnect and exact same-round DONE, including stdout-only
nonce evidence. Synthetic fixtures do not close this gate.

Keep raw failures and unchanged security/assertion/deadline requirements. Do not
recreate healthy connections, broaden capabilities or weaken checks merely to
make an acceptance result green.
