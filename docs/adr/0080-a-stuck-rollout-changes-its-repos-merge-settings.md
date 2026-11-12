# 0080 — a stuck rollout changes its repo's merge settings

Date: 2026-11-12
Status: accepted, not built (grilled with Lachy 2026-11-12, the "rollouts resolve themselves" grill; builds in
Phase 47). Amends ADR 0025's by-hand lift of a protection rule, for a rule that cannot be met; extends ADR 0069 as
amended 2026-11-11 (the `no-runner` set-aside), ADR 0075 and ADR 0078.

## Context

Lachy, 2026-11-10: *"a system where things don't get stuck or they can resolve themselves."* On 2026-11-04 he had
already handed the Companion any machinery snag (CI, quota waits, stale refs) and spends under US$200. One kind of
stop still needed his own hand: a repo setting. In `compression-engine-rollout-2026-11-08` two approved PRs waited
about 20 hours on a required check assigned to a self-hosted runner that no longer existed; only removing that
check from the branch's protection rule could free them.

Two rules already bear on this. ADR 0025: a protected default branch moves only by a green pull request, and its
protection is lifted by hand, deliberately, and then restored. ADR 0069 as amended: a required job queued with no
runner is set aside at once as `no-runner`, retried as infrastructure, and then handed to a person.

Asked whether the system may change a repo's merge settings on its own, he was offered *dead checks only*, *never
mid-run* and *any merge setting*, and picked the widest: **any merge setting**.

Checked for this grill and not asked: Mac sleep is not a real cost (46 sleep stops since mid-October, under 5
hours in total; rollouts resume on wake), and what he meets on return is the one needs-you list settled on
2026-11-10.

## Decision

1. **On a repo Lachy owns, the system may change any merge or CI setting that blocks a rollout.** A setting blocks
   when it asks for something that cannot happen as things stand: a required check no runner will take, a required
   context no job reports (a renamed job), a rule naming a reviewer or an app that is gone, a stuck infrastructure
   run. This is the hand-back ADR 0069's `no-runner` class ends in, taken by the system instead of a person, and it
   amends ADR 0025's by-hand lift for exactly these rules.
2. **A rule that can still be met is never loosened.** The strict up-to-date rule stays (ADR 0078), and so does a
   required check that runs: a check that ran and failed on the task's own change is a real red, the engine's to
   fix.
3. **It makes the smallest change that frees the block,** and repairs before it removes: a renamed job's context is
   replaced with its new name, never dropped.
4. **One owner makes the change.** The lead's own verb changes the setting; `/thread:repair` and the Companion ask
   through it, so two changes never cross.
5. **Every change is logged with its undo:** one Run record line and one "changed for you" row on his needs-you
   list, each with the setting before, the setting after and the one command that restores it. Nothing asks him
   first. The row stays open until the setting is restored or he dismisses it: a setting is never restored on a
   guess, and never forgotten.
6. **A repo check before the first Slot looks for these** (Phase 51's repo check), so a change mid-run is the
   exception.

Considered: *dead checks only, with proof the check cannot run* (recommended to him, not picked: it leaves other
rules that cannot be met waiting for him); *never mid-run, a repo check before the rollout only* (a runner that
dies overnight still waits for him).

## Decided for him (overturnable)

- Whose repos → only ones his own account or his own organisations own (technical: nobody else's rule is his to
  loosen).
- "Blocks" → a rule that cannot be met, never one that only makes a pull request wait (technical: a rule that can
  be met clears by itself, and ADR 0025 exists to keep those).
- What is out of scope → secrets, repo visibility, deleting a branch that holds unmerged work, a force-push, and
  anything in the code itself (technical: none of these is a merge setting, and none has a one-line undo).
- The record → the Run record and the needs-you list, never a notification (priorities: ADR 0075, rollouts never
  notify him).
