# 0080 — a stuck rollout changes its repo's merge settings

Date: 2026-11-12
Status: accepted, not built (grilled with Lachy 2026-11-12, the "rollouts resolve themselves" grill; builds in
Phase 47; extends ADR 0075 and ADR 0078).

## Context

Lachy, 2026-11-10: *"a system where things don't get stuck or they can resolve themselves."* On 2026-11-04 he had
already handed the Companion any machinery snag (CI, quota waits, stale refs) and spends under US$200. One kind of
stop still needed his own hand: a repo setting. In `compression-engine-rollout-2026-11-08` two approved PRs waited
about 20 hours on a required check assigned to a self-hosted runner that no longer existed; only removing that
check from the branch's protection rule could free them.

Asked whether the system may change a repo's merge settings on its own, he was offered *dead checks only*, *never
mid-run* and *any merge setting*, and picked the widest: **any merge setting**.

Checked for this grill and not asked: Mac sleep is not a real cost (46 sleep stops since mid-October, under 5
hours in total; rollouts resume on wake), and what he meets on return is the one needs-you list settled on
2026-11-10.

## Decision

1. **On a repo Lachy owns, the system may change any merge or CI setting that blocks a rollout:** a branch's
   protection rule or ruleset, a required check, a job no runner will take, a stuck or failed infrastructure run.
   The lead, `/thread:repair` and the Companion may each make the change.
2. **It makes the smallest change that frees the block,** and only for a block it has named in the Run record.
3. **Every change is logged with its undo:** one Run record line and one "changed for you" row on his needs-you
   list, each with the setting before, the setting after and the one command that restores it. He reads it on
   return; nothing asks him first.
4. **A setting is never restored on a guess.** A removed check stays removed until he, or the repo's own set-up,
   puts it back; the row says so.
5. **A repo check before the first Slot still looks for these** (the preflight grill's rule), so a change mid-run
   is the exception.

Considered: *dead checks only, with proof the check cannot run* (recommended to him, not picked: it leaves a live
but broken rule waiting for him); *never mid-run, a repo check before the rollout only* (a runner that dies
overnight still waits for him).

## Decided for him (overturnable)

- Whose repos → only ones his own account or his own organisations own (technical: nobody else's rule is his to
  loosen).
- What is out of scope → secrets, repo visibility, deleting a branch that holds unmerged work, a force-push, and
  anything in the code itself (technical: none of these is a merge setting, and none has a one-line undo).
- A check that ran and failed on the task's own change → never bypassed (technical: that is a real red, the
  engine's to fix, not a setting).
- The record → the Run record and the needs-you list, never a notification (priorities: ADR 0075, rollouts never
  notify him).
