# Tunnel control-plane prerequisite — 2026-10-04

Outcome: FIXED and VERIFIED for the owned tunnel boundary, including the packed
installation. Product Planner–Executor acceptance remains unverified.

Candidate: a4679a4f3a93aef9f4cdeec62970c0dffd8ad139. Producer remains
0afd708c288b079096affbfeff4626dcf9a19bf1, unchanged. Client:
0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0.

## Cause established by new diagnostics

There was no competing tunnel-client. Windows had a verified loopback proxy
listener and enabled desktop proxy settings, but the launch environment had no
proxy variable. The client defaults to https://api.openai.com and supports an
explicit control-plane-only proxy. Desktop settings did not supply that route
to the child.

With the same private runtime key, tunnel ID, client and embedded MCP stub, the
direct diagnostic never satisfied the original 40-second readiness budget. Its
poll reported network_error, its metadata connection timed out, and health
reported no authenticated success. A separate non-authenticated curl diagnostic
also timed out on direct HTTPS in 8 seconds; the explicit proxy returned an HTTP
response in 0.498 seconds. Root-path HTTP 421 is connectivity evidence only.

Changing only the control-plane proxy in the tunnel diagnostic produced an
authenticated successful poll with zero failures at 31.299 seconds. This
demonstrates that the credentials and control-plane access work via that route.
It does not identify whether DNS, firewall or upstream routing caused the direct
failure, nor retroactively establish the cause of an earlier run whose raw
transport evidence was not retained.

A second, independent startup mismatch was established: the first empty poll
requests a 30-second server wait by default, exceeding the plugin's 20-second
default startup budget. The proxy-only diagnostic confirmed that an idle healthy
tunnel took about 31 seconds. The earlier product runner used 40 seconds and
still failed on its direct route; that failure cannot be attributed to the
20-second mismatch.

## Change

Managed launch and preview now use the same argument builder. The optional
CONTROL_PLANE_HTTP_PROXY is passed as env:CONTROL_PLANE_HTTP_PROXY to
--control-plane.http-proxy. Configuration may choose another private environment
variable name. Proxy changes close/rebind the owned child. No desktop-registry
discovery or global proxy override was added.

The client requests a 1-second first poll wait. Its HTTP deadline and steady
30-second polling remain unchanged. The original startup deadline and strict
readiness predicate remain unchanged. Startup errors redact the captured key,
proxy URL and URL userinfo. Failure records add a recognized network-error
boolean and bounded poll timings without copying raw errors.

The existing private deployment .env now contains the verified loopback proxy
reference. Secrets and that file are outside Git. DSH launchers must load the
variable into their environment, as documented in installation.md.

## Acceptance

Corrected causal RED: 5 failed / 17 passed in the two tunnel suites before the
source change. Final focused validation: 5 files / 70 passed, including tunnel
lifecycle/readiness, DSH schema/boundary and canonical production composition.
Typecheck, build, packed-package verification and the installed two-boot profile
composition check passed.

The first built-artifact diagnostic observed all health predicates passing in
5.529 seconds, then failed its own incorrect assertion: its counter monitored
the bridge's rejection log instead of successful requests. That failed record
is retained. The corrected verifier observes real HTTP response completion;
it does not alter the production bridge implementation.

The packed installed candidate passed the corrected verifier in 5.553 seconds
within the unchanged 20-second startup budget. Observed health: schema 1,
live/ready=true, control status=ok, zero consecutive failures, valid last_success,
local probe=succeeded. After startup, configured/effective poll wait=30 seconds,
HTTP deadline=35 seconds. Three authenticated successful bridge requests from
the tunnel were observed before the verifier's own auth probe; that probe also
verified rejection without the bearer and success with it. No workspace tools
were registered. Product messages=0.

Shutdown removed the health pointer, stopped the exact child and closed both
health and bridge endpoints. The packed/built module association and retained
profile results are in the [evidence](../evidence/tunnel-control-plane-2026-10-04/README.md).

This verifies secure exposure startup. It does not prove remote ChatGPT App
reads, PLAN, nonce review, fix PLAN, restart/reconnect or same-round DONE. The
original failed product run remains unchanged. Producer Windows Git timing and
actual Windows lock/unlock qualification remain separate unresolved gates.
