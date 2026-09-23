#!/usr/bin/env python3
"""Resolve a defer day to one `YYYY-MM-DD Ddd` line, in Australia/Melbourne.

The contract lives in task-writer.md § 3; this is its portable implementation (stdlib only,
python >= 3.9), replacing the BSD-only `date` day arithmetic. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/resolve-day.py [<day>] [--now <ISO-8601 instant>]

<day>, case-insensitive: absent or `tomorrow` -> today + 1; a weekday (`mon`/`monday`, optional
leading `next`) -> its next future occurrence, 1-7 days ahead, never today; `YYYY-MM-DD`, `D mon` or
`mon D` (year = the current Melbourne year) -> that date, refused if before today.

Exit 0 with the line on stdout. Exit 2 when the input (or --now) is refused, exit 3 when the zone
cannot be loaded (no tz data: install tzdata). On failure stdout is empty and stderr carries one line
starting `resolve-day: `. The zone never falls back to local time or UTC.

--now is for tests only: an aware ISO-8601 instant (a trailing Z is accepted).
"""
import argparse
import re
import sys
from datetime import date, datetime, timedelta, timezone

ZONE = "Australia/Melbourne"
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]  # date.weekday() order; not locale-bound
WEEKDAY_NAMES = {}
for _i, _full in enumerate(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]):
    WEEKDAY_NAMES[_full] = _i
    WEEKDAY_NAMES[_full[:3]] = _i
MONTH_NAMES = {}
for _i, _full in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                            "september", "october", "november", "december"], start=1):
    MONTH_NAMES[_full] = _i
    MONTH_NAMES[_full[:3]] = _i


def fail(code, reason):
    sys.stderr.write("resolve-day: %s\n" % reason)
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        fail(2, message)


def load_zone():
    try:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    except ImportError:
        fail(3, "python >= 3.9 required (zoneinfo)")
    try:
        return ZoneInfo(ZONE)
    except ZoneInfoNotFoundError:
        fail(3, "no tz data for %s; install tzdata: python3 -m pip install tzdata" % ZONE)


def parse_now(value):
    text = value.strip()
    if text[-1:] in ("Z", "z"):  # fromisoformat only accepts Z from python 3.11
        text = text[:-1] + "+00:00"
    try:
        now = datetime.fromisoformat(text)
    except ValueError:
        fail(2, "--now is not an ISO-8601 instant: %r" % value)
    if now.tzinfo is None or now.utcoffset() is None:
        fail(2, "--now must carry a UTC offset or Z: %r" % value)
    return now


def make_date(year, month, day, raw):
    try:
        return date(year, month, day)
    except ValueError:
        fail(2, "not a calendar date: %r" % raw)


def resolve(text, today):
    if text in ("", "tomorrow"):
        return today + timedelta(days=1)

    words = text.split(" ")
    if words[0] == "next":
        if len(words) != 2 or words[1] not in WEEKDAY_NAMES:
            fail(2, "`next` takes a weekday: %r" % text)
        words = words[1:]
    if len(words) == 1 and words[0] in WEEKDAY_NAMES:
        delta = (WEEKDAY_NAMES[words[0]] - today.weekday()) % 7 or 7
        return today + timedelta(days=delta)

    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        target = make_date(int(m.group(1)), int(m.group(2)), int(m.group(3)), text)
    else:
        m = re.fullmatch(r"(\d{1,2}) ([a-z]+)", text) or re.fullmatch(r"([a-z]+) (\d{1,2})", text)
        if not m:
            fail(2, "unrecognised day: %r" % text)
        day_s, month_s = (m.group(1), m.group(2)) if m.group(1).isdigit() else (m.group(2), m.group(1))
        if month_s not in MONTH_NAMES:
            fail(2, "unrecognised day: %r" % text)
        target = make_date(today.year, MONTH_NAMES[month_s], int(day_s), text)
    if target < today:
        fail(2, "%s is before today (%s)" % (target.isoformat(), today.isoformat()))
    return target


def main(argv):
    parser = Parser(prog="resolve-day", description="Resolve a defer day in %s." % ZONE)
    parser.add_argument("day", nargs="*", help="tomorrow | <weekday> | next <weekday> | YYYY-MM-DD | D mon | mon D")
    parser.add_argument("--now", help="tests only: an aware ISO-8601 instant")
    args = parser.parse_args(argv)

    tz = load_zone()
    now = parse_now(args.now) if args.now is not None else datetime.now(timezone.utc)
    today = now.astimezone(tz).date()  # all arithmetic is on the Melbourne date, never on an instant
    text = " ".join(" ".join(args.day).split()).lower()
    target = resolve(text, today)
    sys.stdout.write("%s %s\n" % (target.isoformat(), WEEKDAYS[target.weekday()]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
