# Rollout redesign progress

Plan: Thread rollout redesign, authorised 2026-09-22. Baseline: 2063f818800b7a3d905e4af0051d01806baf3536.

| Work | State | Ownership / evidence |
| --- | --- | --- |
| Glossary, ADRs, audit, implementation spec | In progress | Lead |
| Merge safety | In progress | safe_merge; merger and isolated regression suite |
| Reconciliation safety | In progress | safe_reconcile; reconciler and its suite |
| Convergence safety | In progress | rollout_code_review; workflow and engine tests |
| Durable preparation and execution state | Pending | Lead |
| Task readiness and native continuation | Pending | Lead |
| Compatibility, independent review, acceptance | Pending | Lead |

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
