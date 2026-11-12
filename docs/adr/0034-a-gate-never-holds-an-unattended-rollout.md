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
*(Amended 2026-11-01 by ADR 0063: decisions 1 and 2 no longer hold for a credential gate that reads as its repo's
declared test credential, proved present in its declared file: the standing approval signs it, at any spend limit, and
schedule and orient record it instead of asking it ahead. Irreversible gates, and every other credential, are
unchanged.)*
*(Amended 2026-11-05 by p37-4, § Amendment (2026-11-05) below: unpriceable never means asked. A spend gate the
exposure reading cannot price is priced from its readable cap and signed within the limit and the month line, and
`per`/`each` is a rate only before a unit. A credential gate naming only a declared test Login (`[defaults]
test_logins`) passes the standing approval too, so the 2026-11-01 line's "every other credential, are unchanged" no
longer holds for a declared test Login.)*
*(Amended by ADR 0075, 2026-11-07: decision 3's gate found mid-run is set aside and listed, never pushed; no
rollout ever pushes, and the ntfy fallback ADR 0038 added is superseded.)*
*(Amended 2026-11-13 by p48-4, § Amendment (2026-11-13) below: a spend plainly under the limit never asks. A gate
neither earlier reading prices is read at its widest and signed within the limit and the month line; a gate that names
no amount it can read, or none a cap word governs, still asks.)*

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

## Amendment (2026-11-05, p37-4: unpriceable never means asked)

`[[chorus-rollout-2026-11-02]]` stopped for Lachy's sign-off on a US$1 probe: `spend: live probe of a tag-led Steer
into a running Turn (Haiku 4.5, CLI 2.1.314 and the day's pin, per the task note's 'Measure first') — cap 1 USD`. The
exposure reading refused it on `per/each outside the cap clause: per`, the word "per" in prose read as a rate. Lachy,
2026-11-03: "I can't believe that I am still giving permission for small amounts of money on these rollouts … How can
we prevent it from having any gates on spends in rollouts?" He first answered **Never ask**, then kept the US$200
line: "you're asking me about $1 and stopping a whole rollout for it". The limit is right; the failure was that a gate
the pricer could not price asked however small it was. The same day: rollouts may use the dummy Claude Login for
probes without asking, always.

- **Cap-only pricing.** `approve-gates --standing`, and the `exposure -` CLI the plan judge runs, apply
  `gated_inputs.py`'s standing reading: the full reading (decision 1's, unchanged) when it prices; else the cap-only
  reading. That runs the full reading's rules 1-4 and 6 as ever (no cap, two caps, a malformed, magnitude or range
  amount anywhere, a non-USD or ambiguous currency anywhere still ask), reads the clause with a cap-only reject list
  (any `per`, `each` or `every`, a multiplier, `%`, any `plus` or `+`, widening word, currency or per-unit noun on the
  cap still asks; a digit, number word or bare unit noun beside it does not), and outside the clause asks only on a
  plural Logins/accounts/seats/users (7(ii)) or a per-unit word (7(ix)). Its value is the full reading's sum, the cap
  times the clause's count plus every other USD amount the gate names, so it never reads below what the full reading
  would: `US$500 per run — cap 1 USD` reads 501 and asks over the line. Only a gate with no readable cap, or one over
  the line or past the month line, reaches him. A gate signed so is annotated and logged exactly as a fully priced
  one, and its approval line names the full reading's why.
- **The per/each reading.** Outside the cap clause (rule 7(i)), `per` or `each` is a rate only before a unit (a
  RATE_UNITS noun or a digit, joined by whitespace, `-` or `/`), `each` also before `of`, punctuation or the gate's
  end, or straight after a digit: never in prose (`per the task note`). On the cap itself (rule 5), any `per`, `each`
  or `every` still asks in both readings, whatever follows it, as before: a rate on the cap never prices as a bare
  total (`cap US$0.10 per GB`, `cap US$5 per developer`, `cap US$5 each for the images`; review round 1 of p37-4's PR,
  which found the relaxed in-clause reading pricing those at the cap). A new last rule 7(ix) asks on a per-unit word
  outside the clause (`per the dummy Login`, `each new Login`, `every Login`, `/Login`), so relaxing per/each never
  lets a per-Login reading through. `every signed-in Claude Login` (p18-7) still passes.
- **The plan judge.** The CLI prints only the standing reading's {usd, why}, so a gate whose cap reads prints its
  amount, and the judge, which bounces only a null "usd", never bounces it on wording alone. task.workflow.js is
  unchanged, so no prompt bytes change. ADR 0038's bounce stands for a gate neither reading prices, and a bounced
  note still signs nothing.
- **The test Login.** A credential gate whose text names a Claude Login and no env name passes when every Login it
  names is one of the machine's declared test Logins: `[defaults] test_logins` in `~/.config/thread/rollouts.toml`
  (rollout-settings.py, schema 5), one line, operator-only (ADR 0063 d1's rule: no agent or script writes it, since an
  agent could otherwise widen its own approval; tune.py refuses an edit that changes it). It fails closed: a deny word
  (a `live` before a probe, run or test excepted), an env name, another credential word beside it, an `@` address, a
  conjunction that joins a second thing (`and`, `or`, `plus`, `as well as`, `along with`, `together with`, `&`, `+`,
  `;`), a plural `Logins`, a Login it cannot name or one not declared asks. It reads no limit, ledger or month line,
  is machine-wide (a Leg signs one), and is annotated `(approved <date> under the standing approval: test Login
  <name>, from <source>)`. Schedule and orient record it ahead, never ask it (p39-3): the sweep's `login` field reads
  each `credential:` gate line naming a Login with the declared test Logins, read from rollouts.toml only when a
  reading needs them.
  The built-in is [] (off): the plugin is public, so a hard-coded `dummy` was rejected. Lachy adds `test_logins =
  ["dummy"]` (with `schema = 5`) by hand, after installing the release that knows the key and running the reader
  check rollout-settings.py's header names; until then the Login gate asks as before.

Accepted residuals, each safe because the cap is the implementer's ceiling (the engine's GATED_INPUTS_CHECK: blowing
it is a verifier or review failure) and the annotation records the total exposure:

- (i) In the cap-only reading, outside the clause, widening words, `%`, multipliers, periods, rates that are no
  per-unit word and bare numbers are waived (`soft probe`, `3 runs`, `plus 20%`, `×3`, `each night`).
- (ii) Inside the clause, digits, number words and bare unit nouns that are no per-unit noun are waived: `cap 1 USD
  for 3 runs`, `10k tokens` and `for both probes` read as the cap, a total.
- (iii) Outside the clause, a `per` rate whose unit is not straight after it, or not on RATE_UNITS (`per generated
  image`), reads x1 in the full reading, the value the cap-only reading gives anyway, as `an image` does. On the cap
  itself it asks in both readings.
- (iv) Outside the clause, an `each such call`-style rate reads x1 in the full reading, the value the cap-only reading
  gives anyway; on the cap itself it asks.
- (v) A judge-less mid-run gate (ADR 0038's second reason) now signs at its cap plus its amounts; the per-Login gate
  behind a comma (its first) still asks, on 7(ix).
- (vi) The test-Login reading asks falsely, fail closed, on `access` or `token` beside the Login (`access to the dummy
  Claude Login`, `the dummy Claude Login's session token`), on an account, key, API, PAT or `.env` anywhere on the
  gate's line, on any conjunction or `+` (two declared Logins joined by `and` ask: a comma or `then` lists them), and
  on a `live` before anything but a probe, run or test. Schedule and orient's Planner line (p39-3: schedule step 7's
  and orient R5.2's test-Login Planner line) words the gate to avoid them. Its deny list and other-credential, `@`
  and conjunction steps are a reject list, not a whitelist, as ADR 0063 residual (i) is for the class: a second thing
  named in plain prose with none of them (`the dummy Login, to push to the npm registry`, `the dummy Login, then
  Lachy's Gmail`) passes, and the annotation names only the Login, so any other use is a review failure.

## Amendment (2026-11-13, p48-4: a spend plainly under the limit never asks)

The ruling, decided for Lachy at the `/thread:orient Thread Skill` grill of 2026-11-12 on his standing word (spend is
never asked below US$200, for a single spend or the month: Chorus ADR 0108 d4, kept 2026-11-03; "a variation or
nuance of a spend under that line must never stop a rollout, whatever its wording"): "A spend gate the pricer cannot
read, but which is plainly under the cap, signs under the Standing approval. *Plainly under* means every amount the
gate's line names, read at its widest (the top of a range, a rate times its stated most calls, a split summed), is
under the cap. A gate that names no amount at all goes back to its planner once to restate it with one; only a gate
that still names none asks him."

The corpus: every spend gate under US$200 of `[[thread-skill-rollout-2026-10-26]]` and the 2026-11-03 smart-slider
rollout already signs (p27-5's two from their caps, at US$20 and US$3; smart-slider's two in full, at US$5 and US$10),
so the Verify is a regression pin. Of the vault's 35 distinct spend gates only three read null, and still do: the
Cartesia free-tier gate (a `+` with no amount after it), `spend: none authorised. …` (no amount) and p18-7's
fast-mode gate (a per-Login cap with no count). The wordings the pricer refused were the ruling's: a split (`2 cap
clauses`), `plus US$5`, a range, a non-USD cap (`no cap clause`), a counted rate (`unrecognised clause: per call`),
`US$1k`, `x 3` and `three times`, and a bound word other than `cap` (`up to US$5`, `max A$30`, `budget of €20`).

- **The widest reading.** `gated_inputs.py`'s standing reading gains a third step, `widest_exposure()`, run only when
  the full and cap-only readings both refuse (module docstring, 2, holds its one copy, W1-W7): only a spend gate; no
  per-unit word, `%`, widening word, amount in words, minor units, unknown currency or approximate amount anywhere
  (W2); every amount with a currency at one end or both, a range at its top, a magnitude read, a malformed one asking
  (W3); at least one amount straight after a cap word (W4); each amount's qualifier (a month x1, a rate, a multiplier,
  else a total; `before` asks) and no rate left beyond the amounts (W5, W5d); on a rate line every count's unit a
  rate's, no stray number and each rate times the largest count of its unit (W5c); on a line with no rate the
  unattached multipliers multiply every amount (W6); the sum rounded up to the cent (W7). A gate priced so is signed
  or asked against the limit and the month line exactly as a fully priced one, annotated and logged the same, and its
  approval line ends `; widest pricing, the cap-only reading refused: <why>`.
- **W4, a governed cap word.** At least one amount must start exactly where a cap word ends: `cap`, `capped`, `max`,
  `maximum`, `at most`, `up to`, `no more than`, `limit`, `limited`, `ceiling` or `budget`, at a strict word start (so
  `rate-limit`, `--max-cost-usd` and `hard-cap` never count), then at most two of `:`, `at`, `of`, `to`. It mirrors
  decision 1's rule 3 (a `cap` word straight before its amount), widened only to the bound synonyms, so a line that
  states no cap (`US$10 so far`, `rate-limit probe — US$10`) still asks.
- **WIDENING gains `±` and the uncapped words** (round 2 of the plan's review). Before p48-4 the full reading signed
  `cap US$10 (no limit on retries)` and `cap US$10 (unlimited retries)` at 10, and the cap-only reading `cap US$10 ±
  2`. WIDENING, the one list rules 5 and 7 share, now holds `±` and UNCAPPED: `uncapped`, `unlimited`, `unbounded`,
  `no hard limit|cap`, `no cap|limit|max(imum)|budget|ceiling(s)`, `without a cap|limit|budget`, `not
  capped|limited`, and a `cap|limit|max|budget|ceiling` then TBD, TBC, unknown, unset, none or `to be`. Inside the cap
  clause every reading now asks on them; the widest reading asks on them anywhere. Outside the clause the cap-only
  reading still waives them: the 2026-11-05 amendment's residual (i), a readable cap stays the implementer's ceiling
  (`cap US$50; soft, no hard cap` is still covered at 50). A replay of 5,687 gates (every gate literal in the touched
  tests and fixtures, and the vault's spend lines) flipped no real pin or vault gate.
- **The ceiling table.** Another currency reads at its ceiling rate, at least 5% above its highest daily USD value
  since 2000, rounded up: USD 1; AUD 1.17 (high 1.1081, 27 Jul 2011); NZD 0.93 (0.8843, 1 Aug 2011); CAD 1.16 (1.1042,
  USD/CAD 0.9056, 7 Nov 2007); EUR 1.69 (1.6038, 15 Jul 2008); GBP 2.23 (2.1162, 9 Nov 2007); JPY 0.0140 (0.013277,
  USD/JPY 75.32, 31 Oct 2011). The currency words name only the table's currencies: `dollars`/`bucks` the four listed
  dollars, at the widest of them (1.17); `euros` 1.69; `pounds` 2.23; `yen` 0.0140; `cents` a cent of the four
  dollars or the euro (0.0169); `pence` 0.0223. `cap 30 AUD` reads US$35.10.
- **What still asks.** A gate that names no amount, or none straight after a cap word; a negated or undecided cap
  (`no cap`, `cap TBD`, `unlimited`); a rate with no stated most (`cap US$0.10 per GB`); a count in another unit, a
  count in words or a further rate beside it; a widening word, `%`, an approximate amount or an amount in words
  anywhere; an unknown currency (`¥`, `HK$`); a per-unit word (a per-unit gate is the full reading's alone); and a
  gate over the limit or past the month line, as before.
- **The plan judge.** `exposure -` prints the standing reading's {usd, why}, so a gate neither earlier reading prices
  now prints its widest amount, and the judge, which bounces only a null "usd", never bounces a one-cap gate in
  another currency, a range or a counted rate. task.workflow.js and the prompt bytes are unchanged; ADR 0038's bounce
  rule is unchanged, so a two-cap gate is still sent back for its format at plan time by ADR 0008's automatic
  `changes` (the follow-up below names it), and a bounced note still signs nothing.
- **The open half.** The ruling's second sentence, a gate that names no amount goes back to its planner once and only
  then asks, is not built here: the engine's bounce still climbs a gates-only `changes` over a capless gate. It is
  filed as `[[thread-skill-a-spend-gate-naming-no-amount-goes-back-once]]`.
- **The line-up with chorus-p96-23.** Chorus's sign-off suite (`[[chorus-p96-23-upkeep-repairs-a-rollouts-infra-halt]]`:
  Upkeep signs every sign-off whose effect can be undone) reads the halts the standing approval leaves. The widest
  reading shrinks the spend ones to a gate with no amount or cap word it can read, a rate with no stated most, or one
  over the line, so a variation of a spend under US$200 is signed here, by thread-skill's own reading, before any halt
  reaches Upkeep or him.

Accepted residuals, each safe because the gate's total is the implementer's ceiling (GATED_INPUTS_CHECK) and the
annotation records the total exposure, each pinned in tests/gated-inputs.test.mjs:

- (r1) A count beside a total amount, on a line with no rate, reads once: `cap 30 AUD for 3 runs` reads 35.10.
- (r2) An unknown currency word on a line with no rate is not read (`1000 rupees`); on a rate line it is a count in
  another unit, and asks.
- (r3) A rate idiom off the lists, and not straight after its amount, reads x1.
- (r4) The ceilings under-read a currency that rises more than 5% past its post-2000 high, or a currency word meant as
  a currency off the table worth more than its word's ceiling: today only a `dollars` or `bucks` meant as the Cayman
  Islands dollar (pegged at US$1.20).
- (r5) A bare `$` is USD.

Named over-asks, fail closed and pinned: prose `per`/`each`/`every`; a widening or uncapped word in the description
(`soft launch`); stray numbers on a rate line; `¥`; a count noun not adjacent to its number; a bound word with any
other word, or a parenthesis, between it and its amount (`the cap is US$10`, `cap (US$10)`); a hyphenated bound word
(`hard-cap US$10`); and a line whose only bound word bounds a count (`US$0.50 per call, at most 40 calls`).
