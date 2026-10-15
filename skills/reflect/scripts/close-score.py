#!/usr/bin/env python3
"""close-score.py — the script half of a Reflection, run at a rollout's close (p21-6, ADR 0037 d4).

python >= 3.8, stdlib only. Fold, settings, origin slug, score and a record-only tune, run on their own: no model
reading, no picks, no prompt (stdin is never read). Called as one command, through the Bash tool with
`timeout: 600000`:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/close-score.py --rollout <rollout note path> \\
        --close completion|supersede [--repo <Project root>] [--tasks-dir <dir>] [--timeout S] [--deadline S]

Callers, each with the Bash tool's `timeout: 600000`:
- `--close completion`: execute § 4.5 step 5's completion ceremony (attended, or the unattended Stop driver: one
  text), and the rollout template's manual ceremony (step 4), before the note moves;
- `--close supersede`: schedule step 7.5, before it stamps the prior note; schedule § 0's `file` finish (a run
  that died after the stamps) and its `interrupted` item 3; repair § 1's close-out of an interrupted supersede.
The sign-off form (execute step 5, ADR 0034) never runs it: a rollout gets one close line, written by the later
full ceremony or by the supersede that carries the waiting tasks.

One close line per rollout. Before anything else, before the note is read: the events directory is resolved
(unresolvable: not scored) and tunings.jsonl is read through tune.py's close_line(); a non-voided `tuning` line for
this rollout with a `close` answers `already recorded <id> (<close>)`, exit 0, with no scratch dir and no step run
(an interrupted ceremony's re-run, whatever rollouts.toml or the Project root say now). A tunings.jsonl that exists
but cannot be read is `not scored`. tune.py's own --close guard is the write's backstop. A by-hand `/thread:reflect`
line carries no `close`: it neither blocks the close line nor is blocked by it.

--rollout is the rollout note's path (it must end .md; `~` expands); its stem is the slug (run_record's rule, the
reserved names refused). The Project root is --repo, else the note's ``Project root: `<path>` `` line
(reconcile-rollout.py's PROJECT_ROOT_RE, `~` expanded). Then, each step from a fresh scratch dir
(`$TMPDIR/thread-close-score-*`, never /tmp/thread-reflect-<slug>, so a by-hand Reflection never collides; removed on
every exit and on a signal):
1. `reconcile-rollout.py fold-journals --rollout <note>` (idempotent). A non-zero exit is one stderr line,
   `close-score: WARN: fold-journals exited <rc>: <its first stderr line>`, and the run goes on (reflect step 2's
   rule); its own `WARN:` lines go to stderr as `close-score: WARN: fold-journals: <line>`. A fold that times out is
   `not scored`: recording then would freeze a partial token count as the rollout's one close line.
2. `rollout-settings.py --repo <root>` into the scratch dir's settings.json. A non-zero exit (2 refused, 3 no
   tomllib) is `not scored`.
3. `land.sh --origin-slug <root>`: exit 0 is the `--repo-slug`; exit 4 (no GitHub origin) scores with none, so tune
   records nothing; any other exit is `not scored`.
4. `score.py --rollout <slug> --note <note> --settings <f> [--repo-slug s] --repo <root> [--tasks-dir d] --out <f>`.
   A non-zero exit, or a score.json that cannot be read, is `not scored`. Then the nothing-ran rule: with
   window.activeStart null and merges.count 0 (no Slot, no lane-only stretch, no merge in the window: a never-started
   supersede, or an `incomplete` prior holding only `carried` lines), it prints `not recorded: nothing ran (no
   record)` when score.py flagged `no record`, else `not recorded: nothing ran (no Slot, lane or merge in the
   record)`, and exits 0 with no tune call.
5. `tune.py --scores <f> --record-only --close <kind>`, the only writer of tunings.jsonl. `recorded <id>` is the
   line; `already recorded <id> (<k>)` is its guard; `tune: not recorded: <r>` (a null repo) is `not recorded: <r>`;
   a non-zero exit is `not scored`.

Time. Each step runs in its own process group (start_new_session; SIGTERM, SIGINT and SIGHUP held across the
start), stdin closed, from the scratch dir, with git's repo-local variables (GIT_DIR & co., as `git rev-parse
--local-env-vars` names them) dropped from the env, as declared-check.py does: an inherited GIT_DIR reaches no step.
Python steps run as `sys.executable <script>`; land.sh as `bash <land.sh>`, `bash` found on that env's PATH. Each
step has a cap (CAPS; --timeout S sets every one to S), clipped to the time left of an overall DEADLINE measured
from the start (--deadline S overrides it, for tests and by hand; callers under the Bash tool keep the default).
With under a second left before a step: `not scored: overall deadline <D>s reached before <step>`. On expiry the
whole group is killed (SIGTERM, KILL_GRACE, SIGKILL; land.sh's git and score.py's `git blame` go with it), the pipes
closed and the child reaped for at most REAP_WAIT: `not scored: <step> timed out after <S>s`, with ` (overall
deadline <D>s)` when the deadline clipped the cap. So the worst case is DEADLINE + KILL_GRACE + REAP_WAIT, about
547 s, under the Bash tool's 600 s foreground ceiling: the caller always gets the one line, and neither the ceremony
nor the Stop driver stalls on it. Signalled itself (SIGTERM, SIGINT, SIGHUP), it kills the live step's group,
removes the scratch dir and exits 128 + the signal number, stdout empty.

Output: stdout is exactly one line (none on a signal), `close-score: <slug>: ` and then one of
    recorded <id> (<kind>)
    already recorded <id> (<kind>)
    not recorded: <reason>                 (no GitHub origin, or nothing ran)
    not scored: <why>                      (a step failed or timed out, the deadline, an unusable input)
stderr carries only `close-score: WARN: ...` lines (a usage error: one `close-score: ` line instead).

Exit codes: 0 recorded, already recorded or not recorded; 1 not scored (tune writes nothing); 2 usage (a missing or
bad flag, a --rollout that is no .md path, a reserved or bad slug, a non-positive --timeout or --deadline), stdout
empty.

Writes, both under the events directory, outside the vault and the repo: fold-journals' `call-journal` lines in the
rollout's Run record, and tune.py's one tunings.jsonl line. Reads: the rollout note; the Run record, reviews.jsonl and
tunings.jsonl; ~/.config/thread/rollouts.toml through rollout-settings.py; every note under Work/Tasks/ (Archive
included) for `fixes:` and `merged_into:` (score.py's escapes.py); the Project root's git, read-only and never
fetched: land.sh's `git remote get-url origin`, escapes.py's rev-parse, symbolic-ref, show, log, rev-list,
merge-base, cat-file, diff-tree and blame, and `git remote get-url origin` in each clone reviews.jsonl names
(score.py, through rollout-settings.py's _origin_slug).

Not covered (ADR 0037 d4). The weekly Reflection reads each such rollout's record in the week it ran and names a
closed one with no close line (skills/reflect/SKILL.md § The weekly reading), but writes no tunings.jsonl line for it:
- A dropped rollout: no writer sets a rollout `status: dropped` and schedule never archives one, so there is no close
  path to run this from.
- reconcile-project.py's MISFILED SUPERSEDED ROLLOUT move (orient § 4's `--apply`) archives a note it never scores.
  Every `superseded_by:` stamp now follows a run of this script at its stamping site (schedule 7.5, § 0's `file`,
  repair § 1), so the note it moves was already scored or its failure logged; a note stamped under the older wording
  is archived unscored.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
RUN_RECORD_PY = os.path.join(SKILLS, "_shared", "scripts", "run_record.py")
RECONCILE_PY = os.path.join(SKILLS, "execute", "scripts", "reconcile-rollout.py")
SETTINGS_PY = os.path.join(SKILLS, "_shared", "scripts", "rollout-settings.py")
LAND_SH = os.path.join(SKILLS, "_shared", "scripts", "land.sh")
SCORE_PY = os.path.join(HERE, "score.py")
TUNE_PY = os.path.join(HERE, "tune.py")

# DEADLINE + KILL_GRACE + REAP_WAIT must stay under the Bash tool's 600 s foreground ceiling, with a margin, so the
# caller's `timeout: 600000` never cuts the one stdout line (tests/reflect-close-score.test.mjs pins the sum).
DEADLINE = 540          # the overall budget in seconds, measured from the start
KILL_GRACE = 2.0        # SIGTERM to SIGKILL for a timed-out step's group (declared-check.py's value)
REAP_WAIT = 5           # how long a killed step is waited for once its pipes are closed
GIT_ENV_CAP = 30        # `git rev-parse --local-env-vars`
# Each step's cap in seconds, clipped to the time left of DEADLINE. score.py's is the largest (escapes.py's blame).
CAPS = {
    "fold-journals": 120,
    "rollout-settings.py": 60,
    "land.sh --origin-slug": 30,
    "score.py": 420,
    "tune.py": 60,
}
SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
TAIL_MAX = 240
SCRATCH_PREFIX = "thread-close-score-"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


try:  # one copy of each rule: the slug and the events dir, the close line, the Project root line
    RR = _load("thread_run_record", RUN_RECORD_PY)
    TUNE = _load("thread_tune", TUNE_PY)
    PROJECT_ROOT_RE = _load("thread_reconcile_rollout", RECONCILE_PY).PROJECT_ROOT_RE
except Exception as e:  # a broken install: report it as this script, never as a traceback
    sys.stdout.write("close-score: not scored: cannot load its helpers: %s\n" % e)
    sys.exit(1)


class Usage(Exception):
    pass


class Outcome(Exception):
    """The run's one line (after `close-score: <slug>: `) and its exit code."""

    def __init__(self, text, code):
        Exception.__init__(self, text)
        self.text, self.code = text, code


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Usage(message)


# ---- the step runner (declared-check.py's run_check) --------------------------------------------------------

_live = {"proc": None, "scratch": None}


def kill_group(proc):
    """SIGTERM the process group, wait up to KILL_GRACE for it to empty, then SIGKILL it."""
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


def remove_scratch():
    d, _live["scratch"] = _live["scratch"], None
    if d:
        shutil.rmtree(d, ignore_errors=True)


def on_signal(signum, _frame):
    for s in SIGNALS:
        signal.signal(s, signal.SIG_IGN)
    if _live["proc"] is not None:
        kill_group(_live["proc"])
    remove_scratch()
    os._exit(128 + signum)


class Ran:
    def __init__(self, rc=None, out="", err="", timed_out=False, start_error=None):
        self.rc, self.out, self.err = rc, out, err
        self.timed_out, self.start_error = timed_out, start_error


def run_step(argv, cwd, env, cap):
    # The new group lives in its own session, so a signal that lands before `_live` holds it would leave it running
    # with no limit: hold SIGNALS until it does. The step itself starts with the caller's mask, not the held one.
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, start_new_session=True,
                                preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, mask))
        _live["proc"] = proc
    except OSError as e:
        return Ran(start_error=e.strerror or str(e))
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)
    try:
        out, err = proc.communicate(timeout=cap)
    except subprocess.TimeoutExpired:
        # Kill the whole group before draining: a grandchild holding a pipe would hang communicate().
        kill_group(proc)
        for f in (proc.stdout, proc.stderr):
            try:
                f.close()
            except OSError:
                pass
        try:
            proc.wait(timeout=REAP_WAIT)
        except subprocess.TimeoutExpired:
            pass
        return Ran(timed_out=True)
    finally:
        if proc.poll() is not None:
            _live["proc"] = None
    return Ran(rc=proc.returncode, out=out.decode("utf-8", "replace"), err=err.decode("utf-8", "replace"))


def first_line(text):
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()[:TAIL_MAX]
    return "no output"


def git_env(cap):
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as declared-check.py's git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=cap).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def warn(line):
    sys.stderr.write("close-score: WARN: %s\n" % line)
    sys.stderr.flush()


# ---- the close ----------------------------------------------------------------------------------------------

class Close:
    def __init__(self, args, slug, started):
        self.a, self.slug = args, slug
        self.deadline = args.deadline or DEADLINE
        self.deadline_at = started + self.deadline
        self.env, self.scratch = None, None

    def left(self):
        return self.deadline_at - time.monotonic()

    def step(self, name, argv):
        left = self.left()
        if left < 1:
            raise Outcome("not scored: overall deadline %ds reached before %s" % (self.deadline, name), 1)
        full = self.a.timeout or CAPS[name]
        cap = min(full, int(left))
        ran = run_step(argv, self.scratch, self.env, cap)
        if ran.timed_out:
            clipped = " (overall deadline %ds)" % self.deadline if cap < full else ""
            raise Outcome("not scored: %s timed out after %ds%s" % (name, cap, clipped), 1)
        if ran.start_error is not None:
            raise Outcome("not scored: %s cannot start (%s)" % (name, ran.start_error), 1)
        return ran

    def already(self):
        """(0a): the close line, if this rollout has one, before anything else is read or run."""
        try:
            RR.events_dir()
        except ValueError as e:
            raise Outcome("not scored: cannot resolve the events directory: %s" % e, 1)
        try:
            hit = TUNE.close_line(self.slug)
        except OSError as e:
            raise Outcome("not scored: tunings.jsonl cannot be read: %s" % e, 1)
        if hit is not None:
            raise Outcome("already recorded %s (%s)" % (hit.get("id"), hit.get("close")), 0)

    def inputs(self):
        """(0b): the note's absolute path and the Project root."""
        note = os.path.abspath(os.path.expanduser(self.a.rollout))
        if not os.path.isfile(note):
            raise Outcome("not scored: no rollout note at %s" % note, 1)
        root = self.a.repo
        if root is None:
            try:
                with open(note, encoding="utf-8") as f:
                    text = f.read()
            except (OSError, ValueError) as e:
                raise Outcome("not scored: cannot read the rollout note %s: %s" % (note, e), 1)
            m = re.match(r"^---\n.*?\n---\n(.*)$", text, re.DOTALL)  # reconcile-rollout.py's Note body
            found = PROJECT_ROOT_RE.search(m.group(1) if m else text)
            if not found:
                raise Outcome("not scored: no Project root line in %s" % note, 1)
            root = found.group(1).strip()
        root = os.path.abspath(os.path.expanduser(root))
        if not os.path.isdir(root):
            raise Outcome("not scored: Project root %s is not a directory" % root, 1)
        return note, root

    def make_scratch(self):
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
        try:
            self.scratch = _live["scratch"] = tempfile.mkdtemp(prefix=SCRATCH_PREFIX)
        except OSError as e:
            raise Outcome("not scored: cannot make a scratch dir: %s" % e, 1)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)

    def run(self):
        self.already()
        note, root = self.inputs()
        self.env = git_env(max(1, min(GIT_ENV_CAP, int(self.left()))))
        self.make_scratch()

        # (1) fold the journals: a failure is a WARN and the score goes on; a timeout is not scored
        ran = self.step("fold-journals", [sys.executable, RECONCILE_PY, "fold-journals", "--rollout", note])
        for line in ran.err.splitlines():
            if line.startswith("WARN: "):
                warn("fold-journals: %s" % line[len("WARN: "):].strip()[:TAIL_MAX])
        if ran.rc != 0:
            warn("fold-journals exited %d: %s" % (ran.rc, first_line(ran.err)))

        # (2) the settings
        ran = self.step("rollout-settings.py", [sys.executable, SETTINGS_PY, "--repo", root])
        if ran.rc != 0:
            raise Outcome("not scored: rollout-settings.py exited %d: %s" % (ran.rc, first_line(ran.err)), 1)
        settings = os.path.join(self.scratch, "settings.json")
        try:
            with open(settings, "w", encoding="utf-8") as f:
                f.write(ran.out)
        except OSError as e:
            raise Outcome("not scored: cannot write the settings to the scratch dir: %s" % e, 1)

        # (3) the repo identity
        ran = self.step("land.sh --origin-slug", ["bash", LAND_SH, "--origin-slug", root])
        if ran.rc == 0 and ran.out.strip():
            repo_slug = ran.out.strip().splitlines()[0].strip()
        elif ran.rc == 4:
            repo_slug = None
        else:
            raise Outcome("not scored: land.sh --origin-slug exited %d: %s"
                          % (ran.rc, first_line(ran.err) if ran.err.strip() else first_line(ran.out)), 1)

        # (4) the score
        out = os.path.join(self.scratch, "score.json")
        argv = [sys.executable, SCORE_PY, "--rollout", self.slug, "--note", note, "--settings", settings]
        if repo_slug:
            argv += ["--repo-slug", repo_slug]
        argv += ["--repo", root]
        if self.a.tasks_dir:
            argv += ["--tasks-dir", os.path.abspath(os.path.expanduser(self.a.tasks_dir))]
        argv += ["--out", out]
        ran = self.step("score.py", argv)
        if ran.rc != 0:
            raise Outcome("not scored: score.py exited %d: %s" % (ran.rc, first_line(ran.err)), 1)
        try:
            with open(out, encoding="utf-8") as f:
                doc = json.load(f)
            if not isinstance(doc, dict):
                raise ValueError("not an object")
        except (OSError, ValueError):
            raise Outcome("not scored: score.py wrote no readable score", 1)
        window = doc.get("window") if isinstance(doc.get("window"), dict) else {}
        merges = doc.get("merges") if isinstance(doc.get("merges"), dict) else {}
        if window.get("activeStart") is None and not merges.get("count"):
            why = "no record" if "no record" in (doc.get("flags") or []) else "no Slot, lane or merge in the record"
            raise Outcome("not recorded: nothing ran (%s)" % why, 0)

        # (5) the one line, through tune.py
        ran = self.step("tune.py", [sys.executable, TUNE_PY, "--scores", out, "--record-only", "--close", self.a.close])
        if ran.rc != 0:
            raise Outcome("not scored: tune.py exited %d: %s" % (ran.rc, first_line(ran.err)), 1)
        m = re.match(r"recorded (\S+) ", ran.out)
        if m:
            raise Outcome("recorded %s (%s)" % (m.group(1), self.a.close), 0)
        m = re.match(r"already recorded (\S+) \(([a-z]+)\)", ran.out)
        if m:
            raise Outcome("already recorded %s (%s)" % (m.group(1), m.group(2)), 0)
        m = re.search(r"^tune: not recorded: (.*)$", ran.err, re.M)
        if m:
            raise Outcome("not recorded: %s" % m.group(1).strip(), 0)
        raise Outcome("not scored: tune.py printed no record line: %s" % first_line(ran.out), 1)


def parse(argv):
    p = Parser(prog="close-score.py", allow_abbrev=False,
               description="Run the script half of a Reflection at a rollout's close (ADR 0037 d4).")
    p.add_argument("--rollout", required=True)
    p.add_argument("--close", required=True, choices=TUNE.CLOSES)
    p.add_argument("--repo")
    p.add_argument("--tasks-dir")
    p.add_argument("--timeout", type=int)
    p.add_argument("--deadline", type=int)
    a = p.parse_args(argv)
    if not a.rollout.strip().endswith(".md"):
        raise Usage("--rollout must be the rollout note's path, ending .md: %s" % a.rollout)
    try:
        slug = RR.normalise_slug(os.path.expanduser(a.rollout.strip()), "rollout")
    except RR.Refused as e:
        raise Usage(str(e))
    if slug in RR.RESERVED:
        raise Usage("rollout %r is reserved (%s.jsonl is no rollout's record)" % (slug, slug))
    for name in ("timeout", "deadline"):
        v = getattr(a, name)
        if v is not None and v <= 0:
            raise Usage("--%s must be a positive number of seconds" % name)
    return a, slug


def main(argv):
    started = time.monotonic()
    try:
        a, slug = parse(argv)
    except Usage as e:
        sys.stderr.write("close-score: %s\n" % e)
        return 2
    for s in SIGNALS:
        signal.signal(s, on_signal)
    try:
        Close(a, slug, started).run()
        outcome = Outcome("not scored: no outcome", 1)  # run() always raises its Outcome
    except Outcome as o:
        outcome = o
    except Exception as e:  # never a traceback: the caller reads one line
        outcome = Outcome("not scored: %s: %s" % (type(e).__name__, str(e)[:TAIL_MAX]), 1)
    finally:
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
        try:
            remove_scratch()
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)
    sys.stdout.write("close-score: %s: %s\n" % (slug, outcome.text))
    sys.stdout.flush()
    return outcome.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
