# Routing evals — 2026-09-28, orient reshuffle (PR #32)

`claude plugin eval . --ablation none --runs 1 --max-cost-usd 5 --no-publish --threshold 0 -j 2`,
full suite of 18 cases, one run each, on the `feat/orient-reshuffle` tree (manifest 2.8.0). Cost
$3.34.

| case | score |
|---|---|
| reshuffle-loose-tasks-into-roadmap (new: routes to orient, not schedule) | 1.00 |
| scoped-reshuffle-plan-into-tasks (new: routes to orient, not schedule) | 1.00 |
| orient-project-after-time-away | 1.00 |
| schedule-plan-the-waves | 1.00 |
| status-whats-left | 1.00 |
| execute-run-the-rollout, repair-stuck-rollout | 1.00 |
| every continuity and lifecycle case except the one below | 1.00 |
| handoff-manual-dry-run | 0.83 (the `lifecycle` LLM judge voted FAIL ×3; every tool and regex grader passed) |

Reading: the new orient triggers ("turn these tasks into a roadmap", "break this plan into
numbered, phased tasks") route to orient, and neither collides with schedule or status. The one
miss is in handoff, which PR #32 does not touch: a single nondeterministic run, worth re-running
before treating it as a regression.
