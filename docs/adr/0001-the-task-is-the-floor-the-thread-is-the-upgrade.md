# The task is the floor; the thread is the upgrade

Every `thread:stash` and `thread:defer` writes a **self-contained Obsidian task**
(`Work/Tasks/<slug>.md`, routed to the right project) that carries everything
needed to resume: summary, copy-paste resume prompt, links. A `THREAD.md` is
only created or updated when the work is thread-worthy (8+ substantive turns,
deferred decisions, artefacts). The task never depends on a thread existing.

We chose this because the system's whole point is that shutting an agent down
must never lose context — and the surface Lachy actually reviews daily is the
vault (day pages, TaskNotes agenda), not agent-side THREAD.md files. If the
capture's completeness depended on a THREAD.md, every one-off conversation
would either manufacture a hollow thread file or produce a lossy task.

## Considered Options

- **THREAD.md-first** — always create/update a thread; the task is a thin
  pointer at it. Rejected: manufactures thread files for one-off work, and a
  pointer-task is useless on a day page without opening a second file.
- **Task-only** — never write THREAD.md from the routes. Rejected: for
  genuinely long-running work the thread file is the richer, append-over-time
  surface; collapsing it into a task loses the session log and quirks ledger.
- **Task as floor, thread as upgrade (chosen)** — the task is always complete
  on its own; a THREAD.md is created/updated only when the work earns it, and
  the task links to it as extra depth.

## Consequences

- Tasks written by stash/defer are larger than typical vault tasks (they embed
  a resume prompt). Accepted: self-containment is the invariant.
- Resuming from the task alone is always possible, in any harness — the
  THREAD.md link is enrichment, not a dependency.
- Pickup auto-completes the task (the capture's job is done once the thread is
  live again); if the work is set down again, a fresh capture is written.
  Dedup: re-deferring an *open* capture updates it in place instead.
