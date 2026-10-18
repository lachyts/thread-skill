#!/usr/bin/env python3
"""verify-slot.py — the machine-wide verify slots, and the guard that ends a killed holder's suite (p23-4).

A rollout at ceiling 4 runs up to four task calls, each with its own verifier, beside the lead's Integration
verify and RACE re-verify; other rollouts on the machine run theirs too. Each verifier is a full suite, so
unbounded they pile onto one machine (2026-10-17: load 66 on 12 cores, and a merge lost to a load flake). A
**verify slot** bounds that: at most `verify_slots` (rollouts.toml, `[defaults]` only, built-in 2) slotted
suites run at once across every rollout on this machine; a further one waits for a slot. This header is the one
copy of the contract.

    python3 verify-slot.py run --slots N [--priority] -- CMD…     # the agents' wrapper (engine-rendered)
    python3 verify-slot.py status [--slots N]                      # the operator's view (JSON)

Importable (lead-integrate.py's `verify --slots N --slot-wait S` loads it by importlib): slots_dir(),
SlotDirError, acquire(), Slot, Guarded, kill_group(), write_holder(), held_by(), KILL_GRACE, REAP_WAIT,
GUARD_POLL.

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
   so a kill of the caller's process group or session never reaches it. The guard starts the command in a
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
   REAP_WAIT) before it releases, and exits 128+9.
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

`run --slots N [--priority] -- CMD…`: waits for a slot (`verify-slot: waiting for one of N verify slots (held
by pid … in … since …[; K Integration waiter(s) ahead])` on stderr, repeated every 5 minutes; nothing when one
is free at once; `verify-slot: slot k of N after Ns` once a wait ends), runs CMD under the guard and exits with
its rc (128+n for a signal). Usage errors exit 2: `--slots` missing, 0, negative, a non-integer; no `--`; no
CMD; an unknown flag. A command that cannot be started exits 127.

`status [--slots N]` reaps stale waiter files and prints {dir, slots: [{index, state: free|held, holder}],
waiters: [{pid, cwd, since, kind}]}; without --slots it lists the slot files present. Stdlib only, POSIX.
"""

import errno
import fcntl
import json
import os
import random
import select
import signal
import subprocess
import sys
import time
from datetime import datetime

sys.dont_write_bytecode = True

KILL_GRACE = 10       # seconds between the group's TERM and its KILL
REAP_WAIT = 30        # seconds to reap the command (the guard) or see the group gone (the wrapper)
GUARD_POLL = 0.2      # the guard's poll of the death pipe and the command
REMIND_EVERY = 300    # seconds between waiting lines
DEFAULT_POLL = 1.0    # the poll base: priority every base + up to base/2; others every 2 * base + up to base
SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
WAITER_TRIES = 3
SCRIPT = os.path.abspath(__file__)


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


def acquire(slots, max_wait=None, where=None, poll=None, on_wait=None, priority=False, kind="run"):
    """Wait for one of `slots` verify slots: a Slot, or None when max_wait seconds pass first (0: one try).

    on_wait(msg) gets `waiting for one of N verify slots (…)` at the first miss and every REMIND_EVERY seconds.
    A priority acquirer registers a waiter file while it waits; a non-priority one takes a slot only when it can
    hold (live waiters + 1) at once. SlotDirError when the dir is unusable."""
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
    told = None
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
            live = _scan_waiters(d)
            ahead = 0 if priority else len(live)
            need = 1 if priority else ahead + 1
            got, held = [], []
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
            if on_wait is not None and (told is None or now - told >= REMIND_EVERY):
                names = "; ".join(_describe(_read_json(_slot_path(d, k))) for k in held)
                why = [f"held by {names}"] if names else []
                if ahead:
                    why.append(f"{ahead} Integration waiter(s) ahead")
                on_wait(f"waiting for one of {slots} verify slots ({'; '.join(why) or 'none free'})")
                told = now
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
    to the lock). Signals TERM/INT/HUP are held across the spawn (the child starts with the caller's mask), and
    on_spawn(self) runs inside that window, so a caller that records the handle there never loses it."""

    def __init__(self, argv, hold=None, on_spawn=None, **popen_kw):
        self.group = None
        self.proc = None
        self._death = None
        death_r, death_w = os.pipe()
        rep_r, rep_w = os.pipe()
        fds = [death_r, rep_w]
        if hold is not None and hold.fd is not None:
            fds.append(hold.fd)
        cmd = [sys.executable or "python3", SCRIPT, "_guard", str(death_r), str(rep_w), "--", *argv]
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

USAGE = "usage: verify-slot.py run --slots N [--priority] -- CMD… | status [--slots N]"


class _Usage(Exception):
    pass


def _positive_int(v):
    try:
        n = int(v, 10)
    except (TypeError, ValueError):
        raise _Usage(f"--slots must be an integer >= 1, got {v!r}")
    if n < 1 or str(v).strip() != v:
        raise _Usage(f"--slots must be an integer >= 1, got {v!r}")
    return n


def _parse_run(argv):
    slots, prio, i = None, False, 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            cmd = argv[i + 1:]
            if not cmd:
                raise _Usage("run: no command after --")
            if slots is None:
                raise _Usage("run: --slots N is required")
            return slots, prio, cmd
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
        raise _Usage(f"run: unknown argument {a!r}")
    raise _Usage("run: no -- before the command")


def cmd_run(argv):
    slots, prio, cmd = _parse_run(argv)
    for s in SIGNALS:
        signal.signal(s, _on_signal)
    box = {"g": None}
    slot = None
    rc = None
    try:
        try:
            slot = acquire(slots, priority=prio, kind="run",
                           on_wait=lambda m: print(f"verify-slot: {m}", file=sys.stderr, flush=True))
        except SlotDirError as e:
            print(f"verify-slot: WARN {e}; running unslotted", file=sys.stderr, flush=True)
            slot = None
        if slot is not None and slot.queued:
            print(f"verify-slot: slot {slot.index + 1} of {slots} after {slot.waited:.0f}s", file=sys.stderr, flush=True)
        g = Guarded(cmd, hold=slot, on_spawn=lambda x: box.__setitem__("g", x))
        if slot is not None:
            write_holder(slot, {"pid": os.getpid(), "guard": g.pid, "group": g.group, "cwd": os.getcwd(),
                                "since": _stamp(), "kind": "run"})
        rc = g.wait()
    except _Signalled as s:
        for sig in SIGNALS:
            signal.signal(sig, signal.SIG_IGN)
        if box["g"] is not None:
            box["g"].stop()
        rc = 128 + s.signum
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
    print(json.dumps({"dir": d, "slots": out, "waiters": ws}))
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)
    if not argv:
        print(USAGE, file=sys.stderr)
        return 2
    verb, rest = argv[0], argv[1:]
    try:
        if verb == "run":
            return cmd_run(rest)
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
