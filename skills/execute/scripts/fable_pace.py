#!/usr/bin/env python3
"""fable_pace.py — the Fable share's pace for one Login (p46-3, ADR 0079 decision 6).

The share of a drawn role's work its Fable arm takes is its Fable ceiling (its home the Rollout settings since p46-10,
rollouts.toml's `fable_ceiling_<role>` in percent, seeded by the ladder's `[share]` table for a role rollouts.toml does
not set: ladder.py's engine view) times a pace read per Login from the quota store, so that
the Login's weekly Fable window and its general weekly window run down together. reconcile-rollout.py loads this file
at each draw (mark-started's `_start_arms`, record-entry's `_lead_arm`) and writes one `fable-share` Run record line
per draw; the CLI is for its test.

    read(login, now, path=None) -> {login, fable, general, fetchedAt, why}
    pace(reading) -> float in [0, 1]
    share(ceiling, reading) -> {pace, share: {role: round(ceiling[role] * pace, 3)}}

    python3 fable_pace.py [--login L] [--now ISO] [--ceiling JSON]   # prints one JSON object, exits 0

Stdlib only, python >= 3.8, and it never raises: anything it cannot read gives a share of nothing, with `why` naming
it, and the caller draws every role Opus (never a stop).

The store. `$AGENT_QUOTAS_STORE`, else `~/.claude/state/agent-quotas.json` (an empty value counts as unset), read whole
at most STORE_MAX bytes. Its contract is the file itself (`~/repos/workspaces/_shared/scripts/agent_quotas_store.py`'s
docstring: "the file is the contract, not this module"), so this parses it on its own: top-level `accounts`, each row
`{provider, account, profile, fetched_at, windows}`, `profile` the Chorus Login's name, each window `{kind,
utilization (0-100), resets_at (unix s), fetched_at (unix s)}`, the general window `kind: seven_day` and the Fable
window `kind: custom` whose `custom_kind` or `display_name` names Fable. Two of the store's rules are mirrored here:
its `window_key` (which window is Fable's) and its `ends_at` / `expired` rule (when a window's reading stops holding:
a dated `resets_at`, a positive finite number, ends it at that instant; a null or 0 one ends it at its `fetched_at` plus
the window's 7-day period, so a fresh window with no reset dated still holds).

The reading. The `provider: anthropic` row whose `profile` is the Login (two such rows: the one with the freshest
`fetched_at`), its general and Fable windows. A window holds when its utilization is a finite number (never a bool),
clamped to 0-100, its `fetched_at` (else the row's) is within STALE_AFTER of now and at most AHEAD_MAX ahead of it, and
it has not ended. Otherwise `why` is one of: `no Login`, `no store`, `unreadable`, `no row for <login>`, `no Fable
window`, `no general window`, `stamp ahead`, `stale (<window> fetched <age> ago)`, `reset passed`; fable, general and
fetchedAt are then None. fetchedAt is the older window's `fetched_at` as a UTC Z stamp, to the second.

The pace. 0 when `why` is set or the Fable window is spent (100 or more). Else min(1, 0.5 * r), r = (1 - f) /
max(1 - g, 0.01), f and g the Fable and general utilization as fractions: half the ceiling when the two windows are
even, less when Fable is further used, more when it is behind, the whole ceiling once Fable is at least twice as far
from spent, and the whole ceiling when the general window is spent while Fable has room. It need not be exact, and
allowance left at the week's end is fine (ADR 0079 decision 6).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

STORE_DEFAULT = "~/.claude/state/agent-quotas.json"
STORE_MAX = 256 * 1024
STALE_AFTER = 2 * 60 * 60        # the store's STALE_AFTER: a window fetched longer ago reads stale
AHEAD_MAX = 5 * 60               # a stamp this far ahead of now is a clock fault, never a reading
PERIOD = 7 * 86400               # the store's PERIOD for both windows
EVEN_PACE = 0.5                  # the pace when the two windows are even
GENERAL_FLOOR = 0.01             # 1 - g is never read below this, so a spent general window gives the whole ceiling


def _num(v) -> bool:
    """A stored number: int or float, never a bool, finite (the store's is_num)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    try:
        return math.isfinite(float(v))
    except OverflowError:
        return False


def _reset_at(v):
    """The store's reset_at: the instant a `resets_at` dates, or None for anything but a positive finite number."""
    return float(v) if _num(v) and v > 0 else None


def _ended(resets_at, fetched_at, now) -> bool:
    """The store's expired(): a dated reset ends the window at that instant; with none dated, at fetched_at + PERIOD."""
    dated = _reset_at(resets_at)
    if dated is not None:
        return dated <= now
    return now > fetched_at + PERIOD


def _window_key(win):
    """The store's window_key: `general` (seven_day) or `fable` (custom, naming Fable), else None."""
    if not isinstance(win, dict):
        return None
    kind = win.get("kind")
    if kind == "seven_day":
        return "general"
    if kind == "custom":
        tag = f"{win.get('custom_kind') or ''} {win.get('display_name') or ''}".lower()
        if "fable" in tag:
            return "fable"
    return None


def _epoch(now) -> float:
    if isinstance(now, datetime):
        return (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).timestamp()
    return float(now)


def _stampz(t) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _age(seconds) -> str:
    m = max(0, int(seconds // 60))
    h, r = divmod(m, 60)
    return f"{h}h {r}m" if h else f"{m}m"


def store_path(path=None) -> str:
    """The store this reads: `path`, else $AGENT_QUOTAS_STORE (empty counts as unset), else STORE_DEFAULT; `~` expanded."""
    return os.path.expanduser(path or os.environ.get("AGENT_QUOTAS_STORE") or STORE_DEFAULT)


def _empty(login, why):
    return {"login": login, "fable": None, "general": None, "fetchedAt": None, "why": why}


def read(login, now, path=None) -> dict:
    """The Login's reading (the module docstring): {login, fable, general, fetchedAt, why}. Never raises."""
    try:
        return _read(login, _epoch(now), path)
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape reads unreadable
        return _empty(login if isinstance(login, str) else None, "unreadable")


def _read(login, now, path):
    if not isinstance(login, str) or not login.strip():
        return _empty(None, "no Login")
    p = store_path(path)
    try:
        with open(p, "rb") as f:
            raw = f.read(STORE_MAX + 1)
    except FileNotFoundError:
        return _empty(login, "no store")
    except OSError:
        return _empty(login, "unreadable")
    if len(raw) > STORE_MAX:
        return _empty(login, "unreadable")
    try:
        data = json.loads(raw.decode("utf-8"))
    except ValueError:
        return _empty(login, "unreadable")
    if not isinstance(data, dict) or not isinstance(data.get("accounts"), list):
        return _empty(login, "unreadable")
    rows = [r for r in data["accounts"] if isinstance(r, dict) and r.get("provider") == "anthropic"
            and r.get("profile") == login]
    if not rows:
        return _empty(login, f"no row for {login}")
    row = max(rows, key=lambda r: float(r["fetched_at"]) if _num(r.get("fetched_at")) else -math.inf)
    wins = {}
    for w in row.get("windows") or []:
        key = _window_key(w)
        if key is not None and key not in wins and _num(w.get("utilization")):
            wins[key] = w
    for key, why in (("fable", "no Fable window"), ("general", "no general window")):
        if key not in wins:
            return _empty(login, why)
    stamps = {}
    for key in ("fable", "general"):
        at = wins[key].get("fetched_at")
        at = at if _num(at) else row.get("fetched_at")
        if not _num(at):
            return _empty(login, f"stale ({key} fetched at no known time)")
        stamps[key] = float(at)
    for key in ("fable", "general"):
        if stamps[key] > now + AHEAD_MAX:
            return _empty(login, "stamp ahead")
    for key in ("fable", "general"):
        if now - stamps[key] > STALE_AFTER:
            return _empty(login, f"stale ({key} fetched {_age(now - stamps[key])} ago)")
    for key in ("fable", "general"):
        if _ended(wins[key].get("resets_at"), stamps[key], now):
            return _empty(login, "reset passed")
    util = {k: min(100.0, max(0.0, float(wins[k]["utilization"]))) for k in ("fable", "general")}
    clean = {k: int(v) if v == int(v) else v for k, v in util.items()}
    return {"login": login, "fable": clean["fable"], "general": clean["general"],
            "fetchedAt": _stampz(min(stamps.values())), "why": None}


def pace(reading) -> float:
    """The pace a reading gives (the module docstring): 0 with a `why` or a spent Fable window, else min(1, 0.5 * r)."""
    try:
        if not isinstance(reading, dict) or reading.get("why") or not _num(reading.get("fable")) \
                or not _num(reading.get("general")):
            return 0.0
        f, g = reading["fable"] / 100.0, reading["general"] / 100.0
        if f >= 1:
            return 0.0
        return round(min(1.0, EVEN_PACE * (1 - f) / max(1 - g, GENERAL_FLOOR)), 4)
    except Exception:  # noqa: BLE001
        return 0.0


def share(ceiling, reading) -> dict:
    """{pace, share}: each role of `ceiling` ({role: its Fable ceiling in [0, 1]}) at ceiling times the pace, rounded to
    three places. A role absent from the ceiling is absent from the share."""
    p = pace(reading)
    out = {}
    for role, c in (ceiling or {}).items() if isinstance(ceiling, dict) else ():
        if _num(c):
            out[role] = round(min(1.0, max(0.0, float(c))) * p, 3)
    return {"pace": p, "share": out}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="The Fable share's pace for one Login (prints one JSON object).")
    ap.add_argument("--login", default=None, help="the Chorus Login (the store row's profile)")
    ap.add_argument("--now", default=None, help="an ISO time (default: now)")
    ap.add_argument("--ceiling", default=None, help='a JSON object of Fable ceilings, e.g. {"builder": 0.5}')
    a = ap.parse_args(argv)
    now = datetime.now(timezone.utc)
    if a.now:
        try:
            now = datetime.fromisoformat(a.now.replace("Z", "+00:00"))
        except ValueError:
            pass
    reading = read(a.login, now)
    out = dict(reading, pace=pace(reading))
    if a.ceiling is not None:
        try:
            ceiling = json.loads(a.ceiling)
        except ValueError:
            ceiling = {}
        out["share"] = share(ceiling, reading)["share"]
    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
