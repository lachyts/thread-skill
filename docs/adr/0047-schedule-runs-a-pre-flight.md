# 0047 — Schedule runs a Pre-flight

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Brings ADR 0041's Readiness grade to `/thread:schedule`.

## Context

`/thread:schedule` queues every task it is given. A task that still hides a decision finds it in the plan gate, at whatever hour the queue reaches it: in `chorus-rollout-2026-10-18`, p80-1, p80-2 and p82-3 each had their plans rejected three rounds running, and p82-3 was on its second automatic retry when the rollout stopped. The Readiness grade (ADR 0041) already says which tasks an agent can finish without inventing a decision, but only the estate pass reads it. Lachy wants the least of his time spent overall, and he would rather spend some of it at schedule than have rollouts stall overnight.

## Decision

**Before a rollout note is written, schedule runs a Pre-flight: it grades every task still to start and settles the decisions with Lachy in one round. It runs no plan gate; a task's plan is still drafted and judged at its start (ADR 0030).**

- **Grade.** Each task gets its Readiness grade by `skills/_shared/readiness-grade.md`. Ready tasks enter the queue as they stand; One call and Grill tasks first get one Decision round with Lachy (ADR 0041), their answers written into their notes; Orient tasks stay out of the rollout.
- **Only a task still to start is graded.** A carried task (a `--regenerate` supersede) that has started keeps its state, as supersede already rules; a carried task still queued is graded like any other.
- **A task left out takes its Dependent closure with it,** so nothing queued waits on a task the rollout will never run.
- **Under orient-all, the estate pass has already graded these tasks and held the decision round** (ADR 0041), and its schedule forks ask nothing. The Pre-flight takes those grades and answers as they stand and asks no second round. A One call or Grill task the round never reached stays out of the rollout with its Dependent closure, like an Orient task, and the estate pass's report lists it as waiting on Lachy's answer, so it reaches the next round: nothing enters a queue with a decision open.

## Considered options

- **Plan-gate every queued task at schedule as well:** ruled on 2026-10-21, then dropped in the re-grill the same day. The audit of where rollout time went found October's plan blocks nearly all converging on one automatic retry with a pinned plan (ADR 0033), about an hour each and with no act from Lachy; the overnight losses came from blocks that needed his decision, which the decision round catches, and ADR 0048 turns any left into a set-aside task rather than a held queue. A plan gate at schedule also met four gaps: carried tasks already built, a git-env window with no rollout note yet, tasks `plan_approval` exempts from a plan gate, and orient-all forks that cannot ask about a rejected plan.
- **Pre-flight plans only:** rejected. Plans drafted around an undecided question are judged on a guess.
- **Raise `max_plan_rounds`:** rejected. Three rounds with accumulated feedback already converge when the decision is on record; when it is not, more rounds only repeat the rejection.

## Consequences

- Schedule costs one grading pass and, when any task needs it, one decision round, paid while Lachy is around.
- Schedule step 8's existing "Pre-flight —" report blocks (gated tasks, capture-shaped notes and the rest) are renamed when this is built, so the word names this pass alone.

## Build rulings

Rulings made while P29 is built (the p29-5 plan, 2026-10-26; `skills/schedule/SKILL.md` § 1.5 is canonical). Each is a plan's reading of the Decision above, and each awaits Lachy's confirmation.

- **The word.** Schedule step 8's report blocks are now `Checklist —` (gated tasks, capture-shaped notes, the rollout clone, local copies agents won't see, a refused ladder, legacy values left in place, unfinished-rollout warnings), so "Pre-flight" names this pass alone. Its own report is step 8's **Pre-flight's left-out tasks.** block and the summary's `Pre-flight:` line.
- **The serial path is graded too.** S3.5 runs the Pre-flight over a serial run's chain members, after S3, so an orient-invoked run (orient § 6 or § 7) may ask its round: decisions, never a confirm. A member that leaves re-runs S2 and S3 without it.
- **One question per AskUserQuestion call.** The round asks One calls, then each Grill's decisions (`(k/n)`), then the ungraded tasks, each with its recommendation first.
- **An ungraded task is asked, never guessed.** A task the grading could not grade (an answer still invalid after one re-ask, a task the scan cannot see, one in flight) is asked `Leave it out` (recommended) or `Queue it as it stands`, and the answer is recorded through `record --by schedule`. A refused write is named in step 8, and the answer still governs the run.
- **A refused record leaves its task undecided.** A One call or Grill whose `record` refuses stays out with its Dependent closure, its answer named as unrecorded: nothing enters a queue with a decision that is not on its note.
- **A carried queued task left out is deferred out of the prior at step 6**, by `reconcile-rollout.py defer --tasks <slugs> --rollout <prior>` run from the prior's root, before the carry, so the carry never takes it and it is never left stamped to the prior. The alternatives weighed:
  - a new `carry --leave` flag: rejected, because a prior's Engine snapshot can predate it, and the carry runs from that snapshot;
  - carrying everything, then a `defer --rollout <this note>` from this run's root at step 7: the fallback, at the cost of a `carried` Run-record line for a task never queued, and carry's legacy mapping on it;
  - a hand edit: untestable.
- **Which root each command runs from (ADR 0043, cross-version).**
  - *This run's root*: `estate-scan.py`, `estate-dispatch.py` `slices --tasks/--superseding`, `preflight`, `record --by/--superseding` and `log`, and `estate-rank.py rank --superseding`. All are unguarded and write no rollout note. `record` writes a carried queued task's `## Decisions (asked ahead <date>)` bullet, a form every engine reads as note text, and descope reads `## Decisions…` as recorded in every version; a supersede cancelled before step 6 leaves those answers for the prior's own run to read.
  - *The prior's root*: the ten prior-acting commands, each with only the flags it had at the first Engine snapshot: carry `--from`, `--to`, `--dry-run`; defer `--tasks`, `--rollout` (since p12-8); resume, the canary's `check-all` and `retire`, `--rollout`; close-score `--rollout`, `--close`.
  - *The rule*: a new flag on a prior-root command must exist on the oldest snapshot a live prior can name, or the work runs from this run's root. `tests/contracts/schedule-preflight.test.mjs` p12 pins it.
- **The Grade log.** Every schedule run that grades logs its grades (a standalone run, and one under orient § 6 or § 7); an orient-all fork logs nothing, since the estate pass logged them. A schedule regrade ends an estate episode as `regraded`.
- **Under orient-all, the fork's prompt carries the pass's rank and scan and the decided slugs among its members.** The fork runs only `preflight`: its `--tasks` is its step 1's confirmed candidates, and its `--decided` the decided slugs among them, so a slug its step 1 skipped is never passed.
