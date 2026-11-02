---
slug: thread-skill
created: 2026-07-14
last_touched: 2026-11-02
state: active
scope: Build + maintain the thread:* plugin — continuity verbs + the rollout queue engine (one system, two lanes)
---

# thread-skill — THREAD

## Where we are

**2026-11-02 (later): [[thread-skill-rollout-2026-10-31]] is complete: 14 of 14 tasks merged, archived.**
- Lachy signed off p33-4's irreversible gate at 10:01. The lead resumed its gate-pending run on the signed plan; the handle survived compaction in a `/tmp` file, so this was a resume, not a fresh call.
- The live rig ran against `lachyts/zz-thread-p33-4-e2e` and deleted it. The verifier went green on iteration 3 of 3.
- At Integration, the lead's merge with main went green, and a judge-only review passed the shared files.
- PR #267 merged at 13:19 (b898e35), adding ADR 0064: two projects' parallel rollouts share one repo through per-project rollout clones and a per-origin merge lane.
- P33 is closed, and the run took 51h 32m.
- Filed: [[thread-skill-reflect-whether-p33-freed-queued-rollouts]] (the post-rollout reflect) and, from p33-4, [[thread-skill-followup-p33-4-same-root-loser-later-batch]].

**2026-11-02 (earlier): [[thread-skill-rollout-2026-10-31]] (P33–P35) landed 13 of 14 tasks and paused for sign-off.** Merged in order: #251 p34-2, #253 p33-1, #254 p34-1, #252 p34-7, #257 p33-3, #258 p33-2, #259 p35-1, #260 p34-6, #261 p34-3, #262 p34-4, #264 p34-5, #263 p34-9, #265 p34-8. P34 and P35 are closed; P33 stays open because [[thread-skill-p33-4-parallel-rollouts-share-a-repo]] sits at `gate-pending` on an irreversible gate: create a private scratch repo `lachyts/zz-thread-p33-4-e2e`, open and merge two PRs with `tests/e2e/parallel-rollouts-one-repo.live.sh`, then delete it. Its plan was approved on auto-retry 1/2 after a first plan block. New ADRs: 0059 (p33-1), 0060 (p33-2), 0061 (p35-1), 0062 (p34-3), 0063 (p34-8). Fixes of note beyond the briefs: p34-7's retry found and fixed a real lock-wait race in `completion-verify` (63d6a64) that had failed macOS CI; p34-4 narrowed the Ubuntu flake to the read-only `worktree add --detach` create step on git 2.55 (three data points, root cause still unconfirmed, the test now diagnoses itself). The run took 39h 36m wall clock through three room stops, a soft pause stamped and later removed from outside the session, and a long idle gap.

**2026-10-29: [[thread-skill-rollout-2026-10-26]] is complete: 31 of 32 tasks merged, archived.** P27 and P32 are closed; P28–P31 stay open. [[thread-skill-p31-2-test-rules-and-test-delta]] was deferred to the backlog because it depends on [[agent-stable-p2-3-writing-lean-tests-skill]] (outside the rollout, still open). CI: the macOS `make test` job kept hitting its 25-minute limit with no test failing, so PR #247 raised `timeout-minutes` to 40 and kept `THREAD_TEST_JOBS` at 4 (8 made the 3-vCPU runner slower). Follow-ups filed: [[thread-skill-p34-4-ubuntu-flaky-tests]], [[thread-skill-followup-p32-3-chorus-boundary-prompt]], [[thread-skill-followup-p31-4-chorus-adr-0104-amendment]], [[thread-skill-followup-reflect-rollout-2026-10-26]].

**2026-10-29: a landing blocks only on serious findings (ADR 0058), and every review round is recorded and read weekly.** The review-convergence audit (`docs/audits/2026-10-27-review-convergence.md`) found that no Claude review round since 2026-09-15 had returned zero findings (0 of 452), so "no accepted finding" was never reachable; narcissus-avp PR #65 ran 16 rounds.
- **Lachy's ruling:** land when no serious finding is open, and wait for his call only when one is.
- **The rule:** a finding blocks only for a crash, hang or wrong result in normal use, data loss or a security hole on any path, or the named test failing; the rest are filed in one follow-up task per landing. The budget is four code rounds, and a full-cap round with no blocking finding earns one more. The ledger's STOP is the agent's to resolve.
- **Recording:** land.sh's `--queue`/`--hold` record every review doc on the branch (`review-round.py --branch-docs`), and the weekly reading's `freshReview` is one entry per landing, counting only rounds reviewed in its window.
- **Landed:** agents-config #5 and #6 (fresh-review half) merged. thread-skill PR #231 is queued with auto-merge, up to date at `19b6a9d`, and merges once its CI is green; master's strict up-to-date rule and the running rollout kept it behind for a day.
- **Run on itself:** agents-config's blocking findings went 8, 6, 3, 0, 0 and it landed; thread-skill's went 5, 3, 1, 0, 1 and held at the budget, where Lachy chose "fix it, then land".

**2026-10-25: the verify-and-canary follow-ups merged as PR #213 (ADR 0053), CI green on macOS and Ubuntu.** Built items 1, 2, 6 and 4. Items 5 (one strict command reader) and 3 (a `run_verify` core) were not built, by Lachy's ruling.
- **Item 1, ADR 0053:** a window whose trip is acked before its check exits 4: no verdict, never a halt. Verify and RACE re-verify re-run; an integrate call reconciles `--no-verdict` (its line reads `void`) on any non-zero check; a task window checks 0 and names its acked trip. `arm --resume` carries `ackedTrips` across a Lost-call or § 5 resume. `completion-verify --run` reads the exit, and `_git_env_trips` is gone.
- **Item 2:** `Note.save` journals every edit, takes a per-directory lock, re-applies its edits over a concurrent writer and refuses one it cannot. It renames a `cp -p` clone into place, keeping the note's created time and xattrs (Lachy's ruling, for Obsidian's sort).
- **Items 6 and 4:** a comment-only value (`key:   # x`, `- # x`) reads as none, while `pr: #7` stays a value. Every `--detach-at` tree is pid-locked, and a dead one's locked registration is cleared.

Review: four rounds at xhigh (3 code, 1 simplify). The ledger STOPped at round 3, its regressions mostly from Lachy's mid-chain rulings; round 4 ran on his word, and its 14 findings were all fixed before the Verify-list merge. p29-2's task now notes it builds on #213's `check` and `Note.save` changes.

**2026-10-24: PR #202 merged (ADRs 0043–0051), after an audit of where rollout time goes.** The re-grill widened into that audit. From September to 21 Oct, stalls, usage limits and machine load cost about 150–185 h; the Integration lane's real merge time cost about 35–50 h. On the Chorus 10-18 run, a stall-free stretch merged 1.15 PRs/h against 0.76 approvals/h. The rulings:
- **Deferred:** the merge train (0044; § Deferred keeps the evidence).
- **New ADRs:** 0048 (no single cause holds the whole queue, plus a Watchdog the Companion acts on), 0049 (the Away cap, overturning Chorus 0104 d3), 0050 (a Flake: named failing tests re-run first, then one full suite confirms) and 0051 (a Time-lost ledger in the weekly reading, a monthly audit, new Run-record events, Thread's reading made for Thursday's Routine).
- **0046:** a Bookkeeping miss never trips, a trip holds only what it threatens, and a RACE red twice is reverted on main.
- **0043:** the snapshot is cut at schedule from origin's tip, and every verb routes to it first.
- **Settings:** the file carries a schema version, and a snapshot ignores newer keys.
- **0047:** grading plus a decision round only.

Review: rounds 3–5 (xhigh, xhigh, simplify) on the reset text; every design gap went to Lachy, and every fix was wording only. The P29 tasks were re-scoped (p29-4 parked, p29-6 dropped, p29-7…13 new), and their plan-gate considerations were filed. Chorus tasks were filed for the Watchdog, the Runner, the Away cap, a Tuesday Inbox Routine and prep-waiting Routines, plus [[fresh-review-grades-its-findings]] (per-finding outcomes, and a `/code-review max` trial on 3 risky PRs) and [[launchd-jobs-refused-on-the-default-claude-profile]] (urgent: no com.lachy job pins a profile). **Not done:** the P29 rollout regenerate. Its checks passed and its 13-task queue was shown, but Lachy dismissed the confirm, so `[[thread-skill-rollout-2026-10-21]]` still holds the old six tasks.

**2026-10-23: thread 5.0.0 is released and installed.** #203 (the engine refuses a call without `verifySlot`) merged at `21f349a` after two clean-room rounds: round 1's 9 findings fixed, round 2 stopped the review ledger (11 of 15 were about round 1's own one-off refusal halt), so that halt was reverted at the root and the rest filed as [[thread-skill-execute-args-refusal-and-slot-followups]]. `verify-timeout` now prints the `verifySlot` object the lead copies. Release PR #206 (`078ffc7`, tag `thread--v5.0.0`, eval record `docs/evals/2026-10-22-release-5-0.md`: 24/24, overall 0.979, one unexplained `next-undecided-what-now` miss) merged; `claude plugin update thread@thread` installed 5.0.0 at `0d45df4`; `make release-check` green. Running sessions keep the engine they loaded: a lead must restart to run 5.0.0. Docs follow-ups (README 5.0.0 notes, manifest wording, eval traces kept): [[thread-skill-5-0-docs-follow-ups]].

**2026-10-21: ADRs 0043–0047 (PR #202, P29's design) are held for a re-grill.** Round 1 of clean-room review found 15 wrong claims, fixed in `0fc0723`. Round 2's ledger STOPped (8 of 15 findings were about mechanism the fix round added). The rest are design gaps: the merge train vs strict up-to-date branches, the healed-trip auto-ack, git config the task worktrees share, and Pre-flight vs supersede, orient-all and plan_approval. Re-grill handed to a fresh session.

**2026-10-20: P24 and P25 have landed, and P26 is one task short. `[[thread-skill-rollout-2026-10-19]]` (archived, § Completion log): 10/10 merged (#183–#192) in 20h 46m from the clone. Phases 24 and 25 closed; P26 stays open on [[thread-skill-p26-3-mark-started-arms-the-task-window]].**
- **Landed:**
  - p24-1 three-way fit test (#183).
  - p26-1 arm and prepare refuse without an owner (#184).
  - p25-1 estate scan (#185).
  - p24-2 schedule writes serial rollouts (#186).
  - p24-3 execute runs Legs (#187).
  - p26-2 every rollout runs from its clone (#188).
  - p25-2 grading and ranking (#189).
  - p24-4 status, repair and reflect read serial rollouts (#190).
  - p25-3 decision round and dispatch, `/thread:orient-all` (#191).
  - p25-4 grade calibration (#192).
- **Run shape:**
  - p24-2 and p26-2 plan-blocked once each (3 rounds), then landed on auto-retry 1/2.
  - Five integrations were the lead's clean merge.
  - Three were verify plus a shared-file judge (p25-1, p24-2, p24-4).
  - Two were conflict integrators (p26-2 on land.sh, execute/SKILL.md and tests/land.test.sh; p25-3 on schedule/SKILL.md).
  - One Chorus room stop (main's week line, 03:26–04:07): both calls stopped at a boundary and resumed on fauxmuse with nothing lost.
- **One needs-you item, about 6h:** the integrate calls for p26-2, p24-4 and p25-3 had to carry 40–71k-character plans verbatim, too large for the lead to pass. Lachy ruled `plan: ""` for those three, and all of them integrated clean. Follow-up: [[thread-skill-integrate-args-plan-too-large]].
- **Not live yet:** the installed plugin is still 4.0.0. One release now follows P24–P26 ([[thread-skill-release-after-p24-p25]]), once p26-3 lands or is carried. Scored `t-20261020T034106Z-4f1b50`.

**2026-10-19: P23 and the P19 tail have landed. `[[thread-skill-rollout-2026-10-18]]` (archived, § Completion log): 7/7 merged (#171–#177) in 25h 9m from the clone; phases 19 and 23 closed.**
- **Landed:** p23-1 one-line spend gate + plan-judge pricing (#171), p19-5 description trim + 700 hard cap (#172; post-trim evals 0.986 vs 0.978, US$40.52), p23-5 a code project's thread lives in its repo + `thread-placement.py` + ADR 0039 (#173), p23-4 machine-wide verify slots + `tests/run.sh` cap (#174), p23-6 Start when ready (#175), p23-3 ntfy fallback for undelivered needs-you pushes (#176), p23-7 PR #88's still-true corrections + the reflect-close-score deadline-regex flake fix (#177; #88 closed, superseded).
- **Run shape:** p23-4 and p23-5 plan-blocked once each (3 rounds), auto-retried 1/2, then landed. Integration: two lead merges (p23-1, p23-7), four integrator calls (p19-5 red on load timeout; p23-4 and p23-3 conflicts; p23-5 red flake + shared files), one judge-only shared-file review (p23-6). No RACE, no git-env trip, no needs-you item, no gate reached Lachy.
- **Interruptions survived:** three Chorus room stops (claude-2 5-hour, animately week, claude-2 week) and three usage-limit cuts (claude-2 monthly spend, main 5-hour twice); every stopped or cut call was resumed by `resumeFromRunId` with its original args, never reconciled.
- **Not live yet:** the installed plugin is still 4.0.0 and the primary checkout is 36 behind origin. [[thread-skill-release-4-1-0]] carries the release decision and the install-first `[notify] ntfy_topic` / `verify_slots` settings. Scored `t-20261019T005958Z-d79bbe`.

**2026-10-18: ADR 0038 merged; P22's rollout is closed out and `[[thread-skill-rollout-2026-10-18]]` (P23 + carried p19-5) is executing from the clone.**
- **`[[thread-skill-rollout-2026-10-17]]`**: 10/11 merged (p19-10 at 10:50 after Lachy signed its US$20 gate in the morning). It stalled overnight because the fail-closed pricer read the planners' prose (`each`, bare numbers, bare `plus`) and an undelivered push was logged as pushed. Superseded at 14:15 (Lachy: carry p19-5 forward), scored `t-20261018T055357Z-907caf`, archived to `Work/Tasks/Archive/Rollouts/`.
- **ADR 0038 "a Cap is a promise"** (grill-with-docs, three clean-room review rounds, PR #168 `0b1c2a7`): one-line `spend: <what> — cap N USD` gates with the split in sub-bullets, pricer unchanged, plan judge prices via `exposure -`, one bounce for a never-priceable gate, ntfy fallback (`[notify] ntfy_topic` in `rollouts.toml`) only on Remote Control inactive/error. Built by `[[thread-skill-p23-rollouts-run-through-the-evening]]` (p23-1, 3, 4, 5, 6, 7; p23-2 folded into p23-1).
- **Forks ruled:** PR #88 → trimmed landing (p23-7); 5c5a `.thread/` and the thread-rollout-redesign worktree archived under `~/Archive/thread-skill/` (+ branch `archive/thread-rollout-redesign`, `14676a3`); p21-5/p21-9 done. [[ntfy-noise-audit]] filed.
- **Execute** handed off (`docs/handoffs/2026-10-18-execute-p23-rollout.md`, landing PR #169) to the Chorus Session "Thread Skill: execute the P23 rollout", which consumed it.
**2026-10-17 (evening): the P22 rollout ran 9/11 and closed awaiting sign-off.** `[[thread-skill-rollout-2026-10-17]]` (paused `paused_for: sign-off`, § Completion log): merged #157 to #165 in 7h 16m from the clone, phase 22 closed. Left: [[thread-skill-p19-10-eval-close-consumed-fixture]] is gate-pending on a spend gate (cap US$20, up to 6 eval invocations at `--max-cost-usd 4` each) that the standing approval refused (it cannot price the per-invocation "each"), and p19-5 waits on it.
- **Landed:** p22-1 C17 load-tolerant (#157), p22-2 run-step signal window (#158), p22-3 close/carry vault grammar (#159), p22-7 weekly Reflection gaps (#160), reflect-cites the loops contract (#161), p22-4 close/handoff end on Chorus words (#162), p22-5 next offers Archive this session (#163), p22-6 ADR status sweep (#164), p19-11 handoff manual dry-run eval record (#165, spend signed under the standing approval, US$12).
- **Run shape:** p22-4 plan-blocked once, auto-retried on opus-xhigh. reflect-cites' first merge hit a red required ubuntu check (`tests/pinned-tree.test.sh` bash 13, a flake: master and the other PRs were green), was set aside and auto-retried, and merged on its second CI. Five integrate calls (conflicts on vault-grammar.md, next/SKILL.md, ADR 0037; one shared-file judge-only; one branch-moved). No RACE, no git-env trip.
- **p22-4 changed execute's ceremonies:** `/thread:close` now runs last, after the vault commit, with close's banner and the ROLLOUT-STATUS line in one message. This run's sign-off form followed the new order.
- **The installed plugin is still 4.0.0** and the primary checkout is behind origin (P22 not live).

**2026-10-17: 4.0.0 is installed; the P22 rollout is scheduled and a successor session in the clone is executing it.** `[[thread-skill-rollout-2026-10-17]]`: 11 tasks, p22-1..p22-7, [[thread-skill-reflect-cites-the-reflection-loops-contract]], p19-10, p19-11, then p19-5 last. Project root `~/repos/tools/thread-skill-rollout`, verifier `make test`, built-in settings, standing approval 50 USD (`file:defaults`).
- **Scheduled** via `/thread:orient Thread Skill --steer` (no reshape; drift empty). § 0 passed once landing PR #154 merged (`1b9275c`); before that the pushed-base check refused on the primary's unlanded handoff commit.
- **p19-5 respecced** (Lachy's yes): `skills/split/` is gone; over 700 at `9589e20` are reflect 1,066, close 979, handoff 887. Scope is now those three + `manifest.test.mjs` + a `docs/evals/` comparison record from two `make evals EVAL_ARGS='--runs 3'` runs (pre/post trim, ~40 USD); its plan declares the signed irreversible bullet plus one spend bullet; it `depends-on:` every task that edits close, handoff, reflect or next.
- **Execute** handed off (`docs/handoffs/2026-10-17-execute-p22-rollout.md`, landing PR #155) to a Chorus Session launched in the clone, which consumed it.
- **Waiting on Lachy (grill-me, not resolved):** PR #88 (merge trimmed or close), the 5c5a Codex worktree's `.thread/` evidence, the thread-rollout-redesign worktree (uncommitted, 11 unpushed commits), and the p21-5/p21-9 fork (workspaces master now matches origin, so it looks settled, but no ruling is written). Session-lane work (p11-7, estate/post-P12 chores, execute-offer-start-when-ready, GitHub email block): "Not now".

**2026-10-16 (overnight): P21 has landed. `[[thread-skill-rollout-2026-10-15]]` (archived, § Completion log): 7/7 merged (#144 to #150) in 8h 47m, from the clone, hands-off. Phase 21 stays open for the session-lane p21-5 and p21-9.**
- **Landed:** p21-1 rename Retro → Reflection, `/thread:reflect` (#144); p21-4 Escapes traced by `fixes:` + git (#145); p21-2 the two headlines in the score (#146); p21-3 Review churn recorded and scored (#147); p21-6 every close records a score line via `close-score.py` (#148); p21-7 the weekly Reflection, `reflect.py` (#149); p21-8 `reflect-due.py` + the quiet-streak cadence (#150).
- **Run shape:** p21-1 plan-blocked once (its spend-gate bullet did not price), auto-retried, then gate-pending and signed under its own `spend_approval_usd: 30` (US$8 exposure; actual eval spend $1.49). p21-7 plan-blocked twice and landed on its last auto-retry. p21-2 and p21-4 integrated through the integrator (score.py conflicts with #147, and with #145 too for p21-2); the rest were lead merges with no merge-in. All Opus.
- **Start delay:** § 2.7's pushed-base gate held the start ~25 min while last session's close-out commits landed (#142's macOS CI timed out at 20 min; #143 carried all three).
- **The installed plugin is still pre-P21.** The primary checkout (live plugin) was not touched, since `[[chorus-rollout-2026-10-15]]` runs on it. The new verbs and scripts (`/thread:reflect`, `reflect.py`, `reflect-due.py`, `close-score.py`) go live only once it is updated, so this rollout's own ceremony used the old Retro line.
- **Filed:** [[thread-skill-first-live-weekly-reflection]] (the first live `/thread:reflect` over this rollout, after the plugin update).

**2026-10-15 (evening): P21 is running overnight as `[[thread-skill-rollout-2026-10-15]]` from the clone; p15-7 landed.**
- **#139 merged** (`38d75ec`): CI had failed on ADR 0037 citing Chorus's ADR 0043 bare; `0981b9e` qualified it ("Chorus ADR 0043"), then the branch was updated so auto-merge could fire.
- **Scope (Lachy, grill):** P21 plus p15-7 tonight; the eval rollout (make-evals-on-opus, p19-5/10/11) waits for an attended session (spend + p19-5's irreversible sign-off).
- **Scheduled** via `/thread:orient Thread Skill --steer` → schedule: 7 tasks (p21-1,2,3,4,6,7,8), Project root the clone, verifier `make test`, built-in settings (no `rollouts.toml`), `rung: opus-xhigh` on p21-2/p21-7, p21-1 `spend_approval_usd: 30` asked ahead (its routing evals). Rollout run lines added to every note. p21-8's workspaces half split to new [[thread-skill-p21-9-daily-sweep-starts-the-reflection]] (session lane, with p21-5).
- **Execute** runs in a Chorus Session launched in the clone (handoff `docs/handoffs/2026-10-15-execute-p21-rollout.md`, landed #142, consumed by it).
- **p15-7 done:** an orient session-lane child landed agents-config PR #1 (`b01befa`): `skills/fresh-review/scripts/review-round.py` + Step 5 call + tests. Unset `THREAD_EVENTS_DIR` falls back to run_record's dir chain (the Mirror contract), not "write nothing". **Not yet clean-room reviewed**: a Stage suggestion card runs `/fresh-review` from `~/.agents`. `~/.agents`' local checkout is still at `08e72f3` (pull to make the emit live).

**2026-10-15 (later): ADR 0037 decided, P21 written, scheduling handed off.** The orient grill turned the Retro into an automatic Reflection tuned for hands-off quality (ADR 0037 and its CONTEXT.md terms, PR #139, auto-merge queued). [[thread-skill-p21-reflections-run-on-their-own]] holds 8 tasks. Handoff `docs/handoffs/2026-10-15-schedule-p21-reflections.md` (landing PR #140) was consumed by the session that schedules P21 and runs it overnight. Chorus's side is [[chorus-reflect-cadence]].

**2026-10-15: 3.1.0 is released and installed (PR #136, tag `thread--v3.1.0` on `bce79a8`; `claude plugin update` 3.0.0 → 3.1.0; `make release-check` passes; primary checkout at `bce79a8`). P18 (unattended rollouts), P20 (orient's front door) and P19 bar p19-5 and the eval tasks are live.**
- **Rollout `[[thread-skill-rollout-2026-10-14]]`** (archived, § Completion log): 17/17 merged (#118 to #134) in 12h 43m from the clone. P18 and P20 closed; P19 open. p19-5 deferred to the eval rollout (its irreversible gate needs a pre-trim baseline first).
- **Evals** (`docs/evals/2026-10-15-release-3-1.md`, facts only, $8.24): 16 of 19 cases at 1.00 on `make evals`' defaults; three lifecycle cases fail on the judge alone (one new: `close-pending-doc-owns-continuation`, 1.00 → 0.75). **`make evals` judges with Haiku by default**, which breaks the Opus lock; on `--model opus --judge-model opus` all three score 1.00, but that run changed model and judge together, so the misses stay unexplained.
- **Release review:** two `xhigh` rounds; the ledger stopped at round 2 (9 of 12 findings cited round 1's rewrite of the record), so the record was cut back to what ran. Version stays minor; the PR body states that a bare `/thread:orient` now writes drift fixes without asking (`--look` is read-only).
- **#137** deleted the release handoff doc #135 had landed as pending, before the tag.
- **Filed:** [[thread-skill-make-evals-on-opus]] (Opus model + judge in `EVAL_ARGS`, a ceiling that covers 19 cases), [[thread-skill-adr-status-sweep-after-3-1]] (ADRs 0035/0036 still proposed). [[thread-skill-eval-rollout-p19-evals]] updated: the third miss folds into p19-10; this record is not p19-5's baseline.
- **Not set:** `~/.config/thread/rollouts.toml` does not exist, so `spend_approval_usd` is 0; the eval rollout's first step sets it to 50.

**2026-10-13 (later): p13-4 and P13 are done. The 3.0.0 live E2E is recorded (`docs/e2e/2026-10-13-3-0-0.md`, PR #115, auto-merge queued): 17 rows, 15 PASS, 1 KNOWN, 1 FAIL. Fixtures removed. Nothing of thread-skill's is running; `[[chorus-rollout-2026-10-13]]` still runs on this checkout's engine (held).**
- **Shape:** the 2.5.3 baseline re-cut for 3.0 (orient reshuffle for split/gather, the protocol 5 queue for waves, new rows 16 `/thread:retro` and 17 ladder). Run as a hub (this repo: § 0, leak check, cleanup, filing) plus S1 in the fixture (rows 1–13, a Stage card with `cwd` set) and S2 (rows 14–15, started from row 13's native `create_thread` card). Every 2.5.3 finding re-tested is fixed except the archive `git mv`.
- **Findings filed (loose, candidates for P19):** [[thread-skill-execute-archive-moves-an-untracked-rollout-note]] (row 5 KNOWN), [[thread-skill-retro-load-counts-a-quiet-concurrent-rollout]] (row 16 FAIL: `score.py` `load()` spans first..last line, so a rollout with long calls in flight looks absent), [[thread-skill-repair-stops-on-a-complete-rollout]] (row 7 seam: repair's § 4 hand-off would re-run the ceremony on a done rollout). Plus [[chorus-a-started-card-reports-back-to-its-originator]] (Chorus): the hub had no way to see S1/S2 finish.
- **P13 closed:** the interim rule and Lead actions retired on [[thread-skill-p13-the-ladder]]; [[thread-skill-p13-4-release-3-0-and-e2e]] done. Lachy told (again) that his AGENTS.md § Model tier can drop `max_tier: opus`.
- **Cleanup:** GitHub `lachyts/zz-thread-e2e` deleted (Lachy's OK), local fixture removed, vault fixtures out (`18affd5b`), thread file out (workspaces `94115d6`), fixture state files reverted.

**2026-10-13: 3.0.0 is installed (user scope, `make release-check` passes, primary at `e1a7d75`); the live E2E (p13-4 step 4) runs in a handed-off session. An orient reshuffle re-sorted the backlog into P18 and P19.**
- **Install:** the hold cleared (both 10-10 rollouts archived; `unfinished-rollout.py running` → none). Stray `.claude/worktrees/run-record` removed (clean; branch and PR #88 stay on origin); primary `reset --keep origin/master`; `claude plugin update thread@thread` 2.11.0 → 3.0.0.
- **Reshuffle:** P12 and P14 closed by drift. New [[thread-skill-p18-unattended-means-unattended]] (p18-1 stop calls at a step boundary, p18-2 a gate never holds the rollout, p18-3 one Human fix per refusal) and [[thread-skill-p19-coherence-after-3-0]] (12 tasks: p19-1 land-suite timeout first, the ADR status sweep, the P3/P4/P5/P8/P9 stragglers, the three eval fixes). P3, P4, P5, P8, P9 closed `done` into P19. Dropped: the footing-log task, handoff-widens, "Orient auto-detects…". codex-retro-route merged into [[thread-skill-estate-chores-after-p12]]; post-p12-cleanups stays loose (in-repo, waits on GifLab).
- **Grill → PR #112 (merged):** ADR 0034 (a gate never holds an unattended rollout: standing US$50 approval by total exposure, ask ahead, a mid-run gate is set aside and the rollout closes) and ADR 0035 (`auto_retry_verdict` emits one Human fix per refusal; refused descopes durable, fail closed; the lead acts on recorded answers); CONTEXT.md **Standing approval**, **Human fix**. p19-8 decided: an explicit `capture: continuation` marker.
- **Handoff:** `docs/handoffs/2026-10-13-3-0-e2e.md` (PR #113, queued), consumed by the E2E session the same day.

**2026-10-10: 3.0.0 is released (PR #110, `44f14fa`, tag `thread--v3.0.0`), but not installed: two rollouts run on the primary checkout's engine (`[[chorus-rollout-2026-10-10]]`, `[[event-script-rollout-2026-10-10]]`), so ADR 0031 holds it at `f0257cb` (2.11.0).**
- **Landed:** #108, schedule § 0 resolves the rollout root (`self-rollout-check.sh --resolve` prints the root, or `<repoPath>-rollout`, or refuses); #109, the three load-flaky timing tests made structural (12a sleep stub, a held-until-killed lock holder, case 35's `timed out` proof); #110, the 3.0.0 bump plus `docs/evals/2026-10-10-release-3-0.md` (16 of 18 at 1.00, two lifecycle judge misses filed).
- **Retro of `[[thread-skill-rollout-2026-10-09]]`:** no proposals, ceiling stays 4; the 12a flake's cost was invisible to the score.
- **Review loops:** #107 (needs-you (c) gaps), #108, #109 and the release each hit the fresh-review ledger's STOP at round 2. #107 closed (design: [[thread-skill-p18-3-one-human-fix-per-refusal]], grill first); #108 and #109 reverted to root and took an alternate `/simplify`; the release cut back to bump + eval record, its ADR edits moved to [[thread-skill-p19-2-adr-status-sweep]].
- **Filed:** [[thread-skill-p19-2-adr-status-sweep]], [[thread-skill-p19-10-eval-close-consumed-fixture]], [[thread-skill-p19-11-eval-handoff-manual-dry-run]], [[thread-skill-p19-12-eval-retro-routing-case]]. `ab-fable-vs-opus-planning` stays dropped (Lachy, 2026-10-10).

**2026-10-09 (late): P16 (unattended rollouts) and P17 (queue fixes from live runs) have landed. `[[thread-skill-rollout-2026-10-09]]` (archived, § Completion log): 9/9 merged (#97 to #105) in 11h 6m, from the clone `~/repos/tools/thread-skill-rollout`, on the Opus ladder. Phases 16 and 17 are closed (p16-2 landed separately in `~/repos/workspaces`). p13-4 (release 3.0) is unblocked. The primary checkout is still held: `[[chorus-rollout-2026-10-09]]` is running from it, so the new P16/P17 skills are on `origin/master` but not yet live here.**
- **Landed:**
  - p16-3: the engine declares `needsHuman` and records `## Needs you` (#97);
  - p17-4: land.sh takes consumed review-doc deletions (#98; the six 2026-10-03 docs are gone);
  - p17-5: schedule's gate sweep and capture pre-flight (#99);
  - p16-1: § 6.5 Needs you, so no question tool while work is in flight (#100);
  - p17-3: a doubled Gated-inputs heading reads as one section (#101);
  - p17-1: the Integration lane's order and its landed list (#102);
  - p17-2: a Solo task holds by rank, and carry prints prose `order` hints (#103);
  - p16-4: execute auto-retries agent-fixable set-asides, ADR 0033 (#104);
  - p16-5: repair keeps only the asking (#105).
- **The schedule wrote the live checkout as Project root.** The orient session's schedule set `~/repos/tools/thread-skill`; execute § 2.6 (the self-rollout gate) refused it at launch, and the lead re-pointed the rollout at the clone. Schedule § 0 has no self-rollout check: [[thread-skill-schedule-runs-the-self-rollout-gate]].
- **Load made `make test` flaky.** At ceiling 4 the load average reached 80 to 210. `merge-task-integrated` 12a, a "halts in under 5 s" wall-clock assertion, failed three lead Integration verifies (p16-3, p17-3, p17-5) and three first passes. Each red verify cost an integrate call. Fix: [[thread-skill-load-tolerant-timing-tests]] (high priority, before the next rollout).
- **Two lead hand-backs, both converged** (each logged in the rollout's `## Notes`):
  - p16-1: the Integration judge rejected it at review round 4/4, a semantic conflict with #97's needs-human stops. Raised to 6 rounds and handed back as a seeded revise; landed at round 5.
  - p16-5: plan-blocked at 3 rounds with narrowing feedback. Handed back for a fresh pass, approved on its first plan round.
- **First live Run record:** 19 calls folded with no warnings, about 14.1M subagent tokens. The Retro is offered: `/thread:retro [[thread-skill-rollout-2026-10-09]]`.
- **Follow-ons filed:** [[thread-skill-load-tolerant-timing-tests]], [[thread-skill-schedule-runs-the-self-rollout-gate]], [[thread-skill-execute-needs-you-c-gaps]] (three § 6.5 (c) seams PR #105 asks the lead to file).

**2026-10-06: P15 (the Run record) has landed. `[[thread-skill-rollout-2026-10-04]]` (archived, § Completion log): 5/5 merged (#89 to #93) in 17h 39m from the clone, all on Opus. The primary checkout was fast-forwarded to `1c5c3ca` at 12:15. **That broke ADR 0031's hold:** `[[chorus-rollout-2026-10-06]]` had started at 10:13 from this checkout, so its lead switched to the P15 scripts mid-run. Left in place as the lesser move: P15's scripts take the old SKILL's calls, and its events start mid-run (a `slot-freed` before any `slot-taken`). P16 (unattended rollouts) is filed but not yet scheduled.**
- **Landed:** p15-1 `run_record.py`, the Run record's one writer (#89); p15-4 `rollouts.toml` operator settings and `rollout-settings.py` (#90, Integration resolved 7 test-file conflicts with #89); p15-3 Workflow journals fold in at close (#91); p15-2 execute, lead-integrate and merge-task emit Run record events (#92); p15-5 `/thread:retro` (`score.py`, `tune.py`, #93).
- **p15-2 plan-blocked once** at 3 rounds, with findings narrowing each round. It converged on its first plan round after a hand-back carrying the feedback. All five tasks stamped `tier_capped:` (the Opus lock).
- **The overnight stall, about 12h (20:25 to 08:33).** The lead asked Lachy two questions through AskUserQuestion: whether to hand back p15-2, and whether to create the events symlink. A Stop hook (`check-closing-questions.sh`) had forced the question into that tool, and the tool holds the turn, so p15-4's finished Integration and p15-3's approval sat unprocessed. The 2026-10-06 grill became **P16 ([[thread-skill-p16-unattended-rollouts]], p16-1 to p16-5)**. Memory `wave-repair-autonomy` gained the rule; estate METHOD.md got K118.
- **Operator step done:** `~/.local/state/thread/events` → `~/repos/workspaces/_shared/state/thread-events/` (created 2026-10-06, before #92 merged).
- **No Run record for this rollout:** the lead ran from the held primary at `cba2835`, so the new emitters never ran. The planned self-Retro moved to [[thread-skill-retro-first-live-run-record]], to run on the next rollout.

**2026-10-04 (early): P13's rollout tasks and P14's queue hardening have landed. `[[thread-skill-rollout-2026-10-03]]` (archived, § Completion log): 9/9 merged (#77 to #85) in 8h 10m from the clone, all on Opus, on the held primary checkout's engine at `0b60690`. Nothing of thread-skill's is running; the Chorus rollout still runs on the primary.**
- **Landed:** p13-1 ladder loader (#79), p13-2 the engine climbs rungs, execute feeds the ladder, `max_tier:` removed (#80), p13-3 schedule, status and repair speak rungs (#83; its Integration resolved a conflict with #81/#82 through the integrator). p14-2 the approved plan reaches Integration plus `verify_timeout` (#82), p14-3 seeded revise never autostashes (#81), p14-4 the lead descopes a settled plan-block (#84), p14-5 landing PR bodies name their caller (#78), p14-6 the git-env canary (#85), p14-8 infra classifier word match (#77).
- **Two plan-blocks, one fix.** p14-4 and p14-6 plan-blocked at 3 rounds with feedback narrowing each round and no undecided seam. Lachy raised both to `max_plan_rounds: 6` through `/thread:repair`; p14-4 converged on its first new round, p14-6 on round 5. p14-6's reviser rebased its own PR branch onto #84 with `--force-with-lease` to clear a conflict (its task branch only; the lead never force-pushed).
- **Not live yet:** `origin/master` carries the ladder engine, but the primary checkout stays at `0b60690` until Chorus ends; p13-4 (3.0.0) updates it.
- **Peer close-outs:** PRs #75/#76 (the primary checkout's close-outs) sat `BEHIND` after the rollout merged past them; this close ran `update-branch` on #76 (land.sh's own retry) and both merged (`c7feef6`).
- **Left over:** six consumed review docs in `docs/reviews/`. land.sh refuses `docs/reviews/` close-out paths, so no close can delete them: [[thread-skill-land-takes-review-doc-deletions]].

**2026-10-03 (late afternoon): two rollouts at once.** The Chorus rollout `[[chorus-rollout-2026-10-03]]` (the first queue run, [[thread-skill-p12-13-chorus-first-queue-run]]) runs on this checkout at `0b60690`, so this checkout is **held** (ADR 0031): no pull, switch or plugin update here until Chorus ends. Thread Skill's own P13/P14 rollout is being scheduled from the clone (session `thread-skill-rollout`, started 2026-10-03). Landed today: the orient reshuffle (P13 respecced, P14 filed), PR #73 (p14-1, CI flakes: pushed-base judges "landed" by content alone) and PR #72 (p14-7, the primary checkout holds while a rollout runs), then the cut-over (Chorus soft-paused, checkout `04d1739` → `0b60690`, reinstated).

**2026-10-03: P12 has landed and the queue is live. 14 tasks merged in 10 waves (#56–#69) over 53h 19m; the live checkout was fast-forwarded to `36f09c1`, so new sessions run the queue engine. No version bump: 3.0.0 is p13-4. Nothing is running.**
- **Rollout** `[[thread-skill-rollout-2026-09-30]]` (archived, § Completion log), the last on the wave engine, run from the clone, all on Opus. The queue: one task per Workflow call (`task.workflow.js`), Integration's trouble path as its own call, `merge-task.sh` (one integrated PR), `reconcile-rollout.py` (`next`, stamps, the `## Integration log`), the lead's loop in execute § 4.5 with `lead-integrate.py`, schedule writing protocol 5, status and repair reading the queue, gate sign-off resuming the signed run, and no wave left. Plus P6's carried fixes: zero round budgets fail closed, `GIT_*` scrubbed, read-only agents on a pinned tree, and schedule's unpushed-base check.
- **Six first dispatches plan-blocked.** Two causes, two fixes (Lachy's calls, 2026-10-01): judges held each PR to standalone coherence on master, fixed by the **P12 interim rule** (a task may leave a consumer a later P12 task owns out of step, named in its PR body; p12-12 restores coherence); and deep tasks planned at the default rung, fixed by re-running at `effort: xhigh` with 6 plan rounds. Every re-run landed; from wave 8 on, deep tasks started at `xhigh` and none blocked. Scope cuts on the way: p12-3's canary moved to [[thread-skill-p14-6-git-env-canary]]; p12-5 held to a sequential interim lead.
- **Lead actions:** each PR body ended with the vault edits it needed (contracts for later tasks, file-sets, follow-ups); the lead applied them, appending `## Contracts from landed P12 tasks` on downstream notes. p12-16 (`ready:` and the Integration log) was filed that way mid-run and joined wave 7.
- **Wave 7 stalled 13 h overnight** on a Chorus "Allow Bash?" a review agent raised with `cd /tmp/x && rm -rf ./*`: Claude Code's dangerous-removal check asks even in bypass mode. Fixed estate-wide by the PreToolUse hook `check-dangerous-rm.sh` (workspaces `eb136df`, registered in `~/.claude/settings.json`, proven live); Chorus's fallback is [[chorus-an-unanswered-agent-ask-times-out]].
- **Wave 9's merge halted once** on an Ubuntu flake (`pushed-base.test.sh` case 2); merged on the re-run, filed as [[thread-skill-p14-1-pushed-base-ci-flake]].
- **Still on protocol 3:** `[[chorus-rollout-2026-09-30]]` (paused, migrates after 3.0.0, p13-4) and `[[giflab-rollout-2026-09-23]]` (open, nothing merged; p12-13 hard-pauses and regenerates it). The new execute refuses both until then.

**2026-09-30 (night): waves are being retired. ADR 0030 (a rollout is a queue) and ADR 0029 (escalation climbs the operator's ladder) are decided and slimmed to decision level in PR #53, merged at `df32531` with no further review round. P12 and P13 hold the build. P12's scheduling went to a fresh session through a handoff, consumed the same night; the handoff doc's landing PR #54 is queued.**
- **Two grills.** The evening grill (from the Chorus orient and Lachy's "can't we just run tasks in parallel in worktrees and merge after?") wrote both ADRs. The night's `/thread:orient` reshuffle, with grill-with-docs, answered review round 2 and then round 3's nine design calls. The ADRs hold the decisions; the P12 and P13 task notes hold the mechanics.
- **The night's calls** (all in the ADRs): Integration merges `main` in and never force-pushes; the lead runs a clean Integration itself and a Workflow call only for trouble; a rejected task releases the Integration lane; the verifier is skipped only when `main` hasn't moved; a set-aside task resumes where it stopped. The built-in ladder names no model above Opus, rungs have names, and the file is read at the start of each Workflow call.
- **Fable research** (2026-09-30, Anthropic docs plus a web sweep, several sources vendor-published): since Opus 5.5 it ties or trails on most published coding results at 2.5x the token price, and nothing has measured it on these tasks. The ladder stays two Opus rungs; [[ab-fable-vs-opus-planning]] (after p13-2) replays hard tasks blind, and a win is one line in the ladder file.
- **PR #53's reviews:** round 1 (15 findings) fixed in `a3ddd47`; round 2 (15, 9 of them regressions of round 1) tripped the ledger STOP; round 2 answered at decision level in `5d4404e`; round 3 ran `simplify` (28 findings, `ef71896`), which led to the slimming. **Lesson:** answer a review at the document's altitude; a finding about mechanics moves the mechanics out of the ADR.
- **Protocol 4** (`codex/thread-rollout-redesign`) is retired unlanded; its standalone fixes are in P12.
- **Parked until the queue lands:** `[[chorus-rollout-2026-09-30]]` (53 tasks) and `[[giflab-rollout-2026-09-23]]` (PRs #111–#114, `UNSTABLE`, a week stale).

**2026-09-29/30: 2.11.0 is released and live. Agents now land their own work (ADR 0028, P11). Nothing is running.**
- **Grill → ADR 0028** (#42, amended #45): landing (push, PR, review, fixes, CI retries, merge, cleanup) is the agents' job. Close lands its close-out and the session's own branch (reviewed first); handoff lands its doc; one estate-wide **landing register** (a deny-list) gates every agent push, rollouts included. Amended mid-rollout to **queue and finish**: commit on the default branch, push that commit to a `close/…` branch, queue auto-merge with a merge commit, never wait. Waiting needed a detached waiter whose lock and race findings grew every review round.
- **Rollout** `[[thread-skill-rollout-2026-09-29]]` (archived, § Completion log): 4 waves, 8h 17m, all on Opus. #43 register reader, #44 register gates rollouts, #46 `land.sh` and close's close-out landing (4 dispatches; the 4th ran with `max_plan_rounds: 6`), #47 stranded commits reported, #48 handoff lands its doc, #49 close lands its own branch (started at 6 plan rounds, converged in 4).
- **Release:** #50 (`7f43b9c`), plugin updated in both profiles, `make release-check` green, tag `thread--v2.11.0`. Repo settings: auto-merge and delete-branch-on-merge on for `lachyts/thread-skill`.
- **Register seeded (p11-2):** `~/repos/workspaces/_shared/knowledge/landing-register.md` (workspaces `adf83c5`) lists 11 Animately repos; giflab, gifsicle and optimizer land. P11 stays open for p11-7 (the daily lander) and p11-8 (AGENTS.md wording).
- **Earlier the same session (2026-09-28):** the p10-4 + p9-4 rollout and 2.10.0 (below). The 2026-09-28 close-out went out as #41, merged by hand, which prompted the grill.

**2026-09-28 (late afternoon): 2.10.0 is released and live. p10-4, p9-4 and reconcile-apply-binds landed; phase 10 is closed. Nothing is running.**
- **Rollout** `[[thread-skill-rollout-2026-09-28]]` (archived, § Completion log): 3 waves, 1h 31m, all on Opus. #37 reconcile `--apply --only <dry-run json>` binds the reviewed list, and orient passes its audit's `--json` through (`f49e34c`). #38 handoff docs have one writer, and `next` may recommend a printed `/compact <focus>` line inside keep going (`84240b1`). #39 close flips a finished task within ADR 0026's three-condition guard (`929df02`).
- **p10-4 plan-blocked in wave 1** (3 plan rounds). The smart-halt fired on `CONTEXT.md`, shared with p9-4. Lachy chose to swap: p9-4 ran as wave 2, and p10-4 was re-dispatched as wave 3 with its plan feedback on the note. It converged (3 plan rounds, 2 review rounds). The re-wave was hand-edited: [[thread-skill-rewave-a-blocked-task-within-its-rollout]].
- **Phase 10 closed** by the ceremony. Phase 9 stays open (p9-2, p9-3).
- **Release:** #40 (`2f0d437`, merge commit). Live checkout fast-forwarded, plugin updated in both profiles, `make release-check` green, tag `thread--v2.10.0` pushed at `2f0d437`. Vault `06efef14`, `58dafa3e`. Sessions started before the update still run the 2.9.0 skill text.

**2026-09-28 (evening): orient is the one shaping verb (ADR 0027) and 2.9.0 is live. `split` and `gather` are gone. Nothing is running.**
- **ADR 0027**, grilled with Lachy from his "fold Fit Snack into Chorus" brain dump: he always runs orient → gather → split → grill-with-docs as one move on pickup. Orient now asks **Reshuffle / Steer only / Look only** after its audit. The reshuffle (`skills/orient/reshuffle.md`) sorts all open work by reach tier, unbundles brain dumps, grills only what's unclear (stoppable), and writes at one gate. Orient schedules wave-shaped phases itself (`--tasks`, members only) and ends with the execute offer (fresh session / here / not yet). One note → a scoped reshuffle (split's old job). New glossary: Reshuffle, Reach tiers, Clear / unclear item, Brain dump, execute offer.
- **Landed:** #32 (`b1e2cf2`) with p10-3 (orient's drift wiring) and the gather-rename cache exclusion folded in; release #33 (`43ff855`, 2.9.0, carrying #31 too); #34 (`6962967`, the P10 release session's unpushed close-out). Plugin updated in both profiles, `make release-check` green at 2.9.0. **Sessions started before the update still load 2.8.0**, where split and gather exist.
- **Review:** xhigh ×2 then simplify. Round 2's ledger stopped the chain (10 of 15 findings were round 1's rollout-lifecycle machinery: auto-pause, Pause-and-hand-off, a cross-project schedule gate). Reverted to the root: orient supersedes only a **paused** rollout whose unlanded tasks are all open; anything else waits, a stuck one goes to repair. Deferred: [[thread-skill-schedule-owns-one-live-rollout-per-repo]], [[thread-skill-p19-7-one-vault-grammar]].
- **Evals:** the full suite, 18 cases, $3.34, recorded in `docs/evals/2026-09-28-orient-reshuffle.md`. All route correctly; `handoff-manual-dry-run` 0.83 (its LLM lifecycle judge), untouched by this work. This run has the exact shape p4-6 asked for.
- **Outside this repo:** workspaces `affa997`, `3a57334` (writer specs name orient's reshuffle) and `~/.agents` `22da348` (Codex split/gather adapters deleted, router + orient adapter updated), both pushed.

**2026-09-28: 2.8.0 is released and the reconcile step passed live acceptance. `feat/next-action-set-downs` has merged (#31), so the next rollout is unblocked. Nothing is running.**
- **Release:** close-out PR #29, then the bump PR #30 (`c5f7522`), both green on both runners. The plugin went from 2.7.1 to 2.8.0, and `make release-check` was green at `c5f7522`. Tag `thread--v2.8.0` is pushed at `c5f7522`, and `origin/HEAD` is set in both checkouts. A fresh session is needed for the 2.8.0 skill text.
- **Live acceptance of `reconcile-project.py` on Chorus:** the dry run matched the 2026-09-27 drift audit. The audit's 11 empty phases and `p4-3` were cleaned by hand on 2026-09-26, so they correctly don't reappear. An independent tally of all 13 open Chorus phases agreed that only p23 was finished, and nothing was missed. **`--apply` then wrote 5, not the 2 Lachy approved:** the live `[[chorus-rollout-2026-09-26]]` landed the last tasks of p24, p25 and p28 between the dry run and the apply, and `--apply` recomputes its list. All their tasks were done, so Lachy kept all five. Follow-up: [[thread-skill-reconcile-apply-binds-reviewed-list]]. The daily sweep `6e1c06d2` committed the moves, and vault `4ee121fd` closed the release and acceptance tasks.
- **#31 merged** (`bccca10`, the `gtd-next-action-grill` thread's `feat/next-action-set-downs`) after the release. `origin/master` is 23 commits past `c5f7522` and still reads 2.8.0, so that work isn't released yet.
- **The live checkout `~/repos/tools/thread-skill` is on `feat/orient-reshuffle`**, another session's branch (orient's Reshuffle, ADR 0027). Leave it alone.

**2026-09-27 (late evening): the P10 rollout is done. p10-1, p10-2 and p10-5 are merged; phase 10 stays open for p10-3 and p10-4.**
- **Landed:** `[[thread-skill-rollout-2026-09-27]]` in 2 waves over 2h 9m, continuous auto-merge, all on Opus:
  - #25: schedule archives a superseded rollout (`4033894`)
  - #27: the shared reconcile step, `skills/_shared/scripts/reconcile-project.py` (`5ec1e12`)
  - #28: execute's ceremony closes finished phases (`091d85f`)
  - No blocks, escalations or gates. Each task took 2–3 plan rounds and 2 review rounds. The source of truth is the archived rollout note's § Completion log (`Work/Tasks/Archive/Rollouts/`).
- **First live run of the new ceremony step:** the lead ran it from merged master (the loaded plugin text predates #28). `touched-phases` printed `--project thread-skill --phases 10`, and `--apply` wrote nothing. That is correct: p10-3 and p10-4 are open.
- **Dry run against the real vault:** Chorus shows 2 unambiguous items, phase `chorus-p23` and the misfiled `chorus-rollout-2026-09-21` (p10-5's own incident). Thread Skill is clean. Nothing was applied; checking the result is [[thread-skill-reconcile-step-live-acceptance]].
- **Not yet live:** `~/repos/tools/thread-skill` is still at `daa1797`, so the plugin is still 2.7.1 without P10. The release is [[thread-skill-release-reconcile-step]].

**2026-09-27 (evening): the safe-point hook is deleted, P9/P10 are regathered, and the P10 rollout is running from the clone.**
- **Orient → gather → grill-with-docs** on two of Lachy's issues. First, the safe-point tripwire kept forcing handoffs, including right after a close. Second, finished phases and tasks never close: an audit found 11 of 17 Chorus phase notes open with nothing left in them.
- **The hook is gone** (p9-1, done). Two research passes, one on compaction vs handoff and one on whether a tripwire is worth having at all, led Lachy to delete it outright. Replacing it: a `ctx %` statusline segment, native auto-compact, and loop round caps where the loops run. The three sibling safe-point tasks were dropped. Commits: workspaces `29ca886` (pushed) and `~/.claude` `8bc13eb` (the settings registrations; not pushed). Its fresh-review is still pending (§ Open questions).
- **ADR 0026, finished work closes itself** (PR #24, `daa1797`). It amends ADR 0011. There is one reconcile step. Execute closes the phases it finishes. Orient fixes unambiguous drift on any steer except Report-only, and gather runs the step first. Close flips a task it provably finished, under a three-condition guard. `CONTEXT.md`'s **Drift** now covers project-level drift.
- **Roadmap:**
  - P10 (new): p10-1 to p10-5.
  - P9: p9-1 respecced and done, p9-4 added.
  - Joins: p5-5 (plugin-root read as a file) and p8-4 (schedule's unpushed-base check).
  - `vault-archiver-moves-dropped-tasks` is filed under Agent Stable.
  - The research digest is at `Library/Research/Digests/Session safe-point compact vs handoff (digest 2026-09-27).md`.
- **Running:** `[[thread-skill-rollout-2026-09-27]]` (p10-1 and p10-5 in wave 1, p10-2 in wave 2), launched by Lachy from `~/repos/tools/thread-skill-rollout`. This session doesn't touch it.

**2026-09-27: p5-2 is done on PR #23 (2.7.1). No positional `$N` is left in any SKILL.md body.**
- **Shape:** close's handoff scan and repo-track and execute's default-branch resolver moved into scripts
  behind thin wrappers. Open's repo-thread lookup stays inline, rewritten without a positional. A new
  contract (`tests/contracts/skill-positional-args.test.mjs`) bans a dollar-digit anywhere in a SKILL.md.
  Manifests are at 2.7.1, and `.gitattributes` forces LF on `*.sh`.
- **Verified:** `make test` ALL PASS, CI green on Ubuntu and macOS, `make release-check` green at 2.7.1
  (before the final lookup refactor). A live headless `/thread:close some words here` rendered clean and
  its scan ran. A control skill proved the substitution is still live on CLI 2.1.283.
- **Review:** two xhigh rounds. Round 2 tripped the ledger STOP (10 of 12 classified findings were
  regressions of round 1's fix `7cee1a5`). Lachy chose revert + inline lookup (`d809c95`, `01c1e91`) and
  no third round.

**2026-09-26: the roadmap is regathered as P5–P9, and master is protected. Nothing is running.**
- **Roadmap:** `/thread:orient` → `/thread:gather` with a grill-with-docs interview phased the 32 loose tasks:
  P5 Release safety, P6 Protocol 4 lands, P7 Top tier, P8 Planning-lane gaps, P9 Continuity refinements
  (vault phase notes `thread-skill-p5-…` to `thread-skill-p9-…`). Protocol 4 **lands**: it is integrated
  opt-in at p6-1, and nothing is released until p6-10. P1 and P2 are marked done, and p4-6 (the eval
  baseline) joins P4, ahead of p4-5. The GTD next-action idea left the roadmap for its own grill (a handoff
  in ops-workspace).
- **Decisions:** ADR 0024: the operator's top tier is one value in `~/.config/thread/top-tier`.
  Implementation is pending, and its mechanics are p7-1's open questions after two review rounds. ADR
  0025: master moves only by green PR, owner included. CONTEXT.md gains **Top tier** and **Capture**.
- **p5-1 done:** the repo is **public** (branch protection needs Pro or public; published as-is, README
  says so). CI runs `make test` on Ubuntu and macOS (#21). Rulesets `master-green-pr-only` and
  `no-main-branch` are the enforcement, and live probes are refused. Classic protection was tried and
  removed (an owner push of #21's green head landed under it). This repo commits as the GitHub noreply
  address from now on.
- **Heads-up:** close and handoff commits made on `master` are now **stranded** until a PR carries them
  (p5-4). Do close-out work on a branch.

**2026-09-25 (evening): 2.7.0 is released. Nothing is running and no handoff doc is pending.**
- **Landed:** the 2.7 rollout: 4 tasks as PRs #17–#20 on `lachyts/thread-skill` master, 2 waves, 1h 50m,
  with no halts, no gates and nothing parked. The last merge is `393829c`. The source of truth is the
  archived rollout note `[[thread-skill-rollout-2026-09-25]]` (`~/repos/obsidian/Work/Tasks/Archive/Rollouts/`),
  § Completion log.
- **Released:** 2.7.0 is `15638b6` (the manifests bump on top of the rebased local commits `20147f3` and
  `88e59fe`), and it is pushed. `claude plugin update thread@thread` moved 2.6.0 → 2.7.0, and
  `make release-check` was green on `15638b6`. This close deletes the post-rollout handoff doc, which the
  2.7.0 cache holds, so release-check lists that file as stray until the next release. That is expected.
- **This checkout** is level with origin after `git pull --rebase --autostash`: `--ff-only` could not work
  because `42360be` had never been pushed. `make test` was ALL PASS on the rebased tip.
- **Still deferred:** p3-1 and p3-3 wait on design calls, and p4-5 waits for the eval baseline.
- **Open follow-ups** (vault tasks, all `open`):
  - `thread-skill-eval-baseline-then-p4-5` (a spend, USD 5 cap)
  - `thread-skill-e2e-rerun-on-2-6-0` (retarget it to 2.7.0)
  - `thread-skill-retire-rollout-clone` (now unblocked)
  - `thread-skill-protect-master-ci`, `safepoint-uses-handoff-home-resolver`,
    `thread-skill-stale-project-scope-install`
  - filed at this close, from the rollout's proposals: `thread-skill-project-glob-drift-out-of-repo`,
    `thread-skill-open-list-prunes-close-guard`, `vault-area-notes-area-front-matter`,
    `thread-skill-gh-upgrade-and-set-head`

**2026-09-25 (afternoon), superseded that evening (see above): the self-rollout was complete and 2.6.0
released. Nothing was running.**
- **Landed:** 16 tasks as PRs #1–#16 on `lachyts/thread-skill` master, in 7 waves over 37h 22m (wall
  clock, including the two halts that waited on Lachy). The last merge is `4a87a15`. `make test` was
  green after every wave, and everything ran on Opus 5.5 capped at `max_tier: opus`. The source of truth
  is the archived rollout note `[[thread-skill-rollout-2026-09-23]]`
  (`~/repos/obsidian/Work/Tasks/Archive/Rollouts/`): § Notes, and § Completion log for waves → PRs,
  rounds per task and the repair actions.
- **Released:** 2.6.0 is `3a7b9be` (the manifests bump on `4a87a15`). This checkout pulled `--ff-only`
  and is level with origin, so the freeze is over. `make release-check` is green at `3a7b9be` (re-run at
  this close). This close deletes the consumed review doc, which the 2.6.0 cache still holds, so from now
  on release-check lists that file as stray. That is expected (the Makefile's note on deleted tracked
  files).
- **Not landed:**
  - **p2-3 was split** after it plan-blocked twice, into
    `thread-skill-p2-6-close-repo-state-local-only` (local-only repo state plus close's feature-branch
    check) and `thread-skill-p2-7-tool-repo-threads-and-open-save` (tool-repo threads, `open save`, the
    CONTEXT.md Repo thread entry). Both run from the rollout clone. Lachy's decisions are in the p2-3
    note § *Decisions (Lachy, 2026-09-25)*.
  - **p3-1 and p3-3 are deferred** on design calls:
    `thread-skill-p3-1-orient-native-children-one-launch-model`,
    `thread-skill-p3-3-grill-fit-check-in-prompt-composition`.
  - **p4-5 waits for the eval baseline** (`thread-skill-p4-5-trim-descriptions-700-hard-cap`).
- **Open follow-ups** (vault tasks, all `open`):
  - `thread-skill-e2e-rerun-on-2-6-0`
  - `thread-skill-eval-baseline-then-p4-5` (a spend, USD 5 cap)
  - `thread-skill-evals-results-vs-release-check`
  - `thread-skill-orient-nested-project-notes`
  - `safepoint-uses-handoff-home-resolver`
  - `thread-skill-protect-master-ci`
  - `thread-skill-retire-rollout-clone` (only after p2-6 and p2-7 land)
- **Lessons:** the rollout's five are in § Known quirks (protocol 4 intake items 14–17).
- **Next, prepared later on 2026-09-25:** a four-task 2.7 rollout (p2-6, p2-7 and two small fixes). `d59bcb3`
  is pushed, the rollout clone is tidied and green, and the model tier is locked to Opus 5.5. The order
  and the paste-ready lead prompt are in § Resume instructions.

**2026-09-25 (morning), superseded the same day (see above): the self-rollout was ready to resume from
wave 3. Nothing was running; 8 tasks were left.**
- **2026-09-24, before the resume:** Lachy rewrote `origin/master` to `c667e9e` by hand, deleted
  `origin/main`, and added a clone `pre-push` hook that refuses any push to `master`/`main`. He withdrew
  p1-3's gates and deferred p3-1 and p3-3 out of the rollout (rollout note § *Resolved 2026-09-24*).
- **The resume lead (`execute-2026-09-24-a91d0c16`, unattended) finished wave 2 and most of wave 3.** Every
  merge went through `merge-wave.sh`, and `make test` was green on each merged tree:
  - PR #7, p3-4 → `42e9173`
  - PR #6, p1-3 → `b52270d`. p1-3 was approved after 2 review rounds. It also landed the test-side
    `GIT_*` scrub.
  - PR #8, p3-2 → `a65ddbc`
  - PR #9, p2-1 → `d85a3c7`

  The cursor is 2/7, because wave 3 is incomplete.
- **p4-1 did not land.** Its first pass was plan-blocked after 3 rounds on strictness feedback (narrowing,
  per K87), so the lead re-dispatched it. The re-plan was approved in round 2 but returned
  `gate-pending` with 23 phantom gates. The plan's `### Gated inputs` read `None`, and then a `---` and a
  feedback-resolution list followed; the parser reads until the next heading (protocol 4 intake item
  13). The lead halted at 08:37 and did not approve anything. On 2026-09-25 Lachy withdrew the gates
  (rollout note § *Resolved 2026-09-25*), and p4-1 is back to `in_progress`.
- **Left:** p4-1 (the rest of wave 3), then waves 4–7. Wave 4 is p2-2 with p4-2, p4-3 and p4-4, then
  p2-5, p2-3 and p2-4 run one per wave. That is 8 tasks, not the 6 the 2026-09-25 resolution line
  says.
- **Freeze holds:** this THREAD.md edit is uncommitted. Commit it after the 2.6.0 `pull --ff-only`.

**2026-09-24 (small hours), resolved later that day (see above): the self-rollout halted after wave 2.
A test leaked onto GitHub master, and cleaning it up was Lachy's call.**
- **Wave 1 merged:** PRs #1–#5 (p3-5, p1-4, p1-2, p1-1, p3-6). The repo has no CI, so the lead re-ran
  `make test` on the combined tree (`c667e9e`), and it was green. p1-1 consumed the 2.5.2 simplify review doc
  (it reads `consumed` on master; this checkout still has the pending copy until the pull).
- **Wave 2 landed nothing:**
  - p1-3 is `gate-pending`, with PR #6.
  - p3-1 is `plan-blocked` after 3 rounds.
  - p3-4 is approved, but its PR #7 is held unmerged.

  The smart-halt fires because p1-3's and p3-1's files return in later waves. The cursor is 1/7.
- **The leak:** at 23:41 a p1-3 agent ran `tests/default-branch.test.sh` with `GIT_DIR` set to its worktree's
  gitdir. That reached the clone's shared refs and config, and:
  - it pushed fixture commits `4c4c44b` and `018a60a` (author `t <t@t>`) to `origin/master`;
  - it pushed a stray `origin/main`;
  - it set `core.bare=true` on the clone. The lead reset that to `false`.

  The clone's files and index are still `c667e9e`. The fixture fix is in PR #6.
- **Waiting on Lachy:** rewrite `origin/master` back to `c667e9e`, or go forward-only. Both routes, with
  their exact commands, are in the rollout note's `## Notes` → *Halted after wave 2*.
- **Freeze holds:** this THREAD.md edit is uncommitted. Commit it after the 2.6.0 `pull --ff-only`.

**2026-09-23 (night) — the E2E is recorded; the self-rollout is scheduled and runs unattended from a
clone.**
- **E2E done** (`docs/e2e/2026-09-23-baseline.md`, `status: recorded`). Verbs 1–15 ran: 14 PASS
  and 1 FAIL (verb 7, repair: `in_progress` + a merged PR). The `defaultBranch` proof passed on all
  five points. The leak check was clean. Cleanup was done except the final
  `rm -rf ~/repos/tools/zz-thread-e2e`, which is the rollout lead's first step; the fixture's GitHub
  repo is deleted. The § 5 findings were folded into phase tasks, and the engine fixes went to the
  protocol 4 intake.
- **Roadmap gathered** (Lachy skimmed the Claude-drafted tasks). `[[Thread Skill]]` now has P1 test
  floor and contracts, P2 continuity core, P3 routing and docs coherence and P4 behaviour evals: 20
  tasks, 11 absorbed tasks tombstoned. p4-5 (the description trims and the 700-char cap) is held until
  the eval baseline exists.
- **Rollout** `[[thread-skill-rollout-2026-09-23]]` covers 19 tasks in about 7 waves, continuous
  auto-merge, verifier `make test`. It runs from the GitHub clone `~/repos/tools/thread-skill-rollout`,
  and its **lead session is launched in that clone**. The engine's agents `cd $WT` once and rely on it
  persisting, so worktrees outside the launch tree would fall back to this checkout.
- **Freeze:** don't commit in this checkout until the release's `git pull --ff-only`. Its local
  master must stay a strict ancestor of `origin/master`.
- **Next (human):** release 2.6.0 per the brief § S2 step 6, re-run the E2E with fresh fixtures,
  record the eval baseline, then schedule p4-5.

**2026-09-23 (later) — E2E § 0 is set up. The verbs run in a second session, launched in the
fixture.**
- **Setup:** the setup session (launched here) confirmed 2.5.3 and ran checklist § 0. It created the
  private repo `lachyts/zz-thread-e2e` (`master` only), the checkout `~/repos/tools/zz-thread-e2e`,
  the vault project [[ZZ Thread E2E]] with tasks t1, t2, t3 and cms, and a leak baseline in the
  fixture's `.git/e2e-leak/`.
- **The split:** a session can't `cd` outside its launch directory, so it couldn't run the verbs
  there. Lachy ruled the split, and the verbs session is now live in the fixture.
- **Findings for S2 to file:** the 2.5.2 and 2.5.3 caches both hold a stray copy of the plugin under
  `.claude/worktrees/enabler/`, which `release-check` misses (checklist § 5).
- **S2's own cwd trap:** S2's cleanup would `rm -rf` its own launch directory. The verbs handoff tells
  verb 13 to split S2 from an S3 that runs the rollout from thread-skill.

**2026-09-23 — audit done; 2.5.2 and 2.5.3 shipped; a live E2E baseline and a self-rollout are
next.** A `/thread:orient` audit (`docs/audits/2026-09-23-thread-audit.md`) found the plugin carrying
two eras (master protocol 3 and the paused protocol 4 redesign), 33 open tasks with no phases, and a
test floor that was partly vacuous. Shipped hands-on as the enabler:
- **2.5.2:** `make test` (`tests/run.sh`, a real workflow parse, a contract floor, hermetic).
- **`args.defaultBranch`:** the engine can now roll out repos whose default is not `main`, this one
  included. There is one source for the base, the repo's GitHub default; merge-wave checks every PR
  against it.
- **2.5.3:** `execute` names the read-only agents that read `repoPath`.

Engine work is held for protocol 4. Three clean-room rounds ran plus one simplify pass. The ledger
fired STOP at round 2, so the fix reverted to one source instead of patching a third time. Next: the
pending handoff (a live E2E of every verb, then `/thread:gather` → schedule → execute of this plugin
from a separate clone).

**2026-09-22 — thread 2 closed; rollout redesign remains open.** Lachy designated
**thread 1** as the main project conversation. **thread 3** and Claude's
**Thread rollout redesign native pilot** continue independently. Read the
[thread 2 closeout and Claude agreement](/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/implementation/2026-09-22-thread-2-closeout.md)
for the approved A/B/C scope, finite allowances, authority, last observed
preflight state and evidence locations. The completed Codex pilot is retained;
its success is not full release acceptance. Neither candidate is installed or
released. This closeout does not stop peers or change their runtime records.

**2026-09-21 (latest) — the tier ceiling is consumed, corrected and shipped as
2.5.1; the review chain was stopped by the ledger, not by exhaustion.** Three
clean-room rounds ran this session. Round 1 (`7ed7e6f`/`aaa87d`) was **lost** —
killed mid-run when the CLI process exited, no findings, no doc (estate
[[K42]]). Round 2 (`07ddc75`/`e55ab3`) returned 12 findings, all fixed. Round 3
(`c9f09dd`/`df669e`) returned 15 — and `review-ledger.py` fired **STOP** at 60%
regressions, nine of fifteen citing lines the chain itself had added, every
culprit one of its own fix commits. No round 4 was dispatched. Per fresh-review
§ Rounds the response was **revert to the root**: findings 1, 3, 4 and 8 were
resolved by *deleting* a contortion, not adding a layer to it.

Two real engine defects came out of it, both against the documented contract and
both probe-confirmed: `effortTier` keyed off the lagging `capSuppressed` **event**
flag, so a non-plan-gated capped task ran its full Ralph loop at the LOWER effort
row; and the capped retry budget `floor(n/2)` was **1** at the template default,
where a 1-iteration `ralphLoop` fires step (d) at i==1 and blocks *without*
re-running the verifier. The first fix for the second one was itself defective —
`min(n, max(2, floor(n/2)))` handed n=2 a full second budget, worse at that input
than what it replaced — which is what triggered the revert-to-root. The settled
form is a constant, `CAPPED_RETRY_ITERATIONS = 2`: capped implement cost is
exactly `max_iterations + 2` against an uncapped `1 + max_iterations`, at every n,
no edges. ADR 0016 § 2 was amended to match (it had still taught the event-flag
rule the code now contradicts).

Suite 191 assertions / 0 failures, full README § Tests 7/7, every fix
mutation-checked — including the one that halves a *genuine* escalation's budget,
which passed all 184 assertions before Scenario B was added. **2.5.1 is shipped
and verified**: cache byte-identical to the repo by `diff -rq`, suite green from
the cache copy. Tree clean, `origin/master` == HEAD, zero pending review docs.

**2026-09-21 (later) — leftovers handed off; the consumer ran and died mid-batch.**
The first handoff doc under the new contract
(`docs/handoffs/2026-09-21-tier-review-triage-and-ship.md`) briefed a fresh
session on the stale 2026-09-17 tier-ceiling review and the 2.5.0 ship. That
session consumed the review doc (`af0094f`: 12 dispositioned, 6 verified at
HEAD, 4 fixed) and marked the handoff consumed, then ended without closing —
its four-file fix batch (`wave-execute.workflow.js`, `prompt-invariants.test.mjs`,
`schedule/SKILL.md`, `rollout-template.md`; +60/−4) sits **uncommitted** in this
checkout, presumably per K25 with no review round dispatched. The originating
session's close deleted the consumed handoff doc and its own two consumed
review docs. **The 2.5.0 cache dance has not been run** — sessions still load
2.4.0 until push → marketplace update → plugin update → restart.

**2026-09-21 — v2.5.0: handoff docs are durable, and a pending one owns the
continuation (ADR 0017, amends 0011).** Picked up from the deferred capture
`thread-handoff-durable-lifecycle`. Part 1: `thread:handoff` always writes and
commits `<home>/docs/handoffs/<date>-<slug>.md` — `<home>` the unit directory
(project dir under `~/Projects`, workspace dir under `~/repos/workspaces`, else
the git toplevel) — never OS temp; front matter `thread`/`written`/`status`;
the consumer marks it `consumed` at pickup (paste prompt, or `thread:open`'s new
handoff-doc mode) and its close `git rm -f`s it. Part 2: close § The handoff owns
the continuation — scope test ("would the next session, working from this doc, do
it?"), refresh-don't-restate for the mid-session-then-superseded case, no
annotation, no asking; all tests on disk (one-directory `find`, awk front matter,
consumed = delete whoever marked it); legacy docs without front matter are
counted and untouched. Verified by a five-then-nine-rep close rig (controls
proposed all four candidates; every treatment rep proposed exactly the two loose
ends). Two xhigh clean-room rounds (14 + 15 findings, all dispositioned in
`docs/reviews/2026-09-21-*`); round 2 was 53% about round 1's fixes, so the chain
stopped by METHOD K27 and the rig gated the ship. Stop hook message aligned
(`session_safepoint.py`, fixtures 38/0); Codex adapter stub's OS-temp line
dropped. Manifests re-synced at 2.5.0 (they had drifted 2.4.0 / 2.3.5).

**2026-08-29 — v2.2.0: close saves autonomously; vault tasks stay gated (ADR 0011).**
Lachy called out the close menu as rubber-stamp theatre — he ticks every
memory suggestion unread, so the gate filtered nothing while the memory
estate rotted un-pruned (ops index in ALERT, global triage 65 days overdue).
Grilled six rulings (ADR 0011): the menu survives only for vault tasks;
memory/thread/knowledge auto-execute behind a four-verb save-time triage
(`ADD | UPDATE | SUPERSEDE | NOOP`, NOOP a success state) and a frontmatter
contract (`captured` / `last_confirmed` / `status: provisional|active|
superseded` / `provenance` / `permanent`). The safety moved downstream: a
weekly autonomous **memory curator** (new `~/.agents/skills/memory-curator`,
launchd Sunday 09:30, archive-first — never deletes) prunes/merges/demotes on
*observed* usage from a new daily transcript recall harvest
(`_shared/scripts/memory-recall-harvest.py`); `/memory-triage` retired.
Close's dangling doctrine pointers repaired to
`claude-base-instructions.md § Claude memory management`; project-area file
canonically `AGENTS.md`. The frontmatter contract is a cross-repo interface —
change close and the curator in lockstep.

**2026-08-18: Windows minimal footprint; 2.1.0 finally through the cache.**
The Windows machine (native Windows, user `lachl`, rarely used) requested a
Mac bootstrap that would have re-created infrastructure that already exists:
`~/.claude` is already the private `lachyts/claude-config` repo (allowlist
gitignore, daily-sweep pushed), and its `skills/` entries are Mac-absolute
symlinks whose real bodies live in `lachyts/agents-config`. Grilled twice:
first the transport got corrected, then Lachy called overkill and the scope
collapsed to the three verbs he actually uses there (next/close/orient).
Rulings: plugin + Obsidian-synced vault is the whole Windows footprint; no
personal-config transport (standalone skills and global CLAUDE.md stay
Mac-only); no workspaces clone (shared-thread/registry features degrade
deliberately; clone only when a verb complains); no Windows fork of skill
bodies (a rewrite costs more than the two-command install and drifts
forever); no machine.json indirection (all 46 hardcoded paths resolve via
`expanduser` / Git Bash `~` once the vault syncs to
`C:\Users\lachl\repos\obsidian`). `docs/windows-setup.md` written
full-system (4307eee) then slimmed to the minimal path (118ae5a). Same
session: wave-skill's local clone deleted (the archived `lachyts/wave-skill`
tombstone remains; losslessly verified first); the vault swept NTFS-legal
for Obsidian Sync to Windows (11 renames incl. `*Active* Supplement
Protocol` with 18 wikilink updates; over-length titles shortened with
original phrasing preserved in bodies); and the 08-14 ship-pending item
closed: marketplace + plugin updated 2.0.3 → 2.1.0 on the Mac (session
restart applies). Windows plugin install in flight at close.

**2026-08-14 (later) — v2.1.0: orient launches its own batches (ADR 0010).**
Lachy challenged the SEO orient's paste hand-off believing the cc-* lane had
been retired into the engine. The docs won the factual half: the lane was
never retired (ADR 0009 kept it; the 2026-08-10 mis-routings were the thing
fixed), both SEO batches genuinely fail the fit test, and "run them as
Workflows inside the parent" is impossible — subagents inherit the parent's
MCP config and can never load a different scoped profile. The residue was
real though: the repair-autonomy principle ("never hand him commands to
type") generalises, and the tooling gap ADR 0003 was written against had
closed — `cmux workspace create --cwd … --command` delivers programmatic
scoped-session launch. Two grilled rulings: (1) orient launches batches
itself via cmux with the *expanded* profile alias (emission survives only as
the no-cmux fallback); (2) the steering answer alone authorises — no
per-batch confirm, accepted knowing batches run
`--dangerously-skip-permissions` unreviewed. Live-proven same-day: the SEO
p4/p5 batches fired as cmux workspaces 38/39, prompts verified
in-transcript. Orient §7 rewritten (write + stamp + launch + verify +
fallback), Don'ts gained the no-in-session-Workflow rule, glossary "Dispatch
artefact" updated, memory generalised. **2.1.0 is committed but not yet
shipped through the cache** — needs push → marketplace update → plugin
update → session restart (same dance as ever).

**2026-08-14 — v2.0.3: the review loop has a memory.** The Ralph-loop audit's
review-loop gap closed hands-on (grilled via plan mode, not the self-rollout
the capture's Launch block sketched): the review loop now accumulates
feedback like the plan loop, but with review semantics — the reviser gets the
latest round as its work order plus earlier rounds as ANTI-REGRESSION
constraints (fixes already committed on the branch must not regress), and the
judge gets the same history plus an anti-goalpost discipline (new objections
must come from new commits; round-1-visible nitpicks don't reject). After 2
rejections the round-3+ reviser upgrades to a **step-back round**: licence to
restructure, deviating from the approved plan where the accumulated feedback
demands it — deviations always declared (grilled decision: brief is contract,
plan is reference). Both ceiling outcomes now persist: `approvedAtCeiling`
appends the grouped history under `## Review history (approved at ceiling)`
(the p6-2 auditability gap), and `## Review-blocked feedback` upgrades from
final-round bullets to the full grouped history (legacy results fall back).
`STEP_BACK_AFTER = 2` is an engine constant, deliberately not rollout config
(EFFORT-matrix stance). Glossary gained accumulated feedback / step-back
round / ceiling approval. No ADR — prompt shapes are cheap to reverse.
Remaining from the audit: `thread-schedule-package-init-fileset-blindness` —
run it as a one-task self-rollout from a FRESH session (the version-keyed
cache means only a restart loads 2.0.3): the first live exercise of the
review-loop memory.

**2026-08-13 — v2.0.2 shipped; the merged plugin is live-proven.** The
giflab-rollout-2026-08-12 ran end-to-end on thread 2.0.x — the first
orient-originated rollout ever to reach the engine: 6/6 PRs merged
(giflab #64–#69), one designed gate pause (spend sign-off, amended live via
grill: cap $10→$50, subscription-CLI Claude arms), zero escalations/blocks.
2.0.2 = execute+gather description trims for the skill-listing budget (see
Known quirks); paired with user-settings `skillListingBudgetFraction: 0.02`.
Post-rollout Ralph-loop audit found the review loop has no cross-round
memory (plan loop accumulates feedback; review loop hands revisers only the
latest rejection) and no re-plan lever — three-fix task filed:
vault `thread-execute-review-loop-memory` (scheduled 2026-08-14), plus
`thread-schedule-package-init-fileset-blindness` from the wave-2
`__init__.py` merge-conflict incident. Both are wave-shaped; a two-task
self-rollout is the natural vehicle.

**2026-08-12 — v2.0.1: handoff becomes model-invocable.** Grilled same day as
the merge: the `disable-model-invocation: true` flag on handoff was inherited
from the flat-skill Pocock port (build-plan said "keeps", no rationale ever
recorded), and the asymmetry was backwards — close auto-commits two repos and
is visible; handoff writes only a temp file and was the one hidden route.
Flag dropped; description + body now gate on explicit fork intent or router
dispatch, with a hard no-proactive rule (context-feels-long → recommend
`next`, never self-fire). Decided: visible/explicit-intent over
visible/proactive and keep-hidden. No ADR — one-line reversible flag, stance
recorded here + CONTEXT.md § Handoff.

**2026-08-12 — v2.0.0: thread absorbs wave (ADR 0009).** The wave plugin
(`lachyts/wave-skill`, v1.4.1) merged in with full git history; all six
rollout verbs renamed `/wave:*` → `/thread:*`; "wave" is now a glossary
object, not a namespace (`wave:` frontmatter, `WAVE-STATUS:`, engine
internals unchanged). Behavioural changes from the same grill interview:
the execution-fit test got one canonical home
(`skills/_shared/execution-fit.md`) and decides the lane HARD (orient never
offers cc-* batches for wave-shaped clusters — closes the 08-10
GifLab/Smart Slider leak); schedule's <3-task floor is gone (shape decides,
not count — one-task rollouts are valid); the session-lane fallback names
its owners (defer / open's ## Launch). Wave ADRs renumbered 0004–0008;
wave's THREAD.md preserved at docs/wave-THREAD-archive.md; wave-skill
pinned at wave--v1.4.1 and archived. Live rollout notes (protocol_version:
3, incl. the open giflab-rollout-2026-08-12) remain executable unchanged.

Previous state: v1.0.1 built AND installed 2026-07-14 (`thread@thread`, user scope, GitHub
marketplace from `lachyts/thread-skill`). All six members live; flat skills
retired; workspace references migrated; vault project note [[Thread Skill]]
created. Same-day follow-up: Notion retired ecosystem-wide — close's
cross-machine-handoff destination deleted; plugin + Codex adapter +
workspaces instruction surfaces swept; shipped as 1.0.1 (session restart
applies it). Remaining: the live end-to-end verification checklist (fresh
session) — tracked by the vault task `thread-plugin-live-verification`,
scheduled 2026-07-15.

## What's been built / decided

- **ADR 0037 (accepted, not built; PR #139; build = P21): Reflections run on their own and tune for hands-off quality.**
  - **Why:** in about 16 rollouts, one Retro was ever run, so ADR 0032 d5 could never trigger.
  - **Headlines:** two, Hands-off rate and Quality (Escapes). Throughput and Review churn become Guardrails.
  - **Naming:** Retro → Reflection, `/thread:retro` → `/thread:reflect`, in Chorus's words (Tuning knob/rule/bug, Watch).
  - **Running:** completion scores every rollout by script. A model Reflection runs weekly (Opus xhigh, uncapped), and three quiet ones in a row move it to fortnightly.
  - **What lands unasked:** bugs as tasks, and knobs three Reflections agree on. Rules wait for a morning decision task.
  - **Escapes:** traced by a `fixes:` key.
- **3.0.0 released 2026-10-10 (#110).** The release notes are #110's body: protocol 5 only, the built-in ladder never leaves Opus (Fable only by naming it in `~/.config/thread/ladder.toml`), `max_tier:` retired, rollout defaults from `rollouts.toml` stamped at schedule, schedule picks the `-rollout` clone. Release PRs stay minimal (memory `release-pr-scope`).
- **Schedule resolves the rollout root (#108).** `self-rollout-check.sh --resolve <repoPath>` is the one call; § 0 runs it first, every other blocker runs on the resolved root, and `--regenerate` refuses a root change once a carried task has started (repair § 5 defer).
- **P16 decided (2026-10-06 grill, [[thread-skill-p16-unattended-rollouts]]).** (A) While any call, Integration or merge is in flight, a rollout lead never uses the question tool. A question goes in the report plus one push notification, and the turn ends `waiting`; the closing-questions hook exempts ROLLOUT-STATUS turns. (B) Execute auto-retries set-asides, broader than repair. `auto_retries: 2` (task → rollout → rollouts.toml → built-in) covers plan-blocked, blocked, review-blocked (+1 round per retry) and Integration set-asides. It stops early on a repeated feedback fingerprint, and never retries a judge-declared `needsHuman`. Gates, RACE, closed PRs and declined merges stay human. (C) The lead acts on its own recommendations (memory).
- **P15 landed (2026-10-06, #89 to #93): the Run record and the Retro (ADR 0032).** Events live at `${THREAD_EVENTS_DIR:-$XDG_STATE_HOME/thread/events}`, on Lachy's machine a symlink into `_shared/state/thread-events/`. Operator settings live in `~/.config/thread/rollouts.toml`. `/thread:retro` scores a run and applies only the Tunings Lachy picks. Phase 15 stays open for p15-6 and p15-7.
- **ADR 0031 (accepted, PR #72): the primary checkout holds while a rollout runs.** `land.sh` S4/S11 skip moving the plugin's own checkout while `unfinished-rollout.py running` lists a live, started, unpaused protocol-5 rollout; `primary-hold.sh` finds the checkout by where the plugin runs from. Moving it mid-run is a deliberate cut-over (pause, update, reinstate).
- **pushed-base decides "landed" by touched-file content alone (PR #73).** No `git cherry`, no `rev-list --cherry-pick`: patch identity passed a cherry-picked-then-reverted commit and an empty commit. Landed content that origin has since changed blocks (conservative).
- **Reshuffle 2026-10-03 (Lachy's calls):** Chorus, not GifLab, is the first queue run; P13 goes live only after it ends; p13-1 is the loader only; the `--admin` opt-in is dropped; the git-env canary (p14-6) is lead-side; estate chores merged into one note.

- **ADR 0030 (proposed, PR #53, build = P12): a rollout is a queue that integrates at merge.** Supersedes protocol 4's 0019.
- **ADR 0029 (proposed, PR #53, build = P13): escalation climbs the operator's ladder.** Supersedes ADR 0024's `top-tier` file and protocol 4's 0021.
- **Roadmap (orient scoped reshuffle, 2026-09-30):**
  - **New phases:** [[thread-skill-p12-a-rollout-is-a-queue]] (13 tasks) and [[thread-skill-p13-the-ladder]] (4 tasks, ending with the 3.0.0 release and the E2E).
  - **P6 and P7 retired:** p6-2, p6-3 and p6-5 renamed into P12; p6-4, p6-6, p6-7, p6-8, p7-1, p7-2 and p7-3 merged into new tasks; p6-1, p6-9 and p7-4 dropped.
  - **Loose tasks:** p8-3 and `rewave-a-blocked-task` dropped; `merge-wave-no-autostash` and `schedule-owns-one-live-rollout-per-repo` merged.
- **ADR 0028 (2026-09-29, #42/#45, 2.11.0): agents land their own work.** `skills/_shared/scripts/land.sh` is the one landing route (register → no origin → swept → unprotected push → protected `close/…` branch + `landing` PR + queued merge-commit auto-merge; never waits). `landing-register.py check` is the only permission to push (exit 0). Close's own-branch loop reviews with `/fresh-review` at the xhigh floor, has no round cap, and stops only on the ledger's regression stop, the same check failing twice at `max`, or a decision for Lachy (`--hold`).
- **2.10.0 (2026-09-28, #37–#40):** close marks a task done without asking only when this session did its work, the work is on the default branch (or it isn't code), and its Verify line ran green this session; otherwise it asks (ADR 0026 § 4). `thread:handoff` is the only handoff-doc writer (ADR 0017 amended). `next` can recommend `/compact` in Claude Code but never runs it. `reconcile-project.py --apply --only <file>` writes only the reviewed items and lists newer ones under `New since review`.
- **ADR 0027 (2026-09-28, PR #32, 2.9.0): orient is the one shaping verb.** `split` and `gather` are deleted (no alias stubs); their machinery is `skills/orient/reshuffle.md`. Orient asks Reshuffle / Steer only / Look only; in flight, possibly-landed and thread captures are frozen; a live rollout is superseded only when paused with all unlanded tasks open; the pass ends with the execute offer.
- **p5-2 (2026-09-27, PR #23): no SKILL.md body holds a positional `$N`.** The logic lives in scripts where it
  needs one (close `handoff-scan.sh`, `repo-track.sh`; execute `default-branch.sh`, which refuses an empty
  `<repoPath>`), behind wrappers that check the script exists (exit 2) and pass inputs through the
  environment. Open's lookup stays inline, because close reads it as a file: `fms` reads the loop's `f`
  and parses with `sed`. The contract bans the braced form and the `\$1` escape too (both undocumented).
- Plugin scaffold mirroring wave: manifests, CONTEXT.md, docs/adr/, README.
- Decisions live in `docs/adr/` — read the directory, never a remembered
  subset. ADR 0001 (the task is the floor; the thread is the upgrade) and
  ADR 0002 (`next` is a sibling, not a parent) shaped this scaffold; 0009
  (thread absorbs wave), 0010 (orient launches its own batches) and 0011
  (close saves autonomously) govern current behaviour.
- Canonical THREAD-template.md home: `~/.agents/skills/thread/THREAD-template.md`
  (harness-neutral; `check-agent-parity.py` pins it).
- Pickup auto-completes the capture task (decided in design interview).
- Stash surfacing: `/weekly` "Stashed threads" pass (decided in design interview).
- Codex `.agents/skills/{thread,close}` adapters kept as their audit-era
  **native translations** (not thinned to pointers as the plan suggested) —
  undoing deliberate Codex-safety work wasn't worth the dedup; only
  `handoff`'s canonical pointer was repointed at this repo.
- Vault project note `Work/Projects/AI/Thread Skill.md` is the
  human-facing surface (goal, terminology, wave-sibling framing); its
  `repos:` frontmatter auto-routes tasks captured from this repo's CWD.
- Build lineage: `docs/build-plan.md` (the approved plan, copied in at close).
- **2026-09-25, the model tier is locked:** Opus 5.5 is the top tier until Lachy edits
  `~/.agents/AGENTS.md` § Model tier by hand (`~/.agents` commit `10ceaf6`). Rollouts of this plugin set
  `max_tier: opus` and stamp no `model: fable`. schedule's text still calls `max_tier` a quota switch
  ("leave it commented out"); the AGENTS.md section is the explicit operator instruction ADR 0016 asks
  for. This repo's `fable-first-model-stance` memory is marked overridden.
- **2026-09-25, the close peer guard (p2-4, PR #16):** a consumed handoff doc is deleted at the
  marker's own close, or by any later close once its mtime is 24 h old and no listed peer sits in its
  `<home>` or `Run from:` directory (`skills/_shared/handoff-lifecycle.md` § Close-out). `ListAgents`
  rows carry no cwd as of 2026-09-25, so on Claude the 24 h floor is the whole guard, and close skips
  the listing. This resolves the 2026-09-21 open question on deleting from under a live peer.
- **2026-09-24, the leak cleanup:** it took the rewrite route. `origin/master` was force-pushed back to
  `c667e9e` with a lease, `origin/main` was deleted, and a clone-local `pre-push` guard refuses
  `master`/`main` pushes (rollout note § *Resolved 2026-09-24*). A rollout lead never approves gates. It
  halts on `gate-pending` and parks the decision in the rollout note (p1-3 on 2026-09-24, p4-1 on
  2026-09-25; both were withdrawn by Lachy, not approved).
- **2026-09-23:**
  - **Tests:** `make test` is the one test entrypoint and the self-rollout verifier. New suites join by
    filename. `make release-check` verifies the version-keyed cache after a release.
  - **Base branch:** the rollout base is the repo's GitHub default. The argument is
    `defaultBranch`, never `baseBranch`, which protocol 4 owns. The resolver stops rather than assume
    `main`.
  - **Engine work:** held for protocol 4 except that enabler.
  - **Self-rollouts:** a self-rollout of this plugin runs from a GitHub-origin clone under `~/repos`,
    never the live checkout.
  - **Three test layers:** contract tests, `claude plugin eval` behaviour evals, and a live E2E checklist
    (`docs/e2e/`).
- Notion handoff destination deleted from close (2026-07-14), not re-routed:
  Notion is a read-only legacy archive (personal → Obsidian migration
  pending); THREAD.md, git-committed by the close flow, is the cold-pickup
  artifact — a Notion page duplicated that guarantee.

- **2026-09-27, the safe-point hook deleted** (vault p9-1): no hook polices session length. The statusline shows `ctx %` (yellow from 40%, red from 70%), native auto-compact stays at its default, and round caps live in the loops (fresh-review's ledger, execute's `max_review_rounds`). Rollout conductors are never interrupted: at a quota ceiling they wait and resume from the cursor. `thread:handoff` runs only on request. The memory `feedback_offer_handoff_long_iteration_sessions` is superseded by `feedback_say_loop_round_count`.
- **2026-09-27, ADR 0026** (above) and the P10 roadmap.

- **P12 landed (2026-10-03, #56–#69): the queue replaces waves.** Protocol 5 rollout notes; `task.workflow.js` (one task per call); `merge-task.sh`; `reconcile-rollout.py`; `lead-integrate.py`; `rollout-stop-driver.py` and the `ROLLOUT-STATUS` line. `merge-wave.sh`, `reconcile-wave.py`, `wave-execute.workflow.js` and `WAVE-STATUS` are deleted with no alias. Phase 12 stays open for p12-13.
- **Hard rollout tasks start at the higher rung** (2026-10-01/02 evidence): a deep task stamped `effort: xhigh` with `max_plan_rounds: 6` converges; at the default rung it plan-blocks. ADR 0029's ladder makes this the rung-2 start; until P13, it's per-task frontmatter.

- **P16 landed (2026-10-09, #97, #100, #104, #105; p16-2 in workspaces): unattended rollouts.** The engine declares `needsHuman` (a stop that is never evidence of hardness); the lead never calls the question tool while anything is live and pushes each needs-you item once (`## Needs-you log`); execute auto-retries agent-fixable set-asides by budget (`auto_retries`, built-in 2) with a quota cool-down (ADR 0033); repair asks only what needs Lachy.
- **P17 landed (2026-10-09, #98, #99, #101, #102, #103): queue fixes from the Chorus runs.** Integration lane order (dependants first, then oldest `ready:`) and a landed list that names PR-less commits; a Solo task holds by its row, not `priority:`; carry prints `order` hints from the prior rollout's prose; the plan gate reads a doubled Gated-inputs heading; land.sh takes consumed review-doc deletions; schedule's gate sweep widened.

## Open questions / decisions pending

- **The C17 flake (2026-10-16).** `tests/lead-integrate.test.sh` C17 "TERM to verify … its children are gone" failed on macOS CI under load (`pgrep` found 3 children right after the TERM) on PR #148, which does not touch it, and passed on rerun. merge-task's infra classifier called it genuine (fail-closed), so its exit 1 would have set the task aside and auto-retried a whole call. Make the assertion wait for the group to exit, like the 12a/35 load-tolerant fixes? Lachy's call whether to file it.
- **Schedule P16 before or after p13-4 (3.0.0)?** p13-4 updates the live checkout, and a running rollout holds that checkout, so the two can't overlap. The recommendation is p13-4 first, since it was waiting only on Chorus.
- **Hold own-branch moves too?** (p14-7 follow-up, Lachy's call) Putting the hold inside `move_branch` would guard `land.sh --own-branch` on the primary checkout, but an own-branch landing there would then end `stuck: held`.

- **The daily lander (p11-7) doesn't exist yet.** Until it does, a queued merge that fails (red CI, a PR left behind master, `queued: needs merge`) waits for the next close in that repo. It has to catch up on wake: the laptop is often off overnight until the Mac mini arrives.
- **Loose end from P11:** [[thread-skill-p14-5-land-pr-body-names-its-caller]] (a handoff's landing PR body says `thread:close`). The autostash fix is now in [[thread-skill-p12-7-merge-one-integrated-pr]].
- **Fable as a third rung** waits on [[ab-fable-vs-opus-planning]] (a blind replay of hard rollout tasks, after p13-2). Don't re-open it without that result.
- **AGENTS.md still says reviews never block** (p11-8): landing's review runs inline. Lachy's file, so the wording needs his approval.
- **Open from ADR 0029:** how a block at the top rung is triaged. This is p7-1's third question, carried into [[thread-skill-p13-1-ladder-file]].
- **The fresh-review of workspaces `29ca886` (the hook deletion) hasn't run.** The engine binds to the session's cwd, and this session was in thread-skill. It needs a session launched in `~/repos/workspaces`.
- **Halted vs running is not locally readable.** `reconcile-wave.py status` shows `paused` and task statuses but not whether a lead is still driving, which is why orient supersedes only a `paused` rollout. A liveness signal would widen that.
- **`handoff-manual-dry-run` scored 0.83** in the 2026-09-28 eval run (its LLM lifecycle judge voted FAIL ×3; every tool and regex grader passed). Re-run it before treating it as a regression.
- **`tier_capped:` means something else under the Opus lock** (seen 2026-09-27). With `max_tier: opus` from the AGENTS.md lock (ADR 0024), every opus task whose first plan is rejected gets `tier_capped: plan`: all three P10 tasks did. ADR 0016 defines the marker as "capped by quota, re-dispatch uncapped once quota returns", but the lock never lifts, so the marker is now permanent noise on most cross-cutting tasks. This joins the deferred tier-ceiling gap 1 below (status and repair ignore the marker). Decide whether a lock-driven cap stamps anything.
- **`check-agent-parity.py` exits 1** on `~/.codex/hooks.json` ("direct Codex must use native Stop notification"). Seen 2026-09-27 and unrelated to the hook deletion.

- **`${CLAUDE_PLUGIN_ROOT}` in read-as-file text stays literal** (review e4fe2a2/a0bb12 #1, #6; predates
  p5-2). A command in a sibling SKILL.md read by `/thread:open save` or `/thread:next`, or in a `_shared`
  spec (task-writer.md's `resolve-day.py`, close's handoff-home.sh and repo-state.sh wrappers), runs with an
  empty root, because the Bash tool leaves it unset. It needs one rule stated once and cited by every
  caller. Proposed as a vault task at the 2026-09-27 close.
- ~~No CI and no branch protection~~: resolved 2026-09-26 (ADR 0025, p5-1): CI plus rulesets.
- **The stale `thread@thread` 2.3.4 project-scope record at `~`** is still installed. Uninstalling it is
  unsafe as written: all three profiles' `settings.json` are symlinks to `~/.claude/settings.json`, which
  is also the project settings file for `~`. Vault task `thread-skill-stale-project-scope-install`.
  Related, not yet investigated: `check-agent-parity.py`'s skill-packages check still takes thread 2.3.4
  (`e586b19`) as the selected release, so it reports the 2.6.0 cache and this checkout as drift. A release
  here doesn't update that selection (seen 2026-09-25).
- **Protocol 4 intake** from the 2026-09-23 audit:
  - port `defaultBranch` to the redesign's protocol 3 path
  - gate the release on the zero-rounds fail-open bug
  - the pilot requirement notes never close
  - read-only agents read a mutable checkout
  - scrub `GIT_*` for the verifier and agents (the 2026-09-23 self-rollout leak; vault task
    `thread-rollout-v4-scrub-git-env`)
  - `parseGatedInputs` reads past a thematic break, so p4-1's feedback list became 23 gates on
    2026-09-24 (intake item 13)
  - items 14–17 from the rest of the self-rollout: the lessons are in § Known quirks
  - from the 2.7 rollout: `skills/execute/scripts/merge-wave.sh:102` reads the branch with
    `git rev-parse --abbrev-ref HEAD`, which has the ambiguous-ref bug p2-6 fixed in `repo-state.sh`
    (a tag named `master` gives `heads/master`)
  - from the 2.7 rollout: a verifier red on the base branch, outside a task's `touches:`, blocks the
    implementer. p2-7's capped retry then widened scope into `skills/execute/tests/`. Re-run the verifier
    on base before blocking. The first pass's `## Blocker diagnosis` also stays on the note after a
    successful retry.

  Vault task `thread-rollout-v4-intake-2026-09-23-audit`, owned by thread 1.
- **Two tier-ceiling gaps deferred from the 2026-09-21 round-3 review** (held for protocol 4 since the
  2026-09-23 audit; the redesign already carries most of gap 1)
  (`docs/reviews/2026-09-21-c9f09dd-df669e.md`, findings 12 and 14). Both are
  pre-existing — neither was introduced by that chain — and both were left
  alone deliberately because `review-ledger.py` fired STOP on that round
  (60% regressions, culprits the chain's own fix commits), so a fourth patch
  round was the wrong move. Recorded here because the review doc is deleted at
  close-out.
  1. **`/thread:status` and `/thread:repair` never mention `tier_capped`.**
     ADR 0016 § 3 names those two skills as the consumers of the durable
     marker — the whole justification for stamping it on the note rather than
     leaving it in the workflow return — but `grep -rn 'tier_capped' skills/`
     matches only schedule, execute and `reconcile-wave.py`. So a capped
     rollout's blocked tasks get triaged by `/thread:repair` as genuine walls,
     which is exactly the failure mode ADR 0016 § 3 exists to prevent. Fix is
     two conductor-skill edits; needs a decision on the triage wording.
  2. **A capped run that goes green on its first pass records nothing.**
     `escalate()` is never called, so `capSuppressed` stays false, so
     `tierCapped` is false and reconcile stamps no marker. That task ran a full
     Ralph loop at the higher EFFORT row on the capped model — a materially
     different profile from an uncapped opus success — and the note cannot be
     told apart from one afterwards. Auditing which tasks in a rollout ran
     ceilinged is impossible once the lead session ends. Fix needs a new result
     field (the run was capped) distinct from the existing one (an escalation
     was suppressed), plus a reconcile change: a design decision, not a cleanup.

- **Chorus Suggestion-card seam (estate METHOD K40, 2026-09-21).** The Stage's
  Suggestion card (chorus ADR 0036) has a **Keep** that writes a vault task
  directly — the Host writes it, so close's ADR 0017 rule never gets a vote —
  and a **Start** that carries no pointer to the pending handoff doc. Handed to
  this thread as findings-not-spec; the seam is deliberately undecided: does
  the Stage learn what a handoff doc is, or does `thread:handoff` emit a
  Suggestion? Owner is this thread.
- Does `${CLAUDE_PLUGIN_ROOT}` expand in the Stop-hook command under the
  native-Windows hook runner? The first Windows session end answers it; if it
  fails, the fix lands in `hooks/hooks.json` here, never a local patch.
- Windows install verification pending: marketplace add (gh auth), first
  `/thread:next` (vault path resolution), Stop-hook noise (python3 shim is
  the optional quieting fix).

- **Review-gate-only repos** (no required checks): `merge-task.sh` halts with exit 7 ("review required"). A per-rollout `--admin` opt-in is Lachy's call: [[thread-skill-merge-task-followups]].
- **The queue is live without a release.** The plugin version still reads 2.11.0 while the skills are P12's (the directory source loads the working tree). p13-4 releases 3.0.0; sessions started before 2026-10-03 still run the wave-era skill text until restarted.
- **The fresh-review of workspaces `eb136df` (the dangerous-rm hook) hasn't run either**: same cwd binding as `29ca886`; run both from one session in `~/repos/workspaces`.

- **Ceiling vs. a load-sensitive verifier.** Does the thread-skill ceiling stay at 4 while `make test` has wall-clock assertions? The Retro on `[[thread-skill-rollout-2026-10-09]]` reads the cost (three extra integrate calls, three climbs). Fixing the tests ([[thread-skill-load-tolerant-timing-tests]]) may make a lower ceiling unnecessary.

## Known quirks (don't re-derive)

- **Parallel tasks each draft "the next free ADR number", so they collide (2026-11-01).** Four tasks of rollout 2026-10-31 each wrote a new ADR 0060 under a different filename: git sees no conflict. `tests/contracts/refs.test.mjs` rule A (every ADR reference resolves to exactly one file) catches a duplicate at the Integration verify; the lead then routes it to the integrator, which renumbers when the task note says so (the lead added an `## Integration note`). A fix belongs in schedule or the planner prompt (reserve numbers, or draft as `NNNN` and number at Integration).
- **An OAuth expiry mid-call returns a `transient infrastructure failure` row (2026-11-01).** Same shape as a usage-limit cut (`Failed to authenticate: OAuth session expired` in `<failures>`): treat it as the signed-out case and resume the same runId with its original args, never reconcile the row.
- **merge-task.sh can outlive the 2-hour harness limit waiting on checks that are already green (2026-11-01).** PR #261 sat `waiting on required checks…` while both checks had passed; the harness killed it (`failed:143`) and the one sanctioned re-run merged at once.
- **A sign-off push can reach nobody (2026-11-01).** `PushNotification` reports `not sent (Remote Control inactive)` and the ntfy fallback skips with no `[notify] ntfy_topic` in `~/.config/thread/rollouts.toml`, so the `## Needs-you log` records `push failed:`. Lachy sees the gate only in the session or the rollout note until a topic is set.

- **An integrate call's `headSha` is `prepare`'s `anchor`, never the PR head** (2026-10-29). When the PR head carries agent merge commits, `prepare` reports "neither clean case" with `anchor` ≠ `prHead`; passing `prHead` makes the merge step STOP ("anchor carries a merge") or the judge refuse ("anchor mismatch"), and burns an auto-retry. Build the args from `prepare`'s JSON by script, never by hand. The same goes for a fresh call after a signed gate: pass `task.approvedGates` from the note, or the plan re-asks the same gate.
- **macOS CI runner speed varies about 2x** (2026-10-29): a passing `make test` took 14 min, slow runners over 25. `THREAD_TEST_JOBS` above 4 overloads the 3-vCPU runner and makes it slower; the job now has `timeout-minutes: 40` (PR #247).
- **`Note._set_body_lines` raises outside a journaled edit (#213).** A body edit computed from the note itself goes through `@_journaled` (a module function taking the note first) or `Note.apply(fn, …)`, so `Note.save` can re-apply it over a concurrent writer. A direct `_fm`/`_body` assignment is caught at save, which refuses rather than drop it.
- **Note save locks live in `~/.local/state/thread/note-locks`, one per note directory.** Every engine suite exports `THREAD_NOTE_LOCK_DIR` into its temp dir beside `THREAD_EVENTS_DIR`; a new suite that saves notes must too, or direct runs leak lock files into the real state dir (44 did on 2026-10-24).

- **This machine's `gh` has no `pr update-branch` (2026-10-23).** It prints the command list and exits 1, so a "behind" PR with auto-merge queued never updates. Use `gh api -X PUT repos/<owner>/<repo>/pulls/<N>/update-branch -f expected_head_sha=<sha>`. A PR whose branch is behind sits `BEHIND` with green checks indefinitely.
- **Never wait on GitHub in an unbounded background `until` loop (2026-10-23).** A `connection reset by peer` from `gh` exits the loop "successfully" with the PR still open; the notification reads as done. Poll in the foreground with a bounded count, treat a `gh` error as unknown, and read the result before ending the turn.
- **A release-time `make evals` keeps no traces.** The recipe has no `--keep-temp`, so a sub-1.00 case is unexplainable and the loaded plugins and resolved model are unverified (5.0.0 record). Tracked by [[thread-skill-5-0-docs-follow-ups]].

- **An integrate call's `plan` must go in verbatim, and plans run to 60k+ characters (2026-10-19; hit again 2026-10-20).** On 2026-10-20 a 74k-character args object for p26-2 could not be sent: the attempt was cut off part-way. Lachy ruled `plan: ""` for p26-2, p24-4 and p25-3 (the rollout's `## Notes`). The judge-only path never renders `I.plan`; the conflict integrator worked from the brief and review history and resolved both conflicts. Tracked by [[thread-skill-integrate-args-plan-too-large]]; until it lands, ask Lachy before passing `""` again. The Workflow tool takes args only inline (no file path), so the lead copies the `lead-integrate.py plan` output into the call. Check fidelity after launch: the integrator's prompt embeds the plan indented two spaces, so de-indent from `Planned on:` and compare with the plan file. A shared-file judge-only call carries no plan.
- **Usage-limit cuts read as `transient infrastructure failure` rows (2026-10-19).** A call cut by a session, 5-hour or monthly limit returns `blocked` with that diagnosis and the CLI's `You've hit your … limit` in `<failures>`: never reconcile it; resume the same runId with its original args after the reset.
- **The 1800 s Integration verify times out under concurrent suites (2026-10-19).** At load ~157 (four agents' `make test` plus the lead's) p19-5's lead verify hit rc 124 with zero failures. #174's `tests/run.sh` cap (4 suites) fixed it for later verifies; the machine-wide verify slots go live only after a plugin update.
- **`parallel_ceiling` is live:** `reconcile-rollout.py next` re-reads it from the rollout note on every call, so editing the note changes a running rollout at the lead's next loop entry, which can lag the edit (Chorus: edited 09:43+11:00, first `running=5` at 10:29+11:00). No event records the change: it shows only in the `settings` stamped on the next `slot-taken` / `idle-slots`, and the Reflection flags `ceiling changed mid-window` (split with `--since`/`--until`).
- **Integrations ≠ merges:** a rejection or a re-Integration after `main` moves runs the lane again (Chorus: 40 for 38), so lane capacity in merges is lane capacity in Integrations over that ratio.
- **Lead transcript timestamps are UTC**, task-note stamps are local with an offset, and Melbourne moved +10 → +11 at 02:00 on 2026-10-04: subtract only after normalising.
- **The Codex worktrees' private evidence is archived (2026-10-18).** `docs/implementation/2026-09-23-codex-routing-evidence.json` (on branch `codex/codex-routing-capability-check`, never on master) names a `privateEvidenceRoot` under `~/.codex/worktrees/5c5a/`, which is removed: that evidence root now lives at `~/Archive/thread-skill/2026-09-23-codex-routing-evidence.tgz`. The thread-rollout-redesign worktree is removed too: its commits are on branch `archive/thread-rollout-redesign` (`14676a3`) and its uncommitted `.thread/` evidence is in `~/Archive/thread-skill/2026-09-23-thread-rollout-redesign-evidence.tgz`. Any `~/.codex/worktrees/thread-rollout-redesign/...` or `.../5c5a/...` path (the 2026-09-22 thread 2 closeout link, the redesign's `2026-09-23-claude-routing-evidence.json`) is dead: read the file from the archive branch or the tarball.
- **Pushed-base reads sibling clones (2026-10-17).** A handoff commit queued on the primary checkout (`~/repos/tools/thread-skill`) makes schedule § 0 refuse for the clone until its landing PR merges (~5 min CI). Wait it out; never open a second PR. Execute's launch re-runs the same check.
- **An integrate call carries the task's approved plan verbatim in its args (2026-10-16).** The plans here ran 32–38k chars, so the lead re-emits ~40k of JSON through the Workflow tool call (execute § 4.5 step 3: "never retyped"). It worked, but it is the lead hand-copying a large blob; a plan path the engine reads would be safer. Same for a seeded revise's `plan`.
- **A merge-task exit 1 on a known flake (2026-10-16).** When the red required check is a test the PR does not touch and the other OS is green, the lead reran the one failed job (`gh run rerun <id> --failed`) and re-ran `merge-task.sh` on the same integrated pair rather than set the task aside. Recorded in the P21 Completion log as a lead judgement call.
- **`native_workflow.mjs init DIR SCRIPT ARGS CONFIG` takes ARGS and CONFIG as file paths**, not inline JSON: an inline jobs object fails `ENAMETOOLONG`. Write both to files beside the prompt (orient § 8 dispatch, 2026-10-15).
- **`claude plugin eval` defaults (2026-10-15).** The LLM judge is Haiku unless `--judge-model` is passed. The CLI keeps a repeated option's last value, so `make evals` puts its defaults before `$(EVAL_ARGS)` and its locks (`--ablation none --model opus --judge-model opus --no-publish`) after it (PR #152). `--case` takes one glob per run: a second `--case` silently replaces the first. A `--max-cost-usd` breach skips the remaining cases and exits non-zero.
- **A live E2E needs a hub and children (2026-10-13).** The harness resets a `cd` outside the launch dir, so the CWD-bound verbs run in a child session launched in the fixture: in Chorus, `create_thread` (and `spawn_task`) take a `cwd`, so the hub raises a card that opens there. A card-started session never reports back to its raiser; the hub watched the checklist file with a background `until` loop (fix filed for Chorus).
- **Worktrees under the live checkout can reach the plugin cache.** The `./` directory source copies ignored files; before `claude plugin update`, remove every `.claude/worktrees/*` (the stray `run-record` one, PR #88's, was removed 2026-10-13; #88 closed 2026-10-19, superseded by #177) or `make release-check`'s stray check fails and the cache copy must be deleted by hand. Bit again at 3.1.0 (2026-10-15) by this session's own release and withdraw worktrees: remove them from `~/.claude/plugins/cache/thread/thread/<v>/.claude/worktrees/`.
- **`make evals` grades routing on skill descriptions only.** A body-only change (#108) needs no eval re-run; a description change does. The lifecycle judges record no rationale: re-run a miss with transcripts before reading it.
- **A Workflow task-notification's output file is one JSON object** (`summary`, `logs`, `result`, `agents`): pipe `json.load(f)['result']` into `reconcile-rollout.py reconcile --result -`; the file has no `<result>` tag to cut.
- **land.sh's close-out paths are `THREAD.md` and `docs/handoffs/` only** (`closeout_shaped`): a consumed `docs/reviews/` doc can't be deleted by a close-out landing, though fresh-review expects its docs deleted at close ([[thread-skill-land-takes-review-doc-deletions]]).
- **A queued landing PR falls `BEHIND` when a rollout merges past it** (the repo requires up-to-date branches). land.sh's `update-branch` runs only inside its own call, so a peer's close-out waits for the next close in that repo or the daily lander.

- **Run `unfinished-rollout.py running` before moving the primary checkout by hand.** ADR 0031's hold lives in land.sh only; a manual `git merge --ff-only` bypasses it (2026-10-06: a live Chorus lead switched engines mid-run).
- **A rollout never runs the engine changes it lands.** The lead runs from the held primary checkout, so P15's emitters wrote no Run record for their own rollout. Expect a change to execute, the engine or its scripts to take effect only on the next rollout, after the fast-forward.
- **AskUserQuestion holds the lead's turn.** Workflow and background-command notifications queue until it is answered, so a question asked overnight stalls every finished call behind it (2026-10-05, about 12h). P16 removes the hazard; until then, never ask while work is in flight.
- **This checkout is the engine for every rollout lead.** While one runs, close from here still lands (a protected repo queues a `close/…` PR) but skips the fast-forward (`land: held the primary checkout`), so local `master` sits ahead until `git reset --keep origin/master` once nothing runs (ADR 0031 Consequences).
- **`CLAUDE_PLUGIN_ROOT` is unset in the Bash tool** when a skill is followed through a router (next → handoff): the snippet guards exit 2. Export it to the plugin root and re-run ([[thread-skill-p19-6-plugin-root-read-as-file]]).
- **gh 2.43: `gh pr edit` fails** (Projects-classic GraphQL); `gh api -X PATCH repos/lachyts/thread-skill/pulls/<n>` works, and `gh pr merge --merge` works.
- **A Linux Verify without Docker:** push a throwaway branch whose `test.yml` triggers on that branch and runs a 20-way `ubuntu-latest` matrix of `make test`; delete it after (p14-1's 20/20 run 37097172002).
- **`/fresh-review` on a pushed PR branch** reads `diff6 = da39a3` (nothing unpushed): pass the explicit range and name the doc by the range's digest (`git diff <base>...<head> -- . ':!docs/reviews' | shasum`); from a session whose cwd is another checkout, tell the reviewer where the head's files are.

- **Claude Code asks about some `rm` shapes even in bypass mode** (2.1.285 `dangerousRemoval` is `bypassImmune`; allow rules can't cover it; no ask timeout, in the CLI or Chorus): `cd <dir> && rm -rf ./*`, a bare `rm -rf ./*`, `rm` on a `$VAR/` or command-substitution target. The PreToolUse hook `~/repos/workspaces/_shared/hooks/check-dangerous-rm.sh` refuses them with the literal-path rewrite. A `settings.json` hook change reaches a running session (sentinel-tested 2026-10-02).
- **A Workflow task-notification's `<result>` can be truncated**; the full JSON is the output file's `result` field (`json.load(f)['result']`, a string to parse again). Reconcile from that, never from the inline text.
- **zsh does not word-split `$L`**: a `touched-phases` line stored in a variable must be passed split (`${=L}`, or the args typed out), or reconcile-project sees one argument.
- **Self-rollouts still run from the clone** `~/repos/tools/thread-skill-rollout`: p12-4's self-rollout check refuses a repo path that is, or contains, the directory-source marketplace.
- **One session can hold several Workflow calls in flight:** `docs/spikes/2026-09-30-concurrent-workflow-calls.md`.
- **`gh` 2.43 has no `gh pr update-branch`** (2026-09-30): use `gh api -X PUT repos/lachyts/thread-skill/pulls/<n>/update-branch -f expected_head_sha=<sha>`.
- **`land.sh --own-branch --queue --reviewed <sha>` refuses a head with non-`docs/reviews/` commits after the reviewed SHA**, by design. When Lachy chooses to merge an unreviewed commit (as for #53's slimming), queue `gh pr merge <n> --merge --auto`, which still waits for green CI.
- **The `refs` contract test resolves every `ADR NNNN § X`** in README, skills and `docs/adr/` against that ADR's headings. Cite ADR decisions as "decision N", never "§ N".
- **Dependencies are frontmatter only** (`skills/schedule/SKILL.md` § 3): a body link such as "Carries [[…]]" never creates one.
- **`land.sh` accepts only THREAD.md and `docs/handoffs/` paths.** ADRs and other docs land on a feature branch with a PR, reviewed by close's own-branch loop.
- **A vault-wide `/usr/bin/grep -rlF` for backlinks takes more than 2 minutes** (the vault is large). Run it in the background.
- **Protocol 4's branch is not landed and won't be as a whole** (retired 2026-09-30). Mine it for ideas, never merge it.
- **Design-heavy tasks need a bigger plan budget** (2026-09-29). With 3 plan rounds, p11-3 plan-blocked on breadth three times; with `max_plan_rounds: 6` it converged, and p11-4, started at 6, converged in 4. Stamp `max_plan_rounds: 6` on a deep cross-cutting task up front. When each round instead finds a new race in machinery a requirement forced, reshape the requirement (estate METHOD, the plan-gate move).
- **`merge-wave.sh` now leaves a merged PR's remote branch "for the reaper"**, and the repo's delete-branch-on-merge removes it. A close-out landed through `land.sh` shows as `on master, N commit(s) not on origin/master — queued in close/…` until GitHub merges it; that's normal, not stranded.
- **`claude plugin update` reads the live checkout** (2026-09-28). The marketplace is a directory source at `~/repos/tools/thread-skill`, so a release merged from the rollout clone reports "already at the latest version" until that checkout is fast-forwarded to the release commit. Fast-forward it first, then update both profiles.
- **To move a task to a later wave, edit by hand** (2026-09-28): the task's `wave:`, and the rollout note's wave table, Tasks by wave and File-sets. `reconcile-wave.py defer` clears `wave:`, `rollout:` and `owner:`, which removes the task from the rollout.
- **A plain `reconcile-project.py --apply` recomputes, and never replays the dry run** (2026-09-28). On a vault a live rollout is writing, it can close more than was reviewed: a reviewed 2 became 5. Any caller that reviews before applying (orient's drift fixes, a hand-run acceptance) saves the dry run's `--json` to a file and passes it to `--apply --only <file>` ([[thread-skill-reconcile-apply-binds-reviewed-list]]): it writes only the reviewed items and lists anything newer under `New since review`, unwritten. Only execute's phase-close ceremony uses a plain `--apply`, with no review in between. The vault then moves closed phase notes into `Phases/Archive/` within minutes, and the daily sweep may commit them before you do, so a pathspec commit of the old paths fails.
- **Tag a release at the released commit, never at `origin/master`** (2026-09-28). Master can move past a release without changing the manifests: #31 landed on 2.8.0. `claude plugin tag` tags HEAD, so run it from a checkout sitting on the released commit with a clean tree (stash any consumed-handoff mark first).
- **`gh pr update-branch` doesn't exist in this gh**, and master's protection is strict: a PR behind master shows `mergeStateStatus: BEHIND` and `gh pr merge` refuses with an `--admin` hint. Use `gh api -X PUT repos/lachyts/thread-skill/pulls/<N>/update-branch`, wait for the re-run CI, then merge (2026-09-28, #34).
- **`claude plugin eval` from an agent needs `--trust-plugin`** (its first run in a directory asks otherwise). `make evals` doesn't pass it, and `evals-structure.test.mjs` forbids it in the Makefile, so pass it on the command line only. Delete `evals/results/` before `claude plugin update`, or release-check fails on the copied output (2026-09-28).
- **The live plugin checkout can be on someone else's branch.** Other sessions work in `~/repos/tools/thread-skill` too (2026-09-28: `feat/orient-reshuffle`). Check `git status -sb` there before any release step, and do release git work from the rollout clone when it isn't on `master`.

- **A `cd` in a Bash call moves the session's working directory, but only inside the launch tree.**
  - Inside the tree, it moves. Background clean-room reviewers resolve `git diff` against that
    directory, so while a review runs the lead uses `git -C` and absolute paths only. (2026-09-23: one
    `cd` into the root checkout mid-review would have pointed a worktree review at a clean tree. Caught
    and reverted before the fork started.)
  - A `cd` outside the tree is reset by the harness: `Shell cwd was reset to <launch dir>`. So work
    that needs the CWD-bound verbs against another repo needs a session **launched there**:
    open/close thread lookup, stash/defer routing, and handoff's `<home>`. The engine is exempt,
    because it anchors on `repoPath`. (2026-09-23: this forced the E2E's S1 split.)
- **`plugin update` at one version is not enough.** The cache follows the version number. A content
  change needs both manifests bumped, then `claude plugin update thread@thread`, then `make
  release-check`. The check compares the cache's `skills/` and `hooks/` with the tree, and it
  resolves the cache via `CLAUDE_CONFIG_DIR`.
- **Two sessions can share one checkout** (a handoff consumer opened in the
  same directory). Every delete-at-close lifecycle here — handoff docs, review
  docs — assumes one writer; a `git rm -f` or a restore in one session lands in
  the other's working tree (the 2026-09-17 review "working-tree incident" is the
  precedent). Check `ListAgents` for a peer in this cwd before deleting or
  restoring anything another session may hold. Since 2.6.0, close's peer guard
  enforces this for consumed docs (§ What's been built, 2026-09-25). Its 24 h
  floor reads the file's mtime, so a pull that rewrites the doc resets it: at the
  2026-09-25 close the 2.6.0 pull made a review doc consumed two days earlier
  read `keep fresh`.
- **The plugin cache stays on the old version until the dance is run.** A
  `/thread:handoff` invoked from a session launched with `--plugin-dir` on this
  repo loads the working-tree text (2.5.0 seen 2026-09-21); an installed-plugin
  session loads the cached 2.4.0 text until the restart.
- Colon namespace (`thread:defer`) requires plugin packaging; skill frontmatter
  carries the bare `name:` and Claude Code composes the prefix.
- `disable-model-invocation: true` hides a skill from the model's list but
  keeps the `/slash` form. No skill here carries it any more (handoff dropped
  it at 2.0.1); `skills/execute/SKILL.md` warns against ever adding one.
- `AskUserQuestion` requires ≥2 options per question — a close destination
  section with a single candidate can't be its own menu question; merge
  single-candidate sections into one combined multiSelect.
- A plugin installed **mid-session** hot-registers member *names* into the
  running session's skill list, but descriptions only index at session start —
  members render bare (`thread:close`) until a fresh session. Files were
  verified well-formed; don't debug this again.
- NotchBar's AgentStatus (Bartender) rewrites the direct `~/.codex/hooks.json`
  on its own schedule, injecting notify handlers tagged
  `# notchbar-agents-codex-hook` into every event (including a `Stop`) and
  flipping `features.codex_hooks` in the direct config only.
  `check-agent-parity.py` treats both as app-managed (carve-out added
  2026-08-12, same precedent as its `node_repl` fields). Codex `hooks.state`
  `trusted_hash` values are Codex-internal — they match no derivable
  serialisation of the hook; never hand-author trust entries.
- **Skill-listing budget silently drops descriptions.** Claude Code caps the
  model-facing skill listing at `skillListingBudgetFraction` (default 0.01 =
  1% of context) with a 1536-char per-description cap; over budget, whole
  descriptions vanish and skills render as bare names — killing their
  natural-language triggering (7 of 13 thread skills were bare pre-fix).
  User settings carry `0.02` since 2026-08-13; keep SKILL.md descriptions
  ~600–700 chars (2.0.2 trimmed execute+gather; `schedule` is the next trim
  candidate). Files can be perfectly valid YAML and still render bare —
  check the budget before debugging frontmatter.
- **Vault filenames must stay NTFS-legal** (no `? * : " < > |`, no trailing
  space/dot, basenames within MAX_PATH) or Obsidian Sync silently refuses
  them on Windows. Capture titles become filenames, so task-writer is a
  producer of this risk (sanitisation task proposed and declined 2026-08-18;
  vault swept clean same day, link-safety verified before each rename).
- **A backgrounded clean-room review does not survive the CLI process
  exiting.** Round 1 of the 2026-09-21 tier-ceiling chain was dispatched
  `run_in_background: true`, the process restarted mid-run, and the task
  notification read "no completion record was found" — no findings, no review
  doc, ~5 minutes of engine time for nothing. fresh-review's never-blocking rule
  ("dispatch, keep working, findings land in `docs/reviews/` if you're gone by
  then") assumes the session outlives the agent. Re-dispatching in the
  background worked twice afterwards, both returning synchronously through the
  wrapper's Skill call. Estate [[K42]] holds the general form.
- **The version-keyed cache no longer governs this plugin — corrected
  2026-09-21.** The old rule (skills execute from
  `~/.claude/plugins/cache/thread/thread/<version>/`; bump both manifests →
  push → `claude plugin marketplace update thread` → `claude plugin update
  thread@thread` → restart) was verified 2026-07-14 shipping 1.0.1 and is kept
  here only so the next reader does not re-derive it from a stale memory.
  Since the marketplace was re-registered as a **`directory` source pointing at
  this repo** (`extraKnownMarketplaces.thread` →
  `{"source":"directory","path":"/Users/lachlants/repos/tools/thread-skill"}`,
  `installLocation` = the repo itself), a session loads the skills from the
  **working tree**. Evidence, 2026-09-21: the newest cache dir anywhere is
  `2.3.4` (there has never been a 2.4.0 or 2.5.0, in either
  `~/.claude/plugins/` or `~/.claude-profiles/animately/plugins/`), that tree's
  `skills/handoff/SKILL.md` has **zero** occurrences of `docs/handoffs`, yet a
  session started at 2.5.0 lists `thread:handoff` with the full durable-doc
  description. So: **a committed change is live in the next session with no
  cache dance at all**, and `claude plugin list` reporting `2.3.4` is stale
  registry metadata from the last explicit update (2026-09-14), not what runs.
  Caveat on scope: what is verified is that the *skill text the model sees*
  comes from the repo. `${CLAUDE_PLUGIN_ROOT}` was not separately probed, so a
  skill that shells out to `${CLAUDE_PLUGIN_ROOT}/scripts/...` may still
  resolve into the 2.3.4 cache — check that before assuming scripts are live.
  Still bump both manifests on a release: the version is the record, and a
  github-sourced install elsewhere would need it.
- **The hazard that correction creates.** The version-keyed cache was an
  accidental safety barrier: nothing shipped until two manifests were bumped
  and the plugin updated. With a directory source there is no barrier, so
  **uncommitted, half-finished edits in this working tree are live in every new
  session across the estate** — a SKILL.md mid-rewrite, a `workflow.js` with a
  syntax error, a prompt with a contradiction. The guard is behavioural: land
  skill edits in one write rather than leaving them open across a break, and
  `git stash` before stepping away from a partial edit. (This is not
  hypothetical — the 2026-09-21 session began with four modified skill files
  sitting in the tree.) Verify a release two ways, not one: the repo tree AND
  `~/.claude/plugins/cache/thread/thread/<version>/`, which `claude plugin
  update thread@thread` still rebuilds and which `${CLAUDE_PLUGIN_ROOT}` may
  resolve to for script paths. **The version-keyed half of the old rule is
  still live, and this is where it bites**: changing content *under an
  already-cached version number* does NOT refresh the cache. Measured
  2026-09-21 — 2.5.0 was cached, four skill files were then fixed and pushed
  still at 2.5.0, and the cache kept serving the defective engine
  (`CAPPED_RETRY_ITERATIONS` absent from the cached copy while the repo had
  it). A content change that matters therefore needs a version BUMP, not just
  a re-run of the update; `diff -rq <cache>/skills skills` is the check.

- **A `cd` into an additional working directory moves the session's primary working directory**; it is
  not reset. Seen 2026-09-23 in a rollout lead (`cd ~/repos/obsidian/...`), where the engine's launch
  tree follows it, and again 2026-09-25 in a plain close session. Any session launched here with the
  vault as an additional directory uses absolute paths and `git -C` for vault work and never `cd`s
  there.
- **Tests that run git must be `GIT_*`-safe.** An exported `GIT_DIR` that points at a linked worktree's
  gitdir reaches the shared refs and config through commondir. On 2026-09-23 this happened with
  `tests/default-branch.test.sh`: its `git init --bare` set `core.bare=true` on the main checkout, its
  commits landed on the shared `master`, and its `git push origin` went to the real GitHub remote. p1-3's
  PR #6 landed on 2026-09-24 (`b52270d`). `tests/run.sh`, `default-branch.test.sh` and
  `handoff-scan.test.sh` now run `unset $(git rev-parse --local-env-vars)`, which is git's own list of 15
  variables. p12-3 scrubs the engine (every rendered git/verifier command, plus a rule in every agent
  prompt), `merge-wave.sh`, `default-branch.sh` and the lead (§ 4's git-env check halts before dispatch).
- **A plan's `### Gated inputs` must be its last section**, until protocol 4 fixes the parser (intake item
  13). `parseGatedInputs` ends the section only at a heading. A `---` and a bullet list after `None` are
  read as declared gates, and the task pauses at `gate-pending` (p4-1, 2026-09-24).
- **The Workflow tool's task output file is a JSON envelope.** The engine's return value is its `result`
  field, a JSON string. A lead extracts it (`json.load(f)["result"]`) into a file before
  `reconcile-wave.py reconcile --result`; the file as a whole is not the result.
- **Implementers may rebase a reused in-flight branch** onto the new base, even though the worktree
  prompt says the reuse arms must not. p1-3's PR #6 branch got new hashes on 2026-09-24. This is
  harmless under squash-merge, and the `pre-push` guard covers only `master`/`main`.
- **This repo has no required checks.** `merge-wave.sh` reports "no required checks" and squash-merges
  anyway. Nothing verifies the combined tree unless the lead re-runs `make test` on the merged base, and
  nothing refuses a stray push to `master`.
- **`make release-check` (p1-1's recipe) is exact, so it is only meaningful right after a release.** It
  was green at 2.6.0 (`3a7b9be`). It fails if anything sits under this checkout's `.claude/worktrees/`
  during the plugin update, or once a file tracked at release time is deleted (the consumed review doc
  this 2026-09-25 close removed). Run it right after `claude plugin update`, on the released commit.
  This file's older release-check descriptions predate p1-1's recipe. At 2.7.0 (`15638b6`) the expected
  stray is the post-rollout handoff doc that the 2.7.0 close deleted.
- **A skill's text is rendered from the tree as it stood when the session started, not at invocation.**
  The directory-source marketplace loads skill text from this working tree. Seen 2026-09-25: after
  `git pull --rebase` brought p2-7 in, `/thread:close` still rendered the 2.6.0 body, with no rung 3 (tool-repo
  threads) and no repo-state step, although the source SKILL.md had both. After a pull or release
  mid-session, read the SKILL.md from source with `sed` (as for the `$N` quirk below), or restart.
  `claude plugin update` also says "Restart to apply changes".
- **Invoking a skill with arguments rewrites `$0`, `$1`, `$2`… in its body.** Claude Code substitutes the
  whitespace-split arguments, 0-based, into the SKILL.md text before the model sees it, and that includes
  shell and awk variables. Seen 2026-09-25 on close's handoff scan (`print $2` read `print <THREAD.md path>`).
  **Fixed in p5-2 (2.7.1, 2026-09-26):** close's handoff scan and repo-track and execute's default-branch
  resolver live in scripts (`handoff-scan.sh`, `repo-track.sh`, `default-branch.sh`) behind thin wrappers.
  Open's repo-thread lookup stays inline, rewritten with no positional parameter, because close reads it
  as a file and a wrapper there would need the plugin root. `tests/contracts/skill-positional-args.test.mjs` fails on any
  dollar-digit in a SKILL.md body. The probe on CLI 2.1.283 showed `$0`–`$2` and `$$1` substituted, `\$1` →
  `$1`, and `${1}` and an out-of-range `$30` left alone. Only the rendered SKILL.md substitutes
  `${CLAUDE_PLUGIN_ROOT}`. Any wrapper or command read from a file instead (a sibling SKILL.md read by
  `/thread:open save` or `/thread:next`, a `_shared` spec, a `sed` copy from source) needs
  `CLAUDE_PLUGIN_ROOT=<root>` in front by hand. That predates p5-2, and review e4fe2a2/a0bb12 #1 and #6
  scope it as its own task. Under this directory-source marketplace the rendered root is the working
  tree, not the version cache.
- **Probing a skill's rendered body headless:** `claude -p "/<skill> <args>" --max-turns 1 --permission-mode
  plan` in a scratch repo. The expanded skill text is not in `--output-format stream-json`. Read it from
  the probe's own transcript, `$CLAUDE_CONFIG_DIR/projects/<cwd-slug>/<session>.jsonl`. `claude -p` warns
  about stdin; add `< /dev/null`.
- **`gh pr edit` fails** on the Projects (classic) GraphQL deprecation (`repository.pullRequest.projectCards`).
  Edit a PR body with `gh api -X PATCH repos/lachyts/thread-skill/pulls/<n> -F body=@<file>`.
- **Self-rollout lessons, 2026-09-23 to 2026-09-25** (protocol 4 intake items 14–17, vault task
  `thread-rollout-v4-intake-2026-09-23-audit`):
  - **`resume-filter` misses archived notes.** The daily sweep moves `done` task notes to
    `Work/Tasks/Archive/`. `resume-filter` looks only in `Work/Tasks/`, prints "note not found …
    including for dispatch", and so listed p2-1 and p3-2, both merged, for re-dispatch. `status`
    resolves the archive. Until it is fixed, check a resume list against `/thread:status` before
    dispatching.
  - **A second `plan-blocked` loses its feedback.** `reconcile` appends `## Plan-blocked feedback` once
    per heading, so a re-dispatched task that blocks again keeps only the first pass (p4-1 on 2026-09-24,
    p2-3 on 2026-09-25). The lead copies the second pass into the note by hand. Vault task
    `thread-skill-plan-blocked-feedback-append-once`.
  - **Attaching the last plan converges a re-dispatch.** A re-dispatch re-plans from scratch. With its
    approved plan added to the note as a reference (and the resolution list moved above
    `### Gated inputs`), p4-1 converged in one plan round. The engine does not do this yet.
  - **The cold-resume flush can merge an unreviewed PR.** Execute § 4.5 *Cold resume* re-runs
    `merge-wave.sh` on the next wave's open PRs. On 2026-09-25 p2-4's PR #16 was open with its review
    round 2 failed, and a literal flush would have merged it unreviewed. Flush only PRs whose note is at
    `status: review`.
  - **A lapsed account comes back as `blocked`.** When the animately account lapsed mid-review ("Your
    organization has disabled Claude subscription access for Claude Code"), the engine returned
    `blocked` with a transient-infrastructure diagnosis. After the move to another account,
    `resumeFromRunId` on the same run replayed the cached stages and re-ran only the failed review.

- **A vault-wide backlink rewrite with plain grep hits Smart Connections' `.smart-env/*.ajson` cache** (and would hit `.obsidian/` and `.trash/`). On 2026-09-27 gather's rename pass rewrote 9 cache files; they were swapped back by exact reverse replacement, but 4 had re-indexed mid-pass. Exclude `.git`, `.obsidian`, `.smart-env` and `.trash`. Gather's step 4 doesn't say so yet.
- **`rg` (and `grep`) in the Claude Code Bash tool are shell functions** wrapping the claude binary, so a Python `subprocess.run(['rg', ...])` fails with `FileNotFoundError`. Use `/usr/bin/grep -rlF` in scripts.
- **`tests/contracts/refs.test.mjs` requires every `ADR NNNN` to resolve in this repo** unless a foreign qualifier precedes it (`Chorus ADR 0043`, `workspaces ADR …`). Citing another repo's ADR bare fails `make test`.
- **fresh-review can only review the session's own repo.** A change made in another repo (for example `~/repos/workspaces`) from a thread-skill session has to be reviewed from a session launched there.

- **The Workflow task-notification display HTML-escapes `<` and `>`** in the result and the re-run args it shows. The args themselves reach the agents unescaped (checked in the integrator's prompt, 2026-10-09), so an `&lt;q&gt;` in the notification is not a transcription error.
- **Integrate-call args must be passed inline.** The Workflow tool has no file input, and a plan-gated task's args (its plan plus review history) run to about 40 KB. Build them with python from the row and `lead-integrate.py plan`, print them in parts of 10 KB or less, and paste them verbatim.
- **`bind-run` records `journalDir` as `<session>/workflows`**, while the transcripts live under `<session>/subagents/workflows/<runId>/`. `fold-journals` still found every call (19 folded, 0 warnings, 2026-10-09).
- **Schedule does not run the self-rollout gate:** a rollout scheduled from the primary checkout gets it as Project root, and execute § 2.6 refuses it at launch. Re-point the note at `~/repos/tools/thread-skill-rollout` and fast-forward that clone ([[thread-skill-schedule-runs-the-self-rollout-gate]]).

- **A landing PR that falls BEHIND master never auto-merges:** the ruleset requires an up-to-date branch, and GitHub does not update it. On 2026-10-17 #156 sat green but BEHIND after #155 merged; `gh api -X PUT repos/<o>/<r>/pulls/<n>/update-branch -f expected_head_sha=<sha>` unblocked it (the installed `gh` has no `pr update-branch`). Pushed-base waits on every queued close/… PR, not just the newest.
- **A Workflow run's args are recorded in `<session>/workflows/<runId>.json`** once it completes: compare them with the built args file to prove a hand-pasted integrate call was verbatim (all five on 2026-10-17 matched).

- **CONTEXT.md phrases are pinned by contract tests** (2026-10-24). `tests/contracts/away-state.test.mjs` asserts exact substrings in the Queue, Trickle and Away entries, such as `**Solo** task and, by day, the **Trickle**, never a shared file` and `**Parallel ceiling** (Chorus ADR 0104 d3)`. A glossary rewrite that drops one fails `make test`, so add new holds as a following sentence rather than rewording the pinned one.
- **`make test` can pass 10 minutes; check its real exit code** (2026-10-24). A background run with a 600 s limit gets killed mid-suite, and `cmd; echo rc=$?` makes the background job report exit 0 even when make failed. End the command with `exit $rc` and read the `make test: ALL PASS` line. A worktree push also leaves no `origin/<branch>` tracking ref, so confirm with `git ls-remote`.
- **A Stage session in a worktree of the clone can't lead its rollout** (2026-10-24). "Lead the thread-skill rollout of 2026-10-21" runs in `~/repos/tools/thread-skill-rollout/.claude/worktrees/stage.lead-…`, and execute § 2.8's launch check exits 3 there. Start the lead in `~/repos/tools/thread-skill-rollout` itself. The Stage side is [[chorus-rollout-lead-starts-in-project-root]].
- **A hold written in a rollout note's prose is invisible to `next`** (2026-10-22). `[[thread-skill-rollout-2026-10-21]]` said "do not start until #202 merges" only in its `## Queue` text. A dry-run `next` reported p29-1 would start at once, and the lead caught the hold only by reading the note and the thread's close-out. Put a hold that must bind where `next` reads it (a `paused:` stamp or a `depends-on`), not only in prose.

## Resume instructions

**From 2026-11-02 (rollout 2026-10-31 complete):** no rollout runs on this repo. Next:
- [[thread-skill-reflect-whether-p33-freed-queued-rollouts]]: did ADR 0064 free [[contacts-admin-rollout-2026-10-29]] and the workspaces rollout?
- [[thread-skill-followup-p33-4-same-root-loser-later-batch]].
- The 2026-10-29 candidates below.

The in-place checkout `~/repos/tools/thread-skill` is still held behind origin/master: the contacts-admin and mac-data-mcp rollouts run on it (ADR 0031), and it catches up when they end.

**From 2026-10-29 (rollout 2026-10-26 complete):** no rollout runs on this repo. Next candidates: the four follow-ups above, `/thread:reflect [[thread-skill-rollout-2026-10-26]]`, and a fresh schedule for P28–P31's open tasks (p31-2 once [[agent-stable-p2-3-writing-lean-tests-skill]] lands).

**From 2026-10-29 (ADR 0058):** check PR #231 merged (`gh pr view 231`); if it is behind again, the daily lander retries it, or run `gh api -X PUT repos/lachyts/thread-skill/pulls/231/update-branch`. Then remove the worktree `~/repos/tools/thread-skill-wt-review-bar`. The live checkout runs the old close rules until the running rollout ends and it fast-forwards. Follow-ups: [[thread-skill-p34-5-review-bar-follow-ups]], [[fresh-review-review-bar-follow-ups]], [[thread-skill-unwatched-readings-in-review]]; p30-2 keeps its second bullet.

**From 2026-10-25 (verify-and-canary follow-ups merged, #213):** done. Items 5 and 3 of that task were not built: re-file them if wanted. p29-2 builds on #213's canary `check` and `Note.save`.

**From 2026-10-24 (re-grill):** #202 is merged. To start P29, run `/thread:schedule thread-skill --regenerate` from `~/repos/tools/thread-skill-rollout`, then execute it. The queue shown on 2026-10-23: p29-1 Solo, then p29-3, -9, -5, -8, -12, then -2, -10, -7, -11, -13, plus carried p28-2 and p27-5. Each P29 note's `depends-on` holds that order. The 5.0.0 engine predates ADRs 0043–0051, so P29 builds them.

**From 2026-10-23:** 5.0.0 is installed. Next: open a session in `~/repos/tools/thread-skill-rollout` (not the Stage session "Lead the thread-skill rollout of 2026-10-21": it runs in a worktree, which execute § 2.8 refuses) and run `/thread:schedule thread-skill --regenerate` to supersede `[[thread-skill-rollout-2026-10-21]]` with the re-grilled P29 set (p29-7…p29-13) on the 5.0.0 engine; the two filed follow-ups ([[thread-skill-5-0-docs-follow-ups]], [[thread-skill-execute-args-refusal-and-slot-followups]]) can join it. Lachy's own: `[notify] ntfy_topic` (after [[ntfy-noise-audit]]) and `verify_slots` in `~/.config/thread/rollouts.toml` are now safe to set. The 2026-10-21 and 2026-10-20 notes below are history.

**From 2026-10-21 (history: #202 merged 2026-10-22):** PR #202 (ADRs 0043–0047) is held, not merged. Its re-grill runs in the Stage session "Re-grill ADRs 0043–0047 (PR #202)", whose brief (`docs/handoffs/2026-10-21-regrill-adrs-0043-0047.md`, now consumed) lists round 2's six design gaps (`docs/reviews/2026-10-21-0fc0723-6a9ac7.md` on the PR branch). The plan: rule the gaps with Lachy, trim the ADRs back to decisions, run a fresh-review round on the trimmed text, and queue the merge once it's clean. `[[thread-skill-rollout-2026-10-21]]` (P29) must not start until #202 merges.

**Now (from 2026-10-20):** no rollout is running on this repo. P24 and P25 are closed; P26 waits on p26-3.
1. [[thread-skill-p26-3-mark-started-arms-the-task-window]] (filed by p26-1): finish P26, or carry it into the release.
2. [[thread-skill-release-after-p24-p25]]: one release with one paid eval run, then `claude plugin update thread@thread` once no rollout runs on the primary checkout (ADR 0031). Until it is installed, the lead runs the 4.0.0 engine, so none of P22–P26 is live.
3. Follow-ups: [[thread-skill-integrate-args-plan-too-large]], [[thread-skill-weekly-reading-reads-serial-chains]], [[workspaces-sweep-integrates-origin-before-push]].
4. `/thread:reflect [[thread-skill-rollout-2026-10-19]]` is on offer; the next weekly Reflection is due 2026-10-24.

## Session log

- 2026-11-02 (close, rollout lead after sign-off): signed off p33-4's gate on Lachy's word; reinstated; resumed the gate-pending call on the signed plan; ran the lead verify (green) and a judge-only Integration; merged #267; ran the completion ceremony (P33 closed, scored, archived, reflect follow-up filed).
- 2026-11-02 (close, rollout lead from 2026-10-31): led [[thread-skill-rollout-2026-10-31]] from a 14-task queue to 13 merged and a sign-off pause; rode three room stops and a Login switch; auto-retried p34-7, p34-8 and p33-4 once each; resumed p34-8 after an OAuth expiry; caught four colliding ADR 0060s (task-note Integration notes, refs rule A) so 0059–0063 landed clean. My slips: zsh word-split a slug list once (nothing written); fixed by an array.
- 2026-10-29 (close, rollout lead from 2026-10-26): drove [[thread-skill-rollout-2026-10-26]] to completion (31/32 merged, p31-2 deferred); ran repair hand-backs on Lachy's answers, signed p27-5's gates (US$15 + US$3), fixed the macOS CI timeout (PR #247: timeout-minutes 40), ran the completion ceremony. My slips: twice passed the PR head instead of `prepare`'s anchor as an integrate `headSha`, and once restarted a signed-gate task without `approvedGates`; both now in Known quirks.
- 2026-10-29 (close, from 2026-10-27): audited the non-converging review loop (PR #65 and 114 estate loops), researched practice, Lachy ruled serious-only; built ADR 0058 across close, land.sh, run_record, reflect and fresh-review; 5 review rounds per repo under the new rule; agents-config #5/#6 merged, thread-skill #231 queued. Found: forked review engines read `docs/reviews/` despite the prompt (filed).
- 2026-10-26 (close, from 2026-10-24): grilled the verify-and-canary follow-ups (items 1, 2, 6, 4; ADR 0053), built them test-first, ran 4 fresh-review rounds (ledger STOP at 3, round 4 on Lachy's word), merged #213 with CI green; task done. My slip: direct test runs leaked 44 lock files into the real state dir, cleaned and fixed.
- 2026-10-24 (close, from 2026-10-22): led `[[thread-skill-rollout-2026-10-21]]` as far as its gates and halted with nothing written, because #202 was still open (the note's own hold). #202 has since merged, but the note still holds the old six tasks, and this Stage session runs in a worktree that § 2.8 refuses, so the regenerate and execute go to a session in the clone. Filed [[chorus-rollout-lead-starts-in-project-root]].
- 2026-10-24 (close, from 2026-10-21): re-grilled #202 into an audit of rollout time; ruled the merge train deferred, ADRs 0048–0051 added, 0043/0045/0046/0047/0050 reshaped; 3 review rounds (wording-only fixes), merged #202; filed P29 re-scope, Chorus, fresh-review and launchd tasks; the P29 regenerate is left for the next session.
- 2026-10-23 (close, from 2026-10-22): reviewed and merged #203 (2 rounds, ledger STOP, root revert), released 5.0.0 (#206, tag, eval $7.50) and installed it; landed #205; filed the args-refusal and 5.0.0 docs follow-ups. My slip: a background wait died on a GitHub network reset and I answered its notification "No response requested" instead of acting, so the install sat a day.

- 2026-10-21: `/fresh-review` of PR #202 (ADRs 0043–0047). Round 1 had 15 findings, fixed in `0fc0723`. Round 2's 15 hit the ledger's STOP (8 were regressions). Lachy held #202 for a re-grill, which was handed to a fresh session (landing PR #204).
- 2026-10-20: executed `[[thread-skill-rollout-2026-10-19]]` from the clone: 10/10 merged (#183–#192) in 20h 46m through one room stop. Phases 24 and 25 closed, P26 left on p26-3; the integrate-args plan-size limit was filed after Lachy ruled `plan: ""` for three integrations.
- 2026-10-19: executed `[[thread-skill-rollout-2026-10-18]]` from the clone: 7/7 merged (#171–#177) in 25h 9m through three room stops and three usage-limit cuts; phases 19 and 23 closed; 4.1.0 release decision filed as [[thread-skill-release-4-1-0]].
- 2026-10-18: signed p19-10 (US$20) so it landed; grilled the overnight spend-gate stall into ADR 0038 (#168); superseded and archived the 10-17 rollout; scheduled P23 + carried p19-5 as `[[thread-skill-rollout-2026-10-18]]` and handed execute to a clone session (#169); archived the 5c5a and redesign evidence.
- 2026-10-17 (evening): executed the P22 rollout from the clone: 9/11 merged (#157–#165) in 7h 16m, phase 22 closed; p19-10 spend gate refused by the standing approval (unpriceable "each"), so the run closed in the sign-off form with p19-10 and p19-5 waiting; landing PR #156 needed an update-branch.
- 2026-10-17: Steer-only orient scheduled `[[thread-skill-rollout-2026-10-17]]` (11 tasks: P22, reflect-cites, the P19 eval tail), respecced p19-5 for 4.0.0 (close/handoff/reflect, in-task `--runs 3` comparison), waited out landing PR #154 for pushed-base, handed execute to a clone session (#155).
- 2026-10-16: P21 rollout executed unattended from the clone: 7/7 merged (#144–#150) in 8h 47m; 3 auto-retries, 1 standing approval, 2 integrator conflict merges, 1 macOS CI flake rerun; rollout archived, first-live-Reflection task filed; installed plugin still pre-P21.
- 2026-10-15: #139 fixed and merged; P21 scheduled (+p21-9 split) and executing overnight from the clone; p15-7 landed in agents-config #1 by an orient child (review pending).
- 2026-10-15 (close, later): `/thread:orient` on the Retro, then a grill-with-docs: ADR 0037 + CONTEXT.md terms (#139), P21 phase and 8 tasks, p19-12 merged into p21-1, p15-7 raised, [[chorus-reflect-cadence]] filed; scheduling handed off (#140, consumed by its successor).
- 2026-10-15 (close): released and installed 3.1.0 (#136, tag `thread--v3.1.0`) from handoff `2026-10-15-release-p18-p20` (withdrawn by #137); evals $8.24, Haiku judge found; review ledger STOP at round 2 → record cut to facts; filed make-evals-on-opus and the 3.1 ADR sweep. Memory: release-pr-scope updated.
- 2026-10-13: 3.0.0 live E2E recorded (15 PASS / 1 KNOWN / 1 FAIL over 17 rows, PR #115); three findings filed; fixtures removed; P13 interim rule retired, p13-4 and P13 closed.
- 2026-10-13 (close): `/thread:orient Thread Skill` — drift closed P12/P14; reshuffle wrote P18 (unattended) and P19 (coherence), closed P3/4/5/8/9 into P19, dropped three; grill → ADRs 0034/0035 (#112, merged); installed 3.0.0 (p13-4 steps 1–3); handed the E2E off (#113).
- 2026-10-10 (close): fixed the load-flaky timing tests (#109) and schedule's self-rollout gate (#108, `--resolve`), both after ledger STOPs, reverted to root plus `/simplify`; closed #107 into a design task; Retro of the 10-09 rollout (no proposals); `make evals` ($4.60, 16/18) and released 3.0.0 (#110, tag `thread--v3.0.0`), held from install by two rollouts on the primary. Memory: release-pr-scope.
- 2026-10-09 (close): executed `[[thread-skill-rollout-2026-10-09]]` to 9/9 (#97 to #105, 11h 6m, Opus) from the rollout clone, after the self-rollout gate refused the live checkout as Project root. Load-flaky `make test` (12a) forced three integrate calls; p16-1 (an Integration rejection against #97) and p16-5 (a plan-block) were handed back by the lead and converged. P16 and P17 closed; three follow-ons filed; METHOD K120.
- 2026-10-09: orient reshuffle — P17 (queue fixes from live runs) formed, p12-13/p14-7 closed, p15-6 absorbs the live-record Retro, 3.0 gated after P16; thread-skill-rollout-2026-10-09 scheduled (P16+P17, 9 tasks); p16-2 landed in claude-workspaces PR #4; handed off to a fresh execute session.

- 2026-10-06 (close): executed `[[thread-skill-rollout-2026-10-04]]` to 5/5 (#89 to #93, 17h 39m, Opus lock); p15-2 plan-blocked once and converged after a hand-back. About 12h of the run was an overnight stall on the lead's own AskUserQuestion. Grilled it into P16 (unattended rollouts, p16-1 to p16-5 filed). Created the events symlink; fast-forwarded the primary to `1c5c3ca` mid-way through a Chorus run (a hold breach, in Known quirks). Memory: `wave-repair-autonomy` updated; METHOD K118.
- 2026-10-04 (close, from the clone): consumed the schedule handoff; Steer-only orient scheduled p13-1..3 + p14-2..6, p14-8 as one queue rollout and executed it to 9/9 (#77 to #85, 8h 10m, Opus lock). p14-4 and p14-6 plan-blocked at 3; Lachy raised both to 6 rounds through repair, and both converged. Updated peer PR #76 so #75/#76 merged. Filed the land.sh review-doc gap.
- 2026-10-03 (third close): `/thread:orient Thread Skill` reshuffle with Lachy (Chorus first, P13 after it, P14 filed). Built and merged PR #73 (CI flakes; ledger STOP → root rethink: content-only landed check; 20/20 Ubuntu) and PR #72 (ADR 0031 primary-checkout hold; ledger STOP → Verify). Cut-over: Chorus soft-paused, checkout `04d1739` → `0b60690`, reinstated; the guard holds live. Handed off scheduling to the clone.
- 2026-10-03 (second close): Lachy's plan: he re-orients GifLab himself (restructure, new queue rollout) as p12-13's acceptance; Thread's next is a Thread Skill reshuffle that refreshes P13 against what P12 landed and sorts the follow-ups, flake first.
- 2026-10-03 (close): consumed the P12 handoff; Steer-only orient scheduled P12 as a 10-wave rollout and executed it to completion (#56–#69, 53h 19m). Plan-blocks fixed by the interim rule and the `xhigh` start rung; a 13 h overnight stall on a bypass-immune `rm` ask fixed estate-wide by `check-dangerous-rm.sh`; an Ubuntu CI flake filed. Live checkout fast-forwarded: the queue is live. Memory: bypass-immune `rm`.
- 2026-09-30 (night close): `/thread:orient Thread Skill` reshuffle with grill-with-docs. Answered PR #53's round-2 findings at decision level (`5d4404e`), ran round 3 as `/fresh-review simplify` (28 findings), grilled its nine design calls (merge `main` in, never force-push; lead-run clean Integration; a rejection releases the lane; re-verify only when `main` moved; named rungs; best-effort file lists), slimmed both ADRs and the glossary (`6bac013`), and merged #53 at `df32531`. Researched Fable 5.1 vs Opus 5.5 (no clear step-up; blind A/B filed). Vault: p8-2 and p8-4 moved into P12, P12 and P13 notes respecced. Handed P12's scheduling to a fresh session.
- 2026-09-30 (evening close): PR #53 held after review round 2 (ledger STOP, 9 of 15 findings cite round 1's fixes). Before that: consumed the Chorus-orient handoff. Grilled ADR 0030 (queue, integration, lead-run merge queue, Solo, order, cursor, soft pause, migrate and delete waves) and rewrote ADR 0029 as the operator's ladder file. A scoped orient phased the build as P12 and P13 and retired P6 (protocol 4) and P7. Spike p12-1 proved concurrent Workflow calls. PR #53. My slip: during the spike I typed a fake completion notification and flagged it at once. The write-up uses only real results.
- 2026-09-29/30 (close): grilled landing with Lachy → ADR 0028 (agents land their own work; landing register), amended to queue-and-finish after p11-3's waiting design didn't converge. Orient-reshuffled it into P11; rollout `thread-skill-rollout-2026-09-29` merged #43, #44, #46–#49 in 8h 17m. Released 2.11.0 (#50), tagged. Seeded the landing register (p11-2). Memories: admin happens autonomously; laptop sleeps overnight. First close to land its own close-out via `land.sh`.
- 2026-09-28 (late afternoon close): consumed the p10-4-p9-4-rollout handoff. Scheduled and ran `[[thread-skill-rollout-2026-09-28]]` (p10-4, p9-4, reconcile-apply-binds joined): #37, #38, #39 merged in 1h 31m. p10-4 plan-blocked in wave 1 and was re-waved behind p9-4 (Lachy's call). Phase 10 closed. Released 2.10.0 (#40), tagged. Filed the re-wave follow-up. Handoff doc deleted.
- 2026-09-28 (evening close): grilled ADR 0027 with Lachy (orient is the one shaping verb; split and gather retired), built it (#32), three clean-room review rounds with a ledger stop and a revert to the root, full eval suite run and recorded, released 2.9.0 (#33), landed the P10 session's close-out (#34), pushed workspaces and ~/.agents, cleaned the merged worktree and branches. Follow-ups filed: schedule owns one-live-rollout-per-repo; one vault grammar.
- 2026-09-28 (close): consumed the p10-release-and-acceptance handoff. Merged #29 (close-out) and #30 (2.8.0 bump). Plugin updated, release-check green, tag `thread--v2.8.0` at `c5f7522`, set-head done. Reconcile live acceptance: the dry run matched the audit; `--apply` wrote 5 (2 reviewed, plus 3 landed meanwhile by a live Chorus rollout), all kept, and the follow-up was filed. #31 merged meanwhile, unblocking p10-3/p10-4/p9-4. Handoff doc deleted.
- 2026-09-27 (late evening, second close): handed off the next pieces (land the close-out branch, P10 release, live acceptance, next rollout) as `docs/handoffs/2026-09-27-p10-release-and-acceptance.md` on `docs/close-2026-09-27-p10-rollout`. The clone was left on that branch so the doc's path resolves.
- 2026-09-27 (late evening close): rollout lead for `[[thread-skill-rollout-2026-09-27]]`. Wave 1 (#25, #27) and wave 2 (#28) merged in 2h 9m. The ceremony ran #28's new phase-close step (phase 10 left open) and filed two follow-ons, live acceptance and release. The rollout note was archived (vault `b2a6137b`). This close is on branch `docs/close-2026-09-27-p10-rollout`.
- 2026-09-27 (evening close): `/thread:orient` → research (Chorus drift audit; compact vs handoff; is a tripwire worth it) → `/thread:gather` with grill-with-docs → P9 respec + P10, ADR 0026 (#24) → `/thread:schedule` P10 wave 1–2 → p9-1 done (hook deleted, `ctx %` statusline, memory superseded). Lachy launched the rollout from the clone.
- 2026-09-27 (close): p5-2 on PR #23 (2.7.1). Snippets moved to scripts, the lookup was kept inline without `$N`, and the no-positional contract was added. Live probe clean on CLI 2.1.283. Two fresh-review rounds; the round-2 ledger STOP led to a revert to the root. Consumed handoff doc and four consumed review docs deleted.
- 2026-09-26 (close): handed p5-2 to a fresh session (consumed and in flight on `p5-2/snippets-to-scripts`). The GTD next-action grill went to ops-workspace. THREAD.md was left uncommitted because this shared checkout sits on the peer's branch; its close carries it.
- 2026-09-26: orient → gather (grill-with-docs) → P5–P9, ADRs 0024/0025, CONTEXT.md Top tier and Capture. The GTD next-action grill was handed off to ops-workspace. p5-1: repo public, CI (#21), rulesets, and two fresh-review rounds (56679f6/ad8453, d2b36d6/b59fd7). Round 2 was mostly round 1's fixes, so the stop rule fired: the ADR 0024 mechanics were reverted to open questions on p7-1 rather than patched a third time (#22).
- 2026-09-25 (evening): picked up the post-rollout handoff. Rebased this checkout onto `393829c` (`--autostash`; `--ff-only` was impossible with `42360be` unpushed), and `make test` was ALL PASS. Released 2.7.0 (`15638b6`, pushed, plugin updated, release-check green). The close deleted the consumed handoff doc, filed four rollout follow-ups, added two protocol 4 intake items and the render-at-session-start quirk.
- 2026-09-25 (later): prepared the 2.7 rollout. Pushed `d59bcb3`. Tidied the clone: removed p2-4's merged worktree and branch, fast-forwarded to `d59bcb3`, and `make test` is ALL PASS. Locked Opus 5.5 as the top tier in `~/.agents/AGENTS.md` (`10ceaf6`); the 2026-09-23 rule had lived only in memories this session never loaded. Wrote the lead prompt into Resume. A bare `/thread:close` confirmed that the `$N` quirk needs arguments.
- 2026-09-25 (afternoon): close-out after the 2.6.0 release (`3a7b9be`, release-check green). Folded in the uncommitted 2026-09-25 resume edit, rewrote Where we are and Resume to the finished state, moved the peer-guard question to decided (p2-4), added the five rollout lessons (intake items 14–17) and the skill-argument `$N` quirk to Known quirks, and deleted the consumed 2.5.2 simplify review doc. Remaining: p2-6, p2-7, p3-1, p3-3, p4-5 and seven follow-up tasks.
- 2026-09-25 (morning to midday): self-rollout lead `execute-2026-09-25-a809daf4`. p4-1 converged with its last plan attached (#10). Waves 4–5 merged (#11–#15). p2-3 plan-blocked twice, and Lachy's decisions deferred and split it (p2-6, p2-7), so wave 6 closed empty. Wave 7's p2-4 (#16) survived an account lapse via `resumeFromRunId`. Completed 37h 22m after dispatch.
- 2026-09-24 (morning): self-rollout resume lead (unattended, `execute-2026-09-24-a91d0c16`). Finished wave 2: #7 (p3-4) and #6 (p1-3, the test-side `GIT_*` scrub). Merged #8 (p3-2) and #9 (p2-1) in wave 3, leaving `master` at `d85a3c7`, green. p4-1 was plan-blocked, re-dispatched, then came back with 23 phantom gates (the parser reads past `---`, intake item 13). The lead halted for Lachy, who withdrew the gates on 2026-09-25. Cursor 2/7, 8 tasks left.
- 2026-09-24: self-rollout lead (unattended). Step 0 done (zz-thread-e2e removed). Wave 1 merged 5/5 (#1–#5), and the combined tree was green. Wave 2 halted: a p1-3 agent's `GIT_DIR` experiment leaked fixture commits onto GitHub master and pushed a stray `origin/main`. p1-3 is gate-pending on the repair, p3-1 is plan-blocked, and p3-4 is approved and held. The cleanup decision is Lachy's.
- 2026-09-23 (later): E2E setup. Checklist § 0 is done: fixture repo and GitHub repo, the vault fixture, and the leak baseline. A `cd` outside the launch directory gets reset, so S1 split into this setup session and a verbs session launched in the fixture (Lachy's ruling). § 5 records the stray worktree copy in the plugin caches. The cd quirk is corrected.
- 2026-09-23: /thread:orient audit. Shipped 2.5.2 (make test, the contract floor, args.defaultBranch; one source for the base after the ledger STOP) and 2.5.3 (execute names the read-only agents). Wrote the E2E checklist, the rollout brief and the S1 handoff. Engine defects held for protocol 4. Stale 2.3.4 install left pending (settings symlink hazard).
- 2026-09-22: Closed only thread 2 and saved its Claude-pilot agreement/status/evidence handback; thread 1 now leads, thread 3 and Claude continue independently, rollout redesign remains open.
- 2026-09-21 (latest): consumed the stale 2026-09-17 tier-ceiling review and two further clean-room rounds (12 + 15 findings); round 1 lost to a CLI restart; round 3 hit the ledger's STOP at 60% regressions, so no round 4 — reverted to the root instead (retry budget is now a constant, not arithmetic over max_iterations). Two real engine defects fixed (effort keyed off a lagging event flag; a 1-iteration retry loop at the template default), ADR 0016 §2 amended, Scenarios F and G added, 191 assertions. Shipped 2.5.1 and verified the cache byte-identical — the version-keyed cache is still live and a same-version content change does NOT refresh it. Two findings deferred to § Open questions + vault tasks.
- 2026-09-21 (later): handed the leftovers off via the first ADR 0017 doc; the consumer consumed the 2026-09-17 round-2 review (af0094f) and left its four-file fix batch uncommitted, no close; this close deleted the consumed handoff doc + the two consumed 2026-09-21 review docs; concurrent-checkout hazard logged (open question + estate METHOD row); ship still pending the cache dance.
- 2026-09-21: 2.5.0 — durable handoff lifecycle in `thread:handoff` (docs/handoffs, never temp; pending→consumed→deleted) + close's handoff-owns-the-continuation rule (ADR 0017 amends 0011); `thread:open` handoff-doc pickup; two xhigh rounds consumed, K27 stop, rig-gated; hook + Codex stub aligned; manifests 2.5.0. Ship pending: push → marketplace update → plugin update → restart.
- 2026-09-01: 2.3.1 — phantom-gate footnote fix (ADR 0013): parseGatedInputs reads only list items ("- "/"* "/"+ "/numbered), prose in "### Gated inputs" is commentary; a section with no items and no "None" fails closed to plan-blocked (self-healing re-plan, same door as missing); planner/judge/reviser prompts hardened to bullets-only. Live trigger: chorus-rollout wave 2's planner footnote paused a fully signed-off task at gate-pending. Prompt bytes changed — in-flight resume caches re-run (clean, not corrupt). Shipped through the cache; restart applies.
- 2026-08-31: 2.2.1 — docs-only patch shipping the 2026-08-30 doc-audit remediation through the cache (0ee53f6): repair's model-facing description now matches the ADR 0009 glossary (engine, not wave, holds merge authority); THREAD.md resume instructions point at all of docs/adr/; build-plan.md stamped historical.
- 2026-08-29: 2.2.0 — close de-gated (ADR 0011): menu only for vault tasks; four-verb save-time triage + provisional/provenance frontmatter; weekly memory-curator system + daily recall harvest built on the workspaces side; /memory-triage retired; doctrine pointers repaired; ">4 sections" dead prose deleted (open-question nit resolved). Curator dry-run clean (byte-identical restore) → 7 spec fixes; inaugural live launchd run OK (archived 1 · merged 2 · demoted 3 · 47 index lines repaired; decay correctly gated by legacy grace) after one exit-127 fix (launchd PATH omits ~/.local/bin — runner resolves CLAUDE_BIN). 2.2.0 shipped through the cache; restart applies.
- 2026-08-18: Windows scope grilled down to a next/close/orient minimal footprint (plugin + synced vault; personal-config transport killed; no workspaces clone; no fork; no machine.json); docs/windows-setup.md added then slimmed; wave-skill local clone deleted (archived tombstone kept); vault NTFS-filename sweep (11 renames, 18 wikilinks updated); 2.1.0 shipped through the cache (restart applies); Windows install in flight.
- 2026-08-14 (later): 2.1.0 — orient self-launches its batches via `cmux workspace create` (ADR 0010: steering answer = sole authorisation, emission = no-cmux fallback); rulings grilled off the SEO orient paste-hand-off challenge; live-proven by firing the SEO p4/p5 batches (workspaces 38/39); wave-repair-autonomy memory generalised. Ship pending: cache dance + restart.
- 2026-08-14: 2.0.3 shipped — review-loop memory (accumulated feedback with anti-regression framing, anti-goalpost judge discipline, step-back round at 2 rejections, ceiling outcomes persisted to the note); grilled 4 design forks via grill-with-docs; all suites green; capture task done.
- 2026-08-13: 2.0.1 (handoff visible, intent-gated) + 2.0.2 (description trims) shipped; skill-listing budget discovered + bumped to 0.02; giflab rollout landed 6/6 through the merged plugin (first orient→engine loop); Ralph-loop audit → review-loop-memory + package-init-blindness tasks filed.
- 2026-08-12 (merge-day follow-up): merge-day parity follow-up — the 4 reported checker errors (plus 10 same-day drift) diagnosed to NotchBar's Codex hook injection + hardlink/mode drift; checker gained the NotchBar app-managed carve-out, add.md fan-out re-linked, PASS restored. Follow-up: [[notchbar-codex-hooks-follow-up]].
- 2026-07-14: Notion retired ecosystem-wide — handoff destination deleted from close, workspaces + Codex adapter swept, migration task + global memory captured, v1.0.1 shipped (found: plugin cache is version-keyed).
- 2026-07-14 (later): installed as thread@thread + references migrated + vault project note; first live close ran from the plugin itself; verification task scheduled for 2026-07-15.
- 2026-07-14: thread created — v1.0.0 built end-to-end from approved plan.
