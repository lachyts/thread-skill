# 0030 — a rollout is a queue that integrates at merge

Date: 2026-09-30
Status: proposed, implementation pending (amends ADR 0009's wave and cursor, schedule § 5's
same-file invariant and merge-wave's halt-on-conflict; grilled with Lachy 2026-09-30; supersedes
protocol 4's `0019-task-readiness-governs-progress.md`, never landed on master)

## Context

Schedule colours tasks so that no two tasks editing the same file share a wave. The rule came from
GifLab's #30/#31: two same-wave tasks both edited `metrics.py`, and a squash from a stale base
silently dropped the first one's changes. The rule is safe, but on a repo with one hub file it turns
a rollout into a line. chorus-rollout-2026-09-30 had 53 tasks in 36 waves, because nearly every task
edits `src/stage/static/stage.js`. There was a second hole too. merge-wave brings a PR up to date
through GitHub's update-branch and trusts the repo's required checks, and a repo with no CI (Chorus)
re-verifies nothing, so two correct changes that combine badly land untested. Lachy asked: *"what
about if we're working in worktrees and we're just merging them after we've done those worktrees?"*

## Decision

1. **A rollout is a queue, not waves.** Tasks run in parallel in their own worktrees, each from the
   `main` of its start, up to the parallel ceiling. Only dependencies (`depends-on:`, `blocked-by:`)
   and a **solo** task hold a task back; a shared file never does. A solo task is a sweeping change
   (a rename, a hub-file restructure): when it is next to start, nothing new starts until every
   started task has merged or been set aside, and the queue resumes once the solo task merges or is
   set aside. Queue order is highest `priority:`, then least file overlap with what is running, then
   schedule's order, recomputed from the task notes before every start, so a `priority:` edit in the
   vault reorders a live queue.
2. **Execute's lead runs the queue and is the only merger.** Each task's own run (plan-gate,
   implement, review) is one Workflow call holding one slot until it returns. The Workflow script
   never merges. Every lead-side check (the landing register, a pause, the cursor) runs per task,
   and the vault is current after every merge.
3. **Merging is Integration, one task at a time.** Before an approved task merges, the latest `main`
   is merged into its branch in its worktree and pushed normally: no branch is ever force-pushed.
   The full verifier runs again unless `main` has not moved since the task's base. A short
   re-review follows when the integration wrote code or a PR landed since the task's base shares a
   file with it; the judge asks only whether anything of theirs was dropped or contradicted, or
   anything of ours lost. The lead runs a clean Integration itself; a fresh implementer-role agent
   on the top rung (ADR 0029 decision 5) runs only for a conflict, a red verifier or a rejection. A
   rejection releases the Integration lane: the task revises in its own call, holding a slot, and
   rejoins the Integration queue until its `max_review_rounds` sets it aside. If `main` moves before
   the merge, the task integrates again under the same rule. Integration replaces update-branch for
   every repo, CI or none, so nothing merges from a base older than the `main` it lands on.
4. **A stuck task is set aside, not a halt.** A task that stops short of merging (plan-blocked,
   review-blocked, blocked, gate-pending, or failed at Integration) is set aside: its slot frees,
   its dependants wait, and the queue runs on. A set-aside task resumes at the stage it stopped, and
   nothing already approved is redone. The rollout halts only when nothing can start and nothing is
   running or integrating.
5. **A soft pause drains.** Nothing new starts, what is running integrates and merges, then the
   rollout stops paused. A hard pause still stops now. `--gated` becomes a human pause before each
   merge, and single-wave mode goes.

Considered:
- *Decision 1:* keeping waves as an opt-in mode (two engines, and every reason a wave existed has a
  better home: same-file safety in Integration, order in dependencies, the one real barrier in a
  solo task); a function-level overlap check at plan time (more machinery for a partial gain);
  keeping the file rule (safest, slowest); waves of the ceiling's size (each waits on its slowest
  task); an ordered `## Queue` list in the rollout note (it overrides the overlap preference or
  loses it); order frozen at schedule time.
- *Decision 2:* one long Workflow for the whole rollout. A script cannot touch the vault, so status
  would be blind until the end, the register and pause checks could not run per merge, merges would
  pass to an agent, and a ten-hour run is one failure domain. The spike
  (`docs/spikes/2026-09-30-concurrent-workflow-calls.md`) showed one session holding several
  Workflow calls at once.
- *Decision 3:* rebasing with a force-push (an exception to the engine's never-force-push rule, and
  it can overwrite a fix pushed during repair); re-reviewing only when the integrator wrote code (two
  changes that each merge cleanly but clash then land on the verifier alone, the no-CI hole again);
  always re-reviewing (it pays for reviews with nothing to read); skipping the re-verify on CI repos
  or when the landed commits are docs only (CI and the task's verifier check different things, and
  tests can read docs); an agent for every Integration (a top-rung agent only to run a verifier);
  the integrator on the task's own rung (the riskiest step could run on the bottom rung); a
  dedicated integrator role (another role on every rung for the same job); holding the Integration
  lane through a rejection's review loop (one hard task stalls every finished one); one fix round
  then set aside, or set aside at once (both trade a likely landing for a repair trip); a merge
  train, integrating several finished tasks as one (faster on a hub file, but a bad combination is
  harder to attribute; deferred until the first queue runs measure how long tasks wait).
- *Decision 4:* halting the rollout on a stuck task (today's behaviour, which stops fifty tasks for
  one).
- *Decision 5:* parking running tasks at an open PR (they go stale while paused).

## Consequences

- There is no stored cursor. A rollout's progress is its task notes: `status: done` means merged,
  and a resume checks GitHub for a merge whose note was never marked. (Rejected: a `merged:` list on
  the rollout note, a second copy to reconcile.) `/thread:status` reports running, integrating,
  queued, merged and set aside.
- The Stop-hook status line and the heartbeat report merged and running counts in place of the
  wave cursor; the four run states keep their meaning.
- Schedule stops colouring. It orders the queue, records dependencies and keeps its affine merge
  (one change split across tasks, folded into one unit), which saves Integrations. Planned file
  lists now only break ties in queue order and feed the affine merge, so they are best-effort, with
  no agent sweep and no confirmation turn. The `## File-sets` gate goes everywhere (execute's
  smart-halt, schedule's conflict graph, repair's file-overlap successors); the re-review trigger
  reads real diffs.
- A task plans against the `main` of its own start: its planner and judges read its worktree. A
  plan a landed PR makes stale is reconciled at Integration, not by re-planning.
- There is one engine. A wave rollout in flight migrates by `/thread:schedule --regenerate`, whose
  supersede carries every unlanded task: a `review` task with an open PR awaits Integration, an
  open task is queued, a merged one is done. (Rejected: wave rollouts finishing on the old engine
  beside the queue.) The wave engine, `merged_through_wave` and the `WAVE-STATUS` line are deleted
  with no alias.
- Protocol 4's `0019-task-readiness-governs-progress.md` (on `codex/thread-rollout-redesign`,
  accepted 2026-09-22, never built) reached for the same thing: readiness, not a wave cursor,
  governs progress, and a pause drains. This decision supersedes it and goes further (a shared file
  never holds a task back). The queue is built on master's engine; the branch's standalone fixes
  that also hold on master are carried into the build.
