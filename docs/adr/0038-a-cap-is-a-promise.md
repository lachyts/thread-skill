# 0038 — a Cap is a promise

Date: 2026-10-18
Status: accepted, not built (amends ADR 0034 decision 2's ask-ahead wording and execute § 6.5's push rule; grilled
with Lachy 2026-10-18 in the lead session of `[[thread-skill-rollout-2026-10-17]]`, rewritten the same day after two
clean-room reviews of its earlier drafts)

## Context

`[[thread-skill-rollout-2026-10-17]]` ran 11 tasks from the clone with the standing approval at US$50. At
16:08 p19-10's plan declared `spend: … --runs 3 each, Opus model and judge, before and after the fix plus at most
one more iteration (up to 6 invocations, each --max-cost-usd 4) — cap 20 USD`. `approve-gates --standing`
refused it: `gated_inputs.py`'s `exposure()` found `each` twice and a bare `plus` outside the cap clause and
asked. The push came back "not sent (Remote Control inactive)" and the Needs-you log recorded it as pushed. The
rest of the queue merged, and p19-10 and its dependant p19-5 waited until Lachy signed at 09:59 the next morning.
p19-5's own gate (`spend: two make evals runs at --runs 3 (pre-trim and post-trim) — cap 50 USD total`) was then
refused on the bare `3`. ADR 0034's Context records the same undelivered push on 2026-10-10.

Both gates were under the limit; what stopped them was the planner's explanation of the spend, written into the
gate's own line, where the pricer reads every word. Two earlier drafts of this ADR loosened the pricer instead:
reviews showed that a pricer which reads only the cap clause would sign gates nobody should (one the plan judge
had flagged, and any gate found mid-run with no plan judge, such as ADR 0034's per-Login fast-mode gate behind a
comma). The pricer's fail-closed reading is the shared safety net; the fix belongs in what the planner writes.

## Decision

1. **A spend Gated input is one line: `spend: <what> — cap N USD <unit>`.** The **Cap** is that line's cap
   clause (`total`, a month, or one per-Login count across K Logins). How the spend splits (run counts, per-call
   limits, iterations) goes in nested sub-bullets under it, which the engine already treats as commentary and
   never prices (ADR 0013). The pricer is unchanged and stays fail-closed: what the gate's own line says is all it
   reads. Under this format p19-10's gate (`spend: claude plugin eval re-runs of the two close cases — cap 20 USD`)
   prices US$20 and p19-5's prices US$50.
2. **The planner is taught the format, and the plan judge enforces it.** The engine's planner and plan-reviser
   prompts state decision 1's format. The plan judge runs the pricer on each top-level `spend:` bullet, passing the
   gate on stdin (never as a quoted shell argument, where `$` and backticks expand), and returns `changes` quoting
   the pricer's reason when a bullet does not price, or when its sub-bullets name spend the Cap does not hold. A
   gate already in `## Approved gates` is exempt. Schedule's ask-ahead Planner line asks for the same format.
3. **An undelivered needs-you push falls back to ntfy.** The topic is `[notify] ntfy_topic` in
   `~/.config/thread/rollouts.toml`, the operator file the standing approval already uses (the plugin is public);
   `rollout-settings.py` learns the table before any operator writes it, since it refuses unknown top-level tables.
   The fallback fires only when the push tool reports Remote Control inactive or an error, never when it reports
   Lachy at the terminal. The Needs-you log records `pushed via push` or `pushed via ntfy`, and keeps
   `push failed:` for a delivery that failed on every channel; such an item is retried at most once more, at the
   next loop entry, then dedupes as today. A dedicated topic keeps these items apart from the estate's other ntfy
   traffic, so they can be audited on their own.

## Considered options

- *Keep everything and tell planners to use code spans:* what p19-11 did by luck; formatting no planner can see.
- *A pricer that reads only the cap clause, with the plan judge reading the rest (the second draft):* signs
  judge-flagged and judge-less gates unattended; needs a schema field and bounce state the judge does not have.
- *Loosen the pricer's word list (the first draft):* still refuses p19-10 on a bare `plus` and passes a per-Login
  cap behind a comma.
- *Raise the limit:* both refused gates were already under it.

## Consequences

- **No pricer change.** `gated_inputs.py`'s rules, its fail-closed reading and ADR 0034's residuals stand. It gains
  a stdin form for the judge (`exposure -` reading one gate), printing one JSON line.
- **The engine's prompts change** (planner, plan reviser, plan judge): their bytes change, so a call launched on the
  old script and resumed keeps its own `scriptPath` and replays unchanged. A judge `changes` over a gate's format
  climbs like any other `changes`; it should be rare once the planner is taught the format.
- **Schedule step 7's Planner line** (`## Decisions (asked ahead <date>)`) asks for the one-line gate with the
  split in sub-bullets.
- **Execute § 6.5** gains decision 3, `tests/contracts/execute-needs-you.test.mjs` its new log lines, and
  CONTEXT.md's Needs-you item entry the bounded retry.
- **A gate found mid-run** (no plan judge on the path) is priced as today: if its line does not price, it goes to
  Lachy. Decision 2 narrows how often that happens; it never signs anything the pricer would not.
