# 0070 — A spent budget overruns, then takes the task out

Date: 2026-11-06
Status: proposed. Grilled at `/thread:orient Thread Skill` on 2026-11-06, from Lachy's Note on [[thread-skill-p39-13-fresh-review-landing-loop-review-follow-ups]]: "if all I'm doing is approving another review round or another kind of run, I don't want to be asked about that ... there should be a budget of a set amount of extra runs that can happen until then, and it either gets taken out of another rollout or something like that." To be built by p39-13 (close's landing loop) and a P39 sibling for the engine. Amends close § The stop rule (ADR 0065's budget), ADR 0033's automatic retry and ADR 0058's review-blocked route.

## Context

Two places still wait for Lachy once a budget is spent, and in both his answer is mechanical:

- **A landing** (close's own-branch loop) has three review rounds. A `ci failed`, or a red Verify run after a clean round, once they are spent is "a decision for Lachy" (close § The stop rule), even a flake, and `--fixed-at-budget` refuses an untrailered fix, so whatever he says he merges by hand.
- **A rollout task** has `auto_retries` (2) automatic retries. After them, a review-blocked task waits for `/thread:repair`'s `record-answer --raise` on his word, which approves one more review round.

His Priorities card says the project runs without him, and since 2026-11-06 that approving another round or run is never his question.

## Decision

1. **Overrun.** Once a landing's or a rollout task's normal budget is spent (its review rounds, its plan rounds or its automatic retries), it takes up to **three** more runs by itself, never asked: a re-run of a failed check with no cause in the change, a CI or Verify fix with one review round of its own, or one more review round. Each counts one. (Lachy, 2026-11-06: "3 extra runs".)
2. **Then it is taken out.** With the Overrun spent and the work still not mergeable, a rollout task leaves the rollout by a Clean defer (back to the open backlog, `rollout:` cleared), carrying its evidence in its note, and the rollout runs on to its completion without it. A landing is held, its PR left open and unmerged, and a task is filed with its evidence. Neither asks him anything.
3. **Listed, never alerted.** A taken-out task shows in the rollout's report (or close's landing row), its Run record and the weekly Reflection, and the next orient places it again. No needs-you alert is sent for it. (Lachy, 2026-11-06: "Listed, no alert".)
4. **His decisions still stop.** A decision only Lachy can make (a product or design call, a gate, a credential or irreversible sign-off, a fix outside the task) still reaches him as it does today, at any point in the budget or the Overrun. The Overrun replaces only approvals of another run.

## Decided for him (overturnable)

- An Overrun run → one per re-dispatch or review round, whatever its stage (technical: one count across stages keeps "three" meaning three).
- A repeated feedback fingerprint or a failure that repeats with one key at `max` → taken out at once, without spending the rest of the Overrun (technical: another identical run cannot change the outcome).
- Infrastructure conclusions (`cancelled`, `timed_out`, `startup_failure` and the like) → never count against the Overrun, as they never count against the budget (technical: close § The stop rule's existing rule).
- A flake past the budget → `gh run rerun --failed` on the same head, so CI runs fresh without a commit (technical: today a flake cannot get a fresh run because HEAD does not move).
- A CI fix past the budget → its commit is reviewed by one Overrun round before the merge is queued (priorities: production-ready, so no unreviewed fix lands).
- The allowance → one operator setting in `~/.config/thread/rollouts.toml`, `overrun_runs`, built-in 3 (technical: beside `auto_retries`, so a Reflection can tune it).
- A taken-out task that others in the rollout depend on → its dependants leave with it by the same Clean defer (technical: a Clean defer is only permitted when nothing depends on the task).
- Dev-time `/fresh-review` rounds → never count towards a landing's three (priorities: ADR 0065 already rules the landing's chain is its own; the Counting command is brought into line).
