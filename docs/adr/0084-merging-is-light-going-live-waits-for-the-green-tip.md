# 0084 — Merging is light, going live waits for the Green tip, and Speed fixes go first

Date: 2026-11-16
Status: proposed. Grilled with Lachy on 2026-11-16, from the suite audit of the merge wait
(`docs/audits/test-suite-audit-2026-11-16.md`). Amends ADR 0025 (the required checks), ADR 0073 d3 and its "macOS
stays in the merge gate", and ADR 0043 ("a rollout moves only at its Reinstate"). Built so far: d3's ruleset alone (the
`make test (macos-latest)` context left `master-green-pr-only` by hand on 2026-11-16; the job still runs, unrequired,
until Phase 54's task 2). Phase 54 builds the rest.

## Context

Lachy ruled the merge wait the next cost to take on after Capacity (ADR 0083). The audit read 150 runs of the PR
checks (322 jobs, 2026-11-08 to 11-15) and the rollout's Run record:

- **A merge held the Integration lane a median 65 minutes** (p90 132): about 21 for the Mac's own verify, then about
  43 for GitHub's slower check, one after the other. Runner queue time was nil.
- **The Fast tier was the full suite in all but name.** 39 % of jobs fell to the full suite, and the rest selected a
  median 191 of 199 test files. One file, `tests/leg.test.sh`, ran 28 minutes on macOS.
- **macOS cost more than it caught.** 22 macOS jobs were cut at the 55-minute limit while ubuntu passed. Its 4 own
  failures were timing flakes or limit cuts. Since 2026-10-15 it caught no BSD/GNU product bug; ubuntu caught both.
- **The default branch's full suite already runs after every merge**, on both OSes: 61 of its last 64 runs passed,
  in a median 21 minutes.

Merging and going live were one moment. An **Engine snapshot** is cut at origin's tip and the **Primary refresh**
follows it within minutes, so the only place to stop a break was before the merge, and every merge paid for the whole
suite. Offered the choice of keeping the slow tests in the Mac's check before each merge, Lachy reframed it:

> "Is there a way to catch this so that it only goes live on rollouts once it has passed all the tests? … I would
> rather trade off having threads generally running faster for having new rollouts be safer and only start with code
> that has had all the checks run on it."

## Decision

**d1. Thread Skill's code goes live only from the Green tip.** The **Green tip** is the newest commit on the default
branch whose full suite passed there, on every OS it runs on. An Engine snapshot is cut at it, at schedule and at a
Reinstate, and the Primary refresh moves the **Primary checkout** to it and never past it. Every rollout and session stays on the last
commit that passed. A merge is live about one full-suite run after it lands (a median 21 minutes), later when runs
queue, and never while the default branch is red.

**d2. Everything waits, his own sessions included.** Asked whether only rollouts should wait, he picked "Everything
waits": one rule, nothing runs from a commit the full suite has not passed.

- Rejected: only rollouts wait (his sessions' skills and hooks would run code the slow tests had not checked).

**d3. The checks before a merge are light.** Two rulings, both his:

- **macOS leaves the required checks** ("Drop it from PRs"). A PR waits on ubuntu alone. macOS runs in the default
  branch's full suite, which now decides what goes live.
- **The Slow tier leaves GitHub's check before a merge** ("Move them off PRs now"). His ruling took it off the PR
  check and kept it in the Mac's verify; taking it off the Mac's verify too, once the Green tip is live, is a call
  made for him (Decided for you 1). The suites that each run long (ten today: leg, lead-integrate, unfinished-rollout,
  git-env-canary, primary-refresh, reconcile-rollout-completion, reconcile-rollout-auto-retry, merge-task-integrated,
  land, merge-settings) run in the default branch's full suite and at the **Completion verifier**. A break only they catch turns the default branch red, the Green tip stays where it is, and
  a fix is filed. It never reaches a rollout.

**d4. Speed fixes go first, and the rest of Thread's queue waits for them.** A **Speed fix** is a task filed against a
measured cause of rollout time lost (a Time-lost ledger line, a suite audit's ranked change, a stall audit's cause).
He picked "Stop the rest by default", and said what the stop is for:

> "I just want the faster ones to go first and those fixes to be implemented so that the next task can actually go
> faster based on those fixes. I want that to be automated … I want those speed improvements to be in the system as
> quickly as possible."

A Speed fix phase holds every other task of the project's queue until its releasing task lands: its last task, unless
the phase names an earlier one. The hold is made at schedule, releases by itself, and never asks him.

- Rejected: first in line with no stop (the fix shares the lane and lands later); a stop only when a week's reading
  shows rollouts slow (he wants it whenever a measured fix exists).

**d5. A Speed fix ripples through running rollouts.** His words:

> "Because it's a system that's improving itself, [I want Thread to] not get stuck in situations where we've got a
> better, faster system but a long rollout is getting weighed down by the old version … If we can just do a soft
> pause on something and/or stop the rollout and then restart it again with this new code, then I want to have a
> system like that … even if there's a bit of extra admin in stopping and starting them."

Once a Speed fix in the engine's own code is live at the Green tip, each running rollout makes an **Engine catch-up**: it starts nothing new,
lets what is running finish, moves onto a fresh Engine snapshot at the Green tip, and carries on. ADR 0043's "nothing
moves a rollout's snapshot mid-run" now has this one exception.

## Decided for you

Calls made in his place, each overturnable:

1. **The Mac's verify before a merge goes light too, once the Green tip is live, and then runs at the same time as
   GitHub's check.** Until the Green tip decides what goes live, the Mac's verify keeps the Slow tier, which was his
   first pick ("Move them off PRs now", with the Mac still running them). After that nothing merges until both checks
   pass, and the lane costs the slower of the two (about 10 minutes, estimated), not their sum. Why: d1 makes the
   full suite on the default branch the safety, so the Mac's check need not repeat it, but only from the day d1 is
   built.
2. **The Slow tier is declared and derived, never a hand list.** A suite joins it on its measured seconds (today the
   ten whose macOS median on CI is 180 s or more; `tests/shard-weights.tsv` holds one local number per suite, so the
   cutoff and its source are the building task's to fix). The map check fails for a script whose only tests are
   slow. A suite that lets two Escapes through in four weeks returns to the Fast tier. Why: the set must not grow
   silently.
3. **A red default branch files its fix; it does not revert.** The failed jobs re-run once (a pass then is recorded and
   files nothing; it is no **Flake**, which is a named test in a rollout's own verifier run), then a fix task is filed
   and goes first, by ADR 0055's path. Merges continue. Why: nothing live is broken while the
   Green tip holds, and a revert is new machinery. If a week's reading shows the Green tip trailing for hours, the
   Reflection proposes revert-first.
4. **The default branch's full-suite runs coalesce when they queue.** One run goes on and only the newest commit
   waits; a run in flight is never cancelled. Why: one run uses about 65 macOS runner-minutes and GitHub gives 5 macOS
   jobs at once, so about 4.6 runs an hour, fewer than a 10-minute lane can merge. A verdict per commit would let the
   queue grow and the Green tip trail by hours. A red then covers every merge since the last green commit, and its fix
   task names them all.
5. **An Engine catch-up drains; it never cuts a task mid-step.** Why: one engine version writes a rollout's records
   between moves (ADR 0043). A serial chain catches up at its next Leg.
6. **Only a Speed fix in the engine's own repo causes a catch-up, and a phase drains a rollout once.** The drain is
   for the phase's releasing task; any other engine Speed fix is taken when nothing of the rollout is running, or at
   its next Reinstate. Why: a catch-up on every merge, or on each of a phase's tasks, would keep rollouts draining
   ("within reason", his words), and another project's Speed fix changes no engine.
7. **An engine Speed fix reaches every running rollout on the Mac, whatever its project; the hold of d4 covers only
   the fix's own project's queue.** Why: the engine is shared, the queues are not.
8. **A commit can be made live by hand, on his word only** (a snapshot cut at a named commit). Why: the one case the
   Green tip cannot serve is a break in the code that reads it.
9. **A Green tip that has trailed the default branch for 2 hours shows on the Stage's quiet line.** Why: state he
   may want to check is one click away and never a notification (ADR 0075; Chorus builds the line).
10. **Phase 54's own hold and its catch-up are made by hand**, since it builds the machinery that will make them.
11. **The Green tip is a ref the default branch's own run moves, guarded by its readers.** It lives outside
    `refs/heads/`, a reader takes it only when it is an ancestor of the default branch's tip, and the lead checks that
    its commit carries a passing run. Why: the job that refreshes his sessions has no GitHub CLI, so the tip must be
    readable by a plain fetch; and a ruleset cannot guard it, since GitHub refuses the Actions app as a bypass actor
    on a user-owned repo (tried 2026-11-16).
12. **The audit's other changes stand as technical work**: the remaining ubuntu check runs as shards behind a job
    that keeps the required name, a bytecode cache for the test run, `tests/leg.test.sh` split in four, a narrower
    reach, node's files longest-first.

## Consequences

- A merge should hold the lane about 10 minutes, from a median 65 (estimated; the Reflection reads it).
- Live code trails the default branch by one full-suite run, two in a burst. A fix he is waiting on reaches his
  sessions about 20 to 45 minutes after it merges.
- Until d1 is built, a PR that does not merge through the Integration lane (a session's own PR, a landing PR that
  carries code) merges on ubuntu alone and is live within minutes: macOS checks it only after the merge, on the
  default branch's run. The Mac's verify covers a rollout's merges meanwhile.
- The default branch will go red more often than 3 runs in 64, since less is checked before a merge. Its cost is a
  filed fix and a Green tip that waits, never a broken rollout. How often, and how far the tip trails, are the
  numbers that tune the Slow tier.
- ADR 0025's ruleset dropped the `make test (macos-latest)` context on 2026-11-16, ahead of the change that drops
  the job: a required context no job reports would leave every PR waiting.
- The Primary checkout can stand behind origin while the default branch is red; sessions that need origin's tip work
  in a worktree, as they already do.
- Rollouts on two engine versions still read each other's records (ADR 0043's migration rule stands).
