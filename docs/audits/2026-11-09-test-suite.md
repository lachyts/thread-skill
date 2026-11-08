# Test suite audit — 2026-11-09

Audited at `0030168` (master `8b767dd` plus p43-6's per-suite lines in `tests/run.sh`), for
[[thread-skill-p43-6-the-suite-audit-and-ci-time-limits]] (ADR 0073 d2: the full suite is held to the Suite budget;
estate ADR 0011 d4's method; Chorus ADR 0107). Four timed local full runs in a verify slot, the CI job history since
#327 landed, the Run records, and static reading. The fixes that are plainly safe land in the same PR; each larger one
is a filed task (§ 9). CI was re-read at 2026-11-08T18:37Z, after #348 (p43-5) and #349 had landed on master; the branch
merges onto `a0675f3` without conflict, and the shard predictions in § 3 are read on that merge.

**Why:** the completion verifier, master's CI and Lachy's own sessions still run the full suite, and CI's
`timeout-minutes` was raised to 60 on 2026-11-07 (#327) as headroom until the fast tier and the shards were measured.

## Headline

- **The full suite: 16.2 min locally** (969 s, the median of two runs at the default cap of 4, load 3 to 5), under the
  20-min Suite budget. Under rollout load the week's median is 16.8 min (155 green suite runs, 2026-11-02 to 08), but
  each rollout's median has grown: 12.7 min (11-03), 16.6 (11-05), 16.9 (11-06), 18.0 (11-07), 19.2 (11-08).
- **Where it goes:** the shell phase is 681 s, packed at the cap (2,692 seconds of shell suites and self-tests over 4
  slots); node is 287 s (3,157 tests). `tests/leg.test.sh` alone is 527 s, 20 % of the shell seconds.
- **CI limits, before and after:**

  | Job | Before | After | Slowest passing run in the window |
  |---|---:|---:|---|
  | `make test (macos-latest)` (test.yml, a PR's required check) | 60 | **55** | 50.9 min (a full run) |
  | `make test (ubuntu-latest)` | 60 | **55** | 34.2 min |
  | `full suite (macos-latest, shard K/4)` (full-suite.yml, master) | 60 | **35** | 16.6 min |
  | `full suite (ubuntu-latest, shard K/4)` | 60 | **30** | 14.1 min |

- **#327 finding 2 is fixed:** each suite and step prints `<label>: ok|FAILED (<N>s)` as it ends, so a job cut at its
  limit names every suite that finished. All four macOS jobs cut at 40 min on 2026-11-06 died in the node phase with
  no shell verdict in their logs (§ 4).
- **The shards balance on measured seconds now** (`tests/shard-weights.tsv`): each shard's shell sum is 673 to 673.5 s
  instead of 475 to 958 s by size. The slowest shard does not move, because `tests/leg.test.sh` alone sets its floor
  (§ 3); its split is the top filed recommendation.
- **No CI flake in the window; 2 local flakes in a week, recorded as 3** (one test filed twice, § 6).

## 1. Where the time goes

### Wall time

| Run | Cap | Load at start → end (1-min) | Shell phase | Node | Total |
|---|---:|---|---:|---:|---:|
| M1 | 4 | 4.5 → 3.3 | 691 s | 287 s | 980 s |
| M2 | 4 | 3.3 → 3.5 | 671 s | 286 s | 958 s |
| **median** | 4 | | **681 s** | **287 s** | **969 s (16.2 min)** |

The always-run steps (bash and python syntax, the workflow parse, the fast-tier map check) take 1 to 2 s, and the
tree check under 1 s. The shell phase holds 71 shell suites and the two merge-task self-tests; its suites' own
seconds sum to 2,692 (median), so at 4 slots it could not end before 673 s. It ended at 681: the cap is full for the
whole phase, and the shell phase is bound by total shell work, not by any one suite.

### The 20 slowest

All 20 are shell suites (the slowest node test takes 16.5 s). Median of M1 and M2, each suite's own line:

| # | Suite | Seconds | Share of shell seconds |
|---:|---|---:|---:|
| 1 | `tests/leg.test.sh` | 527 | 19.6 % |
| 2 | `tests/lead-integrate.test.sh` | 244 | 9.1 % |
| 3 | `tests/git-env-canary.test.sh` | 154 | 5.7 % |
| 4 | `tests/primary-refresh.test.sh` | 146 | 5.4 % |
| 5 | `tests/unfinished-rollout.test.sh` | 112 | 4.2 % |
| 6 | `skills/execute/tests/reconcile-rollout-completion.test.sh` | 94 | 3.5 % |
| 7 | `tests/merge-task-integrated.test.sh` | 92 | 3.4 % |
| 8 | `tests/verify-slot-heat.test.sh` | 80 | 3.0 % |
| 9 | `tests/land.test.sh` | 62 | 2.3 % |
| 10 | `skills/execute/tests/reconcile-rollout-auto-retry.test.sh` | 62 | 2.3 % |
| 11 | `tests/pushed-base.test.sh` | 59 | 2.2 % |
| 12 | `skills/execute/tests/reconcile-rollout-record.test.sh` | 56 | 2.1 % |
| 13 | `skills/execute/tests/reconcile-rollout-human-fix.test.sh` | 54 | 2.0 % |
| 14 | `tests/verify-slot.test.sh` | 51 | 1.9 % |
| 15 | `tests/integration-tree.test.sh` | 51 | 1.9 % |
| 16 | `tests/self-rollout-check.test.sh` | 46 | 1.7 % |
| 17 | `skills/execute/tests/reconcile-rollout-moving.test.sh` | 42 | 1.5 % |
| 18 | `tests/engine-snapshot.test.sh` | 37 | 1.4 % |
| 19 | `tests/merge-task-base.test.sh` | 36 | 1.3 % |
| 20 | `skills/execute/tests/reconcile-rollout-queue.test.sh` | 36 | 1.3 % |

The top 5 hold 44 % of the 2,683 shell-suite seconds and the top 20 hold 76 %; the other 51 suites (35 s and under) hold 24 %. The two merge-task self-tests
take 9 s together (8.5 s of it the base self-test), so they never set a shard's floor.

### The node phase

`node --test --test-concurrency=4` over 116 files: 287 s wall for 841 s of top-level test time (3,157 tests), about 2.9
files at once. Placing each top-level test in its file by name (93 % of the seconds place), the `tests/reflect-*.test.mjs`
files hold about 375 s (`reflect-weekly` 153, `reflect-ledger` 66, `reflect-attention` 56), `security-check-scan` 67,
and the 74 contract files under `tests/contracts/` about 73 s in all. The 10 slowest node tests (median):

| Test (top-level, abridged) | Seconds |
|---|---:|
| L3 and L4: the baseline seeds once; a class topping two readings running opens a Watch … | 16.5 |
| on this repo, nothing proposed matches SKILL.md or skills/**, and skills globs fail with a named reader | 13.4 |
| L7: a lone W2 item opens its Watch in readings, recurs the next reading into a rule item … | 11.8 |
| L4: an audit row between two readings never moves the top or the Watch … | 10.2 |
| L2: attention refuses a bad owners file with nothing written … | 9.6 |
| close: a held trade with no decision task line from this Reflection is exit 2 … | 9.3 |
| declines: a no closes the cycle … | 8.0 |
| D15. acceptance: sessions starts written notes … | 7.6 |
| L6: October stands on the baseline … | 7.2 |
| moot: a yes that cannot apply is recorded under its section … | 7.2 |

### Time by kind

| Kind | Files | Seconds (own) | Share of all test seconds |
|---|---:|---:|---:|
| Shell suites that drive an engine script (reconcile-rollout, lead-integrate, leg, merge-task) | 54 | 2,304 | 65 % |
| Other shell suites (git and process: primary-refresh, pushed-base, integration-tree, release-check, ...) | 17 | 379 | 11 % |
| Node files outside `tests/contracts/` (engine drives by node, the reflect readers, estate scripts) | 42 | about 770 | 22 % |
| Node contract tests (`tests/contracts/`, mostly prompt-text and wiring pins) | 74 | about 73 | 2 % |
| merge-task self-tests | (1 entry) | 9 | 0.3 % |

Most of the time is spent driving the engine through real git repos and real processes, which parallelises well
(the cap stays full). The prompt-text pins are cheap: removing every contract test would save about 18 s of wall time.

## 2. Tiers

**Counts.** The full suite: 187 test files (71 shell suites, 116 node files) plus the two merge-task self-tests;
16,452 shell assertions (`ok   - ` lines) and 3,157 node tests. Every mode first runs the always-run steps (59 bash
files, 45 python files, 2 workflow scripts, the fast-tier map check). The fast tier (ADR 0073 d1) is not a fixed set:
`tests/lib/fast-tier.py` selects the files a diff reaches, through `tests/fast-tier.map`.

**The fast-tier replay.** Each of the last 60 first-parent commits on master at `8b767dd`, its changed paths through
`fast-tier.py select --paths` on this tree:

- **16 FAST and 44 FULL.** By the first FULL path each FULL commit reaches: `run_record.py` 8, `unfinished-rollout.py`
  4 and `reconcile-rollout.py` 4, `skills/execute/legs.md` 3, `skills/_shared/readiness-grade.md` 3, the `Makefile`,
  `background_job.py`, `land.sh`, `asking.md`, `lead-integrate.py`, `engine-snapshot.md`, `execution-fit.md` and
  `reflect.py` 2 each, and 6 more once each (`verify-slot.py`, `serial-chains.py`, `rollout-settings.py`,
  `next-action.py` and both workflows).
- **A FAST commit still runs a median 99 files** (84 to 147), most of them node files: a docs-only commit runs 94
  files, 10 of them shell suites, because the contract tests that read docs are walkers.
- The open tasks [[thread-skill-followup-fast-tier-narrow-the-reach]] (FULL → FAST) and
  [[thread-skill-followup-fast-tier-over-selection]] (fewer files per FAST run) own both; this audit files no
  duplicate.

## 3. Parallelism

### The cap

| Run | `THREAD_TEST_JOBS` | Load at start → end | Shell phase | Node | Total |
|---|---:|---|---:|---:|---:|
| M3 | 2 | 3.2 → 4.3 (11 to 16 while another rollout's suite held the second slot) | 1,367 s | 438 s | 1,806 s (30.1 min) |
| M1/M2 median | 4 | 3.3 to 4.5 → 3.3 to 3.5 | 681 s | 287 s | 969 s (16.2 min) |
| M4 | 8 | 4.2 → 4.3 | 537 s | 218 s | 756 s (12.6 min) |

- **2 → 4 halves both phases:** the shell suites' own seconds barely move (2,720 at 2, 2,692 at 4), so the shell
  phase is their sum over the cap (1,367 s, then 681), and node scales the same way (438 s, then 287). On 12 cores,
  4 suites at once do not contend.
- **4 → 8 saves 213 s (3.6 min), and then `tests/leg.test.sh` is the floor:** the shell phase (537 s) is that one
  suite's own time (536 s); the other suites' seconds rise 10 % (2,970 in all) with the contention. With leg split,
  the shell phase at 8 would be about its sum over 8 (about 370 s), and the whole run about 10 min.
- **The default stays 4** (`max(2, ceil(cores / 3))`, p23-4). It exists because one unbounded run drove this Mac to load
  66 on 2026-10-17, and two verify slots at 8 each would put 16 suites on 12 cores while Lachy works. A higher local
  cap is an operator's trade of minutes for load, taken through `THREAD_TEST_JOBS`, not a fix this audit makes.

### The shards

`tests/lib/shard.py` split each kind by file size; the merge-task self-tests counted 0. p43-6 weighs each shell suite
by its measured seconds (`tests/shard-weights.tsv`, the medians of M1 and M2) and lets the self-tests' weight seed
shard 1. Each shard's predicted shell time at 4 slots is the larger of its sum over 4 and its longest suite. The
measured-seconds column is shard.py's split over `tests/shard-weights.tsv` as committed (each value the median of two
whole-second runs, so some end in .5), and shard 1's sum includes the self-tests' 9 s:

| Shard (N = 4) | By size: shell sum, longest | By measured seconds: shell sum, longest |
|---:|---|---|
| 1 | 958 s, `leg` 527 s → about 527 s | 673.5 s, `primary-refresh` 145.5 s → about 168 s |
| 2 | 719 s, `lead-integrate` 244 s → about 244 s | 673 s, `leg` 527 s → about 527 s |
| 3 | 475 s, `unfinished-rollout` 112 s → about 119 s | 673 s, `lead-integrate` 244 s → about 244 s |
| 4 | 540 s, `git-env-canary` 154 s → about 154 s | 673 s, `git-env-canary` 153.5 s → about 168 s |

(The table is this branch's tree. On its merge with master at `a0675f3` the split is the same in shape: 674.8 to 675 s
per shard, `leg` in shard 2, `lead-integrate` in shard 3, and #348's new `tests/merge-task-ci-headroom.test.sh` weighted
by the per-byte fallback.)

The sums now balance, but **`tests/leg.test.sh` alone sets the floor**: whatever N, the shard that holds it cannot end
its shell phase before that suite ends (527 s here; in CI's three full-suite runs the shard holding it ran its shell
phase 10.0 to 15.0 min on macOS and 8.7 to 13.0 on ubuntu, the others 2.3 to 8.6). So the weights move no time off
the slowest shard today; they balance the others and make the split ready for the day that suite is split
([[thread-skill-followup-suite-audit-split-the-leg-suite]]). N stays 4: more shards cannot cut below that floor.

The node phase is still split by size, because no reporter output names a node test's file (node 22's TAP on CI, 23's
spec on the Mac). Size is a poor proxy there: on equal byte shares, shard 3's node phase took 4.2 to 8.2 min across the
three runs and the others 0.6 to 2.8 ([[thread-skill-followup-suite-audit-node-file-weights]]); after #348 added node
tests, shard 3 was ubuntu's slowest shard once (12.8 min). The shell weights leave the node split exactly as it is.
On the merge with master, `leg.test.sh` moves from shard 1 to shard 2, beside node files that took 1.1 to 2.8 min (shard
1's took 0.6 to 1.5), and shard 3 takes `lead-integrate` (244 s) beside the heavy node files. Scaled by the CI-to-local
ratio of the leg shard, the slowest shard is predicted at about 15 to 18 min on macOS and 13 to 15 on ubuntu, a minute
or so above today's: the limits below sit at about twice that and hold for it.

## 4. CI

### Each job against its limit

**test.yml, a PR's two required checks** (`make test (<os>)`). Every completed run since #327 landed
(2026-11-06T23:11:47Z) to the re-read: 85 runs, 172 jobs (run 42421273174's second attempt included), on three UTC
days (2026-11-06, 07, 08: 4, 38 and 130 jobs). 16 red (14 ubuntu, 2 macOS, § 6), 0 cancelled.

| OS | Passing jobs | Range | Median | Slowest vs 60 (before) | Slowest vs 55 (after) | Over 80 % of 55 (44 min) |
|---|---:|---|---:|---:|---:|---:|
| macOS | 84 | 19.3 to 50.9 min | 35.2 | 85 % | 93 % | 1 (50.9, run 42343030831, a push on 2026-11-07) |
| ubuntu | 72 | 19.2 to 34.2 min | 28.3 | 57 % | 62 % | 0 |

**FAST and FULL.** 82 of the 85 runs predate #351, so each ran the full suite. The three that came after it
(42501773707, 42501896289 and 42506560612) print `== fast tier: full suite (...)` (a workflow file, `run_record.py`,
`serial-chains.py`): 0 FAST runs have completed yet. So every number above is a full run in the one required job, unsharded.

**full-suite.yml** (master's shards). Every run so far, all green: 42498536545 at `8b767dd` (#351), 42504957830 at
`f0ef8da` (#348) and 42509716600 at `a0675f3` (#349). Job minutes, with the phases (shell + node) from the log
timestamps:

| Shard | macOS: run 1, 2, 3 | ubuntu: run 1, 2, 3 |
|---:|---|---|
| 1 | 15.7 (13.9 + 1.5), 16.6 (15.0 + 1.4), 10.9 (10.0 + 0.6) | 9.7 (8.7 + 0.9), 11.7 (10.7 + 0.7), 14.1 (13.0 + 0.9) |
| 2 | 8.8 (6.4 + 2.2), 10.0 (7.3 + 2.3), 11.3 (8.1 + 2.8) | 4.6 (3.4 + 1.1), 5.9 (4.2 + 1.5), 7.0 (5.0 + 1.8) |
| 3 | 6.7 (2.3 + 4.2), 12.2 (4.6 + 7.3), 8.9 (3.1 + 5.6) | 7.7 (2.9 + 4.6), 12.8 (4.4 + 8.2), 8.4 (2.7 + 5.4) |
| 4 | 12.4 (8.1 + 3.9), 11.4 (8.6 + 2.5), 11.1 (8.3 + 2.4) | 5.8 (3.0 + 2.6), 4.7 (3.2 + 1.4), 6.2 (4.1 + 1.8) |
| slowest | 15.7, 16.6, 11.3 | 9.7, 12.8, 14.1 |

The same shard swings by up to 1.5x between runs (ubuntu shard 1's shell phase 8.7, 10.7, 13.0 min): runner speed,
as on test.yml. Against the new limits the slowest shard so far sits at 47 % (macOS, 16.6 of 35) and 47 % (ubuntu,
14.1 of 30).

### The rules, and the numbers they give

- **full-suite.yml, per OS:** T is twice M, M the median over the runs of each run's slowest shard on that OS, rounded
  up to a multiple of 5, at least 15, below 60, and above the slowest passing shard. Three runs: macOS M = 15.7
  (15.7, 16.6, 11.3), 2 × 15.7 = 31.4 → **35**; ubuntu M = 12.8 (9.7, 12.8, 14.1), 2 × 12.8 = 25.6 → **30**. Written
  as `${{ matrix.os == 'macos-latest' && 35 || 30 }}` (actionlint 1.7.12 accepts it). Nothing but GitHub reads it: no
  required check runs in this file. Three runs is few, so the limits also rest on the shard prediction in § 3; the
  next runs re-read them. (At planning, with one run, the rule gave 20 for ubuntu; the two runs since raised it.)
- **test.yml (a departure from "twice the median"):** this required job runs the whole unsharded suite whenever the
  selector says FULL, so twice its median (70 min on macOS) would sit far above 60. Instead T is 1.15 × M, M the slowest
  passing FULL job on either OS in the window, rounded up to a multiple of 5, capped at 55, and above M: 1.15 × 50.9 =
  58.5 → 60 → capped to **55**. One plain number, because p43-5's CI headroom reader (`lead-integrate.py`
  `_job_limit`, landed in #348) reads only a whole number from the workflow file: an expression is recorded as `unread`, and
  the Reflection's share and 80 % breach would then be null on both required jobs. Per-OS values for test.yml wait on
  that reader ([[thread-skill-followup-suite-audit-per-os-ci-limits]]; ubuntu would take 40).
- **The backstop:** a FULL run on a slow macOS day can be cut at 55. ADR 0073 d4 re-runs a cancelled required check's
  failed jobs once (merge-task.sh `CANCEL_RERUN_MAX=1`), then sets it aside as `ci-timeout` infra, which the automatic
  retry takes. It is never red and never Lachy's. The 80 % flag (p43-5) only reports.
- **What would let test.yml reach about twice its median:** fewer FULL runs (the narrow-the-reach task: 44 of the last
  60 commits are FULL) and per-OS limits.

### Where a cut job dies

The four macOS jobs cut at 40 min on 2026-11-06 (runs 42238424232, 42220400114, 42199029442, 42191428270) all died in
the node phase: node started 27 to 31 min in and the cut came 9 to 14 min later, and none of the four logs held a
single shell verdict, because `tests/run.sh` printed the shell suites' blocks only after node. From this PR on, each
suite prints its own line as it ends, and every block prints before node starts.

## 5. Redundancy and slow fixtures

Four classes, each judged by estate ADR 0011 d3 (test a rule once, at its lowest layer; no source-text pin where a test
runs the code), Chorus ADR 0107 and the research note. The bar for a removal: another named test asserts the same
behaviour on the same code path, at the same or a lower layer, in the full suite. The bar for a shared fixture: built
once, a copy per case, no case reading another's writes, the suite green alone and in the full run, and its seconds
measurably down.

- **(a) A proven duplicate: none applied.** Repeated assertion names are by design: `… zsh agrees` (82 lines in
  `tests/lead-integrate.test.sh`) re-runs a scenario's shell-sensitive step under zsh, the Bash tool's shell, which
  the suite makes mandatory on macOS; `control: …` names recur across contract files because each file proves
  its own matcher. No pair met the bar in this audit's reading, so none is removed.
- **(b) A slow fixture shared: none applied.** The largest per-case fixture is lead-integrate's `fx` (a bare origin,
  a clone, two pushed commits, a second clone and a linked worktree): 0.36 s each, measured in isolation, and the suite
  builds 33, so about 12 s of its 244. A `cp -R` template would break the linked worktree (its gitdir paths are
  absolute), and the saving is under 1 % of the shell seconds: below the bar, not filed. The engine's start-up was
  checked too: `lead-integrate.py` (which loads the 860 KB `reconcile-rollout.py` by path) starts in 0.14 s with or
  without a bytecode cache (`PYTHONPYCACHEPREFIX`), so caching saves nothing.
- **(c) A prompt-text pin a contract test covers: none removed.** The 74 contract files take about 73 s of test time
  (2 % of the total, about 18 s of wall time at concurrency 4). Removing every pin would save under 20 s; judging each
  against the code it pins is not worth that.
- **(d) A test slower than its value:** the one suite that costs more than it should is `tests/leg.test.sh` (527 s,
  one file), not because a case is useless but because it is one file: it sets a shard's floor (§ 3). Filed, not
  trimmed. The reflect readers' node tests (about 375 s of test time) are the next place to look once a per-file
  time exists.

## 6. Flakiness

- **The Run records:** 3 `flake` events across every thread-skill rollout. One on 2026-11-03 (`tests/verify-slot.test.sh`,
  task `wave-ralph-verifier-lint-gap`); two on 2026-11-08 at the same instant, which are **one test counted twice**:
  `tests/merge-task-base.test.sh` case 8b's assertion line (`8b. --self-test-base under GIT_DIR + GIT_WORK_TREE exits
  0`) and the self-test's own summary line inside it (`… : ALL PASS`). reconcile-rollout.py keys a follow-up by
  (repo, test), so it filed two: [[thread-skill-followup-flake-111f0712fd]] and
  [[thread-skill-followup-flake-c04dc6ff0c]]. Filed: [[thread-skill-followup-suite-audit-one-flake-one-followup]].
- **Completion-verify flakes:** 0 (every event's site is `task`).
- **CI, every red job in the window (16):** none is a flake. Not one went green on the same head, by a re-run or a
  later run.
  - 12 ubuntu jobs failed `tests/release-check.test.sh` (`(c) .DS_Store and __pycache__/ in the cache still exit 0`, or
    the diff shim's quoted form): GNU diffutils 3.12 on ubuntu-latest shell-quotes a path with a space, a real break,
    fixed by #335 (`fix/release-check-quoted-diff`). Run 42421273174 failed it on both attempts.
  - 4 jobs (2 ubuntu, 2 macOS; runs 42474166663 and 42485394849) failed the fast-tier map check and `C1: check passes
    on the real repo`: their branches (p43-2, p43-5) lacked a map line, a real red each branch fixed later.
- **Estate ADR 0011 d2** (more than two flakes in a project's week breach its budget): the week of 2026-11-02 to 08
  holds 2 real flakes, at the line, not over it; the record reads 3 because of the double count, which would trip it.
- **The habits most likely to flake under load:**
  - 118 `sleep N` lines across the shell suites, most of them poll loops (`sleep 0.1` until a file appears, with a
    count bound); the real ones drive a timeout in real time, for example `completion_timeout: 1` against a
    `sleep 5` verifier, or `lc_bounded 1` against `sleep 30`.
  - Elapsed-time asserts: `tests/leg-capacity.test.sh` L6 and L7 assert a claim returns in under 10 s (at ADR 0011 d3's
    10-s floor); `tests/land.test.sh` bounds a hang's elapsed time by `HANG_BOUND`, set well above its measured
    worst under load 150.
  - No liveness bound below 10 s was found. The recorded flakes (verify-slot, a merge-task self-test under exported
    GIT_* variables) are in process-lifecycle and git-environment code, where these habits live.

## 7. Practice: what the best practice is for this sort of repo

**His question: "What are the best practises around testing for this sort of repo?"** For a stdlib-only repo of
python and shell scripts that drive git and each other, with node only as a test runner, current practice (research
note "Test practice for Python, node, Swift and shell", 2026-10-22, inside estate ADR 0011 d5's six months) comes to
five habits, and this repo already has most of them:

1. **One entrypoint that runs suites in parallel, with declared tiers.** Done: `tests/run.sh` caps its background
   suites (p23-4), and the fast tier is declared by a map (ADR 0073 d1), the research note's advice for tests that
   drive other processes (Choosing per stack, test-impact mapping: "declared source globs ... the safer primary").
2. **Per-test or per-suite durations, read from every run.** Applied here: each suite's seconds, every run.
3. **A liveness bound on everything, never a tight wall-clock bound.** Missing: nothing bounds a hung suite or node
   test except the CI job's limit. Filed.
4. **Injected clocks instead of sleeps.** Mostly done: the engine takes `--now`, `THREAD_MACHINE_TIMES` and
   `THREAD_HEAT_LEVEL`; a few timeout tests still wait in real time.
5. **Flakes recorded, never silently retried.** Done locally (the Flake check, ADR 0050), with one counting bug
   (filed); CI retries only a cancelled required check (ADR 0073 d4).

The home-grown shell harness should stay: the note's own reading for shell is that "an existing home-made harness
that already runs suites concurrently loses little by staying", given declared tiers and per-suite durations, which it
now has.

| Subject | This repo today | Current practice (research note) | Verdict |
|---|---|---|---|
| **Runner and reporter** | `node --test` over explicit globs; the default reporter is TAP on CI's node 22 and spec on the Mac's 23.9 | § 5: `reporters (built-in)`, the default on non-TTY stdout moved from TAP to spec in v23.0.0, and output is "not a stable programmatic contract" | Filed: node 24 LTS on CI with one pinned reporter ([[thread-skill-followup-suite-audit-node-24-on-ci]]) |
| | Home-grown `assert.sh` shell suites, run concurrently by `run.sh` | § 7: bats-core 1.14.0 is the maintained runner; its `--jobs` needs GNU parallel; Choosing per stack, Shell: a home-made concurrent harness "loses little by staying" | Keep: a rewrite of 71 suites buys nothing the harness lacks |
| | No per-suite time until now | § 7 (`--timing`), Choosing per stack: "a per-suite duration and JUnit-shaped report" | Applied here: `<label>: ok\|FAILED (<N>s)` per suite and step, and the run's seconds |
| **Per-test timeouts and wall-clock bounds** | `--test-timeout` unset (Infinity); no per-suite bound, so a hang holds the job to its limit | § 5: `--test-timeout (CLI)`, default Infinity; § 7: `BATS_TEST_TIMEOUT`; § 8: Bazel sizes with default timeouts; estate ADR 0011 d3: a liveness bound of 10 s or more | Filed: a per-suite liveness bound and `--test-timeout` ([[thread-skill-followup-suite-audit-liveness-bounds]]) |
| **Fake clocks** | Env-injected readings (`THREAD_MACHINE_TIMES`, `THREAD_HEAT_LEVEL`) and `--now` on the engine's verbs; 0 test files use `mock.timers`; some timeout tests sleep for real | § 5: `MockTimers` stable since v23.1.0, mocks `setTimeout`, `setInterval`, `setImmediate` and `Date` | Keep: the engine is python and shell, so a node fake clock reaches none of it; injected readings are the right tool, and the real-time timeout tests are few and above the 10-s floor where they assert speed |
| **Flake reporting** | The Flake check (ADR 0050) re-runs a red's named tests, then the suite, and files a follow-up; CI re-runs only a cancelled required check (merge-task, ADR 0073 d4) | § 8: "retries feed a flake record rather than turning red into green"; § 5: `--test-rerun-failures` needs v24.7 (CI runs 22) | Keep the design; fix the double count (filed); `--test-rerun-failures` comes with node 24 |
| **Coverage and test-impact mapping** | None. `tests/fast-tier.map` declares reach by name reference | § 3: coverage.py maps lines to the Python test function that ran them (dynamic contexts), needs `patch = subprocess` for child processes and sees no other language, while the tests here are shell and node suites that run the engine as child processes; § 5: c8 12.0.0 reports by source file, with no per-test context; Choosing per stack: declared globs first, coverage as a periodic completeness check | Keep the declared map; the two filed reach tasks own its precision |
| **Property tests** | None | § 4 (Hypothesis), § 5 (fast-check 4.10.2, inside an ordinary `test()`) | Not now: it would be the repo's first dependency. Candidates when one is allowed: `shard.py`'s every-entry-exactly-once split and `fast-tier.py`'s glob rules |

## 8. #327's findings and where each went

The review of #327 (`docs/reviews/2026-11-07-6e8773c-9102f4.md`, consumed in that PR's history, 9 findings, all filed):

| # | Finding | Where it went |
|---:|---|---|
| 1 | 60 treats the symptom; nothing tracks the split | Resolved by p43-3 (#351): PRs run the fast tier, master runs the full suite in shards; this PR brings the limits down |
| 2 | Shell results print only after node, so a cut job shows none | **Fixed here**: each suite's line as it ends, every block before node (`tests/fast-tier.test.sh` F15 to F17) |
| 3 | Nothing measures a job nearing its limit | Owned by p43-5 (#348, landed 2026-11-08): CI headroom in the Run record, the Reflection's 80 % breach |
| 4 | The "over 12 min, raise THREAD_TEST_JOBS before timeout-minutes" rule contradicts itself | **Fixed here**: test.yml's comment rewritten |
| 5 | The comment's job times are wrong, and ubuntu's were deleted | **Fixed here**: measured ranges for both OSes |
| 6 | One job-wide limit loosens ubuntu | **Adopted for full-suite.yml** (35 and 30); for test.yml filed ([[thread-skill-followup-suite-audit-per-os-ci-limits]]): p43-5's reader takes only a plain number |
| 7 | THREAD.md's quirk still says 40 min and 14 to 25 | **Fixed here**: today's limits, ranges and shards |
| 8 | "while the suite is split" reads as if it already is | **Fixed here**: the phrase is gone |
| 9 | `actions/setup-python@v5` runs on the deprecated Node 20 | **Fixed here**: `@v6` in both workflows |

## 9. Recommendations, ranked by minutes saved per run

| # | Recommendation | Minutes saved | Status |
|---:|---|---|---|
| 1 | Narrow the fast tier's reach, so fewer PRs run the full suite in the required job | The largest: for each commit that turns FULL → FAST, a PR's checks drop from a full run (macOS median 35 min, ubuntu 28) to a FAST one, unmeasured on CI yet (no FAST run has completed; a FAST selection runs a median 99 of 187 files). 44 of the last 60 commits are FULL | Filed before this audit: [[thread-skill-followup-fast-tier-narrow-the-reach]], [[thread-skill-followup-fast-tier-over-selection]] |
| 2 | Split `tests/leg.test.sh` (527 s, 20 % of the shell seconds) into two or three files | About 5 to 6 min off master's macOS full-suite wall (the slowest shard from about 16 to about 10), and the macOS shard limit down to about 20 to 25; about nothing locally at the default cap of 4 (the shell phase is bound by total work), about 2.5 min at a cap of 8 (§ 3) | Filed: [[thread-skill-followup-suite-audit-split-the-leg-suite]] |
| 3 | Weigh the node files by measured seconds in the shard split | About 2 to 4 min off the node-heavy shard (shard 3's node phase ran 4.2 to 8.2 min, the others 0.6 to 2.8, on equal byte shares); it sets the slowest shard once (2) lands, and set ubuntu's once already | Filed: [[thread-skill-followup-suite-audit-node-file-weights]] |
| 4 | Weigh the shell suites by measured seconds | 0 on the slowest shard today (the leg floor); balances the shard sums (673 to 673.5 s each, from 475 to 958), and makes (2) pay in full | **Applied in this PR** (`tests/lib/shard.py`, `tests/shard-weights.tsv`) |
| 5 | Bring `timeout-minutes` down | 0 on a passing run; a hang reports red 5 min sooner on a PR check (55, from 60) and 25 to 30 min sooner on a shard (35 and 30, from 60) | **Applied in this PR** |
| 6 | A per-suite liveness bound and node `--test-timeout` | 0 on a passing run; a hang reports in minutes instead of at the job's limit, and a local run ends | Filed: [[thread-skill-followup-suite-audit-liveness-bounds]] |
| 7 | Per-OS limits for test.yml | 0 on a passing run; an ubuntu hang reports at about 40 instead of 55 | Filed: [[thread-skill-followup-suite-audit-per-os-ci-limits]] (after p43-5) |
| 8 | Print each suite's line and seconds as it ends | 0; a cut job is diagnosable, and every run measures itself | **Applied in this PR** (`tests/run.sh`) |
| 9 | One flaky test, one follow-up | 0; the flake count estate ADR 0011 d2 trips on stays true | Filed: [[thread-skill-followup-suite-audit-one-flake-one-followup]] |
| 10 | Node 24 LTS on CI with one pinned reporter | 0; CI and Mac logs read alike, and `--test-rerun-failures` becomes available | Filed: [[thread-skill-followup-suite-audit-node-24-on-ci]] |
| 11 | `actions/setup-python@v6` | 0; avoids both required checks failing when GitHub drops Node 20 | **Applied in this PR** |

Not recommended, with the reason in § 5: removing prompt-text pins (under 20 s), sharing lead-integrate's git fixture
(about 3 s of wall time, unsafe with linked worktrees), a bytecode cache for the engine (no saving).

## 10. What stands between the full suite and the 20-min budget

It is under the budget: 16.2 min at a quiet hour, 16.8 on the week's median under rollout load. It is not far under,
and it is growing: each rollout's median rose from 12.7 min (2026-11-03) to 19.2 (2026-11-08), and the latest
rollout's slowest green run took 21.5.

If that growth goes on, next week's median passes 20 min. What would move it, measured:

- **The cap.** At 8, the run took 12.6 min (§ 3), but it loads the Mac twice as hard; the default is the operator's
  call (p23-4).

- **The work itself.** The shell phase is bound by total shell seconds over the cap, and 86 % of them are suites that
  drive the engine through real repos. Only less work moves it: estate ADR 0011 d3's habits on new tests (a rule
  tested once, at its lowest layer; a table over copies), and consolidation of the largest suites (`leg`,
  `lead-integrate`, `git-env-canary`, `primary-refresh`, `unfinished-rollout`: 44 % of the shell seconds).
- **Not the pins, the fixtures or the self-tests.** Each is under 1 % (§ 5).
- **The full suite runs less often than it did.** PRs run the fast tier (ADR 0073 d3) and the rollout's merges the
  fast tier (d1), so the 20-min budget is now read mostly on the completion verifier, master's shards and Lachy's
  own runs.

## Method and caveats

- **Load.** Every local run was timed through `verify-slot.py run --slots 2` from a separate clone of the
  instrumented commit, so this checkout could be edited meanwhile. Each run records its 1-min load at start and end;
  M1 to M4 ran at 03:49 to 05:05 local, a quiet hour (load 3 to 5, short edits and a few seconds-long checks in
  the worktree beside them). One run's seconds are mostly its load (estate ADR 0011 d1), so the totals and the weights
  are medians of M1 and M2, never one run; M3 and M4 are single runs and read only for their shape.
- **One source per number.** Local per-suite and per-phase seconds: the `<label>: ok (<N>s)` lines (bash's `SECONDS`,
  whole seconds, so a suite under a second reads 0). Node per-test seconds: the spec reporter's `(Nms)`. CI job
  minutes: `gh api .../actions/runs/<id>/jobs?filter=all` (`started_at` to `completed_at`); CI phases: the job logs'
  timestamps at `== suites`, `== node tests` and node's `# duration_ms`. Run-record numbers: `suite-ended` rows with
  `outcome: green`.
- **The node phase by file** is a name match (93 % of the seconds placed) and is only read for "where", never as a
  weight.
- **CI is three days of data,** and three full-suite.yml runs. The shard limits rest on those runs and the shard
  prediction; this PR's own CI run (FULL on both OSes) prints per-suite seconds, a cross-check, never the weights.
- **The research note** is dated 2026-10-22, 18 days before this audit, inside estate ADR 0011 d5's six months; it was
  not refreshed.
