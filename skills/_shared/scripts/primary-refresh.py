#!/usr/bin/env python3
"""primary-refresh.py — the Primary refresh (ADR 0066, amended 2026-11-05 by p37-7): keep the live-loaded checkouts
current with origin.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/primary-refresh.py run [--primary DIR] [--also DIR]...
        [--state F] [--log F] [--ntfy-server URL] [--now ISO] [--dry-run] [--job-shape N] [--ff-timeout N]
        [--smoke-timeout N]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/primary-refresh.py install [--primary DIR] [--also DIR]...
        [--bin-dir DIR] [--plist F] [--interval 300] [--label com.thread.primary-refresh]
        [--log ~/Library/Logs/thread-primary-refresh.log]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/primary-refresh.py bundle

Every session loads this plugin live from its primary checkout (the directory-source install). land.sh S4 and
merge-task's in-place refresh (`self-rollout-check.sh --refresh-in-place`) also fast-forward that checkout, but only
when they run and ADR 0031's hold is clear: on 2026-11-02 it sat 97 commits behind because the hold never cleared. The
Primary refresh is the background job that keeps trying: every pass it fast-forwards the primary to origin while the
hold is clear, and each `--also` checkout (`~/.agents`, which holds /fresh-review and the shared skills) whenever it is
behind.

run, one pass, in this order:
  1. --log F: a log over 1 MiB moves to F.1 first, one generation kept (a pass whose stdout or stderr is that file
     carries on in a fresh F); never under --dry-run, and a missing log directory skips it.
  2. The state is read. 3. Each checkout's pass (below). 4. The self-update and 5. the job check, on the installed copy
     only. 6. The notices. 7. The state is written, when it changed or read as corrupt, never under --dry-run.

One checkout's pass, the primary first, one log line each, `<ISO time> primary-refresh <dir>: <outcome>`, stopping at
the first step that says no. Every git step runs through skills/_shared/scripts/live-checkout.sh, the one primitive
land.sh and self-rollout-check.sh share (the bundle's copy beside this file, else the primary's; with neither, `broken:
no <rel> beside the copy or in <primary>`). Its run modes print a contract, parsed strictly: an exit or a line it does
not promise reads `broken: live-checkout.sh <mode>: <exit N | ran past 60 s | no output | unrecognised output "…">`,
never current or moved, and never leads to a merge.
  a. The checkout: its own toplevel, a main checkout (its git dir is its common dir, so never a linked worktree or an
     Engine snapshot) whose name does not end `-rollout` (a Rollout clone). Else `not a primary checkout: <why>`.
     --primary defaults to this script's plugin root, three levels up.
  b. Origin's default branch (`default`): origin/HEAD, else origin/master, else origin/main, read locally; else origin
     is asked under the ssh rule (60 s). Neither: `fetch failed: cannot resolve origin's default branch (…)`.
  c. The fetch (`fetch`, 60 s): one branch, +refs/heads/<d>:refs/remotes/origin/<d>, --no-tags, never FETCH_HEAD, under
     land.sh's ssh rule (BatchMode unless the operator set an ssh command; never a prompt), so an unrelated ref
     conflict never fails it. A failure is `fetch failed: <git's last fatal: or error: line, else its last line>`,
     and nothing later reads the stale refs.
  d. The read (`check`): `current` (HEAD at origin's tip, on any branch); `ahead <n>: left to its landing route`;
     `diverged (ahead <a>, behind <b>)`: never integrated here (ADR 0042's rule; read before the hold, since it never
     clears by itself); behind and `busy: <why>` (an index.lock, a rebase, merge, cherry-pick, revert, bisect or
     sequencer in progress, a detached HEAD, another branch); `unreadable: <why>` (an unborn HEAD, say).
  e. Behind, the primary only: the hold, `bash <primary>/skills/_shared/scripts/primary-hold.sh <primary>` (the
     primary's own copy, the rule the rollouts reading it run by; 120 s). Any output is `held: <it>`, flattened to one
     line; a missing script, a non-zero exit or a timeout holds too (fail closed). An `--also` checkout has no hold:
     sessions commit there in place, so a fast-forward is no different from a peer's commit. Asked only here, so
     `refused` below always means the hold is clear and git still would not move.
  f. An uncommitted edit origin's commits would overwrite (live-checkout.sh's overlap: dirty or staged tracked files,
     and untracked ones where origin adds a path): `refused: local changes overlap origin/<d> (<paths>)`. No merge
     runs, so ORIG_HEAD is never rewritten.
  g. Behind and free: `would move <old12>..<new12> (<n> commits)` under --dry-run; else `ff`, `git merge -q --ff-only
     --no-autostash`, bounded by --ff-timeout (600 s): `moved <old12>..<new12> (<n> commits)` (HEAD re-read and checked
     against what the helper said), `refused: <git's reason>`, or `timed out: git merge --ff-only ran past <N> s and was
     stopped: the working tree may be partly updated (git -C <d> status)`.

The notices. A stuck spell runs from the first pass whose kind is stuck (not-primary, busy, fetch-failed, broken,
unreadable, diverged, held, refused, timed-out) to the next that reads current, moved or ahead (would move changes
nothing). Its entry is {since, kind, kindSince, outcome, notifiedKinds, notified?, notifyFailed?, notifyWhy?}: `since`
never moves within the spell, a change of kind restarts only `kindSince`, `outcome` is the latest pass's. The first
notice is due once the spell is 24 h old from `since`, whatever its kinds meanwhile, or at once for timed-out (a merge
stopped mid-checkout may have left the live-loaded tree half updated). After it, one re-notice per kind not yet
notified in this spell, once that kind has stood an hour (timed-out at once); a kind already notified never sends
again, so the notices are bounded by the kinds. A failed send is retried no sooner than an hour later, and its reason
is logged: `not notified (ntfy-push exit <rc>: <its last line>)`. One due-rule pass runs over every spell this pass
touched, plus the installed copy's own `self-update` and `job` spells whenever they stand. The message is one line,
outcome first, `<name>: <outcome>` cut to 200 characters, then the longest tail that fits (` (stuck since <since16>;
git -C <d> status)`, else ` (since <MM-DDTHH:MM>)`, else none; ` (since <since16>)` for the copy's own spells), so a
hold naming five rollouts keeps its last holder. It goes through skills/execute/scripts/ntfy-push.py, the bundle's copy
first, then the primary's, so a primary that has gone is still reported. The spells live in the state file
${XDG_STATE_HOME:-~/.local/state}/thread/primary-refresh.json (or --state), {"v": 1, "stuck": {<checkout path, or
`self-update` or `job`>: entry}}, written atomically. A corrupt file, an entry whose `since` will not parse (dropped)
or a bad field (kindSince read as now; notified, notifyFailed, a non-40-hex `tip`, a non-ISO `tipAt` read as absent)
is one WARN, never a traceback, and the file is rewritten valid. An entry in the shape before p37-7, {since,
notified?}, takes its first stuck pass's kind: notified, that kind counts as notified, so its next notice needs a new
kind that has stood an hour. STATE_VERSION stays 1: the fields are additive, and the copy before p37-7 keeps unknown
keys and fields and never re-sends an entry with `notified`.

The bundle: install writes BUNDLE's files beside each other in --bin-dir, with the marker primary-refresh.installed:
this copy (its install-rel primary-refresh.py, the plist's path), and live-checkout.sh, default-branch.sh,
ntfy-push.py, rollout-settings.py and ladder.py each at its repo path below the copy's directory (a mirrored mini plugin
root, so ntfy-push.py's and live-checkout.sh's own sibling lookups work unchanged). `bundle` prints the table, one
`<mode> <repo-rel> <install-rel>` line per file.

The self-update, on the installed copy (the marker beside it) only, on every pass whose primary fetch succeeded,
whatever the primary read, at the tip that fetch read (`git cat-file blob <tip>:<rel>`: one sha, never a short name,
never the working tree). Its exceptions are caught (`self-update: failed (<Type>: <msg>)`, kind failed), so it never
skips the notices or the state.
  1. origin's primary-refresh.py at the tip equal to this copy: compare every row of this copy's own table (bytes and
     mode) with the copy's directory. Nothing differs: current, which clears the self-update spell (printed only under
     --dry-run, which otherwise prints `would install …` and stops there).
  2. A tip already refused within the last 24 h (SMOKE_RETRY) is skipped, so each tip is smoked once; a tip whose
     install failed partway is restaged and installed with no second smoke.
  3. Stage, in a `.stage-*` directory beside the copy (leftovers removed first): the candidate script (compiled first),
     and the candidate's own table, read from `<python> -B <stage>/primary-refresh.py bundle` and checked strictly
     (every line `0<ooo> <rel> <rel>`, no `.` or `..` component, no install-rel starting `.` or naming the marker, unique
     install-rels, at most 32 lines, the copy's own row present), then every other row's file at the tip with its mode,
     and the marker. Each .py is compiled and each .sh passes `bash -n`.
  4. The smoke: the candidate runs the job's own argv (this pass's, as launchd passed it) with --state, --log and --now
     replaced in place where present (<stage>/smoke-state.json, <stage>/smoke.log, this pass's stamp), --state added if
     absent, and --dry-run added: so it fetches for real through its own staged live-checkout.sh, reads the hold, and
     runs its compare-only self-update against the stage it was built from. Accepted only at exit 0 with no Traceback,
     its primary's outcome line neither `fetch failed:`, `not a primary checkout:`, `broken:` nor `unreadable`, and a
     `self-update: current` line; bounded by --smoke-timeout (300 s). A refusal: `self-update: origin's bundle at
     <tip12> failed its smoke run (<why>): the installed copy is kept`.
  5. Install, by the candidate's table: the helpers that differ, then every file of this copy's own table that the
     candidate's drops (removed, so a stale helper never shadows the primary's), then this copy, last, so a failure
     partway leaves the old copy running with its own table: `installed <k> of <n> files, then <rel> failed (<e>): the
     next fetched pass finishes it` (kind install-failed). Success: `the installed bundle now matches origin/<d> at
     <tip12> (installed …; removed …)`.
  A refusal opens or continues the `self-update` spell (kind refused, install-failed or failed, with the tip and tipAt),
  under the notice rules. A helper an older copy cannot parse reads `broken:`, never moved, and the next fetched pass
  heals it.

The self-update contract is frozen: an installed copy sends every candidate `run`, --state, --log, --now and
--dry-run, the `bundle` subcommand, and reads its `<mode> <repo-rel> <install-rel>` lines and the `primary-refresh
<P>: <outcome>` and `self-update: current` lines back. Change any of them and every installed copy refuses every
candidate: the self-update spell notifies after 24 h, and a hand-run install recovers (tests/primary-refresh.test.sh I6
pins the literal tokens). `run` takes no abbreviated flag, so the smoke's rewrite names every flag one way.

The job check, on the installed copy: the self-update rewrites bundle files only; the interpreter, PATH, --log and
--job-shape live in the plist, which only install writes and only a re-bootstrap loads. A job whose --job-shape is below
JOB_SHAPE (an absent one reads 0) opens the `job` spell (kind stale-job), logged once and again on its notice pass:
`job: the launchd job predates this copy (job shape <N>, wants <JOB_SHAPE>): re-run primary-refresh.py install and the
launchctl line it prints`. The first pass at JOB_SHAPE clears it, `job: current`. --dry-run only prints.

Signals: TERM, INT and HUP to a pass stop its live child's process group (TERM, then KILL after KILL_GRACE, 5 s; every
child runs in its own session), then the pass exits 128 + the signal with the state left as it was; a signal during a
spawn is held until the child is recorded. A smoke stopped by its bound is TERMed the same way and stops its own child
first (SMOKE_GRACE, 10 s, > KILL_GRACE), so nothing it started is orphaned. A pass stops inside launchd's 20 s.

--dry-run fetches, then says what it would do: it moves nothing, installs nothing, notifies nothing, rotates nothing
and writes no state. --now pins the clock (tests). Exit 0 whatever it finds; 2 on usage; 128 + N on a signal.

install (python >= 3.11, else exit 2: ntfy-push.py needs tomllib) writes the bundle into --bin-dir
(~/.local/state/thread/bin) from this checkout (or from the installed copy's own bundle, run from there), exit 2 naming
a missing source, and leaves anything else there alone. It writes the launchd job to --plist
(~/Library/LaunchAgents/<label>.plist): ProgramArguments [python, the copy, run, --primary <dir>, --also <dir>...,
--log <log>, --job-shape <JOB_SHAPE>], python being `python3` on PATH when it is this interpreter, else this
interpreter's own path; PATH git's directory, python's, /usr/bin, /bin, /usr/sbin, /sbin; StartInterval --interval
(300), RunAtLoad, ProcessType Background, --log for stdout and stderr. It runs the copy, never the primary's file, so
the job exists before the primary holds this script, its path never moves, and it updates itself. Then it prints `the
job runs <python>` and the one line left to Lachy's shell: `launchctl bootout gui/<uid>/<label> 2>/dev/null; while
launchctl print gui/<uid>/<label> >/dev/null 2>&1; do sleep 1; done; launchctl bootstrap gui/<uid> <plist>`.

Stdlib only; `run` and `bundle` run on python >= 3.9. Never writes the vault, a rollout note or a Run record.
"""
import argparse
import json
import os
import plistlib
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
PLUGIN_ROOT = HERE.parent.parent.parent
MARKER = "primary-refresh.installed"  # install writes it beside the copy: only that copy ever rewrites itself
INSTALLED = (HERE / MARKER).is_file()
BUNDLE_ROOT = HERE if INSTALLED else PLUGIN_ROOT
HOLD_REL = "skills/_shared/scripts/primary-hold.sh"
LC_REL = "skills/_shared/scripts/live-checkout.sh"
NTFY_REL = "skills/execute/scripts/ntfy-push.py"
SELF_REL = "skills/_shared/scripts/primary-refresh.py"
COPY = "primary-refresh.py"  # the copy's install-rel: the plist's path, part of the self-update contract
# (mode, repo-rel, install-rel): what install writes, what the self-update stages and installs, what `bundle` prints.
BUNDLE = (
    ("0755", SELF_REL, COPY),
    ("0755", LC_REL, LC_REL),
    ("0755", "skills/execute/scripts/default-branch.sh", "skills/execute/scripts/default-branch.sh"),
    ("0755", NTFY_REL, NTFY_REL),
    ("0644", "skills/_shared/scripts/rollout-settings.py", "skills/_shared/scripts/rollout-settings.py"),
    ("0644", "skills/_shared/scripts/ladder.py", "skills/_shared/scripts/ladder.py"),
)
# Bump whenever install's ProgramArguments or EnvironmentVariables change: the self-update never rewrites the plist,
# so only this tells a job left on the old one (tests/primary-refresh.test.sh I4 pins both beside it).
JOB_SHAPE = 1
DEFAULT_INTERVAL = 300
DEFAULT_LABEL = "com.thread.primary-refresh"
DEFAULT_LOG = "~/Library/Logs/thread-primary-refresh.log"
DEFAULT_BIN = "~/.local/state/thread/bin"
STATE_VERSION = 1
NOTIFY_AFTER = timedelta(hours=24)     # a spell's first notice
RENOTIFY_SETTLE = timedelta(hours=1)   # a new kind stands this long before its re-notice
NOTIFY_RETRY = timedelta(hours=1)      # a failed send waits this long
SMOKE_RETRY = timedelta(hours=24)      # a refused tip is smoked again after this (= NOTIFY_AFTER, by design)
GIT_TIMEOUT = 60
HOLD_TIMEOUT = 120
NTFY_TIMEOUT = 60
BUNDLE_TIMEOUT = 60
FF_TIMEOUT = 600
SMOKE_TIMEOUT = 300
KILL_GRACE = 5    # every leaf child: git, the bash helpers, the hold, ntfy-push
SMOKE_GRACE = 10  # a smoke's candidate, which stops its own child (KILL_GRACE) first
LOG_MAX = 1 << 20
TABLE_MAX = 32
SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
STUCK_KINDS = ("not-primary", "busy", "fetch-failed", "broken", "unreadable", "diverged", "held", "refused",
               "timed-out")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
BRANCH_RE = re.compile(r"^[A-Za-z0-9._][A-Za-z0-9._/-]*$")
# live-checkout.sh check's one line, form by form (its header is the other half of this contract).
CHECK_FORMS = {
    "current": re.compile(r"^current ([0-9a-f]{40})$"),
    "ahead": re.compile(r"^ahead ([0-9a-f]{40}) ([0-9]+)$"),
    "diverged": re.compile(r"^diverged ([0-9a-f]{40}) ([0-9]+) ([0-9]+)$"),
    "busy": re.compile(r"^busy ([0-9a-f]{40}) (.+)$"),
    "overlap": re.compile(r"^overlap ([0-9a-f]{40}) ([0-9]+) (.+)$"),
    "behind": re.compile(r"^behind ([0-9a-f]{40}) ([0-9]+) ([0-9a-f]{40})$"),
    "unreadable": re.compile(r"^unreadable (.+)$"),
}
FF_FORMS = {
    "moved": re.compile(r"^moved ([0-9a-f]{40}) ([0-9a-f]{40})$"),
    "overlap": re.compile(r"^overlap (.+)$"),
    "refused": re.compile(r"^refused (.+)$"),
}
_SEG = r"[A-Za-z0-9._-]+"
ROW_RE = re.compile(rf"^(0[0-7]{{3}}) ({_SEG}(?:/{_SEG})*) ({_SEG}(?:/{_SEG})*)$")
SMOKE_DENIED = ("fetch failed:", "not a primary checkout:", "broken:", "unreadable")
_STAMP = ""  # the pass's time, for the lines it prints
_ARGV = []   # the argv main parsed: the smoke runs the job's own


class _Signalled(BaseException):
    """A signal to the pass. A BaseException, so the self-update's `except Exception` never swallows it."""

    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


def _on_signal(signum, _frame):
    raise _Signalled(signum)


def _env():
    """os.environ less the repo-local git vars a caller may export (GIT_DIR & co., primary-hold.sh's scrub)."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               timeout=GIT_TIMEOUT).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    for n in names:
        if n not in ("GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"):
            env.pop(n, None)
    return env


ENV = _env()


# ---- children: each in its own session, stopped with its whole group ------------------------------------------------

def _kill_group(p, grace):
    """SIGTERM the child's process group, wait up to `grace` for it to empty, then SIGKILL it (lead-integrate.py's)."""
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
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _stop(p, grace):
    """_kill_group with SIGNALS held, so a second signal cannot cut the wait short; it is raised once the group is gone."""
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        _kill_group(p, grace)
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)


def _drain(p):
    """What a stopped child left in its pipes, once its group is gone."""
    try:
        return p.communicate(timeout=2)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        for f in (p.stdout, p.stderr):
            try:
                f.close()
            except (OSError, AttributeError):
                pass
        return b"", b""


def _run(argv, timeout, input=None, raw=False, grace=KILL_GRACE):
    """(rc, stdout, stderr, timed_out). The child starts in a new session; at its timeout, or when a signal (or
    KeyboardInterrupt) reaches here while it runs, its whole group is stopped (_kill_group), and the signal re-raised.
    SIGNALS are held across the spawn, so one landing there is raised once the child is recorded; the child starts
    with the caller's own mask. stdout is text, stripped, or bytes, unstripped, with raw; stderr is text, stripped."""
    data = None if input is None else (input if isinstance(input, bytes) else input.encode("utf-8"))
    p = None
    timed_out = False
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        try:
            p = subprocess.Popen(argv, stdin=subprocess.DEVNULL if data is None else subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV, start_new_session=True,
                                 preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, mask))
        except OSError as e:
            return 127, (b"" if raw else ""), str(e), False
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        try:
            out, err = p.communicate(input=data, timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _stop(p, grace)
            out, err = _drain(p)
    except BaseException:
        if p is not None:
            _stop(p, grace)
        raise
    rc = p.returncode if p.returncode is not None else -signal.SIGKILL
    err_s = (err or b"").decode("utf-8", "replace").strip()
    if raw:
        return rc, out or b"", err_s, timed_out
    return rc, (out or b"").decode("utf-8", "replace").strip(), err_s, timed_out


def git(d, *args, timeout=GIT_TIMEOUT, raw=False):
    """(returncode, stdout, stderr stripped); a git that cannot run reads as 127, one stopped at its bound as 128."""
    rc, out, err, timed_out = _run(["git", "-C", str(d), *args], timeout, raw=raw)
    if timed_out:
        return 128, (b"" if raw else ""), f"git {args[0]} ran past {timeout} s and was stopped"
    return rc, out, err


def _flat(s):
    return " ".join(str(s).split())


def _last_line(text, n=200):
    lines = [_flat(x) for x in str(text).splitlines() if x.strip()]
    return lines[-1][:n] if lines else ""


def _why_line(text, n=200):
    """git's reason: its last `fatal:` or `error:` line (a transport failure's hint lines come after it), else the
    last non-empty line."""
    lines = [_flat(x) for x in str(text).splitlines() if x.strip()]
    said = [x for x in lines if x.startswith(("fatal:", "error:"))]
    return (said or lines or [""])[-1][:n]


def _real(p):
    return Path(os.path.realpath(os.path.expanduser(str(p))))


def _line(label, text):
    print(f"{_STAMP} primary-refresh {label}: {text}", flush=True)


def _helper(rel, primary):
    """A bundle file: the copy's own (BUNDLE_ROOT/<rel>), else the primary's; None with neither."""
    for base in (BUNDLE_ROOT, Path(primary)):
        f = base / rel
        if f.is_file():
            return f
    return None


def _lc(script, mode, *args, timeout=GIT_TIMEOUT):
    return _run(["bash", str(script), mode, *[str(a) for a in args]], timeout)


def _said(rc, out, timed_out=False, timeout=GIT_TIMEOUT):
    if timed_out:
        return f"ran past {timeout} s"
    if rc != 0:
        return f"exit {rc}"
    if not out:
        return "no output"
    return f'unrecognised output "{_flat(out)[:80]}"'


def _form(forms, rc, out, timed_out):
    """(form, match) for a helper's one promised line, else (None, None)."""
    if timed_out or rc != 0:
        return None, None
    lines = out.splitlines()
    if len(lines) != 1:
        return None, None
    rx = forms.get(lines[0].split(" ", 1)[0])
    m = rx.match(lines[0]) if rx else None
    return (lines[0].split(" ", 1)[0], m) if m else (None, None)


# ---- one checkout's pass --------------------------------------------------------------------------------------------

def checkout_problem(d):
    """None for a main checkout that is its own toplevel and no Rollout clone; else why not."""
    rc, top, _ = git(d, "rev-parse", "--show-toplevel")
    if rc != 0:
        return "not a git checkout"
    if _real(top) != _real(d):
        return f"not its own toplevel ({top})"
    rc1, gd, _ = git(d, "rev-parse", "--path-format=absolute", "--git-dir")
    rc2, gc, _ = git(d, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if rc1 or rc2:
        return "its git dir cannot be read"
    if _real(gd) != _real(gc):
        return "a linked worktree (an Engine snapshot or a session's worktree)"
    if _real(d).name.endswith("-rollout"):
        return "a Rollout clone"
    return None


def hold(primary):
    """primary-hold.sh's line, flattened, or None when nothing holds. Fails closed."""
    script = Path(primary) / HOLD_REL
    if not script.is_file():
        return f"no {HOLD_REL} in the primary"
    rc, out, err, timed_out = _run(["bash", str(script), str(primary)], HOLD_TIMEOUT)
    if timed_out:
        return f"the hold check ran past {HOLD_TIMEOUT} s and was stopped"
    if rc != 0:
        said = _flat(err or out)
        return (f"the hold check exited {rc}" + (f": {said}" if said else ""))[:240]
    return _flat(out) or None


def _origin_tip(d, branch):
    rc, t, _ = git(d, "rev-parse", "-q", "--verify", f"refs/remotes/origin/{branch}^{{commit}}")
    return t if rc == 0 and HEX40.match(t) else None


def refresh(d, primary, is_primary, dry_run, ff_timeout=FF_TIMEOUT):
    """One checkout's pass: (outcome, kind, tip, branch). kind None clears a stuck spell (current, moved, ahead), `dry`
    changes nothing (would move), any other is stuck. tip is origin's tip as this pass fetched it (ff's verified new sha
    after a move), None when the fetch did not succeed: the self-update runs on it whatever the checkout read."""
    why = checkout_problem(d)
    if why:
        return f"not a primary checkout: {why}", "not-primary", None, None
    lc = _helper(LC_REL, primary)
    if lc is None:
        return f"broken: no {LC_REL} beside the copy or in {primary}", "broken", None, None
    rc, out, _, timed_out = _lc(lc, "default", d)
    if timed_out:
        return (f"fetch failed: cannot resolve origin's default branch (origin did not answer within {GIT_TIMEOUT} s)",
                "fetch-failed", None, None)
    if rc == 1:
        return ("fetch failed: cannot resolve origin's default branch (no origin/HEAD, origin/master or origin/main "
                "here, and origin did not answer)", "fetch-failed", None, None)
    if rc != 0 or len(out.splitlines()) != 1 or not BRANCH_RE.match(out):
        return f"broken: live-checkout.sh default: {_said(rc, out)}", "broken", None, None
    branch = out
    frc, _, ferr, fto = _lc(lc, "fetch", d, branch)
    if fto:
        return f"fetch failed: git fetch ran past {GIT_TIMEOUT} s and was stopped", "fetch-failed", None, branch
    if frc != 0:
        return f"fetch failed: {_why_line(ferr) or f'exit {frc}'}", "fetch-failed", None, branch
    rc, out, _, timed_out = _lc(lc, "check", d, branch)
    form, m = _form(CHECK_FORMS, rc, out, timed_out)
    if form is None:
        return (f"broken: live-checkout.sh check: {_said(rc, out, timed_out)}", "broken", _origin_tip(d, branch),
                branch)
    if form == "unreadable":
        return f"unreadable: {m.group(1)}", "unreadable", _origin_tip(d, branch), branch
    tip = m.group(1)
    if form == "current":
        return "current", None, tip, branch
    if form == "ahead":
        return f"ahead {m.group(2)}: left to its landing route", None, tip, branch
    if form == "diverged":
        return f"diverged (ahead {m.group(2)}, behind {m.group(3)}): never integrated here", "diverged", tip, branch
    if form == "busy":
        return f"busy: {m.group(2)}", "busy", tip, branch
    if is_primary:
        h = hold(d)
        if h:
            return f"held: {h}", "held", tip, branch
    if form == "overlap":
        return f"refused: local changes overlap origin/{branch} ({m.group(3)})", "refused", tip, branch
    behind, head = m.group(2), m.group(3)
    if dry_run:
        return f"would move {head[:12]}..{tip[:12]} ({behind} commits)", "dry", tip, branch
    rc, out, _, timed_out = _lc(lc, "ff", d, branch, timeout=ff_timeout)
    if timed_out:
        return (f"timed out: git merge --ff-only ran past {ff_timeout} s and was stopped: the working tree may be "
                f"partly updated (git -C {d} status)", "timed-out", tip, branch)
    form, m = _form(FF_FORMS, rc, out, False)
    if form == "moved":
        new = m.group(2)
        now_head = git(d, "rev-parse", "-q", "--verify", "HEAD^{commit}")[1]
        if now_head != new:
            return (f"broken: live-checkout.sh ff: said moved to {new[:12]}, HEAD is {now_head[:12] or 'unreadable'}",
                    "broken", tip, branch)
        return f"moved {m.group(1)[:12]}..{new[:12]} ({behind} commits)", None, new, branch
    if form == "overlap":
        return f"refused: local changes overlap origin/{branch} ({m.group(1)})", "refused", tip, branch
    if form == "refused":
        return f"refused: {m.group(1)}", "refused", tip, branch
    return f"broken: live-checkout.sh ff: {_said(rc, out)}", "broken", tip, branch


# ---- state and notify -----------------------------------------------------------------------------------------------

def _state_path(arg):
    if arg:
        return Path(os.path.expanduser(arg))
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return Path(base) / "thread" / "primary-refresh.json"


def _parse_iso(s):
    """A tz-aware datetime for an ISO string, else None (a non-string, empty or unparseable value)."""
    if not isinstance(s, str) or not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.astimezone()


def _read_state(path, stamp):
    """(stuck, dirty): the entries, each field checked, and whether anything was dropped or read as something else (so
    the file is rewritten valid). Never raises."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return {}, False
    except OSError as e:
        print(f"WARN: primary-refresh: state {path} unreadable ({e}): read as empty", file=sys.stderr)
        return {}, False
    try:
        data = json.loads(raw.decode("utf-8"))  # a UnicodeDecodeError is a ValueError too
        if not isinstance(data, dict) or data.get("v") != STATE_VERSION or not isinstance(data.get("stuck"), dict):
            raise ValueError("not a v1 primary-refresh state")
    except ValueError as e:
        print(f"WARN: primary-refresh: state {path} is corrupt ({e}): read as empty", file=sys.stderr)
        return {}, True
    out, dirty = {}, False
    for k, v in data["stuck"].items():
        if not isinstance(v, dict) or _parse_iso(v.get("since")) is None:
            print(f"WARN: primary-refresh: state {path}: entry {k} has no readable since: dropped", file=sys.stderr)
            dirty = True
            continue
        e = dict(v)
        if not isinstance(e.get("kind"), str):
            e.pop("kind", None)
            e.pop("kindSince", None)
        elif _parse_iso(e.get("kindSince")) is None:
            e["kindSince"] = stamp
        for key in ("notified", "notifyFailed", "tipAt"):
            if key in e and _parse_iso(e[key]) is None:
                e.pop(key)
        if "tip" in e and not (isinstance(e["tip"], str) and HEX40.match(e["tip"])):
            e.pop("tip")
        kinds = e.get("notifiedKinds")
        if "notifiedKinds" in e and not (isinstance(kinds, list) and all(isinstance(x, str) for x in kinds)):
            e.pop("notifiedKinds")
        dirty = dirty or e != v
        out[k] = e
    return out, dirty


def _atomic_write(path, data, mode=None):
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


def _spell(stuck, key, kind, outcome, stamp, **extra):
    """Open or continue key's stuck spell: since never moves; a new kind restarts kindSince only. An entry in the shape
    before p37-7 takes this pass's kind, already notified for it when it was notified."""
    e = stuck.get(key)
    if e is None:
        e = stuck[key] = {"since": stamp, "kind": kind, "kindSince": stamp, "outcome": outcome, "notifiedKinds": []}
    else:
        if not isinstance(e.get("kind"), str):
            e["kind"], e["kindSince"] = kind, stamp
            e["notifiedKinds"] = [kind] if e.get("notified") else []
        elif e["kind"] != kind:
            e["kind"], e["kindSince"] = kind, stamp
        if not isinstance(e.get("notifiedKinds"), list):
            e["notifiedKinds"] = [e["kind"]] if e.get("notified") else []
        e["outcome"] = outcome
    e.update(extra)
    return e


def _due(e, now):
    """The notice rules: a first notice at 24 h from since (timed-out at once); then one per kind not yet notified,
    once it has stood an hour (timed-out at once); never twice for a kind."""
    kinds, kind = e.get("notifiedKinds") or [], e.get("kind")
    if not kinds:
        since = _parse_iso(e.get("since"))
        return kind == "timed-out" or (since is not None and now - since >= NOTIFY_AFTER)
    if kind in kinds:
        return False
    ks = _parse_iso(e.get("kindSince"))
    return kind == "timed-out" or (ks is not None and now - ks >= RENOTIFY_SETTLE)


def _notice(name, e, d=None):
    """One line, outcome first, cut to 200, then the longest tail that still fits."""
    head = f"{name}: {_flat(e.get('outcome') or '')}"[:200].rstrip()
    since = str(e.get("since") or "")
    tails = ([f" (stuck since {since[:16]}; git -C {d} status)", f" (since {since[5:16]})"] if d is not None
             else [f" (since {since[:16]})"])
    for t in tails + [""]:
        if len(head) + len(t) <= 200:
            return head + t
    return head


def _notify(primary, message, server):
    """(rc, reason): ntfy-push.py's exit and its last line; the bundle's copy first, then the primary's."""
    script = _helper(NTFY_REL, primary)
    if script is None:
        return 127, f"no {NTFY_REL} beside the copy or in {primary}"
    argv = [sys.executable, "-B", str(script)] + (["--server", server] if server else [])
    rc, out, err, timed_out = _run(argv, NTFY_TIMEOUT, input=message + "\n")
    if timed_out:
        return 124, f"ntfy-push ran past {NTFY_TIMEOUT} s and was stopped"
    return rc, _last_line(err) or _last_line(out)


def _parse_now(s):
    if not s:
        return datetime.now().astimezone()
    return _parse_iso(s)


def _rotate(log):
    """A log over LOG_MAX moves to <log>.1; a pass whose stdout or stderr is that file carries on in a fresh one."""
    p = Path(os.path.expanduser(log))
    try:
        st = p.stat()
    except OSError:
        return
    if st.st_size <= LOG_MAX:
        return
    same = []
    for fd in (1, 2):
        try:
            s = os.fstat(fd)
        except OSError:
            continue
        if (s.st_dev, s.st_ino) == (st.st_dev, st.st_ino):
            same.append(fd)
    try:
        os.replace(p, f"{p}.1")
    except OSError as e:
        print(f"WARN: primary-refresh: cannot rotate {p}: {e}", file=sys.stderr)
        return
    if same:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
            fd = os.open(p, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            for t in same:
                os.dup2(fd, t)
            os.close(fd)
        except OSError:
            pass


# ---- the self-update ------------------------------------------------------------------------------------------------

def _parse_table(text):
    """A candidate's `bundle` lines as rows, checked strictly; ValueError says why not."""
    lines = text.splitlines()
    if not lines:
        raise ValueError("no rows")
    if len(lines) > TABLE_MAX:
        raise ValueError(f"{len(lines)} rows, more than {TABLE_MAX}")
    rows, seen = [], set()
    for line in lines:
        m = ROW_RE.match(line)
        if not m:
            raise ValueError(f'line "{line[:60]}"')
        mode, rel, irel = m.groups()
        if any(part in (".", "..") for part in rel.split("/") + irel.split("/")):
            raise ValueError(f'"{line[:60]}" has a . or .. component')
        if irel.startswith(".") or irel == MARKER:
            raise ValueError(f'"{line[:60]}" installs to {irel}')
        if irel in seen:
            raise ValueError(f"{irel} twice")
        seen.add(irel)
        rows.append((mode, rel, irel))
    if not any(irel == COPY and rel == SELF_REL for _, rel, irel in rows):
        raise ValueError(f"no {SELF_REL} {COPY} row")
    return rows


def _differs(src, dst, mode):
    """Whether dst is not src's bytes with mode (a missing or irregular dst differs)."""
    try:
        if dst.is_symlink() or not dst.is_file():
            return True
        if stat.S_IMODE(dst.stat().st_mode) != int(mode, 8):
            return True
        data = src if isinstance(src, bytes) else src.read_bytes()
        return dst.read_bytes() != data
    except OSError:
        return True


def _smoke_argv(argv, stage, stamp):
    """The job's own argv for the candidate: --state, --log and --now replaced in place (`--flag V` or `--flag=V`) where
    present, --state added where absent, --dry-run added; every other token as it was."""
    repl = {"--state": str(stage / "smoke-state.json"), "--log": str(stage / "smoke.log"), "--now": stamp}
    out, seen, i = [], set(), 0
    while i < len(argv):
        t = argv[i]
        k = t.split("=", 1)[0]
        if t in repl:
            out += [t, repl[t]]
            seen.add(t)
            i += 2
            continue
        if k in repl and "=" in t:
            out.append(f"{k}={repl[k]}")
            seen.add(k)
        else:
            out.append(t)
        i += 1
    if "--state" not in seen:
        out += ["--state", repl["--state"]]
    return out + ["--dry-run"]


def _smoke(stage, primary, stamp, smoke_timeout):
    """None when the staged candidate passes its smoke run, else why not (one line, at most 80 characters)."""
    argv = _smoke_argv(_ARGV, stage, stamp)
    rc, out, err, timed_out = _run([sys.executable, "-B", str(stage / COPY), *argv], smoke_timeout, grace=SMOKE_GRACE)
    if timed_out:
        why = f"ran past {smoke_timeout} s and was stopped"
    elif rc != 0:
        why = f"exit {rc}: {_last_line(err) or _last_line(out) or 'no output'}"
    elif "Traceback" in err:
        why = f"a traceback: {_last_line(err)}"
    else:
        pre = f" primary-refresh {primary}: "
        said = [ln.split(pre, 1)[1] for ln in out.splitlines() if pre in ln]
        outcomes = [s for s in said if not s.startswith(("self-update:", "job:", "would notify:", "notified",
                                                         "not notified"))]
        if not outcomes:
            why = f"no primary-refresh line for {primary}"
        elif outcomes[0].startswith(SMOKE_DENIED):
            why = outcomes[0]
        elif "self-update: current" not in said:
            why = "no self-update: current line"
        else:
            return None
    return _flat(why)[:80]


def _install(stage, table, me, branch, t12):
    """The helpers that differ, then the files this copy's table has and the candidate's drops, then the copy."""
    cdir = me.parent
    irels = {irel for _, _, irel in table}
    steps = [("install", mode, irel) for mode, _, irel in table
             if irel != COPY and _differs(stage / irel, cdir / irel, mode)]
    steps += [("remove", None, irel) for _, _, irel in BUNDLE if irel not in irels and os.path.lexists(cdir / irel)]
    copy_mode = next(mode for mode, _, irel in table if irel == COPY)
    if _differs(stage / COPY, me, copy_mode):
        steps.append(("install", copy_mode, COPY))
    done = {"install": [], "remove": []}
    for k, (op, _, irel) in enumerate(steps):
        dst = cdir / irel
        try:
            if op == "install":
                os.makedirs(dst.parent, exist_ok=True)
                os.replace(stage / irel, dst)
            else:
                try:
                    os.unlink(dst)
                except FileNotFoundError:
                    pass
        except OSError as e:
            return (f"self-update: installed {k} of {len(steps)} files, then {irel} failed ({e}): the next fetched pass "
                    "finishes it"), "install-failed"
        done[op].append(irel)
    parts = [f"installed {', '.join(done['install'])}"] if done["install"] else []
    if done["remove"]:
        parts.append(f"removed {', '.join(done['remove'])}")
    return f"self-update: the installed bundle now matches origin/{branch} at {t12} ({'; '.join(parts)})", None


def self_update(primary, branch, tip, args, stuck, now, stamp):
    """The installed copy's self-update at `tip` (the module docstring's steps): (line or None, kind). kind None clears
    the self-update spell, `keep` leaves it as it is, any other opens or continues it."""
    me = Path(__file__).resolve()
    t12 = tip[:12]
    rc, src, _ = git(primary, "cat-file", "blob", f"{tip}:{SELF_REL}", raw=True)
    if rc != 0 or not src:
        return f"self-update: origin's tip {t12} lacks {SELF_REL}: the installed bundle is kept", "refused"
    same = src == me.read_bytes()
    if same:
        diff = []
        for mode, rel, irel in BUNDLE:
            if irel == COPY:
                continue
            rc, data, _ = git(primary, "cat-file", "blob", f"{tip}:{rel}", raw=True)
            if rc != 0 or _differs(data, me.parent / irel, mode):
                diff.append(irel)
        if not diff:
            return ("self-update: current" if args.dry_run else None), None
    if args.dry_run:
        if same:
            return f"self-update: would install {', '.join(diff)}", "keep"
        return f"self-update: would install origin's bundle at {t12} (its primary-refresh.py differs)", "keep"
    e = stuck.get("self-update") or {}
    smoke = True
    if e.get("tip") == tip and e.get("kind") == "refused":
        at = _parse_iso(e.get("tipAt"))
        if at is not None and now - at < SMOKE_RETRY:
            return None, "keep"
    elif e.get("tip") == tip and e.get("kind") == "install-failed":
        smoke = False  # this tip passed its smoke: restage and install
    for old in me.parent.glob(".stage-*"):
        if old.is_dir() and not old.is_symlink():
            shutil.rmtree(old, ignore_errors=True)
        else:
            try:
                old.unlink()
            except OSError:
                pass
    stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=str(me.parent)))
    try:
        return _stage_and_install(primary, branch, tip, src, same, stage, me, smoke, stamp, args.smoke_timeout)
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def _stage_and_install(primary, branch, tip, src, same, stage, me, smoke, stamp, smoke_timeout):
    t12 = tip[:12]

    def refused(why):
        return f"self-update: {why}: the installed copy is kept", "refused"

    cand = stage / COPY
    cand.write_bytes(src)
    os.chmod(cand, 0o755)
    if same:
        table = list(BUNDLE)
    else:
        try:
            compile(src, SELF_REL, "exec")
        except (SyntaxError, ValueError) as e:
            return refused(f"origin's {SELF_REL} at {t12} does not compile ({_flat(e)})")
        rc, out, err, timed_out = _run([sys.executable, "-B", str(cand), "bundle"], BUNDLE_TIMEOUT)
        try:
            if timed_out:
                raise ValueError(f"ran past {BUNDLE_TIMEOUT} s and was stopped")
            if rc != 0:
                raise ValueError(f"exit {rc}: {_last_line(err, 80) or 'no stderr'}")
            table = _parse_table(out)
        except ValueError as e:
            return refused(f"the candidate's bundle table is unreadable ({_flat(e)[:120]})")
    for mode, rel, irel in table:
        if irel == COPY:
            os.chmod(cand, int(mode, 8))
            continue
        rc, data, _ = git(primary, "cat-file", "blob", f"{tip}:{rel}", raw=True)
        if rc != 0:
            return refused(f"origin's tip {t12} lacks {rel}")
        dst = stage / irel
        os.makedirs(dst.parent, exist_ok=True)
        dst.write_bytes(data)
        os.chmod(dst, int(mode, 8))
    (stage / MARKER).write_text(f"the self-update's stage for origin's {t12}\n")
    for _, rel, irel in table:
        f = stage / irel
        if irel.endswith(".py"):
            try:
                compile(f.read_bytes(), rel, "exec")
            except (SyntaxError, ValueError) as e:
                return refused(f"origin's {rel} at {t12} does not compile ({_flat(e)})")
        elif irel.endswith(".sh"):
            rc, _, err, timed_out = _run(["bash", "-n", str(f)], GIT_TIMEOUT)
            if rc != 0 or timed_out:
                return refused(f"origin's {rel} at {t12} fails bash -n ({_last_line(err, 80) or f'exit {rc}'})")
    if smoke:
        why = _smoke(stage, primary, stamp, smoke_timeout)
        if why:
            return refused(f"origin's bundle at {t12} failed its smoke run ({why})")
    return _install(stage, table, me, branch, t12)


def job_check(args, stuck, stamp, primary):
    """The job's shape against this copy's (the module docstring's job check)."""
    if args.job_shape >= JOB_SHAPE:
        if "job" in stuck and not args.dry_run:
            stuck.pop("job")
            _line(primary, "job: current")
        return
    text = (f"the launchd job predates this copy (job shape {args.job_shape}, wants {JOB_SHAPE}): re-run "
            "primary-refresh.py install and the launchctl line it prints")
    if args.dry_run:
        _line(primary, f"job: {text}")
        return
    opening = "job" not in stuck
    _spell(stuck, "job", "stale-job", text, stamp)
    if opening:
        _line(primary, f"job: {text}")


# ---- the verbs ------------------------------------------------------------------------------------------------------

def cmd_run(args):
    global _STAMP
    now = _parse_now(args.now)
    if now is None:
        print(f"ERROR: primary-refresh run: usage: --now {args.now!r} is not an ISO timestamp", file=sys.stderr)
        return 2
    for s in SIGNALS:
        signal.signal(s, _on_signal)
    _STAMP = stamp = now.isoformat(timespec="seconds")
    if args.log and not args.dry_run:
        _rotate(args.log)
    primary = _real(args.primary or PLUGIN_ROOT)
    targets = [(primary, True)]
    for a in args.also:
        if _real(a) not in [d for d, _ in targets]:
            targets.append((_real(a), False))
    state_path = _state_path(args.state)
    stuck, dirty = _read_state(state_path, stamp)
    before = json.dumps(stuck, sort_keys=True)
    touched = []
    tip, branch = None, None
    for d, is_primary in targets:
        outcome, kind, t, b = refresh(d, primary, is_primary, args.dry_run, args.ff_timeout)
        _line(d, outcome)
        if is_primary:
            tip, branch = t, b
        if kind is None:
            stuck.pop(str(d), None)
        elif kind != "dry":
            _spell(stuck, str(d), kind, outcome, stamp)
            touched.append(d)
    if INSTALLED and tip is not None:
        try:
            line, kind = self_update(primary, branch, tip, args, stuck, now, stamp)
        except Exception as e:  # noqa: BLE001 — the self-update never skips the notices or the state
            line, kind = f"self-update: failed ({type(e).__name__}: {_flat(e)[:160]})", "failed"
        if line:
            _line(primary, line)
        if kind is None:
            stuck.pop("self-update", None)
        elif kind != "keep" and not args.dry_run:
            _spell(stuck, "self-update", kind, line[len("self-update: "):], stamp, tip=tip, tipAt=stamp)
    if INSTALLED:
        job_check(args, stuck, stamp, primary)
    spells = [(str(d), d.name, d, d) for d in touched]
    if INSTALLED:
        spells += [("self-update", "primary-refresh self-update", None, f"{primary}: self-update"),
                   ("job", "primary-refresh job", None, f"{primary}: job")]
    for key, name, d, label in spells:
        e = stuck.get(key)
        if not isinstance(e, dict) or not isinstance(e.get("kind"), str) or not _due(e, now):
            continue
        failed = _parse_iso(e.get("notifyFailed"))
        if failed is not None and now - failed < NOTIFY_RETRY:
            continue
        message = _notice(name, e, d)
        if args.dry_run:
            _line(label, f"would notify: {message}")
            continue
        if key == "job":
            _line(primary, f"job: {e.get('outcome')}")
        rc, why = _notify(primary, message, args.ntfy_server)
        if rc == 0:
            kinds = e.setdefault("notifiedKinds", [])  # an untouched copy spell may have lost a malformed list
            if e["kind"] not in kinds:
                kinds.append(e["kind"])
            e["notified"] = stamp
            e.pop("notifyFailed", None)
            e.pop("notifyWhy", None)
            _line(label, "notified")
        else:
            e["notifyFailed"], e["notifyWhy"] = stamp, why
            _line(label, f"not notified (ntfy-push exit {rc}: {why})")
    if not args.dry_run and (dirty or json.dumps(stuck, sort_keys=True) != before):
        try:
            _atomic_write(state_path, json.dumps({"v": STATE_VERSION, "stuck": stuck}, indent=2, sort_keys=True)
                          + "\n")
        except OSError as e:
            print(f"WARN: primary-refresh: cannot write state {state_path}: {e}", file=sys.stderr)
    return 0


def cmd_bundle(_args):
    for row in BUNDLE:
        print(" ".join(row))
    return 0


def cmd_install(args):
    if sys.version_info < (3, 11):
        have = ".".join(str(x) for x in tuple(sys.version_info)[:3])
        print(f"ERROR: primary-refresh install: python {have} is older than 3.11 (ntfy-push.py needs tomllib): run "
              "install with python 3.11 or newer", file=sys.stderr)
        return 2
    primary = _real(args.primary or PLUGIN_ROOT)
    why = checkout_problem(primary)
    if why:
        print(f"ERROR: primary-refresh install: {primary} is {why}: pass --primary <the primary checkout>",
              file=sys.stderr)
        return 2
    bin_dir = _real(args.bin_dir)
    files = [(mode, (HERE / irel) if INSTALLED else (PLUGIN_ROOT / rel), bin_dir / irel) for mode, rel, irel in BUNDLE]
    missing = [str(src) for _, src, _ in files if not src.is_file()]
    if missing:
        print(f"ERROR: primary-refresh install: missing {', '.join(missing)}: run install from a checkout that holds "
              "the whole bundle", file=sys.stderr)
        return 2
    for mode, src, dst in files:
        _atomic_write(dst, src.read_bytes(), mode=int(mode, 8))
    _atomic_write(bin_dir / MARKER, f"installed by primary-refresh.py install for {primary}\n")
    found = shutil.which("python3")
    python = found if found and os.path.realpath(found) == os.path.realpath(sys.executable) else sys.executable
    log = os.path.expanduser(args.log)
    argv = [python, str(bin_dir / COPY), "run", "--primary", str(primary)]
    for a in args.also:
        argv += ["--also", str(_real(a))]
    argv += ["--log", log, "--job-shape", str(JOB_SHAPE)]
    path = []
    for p in (os.path.dirname(shutil.which("git") or ""), os.path.dirname(python), "/usr/bin", "/bin", "/usr/sbin",
              "/sbin"):
        if p and p not in path:
            path.append(p)
    job = {
        "Label": args.label,
        "ProgramArguments": argv,
        "EnvironmentVariables": {"PATH": ":".join(path)},
        "StartInterval": args.interval,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "StandardOutPath": log,
        "StandardErrorPath": log,
    }
    plist = Path(os.path.expanduser(args.plist or f"~/Library/LaunchAgents/{args.label}.plist"))
    _atomic_write(plist, plistlib.dumps(job))
    uid = os.getuid()
    print(f"primary-refresh install: wrote the bundle to {bin_dir} and the job to {plist}")
    print(f"the job runs {python}")
    print(f"next: launchctl bootout gui/{uid}/{args.label} 2>/dev/null; while launchctl print gui/{uid}/{args.label}"
          f" >/dev/null 2>&1; do sleep 1; done; launchctl bootstrap gui/{uid} {shlex.quote(str(plist))}")
    return 0


def _positive(value):
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError(f"must be a positive integer, got {value}")
    return n


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)
    _ARGV[:] = argv
    p = argparse.ArgumentParser(prog="primary-refresh.py", allow_abbrev=False, description="The Primary refresh (ADR "
                                "0066): keep the live-loaded checkouts current with origin.")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", allow_abbrev=False, help="one pass over the primary and each --also checkout")
    r.add_argument("--primary", default=None, help="the primary checkout (default: this script's plugin root)")
    r.add_argument("--also", action="append", default=[], help="another live-loaded checkout (no rollout hold)")
    r.add_argument("--state", default=None, help="the state file (default ${XDG_STATE_HOME:-~/.local/state}/thread/"
                                                 "primary-refresh.json)")
    r.add_argument("--log", default=None, help="the job's log, rotated at 1 MiB before the pass")
    r.add_argument("--ntfy-server", default=None, help="ntfy-push.py's --server")
    r.add_argument("--now", default=None, help="the time to read against, ISO (default: now)")
    r.add_argument("--dry-run", action="store_true", help="move nothing, notify nothing, write no state")
    r.add_argument("--job-shape", type=int, default=0, help="the shape install wrote into the job (absent: 0)")
    r.add_argument("--ff-timeout", type=_positive, default=FF_TIMEOUT, help="the fast-forward's bound, seconds")
    r.add_argument("--smoke-timeout", type=_positive, default=SMOKE_TIMEOUT, help="the smoke run's bound, seconds")
    r.set_defaults(func=cmd_run)
    i = sub.add_parser("install", allow_abbrev=False, help="install the bundle and the launchd job")
    i.add_argument("--primary", default=None)
    i.add_argument("--also", action="append", default=[])
    i.add_argument("--bin-dir", default=DEFAULT_BIN)
    i.add_argument("--plist", default=None)
    i.add_argument("--interval", type=int, default=DEFAULT_INTERVAL)
    i.add_argument("--label", default=DEFAULT_LABEL)
    i.add_argument("--log", default=DEFAULT_LOG)
    i.set_defaults(func=cmd_install)
    b = sub.add_parser("bundle", allow_abbrev=False, help="print the bundle table: <mode> <repo-rel> <install-rel>")
    b.set_defaults(func=cmd_bundle)
    args = p.parse_args(argv)
    try:
        return args.func(args)
    except _Signalled as e:
        for s in SIGNALS:
            signal.signal(s, signal.SIG_DFL)
        print(f"{_STAMP} primary-refresh: stopped by signal {e.signum}: the state is left as it was", file=sys.stderr,
              flush=True)
        return 128 + e.signum


if __name__ == "__main__":
    sys.exit(main())
