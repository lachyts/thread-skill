# 0035 — one human fix per refusal

Date: 2026-10-13
Status: proposed, implemented by p18-3 (amends ADR 0033; from the 2026-10-13 orient grill of
`thread-skill-p18-3-one-human-fix-per-refusal`, after PR #107's three review rounds)

## Context

Every cause that only a person can move (a gate, an undecided RACE, a refused descope, an Integration set-aside
with no PR) was a numbered prose rule that execute § 6.5 (c), status's Needs-you line and repair § 2 each
re-derived. PR #107's fixes hit the review ledger's STOP three times: round 2 found 14 issues, 11 caused by
round 1's own fix.

## Decision

1. **The script names the fix.** `auto_retry_verdict` emits one deterministic **Human fix** (act plus detail)
   per refusal cause, printed through `inputs`. Execute, status and repair read it and never re-derive it. A
   new cause is one script branch plus one test.
2. **A refused descope is durable and fails closed.** On exit 3 the script writes a marker carrying the reason;
   the task becomes a Needs-you item whose Human fix is to decide the descope. Only a recorded human answer
   (through repair, or Lachy) lifts it; a later descope by the lead never overrides it. A malformed call (bad
   arguments, not exit 3) records nothing.
3. **A recorded answer is acted on by the lead.** Once nothing is paused, acting on a recorded answer is
   mechanics: the lead hands back on its next tick, and automatic descope skips a block carrying an answer.
   `inputs`' `answerRecorded` (parsed timestamps) is the one read shared by execute, status and repair. An
   identical re-block after a spent answer is a new Needs-you item and is pushed again.
4. **An Integration set-aside with no `pr:`** gets the Human fix *restore*: repair § 4's restore, or § 3c's
   PR-less merge when the PR is already merged. `hand-back` is never named for it.

## Consequences

- **The Human fix list lives in `lead-integrate.py`.** `auto_retry_verdict` is an ordered list of causes, and
  `inputs` prints `humanFix` ({act, detail, handBack, label, raise}, the act one of `HUMAN_FIX_ACTS`) beside today's
  verdict keys, which are unchanged when no answer is recorded. H0 `finish the recorded answer` (an answer whose way
  back is more than a bare hand-back), H1 `sign off gated input`, H2 `fix its rollout: or defer`, H3 `decide RACE` /
  `decide UNVERIFIED`, H4 `answer the question`, H5 `decide scope or defer` (a block after a descope, or a refused
  one), H6 `restore, recut or defer` (at Integration with no `pr:`), H7 `fix the note's pr: or defer`, H8 `restore,
  recut or defer` (a gone branch), H9 `raise <field>, hand back or defer` (the source run's own spent budget, its
  `raise` the field: `max_review_rounds`, `max_plan_rounds` or `max_iterations`), H10 `hand back or defer`, H11 the
  same for a code-writing review with no PR, H12 `fix the round budget`. A null `humanFix` is the lead's own re-entry
  (a seeded revise, an automatic retry now or after a cool-down, a recorded `hand-back` answer). `handBack` is true only
  when, once Lachy has answered, a bare `hand-back` is the whole way back; H6, H7 and H8 change the note first, so they
  are false. The label is `(<status>, <section> run <n>)` (`(review, no PR)`, `(gate-pending)`), with `, ask <k+1>` once
  k answers to the block were spent, so an identical re-block after a spent answer is a new item, pushed again.
  `--max-review-rounds` is an overlay `humanFix` ignores, so a hand-resolved K never hides a fix.
- **`answerRecorded`** (reconcile-rollout.py `_answer_recorded`) is the one read execute, status and repair share: the
  live `## Repair input` entry for the block's current fingerprint whose stamp is strictly later than the last
  re-entry (every run heading in any section, `auto_retry_at:`, every automatic descope entry, and `started:`, which
  covers a task deferred and re-scheduled). A tie, an unparseable stamp and two live entries sharing the newest stamp
  fail closed. Its key forms: live `(block <fp>)` (a `hand-back` answer), `(block <fp>; awaiting repair)` and
  `(block <fp>; left)`; dead `(block <fp>; handed back <stamp>)`, `(block <fp>; superseded <stamp>)` and `(block -)`.
- **`record-answer` is the only writer of an answer.** One task-note save, the entry last, after the `## Needs you`
  removal it answers, a `--raise <field>` (all three budgets, validated against the cause's `humanFix.raise`, or
  `max_review_rounds` for a revise re-entry with no round left: `lastRound + 1` there, else the resolved value + 1,
  with its rollout `## Notes` line written first) and a confirmed `--pr`. A note holding a `## Needs you` question takes
  only `--kind needs-you` (a `decision` is refused, nothing written), so no answer stands beside a stale question. It
  supersedes every earlier live answer for
  the block, and its stamp is unique per block: now's minute, bumped one minute past the last re-entry and every entry
  for the fingerprint when now is not later (a bump more than a minute ahead refuses). A raise and a `pr:` are
  every-mode writes only inside an answer's save. An own call starts its budgets afresh, so its raise is + 1 per call.
- **Every hand-back spends.** `hand-back` rewrites every live key to `; handed back <stamp>` in the save that moves the
  note (a refused one spends nothing), so no bare hand-back can leave an answer to re-arm the lead's *Recorded answer*
  on an identical re-block. `hand-back --answer <stamp>` is a compare-and-swap on the stamp and the form `hand-back`,
  so the lead and repair never both hand back on one answer, nor a new block on an old one.
- **An answered block is never retried automatically** (amends ADR 0033 decision 2): the verdict reads
  `answered for this block …`, and only the lead's *Recorded answer* (a `hand-back` answer with a null `humanFix`, once
  nothing is paused) or repair moves it. The descope verb refuses an answered block (exit 1, nothing written): the race
  where the lead judged a block before repair answered it.
- **A refused descope is recorded** under `## Descope refused (automatic)`, keyed on the top Plan-blocked run's number
  and sha (a legacy run's text sha when its marker is gone); a malformed line fails closed, and the section is never
  brief text. A recorded refusal re-exits 3 before the part is judged, an answer included; exit 1 and exit 2 record
  nothing.
- **"Leave it" is now `; left`:** answered, listed under its cause's item text (so never pushed again), and never
  retried or asked again. It was a fingerprinted entry that counted as answered before; now it is a form of its own.
- **H6 widens decision 4's "restore"** to repair § 4's full offer, `restore, recut or defer`, with § 3c's PR-less merge
  named in the detail for a MERGED PR.
- **Existing pushed items are reworded once.** A live rollout's (c) items whose act changed (an Integration set-aside
  with no `pr:`, now `restore, recut or defer`, and a needs-you stop, now `answer the question`) read as new text, so
  each is pushed again once after the upgrade.
