# 0035 — one human fix per refusal

Date: 2026-10-13
Status: proposed, implementation pending (amends ADR 0033; from the 2026-10-13 orient grill of
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
