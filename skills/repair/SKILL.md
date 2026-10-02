---
name: repair
description: 'Use to unstick a wave rollout that has stalled — run it whenever there''s an issue with the whole rollout, not a single task. Triggers on "repair [[rollout]]", "fix this rollout", "[[rollout]] is stuck", "sort out [[rollout]]", "unblock the rollout", or after /thread:status shows blockers/drift. A thin CONDUCTOR over /thread:execute (never a second engine): it diagnoses (runs /thread:status), reconciles drift, asks YOU only the decisions no agent can make and writes them into the notes, auto-retries agent-fixable blocks, dependency-aware-defers wedged tasks, then hands off to execute''s resume — the engine keeps sole merge authority. Scope: Obsidian + gh/git + the execute engine.'
---

# /thread:repair — sort out a stuck rollout (conductor, not an engine)

`/thread:repair [[rollout]]` is the **"something's wrong with this rollout — sort it out"** verb. You point
it at the rollout (never a single task); it figures out what's stuck across the queue, does the mechanics,
and asks you only the decisions no agent can make.

It is a **conductor** over execute's queue loop, not an engine (see
`docs/adr/0004-repair-is-a-conductor-not-an-engine.md`). Execute's lead already restarts a stalled task,
launches an automatic seeded revise, integrates each approved task and merges it. Repair adds only what the
loop can't do by itself: hand a set-aside task back at the **stage it stopped** (ADR 0030 decision 4), capture
an **input-gated** decision, record a gate sign-off, raise a review budget **once**, **defer** a wedged task
with its dependants, flip a **merged, never marked** task, and **escalate** a merge the notes never recorded.
It never re-implements Integration, merge or convergence, and **the engine keeps sole merge authority**.

## Native runtime binding

Diagnosis and authorised deterministic reconciliation (the hand-backs, the notes writes) run in either
harness. Any task call goes through execute's native runtime preflight and its canonical engine, with the
original run's caller/session and native child identities. Read
`~/repos/workspaces/_shared/scripts/native_workflow.md`. A new harness must not adopt or replay another
session's pending claims. Recover the actual native children first; otherwise report the unresolved
ownership. Codex has no detached driver: repair preserves the diagnosis and the hand-backs, and the queue can
then run only as a session-driven `--gated` run. Do not claim that a request for continuous repair has been
completed by preparing one. Never create a second convergence engine.

## Scope

Reads/writes `~/repos/obsidian/Work/Tasks/`, makes `gh`/`git` calls against the target repo, and drives
`/thread:execute`'s queue loop. Merges only ever happen through execute's merge step (`merge-task.sh`).

## Invocation forms

```
/thread:repair [[giflab-rollout]]      # diagnose, fix what it can, ask only the decisions, run the queue to done
repair [[giflab-rollout]]            # natural language — same thing
fix this rollout                     # resolves to the rollout in context
```

## Skill flow

### 1. Diagnose

Resolve `[[<slug>]]` (ask if ambiguous). Run the **`/thread:status` scan with the live cross-check on**
(repair is about to act, so it always checks reality): the per-task queue state, each task's
`lead-integrate.py inputs`, the drift flags and the repo path. Show the user the situational report first:
they should see what they're repairing.

**Stops.** Before anything else, and before anything is written:

- `protocol_version` absent, `2` or `3` → execute § 2's remedy: hard-pause it if a session is running it, then
  `/thread:schedule <project> --regenerate`. Stop.
- any other value except `5` → "unsupported protocol version <N>; the queue reads protocol_version: 5". Stop.
- `incomplete` → `/thread:schedule <project> --regenerate`. Stop.
- `superseded_by:` → point at the successor (`/thread:repair [[<successor>]]`). Stop.

Then one of three modes holds. Each is evaluated before anything is written.

**Pause, drained or stamped.** While `pause_requested` drains, or `paused:` stands:

- Repair reports the pause: stamped → "reinstate with `/thread:execute [[<rollout>]]`"; pending → "it drains;
  nothing to do".
- On Lachy's confirmation, and only for something independent of the pause, it may capture a decision (§ 3b)
  or defer a set-aside task with its queued dependants (§ 5).
- It never runs `hand-back`, `approve-gates`, the raise, `resume` or the loop, and it never clears the stamp or
  the flag.
- Why: `next` stamps `paused:` only once nothing runs, awaits Integration or integrates. A hand-back during the
  drain would put a task back into exactly those states, and the live lead would integrate and merge it after
  Lachy asked to pause. Under a stamped pause, the reinstate decides what restarts.
- The one extra under a stamped pause: § 3c's `pr:` write on Lachy's confirmation, leaving `resume` to the
  reinstate's *Cold resume*.

**Live queue, not paused.** A running or integrating task carries an `owner:` whose session is not known to
have ended. A Workflow run is listed only in the session that launched it, which the tag names, so check
`/workflows` in that owner session; from any other session "no run" proves nothing, so report "possibly live:
check session `<owner tag>` first".

- Repair may hand back, apply the raise, capture decisions, run `approve-gates` on sign-off, and defer
  set-aside tasks with their queued dependants.
- It never runs `resume`, never enters the loop, and never writes a running or integrating note, because a
  live call's reconcile would overwrite it.
- The live lead's next `next` restarts an `in_progress` hand-back and integrates a `review` one.

**No lead live.** No pause, and every owner session has ended (or shows no run there): the full flow, § 3 to
§ 6.

**Sent here by schedule's unfinished-rollout refusal.** Repair sorts out what is stuck; superseding stays
schedule's `--regenerate`.

### 2. Classify each unmerged task

From its queue state, its `lead-integrate.py inputs` (`resumeAt`, `autoRevise`, `lastIntegration`) and the
live PR state:

| Class | Signal | Action |
|---|---|---|
| **merged, never marked** | not done; its PR is MERGED into the default branch | `reconcile-rollout.py resume` (§ 3a) flips it done; never hand it back or defer it |
| **PR-less merge** | status's "possible PR-less merge" flag | escalate with evidence (§ 3c) |
| **RACE** | merge-task exit 5 (a `## Race log` line), or `UNVERIFIED:` in its set-aside reason | escalate (§ 3c); never re-call merge-task |
| **merge hold** | merge-task exit 7: review required on the integrating PR | "approve PR #N": Lachy's; never re-integrated, never set aside |
| **live** | running or integrating under a live lead | nothing: the lead owns it (§ 1) |
| **awaiting Integration** | `review` with a `pr:` | nothing: the loop integrates it |
| **queued** | `open`, its `waitingOn` unmet | nothing: it starts when its dependencies land (or defer it with its blocker, § 5) |
| **at Integration** | `setAsideAt: integration` (`resumeAt: integration`) | `reconcile-rollout.py hand-back --tasks <slug>` → `review`: it rejoins the Integration queue and retries Integration only; its branch, plan and review stand, nothing redone (§ 4) |
| **revise (automatic)** | `autoRevise: true` | nothing: the lead (or § 4's hand-off) launches the seeded revise itself |
| **revise stopped** | `revise stopped:` in the marker, `resumeAt: revise` | hand back (§ 4) → a seeded revise |
| **review-blocked, rejected** | `review-blocked`, `lastIntegration.outcome: rejected` | the raise (§ 4), then hand back → a seeded revise |
| **own run** | `resumeAt: own`: `blocked`, `plan-blocked`, `review-blocked` with no `rejected` line, a code-writing `review` with no `pr:`, a `merge-task:` set-aside | agent-fixable → hand back (§ 4) → its own call; input-gated → § 3b first |
| **gate** | `gate-pending` | present the gates verbatim; on sign-off `approve-gates` (§ 3b); never hand back |

Agent-fixable versus input-gated is judged from the feedback: a test failure, a missed case or a concrete
review note is agent-fixable; "human-decided", "supplied out-of-band", "needs a value", "ambiguous" or
"design choice" is input-gated. When torn, ask: cheaper than looping on the same wall. A `tier_capped:` note
is never input-gated: its block is the quota ceiling, so hand it back once the higher tier's quota returns.

### 3. Act on what doesn't need a task call

**3a — merged, never marked → `resume`.** Only when no lead is live and no pause stands or drains:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout <rollout-note>
```

For every unmarked note with a `pr:`, it asks gh for the PR's state and base, flips one merged into the
default branch to done (stamping `merged:`), and reports anything else unchanged: a PR merged into another
base is escalated, never flipped. Under a pause or a live queue, report it and leave it: the reinstate's or
the lead's next *Cold resume* runs `resume` first.

**3b — input-gated → capture + inject.** This is the **only** time you ping the user. For each input-gated
task, `AskUserQuestion` with the specific decision its feedback needs (quote the feedback). Then write the
answer into the **task note body** so the next agent reads it: replace the placeholder in place, or append or
update a `## Repair input` section with the decision verbatim. It is body content, not a status transition,
so it is allowed under a pause. A gate is presented verbatim; on Lachy's sign-off run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --tasks <slug>`
(execute § 3.7), never under a pause: the next `next` restarts it. A declined gate is deferred (§ 5) or left
set aside.

**3c — a possible PR-less merge, and RACE / UNVERIFIED → escalate with evidence.** For each one, show:

1. the slug, the note's `status:`, `owner:` and `started:`;
2. `gh pr view <n> --json state,mergedAt,mergeCommit,baseRefName,headRefName`;
3. whether the merge commit is on origin's default branch: `git -C <repoPath> fetch origin`, then
   `git -C <repoPath> merge-base --is-ancestor <mergeCommit.oid> origin/<default branch>` (resolve the default
   branch with execute § 4's resolver);
4. `git -C ~/repos/obsidian log -p -n 3 -- Work/Tasks/<slug>.md`: a committed version carrying `pr:` or
   `status: done` means the note was reverted or clobbered (say so if there is none).

Then append a dated `## Notes` line to the rollout note (create the section if missing), e.g.
`- <YYYY-MM-DD> repair: [[<slug>]] possible PR-less merge (PR #<n>, head audit-fix/<alias>, MERGED) escalated;
evidence shown; decision left to Lachy.` On Lachy's confirmation that the PR is this task's, write
`pr: <url>` on the task note:

- with no lead live and no pause: run `resume` (§ 3a), which re-checks the state and the base and flips it
  done;
- under a stamped pause: leave `resume` to the reinstate's *Cold resume*;
- under a drain or a live queue: escalate and record only; the `pr:` write waits for the pause stamp or the
  lead's end (advise: hard-pause, or wait for the stamp, then repair).

Repair never writes that task's `status:`. For RACE, never re-call merge-task: main's state is Lachy's call,
and once he has made it, `resume` flips the merged task done.

### 4. Hand back: re-enter at the stage it stopped

Every route uses execute's own re-entry verb, and never under a pause (§ 1):

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py hand-back --tasks <slug>
```

Set aside at Integration → `review` with `ready:` restamped: it rejoins the Integration queue, and when its
`## Integration log`'s last line is `integrated` it merges through case (ii) with nothing redone. Set aside at
its run → `in_progress` with `owner:` cleared: the next `next` restarts it through execute's
*Restart routing* (`resumeAt: revise` → a seeded revise, else its own call). Per stage:

- **Stale anchor ref** (a reason starting `merge step STOP: stale anchor ref <X>`): delete it first, guarded,
  `git -C <repoPath> update-ref -d refs/integration-anchor/<inputs.branch> <X>` (an absent ref is a no-op), then
  hand back.
- **The raise** (review-blocked, its last log line `rejected`): when the resolved `max_review_rounds` (task →
  rollout → 4) is ≤ `lastRound`, write `max_review_rounds: <lastRound + 1>` on the task note: the
  "auto-retry agent-fixable, cap one" leash, applied to the ceiling. Announce it in the report and record it
  in a dated `## Notes` line (`- <YYYY-MM-DD> repair: [[<slug>]] max_review_rounds raised to <N>, one round`),
  then hand back. If the task re-blocks after that raise (in this run, or a raise for it is already recorded
  in `## Notes`), ask Lachy instead of raising again. With no `rejected` line it is its own run: no raise.
- **A `merge-task:` own-run set-aside whose cause Lachy cleared on GitHub** (its last log line `integrated`):
  relabel it at Integration, then hand back, and it merges through case (ii) with nothing redone. A code
  cause stays its own call.
  ```
  printf '%s' "<the cleared cause>" | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py set-aside --note <task note> --kind integration | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py reconcile --result -
  ```
- **Missing branch or CLOSED PR at Integration** (input-gated; `hand-back` refuses an at-Integration note
  with no `pr:`). Offer: restore (the landing-register check, a plain push of the local branch if it exists,
  never forced, `gh pr reopen`, then hand back), recut (below), defer it (§ 5) or leave it.
- **Recut, only on Lachy's explicit ask:** a fresh start from the queue's current base.
  1. Run the landing-register check (execute § 2.5).
  2. Retire the branch with § 5's retire block plus `git -C <repoPath> branch -D <inputs.branch>`.
  3. Relabel it to its own run: the same pipe as above with `--kind own`.
  4. Run `hand-back`. Its old `## Integration log` lines survive and are harmless.
- **Leash:** once per task per repair run. If a task blocks again after its one retry in this run, stop
  retrying it: surface it with its new diagnosis and offer *more guidance and one more retry* / *defer it*
  (§ 5) / *leave it set aside*. Don't loop.
- **Hand-off, when no lead is live and no pause stands:** execute's queue loop, entered at its §4.5 resume
  (*Cold resume*): execute § 2.5 first (then § 2.6), then `reconcile-rollout.py resume`, then the loop with
  `--running ""` (this session holds no task call). Execute's § 2.7 pushed-base gate (entry points only)
  does not run on this hand-off; the next `/thread:execute [[<rollout>]]` runs it. Under a live queue the
  hand-backs are enough: the live lead's next `next` picks them up.

### 5. Defer a wedged task (dependency-aware)

When the user opts to defer a task (or declines further retries on a re-blocked one):

1. **Compute the dependent closure.** From the status task list, every task whose `depends-on:` or
   `blocked-by:` names this task, transitive (a dependant's dependants too), followed through `merged_into:`
   tombstones (a task folded into this one counts as this one).
2. **No dependants** → **clean defer**. The retire block:
   ```
   git -C <repoPath> worktree remove -f -f <repoPath>/.claude/worktrees/<slug>   # if it exists; -f -f: execute locks task trees against the reaper
   gh pr close <pr> --delete-branch --comment "deferred out of [[<rollout>]] — back to backlog"   # if a PR exists
   git -C <repoPath> update-ref -d refs/integration-anchor/<inputs.branch> <X>   # if the ref exists; <X> is its current value
   ```
   then:
   ```
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py defer --tasks <slug> --rollout <rollout-note>
   ```
   then delete the task's `## Queue` row and its `## File-sets` line from the rollout note, and write a dated
   `## Notes` line (`- <YYYY-MM-DD> repair: [[<slug>]] deferred: <reason>`). `defer` clears `rollout:` and
   `owner:` and the run stamps and sets `status: open`, so a future `/thread:schedule` re-plans it. The
   `gh pr close --delete-branch` is **not gated on the landing register**, on purpose: it only removes the
   rollout's own branch and PR from a task the user chose to defer, and lands nothing on the default branch,
   so it is cleanup like a pause (`execution-fit.md` § Dispatch blockers, *Landing register*).
3. **Has dependants** → **ask**: *"[[B]], [[C]] depend on [[A]]: defer the whole chain, or keep and fix
   [[A]]?"* Defer the chain → A and its closure, each through the clean defer. Keep and fix → back to § 3b or
   § 4 on A. A dependant already running or integrating under a live lead → ask, and never write it.

### 6. Run the queue to completion + log

Follow execute's loop from the hand-off (§ 4) until it halts or completes, with the same stop conditions as
execute. This hand-off enters execute's §4.5 resume directly, so execute's § 2.7 pushed-base gate (entry
points only) does not run; the next `/thread:execute [[<rollout>]]` runs it. Execute's **completion
ceremony** then runs on the (possibly reduced) task set. Ensure the rollout's `## Completion log` records
every repair action, copied from the dated `## Notes` records this and earlier runs wrote: hand-backs (task +
stage), decisions injected (task + value), gates signed, raises (task + new budget), merged-never-marked tasks
flipped by `resume` (task + PR), tasks deferred (task + reason + dependants moved with it), and the
escalations of § 3c.

## Don'ts

- **Don't treat `paused:` or `pause_requested` as drift.** A pause is intentional (§ 1): repair never clears
  the stamp or the flag, never hands back, never runs `resume` or the loop under either; reinstate, for a
  stamped pause only, is `/thread:execute [[<rollout>]]`.
- **Don't act on a live queue's running or integrating note.** No `resume`, no loop, no write to it, even
  when an empty `/workflows` was seen from a session other than the owner's.
- **Don't re-implement Integration, merge or convergence.** Set-aside → `hand-back` at its stage; merged,
  never marked → `resume`; everything else → execute's loop. If you're writing a start, integrate or merge
  loop, you've turned the conductor into an engine: stop.
- **Don't merge anywhere but execute's merge step.** No inline `gh pr merge`, no `--admin`, no force-push.
  The engine keeps sole merge authority (README → *Coexistence with Orca*).
- **Don't redo what a set-aside task already finished.** At Integration, retry Integration only; a recut is
  only on Lachy's explicit ask.
- **Don't ask the user about agent-fixable blocks.** Hand them back silently (once); ping only for
  input-gated decisions, gates, a second block or a second raise.
- **Don't write a PR-less or RACE task's `status:`**, and never re-call merge-task for a RACE.
- **Don't defer a task with dependants alone.** Compute the closure first; defer the chain or fix it.
- **Don't loop.** One retry per task per run; then surface and let the user decide.
- **Don't run repair under the built-in `/loop` (and never suggest it).** Repair is input-gated by design: it
  asks the user decisions no agent can make, so an unattended loop would either hang on the question or
  steamroll it. Unattended driving belongs to execute (§8: the Stop-hook driver + heartbeat cron) and status
  (read-only sweeps); repair stays a hands-on verb.
