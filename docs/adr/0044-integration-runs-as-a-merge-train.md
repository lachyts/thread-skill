# 0044 — Integration runs as a Merge train

Date: 2026-10-21
Status: deferred. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, then deferred in the re-grill the same day (§ Deferred). ADR 0030 decision 3's one-at-a-time Integration stands.

## Deferred

The re-grill audited where rollout time went from September to 21 October before ruling on the train's gaps. Stalls that hold the whole queue (a question, a halt, a gate, a dead lead or Mac), usage limits and machine load cost about 150 to 185 hours; the lane's real merge time cost about 35 to 50. In `chorus-rollout-2026-10-18` the 23-hour wait below was 15.2 hours of an overnight git-env halt, 0.7 hours of usage limits and about 6.6 hours of a busy lane, and on a stall-free stretch the one-at-a-time lane merged 1.15 PRs an hour against 0.76 approvals an hour. The train attacks the smallest of those costs and carries the largest open design gap (each car after the first is never up to date with the squash below it, so merge-task's head-contains-base guard refuses it). It returns only if the Run record shows the lane binding once stalls and load are dealt with; the design below is kept as the starting point.

## Context

ADR 0030 integrates one approved task at a time: the latest `main` merged in, the verifier re-run when `main` has moved since the task's base and, when needed, a short re-review. In `chorus-rollout-2026-10-18` the verifier (13,791 tests, 30 to 55 minutes under rollout load) was the unit cost of every merge. Approved PRs arrived at about the rate the lane could clear them, so the Integration queue never shortened: p84-5 took 46 minutes to build and then waited 23 hours to merge, and four other tasks waited 17 to 23 hours. At the pause 12 approved PRs were still queued, about 9 hours of lane at one suite each. That is the measurement ADR 0030 was waiting for.

## Decision

**The lane takes the head of the Integration queue as a Merge train: up to Train size approved tasks, stacked on the latest `main` in queue order, with the verifier run once at the top of the stack.**

- **Each car is still integrated on its own.** The first car merges in the latest `main` and each next car merges in the car below it; a conflict gets its integrator and each car its re-review, as in ADR 0030. Three things change. The verifier is shared, so an integrator resolves a car's conflict without running its own verify. The re-review counts the cars below as landed, so two cars sharing a file are re-reviewed as one-at-a-time Integration would re-review them. And each car's re-review runs before the shared verify, where ADR 0030's follows its verify.
- **Nothing is pushed until the train is green.** A car's merge of the car below stays in its worktree until the verify at the top passes, so a car can still leave the train: an unpushed merge can be undone, a pushed one never (no branch is ever force-pushed).
- **Green merges every car, in order,** each through merge-task. Today merge-task merges only when `origin/<default>` equals the base the task was integrated on, so it learns the train: each car's expected base is the squash commit of the car below, and each squash must leave the tree that car was integrated to. `main` ends on exactly the tree the verifier passed.
- **Red falls back.** The train is released, its unpushed merges are undone, and its cars go through the lane one at a time, so the failure is pinned on its own car.
- **Train size is a knob,** 4 by default, logged per train in the Run record (its cars, verify time and outcome) so a Reflection can raise or lower it (ADR 0032, 0037). Train size 1 is ADR 0030's Integration.

## Considered options

- **No cap** (everything ready rides one train): rejected for now. One failure in a long train costs the most to untangle; the Run record decides whether 4 should grow.
- **Only a cheaper suite** (inert paths, ADR 0045, and a parallel suite, one at a time): rejected as the whole answer. Both help, and both still pay one suite per merge.
- **GitHub's merge queue:** rejected. merge-task refuses a branch that requires one, because it cannot pin the base, and it stays the sole merger (ADR 0030 decision 2); not every repo has CI to run one either (Chorus has none).

## Consequences

- A car rejected at its re-review leaves the train, and the cars above it re-stack without it before the verify.
- The states `main` passes through on the way up (the first car alone, the first two) are never verified; only the top is. A merge that stops partway leaves `main` on one of them, and the cars not yet merged go back to the Integration queue, where they integrate on that `main` under ADR 0030's rule.
- UNVERIFIED and the git-env canary apply to the train as a whole: its window spans the stack and the verify. A RACE on any car stops the train's remaining merges, and that car takes ADR 0030's RACE path.
