# 0046 — A bookkeeping miss never trips, and a trip holds only what it threatens

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Amends ADR 0030's git-env canary consequence and the Git-env hold.

## Context

A git-env trip holds the whole queue (nothing starts, integrates or merges) until Lachy acks it through `/thread:repair` § 3e. In `chorus-rollout-2026-10-18` both trips were false: the lead had skipped arming a window (p80-1 on 19 Oct, p82-2's seeded revise the same evening), so the check found an old record. Each time an agent showed the same evidence (the clone's default equal to `origin/<default>`, no local-only commit, a clean tree) and Lachy's ack was a formality. The second trip came at 18:18 and held all four slots and the lane idle until his ack at 09:28 the next morning: 15 hours of an overnight run lost to a decision with nothing left to decide. p26-1 and p26-3 make that miss rarer; they do not make a false trip impossible.

## Decision

**A window the canary cannot read (a Bookkeeping miss) never trips: it is logged with the checkout's state, read at that moment, and only a failing state check trips. A trip, while it stands, holds only what it threatens: the Integration lane, or the whole rollout when the checkout is bare. Every trip is acked by Lachy.**

- **A Bookkeeping miss is classified at the check.** `record missing`, `record unreadable` and `record not armed` say only that a window was never armed or could not be read; they observed nothing. The check reads the state there and then: the Project root's `<default>` is an ancestor of origin's tip, read from GitHub as well as from the tracking ref (a forged tracking ref could match a bad local one), so no commit on it is missing from origin, while a peer's push since does not fail it; it has no tracked changes; and it is not bare. All three hold: the miss is logged in the `## Git-env log` with that state and holds nothing. Any one fails: it trips, as an observed change does.
- **An observed change always trips and is Lachy's.** The default branch moved, or `core.bare` flipped: a check read after the fact cannot show what the window saw, and a harmful change can be pushed or reverted before anyone looks. Only Lachy acks it; the Companion may gather its evidence and notify him (ADR 0048), never ack it.
- **The merge still checks its base.** A window with a logged Bookkeeping miss keeps its verify, since the state check showed the checkout unharmed. Integration goes on through merge-task, whose base check re-integrates when `main` moved.
- **A RACE's decision stays Lachy's; its hold narrows (ADR 0048).** A git-env halt at a RACE site keeps ADR 0030's rule that after the ack the task is an undecided RACE for Lachy (repair § 3e hands it to § 3c). A red RACE re-verify gets ADR 0050's one extra full run first, so a load flake clears itself. A red that repeats is reverted: the lead reverts that task's merge on `main` with a revert commit (never a force-push) and sets the task aside for Lachy, so `main` is green again, the lane frees and new starts branch from a green `main`. Lachy's decision is then about the task alone. Until the second red the RACE holds the Integration lane, never the whole rollout.
- **A trip holds what it threatens (ADR 0048).** A moved default branch, or a Bookkeeping miss whose state check failed short of a bare checkout, holds only the lane: each task's worktree is cut from `origin/<default>` after a fetch, never from the Project root's local ref, so starts, seeded revises and automatic retries continue, their windows armed and checked as usual, and a trip one finds joins the unacked set. A bare checkout (`core.bare` flipped, or `core.bare true at arm`) holds the whole rollout: linked worktrees share the root's config, so it reaches every task. Nothing new starts, running calls finish, and the restore runs once none is in flight.

## Considered options

- **A bookkeeping trip that acks itself (an Automatic ack)** on the same evidence: ruled in the re-grill, then replaced in the PR #202 simplify round (2026-10-22). It tripped, held the lane and then cleared itself, adding a term and a second ack writer for a case that observed nothing.

- **A red RACE holds the lane, new starts branch from the last green commit, or new starts wait too** (round 4 of the PR #202 review, 2026-10-22): rejected for the revert. Either `main` stays red overnight and every task rebases later, or the night idles again.
- **Self-ack only, the hold still freezing everything:** rejected. A real trip at night would still idle every slot until morning.
- **Lane-only hold, a false trip still tripping and waiting for Lachy:** rejected. It still loses the night's merges to a formality.
- **Any trip kind acks itself on stronger evidence** (the trip line's own recorded state, the moved ref merged by merge-task): rejected in the re-grill. Both false trips of `chorus-rollout-2026-10-18` were Bookkeeping misses, and an observed change is rare enough to be worth a look.

## Consequences

- `/thread:repair` § 3e remains the route for every trip; a logged Bookkeeping miss can be read, and questioned, in the `## Git-env log`.
