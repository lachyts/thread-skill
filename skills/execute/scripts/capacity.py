#!/usr/bin/env python3
"""capacity.py — the Mac-wide Capacity reading (ADR 0067 d8): thread-skill's one reader of capacity.json.

The spec is skills/execute/away.md § Capacity (the file, its keys, its readings and the writer's duties); this module
holds its constants and its reading, and nothing else. Stdlib only. It never raises and it fails closed: anything but
a fresh, well-formed file reads as no Capacity, and its callers then fall back to today's Trickle and Away cap
(reconcile-rollout.py `_capacity_state`), never to open.

    read(now)            {file, why, capacity, writtenAt, logins, signals}: file is fresh, missing, unreadable or
                         stale; why null only when fresh; capacity (an int >= 1), writtenAt (the file's string), logins
                         ({<name>: {inside_line, why}}) and signals (the file's object, as written) are the file's, and
                         only when fresh (else null, null, {}, {}).
    suite_stop(reading)  None, or the label of the Capacity stop (p36-10, ADR 0067 d8; verify-slot.py contract 7):
                         only for a fresh reading whose signals' CAPACITY_STOP_KEY is exactly JSON true; "memory:
                         critical" when signals' `memory` is an integer (never a bool) >= CAPACITY_MEMORY_CRITICAL,
                         else "capacity: stop_suites" (Chorus saw thermal trapping notifyutil did not). Any other
                         value of the key (false, null, "true", 1, missing) is no stop and never makes the file
                         unreadable, so it never drops C. Never raises.
    restart_hold(reading)
                         None, or the level word of the restart hold (p39-7; verify-slot.py contract 7): the run a
                         Capacity stop put back in line also waits while memory is at warning or worse. Only for a
                         fresh reading whose signals' `memory` is an integer (never a bool) >= CAPACITY_MEMORY_WARN:
                         "warning" below CAPACITY_MEMORY_CRITICAL, else "critical". It ignores stop_suites (the caller
                         reads the stop first). `memory` is Chorus's `kern.memorystatus_vm_pressure_level`: 1 normal, 2
                         warning, 4 critical (chorus-p96-28); a null, a bool, a string, a float or anything below 2
                         holds nothing. Never raises.
    login(env)           The caller's Chorus Login name, or None: None unless env holds CLAUDE_CODE_SESSION_ID (a
                         Claude Code session; a Codex or other caller is never held, since the shell sets the pin in
                         every shell); else CLAUDE_ACCOUNT_PINNED stripped, else CLAUDE_CONFIG_DIR's basename (a
                         trailing slash stripped), else CAPACITY_PRIMARY_LOGIN.
    quota(reading, env)  {login, inside, why} for a fresh reading and a known caller, else None: inside is the
                         reading's logins[<login>].inside_line, false for a name the file does not list.
    quota_of(reading, name)
                         The same for a Login named outright (quota reads login(env)'s): None for a reading that is not
                         fresh or a name that is no non-empty string. `moving` reads the lead's Login this way, from the
                         `login` its lease names, never the reader's own (reconcile-rollout.py _lead_login).

The file is ~/.config/thread/capacity.json under the home dir at call time (Path.home(): a pinned HOME is the only
override, as for away.json). Chorus writes it (chorus-p96-28); a person may write it by hand.
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

CAPACITY_FILE_REL = ".config/thread/capacity.json"   # under the home dir, resolved at call time
CAPACITY_STALE_AFTER = timedelta(minutes=10)         # a written_at older than this reads stale (exactly 10:00 is fresh)
CAPACITY_FUTURE_SKEW = timedelta(minutes=5)          # a written_at further ahead than this reads stale (5:00 is fresh)
CAPACITY_MAX_BYTES = 64 * 1024
CAPACITY_WARN = "WARN: ~/.config/thread/capacity.json"   # the stale / unreadable / unresolved stderr line's prefix
CAPACITY_PRIMARY_LOGIN = "dummy"                     # Chorus's PRIMARY Login: neither the pin nor a config dir set
CAPACITY_KEYS = ("capacity", "written_at")           # both required, in away.md § Capacity's key-table order
CAPACITY_STOP_KEY = "stop_suites"                    # signals' flag: JSON true holds and stops slotted suites (p36-10)
CAPACITY_MEMORY_CRITICAL = 4                         # signals' `memory` at this level or above: the stop reads memory
CAPACITY_MEMORY_WARN = 2                             # signals' `memory` at this level or above: a Capacity-stopped
                                                     # run's restart waits (p39-7, restart_hold)


def _stamp(value):
    """(aware datetime, None) for an ISO 8601 stamp with an offset or `Z`, else (None, why): a naive stamp is refused
    as ambiguous, as reconcile-rollout.py's _away_stamp refuses one."""
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


def _field(key, value):
    """None when a key of away.md § Capacity's table holds a well-typed value, else what is wrong with it."""
    if key == "capacity":
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            return "is not a JSON integer of at least 1"
        return None
    if key == "written_at":
        why = _stamp(value)[1]
        return f"is {why}" if why else None
    if key == "signals":
        return None if isinstance(value, dict) else "is not a JSON object"
    if key == "logins":
        if not isinstance(value, dict):
            return "is not a JSON object"
        for name, entry in value.items():
            if not isinstance(entry, dict) or not isinstance(entry.get("inside_line"), bool):
                return f"[{json.dumps(name)}] has no JSON boolean `inside_line`"
            if "why" in entry and not isinstance(entry["why"], str):
                return f"[{json.dumps(name)}] `why` is not a string"
        return None
    return None


def _load(path):
    """(file, why, data): file missing, unreadable or ok (data the parsed, well-formed object)."""
    try:
        with open(path, "rb") as f:
            raw = f.read(CAPACITY_MAX_BYTES + 1)
    except (FileNotFoundError, NotADirectoryError):
        return "missing", "no file", None
    except (OSError, RuntimeError) as e:   # RuntimeError: Path.home() with no home to resolve
        return "unreadable", f"cannot read it ({getattr(e, 'strerror', None) or type(e).__name__})", None
    if len(raw) > CAPACITY_MAX_BYTES:
        return "unreadable", "over 64 KiB", None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return "unreadable", "not UTF-8", None
    try:
        data = json.loads(text)
    except (ValueError, RecursionError):
        return "unreadable", "not JSON", None
    if not isinstance(data, dict):
        return "unreadable", "not a JSON object", None
    for key in CAPACITY_KEYS:   # the first problem, in key-table order; extra keys are ignored
        if key not in data:
            return "unreadable", f"no `{key}`", None
        why = _field(key, data[key])
        if why:
            return "unreadable", f"`{key}` {why}", None
    for key in ("signals", "logins"):   # optional, the table's last rows
        if key in data:
            why = _field(key, data[key])
            if why:
                return "unreadable", f"`{key}` {why}", None
    return "ok", None, data


def read(now) -> dict:
    """The Capacity reading at `now` (an aware datetime): {file, why, capacity, writtenAt, logins, signals} (the
    module docstring). Stale: `written_at` more than CAPACITY_STALE_AFTER before now, or more than CAPACITY_FUTURE_SKEW after
    it. Never raises."""
    out = {"file": "missing", "why": "no file", "capacity": None, "writtenAt": None, "logins": {}, "signals": {}}
    try:
        file, why, data = _load(Path.home() / CAPACITY_FILE_REL)
    except Exception as e:  # noqa: BLE001 — a reading never raises: anything unforeseen fails closed
        file, why, data = "unreadable", f"cannot read it ({type(e).__name__})", None
    if data is None:
        out.update(file=file, why=why)
        return out
    written = _stamp(data["written_at"])[0]
    if now - written > CAPACITY_STALE_AFTER:
        out.update(file="stale", why=f"written_at {data['written_at']} is over 10 minutes old")
        return out
    if written - now > CAPACITY_FUTURE_SKEW:
        out.update(file="stale", why=f"written_at {data['written_at']} is more than 5 minutes ahead of now")
        return out
    logins = {name: {"inside_line": e["inside_line"], "why": e.get("why")} for name, e in (data.get("logins") or {}).items()}
    out.update(file="fresh", why=None, capacity=data["capacity"], writtenAt=data["written_at"], logins=logins,
               signals=dict(data.get("signals") or {}))
    return out


def suite_stop(reading):
    """None, or the Capacity stop's label for a fresh reading whose signals' stop_suites is JSON true (the module
    docstring). Never raises."""
    try:
        if reading.get("file") != "fresh":
            return None
        signals = reading.get("signals")
        if not isinstance(signals, dict) or signals.get(CAPACITY_STOP_KEY) is not True:
            return None
        memory = signals.get("memory")
        if isinstance(memory, int) and not isinstance(memory, bool) and memory >= CAPACITY_MEMORY_CRITICAL:
            return "memory: critical"
        return "capacity: stop_suites"
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape stops nothing
        return None


def restart_hold(reading):
    """None, or the restart hold's level word, "warning" or "critical", for a fresh reading whose signals' `memory` is
    an integer (never a bool) of at least CAPACITY_MEMORY_WARN (the module docstring). Never raises."""
    try:
        if reading.get("file") != "fresh":
            return None
        signals = reading.get("signals")
        if not isinstance(signals, dict):
            return None
        memory = signals.get("memory")
        if isinstance(memory, bool) or not isinstance(memory, int) or memory < CAPACITY_MEMORY_WARN:
            return None
        return "critical" if memory >= CAPACITY_MEMORY_CRITICAL else "warning"
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape holds nothing
        return None


def login(env):
    """The caller's Login name (the module docstring), or None for a caller that is no Claude Code session."""
    if not (env.get("CLAUDE_CODE_SESSION_ID") or "").strip():
        return None
    pin = (env.get("CLAUDE_ACCOUNT_PINNED") or "").strip()
    if pin:
        return pin
    cfg = (env.get("CLAUDE_CONFIG_DIR") or "").strip().rstrip("/")
    name = os.path.basename(cfg) if cfg else ""
    return name or CAPACITY_PRIMARY_LOGIN


def quota(reading, env):
    """{login, inside, why} for a fresh reading and a caller login() names, else None. Never raises."""
    try:
        return quota_of(reading, login(env))
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape holds nothing
        return None


def quota_of(reading, name):
    """{login, inside, why} for a fresh reading and the Login `name` (a non-empty string), else None. Never raises."""
    try:
        if reading.get("file") != "fresh" or not isinstance(name, str) or not name:
            return None
        entry = (reading.get("logins") or {}).get(name)
        inside = bool(entry and entry.get("inside_line"))
        return {"login": name, "inside": inside, "why": (entry or {}).get("why") if inside else None}
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape holds nothing
        return None
