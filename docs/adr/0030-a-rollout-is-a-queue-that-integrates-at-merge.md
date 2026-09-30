# 0030 — a rollout is a queue that integrates at merge

Date: 2026-09-30
Status: proposed, implementation pending (amends ADR 0009's wave and cursor, schedule § 5's
same-file invariant, and merge-wave's halt-on-conflict; grilled with Lachy while scheduling
chorus-rollout-2026-09-30)

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

1. **File overlap no longer serialises tasks.** Only dependencies (`depends-on:`, `blocked-by:`, a
   named "after"), a **solo** task and the parallel ceiling decide what runs at once. A solo task is a
   sweeping change (a rename, a restructure of a hub file) that would make every concurrent task
   redo its work: it starts only when nothing else is running, and nothing starts until it merges.
   Shared files still shape queue order softly: of the tasks free to start, the one overlapping least
   with what is running goes first. Overlap never holds a task back. Waves are dropped outright, not
   kept as an opt-in mode (re-grilled 2026-09-30): nothing a wave did is a wave's job once merging
   integrates.
2. **A rollout is a rolling queue, not waves.** Up to the parallel ceiling's worth of tasks run at any moment,
   each in its own worktree from the `main` of the moment it starts. When one merges, the next in
   **queue order** starts: highest `priority:` first, then the fewest files shared with what is
   running, then the order schedule wrote. The lead re-reads the task notes before every start, so
   changing a task's `priority:` in the vault reorders a live queue; there is no other queue to
   edit. (Re-grilled 2026-09-30. Rejected: an ordered `## Queue` list in the rollout note, which
   either overrides the overlap preference or loses it; order frozen at schedule time.) A task whose dependency has not
   merged waits in the queue.
3. **Merging is integration.** A task that passes its own verifier and review is integrated before
   it merges: its branch is rebased onto the latest `main` in its own worktree, and its implementer
   resolves any conflict from its own diff and the PRs that landed ahead of it. The full verifier
   then runs again. It then gets one short **re-review** when the integrator wrote code (resolved a
   conflict or added a commit) **or** a PR that landed since its base shares a file with it. The
   judge reads only the integration delta and those overlapping PRs, and asks one thing: was
   anything of theirs dropped or contradicted, or anything of ours lost. A clean rebase onto a
   `main` whose new PRs touched none of its files merges on the green verifier alone. (Re-grilled
   2026-09-30. Rejected: re-review only when the integrator wrote code, which leaves a clash
   between two changes that each merged cleanly to the verifier alone, the no-CI hole again; and
   always, which pays for reviews with nothing to read.) A rejection runs the task's full review
   loop, up to its `max_review_rounds`, the integrator revising on the top rung against the accumulated
   feedback; the ceiling sets the task aside. `main` cannot move while it runs, so no round
   re-rebases. The cost is accepted with open eyes: a hard integration holds every finished task
   behind it, while implementation carries on. (Rejected: one fix round then set aside, and set
   aside at once, both of which trade a likely landing for a repair trip.) Only then does it merge. Tasks merge in the order they finish integrating, one
   at a time. The integrate-verify-merge step is serial; implementation is not. Integration replaces
   update-branch for every repo, CI or none, so the stale-base squash cannot happen: nothing merges
   from a base older than the `main` it lands on. The integrating agent is a fresh one in the
   implementer role, on the task's model, given its own diff, its approved plan, and the PRs and
   briefs that landed since its base. It always runs on the **top rung** of the operator's ladder
   (ADR 0029; today Opus at `xhigh`), whatever rung the task reached: folding someone else's landed
   work into yours is the step where a silent drop happens, so it never runs on a first-pass rung.
   (Re-grilled 2026-09-30. Rejected: the task's own rung, which can put the riskiest step on the
   bottom rung; a dedicated integrator role, another role on every rung for the same code-writing
   job.)
4. **Execute's lead session runs the queue; the Workflow script never merges.** Each task is its own Workflow
   call (plan-gate, implement, review), up to the parallel ceiling's worth in flight. When one returns, the
   lead launches that task's integration as a second, small Workflow call in its worktree, and only
   one integration is in flight at a time. On a clean integration the lead merges through the
   merge script, reconciles the vault and starts the next task. Every lead-side check (the landing
   register, a pause, the cursor) therefore runs per task, and the vault is current after every
   merge. (Re-grilled 2026-09-30. Rejected: one long Workflow for the whole rollout, integrating and
   merging inside it. A script cannot touch the vault, so status would be blind until the run ended,
   the landing register and pause checks could not run per merge, merges would pass to an agent inside the script,
   and a ten-hour run is one failure domain. Unverified: that one session holds several Workflow
   calls in flight at once. The build's first step proves it.)
5. **A stuck task is set aside, not a halt.** A conflict it cannot resolve, or a suite still red
   after its fix loop, marks the task `blocked` with the reason. Its dependants wait, and the queue
   runs on. The rollout halts only when nothing left in the queue can start.

Considered: keeping waves as an opt-in mode beside the queue (two engines to keep, and every reason
a wave existed has a better home: same-file safety in integration, order in dependencies, the one
genuine barrier in a solo task); parallel only when the shared file is a hub and the plans touch different functions (a
function-level overlap check at plan time, more machinery for a partial gain); keeping the file
rule (safest, slowest); waves of the parallel ceiling's size (the old cursor, but every wave waits on its
slowest task); and halting the rollout on a stuck integration (today's behaviour, which stops
fifty tasks for one).

## Consequences

- There is no stored cursor. A rollout's progress is its task notes: `status: done` means merged,
  and each task carries its own `dispatched:` and `merged:` stamps, which feed elapsed time and
  the rough estimate. A resume checks GitHub for a merge whose note was never marked, as the cold
  resume does today. (Re-grilled 2026-09-30. Rejected: a `merged: [slugs]` list on the rollout
  note, a second copy for `/thread:status` to reconcile.) `/thread:status` reports running,
  integrating, queued, merged and set aside.
- A soft pause drains: nothing new starts, what is running integrates and merges, then the rollout
  stops paused. A hard pause still stops now. (Re-grilled 2026-09-30. Rejected: parking running
  tasks at an open PR, which leaves them going stale while paused.)
- The Stop-hook line becomes `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=<running|waiting|halted|done>`,
  keeping the four states and their meaning; the heartbeat's stall test becomes "no Workflow call
  for this rollout in flight and work remains".
- Schedule stops colouring. It orders the queue and records dependencies; its affine merge (one
  change split across tasks, folded into one unit) stays, since it saves integrations. The
  `## File-sets` block stops being a gate anywhere: execute's smart-halt and schedule's conflict
  graph go, and `/thread:repair` defers a set-aside task's dependants only, no longer its
  file-overlap successors. Its one remaining reader is the queue-order tiebreak, which needs the
  planned file lists of tasks that have not started. The re-review trigger reads real diffs (the
  files the landed PRs changed against the task's own), never the planned lists.
- The plan-gate still plans against the `main` of the task's start, and a queued task has not
  started, so only a running task's plan can go stale. It is reconciled at integration, never by
  re-planning mid-run: the integrator already holds the approved plan and the landed briefs on
  the top rung, and the re-review checks the result. Re-planning would throw away work in flight to fix
  what integration already fixes.
- There is one engine. A wave rollout in flight migrates onto the queue by `--regenerate`: a task
  at `review` with an open PR is a task awaiting Integration, an open task is queued, and a merged
  one counts toward the cursor. The wave engine, `merged_through_wave` and the `WAVE-STATUS` line
  are deleted outright, with no alias. giflab-rollout-2026-09-23 (wave 1's four PRs at `review`
  since 2026-09-23) and chorus-rollout-2026-09-30 (parked for this) are the two to migrate.
  (Re-grilled 2026-09-30. Rejected: wave rollouts finishing on the old engine beside the queue, and
  holding the queue until GifLab finishes on waves.)
