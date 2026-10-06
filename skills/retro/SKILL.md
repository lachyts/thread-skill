---
name: retro
description: 'Use to score a rollout and tune the operator''s rollout settings: a Retro. Triggers on "retro [[rollout]]", "how did [[rollout]] run", "score this rollout", "what bound the rollout", "should I raise the parallel ceiling", or /thread:retro. Folds the Workflow journals, scores the Run record (Throughput over running time, Guardrails, Slot and lane use, load, the binding constraint), proposes Tunings, and applies only the ones Lachy picks through the tune script, which records every Retro in tunings.jsonl. Never changes anything on its own.'
---

# /thread:retro — score a rollout, propose Tunings, apply the picked ones

`/thread:retro [[rollout]]` is the **Retro** (`CONTEXT.md` § Run record and tuning; ADR 0032): it reads a rollout's
Run record, scores it on Throughput and the Guardrails, names what bound it, and proposes **Tunings** to the
operator's rollout settings (`~/.config/thread/rollouts.toml`). It never changes anything itself. Every number
comes from two scripts, and the model only runs them, shows what they print and passes Lachy's answer on:

- `skills/retro/scripts/score.py` computes the scores and the proposals. It reads only; its header is the one
  copy of every rule (running time, the binding constraint, the baseline, the proposal rules).
- `skills/retro/scripts/tune.py` is the **only writer** of `rollouts.toml` and of `tunings.jsonl` (the Retro's
  line beside the record). Never edit either file by hand from this skill, and never compute a score or write a
  Tuning in the conversation.

The loop is Chorus's `/reflect` shape: record → proposals → Lachy picks → the tune script.

## Scope

Reads the rollout note (`~/repos/obsidian/Work/Tasks/`, then `Work/Tasks/Archive/Rollouts/`), the Run record and
`tunings.jsonl` under the events directory (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py dir`
prints it), and `~/.config/thread/rollouts.toml` through `rollout-settings.py`. `land.sh --origin-slug` runs one
local `git remote get-url origin` in the Project root: no network. Writes: `fold-journals`' `call-journal` lines,
and tune.py's one line and its picked keys. Scratch files go under `/tmp/thread-retro-<rollout-slug>/`. No vault
write, no git write, no PR.

## Invocation forms

```
/thread:retro [[thread-skill-rollout-2026-10-04]]          # the whole run, up to now
retro [[chorus-rollout-2026-10-01]] since Tue 9am until Wed 6pm   # one span (a before/after split)
```

A Retro runs at completion (execute's completion ceremony offers it), mid-run (the slow tail shows, because
running time ends at the Retro, not at the last merge), or on a superseded or dropped rollout (its record alone
is enough).

## Skill flow

### 1. Resolve the rollout note

`[[<slug>]]` → `~/repos/obsidian/Work/Tasks/<slug>.md`, else `~/repos/obsidian/Work/Tasks/Archive/Rollouts/<slug>.md`.
Several matches for a loose name: list them and ask which. Read its body's ``Project root: `<repoPath>` `` line.
A note that cannot be found stops the Retro: say so, and offer a record-only score by slug (step 4 without
`--note`) only on Lachy's word.

### 2. Fold the Workflow journals (idempotent)

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py fold-journals --rollout <rollout note path>
```

Show its summary line and every `WARN:` line. A non-zero exit is surfaced and the Retro **goes on**: the score
flags what the missing journals cost (tokens unknown, a Slot ended at its slot-freed).

### 3. The settings and the repo identity

```
mkdir -p /tmp/thread-retro-<rollout-slug>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py --repo <Project root> > /tmp/thread-retro-<rollout-slug>/settings.json
bash ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh --origin-slug <Project root>
```

- A rollout-settings refusal (exit 2 or 3) **stops the Retro**: quote its stderr line verbatim, with its remedy
  (fix `~/.config/thread/rollouts.toml` at the named line; exit 3 needs python ≥ 3.11).
- `land.sh` exit 0 prints `owner/name`: pass it as `--repo-slug`. This is the repo identity, never
  rollout-settings' `repo`, which is null whenever no repo table applies yet.
- `land.sh` exit 4 (no GitHub origin): score the run with no `--repo-slug`. It proposes nothing and keeps no
  baseline (flagged).
- Any other `land.sh` failure **stops the Retro**: quote it.

### 4. Score

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/retro/scripts/score.py --rollout <slug> --note <rollout note path> \
  --settings /tmp/thread-retro-<rollout-slug>/settings.json --repo-slug <owner/name> \
  --out /tmp/thread-retro-<rollout-slug>/score.json
```

The whole run by default (`--since` the first Slot taken, `--until` now). On Lachy's word add `--since <TS>` and
`--until <TS>`, each with `Z` or an offset (`2026-10-02T09:00+11:00`), to score one span: a before/after split
around a change, or the half of a run a mid-run ceiling change flags. Exit 1 (the record, the events directory,
the settings or the note cannot be read) or 2 (usage, a bad slug or TS) stops the Retro: quote its stderr line.
Exit 0 with the flag `no record` is a real answer (nothing was recorded), shown as such.

### 5. Present

From `score.json`, verbatim numbers only (the record is UTC; local times may be shown beside them):

- **Throughput**: merges per running hour, the running hours, and every excluded span by kind (`paused`,
  `hold-merge` / `hold-race` / `hold-git-env` waits on Lachy, `lead-absent`, `never-finished`,
  `lane-only-over-cap`, `idle`) with its why. Say when the window is `partial` (a Slot still running at the
  Retro).
- **Guardrails**: tokens per merge, set-aside rate, conflict rate (and the integrator-path share) and quota
  stalls, each against its bound and the baseline, and whether it is breached. With no baseline, say so.
- **Slots and lane**: the ceiling it ran at (and any mid-window change), the share of running time the Slots were
  full, utilisation, idle Slot time by reason; the lane's busy share, Integrations and the ready-to-lane waits.
- **Load**: the overlapping rollouts on this machine and their span.
- **The binding constraint** and its why. A lane-bound run proposes no key: say "no key moves this".
- **Each proposal**: `id`, `key from → to`, its evidence, `agreeing` (earlier applied Tunings with the same rule),
  and its `ranAtCause` in plain words when present, e.g. "ran at 5 by a rollout-note override; rollouts.toml says
  3", so a jump such as 3 → 6 reads as one step past what the run proved.
- **Each withheld entry** with its reason, and every flag.

Then ask which proposals to apply, by id, or none.

### 6. Lachy answers

Only Lachy picks. A "yes" names ids (`p1`, `p1 and p3`); anything else, or no answer, applies nothing.

### 7. Apply through the tune script, exactly once

Every Retro that reached its scores runs tune.py **exactly once**: it writes exactly one `tunings.jsonl` line
(none only for a null repo, below). Before a `--pick` run, check every picked id against `score.json`'s
`proposals` (not `withheld`): an id that is not there goes back to Lachy (step 6) before tune.py runs.

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/retro/scripts/tune.py --scores /tmp/thread-retro-<rollout-slug>/score.json --pick <p1,p2> --repo <Project root>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/retro/scripts/tune.py --scores /tmp/thread-retro-<rollout-slug>/score.json --record-only
```

The first with Lachy's yes answers; the second when he picked nothing, said no, or ended the Retro without
answering. `--record-only` still matters: its line is the next Retro's baseline. With a null repo, tune.py prints
`tune: not recorded: ...` and exits 0: report that line as it is. Exit 1 (a write failed: nothing applied, or the
line voided) and exit 2 (refused: a stale `from` because rollouts.toml changed since the score, an unknown or
withheld id, a dotted or inline key, another repo) are reported verbatim; a stale `from` is fixed by a fresh
Retro. Never edit `rollouts.toml` to work around a refusal.

A `--pick` run that wrote no line does not use up the one run: an exit-2 refusal writes nothing (no line, no key),
and neither does an exit 1 that says `nothing applied: the Retro's line could not be written` or `cannot write
next to`. Report it, then either re-ask Lachy once and run the corrected `--pick` (a withheld or mistyped id), or,
when he picks nothing more or the refusal cannot be fixed in this Retro (a stale `from`, another repo), run
`--record-only`, so the Retro still leaves its line as the next one's baseline. A run that wrote its line (exit 0,
or the exit-1 `rollouts.toml was not written` failure, which records the line and voids it) is the one run: never
run tune.py again for this Retro.

### 8. Report, then tidy

Report the `tunings.jsonl` line tune.py named (its id), the applied set (or none), and the `applied ...` lines it
printed. Then `rm -rf /tmp/thread-retro-<rollout-slug>`.

**When a Tuning takes effect.** A picked Tuning takes effect at the next `/thread:schedule` (or its
`--regenerate`, which stamps freshly resolved values). A rollout note already stamped, running, paused or not yet
started, keeps its own frontmatter values: execute reads task frontmatter, then rollout frontmatter, then
rollouts.toml, and only a legacy note missing a key reads rollouts.toml, at its next loop entry (execute § 3). To
change a live rollout, Lachy edits its note.

## What the record cannot show

- A merge hold carries no reason, so a `--gated` hold cannot be told from an exit-7 hold: both read as a wait on
  Lachy.
- A RACE re-verify with no Slot open reads as a wait (`hold-race`), not as running time.
- The cause of a gap between the value the run ran at and rollouts.toml (`ranAtCause`) is **inferred**: the
  record stamps effective values with no source, and rollouts.toml's mtime moves on any save. A label changes
  the wording only, never whether a proposal is made.
- The thresholds (the 30-min grace, the 2-h lane-only cap, the 50 / 80 / 60 % shares) are heuristics, named in
  `score.json`'s `thresholds`.

## Don'ts

- Don't compute, round or restate a number the script did not print, and don't propose a Tuning score.py did not
  emit.
- Don't run tune.py again once it has written this Retro's line, or before Lachy has answered (or ended the
  Retro). An exit-2 `--pick` refusal wrote nothing: it allows one corrected `--pick` or falls back to
  `--record-only` (step 7), and never ends the Retro without a line.
- Don't pick for Lachy, and don't treat a proposal's `agreeing` count as a pick: a rule three Retros agree on may
  become automatic only by ADR (`CONTEXT.md` § Run record and tuning).
