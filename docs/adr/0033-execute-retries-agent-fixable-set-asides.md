# 0033 — execute retries agent-fixable set-asides itself

Date: 2026-10-09
Status: accepted, implemented by p16-4, shipped in 3.0.0 (amends ADR 0030 decision 4, where only a hand-back re-enters a set-aside
task, and ADR 0004, where repair alone retries an agent-fixable block; from the 2026-10-06 grill on unattended
rollouts, `thread-skill-p16-unattended-rollouts`)

## Context

ADR 0030 decision 4 sets a stuck task aside and lets the queue run on, but the task comes back only through
`hand-back`: "retry [[task]]" in a live session, or `/thread:repair`, which ADR 0004 makes the one place an
agent-fixable block is retried. An overnight rollout therefore stalls at its first plan-block, its first red
verifier or its first dead call, and waits for a person who would, most nights, have said "retry it". The phase
grill's question was how much of that the live lead may do alone without ever hiding a decision that is a human's.

## Decision

1. **One verdict, one writing verb.** `lead-integrate.py`'s `auto_retry_verdict` decides whether a set-aside
   task is retried. `lead-integrate.py inputs` prints it to every caller (status, repair and the lead read the
   same answer), and `reconcile-rollout.py auto-retry` re-runs it before it writes anything. The lead never
   hand-edits frontmatter: execute § 4.5 step 1.2's *Automatic retry* reads `inputs` and runs the verb, which
   writes the rollout's `## Notes` line, the task note (hand-back's own transition, the markers, a raise) and the
   Run record events, in that order, each finished by a re-run.
2. **What is retried.** A task set aside at its run (plan-blocked, blocked, review-blocked, `revise stopped:`)
   or at Integration with a `pr:`. Never: a gate-pending task (sign-off is the human's, ADR 0008); an undecided
   RACE or UNVERIFIED; a `## Needs you` question (p16-3); a plan-block after an automatic descope (repair asks);
   a plain rejection the seeded revise owns; a PR branch gone; a declined `--gated` merge; a set-aside at
   Integration with no `pr:`; a code-writing review note approved without a PR; a `pr:` the engine refuses
   (`inputs`' `prUrlError`, p17-1) on a way back that launches on it, a revise or an Integration, since execute
   launches nothing on it and a hand-back alone never moves it (the verb reads the `pr:` against the rollout's
   Project root, the lead's `--repo`, so its re-run verdict is the one `inputs` printed).
3. **The budget is resolved by the verbs.** `auto_retries` (default 2, an integer >= 0, `0` turning every retry
   off) resolves task note → rollout note → `rollouts.toml` → built-in, through the same resolver as the round
   caps (`rollout-settings.py`), inside `inputs` and the verb, never by the lead. The verb's `--auto-retries` and
   `--fingerprint` are assertions the lead copies from `inputs`: a mismatch refuses with nothing written. An
   invalid stamp (of `auto_retries` or `max_review_rounds`) is execute § 3's round-budget halt; an unresolvable
   value (a refused file, a Project root that is gone) only means no retry.
4. **The fingerprint stop.** Each retry stores the block's feedback fingerprint (its run's `<!-- run n end
   sha=… -->` sha) as `auto_retry_sha`. An agent block whose fingerprint equals it stops at once: an agent given
   the same feedback again would do the same thing. A transient or a dead call is exempt (the same failure is the
   expected shape of a flaky infrastructure), and the budget still bounds it, each retry after decision 5's
   short cool-down. The fingerprint is compared with the stored sha, never with the previous run, because
   reconcile writes no new run for identical content.
5. **Quota blocks are retried free, after a cool-down; infra blocks after a short one.** A dead call whose error
   reads as a usage or rate limit spends no budget and has no fingerprint stop. It is retried after 30, 60, 120,
   240, then 480 minutes, measured from the later of its block's run stamp and the last retry: five free retries
   (about 15.5 hours), then a human. An infra block (the engine's transient, or any other dead call) spends the
   budget, and each of its retries first waits 15, then 60, then 240 minutes (the last repeating, indexed by the
   retries already spent), from the same base, so identical dead calls are spread out rather than spent within
   minutes. While a cool-down is pending, a `stuck` queue ends its turn `waiting`, not `halted`, so the heartbeat
   keeps ticking and re-enters after it; but only while no gate-pending or UNVERIFIED task is set aside. Those need
   a human anyway, so with one among the set-asides the `stuck` halts as execute § 7 says (its `gated inputs await
   sign-off` or `UNVERIFIED undecided` reason, its item in the report's `Needs you:` block, execute § 6.5), and the
   cooling task retries at the re-invocation after it.
6. **The budget's lifetime.** `auto-retry` spends it (`auto_retries_used`, or `quota_retries_used`).
   `hand-back`, the explicit re-entry (repair after Lachy answers, "retry [[task]]", the lead after a descope),
   clears both counters and re-stamps `auto_retry_sha` with the block it re-enters: after a human answer the
   budget is fresh, but an identical re-block goes straight back to the human. A supersede's `carry` clears the
   counters and keeps the sha; `defer` clears all four markers.
7. **The raise.** A retry that re-enters a revise with no round left (`resumeAt: revise` and the resolved
   `max_review_rounds` ≤ the last round) raises `max_review_rounds` on the task note by one, repair's own raise,
   recorded with repair's wording (`max_review_rounds raised to <N>, one round`), so repair's "a raise already
   recorded in `## Notes`" rule finds it. An own-run review-blocked task gets no raise: its own call restarts the
   review loop.
8. **merge-task's exit 1 is an allowlist.** Of merge-task's exit-1 texts, only a merge conflict on the integrated
   base and a red required check are retried: a code fix on the branch can clear them. Every other text, and any
   future wording, is a human's (a closed PR, a branch not on origin, another base, a merge queue, a non-check
   gate, a refused merge, an unconfirmed merge, a read failure, a base that stays BEHIND, an unexpected state),
   so the list fails closed. Each allowed text is pinned against `merge-task.sh`.
9. **The records.** Each retry leaves a stamped line in the rollout's `## Notes` (`- <stamp> auto-retry:
   [[<slug>]] <n>/<N> (<stage>; feedback <sha>)`, the stamp being the `auto_retry_at` the retry writes), never in
   the task note (whose body is the brief), an `auto-retry` Run record event (its stage paired with the task's
   latest set-aside line for a Retro), and a report row; the Completion log copies the lines. One line per retry:
   a re-run that finishes a retry whose task-note save failed finds its line (the same text, stamped after the
   note's `auto_retry_at`) and writes no second one, while a later retry that reads the same but for its stamp
   (a hand-back reset the counters in between) is a line of its own.

The bound per task per rollout: (`auto_retries` + one descope) × (1 + human hand-backs) agent and infra retries,
plus at most five quota retries per stretch.

Considered:
- *Cap one, as repair does.* Repair's cap is per repair run, with a human watching; an unattended night needs a
  second try for the common "the first fix was close" case, and `auto_retries` stays an operator setting.
- *Comparing with the previous run.* Reconcile writes no run for identical feedback, so a repeat would read as
  "no new block" rather than "the same block": the stored sha is the only reliable comparison.
- *A live gh or `ls-remote` probe for a closed PR or a missing branch.* The verdict stays offline (status and
  repair print it), working from prepare's and merge-task's own texts. An Integration set-aside for another reason
  whose PR is in fact closed costs one bounded extra Integration before merge-task's CLOSED text routes it to a
  human.
- *A denylist of merge-task's human texts.* A new wording would be retried by default; the allowlist fails closed.
- *Quota never retried (a halt).* It turns every overnight usage limit into a dead night. *Quota spending the
  budget.* Two limits in a night would exhaust it on blocks nobody can act on.
- *Infra retried at once.* The engine has already retried a dead agent once in-run, and a usage limit that kills
  an agent reads as infra (Consequences), so an immediate retry would spend the budget within minutes. The short
  cool-down spreads it out without holding a genuine blip for long.
- *A cool-down that waits over a gate-pending or UNVERIFIED task.* It keeps the queue `waiting` for up to the
  quota's 15.5 hours, and in that time the `gated inputs await sign-off` and `UNVERIFIED undecided` reasons are
  never the turn's reason. A human is needed for those either way, so the halt comes first and only the cooling
  task's retry waits for the re-invocation.
- *A budget per stage.* More state for no observed need; the fingerprint stop already catches a loop.
- *Making `auto_retries` Retro-tunable.* It is no throughput dial and nothing in the Run record scores it yet;
  it stays a plain setting until a Retro shows a rule.
- *Writing the dated line in the task note.* The task body is the brief: descope's `_brief_items` and the plan
  judge read it, and a record section there would need excluding everywhere.

## Consequences

- **Amends ADR 0030 decision 4.** A set-aside task resumes at the stage it stopped, as before, but the live lead
  now re-enters the agent-fixable ones itself, up to `auto_retries`, before a hand-back is needed; the rollout
  halts `stuck` only once nothing is retryable and no cool-down is pending, or at once when a gate-pending or
  UNVERIFIED task needs a human anyway.
- **Amends ADR 0004.** Repair is still a conductor and still the one place a human's decision is captured, but it
  is no longer the only place an agent-fixable block is retried: it keeps the ones a spent budget, a repeated
  fingerprint or a `needsHuman` question hands it.
- `hand-back` now writes frontmatter markers (the counters cleared, `auto_retry_sha` stamped); its stdout is
  unchanged.
- **A usage limit inside an agent is not a quota block.** The quota class reads only a `workflow call failed:`
  error line. A usage limit that kills an agent mid-run surfaces as the engine's transient block (or a thrown
  stage), which is infra: it gets the infra cool-downs (75 minutes in all on the default budget of 2) and then a
  human, never the quota's 15.5 hours. p16-5's prose and a Retro must not count such a limit as covered by
  decision 5.
- **The idle-slots label during a cool-down.** `next` is stateless and never reads the verdict, so while a
  set-aside task waits out a cool-down with nothing queued, the idle-slots reason is `awaiting-hand-back`; a
  Retro tells the two apart by the `auto-retry` event before the restart that ends the span (run_record.py's
  docstring).
- A run-stage automatic retry's restart records `slot-taken start: hand-back`, as any hand-back's does: it
  stamps `handed_back:` through hand-back's own transition, and its `auto-retry` event precedes the restart.
- **Needs-you items (execute § 6.5, p16-1).** An entry `inputs` reports `autoRetry: true`, or with a pending
  `autoRetryAfter`, is no needs-you item: the lead re-enters it, now or after its cool-down, so it is never pushed
  to Lachy. Every entry the verdict refuses stays one, worded by § 6.5's own rules.
- **Status and repair caught up in p16-5.** Repair's **retry (automatic)** class leaves an `autoRetry: true` or
  cooling set-aside to the lead, and its **needs you** class answers a `## Needs you` question into
  `## Repair input` and removes the section before the hand-back. Every other hand-back, a raise included, follows
  Lachy's answer, so decision 7's "raise already recorded" reading is now his word. Every answer repair records for
  a set-aside at its run or at Integration, whatever it asked, is a stamped `## Repair input` entry keyed on the
  block's fingerprint. An answer recorded under a pause for a block with a fingerprint is never asked again: a later
  repair run acts on it once (a hand-back, or for an at-Integration set-aside with no `pr:` a restore, recut, defer
  or leave). It counts only until the task is re-entered: repair's hand-back and execute's "retry [[task]]" spend
  it first, since a hand-back leaves no stamp once the restart consumes `handed_back:`, and a later run, automatic
  retry (`auto_retry_at`) or automatic descope (its stamped `## Scope decision (automatic)` entry, written before
  the lead's hand-back) outdates it. So a block that comes back, an identical one included, goes to Lachy again, as
  decision 6 wants, while an answer recorded since the last re-entry counts whatever the verdict's why. A block with no fingerprint (a gate, a PR-less code-writing review) takes a `-` entry
  that never counts, so it is asked again. Status shows each set-aside's retry count and a `Needs you` block, where
  an answered block reads `answered: awaiting /thread:repair`.
