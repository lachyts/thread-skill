# 0044 — Integration runs as a Merge train

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Amends ADR 0030's one-at-a-time Integration.

## Context

ADR 0030 integrates one approved task at a time: the latest `main` merged in, the verifier re-run and, when needed, a short re-review. In `chorus-rollout-2026-10-18` the verifier (13,791 tests, 30 to 55 minutes under rollout load) was the unit cost of every merge. Approved PRs arrived at about the rate the lane could clear them, so the Integration queue never shortened: p84-5 took 46 minutes to build and then waited 23 hours to merge, and four other tasks waited 17 to 23 hours. At the pause 12 approved PRs were still queued, about 9 hours of lane at one suite each.

## Decision

**The lane takes the head of the Integration queue as a Merge train: up to Train size approved tasks, stacked on the latest `main` in queue order, with the verifier run once at the top of the stack.**

- **Each car is still integrated on its own.** Its merge of the car below it (the first car's, of `main`), its conflict resolution and its re-review run as ADR 0030's Integration does; only the verifier is shared.
- **Green merges every car, in order.** Each car's branch already carries the cars below it, so `main` ends on exactly the tree the verifier passed.
- **Red falls back.** The train is released and its cars go through the lane one at a time, so the failure is pinned on its own car.
- **Train size is a knob,** 4 by default, logged per train in the Run record (its cars, verify time and outcome) so a Reflection can raise or lower it (ADR 0032, 0037). Train size 1 is ADR 0030's Integration.

## Considered options

- **No cap** (everything ready rides one train): rejected for now. One failure in a long train costs the most to untangle; the Run record decides whether 4 should grow.
- **Only a cheaper suite** (inert paths, ADR 0045, and a parallel suite, one at a time): rejected as the whole answer. Both help, and both still pay one suite per merge.
- **GitHub's merge queue:** rejected, as in ADR 0030. merge-task stays the sole merger, and the repos have no CI to run it.

## Consequences

- A car rejected at its re-review leaves the train, and the cars above it re-stack without it before the verify.
- RACE, UNVERIFIED and the git-env canary apply to the train as a whole: its window spans the stack and the verify, and a RACE on any car halts the train.
