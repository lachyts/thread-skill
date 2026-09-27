---
thread: thread-skill
written: 2026-09-27
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- **P10 rollout complete.** `[[thread-skill-rollout-2026-09-27]]` (archived at `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`, § Completion log) merged #25 (`4033894`), #27 (`5ec1e12`) and #28 (`091d85f`) on `lachyts/thread-skill` master in 2h 9m. CI green on both runners for every PR.
- **Phase 10 left open, correctly.** #28's phase-close step ran at the ceremony. It wrote nothing, because p10-3 and p10-4 are open.
- **Dry run (nothing applied):** `reconcile-project.py --project chorus` lists 2 unambiguous items: phase `chorus-p23-words-and-the-turn` and the misfiled `chorus-rollout-2026-09-21`. Thread Skill is clean.
- **Committed:** vault `b2a6137b` and `9b6730fa`. `THREAD.md` close-out `ffade23` is on this branch, `docs/close-2026-09-27-p10-rollout`, which is **unpushed**. This doc is committed on the same branch.

## 2. What remains (in order)

1. **Land this branch.** Push `docs/close-2026-09-27-p10-rollout` and open a PR (master is protected, ADR 0025; p5-4). It carries `ffade23`, this doc and the THREAD.md Resume pointer (uncommitted until your close). Afterwards switch this clone back to `master` so the next rollout's `merge-wave.sh` can fast-forward it.
2. **Release P10:** follow `[[thread-skill-release-reconcile-step]]`. `~/repos/tools/thread-skill` (the live plugin checkout) is at `daa1797` / 2.7.1. The steps:
   - fast-forward it;
   - bump both manifests to 2.8.0 via a PR (a new script plus a ceremony step is a minor bump; confirm with Lachy if unsure);
   - `claude plugin marketplace update thread && claude plugin update thread@thread`;
   - `make release-check`.
   Lachy's step: only run it when he asks.
3. **Live acceptance:** follow `[[thread-skill-reconcile-step-live-acceptance]]`. Compare the Chorus dry run with the 2026-09-27 Chorus drift audit (source: `[[thread-skill-p10-finished-work-closes-itself]]` phase note, which cites it). Explain any difference, then ask Lachy before `--apply` (it writes Chorus notes).
4. **Next rollout:** once `feat/next-action-set-downs` has merged, run `/thread:schedule` on p10-3, p10-4 and p9-4 together. That branch is owned by the `gtd-next-action-grill` thread (worktree `~/repos/tools/thread-skill-wt-next-action`; its review handoff was consumed). Check whether it has a PR yet, but don't drive it from here.
5. **Still owed** (THREAD.md § Resume):
   - the fresh-review of workspaces `29ca886` (needs a session in `~/repos/workspaces`);
   - tag 2.7.1;
   - `git remote set-head origin --auto`.

## 3. Decisions settled

- Phase 10 stays open until p10-3 and p10-4 land. Don't close it by hand.
- Follow-on tasks carry no `-p<N>-` segment, so the reconcile step never counts them as phase tasks.
- Every rollout runs on Opus (the AGENTS.md lock, `max_tier: opus`). `tier_capped: plan` on the P10 tasks is the lock, not a quota problem. Whether a lock-driven cap should stamp anything is an open question in THREAD.md, and it isn't decided yet.

## 4. Gotchas found the hard way

- The loaded plugin skill text is the **live checkout's** (2.7.1). Until the release, `/thread:execute`'s ceremony text lacks #28's phase-close step. Run new scripts from this clone's merged master: `skills/_shared/scripts/reconcile-project.py`, `skills/execute/scripts/reconcile-wave.py touched-phases`.
- zsh doesn't word-split `$VAR` in a Bash call. Pass a file list to `git add` / `git commit` as an array (`"${F[@]}"`).
- The vault has many unrelated uncommitted edits. Commit by pathspec only.

## 5. Suggested skills

`/thread:open` (pick up), `/thread:schedule` (step 4), `/thread:execute` (the next rollout), `/fresh-review` (for any code you write), `/thread:close` at the end.

## 6. Paste-ready prompt

```
You're continuing "thread-skill: P10 release, live acceptance and next rollout" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill-rollout/docs/handoffs/2026-09-27-p10-release-and-acceptance.md — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The P10 rollout merged #25, #27 and #28 (the reconcile step, execute's phase close, schedule's supersede move). Phase 10 stays open for p10-3/p10-4, which wait on feat/next-action-set-downs (another thread's branch). The live plugin checkout ~/repos/tools/thread-skill is still 2.7.1 without P10. This clone sits on the unpushed branch docs/close-2026-09-27-p10-rollout, which carries the close-out and this doc.
Also read: THREAD.md (§ Where we are, § Resume instructions); ~/repos/obsidian/Work/Tasks/thread-skill-release-reconcile-step.md; ~/repos/obsidian/Work/Tasks/thread-skill-reconcile-step-live-acceptance.md
Suggested skills: /thread:open, /thread:schedule, /thread:execute, /fresh-review, /thread:close
Next move: push docs/close-2026-09-27-p10-rollout and open its PR, then ask Lachy whether to run the P10 release now.
```
