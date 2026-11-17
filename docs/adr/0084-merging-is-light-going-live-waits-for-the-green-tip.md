# 0084 — Merging is light, going live waits for the Green tip, and Speed fixes go first

Date: 2026-11-16
Status: proposed. Grilled with Lachy on 2026-11-16, from the suite audit of the merge wait
(`docs/audits/test-suite-audit-2026-11-16.md`). Amends ADR 0025 (the required checks), ADR 0073 d3 and its "macOS
stays in the merge gate", and ADR 0043 ("a rollout moves only at its Reinstate"). Built so far: d3's ruleset (the
`make test (macos-latest)` context left `master-green-pr-only` by hand on 2026-11-16; the job ran on, unrequired,
until Phase 54's task 2). p54-2 built the rest of d3's PR side: test.yml's PR job runs on ubuntu-latest alone, pinned by
`tests/ci-workflows.test.mjs` W1 and W3 (no pull_request job on a macOS runner), and the Reflection's CI headroom reads
the macOS job as retired from 2026-11-16 (`reflect.py`'s `CI_RETIRED`): said once, in the week whose window holds the
date, and never a breach from that week on. d3's Slow tier for GitHub's check built by p54-1: `SLOW` lines in `tests/fast-tier.map`,
held by check (j) to `tests/ci-seconds.tsv`'s macOS CI medians (2026-11-08 to 15), joining at 180 s and leaving only
under 150 s, so today's ten are the set; check (d) fails a script whose only tests are SLOW; `tests/run.sh --fast`
under `THREAD_SKIP_SLOW=1`, which `test.yml` sets, drops every SLOW suite the diff does not edit itself, its full-suite
fallbacks included, and names them in one line. Decided for you 2's return rule waits for p54-7's red-master record,
in its own follow-up task (p54-18). Decided for you 11's publisher and Decided for you 4 by p54-5: full-suite.yml's
`green-tip` job, named `publish the Green tip`, fast-forwards `refs/thread/green` to a run's commit once every shard
passed, and the runs coalesce in one concurrency group. A red of that job alone is read by Decided for you 13. Decided
for you 3 by p54-7: `reconcile-rollout.py master-runs`, run by the lead at each loop entry, after each landing merge and
at each heartbeat tick (never blocking a merge), reads master's last 100 `full suite` runs, re-runs the newest red run's
failed jobs once, and files a red-master fix (`priority: high`, `master_red:`, joined first) for each suite its re-test
confirms, naming every merge since the last green; a pass on the re-run is a `rerun-pass` line, never a Flake; its
master-run lines (master-runs.jsonl) feed the weekly Reflection's `masterRuns` (how often master went red, how long the
Green tip trailed). Decided for you 13 by p54-7, with "on the next default-branch run's publisher" read as a publisher
red that returns on the next run after a run that got no re-run (a newer run was already waiting): that one is covered
and files a publisher task with no re-run, while a publisher red straight after a blip is a first red with its own one
re-run. Decided for you 11's lead check by p54-7: a `refs/thread/green` commit with no successful `full suite` run files
its own task.
d1's and d2's readers built by p54-6: `skills/_shared/scripts/green-tip.py` (its docstring holds the rules) is the one
resolver, read by the snapshot cut (`cut --at <sha>` is Decided for you 8's hand cut), the Primary refresh, land.sh S4,
S11 and O9, and `self-rollout-check.sh --refresh-in-place`. It fetches the ref by name, decides "publishes" from
origin's `full-suite.yml` job or a recorded `seen`, takes the ref only as an ancestor of origin's tip, and follows only
a verified commit: one recorded in `green-tip.json`, or one gh shows a passing `publish the Green tip` run on. The
Primary refresh asks gh too, best effort in its launchd pass, where Decided for you 11 assumed it had none
(full-suite.yml's header still says so): a negative answer is cached 15 minutes, a pending one never. An unverified
Green tip steps back to the newest verified commit before it, and a hold never yields origin's tip. The reset-primary
trigger records two new outcomes, `past` and `no move:`. The readers that only advise, thread-placement.py's `behind`
finding and pushed-base.sh's reset hint, ask its local `waits` (a live checkout of a repo that publishes one) and name
the wait, never a move past the Green tip. The installed bundle follows the Green tip, backwards included. A checkout
that waits on the Green tip keeps the close-out commit's THREAD.md, which a later fast-forward replaces once origin
holds it (live-checkout.sh's lc_landed). Decided for you 9's reading on the Mac is the Primary refresh line's 2-hour
waits line.
d4's Speed fix for the fast tier's fan-out built by p54-4 (`tests/lib/fast-tier.py`'s
header holds the rules): a file under `docs/` and an untracked file are no carriers, and the reach stops one carrier
deep; the `SKILL.md` readers are declared on `READERS` lines in `tests/fast-tier.map`, held by check (k);
`tests/lib/contract-text.mjs` no longer names `SKILL.md`; and a plain select leaves out an untracked path no map line
places, with a note. Measured on the tree: `skills/orient/SKILL.md` 120 test files (6 SLOW) to 88 (none); ADR 0083 87
to 41; `leg.py` 194 to 138; `merge-task.sh` 194 to 83; `attention.py` 194 to 51. d4's Speed fixes from the audit's
rows 2 and 5 built by p54-3: `tests/run.sh` warms a bytecode cache in its scratch dir once (`compileall` into
`PYTHONPYCACHEPREFIX`, exported to every suite and node file), so the engine loads compiled; node's files start
longest first, by measured seconds in `tests/shard-weights.tsv`'s node section (`shard.py --order`, which also weighs
them in the shard split), run through `tests/lib/node-run.mjs`, since `node --test` sorts its arguments by path.
Decided for you 12's engine reading built by p54-11: a roll-up check, a required check whose workflow job has the
aggregator shape (a non-empty `needs:` and a job-level `if:` holding `always()` or `!cancelled()`, read at the
integrated head; a name that is only expressions matches nothing), is read through the jobs it needs by
`lead-integrate.py shards`, at merge-task's three sites: the infra re-run classifies the run's jobs minus the
roll-up's own, so a shard's setup failure is re-run; a shard cut alone takes ADR 0073 d4's cancelled path (skipped
neutral, the cut-again rule per needed job); and a roll-up whose needed jobs all passed or were skipped falls back to
itself, today's read. CI headroom records the slowest of its needed jobs and itself by seconds, against that job's own
limit, and the line's `shard` field names the needed job.
d4's Speed fix from the audit's row 1 begun by p54-10: `tests/run.sh --fast --shard K/N` selects as `--fast` does (its
full-suite fallbacks and the Slow tier's filter included), then runs shard K of that selection by `tests/lib/shard.py`'s
split, so the N shards together run it exactly once, the merge-task self-tests in shard 1 when it holds them; a shard
left nothing passes on the always-run steps, and `--fast --shard-plan N` prints the split and runs nothing
(`tests/fast-tier.test.sh` F26 and G7).
d4's Speed fix from the audit's row 1 finished by p54-12, the PR check's jobs that run it: test.yml's required
`make test (ubuntu-latest)` is reported by the roll-up job `test` (a literal name, so ADR 0025's ruleset is unchanged),
which needs the three `fast tier (shard K/3)` jobs (`bash tests/run.sh --fast --shard K/3`, fail-fast off) under
`if: ${{ always() }}` and fails unless every shard succeeded. p54-12's own PR (FULL) measured the shards at 15.7, 5.0
and 10.0 minutes and the roll-up at 3 seconds, so the check took 15.8 minutes; each shard's limit is 35 minutes, about
twice the slowest rounded up to a multiple of 5. Shard 1 is the long pole: it holds `tests/reflect-weekly.test.mjs`,
about 10.3 minutes of CI alone. Pinned by `tests/ci-workflows.test.mjs` W1-W3 and W8 (W8 runs the roll-up's script and
reads the file with lead-integrate.py's own line reader).
d4's Speed fix from the audit's row 3 built by p54-9: `tests/leg.test.sh` splits in four, L1-L16 keeping the name,
`tests/leg-land.test.sh` L17, `tests/leg-rank.test.sh` L18 and `tests/leg-security.test.sh` L19-L21, each with its own
preamble and the shared helpers in `tests/lib/leg-fixtures.sh`; their seconds in `tests/ci-seconds.tsv` and
`tests/shard-weights.tsv` are leg.test.sh's apportioned by the parts' measured shares, so the Slow tier is thirteen;
ok lines 758 + 307 + 195 + 294 = 1554, the old file's count.
d4's Speed fix hold built by p54-13 (`skills/_shared/vault-grammar.md` § Speed fix hold is the one copy of its forms): a
task's `speed_fix:` cites its evidence (`docs/audits/<file>.md row <N>`, `docs/audits/<file>.md cause <words>` or
`#<anchor>`, or `time-lost <id> [<class>]`), and one without it is refused and held like any other;
`reconcile-rollout.py speed-hold apply` (schedule step 7) and `join` give every other queued task of the rollout a
`depends-on:` on the phase's release (its last task, or the member, marked or not, the phase note's `speed_fix_release:`
names), recorded on the rollout note's `## Speed fix holds` so `speed-hold release` and `lift` remove exactly what was
added; the reach is one rule, so no marked task, no release, nothing upstream of either and no member of any Speed fix
phase in play (one with a live mark or a standing hold) is ever held, and two Speed fix phases hold no task of each
other's and never deadlock; `next` lets a hold go when its release, or a task it
depends on, leaves the queue or is set aside with its automatic retries spent (a gate-pending one never lets it go, so a
gate-pending release, or a task it depends on, is the one wait on Lachy the hold keeps, until he or the Standing
approval signs its gate or he defers it), with a `speed-hold` Run record line; `defer` drops a deferred task's entries,
`carry` copies the record, and `status` reports `speedHolds`. A red-master fix (Decided for you 3) is exempt by its key
alone: `master_red:`, the mark p54-7's `master-runs` stamps on its fix task, or `completion_red_of:`, the completion
verifier's fix task's.
d5 and Decided for you 5, 6 and 7 built by p54-14, the Engine catch-up: `reconcile-rollout.py catch-up` (its docstring
holds the drain rule; engine-snapshot.py's header the `## Catch-up log`) compares a rollout's `engine_sha` with the Green
tip read in its own snapshot's Primary checkout, maps the marked Speed fix units onto those commits (`merge_commit:`,
else the `pr:` number on a `(#N)` or `Merge pull request #N` subject, only on the engine's own repo key) and tests each
matched commit's first-parent diff for engine code (`skills/` or `hooks/`, their tests and fixtures excluded). A phase
drains a rollout once, when its release lands with one of its engine fixes lacking: `pause_requested` with `paused_for:
catch-up` (Decided for you 5: the soft pause's drain, never a cut mid-step); any other lacking engine fix is a take, only
with nothing running; an ordinary merge and another repo's Speed fix cause none (Decided for you 6); the read reaches
every project's rollout on the Mac (Decided for you 7). The drain's bound is 160 minutes, the Slot p90 on the Run
record: past it the rollout goes on on its old snapshot and takes the catch-up later. Drained, the lead moves itself (a
self-Reinstate: cut, adopt, `record-entry --by catch-up`, `clear-pause`); a serial chain moves at its next Leg begin.
Each move restamps `verifier:` from the project's CLAUDE.md, and each catch-up is a Run record `catch-up` line. Accepted
gap: Chorus reads the pause stamps directly, so during a catch-up its own pause, a battery pause or a quiet's drain can
read "already asked" and be lost when the catch-up clears its stamps; follow-up
`chorus-the-stage-reads-an-engine-catch-up`. The Speed fix hold lets go at the release's merge, before the Green tip
holds it, so held tasks may start on the old snapshot first; follow-up
`thread-skill-an-engine-speed-fix-hold-lets-go-at-the-catch-up`.
Phase 54 builds the rest.

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
  a fix is filed. It never reaches a running engine. A task's own tree is still cut from the default branch's tip, so
  later tasks build on the break until its fix lands, which is why that fix goes first.

**d4. Speed fixes go first, and the rest of Thread's queue waits for them.** A **Speed fix** is a task filed against a
measured cause of rollout time lost (a Time-lost ledger line, a suite audit's ranked change, a stall audit's cause).
He picked "Stop the rest by default", and said what the stop is for:

> "I just want the faster ones to go first and those fixes to be implemented so that the next task can actually go
> faster based on those fixes. I want that to be automated … I want those speed improvements to be in the system as
> quickly as possible."

A Speed fix phase holds every other task of the project's queue until its releasing task lands: its last task, unless
the phase names an earlier one. The hold is made at schedule, releases by itself, and never asks him. A red default
branch's fix is never held by it, and a hold whose releasing task is set aside shows on his needs-you list.

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
   pass, and the lane costs the slower of the two (about 10 minutes once the GitHub check is sharded, estimated), not
   their sum. Why: d1 makes the
   full suite on the default branch the safety, so the Mac's check need not repeat it, but only from the day d1 is
   built.
2. **The Slow tier is declared and derived, never a hand list.** A suite joins it on its measured seconds (today the
   ten whose macOS median on CI is 180 s or more; `tests/shard-weights.tsv` holds one local number per suite, so the
   cutoff and its source are the building task's to fix). The map check fails for a script whose only tests are
   slow. A suite the change itself edits still runs before the merge. A suite red on the default branch twice in four
   weeks, for breaks the checks before a merge left out, returns to the Fast tier (the red's own record names the
   suite; an Escape does not). Why: the set must not grow silently, and a diff that points at a suite should run it.
3. **A red default branch files its fix; it does not revert.** The failed jobs re-run once (a pass then is recorded and
   files nothing; it is no **Flake**, which is a named test in a rollout's own verifier run), then a fix task is filed
   and goes first, ahead of a Speed fix phase's hold too, through the writer the completion verifier's fix task uses. Merges continue. Why: nothing live is broken while the
   Green tip holds, and a revert is new machinery. If a week's reading shows the Green tip trailing for hours, the
   Reflection proposes revert-first.
4. **The default branch's full-suite runs coalesce when they queue.** One run goes on and only the newest commit
   waits; a run in flight is never cancelled. Why: one run uses about 65 macOS runner-minutes and GitHub gives 5 macOS
   jobs at once, so about 4.6 runs an hour, fewer than a 10-minute lane can merge. A verdict per commit would let the
   queue grow and the Green tip trail by hours. A red then covers every merge since the last green commit, and its fix
   task names them all. A re-run joins the same group, where it would cancel the newest commit's waiting run or be
   cancelled by it, so only the newest commit's run is re-run (Decided for you 3's one re-run).
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
    `refs/heads/`, a reader fetches it by name and takes it only when it is an ancestor of the default branch's tip, a missing or
    unfetched ref in a repo that publishes one moves nothing (never the branch's tip), and the lead checks that its
    commit carries a passing run. Why: the job that refreshes his sessions has no GitHub CLI, so the tip must be
    readable by a plain fetch; and a ruleset cannot guard it, since GitHub refuses the Actions app as a bypass actor
    on a user-owned repo (tried 2026-11-16).
12. **The audit's other changes stand as technical work**: the remaining ubuntu check runs as shards behind a job
    that keeps the required name, a bytecode cache for the test run, `tests/leg.test.sh` split in four, a narrower
    reach, node's files longest-first.
13. **A red whose only failed job is `publish the Green tip` files no suite fix, and one that comes back wants a fix to
    that job or a credential gate, never another re-run.** Its failed job re-runs once (Decided for you 3), and a pass
    then records a blip. A red that returns, on that re-run or on the next default-branch run's publisher, is a
    structural refusal: GitHub refusing the push or the ref, such as a GITHUB_TOKEN without the `workflows` permission
    across a merge that edited `.github/workflows/`. Why: every shard passed, so the red covers no merge and a suite fix
    would name merges that broke nothing; and a refusal returns on every re-run, so another one only spends runner time
    while the Green tip waits.

## Consequences

- A merge should hold the lane about 30 minutes when Phase 54's hold releases (the light Mac verify, then GitHub's
  light check), and about 10 once the two run together and the GitHub check is sharded, from a median 65 (both
  estimated; the Reflection reads it).
- CI headroom loses its macOS series from 2026-11-16: it reads the required checks.
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
