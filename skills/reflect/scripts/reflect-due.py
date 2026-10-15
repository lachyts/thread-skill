#!/usr/bin/env python3
"""reflect-due.py — is the weekly Reflection due? (p21-8, ADR 0037 d4 and d6). This docstring is the one copy of its rules.

python >= 3.9, stdlib only (zoneinfo). The daily sweep (workspaces' daily-sweep.sh, p21-9) asks it once a day and, when
it says due, starts `/thread:reflect --weekly` headless. It reads only reflections.jsonl and writes nothing.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect-due.py [--now ISO]

The rule. The last Reflection is the last `reflection` line in reflections.jsonl (file order: the order the
Reflections closed) with a parseable until; its until is where the next reading's window starts (reflect.py span's
default since). The cadence is run_record's cadence(): 14 days when the last three or more `reflection` lines are
quiet, else 7 (ADR 0037 d6), read from the quiet flags, never from a line's written cadence. The count is in
Australia/Melbourne calendar dates, not hours, so a sweep that runs at one hour each day finds a reading closed at a
later hour due on the right day: days = Melbourne date of now - Melbourne date of the last until, and the reading is
due when days >= the cadence (due at day 7, not at day 6; at day 14, not 13, on the relaxed cadence). With no
Reflection yet it is due at once. A line that does not parse is skipped (run_record's torn-line rule).

stdout: one JSON object {due, cadence, quietStreak, last (the last Reflection's id, or null), lastUntil, today (the
Melbourne date of now), dueOn (the Melbourne date it falls due, or null with no Reflection), days (or null)}.
--now (tests only) is an ISO-8601 instant with Z or an offset.

Exit codes: 0 due; 4 not due; 1 reflections.jsonl or the events directory cannot be read; 2 usage (a malformed
--now); 3 no tz data (`python3 -m pip install tzdata`). Anything but 0 means do not start the reading.
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUN_RECORD_PY = os.path.join(os.path.dirname(os.path.dirname(HERE)), "_shared", "scripts", "run_record.py")
ZONE = "Australia/Melbourne"
NOT_DUE = 4


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", RUN_RECORD_PY)


class Stop(Exception):
    def __init__(self, message, code):
        Exception.__init__(self, message)
        self.code = code


def zone():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(ZONE)
    except Exception as e:  # ImportError, ZoneInfoNotFoundError
        raise Stop("no tz data for %s (%s): python3 -m pip install tzdata" % (ZONE, e), 3)


def instant(stamp):
    """An aware datetime (UTC) from any stamp run_record accepts; None when it does not parse."""
    try:
        canon = RR._stamp(stamp)
    except RR.Refused:
        return None
    return datetime.datetime.strptime(canon[:-1], "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=datetime.timezone.utc)


def read_lines():
    try:
        path = os.path.join(RR.events_dir(), RR.REFLECTIONS + ".jsonl")
    except ValueError as e:
        raise Stop("cannot resolve the events directory: %s" % e, 1)
    try:
        f = open(path, "rb")
    except FileNotFoundError:
        return []
    except OSError as e:
        raise Stop("reflections.jsonl cannot be read: %s" % e, 1)
    out = []
    try:
        with f:
            for raw in f:
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(d, dict):
                    out.append(d)
    except OSError as e:
        raise Stop("reflections.jsonl cannot be read: %s" % e, 1)
    return out


def due(lines, now, tz):
    days_of, streak = RR.cadence(lines)
    today = now.astimezone(tz).date()
    last = None
    for d in lines:
        if d.get("kind") == "reflection" and isinstance(d.get("id"), str):
            at = instant(d.get("until")) if isinstance(d.get("until"), str) else None
            if at is not None:
                last = (d["id"], d["until"], at)
    out = {"due": True, "cadence": days_of, "quietStreak": streak, "last": None, "lastUntil": None,
           "today": today.isoformat(), "dueOn": None, "days": None}
    if last is None:
        return out
    since = last[2].astimezone(tz).date()
    days = (today - since).days
    out.update({"due": days >= days_of, "last": last[0], "lastUntil": last[1],
                "dueOn": (since + datetime.timedelta(days=days_of)).isoformat(), "days": days})
    return out


class Parser(argparse.ArgumentParser):
    def error(self, message):
        sys.stderr.write("reflect-due: %s\n" % message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="reflect-due.py", description="Is the weekly Reflection due? (ADR 0037 d4 and d6)")
    p.add_argument("--now", help="tests only: an ISO-8601 instant with Z or an offset")
    a = p.parse_args(argv)
    try:
        if a.now is None:
            now = datetime.datetime.now(datetime.timezone.utc)
        else:
            now = instant(a.now)
            if now is None:
                raise Stop("--now %r is not an ISO-8601 instant with Z or an offset" % a.now, 2)
        tz = zone()
        out = due(read_lines(), now, tz)
    except Stop as e:
        sys.stderr.write("reflect-due: %s\n" % e)
        return e.code
    print(json.dumps(out))
    return 0 if out["due"] else NOT_DUE


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
