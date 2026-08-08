# `orient` is project-altitude `next`, and dispatch is an artefact

`thread:orient` joins the family as the *project-altitude* router: where
`next` reads one live thread and recommends its next move, `orient` reads a
whole project/area (sub-project notes, task frontmatter, THREAD.md states,
git state) after Lachy has been away from it, recommends ONE best use of his
time, then asks how he wants to steer — autonomous background batches,
hands-on focus, both, or report-only. When it dispatches, it emits **launch
artefacts** (prompt files + scoped-profile terminal one-liners), never
launched sessions.

We chose this because the originating problem (2026-08-08 Animately
parallel-dispatch session, task `build-fanout-dispatch-skill`) turned out not
to be "a fanout tool" but "returning to a project with many balls in the air":
the audit and the steering question are the essence; dispatch is one output.
That is thread-family territory — picking work up, setting it down, deciding
where attention goes — not wave territory: wave is a PR/merge engine and the
wrong fit for ops/MCP-session work (`feedback_wave_fit_test`). Orient *refers*
PR-shaped clusters to `/wave:*` rather than growing a second engine.

## Considered Options

- **Standalone skill in `~/.agents/skills/`** — the original task's framing.
  Rejected: the audit/steer/route flow is the thread family's "where does
  attention go?" moment at higher altitude; a standalone would duplicate the
  family's routing idioms and fragment the namespace.
- **A wave member (`/wave:audit`)** — keeps "orchestration" in one namespace.
  Rejected: wave's value is PR convergence machinery; most orient output is
  non-PR ops work against external services + the vault.
- **Thread member, dispatch-as-artefact (chosen)** — audit → recommend →
  steer → route. Sessions launch under scoped `cc-*` profile aliases because
  full-profile sessions cannot fan out sub-agents ("Prompt is too long") and
  worktrees lose gitignored MCP configs — batches must start in place, in
  separate scoped sessions, which only terminal one-liners reliably deliver
  today (Desktop chips wrapped prompts in `/grill-with-docs` on 2026-08-08).

## Consequences

- Orient is the third router-shaped member; the single-recommendation
  discipline from `next` applies unchanged (one focus item, never a menu of
  recommendations).
- A new vault frontmatter field, `dispatched: YYYY-MM-DD`, marks a task as
  in-flight so parallel or repeated orient runs can't double-dispatch it; the
  batch session's end-of-run note update supersedes it, and `--debrief`
  clears stale stamps.
- Workspace launch knowledge stays where it lives — the workspace registry
  and each workspace's `CLAUDE.md § Launch profiles` — orient reads it and
  maintains no manifest of its own.
- Fire-and-forget by default: batch prompts mandate end-of-run task-note
  updates, so re-running orient *is* the debrief; `--debrief` exists for the
  explicit sweep.
