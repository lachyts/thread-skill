# 0037 — Reflections run on their own and tune for hands-off quality

Date: 2026-10-15
Status: accepted, the plugin half built by P21 (#144–#150) and shipped in 4.0.0; the workspaces half (d4's
daily-sweep trigger, p21-9, and d7's `fixes:` key in the shared /add writer, p21-5) landed in
claude-workspaces PR #5 (amends ADR 0032 decisions 3 and 5 and its objective; grilled with Lachy 2026-10-15 in
`/thread:orient` on the Thread Skill repo)
*(Amended 2026-10-17 by thread-skill-p22-7: d5's decision task also carries a held trade or caution,
the knob d1 leaves to Lachy. "A rule proposal, or a Watch to confirm, goes into one vault task" reads
"A rule proposal, a Watch to confirm beside it, or a held trade goes into one vault task", and "A
quiet week writes only its record line" reads "...its record line, and the decision task a held trade
needs". d6's quiet definition and the cadence are unchanged.)*

*(Amended by ADR 0051, 2026-10-21: the weekly reading keeps a Time-lost ledger, a Monthly audit rides the month's first
reading, the Run record gains stop, suite, load and moved-`main` events, and d4's reading falls due on the Thursday
Reflection Routine's morning, made by Chorus's weekly Runner, the daily sweep its fallback.)*

## Context

ADR 0032 gave rollouts a Run record and a Retro that scored it on Throughput and proposed knob
Tunings for Lachy to pick. Eleven days and about 16 rollouts later, `tunings.jsonl` held one line
(thread-skill-rollout-2026-10-09: binding `none-clear`, nothing applied). A Retro ran only when
Lachy remembered to run one. So decision 5's gate, three agreeing Retros, could never be reached.

Lachy then stated what the loop is for: **the best-quality work with the least handholding.** He
wants rollouts set going overnight and ready by morning, with every question asked at the top of
the run. He also suspects the review loops waste rounds fixing the previous round's fix. The Retro
measured none of this. Throughput, its one headline, matters little once a run finishes
overnight. And the `review-round` event that would show the review waste is specified but not
emitted (p15-7 is open; `reviews.jsonl` does not exist).

He also wants Thread's loop and Chorus's `/reflect` (Chorus ADR 0043) to be uniform,
and both of them automatic.

## Decision

1. **Two headlines, not one.** A Reflection scores **Hands-off rate** (the share of tasks that
   land with no act from Lachy once the run has started) and **Quality** (how few **Escapes** the
   landed work produces). Throughput becomes a Guardrail, bounded so an overnight run still
   finishes by morning. **Review churn** (rounds whose findings only answer the previous round's
   fix, in the engine's review loop and in `/fresh-review`) joins the Guardrails, and every
   Reflection reports it. When a proposal trades one headline against the other, Lachy decides;
   there is no tie-breaker.
2. **Chorus's words.** The Retro is renamed **Reflection** and `/thread:retro` becomes
   `/thread:reflect`. The old name is deleted outright, with no alias stub. Tunings take Chorus's
   altitudes: **knob** (a rollout-settings value), **rule** (how a skill or the engine behaves:
   a grill and an ADR before a build) and **bug** (a task). A pattern seen in one rollout is a
   **Watch**. It becomes a rule proposal when a later rollout shows it again, or at once when
   Lachy confirms it. The record nouns stay each project's own.
3. **The Reflection reads the friction.** Beyond the script scores, a model reading traces each
   thing that cost a headline to the rule that produced it. That covers every mid-run ask, Human
   fix, repair run, set-aside, retry, descope, Escape and churned review round. A mid-run ask is
   traced to why the schedule-time grill did not catch it.
4. **Score each rollout, read weekly.** Every completion ceremony runs the script score and writes
   its `tunings.jsonl` line on its own, at no model cost. A model Reflection runs on its own once
   a week over all the week's rollouts, on Opus at xhigh effort with no token cap. The current
   rollout's Escapes are not known at completion; each weekly reading counts the Escapes against
   the earlier rollouts that landed them.
5. **What lands without Lachy** (decision 5 of ADR 0032, decided here):
   - A **bug** is filed as a Thread Skill task, so a later rollout fixes it. A bug already open
     is never filed twice.
   - A **knob** lands once three Reflections agree on its rule and no Guardrail is breached. A
     later Reflection that finds that knob breaching a Guardrail reverts it on its own.
   - A **rule** never lands unasked. A rule proposal, or a Watch to confirm, goes into one vault
     task scheduled for the next morning, and orient's audit lists it, so it is decided at the
     top of a run, never during one. A quiet week writes only its record line.
6. **The cadence relaxes on a quiet streak.** Three **quiet Reflections** in a row (no new Watch,
   no rule proposal, no bug, no Guardrail breach) move the reading to fortnightly. Any Reflection
   that is not quiet moves it back to weekly. The Reflection records each change. Chorus's
   Reflection cadence (vault task `chorus-reflect-cadence`) should take the same shape.
7. **Escapes are traced, not guessed.** A task written to fix landed work carries
   `fixes: [[<landed task>]]`; every task writer that can write such a task adds the key. The
   Reflection also reads reverts and later review findings from git.

## Considered

- *One headline (Hands-off rate, with Quality as a Guardrail, or the reverse).* ADR 0032 warned
  that a scorecard with no headline is never decisive. Lachy chose two anyway: both are the point,
  and Lachy settles any trade-off between them.
- *A model reading of every rollout at completion.* Faster feedback, but about one reading a day.
  Patterns across rollouts are what a Watch needs, and a weekly reading sees them in one pass.
- *Rule changes drafted and run without a grill once a Watch recurs.* The most hands-off option,
  but how the skills behave would change with no one ever deciding it.
- *One shared Reflect skill for both repos.* The most uniform option, but it ties two repos and
  their releases together. Shared words and shape give the uniformity without that.
- *Inferring Escapes by model, or counting only git reverts.* The first is fuzzy and costs reading
  time. The second misses most Escapes, which arrive as new tasks.

## Consequences

- The `review-round` emitter (p15-7) and an engine-loop equivalent are prerequisites: without
  them, Review churn reads as unknown.
- The routing evals need a case that tells "reflect on the rollout" from "reflect on the
  Companion".
- The automatic weekly run needs a headless home, like `/method`'s curation from the daily
  sweep. It must still run on this harness and account.
