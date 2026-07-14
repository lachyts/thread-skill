---
slug: thread-skill
created: 2026-07-14
last_touched: 2026-07-14
state: active
scope: Build + maintain the thread:* continuity plugin (router + decisive routes)
---

# thread-skill — THREAD

## Where we are

v1.0.0 built AND installed 2026-07-14 (`thread@thread`, user scope, GitHub
marketplace from `lachyts/thread-skill`). All six members live; flat skills
retired; workspace references migrated; vault project note [[Thread Skill]]
created. First real invocation happened same-day: `thread:close` ran this
repo's own close from the plugin cache. Remaining: the live end-to-end
verification checklist (fresh session) — tracked by the vault task
`thread-plugin-live-verification`, scheduled 2026-07-15.

## What's been built / decided

- Plugin scaffold mirroring wave: manifests, CONTEXT.md, docs/adr/, README.
- ADR 0001: the task is the floor; the thread is the upgrade.
- ADR 0002: `next` is a sibling, not a parent.
- Canonical THREAD-template.md home: `~/.agents/skills/thread/THREAD-template.md`
  (harness-neutral; `check-agent-parity.py` pins it).
- Pickup auto-completes the capture task (decided in design interview).
- Stash surfacing: `/weekly` "Stashed threads" pass (decided in design interview).
- Codex `.agents/skills/{thread,close}` adapters kept as their audit-era
  **native translations** (not thinned to pointers as the plan suggested) —
  undoing deliberate Codex-safety work wasn't worth the dedup; only
  `handoff`'s canonical pointer was repointed at this repo.
- Vault project note `Work/Projects/Side projects/Thread Skill.md` is the
  human-facing surface (goal, terminology, wave-sibling framing); its
  `repos:` frontmatter auto-routes tasks captured from this repo's CWD.
- Build lineage: `docs/build-plan.md` (the approved plan, copied in at close).

## Open questions / decisions pending

None right now.

## Known quirks (don't re-derive)

- Colon namespace (`thread:defer`) requires plugin packaging; skill frontmatter
  carries the bare `name:` and Claude Code composes the prefix.
- `disable-model-invocation: true` hides a skill from the model's list but
  keeps the `/slash` form — used by `thread:handoff`.
- A plugin installed **mid-session** hot-registers member *names* into the
  running session's skill list, but descriptions only index at session start —
  members render bare (`thread:close`) until a fresh session. Files were
  verified well-formed; don't debug this again.
- Skills execute from `~/.claude/plugins/cache/thread/thread/<version>/`, not
  the `marketplaces/thread/` clone — `${CLAUDE_PLUGIN_ROOT}` resolves to the
  cache path. Update flow: push → `claude plugin marketplace update thread`.

## Resume instructions

1. Read this file, then `CONTEXT.md` and the two ADRs.
2. `skills/_shared/task-writer.md` is the single source for task shape —
   never change task behaviour in a route skill directly.
3. Live testing checklist is in the plan's Verification section (plan file:
   `~/.claude/plans/so-i-want-to-rippling-taco.md`, mirrored in repo history).

## Session log

- 2026-07-14 (later): installed as thread@thread + references migrated + vault project note; first live close ran from the plugin itself; verification task scheduled for 2026-07-15.
- 2026-07-14: thread created — v1.0.0 built end-to-end from approved plan.
