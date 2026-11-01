#!/usr/bin/env python3
"""score.py — score one rollout's Run record for a Reflection (p15-5, ADR 0032; p21-2, ADR 0037 d1). Reads only;
writes nothing.

python >= 3.8, stdlib only. Called by skills/reflect/SKILL.md (step 4) as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/score.py --rollout <slug|[[slug]]|note path> \\
        [--note <rollout note>] [--since TS] [--until TS] [--settings <rollout-settings JSON file|->] \\
        [--repo-slug owner/name] [--repo <Project root>] [--tasks-dir <dir>] [--out F]

--repo takes any directory in the Project root's clone, as tune.py's and rollout-settings.py's --repo do; --tasks-dir
the vault's task notes, as unfinished-rollout.py's and reconcile-rollout.py's do (default ~/repos/obsidian/Work/Tasks,
`~` read against the scored env's HOME). Both only feed the Escapes, below; without them those sources read unread.

Reads: the rollout's record `<events dir>/<slug>.jsonl` (run_record.py's directory chain), every other
`<slug>.jsonl` there for load (the reserved files, run_record's RESERVED, are never read as rollouts, though
reviews.jsonl is read for its /fresh-review rounds, Review churn below; only lines from the
scored record's host count, and only where a record's live span overlaps this run's running time, not the window, so
a Reflection run long after the rollout never counts a later rollout; the live span runs to its last line or, while a
Slot it took is open, to --until, flagged, so a busy rollout whose long calls write nothing still counts), tunings.jsonl for the baseline, earlier
Tunings and their agreement, and the rollout note's frontmatter (parallel_ceiling, max_review_rounds,
max_iterations, max_plan_rounds, captured) through reconcile-rollout.py's Note, for the cause labels only. --settings is rollout-settings.py's JSON for
the Project root: each key's resolved value now (a proposal's `from`), the Guardrail bounds, and `path`, whose
mtime feeds the cause labels. For the Escapes, escapes.py (beside this script, loaded here) also reads, read-only and
never fetched: every note under --tasks-dir (Archive included) for `fixes:` and `merged_into:`, and the --repo
clone's commit messages, `docs/reviews/` and `git blame`, or its in-place checkout's when fresher (ADR 0042). Its docstring is the one copy of those rules.

Times. --since and --until take Z or an offset (run_record's `_stamp` rule; a naive stamp is refused) and
everything printed is UTC `Z`. --since defaults to the record's first slot-taken, else its first line;
--until to now (the Reflection's moment). Lines after --until are not read, except `call-journal` lines: fold-journals
stamps them with the fold time (completion, or the Reflection's start), so each is read whatever its ts, and its call's
startTime + durationMs is clamped to --until (a call still running at --until is read as running then). With no
line the score is empty and flagged "no record".

Running time is the time in [since, until] when the run is active and not paused. Active: a Slot is open (to
its effective end, below), or the lane is held with no merge, race or git-env hold open and no Slot open, for
at most LANE_ONLY_CAP of each such stretch of one holding (a pause splits a stretch). Paused spans (paused .. resumed) are excluded; the drain before a
soft pause's stamp counts as running. A hold with no Slot open is a wait on Lachy: excluded, listed by kind. A
Mac-wide hold (MAC_HOLDS: the Trickle, the Away cap, the Heat hold; execute away.md) with no Slot open is a meant wait,
never Lachy's: excluded under its own kind (hold-trickle, hold-away-cap, hold-heat), after every kind above (so a pause
or a hold wins) and before `idle`. Its idle-slots marker at t labels [t, e), e the earliest of the next marker (any
reason), t + HOLD_MARKER_SPAN (two heartbeat ticks: the lead re-checks at each) and --until, so a dead lead's silence
reads idle past the span, never the Trickle; a not-running stretch whose first marker is a Mac-wide hold within
HOLD_MARKER_SPAN of its start takes that label from its start, unless another reason is in force there (the Slots'
labelling, below: the last marker's reason holds until a change of reason, a stop or full Slots), so a queue-tail
before the stop never back-fills as the Trickle. A run the Trickle held with no Slot ever open has no first
slot-taken, so the default window starts at its first line: no running time, its held spans excluded as hold-trickle,
and it reads trickle-bound (all of its time held), with Throughput null.
- A Slot's active intervals. Its calls are every run-bound (not an integrate call) for its task inside it (a
  restart after a dead lead re-takes the open Slot, keeping its first start, and binds a new call); a call's
  journal is its latest terminal call-journal line, else its latest line. The Slot is active from its start to
  the first call's start, then over each call: from its startTime (else its run-bound) to its end, or its last
  activity when not terminal, plus GRACE. An earlier call stops at the next call's start; the gap between them is
  excluded and flagged ("lead absent" after a terminal call, "never finished" after one that is not). Missing
  timing on an earlier call runs it to the next call's start (flagged). The last call sets the Slot's
  effective end:
  - Terminal, with startTime and durationMs: the earlier of slot-freed (or --until) and the call's end plus
    GRACE. A later slot-freed leaves a gap, excluded and flagged "lead absent". A terminal call that ends after
    --until was still running at --until: read as non-terminal with its last activity at --until. Here a
    slot-freed is read at the Slot's release: its `reconciledAt` when reconcile stamped the line at the call's end
    (p29-12, run_record.py's call-end stamps), else its ts, so the lead's absence after the call still reads as
    lead absent; everything else reads the line's ts, the call's end.
  - Non-terminal: its last activity is startTime + durationMs, else the task's last record line (flagged).
    When last activity + GRACE reaches --until on an open Slot, the Slot runs to --until and the window is
    `partial` (a genuine mid-run tail); otherwise it ends at last activity + GRACE (or its earlier
    slot-freed), flagged "never finished: capped".
  - No journal (or a terminal one without startTime/durationMs): slot-freed, flagged; an open Slot is read as
    a non-terminal call with no durationMs.
- Pairing follows run_record.py's reader rules: one Slot per task, the same lane holding, a hold per (hold,
  task), a pause until resumed, a lane-freed closing the task's merge hold, a `carried` line in its from-file
  closing that task's Slot, lane and holds. An origin yield (ADR 0064: lane-freed release=origin, the lead yielding
  its lane to another rollout's Integration on the same origin) ends its holding like any lane-freed; the same task's
  next lane-taken, with no merged, set-aside or from-file carried line for it after that end, opens a continuation
  (`cont`, carrying `first`, its Integration's first holding), and the gap between them is an origin wait
  (origin_waits, (end, start, task)): no lane busy time. A yield whose re-take never came ends at the yield and still
  counts one Integration. A lane, hold or pause still open at the last line read ends there,
  flagged. The night record's lines (away-night, last-start-held, ran-past-morning: p28-2, NIGHT_KINDS) are not
  read: `next` writes a ran-past-morning line after the Morning it reads, so none is a task's last record line (an
  untimed call's last activity) or the record's last line. Nor are the time-lost ledger's (stopped, lead-entry,
  suite-started, suite-ended, base-moved: p29-10, LEDGER_KINDS), dropped as each record is read, the scored one and
  every other one read for load: a score is byte-equal with or without them. reflect.py's Time-lost ledger (ledger.py,
  p29-11) reads them; a score never does.

Headlines (ADR 0037 d1: two, and Lachy settles any trade between them; there is no tie-breaker):
- Hands-off rate: the share of the window's landed tasks (distinct tasks with a `merged` line in [since, until])
  with no act from Lachy between the run's start (the record's first slot-taken, else its first line) and the task's
  first `merged` in the window; an act before --since counts for a task that lands inside it. Read only from the Run
  record events the verbs write (run_record.py's "Human acts"), never from task notes. Acts: `answer-recorded`
  (answer), `gate-signed` standing=false (signOff), `handed-back` via=retry (retry), any merge hold, a paired
  `hold-started` hold=merge (mergeHold), and `race-decided` (raceDecided). Not counted (`notCounted`): `gate-signed`
  standing=true (standingApproval: the Standing approval), `handed-back` via=descope and `auto-retry`
  (automaticHandBack), and a landed task with a race hold and no `race-decided` (raceReverified: the RACE procedure
  opens the hold on every merge-task exit 5, and a green re-verify's mark-done ends it with no decision). A
  `handed-back` via=answer is no act of its own: its `answer-recorded` is. rate = (landed - the tasks with an act) /
  landed, to 4 places; null with nothing landed, flagged. `byKind` counts act events, not tasks. Known gaps, so read
  the rate as a floor on Lachy's involvement, not a full count: every merge hold counts, the exit-7 `review required:`
  hold a heartbeat tick can release with no act from him included (the record carries no reason); a race hold counts
  only through its `race-decided`; a repair run that records no answer, sign-off, retry hand-back or RACE decision is
  not counted (one that only descopes and hands back, a `resume` that lands no decided RACE, a `defer`, drift
  reconciliation); acts from before p21-2's events are not in the record. Flagged: each `slot-taken start=hand-back`
  with no `auto-retry`, `handed-back` or `gate-signed` for its task since that task's last set-aside ("no recorded
  cause: not counted"), and each git-env hold (task null: a rollout-level wait, attributed to no task). An act's own
  line is no activity of the task's call: it never moves an untimed call's last activity (the four act kinds stay out
  of each task's last record line).
- Quality: escapes.quality (Escapes and Quality, below; p21-4): 1 - Escapes / landed, null with nothing landed or
  every Escape source unread. `escapes.partial` says when it rests on fewer sources and can only read too high.

Scores: Throughput = merges (distinct tasks with a `merged` line in the window, read-only ones included) per
running hour (0.0 with no merge; null with no running time, flagged), now a Guardrail. Slots: the Parallel ceiling
is a step
function over the settings on slot-taken and idle-slots (`ceilingSteps` lists its changes only); full = Slots
in use at or above the ceiling in force. Idle Slot time is labelled by its idle-slots markers (the first
marker labels its idle span from the start, a change of reason splits it, and a stop or full Slots ends the span and
its reason), else "unexplained". Lane: busy share, Integrations (lane holdings started in
the window that continue no origin yield: one Integration across its yields, ADR 0064) and each ready -> lane-taken
wait; conflicts and the integrator path are read once per Integration, from its last holding. Guardrails: Throughput first (ADR 0037 d1: no longer a headline,
bounded so an overnight run still finishes by morning): breached when running time exceeds `[guardrails]
hours_per_task` (built-in 1.5, a heuristic) times the tasks whose Slot or lane holding overlaps [since, until] (at
least 1: running time counts lane-only stretches, so a task that only integrates in the window, a supersede's carried
task or the far side of a --since split, earns its allowance too), compared in ms and strictly greater, so a run
exactly at its allowance is inside it; never with zero running time;
a breach on a partial window is flagged ("the run's tail has not landed"). Then tokens per merge (the tokens of
every call journal, its latest terminal line else its latest, so a call still running counts what it has spent,
whose call started in the window by its startTime, else its run-bound; integrate calls included; over merges),
set-aside rate (set-asides / (Slots closed + Integrations)), conflict rate (conflicting lane-freed /
Integrations, with the integrator-path share beside it) and quota stalls, against their [guardrails] bounds:
a % rise for tokens, point rises for the two rates (both measured from the baseline) and an absolute count for
stalls; and Review churn (below) against an absolute `review_churn_pct` bound (built-in 40), which breaches with no
baseline. The baseline is the `scores` of the tunings.jsonl line for this repo (ignoring case) with the latest
window.activeEnd at or before this window's activeStart, a line not marked partial preferred (a partial one is
used only when no other qualifies, flagged); activeEnd null never qualifies. It carries the line's `v`; a line
whose scores lack the v2 keys (a v1 line, seven scores) is flagged and gives no Hands-off rate, Quality or Review
churn baseline. With none, only quota stalls, Throughput and Review churn, the three absolute bounds, can breach ("no
baseline"). Throughput's and Review churn's `baseline` is shown beside them, never compared.

Review churn (p21-3, ADR 0037 d1) = Σregression / Σfindings over the window's review rounds, both sources together,
rounded to 4 places: null, flagged "review churn unknown: no review rounds recorded", with no round; 0.0 only with
rounds but no findings (every round approved clean); null, flagged "review churn unknown: N finding(s), none
classified (...)", with findings none of which original or regression placed (no head, no tree, no `path:line`
cite), since a 0.0 there would read clean and never breach. A null never breaches. The denominator is every
finding, unclassified ones included (the rest of findings once original and regression are taken), so sparse
`path:line` cites understate it; `unclassified` reports the coverage, and more than half of the findings
unclassified is flagged "review churn: low coverage" (review-ledger.py's 40% THRESHOLD, the built-in bound, is
measured over classified findings only). The breach is decided from the integer sums, Σregression x 100 >
review_churn_pct x Σfindings, never from the rounded value (11 of 20 is at a 55 bound, not over it).
- Engine rounds: the record's review-verdict lines (reconcile-rollout.py, one per judged master-review round, split
  by review-split.py). The lines read (ts <= --until) are deduped ONCE by run_record.verdict_key, the first line per
  key in record order kept; that one set feeds both the windowed sums (rounds with ts in [since, until]) and rounds
  per landed task: each landed task's kept rounds up to --until, over the landed tasks with at least one (landed:
  a `merged` line in the window, read-only ones out); null with none, and a landed task with no round is flagged.
  Engine rounds are reviewLoop's REVIEW_VERDICT rounds only; an Integration re-review rejection uses a review round
  but writes no review-verdict line, so rounds per landed task counts master-review rounds only and `round` can skip.
- /fresh-review rounds: reviews.jsonl's review-round lines (p15-7) read up to --until, deduped on (repo, doc), else
  (repo, head, digest), the latest kept, then windowed by the kept line's ts. A line counts only when its repo is
  this score's repo (--repo-slug, else --settings' `repo`): an owner/name matched ignoring case, or an absolute path
  whose GitHub origin is (rollout-settings.py's _origin_slug, cached per path; a deleted worktree resolves through
  its nearest existing ancestor). With no repo identity, or a path with no readable origin, it is `unattributed`,
  flagged and not counted. A missing file is no rounds; a line without valid counts is a round outside the sums,
  flagged.

Binding, the first that holds: quota-bound (quota stalls >= QUOTA_STALLS); lane-bound (lane busy >=
LANE_BOUND_BUSY of running time, or the waits climbing: the last third's mean over WAIT_CLIMB_RATIO times the
first third's and at least WAIT_CLIMB_MIN minutes); slot-bound (Slots full >= SLOT_BOUND_FULL); trickle-bound (the
Mac-wide cap, the Trickle or the Away cap, kept Slots free >= TRICKLE_BOUND of the time, a share read as slot-bound's:
the time a hold-trickle or hold-away-cap label is in force with a Slot free, plus every such excluded span with no
Slot open, over running time plus those spans; and, as dependency-bound's largest reason, the Slot time the cap held,
its idle Slot time plus each such excluded span times the ceiling in force at its start, at least every other idle
reason's idle Slot time, so a run whose dependency waits left more Slots idle than the cap did is not the Trickle's;
flagged that no rollout key moves it, and Throughput flagged as read under the cap, its value and Guardrail
unchanged); dependency-bound (idle >=
DEPENDENCY_IDLE of Slot capacity, dependency plus solo the largest reason); else none-clear.

Proposals, one rule each: slot-bound -> parallel_ceiling +1, withheld ("lane N% busy, at or above 60%") when the
lane is LANE_FREE_FOR_RAISE busy or more (so a Slot-bound run always shows its raise); quota-bound ->
parallel_ceiling -1; >= ROUND_SET_ASIDES set-asides of reasonClass review-rounds ->
max_review_rounds +1; of plan-rejected -> max_plan_rounds +1 (a needs-human set-aside, a stop on a question,
counts toward neither: another round cannot answer it). `ranAt` is the value the run ran at: the ceiling
in force for most of the running time (ties to the later), a round cap's most common value on the window's
slot-taken lines. to = ranAt + direction; from = rollouts.toml's resolved value now (--settings). A proposal is
`from -> to` when sign(to - from) is the rule's direction; otherwise rollouts.toml is already at or past this
run's evidence and the entry is withheld. to < 1 is dropped and flagged. With no repo identity nothing is
proposed. Each rule's effect is a declared heuristic, RULE_EFFECTS (this header is the one copy of it):
  slot-bound-raise      serves throughput; risks tokensPerMerge, setAsideRate, conflictRate, quotaStalls,
                        reviewChurn
  quota-bound-lower     serves quotaStalls; risks throughput
  review-rounds-raise   serves handsOffRate; risks quality, throughput, tokensPerMerge, setAsideRate,
                        conflictRate, quotaStalls, reviewChurn
  plan-rejected-raise   serves handsOffRate; risks quality, throughput, tokensPerMerge, setAsideRate,
                        conflictRate, quotaStalls, reviewChurn
Review churn sits in every raise's risks: its absolute bound (p21-3) withheld any raise when it landed, and still does.
A rule missing from RULE_EFFECTS fails closed (UNDECLARED_EFFECT): it serves nothing and risks every Guardrail, so
any breach withholds its raise.
weigh(rule, measured) gives every proposal and withheld entry `serves`, `risks` and `trade`: {gains: the headlines
it serves, costs: the headlines it risks and does not serve}, only when both lists are non-empty and every headline
in them is scored (non-null); else null. p21-4 scores Quality (escapes.quality), so whenever both headlines are
scored this static table makes both round raises standing trades: whether they stay so (which takes two knob rules
out of ADR 0037 d5's unattended landing) or become evidence-based is Lachy's decision, still open. A Quality that
rests on fewer sources (`escapes.partial`) still names the trade. Withheld, in
this order: no settings, the sign, the lane hold, then a Guardrail: a raise (direction > 0) is withheld while a
Guardrail in its `risks` is breached, naming only those ("a raise while a Guardrail is breached: ..."), so a
slot-bound raise is never withheld by the Throughput it serves. A lower is never withheld by a Guardrail: when one it
risks is breached it stays in `proposals` with a `caution` ("risks <k>, breached (<value> against <bound>): a
Guardrail against a Guardrail, Lachy decides"). A `trade` or a `caution` is Lachy's call (ADR 0037 d1); each is null
otherwise. `ranAtCause`, when from != ranAt, is the
first of: a later non-voided Tuning of this key ("Tuning <id> moved it on <ts>"); a mid-window ceiling change;
round caps that differ across tasks; rollouts.toml's mtime after the first slot-taken; the note's value equal
to ranAt with rollouts.toml absent or older than the note's `captured` (local midnight): a rollout-note
override; the note now differing; else "unclear: rollouts.toml changed around schedule time". These are
inferred (the record stamps effective values with no source): a label changes the wording only, never whether
a proposal is made. `agreeing` counts earlier non-voided applied Tunings with the same repo, key, rule and
direction: an auto landing's entries (tune.py --auto, the weekly reading, p21-7) count like a pick's, a revert's rule
is `revert:<rule>`, so it never counts toward <rule>, and a close line's empty `applied` adds nothing. A round cap's
spread (a task override) is flagged only for a key a proposal uses.

Shared, at module level (bodies as the methods had them): load_tunings(base) and agreeing(tunings, repo, key, rule,
direction), read by tune.py's --auto and --revert; landed_from(merge_lines, since, until), read by
skills/reflect/scripts/reflect.py's Escapes sweep; and RULE_EFFECTS, whose risks tune.py --revert reads.

Escapes and Quality. The landed set is every task with a `merged` line in the window (read-only ones included; the
latest line wins, a later line with no pr keeping the earlier pr, two different prs flagged), keyed as `merges` is,
so escapes.landed == merges.count. escapes.py scores it: an Escape is a task note whose `fixes:` names a landed task,
a revert of its merge, or a later review finding against its lines, each read up to now (never bounded by --until,
so a re-score counts a late Escape against this rollout), deduped per landed task; Quality = 1 - Escapes / landed.
Its flags are prefixed `escapes: `; one that will not load leaves every source unread, flagged.

Output: one JSON object (stdout, or --out F): rollout, repo, host, window{since, until, activeStart, activeEnd,
partial}, runningTime{hours, excluded[{kind, start, end, hours, why}], excludedHours{kind: hours}}, merges, escapes
(escapes.py's block: count, landed, quality, partial, bySource, reviewDocs, reviewTrees, tasks, sources, ref, excluded),
throughput, handsOff{rate, landed, handsOff, tasks[{task, acts[{kind, at, detail}]}], byKind{answer, signOff,
retry, mergeHold, raceDecided}, notCounted{standingApproval, automaticHandBack, raceReverified}, baseline}, slots,
lane, guardrails{throughput{value, runningHours, tasks, allowanceHours, bound, baseline, breached}, tokensPerMerge,
setAsideRate, conflictRate, quotaStalls, reviewChurn{value | "unknown", bound "<=N%", baseline, breached,
roundsPerLandedTask}}, load, binding{constraint, why}, headline (the ten numbers tune.py records, its name kept for
tune.py: throughput, runningHours, merges, tokensPerMerge, setAsideRate, conflictRate, quotaStalls, handsOffRate,
quality (escapes.quality), reviewChurn (reviewChurn.value)), ranAt{parallel_ceiling, max_review_rounds, max_iterations,
max_plan_rounds} (each key's ran-at value, the proposals' rule, or null), reviewChurn{value, findings, original, regression,
unclassified, rounds, engine{rounds, findings, original, regression, unclassified, landedTasks (the landed tasks
with a recorded round), roundsPerLandedTask}, freshReview{rounds, findings, original, regression, unclassified,
unattributed}}, baseline{id, activeEnd, partial, v, scores}, proposals[{id, key, from, to, ranAt, ranAtCause, rule,
direction, evidence, agreeing, serves, risks, trade, caution}], withheld (the same plus reason), flags, thresholds.
stderr gets one summary line, led by `hands-off R (M of N)`.

Exit codes: 0 scored (a "no record" score included); 1 the record, the events directory, --settings or --note
cannot be read; 2 a usage error, a bad or reserved slug, or a bad TS.
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import math
import os
import pathlib
import re
import sys
import time
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
RUN_RECORD_PY = os.path.join(SKILLS, "_shared", "scripts", "run_record.py")
RECONCILE_PY = os.path.join(SKILLS, "execute", "scripts", "reconcile-rollout.py")
ROLLOUT_SETTINGS_PY = os.path.join(SKILLS, "_shared", "scripts", "rollout-settings.py")
ESCAPES_PY = os.path.join(HERE, "escapes.py")

HOUR = 3600 * 1000
MINUTE = 60 * 1000
# The named thresholds (heuristics: ADR 0032 leaves them to the first Reflections).
GRACE = 30 * MINUTE              # a call's end (or last activity) + this is its Slot's latest effective end
LANE_ONLY_CAP = 2 * HOUR         # a lane-only stretch (no Slot, no hold) counts as running for at most this
SLOT_BOUND_FULL = 0.5            # Slots full this share of running time -> slot-bound
LANE_BOUND_BUSY = 0.8            # lane held this share of running time -> lane-bound
LANE_FREE_FOR_RAISE = 0.6        # a ceiling raise needs the lane under this share busy
WAIT_CLIMB_RATIO = 2.0           # last third's mean wait over this times the first third's ...
WAIT_CLIMB_MIN = 10.0            # ... and at least this many minutes -> waits climbing
DEPENDENCY_IDLE = 0.5            # idle Slot time this share of capacity -> dependency-bound (with that reason largest)
QUOTA_STALLS = 1                 # this many quota stalls -> quota-bound
TRICKLE_BOUND = 0.5              # the Mac-wide cap kept Slots free this share of the time -> trickle-bound
HOLD_MARKER_SPAN = 40 * MINUTE   # a Mac-wide hold marker labels no-Slot-open time this long at most (two */20 ticks)
ROUND_SET_ASIDES = 2             # this many review-rounds (plan-rejected) set-asides -> a round cap +1
EVIDENCE_MAX = 300
# rollout-settings.py's GUARDRAILS_BUILT_IN; review_churn_pct (p21-3) is Review churn's absolute bound, hours_per_task
# (p21-2) Throughput's.
GUARDRAILS_BUILT_IN = {"tokens_per_merge_pct": 25, "set_aside_rate_points": 5, "conflict_rate_points": 10,
                       "quota_stalls": 0, "review_churn_pct": 40, "hours_per_task": 1.5}
KEYS = ("parallel_ceiling", "max_review_rounds", "max_iterations", "max_plan_rounds")
# The human acts' kinds (run_record.py's "Human acts"): never a task's call activity (pair keeps them out of last_line).
ACT_KINDS = ("answer-recorded", "gate-signed", "handed-back", "race-decided")
# The night record's kinds (p28-2, run_record.py; reconcile-rollout.py's NIGHT_KINDS): `next`'s reading of a Morning,
# written at a later call, so never a task's call activity nor the record's last line (pair skips them).
NIGHT_KINDS = ("away-night", "last-start-held", "ran-past-morning")
# The time-lost ledger's kinds (p29-10, ADR 0051; run_record.py): stops, entries, suites and why main moved. Never scored:
# every line of these kinds is dropped as it is read, so a score is byte-equal with or without them, and a late one never
# extends a record's live span; reflect.py's Time-lost ledger (ledger.py, p29-11) reads them, a score never does.
LEDGER_KINDS = ("stopped", "lead-entry", "suite-started", "suite-ended", "base-moved")
ACT_NAMES = ("answer", "signOff", "retry", "mergeHold", "raceDecided")
MERGE_HOLD_DETAIL = "a --gated or exit-7 hold: the record carries no reason"
# The two headlines (ADR 0037 d1) and each proposal rule's declared effect: (serves, risks). A heuristic (the header).
HEADLINES = ("handsOffRate", "quality")
OLD_GUARDRAILS = ("tokensPerMerge", "setAsideRate", "conflictRate", "quotaStalls")
GUARDRAILS = ("throughput",) + OLD_GUARDRAILS + ("reviewChurn",)  # guardrails()' keys, in its order
# Review churn is in every raise's risks: its absolute bound (p21-3) withheld any raise when it landed, and still does.
RULE_EFFECTS = {
    "slot-bound-raise": (("throughput",), OLD_GUARDRAILS + ("reviewChurn",)),
    "quota-bound-lower": (("quotaStalls",), ("throughput",)),
    "review-rounds-raise": (("handsOffRate",), ("quality", "throughput") + OLD_GUARDRAILS + ("reviewChurn",)),
    "plan-rejected-raise": (("handsOffRate",), ("quality", "throughput") + OLD_GUARDRAILS + ("reviewChurn",)),
}
# A rule missing from RULE_EFFECTS fails closed: it serves nothing and risks every Guardrail, so any breach withholds
# its raise, as every breach withheld every raise before p21-2 weighed effects, instead of none.
UNDECLARED_EFFECT = ((), GUARDRAILS)
# The Mac-wide holds (execute away.md; _idle_reason's reasons): an idle-slots reason -> its excluded kind and why. A
# stretch with no Slot open that one of these marks is a meant wait on the Mac-wide cap, never a wait on Lachy, nor idle.
# p28-7 adds hold-last-start here.
MAC_HOLDS = {
    "hold-trickle": ("hold-trickle", "a row waits on the Trickle, the Mac-wide cap by day: a meant wait, not Lachy's"),
    "hold-away-cap": ("hold-away-cap", "the Away cap holds it while Away (ADR 0049)"),
    "hold-heat": ("hold-heat", "the Heat hold: the Mac is too hot to start anything (estate ADR 0009 d5)"),
}
# The Mac-wide holds that bind as trickle-bound (the one Mac-wide cap, its value by Away state); Heat is transient.
CAP_HOLDS = ("hold-trickle", "hold-away-cap")
HOLD_WHY = {"merge": "a merge hold with no Slot open (a --gated or exit-7 hold: a wait on Lachy)",
            "race": "a RACE hold with no Slot open (an undecided RACE or its re-verify: a wait on Lachy)",
            "git-env": "a git-env hold with no Slot open (an unacked canary trip: a wait on Lachy)"}


def human_act(kind, d):
    """(name, detail) when a record line of an ACT_KINDS kind is a human act (the header's Acts), else None. A merge
    hold is paired from its hold lines, so it is no single line's act. hands_off() reads it for the window's landed
    tasks; reflect.py's span reads it for every task, landed or not."""
    if kind == "answer-recorded":
        how = [x for x in (d.get("form"), "raise %s" % d["raise"] if d.get("raise") else None,
                           "pr" if d.get("pr") is True else None) if x]
        return "answer", "%s answer%s" % (d.get("answerKind"), " (%s)" % "; ".join(how) if how else "")
    if kind == "gate-signed" and d.get("standing") is not True:
        return "signOff", "%s gate(s) signed off" % d.get("gates")
    if kind == "handed-back" and d.get("via") == "retry":
        return "retry", "handed back with no answer (%s arm)" % d.get("arm")
    if kind == "race-decided":
        return "raceDecided", "%s decided, acted on by %s" % (d.get("mark"), d.get("by"))
    return None


class Usage(Exception):
    pass


class Unreadable(Exception):
    pass


def _load(name, path):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", RUN_RECORD_PY)


# ---- time ----------------------------------------------------------------------------------------------------

def to_ms(stamp):
    """A UTC Z stamp as written by run_record (or any _stamp-accepted one) -> epoch ms. Refused -> RR.Refused."""
    canon = RR._stamp(stamp)
    dt = datetime.datetime.strptime(canon[:-1], "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=datetime.timezone.utc)
    return int(round(dt.timestamp() * 1000))


def _release(t, d):
    """A slot-freed line's release: its `reconciledAt` when reconcile stamped the line at its call's end (p29-12) and
    released the Slot later, else its ts. An unreadable reconciledAt reads as the ts."""
    try:
        return max(t, to_ms(d["reconciledAt"])) if isinstance(d.get("reconciledAt"), str) else t
    except Exception:
        return t


def fmt(ms):
    if ms is None:
        return None
    dt = datetime.datetime.fromtimestamp(ms / 1000.0, tz=datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (dt.microsecond // 1000)


def hours(ms):
    return round(ms / HOUR, 3)


# ---- intervals (lists of (start, end) in ms, end > start) ----------------------------------------------------

def union(iv):
    out = []
    for a, b in sorted(x for x in iv if x[1] > x[0]):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def intersect(xs, ys):
    xs, ys, out, i, j = union(xs), union(ys), [], 0, 0
    while i < len(xs) and j < len(ys):
        a, b = max(xs[i][0], ys[j][0]), min(xs[i][1], ys[j][1])
        if b > a:
            out.append((a, b))
        if xs[i][1] < ys[j][1]:
            i += 1
        else:
            j += 1
    return out


def subtract(xs, ys):
    out = []
    ys = union(ys)
    for a, b in union(xs):
        cur = a
        for c, d in ys:
            if d <= cur or c >= b:
                continue
            if c > cur:
                out.append((cur, c))
            cur = max(cur, d)
            if cur >= b:
                break
        if cur < b:
            out.append((cur, b))
    return out


def total(iv):
    return sum(b - a for a, b in union(iv))


# ---- reading -------------------------------------------------------------------------------------------------

def load_tunings(base):
    """Every `tuning` line of <base>/tunings.jsonl with a string repo, in time then file order, each a copy carrying
    `_t` (its ts in ms) and `_voided` (another line's `voids` names it). [] with no file; OSError when it exists but
    cannot be read. Shared with tune.py (--auto, --revert)."""
    path = os.path.join(base, RR.TUNINGS + ".jsonl")
    out = []
    if not os.path.exists(path):
        return out
    lines, _skipped = read_lines(path)
    voided = {d.get("voids") for _t, _n, d in lines if d.get("kind") == "tuning" and isinstance(d.get("voids"), str)}
    for t, _n, d in lines:
        if d.get("kind") != "tuning" or not isinstance(d.get("repo"), str):
            continue
        d = dict(d)
        d["_t"] = t
        d["_voided"] = d.get("id") in voided
        out.append(d)
    return out


def agreeing(tunings, repo, key, rule, direction):
    """Earlier non-voided applied Tunings (load_tunings' lines) with the same repo (case ignored), key, rule and
    direction. A pick's entries and an auto landing's count alike; a revert's rule is `revert:<rule>`, so it never
    counts toward <rule>; a close line's `applied` is [], so it adds nothing. Shared with tune.py."""
    n = 0
    for d in tunings:
        if d["_voided"] or d["repo"].lower() != repo.lower():
            continue
        for e in d.get("applied") or []:
            if not isinstance(e, dict) or e.get("key") != key or e.get("rule") != rule:
                continue
            if isinstance(e.get("to"), int) and isinstance(e.get("from"), int) and \
                    _sign(e["to"] - e["from"]) == direction:
                n += 1
    return n


def landed_from(merge_lines, since, until):
    """({task: {pr, readOnly, at}}, flags) for every task with a `merged` line in [since, until] (ms), from
    (t, task, pr, readOnly) tuples in time order: the latest line wins, a later line with no pr keeping the earlier
    one, and two different prs for one task are flagged. Shared with reflect.py (the Escapes sweep)."""
    out, prs, flags = {}, {}, []
    for t, task, pr, read_only in merge_lines:
        if not since <= t <= until:
            continue
        if pr not in (None, ""):
            prs.setdefault(task, set()).add(str(pr).rstrip("/").rsplit("/", 1)[-1].lstrip("#"))
        prev = out.get(task, {})
        out[task] = {"pr": pr if pr not in (None, "") else prev.get("pr"), "readOnly": read_only, "at": fmt(t)}
    for task in sorted(prs):
        if len(prs[task]) > 1:
            flags.append("escapes: [[%s]]'s merged lines carry %d different prs (%s): the latest is read"
                         % (task, len(prs[task]), ", ".join(sorted(prs[task]))))
    return out, flags


def read_lines(path):
    """[(ms, n, dict)] sorted by time then file order; unparsable lines (and ones with no valid ts) skipped."""
    out, skipped = [], 0
    with open(path, "rb") as f:
        for n, raw in enumerate(f):
            try:
                d = json.loads(raw)
                t = to_ms(d["ts"])
            except Exception:
                skipped += 1
                continue
            if isinstance(d, dict):
                out.append((t, n, d))
            else:
                skipped += 1
    out.sort(key=lambda x: (x[0], x[1]))
    return out, skipped


def _settings_value(settings, key):
    if not isinstance(settings, dict):
        return None
    v = settings.get(key)
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 1 else None


def _sign(x):
    return (x > 0) - (x < 0)


def weigh(rule, measured):
    """A rule's declared effect (RULE_EFFECTS) and its trade: {serves, risks, trade}. trade is {gains: the headlines it
    serves, costs: the headlines it risks and does not serve} only when both are non-empty and every one of them is
    scored in `measured` ({headline: value or None}); else None. A rule RULE_EFFECTS does not declare is
    UNDECLARED_EFFECT (fail closed). Pure."""
    serves, risks = RULE_EFFECTS.get(rule, UNDECLARED_EFFECT)
    gains = [h for h in serves if h in HEADLINES]
    costs = [h for h in risks if h in HEADLINES and h not in serves]
    trade = None
    if gains and costs and all(measured.get(h) is not None for h in gains + costs):
        trade = {"gains": gains, "costs": costs}
    return {"serves": list(serves), "risks": list(risks), "trade": trade}


def _breach(k, g):
    """One breached Guardrail as a withheld reason names it."""
    if k == "throughput":
        return "throughput %s running h against %s h (%s, %d task(s))" % (g["runningHours"], g["allowanceHours"],
                                                                         g["bound"], g["tasks"])
    return "%s %s (baseline %s, bound %s)" % (k, g["value"], g["baseline"], g["bound"])


def _caution(hit, guard):
    """A lower's caution: the breached Guardrails it risks, for Lachy to weigh (a Guardrail against a Guardrail)."""
    parts = []
    for k in hit:
        g = guard[k]
        if k == "throughput":
            got, bound = "%s running h" % g["runningHours"], "%s h, %s" % (g["allowanceHours"], g["bound"])
        else:
            got, bound = g["value"], g["bound"]
        parts.append("%s, breached (%s against %s)" % (k, got, bound))
    return "risks %s: a Guardrail against a Guardrail, Lachy decides" % "; ".join(parts)


def _counts(d):
    """(findings, original, regression) of a review line when all three are ints >= 0 and original + regression <=
    findings, else None."""
    vals = [d.get(k) for k in ("findings", "original", "regression")]
    if any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in vals) or vals[1] + vals[2] > vals[0]:
        return None
    return tuple(vals)


def _churn_over(regression, findings, bound_pct):
    """regression / findings above bound_pct %, decided from the integer sums: the rounded fraction is no test
    (11/20 * 100 is 55.00000000000001, over a 55 bound; 4-place rounding can hide a breach just over one). A float
    bound is read as the decimal it prints as, so 14.1 is 141/10."""
    finite = not (isinstance(bound_pct, float) and not math.isfinite(bound_pct))
    bound = Fraction(str(bound_pct)) if finite else bound_pct
    return regression * 100 > bound * findings


def guardrail_bounds(settings):
    """The [guardrails] bounds: each built-in, overridden by --settings' numeric value (a boolean refused)."""
    bounds = dict(GUARDRAILS_BUILT_IN)
    g = (settings or {}).get("guardrails")
    if isinstance(g, dict):
        for k in bounds:
            v = g.get(k, {}).get("value") if isinstance(g.get(k), dict) else None
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                bounds[k] = v
    return bounds


class Score:
    def __init__(self, args, env=None):
        self.args = args
        self.flags = []
        self.env = os.environ if env is None else env
        self.origins = {}  # a review-round's repo path -> its GitHub owner/name, or None (review churn)
        self.rs = None     # rollout-settings.py, loaded on the first review-round path

    def flag(self, text):
        if text not in self.flags:
            self.flags.append(text)

    # ---- the record ------------------------------------------------------------------------------------------

    def pair(self, lines, until):
        """Walk the record's lines up to `until` with run_record's reader rules."""
        self.slots, open_slot = [], {}
        self.holdings, lane = [], None
        # ADR 0064: each task's latest holding, and whether a merged, set-aside or from-file carried line came after
        # its end (so the next holding starts a new Integration)
        self.origin_waits, latest, broke = [], {}, {}

        def ends_integration(task):
            if task in latest and latest[task]["end"] is not None:
                broke[task] = True
        self.holds, open_holds = [], {}
        self.pauses, pause = [], None
        self.steps, self.markers, self.merges, self.readies = [], [], [], []
        self.merge_lines = []  # (t, task, pr, readOnly) of every merged line, for the Escapes' landed set
        self.set_asides, self.stalls, self.bound, self.slot_taken = [], [], [], []
        self.journals, self.last_line, self.task_lines = {}, {}, {}
        self.acts, self.hand_back_starts = [], []
        self.verdict_lines, self.read_only = [], set()  # p21-3: review-verdict (n, t, task, d); read-only merges
        last_t = None
        for t, n, d in lines:
            kind, task = d.get("kind"), d.get("task")
            if kind == "call-journal" and isinstance(d.get("runId"), str):
                # read whatever its ts: fold-journals stamps the fold time (completion, or the Reflection's start), not
                # the call's; the call's own startTime and durationMs are clamped to --until in slot_ends
                prev = self.journals.get(d["runId"])
                if prev is None or prev.get("status") not in RR.TERMINAL_STATUSES or \
                        d.get("status") in RR.TERMINAL_STATUSES:
                    self.journals[d["runId"]] = d
                continue
            if kind == "review-verdict":
                # reconcile writes these with the row's other events: read for Review churn only, never as a task's
                # activity (last_line) or the record's last line
                if t <= until and task:
                    self.verdict_lines.append((n, t, task, d))
                continue
            if kind in NIGHT_KINDS:
                # p28-2: a ran-past-morning line names a task whose Slot was open at a Morning, written at a later
                # `next` call: an observation after the fact, never activity of that task's call (an untimed call's
                # last_line, its never-finished cap) or the record's last line, as a review-verdict line is not
                continue
            if t > until:
                continue
            last_t = t
            if task and kind not in ACT_KINDS:  # a human act is no activity of the task's call
                self.last_line[task] = t
                self.task_lines.setdefault(task, []).append((t, kind))
            if task and (kind in ACT_KINDS or kind == "auto-retry"):
                self.acts.append((t, kind, task, d))
            settings = d.get("settings")
            if kind in ("slot-taken", "idle-slots") and _settings_value(settings, "parallel_ceiling") and \
                    (not self.steps or self.steps[-1][1] != settings["parallel_ceiling"]):
                self.steps.append((t, settings["parallel_ceiling"]))  # a change only (lines arrive in time order)
            if kind == "slot-taken" and task:
                self.slot_taken.append((t, task, settings if isinstance(settings, dict) else {}))
                if d.get("start") == "hand-back":
                    self.hand_back_starts.append((t, task))
                if task not in open_slot:
                    s = {"task": task, "start": t, "end": None, "outcome": None}
                    open_slot[task] = s
                    self.slots.append(s)
            elif kind == "slot-freed" and task in open_slot:
                s = open_slot.pop(task)
                s["end"], s["outcome"] = t, d.get("outcome")
                s["release"] = _release(t, d)
            elif kind == "carried" and task and d.get("rollout") == d.get("from"):
                ends_integration(task)
                if task in open_slot:
                    s = open_slot.pop(task)
                    s["end"], s["outcome"] = t, "carried"
                    s["release"] = t
                if lane is not None and lane["task"] == task:
                    lane["end"], lane = t, None
                for key in [k for k in open_holds if k[1] == task]:
                    open_holds.pop(key)["end"] = t
            elif kind == "lane-taken" and task:
                if lane is not None and lane["task"] != task:
                    lane["end"] = t
                    self.flag("lane: [[%s]]'s holding ended unrecorded when [[%s]] took the lane at %s"
                              % (lane["task"], task, fmt(t)))
                    lane = None
                if lane is None:
                    lane = {"task": task, "start": t, "end": None, "release": None, "conflict": False, "path": None}
                    prev = latest.get(task)
                    if prev is not None and prev["release"] == "origin" and prev["end"] is not None and \
                            not broke.get(task):
                        lane.update(cont=True, first=prev.get("first", prev))
                        self.origin_waits.append((prev["end"], t, task))
                    latest[task], broke[task] = lane, False
                    self.holdings.append(lane)
            elif kind == "lane-freed" and task:
                if lane is not None and lane["task"] == task:
                    lane.update(end=t, release=d.get("release"), conflict=d.get("conflict") is True,
                                path=d.get("path"))
                    lane = None
                if ("merge", task) in open_holds:
                    open_holds.pop(("merge", task))["end"] = t
            elif kind == "hold-started":
                key = (d.get("hold"), task)
                if key not in open_holds:
                    h = {"hold": key[0], "task": task, "start": t, "end": None}
                    open_holds[key] = h
                    self.holds.append(h)
            elif kind == "hold-ended":
                key = (d.get("hold"), task)
                if key in open_holds:
                    open_holds.pop(key)["end"] = t
            elif kind == "paused":
                if pause is None:
                    pause = {"mode": d.get("mode"), "start": t, "end": None}
                    self.pauses.append(pause)
            elif kind == "resumed":
                if pause is not None:
                    pause["end"], pause = t, None
            elif kind == "idle-slots":
                self.markers.append((t, d.get("reason")))
            elif kind == "merged" and task:
                ends_integration(task)
                self.merges.append((t, task))
                self.merge_lines.append((t, task, d.get("pr"), d.get("readOnly") is True))
                if d.get("readOnly") is True:
                    self.read_only.add(task)
            elif kind == "ready" and task:
                self.readies.append((t, task))
            elif kind == "set-aside" and task:
                ends_integration(task)
                self.set_asides.append((t, task, d.get("reasonClass")))
            elif kind == "quota-stall":
                self.stalls.append(t)
            elif kind == "run-bound" and task and isinstance(d.get("runId"), str):
                self.bound.append((t, task, d["runId"], d.get("call")))
        self.last_t = last_t
        end = min(until, last_t) if last_t is not None else until
        if lane is not None:
            lane["end"] = end
            self.flag("lane: [[%s]] still holds it at the last line read (%s): its holding ends there"
                      % (lane["task"], fmt(end)))
        for h in open_holds.values():
            h["end"] = end
            self.flag("%s hold%s still open at the last line read (%s): it ends there"
                      % (h["hold"], " for [[%s]]" % h["task"] if h["task"] else "", fmt(end)))
        if pause is not None:
            pause["end"] = end
            self.flag("a %s pause still open at the last line read (%s): it ends there" % (pause["mode"], fmt(end)))

    def slot_ends(self, until):
        """Each Slot's active intervals from every call bound to it, the gaps it leaves, and whether the window is
        partial."""
        self.partial = False
        self.gaps = []  # (kind, why, (a, b))
        for s in self.slots:
            hi = s.get("release", s["end"]) if s["end"] is not None else until
            calls = [b for b in self.bound if b[1] == s["task"] and s["start"] <= b[0] <= hi and b[3] != "integrate"]
            who = "[[%s]]" % s["task"]
            if not calls:
                end = self._last_call(s, None, hi, until, who)
                s["iv"] = [(s["start"], max(s["start"], end))]
                continue
            starts = [self._call_start(c, s["start"], hi) for c in calls]
            iv = [(s["start"], starts[0])]  # the lead's set-up before the first call counts
            for i, call in enumerate(calls):
                if i + 1 < len(calls):
                    end = self._earlier_call(s, call, starts[i], calls[i + 1], starts[i + 1], until, who)
                else:
                    end = self._last_call(s, call, hi, until, who)
                iv.append((starts[i], max(starts[i], end)))
            s["iv"] = union(iv) or [(s["start"], s["start"])]

    def _call_start(self, call, lo, hi):
        st = (self.journals.get(call[2]) or {}).get("startTime")
        t = st if isinstance(st, int) and not isinstance(st, bool) else call[0]
        return min(max(t, lo), hi)

    def _timing(self, call):
        """(journal, terminal, end) for a call, end = startTime + durationMs (None when either is missing)."""
        j = self.journals.get(call[2]) if call else None
        st, dur = (j or {}).get("startTime"), (j or {}).get("durationMs")
        timed = isinstance(st, int) and isinstance(dur, int) and not isinstance(st, bool) and not isinstance(dur, bool)
        return j, j is not None and j.get("status") in RR.TERMINAL_STATUSES, (st + dur) if timed else None

    def _earlier_call(self, s, call, start, nxt, nxt_start, until, who):
        """An earlier call of a Slot a later call re-took (a restart after a dead lead): it covers its start to its
        end (terminal) or last activity (not), plus GRACE, at most to the next call's start; the rest is a gap."""
        j, terminal, end = self._timing(call)
        if j is None or end is None and terminal:
            self.flag("call %s (%s) has %s: it runs to the next call %s's start"
                      % (call[2], who, "no call journal" if j is None else "no startTime or durationMs", nxt[2]))
            return nxt_start
        if end is None:
            # not terminal and untimed: the task's last line before the next call (a re-take is not activity)
            seen = [t for t, k in self.task_lines.get(s["task"], [])
                    if call[0] <= t < nxt[0] and k not in ("slot-taken", "run-bound")]
            end = max(seen) if seen else start
            self.flag("call %s has no durationMs: %s's last activity in it is its last record line (%s)"
                      % (call[2], who, fmt(end)))
        end = min(end, until)
        cap = end + GRACE
        if cap < nxt_start:
            if terminal:
                why = "%s's call %s ended at %s; the next call %s started at %s (lead absent)" % (
                    who, call[2], fmt(end), nxt[2], fmt(nxt_start))
                self.gaps.append(("lead-absent", why, (cap, nxt_start)))
                self.flag("lead absent: " + why)
            else:
                why = "call %s never finished: its last activity was %s; %s re-took %s's Slot at %s" % (
                    call[2], fmt(end), nxt[2], who, fmt(nxt_start))
                self.gaps.append(("never-finished", why, (cap, nxt_start)))
                self.flag(why)
        return min(cap, nxt_start)

    def _last_call(self, s, call, hi, until, who):
        """The Slot's last call (or none): its end is the Slot's effective end. Activity is clamped to --until."""
        j, terminal, end = self._timing(call)
        if terminal and end is not None and end > until:
            terminal = False  # still running at --until: read it as a call whose last activity is --until
        if terminal and end is not None:
            cap = end + GRACE
            if cap < hi:
                self.gaps.append(("lead-absent", "%s's call %s ended at %s; its Slot stayed open (lead absent)"
                                  % (who, call[2], fmt(end)), (cap, hi)))
                self.flag("lead absent: %s's call %s ended at %s but its Slot stayed open until %s"
                          % (who, call[2], fmt(end), fmt(hi)))
            return min(hi, cap)
        if j is None and s["end"] is not None:
            self.flag("no call journal for %s: its Slot ends at its slot-freed" % who)
            return s["end"]
        if terminal:
            self.flag("call %s's journal has no startTime or durationMs: %s's Slot ends at its slot-freed"
                      % (call[2], who))
            if s["end"] is not None:
                return s["end"]
            return self._tail(s, call, until, who)
        if end is not None:
            last = min(end, until)
        else:
            last = self.last_line.get(s["task"], s["start"])
            if j is not None:
                self.flag("call %s has no durationMs: %s's last activity is its last record line (%s)"
                          % (call[2], who, fmt(last)))
        cap = last + GRACE
        if s["end"] is not None:
            if cap < s["end"]:
                self._capped(call, who, last, cap, s["end"])
            return min(s["end"], cap)
        if cap >= until:
            self.partial = True
            return until
        self._capped(call, who, last, cap, until)
        return cap

    def _tail(self, s, call, until, who):
        last = self.last_line.get(s["task"], s["start"])
        cap = last + GRACE
        if cap >= until:
            self.partial = True
            return until
        self._capped(call, who, last, cap, until)
        return cap

    def _capped(self, call, who, last, cap, hi):
        name = ("call %s" % call[2]) if call else "%s's Slot (no call bound)" % who
        self.flag("%s never finished: capped at last activity + %d min (%s)" % (name, GRACE // MINUTE, fmt(cap)))
        self.gaps.append(("never-finished", "%s never finished: its last activity was %s" % (name, fmt(last)),
                          (cap, hi)))

    # ---- running time ----------------------------------------------------------------------------------------

    def running(self, since, until):
        win = [(since, until)]
        slot_iv = union(x for s in self.slots for x in s["iv"])
        lane_iv = union((h["start"], h["end"]) for h in self.holdings)
        hold_iv = union((h["start"], h["end"]) for h in self.holds)
        pause_iv = union((p["start"], p["end"]) for p in self.pauses)
        lane_only, over_cap = [], []
        for h in self.holdings:  # each holding's stretches with no Slot, hold or pause, capped one by one
            for a, b in subtract([(h["start"], h["end"])], hold_iv + slot_iv + pause_iv):
                lane_only.append((a, min(b, a + LANE_ONLY_CAP)))
                if b > a + LANE_ONLY_CAP:
                    over_cap.append((a + LANE_ONLY_CAP, b))
        active = union(slot_iv + lane_only)
        self.run_iv = subtract(intersect(active, win), pause_iv)
        self.slot_iv, self.lane_iv = slot_iv, lane_iv
        self.segs = self.idle_segments(since, until)
        # label every excluded stretch, first matching kind wins
        labels = []
        for p in self.pauses:
            labels.append(("paused", "a %s pause" % (p["mode"] or "recorded"), (p["start"], p["end"])))
        for h in self.holds:
            labels.append(("hold-%s" % h["hold"], HOLD_WHY.get(h["hold"], "a hold with no Slot open")
                           + (" ([[%s]])" % h["task"] if h["task"] else ""), (h["start"], h["end"])))
        labels.extend(g for g in self.gaps if g[0] == "lead-absent")
        labels.extend(g for g in self.gaps if g[0] == "never-finished")
        for iv in over_cap:
            labels.append(("lane-only-over-cap", "the lane held with no Slot or hold open past %d h"
                           % (LANE_ONLY_CAP // HOUR), iv))
        rest = subtract(win, self.run_iv)
        labels.extend(self._mac_hold_labels(rest, until))
        excluded = []
        for kind, why, iv in labels:
            for a, b in intersect(rest, [iv]):
                excluded.append({"kind": kind, "start": a, "end": b, "why": why})
            rest = subtract(rest, [iv])
        for a, b in rest:
            excluded.append({"kind": "idle", "start": a, "end": b,
                             "why": "nothing ran: a halt, a hand-back wait, or before the first Slot or after the last"})
        excluded.sort(key=lambda e: e["start"])
        by_kind = {}
        for e in excluded:
            by_kind[e["kind"]] = by_kind.get(e["kind"], 0) + e["end"] - e["start"]
        self.excluded = [{"kind": e["kind"], "start": fmt(e["start"]), "end": fmt(e["end"]),
                          "hours": hours(e["end"] - e["start"]), "why": e["why"]} for e in excluded]
        self.excluded_hours = {k: hours(v) for k, v in sorted(by_kind.items())}
        self._excluded_ms = [(e["kind"], e["start"], e["end"]) for e in excluded]  # raw, for binding()'s trickle-bound
        self.run_ms = total(self.run_iv)

    def _mac_hold_labels(self, rest, until):
        """The Mac-wide holds' labels (MAC_HOLDS), after every other kind, so a pause or a hold wins: a marker at t
        labels [t, e), e the earliest of the next idle-slots marker (any reason), t + HOLD_MARKER_SPAN and --until, so a
        dead lead, who writes no markers, reads idle past the span. A not-running stretch (of `rest`) whose first marker
        is a Mac-wide hold within HOLD_MARKER_SPAN of its start takes that label from its start (slots_score's "the first
        marker labels its idle span from the start"), unless another reason is in force at its start: the reason
        idle_segments gives the running segment it follows (a marker's reason holds until a change of reason, a stop or
        full Slots), so a queue-tail before the stop is never back-filled as the Trickle; the same Mac-wide reason
        there, or none, back-fills."""
        markers = sorted(self.markers)
        in_force = {b: r for _a, b, _run, _n, _c, r in self.segs if r != "unexplained"}  # segment end -> its reason
        out = []
        for i, (t, r) in enumerate(markers):
            if r not in MAC_HOLDS:
                continue
            e = min([t + HOLD_MARKER_SPAN, until] + [u for u, _r in markers[i + 1:] if u > t][:1])
            if e > t:
                kind, why = MAC_HOLDS[r]
                out.append((kind, why, (t, e)))
        for a, b in rest:
            first = next(((t, r) for t, r in markers if a <= t < b), None)
            if (first and first[1] in MAC_HOLDS and a < first[0] <= a + HOLD_MARKER_SPAN
                    and in_force.get(a) in (None, first[1])):
                kind, why = MAC_HOLDS[first[1]]
                out.append((kind, why, (a, first[0])))
        merged = {}  # one label per kind, its pieces unioned, so back-to-back ticks read as one excluded span
        for kind, why, iv in out:
            merged.setdefault(kind, (why, []))[1].append(iv)
        return [(kind, why, x) for kind, (why, ivs) in merged.items() for x in union(ivs)]

    # ---- Slots -----------------------------------------------------------------------------------------------

    def ceiling_at(self, t):
        if not self.steps:
            return None
        v = self.steps[0][1]
        for st, val in self.steps:
            if st <= t:
                v = val
            else:
                break
        return v

    def idle_segments(self, since, until):
        """The window's segments, each with the reason labelling its free Slots (the header's Scores: Slots): [(a, b,
        running ms, Slots open, ceiling in force, reason)], cut at every Slot interval's ends, ceiling step, idle-slots
        marker and running interval's end in [since, until]. A running segment with a free Slot takes the reason in
        force there: the last marker's, held across such segments until a change of reason, the first marker of an
        idle span labelling it from the span's start; "unexplained" where no marker reaches. Every other segment (not
        running, the Slots full, or before any ceiling) has reason None, and one not running or full ends the span and
        its reason. running() keeps them (self.segs): _mac_hold_labels reads the reason in force where a stretch stops
        running, slots_score totals them."""
        cuts = {since, until}
        for s in self.slots:
            for x, y in s["iv"]:
                cuts.update((x, y))
        cuts.update(t for t, _ in self.steps)
        cuts.update(t for t, _ in self.markers)
        for a, b in self.run_iv:
            cuts.update((a, b))
        cuts = sorted(c for c in cuts if since <= c <= until)
        segs = []
        for a, b in zip(cuts, cuts[1:]):
            if b <= a:
                continue
            running = total(intersect([(a, b)], self.run_iv))
            n = sum(1 for s in self.slots if any(x <= a and y >= b for x, y in s["iv"]))
            segs.append([a, b, running, n, self.ceiling_at(a), None])
        markers = sorted(self.markers)
        span, label = [], None  # the open idle span's segments awaiting a reason, and the reason in force

        def close_span():
            for seg in span:
                seg[5] = "unexplained"
            span.clear()

        for seg in segs:
            a, b, running, n, c, _r = seg
            if c is None:
                continue
            if running == 0 or n >= c:
                close_span()
                label = None
                continue
            for r in [r for t, r in markers if a <= t < b]:
                if label is None:
                    for x in span:
                        x[5] = r
                    span.clear()
                label = r
            if label is None:
                span.append(seg)
            else:
                seg[5] = label
        close_span()
        return [tuple(seg) for seg in segs]

    def slots_score(self, since, until):
        weight, last_seen = {}, {}
        full = used = cap = 0
        idle, idle_ms = {}, {}  # each reason's idle Slot-ms, and the running ms it is in force with a Slot free
        for a, _b, running, n, c, reason in self.segs:
            if c is None:
                continue
            weight[c] = weight.get(c, 0) + running
            if running:
                last_seen[c] = a
            used += min(n, c) * running
            cap += c * running
            if n >= c:
                full += running
            if reason is not None:
                idle[reason] = idle.get(reason, 0) + (c - n) * running
                idle_ms[reason] = idle_ms.get(reason, 0) + running
        ran_at = None
        if weight:
            ran_at = max(weight, key=lambda v: (weight[v], last_seen.get(v, -1)))
        in_window = [(t, v) for t, v in self.steps if since < t <= until]
        prev = self.ceiling_at(since)
        changes = []
        for t, v in in_window:
            if prev is not None and v != prev:
                changes.append((prev, v, t))
            prev = v
        self.ceiling_changes = changes
        for x, y, t in changes:
            self.flag("ceiling changed mid-window %d → %d at %s (a note or task override): split with "
                      "--since/--until" % (x, y, fmt(t)))
        rt = self.run_ms
        idle_total = sum(idle.values())
        self.slot_metrics = {
            "ceiling": ran_at,
            "ceilingSteps": [{"at": fmt(t), "value": v} for t, v in self.steps if t <= until],
            "fullShare": round(full / rt, 4) if rt and ran_at is not None else None,
            "utilisation": round(used / cap, 4) if cap else None,
            "slotHours": hours(used),
            "capacityHours": hours(cap),
            "idleShare": round(idle_total / cap, 4) if cap else None,
            "idleHours": {k: hours(v) for k, v in sorted(idle.items())},
            "taken": sum(1 for t, _task, _s in self.slot_taken if since <= t <= until),
            "closed": sum(1 for s in self.slots if s["end"] is not None and since <= s["end"] <= until
                          and s["outcome"] != "carried"),
        }
        self.idle, self.idle_ms, self.idle_total, self.capacity = idle, idle_ms, idle_total, cap

    # ---- the lane ----------------------------------------------------------------------------------------------

    def lane_score(self, since, until):
        rt = self.run_ms
        busy = total(intersect(self.lane_iv, self.run_iv))
        # One Integration per holding that continues no origin yield (ADR 0064); its conflict and path are its last
        # holding's, the one its re-takes end on.
        started = [h for h in self.holdings if not h.get("cont") and since <= h["start"] <= until]
        last_of = {id(h): h for h in started}
        for h in self.holdings:
            if h.get("cont") and id(h["first"]) in last_of:
                last_of[id(h["first"])] = h
        waits = []
        for t, task in self.readies:
            if not since <= t <= until:
                continue
            nxt = [h["start"] for h in self.holdings if h["task"] == task and h["start"] >= t]
            if nxt:
                waits.append(round((min(nxt) - t) / MINUTE, 1))
        third = len(waits) // 3
        first = last = None
        climbing = False
        if third >= 1:
            first = round(sum(waits[:third]) / third, 1)
            last = round(sum(waits[-third:]) / third, 1)
            climbing = last > WAIT_CLIMB_RATIO * first and last >= WAIT_CLIMB_MIN
        freed = [last_of[id(h)] for h in started if last_of[id(h)]["end"] is not None]
        self.integrations = len(started)
        self.lane_metrics = {
            "busyShare": round(busy / rt, 4) if rt else None,
            "busyHours": hours(busy),
            "integrations": len(started),
            "waitsMinutes": waits,
            "waitFirstThirdMean": first,
            "waitLastThirdMean": last,
            "waitsClimbing": climbing,
            "conflicts": sum(1 for h in freed if h["conflict"]),
            "integratorPath": sum(1 for h in freed if h["path"] == "integrator"),
        }

    # ---- the Hands-off rate (ADR 0037 d1; the header's rules) -----------------------------------------------------

    def hands_off(self, run_start, since, until):
        first = {}
        for t, task in self.merges:
            if since <= t <= until and task not in first:
                first[task] = t
        landed = sorted(first)
        acts = {task: [] for task in landed}
        not_counted = {"standingApproval": 0, "automaticHandBack": 0, "raceReverified": 0}
        decided = set()

        def inside(task, t):
            return task in first and run_start <= t <= first[task]

        for t, kind, task, d in self.acts:
            if not inside(task, t):
                continue
            if kind == "gate-signed" and d.get("standing") is True:
                not_counted["standingApproval"] += 1
            elif kind == "auto-retry" or (kind == "handed-back" and d.get("via") == "descope"):
                not_counted["automaticHandBack"] += 1
            elif kind == "race-decided":
                decided.add(task)
            act = human_act(kind, d)
            if act:
                acts[task].append((t, act[0], act[1]))
        for h in self.holds:
            if h["hold"] == "merge" and inside(h["task"], h["start"]):
                acts[h["task"]].append((h["start"], "mergeHold", "a merge hold to %s (%s)" % (fmt(h["end"]),
                                                                                           MERGE_HOLD_DETAIL)))
        for task in landed:
            if task not in decided and any(h["hold"] == "race" and h["task"] == task and inside(task, h["start"])
                                           for h in self.holds):
                not_counted["raceReverified"] += 1
        by_kind = {k: 0 for k in ACT_NAMES}
        for task in landed:
            for _t, k, _d in acts[task]:
                by_kind[k] += 1
        with_act = sum(1 for task in landed if acts[task])
        rate = round((len(landed) - with_act) / len(landed), 4) if landed else None
        if not landed:
            self.flag("hands-off rate: nothing landed in the window: null")
        for t, task in self.hand_back_starts:
            if not run_start <= t <= until:
                continue
            last_sa = max((x[0] for x in self.set_asides if x[1] == task and x[0] <= t), default=run_start)
            if not any(a_task == task and last_sa <= at_ <= t and kind in ("auto-retry", "handed-back", "gate-signed")
                       for at_, kind, a_task, _d in self.acts):
                self.flag("[[%s]]: slot-taken start=hand-back at %s follows no auto-retry, handed-back or gate-signed "
                          "since its last set-aside: no recorded cause: not counted (a hand-back from before p21-2's "
                          "events, or a hand edit)" % (task, fmt(t)))
        for h in self.holds:
            if h["hold"] == "git-env" and run_start <= h["start"] <= until:
                self.flag("a git-env hold at %s: a rollout-level wait on Lachy, attributed to no task in the "
                          "Hands-off rate" % fmt(h["start"]))
        return {
            "rate": rate, "landed": len(landed), "handsOff": len(landed) - with_act,
            "tasks": [{"task": task, "acts": [{"kind": k, "at": fmt(t), "detail": det}
                                              for t, k, det in sorted(acts[task], key=lambda a: a[0])]}
                      for task in landed],
            "byKind": by_kind, "notCounted": not_counted, "baseline": None,
        }

    # ---- tunings.jsonl -----------------------------------------------------------------------------------------

    def read_tunings(self, base):
        try:
            self.tunings = load_tunings(base)
        except OSError as e:
            self.tunings = []
            self.flag("tunings.jsonl cannot be read (%s): no baseline, no earlier Tunings" % e)

    def baseline(self, repo, active_start):
        if repo is None or active_start is None:
            return None
        cands = []
        for d in self.tunings:
            w = d.get("window") if isinstance(d.get("window"), dict) else {}
            if d["repo"].lower() != repo.lower() or not isinstance(w.get("activeEnd"), str):
                continue
            try:
                end = to_ms(w["activeEnd"])
            except Exception:
                continue
            if end <= active_start and isinstance(d.get("scores"), dict):
                cands.append((end, d["_t"], w.get("partial") is True, d))
        whole = [c for c in cands if not c[2]]
        pick = max(whole or cands, key=lambda c: (c[0], c[1])) if cands else None
        if pick is None:
            return None
        if pick[2]:
            self.flag("baseline: only a partial Reflection's line qualifies (%s); read it with care" % pick[3].get("id"))
        if "handsOffRate" not in pick[3]["scores"]:
            self.flag("baseline %s is a v1 line: no Hands-off rate, Quality or Review churn baseline" % pick[3].get("id"))
        return {"id": pick[3].get("id"), "activeEnd": fmt(pick[0]), "partial": pick[2], "v": pick[3].get("v"),
                "scores": pick[3]["scores"]}

    # ---- the whole score -----------------------------------------------------------------------------------------

    def run(self):
        a = self.args
        try:
            slug = RR.normalise_slug(a.rollout, "rollout")
        except RR.Refused as e:
            raise Usage(str(e))
        if slug in RR.RESERVED:
            raise Usage("rollout %r is reserved (%s.jsonl is no rollout's record)" % (slug, slug))
        note_path = a.note
        if note_path is None and a.rollout.strip().endswith(".md") and os.path.isfile(os.path.expanduser(a.rollout)):
            note_path = a.rollout
        try:
            since = to_ms(a.since) if a.since else None
            until = to_ms(a.until) if a.until else int(time.time() * 1000)
        except RR.Refused as e:
            raise Usage(str(e))
        settings = self.read_settings(a.settings)
        note = self.read_note(note_path) if note_path else None
        try:
            base = RR.events_dir(self.env)
        except ValueError as e:
            raise Unreadable("cannot resolve the events directory: %s" % e)
        path = os.path.join(base, slug + ".jsonl")
        lines, skipped = [], 0
        if os.path.exists(path):
            try:
                lines, skipped = read_lines(path)
            except OSError as e:
                raise Unreadable("cannot read the run record %s: %s" % (path, e))
            lines = [x for x in lines if x[2].get("kind") not in LEDGER_KINDS]
        if skipped:
            self.flag("%d record line(s) did not parse: skipped" % skipped)
        repo = a.repo_slug or (settings or {}).get("repo") or None
        self.slug, self.repo = slug, repo
        first_taken = next((t for t, _n, d in lines if d.get("kind") == "slot-taken"), None)
        if since is None:
            since = first_taken if first_taken is not None else (lines[0][0] if lines else until)
        if since > until:
            raise Usage("--since %s is after --until %s" % (fmt(since), fmt(until)))
        host = next((d.get("host") for _t, _n, d in lines if d.get("kind") == "slot-taken"), None) or \
            (lines[0][2].get("host") if lines else None)
        out = {"rollout": slug, "repo": repo, "host": host, "record": path}
        if repo is None:
            self.flag("no repo identity (no GitHub origin): nothing to tune, no baseline kept")
        if not lines:
            self.flag("no record")
        self.pair(lines, until)
        self.slot_ends(until)
        self.running(since, until)
        self.slots_score(since, until)
        self.lane_score(since, until)
        # each key's ran-at value, once: the ceiling in force for most of the running time, each round cap's most
        # common value on the window's slot-taken lines (tune.py --revert and reflect.py read `ranAt`)
        self.ran_at = {"parallel_ceiling": (self.slot_metrics["ceiling"], None)}
        for key in KEYS[1:]:
            self.ran_at[key] = self._ran_at(key, since, until)
        self.read_tunings(base)
        rt = self.run_ms
        act_start = self.run_iv[0][0] if self.run_iv else None
        act_end = self.run_iv[-1][1] if self.run_iv else None
        merged = sorted({task for t, task in self.merges if since <= t <= until})
        escapes = self.escapes(self.landed(since, until), repo)
        throughput = None
        if rt:
            throughput = round(len(merged) / (rt / HOUR), 3)
        elif lines:
            self.flag("zero running time: Throughput is null")
        tokens = self.tokens(since, until)
        n_merges = len(merged)
        set_asides = [x for x in self.set_asides if since <= x[0] <= until]
        denom = self.slot_metrics["closed"] + self.integrations
        sa_rate = round(len(set_asides) / denom, 4) if denom else None
        conflict = round(self.lane_metrics["conflicts"] / self.integrations, 4) if self.integrations else None
        integ_share = round(self.lane_metrics["integratorPath"] / self.integrations, 4) if self.integrations else None
        tpm = round(tokens / n_merges, 1) if tokens is not None and n_merges else None
        stalls = sum(1 for t in self.stalls if since <= t <= until)
        run_start = first_taken if first_taken is not None else (lines[0][0] if lines else since)
        hands_off = self.hands_off(run_start, since, until)
        bounds = guardrail_bounds(settings)
        churn, churn_breached = self.review_churn(since, until, base, repo, bounds["review_churn_pct"])
        # the ten scores tune.py records: Quality is escapes.quality (p21-4), Review churn reviewChurn.value (p21-3)
        headline = {"throughput": throughput, "runningHours": hours(rt), "merges": n_merges, "tokensPerMerge": tpm,
                    "setAsideRate": sa_rate, "conflictRate": conflict, "quotaStalls": stalls,
                    "handsOffRate": hands_off["rate"], "quality": escapes["quality"], "reviewChurn": churn["value"]}
        base_line = self.baseline(repo, act_start)
        if base_line is None and repo is not None:
            self.flag("no baseline: no earlier Reflection on %s ended before this run began; only quota stalls, "
                      "Throughput and Review churn can withhold a raise" % repo)
        hands_off["baseline"] = ((base_line or {}).get("scores") or {}).get("handsOffRate")
        guard = self.guardrails(headline, base_line, bounds, since, until, churn, churn_breached)
        out.update({
            "window": {"since": fmt(since), "until": fmt(until), "activeStart": fmt(act_start),
                       "activeEnd": fmt(act_end), "partial": self.partial},
            "runningTime": {"hours": hours(rt), "excluded": self.excluded, "excludedHours": self.excluded_hours},
            "merges": {"count": n_merges, "tasks": merged},
            "escapes": escapes,
            "throughput": throughput,
            "handsOff": hands_off,
            "slots": self.slot_metrics,
            "lane": dict(self.lane_metrics, integratorShare=integ_share),
            "guardrails": guard,
            "load": self.load(base, slug, host, since, until),
            "headline": headline,
            "ranAt": {k: self.ran_at[k][0] for k in KEYS},
            "reviewChurn": churn,
            "baseline": base_line,
        })
        binding = self.binding(stalls)
        out["binding"] = binding
        proposals, withheld = self.propose(binding["constraint"], headline, guard, settings, note, first_taken,
                                           since, until, set_asides)
        out["proposals"], out["withheld"] = proposals, withheld
        out["flags"] = self.flags
        out["thresholds"] = {
            "graceMinutes": GRACE // MINUTE, "laneOnlyCapHours": LANE_ONLY_CAP // HOUR,
            "slotBoundFull": SLOT_BOUND_FULL, "laneBoundBusy": LANE_BOUND_BUSY,
            "laneFreeForRaise": LANE_FREE_FOR_RAISE, "waitClimbRatio": WAIT_CLIMB_RATIO,
            "waitClimbMinMinutes": WAIT_CLIMB_MIN, "dependencyIdle": DEPENDENCY_IDLE,
            "quotaStalls": QUOTA_STALLS, "roundSetAsides": ROUND_SET_ASIDES,
            "trickleBound": TRICKLE_BOUND, "holdMarkerSpanMinutes": HOLD_MARKER_SPAN // MINUTE,
        }
        return out

    def read_settings(self, src):
        if src is None:
            return None
        try:
            raw = sys.stdin.read() if src == "-" else open(os.path.expanduser(src), encoding="utf-8").read()
        except OSError as e:
            raise Unreadable("cannot read --settings %s: %s" % (src, e))
        try:
            doc = json.loads(raw)
        except ValueError as e:
            raise Unreadable("--settings %s is not JSON: %s" % (src, e))
        if not isinstance(doc, dict) or not isinstance(doc.get("settings"), dict):
            raise Unreadable("--settings %s is not rollout-settings.py's JSON (no settings object)" % src)
        return doc

    def read_note(self, path):
        rr = _load("reconcile_rollout", RECONCILE_PY)
        p = os.path.expanduser(path)
        try:
            note = rr.Note(pathlib.Path(p))
        except (OSError, ValueError) as e:
            raise Unreadable("cannot read --note %s: %s" % (path, e))
        fm = {}
        for key in KEYS:
            v = rr._int_field(note.get(key), None)
            if isinstance(v, int) and v >= 1:
                fm[key] = v
        cap = rr._scalar(note.get("captured"))
        m = re.match(r"(\d{4})-(\d\d)-(\d\d)", cap)
        if m:
            try:
                day = datetime.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                fm["captured"] = int(time.mktime(day.timetuple()) * 1000)  # local midnight
            except (ValueError, OverflowError):
                pass
        return fm

    # ---- Escapes and Quality (escapes.py) ---------------------------------------------------------------------

    def landed(self, since, until):
        """{task: {pr, readOnly, at}} for every task with a `merged` line in the window, the same raw `task` keys as
        `merges` (emit's normalise_slug output): landed_from's rule, its flags raised here."""
        out, flags = landed_from(self.merge_lines, since, until)
        for f in flags:
            self.flag(f)
        return out

    def _expand(self, p):
        """`~` expanded against the scored env's HOME (a scratch HOME stays hermetic)."""
        if p == "~" or p.startswith("~/"):
            return RR._home(self.env) + p[1:]
        return os.path.expanduser(p)

    def escapes(self, landed, repo):
        """escapes.py's block (its flags prefixed `escapes: `); an all-unread block, flagged, when it will not load."""
        a = self.args
        tasks_dir = self._expand(a.tasks_dir) if a.tasks_dir else \
            os.path.join(RR._home(self.env), "repos", "obsidian", "Work", "Tasks")
        repo_dir = self._expand(a.repo) if a.repo else None
        try:
            block, flags = _load("thread_escapes", ESCAPES_PY).score(landed, tasks_dir, repo_dir, repo, self.env)
        except Exception as e:
            why = "unread: escapes.py did not load (%s: %s)" % (type(e).__name__, e)
            block = {"count": None, "landed": len(landed), "quality": None, "partial": True,
                     "bySource": {"fixes": None, "reverts": None, "reviews": None}, "reviewDocs": None, "tasks": [],
                     "sources": {"fixes": why, "reverts": why, "reviews": why}, "ref": None,
                     "excluded": {"dropped": [], "selfNamed": [], "unreadNotes": 0, "rejectedRows": 0,
                                  "unresolved": [], "unresolvedDocs": [], "unlandedDocs": [],
                                  "unresolvedRows": []}}
            flags = ["Quality unknown: escapes.py did not load (%s: %s)" % (type(e).__name__, e)]
        for f in flags:
            self.flag("escapes: " + f)
        return block

    def tokens(self, since, until):
        """Every call's tokens (its journal's latest terminal line, else its latest: a call still running counts what
        it has spent) when the call started in the window: its startTime, else its run-bound line's ts."""
        got, any_tokens = 0, False
        bound_at = {}
        for t, _task, run_id, _call in self.bound:
            bound_at.setdefault(run_id, t)
        for run_id, j in self.journals.items():
            st = j.get("startTime")
            if not isinstance(st, int) or isinstance(st, bool):
                st = bound_at.get(run_id)
            if st is None or not since <= st <= until:
                continue
            if isinstance(j.get("tokens"), int):
                got += j["tokens"]
                any_tokens = True
        return got if any_tokens else None

    # ---- Review churn (p21-3, ADR 0037 d1) -------------------------------------------------------------------

    def review_churn(self, since, until, base, repo, bound_pct):
        """(churn, breached): regression findings over all findings, over the engine's master-review rounds (this
        record's review-verdict lines) and /fresh-review's rounds (reviews.jsonl's review-round lines attributed to
        `repo`), with the engine's rounds per landed task beside it, and whether it is over `bound_pct` %, decided
        from the integer sums. None (unknown) with no round recorded, or with findings none of which was classified;
        0.0 with rounds but no findings. A None never breaches."""
        # Engine: dedupe the lines read (ts <= --until) ONCE by verdict_key, the first in record order kept (the line
        # the writer kept); the windowed sums and the per-task round counts both read this one set.
        kept, seen = [], set()
        for _n, t, task, d in sorted(self.verdict_lines, key=lambda x: x[0]):
            try:
                key = RR.verdict_key(d)
            except Exception:
                continue
            if key not in seen:
                seen.add(key)
                kept.append((t, task, d))
        eng = {"rounds": 0, "findings": 0, "original": 0, "regression": 0, "unclassified": 0}
        uncounted = 0
        for t, _task, d in kept:
            if since <= t <= until:
                eng["rounds"] += 1
                c = _counts(d)
                if c is None:
                    uncounted += 1
                else:
                    self._add(eng, c)
        if uncounted:
            self.flag("review churn: %d engine round(s) carry no valid findings/original/regression counts: counted as "
                      "rounds, not in the churn" % uncounted)
        landed = sorted({task for t, task in self.merges if since <= t <= until} - self.read_only)
        per_task = {}
        for _t, task, _d in kept:
            per_task[task] = per_task.get(task, 0) + 1
        with_rounds = [task for task in landed if per_task.get(task)]
        without = [task for task in landed if not per_task.get(task)]
        if without:
            self.flag("review churn: landed task(s) with no recorded review round: %s (a pre-p21-3 engine's row, or a "
                      "lead-written one)" % ", ".join("[[%s]]" % x for x in without))
        eng["landedTasks"] = len(with_rounds)
        eng["roundsPerLandedTask"] = (round(sum(per_task[x] for x in with_rounds) / len(with_rounds), 2)
                                      if with_rounds else None)
        fresh = self.fresh_review_rounds(since, until, base, repo)
        tot = {k: eng[k] + fresh[k] for k in ("rounds", "findings", "original", "regression", "unclassified")}
        findings, regression = tot["findings"], tot["regression"]
        breached = False
        if tot["rounds"] == 0:
            value = None
            self.flag("review churn unknown: no review rounds recorded")
        elif findings == 0:
            value = 0.0  # every round approved with nothing to fix: no churn, and known
        elif tot["original"] + regression == 0:
            # findings, but none placed: a 0.0 here would read clean and never breach (unknown is not 0)
            value = None
            self.flag("review churn unknown: %d finding(s), none classified (no head, no tree or no path:line cite)"
                      % findings)
        else:
            value = round(regression / findings, 4)
            breached = _churn_over(regression, findings, bound_pct)
            if tot["unclassified"] * 2 > findings:
                # review-ledger.py's 40% THRESHOLD is measured over classified findings only; here the unclassified
                # ones sit in the denominator as non-regressions, so a sparse split understates the churn
                self.flag("review churn: low coverage: %d of %d finding(s) unclassified (no head, no tree or no "
                          "path:line cite): the churn counts them as non-regressions, so it may read low"
                          % (tot["unclassified"], findings))
        out = {"value": value}
        out.update((k, tot[k]) for k in ("findings", "original", "regression", "unclassified", "rounds"))
        out.update(engine=eng, freshReview=fresh)
        return out, breached

    @staticmethod
    def _add(acc, c):
        f, o, r = c
        acc["findings"] += f
        acc["original"] += o
        acc["regression"] += r
        acc["unclassified"] += f - o - r

    def fresh_review_rounds(self, since, until, base, repo):
        """reviews.jsonl's review-round lines (p15-7's /fresh-review rounds): read up to --until, deduped on (repo, doc),
        else (repo, head, digest), the latest kept, windowed by the round's time, and counted only when their repo
        is this score's (an owner/name ignoring case, or a path whose GitHub origin is). The round's time is the kept
        line's reviewedAt (ADR 0058 d5), else the key's earliest line's ts (its arrival emit), never the kept line's
        own ts: a doc's consumed line, or land.sh's sweep at a landing's end, can fall in a later window than its round,
        which then counted twice or in the wrong window."""
        out = {"rounds": 0, "findings": 0, "original": 0, "regression": 0, "unclassified": 0, "unattributed": 0}
        path = os.path.join(base, RR.REVIEWS + ".jsonl")
        if not os.path.exists(path):
            return out
        try:
            lines, _skipped = read_lines(path)
        except OSError as e:
            self.flag("review churn: reviews.jsonl cannot be read (%s): no /fresh-review rounds" % e)
            return out
        latest, arrived = {}, {}
        for t, _n, d in lines:  # time order, then file order: the last one per key is the latest
            if d.get("kind") != "review-round" or t > until or not isinstance(d.get("repo"), str):
                continue
            doc = d.get("doc")
            key = ("doc", d["repo"], doc) if isinstance(doc, str) and doc else \
                ("head", d["repo"], d.get("head"), d.get("digest"))
            latest[key] = (t, d)
            arrived.setdefault(key, t)
        uncounted = 0
        for key, (t, d) in latest.items():
            at = arrived[key]
            if isinstance(d.get("reviewedAt"), str):
                try:
                    at = to_ms(d["reviewedAt"])
                except Exception:
                    pass
            if not since <= at <= until:
                continue
            mine = self._review_repo(d["repo"], repo)
            if mine is None:
                out["unattributed"] += 1
                continue
            if not mine:
                continue
            out["rounds"] += 1
            c = _counts(d)
            if c is None:
                uncounted += 1
            else:
                self._add(out, c)
        if out["unattributed"]:
            self.flag("review churn: %d /fresh-review round(s) in reviews.jsonl could not be attributed (no repo "
                      "identity, or a repo path with no readable GitHub origin): not counted" % out["unattributed"])
        if uncounted:
            self.flag("review churn: %d /fresh-review round(s) carry no findings/original/regression counts: counted "
                      "as rounds, not in the churn" % uncounted)
        return out

    def _review_repo(self, line_repo, repo):
        """True when a review-round's repo is this score's repo, False when it is another's, None when it cannot be
        told: no repo identity here, or a path with no readable GitHub origin (land.sh --origin-slug, which reads a
        deleted worktree through its nearest existing ancestor; cached per path)."""
        if repo is None or not line_repo:
            return None
        if not os.path.isabs(line_repo):
            return line_repo.lower() == repo.lower()
        cache = self.origins
        if line_repo not in cache:
            try:
                if self.rs is None:
                    self.rs = _load("thread_rollout_settings", ROLLOUT_SETTINGS_PY)
                cache[line_repo] = self.rs._origin_slug(line_repo)
            except Exception:  # rs.SettingsError (land.sh failed or timed out) or a load failure: unresolvable
                cache[line_repo] = None
        slug = cache[line_repo]
        return None if slug is None else slug.lower() == repo.lower()

    def guardrails(self, headline, base_line, bounds, since, until, churn, churn_breached):
        bs = (base_line or {}).get("scores") or {}

        def rise(value, base, points):
            if value is None or not isinstance(base, (int, float)) or isinstance(base, bool):
                return None if value is None or base is None else False
            return (value - base) * 100 > points

        tpm, tbase = headline["tokensPerMerge"], bs.get("tokensPerMerge")
        t_breach = None
        if tpm is not None and isinstance(tbase, (int, float)) and not isinstance(tbase, bool) and tbase > 0:
            t_breach = tpm > tbase * (1 + bounds["tokens_per_merge_pct"] / 100.0)
        # Throughput's absolute bound: hours_per_task running hours for each task whose Slot or lane holding overlaps
        # the window. Running time counts lane-only stretches too, so a task that only integrates in the window (a
        # supersede's carried awaiting-integration task, which holds no Slot here, or the far side of a --since split)
        # earns its allowance like one that ran. The bound is an allowance: compared in ms and strictly greater, so a
        # run exactly at its allowance is inside it, and zero running time never breaches.
        tasks = len({x["task"] for x in self.slots + self.holdings
                     if x["start"] <= until and (x["end"] is None or x["end"] >= since)})
        hpt = bounds["hours_per_task"]
        allowance = hpt * HOUR * max(tasks, 1)
        t_over = self.run_ms > allowance
        if t_over and self.partial:
            self.flag("throughput: breached on a partial window: the run's tail has not landed")
        out = {
            "throughput": {"value": headline["throughput"], "runningHours": hours(self.run_ms), "tasks": tasks,
                           "allowanceHours": hours(allowance), "bound": "<= %s running h per task" % hpt,
                           "baseline": bs.get("throughput"), "breached": t_over},
            "tokensPerMerge": {"value": tpm if tpm is not None else "unknown",
                               "bound": "+%s%%" % bounds["tokens_per_merge_pct"], "baseline": tbase,
                               "breached": bool(t_breach)},
            "setAsideRate": {"value": headline["setAsideRate"], "bound": "+%s points" % bounds["set_aside_rate_points"],
                             "baseline": bs.get("setAsideRate"),
                             "breached": bool(rise(headline["setAsideRate"], bs.get("setAsideRate"),
                                                   bounds["set_aside_rate_points"]))},
            "conflictRate": {"value": headline["conflictRate"], "bound": "+%s points" % bounds["conflict_rate_points"],
                             "baseline": bs.get("conflictRate"),
                             "breached": bool(rise(headline["conflictRate"], bs.get("conflictRate"),
                                                   bounds["conflict_rate_points"]))},
            "quotaStalls": {"value": headline["quotaStalls"], "bound": bounds["quota_stalls"],
                            "baseline": bs.get("quotaStalls"),
                            "breached": headline["quotaStalls"] > bounds["quota_stalls"]},
        }
        # an absolute bound (ADR 0037 d1): it breaches with no baseline (its baseline is shown, never compared), and a
        # null value never breaches; the breach is review_churn's, decided from the integer sums, never from the
        # rounded value
        v = churn["value"]
        out["reviewChurn"] = {"value": v if v is not None else "unknown", "bound": "<=%s%%" % bounds["review_churn_pct"],
                              "baseline": bs.get("reviewChurn"), "breached": v is not None and churn_breached,
                              "roundsPerLandedTask": churn["engine"]["roundsPerLandedTask"]}
        if tpm is None:
            self.flag("tokens per merge unknown: no folded call journal carries tokens (or nothing merged)")
        return out

    def binding(self, stalls):
        sm, lm = self.slot_metrics, self.lane_metrics
        busy = lm["busyShare"] or 0
        if stalls >= QUOTA_STALLS:
            return {"constraint": "quota-bound", "why": "%d quota stall(s) in the window" % stalls}
        if busy >= LANE_BOUND_BUSY or lm["waitsClimbing"]:
            why = "lane held %d%% of running time" % round(busy * 100)
            if lm["waitsClimbing"]:
                why += "; ready-to-lane waits climbing (%s → %s min)" % (lm["waitFirstThirdMean"],
                                                                         lm["waitLastThirdMean"])
            self.flag("lane-bound: no key moves this (the Integration lane takes one task at a time)")
            return {"constraint": "lane-bound", "why": why}
        if sm["fullShare"] is not None and sm["fullShare"] >= SLOT_BOUND_FULL:
            return {"constraint": "slot-bound", "why": "Slots full %d%% of running time at ceiling %s"
                    % (round(sm["fullShare"] * 100), sm["ceiling"])}
        trickle = self._trickle_bound()
        if trickle:
            return trickle
        if self.capacity and self.idle_total / self.capacity >= DEPENDENCY_IDLE:
            dep = self.idle.get("dependency", 0) + self.idle.get("solo", 0)
            others = [v for k, v in self.idle.items() if k not in ("dependency", "solo")]
            if dep > 0 and dep >= max(others or [0]):
                return {"constraint": "dependency-bound", "why": "free Slots %d%% of capacity, mostly waiting on "
                        "dependencies or a Solo task" % round(self.idle_total * 100 / self.capacity)}
        return {"constraint": "none-clear", "why": "no rule held"}

    def _trickle_bound(self):
        """The trickle-bound rule (the header's Binding), or None. Its share, as slot-bound's full share: the time a
        CAP_HOLDS reason is in force with a Slot free (idle_segments' running segments with that reason, self.idle_ms)
        plus every excluded CAP_HOLDS span (no Slot open), over running time plus those spans; it holds at
        TRICKLE_BOUND or more. And, as dependency-bound's largest reason, the Slot time the cap held (its idle Slot-ms
        plus each excluded span times the ceiling in force at its start: every Slot is free then; no ceiling step, no
        term) is at least every other idle reason's Slot-ms, so a run whose dependency waits left more Slots idle than
        the cap did is not read as the Trickle's. Slot-full time and held time never overlap: a hold marker is only
        written while a Slot is free, and a full segment ends its reason."""
        held = {k: self.idle.get(k, 0) for k in CAP_HOLDS}
        held_ms = sum(self.idle_ms.get(k, 0) for k in CAP_HOLDS)
        no_slot = 0
        for kind, a, b in self._excluded_ms:
            if kind not in CAP_HOLDS:
                continue
            no_slot += b - a
            c = self.ceiling_at(a)
            if c:
                held[kind] += (b - a) * c
        span = self.run_ms + no_slot
        h = sum(held.values())
        others = [v for k, v in self.idle.items() if k not in CAP_HOLDS]
        if not span or not held_ms + no_slot or (held_ms + no_slot) / span < TRICKLE_BOUND or h < max(others or [0]):
            return None
        share = (held_ms + no_slot) / span
        self.flag("trickle-bound: no rollout key moves this (the Trickle is the Mac-wide cap in "
                  "~/.config/thread/away.json)")
        self.flag("throughput: read under the Mac-wide cap (trickle-bound): merges per running hour at the Slots the "
                  "cap allowed, not at the ceiling %s" % self.slot_metrics["ceiling"])
        return {"constraint": "trickle-bound",
                "why": "the Mac-wide cap kept Slots free %d%% of the time (running time plus %g h with no Slot open; "
                       "Slot time it held: the Trickle %g h, the Away cap %g h)"
                       % (round(share * 100), hours(no_slot), hours(held["hold-trickle"]),
                          hours(held["hold-away-cap"]))}

    def _ran_at(self, key, since, until):
        """(ran, spread) for a round cap: its most common value on the window's slot-taken lines (ties to the later),
        and how many tasks ran with another (a task override), or (None, None). Pure: run() computes each key once
        into self.ran_at, and ran_at_cap flags a spread only for a key a proposal uses."""
        vals = [(t, task, s.get(key)) for t, task, s in self.slot_taken
                if since <= t <= until and _settings_value(s, key)]
        if not vals:
            return None, None
        count, latest = {}, {}
        for t, _task, v in vals:
            count[v] = count.get(v, 0) + 1
            latest[v] = t
        ran = max(count, key=lambda v: (count[v], latest[v]))
        per_task = {}
        for _t, task, v in vals:
            per_task[task] = v
        odd = sum(1 for v in per_task.values() if v != ran)
        spread = "%d of %d tasks ran with a task override" % (odd, len(per_task)) if odd else None
        return ran, spread

    def ran_at_cap(self, key):
        """A proposal's ran-at value for a round cap (self.ran_at's), its spread flagged here."""
        ran, spread = self.ran_at.get(key, (None, None))
        if spread:
            self.flag("%s: %s" % (key, spread))
        return ran, spread

    def cause(self, key, ran_at, frm, spread, note, settings, first_taken):
        for d in sorted(self.tunings, key=lambda x: x["_t"], reverse=True):
            if d["_voided"] or self.repo is None or d["repo"].lower() != self.repo.lower():
                continue
            if first_taken is not None and d["_t"] <= first_taken:
                continue
            if any(isinstance(e, dict) and e.get("key") == key for e in d.get("applied") or []):
                return "Tuning %s moved it on %s" % (d.get("id"), fmt(d["_t"]))
        if key == "parallel_ceiling" and self.ceiling_changes:
            x, y, t = self.ceiling_changes[0]
            return "changed mid-window %d → %d at %s (a note or task override)" % (x, y, fmt(t))
        if spread:
            return spread
        mtime = None
        if settings and settings.get("file") and isinstance(settings.get("path"), str):
            try:
                mtime = int(os.stat(os.path.expanduser(settings["path"])).st_mtime * 1000)
            except OSError:
                mtime = None
        if mtime is not None and first_taken is not None and mtime > first_taken:
            return "rollouts.toml was edited after the run started"
        fm = (note or {}).get(key)
        captured = (note or {}).get("captured")
        toml_absent = not (settings and settings.get("file"))
        if fm == ran_at and (toml_absent or (mtime is not None and captured is not None and mtime < captured)):
            return ("ran at %d by a rollout-note override; rollouts.toml has said %d since before this rollout "
                    "was scheduled" % (ran_at, frm))
        if fm is not None and fm != ran_at:
            return "the rollout note now says %d; the run ran at %d" % (fm, ran_at)
        return "unclear: rollouts.toml changed around schedule time"

    def propose(self, constraint, headline, guard, settings, note, first_taken, since, until, set_asides):
        if self.repo is None:
            return [], []
        rules = []
        lane_busy = self.lane_metrics["busyShare"] or 0
        sm = self.slot_metrics
        rh = headline["runningHours"]
        if constraint == "slot-bound":
            # a busy lane would take the extra Slot's work one task at a time: the raise is withheld, never dropped
            busy_lane = None
            if lane_busy >= LANE_FREE_FOR_RAISE:
                busy_lane = "lane %d%% busy, at or above %d%%: a raise would queue on the Integration lane" % (
                    round(lane_busy * 100), round(LANE_FREE_FOR_RAISE * 100))
            rules.append(("parallel_ceiling", 1, "slot-bound-raise",
                          "Slot-bound: Slots full %d%% of %s running h at ceiling %s; lane %d%% busy"
                          % (round(sm["fullShare"] * 100), rh, sm["ceiling"], round(lane_busy * 100)), busy_lane))
        if constraint == "quota-bound":
            rules.append(("parallel_ceiling", -1, "quota-bound-lower",
                          "Quota-bound: %d quota stall(s) in %s running h at ceiling %s"
                          % (headline["quotaStalls"], rh, sm["ceiling"]), None))
        for cls, key, rule in (("review-rounds", "max_review_rounds", "review-rounds-raise"),
                               ("plan-rejected", "max_plan_rounds", "plan-rejected-raise")):
            n = sum(1 for x in set_asides if x[2] == cls)
            if n >= ROUND_SET_ASIDES:
                rules.append((key, 1, rule, "%d set-asides of reasonClass %s in the window" % (n, cls), None))
        proposals, withheld = [], []
        breached = [k for k, v in guard.items() if v["breached"]]
        measured = {h: headline.get(h) for h in HEADLINES}
        for key, direction, rule, evidence, hold in rules:
            spread = None
            if key == "parallel_ceiling":
                ran_at = sm["ceiling"]
            else:
                ran_at, spread = self.ran_at_cap(key)
            frm = (((settings or {}).get("settings") or {}).get(key) or {}).get("value")
            if ran_at is None:
                if not isinstance(frm, int):
                    self.flag("%s: %s needs a ran-at value and no slot-taken carries one" % (rule, key))
                    continue
                ran_at = frm
                self.flag("%s: no slot-taken carries %s; its ran-at value is rollouts.toml's %d" % (rule, key, frm))
            to = ran_at + direction
            if to < 1:
                self.flag("%s: %s would drop to %d (ran at %d): dropped" % (rule, key, to, ran_at))
                continue
            evidence = ("%s (ran at %d)" % (evidence, ran_at))[:EVIDENCE_MAX]
            weight = weigh(rule, measured)
            entry = {"id": "p%d" % (len(proposals) + len(withheld) + 1), "key": key, "from": frm, "to": to,
                     "ranAt": ran_at, "ranAtCause": None, "rule": rule, "direction": direction,
                     "evidence": evidence, "agreeing": self.agreeing(key, rule, direction),
                     "serves": weight["serves"], "risks": weight["risks"], "trade": weight["trade"], "caution": None}
            hit = [k for k in breached if k in weight["risks"]]  # the breached Guardrails this rule risks
            if not isinstance(frm, int) or isinstance(frm, bool):
                entry["reason"] = "no rollout settings (--settings): rollouts.toml's current value is unknown"
                withheld.append(entry)
                continue
            if frm != ran_at:
                entry["ranAtCause"] = self.cause(key, ran_at, frm, spread, note, settings, first_taken)
            if _sign(to - frm) != direction:
                reason = "rollouts.toml already at %d, at or past this run's evidence (ran at %d → %d)" % (frm, ran_at, to)
                if entry["ranAtCause"]:
                    reason += "; " + entry["ranAtCause"]
                entry["reason"] = reason
                withheld.append(entry)
            elif hold:
                entry["reason"] = hold
                withheld.append(entry)
            elif direction > 0 and hit:
                entry["reason"] = "a raise while a Guardrail is breached: %s" % ", ".join(_breach(k, guard[k]) for k in hit)
                withheld.append(entry)
            else:
                if direction < 0 and hit:  # a lower is never withheld by a Guardrail: Lachy weighs it
                    entry["caution"] = _caution(hit, guard)
                proposals.append(entry)
        return proposals, withheld

    def agreeing(self, key, rule, direction):
        return agreeing(self.tunings, self.repo, key, rule, direction)

    def load(self, base, slug, host, since, until):
        """Each other same-host record whose live span overlaps this run's running time (run_iv), never merely the
        window: a Reflection run long after the rollout must not count later rollouts as load. The live span runs from its
        first line to its last line or, while a Slot it took has no slot-freed (nor a `carried` out), to --until: a
        rollout whose calls run long writes nothing while they run, so its last line can precede this run although
        its Slots are busy throughout. Bounding an open Slot by the window keeps a long-dead record with a lost
        slot-freed from counting forever; it is flagged instead. slotsOpen counts the Slots live in the overlap."""
        out, other_host = [], 0
        try:
            names = sorted(os.listdir(base))
        except OSError:
            names = []
        skip = {slug + ".jsonl"} | {r + ".jsonl" for r in RR.RESERVED}
        for name in names:
            if not name.endswith(".jsonl") or name in skip:
                continue
            try:
                lines, _skipped = read_lines(os.path.join(base, name))
            except OSError:
                self.flag("load: %s cannot be read: skipped" % name)
                continue
            lines = [x for x in lines if x[2].get("kind") not in LEDGER_KINDS]
            mine = []
            for t, _n, d in lines:
                if host is not None and d.get("host") != host:
                    if since <= t <= until:
                        other_host += 1
                    continue
                mine.append((t, d))
            if not mine:
                continue
            slots, open_slot = [], {}  # pairing as in pair(): one Slot per task, a re-take keeps the open one
            for t, d in mine:
                kind, task = d.get("kind"), d.get("task")
                if not task:
                    continue
                if kind == "slot-taken" and task not in open_slot:
                    open_slot[task] = [t, None]
                    slots.append(open_slot[task])
                elif kind == "slot-freed" or (kind == "carried" and d.get("rollout") == d.get("from")):
                    if task in open_slot:
                        open_slot.pop(task)[1] = t
            last = mine[-1][0]
            end = max(last, until) if open_slot else last
            overlap = intersect([(mine[0][0], end)], self.run_iv)
            if not overlap:
                continue
            name_ = name[:-6]
            if end > last and intersect([(last, end)], self.run_iv):
                self.flag("load: [[%s]] has %d Slot(s) with no slot-freed (%s): read as live past its last line (%s) "
                          "to this run's end; a lost slot-freed overcounts it"
                          % (name_, len(open_slot), ", ".join("[[%s]]" % k for k in sorted(open_slot)), fmt(last)))
            a, b = overlap[0][0], overlap[-1][1]
            inside = [d for t, d in mine if any(x <= t <= y for x, y in overlap)]
            out.append({"rollout": name_, "start": fmt(a), "end": fmt(b), "hours": hours(total(overlap)),
                        "slotsTaken": sum(1 for d in inside if d.get("kind") == "slot-taken"),
                        "slotsOpen": sum(1 for x, y in slots if intersect([(x, end if y is None else y)], overlap)),
                        "merges": len({d.get("task") for d in inside if d.get("kind") == "merged"})})
        return {"rollouts": out, "otherHostLinesIgnored": other_host}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        sys.stderr.write("score: %s\n" % message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="score.py", description="Score one rollout's Run record for a Reflection (writes nothing).")
    p.add_argument("--rollout", required=True)
    p.add_argument("--note")
    p.add_argument("--since")
    p.add_argument("--until")
    p.add_argument("--settings")
    p.add_argument("--repo-slug")
    p.add_argument("--repo", help="any directory in the Project root's clone: its git gives reverts and review findings")
    p.add_argument("--tasks-dir", help="the vault's task notes, for fixes: (default ~/repos/obsidian/Work/Tasks)")
    p.add_argument("--out")
    args = p.parse_args(argv)
    try:
        out = Score(args).run()
    except Usage as e:
        sys.stderr.write("score: %s\n" % e)
        return 2
    except Unreadable as e:
        sys.stderr.write("score: %s\n" % e)
        return 1
    text = json.dumps(out, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(text)
        except OSError as e:
            sys.stderr.write("score: cannot write --out %s: %s\n" % (args.out, e))
            return 1
    else:
        sys.stdout.write(text)
    h, ho = out["headline"], out["handsOff"]
    sys.stderr.write("score: %s: hands-off %s (%d of %d), %s merge(s) in %s running h (throughput %s/h%s), %s, "
                     "%d proposal(s), %d withheld\n"
                     % (out["rollout"], "n/a" if ho["rate"] is None else ho["rate"], ho["handsOff"], ho["landed"],
                        h["merges"], h["runningHours"], h["throughput"],
                        ", breached" if out["guardrails"]["throughput"]["breached"] else "",
                        out["binding"]["constraint"], len(out["proposals"]), len(out["withheld"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
