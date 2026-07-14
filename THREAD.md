---
slug: thread-skill
created: 2026-07-14
last_touched: 2026-07-14
state: active
scope: Build + maintain the thread:* continuity plugin (router + decisive routes)
---

# thread-skill — THREAD

## Where we are

v1.0.0 built 2026-07-14 from the approved plan (grilled twice, Fable
re-review). All six members written; migration of the flat skills and
workspace references done in the same change. Awaiting first real-world use —
live end-to-end tests need a fresh session with the plugin loaded.

## What's been built / decided

- Plugin scaffold mirroring wave: manifests, CONTEXT.md, docs/adr/, README.
- ADR 0001: the task is the floor; the thread is the upgrade.
- ADR 0002: `next` is a sibling, not a parent.
- Canonical THREAD-template.md home: `~/.agents/skills/thread/THREAD-template.md`
  (harness-neutral; `check-agent-parity.py` pins it).
- Pickup auto-completes the capture task (decided in design interview).
- Stash surfacing: `/weekly` "Stashed threads" pass (decided in design interview).

## Open questions / decisions pending

None right now.

## Known quirks (don't re-derive)

- Colon namespace (`thread:defer`) requires plugin packaging; skill frontmatter
  carries the bare `name:` and Claude Code composes the prefix.
- `disable-model-invocation: true` hides a skill from the model's list but
  keeps the `/slash` form — used by `thread:handoff`.

## Resume instructions

1. Read this file, then `CONTEXT.md` and the two ADRs.
2. `skills/_shared/task-writer.md` is the single source for task shape —
   never change task behaviour in a route skill directly.
3. Live testing checklist is in the plan's Verification section (plan file:
   `~/.claude/plans/so-i-want-to-rippling-taco.md`, mirrored in repo history).

## Session log

- 2026-07-14: thread created — v1.0.0 built end-to-end from approved plan.
