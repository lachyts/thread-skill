#!/usr/bin/env python3
"""capacity.py — the Mac-wide Capacity reading (ADR 0067 d8): thread-skill's one reader of capacity.json.

The spec is skills/execute/away.md § Capacity (the file, its keys, its readings and the writer's duties); this module
holds its constants and its reading, and nothing else. Stdlib only. It never raises and it fails closed: anything but
a fresh, well-formed file reads as no Capacity, and its callers then fall back to today's Trickle and Away cap
(reconcile-rollout.py `_capacity_state`), never to open.

    read(now)            {file, why, capacity, writtenAt, logins}: file is fresh, missing, unreadable or stale; why
                         null only when fresh; capacity (an int >= 1), writtenAt (the file's string) and logins
                         ({<name>: {inside_line, why}}) are the file's, and only when fresh (else null, null, {}).
    login(env)           The caller's Chorus Login name, or None: None unless env holds CLAUDE_CODE_SESSION_ID (a
                         Claude Code session; a Codex or other caller is never held, since the shell sets the pin in
                         every shell); else CLAUDE_ACCOUNT_PINNED stripped, else CLAUDE_CONFIG_DIR's basename (a
                         trailing slash stripped), else CAPACITY_PRIMARY_LOGIN.
    quota(reading, env)  {login, inside, why} for a fresh reading and a known caller, else None: inside is the
                         reading's logins[<login>].inside_line, false for a name the file does not list.

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
    """The Capacity reading at `now` (an aware datetime): {file, why, capacity, writtenAt, logins} (the module
    docstring). Stale: `written_at` more than CAPACITY_STALE_AFTER before now, or more than CAPACITY_FUTURE_SKEW after
    it. Never raises."""
    out = {"file": "missing", "why": "no file", "capacity": None, "writtenAt": None, "logins": {}}
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
    out.update(file="fresh", why=None, capacity=data["capacity"], writtenAt=data["written_at"], logins=logins)
    return out


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
        if reading.get("file") != "fresh":
            return None
        name = login(env)
        if name is None:
            return None
        entry = (reading.get("logins") or {}).get(name)
        inside = bool(entry and entry.get("inside_line"))
        return {"login": name, "inside": inside, "why": (entry or {}).get("why") if inside else None}
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape holds nothing
        return None
