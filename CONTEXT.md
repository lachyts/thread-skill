# Thread — domain glossary

The ubiquitous language of the `thread:*` plugin: one system that drives work
through time, from attention to merged PRs. Terms only — no implementation.

## The system

- **Lane** — one of the two dispatch surfaces every cluster of open work gets
  exactly one of: the **rollout lane** (`schedule` → `execute`: worktrees,
  PRs, convergence engine, auto-merge) or the **session lane** (scoped
  sessions dispatched by calendar and attention: `defer`, a task's `## Launch`
  block via `open`, orient's cc-* batches).
- **Execution-fit test** — the single rule deciding a cluster's lane
  (`skills/_shared/execution-fit.md`). Decides hard, never as a preference.
- **Wave-shaped** — passes the fit test: converges on ONE code repo, lands as
  a PR per task, verifies machine-checkably inside the run. Shape only —
  count is never a criterion (ADR 0009).
- **Task floor** — the invariant: every stash/defer writes a self-contained
  vault task routed to the right project. The guarantee that makes shutting an
  agent down feel safe. The Task is also the shared atom of both ladders:
  planning (project → phase → task) and execution (rollout → wave → task).

## Continuity (threads and attention)

- **Thread** — a live agent conversation carrying working context. Ephemeral;
  dies with the session. (Deliberately overloaded with the file below — the
  plugin name trades on the overlap, but the two must never be confused in
  skill prose.)
- **THREAD.md** — the durable state-of-play *file* a thread can be persisted
  into. Project-side (`~/Projects/<Area>/<Project>/THREAD.md`), shared
  (`~/repos/workspaces/_shared/threads/<slug>.md`), or a **Repo thread** — a
  tool repo's own toplevel `THREAD.md` under `~/repos`, found by `open`'s
  repo-thread lookup; its slug is its front-matter `slug:`, else the repo
  directory's name. Agent-facing.
- **Route** — a decisive member (`stash`, `defer`, `handoff`, `close`) that
  disposes of the current thread with known intent.
- **Router (`next`)** — the undecided sibling. Answers "what's my next move?"
  then dispatches to a route. A sibling, not a parent. Its *keep going* may
  carry a **compact recommendation**, which only Lachy acts on: compact is a
  recommendation inside keep going, never a route.
- **Orient** — the one shaping verb, at project altitude: audits a whole
  project/area (not one thread), then reshuffles it (the default on pickup),
  steers it as it stands, or just looks. It schedules wave-shaped work itself,
  routes the rest by the execution-fit test, and ends with the **execute
  offer** (run the rollout in a fresh session, here, or not yet). Pointed at a
  single plan, design note or brain dump it runs a **scoped reshuffle** of that
  note alone. Absorbs the former `split` and `gather` verbs (ADR 0027).
- **Batch** — a parallel-safe cluster of open work (disjoint files/surfaces)
  matched to the narrowest covering launch profile; the session-lane unit
  orient dispatches. Never contains a wave-shaped cluster.
- **Dispatch artefact** — a batch's durable contract: the prompt file under
  `<workspace>/.scratch/orient/`. Since ADR 0010 orient launches the batch
  session from it itself — the steering answer is the sole authorisation —
  and a hand-run terminal one-liner survives only as the no-cmux fallback.
- **`dispatched:` stamp** — `dispatched: YYYY-MM-DD` task frontmatter written
  at emission; marks the task in-flight so orient never double-batches it.
  Superseded by the batch session's end-of-run note update; stale stamps are
  cleared by `--debrief`.
- **Thread-worthy** — passes the thread-shape test (8+ substantive turns,
  deferred decisions, artefacts produced). Only thread-worthy work earns a
  THREAD.md.
- **Stash** — dispose dormant, no date. "Not my focus, lock it in."
- **Defer** — dispose onto a specific day (`scheduled:`). "Tomorrow's problem."
- **Handoff** — fork the working context to a fresh agent *now*; work continues
  immediately, this session ends. Always produces a **handoff doc** (below) and
  a paste-ready prompt; in Codex Desktop also a visible native task. Model-invocable
  on explicit fork intent (or router dispatch) only — never self-initiated because
  the context feels long; that recommendation belongs to `next`.
- **Handoff doc** — the durable brief `thread:handoff`, its only writer, writes
  on explicit fork intent only (Lachy's ask, or his pick from a router's menu;
  never self-initiated) to `<home>/docs/handoffs/<date>-<slug>.md` and commits
  and lands (pushed, merge queued, never waited on) —
  `<home>` the unit directory: the project dir under `~/Projects/`, the
  workspace dir under `~/repos/workspaces/`, else the git toplevel.
  Lifecycle `pending → consumed → deleted`: marked `status: consumed` at
  pickup, deleted in the consumer's close-out commit; git history is the
  archive, so the working tree lists only in-flight handoffs. One doc, one
  consumer. Never OS temp, never the vault (ADR 0017). A doc with no `status:`
  front matter is **legacy** — listed by `close`, never touched. _Avoid_: temp
  doc, compaction file, handoff note.
- **Continuation** — the part of a thread's follow-up that the next session,
  working from a pending handoff doc, would do. While the doc is pending,
  `close` routes it to the doc (refreshing it in place) and never to a vault
  task. Its complement is a **loose end** — work outside the thread's scope
  line — which reaches the task menu as before (ADR 0017). _Avoid_: next
  steps (ambiguous), remaining work.
- **Capture** — the self-contained vault task `stash` or `defer` writes to set
  a thread's next move down, marked as a capture by its writer. Only a capture
  is superseded when the thread continues elsewhere. A loose end filed at
  `close` may link the same thread and is still never a capture. _Avoid_:
  thread task (any task can link a thread), backlog item.
- **Close** — the work is finished; persist + commit, end-of-thread ritual.
  For vault tasks close only proposes, with one exception: it marks a task
  this session explicitly worked `done` without asking when the work is on
  the default branch (or is not code) and its Verify line ran green; a task
  short of that becomes a mark-done question (ADR 0026). Close also lands
  what it can: it pushes the close-out and queues its merge, and reviews the
  session's own branch before queuing its merge.
- **Landing** — taking a session's committed work all the way to a merged
  default branch and a clean checkout: push, PR, review, fixes, CI retries,
  merge, cleanup. Agents own it end to end and take as long as it needs;
  Lachy is asked only for a decision no agent can make. _Avoid_: shipping
  (a release), publishing, admin.
- **Landing register** — the one estate-wide list of repos agents must never
  push to on their own. Any repo Lachy can push to lands unless the register
  names it. _Avoid_: allow-list (it is a deny-list), push list.
- **Own branch** — the feature branch whose work this session did. Close may
  push, review and merge it; a branch close can't prove is its own is only
  reported. _Avoid_: current branch (it may be another session's), my branch.
- **Close-out PR** — the pull request carrying close's own bookkeeping
  (THREAD.md, handoff-doc refreshes and deletions). Its merge is queued at
  close and happens on green, with no review. _Avoid_: docs PR, thread PR.
- **Pickup** — resuming a stashed/deferred thread from its task, or a handed-off
  thread from its handoff doc. Pickup auto-completes the capture — the task is
  marked done, the handoff doc consumed: the capture's job ends the moment the
  thread is live again.
- **Set-down** — any route that puts a thread's work down: `stash`, `defer`,
  or `close` when the thread has a concrete next task (`/thread:open save` is
  not one). The only agent writer that overwrites the two next-action fields;
  the most recent set-down wins, and Lachy may edit either field any time.
  Defined estate-wide in `~/repos/workspaces/_shared/CONTEXT.md` § Next action
  (estate ADR 0008). _Avoid_: park (a project status), save.
- **Next action** — a task's `next_action:` (estate ADR 0008): one line,
  verb-first, one physical action. A set-down takes it from the resume
  prompt's `Next move`, or close from the next step it writes into THREAD.md.
  _Avoid_: next step (vague), todo.
- **Next task** — a project note's `next_task:` (estate ADR 0008): one
  wikilink naming the task that is up; the project shows that task's next
  action and holds no text of its own. A set-down points it at its task
  (stash and defer: the capture; close: its concrete next task); `orient`
  fills it only when blank. Area notes carry none. A link to a done, merged,
  dropped, archived or missing task is a **dead link**: read as blank
  everywhere, and no sweep or pickup clears it — it stays until the next
  set-down, a fill-blank writer or Lachy replaces it. _Avoid_: up next, focus task.

## Memory capture (close-side)

- **Four-verb triage** — the save-time resolution of every memory candidate
  against existing memory: `ADD`, `UPDATE <file>`, `SUPERSEDE <file>`, or
  `NOOP`. NOOP is a success state, never a failure to capture.
  _Avoid_: save/skip, dedupe pass.
- **Provisional** — an auto-saved memory not yet corroborated; the curator
  promotes it to active on a later recall and archives it if none comes.
  _Avoid_: draft, pending, tentative.
- **Provenance** — who initiated a memory: `close-inferred`, `user-explicit`,
  or `legacy`. Sets the prune bar (explicit saves are harder to cull).
  _Avoid_: source, origin.
- **Recall** — a live session Reading a memory topic file; the usage signal,
  harvested daily from session transcripts. Index loads never count.
  _Avoid_: hit, access, view.
- **Curator** — the weekly autonomous pass holding sole destructive authority
  over memory (promote, expire, decay-archive, merge, demote, rebuild
  indexes). Lives outside this repo; close only writes what it reads.
  _Avoid_: garbage collector, janitor, cleanup job.
- **Permanent** — the exemption class never recency-culled: identity, health,
  hard constraints. _Avoid_: pinned, sticky.
- **Demotion** — the curator verb moving a global memory to the one workspace
  whose sessions actually recall it. _Avoid_: downgrade, relocation.
- **Seat** — the workspace altitude of a METHOD ledger,
  `~/repos/workspaces/<workspace>/knowledge/METHOD.md`; defined in
  `~/repos/workspaces/_shared/CONTEXT.md` § Method. _Avoid_: workspace method.
- **Estate** — the everywhere altitude,
  `~/repos/workspaces/_shared/knowledge/METHOD.md`; defined in
  `~/repos/workspaces/_shared/CONTEXT.md` § Method. _Avoid_: global method,
  org method.
- **Process observation** — the category-7 scan (close, stash and defer): a
  stage-shift, pivot, reusable move, revealing failure, or cross-workstream
  effect in *how* a project is being made. Stage-gated; routed by altitude
  (project / seat / estate) via the method skill's routing test. _Avoid_:
  learning, insight, retro item.
- **METHOD.md / Candidates** — the per-altitude surface (ADR 0012, 0015; owned
  by the `method` skill in agents-config) the category-7 scan (close, stash and
  defer) appends process observations to. Candidate rows carry their own
  six-token status vocabulary
  (`[provisional]`/`[confirmed]`/`[rejected]`/`[deferred]`/
  `[contradicted]`/`[correction]`, the last an annotation on another row — not
  an observation, never clustered) — deliberately distinct from the memory
  frontmatter's provisional/active/superseded, which describes memory files,
  not candidate rows. Those writers write candidates only: nothing enters the
  gate-protected `## Method` section, at any altitude, without an interactive
  `/method` apply Lachy has ruled on. _Correction 2026-09-15 (evening)_: a
  `/method` pass under the skill's working agreement — routine curation automatic,
  scheduled headless from the daily sweep, only consequential exceptions ruled by
  Lachy in the pass's vault task (workspaces ADR 0003, second amendment); the
  candidates-only rule for these writers is unchanged. _Avoid_: process ledger,
  retro doc, processes.md.

## Planning structure (rollout lane)

- **Task** — one PR-sized, independently-shippable unit, written as a single
  Obsidian task note (`Work/Tasks/<project>-p<N>-<M>-<desc>`,
  `tags: [task, …]`). _Avoid_: ticket, item, story, step.
- **Phase** — a project's roadmap tier: an ordered milestone (P1, P2, …) whose
  tasks carry `phase: N`. A human planning concept only: phases order meaning,
  waves order merges, and the engine never reads `phase:`. One phase = one
  rollout by convention. A phase is a plan, never a task (ADR 0005).
  _Avoid_: stage, iteration, wave.
- **Reshuffle** — the usual reason a project is picked up after time away:
  re-examine *all* its open work (stray bugs, brain dumps, loose tasks and
  unstarted phases alike), rethink what the next steps are, and leave it
  shaped for the lanes (cluster proposal → grilled meaning → mechanical
  writes). Scoped to one note, it turns a single plan or design into tasks.
  A bare look-around with no reshaping is the rarer case. Replaces the former
  gather (loose tasks → phases, existing roadmap fixed) and split (plan →
  tasks) passes. _Avoid_: gather, split, re-plan, re-triage, backlog grooming.
- **Clear / unclear item** — a reshuffle's first sort of every open item.
  Clear ones (the body already says what to do) go straight to the gate;
  unclear ones (brain dumps, one-liners) are grilled, cluster by cluster,
  highest value first. The grill may stop at any point: what is resolved is
  written, the rest stays loose for the next reshuffle. _Avoid_: triage.
- **Brain dump** — a loose task note holding raw, unspecced intent, often
  several ideas at once. A reshuffle **unbundles** it: one task per idea, each
  grilled into a real body. _Avoid_: capture (that is stash/defer's task).
- **Reach tiers** — what a reshuffle may change, by an item's state: **in
  flight** and other **frozen** items (possibly landed, thread captures) are
  context only; **unstarted** phased work is movable; **loose** work is fully
  open, including re-homing and pull-ins across projects. Defined in
  `skills/orient/reshuffle.md` R1. _Avoid_: locked, pinned.
- **Clear / unclear item** — a reshuffle's first sort of every open item.
  Clear ones (the body already says what to do) go straight to the gate;
  unclear ones (brain dumps, one-liners) are grilled, cluster by cluster,
  highest value first. The grill may stop at any point: what is resolved is
  written, the rest stays loose for the next reshuffle. _Avoid_: triage.
- **Brain dump** — a loose task note holding raw, unspecced intent, often
  several ideas at once. A reshuffle **unbundles** it: one task per idea, each
  grilled into a real body. _Avoid_: capture (that is stash/defer's task).
- **Reach tiers** — what a reshuffle may change, by a task's state:
  **in flight** (in a live rollout, dispatched, or in progress) is frozen,
  read for context only — its scope, phase and body never change, though
  schedule may still re-derive its wave when a superseding rollout takes it
  over, and new work may join its phase for a later rollout; **unstarted** phased work is movable (re-phase, merge, split, drop,
  retire the phase); **loose** work is fully open, including re-homing to
  another project. Thread captures (stash/defer's `thread`-tagged tasks) are frozen like
  in-flight work. The tiers hold across projects: a reshuffle reads related
  projects (parked or being absorbed ones especially) and may pull their
  unstarted phases or tasks into its target, leaving a pointer behind.
  _Avoid_: locked, pinned.

## Rollout structure

- **Rollout** — a backlog of related tasks landed as one coordinated effort,
  described by one always-dated Obsidian note
  (`<slug>-rollout-<YYYY-MM-DD>`). At most one is live per repo; new
  wave-shaped work supersedes it rather than running beside it (orient § 6,
  ADR 0027). _Avoid_: batch, run, campaign.
- **Wave** — a set of tasks within a rollout that are safe to run in parallel
  because no two of them edit the same file. Waves land in order; a later
  wave branches from the `main` earlier waves merged into. Since ADR 0009 the
  wave is a glossary object, not a namespace. Retired (ADR 0030): a rollout
  is a **Queue**, with no wave mode to opt back into, and a wave rollout in
  flight migrates onto it. _Avoid_: round, phase, stage.
- **Queue** — how a rollout runs since ADR 0030: up to the parallel ceiling's worth of
  tasks at once, each started from the `main` of its moment; when one merges
  the next starts. Only dependencies and a **Solo** task hold a task back,
  never a shared file. _Avoid_: wave (the old grouping), batch (the session
  lane's).
- **Solo** — a task in a Queue that runs alone: it starts only when nothing
  else is running, and nothing starts until it merges. For a sweeping change
  that every concurrent task would otherwise have to redo its work around
  (ADR 0030). _Avoid_: barrier, exclusive, wave of one.
- **Integration** — the serial step between a task's approval and its merge,
  one task at a time: rebase onto the latest `main` in its own worktree, an
  implementer on the Top rung resolves any conflict, the full verifier runs
  again, and a short re-review follows when the integrator wrote code or a
  PR landed since the task's start shares a file with it. A task that cannot
  be integrated is **set aside** (blocked, its dependants waiting) and the
  queue runs on (ADR 0030). _Avoid_: update-branch (GitHub's merge-in, which
  re-verifies nothing without CI), rebase (only its first step).
- **Cursor** — the durable record of rollout progress, the single source of
  truth for "where was I". Under a Queue (ADR 0030) it is not stored: it is
  the rollout's task notes, a task marked done being a task merged. (Wave
  rollouts kept `merged_through_wave: N` on the rollout note.)
  _Avoid_: checkpoint, pointer, progress marker.
- **Dependent closure** — the set of tasks transitively depending on a task
  via `depends-on:` / `blocked-by:` / body wikilinks — the blast radius that
  must move together if it's deferred. _Avoid_: dependency tree, downstream.

## Task lifecycle (rollout lane)

- **Landed** — work final on `main` (`status: done`, or `review`/`merged`
  awaiting confirmation). Never re-dispatched on resume.
  _Avoid_: finished, complete, shipped.
- **Blocked** — the umbrella for a task that did not land: `blocked` (verifier
  never green), `plan-blocked` (plan never approved), or `review-blocked`
  (open PR, review rejected). _Avoid_: failed, stuck, errored.
- **Input-gated block** — a block needing a human decision no agent can
  supply; the decision must be written into the note before re-dispatch.
  _Avoid_: manual block, human block.
- **Gated input** — a human authorisation a task's plan declares up front
  (API spend with a cap, credentials, an irreversible action). Always pauses
  for sign-off, even in continuous mode (ADR 0008).
  _Avoid_: approval item, spend gate, pre-approval.
- **Agent-fixable block** — a block a re-dispatched agent can resolve alone;
  repair retries these without asking the human. _Avoid_: auto-block, soft block.
- **Drift** — divergence between the vault's recorded state and live
  GitHub/git reality. Within a rollout, `status` flags it and `repair`
  reconciles it. Across a project it is finished work still marked open: a
  phase whose tasks have all landed, or a task whose PR has merged. `orient`
  flags it and fixes the unambiguous items on a Reshuffle or Steer only
  answer (ADR 0026, 0027). _Avoid_: desync, staleness, mismatch.
- **Clean defer** — taking a task out of a rollout back to the open backlog
  (clearing `wave:`/`rollout:`/`owner:`), permitted only when nothing in the
  rollout depends on it. _Avoid_: drop, cancel, skip.

## Convergence engine

- **Convergence** — the per-task loop driving a task to mergeable: plan-gate →
  verifier retry → master review. Owned by `execute`.
  _Avoid_: the pipeline, the build, processing.
- **Engine** — the component that *does* convergence (`execute` and its
  Workflow script). Spawns agents, runs the verifier, merges PRs.
  _Avoid_: runner, executor (as a generic term).
- **Accumulated feedback** — the by-round history of judge rejections,
  threaded into every later reviser and judge in both gated loops (plan and
  review). In the review loop the latest round is the reviser's work order
  and earlier rounds are anti-regression constraints; the judge carries an
  anti-goalpost discipline. _Avoid_: feedback log, memory (alone).
- **Step-back round** — the round-3+ revision round, triggered by two
  accumulated rejections: the reviser stops patching and is licensed to
  restructure the approach — deviations from the approved plan permitted but
  always declared. The re-planning lever without re-entering the plan gate.
  _Avoid_: re-plan round, redesign.
- **Ceiling approval** — an approval on the final review round with real
  rejection history; always leaves an auditable `## Review history` record
  on the task note. _Avoid_: barely-passed, last-chance approval.
- **Conductor** — a component that *orchestrates* the engine without
  re-implementing it (`repair`). Diagnoses, captures decisions, reconciles
  drift, hands off to the engine's resume — never merges or converges
  (ADR 0004). _Avoid_: orchestrator, controller, wrapper.
- **Situational report** — the read-only output of `status`: cursor, per-task
  state by wave, blockers, drift flags, one recommended next action.
  _Avoid_: dashboard, summary, snapshot.
- **Repair bridge** — the path by which a blocked task is fixed and re-landed
  while the engine keeps sole merge authority. _Avoid_: handoff, recovery.
- **Pause** — stopping a rollout run without losing its place. Soft: a
  `pause_requested` flag (start nothing new, let what is running integrate
  and merge, exit paused; ADR 0030).
  Hard: stop now; worktrees keep the work. _Avoid_: suspend, halt, abort.
- **Reinstate** — resuming a paused rollout: plain `execute` on the rollout
  note. No separate resume command. _Avoid_: restart, relaunch, unpause.

## Model ladder

- **Ladder** — the operator's ordered list of **Rungs**, bottom first, held in
  one place outside any rollout. Absent, a built-in ladder applies (opus,
  then fable). Changing models or efforts is an edit to it, never a release
  (ADR 0029). _Avoid_: matrix, tier list, config (alone).
- **Rung** — one step of the Ladder: a model plus the efforts its roles run
  at (the code-writing roles, the plan judge, the master review). Two rungs
  may share a model, so an effort step and a model step are the same move.
  A task is on one rung at any moment; its judges run on it too. Replaces
  **Tier** (ADR 0007), retired. _Avoid_: tier, model level, grade, model
  (alone).
- **Top rung** — the Ladder's last rung: the ceiling every task and every
  Integration is capped at. Replaces **Top tier** and **Ceiling** (ADR 0024,
  ADR 0016), retired. A task on it cannot climb. _Avoid_: top tier, ceiling,
  max tier, default model.
- **Starting rung** — the planning-time, predictive choice to start a hard
  task above the bottom rung, from its shape alone. Replaces **Step-up**'s
  `model: fable`; the only per-task position a task may hold (ADR 0029).
  _Avoid_: escalation (that's run-time), upgrade, effort override.
- **Escalation** — the run-time, evidence-driven climb of one rung, at most
  once per stage (plan, implement, review), at that stage's first sign of
  hardness. One-way and sticky, never past the Top rung (ADR 0006, ADR
  0029). _Avoid_: fallback, retry, promotion.
