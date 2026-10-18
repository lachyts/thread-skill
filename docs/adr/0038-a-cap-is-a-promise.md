# 0038 — a Cap is a promise

Date: 2026-10-18
Status: accepted, not built (amends ADR 0034's fail-closed reading and execute § 6.5's push rule; grilled with
Lachy 2026-10-18 in the lead session of `[[thread-skill-rollout-2026-10-17]]`)

## Context

`[[thread-skill-rollout-2026-10-17]]` ran 11 tasks from the clone with the standing approval at US$50. At
16:08 p19-10's plan declared `spend: … --runs 3 each, Opus model and judge, before and after the fix plus at most
one more iteration (up to 6 invocations, each --max-cost-usd 4) — cap 20 USD`. `approve-gates --standing`
refused it: `gated_inputs.py`'s `exposure()` found `each` twice outside the cap clause and asked. The push came
back "not sent (Remote Control inactive)" and the Needs-you log recorded it as pushed. The rest of the queue
merged, and p19-10 and its dependant p19-5 waited until Lachy signed at 09:59 the next morning. p19-5's own gate,
in the wording its task note had given the planner (`spend: two make evals runs at --runs 3 (pre-trim and
post-trim) — cap 50 USD total`), was then refused on the bare `3`; the same gate with `--runs 3` in a code span
prices US$50, which is how p19-11's gate passed the same evening. The pricer was reading formatting, not risk.
ADR 0034's Context records the same undelivered push on 2026-10-10.

## Decision

1. **A Cap is a promise.** A spend Gated input's exposure is its one Cap, `cap N USD`: the amount times the
   per-Login or per-month count inside its own clause, as before. Everything else the gate says (how the work
   splits, per-call limits such as `--max-cost-usd 4`, run counts, `each`, bare numbers, flags) is the planner's
   account of the work and never widens it, because the task is bound to stop at the Cap: blowing it is a
   verifier or review failure (ADR 0034).
2. **Words that say the Cap is not the ceiling still count.** An amount after `plus` adds to the Cap. A vaguer
   widening word (`soft`, excluding tax or fees, `or more`, `uncapped`, `to start`, `for now`) asks. No Cap, more
   than one, a non-USD or ambiguous currency, a range, or a per-unit Cap with no count asks, as before.
3. **The plan judge sends an unpriceable spend Gated input back.** A plan whose spend Gated input `exposure()`
   cannot price is a plan-judge `changes` that quotes the pricer's reason, so the planner restates it as one Cap.
   Only a gate priced above the limit, and every credential or irreversible gate, reaches Lachy.
4. **A needs-you push that is not delivered falls back to ntfy.** When the push tool reports that it did not
   deliver (not sent, no Remote Control, an error), the lead sends the same one-line item to an ntfy topic of its
   own at high priority. The Needs-you log records the channel that delivered it: `pushed` only when one did,
   `push not delivered` otherwise. A dedicated topic keeps these few items apart from the estate's other ntfy
   traffic, so they can be audited on their own.

## Considered options

- *Keep fail-closed pricing and tell planners to use code spans:* what p19-11 did by luck; a rule that turns on
  formatting no planner can see.
- *The Cap alone, widening words ignored:* would sign "cap 20 USD, plus a US$40 setup fee" as US$20.
- *Every widening word asks:* "plus US$15" prices, so asking about it is the same stop for nothing.
- *Raise the limit:* both refused gates were already under it.

## Consequences

- **The pricer.** `exposure()`'s rule 7 (multipliers, periods, `per`/`each` outside the clause) and rule 8 (a bare
  number outside the clause) stop asking, except that a WIDENING word anywhere still applies decision 2; rule 9
  sums the Cap and the amounts a `plus` names, never every USD amount in the gate. ADR 0034's § Consequences
  *A fail-closed reading* and its two pinned residuals are superseded by this, and the tests change with it.
- **The plan judge.** The engine's plan-judge prompt gains the check, so its bytes change: a call launched on the
  old script and resumed keeps its own `scriptPath` and replays unchanged.
- **Schedule's ask-ahead is unchanged.** Its `## Decisions (asked ahead <date>)` Planner line already asks for one
  priceable total; under decision 3 a planner that ignores it is sent back rather than stopping the task.
- **ntfy is operator config.** The topic lives in the operator's environment (launchd's, beside the estate's other
  ntfy topics), never in the skills, since the plugin is public. With no topic set the fallback is skipped and
  the log says `push not delivered`, so the report never claims Lachy was told.
