# Thread — domain glossary

The ubiquitous language of the `thread:*` plugin. Terms only — no implementation.

- **Thread** — a live agent conversation carrying working context. Ephemeral;
  dies with the session. (Deliberately overloaded with the file below — the
  plugin name trades on the overlap, but the two must never be confused in
  skill prose.)
- **THREAD.md** — the durable state-of-play *file* a thread can be persisted
  into. Project-side (`~/Projects/<Area>/<Project>/THREAD.md`) or shared
  (`~/repos/workspaces/_shared/threads/<slug>.md`). Agent-facing.
- **Route** — a decisive member (`stash`, `defer`, `handoff`, `close`) that
  disposes of the current thread with known intent.
- **Router (`next`)** — the undecided sibling. Answers "what's my next move?"
  then dispatches to a route. A sibling, not a parent.
- **Orient** — the project-altitude router: audits a whole project/area (not
  one thread), recommends the best use of time, asks the steering mode, then
  routes — dispatch artefacts, `open`, or `/wave:*`.
- **Batch** — a parallel-safe cluster of open work (disjoint files/surfaces)
  matched to the narrowest covering launch profile; the unit orient
  dispatches.
- **Dispatch artefact** — what an orient dispatch actually produces: a batch
  prompt file under `<workspace>/.scratch/orient/` plus a scoped-profile
  terminal one-liner. Artefacts are emitted, never launched.
- **`dispatched:` stamp** — `dispatched: YYYY-MM-DD` task frontmatter written
  at emission; marks the task in-flight so orient never double-batches it.
  Superseded by the batch session's end-of-run note update; stale stamps are
  cleared by `--debrief`.
- **Task floor** — the invariant: every stash/defer writes a self-contained
  vault task routed to the right project. The guarantee that makes shutting an
  agent down feel safe.
- **Thread-worthy** — passes the thread-shape test (8+ substantive turns,
  deferred decisions, artefacts produced). Only thread-worthy work earns a
  THREAD.md.
- **Stash** — dispose dormant, no date. "Not my focus, lock it in."
- **Defer** — dispose onto a specific day (`scheduled:`). "Tomorrow's problem."
- **Handoff** — fork the working context to a fresh agent *now*; work continues
  immediately, this session ends.
- **Close** — the work is finished; persist + commit, end-of-thread ritual.
- **Pickup** — resuming a stashed/deferred thread from its task. Pickup
  auto-completes the capture task: the capture's job ends the moment the
  thread is live again.
