# Optional semantic Chat Control diagnostics

Stage F implementation is PARTIAL and not independently accepted. PLAN4 is
planning input. Diagnostics do not prove a native Executor or product task loop.

`ChatControl` retains its seven neutral operations. The separate optional
`ChatControlDiagnostics` port returns `readiness` facts and performs an exact
configured-App `probeApp`. It has no browser primitive, deployment, workspace,
file, shell or Git access. Doctor consumes this semantic contract while keeping
legacy browser-error classification only at its compatibility edge.

Authenticated version-1 Sidecar RPC adds two strictly shaped methods:

| Method | Parameters | Result | Mutation policy |
|---|---|---|---|
| readiness | empty object | url (at most 2048 characters), composer and loggedOut booleans | observe browser facts; do not infer them from service health |
| probeApp | appName (1–256 characters) | null | select and verify the deployment's exact configured App; clean only the owned draft; never submit a message |

All existing authentication, generation, request/operation IDs, body limits,
deadlines, cancellation and active-provider exclusion apply. Extra parameters
such as script, URL or CDP method are rejected. App names must exactly match
the trusted server binding before journal admission or provider invocation.
Missing diagnostic capability returns `CHAT_CONTROL_DIAGNOSTICS_UNAVAILABLE`;
there is no inferred success or alternative browser-provider fallback. Older
servers reject these new methods; clients do not silently downgrade.

App selection is a write operation. Its journal path is `prepared → probing-app
→ observed-app → accepted`, distinct from message delivery's `observed-sent`.
Restart turns unresolved `probing-app`/`observed-app` entries into uncertainty.
A repeated same-generation operation joins its existing result. A previous
generation's accepted probe cannot establish fresh App availability: it is
refused as `SEND_UNCERTAIN`; a fresh probe needs a fresh operation ID. Journal
version-1 readers that do not know these extension states fail closed.

The server delegates selection to the existing shared `ChatGptWebDriver`;
it does not duplicate its composer ownership, exact mention or cleanup logic.
Cancellation after possible selection preserves uncertainty and never authorizes
a replayed write. `readiness` is observation, not an App selection proof. Exact
App selection is not an App workspace-reading proof. Doctor preserves these
separate checks and never reports the complete product loop as accepted.

Tests first: six initial diagnostic cases failed before implementation; six
new typed-error classification cases failed while three legacy cases passed.
Current HTTP integration tests cover independent health/readiness facts,
unsupported capability, mismatched App, bounded parameters, joined probe replay,
in-flight cancellation and restart refusal for uncertain or accepted old probes.
Existing shared-driver tests remain responsible for real composer selection,
foreign draft preservation and no extra Enter. Real primary profile/bootstrap
acceptance remains pending.
