---
name: reflect
description: 'Use to score a rollout and tune the operator''s rollout settings: a Reflection over its Run record, by hand or weekly. Triggers on "reflect on [[rollout]]", "how did [[rollout]] run", "how did the rollout run", "score this rollout", "what bound the rollout", "should I raise the parallel ceiling", "run the weekly Reflection", "reflect on this week''s rollouts", or /thread:reflect. Scores the Run record (Hands-off rate, Quality, Guardrails) and proposes Tunings; by hand it applies only the ones Lachy picks, and the weekly reading files bugs and lands agreed knobs, never a rule. Not for Chorus''s Companion record: "reflect on the Companion" is Chorus''s /reflect.'
---

# /thread:reflect — score a rollout, propose Tunings, apply the picked ones

`/thread:reflect [[rollout]]` is the **Reflection** (`CONTEXT.md` § Run record and tuning; ADR 0032): it reads a
rollout's Run record, scores it on its two headlines (ADR 0037 d1), **Hands-off rate** (the share of landed tasks
with no act from Lachy once the run started) and **Quality** (how few Escapes its landed tasks produced), then on
the Guardrails (Throughput, bounded so an overnight run still finishes by morning, and Review churn among them),
names what bound it, and proposes **Tunings** to the operator's rollout settings (`~/.config/thread/rollouts.toml`).
By hand (steps 1–8) it changes nothing itself: Lachy picks. The **weekly reading** (steps 9–17, ADR 0037 d3–d5)
reads every rollout since the last one, traces each cost to the rule that produced it, and lands only what ADR 0037
d5 lets it land unasked (a bug task, a knob three Reflections agree on, the revert of one that breaches); a rule
always waits for Lachy. Every number comes from scripts, and the model only runs them, reads what they print and
passes Lachy's answer on:

- `skills/reflect/scripts/score.py` computes the scores and the proposals. It reads only; its header is the one
  copy of every rule (running time, the binding constraint, the baseline, the proposal rules), and
  `skills/reflect/scripts/escapes.py` beside it, which it loads, holds the rules for the Escapes and Quality.
- `skills/reflect/scripts/tune.py` is the **only writer** of `rollouts.toml` and of `tunings.jsonl` (the
  Reflection's line beside the record). Never edit either file by hand from this skill, and never compute a score
  or write a Tuning in the conversation.
- `skills/reflect/scripts/reflect.py` is the **only writer** of `reflections.jsonl` (the weekly reading's Watches,
  proposals and close), and of the bug and decision tasks it files. Its header is the one copy of its rules.
- `skills/reflect/scripts/reflect-due.py` says whether the weekly reading is due (ADR 0037 d4 and d6). It reads
  `reflections.jsonl` only and writes nothing; its header is the one copy of its rule.

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

The Reflection takes Chorus's word and shape (ADR 0037 d2): record → proposals → Lachy picks → the tune script, and
for the weekly reading, Chorus's span → Watches → close. It reads rollouts' Run records, never the Companion's:
"reflect on the Companion" is Chorus's `/reflect`.

**The contract.** The loops share one contract: `~/.agents/knowledge/reflection-loops.md` (the estate copy, canonical;
Chorus's `/reflect` cites it too): the words, the ledger line, the cadence and what lands alone. Read it, when it is
there, before a `--weekly` or a `--decide` run; the scripts never read it. Each loop keeps its own engine and its own
records (ADR 0037 "Considered" declined one shared Reflect skill), so the script headers stay the one copy of what
Thread does, in the contract's words:

- **Reflection**: a reading of a span after the fact that traces what cost Lachy to the rule that produced it, and
  proposes Tunings. Never *review* (code review's word) or *retro*. The by-hand form scores and proposes; the
  weekly reading also traces.
- **Watch**: a pattern seen once, carried to the next reading. Thread's sighting is per rollout, so it becomes a rule
  proposal when another rollout shows it again, or at once when Lachy confirms it (step 12).
- **Tuning**: one change at one of three altitudes: a **knob** (a number: cheap, reversible, and it may land on its
  own), a **rule** (a grill and an ADR before a build; never lands unasked) and a **bug** (filed as a task, never
  picked, never filed twice). Chorus's word and map altitudes are not Thread's. A knob that lands is its own `applied`
  entry on tune.py's one `tuning` line, which carries every pick of a by-hand Reflection (step 7) and every knob one
  `--auto` call lands (step 14); in the weekly reading each Tuning is its own `proposal` line in `reflections.jsonl`
  (one per knob_key, bug and rule item: steps 13–15).
- **A quiet reading** has no new Watch, no rule proposal, no bug and no Guardrail breach; a knob proposal step 14
  holds while it gathers agreement (`held <key>: agreement <n> of 3`), and a knob that landed on its own, keep it
  quiet. Its flag is `close`'s `quiet` (step 16).
- **The cadence** is weekly, fortnightly after three quiet readings in a row, and weekly again after any reading that
  is not quiet: derived from the `quiet` flags, never kept as a written value (a line's `cadence` says what it was
  then). Thread counts it in Melbourne dates (7 or 14 days, `reflect-due.py`), where Chorus counts sittings.

## Scope

Reads the rollout note (`~/repos/obsidian/Work/Tasks/`, then `Work/Tasks/Archive/Rollouts/`), the Run record and
`tunings.jsonl` under the events directory (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py dir`
prints it), and `~/.config/thread/rollouts.toml` through `rollout-settings.py`. `land.sh --origin-slug` runs one
local `git remote get-url origin` in the Project root: no network. For the Escapes the score also reads, read-only:
every note under `~/repos/obsidian/Work/Tasks/`, Archive included, for `fixes:` and `merged_into:`; and the Project
root's git (commit messages, `docs/reviews/` and `git blame`), never fetched. By hand it writes `fold-journals`'
`call-journal` lines, and tune.py's one line and its picked keys; scratch files go under
`/tmp/thread-reflect-<rollout-slug>/`, and it makes no vault write. A serial note's reading (§ 1) runs
`serial-score.py` alone, which reads the note's Leg log through `leg.py status`, the Run record and the task notes,
and writes nothing. The weekly reading reads every rollout record,
`reflections.jsonl`, `grades.jsonl` (the Grade log, read-only) and the contract (above) too, and writes: `reflections.jsonl` through reflect.py; a bug task and
the decision task under `~/repos/obsidian/Work/Tasks/`; the decision task's one line on its day page (task-writer
§ 3b); `tunings.jsonl` lines only through tune.py's `--auto` and `--revert`; and `call-journal` lines through
`span --fold`. Its scratch dir is `/tmp/thread-reflect-week-<YYYY-MM-DD>/`. `--decide` writes `watch-raised` lines
through `reflect.py raised` and a `moot` line in the decision task through `reflect.py moot`, and marks the task done.
Neither form makes a git write or a PR.

## Invocation forms

```
/thread:reflect [[thread-skill-rollout-2026-10-04]]        # the whole run, up to now
reflect on [[chorus-rollout-2026-10-01]] since Tue 9am until Wed 6pm   # one span (a before/after split)
/thread:reflect --weekly [--since TS] [--until TS]         # the weekly reading, since the last one (steps 9-17)
/thread:reflect --decide [[thread-skill-decisions-<date>]]  # Lachy decides the weekly decision task
```

Every completion ceremony and every supersede (schedule step 7.5, § 0's `file` finish, repair's close-out) records
the script half on its own through `close-score.py` (ADR 0037 d4): fold, settings, score, and one `close` line in
`tunings.jsonl` that tune.py writes, one per rollout, with no model reading and no picks. A dropped rollout has no
close path: the weekly reading reads its record in the week it ran, like every rollout with a line in its window, and
names a closed rollout with no close line, but writes no `tunings.jsonl` line for it, so it leaves no baseline. A
by-hand Reflection still runs at completion on Lachy's word,
mid-run (the slow tail shows, because running time ends at the Reflection, not at the last merge), or on a
superseded or dropped rollout (its record alone is enough). It writes its own line through tune.py, which the close
line never blocks.

## Skill flow

### 1. Resolve the rollout note

`[[<slug>]]` → `~/repos/obsidian/Work/Tasks/<slug>.md`, else `~/repos/obsidian/Work/Tasks/Archive/Rollouts/<slug>.md`.
Several matches for a loose name: list them and ask which. Read its body's ``Project root: `<repoPath>` `` line.
A note that cannot be found stops the Reflection: say so, and offer a record-only score by slug (step 4 without
`--note`) only on Lachy's word.

**A serial note** (`shape: serial`, ADR 0040) is a chain of Legs, with no Workflow journals, Slots, lane or Project
root, so steps 2–8 do not apply to it. Its reading is one read-only script, whose header holds the rules (the Leg
spans, the merges, the Hands-off rate from the record's acts and halt clears, and Quality from `fixes:` only):

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/serial-score.py --rollout <rollout note path>
```

Present its headline, its window and its flags, as step 5 presents a score: Throughput, the Hands-off rate and a
Quality that is always partial. It makes no proposals, so nothing is picked, and the reading stops here: it never
reaches step 4's score, so step 7 does not apply. A serial score is recorded only as its chain's close line, which
close-score.py writes at the chain's Complete (`skills/execute/legs.md` § Complete).

### 2. Fold the Workflow journals (idempotent)

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py fold-journals --rollout <rollout note path>
```

Show its summary line and every `WARN:` line. A non-zero exit is surfaced and the Reflection **goes on**: the score
flags what the missing journals cost (tokens unknown, a Slot ended at its slot-freed).

### 3. The settings and the repo identity

```
mkdir -p /tmp/thread-reflect-<rollout-slug>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py --repo <Project root> > /tmp/thread-reflect-<rollout-slug>/settings.json
bash ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh --origin-slug <Project root>
```

- A rollout-settings refusal (exit 2 or 3) **stops the Reflection**: quote its stderr line verbatim, with its remedy
  (fix `~/.config/thread/rollouts.toml` at the named line; exit 3 needs python ≥ 3.11).
- `land.sh` exit 0 prints `owner/name`: pass it as `--repo-slug`. This is the repo identity, never
  rollout-settings' `repo`, which is null whenever no repo table applies yet.
- `land.sh` exit 4 (no GitHub origin): score the run with no `--repo-slug`. It proposes nothing and keeps no
  baseline (flagged).
- Any other `land.sh` failure **stops the Reflection**: quote it.

### 4. Score

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/score.py --rollout <slug> --note <rollout note path> \
  --settings /tmp/thread-reflect-<rollout-slug>/settings.json --repo-slug <owner/name> --repo <Project root> \
  --out /tmp/thread-reflect-<rollout-slug>/score.json
```

`--repo <Project root>` lets the score read the Escapes git holds (reverts of this rollout's merges, later review
findings against its lines); the task notes' `fixes:` come from the vault's `Work/Tasks/` (`--tasks-dir <dir>` only to
point it elsewhere). With `land.sh` exit 4 (no `--repo-slug`), still pass `--repo`.

The whole run by default (`--since` the first Slot taken, `--until` now). On Lachy's word add `--since <TS>` and
`--until <TS>`, each with `Z` or an offset (`2026-10-02T09:00+11:00`), to score one span: a before/after split
around a change, or the half of a run a mid-run ceiling change flags. Exit 1 (the record, the events directory,
the settings or the note cannot be read) or 2 (usage, a bad slug or TS) stops the Reflection: quote its stderr line.
Exit 0 with the flag `no record` is a real answer (nothing was recorded), shown as such.

### 5. Present

From `score.json`, verbatim numbers only (the record is UTC; local times may be shown beside them), the two
headlines first (ADR 0037 d1), then the Guardrails:

- **Hands-off rate** (`handsOff`), the first headline: the rate, landed tasks and how many landed with no act from
  Lachy, then each task's acts (`tasks[].acts`: a Recorded answer, a sign-off, a retry hand-back, a merge hold, a RACE
  decision), the tally by kind, and what was not counted (`notCounted`: Standing approvals, automatic hand-backs, green
  RACE re-verifies). Show the baseline's rate (`handsOff.baseline`), or "none (a v1 line)" when the flags say the
  baseline is a v1 line.
- **Quality**, the second headline: `escapes.count` Escapes of `escapes.landed` landed tasks, `headline.quality`, and
  `escapes.bySource` (fixes, reverts, reviews), with each escaped task's evidence verbatim (the `fixes:` note, the
  revert commit, or the review doc and row). When `escapes.partial` is true, say what Quality misses, which can hold
  even with all three sources read: each unread source (`escapes.sources`), each `escapes.excluded.unresolved` task
  with its why (a landed task whose git evidence is unresolved), and the count of review findings whose blame failed
  (`escapes.excluded.unresolvedRows`); say Quality can only read too high. An Escape found later counts against this
  rollout, so a later re-score can lower Quality.
- **Guardrails**: **Throughput** first, against its bound: merges per running hour, the running hours against the
  allowance (`allowanceHours` for its `tasks`, `bound`), and whether it is breached; then every excluded span by kind
  (`paused`, `hold-merge` / `hold-race` / `hold-git-env` waits on Lachy, `lead-absent`, `never-finished`,
  `lane-only-over-cap`, `idle`) with its why. Say when the window is `partial` (a Slot still running at the
  Reflection). Then tokens per merge, set-aside rate, conflict rate (and the integrator-path share) and quota
  stalls, each against its bound and the baseline, and whether it is breached. With no baseline, say so. Last,
  **Review churn** (`reviewChurn`, p21-3): its value, or "unknown" when no review round was recorded or no
  finding could be classified (never 0; say which, from its flag, and any "low coverage" flag), rounds per landed
  task, the engine and /fresh-review split (`engine`, `freshReview`), the `unclassified` count (findings no
  `path:line` blame could place), its bound (`review_churn_pct`, absolute: it breaches with no baseline) and
  whether it is breached. Integration re-review rejections are not counted: rounds per landed task is
  master-review rounds only.
- **Slots and lane**: the ceiling it ran at (and any mid-window change), the share of running time the Slots were
  full, utilisation, idle Slot time by reason; the lane's busy share, Integrations and the ready-to-lane waits.
- **Load**: the overlapping rollouts on this machine, their span and the Slots each held open (`slotsOpen`). A
  rollout counts through this run while a Slot it took has no slot-freed, even when its long calls wrote nothing
  meanwhile; say so when its `load:` flag reads it live past its last line (a lost slot-freed overcounts it).
- **The binding constraint** and its why. A lane-bound run proposes no key: say "no key moves this".
- **Each proposal**: `id`, `key from → to`, its evidence, `agreeing` (earlier applied Tunings with the same rule),
  and its `ranAtCause` in plain words when present, e.g. "ran at 5 by a rollout-note override; rollouts.toml says
  3", so a jump such as 3 → 6 reads as one step past what the run proved. Then what it `serves` and `risks`. A
  `trade` reads "buys <gains> at the risk of <costs>: Lachy decides, no tie-breaker (ADR 0037 d1)". A `caution` is
  shown verbatim, as Lachy's call.
- **Each withheld entry** with its reason, and every flag.

Then ask which proposals to apply, by id, or none.

### 6. Lachy answers

Only Lachy picks. A "yes" names ids (`p1`, `p1 and p3`); anything else, or no answer, applies nothing.

### 7. Apply through the tune script, exactly once

Every by-hand Reflection that reached its scores runs tune.py **exactly once**: it writes exactly one `tunings.jsonl`
line (none only for a null repo, below). The weekly reading (step 14) runs it zero or more times per repo, never with
`--pick`, `--record-only` or `--close`. Before a `--pick` run, check every picked id against `score.json`'s
`proposals` (not `withheld`): an id that is not there goes back to Lachy (step 6) before tune.py runs.

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/tune.py --scores /tmp/thread-reflect-<rollout-slug>/score.json --pick <p1,p2> --repo <Project root>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/tune.py --scores /tmp/thread-reflect-<rollout-slug>/score.json --record-only
```

The first with Lachy's yes answers; the second when he picked nothing, said no, or ended the Reflection without
answering. `--record-only` still matters: its line is the next Reflection's baseline. With a null repo, tune.py prints
`tune: not recorded: ...` and exits 0: report that line as it is. Exit 1 (a write failed: nothing applied, or the
line voided) and exit 2 (refused: a stale `from` because rollouts.toml changed since the score, an unknown or
withheld id, a dotted or inline key, another repo) are reported verbatim; a stale `from` is fixed by a fresh
Reflection. Never edit `rollouts.toml` to work around a refusal.

A `--pick` run that wrote no line does not use up the one run: an exit-2 refusal writes nothing (no line, no key),
and neither does an exit 1 that says `nothing applied: the Reflection's line could not be written` or `cannot write
next to`. Report it, then either re-ask Lachy once and run the corrected `--pick` (a withheld or mistyped id), or,
when he picks nothing more or the refusal cannot be fixed in this Reflection (a stale `from`, another repo), run
`--record-only`, so the Reflection still leaves its line as the next one's baseline. A run that wrote its line (exit 0,
or the exit-1 `rollouts.toml was not written` failure, which records the line and voids it) is the one run: never
run tune.py again for this Reflection.

### 8. Report, then tidy

Report the `tunings.jsonl` line tune.py named (its id), the applied set (or none), and the `applied ...` lines it
printed. Then `rm -rf /tmp/thread-reflect-<rollout-slug>`.

**When a Tuning takes effect.** A picked Tuning takes effect at the next `/thread:schedule` (or its
`--regenerate`, which stamps freshly resolved values). A rollout note already stamped, running, paused or not yet
started, keeps its own frontmatter values: execute reads task frontmatter, then rollout frontmatter, then
rollouts.toml, and only a legacy note missing a key reads rollouts.toml, at its next loop entry (execute § 3). To
change a live rollout, Lachy edits its note.

## The weekly reading (ADR 0037 d3–d5)

`/thread:reflect --weekly` reads every rollout since the last weekly Reflection, on its own, once a week (ADR 0037
d4), or once a fortnight on a quiet streak (d6): the scripts score and sweep, the model traces each cost to its rule,
and the writers record the outcome. It lands a bug task, an agreed knob or a knob's revert unasked (ADR 0037 d5); a
rule proposal (with any Watch to confirm beside it) or a held trade (a knob ADR 0037 d1 leaves to Lachy) goes into one
decision task for Lachy's next morning. Every write goes through `reflect.py` or tune.py, each idempotent, so a reading
that dies part-way is finished by running the remaining steps against the same `span.json`.

What starts it is the daily sweep, which asks each day:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect-due.py
```

Exit 0 is due, 4 is not yet; any other exit starts nothing. It is due once the cadence's days (7, or 14 after three
quiet readings in a row) have passed, in Melbourne dates, since the last Reflection's `until`, and at once when
there is none. Its JSON names the cadence, the quiet streak and the day it falls due.

### 9. Preflight

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py rung
mkdir -p /tmp/thread-reflect-week-<YYYY-MM-DD>
```

`rung` prints the ladder's highest Opus rung with its own effort (ADR 0037 d4 names Opus at xhigh, no token cap)
and notes on stderr when the top rung is not Opus or that rung's effort is not xhigh. A skill cannot set its own
model: if this session is not on that model and effort, say so and go on. `<YYYY-MM-DD>` is today's Melbourne date.

### 10. Span

Run it once, through the Bash tool with `timeout: 600000`:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py span --fold --out /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json
```

It folds each read rollout's journals and scores it, reads its friction and close line, sweeps the Escapes over
every record (ADR 0037 d4) and the dated `repair:` lines over every record's rollout note, joins the Grade log to what
followed each grade (`skills/reflect/scripts/grades.py`, loaded by span, whose header holds the join's rules), and lists
the open Watches and the knob candidates; its header holds every rule. Add `--since <TS>` and `--until <TS>` only on Lachy's word: by
default it starts where the last Reflection ended. Read the whole `span.json`. Exit 1 or 2 stops the reading: quote
its stderr line. Never re-run it after a write (step 12 on): a new span is a new Reflection, with a new id.

### 11. The reading

For each rollout, read its `friction` items, of seven kinds (`ask`, `set-aside`, `retry`, `descope`, `repair`,
`escape`, `churn`), and trace each to the skill rule or ADR that produced it:

- An `ask` (a Recorded answer, a sign-off, a retry hand-back, a merge hold, a RACE decision, a git-env hold) is a
  mid-run ask. A mid-run ask is traced to the grill that should have asked it before the run: orient § 5
  (Reshuffle), where `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § R2 (Sort and propose) sorted the task
  clear, or where `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § R3 (Grill the unclear) never put the fork
  to Lachy; `${CLAUDE_PLUGIN_ROOT}/skills/_shared/grill-fit.md` § How a fork comes back, where a cold prompt
  routed no gate; orient § 7 (Autonomous), where a conversation-gated task entered a serial rollout; and, only for
  spend, a credential or an irreversible action, schedule § 3.5 (Detect human/release gates) or schedule § 3.6 (Sweep for
  gated-input smell), or `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § R3 (Grill the unclear), item (c),
  asked ahead. An ask whose `askedAhead` is true was asked at the top and still came back: trace why the answer
  did not hold. span reads each ask from the record in the week it happened, on a landed task or one still waiting
  (the Hands-off rate counts landed tasks only).
- A `set-aside` is traced by its stage and `reasonClass` to the rule that stopped it: execute § 3.5 (the plan
  gate), execute § 3.7 (gated inputs, ADR 0034), execute § 4.5 (the queue, ADR 0030) or execute § 6.5 (Needs
  you), and by its `movedBy` to what moved it on. `integration-conflict` traces to execute § 4.5 step 3
  (Integration's merge of the latest main, ADR 0030 decision 3), and `integration-red` to the integrate call's
  verifier.
- A `retry` is execute § 4.5's automatic retry (ADR 0033): trace why the first attempt failed a block an agent
  could fix.
- A `descope` is repair § 2–§ 5's descope and its hand-back (ADR 0035): trace why the task's scope could not land
  whole.
- A `repair` item is traced by its shape: `race-decided` is read with its `raceDecided` ask, never twice;
  `escalated` and `flipped` are drift the run should have closed itself (repair § 3); `git-env` is execute § 4.5's
  canary; `raise` is a round cap (weigh it beside score.py's own knob); `deferred` is repair § 5. A rollout with no
  line in the window still brings its in-window repair lines, read `repairs-only` (or with its Escapes,
  `escapes-only`).
- An `escape` is traced to the review that should have caught it (execute § 5, ADR 0037 d7), and only when its
  `inWindow` is true: an Escape counts in the week it surfaced, against the rollout that landed the work.
- A `churn` item is a review round that only answered the last round's fix (execute § 5): trace what the fix broke.

For each `set-aside` item whose `movedBy` is `unrecorded`, read what its `explainedIn` names: its `taskNote`'s
`## Needs you` and `## Integration log`, a gate set-aside's `## Approved gates`, and the rollout note's `## Notes`
lines that name the task; then its lines in the Run record (`mover` is the line that moved it on: a `slot-taken`
`start` of `resume` is a signed-gate or Lost-call resume, one of `hand-back` a restart after a hand-back or a sign-off).

- An `## Approved gates: standing approval` entry (a line ending `(approved <date> under the standing approval: …)`)
  is a gate the Standing approval signed (ADR 0034), not Lachy: report it as what moved the task, never trace it as
  his ask.
- An `## Approved gates: sign-off` entry (a bare `(approved <date>)`) is Lachy's sign-off with no `gate-signed` line:
  trace it as a sign-off `ask`.
- A Human fix (ADR 0035) in `## Needs you`, `## Integration log` or the rollout note's `## Notes` is traced like a
  mid-run ask.
- When none of them says what moved it, name it as unexplained.

Each item becomes a sighting (step 12), a bug (step 13), a knob (score.py's only: never invent one) or nothing,
named with why. Read `freshReview` and `cannotShow` as reported, not traced. A `closed with no close line` flag is
reported, not traced: that rollout leaves no baseline (ADRs 0030, 0033, 0034, 0035 and 0037 bound what each
trace may conclude). The Watch, its id and its recurring rule are Chorus's Reflection's, borrowed and never imported;
recording Lachy's no (step 15's decision task, § Deciding the decision task) is this skill's own.

**Grade accuracy.** Read `span.json`'s `grades`: the Grade log (p25-4, ADR 0041) joined to what followed each grade,
scored over its own episode, which runs to the task's next grade or its close. Read the Ready headline
(`window.readyHandsOff`) first, then each grade's `rate` in `window` and in `all`, with its counts: `handsOff`,
`bounced`, `regraded` and `dropped` make the rate, and `byHand`, `undispatched`, `unknown` and `pending` sit beside it,
as counts alone. `episodes` lists the window's rated episodes (hands-off, bounced, regraded or dropped), each with its
acts and its `rollouts`: the rollouts whose Run-record lines fall in its span, and its `endLink` when it was dispatched
by link. Trace each miss to `${CLAUDE_PLUGIN_ROOT}/skills/_shared/readiness-grade.md`, the grading rules:

- A `bounced` or `regraded` episode, by its acts: an `answer` to readiness-grade.md § The grade (a decision the grader
  missed), an unforeseen `signOff` (one on a grade that named no `gates`) to readiness-grade.md § Size, deadlines and
  review, and a `retry` or a set-aside to readiness-grade.md § The grade. A sign-off on a grade that named its gates is
  foreseen Review load (`foreseenSignOffs`), no miss.
- A task raised for confidence (`byAgentGrade`, its `raised`) that still went hands-off to readiness-grade.md § The
  raise.
- A size whose median Slot hours (`bySize`) sits outside its `estimateHours` to readiness-grade.md § The ranking
  (`SIZE_MINUTES`).
- A `mergeHoldOnly` bounce is read as the merge hold it is: a `--gated` run's hold cannot be told from an ask.

Each becomes a sighting (step 12) or, once it recurs, a rule proposal (step 15), never a knob: the grading constants are
no operator setting. A grade trace's Watch names its episodes' `rollouts` (a `bySize` one, those of that size's timed
episodes), which `watch` takes whether or not the span read them: a serial chain dispatched by link, or a regraded or
dropped task whose rollout had no line this week. A trace whose episodes list no rollout (a `bySize` readout seen only
in `all`) is reported, never made a Watch. An `ask` item's `grade` says what grade its task carried when it asked.

### 12. Sightings

After the whole reading, make ONE `reflect.py watch` call per Watch, naming every rollout where you saw it. Reuse an
open Watch's rule and shape verbatim, a declined one's included. On exit 2, re-run naming the union the refusal
prints. A rollout is one the span read or one an in-window grade episode lists (step 11); any other is exit 2.

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py watch --span /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json --rollout <slug> [--rollout <slug> ...] --rule "<rule>" --shape "<shape>" --count <n>
```

The rule is the citation the trace reached (at most 120 characters); the shape says what happened, in a few words.
A Watch seen in two rollouts, or confirmed by Lachy, becomes a rule proposal (step 15).

### 13. Bugs

A bug is a skill or the engine not doing what its own rule says. File each once:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py bug --span /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json --rule "<rule>" --shape "<shape>" --slug <one-to-five-words> --title "Thread Skill: <title>" --why "<why>" --rollout <slug> [--rollout <slug> ...] [--fixes <landed task>]
```

Pass `--fixes <landed task>` when the bug fixes work that already landed, so the task carries its `fixes:` key
(task-writer § 4). An open bug task with the same rule and shape prints `exists <slug>` and files nothing. On `path
exists`, call again with other slug words; never edit, move or remove the existing note.

### 14. Knobs

From `span.json`'s `knobs`: each revert first, then each landing, then one `knobs` call.

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/tune.py --scores /tmp/thread-reflect-week-<YYYY-MM-DD>/<slug>.score.json --revert <tuning id> --repo <Project root> --reflection <reflection id>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/tune.py --scores /tmp/thread-reflect-week-<YYYY-MM-DD>/<slug>.score.json --auto --repo <Project root> --reflection <reflection id>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py knobs --span /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json
```

`--revert` runs once per `knobs.revert[]` item (its `scores`, `tuning` and `root`), `--auto` once per distinct
`scores` file among `knobs.land[]` (with its items' `root`): one call lands every eligible proposal in that file as one
line, and a repo's land items all come from its newest rollout's file. `knobs` runs once, after them. Report every exit
verbatim: an `applied` line, a `held <key>: <reason>` line (`agreement 1 of 3`, say; a key this Reflection's revert
moved is held `Reflection <id> already moved <key>`), a refusal (exit 2) or a write failure (exit 1). Never `--pick`,
`--record-only` or `--close`, and never edit `rollouts.toml`. A `held <key>: a trade (...): Lachy decides` or
`held <key>: a caution: Lachy decides` line is a held trade (ADR 0037 d1): the weekly reading never lands it, and
step 15's `decide` puts it in the decision task.

### 15. Decide

Write `/tmp/thread-reflect-week-<YYYY-MM-DD>/decisions.json`, `{"<watch id>": {"why": "...", "amends": "..."}}`,
one entry per recurring Watch: why it matters, and the rule it would amend; with no recurring Watch, write `{}`. Then:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py decide --span /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json --decisions /tmp/thread-reflect-week-<YYYY-MM-DD>/decisions.json
```

It writes a decision task only with a rule proposal or a held trade: a week with Watches to confirm alone writes none,
and they wait (a task a held trade alone writes lists none). A held trade is listed once per (knob id, `from`): one an
open decision task already lists gets a `## Still open` line; one a done decision task lists was decided there, and
`decide` prints `trade <kid> at <from>: decided in [[<slug>]]` and never offers it at that `from` again; one only a
dropped task lists, or one recorded moot, is offered again. A trade on a key this Reflection's revert moved waits for
the next reading (`a revert of <key> comes first this Reflection`). The task is scheduled for the next Melbourne
morning, conversation-gated, and orient's audit lists it (orient § 2). Put its line on its `scheduled:` day's page by
task-writer § 3b; when `decide` printed `(was <date>)`, move the line from the old day's page.

### 16. Close

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py close --span /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json
```

Exactly once, quiet weeks included: its line is the Reflection's record, and its `quiet` feeds the cadence (ADR
0037 d6). Three quiet readings in a row move the reading to fortnightly (`cadence` 14), and any that is not quiet
moves it back to weekly (7). The cadence is derived from the `quiet` flags: `close` writes it on its line for the
record (what it was then), and its outcome line ends `cadence <old> -> <new>` when it changes. A quiet week writes
only record lines, and no vault task but the decision task a held trade needs (step 15): a held trade is no rule
proposal, so it leaves the week quiet. Every writer refuses a closed Reflection, so `close` refuses first (exit 2,
nothing written) while step 14's `knobs` or step 15's `decide` has a line to write (a knob line, a rule line, or a
held trade no decision task lists for this Reflection): run the step its stderr line names, then close.

### 17. Report, then tidy

Report the rollouts read (and the escapes-only and repairs-only ones), each trace and what it became, the grade
accuracy (the Ready headline, each grade's rate in `window` and `all`, the `bySize` readout and each grade trace), the
Watches written (and any `extended` line), the bugs filed or found, each knob landed, reverted or held with its reason, the
decision task (or none), with each held trade it lists, found decided or skipped behind a revert, the close line's
counts and `quiet`, the `cannotShow` list and every flag. Then `rm -rf /tmp/thread-reflect-week-<YYYY-MM-DD>`.

## Deciding the decision task

`/thread:reflect --decide [[<slug>]]`, with Lachy, at the top of a run. Read every `## Reflection <id>` section and
`## Still open`. For each item:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py raised --watch <id> --reflection <the section's id> [--confirmed | --declined]
```

- **A yes to a rule item**: `raised` plain, then file the rule's grill task (task-writer § 4: a grill and an ADR
  before any build).
- **A yes to a Watch to confirm**: the same with `--confirmed`, then the grill task.
- **A no to a rule item or a Watch to confirm**: the same with `--declined`. It records his no and
  closes the Watch's cycle, so the pattern is proposed again only when two later rollouts show it afresh, never next
  week from the same evidence.
- **A yes to a trade** (a `- trade` item): run `/thread:reflect [[<rollout>]]`, the item's by-hand Reflection (steps
  1–8). At step 6 his yes is the score's proposal with the item's key and rule, and step 7's `--pick` applies it;
  tune.py's line is the record.
- **A yes that cannot apply**: the fresh score no longer proposes that key and rule, or tune.py refuses a stale
  `from` (step 7 then runs `--record-only`). The item is answered, moot: record why with the `moot` command below. A
  moot trade is not decided: the next weekly reading that holds it offers it again, at its new `from` when the value
  moved, or at the same one.
- **A no to a trade**: nothing to run. Its `- trade` line is the record once the task is done, and `decide` never
  offers that trade at that `from` again.
- **Not now, or not reached**: nothing. The Watch stays open, and the next weekly reading lists it under `## Still
  open`; a held trade stays listed, and the next weekly reading that holds it adds a `## Still open` line.

A yes that cannot apply, recorded under the item's own `## Reflection <id>` section:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py moot --task <slug> --trade <knob id> --from <from> --why "<the tune script's refusal, or: the fresh score no longer proposes it>"
```

Then mark the task done (`status: done` and `completed: <Melbourne today>`) only once every item it lists has had a
yes or a no (each `raised` printed `raised` or `exists`; each trade's yes went through tune.py or `moot` printed `moot`
or `exists`). An item left open keeps the task open.

## What the record cannot show

- A merge hold carries no reason, so a `--gated` hold cannot be told from an exit-7 hold: both read as a wait on
  Lachy, and both count as an act in the Hands-off rate, though a heartbeat tick can release an exit-7 `review
  required:` hold with no act from him (someone else approved the PR).
- A RACE hold is no act. Only a `RACE decided:` line that `resume`, `hand-back` or `auto-retry` acts on is counted
  (`race-decided`). A decision that arrives while a green re-verify lands the task, or that a defer applies, is not
  counted.
- A repair run that records no answer, sign-off, retry hand-back or RACE decision is not counted: one that only
  descopes and hands back, runs a `resume` that lands no decided RACE, defers, or reconciles drift. The Hands-off rate
  is a floor on Lachy's involvement, not a full count.
- Acts from before p21-2's events (a lead's own hand-back then included) are not in the record: such a hand-back is
  flagged "no recorded cause: not counted".
- A descope's hand-back reads as automatic, whichever session ran it.
- A hand edit to a note is no event.
- A RACE re-verify with no Slot open reads as a wait (`hold-race`), not as running time.
- The cause of a gap between the value the run ran at and rollouts.toml (`ranAtCause`) is **inferred**: the
  record stamps effective values with no source, and rollouts.toml's mtime moves on any save. A label changes
  the wording only, never whether a proposal is made.
- The thresholds (the 30-min grace, the 2-h lane-only cap, the 50 / 80 / 60 % shares) are heuristics, named in
  `score.json`'s `thresholds`.
- A fix written without `fixes:` is not counted as an Escape (task-writer § 4 sets the key).
- A review finding is attributed by `git blame`, so a finding on an old line counts against whichever task last
  wrote that line: a landed later PR's review can still blame its sibling-site findings (a line it should have
  changed alongside its own change) on the task that last wrote the line, so Quality can read too low.
- Only a review of landed work counts: a review whose head the Project root's ref does not reach (a closed PR's
  rounds, or a branch that landed only by squash) is skipped and listed in `escapes.excluded.unlandedDocs`, so a
  squash-landed later PR's findings are missed too.
- Reverts and review findings are read from the Project root's local ref, never fetched: `escapes.ref.tipDate`
  shows how old it is, and anything pushed since the last fetch is missed.
- A repair run that writes no dated `repair:` line in the rollout note's `## Notes` and records no event is not seen
  by the weekly reading, nor is a `repair:` line on a rollout with no Run record (one that never ran): the repair
  lines are swept from the notes of the rollouts the record holds.
- A Human fix (ADR 0035) has no event of its own, nor does a gate signed on the note with no `gate-signed` line (one
  signed before p21-2's events, by Lachy or the Standing approval, or written by hand): the weekly reading sees
  either only as a set-aside whose `movedBy` is `unrecorded`, and then its task note's `## Needs you`,
  `## Integration log` and `## Approved gates`, the rollout note's `## Notes` and its Run record lines (`mover`) say
  what moved it, or nothing does.
- /fresh-review churn names no rollout (`reviews.jsonl` carries none): the weekly reading reports it (`freshReview`)
  and traces none of it.
- The Escapes sweep misses a record with no rollout note or Project root and a repo with no GitHub origin (both in
  `cannotShow`), and dates an undated fixer by its mtime.
- An escapes-only rollout's breaches are not counted, nor a repairs-only one's: a Guardrail breach counts in the week
  its run ends.
- A closed rollout with no close line (a dropped one, one archived unscored, or a close that was not scored) is read
  in the week its record has lines but leaves no baseline, and one whose lines all predate a window is never re-read.
- A date-only piece of evidence (a `repair:` line, a fixer's `captured:`) carries no time: it is read by the
  Reflection whose window holds that Melbourne date, from every rollout with a Run record whether or not it has a line
  that week, so one dated the day a reading ends is read once, by the next reading. A `--since` other than the last
  Reflection's end skips or re-reads the dates between.
- A single-rollout Watch is offered only beside a rule proposal, but still makes the week not quiet when it is new.
- A declined Watch seen again in one rollout is neither new nor offered: it returns only when two later rollouts show
  it.
- Lachy's no to a held trade is recorded only by a done decision task's `- trade` line, never in `reflections.jsonl`:
  a decision task dropped unanswered decides nothing, so its trades are offered again while they are held; a task
  marked done with a trade unanswered reads as his no; and a hand edit that removes a `- trade` line forgets the no. A
  no holds for that (knob id, `from`) whatever later rollouts show, unlike a declined Watch, which returns when two
  later rollouts show it afresh: the trade is offered again only once its value moves to a new `from`.
- A held trade on a partial window is held `partial window`, so it reaches the decision task only in a later week
  that reads the rollout whole; one on a rollout with no repo, note or settings is never a knob candidate, so it is
  never offered.
- A knob's revert does not by itself make a reading not quiet: the contract's quiet reading also has no revert, but
  `close`'s `quiet` counts new Watches, rule proposals, bugs and Guardrail breaches only, and the breach behind a
  revert counts only on a rollout whose run ended in the window (reflect.py's header).
- Lachy's minutes per decision and per review item (`DECISION_MINUTES`, `REVIEW_MINUTES`) and the fortnight constants
  (`DUE_SOON_DAYS`, `SNOOZE_DAYS`) have no measure in the record: the Grade log measures the grades and, through Slot
  hours per size, `SIZE_MINUTES` alone. Slot hours include the lead's set-up and in-Slot waits, so they read high.
- In grade accuracy a serial task is seen as dispatched only through its `rollout:` link or an act line: it has no Slot
  hours, and a halt clear is no act there. A task scheduled into a rollout that closed before it ran reads as
  `regraded` by its link (`dispatchedBy: link`), and a `--gated` rollout's merge holds count as bounces
  (`mergeHoldOnly` counts them).
- Fit disagreements (the grader's shape against schedule's outcome, orient-all § 8) are not logged, a renamed task's
  grades read `unknown`, and grades from before the first logged estate pass do not exist.
- A `tunings.jsonl` line can carry several Tunings: the contract's ledger has one line per Tuning, but tune.py writes
  a run's Tunings on ONE `tuning` line, an `applied` entry per knob, for a by-hand `--pick` of several (step 7) and
  for an `--auto` call that lands several (step 14). Only the weekly reading's `proposal` lines in
  `reflections.jsonl` give one line per knob; a by-hand Reflection's picks have none.

## Don'ts

- Don't compute, round or restate a number the script did not print, and don't propose a Tuning score.py did not
  emit.
- Don't run tune.py again once it has written this Reflection's line, or before Lachy has answered (or ended the
  Reflection). An exit-2 `--pick` refusal wrote nothing: it allows one corrected `--pick` or falls back to
  `--record-only` (step 7), and never ends the Reflection without a line.
- By hand, don't pick for Lachy or treat a proposal's `agreeing` count as a pick; the weekly reading lands a knob only
  through `tune.py --auto` (ADR 0037 d5), never a rule.
- Don't write a decision task for Watches to confirm alone: they wait for a rule proposal, and a task a held trade
  alone writes lists none.
- Don't re-run step 10 after a write: a new span is a new Reflection.
- Never overwrite or edit a done task: reflect.py creates a note by exclusive create and refuses a taken path.
- Never write a close line from the weekly reading: `--close` is close-score.py's alone (ADR 0037 d4).
- Never decide a rule item or a held trade during a run (the weekly reading never `--pick`s), and never schedule
  or reshuffle the decision task.
