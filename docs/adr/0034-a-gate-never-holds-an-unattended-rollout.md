# 0034 — a gate never holds an unattended rollout

Date: 2026-10-13
Status: accepted, shipped in 3.1.0 (implemented by p18-2, #121; amends ADR 0008, where a gated input always
paused the rollout until sign-off; from the 2026-10-13 orient grill of
`thread-skill-p18-2-a-gate-never-holds-the-rollout`)
*(Amended by ADR 0038, 2026-10-18: a spend Gated input is priced on its Cap alone, a promise the task keeps, so
commentary outside the cap clause no longer asks; words that say the Cap is not the ceiling still count; the
plan judge sends an unpriceable gate back to its planner; an undelivered needs-you push falls back to ntfy.)*

## Context

`[[chorus-rollout-2026-10-10]]` ran 44 h 28 m. One task, `chorus-p18-7-fast-while-held`, declared two spend
gates (a US$5 probe; fast mode at US$50 per Login per month) in the run's first hour. The push never reached
Lachy, the rest of the queue merged, and the rollout went `stuck` on the gate and waited overnight: about 42 h
from the gate being known to his answer. An approval matches the planner's exact gate text (execute § 3.7), so
nothing can be signed before a plan words its gate; some gates will always first appear mid-run.

## Decision

1. **A standing approval.** Lachy signs, once, every spend gate whose total exposure is at most US$50: the cap
   summed across Logins, a recurring cap counted per month, US$50 itself included. Such a gate passes without
   him and is written to `## Approved gates` as auto-approved under the standing rule. Credential and
   irreversible gates never pass under it. The threshold lives in the operator settings (`rollouts.toml`), not
   in the skills. Under this measure p18-7's US$5 probe passes and its fast-mode gate (about US$150 a month)
   asks.
2. **Ask ahead.** A gate the standing approval does not cover is asked before dispatch wherever the work is
   shaped (the grill, orient, schedule's confirm batch), and his answer is recorded on the task.
3. **A gate found mid-run is set aside, never held.** The task is set aside and pushed once; the queue runs
   everything else and the completion ceremony runs with that task listed as waiting on him. His later
   sign-off resumes it in a new run. A rollout never sits `stuck` on a gate alone.

## Considered options

- *Set aside but hold the rollout open* until sign-off: keeps today's `stuck`, minus the blocking.
- *Front-load gate-smelling tasks* so gates fire while he is at the Mac: a heuristic, not a guarantee; it may
  still be used as an ordering hint but is not the rule.
- *Cap read literally, per Login*: would let three Logins at US$49 a month pass as "under US$50".

## Consequences

- **The key and its built-in.** The limit is the Rollout settings key `spend_approval_usd` (whole US dollars,
  `[defaults]` or a `[repo."o/r"]` table of `~/.config/thread/rollouts.toml`; an integer >= 0). It is no Tuning key:
  schedule shows it but never stamps it on a rollout, and `reconcile-rollout.py approve-gates --standing` resolves
  it itself, task frontmatter (an ask-ahead answer), then rollout frontmatter, then the file, then the built-in.
  The built-in is 0, which is off: the plugin is public, so spend fails closed until the operator's file says
  otherwise. Decision 1's US$50 is written there, never into the skills.
- **The annotation.** A covered gate is written to `## Approved gates` as
  `(approved <date> under the standing approval: total exposure US$<x>, limit US$<t> from <source>)`. It begins
  `(approved `, holds no `)` and goes last, so the engine's `normalizeGate` and `GATE_ANNOT_RE` strip it unchanged
  and the engine's prompts stay byte-identical (no resume cache is invalidated). It records the approval as the
  task's **total exposure**, which the engine's gated-input rule makes a ceiling, never a target: blowing it is a
  verifier or review failure, never an approved spend.
- **A fail-closed reading.** `skills/_shared/scripts/gated_inputs.py`'s `exposure()` prices a gate as its cap times
  the clause's per-unit count (a recurring cap counted per month), plus every other USD amount the gate names, so
  p18-7's probe reads 9 (its US$5 cap plus its US$4 stop line) and passes, and its fast-mode gate (US$50 per Login
  with no Login count) asks. Anything it cannot price asks: a non-USD or ambiguous currency, a range, a magnitude,
  a multiplier or period outside the cap clause, a bare number, more than one cap, a count of a unit other than
  the cap's per-unit one (a Login can hold several users), or a word that says the cap is not the ceiling (`plus`
  tax, fees or overage, `soft`, `to start`, `for now`), inside the cap clause or out. Two residuals are accepted and
  pinned by its tests: a number word outside the clause with no Login/account/seat/user noun is not counted, and
  `every`/`a`/`an` before a noun that is not a listed unit (`every push`) reads x1. The second stays because a
  blanket `every` would make the probe ("every signed-in Claude Login") ask, and it is safe because the cap is the
  task's total ceiling and the annotation says so.
- **The sweep.** Schedule § 3.6 runs `gated_inputs.py sweep` over every candidate instead of reading word lists by
  eye: the new words (`credit`, `usage credits`, `extra usage`, `fast mode`, `per month`, `AUD`, `max_budget`) plus
  a currency amount marker in place of the old literal `$` (`US$`, or `A$`/`AU$`/`NZ$`/`C$`/`CA$` before an amount,
  or a bare `$` before an amount in prose), so shell variables never flag and AUD amounts do. Its output is the
  recall floor, never the verdict: a hit whose context names nothing the task pays for is dismissed, and listed.
- **Ask ahead.** The answer is recorded on the task: `spend_approval_usd: <N>` above the standing approval, a
  `## Decisions (asked ahead <date>)` section whose Planner line asks for one priceable total (so an answer above
  the standing approval can actually match the gate the planner words), and a credential or irreversible sign-off
  as an `## Approved gates` bullet the planner restates verbatim.
- **The engine is unchanged.** Its per-call stop stays unconditional; the lead applies the standing approval after
  the stop (execute § 4.5 step 1.2, and again at Reinstate), and the signed-gate resume works as before.
- **The sign-off pause.** When only gate-pending tasks and their queued dependants remain, `next` reports
  `halt: awaiting-sign-off` instead of `stuck`, and execute's sign-off form folds the journals, closes what it can,
  runs `await-sign-off` (`paused:` with `paused_for: sign-off`), writes the Completion log with the waiting gates
  and closes the thread, without calling the question tool. The rollout stays open, paused, rather than archived,
  because schedule picks up only `status: open` tasks: under an archived rollout the gate-pending task would never
  be scheduled again. While it waits its note is live, so reconcile-project never reads its log; the log's waiting
  bullet carries `not landed`, so once a later full ceremony archives the note it is never landing evidence.
  `clear-pause` refuses a sign-off pause while a gate is unsigned (`STILL-AWAITING`, exit 3), so a reinstate never
  re-runs the form. A sign-off pause keeps the repo's one unfinished rollout until each gate is signed or deferred:
  schedule's refusal names that one-step path (sign off, then `/thread:execute`, or `/thread:repair` to defer).
- **Install before write.** An installed `rollout-settings.py` older than this change refuses the unknown key, which
  would refuse every rollout's settings (and `auto_retries` with them), so `[defaults] spend_approval_usd` is written
  only after the plugin that knows it is installed.
