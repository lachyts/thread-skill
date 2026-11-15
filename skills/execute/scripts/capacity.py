#!/usr/bin/env python3
"""capacity.py — the Mac-wide Capacity reading (ADR 0067 d8): thread-skill's one reader of capacity.json.

The spec is skills/execute/away.md § Capacity (the file, its keys, its readings and the writer's duties); this module
holds its constants and its reading, and nothing else. Stdlib only. It never raises and it fails closed: anything but
a fresh, well-formed file reads as no Capacity, and its callers then fall back to today's Trickle and Away cap
(reconcile-rollout.py `_capacity_state`), never to open.

    read(now)            {file, why, capacity, writtenAt, logins, signals, budget}: file is fresh, missing,
                         unreadable or stale; why null only when fresh; capacity (an int >= 1), writtenAt (the file's
                         string), logins ({<name>: {inside_line, why}}) and signals (the file's object, as written) are
                         the file's, and only when fresh (else null, null, {}, {}). budget (p53-2, ADR 0083 d4) is
                         {mem_gb, cores}, rebuilt from those two keys (any other dropped), only when fresh and both are
                         finite numbers above 0 (never a bool); else null, and the file reads as it does without one.
    suite_stop(reading)  None, or the label of the Capacity stop (p36-10, ADR 0067 d8; verify-slot.py contract 7):
                         only for a fresh reading whose signals' CAPACITY_STOP_KEY is exactly JSON true; "memory:
                         critical" when signals' `memory` is an integer (never a bool) >= CAPACITY_MEMORY_CRITICAL and
                         memory is Strain (below), else "capacity: stop_suites" (Chorus saw thermal trapping notifyutil
                         did not, or memory is a Mac fault). Any other value of the key (false, null, "true", 1,
                         missing) is no stop and never makes the file unreadable, so it never drops C. A writer that
                         tells Strain from a fault (ADR 0083 d2) sets stop_suites for Strain only: the flag is obeyed as
                         written, and only its label asks whose memory it is. Never raises.
    restart_hold(reading)
                         None, or the level word of the restart hold (p39-7; verify-slot.py contract 7): the run a
                         Capacity stop put back in line also waits while memory is Strain at warning or worse. Only for
                         a fresh reading. Strain (ADR 0083 d2): while signals' CAPACITY_FAULT_KEY is a JSON list of
                         strings (the writer tells Strain from a fault), memory is Strain only while "memory" is in
                         signals' CAPACITY_FREEZE_KEY (a JSON list; anything else holds nothing), whatever the level;
                         with no such key, or an ill-typed one (an older writer), it reads the raw level as before:
                         signals' `memory` an integer (never a bool) >= CAPACITY_MEMORY_WARN. Then "critical" when
                         `memory` is an integer of at least CAPACITY_MEMORY_CRITICAL, else "warning". It ignores
                         stop_suites (the caller reads the stop first). `memory` is Chorus's
                         `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical (chorus-p96-28); read
                         raw, a null, a bool, a string, a float or anything below 2 holds nothing. Never raises.
    fault(reading)       None, or the Mac fault a fresh reading names (ADR 0083 d2): {signals, holder} while signals'
                         CAPACITY_FAULT_KEY is a non-empty JSON list of strings; signals is that list, holder
                         {name, mem_gb} from signals' CAPACITY_HOLDER_KEY when it is an object with a non-empty string
                         `name` (mem_gb a finite number, never a bool, else None), else None. It is said, never obeyed:
                         nothing here holds or waits on it. Never raises.
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
    peak(tree, since, ref, now)
                         A Slot's peak (p53-2, ADR 0083 d4; away.md § Capacity, *A Slot's peak*): {mem_gb, cores},
                         rebuilt from slot-peaks.json's entry for the task tree `tree`, or None. None for a file that
                         cannot be read (missing, a directory, over SLOT_PEAKS_MAX_BYTES, not UTF-8, not JSON, not an
                         object, a `written_at` missing or naive, `slots` not an object); for a stale one, by
                         capacity.json's bounds, `written_at` more than CAPACITY_STALE_AFTER before `ref` (the call's
                         end) or more than CAPACITY_FUTURE_SKEW after `now`; for no entry (an exact key equal to `tree`
                         wins, else the first absolute key whose real path is `tree`'s, `~` expanded on both sides; a
                         relative key is skipped); and for an entry whose `mem_gb` or `cores` is no finite number of at
                         least 0 (a bool or NaN included) or whose `last` is no aware stamp at or after `since` (the
                         Slot's first slot-taken: an earlier `last` holds no sample of this Slot). Never raises.

The file is ~/.config/thread/capacity.json under the home dir at call time (Path.home(): a pinned HOME is the only
override, as for away.json). Chorus writes it (chorus-p96-28); a person may write it by hand. slot-peaks.json
(SLOT_PEAKS_FILE_REL) sits beside it, under the same home, and Chorus writes it too (chorus-p109-8).
"""
import json
import math
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
CAPACITY_FAULT_KEY = "fault"                         # signals' list of the signals standing as a Mac fault (ADR 0083
                                                     # d2): its presence says the writer tells Strain from a fault
CAPACITY_FREEZE_KEY = "freeze"                       # signals' list of the signals freezing Capacity: Strain only
                                                     # while CAPACITY_FAULT_KEY is present
CAPACITY_HOLDER_KEY = "holder"                       # signals' {name, mem_gb}: the process a memory fault is read from
CAPACITY_MEMORY_SIGNAL = "memory"                    # the memory signal's name in the fault and freeze lists
SLOT_PEAKS_FILE_REL = ".config/thread/slot-peaks.json"   # each task tree's peak (p53-2), under the home dir
SLOT_PEAKS_MAX_BYTES = 256 * 1024                    # 24 h of entries; a larger file reads as no peak


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
    """The Capacity reading at `now` (an aware datetime): {file, why, capacity, writtenAt, logins, signals, budget} (the
    module docstring). Stale: `written_at` more than CAPACITY_STALE_AFTER before now, or more than CAPACITY_FUTURE_SKEW after
    it. Never raises."""
    out = {"file": "missing", "why": "no file", "capacity": None, "writtenAt": None, "logins": {}, "signals": {},
           "budget": None}
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
               signals=dict(data.get("signals") or {}), budget=_room(data.get("budget"), positive=True))
    return out


def _finite(value):
    """Whether a JSON value is a finite number: an int or a float, never a bool, never NaN or an infinity."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return isinstance(value, int) or math.isfinite(value)


def _room(value, positive):
    """{mem_gb, cores} rebuilt from an object whose two keys are finite numbers, above 0 when `positive` (a budget),
    else at least 0 (a peak); any other key is dropped. None for anything else."""
    if not isinstance(value, dict):
        return None
    room = {k: value.get(k) for k in ("mem_gb", "cores")}
    if not all(_finite(v) and (v > 0 if positive else v >= 0) for v in room.values()):
        return None
    return room


def _tree_entry(slots, tree):
    """The entry slots holds for the task tree `tree`: an exact key wins, else the first absolute key (after `~`) whose
    real path is the tree's. None with none."""
    if tree in slots:
        return slots[tree]
    want = os.path.realpath(os.path.expanduser(tree))
    for key, entry in slots.items():
        path = os.path.expanduser(key) if isinstance(key, str) else ""
        if os.path.isabs(path) and os.path.realpath(path) == want:
            return entry
    return None


def peak(tree, since, ref, now):
    """The task tree's peak from slot-peaks.json, {mem_gb, cores}, or None (the module docstring). `since` is the
    Slot's first slot-taken, `ref` the call's end (else now), `now` this reconcile's clock: aware datetimes. Never
    raises."""
    try:
        path = Path.home() / SLOT_PEAKS_FILE_REL
        with open(path, "rb") as f:
            raw = f.read(SLOT_PEAKS_MAX_BYTES + 1)
        if len(raw) > SLOT_PEAKS_MAX_BYTES:
            return None
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            return None
        written = _stamp(data.get("written_at"))[0]
        slots = data.get("slots")
        if written is None or not isinstance(slots, dict):
            return None
        if ref - written > CAPACITY_STALE_AFTER or written - now > CAPACITY_FUTURE_SKEW:
            return None
        if not isinstance(tree, str) or not os.path.isabs(os.path.expanduser(tree)):
            return None
        entry = _tree_entry(slots, tree)
        if not isinstance(entry, dict):
            return None
        last = _stamp(entry.get("last"))[0]
        if last is None or last < since:
            return None
        return _room(entry, positive=False)
    except Exception:  # noqa: BLE001 — a reading never raises: any read error or unforeseen shape is no peak
        return None


def _level(memory):
    """Whether signals' `memory` is a level: an integer, never a bool."""
    return isinstance(memory, int) and not isinstance(memory, bool)


def _strain_told(signals):
    """Whether the writer tells Strain from a Mac fault (ADR 0083 d2): signals' CAPACITY_FAULT_KEY is a JSON list of
    strings. Absent or ill-typed reads as an older writer's file, the raw level as before."""
    fault = signals.get(CAPACITY_FAULT_KEY)
    return isinstance(fault, list) and all(isinstance(name, str) for name in fault)


def _memory_strain(signals, memory):
    """Whether memory is Strain (the module docstring's restart_hold): told, "memory" in signals' CAPACITY_FREEZE_KEY
    (a JSON list), whatever the level; else the raw level, an integer of at least CAPACITY_MEMORY_WARN."""
    if _strain_told(signals):
        freeze = signals.get(CAPACITY_FREEZE_KEY)
        return isinstance(freeze, list) and CAPACITY_MEMORY_SIGNAL in freeze
    return _level(memory) and memory >= CAPACITY_MEMORY_WARN


def suite_stop(reading):
    """None, or the Capacity stop's label for a fresh reading whose signals' stop_suites is JSON true (the module
    docstring): `memory: critical` only while memory is Strain. Never raises."""
    try:
        if reading.get("file") != "fresh":
            return None
        signals = reading.get("signals")
        if not isinstance(signals, dict) or signals.get(CAPACITY_STOP_KEY) is not True:
            return None
        memory = signals.get("memory")
        if _level(memory) and memory >= CAPACITY_MEMORY_CRITICAL and _memory_strain(signals, memory):
            return "memory: critical"
        return "capacity: stop_suites"
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape stops nothing
        return None


def restart_hold(reading):
    """None, or the restart hold's level word, "warning" or "critical", for a fresh reading whose memory is Strain
    (the module docstring): told, "memory" in signals' freeze; else signals' `memory` an integer (never a bool) of at
    least CAPACITY_MEMORY_WARN. Never raises."""
    try:
        if reading.get("file") != "fresh":
            return None
        signals = reading.get("signals")
        if not isinstance(signals, dict):
            return None
        memory = signals.get("memory")
        if not _memory_strain(signals, memory):
            return None
        return "critical" if _level(memory) and memory >= CAPACITY_MEMORY_CRITICAL else "warning"
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape holds nothing
        return None


def fault(reading):
    """None, or {signals, holder}: the Mac fault a fresh reading names (the module docstring). Said, never obeyed.
    Never raises."""
    try:
        if reading.get("file") != "fresh":
            return None
        signals = reading.get("signals")
        if not isinstance(signals, dict) or not _strain_told(signals) or not signals[CAPACITY_FAULT_KEY]:
            return None
        holder, raw = None, signals.get(CAPACITY_HOLDER_KEY)
        if isinstance(raw, dict) and isinstance(raw.get("name"), str) and raw["name"].strip():
            gb = raw.get("mem_gb")
            ok = _level(gb) or (isinstance(gb, float) and math.isfinite(gb))
            holder = {"name": raw["name"], "mem_gb": gb if ok else None}
        return {"signals": list(signals[CAPACITY_FAULT_KEY]), "holder": holder}
    except Exception:  # noqa: BLE001 — a reading never raises: an unforeseen shape names no fault
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
