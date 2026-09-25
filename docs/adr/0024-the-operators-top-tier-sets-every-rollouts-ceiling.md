# 0024 — the operator's top tier sets every rollout's ceiling (amends 0016)

Date: 2026-09-26
Status: accepted

## Context

ADR 0016 admitted one reason to cap tier decisions: the account's quota for the higher
tier is exhausted. Since 2026-09-23 Lachy has run everything on Opus 5.5 by choice, not
because quota ran out. The lock lived as prose in `~/.agents/AGENTS.md § Model tier`, while
`skills/schedule/SKILL.md` still told the planner to "err toward Fable" and to leave
`max_tier:` commented out. Rollouts came out right only because an agent read the prose and
overrode the skill each time, and changing the top model meant editing prose in several
places.

## Decision

The **top tier** is one operator-held value in a plugin config file,
`~/.config/thread/top-tier` (a single tier name, e.g. `opus`). Schedule stamps each
rollout's ceiling from it, and execute refuses any tier above it. It names a rung, never a
model version: the harness resolves `opus` to the current Opus. If the file is absent there
is no ceiling, which is 0016's uncapped default, so the public plugin behaves for other
users exactly as before. A standing operator choice is now a valid reason for the ceiling
alongside exhausted quota. Both are operator or resource facts, never a judgement about a
task, so 0006 still holds. Everything 0016 says about terminality and effort applies
unchanged.

## Considered options

- **An Opus-only plugin default.** Rejected: it bakes one operator's current preference
  into a public plugin, and a new top model would mean a release.
- **Removing the Fable step-up and escalation machinery.** Rejected: that is the most code
  change and the hardest to undo, and the ladder comes back the day Fable is top again.
- **An environment variable.** Rejected: desktop sessions launched from the GUI may never
  inherit it. A file reads the same in every harness and every launch mode.
- **Keeping the lock as AGENTS.md prose.** Rejected: enforcement depends on an agent reading
  it every time, and the skill text keeps contradicting it.
