---
thread: thread-skill
written: 2026-09-25
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

Written by the 2.7 rollout lead (session `execute-2026-09-25-9ddc3e9b`, launched in the rollout clone
`~/repos/tools/thread-skill-rollout`). Lachy chose this handoff from `/thread:next`, lifting the lead's
read-only rule on this checkout for the handoff doc and its THREAD.md Resume pointer only.

## 1. Done and verified

- **The 2.7 rollout landed, 4 tasks in 2 waves, 1h 50m, no halts, no gates, nothing parked.** PRs on
  `lachyts/thread-skill` master:
  - #17 orient nested project notes → `881648e`
  - #18 evals-results vs release-check → `9006910`
  - #19 p2-6 close repo state (strict local-only) → `448d20f`
  - #20 p2-7 tool-repo threads and `open save` → `393829c` (the last merge; `origin/master` now)
- `make test` reported ALL PASS on the merged master after each wave (`448d20f`, then `393829c`).
- The rollout note is archived with its completion log: waves → PRs, rounds per task, what each review
  round fixed. See `~/repos/obsidian/Work/Tasks/Archive/Rollouts/thread-skill-rollout-2026-09-25.md`.
  Vault commit `587c7a01` (rollout note plus the four task notes, all `done`).
- **Nothing is released.** The manifests still say 2.6.0. This checkout has not pulled.
- The rollout clone is clean at `393829c`, with the four task worktrees still under `.claude/worktrees/`
  (for the daily sweep's reaper). No heartbeat cron is left.

## 2. What remains

1. **Bring this checkout level.** Local master is `d59bcb3` + Lachy's unpushed `42360be` ("2.7 rollout
   prepared", THREAD.md only) + this doc's commit. `THREAD.md` also carries the uncommitted handoff
   Resume pointer. Run `git pull --rebase --autostash`. No merged PR touches `THREAD.md` or
   `docs/handoffs/`, so the replay should be clean. Check `git log --oneline -6` shows the two local
   commits on top of `393829c`, the tree is clean apart from THREAD.md, and `make test` is ALL PASS.
2. **Release 2.7.0 with Lachy** (his step; confirm before pushing). The recipe is the previous
   Resume's step 2, now `42360be`'s text:
   - bump both manifests to 2.7.0;
   - commit `🔖 chore(release): 2.7.0 — …`;
   - push (this also pushes `42360be`, which the previous Resume said must go up);
   - `claude plugin update thread@thread`;
   - `make release-check` right after the update, on the released commit.

   `evals/results/` must be empty or absent first: #18 makes release-check refuse otherwise.
3. **`/thread:close`** to fold the rollout and the release into THREAD.md. It deletes this consumed doc.
   - Where we are: point at the archived rollout note, don't restate it.
   - Open follow-ups: `thread-skill-evals-results-vs-release-check` and
     `thread-skill-orient-nested-project-notes` are done.
   - Resume: the rest of the old order.
4. **The rest of the old order**, unchanged:
   - the eval baseline (Lachy's USD 5 spend), then schedule p4-5;
   - the E2E once on 2.7.0 (retarget `thread-skill-e2e-rerun-on-2-6-0`);
   - retire the rollout clone: `thread-skill-retire-rollout-clone` is now unblocked.

   Any time alongside:
   - the `$N` snippet fix;
   - `thread-skill-protect-master-ci`;
   - the p3-1 and p3-3 design calls;
   - `safepoint-uses-handoff-home-resolver`;
   - the stale 2.3.4 install.
5. **Proposed follow-ups from the rollout.** None filed: filing is Lachy's call, and close's step-6 menu
   is the place to offer them.
   - Out-of-repo glob drift (PR #17). These three still use depth-limited `Work/Projects` globs:
     - `~/.agents/knowledge/task-home.md:9`
     - `~/repos/workspaces/_shared/knowledge/obsidian-schema.md:236`
     - `~/repos/workspaces/_shared/scripts/sync-project-repos.py:38` (misses depth-4 notes)

     Open question: should `Archive/` be excluded at all three sites?
   - `skills/execute/scripts/merge-wave.sh:102` uses `git rev-parse --abbrev-ref HEAD`, which has the
     ambiguous-ref bug p2-6 fixed in `repo-state.sh` (a tag named `master` gives `heads/master`).
     Protocol 4 intake.
   - Protocol 4 intake: a verifier red on the base branch outside a task's `touches:` blocks the
     implementer, and p2-7's capped retry then widened scope into `skills/execute/tests/`. Re-run the
     verifier on base before blocking. Also, the first pass's `## Blocker diagnosis` stays on the note
     after a successful retry.
   - `open` `list` step 2's `~/Projects` find still lists `.claude` worktree copies and lacks p2-7's
     prunes.
   - close sub-step 2's `.git/` guard is looser than 7.1's `--path-format=absolute --git-path` form.
   - Area notes like `Life (area)/Life (area).md` have no `area:` front matter, so the area falls back
     to `Life (area)` (orient § 1, process-scan rung 3).
   - `gh` 2.43.1: `gh pr edit` fails on a Projects-classic GraphQL error, and agents fell back to
     `gh api`. Upgrade `gh`.
   - Lachy's one-off: `git remote set-head origin --auto` across his repos, so close's new repo-state
     line resolves. It needs the network.

## 3. Decisions settled

- **p2-6 is strict** (Lachy, at scheduling): the default branch comes from `origin/HEAD` only, with no
  `origin/{main,master}` heuristic. The "default branch unresolved" line on unset repos is accepted.
- **evals-results is option 1** (Lachy): release-check refuses while `evals/results/` is non-empty.
- **Tier:** Opus 5.5 only, per `~/.agents/AGENTS.md` § Model tier.
- **p2-7's scope widening was accepted.** Commit `1534f34` converted `echo | grep -q` pipes to
  here-strings in `skills/execute/tests/reconcile-wave.test.sh` and `tests/repair-stranded-merged.test.sh`.
  It is test-only and has no engine code. The master review approved it after the widening was recorded,
  and the lead checked the diff before merging.

## 4. Gotchas found the hard way

- **`pull --ff-only` fails here now**, because `42360be` was never pushed and origin moved on. Rebase,
  don't merge. `--autostash` is needed for the uncommitted THREAD.md pointer.
- **Skill text loads from this working tree** (directory-source marketplace). This session started on
  the pre-rebase tree. Whether a skill body is re-read at invocation after the rebase is unverified. If
  `/thread:close` can't identify this tool-repo thread (the 2.6.0 text has no rung 3), commit THREAD.md
  by pathspec by hand, as before.
- **`$N` substitution**: invoking a skill with arguments rewrites `$0`/`$1`/`$2` in its body. Run
  embedded snippets from the source SKILL.md with `sed`, never from the rendered text.
- **The `grep -q` flake**: `echo "$x" | grep -q` under `pipefail` on macOS grep can fail once the
  payload passes about 512 bytes. The two affected suites are fixed on master. `wave-stop-driver.test.sh`
  still pipes but sets no `pipefail`.
- **zsh**: a bare `=====` word in a command is `=`-expansion and errors. Don't use it as an echo
  separator.
- **release-check** is exact. A tracked file deleted after release (this doc, once close removes it)
  reads as stray until the next release. That's expected (the Makefile note).

## 5. Suggested skills

- `thread:open` handoff-doc mode, to pick this up.
- `thread:close` after the release.
- `fresh-review`, only if the session writes code beyond the manifest bump.

## 6. Paste-ready prompt

```
You're continuing "thread-skill: rebase, release 2.7.0, close" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-25-post-rollout-release.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The 2.7 rollout is done. PRs #17–#20 are merged to lachyts/thread-skill master (last merge 393829c), make test is green and the rollout note is archived with its completion log. This checkout is behind origin. Local master carries Lachy's unpushed 42360be (THREAD.md) plus the handoff-doc commit on d59bcb3, and THREAD.md has an uncommitted Resume pointer. Nothing is released yet.
Also read: ~/repos/obsidian/Work/Tasks/Archive/Rollouts/thread-skill-rollout-2026-09-25.md (§ Completion log); THREAD.md § Known quirks (the $N entry, release-check).
Suggested skills: thread:close after the release. Run embedded shell snippets from the source SKILL.md with sed.
Next move: `git pull --rebase --autostash`, confirm the replay is clean and `make test` is ALL PASS, then ask Lachy before the 2.7.0 release steps (bump both manifests, commit, push, `claude plugin update thread@thread`, `make release-check`).
```
