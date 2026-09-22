# Rollout redesign progress

Plan: Thread rollout redesign, authorised 2026-09-22. Baseline: 2063f818800b7a3d905e4af0051d01806baf3536.

| Work | State | Ownership / evidence |
| --- | --- | --- |
| Glossary, ADRs, audit, implementation spec | Complete | 7038654; accepted target, implementation pending |
| Merge safety | Implemented and tested | 38a14f7; 22 merger regressions, 12 classifier checks |
| Reconciliation safety | Implemented and tested | 38a14f7; existing suite plus 26 regressions |
| Convergence safety | Implemented and tested | 38a14f7; 19 new tests plus existing prompt invariants |
| Durable preparation and execution state | Implemented and independently reviewed | 6e394c4, 8594c52, ebcf1cb; 37 domain tests |
| Task readiness and native continuation | Implemented and independently reviewed candidate | Host bridge, Claude driver; shared adapter candidate in separate worktree, 42 tests |
| Compatibility and skill application | Documented and checked | Explicit v4 pilot routing, pinned runtime, payload reference; six application scenarios reviewed |
| Live unattended acceptance and release | Not complete | Actual Claude and Codex runs, recovery and external merges still required before promotion |

## Preflight

| Interfaces | Check / resolution |
| --- | --- |
| Glossary → ADRs → runtime | New meanings are accepted target semantics; v3 retains its explicit legacy contract. |
| Safety fixes → live v3 | Backwards compatible defaults; new identity fields optional until protocol upgrade. |
| Convergence → readiness | Invoke the same convergence engine once per ready task; no second convergence loop. |
| Native host → durable record | One owner, cumulative allowances, immutable attempts and recorded native launch evidence. |
| Merger → completion | Only confirmed merge of approved repository/base/head can satisfy a task. Queue admission remains waiting. |
| Preparation → launch | Local repository/base/verifier resolution precedes workers. Approval covers effects before launch. |
| Acceptance → release | Fixture evidence cannot be labelled live unattended acceptance. Both harnesses require their own native live evidence. |

Ruling: independent, disjoint safety files may be implemented in parallel as authorised by the user's parallel-work preference; parent alone integrates shared interfaces.
Ruling: preserve v3 execution semantics and introduce protocol 4 explicitly; do not silently migrate a live rollout.
Ruling: release readiness must distinguish implemented/tested code from unavailable live cross-harness validation. No model CLI may impersonate a native child.

## Independent review

Native bundled reviewers reproduced three introduced safety integration issues and five state lifecycle issues. Fixes have regression coverage. A scoped recheck caught one remaining terminal-request cleanup path; it was removed. Shared adapter review found stale ownership evidence could replay after A→B→A; ownership epochs now fence both transfer evidence and ordinary transactions.

The rollback review found two further accounting/replay defects, both fixed and independently rechecked. The continuation review found an attention-required queued wait was silently released; the host now exposes an explicit attention signal and the hook reports incomplete. The skill application check found three instruction gaps (serial-looking dispatch, missing payload/evidence shapes, and ambiguous v4 schedule routing); all were resolved and the six scenarios rechecked without further findings.

The host review additionally found unfinished merge-intent checkpoints, recovery locks, post-landing PR identity and stale queue-attention defects. Fixes have targeted crash/replay regressions. A subsequent-owner epoch issue and actual surviving-merger SIGKILL reproduction were also fixed. Final scoped rechecks report no findings. The process lease is recorded before side effects; parent death terminates the merger group, and recovery refuses a still-live group while preserving uncertain remote outcomes. See [host review](../reviews/2026-09-22-native-host.md), [state review](../reviews/2026-09-22-rollout-state.md) and [safety review](../reviews/2026-09-22-rollout-safety.md).

The final documentation review exposed a missing operation for semantically covered gate declarations. `cover-gate` now records coverage against the same authority/current revision and supplies its evidence to independent review, without granting authority, refreshing allowance or clearing deliberate pauses. State and host binding tests plus an independent recheck pass.

## Acceptance evidence

| Domain promise | Evidence |
| --- | --- |
| Completed task releases dependant while a peer runs | Domain regression and integrated real-engine/native-adapter fixture |
| Block holds only dependency closure | Domain regression and host independent-task fixture |
| Revision invalidates review/completion | Domain and host source-change fixtures |
| Seven complete, three blocked ends only the execution | Domain regression |
| Restarts retain allowance; relaunch renews requested unfinished scope | Domain, host recovery and substitution fixtures |
| Pause drains without follow-ons | Domain and Claude driver fixtures |
| Queue/head/replay cannot falsely advance | Merger, state, host and continuation regressions |
| Revert invalidates outcomes and revalidates dependants | Domain rollback/history and real local Git host fixture |
| Unattended execution and recovery in each live harness | **Outstanding**; harness-name fixtures do not establish this |

The three integrated tests execute the actual convergence engine and candidate shared native adapter against local Git, using fixture model results and GitHub responses. They cover both owner-harness bindings, mid-request recovery, exact-head approval and immediate follower admission. They are not live authenticated native or GitHub acceptance.

## Final validation

| Suite | Result |
| --- | --- |
| Domain transitions | 37 passing tests |
| Durable host | 33 passing tests, including actual local SIGKILL and process-group recovery |
| Canonical engine + shared adapter integration | 3 passing fixtures; explicit candidate adapter path supplied |
| Shared native adapter | 42 passing tests |
| Engine safety / prompt compatibility | 20 Node tests, including 19 safety cases and the existing prompt-invariant runner |
| Merger | 22 regressions; 12 check-classifier checks |
| Reconciliation | Existing suite plus 26 regressions |
| Continuation drivers | Existing v3/mixed-session suite plus 21 v4 tests |
| Source checks | JavaScript/Python syntax, JSON example parsing, local documentation links and whitespace checks pass |

Reproduce the domain/host/engine checks with `node --test skills/execute/tests/rollout-state.test.mjs skills/execute/tests/rollout-host.test.mjs skills/execute/tests/engine-safety.test.mjs skills/execute/tests/prompt-invariants.test.mjs`. The real-adapter fixture requires `THREAD_TEST_NATIVE_ADAPTER` pointing to the candidate `_shared/scripts/native_workflow.mjs`, then `node --test skills/execute/tests/rollout-integration.test.mjs`. Run the four shell suites in `skills/execute/tests/` separately. The shared adapter suite is `_shared/scripts/tests/native_workflow.test.mjs` in its own repository. No test above authenticates a real unattended merge run.

## Integration dependency

The shared adapter candidate lives in `/Users/lachlants/.codex/worktrees/thread-native-recovery`, branch `codex/thread-native-recovery`. It is intentionally separate from the live shared workspace. Protocol 4 preparation must name an adapter containing the accepted recovery API; existing installed adapters are not silently replaced.

Shared adapter implementation/review commits: `42263b4`, `192244e`; migration evidence: `5cb5b72`. The remaining live gate is saved as [Thread v4 native acceptance](/Users/lachlants/repos/obsidian/Work/Tasks/thread-rollout-v4-native-acceptance.md), linked to Thread Skill and Shared Skills. R-WAVE remains open. The calling Codex session cannot stand in for a native Claude run; its implementation/review children and simulated harness labels are not rollout acceptance evidence.
