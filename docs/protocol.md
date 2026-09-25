# D2C Protocol

Version 1. Machine-parsed control-plane envelopes exchanged between the DSH coordinator and ChatGPT Web. Adapted from the C2C `[C2C]` envelope (codex-with-chatgpt, MIT) with machine validation upstream lacks.

## Wire format

```
[D2C]
VERSION: 1
STATE: PLAN
TASK_ID: d2c_a1b2c3
ITERATION: 2
IN_REPLY_TO: 1
<EXT_HEADER: value>

ACTIONS:
1. Do the thing
2. Add tests

SUCCESS_CRITERIA:
Theme toggles without reload.
```

- Envelope ≤ 8192 bytes total; each section ≤ 4096; headers ≤ 512.
- Sections are `NAME:` with an empty value followed by the body; headers are `NAME: value`.
- Free conversational text may surround the envelope (replies are parsed by locating `[D2C]`, taking the **last** envelope in the text).

## Headers

| Header | Required | Meaning |
|---|---|---|
| VERSION | yes | Protocol version, must equal `1` |
| STATE | yes | Envelope state (below) |
| TASK_ID | yes | `d2c_` + 4–32 lowercase alphanumerics |
| ITERATION | yes | Monotonic round counter (INIT sends 0) |
| IN_REPLY_TO | when replying | ITERATION of the envelope being answered |
| WORKSPACE_ID | DSH sends; ChatGPT must echo | Stable non-secret id from `workspace_info.workspaceId`; prevents cross-workspace App/connector mistakes |
| HEAD | EXECUTED review rounds | Exact committed HEAD; ChatGPT must echo it in DONE/fix PLAN after independent verification |

## States and senders

| State | Sender | Meaning |
|---|---|---|
| INIT | dsh | New task + goal (+ boot prompt on first contact) |
| PLAN | chatgpt | Plan (or fix plan) for the current iteration |
| EXECUTING | dsh | Execution in progress (informational) |
| EXECUTED | dsh | Implementation round done; review requested |
| REVIEW_REQUEST | dsh | Alias posture for explicit review focus |
| DONE | chatgpt | Reviewer verified the result |
| BLOCKED | either | Needs the user |
| ERROR | either | Fatal for this task |
| HANDOFF | dsh | Context transfer (long task, compacted session) |

Section vocabulary per state (parser rejects unknown sections):

- INIT: GOAL, INSTRUCTION
- PLAN: GOAL, RATIONALE, ACTIONS, FILES_LIKELY_INVOLVED, TESTS, SUCCESS_CRITERIA
- EXECUTING: NOTE
- EXECUTED: RESULT, CHANGED_FILES, TESTS, NOTE
- REVIEW_REQUEST: FOCUS
- DONE: SUMMARY
- BLOCKED: REASON, NEEDS
- ERROR: REASON
- HANDOFF: ORIGINAL_GOAL, PROGRESS, CURRENT_STATE, KNOWN_ISSUES, NEXT_EXPECTED_STEP

## State machine (coordinator side)

```
awaiting-plan --PLAN--> planned --(DSH executes)--> executing
executing --(EXECUTED sent)--> awaiting-review
awaiting-review --DONE--> done
awaiting-review --PLAN--> planned        (fix round, iteration++)
any --BLOCKED/ERROR--> blocked/error (user)
```

Rejection rules (machine-enforced, `ProtocolError` with stable reasons):

- `unknown-task` — reply for an untracked TASK_ID
- `unexpected-reply` — reply while not waiting for ChatGPT
- `stale-reply` — reply state cannot satisfy the current wait (e.g. DONE before any plan)
- `stale-iteration` — `ITERATION < expected` where expected is `IN_REPLY_TO ?? current`
- `wrong-sender` — a side sent a state it may not send
- `workspace-mismatch` — ChatGPT did not echo the exact workspace id verified through MCP
- `review-head-mismatch` — review did not acknowledge the exact EXECUTED HEAD
- `iteration-limit` — autonomous fix/review loop exceeded configured `maxIterations`
- `version-mismatch`, `bad-task-id`, `bad-header`, `section-too-large`, `envelope-too-large`

## Size discipline

The composer carries only envelopes + short prose. Files, diffs, and logs flow through the read-only MCP data plane (`git_diff` is byte-capped at 256KiB default; `read_file` at 128KiB with head+tail; execution output tails at 16KiB/200 lines).


## Unattended runtime invariants

The ChatGPT App is activated for every outgoing MCP-dependent control message. Before PLAN, ChatGPT is instructed to call `workspace_info` and echo its `workspaceId`. Before DONE/fix PLAN after EXECUTED, ChatGPT independently checks git/test evidence and echoes both `WORKSPACE_ID` and exact `HEAD`.

These headers are control-plane identity checks; source, diffs, and logs stay on the read-only MCP data plane.
