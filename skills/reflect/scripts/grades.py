#!/usr/bin/env python3
"""grades.py — the Grade log's reader: each Readiness grade joined to what followed it (p25-4, ADR 0041; CONTEXT.md
**Grade log**). This docstring is the one copy of the episode, dispatch, act, outcome, rate, window and Slot-hours
rules. Reads only; writes nothing.

python >= 3.9, stdlib only. skills/reflect/scripts/reflect.py's `span` loads it by path, as score.py loads escapes.py,
and writes its block into span.json as `grades`; the weekly reading's step 11 reads it (skills/reflect/SKILL.md). The
CLI is for tests and by-hand reads, and prints {grades, flags, cannotShow}:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/grades.py [--since TS] [--until TS] [--tasks-dir D]

--until defaults to now and --since to until - 7 days (Z or an offset, as span reads them); --tasks-dir is the vault's
Work/Tasks (default ~/repos/obsidian/Work/Tasks). The CLI loads reflect.py inside main() for its Vault, date_in and
record listing; this module's own load never loads reflect.py, so the two never import each other in a cycle.

Reads: grades.jsonl in the events directory (run_record's GRADE_LOG: one `grade` line per task each estate pass or
schedule Pre-flight grades, written only by skills/_shared/scripts/estate-dispatch.py `log`), every Run record there (span's listing:
each <slug>.jsonl but run_record's RESERVED files), and each graded task's note through reflect.py's Vault.find
(Work/Tasks, then anywhere under it, Archive included).

What it reuses, loaded by path and never copied: run_record.py (RR: GRADE_LOG, LINK_RE, normalise_slug, Refused);
score.py (SCORE: read_lines, human_act, ACT_KINDS, ACT_NAMES, MERGE_HOLD_DETAIL, to_ms, fmt, HOUR, intersect, total and
Score.pair, run over each record for its Slots, lane holdings and merge holds: pair reads no args); reconcile-project.py
(RP: LANDED, and Rec's status and scalar, vault-grammar.md § Statuses: done and merged land a task, dropped drops it);
estate-rank.py (ER: GRADES and SIZE_MINUTES; it imports only the stdlib at load). The window's date rules are
reflect.py's date_in and mdate (an instant's Melbourne date), passed in, so each rule stays stated once.

The log. A line that does not parse, or has no valid ts, is torn: skipped and counted, as is a `grade` line with no
string task or a grade outside GRADES. Two lines with one (pass, task) count once, the first kept. Grade lines after
--until are not read.

Episodes. For a task T with grade lines g1 .. gk in time order, episode i runs from gi's ts to its end, the first of:
(a) a `merged` Run-record line for T at or after gi's ts, and before g(i+1)'s when there is one: `landed`, at that line;
(b) for an earlier episode (i < k): `regraded`, at g(i+1)'s ts; (c) for the latest episode, T's note as it stands: a
status of done or merged is `landed`, at its `merged:` stamp, else on its `completed:` date; dropped is `dropped`, on
its `completed:` date; any other status is `open`; no note (or one with no frontmatter) is `unknown`. A note's close
after --until is still open, since no act after until is read: an instant after it, or a date-only stamp after until's
Melbourne date (mdate, the zone date_in reads; a close on until's date is closed, and the next reading's window holds
it). An episode's span is [gi's ts, its end] ([gi, g(i+1)) for a regrade, so a record line at g(i+1)'s ts is the next
episode's); an open episode, or one closed only by a date, reads up to --until.

Dispatched. An episode is dispatched when a Run-record line names T in its span (dispatchedBy `record`), or when its
end-state link is not null and differs from gi's `linked` (dispatchedBy `link`). The end-state link is g(i+1)'s `linked`
for a regrade, and the first link of the note's `rollout:` now (run_record's normalise_slug) for a note's landed or
dropped end. The link is the only trace a serial chain leaves of a task that drew no act. rollouts lists, sorted, the
distinct records (each <slug>.jsonl's slug) whose lines name T in the span, plus the end-state link when dispatchedBy is
`link`: the rollouts a Watch on the episode's trace names (reflect.py `watch` takes a rollout an in-window episode
lists, read in the span or not). An undispatched episode lists none.

Acts. score.py's human_act over T's lines in the span, from every record (answer, signOff, retry, raceDecided), and each
merge hold Score.pair pairs for T that opens in the span (mergeHold): ADR 0037's acts. A signOff in an episode whose
grade line named `gates` is foreseen Review load, whenever it was signed: tallied in byKind and foreseenSignOffs, and
never counted toward the bounce. Not counted, tallied in notCounted as score.py tallies them: `gate-signed` standing
true (standingApproval), and `handed-back` via descope and `auto-retry` (automaticHandBack). setAsides counts T's
`set-aside` lines in the span. A `carried` line is no act.

Outcome, the first that matches: `unknown` (the end is unknown); `pending` (the end is open); not dispatched: `by hand`
when landed, else `undispatched` (dropped or regraded); `bounced` (at least one counted act, whatever the end);
`hands-off` when landed, `dropped` when dropped, `regraded` when regraded. So a grade that missed keeps its own outcome
when the task is regraded, and the next grade is scored over its own episode.

Rate. handsOffRate = hands-off / (hands-off + bounced + regraded + dropped), the closed dispatched episodes, rounded to 4
places; null when that is 0. `by hand`, `undispatched`, `pending` and `unknown` are counted beside it, never in it.
mergeHoldOnly counts the bounced episodes whose every counted act is a merge hold (a `--gated` run's holds read as acts:
the record carries no reason).

Window and all. `window` holds the closed episodes whose end lies in [since, until]: an instant by its ms, a date-only
end by date_in. `all` holds every closed episode, the window's included. An `unknown` episode, or a closed one with no
instant and no date (flagged), counts in `all` only. `pending` counts the open ones, in neither.

Slot hours (bySize, per grade size, over the landed dispatched episodes): slotHours is the time T's Slots (Score.pair's
slot-taken .. slot-freed, from every record; an open one to --until) cover inside the episode's span, laneHours the same
for its lane holdings, each in hours to 3 places. An episode with a Slot there is `timed`, and the median and mean of
each sit beside estimateHours = SIZE_MINUTES[size] / 60; the rest are `untimed` (a serial chain's, a session's or work
done by hand). Slot hours include the lead's set-up and in-Slot waits, so they are an upper bound on agent time.

Output, accuracy()'s block: {log {path, exists, lines, passes, tasks, torn}, window and all, each {readyHandsOff {rate,
handsOff, dispatched}, byGrade and byAgentGrade ({grade: {episodes, handsOff, bounced, regraded, dropped, byHand,
undispatched, unknown, rate, byKind {answer, signOff, retry, mergeHold, raceDecided}, foreseenSignOffs, notCounted
{standingApproval, automaticHandBack}, setAsides, mergeHoldOnly}} for every grade in GRADES' order), bySize ({size:
{timed, untimed, slotHours {median, mean}, laneHours {median, mean}, estimateHours}})}, pending {total, byGrade},
episodes[] (the window's rated episodes alone, hands-off, bounced, regraded or dropped, the ones skills/reflect/SKILL.md
§ 11 traces, by start then task; `by hand`, `undispatched`, `unknown` and `pending` are counts alone, in byGrade and
pending, since every estate pass regrades every open task and one episode each per pass would swell span.json; each
{task, pass, grade, agentGrade, raised[], gates[], size, shape, start, end {kind, at, date, by}, outcome, dispatchedBy,
linked, endLink, rollouts[], acts[] {kind, at, detail, counted}, notCounted, setAsides, slotHours, laneHours,
inWindow})}. Flags: `no grade log` (no grades.jsonl: an empty block, never an error), an unreadable log (named in
cannotShow too), torn lines, a task with no note, and a closed episode with no date. cannotShow names what this reading
cannot see (skills/reflect/SKILL.md § What the record cannot show).

Exit codes (the CLI): 0 printed; 1 the events directory cannot be listed; 2 a usage error or a bad TS; 3 no tz data.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import statistics
import sys
from pathlib import Path

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
SHARED = os.path.join(SKILLS, "_shared", "scripts")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", os.path.join(SHARED, "run_record.py"))
SCORE = _load("thread_score", os.path.join(HERE, "score.py"))
RP = _load("thread_reconcile_project", os.path.join(SHARED, "reconcile-project.py"))
ER = _load("thread_estate_rank", os.path.join(SHARED, "estate-rank.py"))

GRADES = ER.GRADES
SIZES = tuple(ER.SIZE_MINUTES)
LANDS = RP.LANDED - {"dropped"}  # done and merged land a task; dropped drops it
COUNT_KEYS = (("hands-off", "handsOff"), ("bounced", "bounced"), ("regraded", "regraded"), ("dropped", "dropped"),
              ("by hand", "byHand"), ("undispatched", "undispatched"), ("unknown", "unknown"))
RATED = ("hands-off", "bounced", "regraded", "dropped")
NOT_COUNTED = ("standingApproval", "automaticHandBack")
DATE_RE = re.compile(r"\d{4}-\d\d-\d\d")
MERGE_HOLD = "a merge hold (%s)" % SCORE.MERGE_HOLD_DETAIL
CANNOT_SHOW = (
    "grade accuracy: a serial task is seen as dispatched only through its `rollout:` link or an act line, has no Slot "
    "hours, and a halt clear is no act there; a task scheduled into a rollout that closed before it ran reads as "
    "regraded by its link (dispatchedBy link)",
    "grade accuracy: a --gated rollout's merge holds count as bounces (mergeHoldOnly); fit disagreements (the grader's "
    "shape against schedule's outcome) are not logged; a renamed task's history reads unknown; grades from before the "
    "first logged pass do not exist",
    "grade accuracy: Lachy's minutes per decision and per review item (DECISION_MINUTES, REVIEW_MINUTES) and the "
    "fortnight constants have no measure in the record; only SIZE_MINUTES is read, through Slot hours",
)


# ---- the log -----------------------------------------------------------------------------------------------------

class Log:
    """The Grade log: its kept grade lines [(ms, n, line)], time then file order, (pass, task) deduped."""

    def __init__(self, path, exists=False, lines=(), torn=0, error=None):
        self.path, self.exists, self.torn, self.error = path, exists, torn, error
        self.lines = list(lines)
        self.by_task = {}
        for t, n, d in self.lines:
            self.by_task.setdefault(d["task"], []).append((t, n, d))

    def at(self, task, ms):
        """The grade line in force for `task` at `ms` (the latest at or before it), or None."""
        best = None
        for t, _n, d in self.by_task.get(task) or []:
            if t > ms:
                break
            best = d
        if best is None:
            return None
        return {"grade": best.get("grade"), "agentGrade": best.get("agentGrade"),
                "raised": list(best.get("raised") or []), "gates": list(best.get("gates") or []),
                "pass": best.get("pass")}


def load(events_dir):
    """The Grade log under `events_dir`: a Log, never an error (an unreadable file is the Log's `error`)."""
    path = os.path.join(events_dir, RR.GRADE_LOG + ".jsonl")
    if not os.path.isfile(path):
        return Log(path)
    try:
        lines, torn = SCORE.read_lines(path)
    except OSError as e:
        return Log(path, exists=True, error=str(e))
    kept, seen = [], set()
    for t, n, d in lines:
        if d.get("kind") != "grade":
            continue
        if not isinstance(d.get("task"), str) or d.get("grade") not in GRADES:
            torn += 1
            continue
        key = (d.get("pass"), d["task"])
        if key not in seen:
            seen.add(key)
            kept.append((t, n, d))
    return Log(path, exists=True, lines=kept, torn=torn)


# ---- the records -------------------------------------------------------------------------------------------------

class Index:
    """Each wanted task's Run-record lines [(ms, kind, line, record slug)], Slots, lane holdings and merge holds, from
    every record up to until."""

    def __init__(self, records, wanted, until):
        self.lines, self.slots, self.lanes, self.holds = {}, {}, {}, {}
        for slug in sorted(records):
            lines = records[slug]
            for t, _n, d in lines:
                task = d.get("task")
                if t <= until and task in wanted:
                    self.lines.setdefault(task, []).append((t, d.get("kind"), d, slug))
            if not any(d.get("task") in wanted for _t, _n, d in lines):
                continue
            sc = SCORE.Score(None)
            sc.pair(lines, until)
            for s in sc.slots:
                if s["task"] in wanted:
                    self.slots.setdefault(s["task"], []).append((s["start"], s["end"] if s["end"] is not None else until))
            for h in sc.holdings:
                if h["task"] in wanted:
                    self.lanes.setdefault(h["task"], []).append((h["start"], h["end"] if h["end"] is not None else until))
            for h in sc.holds:
                if h["hold"] == "merge" and h["task"] in wanted:
                    self.holds.setdefault(h["task"], []).append(h["start"])
        for v in self.lines.values():
            v.sort(key=lambda x: x[0])


# ---- one note ----------------------------------------------------------------------------------------------------

def when(value):
    """A frontmatter stamp as (ms, None) for an instant with Z or an offset, (None, date) for a date, else (None, None)."""
    if not value:
        return None, None
    try:
        return SCORE.to_ms(value), None
    except Exception:
        pass
    m = DATE_RE.match(value)
    return (None, m.group(0)) if m else (None, None)


def link_of(value):
    """A `rollout:` value's first link (or its bare text) as a slug, or None."""
    if not isinstance(value, str) or not value.strip():
        return None
    m = RR.LINK_RE.search(value)
    try:
        return RR.normalise_slug(m.group(0) if m else value.strip())
    except RR.Refused:
        return None


def read_note(find, task):
    """(Rec, why): the task's note read, or None and why it is unknown."""
    p = find(task)
    if p is None:
        return None, "no task note"
    rec = RP.Rec(Path(p), "")
    if rec.fm is None:
        return None, "its note %s has no frontmatter (%s)" % (Path(p).name, rec.err)
    return rec, None


# ---- one episode -------------------------------------------------------------------------------------------------

def episode(task, start, g, nxt, note, idx, since, until, date_in, until_day):
    """One grade line's episode: its end, dispatch, acts and outcome (the module docstring's rules). until_day is
    until's Melbourne date (reflect.py's mdate), past which a date-only close is still open."""
    nxt_ms = nxt[0] if nxt is not None else None
    lines = idx.lines.get(task) or []
    merged = [t for t, kind, _d, _r in lines if kind == "merged" and t >= start and (nxt_ms is None or t < nxt_ms)]
    end = {"kind": None, "at": None, "date": None, "by": None}
    end_ms, end_link, half_open = None, None, False
    if merged:
        end_ms = min(merged)
        end.update(kind="landed", by="record")
    elif nxt is not None:
        end_ms, half_open = nxt_ms, True
        end.update(kind="regraded", by="regrade")
        end_link = nxt[2].get("linked")
    elif note is None:
        end.update(kind="unknown", by="note")
    else:
        st = note.status
        end["by"] = "note"
        if st in LANDS or st == "dropped":
            ms, day = when(note.scalar("merged")) if st in LANDS else (None, None)
            if ms is None and day is None:
                ms, day = when(note.scalar("completed"))
            if (ms is not None and ms > until) or (ms is None and day is not None and day > until_day):
                end["kind"] = "open"  # closed after the reading's end (an instant, or a later date): still open at until
            else:
                end_ms, end["date"] = ms, day
                end["kind"] = "landed" if st in LANDS else "dropped"
                end_link = link_of(note.scalar("rollout"))
        else:
            end["kind"] = "open"
    if end_ms is not None:
        end["at"] = SCORE.fmt(end_ms)
    kind = end["kind"]
    hi = end_ms if end_ms is not None else until

    def inside(t):
        return start <= t and (t < hi if half_open else t <= hi)

    span_lines = [x for x in lines if inside(x[0])]
    linked = g.get("linked")
    dispatched = "record" if span_lines else "link" if end_link is not None and end_link != linked else None
    rollouts = {r for _t, _k, _d, r in span_lines}
    if dispatched == "link":
        rollouts.add(end_link)
    gates = g.get("gates") or []
    acts, not_counted = [], {k: 0 for k in NOT_COUNTED}
    for t, k, d, _r in span_lines:
        if k == "gate-signed" and d.get("standing") is True:
            not_counted["standingApproval"] += 1
        elif k == "auto-retry" or (k == "handed-back" and d.get("via") == "descope"):
            not_counted["automaticHandBack"] += 1
        act = SCORE.human_act(k, d) if k in SCORE.ACT_KINDS else None
        if act is not None:
            acts.append((t, act[0], act[1], not (act[0] == "signOff" and gates)))
    for t in idx.holds.get(task) or []:
        if inside(t):
            acts.append((t, "mergeHold", MERGE_HOLD, True))
    acts.sort(key=lambda a: a[0])
    counted = [a for a in acts if a[3]]
    if kind == "unknown":
        outcome = "unknown"
    elif kind == "open":
        outcome = "pending"
    elif dispatched is None:
        outcome = "by hand" if kind == "landed" else "undispatched"
    elif counted:
        outcome = "bounced"
    else:
        outcome = {"landed": "hands-off", "dropped": "dropped", "regraded": "regraded"}[kind]
    slot_h = lane_h = None
    if kind == "landed" and dispatched is not None:
        box = [(start, hi)]
        slots = [s for s in idx.slots.get(task) or [] if s[0] <= hi and s[1] >= start]
        if slots:
            slot_h = round(SCORE.total(SCORE.intersect(slots, box)) / SCORE.HOUR, 3)
            lane_h = round(SCORE.total(SCORE.intersect(idx.lanes.get(task) or [], box)) / SCORE.HOUR, 3)
    if kind == "open":
        in_window = None
    elif end_ms is not None:
        in_window = since <= end_ms <= until
    elif end["date"] is not None:
        in_window = date_in(end["date"], since, until)
    else:
        in_window = False
    return {"task": task, "pass": g.get("pass"), "grade": g.get("grade"), "agentGrade": g.get("agentGrade"),
            "raised": list(g.get("raised") or []), "gates": list(gates), "size": g.get("size"), "shape": g.get("shape"),
            "start": SCORE.fmt(start), "end": end, "outcome": outcome, "dispatchedBy": dispatched, "linked": linked,
            "endLink": end_link, "rollouts": sorted(rollouts),
            "acts": [{"kind": k, "at": SCORE.fmt(t), "detail": det, "counted": c} for t, k, det, c in acts],
            "notCounted": not_counted, "setAsides": sum(1 for _t, k, _d, _r in span_lines if k == "set-aside"),
            "slotHours": slot_h, "laneHours": lane_h, "inWindow": in_window}


# ---- the readout -------------------------------------------------------------------------------------------------

def group(eps):
    """One grade's counts, rate and acts over `eps`."""
    out = {"episodes": len(eps)}
    for outcome, key in COUNT_KEYS:
        out[key] = sum(1 for e in eps if e["outcome"] == outcome)
    rated = sum(1 for e in eps if e["outcome"] in RATED)
    out["rate"] = round(out["handsOff"] / rated, 4) if rated else None
    out["byKind"] = {k: sum(1 for e in eps for a in e["acts"] if a["kind"] == k) for k in SCORE.ACT_NAMES}
    out["foreseenSignOffs"] = sum(1 for e in eps for a in e["acts"] if not a["counted"])
    out["notCounted"] = {k: sum(e["notCounted"][k] for e in eps) for k in NOT_COUNTED}
    out["setAsides"] = sum(e["setAsides"] for e in eps)
    out["mergeHoldOnly"] = sum(1 for e in eps if e["outcome"] == "bounced"
                               and all(a["kind"] == "mergeHold" for a in e["acts"] if a["counted"]))
    return out


def _stat(values):
    if not values:
        return {"median": None, "mean": None}
    return {"median": round(statistics.median(values), 3), "mean": round(statistics.mean(values), 3)}


def by_size(eps):
    out = {}
    for size in SIZES:
        landed = [e for e in eps if e["size"] == size and e["end"]["kind"] == "landed" and e["dispatchedBy"] is not None]
        timed = [e for e in landed if e["slotHours"] is not None]
        out[size] = {"timed": len(timed), "untimed": len(landed) - len(timed),
                     "slotHours": _stat([e["slotHours"] for e in timed]),
                     "laneHours": _stat([e["laneHours"] for e in timed]),
                     "estimateHours": round(ER.SIZE_MINUTES[size] / 60.0, 3)}
    return out


def summary(eps):
    by_grade = {g: group([e for e in eps if e["grade"] == g]) for g in GRADES}
    ready = by_grade["Ready"]
    return {"readyHandsOff": {"rate": ready["rate"], "handsOff": ready["handsOff"],
                              "dispatched": sum(ready[k] for k in ("handsOff", "bounced", "regraded", "dropped"))},
            "byGrade": by_grade,
            "byAgentGrade": {g: group([e for e in eps if e["agentGrade"] == g]) for g in GRADES},
            "bySize": by_size(eps)}


def block(log, episodes=()):
    eps = list(episodes)
    closed = [e for e in eps if e["outcome"] != "pending"]
    pending = [e for e in eps if e["outcome"] == "pending"]
    # Only the window's rated episodes, the ones the reading traces: every pass regrades every open task, so an
    # undispatched or pending episode per graded task per pass would swell span.json; those are counts alone.
    shown = sorted((e for e in closed if e["inWindow"] and e["outcome"] in RATED), key=lambda e: (e["start"], e["task"]))
    return {"log": {"path": log.path, "exists": log.exists, "lines": len(log.lines),
                    "passes": len({d.get("pass") for _t, _n, d in log.lines}), "tasks": len(log.by_task),
                    "torn": log.torn},
            "window": summary([e for e in closed if e["inWindow"]]), "all": summary(closed),
            "pending": {"total": len(pending), "byGrade": {g: sum(1 for e in pending if e["grade"] == g) for g in GRADES}},
            "episodes": shown}


def accuracy(log, records, find, date_in, day_of, since, until):
    """(block, flags, cannotShow): every graded task's episodes, joined to the records and notes, read over [since,
    until]. records is span's {slug: [(ms, n, line)]}, find reflect's Vault.find, date_in reflect's date_in and day_of
    reflect's mdate (an instant's Melbourne date)."""
    flags, cannot = [], []
    if log.error is not None:
        flags.append("grades.jsonl cannot be read (%s): no grade accuracy" % log.error)
        cannot.append("grade accuracy: grades.jsonl cannot be read, so no grade is joined to its outcome")
        return block(log), flags, cannot
    if not log.exists:
        flags.append("no grade log")
        return block(log), flags, cannot
    if log.torn:
        flags.append("%d line(s) of grades.jsonl did not parse: skipped" % log.torn)
    wanted = {task for task, gl in log.by_task.items() if any(t <= until for t, _n, _d in gl)}
    idx = Index(records, wanted, until)
    until_day = day_of(until)
    eps = []
    for task in sorted(wanted):
        gl = [x for x in log.by_task[task] if x[0] <= until]
        note, why = read_note(find, task)
        for i, (t, _n, g) in enumerate(gl):
            nxt = gl[i + 1] if i + 1 < len(gl) else None
            e = episode(task, t, g, nxt, note, idx, since, until, date_in, until_day)
            if e["outcome"] == "unknown":
                flags.append("[[%s]]: %s: its latest grade (%s) reads unknown" % (task, why, e["grade"]))
            elif e["outcome"] != "pending" and e["end"]["at"] is None and e["end"]["date"] is None:
                flags.append("[[%s]] (%s, %s): closed %s with no merged: or completed: date: counted in all only"
                             % (task, e["grade"], e["pass"], e["end"]["kind"]))
            eps.append(e)
    cannot.extend(CANNOT_SHOW)
    return block(log, eps), flags, cannot


# ---- CLI ---------------------------------------------------------------------------------------------------------

def main(argv):
    p = argparse.ArgumentParser(prog="grades.py", description="The Grade log joined to outcomes (p25-4, ADR 0041).")
    p.add_argument("--since")
    p.add_argument("--until")
    p.add_argument("--tasks-dir")
    a = p.parse_args(argv)
    REF = _load("thread_reflect", os.path.join(HERE, "reflect.py"))
    try:
        until = REF.to_ms(a.until, "--until") if a.until else REF.now_ms()
        since = REF.to_ms(a.since, "--since") if a.since else until - 7 * REF.DAY_MS
        if since > until:
            raise REF.Stop("--since %s is after --until %s" % (SCORE.fmt(since), SCORE.fmt(until)), 2)
        REF.zone()
        ev = REF.events_dir()
        span = REF.Span(argparse.Namespace(tasks_dir=a.tasks_dir, out=os.devnull))
        records = span.records(ev)
        out, flags, cannot = accuracy(load(ev), records, span.vault.find, REF.date_in, REF.mdate, since, until)
    except REF.Stop as e:
        sys.stderr.write("grades: %s\n" % e)
        return e.code
    print(json.dumps({"grades": out, "flags": span.flags + flags, "cannotShow": cannot}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
