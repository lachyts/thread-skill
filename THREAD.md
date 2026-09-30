---
slug: thread-skill
created: 2026-07-14
last_touched: 2026-09-30
state: active
scope: Build + maintain the thread:* plugin — continuity verbs + the wave rollout engine (one system, two lanes)
---

# thread-skill — THREAD

## Where we are

**2026-09-30: waves are being retired. ADR 0030 (a rollout is a queue that integrates at merge) and ADR 0029 (escalation climbs the operator's ladder) are written, and the build is phased as P12 and P13. Protocol 4 (P6) and P7 are retired. Docs PR #53 is landing; nothing is running.**
- **Grill** (handoff from the Chorus orient, then Lachy's "can't we just run tasks in parallel in worktrees and merge after?"):
  - **Waves dropped outright.** Order comes from `depends-on:` plus a **Solo** flag; shared files only shape queue order.
  - **Integration.** One task at a time: rebase, a top-rung integrator, the full verifier, a re-review when the integrator wrote code or a landed PR shares a file, the full review loop, set aside when stuck.
  - **The lead runs the queue.** Execute's lead runs it as per-task Workflow calls and stays the only merger.
  - **Order and state.** Order is priority, then least overlap. The cursor is the task notes. A soft pause drains. GifLab's and Chorus's wave rollouts migrate.
  - **ADR 0029 rewritten** at Lachy's ask ("a settings file for the effort step-up and the model tree; max isn't effective on Opus 5.5"). One `~/.config/thread/ladder.toml` of rungs (model plus efforts). Escalation climbs one rung per stage; a task may start on a higher rung (`rung: N`). It replaces the EFFORT matrix, ADR 0024's `top-tier` file and per-task `effort:`. Lachy's ladder is Opus high, then Opus xhigh, with no max.
- **Orient (scoped) found protocol 4** (`codex/thread-rollout-redesign`, 36 ahead and 171 behind, idle since 09-23). Its ADRs 0019 and 0021 cover the same ground; 0021 climbs to max before changing model. Lachy chose to **build on master and retire P6**. Its standalone fixes moved into P12. P7 merged into P13.
- **Spike p12-1 passed.** Three Workflow calls ran at once in one session, one of them in a worktree passed in args (`docs/spikes/2026-09-30-concurrent-workflow-calls.md`). ADR 0030 decision 4 is verified.
- **PR #53** (`docs/adr-0029-0030-queue-and-ladder`): ADRs 0029 and 0030, CONTEXT.md (Queue, Solo, Integration, Ladder, Rung, Top rung, Starting rung; Tier, Top tier, Ceiling, Step-up and Wave retired) and the spike doc. Landed by this close.
- **Parked until the queue lands:** `[[chorus-rollout-2026-09-30]]` (53 tasks, all stamped `effort: high`) and `[[giflab-rollout-2026-09-23]]` (wave 1's PRs #111–#114 at `review` since 09-23).

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
- **Review:** xhigh ×2 then simplify. Round 2's ledger stopped the chain (10 of 15 findings were round 1's rollout-lifecycle machinery: auto-pause, Pause-and-hand-off, a cross-project schedule gate). Reverted to the root: orient supersedes only a **paused** rollout whose unlanded tasks are all open; anything else waits, a stuck one goes to repair. Deferred: [[thread-skill-schedule-owns-one-live-rollout-per-repo]], [[thread-skill-one-vault-grammar-for-reconcile-and-reshuffle]].
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

- **ADR 0030 (2026-09-30, PR #53, proposed, build = P12): a rollout is a queue that integrates at merge.** Waves are dropped with no opt-in mode. Same-file tasks run in parallel. Integration runs serially before each merge; every re-review uses real diffs. Solo tasks run alone. The lead runs per-task Workflow calls plus one integration call, and the Workflow script never merges. The cursor is the task notes; `ROLLOUT-STATUS` replaces `WAVE-STATUS`; `protocol_version` goes to 5 (4 was protocol 4's). Supersedes protocol 4's 0019.
- **ADR 0029 (2026-09-30, PR #53, proposed, build = P13): escalation climbs the operator's ladder.** `~/.config/thread/ladder.toml` rungs (model, effort, judge, review); climb once per stage; `rung: N` start; integration on the top rung; the ladder is read at each task's start. The built-in default is today's behaviour. Supersedes ADR 0024's `top-tier` file and protocol 4's 0021; absorbs p7-1's first two questions.
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

## Open questions / decisions pending

- **The daily lander (p11-7) doesn't exist yet.** Until it does, a queued merge that fails (red CI, a PR left behind master, `queued: needs merge`) waits for the next close in that repo. It has to catch up on wake: the laptop is often off overnight until the Mac mini arrives.
- **Loose end from P11:** [[thread-skill-land-pr-body-names-its-caller]] (a handoff's landing PR body says `thread:close`). The autostash fix is now in [[thread-skill-p12-7-merge-one-integrated-pr]].
- **AGENTS.md still says reviews never block** (p11-8): landing's review runs inline. Lachy's file, so the wording needs his approval.
- **Decided in task specs, not grilled** (2026-09-30, flag if wrong):
  - `--gated` becomes a human pause before each merge, and single-wave mode goes (p12-9).
  - A rebase or merge-from-main is the integrator's plan-time choice (p12-6).
  - `protocol_version: 5` (p12-10).
- **Open from ADR 0029:** how a block at the top rung is triaged. This is p7-1's third question, carried into [[thread-skill-p13-1-ladder-file]].
- **Untested:** five Workflow calls at once (the ceiling of 4 plus integration). The spike ran three; p12-13 should confirm five.
- **The fresh-review of workspaces `29ca886` (the hook deletion) hasn't run.** The engine binds to the session's cwd, and this session was in thread-skill. It needs a session launched in `~/repos/workspaces`.
- **The one-live-rollout rule is orient-only** (ADR 0027): `/thread:schedule` run directly can still write a second rollout on a repo or `--regenerate` over a running one. [[thread-skill-schedule-owns-one-live-rollout-per-repo]] moves it into schedule's gate; its note lists why round 1's attempt was reverted.
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

## Known quirks (don't re-derive)

- **One session can hold several Workflow calls in flight** (spike 2026-09-30). Each completion is its own notification, and an agent can work in a worktree path passed in `args`. The floor is about 36k subagent tokens per call. Workflow scripts can't touch files or the clock, so anything vault-side (reconcile, pause, landing-register checks) must stay in the lead.
- **Schedule reads dependencies from frontmatter `depends-on:`/`blocked-by:` only;** body phrases are surfaced for confirmation. A task can link a merged-away note in its body ("Carries [[…]]") without creating a dependency.
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
  variables. The engine-side scrub for the verifier and agents is still protocol 4.
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

## Resume instructions

**Now (from 2026-09-30, evening): build the queue.**
1. **Land the docs.** PR #53 (ADRs 0029 and 0030, CONTEXT, spike) is landed by this close's own-branch loop; check it merged.
2. **Schedule P12.** From a session in this repo on a clean `master`, run a Steer-only `/thread:orient Thread Skill`. It schedules P12's wave-shaped tasks (p12-2 to p12-12) with `--tasks`; then `/thread:execute`. They run on the old wave engine, which serialises them on `wave-execute.workflow.js` and `execute/SKILL.md`; that's expected.
3. **Then:** p12-13 (the GifLab run on the queue, session lane), P13, and the 3.0.0 release (p13-4), which unparks Chorus.
4. **The p11-7 slot** (the daily lander) still stands as the project's next action; the queue build is the higher-value proposal against it.

**Now (from 2026-09-30): 2.11.0 is live: close and handoff land their own work (ADR 0028). Nothing is running, no handoff is pending, and both checkouts are on `master`.**
- **Next:** [[thread-skill-p11-7-the-daily-lander]], the last structural piece of P11. Build it as a session (launchd plus a live headless probe), and design it to catch up on wake.
- **Then, any order:** [[thread-skill-p11-8-agents-md-landing-review]] (show Lachy the wording first); [[thread-skill-merge-wave-no-autostash]] and [[thread-skill-land-pr-body-names-its-caller]] (small, wave-shaped); the ADR 0027 follow-ups ([[thread-skill-schedule-owns-one-live-rollout-per-repo]], [[thread-skill-one-vault-grammar-for-reconcile-and-reshuffle]]); [[thread-skill-p4-5-trim-descriptions-700-hard-cap]]; [[thread-skill-rewave-a-blocked-task-within-its-rollout]]; phase 9's p9-2 and p9-3.
- **Still owed:** the fresh-review of workspaces `29ca886`; tags 2.7.1 at `e5903f5` and 2.9.0 at `43ff855`.
- **Close-outs now land themselves** (queued `landing` PR, auto-merge). Run a thread-skill rollout from this clone on a clean `master`.

**Superseded 2026-09-30:**
**Now (from 2026-09-28, late afternoon): 2.10.0 is live. Nothing is running, no handoff is pending, and both checkouts are on `master` (after this close-out's PR merges, fast-forward the clone).**
- **Next** (pick one; nothing is decided):
  1. [[thread-skill-schedule-owns-one-live-rollout-per-repo]] and [[thread-skill-one-vault-grammar-for-reconcile-and-reshuffle]], the ADR 0027 follow-ups (the second edits `reconcile-project.py`).
  2. [[thread-skill-p4-5-trim-descriptions-700-hard-cap]] (its p4-6 baseline exists).
  3. [[thread-skill-rewave-a-blocked-task-within-its-rollout]].
  4. Phase 9's rest: p9-2 (capture marker), p9-3 (open list prunes, close guard).
  5. Still owed: the fresh-review of workspaces `29ca886` (a session in `~/repos/workspaces`); tags 2.7.1 at `e5903f5` and 2.9.0 at `43ff855`.
- **Close-outs still go on a branch and a PR.** Run a thread-skill rollout from this clone on a clean `master`.

**Superseded 2026-09-28 (late afternoon; the p10-4-p9-4-rollout handoff it pointed at is consumed and deleted):**
**Now (from 2026-09-28, evening): 2.9.0 is live (orient's reshuffle, set-down next actions). Nothing is running and no handoff is pending. Both checkouts are on `master`.**
- **Next:**
  1. The next rollout: `/thread:schedule` on [[thread-skill-p10-4-close-flips-a-finished-task]] and p9-4, from the rollout clone (p10-3 landed in #32). Consider [[thread-skill-reconcile-apply-binds-reviewed-list]] with them. Phase 10 closes itself when p10-4 lands.
  2. p4-6's eval baseline now exists (`docs/evals/2026-09-28-orient-reshuffle.md`), so [[thread-skill-p4-5-trim-descriptions-700-hard-cap]] can be scheduled.
  3. The two ADR 0027 follow-ups: [[thread-skill-schedule-owns-one-live-rollout-per-repo]], [[thread-skill-one-vault-grammar-for-reconcile-and-reshuffle]].
  4. Still owed: the fresh-review of workspaces `29ca886` (a session in `~/repos/workspaces`); tag 2.7.1 at `e5903f5` and 2.9.0 at `43ff855` (`claude plugin tag` tags HEAD, so from a clean checkout sitting on that commit).
- **Close-outs still go on a branch and a PR** (master is protected, strict: a PR behind master must be updated before it merges).

**Superseded 2026-09-28 (evening):**
**Now (from 2026-09-28): 2.8.0 is released and tagged, and the reconcile step is accepted. Nothing is running.**
- **First:** push this close-out branch, `docs/close-2026-09-28-p10-release`, in `~/repos/tools/thread-skill-rollout`, and open its PR (master is protected; p5-4). After it merges, switch that clone back to `master` and fast-forward it, so the next rollout's `merge-wave.sh` can fast-forward.
- **Next:**
  1. The next rollout: `/thread:schedule` on [[thread-skill-p10-3-orient-reports-and-fixes-drift]], [[thread-skill-p10-4-close-flips-a-finished-task]] and p9-4 together, from the rollout clone. #31 unblocked them. First check that `feat/orient-reshuffle` doesn't overlap p10-3. Phase 10 closes itself when they land.
  2. Consider [[thread-skill-reconcile-apply-binds-reviewed-list]] alongside them. It touches the same script and orient's use of it.
  3. Release again after the rollout: #31 is on master and unreleased (manifests still say 2.8.0).
  4. Still owed: the fresh-review of workspaces `29ca886` (a session in `~/repos/workspaces`). Tag 2.7.1 at `e5903f5` if you want the history complete.

**Superseded 2026-09-28 (the handoff it pointed at is consumed and deleted):**
**Now (from 2026-09-27, late evening): the P10 rollout is done and archived. Nothing is running.**
- **Next:**
  1. Release P10: [[thread-skill-release-reconcile-step]]. Fast-forward the live checkout, bump the manifests by PR, update the plugin, then run `make release-check`.
  2. [[thread-skill-reconcile-step-live-acceptance]]: check the Chorus dry run against the drift audit, then decide on `--apply`.
  3. Land `feat/next-action-set-downs`, then schedule p10-3, p10-4 and p9-4 together.
  4. Still owed: the fresh-review of workspaces `29ca886`; tag 2.7.1; `git remote set-head origin --auto`.
- **This close is unpushed branch `docs/close-2026-09-27-p10-rollout`** in `~/repos/tools/thread-skill-rollout` (master is protected; p5-4). Push it and open a PR, or fold it into the release PR.

**Superseded 2026-09-27 (late evening):**
**Now (from 2026-09-27, evening): P10's first rollout is running from the clone. This checkout has nothing in flight.**
- **Rollout:** `[[thread-skill-rollout-2026-09-27]]` is conducted from `~/repos/tools/thread-skill-rollout`. Check it with `/thread:status [[thread-skill-rollout-2026-09-27]]`. Its completion ceremony lists the follow-ups (schedule p10-3/p10-4, a live reconcile dry run, a release).
- **Next:**
  1. The fresh-review of workspaces `29ca886`, from a session in `~/repos/workspaces`.
  2. Land `feat/next-action-set-downs` (consume its review handoff).
  3. Schedule p10-3, p10-4 and p9-4 as the next rollout.
  4. Still owed from p5-2: tag 2.7.1 and run `git remote set-head origin --auto` here.
- **Close-outs go on a branch** until p5-4 lands (this close is `docs/close-2026-09-27`).

**Now (from 2026-09-27): p5-2 is merged (#23, `e5903f5`) and 2.7.1 is live.** The cache was refreshed and
`make release-check` is green on `e5903f5`. A same-version refresh needs `rm -rf` of the version dir and then
`claude plugin install thread@thread`; `update` says "already at the latest version" and copies nothing.
Still to do: tag 2.7.1 (`git fetch origin && git switch --detach origin/master && claude plugin tag --push`),
and run `git remote set-head origin --auto` once here. Next: p5-3 (retire the rollout clone, a session),
p5-4 (close and handoff on a protected default branch), then P6. This paragraph is an uncommitted edit on
master; the next close's PR carries it (the p5-4 problem).

**Now (from 2026-09-26): work the P5–P9 roadmap. Master is protected, and nothing is running.**
- **Order:** P5: p5-2 (`$N` snippets into scripts, wave-shaped), p5-3 (retire the rollout clone, a session),
  p5-4 (close and handoff on a protected default branch). Then P6 (p6-1 integrates protocol 4 first,
  alone), then P7 and P8. P9 can run any time. p4-6 (the eval baseline, your spend) precedes p4-5.
- **Every change lands by PR** (ADR 0025), including THREAD.md close-outs. A thread-skill self-rollout still
  runs from a fresh clone of the repo, never this checkout.

**Superseded 2026-09-26 (kept for the record):**
**Now (from 2026-09-25, evening): 2.7.0 is released. Nothing is running and no handoff doc is pending.**
- **Order** (the rest of the 2.7 plan, unchanged):
  1. The eval baseline (Lachy's USD 5 spend, `thread-skill-eval-baseline-then-p4-5`), then schedule p4-5.
     release-check now refuses a non-empty `evals/results/`, so record a paid run in `docs/evals/` and
     clear the directory before the next release.
  2. The E2E, once, on 2.7.0. Retarget `thread-skill-e2e-rerun-on-2-6-0` first, so one live pass covers
     both releases.
  3. Retire the rollout clone (`thread-skill-retire-rollout-clone`, now unblocked). It is clean at
     `393829c`, with the four 2.7 task worktrees still under `.claude/worktrees/`.
  - Any time alongside: the `$N` snippet fix (hands-on, because it needs a live probe),
    `thread-skill-protect-master-ci` (Lachy's call), the p3-1 and p3-3 design calls,
    `safepoint-uses-handoff-home-resolver` (in the workspaces repo), the stale 2.3.4 install, and the four
    follow-ups filed at the 2.7.0 close (§ Where we are).
- **Run embedded snippets from the source SKILL.md with `sed`** (§ Known quirks: the `$N` entry, and skill
  text rendered at session start).

**Superseded 2026-09-25 (evening): run the 2.7 rollout.** The order and the paste-ready lead prompt are in
`20147f3`. The rollout ran as planned.
- The instructions below predate this and are kept for history.

**Superseded 2026-09-25 (afternoon): the self-rollout was ready to resume. Nothing was running.**
- **Resume:** launch a fresh lead in `~/repos/tools/thread-skill-rollout` and run
  `/thread:execute [[thread-skill-rollout-2026-09-23]]`. With the cursor at 2/7, it re-dispatches p4-1
  (gates withdrawn), then runs waves 4–7. That is 8 tasks left.
- **Lead rules** (rollout note § *Resolved 2026-09-24* and § *Resolved 2026-09-25*):
  - never approve gates;
  - never push or reset `master`/`main`;
  - never point `GIT_DIR` at the clone;
  - make no commits in this checkout;
  - park anything only Lachy can decide.
- **When it's done,** release 2.6.0 (brief § S2 step 6). Pull here first (`git pull --ff-only`, and this
  file's uncommitted edit rides along), then bump, then run the cache dance.
- The instructions below predate this and are kept for history.

**Superseded 2026-09-24: the self-rollout was HALTED after wave 2, waiting on one decision.**
- **Read first:** `[[thread-skill-rollout-2026-09-23]]` § Notes → *Halted after wave 2*. It has the leak,
  the parked tasks and the exact commands for both routes.
- **Decide:** (a) rewrite `origin/master` to `c667e9e` and delete `origin/main`, or (b) go forward-only.
  Then re-invoke `/thread:execute [[thread-skill-rollout-2026-09-23]]` from a session launched in
  `~/repos/tools/thread-skill-rollout`, never from here. The cold resume merges PR #7, re-dispatches p3-1
  and p1-3, and continues from wave 3.
- **Don't** approve p1-3's gates once anything has merged on top of `018a60a`. **Don't** hand-edit a task
  back to `in_progress`: that is the verb 7 gap, and resume would re-dispatch merged work.
- **When it's done,** release 2.6.0 (brief § S2 step 6). Pull here first (`git pull --ff-only`, and this
  file's uncommitted edit rides along), then bump, then run the cache dance.
- The older instructions below predate this and are kept for history.

**The live E2E baseline is running.**
- **The S1 verbs session is live**, launched in `~/repos/tools/zz-thread-e2e` (peer `zz-thread-e2e-0b`).
  It consumed `docs/handoffs/2026-09-23-thread-e2e-verbs-1-13.md` and runs verbs 1–13.
- **The live record** is `docs/e2e/2026-09-23-baseline.md`, which that session edits and commits.
- **Pick up S2 from** the handoff its verb 13 writes into `~/repos/tools/zz-thread-e2e/docs/handoffs/`.
  - Don't start S2 from here. The shared brief `docs/audits/2026-09-23-rollout-brief.md` § S2 carries
    the rest, and the gather draft.
  - Expect S2 to split: S2 in the fixture, then S3 here for the `rm -rf` and the rollout.
- **Pending deletion:** the next close here deletes the consumed verbs doc, once no peer holds it.

**Rollout redesign, 22 September 2026:** coordination now belongs to **thread 1**.
Read the [thread 2 handback](/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/implementation/2026-09-22-thread-2-closeout.md)
and the current records owned by thread 3 and the native Claude pilot before
acting. Their work continues independently; do not duplicate dispatch, reuse the
completed Codex pools, or infer release readiness. The instructions below describe
the earlier released 2.5.1 checkpoint, not completion of the protocol 4 candidate.

0. **Nothing is half-done — the tree is clean and 2.5.1 is shipped.** The
   2026-09-21 four-file batch was reviewed, corrected across two rounds and
   committed; the cache dance ran and was verified (`diff -rq` against the
   2.5.1 cache, suite green from the cache copy). A session restart is all that
   is needed for 2.5.1 to load. Do **not** open a new `/code-review` chain on
   the tier ceiling: `review-ledger.py` stopped the last one at 60%
   regressions. The shipped code at `6b8188c` has had no clean-room pass —
   `/simplify` is the engine that has never run on it and is the honest way to
   close that gap. Start from § Open questions, which carries the two deferred
   findings.
1. Read this file, then `CONTEXT.md` and the ADRs in `docs/adr/` — the whole
   directory, not a subset. The rollout lane, orient's self-launching and
   close's autonomy each rest on an ADR added after v1.0.0.
2. `skills/_shared/task-writer.md` is the single source for task shape —
   never change task behaviour in a route skill directly.
3. Automated checks are `README.md` § Tests. A live end-to-end checklist is
   written from the current specs — `task-writer.md` § 3b (a `defer` is not
   done until the target day note carries its `## To do` line; the TaskNotes
   agenda is secondary discovery) plus each route's SKILL.md.
   `docs/build-plan.md` § Verification is the historical v1.0.0 checklist: it
   predates § 3b and passes a defer that writes only `scheduled:`. Don't
   route live testing through it.

## Session log

- 2026-09-30 (evening close): consumed the Chorus-orient handoff. Grilled ADR 0030 (queue, integration, lead-run merge queue, Solo, order, cursor, soft pause, migrate and delete waves) and rewrote ADR 0029 as the operator's ladder file. A scoped orient phased the build as P12 and P13 and retired P6 (protocol 4) and P7. Spike p12-1 proved concurrent Workflow calls. PR #53. My slip: during the spike I typed a fake completion notification and flagged it at once. The write-up uses only real results.
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
