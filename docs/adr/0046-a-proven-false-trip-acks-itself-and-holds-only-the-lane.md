# 0046 — A proven-false git-env trip acks itself, and a trip holds only the lane

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Amends ADR 0030's git-env rule ("never ack from execute") and the Git-env hold.

## Context

A git-env trip holds the whole queue (nothing starts, integrates or merges) until Lachy acks it through `/thread:repair` § 3e. In `chorus-rollout-2026-10-18` both trips were false: the lead had skipped arming a window (p80-1 on 19 Oct, p82-2's seeded revise the same evening), so the check found an old record. Each time an agent showed the same evidence (the clone's default equal to `origin/<default>`, no local-only commit, a clean tree) and Lachy's ack was a formality. The second trip came at 18:18 and held all four slots and the lane idle until his ack at 09:28 the next morning: 15 hours of an overnight run lost to a decision with nothing left to decide. p26-1 and p26-3 make that miss rarer; they do not make a false trip impossible.

## Decision

**When the evidence proves the checkout unharmed, the lead writes the Git-env ack itself (an Automatic ack), logged with that evidence. A trip, while it stands, holds only the Integration lane.**

- **The evidence, all of it:** the Project root's `<default>` equals `origin/<default>`, no local commit is missing from origin, its tree is clean and it is not bare. Anything short of that still waits for Lachy, who is pushed a needs-you notification.
- **The merge still checks its base.** An Automatic ack never merges what the window verified: Integration resumes through merge-task, whose base check re-integrates when `main` moved.
- **Task calls keep going under a hold.** Each task's worktree is cut from `origin/<default>` after a fetch, never from the Project root's local ref, so a trip in the root cannot reach them. Starts, seeded revises and automatic retries continue; only Integration and merging wait.

## Considered options

- **Self-ack only, the hold still freezing everything:** rejected. A real trip at night would still idle every slot until morning.
- **Lane-only hold, Lachy still acks every trip:** rejected. It still loses the night's merges to a formality.

## Consequences

- `/thread:repair` § 3e remains the route for a trip the evidence does not clear, and for any trip Lachy wants to inspect; an Automatic ack can be read, and questioned, in the `## Git-env log`.
