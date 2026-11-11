# 0081 — code no test can exercise gets the strongest review, and lands with a felt check open

Date: 2026-11-12
Status: accepted, not built (grilled with Lachy 2026-11-12, from the weekly Reflection's rule proposal `5e0d1301`
and Watch `9929d6e6`; builds as Phase 52). Changes the master review of execute § 5 for one kind of task; leans on
ADR 0079. ADR 0078's **Proven** is unchanged.

## Context

The master review approves a task on reading alone when no check in its rollout's verifier exercises its code:
Codex computer use, and device-only code for Vision Pro and Quest. In the week of 2026-10-19, 24 of 26 review
Escapes sat on the Codex surface (`chorus-p68-5` drew 19 later findings), and a later sitting found the same on
visionOS control-panel code. Lachy's project card names review rules as a detail he steers. Asked what such a task
should need before it merges, he picked: **a stronger review, then land flagged.**

## Decision

1. **A task says when its surface is unreachable.** Its plan declares that no check in the rollout's verifier
   exercises the change, and a path list per repo backs the plan up.
2. **Its final review is doubled.** A second, independent reviewer runs beside the first, and both must approve.
   Where the operator's file names Fable for the final review and the Login has room, the first reviewer is Fable,
   outside ADR 0079's draw and left out of that role's comparison. Otherwise it runs on the Top rung, as today.
3. **It merges, and is done once live** as ADR 0078 says, carrying an open **Felt check**: one row on his needs-you
   list, for a sitting he chooses. Nothing holds the merge, and nothing notifies him. His check closes the row; a
   check that fails is filed as a fix of the landed task, which is how an Escape is already counted.

Considered: *hold the pull request for his own check* (offered, not picked: every device task and its dependants
would wait on him); *no special rule* (offered, not picked: October's pattern continues); *a live smoke before
approval where a tool exists* (an earlier draft: a surface a tool can exercise is not unreachable, and computer use
would take the Mac's screen while he works).

## Decided for him (overturnable)

- How the engine knows → the plan's own declaration, backed by a path list per repo (technical: the planner knows
  what its verifier runs; the list catches one that forgets).
- With no Fable to call → the Top rung and the second reviewer (technical: ADR 0079 decisions 7 and 10 already say
  what runs when Fable cannot).
- The felt check → one row per task on the needs-you list, never a gate, and never counted against the Hands-off
  rate (priorities: only real decisions reach him, at a sitting he chooses; the task had already landed).
