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

**Left open for p7-1, deliberately.** How the value reaches a run is implementation, and a
first attempt to decide it here was wrong (review d2b36d6/b59fd7). p7-1 settles, in its own grill:
whether schedule stamps the value or execute reads the file; how a resumed run keeps its original
args (execute's resume contract) while the file may have changed; and how a block under an operator
ceiling is triaged, given that 0016 reads a capped block as "wait for quota" and that a capped block
may still be a capacity block rather than a wall. Until then, 0016's terminality and effort rules
apply as written.

**Not the engine's ladder constant.** The engine names the top of its ladder internally; the
operator's top tier caps that ladder and never replaces the constant. Wiring this value into it
would turn escalation into a no-op and cost capped tasks their effort uplift.

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
