#!/usr/bin/env python3
"""The suites' one handshake: a test, never the clock, ends a wait; the cap only turns a lost handshake into a
loud failure instead of a hang. Every wait polls every 0.05 s and gives up after --cap seconds (CAP, 120 s by
default: a loaded host delays the other side by seconds, a broken handshake never arrives).

  handshake.py wait <file> [--cap S] [--pid P]
      Exit 0 once <file> exists. Exit 3 when the cap passes first, 4 when process P is gone first (P is the side
      that should create <file>), each with a `handshake:` line on stderr.
  handshake.py hold <lock> --held <file|-> [--release <file|->] [--cap S]
      Take an exclusive flock on <lock>, then create <file> (`-`: print `held` on stdout), and hold the lock until
      <release> exists (`-`: until stdin closes). Exit 0 on release; when the cap passes first, let go and exit 3.

Python callers import it (`sys.path` the tests/lib dir) and call wait_for(path, cap, pid) -> 0 | 3 | 4.
"""
import argparse
import fcntl
import os
import select
import sys
import time

CAP = 120.0
POLL = 0.05


def _gone(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def wait_for(path, cap=CAP, pid=None):
    end = time.monotonic() + cap
    while not os.path.exists(path):
        if pid is not None and _gone(pid):
            return 4
        if time.monotonic() >= end:
            return 3
        time.sleep(POLL)
    return 0


def _released(release, end):
    if release == "-":
        while time.monotonic() < end:
            ready, _, _ = select.select([sys.stdin], [], [], POLL)
            if ready and not sys.stdin.buffer.read1(4096):
                return True
        return False
    return wait_for(release, max(0.0, end - time.monotonic())) == 0


def main(argv):
    ap = argparse.ArgumentParser(prog="handshake.py")
    sub = ap.add_subparsers(dest="verb", required=True)
    w = sub.add_parser("wait")
    w.add_argument("file")
    w.add_argument("--cap", type=float, default=CAP)
    w.add_argument("--pid", type=int)
    h = sub.add_parser("hold")
    h.add_argument("lock")
    h.add_argument("--held", required=True)
    h.add_argument("--release", default="-")
    h.add_argument("--cap", type=float, default=CAP)
    a = ap.parse_args(argv)
    if a.verb == "wait":
        rc = wait_for(a.file, a.cap, a.pid)
        if rc == 3:
            print(f"handshake: {a.file} never appeared within {a.cap:g}s", file=sys.stderr)
        elif rc == 4:
            print(f"handshake: process {a.pid} ended before {a.file} appeared", file=sys.stderr)
        return rc
    fh = open(a.lock, "a")
    fcntl.flock(fh, fcntl.LOCK_EX)
    if a.held == "-":
        print("held", flush=True)
    else:
        open(a.held, "w").close()
    if _released(a.release, time.monotonic() + a.cap):
        return 0
    print(f"handshake: hold on {a.lock} never released within {a.cap:g}s; letting go", file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
