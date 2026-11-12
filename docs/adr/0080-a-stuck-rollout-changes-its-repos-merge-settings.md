# 0080 — a stuck rollout changes its repo's merge settings

Date: 2026-11-12
Status: accepted, not built (grilled with Lachy 2026-11-12, the "rollouts resolve themselves" grill; builds in
Phase 47). Amends ADR 0025's by-hand lift of a protection rule, for a rule that cannot be met, and reopens on his
word the no-bypass ADR 0025 kept because agents act as him; extends ADR 0069 as amended 2026-11-11 (the `no-runner`
set-aside), ADR 0075 and ADR 0078.

*(Amended 2026-11-12 by thread-skill-p46-8: findings 5, 8, 10 and 11 of review round 45adf20/cdf93d are settled in
decisions 4 to 6, the Consequences and the Decided list, each marked "review #N".)*

## Context

Lachy, 2026-11-10: *"a system where things don't get stuck or they can resolve themselves."* On 2026-11-04 he had
already handed the Companion any machinery snag (CI, quota waits, stale refs) and spends under US$200. One kind of
stop still needed his own hand: a repo setting. In `compression-engine-rollout-2026-11-08` two approved PRs waited
about 20 hours on a required check assigned to a self-hosted runner that no longer existed; only removing that
check from the branch's protection rule could free them.

Two rules already bear on this. ADR 0025: a protected default branch moves only by a green pull request, and its
protection is lifted by hand, deliberately, and then restored. It grants no bypass, the owner included, because
rollout agents act with Lachy's own GitHub identity: a bypass granted to him is granted to every agent he launches.
ADR 0069 as amended: a required job queued with no runner is set aside at once as `no-runner`, retried as
infrastructure, and then handed to a person.

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
4. **One script makes the change, under a lock, and its guard is technical, never prose.** The change lives in one
   script. The lead, `/thread:repair` and the Companion each run it, so a stuck rollout with no live lead is still
   freed, and the script's lock keeps two changes from crossing (review #11). This reopens ADR 0025's no bypass on
   his word ("any merge setting"), and the guard is code (review #8): no agent prompt names the rulesets or the
   branch-protection API, a contract test pins that, and the script refuses unless the Run record already names the
   block it frees. No separate token is minted for it.
5. **Every change is logged with its undo:** one Run record line and one "changed for you" row on his needs-you
   list, each with the setting before, the setting after and the one command that restores it. Nothing asks him
   first. The row is written on the task note whose block the change freed, which outlives its rollout, so the
   needs-you list reads it there after the rollout is archived too (review #10). The row stays open until the
   setting is restored or he dismisses it. A dismissal is his decision to keep the change, and the Run record keeps
   its line (review #5). A setting is never restored on a guess.
6. **A repo check before the first Slot looks for these** (Phase 51's repo check), so a change mid-run is the
   exception. At each rollout's start it also lists every setting changed under this ADR and not yet restored, a
   dismissed row's among them, so none is forgotten (review #5).

Considered: *dead checks only, with proof the check cannot run* (recommended to him, not picked: it leaves other
rules that cannot be met waiting for him); *never mid-run, a repo check before the rollout only* (a runner that
dies overnight still waits for him); *only the lead changes a setting* (this ADR's first text: a stuck rollout often
has no live lead, review #11); *a separate token for the script* (it would still be his to mint and hold, and the
guard would move from code the tests read to a secret they cannot, review #8).

## Consequences

- **The residual risk** (review #8): the script runs as Lachy, so an agent that called the GitHub API by hand, as
  him, could still change a protection rule. The guard narrows the way to one script and keeps it out of every
  agent prompt, where a contract test can see it; it does not close it, and nothing short of a separate identity
  would.
- A changed setting is never lost: a restored one closes its row, a dismissed one is kept by his decision and
  stays in the Run record, and both stay listed by the repo check until restored or kept (decisions 5 and 6).

## Decided for him (overturnable)

- Whose repos → only ones his own account or his own organisations own (technical: nobody else's rule is his to
  loosen).
- "Blocks" → a rule that cannot be met, never one that only makes a pull request wait (technical: a rule that can
  be met clears by itself, and ADR 0025 exists to keep those).
- What is out of scope → secrets, repo visibility, deleting a branch that holds unmerged work, a force-push, and
  anything in the code itself (technical: none of these is a merge setting, and none has a one-line undo).
- The record → the Run record and the needs-you list, never a notification (priorities: ADR 0075, rollouts never
  notify him).
- Who changes a setting → one script with a lock, run by the lead, `/thread:repair` or the Companion (technical,
  review #11: a stuck rollout often has no live lead).
- The guard → the one script, no agent prompt naming the rulesets or branch-protection API, a contract test, and a
  refusal unless the Run record names the block; no separate token (technical, review #8).
- A dismissed row → his decision to keep the change, its Run record line kept, and listed by the repo check at
  each rollout's start until restored (technical, review #5).
- Where the row lives → the task note whose block it freed, so it outlives the rollout (technical, review #10).
