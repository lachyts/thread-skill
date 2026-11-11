# 0081 — code no test can exercise gets the strongest review, and lands not proven

Date: 2026-11-12
Status: accepted, not built (grilled with Lachy 2026-11-12, from the weekly Reflection's rule proposals `5e0d1301`
and Watch `9929d6e6`; builds as Phase 52; amends ADR 0037 decision 7 and leans on ADR 0078 and ADR 0079).

## Context

The master review approves a task on reading alone when no check a rollout can run exercises its code: Codex
computer use, and device-only code for Vision Pro and Quest. In the week of 2026-10-19, 24 of 26 review Escapes sat
on the Codex surface (`chorus-p68-5` drew 19 later findings), and a later sitting found the same on visionOS
control-panel code. Lachy's project card names review rules as a detail he steers. Asked what such a task should
need before it merges, he picked: **a stronger review, then land flagged.**

## Decision

1. **A task says when its surface is unreachable.** Its plan declares that no check the rollout can run exercises
   the change, and a path list per repo backs the plan up.
2. **Its final review runs on Fable, with a second, independent reviewer beside it.** Such a task is outside ADR
   0079's draw for the review role: it always takes the stronger arm, and is left out of that role's comparison.
3. **Where a tool can exercise the code** (a simulator, computer use), a live smoke runs before approval.
4. **It merges as landed, not Proven** (ADR 0078), and sits on his needs-you list as one row for a felt check at a
   sitting he chooses. Nothing holds the merge, and nothing notifies him.

Considered: *hold the pull request for his own check* (offered, not picked: every device task and its dependants
would wait on him); *no special rule* (offered, not picked: October's pattern continues).

## Decided for him (overturnable)

- How the engine knows → the plan's own declaration, backed by a path list per repo (technical: the planner knows
  what it can run; the list catches one that forgets).
- A live smoke where a tool exists → before approval, not after merge (technical: evidence beats a second reading).
- The felt check → one row per task on the needs-you list, never a gate (priorities: only real decisions reach
  him, at a sitting he chooses).
