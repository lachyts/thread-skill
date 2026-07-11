# Wave

The domain language of the wave plugin — decomposing, scheduling, and executing a large multi-PR change
as a wave-by-wave convergence rollout. Terms here are wave-specific; general programming concepts are not.

## Planning structure

**Task**:
One PR-sized, independently-shippable unit, written as a single Obsidian task note
(`Work/Tasks/<project>-p<N>-<M>-<desc>`, `tags: [task, …]`) — the atom of the pipeline and the only
object on both ladders: planning (project → phase → task) and execution (rollout → wave → task).
_Avoid_: ticket, item, story, step.

**Phase**:
A project's roadmap tier — an ordered milestone (P1, P2, …) whose tasks carry `phase: N`. A human
planning concept only: phases order meaning, waves order merges, and the engine never reads `phase:`.
One phase = one rollout by convention. A phase is a plan, never a task — its note is
`Work/Phases/<project>-p<N>-<desc>` with `tags: [phase]`, and `/wave:split` de-tasks a legacy
task-tagged phase note when decomposing it.
_Avoid_: stage, iteration, wave.

## Rollout structure

**Rollout**:
A backlog of related tasks landed as one coordinated effort, described by a single Obsidian rollout note.
_Avoid_: batch, run, campaign.

**Wave**:
A set of tasks within a rollout that are safe to run in parallel because no two of them edit the same
file. Waves land in order; a later wave branches from the `main` that earlier waves merged into.
_Avoid_: round, phase, stage.

**Cursor**:
The durable record of how far a rollout has progressed — `merged_through_wave: N` in the rollout note.
The single source of truth for "where was I", resumed from rather than re-scanned from GitHub.
_Avoid_: checkpoint, pointer, progress marker.

**Dependent closure**:
The set of tasks that transitively depend on a given task via `depends-on:` / `blocked-by:` / body
wikilinks — the blast radius that must move together if that task is deferred.
_Avoid_: dependency tree, downstream.

## Task lifecycle

**Landed**:
A task whose work is final on `main` — note `status: done`, or `review`/`merged` awaiting confirmation.
A landed task is never re-dispatched on resume.
_Avoid_: finished, complete, shipped.

**Blocked**:
The umbrella for a task that did not land: `blocked` (verifier never went green), `plan-blocked` (plan
never approved), or `review-blocked` (work done but review rejected it, leaving an open PR).
_Avoid_: failed, stuck, errored.

**Input-gated block**:
A block that needs a human decision no agent can supply — a value, a design choice, an ambiguity. Re-
dispatching alone loops forever on the same wall; the decision must be written into the note first.
_Avoid_: manual block, human block.

**Agent-fixable block**:
A block a re-dispatched agent can resolve on its own — a real test failure, a missed case, concrete
review feedback. Repair retries these without asking the human.
_Avoid_: auto-block, soft block.

**Drift**:
A divergence between the vault's recorded state and live GitHub/git reality — most importantly a blocked
task whose PR actually merged out-of-band. `/wave:status` flags it; `/wave:repair` reconciles it to done.
_Avoid_: desync, staleness, mismatch.

**Clean defer**:
Taking a task out of a rollout back to the open backlog (clearing `wave:`/`rollout:`/`owner:`) so the
rollout can complete without it — permitted only when nothing in the rollout depends on it.
_Avoid_: drop, cancel, skip.

## Convergence engine

**Convergence**:
The per-task loop that drives a task to a mergeable state — plan-gate → verifier retry → master review.
Owned by `/wave:execute`.
_Avoid_: the pipeline, the build, processing.

**Engine**:
The component that *does* convergence (`/wave:execute` and its Workflow script). Spawns agents, runs the
verifier, merges PRs.
_Avoid_: runner, executor (as a synonym — `execute` is the engine's name, not a generic term).

**Conductor**:
A component that *orchestrates* the engine without re-implementing it (`/wave:repair`). It diagnoses,
captures decisions, reconciles drift, and hands off to the engine's resume — it never merges or converges.
_Avoid_: orchestrator, controller, wrapper.

**Situational report**:
The read-only output of `/wave:status` — the cursor, per-task state grouped by wave, each blocker and
what it needs, drift flags, and a single recommended next action. Never mutates anything.
_Avoid_: dashboard, summary, snapshot.

**Repair bridge**:
The path by which a blocked task is fixed and re-landed while the engine keeps sole merge authority —
now driven by `/wave:repair` (the human supplies decisions; Claude does the mechanics).
_Avoid_: handoff, recovery.

## Model tiering

**Tier**:
The model a task's agents run on — `opus` (the first-pass tier, for mechanical execution) or `fable`
(the escalation tier, for anything that has to be thought through). A task has exactly one tier at any
moment, and its judges follow it.
_Avoid_: model level, grade.

**Step-up**:
The planning-time, predictive assignment of the fable tier to a task — `/wave:schedule` stamps
structural or deep tasks before any evidence exists, from the task's shape alone.
_Avoid_: escalation (that's run-time), upgrade.

**Escalation**:
The run-time, evidence-driven flip of an opus task to fable at the first sign of hardness — a rejected
plan, a red one-shot verifier run, a rejected review round, or any first-pass block. One-way and
sticky: the task finishes on fable, and the flip is recorded durably so every later re-dispatch starts
there. Opus never iterates — the first pass is a one-shot, and iteration itself is fable's job.
_Avoid_: fallback (it suggests dropping DOWN to a degraded path — this is the opposite), retry,
promotion.
