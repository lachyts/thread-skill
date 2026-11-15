# Test suite audit — 2026-11-16: the merge wait

Audited at `632defa` (master; the primary checkout carried uncommitted THREAD.md and handoff edits and an untracked
`.scratch/`, none read by CI). Read-only: no local timed run. The timings are CI's own, 150 `test.yml` runs (322 jobs,
2026-11-08 to 2026-11-15), plus three read-only agents and two micro-timings. Builds on
`docs/audits/2026-11-09-test-suite.md`, which it does not repeat.

**Why:** Lachy ruled the merge wait the next focus (2026-11-16). Thread Skill PRs wait 45 to 110 minutes on the two
required checks against about 6 on Chorus, and last week's Time-lost ledger put the Integration lane at 96.1 h (11-02
to 11-09), second only to stalls. ADR 0073 made the fast tier the PR gate, so the question was why the gate is not fast.

## Headline

- **The runner queue is not the cost.** Job created to started: median 0.0 min ubuntu, 0.1 macOS (max 15.1). Every
  minute of the wait is run time.
- **The fast tier is the full suite in all but name.** 39 % of jobs in the window fell to FULL. The rest selected a
  median **191 of 199** test files. Under today's map, replayed in a clean clone, 41 of 85 recent PRs select 150 or more
  files and 13 are FULL (all from config: the map, a workflow, the Makefile).
- **A PR check's wall is two numbers added together.** On a job that selects 150 or more files (median): macOS 43.3
  min = shell phase ~29.6 (leg.test.sh alone 28.2) + node phase 13.5. Ubuntu 34.5 = ~21.7 (leg 19.1) + 12.2. The node
  phase starts only after the last shell suite ends.
- **Each PR pays it at least twice.** A merged PR needed **2.2 CI runs** on average (5 at worst): the task's own push,
  then the lead's integration push, plus a re-run for each job cut at its limit. First CI start to merge: median 133
  min, p90 585. The integration push is what brings a PR level with master, so strict checks add little on top.
- **macOS costs more than it catches.** 22 macOS jobs were cut at the 55-min limit while ubuntu passed. The 4
  macOS-only failures were all timing flakes or liveness-bound cuts, none a BSD/GNU difference. Since 2026-10-15
  macOS CI caught 0 BSD/GNU product bugs and 2 races; ubuntu caught both of the real platform bugs.
- **Biggest wins without changing what a PR must pass:** shard each required check behind an aggregator that keeps
  its name (macOS 43 → about 22 to 26 min, modelled), a bytecode cache for the engine (measured: loading
  `reconcile-rollout.py` takes 105 ms without it, 53 ms with it), then split `tests/leg.test.sh` so it stops setting
  the shard floor.

## 1. Where the time goes

### The PR check, job by job

Successful jobs, `make test-fast` step minutes, 2026-11-08 to 15:

| OS | Kind | Jobs | p10 | median | p90 | max |
|---|---|---:|---:|---:|---:|---:|
| ubuntu | FULL | 58 | 23.8 | 30.4 | 36.5 | 44.9 |
| ubuntu | FAST | 90 | 3.1 | 29.8 | 43.0 | 48.2 |
| macOS | FULL | 54 | 31.0 | 42.1 | 48.3 | 53.2 |
| macOS | FAST | 71 | 3.7 | 30.4 | 52.5 | 54.5 |

FAST by selection size: 50 to 99 files ran a median 4.1 min (ubuntu) and 7.5 (macOS); 150 to 199 files ran 37.6 and
48.3. Two thirds of FAST jobs were in the second group. Conclusions over the window: macOS 133 success, 22 cancelled,
6 failed; ubuntu 156 success, 5 failed.

### Which suites

Total CI seconds over the window, both OSes (420 suite-hours in all, plus 46.5 h of node phase):

| Suite | Share | macOS median | ubuntu median | Local (11-09) |
|---|---:|---:|---:|---:|
| `tests/leg.test.sh` | 23.0 % | 1778 s | 1146 s | 527 s |
| `tests/lead-integrate.test.sh` | 8.3 % | 644 | 362 | 244 |
| `tests/unfinished-rollout.test.sh` | 6.9 % | 546 | 366 | 112 |
| `tests/git-env-canary.test.sh` | 5.3 % | 393 | 252 | 154 |
| `reconcile-rollout-auto-retry.test.sh` | 3.9 % | 229 | 220 | 62 |
| `tests/primary-refresh.test.sh` | 3.6 % | 364 | 141 | 146 |
| `reconcile-rollout-completion.test.sh` | 2.9 % | 234 | 163 | 94 |
| `reconcile-rollout-human-fix.test.sh` | 2.5 % | 174 | 160 | 54 |
| `tests/merge-task-integrated.test.sh` | 2.5 % | 213 | 143 | 92 |
| `tests/land.test.sh` | 2.3 % | 197 | 95 | 62 |

By kind (agent 1, regex over each file's code): 61 shell suites that build real git repos hold 83 % of CI seconds; 23
of those also carry real sleeps or deadlines (54 %). Node's 63 prose-pin contracts hold about 1 %.

### Why leg is so slow, and slower on macOS

`tests/leg.test.sh` makes about 1,528 `leg.py` launches, 1,108 other python launches and 2,170 git calls (traced).
`leg.py` loads `reconcile-rollout.py` (1.1 MB) and `serial-chains.py` by path, and `_load` sets
`sys.dont_write_bytecode = True` (`skills/execute/scripts/leg.py:835`). Every launch therefore recompiles them.
Measured on this Mac: the load takes 105 ms with no cache and 53 ms with a cache from `PYTHONPYCACHEPREFIX`.

The heaviest engine-loading suites run 3 to 4.5x slower on macOS than locally. Lighter suites run about 1.4x.
`THREAD_TEST_JOBS=4` on a 3-vCPU macOS runner gives each suite at most 0.75 of a core, and compiling is
single-threaded CPU work (inference, not profiled). Real sleeps in leg come to about 13 s.

`reconcile-rollout.py` grew from 859 KB (11-09) to 1,145 KB. Over the same span leg's macOS median grew 44 % while
its sections grew 12 %.

### The node phase

The node phase has a median of 820 s on macOS. Its files run at an average concurrency of 2.4 out of 4.
`tests/reflect-weekly.test.mjs` alone takes 383 s and finishes last, because node takes files in glob order
(`tests/run.sh:228`), not longest first.

## 2. Redundancy

Agent 3 read the ten slowest suites. Redundancy is real but not the main cost:

- **Near-certain cuts or push-downs: about 217 s of suite seconds per run** (about 14.5 CI-hours a week). The largest:
  - completion C11/C5x: about 30 sections build a bare origin to test two pure functions (73 s);
  - human-fix: 11 cases duplicate auto-retry ones (30 s);
  - auto-retry: setup checks repeated in every A17/A18 row (26 s);
  - leg: L1v landctl, L16e, half of L17e, L10's close snippet, L19b1 (45 s);
  - git-env-canary: the nv loop over three kinds where the canary branches on two (21 s);
  - lead-integrate: the C1 key loop (12 s).
- **Plausible: about 175 s removed and 148 s pushed down to in-process tables.**
- **Legacy readers: about 174 s, if the code is retired too.** leg's in-place mode (ADR 0075 d4 keeps it for
  pre-0075 notes) and unfinished-rollout's protocol-3 migration and K6. Whether to retire them is a product call.

**What it buys on the clock:** only cuts inside leg move today's macOS wall (about 2.5 min for leg's 14 sections). The
rest shaves the shell-seconds ÷ 4 bound by about 1 min. After the shards land, each cut pays in its own shard.

**Growth.** The suite has never been consolidated: 2 of 496 first-parent commits cut more than 40 test lines, both
feature removals.

| Measure | 2026-10-15 | 632defa |
|---|---:|---:|
| Test lines | 34,117 | 120,456 |
| Shell suites | 31 | 79 |
| Node files | 47 | 120 |

Test lines track source lines at 1.17 to 1. leg.test.sh went from 716 lines on 10-20 to 3,697 now. #400 (test rules in
the engine's prompts) carries all seven lean-test rules but only informs. None of the 8 PR bodies checked after it
answers its "how many tests, and why" line.

## 3. Flakiness

There was no local run, so nothing to re-run alone. In CI: 4 macOS-only failures, none a product bug.

| Run | What failed | Kind |
|---|---|---|
| 42869709516 | leg-capacity L9 | test timing; fixed in f9393cf (#404) |
| 42929153140 | unfinished-rollout and leg cut by their liveness bounds | the bound's factor was 3, since raised to 10 |
| 43212134253 | live-checkout LC10, a 2-s poll | timing |
| 43599785678 | `note-overlap-opener.test.mjs` hit node's 1200-s file limit | hang of unknown cause; an un-timed `spawnSync` at :62 |

The 22 macOS cancellations at 55 min are the costlier flake: each re-runs a whole job.

The worst timing-sensitive lines (agent 2):

- `tests/git-env-canary.test.sh:285`: an upper bound of 4 s, in whole seconds;
- `skills/execute/tests/reconcile-rollout-completion.test.sh:428`: `sleep 0.2`, then it assumes a lock is held;
- `git-env-canary.test.sh:303`;
- `tests/leg.test.sh:1026` and `:3457`: upper bounds on elapsed time;
- `tests/live-checkout.test.sh:350-353`: a 2-s poll that failed in the window.

## 4. Structure: the tier and its reach

The fast tier exists and is declared (ADR 0073, `tests/fast-tier.map`). Its reach is the problem. The 32 first-parent
commits since 11-12, replayed against today's map from tracked files only, select a median 194 files (p25 92, p75
196). Docs-only commits select 87 to 88. What fans it out (agent 1, `tests/lib/fast-tier.py`):

| Cause | Where | What fixing it buys |
|---|---|---|
| The transitive carrier push has no depth limit: `leg.py → unfinished-rollout.py → primary-hold.sh → land.sh → self-rollout-check.sh → merge-task.sh → …` | `fast-tier.py:382-391` | Depth ≤ 1: median 188 → 158 files, about −3.4 min. Depth 0: 93 files, p75 still 37 min |
| `docs/**` places `docs/spikes/2026-11-02-replan.py` as a carrier; it names serial-chains.py and so pulls in all 77 contracts | map:200 | 194 → 188; no risk (no test runs the spike) |
| The FOREIGN `SKILL.md` matches by whole basename, so any SKILL.md edit selects leg, lead-integrate, unfinished-rollout, git-env-canary, land and auto-retry | map:22, `fast-tier.py:336,383-386` | A SKILL.md-only PR: about 43 → 13 to 15 min. Needs declared reader paths (auto-retry reads `$HERE/../SKILL.md`) |
| `contract-text.mjs:108-110` names `SKILL.md`, pushing its 11 non-contract importers | | about −11 files on prose diffs |
| The rr HUB lists 99 tests, all 9 slow suites among them; rr is touched in 34 % of commits | map:100-120 | Cannot be cut at file level |

The selection fixes top out at about −4 min on the median code PR. They pay more on prose-only PRs.

**A local-only defect:** `fast-tier.py` counts untracked files as carriers. The primary checkout's `.scratch/*.py` make
`leg.py`, `legs.md`, ADRs and most scripts read FULL locally (`reaches .scratch/p53-p109/gen.py, not in the map`). CI
never sees it, but every local `make test-fast` in that checkout runs the full suite.

**The practice note** (`captured: 2026-10-22`, under six months, not refreshed) names nothing this stack lacks for
the merge wait. The duration report already exists (run.sh's per-suite lines) and the flake record is in the Run record.

## 5. Parallelism

**Within one job.** The shell phase is full: 37 idle slot-seconds in 1805 on macOS. Only less work, or more cores,
moves it. Overlapping the node phase with the shell phase saves at most about 3 min on macOS. Node must share the
4-slot cap, because 8 at once made the 3-vCPU runner slower (2a5150c). Starting `reflect-weekly` first gets most of
that with no change to output grouping. Pinned by `tests/fast-tier.test.sh:578-582` (F15) and
`tests/test-jobs.test.sh:135`.

**Across jobs, behind an aggregator.** Each required check would become a matrix of shards over the fast tier's
selection, plus one aggregator job carrying the exact name `make test (<os>)`. The aggregator runs on ubuntu for both
names, so it never takes a macOS slot. It keeps ADR 0025's ruleset unchanged. What it needs, in order:

1. `tests/run.sh` gets a select-then-shard mode. Its modes are exclusive today (`run.sh:61-77`), but `shard.py`
   already splits any entry list.
2. The engine reads through the aggregator:
   - the infra re-run (`merge-task.sh:1333-1420`) must look at the shard jobs' failed steps;
   - the timeout re-run (ADR 0073 d4, `merge-task.sh:1278-1300,1478`) must treat a shard cut at its limit as a
     cancellation, though the aggregator concludes `failure`;
   - CI headroom (`lead-integrate.py:1744`, `_job_limit`) must record the slowest shard, not the aggregator's seconds.

   `merge-gate.py` and the no-runner logic already follow `needs:`.
3. `test.yml` and `tests/ci-workflows.test.mjs` W1/W2 are rewritten. A skipped job reports success, so the aggregator
   needs `if: always()` and must fail unless every shard succeeded.

**macOS concurrency.** Agent 2 replayed the window's 161 PR and 253 master macOS jobs through a 5-slot queue (model).
With 4 PR shards: shard wait median 0, p90 2.6 min, max 19.9. The macOS check's median falls from 48.2 to 26.1 min. Three
shards give 26.0, because leg is the floor until it is split. The 5-slot cap comes from commit 52a5eab
(`merge-task.sh:230`) and was not re-verified against GitHub's current limits.

**leg's split.** No section shares state with another, apart from `STATUS_LINES` across L1-L11 (`:200,:848`) and the
L19 exports carrying into L20-21 (`:2954`). Helpers defined mid-file move to a sourced `tests/lib/` file, which joins
the rr HUB line. Four balanced parts: L1-L16, L17, L18, L19-L21. On today's single job the split saves 0 to 1.6 min. In
shards it sets the floor: about 9 min for the longest part on macOS (estimate).

## Ranked changes: minutes saved per run

Baseline: a PR check that selects 150+ files, macOS 43.3 min and ubuntu 34.5 (window medians, CI load). The PR waits
on the slower one, times 2.2 runs per merged PR. Master's full-suite shards are a separate number.

| # | Change | Saves per PR check (macOS) | Changes what a PR must pass? |
|---|---|---|---|
| 1 | Shard the required checks behind name-keeping aggregators (with run.sh select+shard and the engine reading through) | about 17 to 21 min (43 → 22 to 26), modelled | No: the same tests run |
| 2 | Bytecode cache for the test run (`PYTHONPYCACHEPREFIX`, warmed by `compileall`) | about 4 min of leg on macOS (measured: 52 ms saved per engine load × ~1,500 launches × 3.2); more across rr-loading suites, not measured | No |
| 3 | Split `tests/leg.test.sh` in four | 0 to 1.6 alone; about 5 more once (1) lands (sets the shard floor), and master's slowest shard 21.8 → about 16.5 | No |
| 4 | Narrow the reach: docs carriers NONE, the contract-text literal, declared SKILL.md readers, carrier depth ≤ 1 | about 4 on the median code PR; prose-only PRs 43 → 13 to 15 | No for the first three. Depth ≤ 1 moves some reach to master |
| 5 | Node longest-first (`reflect-weekly` first) | about 1.5 to 3 | No |
| 6 | Near-certain redundancy cuts | about 1 now (2.5 inside leg); 14.5 CI-h a week | No |
| 7 | Fix the 5 worst timing-sensitive tests and the un-timed `spawnSync` | each avoided flake saves one 45-min re-run | No |
| 8 | Selector ignores untracked files outside the map's roots | 0 on CI; a local `make test-fast` stops running FULL | No |
| A | macOS leaves the required checks (stays on master's shards). **Ruled by Lachy 2026-11-16: "Drop it from PRs"** | 43.3 → 34.5 today; about 0 after (1) | **Yes** |
| B | The slowest suites (≥ 180 s on macOS) leave the checks before a merge for master and the completion verifier. **Ruled by Lachy 2026-11-16: "Move them off PRs now"** | 43 → about 26 today; less after (1)-(3) | **Yes** |
| C | The required checks stop being strict | little: the lead's integration push already brings each PR level with master and triggers its run; not recommended | Yes |

Lachy then reframed the gate (ADR 0084): merging is light, and code goes live only from the newest master commit
whose full suite passed.

Rows 1 to 8 together (estimate, not additive in a simple way): a 150+-file PR check at about 15 to 20 min on macOS,
from 43. That is before A or B.

**Evidence for row A.** Every merge already runs `make test-fast` on Lachy's Mac in the Integration lane (ADR 0073 d1),
so the macOS CI check repeats the platform the lead has just verified. Since 2026-10-15, macOS CI caught 0 BSD/GNU
product bugs, 2 races (56b7567, 92d0ec0) and test-only issues; ubuntu caught both platform bugs (9f1bf29,
0498dc3/bc27b27). In the window, macOS cost 22 cuts at 55 min and 4 flaky reds, each a re-run of the whole job.
Master's full-suite shards keep running on macOS either way.

## Proposed phase

Phase 54, "Merging is light, going live waits for the Green tip" (ADR 0084, grilled with Lachy on 2026-11-16 from
this audit). Every task is a **Speed fix**: its evidence is the row or section of this audit named beside it. Tasks 1
to 8 are the core; the rest of Thread's queue is held until task 8 lands (ADR 0084 d4).

1. **The Slow tier is declared, and GitHub's check leaves it out** (rows B, 4; § 1). `SLOW` lines in
   `tests/fast-tier.map`, checked by `tests/lib/fast-tier.py check` against measured seconds. `tests/run.sh --fast`
   drops them only under a flag `test.yml` sets, after a FULL fallback too. Full mode and `--shard` keep them.
   **Verify:** `--fast` with the flag runs no SLOW suite and without it runs them; `bash tests/run.sh --shard-plan 4`
   still lists every suite; `python3 tests/lib/fast-tier.py check` passes.
2. **macOS leaves the PR checks** (row A). `test.yml`'s matrix is ubuntu alone; `tests/ci-workflows.test.mjs` and the
   tests that hard-code both names follow. The ruleset already requires only the ubuntu context (changed by hand on
   2026-11-16, ADR 0025's amendment).
   **Verify:** `node --test tests/ci-workflows.test.mjs` passes; a PR reports no macOS job.
3. **A bytecode cache for the test run, and node's files longest-first** (rows 2, 5). `tests/run.sh` warms a scratch
   `PYTHONPYCACHEPREFIX` once with `compileall` and exports it; node's file order comes from measured seconds.
   **Verify:** a test proves a suite's scripts read bytecode from the prefix and the tree stays unchanged; a test pins
   the heaviest node file first; the PR records leg's seconds before and after.
4. **The fast tier stops fanning out** (row 4, § 4). Docs carriers are NONE, `contract-text.mjs`'s `SKILL.md` literal
   goes, `SKILL.md` readers are declared, the carrier push stops at depth 1, and untracked files are no carriers.
   **Verify:** `select --paths skills/orient/SKILL.md` selects none of the Slow tier; `select --paths` on an ADR
   selects under 50; `tests/fast-tier.test.sh` passes.
5. **Master's full-suite run publishes the Green tip** (ADR 0084 d1). A last job in `full-suite.yml` fast-forwards a
   `green` ref once every shard passed; nothing else may move it.
   **Verify:** `tests/ci-workflows.test.mjs` pins the job and its `needs:`; a probe push to `green` from the Mac is
   refused; after a green master run the ref is that commit.
6. **Live code follows the Green tip** (ADR 0084 d1, d2). The snapshot cut, the Primary refresh (its fast-forward,
   repair and self-update), merge-task's in-place refresh and land.sh S4 stop at the Green tip. The Rollout clone
   stays on origin's tip. With no ref yet, origin's tip. A cut at a named commit, by hand.
   **Verify:** fixtures where origin's tip is ahead of the Green tip: `tests/engine-snapshot.test.sh`,
   `tests/primary-refresh.test.sh` and `tests/live-checkout.test.sh` gain cases where each stops at it.
7. **A red master files its fix** (ADR 0084 Decided for you 3). The failed jobs re-run once; red again files a fix
   task first in the queue, with a Run record line.
   **Verify:** fixtures of a red, a flake and a green master run produce a fix task, a Flake line and nothing.
8. **The Mac's check before a merge goes light** (ADR 0084 Decided for you 1). The rollout's verify takes task 1's
   flag, only once tasks 6 and 7 are live.
   **Verify:** an Integration verify's `suite-ended` line shows no Slow tier suite; the completion verifier still
   runs them all.
9. **`tests/leg.test.sh` splits in four** (row 3). L1-L16, L17, L18, L19-L21, with shared helpers in a sourced
   `tests/lib/` file.
   **Verify:** the four files' `ok` count equals the old file's; `fast-tier.py check` passes.
10. **`tests/run.sh` shards a fast-tier selection** (row 1). `--fast --shard K/N`.
    **Verify:** the union of the N shards equals `--fast`'s selection, with no duplicate.
11. **The merge engine reads a required check through its shards** (row 1, § 5). Infra and timeout re-runs and CI
    headroom read the shard jobs behind an aggregator.
    **Verify:** merge-task cases for a shard that fails setup, a shard cut at its limit, and headroom recording the
    slowest shard.
12. **The ubuntu check runs as shards behind a job that keeps its name** (row 1).
    **Verify:** `node --test tests/ci-workflows.test.mjs` passes; a PR shows the one required context reported by
    the aggregator.
13. **Schedule holds the queue for a Speed fix phase** (ADR 0084 d4).
    **Verify:** a join of a Speed fix phase stamps the hold on every other queued task, and its last task's merge
    leaves none held.
14. **Engine catch-up** (ADR 0084 d5). A running rollout drains, moves onto a snapshot at the Green tip and carries
    on, once a Speed fix is live there.
    **Verify:** a fixture rollout with a Speed fix live past its snapshot starts nothing new, then re-snapshots and
    resumes with no hand in it; an ordinary merge causes none.
15. **The Mac's check and GitHub's run at the same time** (§ 5). Push first; a red after a push has its own route.
    **Verify:** the lane's Run record shows `suite-started` before the required checks end, and a red local verify
    after a push never merges.
16. **The near-certain redundancy goes** (§ 2; normal priority).
    **Verify:** each touched suite passes alone and its seconds fall.
17. **The worst timing-sensitive tests wait on events** (§ 3; normal priority).
    **Verify:** no `sleep` precedes an assertion about a background process in the named files.

**Order and what must not run together.** 3 and 4 follow 1 (`tests/run.sh`, the map). 6 and 7 follow 5. 8 follows 1,
6 and 7. 9 follows 4; 10 follows 3; 12 follows 2, 10 and 11 and runs Solo, as does 2 (they change the gate every
rollout merges through). 14 follows 6; 15 follows 8; 16 follows 9. Tasks that edit `tests/fast-tier.map`,
`tests/run.sh` or `.github/**` run the full suite in their own PR.

## Method and caveats

- **No local timed run.** The audit is about CI's wall, and CI's own per-suite lines (`<label>: ok (<N>s)`) give per-suite
  seconds for 289 successful jobs. Lachy was at the Mac, and a full run loads it (the handoff's rule). The local
  numbers quoted are from the 11-09 audit, plus one single-suite run of `tests/leg.test.sh` by agent 2 (646 s) and
  agent 1's trace.
- **Sources.** Jobs: `gh api repos/lachyts/thread-skill/actions/runs/<id>/jobs?filter=all`. Logs: each job's
  `== fast tier:` line and per-suite lines. Raw files are in `~/.local/share/suite-audit/thread-skill-2026-11-16/`
  (`runs-jobs.json`, `jobs-parsed.json`, `logs/`, `tables.md`, `reach-clean.json`, `analyse.py`).
- **Runs per PR** joins runs to PRs by head branch. Branches older than the 150-run window are truncated.
- **Modelled, not measured:** the sharded wall (agent 2's 5-slot replay), leg's split pieces, the node overlap, the
  cache's saving beyond the measured load, and rows A to C's savings.
- **Measured:** queue and run minutes, the FAST/FULL split, per-suite CI seconds, the rr load time with and without a
  cache (3 runs each on this Mac, 105 vs 53 ms), and that `compileall` writes under `PYTHONDONTWRITEBYTECODE=1`.
- **The macOS evidence** (rows A, § 3) reads commit messages for platform bugs. A fix whose message does not name the
  platform is missed.
- **Not checked:** GitHub's current macOS concurrency limit for this account, and whether the live plugin's engine
  ran #400 for the tasks counted after it.
