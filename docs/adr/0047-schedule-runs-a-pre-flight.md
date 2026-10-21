# 0047 — Schedule runs a Pre-flight

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Brings ADR 0041's Readiness grade to `/thread:schedule`.

## Context

`/thread:schedule` queues every task it is given. A task that still hides a decision finds it in the plan gate, at whatever hour the queue reaches it: in `chorus-rollout-2026-10-18`, p80-1, p80-2 and p82-3 each had their plans rejected three rounds running, and p82-3 was on its second automatic retry when the rollout stopped. The Readiness grade (ADR 0041) already says which tasks an agent can finish without inventing a decision, but only the estate pass reads it. Lachy wants the least of his time spent overall, and he would rather spend some of it at schedule than have rollouts stall overnight.

## Decision

**Before a rollout note is written, schedule runs a Pre-flight: it grades every task, settles the decisions with Lachy in one round, and runs the plan gate on every task it queues.**

- **Grade.** Each task gets its Readiness grade by `skills/_shared/readiness-grade.md`. Ready tasks enter the queue as they stand; One call and Grill tasks get one batched decision round with Lachy first, their answers written into their notes; Orient tasks stay out of the rollout.
- **Plan.** Every queued task's plan is drafted and judged by the engine's plan gate before launch, and the approved plan is kept on the note with the commit it was judged on.
- **A plan stands at the start** unless `main` has since moved in the files the plan names; then the gate re-runs with the kept plan as its draft.

## Considered options

- **Grade and decision round only:** rejected. Cheaper, but a grade is a reading of the note; the plan gate is what found p80-1's and p82-3's gaps.
- **Pre-flight plans only:** rejected. Plans drafted around an undecided question are judged on a guess.
- **Raise `max_plan_rounds`:** rejected. Three rounds with accumulated feedback already converge when the decision is on record; when it is not, more rounds only repeat the rejection.

## Consequences

- Schedule now costs one plan-gate run per task, paid while Lachy is around, and takes longer to write a rollout.
- The plan gate's run at launch is usually skipped, so a rollout's first hours go to building, not planning.
