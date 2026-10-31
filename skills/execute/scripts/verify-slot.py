#!/usr/bin/env python3
"""verify-slot.py — the machine-wide verify slots, and the guard that ends a killed holder's suite (p23-4).

A rollout at ceiling 4 runs up to four task calls, each with its own verifier, beside the lead's Integration
verify and RACE re-verify; other rollouts on the machine run theirs too. Each verifier is a full suite, so
unbounded they pile onto one machine (2026-10-17: load 66 on 12 cores, and a merge lost to a load flake). A
**verify slot** bounds that: at most `verify_slots` (rollouts.toml, `[defaults]` only, built-in 2) slotted
suites run at once across every rollout on this machine; a further one waits for a slot. This header is the one
copy of the contract.

    python3 verify-slot.py run --slots N [--priority] [--slot-wait S] -- CMD…   # the agents' wrapper (engine-rendered)
    python3 verify-slot.py wait --log FILE [--pid P] [--for S]     # an agent's in-turn wait for a run's verdict
    python3 verify-slot.py status [--slots N]                      # the operator's view (JSON)

Importable (lead-integrate.py's `verify --slots N --slot-wait S` loads it by importlib, and reconcile-rollout.py's
`next` for the heat reading): slots_dir(), SlotDirError, acquire(), Slot, Guarded, kill_group(), write_holder(),
held_by(), heat_level(), heat_name(), KILL_GRACE, REAP_WAIT, GUARD_POLL, HEAT_KEY, HEAT_NAMES, HEAT_HOLD, HEAT_STOP,
HEAT_EXIT, HEAT_ENV, HEAT_POLL_FACTOR, HEAT_SETTLE, HEAT_STOPPED, HELD_ENV.

The pool. `slot-0.lock` … `slot-(N-1).lock` in
`${THREAD_VERIFY_SLOTS_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/thread/verify-slots}` (run_record.py's
chain: an empty value is unset, a relative XDG_STATE_HOME is ignored, a relative override is refused). A slot
is held by `fcntl.flock(LOCK_EX | LOCK_NB)` on its file, polled with jitter (THREAD_VERIFY_SLOT_POLL sets the
base in seconds, default 1; a value that is not a positive number falls back). The holder's record
{pid, guard, group, cwd, since, kind} is written into the lock file itself; a half-written one reads
"unreadable".

Contract.
1. Release closes the fd and never calls LOCK_UN. An flock belongs to the open file description, and the
   guard (below) holds the same description through an inherited fd, so an unlock by the wrapper would free
   the slot for the guard too while it is still ending its suite: N+1 suites would run. A close drops only
   the wrapper's reference; the guard's keeps the slot held until the guard exits. An unexpected exception
   after the spawn closes the death fd (the guard starts ending the suite) and the slot fd, and re-raises
   without waiting: the guard's reference keeps the slot held until the suite is gone.
2. There is no staleness timer. A slot frees when the last holder of its lock's open file description exits
   or closes it; the kernel drops the lock of a process that dies by any means.
3. The guard. Every slotted command runs under a guard: a small python process (`_guard`) in its own session,
   so a kill of the caller's process group or session never reaches it. It starts isolated (`python3 -I`, p34-1): it
   ignores PYTHONPATH, PYTHONHOME and the user site, so a command's own python environment (a shadowing json.py)
   never stops it, and the command still gets that environment unchanged, plus the marker: a command run in a held
   slot sees HELD_ENV (`VERIFY_SLOT_HELD=1`, p34-1), so a full suite it starts, even one reparented out of its process
   tree (daemonised, tmux), can tell it already holds one and never queues for a second; a caller's own value passes
   through, and an unslotted (fail-open) run sets none. The guard starts the command in a
   session of its own (its own process group, pgid = its pid), reports that pgid on a pipe, and watches a
   death pipe whose write end only the caller holds. On EOF (the caller exited, was killed by any means, or
   closed it to stop the run) or a TERM/INT/HUP to the guard, it ends the command's group: killpg(TERM),
   up to KILL_GRACE seconds for the command to exit, killpg(KILL), then waitpid on the command (bounded by
   REAP_WAIT). Only then does it exit, and only its exit drops the last reference to the slot's lock. So "no
   overlap" rests on this: the slot is dropped only after the whole group has been SIGKILLed and the command
   itself reaped. A SIGKILLed process runs no further instruction, so a grandchild left a zombie until launchd
   reaps it is not running. A command that exits by itself frees the slot at once; background processes it
   left behind hold no slot and are not killed (as before the slot existed).
4. Stop a run by its wrapper's pid (`kill <pid>`): TERM, INT or HUP to `run` only closes the death pipe, so
   every stop (a signal, a SIGKILL, a group or session kill, a harness timeout) takes the guard's one kill
   path, and `run` exits 128+n once the guard is done. A guard SIGKILLed alone leaves the command running: the
   wrapper then kills the reported group itself (TERM; KILL_GRACE; KILL; polled until it is gone, bounded by
   REAP_WAIT) before it releases, and exits 128+9. A stop before the guard spawned the suite (in the slot wait, or
   between the slot and the spawn) has no suite to end, so it is no verdict, never red (p32-1): `run` exits HEAT_EXIT
   (76) with `verify-slot: no verdict: stopped before the suite started; exit 76` (while it waits on the heat or is
   back in line after a heat stop, contract 7's line instead). Only a stop once the suite is spawned is 128+n.
5. The Integration priority. lead-integrate.py's `verify` (the lead's Integration verify and RACE re-verify)
   and `run --priority` (the integrate call's own verifier, rendered only by the engine's integrate mode)
   register a waiter file (`waiter-<pid>-<rand>.wait`, held LOCK_EX while they wait: liveness is the flock,
   never a pid). A non-priority acquirer takes a slot only when it can hold (live waiters + 1) free slots at
   once, keeps one and closes the rest; priority acquirers ignore the count and compete by polling. Every
   poll, and `status`, reaps a `waiter-*.wait` or `.waiter-*.tmp` it can flock LOCK_NB (the inode re-checked
   against the path before the unlink).
6. Residuals. A slots dir deleted while held, or a different HOME or XDG chain, makes a separate pool. A
   process the suite itself moves into another session or group escapes the guard's kill, as it escapes a
   harness kill today, and so does a suite whose guard and wrapper are SIGKILLed together (a tree kill by pid
   snapshot). An unusable slots dir fails open: `verify-slot: WARN <dir>: <err>; running unslotted`, and the
   command still runs under the guard. The `status` probe of a free slot holds it for microseconds, so an
   acquirer at that instant waits one more poll.
7. The Heat hold (estate ADR 0009 d5). The reading is heat_level(): `notifyutil -g HEAT_KEY`, 0 nominal, 1
   moderate, 2 heavy, 3 trapping, 4 sleeping, read fresh each time (never cached); THREAD_HEAT_LEVEL 0 to 4 pins it
   (the tests' pin), any other value is ignored. At heavy (HEAT_HOLD) or worse no slot is free: every poll of
   acquire() reads it first and tries no slot, a priority waiter keeping its waiter file, and the wait line is
   `waiting (heat: <name>)`; max_wait still bounds the whole wait. At trapping or sleeping (HEAT_STOP) a running
   slotted suite is stopped: Guarded.watch() reads the level every HEAT_POLL_FACTOR * the poll base and first gives
   the guard HEAT_SETTLE to exit by itself, so a command that already ended keeps its own rc (green or red) and is
   never rerun; only a guard still there is stopped (the guard's TERM, KILL_GRACE, KILL, reaped), its slot released
   (a close), and the caller goes back in line, at the back, to restart from the beginning once the level is below
   heavy. Heavy never stops a running suite. A heat stop is never red: `run` exits HEAT_EXIT (76), no verdict, when
   a stop signal lands before the suite starts (contract 4: while it waits on the heat or is back in line after a
   heat stop, `verify-slot: no verdict: stopped while the Mac was hot (heat: <name>); exit 76`), or when its slot wait
   runs out (`--slot-wait`, p32-1: `verify-slot: no verdict: no verify slot within <S>s[ (heat: <name>)]; exit 76`,
   the name the heat that held its last poll, else its last heat stop's), and lead-integrate.py's verify reads `heat`
   (exit 76). Its slot wait is one deadline across heat restarts: a re-queue after a heat stop tries only while time
   is left, and with none left makes no try. Fails open, like an unusable slots dir: no notifyutil (Linux, CI), a non-zero exit, a
   2 s timeout or output it cannot parse reads 0, and an unslotted run (a SlotDirError) has no heat watch.
   Residuals: a command that exits after the settle check, inside the guard's last poll (at most one GUARD_POLL),
   reads as heat-stopped and is rerun (no verdict, never red); a copy of this script from before the Heat hold
   (another rollout's Engine snapshot, an older plugin install) shares the pool and still runs hot.
8. The Run record (p29-10, ADR 0051). A `run` whose real cwd lies under `<repo>/.claude/worktrees/<slug>` (the last
   such part) and whose task note, reconcile-rollout.py's DEFAULT_TASKS_DIR/<slug>.md, names a rollout records the
   suite in that rollout's Run record: suite-started (by task, or integration with --priority; runner agent; the
   tree's sha, dirty and diff read before the slot wait, the load and the Mac-wide running count after it) and,
   once the slot is released, suite-ended: green (rc 0), stopped (128+n, or a signal to `run`: no vault scan, no
   output read), unrun (127), else red with the failing names read from the last 16 MiB of its output. Only
   suite-started is written while the slot is held, before the command starts (its vault walk for the running
   count, a fraction of a second); a stop signal in that walk ends the run 76 (no verdict: the suite never started,
   contract 4) with no line written, and one after the started line is written but before the spawn ends it 76 too,
   with a suite-ended stopped that carries no rc (p32-1: the suite never ran). The Heat
   hold (contract 7) holds here too: a heat stop ends that run's suite heat (no verdict, no rc), written once its
   slot is released and with stops held for the write, and the restart once the Mac cools is a suite of its own,
   with a fresh suite-started; a stop while held for the heat or back in line exits 76 and writes nothing more, and
   so does a slot wait that runs out (no slot, no suite-started).
   Unless fd 1 or fd 2 is a TTY, the guard's stdout and stderr then go through pipes: a pump forwards each chunk to
   fd 1 or fd 2 within GUARD_POLL, keeps a copy in an unlinked temp file and reads the heat as Guarded.watch() does;
   once the guard exits it drains what is ready for at most a second and never waits for EOF, so a leftover that
   writes after `run` exits gets EPIPE, and output written while a stop ends the suite may be lost. Any other run (no
   task tree, no note, no `rollout:`) takes the path above unchanged. Recording failures are silent and never change
   the rc; a SIGKILL of `run` leaves a started line with no ended line.
9. The wait (p31-3). An agent's suite outlives its harness's foreground Bash cap (600000 ms), so it runs `run` in the
   background, and the harness blocks a long `sleep` and ends a background run when the agent's turn ends: an agent
   that ends its turn to await the run returns with no verdict and its run is killed. So `run` frames its output, and
   `wait` is the command that reports the verdict inside the agent's turn, never a pause. `run` prints first, on
   stderr, `verify-slot: run <pid> started; wait for its verdict with: python3 '<this script>' wait --log '<path>'
   --pid <pid>` (each word single-quoted, each ' written '\\''), and last, on every return, `verify-slot: exit <rc> (run
   <pid>)`: a usage error (2), a stop (128+n; one that escapes cmd_run's handlers too), a no verdict (76, its
   `verify-slot: no verdict` line before it) and an unexpected exception (its traceback, then 1) included, with stops
   ignored while it is written; both lines are best effort and never change the rc. The path is fd 2's when fd 2 is a regular file: F_GETPATH on macOS, /proc/self/fd/2 on Linux, each accepted
   only when it stats to fd 2's own (st_dev, st_ino); else (a pipe, a TTY, /dev/null, an unlinked file) the
   placeholder `<its output file>`, the file the harness names. `wait --log FILE [--pid P] [--for S]` reads FILE as it
   grows (complete lines; the exit line matched at a line's end, so a suite whose last output had no newline still
   gives it) for the run with --pid, else the first start line's (a nested run's lines name other pids and are
   ignored), and prints, once, `verify-slot: wait up to <S>s for the verdict of run <pid> in <FILE>; …`. S is 1 to 590,
   default 540, so one call fits the foreground cap. It exits with the run's rc once its exit line is there (and
   prints that line); 75 at S while the run goes on (`verify-slot: still running after <S>s (run <pid>; last: <its last
   verify-slot: line>): run this wait again`), or with no run named yet (`… no verify-slot: run line in <FILE> yet:
   check the path …`); 76 when the pid is gone (ESRCH; EPERM is alive) and a final read finds no exit line
   (`verify-slot: no verdict: run <pid> ended with no exit line (stopped or killed); exit 76`); 2 on a usage error (a
   missing or unreadable FILE, a bad --for or --pid, anything but ASCII digits included, an unknown flag); 128+n when a TERM, INT or HUP cuts it
   (`verify-slot: wait cut by a signal after <N>s (run <pid>): no verdict; run this wait again`). A wait cut by its own
   timeout or a signal is no verdict: run it again. It takes no slot, registers no waiter, never calls slots_dir(),
   writes no Run record line and never signals the run. The printed line is authoritative where a code is ambiguous (a
   suite whose own rc is 75 or 76, or 2). Residuals: a reused pid, and a run its parent has not reaped yet (a zombie),
   read as alive until S, so they give 75, never a wrong verdict; a TERM between the start line and cmd_run's handlers
   ends the run with no exit line, so 76.

`run --slots N [--priority] [--slot-wait S] -- CMD…`: prints its start line (contract 9), then waits for a slot
(`verify-slot: waiting for one of N verify slots (held by pid … in … since …[; K Integration waiter(s) ahead])` on
stderr, repeated every 5 minutes; no waiting line when one is free at once; `verify-slot: slot k of N after Ns` once a
wait ends), runs CMD under the guard and exits with its rc (128+n for a signal), its exit line (contract 9) last. While
the Mac is hot it waits with `verify-slot: waiting (heat: <name>)` (contract 7); a heat stop prints `verify-slot: heat
stop (<name>): ended the suite after Ns; no verdict, never red: back in line to restart from the beginning once the Mac
cools`, and the exit is the last run's rc. The slot wait is bounded (p32-1): `--slot-wait S` (or `--slot-wait=S`), an
integer >= 0 in seconds, written in ASCII digits only, default RUN_SLOT_WAIT, 4800: the lead's `slotWait` at the default `verify_timeout` of 1800 s,
max(60, 7200 - 600 - 1800), so an agent's wait fits its harness maximum as the lead's verify does; a constant, never
a rollout's own `verify_timeout`, and the engine renders no `--slot-wait`. S is one deadline for the whole run: every
slot wait, heat hold and heat-stopped run counts against it; the first pass always tries (0: one try, and a free slot
is still taken), a re-queue after a heat stop only while time is left. Once it runs out the command never ran (or
never restarted): `verify-slot: no verdict: no verify slot within <S>s[ (heat: <name>)]; exit 76`, no verdict, never
red. A TERM, INT or HUP before the suite starts exits 76 too, no verdict, never red: `verify-slot: no verdict: stopped
while the Mac was hot (heat: <name>); exit 76` while it waits on the heat or is back in line after a heat stop, else
`verify-slot: no verdict: stopped before the suite started; exit 76` (contract 4). Usage errors exit 2: `--slots`
missing, 0, or anything but ASCII digits; `--slot-wait` with no value or anything but ASCII digits (each refuses a
sign, `+1` included, an underscore such as `1_0`, whitespace and a non-ASCII digit); no `--`; no CMD; an unknown flag. A command that cannot be started exits 127.

`status [--slots N]` reaps stale waiter files and prints {dir, slots: [{index, state: free|held, holder}],
waiters: [{pid, cwd, since, kind}], heat: {level, name}}; without --slots it lists the slot files present. Stdlib
only, POSIX.
"""

import errno
import fcntl
import json
import os
import random
import re
import select
import shutil
import signal
import stat
import subprocess
import sys
import time
import traceback
from datetime import datetime

sys.dont_write_bytecode = True

KILL_GRACE = 10       # seconds between the group's TERM and its KILL
REAP_WAIT = 30        # seconds to reap the command (the guard) or see the group gone (the wrapper)
GUARD_POLL = 0.2      # the guard's poll of the death pipe and the command
REMIND_EVERY = 300    # seconds between waiting lines
DEFAULT_POLL = 1.0    # the poll base: priority every base + up to base/2; others every 2 * base + up to base
SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
WAITER_TRIES = 3
HELD_ENV = "VERIFY_SLOT_HELD"   # the marker (p34-1): "1" in the environment of a command run in a held slot
SCRIPT = os.path.abspath(__file__)

# The Heat hold (estate ADR 0009 d5, contract 7): the Mac's thermal pressure, read fresh on every call.
HEAT_KEY = "com.apple.system.thermalpressurelevel"
HEAT_NAMES = ("nominal", "moderate", "heavy", "trapping", "sleeping")
HEAT_HOLD = 2              # at this level or worse no slot is free
HEAT_STOP = 3              # at this level or worse a running slotted suite is stopped and put back in line
HEAT_EXIT = 76             # `run`'s no verdict, never red (75 is lead-integrate's noslot): a stop before the suite
                           # started (the Mac hot or not) or a slot wait that ran out (contract items 4 and 7)
HEAT_ENV = "THREAD_HEAT_LEVEL"   # an integer 0 to 4 pins the level (the tests' pin); any other value is ignored
HEAT_POLL_FACTOR = 5       # a running suite's heat is read every HEAT_POLL_FACTOR * the poll base
HEAT_SETTLE = 2 * GUARD_POLL     # at a stop reading, how long a guard that is already ending gets to exit by itself
HEAT_STOPPED = object()    # Guarded.watch's result when it stopped the suite for the heat
NOTIFYUTIL = "/usr/bin/notifyutil"   # the reading's tool when PATH has none
# `run`'s own bound on its slot wait (p32-1), `--slot-wait`'s default: the lead's `slotWait` at the default
# `verify_timeout` of 1800 s, max(60, 7200 - 600 - 1800), so an agent's wait, its suite and the margin fit the harness
# maximum as the lead's verify does. A constant: never read from a rollout's own `verify_timeout`, and the engine
# renders no `--slot-wait`, so its prompt bytes are unchanged. Heat holds and heat restarts count against it.
RUN_SLOT_WAIT = 4800


class SlotDirError(Exception):
    """The slots dir is unusable: str() is `<dir>: <err>`. Callers fail open (a WARN, the command still guarded)."""


class _Signalled(Exception):
    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


def _on_signal(signum, _frame):
    raise _Signalled(signum)


def _stamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _home():
    h = os.environ.get("HOME")
    if h:
        return h
    try:
        import pwd
        return pwd.getpwuid(os.getuid()).pw_dir
    except Exception:
        return os.path.expanduser("~")


def slots_dir():
    """The pool's directory: the override, then XDG_STATE_HOME (absolute only), then ~/.local/state."""
    over = os.environ.get("THREAD_VERIFY_SLOTS_DIR") or ""
    if over:
        if over == "~" or over.startswith("~/"):
            over = _home() + over[1:]
        if not os.path.isabs(over):
            raise SlotDirError(f"{over}: THREAD_VERIFY_SLOTS_DIR is relative; it must be absolute")
        return os.path.normpath(over)
    xdg = os.environ.get("XDG_STATE_HOME") or ""
    base = xdg if os.path.isabs(xdg) else os.path.join(_home(), ".local", "state")
    return os.path.normpath(os.path.join(base, "thread", "verify-slots"))


def _poll_base():
    try:
        v = float(os.environ.get("THREAD_VERIFY_SLOT_POLL") or "")
    except ValueError:
        return DEFAULT_POLL
    return v if v > 0 and v == v and v != float("inf") else DEFAULT_POLL


def heat_level():
    """The Mac's thermal pressure level, 0 to 4 (HEAT_NAMES), read fresh on every call, never cached. A
    THREAD_HEAT_LEVEL of 0 to 4 pins it; any other value is ignored. Otherwise `notifyutil -g HEAT_KEY`'s last token,
    clamped to 0..4. Fails open: no notifyutil, a non-zero exit, a timeout or output it cannot parse reads 0 (Linux,
    CI)."""
    pin = (os.environ.get(HEAT_ENV) or "").strip()
    if pin in ("0", "1", "2", "3", "4"):
        return int(pin)
    try:
        p = subprocess.run([shutil.which("notifyutil") or NOTIFYUTIL, "-g", HEAT_KEY], stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=2)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0
    if p.returncode != 0:
        return 0
    try:
        n = int((p.stdout or "").split()[-1])
    except (IndexError, ValueError):
        return 0
    return max(0, min(len(HEAT_NAMES) - 1, n))


def heat_name(n):
    """The level's name (HEAT_NAMES), or the number itself when it is out of range."""
    return HEAT_NAMES[n] if isinstance(n, int) and 0 <= n < len(HEAT_NAMES) else str(n)


def _slot_path(d, k):
    return os.path.join(d, f"slot-{k}.lock")


def _flock_nb(fd):
    """True when this fd now holds LOCK_EX; False when another description holds it."""
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError as e:
        if e.errno in (errno.EWOULDBLOCK, errno.EAGAIN, errno.EACCES):
            return False
        raise


def _read_json(path):
    """A record file's JSON object; None when empty or gone; "unreadable" otherwise."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return None
    except OSError:
        return "unreadable"
    if not raw.strip():
        return None
    try:
        rec = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return "unreadable"
    return rec if isinstance(rec, dict) else "unreadable"


# ---- waiter files: the Integration priority ------------------------------------------------------------------

def _reap_one(path):
    """Unlink a waiter file nobody holds; True when it was live (held by its waiter)."""
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return False
    try:
        if not _flock_nb(fd):
            return True
        try:
            if os.fstat(fd).st_ino == os.stat(path).st_ino:
                os.unlink(path)
        except OSError:
            pass
        return False
    except OSError:
        return False
    finally:
        os.close(fd)


def _scan_waiters(d):
    """Reap every stale waiter file (`waiter-*.wait`, `.waiter-*.tmp`); the live `.wait` records, oldest first."""
    live = []
    try:
        names = os.listdir(d)
    except OSError:
        return live
    for name in sorted(names):
        path = os.path.join(d, name)
        if name.startswith("waiter-") and name.endswith(".wait"):
            if _reap_one(path):
                rec = _read_json(path)
                live.append(rec if isinstance(rec, dict) else {"pid": None, "cwd": None, "since": None, "kind": None})
        elif name.startswith(".waiter-") and name.endswith(".tmp"):
            _reap_one(path)
    live.sort(key=lambda r: str(r.get("since") or ""))
    return live


def _register_waiter(d, kind):
    """(fd, path) of this process's live waiter file, or (None, None) after WAITER_TRIES lost races."""
    for _ in range(WAITER_TRIES):
        name = f"waiter-{os.getpid()}-{random.getrandbits(32):08x}"
        tmp = os.path.join(d, f".{name}.tmp")
        final = os.path.join(d, f"{name}.wait")
        try:
            fd = os.open(tmp, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o644)
        except FileExistsError:
            continue
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            rec = {"pid": os.getpid(), "cwd": os.getcwd(), "since": _stamp(), "kind": kind}
            os.write(fd, (json.dumps(rec) + "\n").encode())
            os.rename(tmp, final)
            return fd, final
        except FileNotFoundError:
            os.close(fd)  # a reaper took the .tmp before this flock: retry with a new name
            continue
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            os.close(fd)
            raise
    return None, None


def _drop_waiter(fd, path):
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass


# ---- slots ----------------------------------------------------------------------------------------------------

class Slot:
    """One held verify slot. `.index` is 0-based (slot-<index>.lock); `.waited` the seconds acquire() waited;
    `.queued` whether it missed at least once."""

    def __init__(self, index, fd, waited, path, queued=False):
        self.index = index
        self.fd = fd
        self.waited = waited
        self.path = path
        self.queued = queued  # True when acquire() missed at least once (a waiting line was due)

    def release(self):
        """Close this fd. Never LOCK_UN: a guard sharing the description keeps the slot until it exits."""
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None


def write_holder(slot, rec):
    """Write the holder record into the slot's lock file (through the held fd)."""
    if slot is None or slot.fd is None:
        return
    data = (json.dumps(rec) + "\n").encode()
    os.ftruncate(slot.fd, 0)
    os.pwrite(slot.fd, data, 0)


def _describe(rec):
    if not isinstance(rec, dict):
        return "an unreadable holder record"
    return f"pid {rec.get('pid')} in {rec.get('cwd')} since {rec.get('since')}"


def held_by(slots, where=None):
    """One line naming the holders of the held slots among the first `slots` ("" when none reads held)."""
    try:
        d = where or slots_dir()
    except SlotDirError:
        return ""
    out = []
    for k in range(slots):
        state, holder = _probe(d, k)
        if state == "held":
            out.append(_describe(holder))
    return "; ".join(out)


def _probe(d, k):
    """(state, holder) of slot k without creating it. A free slot is held for microseconds by the probe."""
    path = _slot_path(d, k)
    try:
        fd = os.open(path, os.O_RDONLY)
    except FileNotFoundError:
        return "free", None
    except OSError:
        return "free", None
    try:
        if _flock_nb(fd):
            return "free", None
        return "held", _read_json(path)
    finally:
        os.close(fd)


def _open_slot(d, k):
    try:
        return os.open(_slot_path(d, k), os.O_RDWR | os.O_CREAT, 0o644)
    except OSError as e:
        raise SlotDirError(f"{d}: {e.strerror or e}")


def acquire(slots, max_wait=None, where=None, poll=None, on_wait=None, priority=False, kind="run", why=None):
    """Wait for one of `slots` verify slots: a Slot, or None when max_wait seconds pass first (0: one try).

    on_wait(msg) gets `waiting for one of N verify slots (…)` at the first miss and every REMIND_EVERY seconds.
    A priority acquirer registers a waiter file while it waits; a non-priority one takes a slot only when it can
    hold (live waiters + 1) at once. SlotDirError when the dir is unusable (checked before any heat reading).
    The Heat hold (contract 7): each poll reads heat_level() first; at HEAT_HOLD or worse it tries no slot (a miss),
    and on_wait gets `waiting (heat: <name>)`, said at the first miss, whenever the holding reason changes (another
    heat name, or a switch between heat and slots) and every REMIND_EVERY seconds. `why`, a dict the caller keeps,
    gets "heat": the level each poll that heat held, else None. max_wait bounds the whole wait, heat included."""
    if not isinstance(slots, int) or isinstance(slots, bool) or slots < 1:
        raise ValueError(f"slots must be an integer >= 1, got {slots!r}")
    d = where or slots_dir()
    try:
        os.makedirs(d, exist_ok=True)
    except OSError as e:
        raise SlotDirError(f"{d}: {e.strerror or e}")
    if not os.path.isdir(d):
        raise SlotDirError(f"{d}: not a directory")
    base = poll if poll is not None and poll > 0 else _poll_base()
    start = time.monotonic()
    told = told_reason = None
    wfd = wpath = None
    try:
        if priority:
            try:
                wfd, wpath = _register_waiter(d, kind)
            except OSError as e:
                raise SlotDirError(f"{d}: {e.strerror or e}")
            if wfd is None:
                print(f"verify-slot: WARN {d}: could not register a waiter after {WAITER_TRIES} tries; "
                      "waiting unregistered", file=sys.stderr)
        missed = False
        while True:
            level = heat_level()
            hot = level >= HEAT_HOLD
            if why is not None:
                why["heat"] = level if hot else None
            ahead = 0
            got, held = [], []
            if not hot:
                live = _scan_waiters(d)
                ahead = 0 if priority else len(live)
                need = 1 if priority else ahead + 1
                try:
                    for k in range(slots):
                        fd = _open_slot(d, k)
                        try:
                            took = _flock_nb(fd)
                        except OSError as e:
                            os.close(fd)
                            raise SlotDirError(f"{d}: {e.strerror or e}")
                        if took:
                            got.append((k, fd))
                            if len(got) >= need:
                                break
                        else:
                            os.close(fd)
                            held.append(k)
                    if len(got) >= need:
                        k, fd = got.pop(0)
                        os.ftruncate(fd, 0)
                        return Slot(k, fd, time.monotonic() - start, _slot_path(d, k), missed)
                finally:
                    for _, fd in got:
                        os.close(fd)
            missed = True
            now = time.monotonic()
            if max_wait is not None and now - start >= max_wait:
                return None
            reason = f"heat: {heat_name(level)}" if hot else "slots"
            if on_wait is not None and (told is None or reason != told_reason or now - told >= REMIND_EVERY):
                if hot:
                    on_wait(f"waiting ({reason})")
                else:
                    names = "; ".join(_describe(_read_json(_slot_path(d, k))) for k in held)
                    held_why = [f"held by {names}"] if names else []
                    if ahead:
                        held_why.append(f"{ahead} Integration waiter(s) ahead")
                    on_wait(f"waiting for one of {slots} verify slots ({'; '.join(held_why) or 'none free'})")
                told, told_reason = now, reason
            step = base + random.uniform(0, base / 2) if priority else 2 * base + random.uniform(0, base)
            if max_wait is not None:
                step = min(step, max(0.0, max_wait - (now - start)))
            time.sleep(step)
    finally:
        _drop_waiter(wfd, wpath)


# ---- the guard --------------------------------------------------------------------------------------------------

def kill_group(pgid, grace=KILL_GRACE):
    """TERM the group, up to `grace` s for it to empty, KILL it, then poll until it is gone (ESRCH, or EPERM: a
    zombie-only group) for up to REAP_WAIT s. True when it is gone."""
    def gone():
        try:
            os.killpg(pgid, 0)
            return False
        except (ProcessLookupError, PermissionError):
            return True
    if not pgid or gone():
        return True
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return True
    end = time.monotonic() + grace
    while time.monotonic() < end:
        if gone():
            return True
        time.sleep(0.1)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        return True
    end = time.monotonic() + REAP_WAIT
    while time.monotonic() < end:
        if gone():
            return True
        time.sleep(0.1)
    return gone()


class Guarded:
    """CMD under a guard (`_guard`, its own session). `.pid` is the guard's pid; `.group` the command's pgid, or
    None when the guard died before reporting it. `hold` is a Slot whose fd the guard inherits (its own reference
    to the lock), and with it held the command sees HELD_ENV=1 (the marker, contract 3). Signals TERM/INT/HUP are held
    across the spawn (the child starts with the caller's mask), and on_spawn(self) runs inside that window, so a caller
    that records the handle there never loses it. wait() waits; watch() waits under the Heat hold's stop (contract
    7)."""

    def __init__(self, argv, hold=None, on_spawn=None, **popen_kw):
        self.group = None
        self.proc = None
        self._death = None
        self.heat = None   # the level a heat stop read (watch)
        death_r, death_w = os.pipe()
        rep_r, rep_w = os.pipe()
        fds = [death_r, rep_w]
        if hold is not None and hold.fd is not None:
            fds.append(hold.fd)
            # The marker (p34-1): the guard's environment, which the command inherits, gains HELD_ENV. A new dict, so a
            # caller's env is never mutated; every Guarded caller (cmd_run, _run_recorded, lead-integrate.py's
            # _run_guarded) gets it here, on each heat-stop restart too.
            base = os.environ if popen_kw.get("env") is None else popen_kw["env"]
            popen_kw["env"] = {**base, HELD_ENV: "1"}
        # Isolated (-I): the guard ignores PYTHONPATH, PYTHONHOME and the user site (it imports only the stdlib), and
        # its own environment, which the command inherits, is left as the caller's.
        cmd = [sys.executable or "python3", "-I", SCRIPT, "_guard", str(death_r), str(rep_w), "--", *argv]
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
        try:
            try:
                self.proc = subprocess.Popen(cmd, start_new_session=True, pass_fds=tuple(fds),
                                             preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, mask),
                                             **popen_kw)
            except BaseException:
                for fd in (death_r, death_w, rep_r, rep_w):
                    os.close(fd)
                raise
            self.pid = self.proc.pid
            self._death = death_w
            os.close(death_r)
            os.close(rep_w)
            if on_spawn is not None:
                on_spawn(self)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        try:
            buf = b""
            while True:
                chunk = os.read(rep_r, 64)
                if not chunk:
                    break
                buf += chunk
        finally:
            os.close(rep_r)
        try:
            self.group = int(buf.decode().strip()) or None
        except ValueError:
            self.group = None

    def done(self):
        return self.proc.poll() is not None

    def close(self):
        """Close the death fd (idempotent): the guard then ends the command's group."""
        if self._death is not None:
            try:
                os.close(self._death)
            except OSError:
                pass
            self._death = None

    def _after(self, rc):
        if rc < 0:  # the guard itself died by a signal: the command may still run, so end its group here
            if self.group:
                kill_group(self.group, KILL_GRACE)
            return 128 - rc
        return rc

    def wait(self, timeout=None):
        """The command's rc once the guard exits (128+n for a signal), or None when `timeout` passes first."""
        try:
            rc = self.proc.wait(timeout)
        except subprocess.TimeoutExpired:
            return None
        self.close()
        return self._after(rc)

    def watch(self, timeout=None, heat=True):
        """wait(timeout) under the Heat hold's stop (contract 7): the command's rc exactly as wait() gives it, None when
        `timeout` passes first (nothing stopped), or HEAT_STOPPED once it stopped the suite. Every HEAT_POLL_FACTOR *
        the poll base it reads heat_level(); at HEAT_STOP or worse it first gives the guard HEAT_SETTLE to exit by
        itself (a command that already ended: the guard reaps its child within one GUARD_POLL), and keeps that rc,
        never calling stop(); only a guard still there is stopped (stop(): TERM, KILL_GRACE, KILL, reaped), with the
        level kept in `.heat`. Heavy never stops a suite. heat=False is exactly wait(timeout)."""
        if not heat:
            return self.wait(timeout)
        end = None if timeout is None else time.monotonic() + max(0.0, timeout)
        while True:
            step = HEAT_POLL_FACTOR * _poll_base()
            if end is not None:
                step = min(step, max(0.0, end - time.monotonic()))
            try:
                rc = self.proc.wait(step)
            except subprocess.TimeoutExpired:
                if end is not None and time.monotonic() >= end:
                    return None
                level = heat_level()
                if level < HEAT_STOP:
                    continue
                try:
                    rc = self.proc.wait(HEAT_SETTLE)
                except subprocess.TimeoutExpired:
                    self.heat = level
                    self.stop()
                    return HEAT_STOPPED
            self.close()
            return self._after(rc)

    def stop(self):
        """Close the death fd, then wait for the guard (bounded); a guard still there is SIGKILLed and the
        group with it. Returns the guard's rc."""
        self.close()
        try:
            rc = self.proc.wait(KILL_GRACE + REAP_WAIT + 5)
        except subprocess.TimeoutExpired:
            try:
                self.proc.kill()
            except OSError:
                pass
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                pass
            if self.group:
                try:
                    os.killpg(self.group, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
            return 128 + signal.SIGKILL
        return self._after(rc)


def _guard(death_fd, report_fd, argv):
    """The guard process: run argv in its own session; end its group on EOF of death_fd or a TERM/INT/HUP."""
    for s in SIGNALS:
        signal.signal(s, _on_signal)
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        child = subprocess.Popen(argv, start_new_session=True, close_fds=True,
                                 preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, mask))
    except (OSError, subprocess.SubprocessError) as e:
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        print(f"verify-slot: cannot run {argv[0]}: {getattr(e, 'strerror', None) or e}", file=sys.stderr)
        os.close(report_fd)
        return 127
    rc = None
    try:
        # A signal held across the spawn is acted on here, once `child` is recorded.
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        try:
            os.write(report_fd, f"{child.pid}\n".encode())
        finally:
            os.close(report_fd)
        while True:
            if child.poll() is not None:
                return 128 - child.returncode if child.returncode < 0 else child.returncode
            ready, _, _ = select.select([death_fd], [], [], GUARD_POLL)
            if ready and not os.read(death_fd, 64):
                rc = 128 + signal.SIGTERM
                break
    except _Signalled as s:
        rc = 128 + s.signum
    except OSError:
        rc = 128 + signal.SIGTERM
    for s in SIGNALS:
        signal.signal(s, signal.SIG_IGN)
    _end(child)
    return rc


def _end(child):
    """killpg(TERM); up to KILL_GRACE for the command to exit; killpg(KILL); reap the command (REAP_WAIT)."""
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    end = time.monotonic() + KILL_GRACE
    while time.monotonic() < end and child.poll() is None:
        time.sleep(0.1)
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        child.wait(REAP_WAIT)
    except subprocess.TimeoutExpired:
        pass


# ---- CLI ---------------------------------------------------------------------------------------------------------

USAGE = ("usage: verify-slot.py run --slots N [--priority] [--slot-wait S] -- CMD… | wait --log FILE [--pid P] "
         "[--for S] | status [--slots N]")


class _Usage(Exception):
    pass


def _digits(v):
    """A flag's integer value, written in ASCII digits only, else None (p32-1). int() alone also takes a sign (`+5`),
    an underscore (`1_000`), surrounding whitespace and non-ASCII digits, none of which the usage contract allows."""
    if not isinstance(v, str) or not v.isascii() or not v.isdigit():
        return None
    return int(v, 10)


def _positive_int(v):
    n = _digits(v)
    if n is None or n < 1:
        raise _Usage(f"--slots must be an integer >= 1, got {v!r}")
    return n


def _slot_wait_arg(v):
    """`run --slot-wait S` (p32-1): an integer >= 0 in seconds (0: one try), in ASCII digits only; else usage."""
    n = _digits(v)
    if n is None:
        raise _Usage(f"run: --slot-wait must be an integer >= 0 (seconds), got {v!r}")
    return n


def _parse_run(argv):
    slots, prio, wait, i = None, False, RUN_SLOT_WAIT, 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            cmd = argv[i + 1:]
            if not cmd:
                raise _Usage("run: no command after --")
            if slots is None:
                raise _Usage("run: --slots N is required")
            return slots, prio, cmd, wait
        if a == "--slots":
            if i + 1 >= len(argv):
                raise _Usage("run: --slots needs a value")
            slots = _positive_int(argv[i + 1])
            i += 2
            continue
        if a.startswith("--slots="):
            slots = _positive_int(a[len("--slots="):])
            i += 1
            continue
        if a == "--priority":
            prio = True
            i += 1
            continue
        if a == "--slot-wait":
            if i + 1 >= len(argv):
                raise _Usage("run: --slot-wait needs a value")
            wait = _slot_wait_arg(argv[i + 1])
            i += 2
            continue
        if a.startswith("--slot-wait="):
            wait = _slot_wait_arg(a[len("--slot-wait="):])
            i += 1
            continue
        raise _Usage(f"run: unknown argument {a!r}")
    raise _Usage("run: no -- before the command")


RECONCILE_PY = os.path.join(os.path.dirname(SCRIPT), "reconcile-rollout.py")
WORKTREES = (".claude", "worktrees")
CAPTURE_TAIL = 16 * 1024 * 1024   # the bytes of an agent suite's output its failing names are read from
DRAIN_FOR = 1.0                   # seconds the pump drains what is ready once the guard exits; never waits for EOF


def _load_reconcile():
    """reconcile-rollout.py, loaded only for a suite in a task tree (step-boundary.py's _load_reconcile pattern)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("reconcile_rollout", RECONCILE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _suite_owner():
    """The task an agent's suite is for (contract item 8), or None: the last `/.claude/worktrees/<slug>` of the real cwd
    names the task, and its note in reconcile-rollout.py's DEFAULT_TASKS_DIR names the rollout (`rollout:`). Silent:
    any failure is no owner."""
    try:
        parts = os.path.realpath(os.getcwd()).split(os.sep)
        at = [i for i in range(len(parts) - 2) if tuple(parts[i:i + 2]) == WORKTREES and parts[i + 2]]
        if not at:
            return None
        i = at[-1]
        slug, tree = parts[i + 2], os.sep.join(parts[:i + 3])
        rr = _load_reconcile()
        note = rr.DEFAULT_TASKS_DIR / f"{slug}.md"
        if not note.is_file():
            return None
        rollout = rr._note_rollout(rr.Note(note))
        if not rollout:
            return None
        return {"rr": rr, "rollout": rollout, "task": slug, "tree": tree, "tasks_dir": rr.DEFAULT_TASKS_DIR}
    except Exception:
        return None


def _say(msg):
    print(f"verify-slot: {msg}", file=sys.stderr, flush=True)


def _acquire_within(slots, prio, why, wait, t_end, first):
    """acquire() under `run`'s one slot-wait deadline (p32-1; lead-integrate.py verify's rule): the first pass always
    tries, with max_wait=wait (0: one try); a re-queue after a heat stop tries only while time is left before t_end, and
    with no time left makes no try at all (no waiting line). A Slot, or None when none came in time; a SlotDirError
    passes through."""
    left = wait if first else t_end - time.monotonic()
    if not first and left <= 0:
        return None
    return acquire(slots, max_wait=max(0.0, left), priority=prio, kind="run", why=why, on_wait=_say)


def _no_slot(wait, why, stopped):
    """A slot wait that ran out (p32-1): its no-verdict line, naming the heat that held its last poll, else its last heat
    stop's; HEAT_EXIT, no verdict and never red."""
    name = heat_name(why["heat"]) if why["heat"] is not None else stopped
    heat = f" (heat: {name})" if name else ""
    _say(f"no verdict: no verify slot within {wait}s{heat}; exit {HEAT_EXIT}")
    return HEAT_EXIT


def cmd_run(argv):
    slots, prio, cmd, wait = _parse_run(argv)
    owner = _suite_owner()
    if owner is not None:
        return _run_recorded(slots, prio, cmd, owner, wait)
    for s in SIGNALS:
        signal.signal(s, _on_signal)
    box = {"g": None}
    why = {"heat": None}   # acquire's: the level that held the last poll, or None
    stopped = None         # the heat name of the last heat stop
    slot = None
    rc = None
    try:
        # The Heat hold (contract 7): a heat stop releases the slot and goes back in line, at the back, to restart the
        # command from the beginning once the Mac cools. Only the last run's rc is the exit. One slot-wait deadline
        # bounds every pass's wait (p32-1): once it runs out, no verdict (76).
        t_end, first = time.monotonic() + wait, True
        while True:
            try:
                slot = _acquire_within(slots, prio, why, wait, t_end, first)
            except SlotDirError as e:
                _say(f"WARN {e}; running unslotted")
                slot = None
            else:
                if slot is None:
                    rc = _no_slot(wait, why, stopped)
                    break
            first = False
            if slot is not None and slot.queued:
                _say(f"slot {slot.index + 1} of {slots} after {slot.waited:.0f}s")
            t0 = time.monotonic()
            g = Guarded(cmd, hold=slot, on_spawn=lambda x: box.__setitem__("g", x))
            if slot is not None:
                write_holder(slot, {"pid": os.getpid(), "guard": g.pid, "group": g.group, "cwd": os.getcwd(),
                                    "since": _stamp(), "kind": "run"})
            # Unslotted (a SlotDirError) there is no heat watch, so that run is the last.
            rc = g.watch(heat=slot is not None)
            if rc is not HEAT_STOPPED:
                break
            slot.release()
            slot = None
            box["g"] = None
            stopped = heat_name(g.heat)
            _say(f"heat stop ({stopped}): ended the suite after {time.monotonic() - t0:.0f}s; no verdict, never red: "
                 "back in line to restart from the beginning once the Mac cools")
    except _Signalled as s:
        for sig in SIGNALS:
            signal.signal(sig, signal.SIG_IGN)
        if box["g"] is not None:
            box["g"].stop()
            rc = 128 + s.signum
        elif why["heat"] is not None or stopped is not None:
            # Stopped while held for the heat, or back in line after a heat stop: no verdict, never red.
            name = heat_name(why["heat"]) if why["heat"] is not None else stopped
            _say(f"no verdict: stopped while the Mac was hot (heat: {name}); exit {HEAT_EXIT}")
            rc = HEAT_EXIT
        else:
            # Stopped before the guard spawned the suite (in the slot wait, or between the slot and the spawn): nothing
            # ran, so no verdict, never red (p32-1, contract 4). A stop once the suite is spawned stays 128+n.
            _say(f"no verdict: stopped before the suite started; exit {HEAT_EXIT}")
            rc = HEAT_EXIT
    except BaseException:
        # Close the death fd (the guard starts ending the suite) and re-raise without waiting: the guard's own
        # reference keeps the slot held until the suite is gone (contract 1).
        if box["g"] is not None:
            box["g"].close()
        raise
    finally:
        if slot is not None:
            slot.release()
    return rc


def _put(fd, data):
    """Write all of `data` to fd; a closed reader (EPIPE) or any other error drops the rest."""
    try:
        while data:
            data = data[os.write(fd, data):]
    except OSError:
        pass


def _pump(g, capture, heat=False):
    """Forward the guard's stdout and stderr, as they come, to fd 1 and fd 2, appending both to `capture`; once the guard
    exits, drain what is ready for at most DRAIN_FOR seconds, never waiting for EOF (a leftover background process may
    hold the pipes), close the pipes and return the command's rc as Guarded.wait does. With `heat`, the Heat hold's stop
    as Guarded.watch() (contract 7): while the guard runs it reads heat_level() every HEAT_POLL_FACTOR * the poll base;
    at HEAT_STOP or worse it gives the guard HEAT_SETTLE to exit by itself (that rc is kept), else stops it, keeps the
    level in `g.heat` and returns HEAT_STOPPED."""
    srcs = {g.proc.stdout.fileno(): 1, g.proc.stderr.fileno(): 2}
    until = None
    due = time.monotonic() + HEAT_POLL_FACTOR * _poll_base() if heat else None
    stopped = False
    while srcs:
        if until is None and g.proc.poll() is not None:
            until = time.monotonic() + DRAIN_FOR
        if until is None and due is not None and time.monotonic() >= due:
            due = time.monotonic() + HEAT_POLL_FACTOR * _poll_base()
            level = heat_level()
            if level >= HEAT_STOP:
                try:
                    g.proc.wait(HEAT_SETTLE)
                except subprocess.TimeoutExpired:
                    g.heat = level
                    g.stop()
                    stopped = True
                    break
                continue   # the guard ended by itself: drain, and its rc is the verdict
        ready, _, _ = select.select(list(srcs), [], [], 0 if until is not None else GUARD_POLL)
        for fd in ready:
            try:
                chunk = os.read(fd, 1 << 16)
            except OSError:
                chunk = b""
            if not chunk:
                del srcs[fd]
                continue
            _put(srcs[fd], chunk)
            try:
                capture.write(chunk)
            except OSError:
                pass
        if until is not None and (not ready or time.monotonic() >= until):
            break
    rc = None if stopped else g.proc.wait()
    for f in (g.proc.stdout, g.proc.stderr):
        try:
            f.close()
        except OSError:
            pass
    if stopped:
        return HEAT_STOPPED
    g.close()
    return g._after(rc)


def _failing_from(rr, capture):
    """The failing-test names in the last CAPTURE_TAIL bytes of an agent suite's captured output (reconcile-rollout.py
    _failing_ids, from the first line), or None when nothing could be read."""
    try:
        capture.flush()
        size = capture.seek(0, os.SEEK_END)
        capture.seek(max(0, size - CAPTURE_TAIL))
        return rr._failing_ids(capture.read().decode("utf-8", "replace").splitlines(), marker=None)
    except (OSError, ValueError):
        return None


def _heat_run_ended(rr, owner, slot, suite, by, t0, written):
    """A heat-stopped run in a task tree (contract items 7 and 8): its slot released (a close), then, when its started
    line landed, its suite ended heat, no verdict and no rc, so the record never holds a slot. The caller holds stops
    across it."""
    slot.release()
    if written.get("started"):
        rr.suite_ended(owner["rollout"], owner["task"], suite, by, "agent", "heat", time.monotonic() - t0,
                       tasks_dir=owner["tasks_dir"])


def _run_recorded(slots, prio, cmd, owner, wait=RUN_SLOT_WAIT):
    """`run` for a suite in a task tree (contract item 8): the slotted run as cmd_run's, the Heat hold included, plus its
    suite-started and suite-ended lines in the rollout's Run record, and, unless fd 1 or fd 2 is a TTY, its output
    captured through a pump for the failing names. The tree's state is read before the slot wait; the load and the
    running count after it, so suite-started (that vault walk included) is written with the slot held, before the
    command starts. suite-ended is written once the slot is released, so its walk and the failing names never hold one;
    a stop by signal skips the vault scan and the capture. A heat stop ends its run's suite heat, with stops held for the
    write, and the restart once the Mac cools is a suite of its own. Recording never changes the rc, nor swallows a
    stop: one in that walk, or after the started line and before the spawn, is no verdict (76, as cmd_run's), and the
    latter's suite ends stopped with no rc (the suite never ran). A slot wait that runs out (p32-1) writes no line."""
    rr = owner["rr"]
    for s in SIGNALS:
        signal.signal(s, _on_signal)
    box = {"g": None}
    why = {"heat": None}   # acquire's: the level that held the last poll, or None
    stopped = None         # the heat name of the last heat stop
    slot = capture = None
    rc = signalled = None
    unspawned = False      # a stop before the guard spawned the suite: its suite-ended carries no rc
    written, t0 = {}, None
    suite, by = rr.new_suite_id(), ("integration" if prio else "task")
    piped = not (os.isatty(1) or os.isatty(2))
    try:
        state = rr.tree_state(owner["tree"])   # the agent's tree is still while it waits for a slot
        # The Heat hold (contract 7), as cmd_run's: a heat stop releases the slot and goes back in line, at the back, to
        # restart the command from the beginning once the Mac cools. Only the last run's rc is the exit. One slot-wait
        # deadline bounds every pass's wait (p32-1), as cmd_run's: once it runs out, no verdict (76) and no line.
        t_end, first = time.monotonic() + wait, True
        while True:
            try:
                slot = _acquire_within(slots, prio, why, wait, t_end, first)
            except SlotDirError as e:
                _say(f"WARN {e}; running unslotted")
                slot = None
            else:
                if slot is None:
                    rc = _no_slot(wait, why, stopped)
                    break
            first = False
            if slot is not None and slot.queued:
                _say(f"slot {slot.index + 1} of {slots} after {slot.waited:.0f}s")
            t0 = time.monotonic()   # before the write: a stop delivered as it ends still gets its end line
            rr.suite_started(owner["rollout"], owner["task"], suite, by, "agent", state, tasks_dir=owner["tasks_dir"],
                             waited=slot.waited if slot is not None else None, reraise=(_Signalled,), written=written)
            if piped:
                import tempfile
                capture = tempfile.TemporaryFile()
            g = Guarded(cmd, hold=slot, on_spawn=lambda x: box.__setitem__("g", x),
                        **({"stdout": subprocess.PIPE, "stderr": subprocess.PIPE} if piped else {}))
            if slot is not None:
                write_holder(slot, {"pid": os.getpid(), "guard": g.pid, "group": g.group, "cwd": os.getcwd(),
                                    "since": _stamp(), "kind": "run"})
            # Unslotted (a SlotDirError) there is no heat watch, so that run is the last.
            rc = _pump(g, capture, heat=slot is not None) if piped else g.watch(heat=slot is not None)
            if rc is not HEAT_STOPPED:
                break
            stopped = heat_name(g.heat)
            # With stops held, so a stop meanwhile ends no suite twice: the slot released, then the heat-stopped run's
            # suite ended heat (_heat_run_ended); the restart is a fresh suite.
            with rr._signals_held():
                _say(f"heat stop ({stopped}): ended the suite after {time.monotonic() - t0:.0f}s; no verdict, never "
                     "red: back in line to restart from the beginning once the Mac cools")
                _heat_run_ended(rr, owner, slot, suite, by, t0, written)
                slot = None
                box["g"] = None
                if capture is not None:
                    capture.close()
                    capture = None
                suite, written, t0 = rr.new_suite_id(), {}, None
    except _Signalled as s:
        for sig in SIGNALS:
            signal.signal(sig, signal.SIG_IGN)
        signalled = True
        unspawned = box["g"] is None
        if box["g"] is not None:
            box["g"].stop()
            rc = 128 + s.signum
        elif why["heat"] is not None or stopped is not None:
            # Stopped while held for the heat, or back in line after a heat stop: no verdict, never red.
            name = heat_name(why["heat"]) if why["heat"] is not None else stopped
            _say(f"no verdict: stopped while the Mac was hot (heat: {name}); exit {HEAT_EXIT}")
            rc = HEAT_EXIT
        else:
            # Stopped before the guard spawned the suite (cmd_run's, p32-1): no verdict, never red.
            _say(f"no verdict: stopped before the suite started; exit {HEAT_EXIT}")
            rc = HEAT_EXIT
    except BaseException:
        if box["g"] is not None:
            box["g"].close()
        if capture is not None:
            capture.close()
        raise
    finally:
        if slot is not None:
            slot.release()
    try:
        if written.get("started") and t0 is not None:
            seconds = time.monotonic() - t0
            common = (owner["rollout"], owner["task"], suite, by, "agent")
            if signalled or rc > 128:
                # A stop before the spawn (after the started line) ran no suite, so its line carries no rc (p32-1).
                rr.suite_ended(*common, "stopped", seconds, tasks_dir=owner["tasks_dir"], scan=False,
                               rc=None if unspawned else rc)
            else:
                outcome = "green" if rc == 0 else "unrun" if rc == 127 else "red"
                failing = _failing_from(rr, capture) if outcome == "red" and capture is not None else None
                rr.suite_ended(*common, outcome, seconds, tasks_dir=owner["tasks_dir"], rc=rc, failing=failing)
    except _Signalled:
        pass   # a stop after the suite ended: the recording is abandoned and the exit stays the suite's rc
    except Exception:
        pass
    finally:
        for sig in SIGNALS:   # the suite and its record are done: a late stop changes nothing now
            signal.signal(sig, signal.SIG_IGN)
        if capture is not None:
            capture.close()
    return rc


def cmd_status(argv):
    slots = None
    i = 0
    while i < len(argv):
        if argv[i] == "--slots" and i + 1 < len(argv):
            slots = _positive_int(argv[i + 1])
            i += 2
        elif argv[i].startswith("--slots="):
            slots = _positive_int(argv[i][len("--slots="):])
            i += 1
        else:
            raise _Usage(f"status: unknown argument {argv[i]!r}")
    try:
        d = slots_dir()
    except SlotDirError as e:
        print(f"verify-slot: {e}", file=sys.stderr)
        return 2
    if os.path.exists(d) and not os.path.isdir(d):
        print(f"verify-slot: {d}: not a directory", file=sys.stderr)
        return 2
    waiters = _scan_waiters(d)
    if slots is None:
        idx = []
        try:
            for name in os.listdir(d):
                if name.startswith("slot-") and name.endswith(".lock") and name[5:-5].isdigit():
                    idx.append(int(name[5:-5]))
        except OSError:
            pass
        indexes = sorted(idx)
    else:
        indexes = list(range(slots))
    out = []
    for k in indexes:
        state, holder = _probe(d, k)
        out.append({"index": k, "state": state, "holder": holder if state == "held" else None})
    ws = [{k: w.get(k) for k in ("pid", "cwd", "since", "kind")} for w in waiters]
    level = heat_level()
    print(json.dumps({"dir": d, "slots": out, "waiters": ws, "heat": {"level": level, "name": heat_name(level)}}))
    return 0


# ---- the wait (p31-3, contract item 9) ---------------------------------------------------------------------------

WAIT_FOR = 540          # seconds one `wait` call watches by default: a call fits the 600000 ms foreground cap
WAIT_MAX = 590          # the largest --for
WAIT_RUNNING = 75       # `wait`: the run still goes at the bound (or no run is named yet); run the wait again
WAIT_GONE = HEAT_EXIT   # `wait`: the run ended with no exit line (stopped or killed): no verdict (76)
WAIT_TAIL = 1 << 16     # the bytes of an unfinished last line `wait` keeps, so memory stays flat
NO_PATH = "<its output file>"   # the start line's --log when fd 2's path cannot be proved
START_RE = re.compile(r"verify-slot: run (\d+) started; wait for its verdict with:")
EXIT_RE = re.compile(r"verify-slot: exit (\d{1,3}) \(run (\d+)\)\s*$")


def _shq(s):
    """One POSIX shell word, always single-quoted, each ' written '\\'' (the engine's shq)."""
    return "'" + str(s).replace("'", "'\\''") + "'"


def _frame(msg):
    """A `verify-slot:` line on stderr, best effort: a write that fails is dropped and never changes the rc."""
    try:
        print(f"verify-slot: {msg}", file=sys.stderr, flush=True)
    except (OSError, ValueError, AttributeError):
        pass


def _quiet():
    """SIG_IGN for every stop signal; a stop that lands while the handlers change is dropped (the call is ending)."""
    for _ in range(len(SIGNALS) + 1):
        try:
            for s in SIGNALS:
                signal.signal(s, signal.SIG_IGN)
            return
        except _Signalled:
            continue


def _stderr_path():
    """fd 2's real path when fd 2 is a regular file that path still names (contract item 9), else None. The candidates
    are F_GETPATH (macOS) and /proc/self/fd/2 (Linux); the first that is absolute and stats to fd 2's own (st_dev,
    st_ino) is the path. A pipe, a TTY, /dev/null, an unlinked file (Linux's "(deleted)") or any error is None."""
    try:
        st = os.fstat(2)
        if not stat.S_ISREG(st.st_mode):
            return None
        cands = []
        if hasattr(fcntl, "F_GETPATH"):
            try:
                cands.append(os.fsdecode(fcntl.fcntl(2, fcntl.F_GETPATH, bytes(1024)).split(b"\0", 1)[0]))
            except OSError:
                pass
        try:
            cands.append(os.readlink("/proc/self/fd/2"))
        except OSError:
            pass
        for p in cands:
            try:
                if p and os.path.isabs(p):
                    s = os.stat(p)
                    if (s.st_dev, s.st_ino) == (st.st_dev, st.st_ino):
                        return p
            except (OSError, ValueError):
                continue
    except Exception:
        return None
    return None


def _run_framed(argv):
    """`run` framed (contract item 9): first a start line naming this run's pid and the exact `wait` command for its
    verdict, then cmd_run, then an exit line on every return: a usage error (2), a stop that escapes cmd_run (128+n), a
    SIGINT before cmd_run's handlers (130) or an unexpected exception (its traceback, then 1). A stop while a usage
    message or a traceback is printed reads as that stop."""
    pid = os.getpid()
    _frame(f"run {pid} started; wait for its verdict with: python3 {_shq(SCRIPT)} wait --log "
           f"{_shq(_stderr_path() or NO_PATH)} --pid {pid}")
    rc = None
    try:
        try:
            rc = cmd_run(argv)
        except _Usage as e:
            _frame(f"{e}\n{USAGE}")
            rc = 2
        except _Signalled:
            raise
        except KeyboardInterrupt:
            rc = 130
        except Exception:
            try:
                traceback.print_exc()
            except (OSError, ValueError, AttributeError):
                pass
            rc = 1
    except _Signalled as s:
        if rc is None:
            rc = 128 + s.signum
    finally:
        _quiet()
        if rc is not None:
            _frame(f"exit {rc} (run {pid})")
    return rc


def _int_in(v, lo, hi, name):
    n = _digits(v)
    if n is None or n < lo or (hi is not None and n > hi):
        span = f"from {lo} to {hi}" if hi is not None else f">= {lo}"
        raise _Usage(f"wait: {name} must be an integer {span}, got {v!r}")
    return n


def _parse_wait(argv):
    log, pid, bound, i = None, None, WAIT_FOR, 0
    while i < len(argv):
        a = argv[i]
        name, eq, v = a.partition("=")
        if name not in ("--log", "--pid", "--for"):
            raise _Usage(f"wait: unknown argument {a!r}")
        if eq:
            i += 1
        elif i + 1 < len(argv):
            v = argv[i + 1]
            i += 2
        else:
            raise _Usage(f"wait: {name} needs a value")
        if name == "--log":
            log = v
        elif name == "--pid":
            pid = _int_in(v, 1, None, "--pid")
        else:
            bound = _int_in(v, 1, WAIT_MAX, "--for")
    if not log:
        raise _Usage("wait: --log FILE is required")
    return log, pid, bound


def _alive(pid):
    """True while pid exists (EPERM counts as alive; so does an unreaped zombie, a residual: contract item 9)."""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except (OverflowError, ValueError):
        return False
    except OSError:
        return True


def cmd_wait(argv):
    """`wait --log FILE [--pid P] [--for S]` (contract item 9): an agent's in-turn wait for a run's verdict. It reads
    FILE as it grows, takes no slot, registers no waiter, writes no Run record line and never signals the run."""
    log, want, bound = _parse_wait(argv)
    try:
        f = open(log, "rb")
    except OSError as e:
        raise _Usage(f"wait: cannot read {log}: {e.strerror or e}")
    st = {"pid": want, "last": None, "tail": b""}

    def see(line):
        # The watched run: --pid, else the first start line's (a nested run's lines come after it and name other pids).
        if st["pid"] is None:
            m = START_RE.search(line)
            if m and int(m.group(1)) >= 1:
                st["pid"] = int(m.group(1))
        at = line.find("verify-slot: ")
        if at >= 0:
            st["last"] = line[at:].strip()[:200]
        m = EXIT_RE.search(line)
        if m and st["pid"] is not None and int(m.group(2)) == st["pid"] and int(m.group(1)) <= 255:
            return int(m.group(1))
        return None

    def scan(final=False):
        # Complete lines only, read as the file grows; on the final read the unfinished last line too.
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            parts = (st["tail"] + chunk).split(b"\n")
            st["tail"] = parts.pop()[-WAIT_TAIL:]
            for raw in parts:
                rc = see(raw.decode("utf-8", "replace"))
                if rc is not None:
                    return rc
        if final and st["tail"]:
            line, st["tail"] = st["tail"], b""
            return see(line.decode("utf-8", "replace"))
        return None

    def run():
        return f"run {st['pid']}" if st["pid"] is not None else "run (not started yet)"

    t0 = time.monotonic()
    try:
        for s in SIGNALS:
            signal.signal(s, _on_signal)
        with f:
            rc = scan()
            _frame(f"wait up to {bound}s for the verdict of {run()} in {log}; give this call a timeout over {bound}s, "
                   "and a call cut before a verdict line is no verdict: run it again")
            base = _poll_base()
            while True:
                if rc is not None:
                    _frame(f"exit {rc} (run {st['pid']})")
                    return rc
                if st["pid"] is not None and not _alive(st["pid"]):
                    rc = scan(final=True)
                    if rc is not None:
                        continue
                    _frame(f"no verdict: run {st['pid']} ended with no exit line (stopped or killed); exit {WAIT_GONE}")
                    return WAIT_GONE
                left = bound - (time.monotonic() - t0)
                if left <= 0:
                    if st["pid"] is None:
                        _frame(f"after {bound}s, no verify-slot: run line in {log} yet: check the path, then run this "
                               "wait again")
                    else:
                        _frame(f"still running after {bound}s ({run()}; last: {st['last'] or '(none)'}): run this wait "
                               "again")
                    return WAIT_RUNNING
                time.sleep(min(base, left))
                rc = scan()
    except _Signalled as s:
        _quiet()
        _frame(f"wait cut by a signal after {time.monotonic() - t0:.0f}s ({run()}): no verdict; run this wait again")
        return 128 + s.signum


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)
    if not argv:
        print(USAGE, file=sys.stderr)
        return 2
    verb, rest = argv[0], argv[1:]
    try:
        if verb == "run":
            return _run_framed(rest)
        if verb == "wait":
            return cmd_wait(rest)
        if verb == "status":
            return cmd_status(rest)
        if verb == "_guard":
            if len(rest) < 4 or rest[2] != "--":
                raise _Usage("_guard DEATH_FD REPORT_FD -- CMD…")
            return _guard(int(rest[0]), int(rest[1]), rest[3:])
        raise _Usage(f"unknown verb {verb!r}")
    except _Usage as e:
        print(f"verify-slot: {e}\n{USAGE}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
