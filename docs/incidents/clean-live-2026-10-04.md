# Controlled Windows exposure, 2026-10-04

Outcome: FAILED before PLAN. No product acceptance is claimed.

- Consumer HEAD: b83e31ce647866c5b7a1b4b0a76e91b414f8b982.
- Producer HEAD: 0afd708c288b079096affbfeff4626dcf9a19bf1.
- Evidence root: C:/Users/jingc/AppData/Local/Temp/planner-executor-live-fR3imE.
- Run ID: 4b8cba31-c644-4165-95fb-868d451bfd4d.
- Phase-one executor PID: 24664.
- Explicit product target: 1131E553E79CBFB4B151FD60D6EDBEF1.
- Private Sidecar state: LocalAppData/PlannerBridge/acceptance/clean-live-a3556b9e218c4e88b15cb45e9f099354.

Prerequisites verified: both repository HEADs, clean producer worktree, consumer worktree containing only the user-provided untracked clean-goal file, packed lib equality with current build, dedicated Chrome profile and loopback listener, visible empty composer, authenticated real Sidecar readiness and graceful shutdown. Windows WTS flags were not captured; document visibility is not a substitute for that gate. Credentials were read from the user's private .env without printing them. CLI and exposure executable paths were interpreted from its prose and checked for existence.

The local doctor dispatch at 1791072289970 failed at 1791072334012 with TUNNEL_START_TIMEOUT: TUNNEL_CONTROL_PLANE_UNAVAILABLE (about 44 seconds including doctor work). The executor then dispatched app-proof at 1791072334016. Observation detected this after dispatch; the operator stopped executor PID 24664 and its tunnel child PID 35580. This is not proof that the runner automatically stops on its first failure. No new run was launched.

The verifier terminated with code 4294967295 and all acceptance fields false. Preserve observed.jsonl, run-1.log, install.log, owned-target.json and result.json in the evidence root. These files are diagnostic artifacts, not independent review evidence.

The supervisor classification means its authenticated control-plane success predicate was not satisfied before the startup deadline. It does not establish a network, credential or server root cause. No raw tunnel health snapshot or child diagnostic was captured before termination. Do not infer authentication failure from this classification, increase timeouts, or retry the exposure without independent failure review and a newly justified gate.

Next action: independent review of the frozen evidence and current supervisor/acceptance runner, including the runner's failure-stop behavior. Root cause remains UNKNOWN; PLAN, implementation, review, restart/reconnect, second review and original oracle remain unverified.
