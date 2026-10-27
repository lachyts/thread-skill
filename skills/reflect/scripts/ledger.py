#!/usr/bin/env python3
"""ledger.py — the Time-lost ledger (p29-11, ADR 0051). This docstring is the one copy of its model.

python >= 3.9, stdlib only (zoneinfo, for the Melbourne month). skills/reflect/scripts/reflect.py loads it by path, as it
loads grades.py: span's `ledger` block, the `ledger` verb, decide, close and Span.moved_by's set-aside mover. It loads
score.py and run_record.py by path, reads only and writes nothing but --out. The CLI is for tests and by-hand reads:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/ledger.py --since TS --until TS [--tasks-dir D] [--out F]

It reads every <slug>.jsonl in run_record's events directory (the reserved files aside) and reflections.jsonl's
`time-lost` and `watch` lines, and prints rows()'s block (stdout, or --out F). A rollout is live while its note
(<tasks dir>/<slug>.md, default ~/repos/obsidian/Work/Tasks) is not archived and its status is none of CLOSED, and
serial while its note (there, else under <tasks dir>/Archive/Rollouts) says `shape: serial` (note_live and note_serial);
span passes the same rules as its `live(slug)` and `serial(slug)` callbacks, so this module reads no vault itself.

The model. The ledger prices the hours each cause class cost, ranked by cause, never by rollout.

- Unit. A class is measured in hours of the resource its cause holds up, per rollout, then summed across rollouts: a stop,
  a sign-off pause and a not-running wait hold the whole rollout, a hold and the lane hold the lane, a plan thrown away
  holds a Slot and a suite a verify slot. So one Mac-wide stop across four rollouts counts four times (ADR 0048 measures
  rollout time too), and the classes overlap across resources. Within one class a rollout's overlapping intervals count
  once.
- The record as score.py reads it. Per rollout, Score.pair, slot_ends and running run on the record minus LEDGER_KINDS,
  exactly as score.py does, so running time (run_iv), the Slots' active intervals and the lead-absent and never-finished
  gaps are the score's own; its union, intersect, subtract and total are reused, never copied. The LEDGER_KINDS lines are
  read beside them: stop_spans() (run_record's stop model) and the suites, paired by `suite`.
- Which records. A serial chain (`shape: serial`, ADR 0040; the `serial(slug)` callback) is left out whole, flagged when
  it is live or has a line in the window: its Legs record no Slots and no stops (record-entry and the stop driver skip a
  serial note), so its record holds Lachy's acts and a Leg's suites alone, while its note stays open until its Leg's
  Complete, and a live span over it would price the chain's whole life as stalls/unexplained.
- The live span runs from the record's first engine line (ENGINE_KINDS: a Slot, a lane, a hold, an idle-slots marker, a
  stop, a lead-entry or a suite; never an act, a pause or a `carried` line, which a supersede's carry writes to the new
  rollout's record at schedule time, before it runs) to until while the rollout is live, else to the record's last line
  (a call-journal, review-verdict or night-record line is never the last: each is written after the fact), clipped to
  [since, until]. A record with no engine line yet prices nothing (flagged when it has a line in the window). An
  interval still open at the record's last line runs to that end, until on a live rollout, and is flagged either way
  (score.py's open-interval flags, and one per open stop).
- Pauses. Lachy's own pause (`paused` mode soft or hard .. `resumed`) is subtracted from every class and reported in
  `other` as `pause`. A sign-off pause is not his pause: run_record's catalogue and ADR 0034 make it the queue closed with
  only gates left, so it is priced as stalls/gate.
- Precedence for rollout hours, first match: stops (a mac-sleep owns its overlap with another stop); the sign-off pause;
  the holds (git-env, then merge, then race); the not-running remainder's labels.

The classes are ADR 0051's six (run_record.py's TIME_LOST_CLASSES and per-class TIME_LOST_CAUSES, the schema's one copy),
keyed by the record's own values where one fits:

- stalls, by cause:
  - stop spans of dead-lead, mac-restart, mac-sleep and watchdog;
  - halt spans, split by HALT_WAITS on the halt's reason prefix (execute § 7's wording, which hooks/rollout-stop-driver.py
    writes verbatim): `nothing can start:` is a wait on set-aside tasks, classed by the wait's mover (below); `RACE
    undecided:` and `UNVERIFIED undecided:` go to hold-race; `git-env trip:` and `git-env canary failed` to hold-git-env;
    `awaiting sign-off:` to gate (a fallback: the driver writes no stop while the sign-off pause stands); any other reason
    (an engine or settings halt, an older snapshot's wording) stays halt;
  - the sign-off pause, less stops: gate;
  - the holds hold-git-env, hold-merge and hold-race, paired by Score.pair, priced in full (Slots running or not: they hold
    the lane), less stops and pauses;
  - the not-running remainder: the live span less running time, the lane holdings, stops, pauses and holds, labelled,
    first match, by score.py's lead-absent and never-finished gaps, then by the idle-slots markers on score.py's rule (the
    first marker in a stretch labels it from its start; a change of reason splits it): hold-trickle and hold-away-cap
    (and a hold-merge, hold-git-env or hold-race marker no hold pairs) are stalls; awaiting-hand-back is classed by the
    wait's mover; hold-heat is load; the rest are `other`; no marker at all is stalls/unexplained: a live rollout with
    nothing running and no recorded cause, the audit's first lead, and where a lead's own unrecorded question shows.
- The wait's mover (run_record's idle-slots rule): the first slot-taken after the wait's start whose start is revise,
  hand-back or resume. A revise ends it as other/revise (the known seeded-revise mislabel). Otherwise its task's latest
  set-aside at or before the wait's start, and that set-aside's first mover (first_mover(), Span.moved_by's one copy, so
  the friction's movedBy is byte-equal), decide the cause: auto-retry is a cool-down, quota-bound/cool-down when its
  retryClass is quota or that set-aside's reasonClass is quota (the quota-stall beside it), else stalls/cool-down (infra
  and transient; an agent retry has none); gate-signed is stalls/gate; answer-recorded, or handed-back via answer, is
  stalls/question; handed-back via retry or descope, race-decided, carried, or an unrecorded mover (a slot-taken,
  lane-taken or merged first, flagged) is stalls/hand-back. With no mover yet (still waiting at the span's end), the
  rollout's latest unmoved set-aside's reasonClass decides, flagged `still waiting`: gate is gate, needs-human question,
  quota quota-bound/cool-down, transient or call-failed stalls/cool-down, anything else hand-back. A wait over set-asides
  of different reasonClasses is classed by the first one moved, flagged.
- quota-bound: usage-limit stop spans (cause usage-limit) and the quota cool-downs above (cool-down); quota-stall lines are
  counted as events. Here the call-level stalls go: ADR 0051's three missed stops out of nine.
- load: not-running stretches labelled hold-heat; each suite's verify-slot `waited` (slot-wait: the wait before its
  suite-started, or before a noslot or heat suite-ended that never started); and the run of a suite that ended heat or
  timeout (heat, timeout).
- lane-bound: the lane holdings, less every stall span of the rollout (stops, the sign-off pause, holds), pauses and the
  rework suites.
- rework: every race suite's run, and every integration suite after the task's first in its record (its first is never
  rework, even when it ran before since); base-moved lines are counted as events, with their inertOnly.
- plan-rejected: for each plan-rejected set-aside, the time from the task's latest slot-taken at or before it to the
  set-aside: the Slot hours of a plan thrown away. needs-human is no class of its own: a question throws no work away,
  and it holds rollout hours only when nothing else can run, which is exactly when its halt or wait is stalls/question.
- other (unranked, never a Watch): pause, pause-drain, dependency, solo, queue-tail, hold-last-start, hold-pr, revise.

A suite runs from its suite-started to its suite-ended (or its seconds before a suite-ended with no start); one with no
end is priced 0 and counted (`suite-unfinished`). Completion suites belong to no class. Which records are read: every
record whose live span reaches the window, a stopped rollout with no line in the window included, a serial chain's aside.

Ranking, top and streak. The ranking is by milliseconds, ties broken by TIME_LOST_CLASSES' order (a tie at the top is
flagged); the top is the first class with hours above zero, else null; the streak is the run of consecutive `record`
lines, ending with this row, that share its top (0 with no top).

The block (rows()): row (the `time-lost` record line `ledger` writes: hours per class, top, byCause, rollouts (at most 8
[slug, hours] per class), other, events, streak, month), previous and delta (against the latest earlier record line only,
week against week), weeks (up to 8 of the latest record and audit lines, oldest first, this row last: {source,
reflection, since, until, hours, top} for a record line, {..., rank, recorded, missed} for an audit line, missed per
class found / (found + recorded)), streak, watch (the preview: class, id, rule, shape, rollouts, sighted), baseline
(BASELINE) and flags. Audit lines never move the top, the streak, the Watch or tune.py's load hold: those read
`source: record` lines only, since an audit's window spans weeks and its hours come from intervals the model reconciled
from evidence, while the Watch and the hold rest on hours a script sums from the record (ADR 0051 d1). What only the
audit sees reaches Lachy through its row in weeks, its gap line and the task a yes files.

The Watch (sighted()): a class sighted tops this record row and either topped the previous record row too or already has
a `watch` line for its id; reflect.py `ledger` then writes one watch line, rule WATCH_RULE, shape `<words> tops the
Time-lost ledger`, ledgerClass the class, rollouts its top contributors (at most 64), count 1. The baseline is no reading,
so it never counts toward "two running".

The baseline is BASELINE, the 2026-10-21 audit (ADRs 0044 § Deferred, 0048 and 0051, each figure cited), October's.

The Monthly audit (audit_due(), audit_window()). The reading's month is the Australia/Melbourne calendar month of until.
It is due when no `time-lost` audit or baseline line has that month (BASELINE counts as 2026-10's before its line is
written, so no October reading audits, and the first audit is November's first reading) and until is after the window's
start. The window runs from the latest until among the audit and baseline lines (BASELINE's before any audit) to until,
never cut at a month boundary, so no hour falls between two audits; its month is the reading's. A month with no reading
leaves the next reading's month to audit, its window starting at the last audit's until; the fortnightly cadence takes
the same rule, and a second reading in a month is not due. recorded is rows() over the audit window (it may overlap the
weekly rows inside it, harmless, since an audit row is never summed with a record row). audit_line() checks audit.json:
the month; each entry's class and cause, rollout, from .. to inside the window and overlapping no known interval of the
same rollout and class (overlaps()); the caps (MAX_AUDIT_ENTRIES, MAX_AUDIT_GAPS; text folded and cut); and the line's
own size (run_record's line_bytes(), as emit would write it here): one over MAX_LINE, which text JSON escapes can reach
(a non-ASCII character takes 6 bytes or more), is refused, `trim entries or their text`, before anything is written. Each
entry's hours come from its from .. to (audit_hours()): the model never types a number. Its gaps never count against a
reading's `quiet` (run_record's cadence rule).

Exit codes (the CLI): 0 written; 1 the events directory or --out cannot be read or written; 2 usage or a bad stamp; 3 no tz
data (`python3 -m pip install tzdata`).
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
RUN_RECORD_PY = os.path.join(SKILLS, "_shared", "scripts", "run_record.py")
SCORE_PY = os.path.join(HERE, "score.py")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", RUN_RECORD_PY)
SCORE = _load("thread_score", SCORE_PY)

ZONE = "Australia/Melbourne"
HOUR = SCORE.HOUR
DAY_MS = 24 * HOUR
CLASSES = RR.TIME_LOST_CLASSES
CAUSES = RR.TIME_LOST_CAUSES
OTHER = RR.TIME_LOST_OTHER
CLOSED = ("done", "merged", "dropped", "superseded")   # a rollout note at one of these is not live
MAX_WATCH_ROLLOUTS = RR.MAX_ROLLOUTS
union, intersect, subtract, total, fmt, hours = SCORE.union, SCORE.intersect, SCORE.subtract, SCORE.total, SCORE.fmt, \
    SCORE.hours
# Lines written after the fact, never a record's last line (score.py's pair keeps them out of last_t too).
NOT_TAIL = ("call-journal", "review-verdict") + SCORE.NIGHT_KINDS
# The lines the engine writes as it runs a rollout: the first starts its live span. Never an act (answer-recorded,
# gate-signed, handed-back, race-decided), a pause, or a `carried` line, which a supersede's carry writes at schedule time.
ENGINE_KINDS = ("slot-taken", "slot-freed", "run-bound", "lane-taken", "lane-freed", "hold-started", "hold-ended",
                "idle-slots", "stopped", "lead-entry", "suite-started", "suite-ended")
SENTINEL = "time-lost-span-end"

# A halt's reason prefix (execute § 7's `reason="..."`, the stop driver's verbatim copy) -> its stalls cause; None is a
# wait on set-aside tasks, classed by its mover. tests/reflect-ledger.test.mjs pins each against execute's SKILL § 7.
HALT_WAITS = (("nothing can start:", None), ("RACE undecided:", "hold-race"), ("UNVERIFIED undecided:", "hold-race"),
              ("git-env trip:", "hold-git-env"), ("git-env canary failed", "hold-git-env"),
              ("awaiting sign-off:", "gate"))
# The idle-slots reasons a not-running stretch takes as a stall (a hold marker no hold-started pairs included).
STALL_MARKERS = ("hold-trickle", "hold-away-cap", "hold-merge", "hold-git-env", "hold-race")
# A still-waiting wait's set-aside reasonClass -> (class, cause); anything else is stalls/hand-back.
STILL_WAITING = {"gate": ("stalls", "gate"), "needs-human": ("stalls", "question"), "quota": ("quota-bound", "cool-down"),
                 "transient": ("stalls", "cool-down"), "call-failed": ("stalls", "cool-down")}
WAIT_STARTS = ("revise", "hand-back", "resume")

# The set-aside mover rule (moved here from reflect.py, p29-11: one copy; Span.moved_by delegates to first_mover).
MOVERS = ("auto-retry", "handed-back", "answer-recorded", "gate-signed", "race-decided", "carried", "slot-taken",
          "lane-taken", "merged")
UNRECORDED_MOVERS = ("slot-taken", "lane-taken", "merged")
SLOT_STARTS = ("start", "restart", "revise", "hand-back", "resume")  # run_record's slot-taken `start`

WATCH_RULE = "ADR 0051: a class that tops the Time-lost ledger two readings running"
CLASS_WORDS = {"stalls": "stalls", "quota-bound": "usage limits", "load": "machine load",
               "lane-bound": "the Integration lane", "rework": "Integration rework", "plan-rejected": "plan blocks"}
WEEKS = 8

_B_SINCE, _B_UNTIL = "2026-08-31T14:00:00.000Z", "2026-10-21T13:00:00.000Z"
_B_RANGES = [
    {"what": "stalls, usage limits and machine load", "classes": ["stalls", "quota-bound", "load"], "low": 150,
     "high": 185, "cite": "ADR 0048 Context"},
    {"what": "real merge time in the Integration lane", "classes": ["lane-bound"], "low": 35, "high": 50,
     "cite": "ADR 0048 Context"},
]
# The 2026-10-21 audit (ADR 0048's Context, ADR 0044 § Deferred, ADR 0051's Context): Melbourne 1 September to the end of
# 21 October, October's. Each figure cited; its causes are this model's names for what the audit found.
BASELINE = {
    "id": "tl-baseline-2026-10", "source": "baseline", "month": "2026-10", "since": _B_SINCE, "until": _B_UNTIL,
    "top": "stalls",
    "ranges": _B_RANGES,
    "cites": [
        {"what": "a bypass-proof rm prompt", "hours": 13, "class": "stalls", "causes": ["unexplained"],
         "cite": "ADR 0048 Context"},
        {"what": "the lead's own question", "hours": 12, "class": "stalls", "causes": ["question", "unexplained"],
         "cite": "ADR 0048 Context"},
        {"what": "a paused: stamp", "hours": 17, "class": "other", "causes": ["pause"], "cite": "ADR 0048 Context"},
        {"what": "a spend gate", "hours": 14, "class": "stalls", "causes": ["gate"], "cite": "ADR 0048 Context"},
        {"what": "a false git-env trip", "hours": 15, "class": "stalls", "causes": ["hold-git-env"],
         "cite": "ADR 0048 Context"},
        {"what": "a plan-size ruling", "hours": 6, "class": "stalls", "causes": ["question"], "cite": "ADR 0048 Context"},
        {"what": "a 03:10 restart", "hours": None, "class": "stalls", "causes": ["mac-restart"],
         "cite": "ADR 0048 Context"},
        {"what": "chorus-rollout-2026-10-18: an overnight git-env halt", "hours": 15.2, "class": "stalls",
         "causes": ["hold-git-env"], "cite": "ADR 0044 Deferred"},
        {"what": "chorus-rollout-2026-10-18: usage limits", "hours": 0.7, "class": "quota-bound",
         "causes": ["usage-limit"], "cite": "ADR 0044 Deferred"},
        {"what": "chorus-rollout-2026-10-18: a busy lane", "hours": 6.6, "class": "lane-bound", "causes": ["lane"],
         "cite": "ADR 0044 Deferred"},
        {"what": "a stall-free stretch: 1.15 PRs merged an hour against 0.76 approvals an hour", "mergedPerHour": 1.15,
         "approvalsPerHour": 0.76, "class": "lane-bound", "cite": "ADR 0044 Deferred"},
        {"what": "usage-limit stops the Run record did not trace", "missed": 3, "of": 9, "class": "quota-bound",
         "cite": "ADR 0051 Context"},
        {"what": "the Mac at load 149 on 16 October while a reading proposed a Parallel ceiling raise", "loadAverage": 149,
         "class": "load", "cite": "ADR 0051 Context"},
        {"what": "the largest share: overnight stalls, the whole queue waiting on one thing", "class": "stalls",
         "cite": "ADR 0048 Context"},
    ],
}


def _per_week():
    weeks = (SCORE.to_ms(_B_UNTIL) - SCORE.to_ms(_B_SINCE)) / (7 * DAY_MS)
    return {"weeks": round(weeks, 2), "ranges": [{"classes": r["classes"], "low": round(r["low"] / weeks, 1),
                                                  "high": round(r["high"] / weeks, 1)} for r in _B_RANGES]}


BASELINE["perWeek"] = _per_week()


# ---- time --------------------------------------------------------------------------------------------------------

_TZ = []


def zone():
    """Australia/Melbourne (a ZoneInfo); ImportError or ZoneInfoNotFoundError when there is no tz data."""
    if not _TZ:
        from zoneinfo import ZoneInfo
        _TZ.append(ZoneInfo(ZONE))
    return _TZ[0]


def mmonth(ms):
    """The Melbourne calendar month (YYYY-MM) of an instant in ms."""
    return datetime.datetime.fromtimestamp(ms / 1000.0, tz=zone()).strftime("%Y-%m")


def _ms(stamp, default=None):
    try:
        return SCORE.to_ms(stamp) if isinstance(stamp, str) else default
    except Exception:
        return default


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def fold(text, cap):
    return " ".join(str(text or "").split())[:cap]


# ---- the set-aside mover ------------------------------------------------------------------------------------------

def first_mover(lines, i, task, until):
    """(movedBy, mover, t, line) of the set-aside at lines[i] (the record's (ms, n, line) list, read by ts): the first
    later MOVERS line of its task at or before `until`. movedBy is its kind (`handed-back (via <via>)` for a hand-back), or
    `unrecorded` when a slot-taken, lane-taken or merged comes first with no act or retry before it; mover is {kind, at,
    start?} of that line (start on a slot-taken only), else None. All None while the task is still set aside. A `carried`
    in the to-file is the from-file's copy and never moves it. Span.moved_by is this, its first two."""
    for t, _n, d in lines[i + 1:]:
        if t > until:
            break
        if d.get("task") != task or d.get("kind") not in MOVERS:
            continue
        kind = d["kind"]
        if kind == "carried" and d.get("rollout") != d.get("from"):
            continue  # the to-file's copy: the from-file's line moved it
        if kind in UNRECORDED_MOVERS:
            mover = {"kind": kind, "at": fmt(t)}
            if kind == "slot-taken" and d.get("start") in SLOT_STARTS:
                mover["start"] = d["start"]
            return "unrecorded", mover, t, d
        if kind == "handed-back":
            return "handed-back (via %s)" % d.get("via"), None, t, d
        return kind, None, t, d
    return None, None, None, None


def mover_cause(moved, line, reason_class):
    """(class, cause) of a wait its set-aside's first mover ended (the module docstring's wait rule)."""
    if moved == "auto-retry":
        quota = (line or {}).get("retryClass") == "quota" or reason_class == "quota"
        return ("quota-bound", "cool-down") if quota else ("stalls", "cool-down")
    if moved == "gate-signed":
        return "stalls", "gate"
    if moved in ("answer-recorded", "handed-back (via answer)"):
        return "stalls", "question"
    return "stalls", "hand-back"


def classify_wait(base, a, b, hi):
    """(class, cause, flag or None) of a wait on set-aside tasks from a to b (ms), read from the record's base lines up to
    hi: the wait's mover, or with none yet its latest unmoved set-aside (the module docstring's rule)."""
    first = None
    for t, _n, d in base:
        if t <= a:
            continue
        if t > hi:
            break
        if d.get("kind") == "slot-taken" and d.get("start") in WAIT_STARTS:
            first = (t, d)
            break
    if first is not None and first[1].get("start") == "revise":
        return "other", "revise", None
    standing = {}  # task -> (t, reasonClass) of its latest set-aside at or before a that nothing moved by a
    latest = {}    # task -> index of its latest set-aside at or before a
    for i, (t, _n, d) in enumerate(base):
        if t > a:
            break
        if d.get("kind") == "set-aside" and isinstance(d.get("task"), str):
            latest[d["task"]] = i
    for task, i in latest.items():
        _m, _mv, mt, _d = first_mover(base, i, task, hi)
        if mt is None or mt > a:
            standing[task] = (base[i][0], base[i][2].get("reasonClass"))
    mixed = sorted({str(rc) for _t, rc in standing.values()})
    if first is not None:
        task = first[1].get("task")
        i = latest.get(task)
        if i is None:
            return "stalls", "hand-back", "no set-aside of [[%s]] at or before the wait: read as a hand-back" % task
        moved, _mover, _mt, line = first_mover(base, i, task, hi)
        rc = base[i][2].get("reasonClass")
        cls, cause = mover_cause(moved, line, rc)
        flag = None
        if moved == "unrecorded":
            flag = "[[%s]] moved on with no recorded mover: read as a hand-back" % task
        if len(mixed) > 1:
            flag = "a wait over set-asides of different reasonClasses (%s) is classed by the first moved ([[%s]], %s)" % (
                ", ".join(mixed), task, rc)
        return cls, cause, flag
    unmoved = []
    for i, (t, _n, d) in enumerate(base):
        if t > b:
            break
        if d.get("kind") == "set-aside" and isinstance(d.get("task"), str) and first_mover(base, i, d["task"], hi)[0] is None:
            unmoved.append((t, d))
    if not unmoved:
        return "stalls", "hand-back", "still waiting with no set-aside standing: read as a hand-back"
    t, d = unmoved[-1]
    rc = d.get("reasonClass")
    cls, cause = STILL_WAITING.get(rc, ("stalls", "hand-back"))
    return cls, cause, "still waiting: [[%s]]'s %s set-aside at %s has no mover yet" % (d.get("task"), rc, fmt(t))


def halt_cause(reason):
    """A halt's stalls cause from its reason prefix (HALT_WAITS), None for a wait classed by its mover, else `halt`."""
    text = (reason or "").strip()
    for prefix, cause in HALT_WAITS:
        if text.startswith(prefix):
            return cause
    return "halt"


# ---- the stop model and the suites -----------------------------------------------------------------------------------

def stop_spans(lines, hi):
    """Every `stopped` line as {cause, start, end, open, reason, inferred} by run_record's stop model: a stop starts at its
    `at`, else its ts; a mac-sleep ends at its wake; any other at the first of the next lead-entry, the next non-sleep
    stop's start and the next paused line, else the next slot-taken, lane-taken or run-bound, else it stays open and runs
    to hi. (A sleep's ownership of its overlap is the caller's.)"""
    entries, pauses, takes, nonsleep, stops = [], [], [], [], []
    for t, _n, d in lines:
        kind = d.get("kind")
        if kind == "lead-entry":
            entries.append(t)
        elif kind == "paused":
            pauses.append(t)
        elif kind in ("slot-taken", "lane-taken", "run-bound"):
            takes.append(t)
        elif kind == "stopped":
            s = _ms(d.get("at"), t)
            stops.append((s, t, d))
            if d.get("cause") != "mac-sleep":
                nonsleep.append(s)
    out = []
    for s, t, d in sorted(stops, key=lambda x: (x[0], x[1])):
        if d.get("cause") == "mac-sleep":
            e = _ms(d.get("wake"))
        else:
            nxt = [x for x in entries + nonsleep + pauses if x > s]
            e = min(nxt) if nxt else None
            if e is None:
                nxt = [x for x in takes if x > s]
                e = min(nxt) if nxt else None
        out.append({"cause": d.get("cause"), "start": s, "end": hi if e is None else max(e, s), "open": e is None,
                    "reason": d.get("reason") if isinstance(d.get("reason"), str) else "",
                    "inferred": d.get("inferred") is True})
    return out


def pair_suites(lines):
    """[{suite, by, task, start, end, outcome, seconds, waited}] paired by `suite`, in first-line order; start or end None
    for a suite with no suite-started (a noslot or a heat) or no suite-ended (it never finished)."""
    by, order = {}, []
    for t, _n, d in lines:
        kind = d.get("kind")
        if kind not in ("suite-started", "suite-ended") or not isinstance(d.get("suite"), str):
            continue
        su = by.get(d["suite"])
        if su is None:
            su = {"suite": d["suite"], "by": d.get("by"), "task": d.get("task"), "start": None, "end": None,
                  "outcome": None, "seconds": None, "waited": None}
            by[d["suite"]] = su
            order.append(su)
        if kind == "suite-started" and su["start"] is None:
            su["start"] = t
            if _num(d.get("waited")):
                su["waited"] = d["waited"]
        elif kind == "suite-ended" and su["end"] is None:
            su["end"], su["outcome"] = t, d.get("outcome")
            su["seconds"] = d.get("seconds") if _num(d.get("seconds")) else None
            if su["waited"] is None and _num(d.get("waited")):
                su["waited"] = d["waited"]
    return order


def run_span(su):
    """A suite's run as [(a, b)]: suite-started .. suite-ended, else its seconds before a suite-ended; [] with no end."""
    if su["end"] is None:
        return []
    if su["start"] is not None:
        return [(su["start"], max(su["start"], su["end"]))]
    secs = su["seconds"] or 0
    return [(su["end"] - int(round(secs * 1000)), su["end"])]


# ---- one rollout ---------------------------------------------------------------------------------------------------

class Measure:
    """One rollout's priced intervals: iv {(class or "other", cause): [(a, b)]}, events, flags and the audit's leads."""

    def __init__(self, slug):
        self.slug = slug
        self.iv, self.events, self.flags, self.leads = {}, {}, [], []

    def add(self, cls, cause, iv):
        iv = [(a, b) for a, b in iv if b > a]
        if iv:
            self.iv.setdefault((cls, cause), []).extend(iv)

    def lead(self, kind, iv):
        for a, b in iv:
            if b > a:
                self.leads.append({"rollout": self.slug, "kind": kind, "from": fmt(a), "to": fmt(b), "hours": hours(b - a)})

    def flag(self, text):
        text = "[[%s]]: %s" % (self.slug, text)
        if text not in self.flags:
            self.flags.append(text)

    def count(self, name, n=1):
        self.events[name] = self.events.get(name, 0) + n


def measure(slug, lines, since, until, is_live):
    """One record's Measure over [since, until] (ms), or None when its live span misses the window. `lines` is the whole
    record, (ms, n, line) in time then file order, the LEDGER_KINDS lines included."""
    if not lines:
        return None
    base = [x for x in lines if x[2].get("kind") not in SCORE.LEDGER_KINDS]
    engine = next(((t, d.get("kind")) for t, _n, d in lines if d.get("kind") in ENGINE_KINDS), None)
    if engine is None:  # acts or carried lines alone: the rollout has not run (a superseding one before its first Slot)
        if not any(since <= t <= until for t, _n, _d in lines):
            return None
        m = Measure(slug)
        m.flag("no engine line yet (acts or carried lines alone): nothing priced")
        return m
    start = engine[0]
    tail = [t for t, _n, d in lines if d.get("kind") not in NOT_TAIL]
    last = max(tail) if tail else lines[-1][0]
    lo, hi = max(since, start), (until if is_live else min(until, last))
    if hi <= lo:
        return None
    m = Measure(slug)
    sc = SCORE.Score(None, {})
    sc.pair(base + [(hi, float("inf"), {"kind": SENTINEL})], hi)
    sc.slot_ends(hi)
    sc.running(lo, hi)
    for f in sc.flags:
        if "at the last line read" in f:
            m.flag(f + (": the rollout is live, so it runs to until" if is_live else ""))
    W = [(lo, hi)]

    def win(iv):
        return intersect(union(iv), W)

    own = win([(p["start"], p["end"]) for p in sc.pauses if p["mode"] != "sign-off"])
    signoff = win([(p["start"], p["end"]) for p in sc.pauses if p["mode"] == "sign-off"])
    m.add("other", "pause", own)
    m.lead("pause", own)

    def clean(iv):
        return subtract(win(iv), own)

    # 1. stops, a sleep owning its overlap with any other stop
    stops = stop_spans(lines, hi)
    sleeps = union([(s["start"], s["end"]) for s in stops if s["cause"] == "mac-sleep"])
    taken = []
    for s in stops:
        iv = [(s["start"], s["end"])]
        if s["cause"] != "mac-sleep":
            iv = subtract(iv, sleeps)
        iv = clean(iv)
        if not iv:
            continue
        if s["open"]:
            m.flag("a %s stop at %s is still open at the record's end: it runs to %s" % (
                s["cause"], fmt(s["start"]), "until (the rollout is live)" if is_live else "its last line"))
        if s["cause"] == "usage-limit":
            cls, cause = "quota-bound", "usage-limit"
        elif s["cause"] == "halt":
            cause = halt_cause(s["reason"])
            cls = "stalls"
            if cause is None:
                cls, cause, flag = classify_wait(base, s["start"], s["end"], hi)
                if flag:
                    m.flag("the halt at %s: %s" % (fmt(s["start"]), flag))
            elif cause == "halt" and s["reason"]:
                m.flag("a halt at %s whose reason no HALT_WAITS prefix matches (%s): halt" % (fmt(s["start"]),
                                                                                            fold(s["reason"], 80)))
        elif s["cause"] in CAUSES["stalls"]:
            cls, cause = "stalls", s["cause"]
        else:
            cls, cause = "stalls", "halt"
            m.flag("a stop with an unknown cause %r at %s: halt" % (s["cause"], fmt(s["start"])))
        m.add(cls, cause, iv)
        taken += iv
    taken = union(taken)
    # 2. the sign-off pause; 3. the holds
    gate = subtract(signoff, taken)
    m.add("stalls", "gate", gate)
    taken = union(taken + gate)
    for hold in ("git-env", "merge", "race"):
        iv = subtract(clean([(h["start"], h["end"]) for h in sc.holds if h["hold"] == hold]), taken)
        m.add("stalls", "hold-" + hold, iv)
        taken = union(taken + iv)
    # the suites: rework, then load
    suites = pair_suites(lines)
    rework = []
    integ = {}
    for su in suites:
        if su["by"] == "integration" and su["start"] is not None:
            integ.setdefault(su["task"], []).append(su)
    for task in sorted(integ, key=str):
        for su in sorted(integ[task], key=lambda x: x["start"])[1:]:
            iv = clean(run_span(su))
            m.add("rework", "integration", iv)
            rework += iv
    for su in suites:
        if su["by"] == "race":
            iv = clean(run_span(su))
            m.add("rework", "race", iv)
            rework += iv
    for su in suites:
        if su["by"] == "completion":
            continue  # a completion suite belongs to no class
        w = su["waited"]
        at = su["start"] if su["start"] is not None else su["end"]
        if _num(w) and w > 0 and at is not None:
            m.add("load", "slot-wait", clean([(at - int(round(w * 1000)), at)]))
        if su["outcome"] in ("heat", "timeout"):
            m.add("load", su["outcome"], clean(run_span(su)))
        if su["start"] is not None and su["end"] is None and since <= su["start"] <= until:
            m.count("suite-unfinished")
    # the lane, less every stall span, pauses and rework
    holdings = union([(h["start"], h["end"]) for h in sc.holdings])
    m.add("lane-bound", "lane", subtract(clean(holdings), taken + union(rework)))
    # plan-rejected: the Slot hours of a plan thrown away
    takes = [(t, d.get("task")) for t, _n, d in base if d.get("kind") == "slot-taken"]
    for t, task, rc in sc.set_asides:
        if rc != "plan-rejected":
            continue
        st = [x for x, k in takes if k == task and x <= t]
        if st:
            m.add("plan-rejected", "plan-rejected", clean([(max(st), t)]))
    # 4. the not-running remainder
    rest = subtract(W, sc.run_iv + holdings + taken + own)
    for kind in ("lead-absent", "never-finished"):
        for g in sc.gaps:
            if g[0] != kind:
                continue
            iv = intersect(rest, [g[2]])
            m.add("stalls", kind, iv)
            if kind == "lead-absent":
                m.lead(kind, iv)
            rest = subtract(rest, iv)
    markers = sorted(sc.markers, key=lambda x: x[0])

    def label(reason, a, b):
        if reason in STALL_MARKERS:
            m.add("stalls", reason, [(a, b)])
        elif reason == "hold-heat":
            m.add("load", "hold-heat", [(a, b)])
        elif reason == "awaiting-hand-back":
            cls, cause, flag = classify_wait(base, a, b, hi)
            if flag:
                m.flag("the wait at %s: %s" % (fmt(a), flag))
            m.add(cls, cause, [(a, b)])
        elif reason in OTHER:
            m.add("other", reason, [(a, b)])
        else:
            m.add("stalls", "unexplained", [(a, b)])
            m.lead("unexplained", [(a, b)])
            m.flag("an idle-slots reason %r at %s is no ledger label: unexplained" % (reason, fmt(a)))

    for a, b in rest:
        here = [(t, r) for t, r in markers if a <= t < b]
        if not here:
            m.add("stalls", "unexplained", [(a, b)])
            m.lead("unexplained", [(a, b)])
            continue
        reason, cur = here[0][1], a
        for t, r in here[1:]:
            if r != reason:
                label(reason, cur, t)
                reason, cur = r, t
        label(reason, cur, b)
    # events, in [since, until]
    for t, _n, d in lines:
        if not since <= t <= until:
            continue
        kind = d.get("kind")
        if kind == "quota-stall":
            m.count("quota-stall")
        elif kind == "base-moved":
            m.count("base-moved")
            if d.get("inertOnly") is True:
                m.count("base-moved-inert")
        elif kind == "stopped":
            m.count("stopped")
    if not any(d.get("kind") == "slot-taken" for _t, _n, d in base):
        m.flag("no slot-taken: its live span starts at its first engine line (a %s at %s)" % (engine[1], fmt(start)))
    if not any(d.get("kind") in ("stopped", "lead-entry", "suite-started", "suite-ended") for _t, _n, d in lines):
        m.flag("no stop, entry or suite lines (a record from before p29-10): its halts read unexplained")
    return m


# ---- the block --------------------------------------------------------------------------------------------------------

SERIAL_LEFT_OUT = "a serial chain (shape: serial): its Legs record no Slots or stops, so the ledger leaves it out"


def measure_all(records, since, until, live, serial=None):
    """{slug: Measure} for every record whose live span reaches [since, until] (ms). `records` is {slug: whole lines};
    `live(slug)` says whether its rollout is live, `serial(slug)` whether it is a serial chain (left out, flagged when it
    is live or has a line in the window: a Measure holding the flag alone)."""
    out = {}
    for slug in sorted(records):
        lines = records[slug]
        if serial is not None and serial(slug):
            if lines and (live(slug) or any(since <= t <= until for t, _n, _d in lines)):
                out[slug] = Measure(slug)
                out[slug].flag(SERIAL_LEFT_OUT)
            continue
        m = measure(slug, lines, since, until, bool(live(slug)))
        if m is not None:
            out[slug] = m
    return out


def tl_lines(lines, rid=None):
    """reflections.jsonl's `time-lost` lines, the first per (reflection or id, source), in file order; with `rid`, that
    Reflection's own are left out."""
    seen, out = set(), []
    for d in lines:
        if not isinstance(d, dict) or d.get("kind") != "time-lost":
            continue
        key = (d.get("reflection") or d.get("id"), d.get("source"))
        if key in seen:
            continue
        seen.add(key)
        if rid is not None and d.get("reflection") == rid:
            continue
        out.append(d)
    return out


def _class_hours(d, key="hours"):
    v = d.get(key) if isinstance(d.get(key), dict) else {}
    return {c: v.get(c) if _num(v.get(c)) else 0 for c in CLASSES}


def missed(d):
    """Per class, an audit line's found / (found + recorded), null where both are 0."""
    found, rec = _class_hours(d), _class_hours(d, "recorded")
    return {c: (round(found[c] / (found[c] + rec[c]), 4) if found[c] + rec[c] > 0 else None) for c in CLASSES}


def week_item(d):
    item = {"source": d.get("source"), "reflection": d.get("reflection"), "since": d.get("since"), "until": d.get("until"),
            "hours": _class_hours(d)}
    if d.get("source") == "audit":
        item.update(rank=d.get("rank"), recorded=_class_hours(d, "recorded"), missed=missed(d), month=d.get("month"))
    else:
        item["top"] = d.get("top")
    return item


def trend(lines, row, rid):
    """{previous, delta, weeks}: previous and delta against the latest earlier record line only; weeks up to WEEKS of the
    latest record and audit lines, oldest first, this row last."""
    earlier = tl_lines(lines, rid)
    recs = [d for d in earlier if d.get("source") == "record"]
    prev = recs[-1] if recs else None
    delta = None
    if prev is not None:
        ph = _class_hours(prev)
        delta = {c: round(row["hours"][c] - ph[c], 3) for c in CLASSES}
    items = [week_item(d) for d in earlier if d.get("source") in ("record", "audit")] + [week_item(row)]
    return {"previous": week_item(prev) if prev is not None else None, "delta": delta, "weeks": items[-WEEKS:]}


def top_streak(lines, top, rid):
    """The run of consecutive record lines, ending with this row, that share its top (0 with no top)."""
    if top is None:
        return 0
    n = 1
    for d in reversed([x for x in tl_lines(lines, rid) if x.get("source") == "record"]):
        if d.get("top") != top:
            break
        n += 1
    return n


def watch_shape(cls):
    return "%s tops the Time-lost ledger" % CLASS_WORDS[cls]


def watch_id(cls):
    return RR.watch_id(WATCH_RULE, watch_shape(cls))


def sighted(top, previous, lines):
    """Whether this reading sights the ledger's Watch on `top`: it tops this row, and it topped the previous record row
    too, or a `watch` line for its id already exists."""
    if top is None:
        return False
    wid = watch_id(top)
    return (previous is not None and previous.get("top") == top) or \
        any(isinstance(d, dict) and d.get("kind") == "watch" and d.get("id") == wid for d in lines)


def rows(records, ledger_lines, since, until, live, rid, intervals=False, serial=None):
    """The ledger block over [since, until] (ms) for Reflection `rid` (the module docstring's block). `ledger_lines` is
    reflections.jsonl's lines (its time-lost and watch lines are read); `live` and `serial` are measure_all()'s callbacks.
    With `intervals`, the block carries every priced interval and the audit's leads too."""
    per = measure_all(records, since, until, live, serial)
    ms = {c: 0 for c in CLASSES}
    by = {c: {} for c in CLASSES}
    other, events, contrib, flags = {}, {}, {c: [] for c in CLASSES}, []
    known, leads = [], []
    for slug, m in per.items():
        for cls in CLASSES:
            civ = union([x for (c, _k), iv in m.iv.items() if c == cls for x in iv])
            if civ:
                ms[cls] += total(civ)
                contrib[cls].append((slug, total(civ)))
        for (c, k), iv in sorted(m.iv.items()):
            n = total(iv)
            if c == "other":
                other[k] = other.get(k, 0) + n
            else:
                by[c][k] = by[c].get(k, 0) + n
            if intervals:
                for a, b in union(iv):
                    known.append({"rollout": slug, "class": c, "cause": k, "from": fmt(a), "to": fmt(b),
                                  "hours": hours(b - a)})
        for k, n in m.events.items():
            events[k] = events.get(k, 0) + n
        flags.extend(m.flags)
        leads.extend(m.leads)
    order = sorted(CLASSES, key=lambda c: (-ms[c], CLASSES.index(c)))
    top = order[0] if ms[order[0]] > 0 else None
    if top is not None and ms[order[1]] == ms[top]:
        flags.append("a tie at the top (%s and %s, %s h each): the class order decides" % (top, order[1], hours(ms[top])))
    bad = sorted({s for c in CLASSES for s, _n in contrib[c] if RR._slug(s)})
    if bad:
        flags.append("record(s) %s are no slugs: counted in the hours, never named as a contributor" % ", ".join(bad))
    ranked = {c: [(s, n) for s, n in sorted(contrib[c], key=lambda x: (-x[1], x[0])) if not RR._slug(s)] for c in CLASSES}
    row = {"id": "tl-record-%s" % rid[2:], "source": "record", "reflection": rid, "since": fmt(since), "until": fmt(until),
           "month": mmonth(until), "hours": {c: hours(ms[c]) for c in CLASSES}, "top": top,
           "byCause": {c: {k: hours(v) for k, v in sorted(by[c].items()) if v > 0} for c in CLASSES
                       if any(v > 0 for v in by[c].values())},
           "rollouts": {c: [[s, hours(n)] for s, n in ranked[c][:RR.MAX_TL_ROLLOUTS]] for c in CLASSES},
           "other": {k: hours(v) for k, v in sorted(other.items()) if v > 0},
           "events": dict(sorted(events.items())),
           "streak": top_streak(ledger_lines, top, rid)}
    tr = trend(ledger_lines, row, rid)
    prev = tr["previous"]
    block = {"row": row, "ranking": order, "previous": prev, "delta": tr["delta"], "weeks": tr["weeks"],
             "streak": row["streak"],
             "watch": {"class": top, "id": watch_id(top) if top else None, "rule": WATCH_RULE,
                       "shape": watch_shape(top) if top else None,
                       "rollouts": sorted(s for s, _n in ranked[top][:MAX_WATCH_ROLLOUTS]) if top else [],
                       "sighted": sighted(top, prev, ledger_lines)},
             "baseline": BASELINE, "flags": flags}
    if intervals:
        block["intervals"] = sorted(known, key=lambda x: (x["rollout"], x["from"], x["class"], x["cause"]))
        block["leads"] = sorted(leads, key=lambda x: (x["rollout"], x["from"], x["kind"]))
    return block


def preview_line(row):
    """The record line as tune.py's load hold reads it before `ledger` writes it (span's knobs())."""
    return dict(row, kind="time-lost")


# ---- the baseline and the Watch line -------------------------------------------------------------------------------

def baseline_line():
    """The baseline's `time-lost` line, written once by `ledger`."""
    return {k: BASELINE[k] for k in ("id", "source", "since", "until", "month", "ranges", "cites")}


def watch_line(watch, rid):
    """The ledger's Watch line for a sighted class (watch: the block's preview)."""
    return {"id": watch["id"], "rule": WATCH_RULE, "shape": watch["shape"], "rollouts": watch["rollouts"], "count": 1,
            "reflection": rid, "ledgerClass": watch["class"]}


# ---- the Monthly audit ----------------------------------------------------------------------------------------------

def audit_window(lines, until):
    """(since, until) of the audit window in ms: from the latest until among the audit and baseline lines (BASELINE's
    before any audit) to until."""
    ends = [SCORE.to_ms(BASELINE["until"])] + [_ms(d.get("until")) for d in tl_lines(lines)
                                               if d.get("source") in ("audit", "baseline")]
    return max(x for x in ends if x is not None), until


def audit_due(lines, until):
    """{due, month, since, until}: due when no audit or baseline line (BASELINE counted as its month) has the Melbourne
    month of until, and until is after the window's start."""
    month = mmonth(until)
    months = {BASELINE["month"]} | {d.get("month") for d in tl_lines(lines) if d.get("source") in ("audit", "baseline")}
    since, _u = audit_window(lines, until)
    return {"due": month not in months and until > since, "month": month, "since": fmt(since), "until": fmt(until)}


def audit_hours(entries):
    """{class: ms} the entries found, each from its from .. to, a rollout's overlapping entries in a class counted once."""
    per = {}
    for e in entries:
        per.setdefault((e["class"], e["rollout"]), []).append((SCORE.to_ms(e["from"]), SCORE.to_ms(e["to"])))
    out = {c: 0 for c in CLASSES}
    for (c, _r), iv in per.items():
        out[c] += total(iv)
    return out


def overlaps(entries, known):
    """[(entry index, known interval)] for each entry that overlaps a known interval of the same rollout and class."""
    out = []
    for i, e in enumerate(entries):
        a, b = SCORE.to_ms(e["from"]), SCORE.to_ms(e["to"])
        for k in known:
            if k.get("rollout") == e["rollout"] and k.get("class") == e["class"] and \
                    intersect([(a, b)], [(SCORE.to_ms(k["from"]), SCORE.to_ms(k["to"]))]):
                out.append((i, k))
                break
    return out


def audit_line(doc, audit, rid, known):
    """The audit line's fields from audit.json `doc`, for the span's `audit` block (due, month, since, until, recorded) and
    the known intervals (ledger-intervals.json's). ValueError names the first refusal: the month, an entry's class, cause,
    rollout or stamps, one outside the window or overlapping a known interval, a cap."""
    if not isinstance(doc, dict):
        raise ValueError("audit.json is no JSON object")
    if doc.get("month") != audit.get("month"):
        raise ValueError("audit.json's month %r is not this reading's %s" % (doc.get("month"), audit.get("month")))
    lo, hi = SCORE.to_ms(audit["since"]), SCORE.to_ms(audit["until"])
    src = doc.get("sources")
    if not isinstance(src, list) or not src:
        raise ValueError("audit.json names no sources (each of %s, read or not)" % ", ".join(RR.AUDIT_SOURCES))
    sources = []
    for s in src:
        if not isinstance(s, dict) or s.get("source") not in RR.AUDIT_SOURCES or not isinstance(s.get("read"), bool):
            raise ValueError("a source must be {source: one of %s, read: true or false, why?}" % ", ".join(RR.AUDIT_SOURCES))
        item = {"source": s["source"], "read": s["read"]}
        why = fold(s.get("why"), RR.TL_WHAT)
        if why:
            item["why"] = why
        elif not s["read"]:
            raise ValueError("source %s is unread with no why" % s["source"])
        sources.append(item)
    if len({s["source"] for s in sources}) != len(sources):
        raise ValueError("a source is named twice")
    ent = doc.get("entries") or []
    gaps = doc.get("gaps") or []
    if not isinstance(ent, list) or len(ent) > RR.MAX_AUDIT_ENTRIES:
        raise ValueError("at most %d entries" % RR.MAX_AUDIT_ENTRIES)
    if not isinstance(gaps, list) or len(gaps) > RR.MAX_AUDIT_GAPS:
        raise ValueError("at most %d gaps" % RR.MAX_AUDIT_GAPS)
    entries = []
    for n, e in enumerate(ent, 1):
        if not isinstance(e, dict):
            raise ValueError("entry %d is no object" % n)
        cls, cause = e.get("class"), e.get("cause")
        if cls not in CLASSES or cause not in CAUSES[cls]:
            raise ValueError("entry %d: %r / %r is no class and cause (%s)" % (n, cls, cause, ", ".join(CLASSES)))
        try:
            rollout = RR.normalise_slug(e.get("rollout"), "rollout")
            a, b = SCORE.to_ms(e.get("from")), SCORE.to_ms(e.get("to"))
        except Exception as x:
            raise ValueError("entry %d: %s" % (n, x))
        if not b > a:
            raise ValueError("entry %d: from %s is not before to %s" % (n, fmt(a), fmt(b)))
        if a < lo or b > hi:
            raise ValueError("entry %d (%s .. %s) falls outside the audit window %s .. %s" % (n, fmt(a), fmt(b),
                                                                                           audit["since"], audit["until"]))
        what, evidence = fold(e.get("what"), RR.TL_WHAT), fold(e.get("evidence"), RR.TL_EVIDENCE)
        if not what or not evidence:
            raise ValueError("entry %d needs what and evidence" % n)
        entries.append({"class": cls, "cause": cause, "rollout": rollout, "from": fmt(a), "to": fmt(b),
                        "hours": hours(b - a), "what": what, "evidence": evidence})
    hits = overlaps(entries, known)
    if hits:
        i, k = hits[0]
        raise ValueError("entry %d overlaps the record's own %s/%s interval of [[%s]] (%s .. %s): the record already "
                         "priced it, so name it as a gap instead" % (i + 1, k["class"], k.get("cause"), k["rollout"],
                                                                     k["from"], k["to"]))
    out_gaps = []
    for n, g in enumerate(gaps, 1):
        what = fold((g or {}).get("what") if isinstance(g, dict) else None, RR.TL_WHAT)
        evidence = fold((g or {}).get("evidence") if isinstance(g, dict) else None, RR.TL_EVIDENCE)
        if not what or not evidence:
            raise ValueError("gap %d needs what and evidence" % n)
        out_gaps.append({"what": what, "evidence": evidence})
    found = audit_hours(entries)
    recorded = {c: (audit.get("recorded") or {}).get(c, 0) for c in CLASSES}
    rank = sorted(CLASSES, key=lambda c: (-(found[c] + int(round(recorded[c] * HOUR))), CLASSES.index(c)))
    line = {"id": "tl-audit-%s" % rid[2:], "source": "audit", "reflection": rid, "since": audit["since"],
            "until": audit["until"], "month": audit["month"], "hours": {c: hours(found[c]) for c in CLASSES},
            "recorded": recorded, "rank": rank, "audit": {"sources": sources, "entries": entries, "gaps": out_gaps}}
    size = RR.line_bytes("time-lost", line)
    if size > RR.MAX_LINE:
        raise ValueError("the audit line would be %d bytes, over the Run record's %d-byte line limit (%d entries, %d gaps; "
                         "a non-ASCII character takes 6 bytes or more): trim entries or their text"
                         % (size, RR.MAX_LINE, len(entries), len(out_gaps)))
    return line


# ---- the CLI ------------------------------------------------------------------------------------------------------------

def read_records(ev):
    """{slug: whole lines} for every non-reserved <slug>.jsonl under `ev`."""
    out = {}
    reserved = {r + ".jsonl" for r in RR.RESERVED}
    for name in sorted(os.listdir(ev)) if os.path.isdir(ev) else []:
        if name.endswith(".jsonl") and name not in reserved:
            out[name[:-6]], _skipped = SCORE.read_lines(os.path.join(ev, name))
    return out


def read_jsonl(path):
    out = []
    try:
        with open(path, "rb") as f:
            for raw in f:
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(d, dict):
                    out.append(d)
    except FileNotFoundError:
        pass
    return out


def note_field(path, key):
    """A note's frontmatter scalar `key:` (lowercased, quotes and an inline ` # comment` dropped), or None."""
    try:
        text = open(path, encoding="utf-8").read()
    except (OSError, UnicodeDecodeError):
        return None
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    s = re.search(r"^%s:\s*['\"]?([^'\"\n#]+)" % re.escape(key), m.group(1), re.M) if m else None
    return s.group(1).strip().lower() if s else None


def note_live(tasks_dir, slug):
    """The CLI's live rule (span's own, read from the vault): the note directly under the tasks dir, not archived, its
    status none of CLOSED."""
    p = os.path.join(tasks_dir, "%s.md" % slug)
    return os.path.isfile(p) and note_field(p, "status") not in CLOSED


def note_serial(tasks_dir, slug):
    """The CLI's serial rule (span's own): the note directly under the tasks dir, else under Archive/Rollouts (span's
    rollout_note), says `shape: serial`."""
    for p in (os.path.join(tasks_dir, "%s.md" % slug), os.path.join(tasks_dir, "Archive", "Rollouts", "%s.md" % slug)):
        if os.path.isfile(p):
            return note_field(p, "shape") == "serial"
    return False


class Parser(argparse.ArgumentParser):
    def error(self, message):
        sys.stderr.write("ledger: %s\n" % message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="ledger.py", description="The Time-lost ledger over the Run record (reads only).")
    p.add_argument("--since", required=True)
    p.add_argument("--until", required=True)
    p.add_argument("--tasks-dir")
    p.add_argument("--out")
    a = p.parse_args(argv)
    try:
        since, until = SCORE.to_ms(a.since), SCORE.to_ms(a.until)
    except Exception as e:
        sys.stderr.write("ledger: %s\n" % e)
        return 2
    if since > until:
        sys.stderr.write("ledger: --since is after --until\n")
        return 2
    try:
        zone()
    except Exception as e:
        sys.stderr.write("ledger: no tz data for %s (%s): python3 -m pip install tzdata\n" % (ZONE, e))
        return 3
    tasks = os.path.expanduser(a.tasks_dir or os.path.join("~", "repos", "obsidian", "Work", "Tasks"))
    try:
        ev = RR.events_dir()
        records = read_records(ev)
        lines = read_jsonl(os.path.join(ev, RR.REFLECTIONS + ".jsonl"))
    except (OSError, ValueError) as e:
        sys.stderr.write("ledger: cannot read the events directory: %s\n" % e)
        return 1
    block = rows(records, lines, since, until, lambda slug: note_live(tasks, slug), "r-cli", intervals=True,
                 serial=lambda slug: note_serial(tasks, slug))
    text = json.dumps(block, indent=2, ensure_ascii=False) + "\n"
    if a.out:
        try:
            with open(a.out, "w", encoding="utf-8") as f:
                f.write(text)
        except OSError as e:
            sys.stderr.write("ledger: cannot write --out %s: %s\n" % (a.out, e))
            return 1
    else:
        sys.stdout.write(text)
    row = block["row"]
    sys.stderr.write("ledger: top %s of %s h over %d rollout(s)\n" % (
        row["top"], round(sum(row["hours"].values()), 3), len({s for c in CLASSES for s, _n in row["rollouts"][c]})))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
