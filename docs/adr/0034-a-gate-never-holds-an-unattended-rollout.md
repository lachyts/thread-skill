# 0034 — a gate never holds an unattended rollout

Date: 2026-10-13
Status: accepted, shipped in 3.1.0 (implemented by p18-2, #121; amends ADR 0008, where a gated input always
paused the rollout until sign-off; from the 2026-10-13 orient grill of
`thread-skill-p18-2-a-gate-never-holds-the-rollout`)
*(Amended by ADR 0038, 2026-10-18: a spend Gated input is one line, `spend: <what> — cap N USD`, with the split
in sub-bullets; the planner is taught it and the plan judge enforces it; the pricer is unchanged; an undelivered
needs-you push falls back to ntfy.)*
*(Amended 2026-10-27 by p30-8, § Amendment below: spend is never asked ahead; the standing approval's limit is also a
calendar-month line.)*
*(Amended 2026-11-01 by ADR 0061: decisions 1 and 2 no longer hold for a credential gate that reads as its repo's
declared test credential, proved present in its declared file: the standing approval signs it, at any spend limit, and
schedule and orient record it instead of asking it ahead. Irreversible gates, and every other credential, are
unchanged.)*

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

## Amendment (2026-10-27, p30-8: spend is never asked)

From Chorus ADR 0108 d4 (`docs/adr/0108-upkeep-the-companion-does-the-machinery-and-learns-his-choices.md` in the
Chorus repo), grilled at Chorus's seventeenth orient, 2026-10-23. Lachy's words: "I have never denied a spend ever …
my time is far more important than you asking me about $5 here or $10 there … just go ahead and do it."

- **Decision 2 no longer covers spend.** Schedule § 3.6 and orient's R3 (c) record a spend smell and never ask it:
  the task keeps its `plan_approval: required` stamp, and step 7 (or orient's R5.2) writes ADR 0038 d2's Planner line
  alone under `## Decisions (recorded <YYYY-MM-DD>)`, a heading reflect.py's `ASKED_AHEAD_RE` never reads as asked.
  A limit Lachy names unprompted is still recorded exactly as before (`spend_approval_usd: <N>` above the standing
  approval, and the `## Decisions (asked ahead <date>)` section at any amount) and never asked again. Credential
  and irreversible gates are unchanged: still asked ahead, signed into `## Approved gates`.
- **The limit.** Lachy set `[defaults] spend_approval_usd = 200` in his `~/.config/thread/rollouts.toml` by hand on
  2026-10-23. The built-in stays 0 (off), because the plugin is public: for anyone else "never asked" means a spend
  gate reaches them mid-run, and schedule step 8 says so. No skill hard-codes 200 except as an example.
- **The month line.** A gate the per-gate limit covers is signed only while this calendar month's standing-approved
  spend, with it, stays within the same resolved limit (task, rollout, file, built-in; inclusive, as `covered()` is).
  The ledger is the rollout notes' `## Needs-you log`: `approve-gates --standing` appends one
  `- <stamp> [[<slug>]] signed under the standing approval: US$<x> (month to date US$<m> of US$<t>, <source>): <gate>`
  line per gate it signs, and sums this month's such lines (the mark right after the line's first wikilink, inside
  the section) over the `--rollout` note and every note directly in the tasks dir, `Archive/` and
  `Archive/Rollouts/` whose name is a dated rollout note's (`-rollout-<YYYY-MM-DD>[-N].md`), each once by real path,
  plus the call's own earlier signings. The month and the stamp are local time. A gate already in
  `## Approved gates`, or listed twice, is counted and logged at most once. A gate past the line is an `ASK:` naming
  it, and reaches Lachy as an ordinary (a) item.
- **The lock and the write order.** The read takes a machine-wide `standing-spend.lock` beside the note locks (never
  on `--dry-run`), held to the call's last save; note locks are taken inside it, never it inside one. A lock not
  taken in time is exit 1, and nothing written for any slug that needed the month read (taken lazily, it is never
  needed by a gate already approved, over the limit or bounced). Per slug the log line is saved first, then the task
  note, so a failure between the two over-counts: it fails closed.
- **Fail-closed reads.** A dated rollout note that cannot be read, or a directory that exists but cannot be listed,
  is an `ASK:` naming it, never a blind signing; a missing `Archive/` is skipped.
- **ADR 0038 d2.** Its Planner line, once written only with an ask-ahead answer, is now written on every spend-smell
  task, recorded, never asked.

Accepted residuals:

- (i) The line is each task's resolved limit, so a `[repo."o/r"]` table or a task stamp gives that task another line
  over the one machine-wide sum.
- (ii) A recurring per-month cap counts once, in the month it was signed.
- (iii) A gate re-signed (a changed cap, a re-gated task) counts again: an over-count.
- (iv) Lachy's own bare sign-offs are not counted: d4 counts Upkeep spend, what went ahead without him.
- (v) Caps are summed, not actual spend: an over-count.
- (vi) Engine snapshots (ADR 0043). A rollout cut before this change runs its snapshot's older `approve-gates
  --standing` until it moves (a hard pause's Reinstate, or a serial chain's first Leg after a `stopped` close) or
  finishes, so its signings, up to the per-gate limit, take no month check, no lock and no log line, and stay
  outside the month sum; a sign-off pause never moves, so its Reinstate signs the old way too. The window closes when
  the last pre-change snapshot retires, and nothing can be migrated, since no old line exists. Summing the old
  engine's `## Approved gates` standing annotations from task notes was considered and rejected: the task names the
  Needs-you logs as the ledger, and that sum would read every task note on each call.
- (vii) Chorus's own Upkeep spend (Chorus ADR 0099's Spill) is not in these logs.
- (viii) A hand-edited or deleted log line under-counts, and a legacy undated `<slug>-rollout.md` note (none live
  today) counts only as `--rollout`.
- (ix) orient-all's Sign-off round is unchanged. Its `rounds` never asks a hard-paused rollout's gate, and a pending
  spend gate on a running or sign-off-paused rollout has already been through the standing approval (step 1.2, or
  before `await-sign-off`), so it is over the limit, past the month line, unpriceable or bounced: an ask d4 keeps. The
  remainder, a gate left under an older, lower limit or last month's line on a sign-off-paused rollout, reaches
  Lachy there before the Reinstate's standing approval would sign it; signing it there is his own act.
- (x) orient-all's Leverage is unchanged too: `estate-rank.py` charges a sign-off (`REVIEW_MINUTES`' `signOff`) for a
  gate of any kind, `spend` included, so a spend-only task the standing approval would sign ranks as if it cost Lachy
  a sign-off. The ranker reads a gate's kind from the grade, never its price, and cannot see the operator's limit or
  the month line, so it cannot tell a spend gate that will be signed from one that will ask; with the built-in 0 (off)
  every spend gate asks and the charge is right. The over-charge only lowers that task's leverage, never hides an
  ask. readiness-grade.md § Leverage says so, and estate-rank's test 6 pins it (`que-call`, spend only, `signOff: 1`).
- (xi) A month-line `ASK:` on a running rollout is re-judged only under a new step-1.2 key, a new lead session or a
  Reinstate, never at the turn of the month mid-session; until then it reaches Lachy. A timezone change shifts a
  boundary line by hours.
