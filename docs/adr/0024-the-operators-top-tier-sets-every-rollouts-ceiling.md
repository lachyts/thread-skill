# 0024 — the operator's top tier sets every rollout's ceiling (amends 0016)

Date: 2026-09-26
Status: accepted, implementation pending (task p7-1). Until it lands, schedule and execute still
carry 0016's quota-only wording, and the ceiling reaches rollouts only through the operator's
own instruction (AGENTS.md § Model tier).

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
`~/.config/thread/top-tier` (a single tier name, e.g. `opus`). It names a rung, never a model
version: the harness resolves `opus` to the current Opus. If the file is absent there is no
ceiling, which is 0016's uncapped default, so the plugin behaves for other users exactly as
before. A standing operator choice is now a valid reason for the ceiling alongside exhausted
quota. Both are operator or resource facts, never a judgement about a task, so 0006 still
holds.

How it applies:

1. **The live file governs, at dispatch.** Execute reads the file each time it dispatches. A
   rollout's `max_tier:` is what schedule saw when it wrote the note; the **lower** of the stamp
   and the file applies. So changing the file changes every future dispatch, including resumed
   and paused rollouts, in one place, and a note can still be capped lower than the file on
   purpose.
2. **Over-cap tiers are lowered, never refused.** A task stamped `model: fable` by an earlier
   escalation runs at the ceiling, exactly as 0016 already lowers it. Resume and repair of a
   previously escalated rollout keep working.
3. **Under an operator ceiling, a capped block is a wall.** 0016's terminality and effort rules
   hold: a capped task runs the full Ralph loop and takes the higher tier's effort row. But
   0016's reading of a capped block as "re-dispatch once quota returns, never read it as a wall"
   holds only for a quota cap. An operator ceiling does not lift on its own, so its blocks are
   triaged as real walls (ADR 0006), and `tier_capped:` records which kind of cap it was.

**Not the engine's highest rung.** The engine's internal name for the top of its ladder
(`fable`) is a different thing: the operator's top tier caps the ladder and never renames or
shortens it. Wiring this value into that constant would turn escalation into a no-op and cost
capped tasks their effort uplift.

**Open against protocol 4.** The protocol 4 branch carries a decision on shared effort-first
routing (numbered 0021 there, `docs/adr/` on `codex/thread-rollout-redesign`) that rejects
legacy tier knobs. When p6-1 integrates it, re-check this decision against that one before
p7-1 implements it; P7 may need re-grilling.

## Considered options

- **An Opus-only plugin default.** Rejected: it bakes one operator's current preference
  into a public plugin, and a new top model would mean a release.
- **Removing the Fable step-up and escalation machinery.** Rejected: that is the most code
  change and the hardest to undo, and the ladder comes back the day Fable is top again.
- **An environment variable.** Rejected: desktop sessions launched from the GUI may never
  inherit it. A file reads the same in every harness and every launch mode.
- **Keeping the lock as AGENTS.md prose.** Rejected: enforcement depends on an agent reading
  it every time, and the skill text keeps contradicting it.
