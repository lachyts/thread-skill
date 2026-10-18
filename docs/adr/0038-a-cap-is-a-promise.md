# 0038 — a Cap is a promise

Date: 2026-10-18
Status: accepted, not built (amends ADR 0034's fail-closed reading, execute § 3.7's exposure definition and
§ 6.5's push rule; grilled with Lachy 2026-10-18 in the lead session of `[[thread-skill-rollout-2026-10-17]]`,
revised the same day after a clean-room review of its first draft)

## Context

`[[thread-skill-rollout-2026-10-17]]` ran 11 tasks from the clone with the standing approval at US$50. At
16:08 p19-10's plan declared `spend: … --runs 3 each, Opus model and judge, before and after the fix plus at most
one more iteration (up to 6 invocations, each --max-cost-usd 4) — cap 20 USD`. `approve-gates --standing`
refused it: `gated_inputs.py`'s `exposure()` found `each` twice and a bare `plus` outside the cap clause and
asked. The push came back "not sent (Remote Control inactive)" and the Needs-you log recorded it as pushed. The
rest of the queue merged, and p19-10 and its dependant p19-5 waited until Lachy signed at 09:59 the next morning.
p19-5's own gate, in the wording its task note gave the planner (`spend: two make evals runs at --runs 3
(pre-trim and post-trim) — cap 50 USD total`), was then refused on the bare `3`; the same gate with `--runs 3`
in a code span prices US$50, which is how p19-11's gate passed the same evening. ADR 0034's Context records the
same undelivered push on 2026-10-10.

The script was reading planner prose word by word. Loosening its word list leaks both ways: a review of this
ADR's first draft showed that dropping rules 7 and 8 lets `cap 50 USD, per Login per month` price as 50 and
drops a separate `US$40` spend, while keeping the widening list anywhere still refuses p19-10 on "plus at most
one more iteration". Telling commentary from extra spend needs reading for meaning, which a script cannot do and
the plan judge can.

## Decision

1. **The script prices the cap clause; it never reads commentary.** A spend Gated input's exposure is its one
   cap clause: `cap N USD` and what its own clause says (`total`, a month, or one `per Login|account|seat|user`
   with its count), as `exposure()` reads that clause today. Text outside the clause (how the work splits,
   per-call limits, run counts, `each`, `plus`, bare numbers) is never read by the script. No cap clause, two of
   them, a non-USD or ambiguous currency in the clause, a range, or a per-unit cap with no count still asks.
2. **The plan judge reads the commentary against the Cap.** When it approves a plan, the plan judge checks each
   spend Gated input's text for anything that says the Cap is not the ceiling: a stated USD amount not folded
   into the Cap, a per-call limit times a count above it, a recurring or per-unit qualifier outside the clause,
   a widening word (`soft`, excluding tax or fees, `or more`). Any of those is a `changes` asking the planner to
   fold it into one Cap. The judge prices through a `gated_inputs.py exposure "<gate>"` command, the same code
   `approve-gates --standing` runs, never by eye.
3. **One bounce, no climb, then Lachy.** A `changes` the judge returns only over a Gated input's wording never
   climbs a rung and is not hardness evidence (execute § 3.7). A gate already in `## Approved gates` is exempt.
   After one such bounce, or when the planner states the gate cannot be one total (a per-Login cap with no known
   Login count), the gate goes to Lachy for sign-off as before. A gate found mid-run, with no plan judge on the
   path, goes to Lachy as before.
4. **An undelivered needs-you push falls back to ntfy.** The topic is `[notify] ntfy_topic` in
   `~/.config/thread/rollouts.toml`, the operator file the standing approval already uses (the plugin is public).
   The fallback fires only when the push tool reports Remote Control inactive or an error, never when it reports
   Lachy at the terminal. The Needs-you log records `pushed via push` or `pushed via ntfy`, keeps
   `push failed:` for a delivery that failed on every channel, and an item that failed is retried at the next
   loop entry rather than deduped for ever. A dedicated topic keeps these items apart from the estate's other
   ntfy traffic, so they can be audited on their own.

## Considered options

- *Keep fail-closed pricing and tell planners to use code spans:* what p19-11 did by luck; a rule that turns on
  formatting no planner can see.
- *Loosen the word list (this ADR's first draft):* rule 7 and 8 off, widening words anywhere. The review showed it
  both refuses p19-10 and passes a per-Login cap behind a comma.
- *A fixed gate format with no commentary:* strict and simple, but the planner loses the room to say how the
  spend splits, which is what the judge needs to check the Cap.
- *Bounce until the plan rounds run out:* a gate only Lachy can price ends plan-blocked instead of as a sign-off.
- *Raise the limit:* both refused gates were already under it.

## Consequences

- **The pricer.** `exposure()` stops reading text outside the cap clause: rule 7 (multipliers, periods,
  `per`/`each`, widening words outside the clause), rule 8 (a bare number outside the clause) and the second half
  of rule 9 (every other USD amount) are dropped from the script and move to the plan judge (decision 2). Its
  `main()` gains an `exposure` subcommand printing one JSON line. ADR 0034's § Consequences *A fail-closed
  reading* and its two pinned residuals are superseded, and the tests change with it.
- **The plan judge.** Its prompt gains decision 2's check, run through the command, and the engine marks a
  gate-wording `changes` so it is not escalated (decision 3). The engine's prompt bytes change: a call launched
  on the old script and resumed keeps its own `scriptPath` and replays unchanged.
- **Execute § 3.7** stops defining exposure as "plus every other USD amount the gate names", and its *Standing
  approval* paragraph gains decision 3's bounce. **Schedule step 7's Planner line** (`## Decisions (asked
  ahead <date>)`) stops saying a cap the standing approval cannot price is asked mid-run: it asks for one cap
  clause that holds every amount.
- **Execute § 6.5** gains decision 4, and `tests/contracts/execute-needs-you.test.mjs` its new log lines.
- **Until this is built** the old reading applies; CONTEXT.md's Standing approval entry is updated with the
  pricer change, not before.
