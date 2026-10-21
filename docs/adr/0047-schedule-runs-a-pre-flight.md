# 0047 — Schedule runs a Pre-flight

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Brings ADR 0041's Readiness grade to `/thread:schedule`.

## Context

`/thread:schedule` queues every task it is given. A task that still hides a decision finds it in the plan gate, at whatever hour the queue reaches it: in `chorus-rollout-2026-10-18`, p80-1, p80-2 and p82-3 each had their plans rejected three rounds running, and p82-3 was on its second automatic retry when the rollout stopped. The Readiness grade (ADR 0041) already says which tasks an agent can finish without inventing a decision, but only the estate pass reads it. Lachy wants the least of his time spent overall, and he would rather spend some of it at schedule than have rollouts stall overnight.

## Decision

**Before a rollout note is written, schedule runs a Pre-flight: it grades every task still to start and settles the decisions with Lachy in one round. It runs no plan gate; a task's plan is still drafted and judged at its start (ADR 0030).**

- **Grade.** Each task gets its Readiness grade by `skills/_shared/readiness-grade.md`. Ready tasks enter the queue as they stand; One call and Grill tasks get one batched decision round with Lachy first, their answers written into their notes; Orient tasks stay out of the rollout.
- **Only a task still to start is graded.** A carried task (a `--regenerate` supersede) that has started keeps its state, as supersede already rules; a carried task still queued is graded like any other.
- **A task left out takes its Dependent closure with it,** so nothing queued waits on a task the rollout will never run.
- **Under orient-all, the estate pass has already graded these tasks and held the decision round** (ADR 0041), and its schedule forks ask nothing. The Pre-flight takes those grades and answers as they stand and asks no second round.

## Considered options

- **Plan-gate every queued task at schedule as well:** ruled on 2026-10-21, then dropped in the re-grill the same day. The audit of where rollout time went found October's plan blocks nearly all converging on one automatic retry with a pinned plan (ADR 0033), about an hour each and with no act from Lachy; the overnight losses came from blocks that needed his decision, which the decision round catches, and ADR 0048 turns any left into a set-aside task rather than a held queue. A plan gate at schedule also met four gaps: carried tasks already built, a git-env window with no rollout note yet, tasks `plan_approval` exempts from a plan gate, and orient-all forks that cannot ask about a rejected plan.
- **Pre-flight plans only:** rejected. Plans drafted around an undecided question are judged on a guess.
- **Raise `max_plan_rounds`:** rejected. Three rounds with accumulated feedback already converge when the decision is on record; when it is not, more rounds only repeat the rejection.

## Consequences

- Schedule costs one grading pass and, when any task needs it, one decision round, paid while Lachy is around.
- Schedule step 8's existing "Pre-flight —" report blocks (gated tasks, capture-shaped notes and the rest) are renamed when this is built, so the word names this pass alone.
