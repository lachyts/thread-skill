---
name: reflect
description: 'Use to score a rollout and tune the operator''s rollout settings: a Reflection over its Run record, by hand or weekly. Triggers on "reflect on [[rollout]]", "how did [[rollout]] run", "how did the rollout run", "score this rollout", "what bound the rollout", "should I raise the parallel ceiling", "run the weekly Reflection", "reflect on this week''s rollouts", or /thread:reflect. Folds the Workflow journals, scores the Run record on its two headlines (Hands-off rate, and Quality from the Escapes traced to it) and the Guardrails (Throughput among them, bounded in running hours per task, and Review churn), with Slot and lane use, load and the binding constraint, and proposes Tunings weighed for what each serves and risks. By hand it applies only the ones Lachy picks, through the tune script, which records each by-hand Reflection in tunings.jsonl; the weekly reading traces the friction to its rules, keeps Watches, files bugs and lands agreed knobs on its own, never a rule. Not for Chorus''s Companion record: "reflect on the Companion" is Chorus''s /reflect.'
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

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

The Reflection takes Chorus's word and shape (ADR 0037 d2): record → proposals → Lachy picks → the tune script, and
for the weekly reading, Chorus's span → Watches → close. It reads rollouts' Run records, never the Companion's:
"reflect on the Companion" is Chorus's `/reflect`.

## Scope

Reads the rollout note (`~/repos/obsidian/Work/Tasks/`, then `Work/Tasks/Archive/Rollouts/`), the Run record and
`tunings.jsonl` under the events directory (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py dir`
prints it), and `~/.config/thread/rollouts.toml` through `rollout-settings.py`. `land.sh --origin-slug` runs one
local `git remote get-url origin` in the Project root: no network. For the Escapes the score also reads, read-only:
every note under `~/repos/obsidian/Work/Tasks/`, Archive included, for `fixes:` and `merged_into:`; and the Project
root's git (commit messages, `docs/reviews/` and `git blame`), never fetched. By hand it writes `fold-journals`'
`call-journal` lines, and tune.py's one line and its picked keys; scratch files go under
`/tmp/thread-reflect-<rollout-slug>/`, and it makes no vault write. The weekly reading reads every rollout record and
`reflections.jsonl` too, and writes: `reflections.jsonl` through reflect.py; a bug task and the decision task under
`~/repos/obsidian/Work/Tasks/`; the decision task's one line on its day page (task-writer § 3b); `tunings.jsonl` lines
only through tune.py's `--auto` and `--revert`; and `call-journal` lines through `span --fold`. Its scratch dir is
`/tmp/thread-reflect-week-<YYYY-MM-DD>/`. Neither form makes a git write or a PR.

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
d4): the scripts score and sweep, the model traces each cost to its rule, and the writers record the outcome. It
lands a bug task, an agreed knob or a knob's revert unasked (ADR 0037 d5); a rule proposal, and any Watch to confirm
beside it, goes into one decision task for Lachy's next morning. Every write goes through `reflect.py` or tune.py,
each idempotent, so a reading that dies part-way is finished by running the remaining steps against the same
`span.json`.

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
every record (ADR 0037 d4), and lists the open Watches and the knob candidates; its header holds every rule. Add
`--since <TS>` and `--until <TS>` only on Lachy's word: by default it starts where the last Reflection ended. Read
the whole `span.json`. Exit 1 or 2 stops the reading: quote its stderr line. Never re-run it after a write (step 12
on): a new span is a new Reflection, with a new id.

### 11. The reading

For each rollout, read its `friction` items, of seven kinds (`ask`, `set-aside`, `retry`, `descope`, `repair`,
`escape`, `churn`), and trace each to the skill rule or ADR that produced it:

- An `ask` (a Recorded answer, a sign-off, a retry hand-back, a merge hold, a RACE decision, a git-env hold) is a
  mid-run ask. A mid-run ask is traced to the grill that should have asked it before the run: orient § 5
  (Reshuffle), where `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § R2 (Sort and propose) sorted the task
  clear, or where `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § R3 (Grill the unclear) never put the fork
  to Lachy; `${CLAUDE_PLUGIN_ROOT}/skills/_shared/grill-fit.md` § How a fork comes back, where the batch prompt
  routed no gate; orient § 7 (Batch), where a conversation-gated task entered a batch; and, only for spend, a
  credential or an irreversible action, schedule § 3.5 (Detect human/release gates) or schedule § 3.6 (Sweep for
  gated-input smell), or `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § R3 (Grill the unclear), item (c),
  asked ahead. An ask whose `askedAhead` is true was asked at the top and still came back: trace why the answer
  did not hold. span reads each ask from the record in the week it happened, on a landed task or one still waiting
  (the Hands-off rate counts landed tasks only).
- A `set-aside` is traced by its stage and `reasonClass` to the rule that stopped it: execute § 3.5 (the plan
  gate), execute § 3.7 (gated inputs, ADR 0034), execute § 4.5 (the queue, ADR 0030) or execute § 6.5 (Needs
  you), and by its `movedBy` to what moved it on.
- A `retry` is execute § 4.5's automatic retry (ADR 0033): trace why the first attempt failed a block an agent
  could fix.
- A `descope` is repair § 2–§ 5's descope and its hand-back (ADR 0035): trace why the task's scope could not land
  whole.
- A `repair` item is traced by its shape: `race-decided` is read with its `raceDecided` ask, never twice;
  `escalated` and `flipped` are drift the run should have closed itself (repair § 3); `git-env` is execute § 4.5's
  canary; `raise` is a round cap (weigh it beside score.py's own knob); `deferred` is repair § 5.
- An `escape` is traced to the review that should have caught it (execute § 5, ADR 0037 d7), and only when its
  `inWindow` is true: an Escape counts in the week it surfaced, against the rollout that landed the work.
- A `churn` item is a review round that only answered the last round's fix (execute § 5): trace what the fix broke.

For each `set-aside` item whose `movedBy` is `unrecorded`, open its `taskNote` and read its `## Needs you` and
`## Integration log`; trace the Human fix you find there (ADR 0035) like a mid-run ask; when neither says what moved
it, name it as unexplained.

Each item becomes a sighting (step 12), a bug (step 13), a knob (score.py's only: never invent one) or nothing,
named with why. Read `freshReview` and `cannotShow` as reported, not traced. A `closed with no close line` flag is
reported, not traced: that rollout leaves no baseline (ADRs 0030, 0033, 0034, 0035 and 0037 bound what each
trace may conclude). The Watch, its id and its recurring rule are Chorus's Reflection's, borrowed and never imported;
recording Lachy's no (step 15's decision task, § Deciding the decision task) is this skill's own.

### 12. Sightings

After the whole reading, make ONE `reflect.py watch` call per Watch, naming every rollout where you saw it. Reuse an
open Watch's rule and shape verbatim, a declined one's included. On exit 2, re-run naming the union the refusal
prints.

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

`--revert` runs once per `knobs.revert[]` item (its `scores`, `tuning` and `root`), `--auto` once per `knobs.land[]`
item, and `knobs` once, after them. Report every exit verbatim: an `applied` line, a `held <key>: <reason>` line
(`agreement 1 of 3`, say), a refusal (exit 2) or a write failure (exit 1). Never `--pick`, `--record-only` or
`--close`, and never edit `rollouts.toml`.

### 15. Decide

Write `/tmp/thread-reflect-week-<YYYY-MM-DD>/decisions.json`, `{"<watch id>": {"why": "...", "amends": "..."}}`,
one entry per recurring Watch: why it matters, and the rule it would amend. Then:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py decide --span /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json --decisions /tmp/thread-reflect-week-<YYYY-MM-DD>/decisions.json
```

It writes a decision task only with a rule proposal: a week with Watches to confirm alone writes none, and they
wait. The task is scheduled for the next Melbourne morning, conversation-gated, and orient's audit lists it (orient
§ 2). Put its line on its `scheduled:` day's page by task-writer § 3b; when `decide` printed `(was <date>)`, move the
line from the old day's page.

### 16. Close

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py close --span /tmp/thread-reflect-week-<YYYY-MM-DD>/span.json
```

Exactly once, quiet weeks included: its line is the Reflection's record, and its `quiet` feeds the cadence (ADR
0037 d6). A quiet week writes only record lines, never a vault task.

### 17. Report, then tidy

Report the rollouts read (and the escapes-only ones), each trace and what it became, the Watches written (and any
`extended` line), the bugs filed or found, each knob landed, reverted or held with its reason, the decision task (or
none), the close line's counts and `quiet`, the `cannotShow` list and every flag. Then `rm -rf
/tmp/thread-reflect-week-<YYYY-MM-DD>`.

## Deciding the decision task

`/thread:reflect --decide [[<slug>]]`, with Lachy, at the top of a run. Read every `## Reflection <id>` section and
`## Still open`. For each item:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py raised --watch <id> --reflection <the section's id> [--confirmed | --declined]
```

- **A yes to a rule item**: `raised` plain, then file the rule's grill task (task-writer § 4: a grill and an ADR
  before any build).
- **A yes to a Watch to confirm**: the same with `--confirmed`, then the grill task.
- **A no**: the same with `--declined`. It records his no and closes the Watch's cycle, so the pattern is proposed
  again only when two later rollouts show it afresh, never next week from the same evidence.
- **Not now, or not reached**: nothing. The Watch stays open, and the next weekly reading lists it under `## Still
  open`.

Then mark the task done (`status: done` and `completed: <Melbourne today>`) only once every item it lists has had a
yes or a no (each `raised` printed `raised` or `exists`). An item left open keeps the task open.

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
  by the weekly reading.
- A Human fix (ADR 0035) has no event of its own: the weekly reading sees it only as a set-aside whose `movedBy` is
  `unrecorded`, and then its `## Needs you` and `## Integration log` say what moved it, or nothing does.
- /fresh-review churn names no rollout (`reviews.jsonl` carries none): the weekly reading reports it (`freshReview`)
  and traces none of it.
- The Escapes sweep misses a record with no rollout note or Project root and a repo with no GitHub origin (both in
  `cannotShow`), and dates an undated fixer by its mtime.
- An escapes-only rollout's breaches are not counted: a Guardrail breach counts in the week its run ends.
- A closed rollout with no close line (a dropped one, one archived unscored, or a close that was not scored) is read
  in the week its record has lines but leaves no baseline, and one whose lines all predate a window is never re-read.
- A single-rollout Watch is offered only beside a rule proposal, but still makes the week not quiet when it is new.
- A declined Watch seen again in one rollout is neither new nor offered: it returns only when two later rollouts show
  it.

## Don'ts

- Don't compute, round or restate a number the script did not print, and don't propose a Tuning score.py did not
  emit.
- Don't run tune.py again once it has written this Reflection's line, or before Lachy has answered (or ended the
  Reflection). An exit-2 `--pick` refusal wrote nothing: it allows one corrected `--pick` or falls back to
  `--record-only` (step 7), and never ends the Reflection without a line.
- By hand, don't pick for Lachy or treat a proposal's `agreeing` count as a pick; the weekly reading lands a knob only
  through `tune.py --auto` (ADR 0037 d5), never a rule.
- Don't write a decision task for Watches to confirm alone: they wait for a rule proposal.
- Don't re-run step 10 after a write: a new span is a new Reflection.
- Never overwrite or edit a done task: reflect.py creates a note by exclusive create and refuses a taken path.
- Never write a close line from the weekly reading: `--close` is close-score.py's alone (ADR 0037 d4).
- Never decide a rule item during a run, and never schedule, batch or reshuffle the decision task.
