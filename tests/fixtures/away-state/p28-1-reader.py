#!/usr/bin/env python3
"""The Away state reader of an engine snapshot from before p29-8: p28-1's, frozen verbatim (ADR 0043).

The block between the FROZEN lines is skills/execute/scripts/reconcile-rollout.py at 5ee55af (lines 2747-2844): its
constants and _away_stamp, _away_read, _away_field and _away_state, unchanged. A rollout whose Engine snapshot predates
p29-8 reads ~/.config/thread/away.json with exactly this code, so the trickle suite's A13 checks that the Away cap's
key (`away_cap`, ADR 0049) is safe to write while such a rollout is live, a paused one included: this reader ignores it
as an extra key and runs Away to each rollout's own ceiling, as it did. It is vendored because CI checks the repo out
at depth 1, so no test can rebuild an older snapshot from git history (`git show <old sha>`). Never edit the frozen
block: it is the older snapshot's behaviour, not this tree's. tests/contracts/away-state.test.mjs (rule older-reader)
pins that the live AWAY_KEYS still equals the frozen one.

Usage: p28-1-reader.py --now <ISO 8601> --ceiling <n> --elsewhere <n>
Prints {file, away, limit, slotLimit} as one JSON object, slotLimit by p28-1's formula: the ceiling while Away, else
min(ceiling, max(0, limit - elsewhere)). The home dir is the call's (pin HOME).
"""
import argparse
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

# ---- FROZEN: reconcile-rollout.py at 5ee55af, lines 2747-2844 ---------------------------------------------------
# ---- the Trickle and Away (Chorus ADR 0104 d2, d3, d6; execute away.md) ----------------------------------------

AWAY_FILE_REL = ".config/thread/away.json"                    # under the home dir, resolved at call time
AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at")  # all required, in away.md's key-table order
DEFAULT_TRICKLE = 2                                            # missing, stale or unreadable: not Away, at this
AWAY_STALE_AFTER = timedelta(hours=24)                         # a written_at older than this reads stale
AWAY_FUTURE_SKEW = timedelta(minutes=5)                        # a written_at further ahead than this reads stale
AWAY_MAX_BYTES = 64 * 1024
MORNING_RE = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]\Z", re.ASCII)
AWAY_WARN = "WARN: ~/.config/thread/away.json"                 # the stale / unreadable stderr line's prefix
TRICKLE_PREFIX = "trickle:"                                    # a row held for want of a Trickle Slot


def _away_stamp(value):
    """(aware datetime, None) for an ISO 8601 stamp with an offset or `Z`, else (None, why). A naive stamp is refused
    as ambiguous: the writer and the reader may not share a time zone."""
    if not isinstance(value, str):
        return None, "not a string"
    s = value.strip()
    if s[-1:] in ("Z", "z"):
        s = s[:-1] + "+00:00"
    try:
        ts = datetime.fromisoformat(s)
    except ValueError:
        return None, "not an ISO 8601 stamp"
    if ts.tzinfo is None:
        return None, "naive (no offset or Z)"
    return ts, None


def _away_read(path: Path):
    """(file, why, data) for the state file at `path`: file is missing, unreadable or ok (data the parsed object)."""
    try:
        with open(path, "rb") as f:
            raw = f.read(AWAY_MAX_BYTES + 1)
    except (FileNotFoundError, NotADirectoryError):
        return "missing", "no file", None
    except OSError as e:
        return "unreadable", f"cannot read it ({e.strerror or type(e).__name__})", None
    if len(raw) > AWAY_MAX_BYTES:
        return "unreadable", "over 64 KiB", None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return "unreadable", "not UTF-8", None
    try:
        data = json.loads(text)
    except ValueError:
        return "unreadable", "not JSON", None
    if not isinstance(data, dict):
        return "unreadable", "not a JSON object", None
    for key in AWAY_KEYS:  # the first problem, in key-table order; extra keys are ignored
        if key not in data:
            return "unreadable", f"no `{key}`", None
        why = _away_field(key, data[key])
        if why:
            return "unreadable", f"`{key}` {why}", None
    return "ok", None, data


def _away_field(key, value):
    """None when one of AWAY_KEYS holds a well-typed value, else what is wrong with it (away.md's key table)."""
    if key == "away":
        return None if isinstance(value, bool) else "is not a JSON boolean"
    if key in ("until", "written_at"):
        why = _away_stamp(value)[1]
        return f"is {why}" if why else None
    if key == "morning":
        return None if isinstance(value, str) and MORNING_RE.match(value) else 'is not "HH:MM" (00:00 to 23:59)'
    # trickle: a JSON integer of at least 1; a bool, a float, a string or 0 is refused (the Trickle is never 0)
    return None if not isinstance(value, bool) and isinstance(value, int) and value >= 1 else \
        "is not a JSON integer of at least 1"


def _away_state(now) -> dict:
    """The Away state `next` reads (execute away.md § Reading it): {away, file, why, limit, until, morning}. `file` is
    fresh, missing, stale or unreadable; `why` is null only when fresh. Anything but fresh reads not Away at
    DEFAULT_TRICKLE, and a stale file's own `trickle` is ignored. Stale is any of: `until` <= now; now - `written_at`
    over 24 h; `written_at` more than 5 minutes after now. `until` and `morning` are the file's, reported only when
    fresh. The path is the home dir's at call time (a pinned HOME is the only override)."""
    out = {"away": False, "file": "missing", "why": None, "limit": DEFAULT_TRICKLE, "until": None, "morning": None}
    file, why, data = _away_read(Path.home() / AWAY_FILE_REL)
    if data is None:
        out.update(file=file, why=why)
        return out
    until = _away_stamp(data["until"])[0]
    written = _away_stamp(data["written_at"])[0]
    if until <= now:
        why = f"until {data['until']} has passed"
    elif now - written > AWAY_STALE_AFTER:
        why = f"written_at {data['written_at']} is over 24 h old"
    elif written - now > AWAY_FUTURE_SKEW:
        why = f"written_at {data['written_at']} is more than 5 minutes ahead of now"
    if why:
        out.update(file="stale", why=why)
        return out
    out.update(away=data["away"], file="fresh", limit=data["trickle"], until=data["until"], morning=data["morning"])
    return out
# ---- end FROZEN ---------------------------------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="p28-1's Away state reader and slotLimit, frozen (ADR 0043)")
    ap.add_argument("--now", required=True)
    ap.add_argument("--ceiling", type=int, required=True)
    ap.add_argument("--elsewhere", type=int, required=True)
    args = ap.parse_args()
    now, why = _away_stamp(args.now)
    if now is None:
        ap.error(f"--now is {why}")
    away = _away_state(now)
    slot_limit = args.ceiling if away["away"] else min(args.ceiling, max(0, away["limit"] - args.elsewhere))
    print(json.dumps({"file": away["file"], "away": away["away"], "limit": away["limit"], "slotLimit": slot_limit}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
