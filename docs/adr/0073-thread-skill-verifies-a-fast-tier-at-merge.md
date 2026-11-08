# 0073 — Thread Skill verifies a fast tier at merge, and measures its suite and its CI

Date: 2026-11-07
Status: proposed. Grilled with Lachy on 2026-11-07, from the close of `thread-skill-rollout-2026-11-06`, whose
last two tasks (PRs #324 and #326) were set aside at merge by a macOS CI timeout. Adopts estate ADR 0009 d6
(a declared fast tier at Integration) and estate ADR 0011 (a suite keeps its budget) for Thread Skill itself.

## Context

Thread Skill's engine already supports a project that verifies a fast tier at Integration and runs its
full suite once at completion (**Completion verifier**, ADR 0052, ADR 0055, ADR 0062's **Verify base**).
Thread Skill never declared one for itself: every rollout's `verifier:` is the full `make test`.

By 2026-11-06 that full suite cost, on every merge, one at a time in the Integration lane:

- **On the Mac:** a median of 17 minutes per Integration verify (up to 31) and 18 per task-side run, from
  the rollout's own `suite-ended` Run-record lines. Estate ADR 0011's budget is 5 minutes for an Integration
  verify and 20 for a full suite.
- **On GitHub:** 31 to 39 minutes for a passing macOS `make test` job (shell suites about 29 minutes at
  `THREAD_TEST_JOBS=4`, node tests 12 or more), and 31 to 33 on ubuntu. The required checks wait on both.
  The job outgrew its `timeout-minutes` twice in nine days: 25 to 40 on 2026-10-29 (#247), 40 to 60 on
  2026-11-07 (#327). 7 of the last 40 macOS jobs, 3 of them on master, were cancelled at the limit with
  no test failing.

Nothing caught the growth. The Run record holds each local suite's time but nothing reads it against a
budget (estate ADR 0011 d1's tasks are open), and nothing records GitHub CI at all, so both raises were a
person noticing. When the cancellations came, `gh` 2.43.1 reported the cancelled required check as passing,
and `merge-task.sh` read the still-blocked PR as "a NON-check gate", a human's, so both tasks were set aside
for Lachy over a timeout.

## Decision

**d1. Merges verify a fast tier; the full suite runs at completion and on master.** Lachy's pick:
"Fast tier at merge". A rollout's `verifier:` becomes Thread Skill's declared **Fast tier** and its
`completion_verifier:` the full suite. The accepted risk is estate ADR 0009 d6's: a break only the slow tests
catch, in code the diff did not reach, is found by the completion verifier or master's own run, not at its
merge, and files a fix task (ADR 0055) instead of blocking.

- Rejected: the full suite at every merge, made faster (each merge still waits 12 to 20 minutes at best, and
  the suite keeps growing); staging the fast tier behind the speed-up (the merge cost lands now).

**d2. The full suite gets faster too.** His note on the pick: "speed up the full suite as well … any time
spent on speeding that up will help down the track." The completion verifier, master's CI and Lachy's
own sessions still run it, so it is held to estate ADR 0011's **Suite budget** (20 minutes, week's median),
and Thread Skill's suite audit (estate ADR 0011 d4's method) runs now rather than waiting for the estate skill.

**d3. The merge gate follows the tier.** A PR's required checks run the fast tier on both OSes, keeping the
two required-check names (ADR 0025), so a merge never waits on the full suite remotely either. The full
suite runs on every push to master, split across parallel jobs. Master's red is that run's, read by the
Reflection (d5), never a PR's.

**d4. A CI timeout is the engine's, never Lachy's.** A required check cancelled at its job's time limit is
a stop on GitHub's side, read as one: one automatic re-run of the failed jobs, then an infra set-aside that
the automatic retry takes with its cool-downs (ADR 0033, ADR 0069). It is never "a NON-check gate". The
Companion needs no new authority: it still never hands back a block marked as his, and this one is no
longer marked so.

**d5. The suite and its CI are measured, and a breach files the audit.** Each merge's Run record holds each
required job's time, its conclusion and its job's time limit (**CI headroom**). The Reflection reads two
things on the week's median: local suites against the Suite budget, and CI jobs against their time limit,
flagging a job past 80 % of it. A breach files Thread Skill's suite audit task (estate ADR 0011 d1); a
timeout cancellation has a set-aside class of its own.

## Decided for you

Calls made in his place, each overturnable:

- **The fast tier's reach** is the tests a diff reaches from its **Verify base**, plus a small fixed set that
  always runs (the syntax and workflow-parse checks); a change the map cannot place runs the full suite. Why:
  a fast tier that fails toward the full suite can only be slower, never wrong.
- **An agent's Checkpoint runs the fast tier too.** The engine renders the rollout's `verifier:` at both
  Checkpoints, so this departs from estate ADR 0009 d6's last sentence ("the implementer's last check stays
  the full suite"). Why: a full suite per task is the cost being removed (18 minutes median, task-side), and
  the risk is the one d1 already accepts.
- **macOS stays in the merge gate.** Why: the engine runs on his Mac, and BSD tools differ from GNU ones
  (a `sed` form that works on ubuntu fails on macOS, met in this very rollout).
- **CI's full suite is split, not trimmed, first.** Why: splitting keeps every test and is reversible; the
  audit (d2) decides what to trim.
- **The 80 % flag and the week's median** follow estate ADR 0011 d1's reading rule (one run's time is mostly its
  load). Why: one slow runner must not file an audit.
- **The timeout raise to 60 (#327) stays** as headroom until d1 and d3 land, then comes back down to fit the
  split jobs. Why: a hang should report red quickly.

## Consequences

- A rollout merge waits minutes on its verify and its required checks, not most of an hour, so the
  Integration lane stops being the rollout's floor.
- A slow-tier break can reach master and is found within one master run or at completion, then filed.
- Thread Skill's own `CLAUDE.md` gains a `Verifier:` line naming the fast tier and a `Completion verifier:`
  line naming the full suite, so schedule stamps both (schedule steps 2.5 and 6).
- A future timeout reaches Lachy only after the automatic retries are spent.
