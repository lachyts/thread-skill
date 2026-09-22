---
status: consumed
repo: thread-skill
harness: codex
effort: xhigh
scope: protocol 4 host, integration fixtures and Claude continuation driver
---
# Native host and continuation review

Independent bundled Codex review-agent, refute_doc_candidates. Read-only native reviews; no model CLI, live GitHub mutation or authenticated unattended acceptance. Existing tests passed before the additional fault injections, which exposed missing cases.

| Finding | Resolution and evidence |
| --- | --- |
| P1 Reconcile every unfinished merge intent before draining | Reserved and reported-merged checkpoints now remain held until fresh queue/landing evidence is applied. Uncertain work reports attention, not evidenced waiting. |
| P1 Recover the destination owner's interrupted transfer lock | Exact persisted transfer intent permits its proven-dead destination lock to be recovered; a changed transfer does not. |
| P1 Recover the repository merger lease | Recovery includes the repository lease, preserving owner identity and explicit epoch checks. |
| P2 Derive replacement PR identity from actual landings | Historical landing evidence selects a new PR identity even when an old queue report still said pending. |
| P2 Clear queue attention on terminal resolution | Closed/merged operations clear stale queue counters and attention; independent work continues. |
| P1 Use the execution epoch after an earlier ownership transfer | The predecessor comparison now takes the top-level execution epoch. The initial fix was insufficient for a second owner; the multi-transfer regression covers it. |
| P1 Fence a surviving merger before releasing its lease | Actual SIGKILL reproduction showed a detached merger surviving while recovery released its lease. A durable versioned process lease, start gate and parent-liveness supervisor now fence it. Recovery refuses live/unknown groups and legacy PID-only leases. |
| P2 Surface attention-required waits in the Stop driver | Explicit host attention is reported even while waiting. Ordinary waits remain quiet and terminal states remain stopped; 21 driver tests pass. |

The initial host review's five findings were fixed and narrowly rechecked. That recheck exposed the subsequent-owner epoch case, now passing. A separate hard-crash probe confirmed the surviving-subprocess issue above. Its final narrow independent recheck reported no findings: six focused tests passed, and an extended actual SIGKILL fixture proved that recovery refuses a surviving group, retains the uncertain remote intent after termination, and reconciles it under the new owner before clearing attention. The probe used fixture GitHub commands, not a live external merge. The macOS pinned-host CLI entry path also now resolves filesystem aliases before comparing its entry point.

State transitions and adapter ownership have separate review records. The documentation application pass resolved parallel admission, exact payload/recovery shapes and explicit v4 schedule routing. A final documentation review found the missing covered-gate operation; implementation and scoped recheck now pass with unchanged authority and allowances.

Fixture review does not establish actual native heartbeat delivery or GitHub merge/recovery behaviour in either harness. Those remain the explicit release gate.
