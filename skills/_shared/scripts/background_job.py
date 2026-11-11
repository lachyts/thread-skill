"""background_job.py — the plumbing the background jobs share (p39-6; ADR 0066's 2026-11-06 note): the Primary refresh
(skills/_shared/scripts/primary-refresh.py) and its landing carrier (land-carrier.py), plus the one TERM-grace-KILL
stop of a child's process group that lead-integrate.py, declared-check.py, estate-scan.py and close-score.py run too.

Loaded by path only (importlib's spec_from_file_location), never imported by name or put on sys.path:
  - primary-refresh.py main(), for `run`, `install` and `stuck` only (never `bundle`), from its own bundle, else the
    primary's when its own bundle has no file. It ships as a row of primary-refresh.py's BUNDLE table, so the
    self-update stages, smokes and installs it like any other helper;
  - land-carrier.py main(), for `run` and `stuck` only (never `marker`), from its own directory: the bundle's copy
    beside it or the checkout's, never the primary's (land-carrier.py ships as a BUNDLE row too);
  - lead-integrate.py at its module top, declared-check.py and close-score.py inside their broken-install guards, and
    estate-scan.py's load_siblings(), each from this directory.
Importing it installs no signal handler, starts no subprocess and no thread, reads no environment variable and writes
nothing. Stdlib only, python >= 3.8 syntax (declared-check.py and close-score.py run on 3.8).

The pieces:
  state_path, read_state, atomic_write, write_state: a job's state file, ${XDG_STATE_HOME:-~/.local/state}/thread/<name>
    (or its --state), {"v": <version>, <key>: {...}}. A missing file reads as empty; an unreadable one, or one that is
    not UTF-8 JSON in that shape, reads as empty with one WARN, never a traceback. A write is atomic (a temp file
    beside it, then a rename), so a reader never sees half a file.
  notify, run_plain, Notified: one line to a notifier script on stdin, `--server` passed through, bounded by `timeout`:
    (rc, why, out, err, ran). rc 127 when it cannot start, 124 when it ran past its bound; `why` is its last stderr
    line, else stdout's. out and err are always text. Unused since ADR 0075 d2 (no rollout code notifies, and
    primary-refresh.py no longer calls it), but frozen (ADR 0066 decision 7): an installed older Primary refresh copy
    still calls it in process, so notify and Notified stay, unchanged.
  job_python, job_path, launchd_plist: the launchd job. The interpreter is `python3` on PATH when it is this
    interpreter, else this interpreter's own path, so a stable alias survives an upgrade; PATH is the dirs given, then
    /usr/bin, /bin, /usr/sbin and /sbin, de-duplicated.
  kill_group: SIGTERM a Popen's process group, up to `grace` seconds for it to empty, then SIGKILL, then an optional
    bounded reap.

The frozen interface (ADR 0066 decision 7, the Primary refresh's self-update contract). Every other loader loads the
copy in its own tree and moves with it, but an installed Primary refresh copy can run against a newer one: its
self-update installs this file as a helper before the copy, so an install that fails partway leaves the old copy calling
this module in process. A call that no longer binds raises at its first one (state_path, at the top of cmd_run), before
the fetch and the self-update that would heal it, on every pass; only a hand install gets out of it. So what
primary-refresh.py calls is additive only, never renamed, removed or reordered:
  - the file itself, at skills/_shared/scripts/background_job.py (primary-refresh.py's BJ_REL);
  - state_path(arg, name); read_state(path, prog, key, version), returning the pair (entries, corrupt);
    write_state(path, key, entries, version); atomic_write(path, data, mode); notify(script, message, server, run,
    timeout), returning a Notified, with `run` called as run(argv, timeout, input) and read as (rc, out, err,
    timed_out); job_python(); job_path(*first); launchd_plist(label, argv, path, interval, log); kill_group(p, grace,
    reap): each parameter by its name and in its place;
  - Notified's fields, rc, why, out, err, ran, in that order.
A new parameter goes last with a default, a new Notified field goes last, read_state stays a pair, and a new call in
primary-refresh.py joins the list. An entry never leaves it, even after primary-refresh.py stops making that call,
because an installed older copy still makes it: retiring one is a contract change that needs a hand re-install, the
same rule as tests/primary-refresh.test.sh I6's tokens. The rest (run_plain, the private helpers) is outside it.
tests/background-job.test.mjs BJ10 pins it: every `BJ.<name>(...)` call in primary-refresh.py is in a literal list,
and every listed call binds to the signatures here; BJ10b proves a retired call stays listed and binding.

What stays where. These stops are not kill_group, each for its own reason:
  - verify-slot.py `kill_group(pgid)` and `_end(child)`: verify-slot's stop works from a pgid after the Popen may be
    gone, reads EPERM as a zombie-only group and polls for REAP_WAIT until the group is gone; `_end` always KILLs once
    the command has exited, since the guard drops the slot only after the whole group is gone.
  - estate-scan.py `Runner.interrupt`: many groups under one grace, then `os._exit(130)` from the signal handler.
  - Each caller's spawn with SIGNALS held (primary-refresh.py `_run` and `_stop`, lead-integrate.py `_run_step`,
    declared-check.py `run_check`, close-score.py `run_step`): each records its child in its own place before the
    signals are let through, so the spawn stays the caller's; only the stop is shared.
  - The KILL-at-once sites (engine-snapshot.py, merge-gate.py, rollout-settings.py, git-env-canary.py, and
    verify-slot.py Guarded's fallback): no TERM and no grace, another shape.
"""
import json
import os
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from collections import namedtuple
from pathlib import Path

SYSTEM_PATH = ("/usr/bin", "/bin", "/usr/sbin", "/sbin")
WHY_MAX = 200

# ntfy-push.py's answer: its exit (127 unable to start, 124 stopped at its bound), why (its last line), what it printed
# (text), and whether it ran to an exit of its own.
Notified = namedtuple("Notified", "rc why out err ran")


def _flat(s):
    return " ".join(str(s).split())


def _last_line(text, n=WHY_MAX):
    lines = [_flat(x) for x in str(text).splitlines() if x.strip()]
    return lines[-1][:n] if lines else ""


def _text(data):
    """A child's output as text: bytes decoded (utf-8, replace), None as ""."""
    if data is None:
        return ""
    if isinstance(data, bytes):
        return data.decode("utf-8", "replace")
    return data


# ---- the state file -------------------------------------------------------------------------------------------------

def state_path(arg, name):
    """The --state path (`~` expanded), else ${XDG_STATE_HOME:-~/.local/state}/thread/<name>."""
    if arg:
        return Path(os.path.expanduser(arg))
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return Path(base) / "thread" / name


def read_state(path, prog, key, version=1):
    """(entries, corrupt): the state's `key` mapping. A missing file is ({}, False); an unreadable one ({}, False) with
    one WARN; one that is not UTF-8 JSON {"v": version, key: {...}} ({}, True) with one WARN. Never raises."""
    path = Path(path)
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return {}, False
    except OSError as e:
        print(f"WARN: {prog}: state {path} unreadable ({e}): read as empty", file=sys.stderr)
        return {}, False
    try:
        data = json.loads(raw.decode("utf-8"))  # a UnicodeDecodeError is a ValueError too
        if not isinstance(data, dict) or data.get("v") != version or not isinstance(data.get(key), dict):
            raise ValueError(f"not a v{version} {prog} state")
    except ValueError as e:
        print(f"WARN: {prog}: state {path} is corrupt ({e}): read as empty", file=sys.stderr)
        return {}, True
    return data[key], False


def atomic_write(path, data, mode=None):
    """Write data (bytes, or text as UTF-8) to path through a temp file beside it, chmod'd to mode when given (else
    mkstemp's 0600), then renamed over path; the temp file is removed on any failure."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data if isinstance(data, bytes) else data.encode("utf-8"))
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_state(path, key, entries, version=1):
    """{"v": version, key: entries}, indented and key-sorted, written atomically (mode 0600)."""
    atomic_write(path, json.dumps({"v": version, key: entries}, indent=2, sort_keys=True) + "\n")


# ---- ntfy-push ------------------------------------------------------------------------------------------------------

def run_plain(argv, timeout, input):
    """(rc, stdout, stderr, timed_out) of argv run in the caller's own process group, input on stdin. At its timeout
    subprocess.run kills the child and rc is None; out and err are always text. An OSError (it cannot start)
    propagates."""
    try:
        p = subprocess.run(argv, input=input, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        return None, _text(e.stdout), _text(e.stderr), True
    return p.returncode, p.stdout or "", p.stderr or "", False


def notify(script, message, server, run=run_plain, timeout=60):
    """Notified for one line to ntfy-push.py (`script`), run as this interpreter, through run(argv, timeout, input) ->
    (rc, out, err, timed_out)."""
    argv = [sys.executable, "-B", str(script)] + (["--server", server] if server else [])
    try:
        rc, out, err, timed_out = run(argv, timeout, message + "\n")
    except OSError as e:
        return Notified(127, _flat(e), "", "", False)
    if timed_out:
        return Notified(124, f"ntfy-push ran past {timeout} s and was stopped", out, err, False)
    return Notified(rc, _last_line(err) or _last_line(out), out, err, True)


# ---- the launchd job ------------------------------------------------------------------------------------------------

def job_python():
    """`python3` on PATH when its realpath is this interpreter's, else this interpreter's own path."""
    found = shutil.which("python3")
    if found and os.path.realpath(found) == os.path.realpath(sys.executable):
        return found
    return sys.executable


def job_path(*first):
    """The non-empty dirs in `first`, then the system dirs, de-duplicated in order, joined with `:`."""
    out = []
    for d in tuple(first) + SYSTEM_PATH:
        if d and d not in out:
            out.append(d)
    return ":".join(out)


def launchd_plist(label, argv, path, interval, log):
    """The launchd job's plist bytes: argv every `interval` seconds and at load, as a background process, with PATH,
    stdout and stderr appended to `log` (`~` expanded)."""
    log = os.path.expanduser(log)
    return plistlib.dumps({
        "Label": label,
        "ProgramArguments": list(argv),
        "EnvironmentVariables": {"PATH": path},
        "StartInterval": interval,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "StandardOutPath": log,
        "StandardErrorPath": log,
    })


# ---- the process-group stop -----------------------------------------------------------------------------------------

def kill_group(p, grace, reap=None):
    """SIGTERM the process group of Popen `p` (its own session's), wait up to `grace` s for it to empty, then SIGKILL
    it; with `reap`, wait up to that many seconds for p itself. ESRCH, or EPERM (a zombie-only group on macOS), reads
    as an empty group."""
    try:
        os.killpg(p.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        p.poll()
        return
    end = time.monotonic() + grace
    while time.monotonic() < end:
        p.poll()
        try:
            os.killpg(p.pid, 0)
        except (ProcessLookupError, PermissionError):
            return
        time.sleep(0.05)
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    if reap is not None:
        try:
            p.wait(timeout=reap)
        except subprocess.TimeoutExpired:
            pass
