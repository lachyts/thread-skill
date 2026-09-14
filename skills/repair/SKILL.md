---
name: repair
description: 'Use to unstick a wave rollout that has stalled — run it whenever there''s an issue with the whole rollout, not a single task. Triggers on "repair [[rollout]]", "fix this rollout", "[[rollout]] is stuck", "sort out [[rollout]]", "unblock the rollout", or after /thread:status shows blockers/drift. A thin CONDUCTOR over /thread:execute (never a second engine): it diagnoses (runs /thread:status), reconciles drift, asks YOU only the decisions no agent can make and writes them into the notes, auto-retries agent-fixable blocks, dependency-aware-defers wedged tasks, then hands off to execute''s resume — the engine keeps sole merge authority. Scope: Obsidian + gh/git + the execute engine.'
---

# /thread:repair — sort out a stuck rollout (conductor, not an engine)

`/thread:repair [[rollout]]` is the **"something's wrong with this rollout — sort it out"** verb. You point
it at the rollout (never a single task); it figures out what's stuck across every wave, does the
mechanics, and asks you only the decisions no agent can make.

It is a **conductor**, not an engine (see `docs/adr/0004-repair-is-a-conductor-not-an-engine.md`). The
execute engine's worktree setup is already idempotent on re-dispatch and `resume-filter` already
re-attempts blocked tasks — so repair **reuses execute's resume** and adds only the three things
re-running execute can't do: reconcile **drift**, inject an **input-gated** decision, and **defer** a
wedged task. It never re-implements merge or convergence, and **the engine keeps sole merge authority**.

## Native runtime binding

Diagnosis and authorised deterministic reconciliation run in either harness.
Any re-dispatch goes through execute's native runtime preflight and its canonical
engine, with the original run's caller/session and native child identities.
Read `~/repos/workspaces/_shared/scripts/native_workflow.md`. A new harness must
not adopt or replay another session's pending claims. Recover the actual native
children first; otherwise report the unresolved ownership. Codex's detached
continuous Wave driver remains unavailable: preserve the diagnosis and resume
point, and do not claim that a request for continuous repair has been completed
by preparing a single-wave input. Never create a second convergence engine.

## Scope

Reads/writes `~/repos/obsidian/Work/Tasks/`, makes `gh`/`git` calls against the target repo, and drives
`/thread:execute`'s resume. Merges only ever happen via execute's `merge-wave.sh`.

## Invocation forms

```
/thread:repair [[giflab-rollout]]      # diagnose, fix what it can, ask only the decisions, resume to done
repair [[giflab-rollout]]            # natural language — same thing
fix this rollout                     # resolves to the rollout in context
```

## Skill flow

### 1. Diagnose

Resolve `[[<slug>]]` (ask if ambiguous). Run the **`/thread:status` scan with the live cross-check on**
(repair is about to act, so it always checks reality): get the per-task state JSON + the PR/worktree
drift flags + the repo path. Show the user the situational report first — they should see what they're
repairing.

**Paused is not stuck.** Two distinct pause states in the status JSON (execute → *Pausing + reinstating
a rollout*) — do not conflate them:

- `paused:` stamp → the rollout is deliberately paused; its unlanded tasks are waiting for reinstate,
  not wedged. Say so, point at `/thread:execute [[<rollout>]]` to reinstate, and stop.
- `pause_requested:` only (no stamp) → the rollout is still **live and mid-wave**; the pause takes
  effect at the next wave boundary. Report "pause pending — takes effect at the next wave boundary,
  nothing to do" (matching status's rendering) and stop. There is nothing to reinstate, and **never
  recommend re-invoking `/thread:execute` against a live run** — the running loop honours the flag itself.

In either case, continue into repair only for something genuinely independent of the pause (e.g. drift —
a PR merged out-of-band before the pause) and the user confirms; even then, **never clear the pause
stamp or the pending flag, and never resume** — reinstate belongs to `/thread:execute`.

### 2. Classify each non-landed task

For every task whose note status is not `done`, classify from its `blockerSummary` + live PR state:

| Class | Signal | Action |
|---|---|---|
| **landed-unconfirmed** | `review` with an open PR | none here — execute's resume merges + `mark-done`s it |
| **drift** | `review-blocked`/`blocked` whose PR is verified **MERGED** | reconcile to done now (step 3a); never re-dispatch |
| **agent-fixable** | `blocked`/`plan-blocked`/`review-blocked`, PR not merged, feedback an agent can act on (test failure, missed case, concrete review note) | auto-retry via execute (step 4), no user input |
| **input-gated** | feedback signals a human decision — "human-decided", "supplied out-of-band", "needs a value", "ambiguous", "design choice" | ask you + inject (step 3b) |

When torn between agent-fixable and input-gated, treat it as **input-gated** (ask) — cheaper than
looping on the same wall.

### 3. Act on what doesn't need re-running

**3a — drift → done.** For each drift task, confirm the merge with `gh pr view <pr> --json state` ==
`MERGED`, then:
```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py resolve --tasks <slug>
```
(`resolve` refuses any note that isn't in a blocked state — the merge verification is *your* contract.)

**3b — input-gated → capture + inject.** This is the **only** time you ping the user. For each
input-gated task, `AskUserQuestion` with the specific decision its feedback needs (quote the feedback).
Then write the answer into the **task note body** so the re-dispatched agent reads it — either replace
the placeholder in place, or append/update a `## Repair input` section with the decision verbatim. The
lead session owns this edit; keep it deterministic (Edit the note directly — it's body content, not a
status transition).

### 4. Auto-retry the agent-fixable + just-injected tasks (hand off to execute)

These re-dispatch through the **existing** engine — do **not** write a new loop. Follow
`/thread:execute` §4.5 (the continuous per-wave resume): compute the still-to-dispatch set with
`reconcile-wave.py resume-filter`, run the Workflow one wave at a time, merge each wave with
`merge-wave.sh`, advance the cursor, `mark-done`. The re-dispatched agent reads the prior
`## Review-blocked feedback` / `## Blocker diagnosis` / `## Repair input` from the note.

**Leash (Decision: auto-retry, cap one):** retry each agent-fixable/just-injected task **once** per
repair run. If a task blocks **again** after its retry, **stop retrying it** — surface it to the user
with its new diagnosis and offer: *give more guidance & retry once more* / *defer it* (step 5) / *leave
it blocked*. Don't loop.

### 5. Defer a wedged task (dependency-aware)

When the user opts to defer a task (or declines further retries on a re-blocked one):

1. **Compute the dependent closure.** From the status task list, find tasks whose frontmatter
   `depends-on:` / `blocked-by:` references this task, or whose body wikilinks it as a dependency. Also
   note **file-overlap successors** — later-wave tasks sharing a file (the rollout's `## File-sets` block).
2. **No true dependents** → **clean defer**:
   ```
   git -C <repoPath> worktree remove --force <repoPath>/.claude/worktrees/<slug>   # if it exists
   gh pr close <pr> --delete-branch --comment "deferred out of [[<rollout>]] — back to backlog"   # if a PR exists
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py defer --tasks <slug> --rollout <rollout-note>
   ```
   (`defer` clears `wave:`/`rollout:`/`owner:` and sets `status: open`, so a future `/thread:schedule`
   re-plans it.) For any file-overlap successor, give a one-line confirm: *"[[B]] edits the same file and
   will now branch without this change — OK?"*
3. **Has true dependents** → **STOP**: surface the chain and `AskUserQuestion`: *"[[B]], [[C]] depend on
   [[A]] — defer the whole chain, or keep & fix [[A]]?"* If *defer the chain* → defer A + its closure
   together (each via the clean-defer steps). If *keep & fix* → return to step 3b/4 on A.

### 6. Resume to completion + log

Continue execute's per-wave resume until the last wave merges (or it legitimately halts on a red
required check / smart-halt — same stop conditions as execute). Execute's **completion ceremony** then
runs on the (possibly reduced) task set. Ensure the rollout's `## Completion log` records every repair
action: decisions injected (task + value), drift reconciled (task + PR), tasks deferred (task + reason +
any dependents moved with it).

## Don'ts

- **Don't treat `paused:` or `pause_requested:` as drift or a blocker.** A pause is intentional (see §1)
  — repair never clears the stamp or the pending flag, never resumes the loop, and never points a
  pending-only rollout (still live, mid-wave) at a re-invocation of execute; reinstate — for a stamped
  pause only — is `/thread:execute [[<rollout>]]`.
- **Don't re-implement merge or convergence.** Drift → `resolve`; everything else → execute's §4.5
  resume. If you're writing a dispatch/merge loop, you've turned the conductor into an engine — stop.
- **Don't merge anywhere but `merge-wave.sh`.** No inline `gh pr merge`, no `--admin`, no force-push.
  The engine keeps sole merge authority (README → *Coexistence with Orca*).
- **Don't ask the user about agent-fixable blocks.** Retry them silently (cap one); ping only for
  input-gated decisions or a second block.
- **Don't `resolve` a task whose PR isn't verified MERGED.** That would mask unfinished work — `resolve`
  is the out-of-band-merge gap-closer only.
- **Don't defer a task with true dependents alone.** Compute the closure first; defer the chain or fix it.
- **Don't loop.** One retry per task per run; then surface and let the user decide.
- **Don't run repair under the built-in `/loop` (and never suggest it).** Repair is input-gated by
  design — it asks the user decisions no agent can make, so an unattended loop would either hang on the
  question or steamroll it. Unattended driving belongs to execute (§8: the Stop-hook driver +
  heartbeat cron) and status (read-only sweeps); repair stays a hands-on verb.
