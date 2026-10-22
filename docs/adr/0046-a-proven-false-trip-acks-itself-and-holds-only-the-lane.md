# 0046 — A proven-false git-env trip acks itself, and a trip holds only what it threatens

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Amends ADR 0030's git-env canary consequence (only `/thread:repair` acks, on Lachy's word) and the Git-env hold.

## Context

A git-env trip holds the whole queue (nothing starts, integrates or merges) until Lachy acks it through `/thread:repair` § 3e. In `chorus-rollout-2026-10-18` both trips were false: the lead had skipped arming a window (p80-1 on 19 Oct, p82-2's seeded revise the same evening), so the check found an old record. Each time an agent showed the same evidence (the clone's default equal to `origin/<default>`, no local-only commit, a clean tree) and Lachy's ack was a formality. The second trip came at 18:18 and held all four slots and the lane idle until his ack at 09:28 the next morning: 15 hours of an overnight run lost to a decision with nothing left to decide. p26-1 and p26-3 make that miss rarer; they do not make a false trip impossible.

## Decision

**When the evidence proves the checkout unharmed, the lead writes the Git-env ack itself (an Automatic ack), logged with that evidence. A trip, while it stands, holds only what it threatens: the Integration lane, or the whole rollout when the checkout is bare.**

- **Only a bookkeeping trip acks itself.** A trip that observed nothing (`record missing`, `record unreadable`, `record not armed`: a window was never armed or could not be read) is the only kind an Automatic ack may clear. A trip that observed a change (the default branch moved, `core.bare` flipped) is never acked automatically, whatever the checkout reads afterwards: evidence read at ack time cannot show what the window saw, and a harmful change can be pushed or reverted before anyone looks.
- **The evidence, all of it, read at the ack:** the Project root's `<default>` is an ancestor of origin's tip, read from GitHub as well as from the tracking ref (a forged tracking ref could match a bad local one), so no commit on it is missing from origin, while a peer's push since does not fail it; it has no tracked changes; and it is not bare. A trip that is not a bookkeeping trip, or that fails any of these, is acked only by Lachy; the Companion may gather its evidence and notify him (ADR 0048), never ack it.
- **The merge still checks its base.** The tripped window's verify stands, because the evidence shows the checkout it ran against was unharmed. Integration resumes through merge-task, whose base check re-integrates when `main` moved.
- **A RACE's decision stays Lachy's; its hold narrows (ADR 0048).** A git-env halt at a RACE site keeps ADR 0030's rule that after any ack, automatic or not, the task is an undecided RACE for Lachy (repair § 3e hands it to § 3c), and an Automatic ack never re-runs a RACE re-verify. An undecided RACE holds the Integration lane, since `main` may be red and nothing else may merge onto it, never the whole rollout: task calls keep building. A red RACE re-verify gets ADR 0050's Flake re-run first, so a load flake clears itself; a red that repeats waits for Lachy.
- **A trip holds what it threatens (ADR 0048).** A bookkeeping trip or a moved default branch holds only the lane: each task's worktree is cut from `origin/<default>` after a fetch, never from the Project root's local ref, so starts, seeded revises and automatic retries continue, their windows armed and checked as usual, and a trip one finds joins the unacked set. A bare checkout (`core.bare` flipped, or `core.bare true at arm`) holds the whole rollout: linked worktrees share the root's config, so it reaches every task. Nothing new starts, running calls finish, and the restore runs once none is in flight.

## Considered options

- **Self-ack only, the hold still freezing everything:** rejected. A real trip at night would still idle every slot until morning.
- **Lane-only hold, Lachy still acks every trip:** rejected. It still loses the night's merges to a formality.
- **Any trip kind acks itself on stronger evidence** (the trip line's own recorded state, the moved ref merged by merge-task): rejected in the re-grill. Both false trips of `chorus-rollout-2026-10-18` were bookkeeping trips, and an observed change is rare enough to be worth a look.

## Consequences

- `/thread:repair` § 3e remains the route for a trip the evidence does not clear, and for any trip Lachy wants to inspect; an Automatic ack can be read, and questioned, in the `## Git-env log`.
