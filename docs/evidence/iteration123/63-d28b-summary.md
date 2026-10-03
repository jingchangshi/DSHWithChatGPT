# D28b diagnostic candidate

Consumer base: bf5a0bec82261f1e82695cd4126515b35ca4dd5f. Producer remains
0afd708c288b079096affbfeff4626dcf9a19bf1. Candidate is uncommitted.
Only error metadata was added to production rejection branches; no timeout,
retry, App activation, identity proof or observation command was changed.

Native composition uses compiled Sidecar, original driver decisions, Direct
CDP and the original 90s doctor budget on a disposable synthetic page.

| Scenario | Evidence | Outcome |
| --- | --- | --- |
| 250ms exact | 57/58 | Bound, one send/Enter/wait, no recovery |
| 9s exact | 57/58 | Bound; reconcile 9096ms, one send/Enter/wait |
| 11s exact | 59/61 | Rejected at 10680ms; PROOF_NOT_FOUND; later exact on same document/route |
| Transient unknown-role article | 59/61 | Rejected at 629ms; OBSERVATION_MISSING; later exact on same document/route |
| Permanent missing | 57/58 | Rejected at 10790ms; PROOF_NOT_FOUND |
| Foreign control | 57/58 | Rejected at 675ms; DIGEST_MISMATCH |
| Duplicate exact user | 57/58 | Rejected at 642ms; PROOF_AMBIGUOUS |
| Wrong App | 57/58 | Rejected at 710ms; WRONG_APP |
| Route changed during materialization | 59/61 | Rejected at 867ms; BrowserTargetChangedError |

Every rejected native case has exactly one accepted send/Enter, no bound
baseline, no wait and no recovery. The later-exact probes are explicitly
post-terminal local fixture observations, not product retries. They compare
the actual messageObservationScript result and target/document/route equality;
only a boolean is recorded. They do not prove the production acceptability of
the fixture's unknown-role article, nor the historical real123 cause.

58 contains eight passing cases and a failing route-change fixture assertion:
the initial user was already exact, so no reload and no configured route change
occurred. The refinement omits that initial user and delays durable materialization
so the route change actually occurs within the existing observation window.
61 validates only three selected cases; its six skips are filter exclusions.
60 preserves a Windows command-quoting failure with no experiment performed.

62: two files, 32 PASS. The observer delegates original methods once, never
awaits its sink, and catches synchronous throws/asynchronous rejections. A
permanently pending sink also cannot block the return. Disabled/normal/failing/
pending sinks preserve the browser-call sequence, provider return/error and
method counts in actual semantic DOM tests. Separate actual Sidecar RPC tests
compare public outcome, journal method/phase/bootstrap/bound flags and provider
counts with diagnostics disabled/enabled, both for binding and rejection.

Reason enums remain local error metadata and are not serialized through RPC.
Asynchronous output can be incomplete or reorder records; it cannot be treated
as an authoritative ordered journal. Missing diagnostics must remain INCOMPLETE.
No fresh real exposure, timeout repair, frozen full or product PASS is claimed.
Independent source review must determine whether either later-exact case is an
acceptable production transient, compare deadline strategies, and specify the
unique next change/experiment before a behavior repair.
