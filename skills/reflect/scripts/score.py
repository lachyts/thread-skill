#!/usr/bin/env python3
"""score.py — score one rollout's Run record for a Reflection (p15-5, ADR 0032; p21-2, ADR 0037 d1). Reads only;
writes nothing.

python >= 3.8, stdlib only. Called by skills/reflect/SKILL.md (step 4) as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/score.py --rollout <slug|[[slug]]|note path> \\
        [--note <rollout note>] [--since TS] [--until TS] [--settings <rollout-settings JSON file|->] \\
        [--repo-slug owner/name] [--out F]

Reads: the rollout's record `<events dir>/<slug>.jsonl` (run_record.py's directory chain), every other
`<slug>.jsonl` there for load (reviews.jsonl and tunings.jsonl are never read as rollouts; only lines from the
scored record's host count, and only where a record's live span overlaps this run's running time, not the window, so
a Reflection run long after the rollout never counts a later rollout; the live span runs to its last line or, while a
Slot it took is open, to --until, flagged, so a busy rollout whose long calls write nothing still counts), tunings.jsonl for the baseline, earlier
Tunings and their agreement, and the rollout note's frontmatter (parallel_ceiling, max_review_rounds,
max_iterations, max_plan_rounds, captured) through reconcile-rollout.py's Note, for the cause labels only. --settings is rollout-settings.py's JSON for
the Project root: each key's resolved value now (a proposal's `from`), the Guardrail bounds, and `path`, whose
mtime feeds the cause labels.

Times. --since and --until take Z or an offset (run_record's `_stamp` rule; a naive stamp is refused) and
everything printed is UTC `Z`. --since defaults to the record's first slot-taken, else its first line;
--until to now (the Reflection's moment). Lines after --until are not read, except `call-journal` lines: fold-journals
stamps them with the fold time (completion, or the Reflection's start), so each is read whatever its ts, and its call's
startTime + durationMs is clamped to --until (a call still running at --until is read as running then). With no
line the score is empty and flagged "no record".

Running time is the time in [since, until] when the run is active and not paused. Active: a Slot is open (to
its effective end, below), or the lane is held with no merge, race or git-env hold open and no Slot open, for
at most LANE_ONLY_CAP of each such stretch of one holding (a pause splits a stretch). Paused spans (paused .. resumed) are excluded; the drain before a
soft pause's stamp counts as running. A hold with no Slot open is a wait on Lachy: excluded, listed by kind.
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
    --until was still running at --until: read as non-terminal with its last activity at --until.
  - Non-terminal: its last activity is startTime + durationMs, else the task's last record line (flagged).
    When last activity + GRACE reaches --until on an open Slot, the Slot runs to --until and the window is
    `partial` (a genuine mid-run tail); otherwise it ends at last activity + GRACE (or its earlier
    slot-freed), flagged "never finished: capped".
  - No journal (or a terminal one without startTime/durationMs): slot-freed, flagged; an open Slot is read as
    a non-terminal call with no durationMs.
- Pairing follows run_record.py's reader rules: one Slot per task, the same lane holding, a hold per (hold,
  task), a pause until resumed, a lane-freed closing the task's merge hold, a `carried` line in its from-file
  closing that task's Slot, lane and holds. A lane, hold or pause still open at the last line read ends there,
  flagged.

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
- Quality: null until p21-4 traces Escapes; `quality.why` says so, and the headline slot carries null.

Scores: Throughput = merges (distinct tasks with a `merged` line in the window, read-only ones included) per
running hour (0.0 with no merge; null with no running time, flagged), now a Guardrail. Slots: the Parallel ceiling
is a step
function over the settings on slot-taken and idle-slots (`ceilingSteps` lists its changes only); full = Slots
in use at or above the ceiling in force. Idle Slot time is labelled by its idle-slots markers (the first
marker labels its idle span from the start, a change of reason splits it), else "unexplained". Lane: busy share, Integrations (lane holdings started in
the window) and each ready -> lane-taken wait. Guardrails: Throughput first (ADR 0037 d1: no longer a headline,
bounded so an overnight run still finishes by morning): breached when running time exceeds `[guardrails]
hours_per_task` (built-in 1.5, a heuristic) times the tasks whose Slot overlaps [since, until] (at least 1),
compared in ms and strictly greater, so a run exactly at its allowance is inside it; never with zero running time;
a breach on a partial window is flagged ("the run's tail has not landed"). Then tokens per merge (the tokens of
every call journal, its latest terminal line else its latest, so a call still running counts what it has spent,
whose call started in the window by its startTime, else its run-bound; integrate calls included; over merges),
set-aside rate (set-asides / (Slots closed + Integrations)), conflict rate (conflicting lane-freed /
Integrations, with the integrator-path share beside it) and quota stalls, against their [guardrails] bounds:
a % rise for tokens, point rises for the two rates (both measured from the baseline) and an absolute count for
stalls. Review churn reads "unknown" and never breaches until p21-3 records review rounds. The baseline is the
`scores` of the tunings.jsonl line for this repo (ignoring case) with the latest
window.activeEnd at or before this window's activeStart, a line not marked partial preferred (a partial one is
used only when no other qualifies, flagged); activeEnd null never qualifies. It carries the line's `v`; a line
whose scores lack the v2 keys (a v1 line, seven scores) is flagged and gives no Hands-off rate, Quality or Review
churn baseline. With none, only quota stalls and Throughput (both absolute) can breach ("no baseline").

Binding, the first that holds: quota-bound (quota stalls >= QUOTA_STALLS); lane-bound (lane busy >=
LANE_BOUND_BUSY of running time, or the waits climbing: the last third's mean over WAIT_CLIMB_RATIO times the
first third's and at least WAIT_CLIMB_MIN minutes); slot-bound (Slots full >= SLOT_BOUND_FULL); dependency-bound
(idle >= DEPENDENCY_IDLE of Slot capacity, dependency plus solo the largest reason); else none-clear.

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
  slot-bound-raise      serves throughput; risks tokensPerMerge, setAsideRate, conflictRate, quotaStalls
  quota-bound-lower     serves quotaStalls; risks throughput
  review-rounds-raise   serves handsOffRate; risks quality, throughput, tokensPerMerge, setAsideRate,
                        conflictRate, quotaStalls, reviewChurn
  plan-rejected-raise   serves handsOffRate; risks quality, throughput, tokensPerMerge, setAsideRate,
                        conflictRate, quotaStalls
weigh(rule, measured) gives every proposal and withheld entry `serves`, `risks` and `trade`: {gains: the headlines
it serves, costs: the headlines it risks and does not serve}, only when both lists are non-empty and every headline
in them is scored (non-null); else null. Quality is null until p21-4, so no trade fires yet. Once p21-4 scores it,
this static table makes both round raises standing trades: whether they stay so (which takes two knob rules out of
ADR 0037 d5's unattended landing) or become evidence-based is Lachy's decision, which p21-4 inherits. Withheld, in
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
direction.

Output: one JSON object (stdout, or --out F): rollout, repo, host, window{since, until, activeStart, activeEnd,
partial}, runningTime{hours, excluded[{kind, start, end, hours, why}], excludedHours{kind: hours}}, merges,
throughput, handsOff{rate, landed, handsOff, tasks[{task, acts[{kind, at, detail}]}], byKind{answer, signOff,
retry, mergeHold, raceDecided}, notCounted{standingApproval, automaticHandBack, raceReverified}, baseline},
quality{value, why}, slots, lane, guardrails{throughput{value, runningHours, tasks, allowanceHours, bound,
baseline, breached}, tokensPerMerge, setAsideRate, conflictRate, quotaStalls, reviewChurn}, load, binding{constraint,
why}, headline (the ten numbers tune.py records, its name kept for tune.py: throughput, runningHours, merges,
tokensPerMerge, setAsideRate, conflictRate, quotaStalls, handsOffRate, quality, reviewChurn), baseline{id,
activeEnd, partial, v, scores}, proposals[{id, key, from, to, ranAt, ranAtCause, rule, direction, evidence,
agreeing, serves, risks, trade, caution}], withheld (the same plus reason), flags, thresholds. stderr gets one
summary line, led by `hands-off R (M of N)`.

Exit codes: 0 scored (a "no record" score included); 1 the record, the events directory, --settings or --note
cannot be read; 2 a usage error, a bad or reserved slug, or a bad TS.
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import os
import pathlib
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
RUN_RECORD_PY = os.path.join(SKILLS, "_shared", "scripts", "run_record.py")
RECONCILE_PY = os.path.join(SKILLS, "execute", "scripts", "reconcile-rollout.py")

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
ROUND_SET_ASIDES = 2             # this many review-rounds (plan-rejected) set-asides -> a round cap +1
EVIDENCE_MAX = 300
# rollout-settings.py's GUARDRAILS_BUILT_IN; hours_per_task (p21-2) is Throughput's absolute bound.
GUARDRAILS_BUILT_IN = {"tokens_per_merge_pct": 25, "set_aside_rate_points": 5, "conflict_rate_points": 10,
                       "quota_stalls": 0, "hours_per_task": 1.5}
KEYS = ("parallel_ceiling", "max_review_rounds", "max_iterations", "max_plan_rounds")
# The human acts' kinds (run_record.py's "Human acts"): never a task's call activity (pair keeps them out of last_line).
ACT_KINDS = ("answer-recorded", "gate-signed", "handed-back", "race-decided")
ACT_NAMES = ("answer", "signOff", "retry", "mergeHold", "raceDecided")
# The two headlines (ADR 0037 d1) and each proposal rule's declared effect: (serves, risks). A heuristic (the header).
HEADLINES = ("handsOffRate", "quality")
OLD_GUARDRAILS = ("tokensPerMerge", "setAsideRate", "conflictRate", "quotaStalls")
RULE_EFFECTS = {
    "slot-bound-raise": (("throughput",), OLD_GUARDRAILS),
    "quota-bound-lower": (("quotaStalls",), ("throughput",)),
    "review-rounds-raise": (("handsOffRate",), ("quality", "throughput") + OLD_GUARDRAILS + ("reviewChurn",)),
    "plan-rejected-raise": (("handsOffRate",), ("quality", "throughput") + OLD_GUARDRAILS),
}
HOLD_WHY = {"merge": "a merge hold with no Slot open (a --gated or exit-7 hold: a wait on Lachy)",
            "race": "a RACE hold with no Slot open (an undecided RACE or its re-verify: a wait on Lachy)",
            "git-env": "a git-env hold with no Slot open (an unacked canary trip: a wait on Lachy)"}


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
    scored in `measured` ({headline: value or None}); else None. Pure."""
    serves, risks = RULE_EFFECTS.get(rule, ((), ()))
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


class Score:
    def __init__(self, args, env=None):
        self.args = args
        self.flags = []
        self.env = os.environ if env is None else env

    def flag(self, text):
        if text not in self.flags:
            self.flags.append(text)

    # ---- the record ------------------------------------------------------------------------------------------

    def pair(self, lines, until):
        """Walk the record's lines up to `until` with run_record's reader rules."""
        self.slots, open_slot = [], {}
        self.holdings, lane = [], None
        self.holds, open_holds = [], {}
        self.pauses, pause = [], None
        self.steps, self.markers, self.merges, self.readies = [], [], [], []
        self.set_asides, self.stalls, self.bound, self.slot_taken = [], [], [], []
        self.journals, self.last_line, self.task_lines = {}, {}, {}
        self.acts, self.hand_back_starts = [], []
        last_t = None
        for t, _n, d in lines:
            kind, task = d.get("kind"), d.get("task")
            if kind == "call-journal" and isinstance(d.get("runId"), str):
                # read whatever its ts: fold-journals stamps the fold time (completion, or the Reflection's start), not
                # the call's; the call's own startTime and durationMs are clamped to --until in slot_ends
                prev = self.journals.get(d["runId"])
                if prev is None or prev.get("status") not in RR.TERMINAL_STATUSES or \
                        d.get("status") in RR.TERMINAL_STATUSES:
                    self.journals[d["runId"]] = d
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
            elif kind == "carried" and task and d.get("rollout") == d.get("from"):
                if task in open_slot:
                    s = open_slot.pop(task)
                    s["end"], s["outcome"] = t, "carried"
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
                self.merges.append((t, task))
            elif kind == "ready" and task:
                self.readies.append((t, task))
            elif kind == "set-aside" and task:
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
            hi = s["end"] if s["end"] is not None else until
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
        self.run_ms = total(self.run_iv)

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

    def slots_score(self, since, until):
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
            segs.append((a, b, running, n, self.ceiling_at(a)))
        weight, last_seen = {}, {}
        full = used = cap = 0
        idle = {}
        span, label = [], None  # the open idle span's (slot-ms) pieces awaiting a label, and its reason
        markers = sorted(self.markers)

        def close_span():
            for ms in span:
                idle["unexplained"] = idle.get("unexplained", 0) + ms
            span.clear()

        for a, b, running, n, c in segs:
            if c is None:
                continue
            weight[c] = weight.get(c, 0) + running
            if running:
                last_seen[c] = a
            free = max(c - n, 0)
            if running == 0 or free == 0:
                close_span()
                label = None
                if running:
                    full += running if n >= c else 0
                    used += min(n, c) * running
                    cap += c * running
                continue
            used += min(n, c) * running
            cap += c * running
            here = [r for t, r in markers if a <= t < b]
            for r in here:
                if label is None:
                    for ms in span:
                        idle[r] = idle.get(r, 0) + ms
                    span.clear()
                    label = r
                elif r != label:
                    label = r
            if label is None:
                span.append(free * running)
            else:
                idle[label] = idle.get(label, 0) + free * running
        close_span()
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
        self.idle, self.idle_total, self.capacity = idle, idle_total, cap

    # ---- the lane ----------------------------------------------------------------------------------------------

    def lane_score(self, since, until):
        rt = self.run_ms
        busy = total(intersect(self.lane_iv, self.run_iv))
        started = [h for h in self.holdings if since <= h["start"] <= until]
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
        freed = [h for h in started if h["end"] is not None]
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
            act = None
            if kind == "answer-recorded":
                how = [x for x in (d.get("form"), "raise %s" % d["raise"] if d.get("raise") else None,
                                   "pr" if d.get("pr") is True else None) if x]
                act = ("answer", "%s answer%s" % (d.get("answerKind"), " (%s)" % "; ".join(how) if how else ""))
            elif kind == "gate-signed":
                if d.get("standing") is True:
                    not_counted["standingApproval"] += 1
                else:
                    act = ("signOff", "%s gate(s) signed off" % d.get("gates"))
            elif kind == "handed-back":
                if d.get("via") == "retry":
                    act = ("retry", "handed back with no answer (%s arm)" % d.get("arm"))
                elif d.get("via") == "descope":
                    not_counted["automaticHandBack"] += 1
            elif kind == "auto-retry":
                not_counted["automaticHandBack"] += 1
            elif kind == "race-decided":
                decided.add(task)
                act = ("raceDecided", "%s decided, acted on by %s" % (d.get("mark"), d.get("by")))
            if act:
                acts[task].append((t, act[0], act[1]))
        for h in self.holds:
            if h["hold"] == "merge" and inside(h["task"], h["start"]):
                acts[h["task"]].append((h["start"], "mergeHold", "a merge hold to %s (a --gated or exit-7 hold: the "
                                                                  "record carries no reason)" % fmt(h["end"])))
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
        path = os.path.join(base, RR.TUNINGS + ".jsonl")
        self.tunings = []
        if not os.path.exists(path):
            return
        try:
            lines, _skipped = read_lines(path)
        except OSError as e:
            self.flag("tunings.jsonl cannot be read (%s): no baseline, no earlier Tunings" % e)
            return
        voided = {d.get("voids") for _t, _n, d in lines if d.get("kind") == "tuning" and isinstance(d.get("voids"), str)}
        for t, _n, d in lines:
            if d.get("kind") != "tuning" or not isinstance(d.get("repo"), str):
                continue
            d = dict(d)
            d["_t"] = t
            d["_voided"] = d.get("id") in voided
            self.tunings.append(d)

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
        self.read_tunings(base)
        rt = self.run_ms
        act_start = self.run_iv[0][0] if self.run_iv else None
        act_end = self.run_iv[-1][1] if self.run_iv else None
        merged = sorted({task for t, task in self.merges if since <= t <= until})
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
        headline = {"throughput": throughput, "runningHours": hours(rt), "merges": n_merges, "tokensPerMerge": tpm,
                    "setAsideRate": sa_rate, "conflictRate": conflict, "quotaStalls": stalls,
                    "handsOffRate": hands_off["rate"], "quality": None, "reviewChurn": None}
        base_line = self.baseline(repo, act_start)
        if base_line is None and repo is not None:
            self.flag("no baseline: no earlier Reflection on %s ended before this run began; only quota stalls and "
                      "Throughput can withhold a raise" % repo)
        hands_off["baseline"] = ((base_line or {}).get("scores") or {}).get("handsOffRate")
        guard = self.guardrails(headline, base_line, settings, since, until)
        out.update({
            "window": {"since": fmt(since), "until": fmt(until), "activeStart": fmt(act_start),
                       "activeEnd": fmt(act_end), "partial": self.partial},
            "runningTime": {"hours": hours(rt), "excluded": self.excluded, "excludedHours": self.excluded_hours},
            "merges": {"count": n_merges, "tasks": merged},
            "throughput": throughput,
            "handsOff": hands_off,
            "quality": {"value": None, "why": "not scored yet: Escapes are traced by p21-4"},
            "slots": self.slot_metrics,
            "lane": dict(self.lane_metrics, integratorShare=integ_share),
            "guardrails": guard,
            "load": self.load(base, slug, host, since, until),
            "headline": headline,
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

    def guardrails(self, headline, base_line, settings, since, until):
        bounds = dict(GUARDRAILS_BUILT_IN)
        g = (settings or {}).get("guardrails")
        if isinstance(g, dict):
            for k in bounds:
                v = g.get(k, {}).get("value") if isinstance(g.get(k), dict) else None
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    bounds[k] = v
        bs = (base_line or {}).get("scores") or {}

        def rise(value, base, points):
            if value is None or not isinstance(base, (int, float)) or isinstance(base, bool):
                return None if value is None or base is None else False
            return (value - base) * 100 > points

        tpm, tbase = headline["tokensPerMerge"], bs.get("tokensPerMerge")
        t_breach = None
        if tpm is not None and isinstance(tbase, (int, float)) and not isinstance(tbase, bool) and tbase > 0:
            t_breach = tpm > tbase * (1 + bounds["tokens_per_merge_pct"] / 100.0)
        # Throughput's absolute bound: hours_per_task running hours for each task whose Slot overlaps the window.
        # Compared in ms and strictly greater: a run exactly at its allowance is inside it (the (i) round-cap
        # fixtures in tests/reflect-score.test.mjs sit on the bound and rely on this), and zero running time never
        # breaches.
        tasks = len({s["task"] for s in self.slots if s["start"] <= until and (s["end"] is None or s["end"] >= since)})
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
            # p21-3 records review rounds; until then Review churn is unknown and never breaches
            "reviewChurn": {"value": "unknown", "bound": None, "baseline": bs.get("reviewChurn"), "breached": False},
        }
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
        if self.capacity and self.idle_total / self.capacity >= DEPENDENCY_IDLE:
            dep = self.idle.get("dependency", 0) + self.idle.get("solo", 0)
            others = [v for k, v in self.idle.items() if k not in ("dependency", "solo")]
            if dep > 0 and dep >= max(others or [0]):
                return {"constraint": "dependency-bound", "why": "free Slots %d%% of capacity, mostly waiting on "
                        "dependencies or a Solo task" % round(self.idle_total * 100 / self.capacity)}
        return {"constraint": "none-clear", "why": "no rule held"}

    def ran_at_cap(self, key, since, until):
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
                ran_at, spread = self.ran_at_cap(key, since, until)
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
        n = 0
        for d in self.tunings:
            if d["_voided"] or d["repo"].lower() != self.repo.lower():
                continue
            for e in d.get("applied") or []:
                if not isinstance(e, dict) or e.get("key") != key or e.get("rule") != rule:
                    continue
                if isinstance(e.get("to"), int) and isinstance(e.get("from"), int) and \
                        _sign(e["to"] - e["from"]) == direction:
                    n += 1
        return n

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
