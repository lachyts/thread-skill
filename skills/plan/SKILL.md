---
name: plan
description: DEPRECATED alias. /wave:plan was renamed to /wave:schedule when /wave:split was added upstream, so the pipeline reads /wave:split → /wave:schedule → /wave:execute. Use /wave:schedule. This stub only redirects; it carries no planner logic.
---

# /wave:plan — renamed to /wave:schedule

`/wave:plan` is **deprecated**. The planner that clusters a backlog of Obsidian tasks into
parallel-safe waves is now **`/wave:schedule`** (renamed 2026-06-18 when `/wave:split` was added as
the upstream decomposition stage, so the pipeline reads **`/wave:split` → `/wave:schedule` →
`/wave:execute`**).

**Do this:** run `/wave:schedule` with the same arguments the user gave, and tell them the command
was renamed. Do not reimplement the planner here — the implementation lives in
`${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md`.
