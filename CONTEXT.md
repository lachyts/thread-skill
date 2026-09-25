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
  then dispatches to a route. A sibling, not a parent.
- **Orient** — the project-altitude router: audits a whole project/area (not
  one thread), recommends the best use of time, asks the steering mode, then
  routes by the execution-fit test — wave-shaped clusters to the rollout lane
  (`gather`/`schedule`), everything else to `open` or batch dispatch
  artefacts.
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
- **Handoff doc** — the durable brief `thread:handoff` (or the session-safepoint
  stop hook) writes to `<home>/docs/handoffs/<date>-<slug>.md` and commits —
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
- **Close** — the work is finished; persist + commit, end-of-thread ritual.
- **Pickup** — resuming a stashed/deferred thread from its task, or a handed-off
  thread from its handoff doc. Pickup auto-completes the capture — the task is
  marked done, the handoff doc consumed: the capture's job ends the moment the
  thread is live again.

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
- **Gather** — the roadmap-forming pass: loose, unphased open tasks → phases
  (cluster proposal → grilled meaning → mechanical writes). The inverse of
  split (plan → tasks); both converge on `schedule` when the work is
  wave-shaped. _Avoid_: triage, backlog grooming, auto-roadmap, sort.

## Rollout structure

- **Rollout** — a backlog of related tasks landed as one coordinated effort,
  described by one always-dated Obsidian note
  (`<slug>-rollout-<YYYY-MM-DD>`). _Avoid_: batch, run, campaign.
- **Wave** — a set of tasks within a rollout that are safe to run in parallel
  because no two of them edit the same file. Waves land in order; a later
  wave branches from the `main` earlier waves merged into. Since ADR 0009 the
  wave is a glossary object, not a namespace. _Avoid_: round, phase, stage.
- **Cursor** — the durable record of rollout progress:
  `merged_through_wave: N` in the rollout note. The single source of truth
  for "where was I". _Avoid_: checkpoint, pointer, progress marker.
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
  GitHub/git reality. `status` flags it; `repair` reconciles it.
  _Avoid_: desync, staleness, mismatch.
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
  `pause_requested` flag (finish + merge the current wave, exit paused).
  Hard: stop now; worktrees keep the work. _Avoid_: suspend, halt, abort.
- **Reinstate** — resuming a paused rollout: plain `execute` on the rollout
  note. No separate resume command. _Avoid_: restart, relaunch, unpause.

## Model tiering

- **Tier** — the model **and effort** bundle a task's agents run on: `opus`
  (first-pass, mechanical) or `fable` (escalation, anything that must be
  thought through). One tier per task at any moment; judges follow it; moving
  tier moves effort with it (ADR 0007). Per-task `effort:` frontmatter is the
  escape hatch, never a second ladder. _Avoid_: model level, grade, model
  (alone).
- **Step-up** — the planning-time, predictive assignment of the fable tier
  from the task's shape alone. _Avoid_: escalation (that's run-time), upgrade.
- **Escalation** — the run-time, evidence-driven flip of an opus task to
  fable at the first sign of hardness. One-way and sticky (ADR 0006).
  _Avoid_: fallback, retry, promotion.
- **Ceiling** — a run-wide cap on every tier decision (`args.maxTier`), set
  because the account's quota for the higher tier is exhausted. It names a
  resource fact, never a judgement about a task, which is why it does not
  contradict ADR 0006's "no config switch" (ADR 0016). A capped tier is
  **terminal**: it runs the full Ralph loop and takes the higher tier's effort
  row, and a block on it is reported `tierCapped` rather than as a wall.
  _Avoid_: downgrade, throttle, cheap mode.
