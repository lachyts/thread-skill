#!/usr/bin/env python3
"""The estate scan: the estate pass's deterministic first pass (CONTEXT.md **Estate scan**; orient-all).

Scripts scan, the model decides: this lists every project that is not done (parked ones marked), its open tasks, its
repos and their dispatch blockers, the deadlines, and every live rollout's state, with no model calls. It writes
nothing: no vault edit, no git fetch or ref write, no bytecode (sys.dont_write_bytecode is set before its siblings
load, and every child gets PYTHONDONTWRITEBYTECODE=1). python >= 3.9 with PyYAML. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-scan.py [--vault PATH] [--today YYYY-MM-DD]
        [--offline] [--jobs N] [--timeout S] [--deadline S] [--compact]

Defaults: ~/repos/obsidian, today's local date, 8 jobs, a 10 s timeout per probe, a 40 s deadline. Exit 0 when the
scan is done (every per-item problem is inside the JSON); 2 on a usage error (one `estate-scan:` stderr line); 3 when
the vault, PyYAML or a sibling script is missing.

What it reuses. Loaded by path: resolve-target.py (RT: `done_flag`/`dead_why`, its "Live targets" rule, and
`flatten`/`unlink`), and through it next-action.py (RT.NA: Note, Vault and its link resolution, tags_of, status_of,
as_list, links_in, read_slots, DEAD_STATUSES and OPEN_STATUSES), so the vault keeps one frontmatter
reader; reconcile-rollout.py for its PROJECT_ROOT_RE. The statuses read per `_shared/vault-grammar.md` § Statuses:
Landed and Active are next-action's sets; Review is the one literal here, REVIEW_STATUSES, pinned to the doc by
tests/contracts/vault-grammar.test.mjs. In flight is § In flight. Run as children, never copied:
self-rollout-check.sh --resolve, land.sh --origin-slug, landing-register.py check, unfinished-rollout.py check and
reconcile-rollout.py status. Restated, each cited: schedule § 2.5's verifier detection (SKILL.md prose, nothing to
import), and pushed-base.sh's ahead classification (execution-fit.md § Dispatch blockers, **Pushed base**).

The vault (pure Python, never under the deadline):
- Projects: notes under Work/Projects outside Archive/, tagged `project`, with RT.dead_why None (not the `archived`
  tag, not status done/merged/dropped, not `done: true` or "true").
- Tasks: notes directly in Work/Tasks tagged `task`, neither `rollout` nor `phase`, not landed, not `archived`.
- Rollouts: notes directly in Work/Tasks tagged `rollout` (CONTEXT.md **Live rollout**: live by location).
- Phases: notes directly in Work/Phases tagged `phase`, not landed, not `archived`.
- A note whose frontmatter is present but broken (does not parse, is not a mapping, never closes, unreadable) is
  listed in `skipped`; a note with no frontmatter is out of scope.
- The Tasks-dir pre-check: every *.md under Work/Tasks, Archive/ included (the set reconcile-rollout's _scan reads),
  is opened once. One that will not open (permission, a dangling symlink, a directory) would crash every status
  and unfinished-rollout call, so it is one `vaultErrors` entry, each such note is in `skipped` (`unreadable`), and
  neither tool runs: every rollout's `error` and every repo's unfinished-rollout check read `vault`. A missing
  Work/Tasks is the entry `no-tasks-dir`, the same way.

The repo checks, schedule § 0's order, once per repo path that a live project's `repos:` declares (deduped on its
realpath; the declared strings kept):
  git                 `git rev-parse --show-toplevel`. A missing path, a plain directory or a failed probe leaves
                      every check unchecked with its reason.
  self-rollout        `bash self-rollout-check.sh --resolve <declared path>`: exit 0 prints the rolloutRoot; exit 3
                      blocks (its stderr kept), and the toplevel stands in so the later checks still report; any
                      other exit is unchecked. Every check below runs against the rolloutRoot's git root.
  no-github-origin    `bash land.sh --origin-slug`: exit 0 is `github`, exit 4 blocks, else unchecked.
  landing-register    `landing-register.py check`: 0 clear; 3 blocks (`landingRegister.line` is the `listed
                      <owner/name>: <reason>` line); 4 is recorded only (no-github-origin covers it); else unchecked.
  default-branch      `git ls-remote --symref origin HEAD` (skills/execute/scripts/default-branch.sh's resolver):
                      the branch and the remote tip. --offline, or a failed, timed-out or empty probe, falls back to
                      the cached refs/remotes/origin/HEAD (`cached`), else null and unchecked.
  unpushed-default    over the clone set: the rolloutRoot's git root, plus the declared path's toplevel when it
                      differs. pushed-base.sh's rule: a clone with no local <d> is skipped; ahead of the remote tip
                      when it is present locally (`remote`), else of refs/remotes/origin/<d> (`last-fetch`); an ahead
                      set touching no file blocks; one touching only THREAD.md, or whose content is already on
                      origin, does not. pushed-base.sh stays the gate: it fetches and walks the full clone set.
  unfinished-rollout  `unfinished-rollout.py check --repo <root> --project <name>` per declaring project, without
                      --regenerate: exit 3 blocks, 0 is the verdict (`none`, `file`), else unchecked.
  no-verifier         schedule § 2.5's order, read from the root's working tree: CLAUDE.md `Verifier: \\`<cmd>\\``,
                      a Makefile `test:` target (`make test`), pyproject.toml [tool.poetry] (`poetry run pytest`),
                      package.json scripts.test (`npm test`). A CLAUDE.md Verification or Testing heading with none of
                      these is {command: null, source: "CLAUDE.md section"} for the model to read, no blocker.

Probes. Each child runs in its own session with stdin from /dev/null and the caller's env minus `git rev-parse
--local-env-vars` (computed by the first probe), plus land.sh's no-prompt set (GIT_TERMINAL_PROMPT=0,
GCM_INTERACTIVE=never, GH_PROMPT_DISABLED=1) and PYTHONDONTWRITEBYTECODE=1; git also gets LC_ALL=C, and ls-remote
gets `GIT_SSH_COMMAND='ssh -o BatchMode=yes'` only when GIT_SSH_COMMAND, GIT_SSH and the repo's core.sshCommand are
all unset (land.sh's rule). Each waits min(--timeout, time left to the deadline); at expiry its whole process group
gets SIGTERM, a 1 s grace, then SIGKILL (declared-check.py's kill_group), then its pipes close and it is reaped
within 2 s (rollout-settings.py _origin_slug's pattern). The deadline is absolute from process start: no probe starts
after it, and every probe in flight at it is killed, so the run ends within about the deadline plus 3 s. --deadline 0
starts no subprocess at all. SIGINT or SIGTERM kills every live probe group, then exits 130.

Output, one JSON object (schema 1; --compact for one line):
  schema, vault, today, offline, limits {deadline, timeout, jobs}, elapsedMs, deadlineHit,
  counts {projects, parked, tasks, unhomed, rollouts, repos, deadlines, overdue, skipped},
  vaultErrors[] {kind: unreadable-tasks-notes | no-tasks-dir, notes[], skips[]},
  projects[]  {name, note, status (raw), standing: crowned|active|queued|parked|other|none, parked, crowned, lane,
               area[], aliases[], nextTask {result: live|blank|dead:<reason>, task, next_action}, repos[] (as
               declared), tasks[] (slugs), openTasks, phases[] {slug, note, status, phase, openTasks}, rollouts[],
               nextDue (the earliest due on or after today), overdue}
               ordered crowned, active, queued, parked, other, none, then by name, then by note;
  tasks[]     {slug, note, title, status, statusClass: active|review|hold, projects[] (live project names),
               deadLinks[] {link, why, raw}, phase, priority, scope, work_depth, launch, due, scheduled, captured,
               dependsOn[], rollout, rolloutLive, inFlight}, by slug;
  unhomed[]   {slug, why, links[] {link, why, raw}}: an open task with no live project; why is its first link's, or
               `no projects`. A link's why: missing, project archived, not a project, ambiguous, area note, project
               unreadable, project done, or other; raw is next-action's resolve_project reason (or RT.dead_why's);
  repos[]     {path, declared[], declaredBy[], exists, git, toplevel, nested, rolloutRoot, selfRollout {exit, stderr},
               origin, github, landingRegister {exit, line}, defaultBranch, defaultBranchSource (remote|cached|null),
               unpushed[] {clone, ahead, basis (remote|last-fetch), touched[], threadOnly, contentOnOrigin, blocks,
               commits[] (up to 5, `log --oneline`)}, verifier {command, source} | null,
               unfinishedRollout[] {project, verdict, line, exit, stderr}, blockers[] {check, why},
               unchecked[] {check, why}, errors[] {check, error}}, by path; blockers and unchecked in the check
               order above, and unchecked means not clear (`deadline`, `timeout`, `vault`, `error`, ...);
  rollouts[]  {slug, note, status, shape (absent: parallel), protocolVersion, projects[] (as written), projectRoot,
               supersedes, supersededBy, summary, error}, by slug. summary is reconcile-rollout.py status's
               {rolloutStatus, paused, pause_requested, pausedFor, incomplete, ceiling, ceilingError, counts,
               progress, gitEnvHold (a count), setAside[] {slug, status, setAsideAt, needsHuman?}, running[],
               awaitingIntegration[], pendingSignOffs[] (set aside at `gate`), awaitingSignOff}, or null with error
               the status call's last stderr line, `deadline`, `timeout` or `vault`;
  deadlines[] {date, kind: "due", task, projects[]}, by date then task;
  skipped[]   {note, why}, by note.
Grading and ranking are the estate pass's next step, never this script's.
"""
import argparse
import datetime
import importlib.util
import json
import math
import os
import re
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

START = time.monotonic()
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
RESOLVE_TARGET_PY = os.path.join(HERE, "resolve-target.py")
RECONCILE_ROLLOUT_PY = os.path.join(SKILLS, "execute", "scripts", "reconcile-rollout.py")
SELF_ROLLOUT_SH = os.path.join(SKILLS, "execute", "scripts", "self-rollout-check.sh")
LAND_SH = os.path.join(HERE, "land.sh")
LANDING_REGISTER_PY = os.path.join(HERE, "landing-register.py")
UNFINISHED_ROLLOUT_PY = os.path.join(HERE, "unfinished-rollout.py")

SCHEMA = 1
VAULT_DEFAULT = "~/repos/obsidian"
REVIEW_STATUSES = frozenset({"review"})  # vault-grammar.md § Statuses **Review**; pinned by its contract test
STANDINGS = ("crowned", "active", "queued", "parked")
STANDING_RANK = {s: i for i, s in enumerate(STANDINGS + ("other", "none"))}
CHECKS = ("git", "self-rollout", "no-github-origin", "landing-register", "default-branch", "unpushed-default",
          "unfinished-rollout", "no-verifier")
CHECK_RANK = {c: i for i, c in enumerate(CHECKS)}
STATUS_SKIPS = ["rollout status", "unfinished-rollout"]
KILL_GRACE = 1.0  # declared-check.py's TERM-to-KILL grace
REAP_BOUND = 2.0  # how long a killed probe's reap may take before it is left to init
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
H1 = re.compile(r"#[ \t]+(\S.*?)[ \t]*#*[ \t]*$")
VERIFIER_LINE = re.compile(r"Verifier:\s*`([^`\n]+)`")
VERIFIER_HEADING = re.compile(r"^#{1,6}\s+(?:Verification|Testing)\b", re.M | re.I)
# Each resolve_project reason (next-action.py) the way the estate pass reads it; anything unmatched is `other`.
LINK_WHY = (("not a project note (", "not a project"), ("ambiguous (", "ambiguous"), ("area note (", "area note"),
            ("no closed frontmatter (", "project unreadable"), ("frontmatter does not parse (", "project unreadable"),
            ("frontmatter is not a mapping (", "project unreadable"), ("unreadable (", "project unreadable"))


def fail(code, reason):
    sys.stderr.write("estate-scan: %s\n" % reason)
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


def _load(name, path):
    """A sibling script as a module, by path (resolve-target.py's _load)."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_siblings():
    out = []
    for name, path in (("thread_resolve_target", RESOLVE_TARGET_PY), ("thread_reconcile_rollout", RECONCILE_ROLLOUT_PY)):
        try:
            out.append(_load(name, path))
        except SystemExit:  # resolve-target's own exit 3 (next-action.py would not load), already on stderr
            fail(3, "cannot load %s" % path)
        except Exception as e:
            fail(3, "cannot load %s: %s" % (path, e))
    return out


# ---- values ----------------------------------------------------------------------------------------------------

def jsonable(v):
    """A frontmatter value as JSON: a date as its ISO string, a non-finite float or anything odd as its text."""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return str(v)


def as_date(v):
    """A frontmatter date (a YAML date, or a YYYY-MM-DD string), else None: a non-date is kept raw, never compared."""
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    if isinstance(v, str) and ISO_DATE.fullmatch(v.strip()):
        try:
            return datetime.date.fromisoformat(v.strip())
        except ValueError:
            return None
    return None


def link_why(raw):
    if raw == "no note":
        return "missing"
    if raw == "archived":
        return "project archived"
    for prefix, why in LINK_WHY:
        if raw.startswith(prefix):
            return why
    return "other"


def slug_of(rel):
    return os.path.basename(rel)[:-3]


def slash(rel):
    return rel.replace(os.sep, "/")


def last_line(text):
    for line in reversed((text or "").splitlines()):
        if line.strip():
            return line.strip()
    return None


def ordered(rows):
    return sorted(rows, key=lambda r: CHECK_RANK[r["check"]])


# ---- probes ----------------------------------------------------------------------------------------------------

class Ran:
    """One probe: exit (None when it never finished), stdout, stderr, and why it did not finish (deadline, timeout,
    start, interrupted), else None."""

    def __init__(self, exit=None, out="", err="", why=None):
        self.exit, self.out, self.err, self.why = exit, out, err, why

    @property
    def ok(self):
        return self.exit == 0


def kill_group(proc):
    """SIGTERM the process group, wait up to KILL_GRACE for it to empty, then SIGKILL it. Copied from
    declared-check.py's kill_group (loading that script would install its signal handlers)."""
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


def decode(data):
    return data.decode("utf-8", "surrogateescape") if data else ""


class Runner:
    """Every subprocess the scan starts, bounded by --timeout each and by the absolute deadline."""

    def __init__(self, timeout, deadline):
        self.timeout = timeout
        self.deadline_at = START + deadline
        self.deadline_hit = False
        self._lock = threading.Lock()  # spawning and the live set; the signal handler takes it and never gives it back
        self._live = set()
        self._dying = False
        self._env = None
        self._env_lock = threading.Lock()

    def left(self):
        return self.deadline_at - time.monotonic()

    def _env_for_children(self):
        """The caller's env minus git's repo-local names (a hook's GIT_DIR & co.), plus the no-prompt set; built by
        the first probe, so --deadline 0 runs not even this. None when the deadline stops it."""
        with self._env_lock:
            if self._env is None:
                r = self._spawn(["git", "rev-parse", "--local-env-vars"], dict(os.environ))
                if r.why == "deadline":
                    return None
                names = set(r.out.split()) if r.ok else set()
                env = {k: v for k, v in os.environ.items() if k not in names}
                env.update(GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never", GH_PROMPT_DISABLED="1",
                           PYTHONDONTWRITEBYTECODE="1")
                self._env = env
            return self._env

    def run(self, argv, extra=None, git=False):
        if self.left() <= 0:
            self.deadline_hit = True
            return Ran(why="deadline")
        env = self._env_for_children()
        if env is None:
            return Ran(why="deadline")
        env = dict(env)
        if git:
            env["LC_ALL"] = "C"
        env.update(extra or {})
        return self._spawn(argv, env)

    def git(self, cwd, *args, extra=None):
        return self.run(["git", "-C", cwd] + list(args), extra=extra, git=True)

    def _spawn(self, argv, env):
        with self._lock:
            if self._dying:
                return Ran(why="interrupted")
            left = self.left()
            if left <= 0:
                self.deadline_hit = True
                return Ran(why="deadline")
            try:
                proc = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, start_new_session=True)
            except OSError as e:
                return Ran(err=e.strerror or str(e), why="start")
            self._live.add(proc)
        bound = "deadline" if left < self.timeout else "timeout"
        try:
            out, err = proc.communicate(timeout=min(self.timeout, left))
        except subprocess.TimeoutExpired:
            # Kill the whole group before draining: a grandchild (ssh, an askpass) holding a pipe would hang the drain.
            kill_group(proc)
            for f in (proc.stdout, proc.stderr):
                try:
                    f.close()
                except OSError:
                    pass
            try:
                proc.wait(timeout=REAP_BOUND)
            except subprocess.TimeoutExpired:
                pass
            if bound == "deadline":
                self.deadline_hit = True
            return Ran(why=bound)
        finally:
            with self._lock:
                self._live.discard(proc)
        return Ran(exit=proc.returncode, out=decode(out), err=decode(err))

    def interrupt(self, signum, _frame):
        """SIGINT/SIGTERM: kill every live probe group (TERM, the grace, then KILL), then exit 130."""
        for s in (signal.SIGINT, signal.SIGTERM):
            signal.signal(s, signal.SIG_IGN)
        self._lock.acquire(timeout=2)
        self._dying = True
        procs = list(self._live)
        for p in procs:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except OSError:
                pass
        end = time.monotonic() + KILL_GRACE
        while procs and time.monotonic() < end:
            alive = []
            for p in procs:
                p.poll()
                try:
                    os.killpg(p.pid, 0)
                    alive.append(p)
                except OSError:
                    pass
            procs = alive
            time.sleep(0.05)
        for p in procs:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
        os._exit(130)


# ---- the scan --------------------------------------------------------------------------------------------------

class Repo:
    """One declared repo path (deduped on its realpath) and what the checks found for it."""

    def __init__(self, path, absolute):
        self.path, self.absolute = path, absolute
        self.declared, self.by = set(), set()
        self.exists = False
        self.git = None
        self.git_why = None
        self.toplevel = None
        self.rollout_root = None
        self.root = None  # the rolloutRoot's git root, realpath'd: every check after self-rollout reads it
        self.self_rollout = None
        self.blockers, self.unchecked, self.errors = [], [], []


class RootFacts:
    """The checks of one git root (the rolloutRoot's), shared by every declared path under it."""

    def __init__(self):
        self.origin = self.github = self.landing = self.branch = self.source = self.verifier = None
        self.unpushed = []
        self.blockers, self.unchecked, self.errors = [], [], []


class Scan:
    def __init__(self, RT, RR, args):
        self.RT, self.RR, self.NA = RT, RR, RT.NA
        self.args = args
        self.vault = self.NA.Vault(os.path.expanduser(args.vault))
        self.root = self.vault.root
        self.today = args.today
        self.runner = Runner(args.timeout, args.deadline)
        self.skipped = {}
        self.vault_errors = []
        self._resolved = {}

    # ---- the vault ---------------------------------------------------------------------------------------------

    def skip(self, rel, why):
        self.skipped.setdefault(slash(rel), why)

    def note(self, rel):
        """The note's parsed frontmatter holder, or None: a broken one is skipped, one with none is out of scope."""
        note = self.vault.note(rel)
        if note.fm is None:
            opened = bool(note.lines) and note.lines[0].rstrip() == "---"
            if note.error != "no closed frontmatter" or opened:
                self.skip(rel, note.error)
            return None
        return note

    def tasks_precheck(self):
        """True when status and unfinished-rollout can read Work/Tasks: reconcile-rollout's _scan opens every *.md
        under it (Archive/ included), and one that will not open crashes both."""
        tasks = os.path.join(self.root, self.NA.TASKS_DIR)
        if not os.path.isdir(tasks):
            self.vault_errors.append({"kind": "no-tasks-dir", "notes": [], "skips": list(STATUS_SKIPS)})
            return False
        from pathlib import Path
        bad = []
        for p in sorted(Path(tasks).rglob("*.md")):
            try:
                open(p, "rb").close()
            except OSError:
                bad.append(slash(os.path.relpath(str(p), self.root)))
        if bad:
            self.vault_errors.append({"kind": "unreadable-tasks-notes", "notes": bad, "skips": list(STATUS_SKIPS)})
            for rel in bad:
                self.skip(rel, "unreadable")
        return not bad

    def notes_in(self, rel_dir):
        d = os.path.join(self.root, rel_dir)
        names = sorted(os.listdir(d)) if os.path.isdir(d) else []
        for name in names:
            if name.lower().endswith(".md") and os.path.isfile(os.path.join(d, name)):
                rel = os.path.join(rel_dir, name)
                note = self.note(rel)
                if note is not None:
                    yield rel, note

    def resolve(self, link):
        """(project rel, None, None) for a live project, else (None, why, raw)."""
        if link not in self._resolved:
            rel, raw = self.vault.resolve_project(link, link=True)
            if raw is not None:
                self._resolved[link] = (None, link_why(raw), raw)
            else:
                dead = self.RT.dead_why(rel, self.vault.note(rel))
                if dead:
                    self._resolved[link] = (None, "project archived" if dead == "archived" else "project done", dead)
                else:
                    self._resolved[link] = (rel, None, None)
        return self._resolved[link]

    def read_projects(self):
        NA, RT = self.NA, self.RT
        top = os.path.join(self.root, NA.PROJECTS_DIR)
        rows = {}
        for d, dirs, files in os.walk(top):
            dirs[:] = sorted(x for x in dirs if not x.startswith(".") and x != "Archive")
            for f in sorted(files):
                if not f.lower().endswith(".md"):
                    continue
                rel = os.path.relpath(os.path.join(d, f), self.root)
                note = self.note(rel)
                if note is None or "project" not in NA.tags_of(note) or RT.dead_why(rel, note):
                    continue
                st = NA.status_of(note)
                standing = st if st in STANDINGS else ("other" if st else "none")
                slot = NA.read_slots(self.vault, [rel])[0]
                rows[rel] = {
                    "name": slug_of(rel), "note": slash(rel), "status": jsonable(note.get("status")),
                    "standing": standing, "parked": standing == "parked", "crowned": jsonable(note.get("crowned")),
                    "lane": jsonable(note.get("lane")),
                    "area": [s for s in (RT.unlink(x) for x in RT.flatten(note.get("area")) if isinstance(x, str)) if s],
                    "aliases": [str(a).strip() for a in RT.flatten(note.get("aliases")) if str(a).strip()],
                    "nextTask": ({"result": slot["result"], "task": slot["task"], "next_action": slot["next_action"]}
                                 if slot["kind"] == "slot" else
                                 {"result": "skip:%s" % slot["result"], "task": None, "next_action": None}),
                    "repos": [x.strip() for x in NA.as_list(note.get("repos")) if isinstance(x, str) and x.strip()],
                    "tasks": [], "openTasks": 0, "phases": [], "rollouts": [], "nextDue": None, "overdue": 0,
                }
        return rows

    def title(self, note):
        lines = note.lines[note.span[1] + 1:] if note.span else note.lines
        for line in lines:
            m = H1.match(line.rstrip("\r\n"))
            if m:
                return m.group(1)
        return None

    def deps(self, note):
        out, seen = [], set()
        for key in ("depends-on", "blocked-by"):
            for item in self.NA.as_list(note.get(key)):
                got = self.NA.links_in([item])
                if not got and isinstance(item, (str, int, float)) and str(item).strip():
                    got = [str(item).strip()]
                for g in got:
                    if g.lower() not in seen:
                        seen.add(g.lower())
                        out.append(g)
        return out

    def first_link(self, value):
        links = self.NA.links_in(value)
        if links:
            return links[0]
        return value.strip() if isinstance(value, str) and value.strip() else None

    def read_tasks(self, projects):
        NA = self.NA
        tasks, homes, unhomed, rollouts, phases = [], {}, [], [], []
        for rel, note in self.notes_in(NA.TASKS_DIR):
            tags = NA.tags_of(note)
            if "rollout" in tags:
                rollouts.append((rel, note))
                continue
            slug, st = slug_of(rel), NA.status_of(note)
            if "task" not in tags or "phase" in tags or st in NA.DEAD_STATUSES or "archived" in tags:
                continue
            live, dead, links = [], [], NA.links_in(note.get("projects"))
            for link in links:
                prel, why, raw = self.resolve(link)
                if prel is None:
                    dead.append({"link": link, "why": why, "raw": raw})
                elif prel not in live:
                    live.append(prel)
            rollout = self.first_link(note.get("rollout"))
            rollout_live = bool(rollout) and any(os.path.dirname(t) == NA.TASKS_DIR for t in self.vault.targets(rollout))
            row = {
                "slug": slug, "note": slash(rel), "title": self.title(note) or slug, "status": jsonable(note.get("status")),
                "statusClass": ("active" if st in NA.OPEN_STATUSES else "review" if st in REVIEW_STATUSES else "hold"),
                "projects": [projects[p]["name"] for p in live], "deadLinks": dead,
            }
            for key in ("phase", "priority", "scope", "work_depth", "launch", "due", "scheduled", "captured"):
                row[key] = jsonable(note.get(key))
            row.update(dependsOn=self.deps(note), rollout=rollout, rolloutLive=rollout_live,
                       inFlight=rollout_live or st in ("in_progress",) or st in REVIEW_STATUSES)
            tasks.append(row)
            homes[slug] = (live, note)
            if not live:
                unhomed.append({"slug": slug, "why": dead[0]["why"] if dead else "no projects", "links": dead})
        for rel, note in self.notes_in(os.path.join("Work", "Phases")):
            tags = NA.tags_of(note)
            if "phase" in tags and NA.status_of(note) not in NA.DEAD_STATUSES and "archived" not in tags:
                phases.append((rel, note))
        return tasks, homes, unhomed, rollouts, phases

    # ---- the repos -----------------------------------------------------------------------------------------------

    def repo_rows(self, projects):
        repos = {}
        for p in projects:
            for declared in p["repos"]:
                exp = os.path.expanduser(declared)
                absolute = os.path.isabs(exp)
                key = os.path.realpath(exp.rstrip("/") or "/") if absolute else declared
                r = repos.setdefault(key, Repo(key, absolute))
                r.declared.add(declared)
                r.by.add(p["name"])
        return [repos[k] for k in sorted(repos)]

    def probe_repo(self, r):
        """git, then self-rollout: the repo's toplevel, its rolloutRoot and that root's git root."""
        run = self.runner
        if not r.absolute:
            r.git_why = "not an absolute path"
            return
        r.exists = os.path.exists(r.path)
        if not r.exists:
            r.git_why = "missing"
            return
        if not os.path.isdir(r.path):
            r.git, r.git_why = False, "not a directory"
            return
        g = run.git(r.path, "rev-parse", "--show-toplevel")
        if g.why:
            r.git_why = g.why
            return
        if not g.ok or not g.out.strip():
            r.git, r.git_why = False, "not a git repo"
            return
        r.git, r.toplevel = True, os.path.realpath(g.out.strip())
        declared = os.path.expanduser(sorted(r.declared)[0])
        s = run.run(["bash", SELF_ROLLOUT_SH, "--resolve", declared])
        r.self_rollout = {"exit": s.exit, "stderr": s.err}
        printed = s.out.strip().splitlines()[-1] if s.ok and s.out.strip() else None
        r.rollout_root = printed or r.toplevel
        if printed is None:
            if s.why:
                r.unchecked.append({"check": "self-rollout", "why": s.why})
            elif s.exit == 3:
                why = next((ln.strip() for ln in s.err.splitlines() if "is not a usable rollout clone" in ln), None)
                r.blockers.append({"check": "self-rollout", "why": why or last_line(s.err) or "exit 3"})
            else:
                r.unchecked.append({"check": "self-rollout", "why": "error"})
                r.errors.append({"check": "self-rollout", "error": last_line(s.err) or "exit %s" % s.exit})
        real = os.path.realpath(r.rollout_root)
        if real in (r.path, r.toplevel):
            r.root = r.toplevel
            return
        t = run.git(r.rollout_root, "rev-parse", "--show-toplevel")
        if t.ok and t.out.strip():
            r.root = os.path.realpath(t.out.strip())
        else:
            r.git_why = t.why or "the rollout root is not a git repo"

    def root_facts(self, root, primaries):
        """Every check of one git root, in schedule § 0's order, with its clone set [root] + primaries."""
        run, f = self.runner, RootFacts()
        o = run.git(root, "remote", "get-url", "origin")
        f.origin = o.out.strip() if o.ok and o.out.strip() else None

        s = run.run(["bash", LAND_SH, "--origin-slug", root])
        if s.ok and s.out.strip():
            f.github = s.out.strip()
        elif s.exit == 4:
            f.blockers.append({"check": "no-github-origin",
                               "why": ("origin %s is not a GitHub remote" % f.origin) if f.origin else "no origin remote"})
        else:
            f.unchecked.append({"check": "no-github-origin", "why": s.why or "error"})
            if not s.why:
                f.errors.append({"check": "no-github-origin", "error": last_line(s.err) or "exit %s" % s.exit})

        lr = run.run([sys.executable, LANDING_REGISTER_PY, "check", root])
        line = lr.out.strip().splitlines()[0] if lr.out.strip() else None
        for warn in lr.err.splitlines():
            if warn.strip():
                f.errors.append({"check": "landing-register", "error": warn.strip()})
        if lr.exit in (0, 3, 4):
            f.landing = {"exit": lr.exit, "line": line}
            if lr.exit == 3:
                f.blockers.append({"check": "landing-register", "why": line or "listed"})
        else:
            f.landing = {"exit": lr.exit, "line": None}
            f.unchecked.append({"check": "landing-register", "why": lr.why or "error"})

        tip = self.default_branch(f, root)
        self.unpushed(f, [root] + primaries, tip)
        self.verifier(f, root)
        return f

    def default_branch(self, f, root):
        """Sets f.branch and f.source; returns the remote tip, or None. default-branch.sh's resolver, asked of the
        remote; the cached origin/HEAD is only a labelled fallback (tests/default-branch.test.sh: the remote wins)."""
        run, tip = self.runner, None
        if not self.args.offline:
            extra = {}
            if not os.environ.get("GIT_SSH_COMMAND") and not os.environ.get("GIT_SSH"):
                c = run.git(root, "config", "--get", "core.sshCommand")
                if not (c.ok and c.out.strip()) and not c.why:
                    extra["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes"  # land.sh's rule: never prompt
            r = run.git(root, "ls-remote", "--symref", "origin", "HEAD", extra=extra)
            branch = None
            for ln in r.out.splitlines() if r.ok else []:
                parts = ln.split("\t")
                if parts[0].startswith("ref: refs/heads/") and parts[-1] == "HEAD":
                    branch = parts[0][len("ref: refs/heads/"):]
                elif len(parts) == 2 and parts[1] == "HEAD" and re.fullmatch(r"[0-9a-f]{40,64}", parts[0]):
                    tip = parts[0]
            if branch:
                f.branch, f.source = branch, "remote"
                return tip
            tip = None
            f.errors.append({"check": "default-branch",
                             "error": "ls-remote: %s" % (r.why or last_line(r.err) or "no HEAD symref on origin")})
        c = run.git(root, "symbolic-ref", "-q", "refs/remotes/origin/HEAD")
        ref = c.out.strip() if c.ok else ""
        if ref.startswith("refs/remotes/origin/"):
            f.branch, f.source = ref[len("refs/remotes/origin/"):], "cached"
        else:
            f.unchecked.append({"check": "default-branch", "why": c.why or "no cached origin/HEAD"})
        return None

    def unpushed(self, f, clones, tip):
        """pushed-base.sh's ahead classification (execution-fit.md § Dispatch blockers, **Pushed base**), restated:
        it fetches and walks the full clone set, the scan reads what is already local."""
        run, d = self.runner, f.branch
        if d is None:
            why = next((u["why"] for u in f.unchecked if u["check"] == "default-branch"), "no default branch")
            f.unchecked.append({"check": "unpushed-default", "why": why})
            return
        problem = None
        for c in clones:
            local = "refs/heads/%s" % d
            v = run.git(c, "rev-parse", "-q", "--verify", local)
            if v.why:
                problem = problem or v.why
                continue
            if not v.ok:
                continue  # no local default branch: skipped, as pushed-base skips it
            up, basis = "refs/remotes/origin/%s" % d, "last-fetch"
            if tip:
                e = run.git(c, "cat-file", "-e", "%s^{commit}" % tip)
                if e.why:
                    problem = problem or e.why
                    continue
                if e.ok:
                    up, basis = tip, "remote"
            n = run.git(c, "rev-list", "--count", "%s..%s" % (up, local))
            if not n.ok or not n.out.strip().isdigit():
                problem = problem or n.why or "error"
                f.errors.append({"check": "unpushed-default",
                                 "error": "%s: %s" % (c, n.why or last_line(n.err) or "cannot count %s" % d)})
                continue
            row = {"clone": c, "ahead": int(n.out.strip()), "basis": basis, "touched": [], "threadOnly": False,
                   "contentOnOrigin": False, "blocks": False, "commits": []}
            if row["ahead"]:
                t = run.git(c, "diff", "--no-renames", "--name-only", "-z", "%s...%s" % (up, local))
                if t.why:
                    problem = problem or t.why
                    continue
                touched = [x for x in t.out.split("\0") if x] if t.ok else []
                other = not touched  # an ahead set touching no file blocks
                if touched:
                    q = run.run(["git", "-C", c, "--literal-pathspecs", "diff", "--quiet", "--no-renames", up, local,
                                 "--"] + touched, git=True)
                    if q.why:
                        problem = problem or q.why
                        continue
                    if q.exit == 0:
                        row["contentOnOrigin"] = True
                    elif q.exit == 1:
                        w = run.run(["git", "-C", c, "--literal-pathspecs", "diff", "--no-renames", "--name-only", "-z",
                                     up, local, "--"] + touched, git=True)
                        if w.why:
                            problem = problem or w.why
                            continue
                        differ = [x for x in w.out.split("\0") if x] if w.ok else []
                        other = not differ or any(os.path.basename(x) != "THREAD.md" for x in differ)
                    else:
                        other = True  # a failed comparison blocks: fail closed
                row["touched"] = touched
                row["threadOnly"] = bool(touched) and all(os.path.basename(x) == "THREAD.md" for x in touched)
                row["blocks"] = other
                lg = run.git(c, "log", "--oneline", "--no-decorate", "-n", "5", "%s..%s" % (up, local))
                row["commits"] = lg.out.splitlines() if lg.ok else []
            f.unpushed.append(row)
        blocking = [u for u in f.unpushed if u["blocks"]]
        if blocking:
            u = blocking[0]
            f.blockers.append({"check": "unpushed-default", "why": "local %s in %s is %d commit(s) ahead of origin/%s"
                               % (d, u["clone"], u["ahead"], d)})
        elif problem:
            f.unchecked.append({"check": "unpushed-default", "why": problem})

    def verifier(self, f, root):
        """schedule § 2.5's detection order, restated (SKILL.md prose: nothing to import)."""
        def text(name):
            try:
                with open(os.path.join(root, name), encoding="utf-8", errors="replace") as fh:
                    return fh.read()
            except OSError:
                return None
        claude, make, pyproject, package = text("CLAUDE.md"), text("Makefile"), text("pyproject.toml"), text("package.json")
        m = VERIFIER_LINE.search(claude or "")
        if m:
            f.verifier = {"command": m.group(1).strip(), "source": "CLAUDE.md"}
        elif make is not None and any(self.test_target(ln) for ln in make.splitlines()):
            f.verifier = {"command": "make test", "source": "Makefile"}
        elif pyproject is not None and any(ln.strip() == "[tool.poetry]" for ln in pyproject.splitlines()):
            f.verifier = {"command": "poetry run pytest", "source": "pyproject.toml"}
        elif self.npm_test(package):
            f.verifier = {"command": "npm test", "source": "package.json"}
        elif claude is not None and VERIFIER_HEADING.search(claude):
            f.verifier = {"command": None, "source": "CLAUDE.md section"}
        else:
            f.blockers.append({"check": "no-verifier", "why": "no verifier detected (schedule § 2.5)"})

    @staticmethod
    def test_target(line):
        """A Makefile rule line whose targets include `test` (not a `test :=` assignment, not a recipe line)."""
        if not line or line[0] in " \t#." or ":" not in line:
            return False
        targets, _, rest = line.partition(":")
        return not rest.startswith("=") and "=" not in targets and "test" in targets.split()

    @staticmethod
    def npm_test(text):
        try:
            data = json.loads(text) if text else None
        except ValueError:
            return False
        scripts = data.get("scripts") if isinstance(data, dict) else None
        test = scripts.get("test") if isinstance(scripts, dict) else None
        return isinstance(test, str) and bool(test.strip())

    def unfinished(self, name, root):
        r = self.runner.run([sys.executable, UNFINISHED_ROLLOUT_PY, "check", "--repo", root, "--project", name,
                             "--tasks-dir", os.path.join(self.root, self.NA.TASKS_DIR)])
        line = r.out.strip().splitlines()[0] if r.out.strip() else None
        return {"project": name, "verdict": line.split()[0] if line else None, "line": line, "exit": r.exit,
                "stderr": r.err, "why": r.why}

    # ---- rollouts --------------------------------------------------------------------------------------------------

    def status(self, rel):
        r = self.runner.run([sys.executable, RECONCILE_ROLLOUT_PY, "status", "--rollout", os.path.join(self.root, rel),
                             "--tasks-dir", os.path.join(self.root, self.NA.TASKS_DIR)])
        if r.why:
            return None, r.why
        if not r.ok:
            return None, last_line(r.err) or "status exited %s" % r.exit
        try:
            s = json.loads(r.out)
        except ValueError:
            return None, "status printed no JSON"
        tasks = s.get("tasks") or []
        set_aside = []
        for t in tasks:
            if t.get("queueState") == "set-aside":
                e = {"slug": t.get("slug"), "status": t.get("status"), "setAsideAt": t.get("setAsideAt")}
                if t.get("needsHuman"):
                    e["needsHuman"] = t["needsHuman"]
                set_aside.append(e)
        summary = {k: s.get(k) for k in ("rolloutStatus", "paused", "pause_requested", "pausedFor", "incomplete",
                                         "ceiling", "ceilingError", "counts", "progress")}
        summary.update(
            gitEnvHold=len(s.get("gitEnvHold") or []),
            setAside=set_aside,
            running=[t.get("slug") for t in tasks if t.get("queueState") == "running"],
            awaitingIntegration=[t.get("slug") for t in tasks if t.get("queueState") == "awaiting-integration"],
            pendingSignOffs=[e["slug"] for e in set_aside if e["setAsideAt"] == "gate"],
            awaitingSignOff=s.get("pausedFor") == "sign-off",
        )
        return summary, None

    def rollout_row(self, rel, note):
        lines = note.lines[note.span[1] + 1:] if note.span else []
        m = self.RR.PROJECT_ROOT_RE.search("".join(lines))
        return {
            "slug": slug_of(rel), "note": slash(rel), "status": jsonable(note.get("status")),
            "shape": jsonable(note.get("shape")) or "parallel", "protocolVersion": jsonable(note.get("protocol_version")),
            "projects": self.NA.links_in(note.get("projects")), "projectRoot": m.group(1).strip() if m else None,
            "supersedes": self.first_link(note.get("supersedes")),
            "supersededBy": self.first_link(note.get("superseded_by")),
            "summary": None, "error": None,
        }

    # ---- the run ---------------------------------------------------------------------------------------------------

    def run(self):
        for s in (signal.SIGINT, signal.SIGTERM):
            signal.signal(s, self.runner.interrupt)
        tasks_ok = self.tasks_precheck()
        projects = self.read_projects()
        tasks, homes, unhomed, rollout_notes, phase_notes = self.read_tasks(projects)

        # Homing, phases, rollouts and deadlines onto the projects.
        deadlines = []
        for row in tasks:
            live, note = homes[row["slug"]]
            due = as_date(note.get("due"))
            for prel in live:
                p = projects[prel]
                p["tasks"].append(row["slug"])
                if due is not None and due < self.today:
                    p["overdue"] += 1
                elif due is not None and (p["nextDue"] is None or due.isoformat() < p["nextDue"]):
                    p["nextDue"] = due.isoformat()
            if due is not None:
                deadlines.append({"date": due.isoformat(), "kind": "due", "task": row["slug"], "projects": row["projects"]})
        for p in projects.values():
            p["tasks"].sort()
            p["openTasks"] = len(p["tasks"])
        by_slug = {row["slug"]: homes[row["slug"]][1] for row in tasks}
        for rel, note in phase_notes:
            value = note.get("phase")
            for prel in {self.resolve(link)[0] for link in self.NA.links_in(note.get("projects"))} - {None}:
                p = projects[prel]
                count = sum(1 for t in p["tasks"] if value is not None and by_slug[t].get("phase") is not None
                            and str(by_slug[t].get("phase")) == str(value))
                p["phases"].append({"slug": slug_of(rel), "note": slash(rel), "status": jsonable(note.get("status")),
                                    "phase": jsonable(value), "openTasks": count})
        rollouts = [self.rollout_row(rel, note) for rel, note in rollout_notes]
        for row, (rel, note) in zip(rollouts, rollout_notes):
            for prel in {self.resolve(link)[0] for link in self.NA.links_in(note.get("projects"))} - {None}:
                projects[prel]["rollouts"].append(row["slug"])
        for p in projects.values():
            p["phases"].sort(key=lambda x: x["slug"])
            p["rollouts"].sort()
        plist = sorted(projects.values(), key=lambda p: (STANDING_RANK[p["standing"]], p["name"], p["note"]))
        repos = self.repo_rows(plist)

        # The probes: status calls first, then each repo's git and self-rollout, then each git root's checks, then the
        # unfinished-rollout checks, which need the root.
        with ThreadPoolExecutor(max_workers=self.args.jobs) as pool:
            status = {}
            for row in rollouts:
                if tasks_ok:
                    status[row["slug"]] = pool.submit(self.status, row["note"])
                else:
                    row["error"] = "vault"
            list(pool.map(self.probe_repo, repos))
            roots = {}
            for r in repos:
                if r.root and r.git_why is None:
                    roots.setdefault(r.root, set())
                    if r.toplevel != r.root:
                        roots[r.root].add(r.toplevel)
            facts = dict(zip(sorted(roots), pool.map(lambda k: self.root_facts(k, sorted(roots[k])), sorted(roots))))
            pairs = sorted({(name, r.root) for r in repos if r.root and r.git_why is None for name in r.by})
            unfinished = dict(zip(pairs, pool.map(lambda pr: self.unfinished(*pr), pairs))) if tasks_ok else {}
            for row in rollouts:
                if row["slug"] in status:
                    row["summary"], row["error"] = status[row["slug"]].result()

        out_repos = [self.repo_out(r, facts.get(r.root), unfinished, tasks_ok) for r in repos]
        deadlines.sort(key=lambda x: (x["date"], x["task"]))
        skipped = [{"note": k, "why": self.skipped[k]} for k in sorted(self.skipped)]
        out = {
            "schema": SCHEMA, "vault": self.root, "today": self.today.isoformat(), "offline": self.args.offline,
            "limits": {"deadline": num(self.args.deadline), "timeout": num(self.args.timeout), "jobs": self.args.jobs},
            "elapsedMs": 0, "deadlineHit": self.runner.deadline_hit,
            "counts": {"projects": len(plist), "parked": sum(1 for p in plist if p["parked"]), "tasks": len(tasks),
                       "unhomed": len(unhomed), "rollouts": len(rollouts), "repos": len(out_repos),
                       "deadlines": len(deadlines), "overdue": sum(1 for d in deadlines if d["date"] < self.today.isoformat()),
                       "skipped": len(skipped)},
            "vaultErrors": self.vault_errors,
            "projects": plist, "tasks": tasks, "unhomed": unhomed, "repos": out_repos, "rollouts": rollouts,
            "deadlines": deadlines, "skipped": skipped,
        }
        out["elapsedMs"] = int((time.monotonic() - START) * 1000)
        return out

    def repo_out(self, r, f, unfinished, tasks_ok):
        out = {"path": r.path, "declared": sorted(r.declared), "declaredBy": sorted(r.by), "exists": r.exists,
               "git": r.git, "toplevel": r.toplevel, "nested": (r.toplevel != r.path) if r.toplevel else None,
               "rolloutRoot": None, "selfRollout": None, "origin": None, "github": None, "landingRegister": None,
               "defaultBranch": None, "defaultBranchSource": None, "unpushed": [], "verifier": None,
               "unfinishedRollout": [], "blockers": [], "unchecked": [], "errors": []}
        if r.git_why is not None or f is None:
            why = r.git_why or "error"
            out["unchecked"] = [{"check": c, "why": why} for c in CHECKS]
            if r.self_rollout is not None:
                out.update(rolloutRoot=r.rollout_root, selfRollout=r.self_rollout)
            out["errors"] = r.errors
            return out
        out.update(rolloutRoot=r.rollout_root, selfRollout=r.self_rollout, origin=f.origin, github=f.github,
                   landingRegister=f.landing, defaultBranch=f.branch, defaultBranchSource=f.source,
                   unpushed=f.unpushed, verifier=f.verifier)
        blockers, unchecked, errors = list(r.blockers) + f.blockers, list(r.unchecked) + f.unchecked, list(r.errors) + f.errors
        if not tasks_ok:
            unchecked.append({"check": "unfinished-rollout", "why": "vault"})
        else:
            rows = [unfinished[(name, r.root)] for name in sorted(r.by)]
            ran = [x for x in rows if x["exit"] is not None]
            out["unfinishedRollout"] = [{k: x[k] for k in ("project", "verdict", "line", "exit", "stderr")} for x in ran]
            refused = [x for x in ran if x["exit"] == 3]
            broken = [x for x in rows if x["exit"] not in (0, 3)]
            if refused:
                blockers.append({"check": "unfinished-rollout", "why": refused[0]["line"] or "refuse"})
            elif broken:
                unchecked.append({"check": "unfinished-rollout", "why": broken[0]["why"] or "error"})
                for x in broken:
                    if not x["why"]:
                        errors.append({"check": "unfinished-rollout",
                                       "error": "%s: %s" % (x["project"], last_line(x["stderr"]) or "exit %s" % x["exit"])})
        out.update(blockers=ordered(blockers), unchecked=ordered(unchecked),
                   errors=sorted(errors, key=lambda e: CHECK_RANK[e["check"]]))
        return out


def num(x):
    return int(x) if float(x).is_integer() else x


def parse(argv):
    p = Parser(prog="estate-scan", allow_abbrev=False,
               description="The estate pass's deterministic first pass: the estate as JSON (CONTEXT.md Estate scan).")
    p.add_argument("--vault", default=VAULT_DEFAULT)
    p.add_argument("--today")
    p.add_argument("--offline", action="store_true")
    p.add_argument("--jobs", type=int, default=8)
    p.add_argument("--timeout", type=float, default=10.0)
    p.add_argument("--deadline", type=float, default=40.0)
    p.add_argument("--compact", action="store_true")
    args = p.parse_args(argv)
    if args.jobs < 1:
        fail(2, "--jobs must be at least 1")
    if not (args.timeout > 0 and math.isfinite(args.timeout)):
        fail(2, "--timeout must be a positive number of seconds")
    if not (args.deadline >= 0 and math.isfinite(args.deadline)):
        fail(2, "--deadline must be zero or a positive number of seconds")
    if args.today is None:
        args.today = datetime.date.today()
    else:
        try:
            if not ISO_DATE.fullmatch(args.today):
                raise ValueError
            args.today = datetime.date.fromisoformat(args.today)
        except ValueError:
            fail(2, "--today must be a date, YYYY-MM-DD: %r" % args.today)
    return args


def main(argv):
    args = parse(argv)
    RT, RR = load_siblings()
    if RT.NA.yaml is None:
        fail(3, "PyYAML is required: python3 -m pip install pyyaml")
    vroot = os.path.expanduser(args.vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    out = Scan(RT, RR, args).run()
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":")) if args.compact else \
        json.dumps(out, ensure_ascii=False, indent=2)
    sys.stdout.buffer.write((text + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
