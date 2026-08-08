# thread — a continuity family for agent threads

Claude Code plugin. Solves one problem: **too many live agent threads, and
shutting one down feels like losing context.** Every route out of a thread
captures its state somewhere durable — an Obsidian task on the right project,
a THREAD.md, a handoff prompt — so closing a session is always safe.

## Members

| Member | Moment | What it does |
|---|---|---|
| `/thread:open` | resume/start | Open or create a durable `THREAD.md`; also picks up a stashed/deferred task (`/thread:open [[task]]`) and auto-completes it. |
| `/thread:next` | "what's my move?" | Router/advisor: summarise where we are, recommend a move, dispatch to a sibling route. |
| `/thread:orient` | back on a project, balls in the air | Project-altitude router: audit an area's open work, recommend the best use of time, ask the steering mode (autonomous batches / hands-on / mixed / report), emit dispatch artefacts or route to `open`/`wave`. |
| `/thread:stash` | out of time, not my focus | Self-contained vault task, **no date**. Locked in, safely dormant. |
| `/thread:defer [day]` | tomorrow's problem | Self-contained vault task **scheduled** for `[day]` (default tomorrow). Surfaces on that day's page. |
| `/thread:handoff` | fork now | Compact this conversation into an inline copy-paste prompt for a fresh agent. |
| `/thread:close` | done | Persist to THREAD.md + auto-commit; end-of-thread ritual. |

## Design

- `CONTEXT.md` — the domain glossary (Thread vs THREAD.md, Task floor, Route
  vs Router, Thread-worthy, Pickup).
- `docs/adr/0001` — the task is the floor; the thread is the upgrade.
- `docs/adr/0002` — `next` is a sibling, not a parent.
- `docs/adr/0003` — `orient` is project-altitude `next`; dispatch is an artefact.
- `skills/_shared/task-writer.md` — the single spec for writing + routing the
  vault task (dedup, day parsing, resume prompt, pickup auto-complete).

## Lineage

Absorbs three previously flat skills: `/thread` (→ `thread:open`), `/close`
(→ `thread:close`), and `/handoff` (→ `thread:handoff`; originally from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT — attribution
retained in the skill).

## Install

Dev: `claude --plugin-dir ~/repos/tools/thread-skill`.
Installed as a marketplace plugin from `lachyts/thread-skill` (same pattern as
`lachyts/wave-skill`).
