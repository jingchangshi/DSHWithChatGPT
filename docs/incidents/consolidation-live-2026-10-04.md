# Controlled consolidation acceptance — 2026-10-04

Outcome: FAILED before PLAN. Automatic readiness fail-stop VERIFIED in the real DSH process; complete product acceptance is not claimed.

- Consumer production candidate: 2fef84407d1e2c41e2b093b683345a56987530bd.
- Producer: 0afd708c288b079096affbfeff4626dcf9a19bf1, unchanged.
- Packed installation: dsh-chatgpt-package-M5QQYF; profile composition: dsh-chatgpt-profile-vmRdB6.
- Run: d921ba4b-290d-4458-8679-e961d21764ba, phase-one PID 31604.
- Explicit fresh product target: 39135EAD4B8309E38E472757A99C8BA6.
- Runtime evidence root: C:/Users/jingc/AppData/Local/Temp/planner-executor-live-sWMAYZ; [durable evidence](../evidence/consolidation-2026-10-04/README.md).

Before exposure, frozen full passed 94 files / 1,327 tests / 3 original skips; all 230 input hashes remained unchanged. Package/import/private replay and two profile composition runs passed. All 174 consumer lib files matched built, packed, isolated-installed and actual live-installed copies; 28 installed Producer runtime modules matched the Producer build. WTS SessionFlags=1 was measured immediately before native preflight. The exact target was logged in, visible with one empty composer. Authenticated native Sidecar readiness, graceful shutdown and transport closure passed with a separate private preflight journal. These gates do not prove App readiness.

The one controlled run dispatched explicit local doctor at 1791078161159. It returned an error at 1791078204667: TUNNEL_START_TIMEOUT: TUNNEL_CONTROL_PLANE_UNAVAILABLE. The observer recorded READINESS_LOCAL_FAILED at the same timestamp and requested graceful shutdown. No App-proof or PLAN dispatch and no phase-two boot occurred. DSH exited 0, the verifier/oracle exited 1 and every product acceptance field was false. No manual stop or retry was used. The owned executor, Sidecar listener and tunnel child were absent after shutdown.

The finite diagnostic was captured before tunnel shutdown: schemaSupported/live/ready=true, controlStatusOk=false, consecutiveFailures=1, lastSuccessValid=false, httpStatus=null, localProbeSucceeded=true. These are the last parsed health predicate facts. They establish failure to satisfy authenticated control-plane readiness before the unchanged startup deadline; they do not distinguish credential, network or server cause. Root cause remains UNKNOWN. They cannot retroactively explain the historical exposure.

Independent product PLAN, execution, nonce review, fix PLAN, restart/reconnect and same-round DONE remain unverified. Producer original Windows Git gate separately failed its unchanged 5-second total fixture deadline; actual lock/unlock qualification remains NOT_RUN. Current next action is in [status/current.md](../status/current.md).
