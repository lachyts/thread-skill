#!/usr/bin/env python3
"""Orient's declared check (ADR 0036 d6; CONTEXT.md **Declared check**): run the command a project note
declares as `orient_check:`, and advance its record only when its output is still what Lachy saw.

python >= 3.8 with PyYAML. It reads frontmatter through next-action.py (imported by path, never run), so the
vault keeps one frontmatter reader. Called as:

    declared-check.py run <project> [--vault PATH] [--timeout S]
    declared-check.py advance <project> --expect <digest> [--vault PATH] [--timeout S]

<project> is a live project note by name or vault path (orient passes § 1's vault-relative `note` field).
Defaults: ~/repos/obsidian and 90 seconds per run of the check. It never writes the vault.

The check runs as `/bin/sh -c <command>` from the realpath of the note's first `repos:` entry (`~` expanded
against HOME; a later entry is never tried), stdin closed, in its own process group, with git's repo-local
variables (GIT_DIR & co.) dropped from the environment. Its stdout is the entries; its stderr only ever names a
failure, and never enters the output or the digest. A run past the time limit has its whole group killed
(SIGTERM, a 2-second grace, SIGKILL); so does the live check when this script is signalled.

The guard: the command must be one simple command whose last word takes more arguments, because `advance`
appends ` --advance` to it. Refused, unrun: a control character or line break; an unbalanced quote; a word made
only of `;&|()<>`; a word starting with `#`; a word holding a backtick or `$(`, quoted or not (so `$((…))` and a
single-quoted `'$(x)'` too); a shell reserved word first; a last word ending in a backslash.

`run` runs the command once. `advance` re-runs it, and only when that output's digest equals --expect (the
`digest` of the run Lachy reviewed) runs `<command> --advance`; otherwise the record is held.

Output: line 1 is one compact JSON header, then — for a `run` that is `ok` and an `advance` that is `advanced`
only — the check's own stdout, byte for byte:

    verb      run | advance
    note      the vault-relative project note
    command   the declared string, or null when absent or not a string
    cwd       the directory it ran from, or null
    status    undeclared | invalid | refused | no-repo | ok | failed | timeout   (run)
              invalid | refused | no-repo | held | advanced | failed | timeout   (advance)
    exit      the last run's exit code, or null (nothing ran, or it timed out or did not start)
    digest    sha256 of the plain run's stdout when it exited 0, else null
    bytes     how many bytes follow the header
    audit     one `declared check: …` line, or null for `undeclared` and `ok`
    expected  (advance only) the --expect digest

On `advance`, `failed` and `timeout` are the `--advance` run's own; a failed or timed-out re-run is `held`.

Exit 0 on every header. Exit 2 on a refusal (a usage error, a project that is not one live project note,
`advance` on a note with no `orient_check:`, an --expect that is not 64 lowercase hex): stderr carries one line
starting `declared-check: ` and nothing ran. Exit 3 when the vault or PyYAML is missing. Signalled, it kills the
live check's group and exits 128 + the signal number.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
NEXT_ACTION_PY = os.path.join(HERE, "next-action.py")
VAULT_DEFAULT = "~/repos/obsidian"
TIMEOUT_DEFAULT = 90.0
KILL_GRACE = 2.0
TAIL_MAX = 240
PREFIX = "declared check: "
HELD = "record held, the next orient lists it"
DIGEST = re.compile(r"[0-9a-f]{64}")
OPERATORS = ";&|()<>"
CONTROL = re.compile("[\x00-\x1f\x7f\x85  ]")
RESERVED = {"!", "{", "}", "[[", "]]", "case", "coproc", "do", "done", "elif", "else", "esac", "fi", "for",
            "function", "if", "in", "select", "then", "time", "until", "while"}


def fail(code, reason):
    sys.stderr.write("declared-check: %s\n" % reason)
    sys.exit(code)


def _load(name, path):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


try:
    NA = _load("thread_next_action", NEXT_ACTION_PY)
except Exception as e:  # a broken install: report it as this script, never as a traceback
    fail(3, "cannot load %s: %s" % (NEXT_ACTION_PY, e))


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


# ---- The declaration ---------------------------------------------------------------------------------

def not_simple(cmd):
    """Why `cmd` is not one simple command that takes a trailing ` --advance`, else None."""
    if CONTROL.search(cmd):
        return "a line break or control character"
    lex = shlex.shlex(cmd, posix=False, punctuation_chars=OPERATORS)
    lex.commenters = ""
    lex.whitespace_split = True
    try:
        words = list(lex)
    except ValueError:
        return "an unbalanced quote"
    for w in words:
        if all(c in OPERATORS for c in w):
            return "the operator %s" % w
        if w.startswith("#"):
            return "a # comment"
        if "`" in w:
            return "a backtick"
        if "$(" in w:
            return "a $( substitution"
    if words[0] in RESERVED:
        return "the reserved word %s first" % words[0]
    if words[-1].endswith("\\"):
        return "a trailing backslash"
    return None


def work_dir(note):
    """(realpath, None) for the first `repos:` entry when it is a directory, else (None, the entry or `none`)."""
    entries = NA.as_list(note.get("repos"))
    if not entries:
        return None, "none"
    first = entries[0]
    if not isinstance(first, str) or not first.strip():
        return None, str(first)
    path = os.path.expanduser(first.strip())
    if not os.path.isabs(path) or not os.path.isdir(path):
        return None, first.strip()
    return os.path.realpath(path), None


# ---- Running it --------------------------------------------------------------------------------------

_live = {"proc": None}


def git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as unfinished-rollout.py's git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=30).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def kill_group(proc):
    """SIGTERM the process group, wait up to KILL_GRACE for it to empty, then SIGKILL it (lead-integrate's)."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        proc.poll()
        return
    end = time.monotonic() + KILL_GRACE
    while time.monotonic() < end:
        proc.poll()
        try:
            os.killpg(proc.pid, 0)
        except (ProcessLookupError, PermissionError):
            return
        time.sleep(0.05)
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def on_signal(signum, _frame):
    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(s, signal.SIG_IGN)
    if _live["proc"] is not None:
        kill_group(_live["proc"])
    os._exit(128 + signum)


class Ran:
    """One run of the check: `exit` (None on a timeout or a start failure), stdout, stderr, why it did not finish."""

    def __init__(self, exit=None, out=b"", err=b"", timed_out=False, start_error=None):
        self.exit, self.out, self.err = exit, out, err
        self.timed_out, self.start_error = timed_out, start_error

    @property
    def ok(self):
        return self.exit == 0

    def digest(self):
        return hashlib.sha256(self.out).hexdigest() if self.ok else None


def run_check(cmd, cwd, env, timeout):
    try:
        proc = subprocess.Popen(["/bin/sh", "-c", cmd], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    except OSError as e:
        return Ran(start_error=e.strerror or str(e))
    _live["proc"] = proc
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        # Kill the whole group before draining: a grandchild holding a pipe would hang communicate().
        kill_group(proc)
        for f in (proc.stdout, proc.stderr):
            try:
                f.close()
            except OSError:
                pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        return Ran(timed_out=True)
    finally:
        if proc.poll() is not None:
            _live["proc"] = None
    return Ran(exit=proc.returncode, out=out, err=err)


def last_line(data):
    for line in reversed(data.decode("utf-8", "replace").splitlines()):
        if line.strip():
            return line.strip()
    return None


def tail(ran):
    """The line that names a failure: stderr's last non-empty line, else stdout's, else `no output`."""
    return (last_line(ran.err) or last_line(ran.out) or "no output")[:TAIL_MAX]


def seconds(timeout):
    return "%gs" % timeout


def why_not(ran, timeout):
    """`exit N: <tail>`, `timed out after Ns` or `cannot start (<reason>)` for a run that did not exit 0."""
    if ran.start_error is not None:
        return "cannot start (%s)" % ran.start_error
    if ran.timed_out:
        return "timed out after %s" % seconds(timeout)
    return "exit %d: %s" % (ran.exit, tail(ran))


def failed_line(ran, timeout, lead=""):
    """The audit line of a run that did not exit 0, `lead` naming which run (`--advance `) when it matters."""
    line = lead + why_not(ran, timeout)
    return line + "; its process group was killed" if ran.timed_out else line


# ---- The verbs ---------------------------------------------------------------------------------------

def outcome(ran):
    return "timeout" if ran.timed_out else "failed"


def check(args, rel, note, head):
    """Fill `head` for a declaration that cannot run (returns None), or return (command, cwd) to run."""
    value = note.get("orient_check")
    if value is None or (isinstance(value, str) and not value.strip()):
        if args.verb == "advance":
            fail(2, "%s has no orient_check: to advance" % rel)
        head["status"] = "undeclared"
        return None
    if not isinstance(value, str):
        head.update(status="invalid", audit="orient_check: is not a command string (%s); not run" % type(value).__name__)
        return None
    head["command"] = value
    why = not_simple(value)
    if why is not None:
        head.update(status="refused", audit="orient_check: is not one simple command (%s); not run" % why)
        return None
    cwd, entry = work_dir(note)
    if cwd is None:
        head.update(status="no-repo", audit="%s has no repos: directory to run orient_check: from (%s); not run" % (rel, entry))
        return None
    head["cwd"] = cwd
    return value, cwd


def verb_run(cmd, cwd, env, args, head):
    ran = run_check(cmd, cwd, env, args.timeout)
    head["exit"] = ran.exit
    if not ran.ok:
        head.update(status=outcome(ran), audit=failed_line(ran, args.timeout))
        return b""
    head.update(status="ok", digest=ran.digest())
    return ran.out


def verb_advance(cmd, cwd, env, args, head):
    again = run_check(cmd, cwd, env, args.timeout)
    head["exit"] = again.exit
    if not again.ok:
        head.update(status="held", audit="the re-run before --advance %s; %s" % (why_not(again, args.timeout), HELD))
        return b""
    head["digest"] = again.digest()
    if head["digest"] != args.expect:
        head.update(status="held", audit="changed since the audit; %s" % HELD)
        return b""
    ran = run_check(cmd + " --advance", cwd, env, args.timeout)
    head["exit"] = ran.exit
    if not ran.ok:
        head.update(status=outcome(ran), audit=failed_line(ran, args.timeout, "--advance "))
        return b""
    head.update(status="advanced", audit="advanced; %s" % (last_line(ran.out) or "no output")[:TAIL_MAX])
    return ran.out


def main(argv):
    p = Parser(prog="declared-check", allow_abbrev=False,
               description="Orient's declared check: run a project's orient_check:, or advance it (ADR 0036 d6).")
    p.add_argument("verb", choices=["run", "advance"])
    p.add_argument("project")
    p.add_argument("--expect")
    p.add_argument("--vault", default=VAULT_DEFAULT)
    p.add_argument("--timeout", type=float, default=TIMEOUT_DEFAULT)
    args = p.parse_args(argv)
    if args.verb == "advance" and args.expect is None:
        fail(2, "advance needs --expect <digest>: the digest of the run Lachy reviewed")
    if args.verb == "run" and args.expect is not None:
        fail(2, "--expect is for advance only")
    if args.expect is not None and not DIGEST.fullmatch(args.expect):
        fail(2, "--expect must be a sha256 digest, 64 lowercase hex characters: %s" % args.expect)
    if not args.timeout > 0:
        fail(2, "--timeout must be a positive number of seconds")
    if NA.yaml is None:
        fail(3, "PyYAML is required: python3 -m pip install pyyaml")
    vroot = os.path.expanduser(args.vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    vault = NA.Vault(vroot)
    try:
        rel, skip = vault.resolve_project(args.project)
    except NA.Refused as e:
        fail(2, str(e))
    if rel is None:
        fail(2, "%s: %s" % (args.project, skip))
    note = vault.note(rel)

    head = {"verb": args.verb, "note": rel.replace(os.sep, "/"), "command": None, "cwd": None, "status": None,
            "exit": None, "digest": None, "bytes": 0, "audit": None}
    if args.verb == "advance":
        head["expected"] = args.expect
    body = b""
    found = check(args, head["note"], note, head)
    if found is not None:
        for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(s, on_signal)
        cmd, cwd = found
        body = (verb_run if args.verb == "run" else verb_advance)(cmd, cwd, git_env(), args, head)
    if head["audit"] is not None:
        head["audit"] = PREFIX + head["audit"]
    head["bytes"] = len(body)
    out = sys.stdout.buffer
    out.write(json.dumps(head, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "replace") + b"\n")
    out.write(body)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
