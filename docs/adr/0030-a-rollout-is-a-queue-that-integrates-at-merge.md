# 0030 — a rollout is a queue that integrates at merge

Date: 2026-09-30
Status: proposed, implementation pending (amends ADR 0009's wave and cursor, schedule § 5's
same-file invariant and merge-wave's halt-on-conflict; grilled with Lachy 2026-09-30; supersedes
protocol 4's `0019-task-readiness-governs-progress.md`, never landed on master)
Amended by ADR 0031: the primary checkout holds while a rollout runs, so a migration is a deliberate
cut-over.

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
- **A git-env canary watches the shared checkout (p14-6).** The lead opens a window around every
  launch that can run agents or a verifier against the rollout's `Project root` (each Workflow call,
  a *Lost call* or signed-gate resume, the lead's Integration verify and a RACE re-verify):
  `git-env-canary.py arm` records `refs/heads/<default>` and the effective bareness
  (`rev-parse --is-bare-repository`, so a `config --worktree core.bare` flip counts), and `check`
  compares them when the window ends. A window is open only while its vault owner holds (`in_progress`
  for a task call, `integrating:` for the rest); an orphan is compared once and closed. A change that
  is not benign appends a `git-env trip` line to the rollout note's `## Git-env log`, which halts the
  queue before any merge (`next` reports `halt: "git-env"`, `carry` refuses) and is never retried; only
  `/thread:repair` (its git-env step, 3e) clears it, through an `ack` on Lachy's word that names exactly the tripped set
  shown and the ref shown (`--ref`), so a stale or partial ack writes nothing.
  - **The close-out decision (option (a)).** Execute § 2.7 says a close-out landed mid-run must not
    halt, so a local commit not on `origin/<default>` is benign when every one is a non-merge commit
    touching only land.sh's `closeout_shaped` paths (or, since P17, deleting a file directly under
    `docs/reviews/`: the consumed review doc a close-out deletes, land.sh's `closeout_change`). That is
    **stricter than S9**: S9 also carries an
    empty non-merge commit and a merge whose other parents are on origin, and the canary trips on both
    (fail-closed). The rule covers land.sh's S4, S5 and S11 moves and merge-task's `refresh_local_base`.
  - **The read order.** The canary reads B before O (`origin/<default>`), in one function. Every writer
    that moves local B onto origin's commits fetches O first and then moves B, so an O read after B is
    at least as new as the O that B moved onto; reading O first could pair a pre-fetch O with a moved
    B and trip on origin's own commits. A future writer that breaks this trips falsely, which fails
    closed.
  - **The RACE path.** A git-env halt at a RACE site (the race-verify arm, the RACE check, merge-task's
    exit 5 under a hold) writes one `git-env halt` line on the `## Race log`, the only write a git-env
    halt makes. It ends the re-verify's in-flight state, from any session, and after the ack the task
    is an undecided RACE that repair § 3e hands to § 3c with the git-env reading of its verdict file.
    This is accepted on purpose, and consistent with a lead crash mid-re-verify. (Rejected: re-running
    the RACE re-verify automatically after an ack: a human saw a git-env halt, so a human decides.)
  - **The integrate-call return.** Its row is reconciled whatever its check says (the engine's own
    result; dropping it would make it a *Lost call*), and on a non-zero check no outcome is acted on.
  - **`restore`'s drop guard.** Repair's restore moves the local default to origin's only when it
    holds no commit missing from origin, or when `--drop-local` names the exact sha Lachy was shown;
    a drop prints the old sha and the `git-env-rescue` branch command that recovers it. It clears
    `core.bare` first, before and independently of that guard (clearing it drops nothing), and
    `--bare-only` stops there: `ack` refuses while the checkout reads bare, so a refused restore that
    left it bare would deadlock the keep-and-ack route whenever local B holds a pending close-out.
  - **Binding.** `--repo` must resolve to the rollout's `Project root` (and to its records and trip
    lines), and `--default` must be a plain branch name equal to the one the records and trip lines
    name, so a mistyped flag reads or changes nothing in the wrong repo.
  - **Records** live outside the repo, under `${THREAD_GIT_ENV_DIR:-${XDG_STATE_HOME:-~/.local/state}/thread/git-env}/<rollout>/`,
    so an agent's `git clean` or `rm -rf .claude` never reaches them, and a missing or unreadable record
    at `check` is itself a trip. So is a closed one (`record not armed`): the owner holds at its own
    check, so a tombstone an earlier window of the same slug and kind left means this window was never
    armed, and passing it as clean would let a commit made with no window open go unseen. Each window is
    checked once, a *Lost call* resume's included. Every verb but `restore` holds a `flock` on `<rollout>.lock` beside the
    per-rollout dir (never deleted); `retire` (completion, a supersede) leaves a `<rollout>.retired`
    marker that refuses a new window; `restore` is lock-free (git's own locks serialise it). POSIX only.
  - **Considered:** wrapping the verifier (inside a Ralph loop a canary diff invites the agent to "fix"
    it, it misses ad-hoc agent commands, and it changes prompt bytes, so the resume cache breaks);
    prompt-only (it depends on the agent complying); records under `.claude/` (agents reach them);
    accepting the close-out halt (§ 2.7 forbids it); and auto re-running the RACE re-verify after an ack
    (rejected above).
  - **Known gaps:** a direct push to an unprotected origin followed by a local fast-forward passes; so
    does a forged `refs/remotes/origin/<default>` (repair's `ls-remote` exposes it, restore's fetch
    overwrites it); close-out-path contents are not inspected; dropping a close-out commit from local B
    passes; a net-zero change inside a window passes; other refs are unwatched; records are
    machine-local (a cold resume elsewhere still has the vault hold); an orphan is compared once after
    its owner ends; and the upgrade path: the first return of a call launched before the canary shipped
    trips `record missing` and halts until a human acks it.
