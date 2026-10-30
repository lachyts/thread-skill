#!/usr/bin/env python3
"""serial-score.py — score one serial rollout's chain of Legs (p24-4, ADR 0040). Reads only; writes nothing.

python >= 3.8, stdlib only. A serial rollout runs as Legs (skills/execute/legs.md), not Slots and an Integration lane,
so score.py's running time, load and binding do not apply: this script scores the chain from its Leg log instead, in
the shape tune.py records. Its callers: close-score.py's serial path (legs.md § Complete step 3, the serial
template's scoring step), skills/reflect/SKILL.md § 1's serial reading, and reflect.py span (the weekly reading),
which also loads leg_status() and fold_restarts():

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/serial-score.py --rollout <rollout note.md> \\
        [--tasks-dir <dir>] [--until TS] [--out F]

--rollout is the rollout note's path (live, or its Archive/Rollouts/ copy), ending .md; its stem is the slug. The
task notes are --tasks-dir, else the note's own Work/Tasks (its folder, or three levels up from Archive/Rollouts/).

Reads. The chain through `leg.py status` (skills/execute/scripts/leg.py, the Leg log's one reader: its header holds
the chain's definitions), run as `sys.executable leg.py status --rollout <note> --tasks-dir <dir>` with stdin closed,
git's repo-local variables (`git rev-parse --local-env-vars`) dropped from the env and a LEG_CAP s timeout. The Run
record `<events dir>/<slug>.jsonl` (run_record.py's directory chain) through score.py's read_lines: a serial chain
records only the acts Lachy's verbs write there (approve-gates, record-answer, hand-back, defer), plus its completion
verify's completion-verify and suite lines (ADR 0055), which are no act (ACT_KINDS passes them by). The task notes under
--tasks-dir, Archive included, for `fixes:` (escapes.py).

Times. Every Leg-log stamp (minute precision, with the offset it was written in) goes through score.py's to_ms and
fmt, so every printed stamp is UTC `Z` (run_record's tuning window refuses any other). --until takes Z or an offset
(a naive stamp is refused, exit 2) and defaults to now. `since` and `activeStart` are Leg 1's `began`; `until` is
--until; `activeEnd` is the latest Leg span's end. With no Leg begun: `since` = `until`, activeStart and activeEnd
null, flagged "no Leg began: nothing ran" (close-score's nothing-ran exit reads it). --until before Leg 1 began is
exit 2.

Running time is the union of the Leg spans, clipped to [since, until]: a closed Leg runs from its `began` to its
close line; a lost Leg (taken over) to its own last line (leg.py's lastAt), never the taker's `closed: lost` line,
flagged; an open Leg to --until (Complete scores the chain from its last, still open, Leg), which makes the window
`partial` only while a counted row is not done. runningHours is score.py's hours().

Merges: the done Queue rows (fix tasks included) whose latest `done` line is at or before --until; a done row with no
`done` line is flagged and not counted. throughput = round(merges / runningHours, 3), null with no running time.

Hands-off rate (ADR 0037 d1's headline, read for a chain): a landed task has an act from Lachy when
- a Run-record line that score.py's human_act names (an answer, a sign-off, a retry hand-back, a RACE decision) for
  that task lies in since <= act < done + 60 s. The ms-against-minute rule is on purpose: `done` is a minute-floor
  stamp, so the whole done minute counts, which errs towards counting: the rate is a floor on hands-off; or
- a `halt cleared:` line (leg.py status's haltCleared) cleared the halt of the Leg holding that task: a task some Leg
  took from a halted Leg (its `took` entry's `from`).
rate = (landed - the tasks with an act) / landed, to 4 places; null with nothing landed. `byKind` counts acts.
`notCounted` counts what the chain did that is no act on a task: takeOvers, manualHandOvers, restarts (below: one per
restart, at or before --until, never one per `restart:` line), stops (a Leg closed `stopped:`) and standingApproval
(gate-signed standing=true lines).

Restarts (fold_restarts(), reflect.py span's restart items too). repair § 7 (e) writes two `restart:` lines for one
restart: step 2's `pending (session <sid>)`, then step 3's `started <id>` or step 4's `manual (<why>)`, each its own
line. Read in write order (leg.py status's `restarts`), skipping a line stamped after --until: a `pending` line opens a
restart of its Leg; a `started` or `manual` line answers that Leg's open restart, when its latest line is `pending` and
the line is stamped no later than the minute that Leg's `began` line is, and is then the same restart; any other line
opens one of its own. So a `pending` after a `pending`, or after an answered restart, is a second restart (a
`--replace` re-mark: the restart before it never started its Leg, or its Session died before `begin`). A restart's
`at` is its first line's stamp, the one that decides which window it falls in; `how`, `started` and `manual` are its
latest line's, so `how` is `pending` only when step 2 ran with no step 3 or 4 line after it. `session` is the `pending`
line's (the repair that marked it, null for a lone `started` or `manual` line), and `began` the Leg's `began` stamp on
its Leg's last restart (the one standing when it began), at or after `at` and at or before --until, else null: a
`pending` restart whose Leg began did start, by a route that wrote no line (`leg.py restarted` writes nothing once the
Leg began, its `began: true`), or by hand. An earlier restart of that Leg keeps `began` null: the later one started it.

Quality: escapes.score(landed, tasks_dir, None, None, env), with no --repo, so it reads `fixes:` only: reverts and
reviews are unread, and it is always partial (escapes.py's flags, prefixed `escapes: `). A fix task's `verifies:` is
never an Escape; its `fixes:` is (legs.md § Fix tasks).

reviewChurn and the parallel-only scores (tokensPerMerge, setAsideRate, conflictRate, quotaStalls) are null, each
flagged. repo is null (a chain has no one repo), shape `serial`, binding null and proposals []: a serial score
proposes no Tuning, and tune.py records it only as a close line.

Output: one JSON object (stdout, or --out F): rollout, repo, shape, chain (leg.py's chain state), window{since, until,
activeStart, activeEnd, partial}, runningTime{hours, spans[{leg, start, end, hours, lost}]}, merges{count, tasks[{task,
at}]}, throughput, handsOff{rate, landed, handsOff, tasks[{task, acts[{kind, at, detail}]}], byKind{answer, signOff,
retry, raceDecided, haltCleared}, notCounted{takeOvers, manualHandOvers, restarts, stops, standingApproval}},
escapes (escapes.py's block), headline (tune.py's ten), binding, proposals, withheld, flags. stderr gets one summary
line.

Exit codes: 0 scored (no Leg and a missing record included); 1 leg.py status failed or timed out, the Run record
exists but cannot be read, or --out cannot be written; 2 usage (a missing or bad flag, a --rollout that is no .md
path, a reserved or bad slug, a bad --until, --until before Leg 1).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
LEG_PY = os.path.join(SKILLS, "execute", "scripts", "leg.py")
SCORE_PY = os.path.join(HERE, "score.py")
ESCAPES_PY = os.path.join(HERE, "escapes.py")
LEG_CAP = 60            # leg.py status's timeout in seconds
MINUTE = 60 * 1000
ACT_NAMES = ("answer", "signOff", "retry", "raceDecided", "haltCleared")
NULL_KEYS = ("tokensPerMerge", "setAsideRate", "conflictRate", "quotaStalls", "reviewChurn")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SCORE = _load("thread_score", SCORE_PY)  # to_ms, fmt, hours, union, total, read_lines, human_act, ACT_KINDS
RR = SCORE.RR
ESC = _load("thread_escapes", ESCAPES_PY)


class Usage(Exception):
    pass


class Unreadable(Exception):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Usage(message)


def git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as close-score.py's git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=30).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def first_line(text):
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()[:240]
    return "no output"


def tasks_dir_of(note, given):
    if given:
        return os.path.abspath(os.path.expanduser(given))
    d = os.path.dirname(note)
    if os.path.basename(d) == "Rollouts" and os.path.basename(os.path.dirname(d)) == "Archive":
        return os.path.dirname(os.path.dirname(d))
    return d


def leg_status(note, tasks_dir, env):
    argv = [sys.executable, LEG_PY, "status", "--rollout", note, "--tasks-dir", tasks_dir]
    try:
        r = subprocess.run(argv, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=LEG_CAP)
    except subprocess.TimeoutExpired:
        raise Unreadable("leg.py status timed out after %ds" % LEG_CAP)
    except OSError as e:
        raise Unreadable("leg.py status cannot start: %s" % e)
    if r.returncode != 0:
        raise Unreadable("leg.py status exited %d: %s" % (r.returncode, first_line(r.stderr) if r.stderr.strip()
                                                           else first_line(r.stdout)))
    try:
        doc = json.loads(r.stdout)
        if not isinstance(doc, dict) or not isinstance(doc.get("legs"), list):
            raise ValueError("not leg.py status's object")
    except ValueError as e:
        raise Unreadable("leg.py status printed no status: %s" % e)
    return doc


def ms(stamp):
    return SCORE.to_ms(stamp)


def fold_restarts(st, until, to_ms=ms):
    """The chain's restarts as the Leg log stood at `until` (ms), one per restart repair § 7 made, never one per
    `restart:` line (the header's Restarts rule, its one copy). `to_ms` turns a raw stamp into ms, or None to skip
    it. Each is {leg, how, started, manual, session, at, began}, `at` and `began` in ms."""
    began = {}
    for g in st.get("legs") or []:
        t = to_ms(g["began"]) if g.get("began") else None
        if t is not None and t <= until:
            began[g.get("n")] = t
    out, waiting = [], {}  # waiting: Leg -> its restart whose latest line is `pending`, still open to an answer
    for r in st.get("restarts") or []:
        t = to_ms(r.get("at"))
        if t is None or t > until:
            continue
        leg, how = r.get("leg"), r.get("how")
        cur = waiting.pop(leg, None)
        if how != "pending" and cur is not None and (began.get(leg) is None or t <= began[leg]):
            cur.update(how=how, started=r.get("started"), manual=r.get("manual"))  # step 3 or 4 answering step 2
            continue
        item = {"leg": leg, "how": how, "started": r.get("started"), "manual": r.get("manual"),
                "session": r.get("session"), "at": t, "began": None}
        out.append(item)
        if how == "pending":
            waiting[leg] = item
    last = {item["leg"]: item for item in out}  # a Leg's last restart: the one standing when it began
    for leg, item in last.items():
        b = began.get(leg)
        item["began"] = b if b is not None and b >= item["at"] else None
    return out


class Score:
    def __init__(self, slug, status, until, tasks_dir, env):
        self.slug, self.st, self.until, self.tasks_dir, self.env = slug, status, until, tasks_dir, env
        self.flags = []

    def flag(self, text):
        if text not in self.flags:
            self.flags.append(text)

    # ---- the window and running time -------------------------------------------------------------------------------

    def window(self):
        legs = [g for g in self.st["legs"] if g.get("began")]
        if not legs:
            self.flag("no Leg began: nothing ran")
            self.spans = []
            return {"since": SCORE.fmt(self.until), "until": SCORE.fmt(self.until), "activeStart": None,
                    "activeEnd": None, "partial": False}
        since = min(ms(g["began"]) for g in legs)
        if self.until < since:
            raise Usage("--until %s is before Leg 1 began (%s)" % (SCORE.fmt(self.until), SCORE.fmt(since)))
        self.since = since
        spans, partial = [], False
        for g in legs:
            start, lost = ms(g["began"]), False
            if g.get("outcome") == "lost":
                end, lost = ms(g["lastAt"] or g["began"]), True
                self.flag("Leg %d was lost (taken over by Leg %d): its span ends at its own last line, %s"
                          % (g["n"], g["n"] + 1, SCORE.fmt(end)))
            elif g.get("closedStamp"):
                end = ms(g["closedStamp"])
            else:
                end = self.until
                prog = self.st.get("progress") or {}
                if prog.get("done", 0) < prog.get("total", 0):
                    partial = True
                    self.flag("partial: Leg %d is open at --until and the chain's tail has not landed" % g["n"])
            start, end = max(start, since), min(max(end, start), self.until)
            spans.append({"leg": g["n"], "start": start, "end": end, "lost": lost})
        self.spans = spans
        return {"since": SCORE.fmt(since), "until": SCORE.fmt(self.until), "activeStart": SCORE.fmt(since),
                "activeEnd": SCORE.fmt(max(s["end"] for s in spans)), "partial": partial}

    def running(self):
        iv = [(s["start"], s["end"]) for s in self.spans]
        total = SCORE.total(iv)
        return total, {"hours": SCORE.hours(total),
                       "spans": [{"leg": s["leg"], "start": SCORE.fmt(s["start"]), "end": SCORE.fmt(s["end"]),
                                  "hours": SCORE.hours(max(0, s["end"] - s["start"])), "lost": s["lost"]}
                                 for s in self.spans]}

    # ---- merges ---------------------------------------------------------------------------------------------------

    def landed(self):
        done_at = {}
        for g in self.st["legs"]:
            for e in g.get("done") or []:
                t = ms(e["at"])
                k = e["task"].lower()
                done_at[k] = max(done_at.get(k, t), t)
        out = {}
        for r in self.st["rows"]:
            if r.get("state") != "done":
                continue
            k = r["slug"].lower()
            if k not in done_at:
                self.flag("[[%s]] is done with no `done` line in the Leg log: not counted" % r["slug"])
                continue
            if done_at[k] <= self.until:
                out[k] = {"task": r["slug"], "at": done_at[k]}
        return out

    # ---- hands-off -------------------------------------------------------------------------------------------------

    def record(self):
        try:
            path = os.path.join(RR.events_dir(), self.slug + ".jsonl")
        except ValueError as e:
            raise Unreadable("cannot resolve the events directory: %s" % e)
        if not os.path.exists(path):
            self.flag("no record: no act is read (a serial chain records only the acts Lachy's verbs write)")
            return []
        try:
            lines, skipped = SCORE.read_lines(path)
        except OSError as e:
            raise Unreadable("the Run record %s cannot be read: %s" % (path, e))
        if skipped:
            self.flag("%d Run-record line(s) unreadable: skipped" % skipped)
        return lines

    def hands_off(self, landed, lines):
        acts = {k: [] for k in landed}
        by = {n: 0 for n in ACT_NAMES}
        standing = 0
        for t, _n, d in lines:
            kind = d.get("kind")
            if kind not in SCORE.ACT_KINDS:
                continue
            if kind == "gate-signed" and d.get("standing") is True and self.since <= t <= self.until:
                standing += 1
            act = SCORE.human_act(kind, d)
            task = str(d.get("task") or "").lower()
            if act is None or task not in landed:
                continue
            if self.since <= t < landed[task]["at"] + MINUTE:
                acts[task].append({"kind": act[0], "at": SCORE.fmt(t), "detail": act[1]})
                by[act[0]] = by.get(act[0], 0) + 1
        cleared = {c["leg"]: c for c in self.st.get("haltCleared") or [] if c.get("leg") is not None}
        for g in self.st["legs"]:
            for e in g.get("took") or []:
                c = cleared.get(e.get("from"))
                k = e["task"].lower()
                if c is not None and k in landed:
                    acts[k].append({"kind": "haltCleared", "at": SCORE.fmt(ms(c["at"])),
                                    "detail": "Leg %d's halt cleared: %s" % (c["leg"], c["reason"])})
                    by["haltCleared"] += 1
        n = len(landed)
        hit = [k for k in landed if acts[k]]
        if not n:
            self.flag("nothing landed in the window: Hands-off rate and Quality are null")
        legs = self.st["legs"]
        return {"rate": round((n - len(hit)) / n, 4) if n else None, "landed": n, "handsOff": n - len(hit),
                "tasks": [{"task": landed[k]["task"], "acts": sorted(acts[k], key=lambda a: a["at"])}
                          for k in sorted(landed, key=lambda k: landed[k]["at"]) if acts[k]],
                "byKind": by,
                "notCounted": {"takeOvers": sum(1 for g in legs if g.get("tookOver")),
                               "manualHandOvers": sum(1 for g in legs if (g.get("handover") or "").startswith("manual")),
                               "restarts": len(fold_restarts(self.st, self.until)),
                               "stops": sum(1 for g in legs if g.get("outcome") == "stopped"),
                               "standingApproval": standing}}

    # ---- the whole score -------------------------------------------------------------------------------------------

    def run(self):
        window = self.window()
        if window["activeStart"] is None:
            total, running = 0, {"hours": 0.0, "spans": []}
            landed, hands = {}, None
        else:
            total, running = self.running()
            landed = self.landed()
            hands = self.hands_off(landed, self.record())
        merges = len(landed)
        throughput = round(merges / (total / SCORE.HOUR), 3) if total > 0 else None
        if total <= 0 and window["activeStart"] is not None:
            self.flag("no running time: throughput is null")
        lmap = {v["task"]: {"pr": None, "readOnly": False, "at": SCORE.fmt(v["at"])} for v in landed.values()}
        block, eflags = ESC.score(lmap, self.tasks_dir, None, None, self.env)
        for f in eflags:
            self.flag("escapes: %s" % f)
        self.flag("quality reads fixes: only (a serial score has no repo, so reverts and reviews are unread): partial")
        self.flag("tokensPerMerge, setAsideRate, conflictRate and quotaStalls are a parallel rollout's (Slots, a lane, "
                  "Integration): null")
        self.flag("reviewChurn is not read for a serial chain: null")
        headline = {"throughput": throughput, "runningHours": running["hours"], "merges": merges,
                    "handsOffRate": hands["rate"] if hands else None, "quality": block.get("quality")}
        for k in NULL_KEYS:
            headline[k] = None
        headline = {k: headline[k] for k in RR.SCORE_KEYS}
        return {"rollout": self.slug, "repo": None, "shape": "serial", "chain": self.st.get("chain"),
                "window": window, "runningTime": running,
                "merges": {"count": merges, "tasks": [{"task": v["task"], "at": SCORE.fmt(v["at"])}
                                                     for v in sorted(landed.values(), key=lambda v: v["at"])]},
                "throughput": throughput, "handsOff": hands, "escapes": block, "headline": headline, "binding": None,
                "proposals": [], "withheld": [], "flags": self.flags}


def parse(argv):
    p = Parser(prog="serial-score.py", allow_abbrev=False, description="Score a serial rollout's chain of Legs.")
    p.add_argument("--rollout", required=True)
    p.add_argument("--tasks-dir")
    p.add_argument("--until")
    p.add_argument("--out")
    a = p.parse_args(argv)
    note = os.path.abspath(os.path.expanduser(a.rollout.strip()))
    if not note.endswith(".md"):
        raise Usage("--rollout must be the rollout note's path, ending .md: %s" % a.rollout)
    try:
        slug = RR.normalise_slug(note, "rollout")
    except RR.Refused as e:
        raise Usage(str(e))
    if slug in RR.RESERVED:
        raise Usage("rollout %r is reserved (%s.jsonl is no rollout's record)" % (slug, slug))
    if a.until is not None:
        try:
            until = ms(a.until)
        except Exception as e:  # RR.Refused, or a stamp _stamp passes and strptime does not
            raise Usage("--until %s: %s" % (a.until, e))
    else:
        until = int(round(time.time() * 1000))
    return a, note, slug, until


def main(argv):
    try:
        a, note, slug, until = parse(argv)
    except Usage as e:
        sys.stderr.write("serial-score: %s\n" % e)
        return 2
    env = git_env()
    tasks_dir = tasks_dir_of(note, a.tasks_dir)
    try:
        status = leg_status(note, tasks_dir, env)
        doc = Score(slug, status, until, tasks_dir, env).run()
    except Usage as e:
        sys.stderr.write("serial-score: %s\n" % e)
        return 2
    except Unreadable as e:
        sys.stderr.write("serial-score: %s\n" % e)
        return 1
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    if a.out:
        try:
            with open(os.path.expanduser(a.out), "w", encoding="utf-8") as f:
                f.write(text)
        except OSError as e:
            sys.stderr.write("serial-score: cannot write --out %s: %s\n" % (a.out, e))
            return 1
    else:
        sys.stdout.write(text)
    h = doc["handsOff"]
    sys.stderr.write("serial-score: %s: hands-off %s (%s of %s), %d merges in %s running h, quality %s (partial)\n"
                     % (slug, h["rate"] if h else None, h["handsOff"] if h else 0, h["landed"] if h else 0,
                        doc["merges"]["count"], doc["runningTime"]["hours"], doc["headline"]["quality"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
