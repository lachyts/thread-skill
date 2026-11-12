# 0080 — a stuck rollout changes its repo's merge settings

Date: 2026-11-12
Status: accepted, built in part 2026-11-12 (p47-9, below; grilled with Lachy 2026-11-12, the "rollouts resolve themselves" grill; builds in
Phase 47). Amends ADR 0025's by-hand lift of a protection rule, for a rule that cannot be met, and reopens on his
word the no-bypass ADR 0025 kept because agents act as him; extends ADR 0069 as amended 2026-11-11 (the `no-runner`
set-aside), ADR 0075 and ADR 0078.

*(Amended 2026-11-12 by thread-skill-p46-8: findings 5, 8, 10 and 11 of review round 45adf20/cdf93d are settled in
decisions 4 to 6, the Consequences and the Decided list, each marked "review #N".)*

*Built 2026-11-12 (p47-9), for two of decision 1's kinds: a required check no runner will take (ADR 0069's `no-runner`
set-aside) and a required context no job reports (merge-task's new `unreported-context` set-aside, a renamed job). Each
is a **settings block**: it retries as infra first, and only at the **settings point**, where the same stop comes back
after its cool-down retry or the budget is spent (the H10 it ended in before), does `lead-integrate.py inputs` read it
due (`settingsBlock`), so a sleeping self-hosted runner keeps its check through one retry (decision 2). One script,
`skills/execute/scripts/merge-settings.py`, under one lock per origin, frees it: the lead's step 1.2 *Settings repair*,
repair's **settings block** row and, through repair, the Companion run its `free` (decision 4). It refuses a block the
Run record does not name, a repo he does not own, a token without admin rights and another app's check, and every
refusal is a `left` row, his H13. It edits only a rule's contexts: `strict` and a ruleset's up-to-date policy are
copied. A no-runner context is removed; an unreported one is replaced, never dropped (decision 3), and only on exact
evidence: GitHub's expanded job names at each rev it reads (matrix suffixes included), merge-gate's matcher used only to
leave, and every rename gated on the new name having passed on the PR's head. The task's own rename is replaced once
its new name passed on the head; a required job its own PR deletes is left for him. Each change is written to the task
note's `## Merge settings` before the write (its before, after and one-command undo, then `changed` once read back), with
a `setting-changed` Run record line, and listed as a changed-for-you row (execute § 6.5 (i)) until restored or dismissed
(decision 5). A changed block re-enters once past the same stop and the budget; the `re-entered` boundary row its
re-entry writes consumes that, so a change that did not free it reads H10. merge-task gains the probe that sets a
renamed job aside, a bounded wait while the renamed job still runs, one re-watch after it, and a re-poll of a BLOCKED PR
whose every required context is reported, so GitHub's lazy fold of a changed setting merges instead of stopping at the
NON-check gate. A rule naming a gone reviewer or app, a stuck infrastructure run, and the contexts this build leaves for
him (an expression or include matrix, a reusable workflow's `a / b`, a dropped matrix combination) are follow-up p47-15;
the needs-you list's and decision 6's repo check's read of the rows is p47-16.*

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
   his word ("any merge setting"), and the guard is code (review #8): no agent prompt names a call that writes the
   rulesets or the branch-protection settings (read-only calls, like schedule § 2.5's merge gate, stay), a contract
   test pins that, and the script refuses unless the Run record already names the block it frees. No separate token
   is minted for it.
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
  him, could still change a protection rule. The guard narrows the way to one script and keeps every call that
  writes those settings out of the agent prompts, where a contract test can see it; it does not close it, and
  nothing short of a separate identity would.
- A changed setting is never lost: a restored one closes its row; a dismissed one is kept by his decision and stays
  in the Run record; every setting not yet restored, a dismissed one's included, stays listed by the repo check at
  each rollout's start (decisions 5 and 6).

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
- The guard → the one script, no agent prompt naming a call that writes the rulesets or branch-protection settings
  (read-only calls, like schedule § 2.5's merge gate, stay), a contract test, and a refusal unless the Run record
  names the block; no separate token (technical, review #8).
- A dismissed row → his decision to keep the change, its Run record line kept, and listed by the repo check at
  each rollout's start until restored (technical, review #5).
- Where the row lives → the task note whose block it freed, so it outlives the rollout (technical, review #10).
