#!/usr/bin/env python3
"""git-env-canary.py — the lead's git-env canary: did the shared checkout change during a window? (p14-6)

The lead session (execute § 4.5 *Git-env canary*) opens a **window** around every launch that can run agents or a
verifier against the rollout's shared checkout R (its `Project root:`): a task call, a seeded revise, an integrate
call, a *Lost call* or § 3.7 resume, the lead's own Integration verify and a RACE re-verify. `arm` records R's
`refs/heads/<B>` and its effective bareness before the launch; `check` compares them when the window ends. A
change that is not benign appends a trip line to the rollout note's GIT_ENV_LOG_SECTION, which holds the queue
(reconcile-rollout.py's `_git_env_hold`: `next` halts "git-env", `carry` refuses) until a human acks it through
/thread:repair (`ack`). Nothing here retries, restores or acks on its own. Stdlib only, POSIX only (fcntl), like
every script in this repo.

Verbs (every verb takes --rollout <note>; every verb but `restore` takes --tasks-dir <dir>, default
reconcile-rollout.py's DEFAULT_TASKS_DIR, which must be an existing directory):

  arm --repo R --default B --slug S --kind task|integrate|verify|race-verify
        Runs the common pass (below), then writes this window's open `armed` record, with the ref of the pass's
        single state read, only when the pass exits 0. R bare at arm is itself a trip (`core.bare true at arm`;
        no record). Under a hold it exits 3 and writes no record. A retired rollout: exit 2, nothing created.
  check --repo R --default B --slug S --kind K
        Runs the pass, then closes this window's record: `armed` and clean -> a `checked` tombstone; tripped
        (now or by an earlier verb) -> `closed: true`, no second trip line; a closed tripped record -> unchanged.
        A missing record trips `record missing`, an unreadable one `record unreadable`, and a closed `checked` or
        `acked` tombstone `record not armed`: the owner holds at its own check, so a tombstone left by an earlier
        window with the same slug and kind (a revise, a restart or a resume) means this window was never armed,
        and a check that passed it as clean would let a commit made with no window open go unseen.
  check-all
        The pass alone (R and B from the records). No records: 0, or 3 under a hold.
  ack --repo R --default B --slugs a,b --ref <sha|absent>
        Runs the pass, re-reads the note and the state once more, and refuses (exit 3, nothing more written)
        unless --slugs is exactly the unacked set (the hold's slugs plus every record still `tripped`), R is not
        bare and refs/heads/B is --ref. Nothing to ack: exit 1. Otherwise every open window whose owner still
        holds is re-baselined to `armed` on that read, every other tripped or orphaned record becomes an `acked`
        tombstone, and one ack line is appended and confirmed.
  retire
        check-all (a non-zero exit is returned, nothing deleted), then writes `<dir>/<stem>.retired` and deletes
        `<dir>/<stem>/`, keeping `<dir>/<stem>.lock`.
  restore --repo R --default B [--drop-local <sha> | --bare-only]
        Lock-free; reads the note only to validate, writes only git state. First, before and independently of
        every guard, clears core.bare (the local config, and the worktree config when extensions.worktreeConfig
        is on): that drops nothing, and `ack` refuses while R reads bare, so a refused restore must never leave
        it bare (a pending close-out on B would otherwise deadlock the keep-and-ack route). --bare-only stops
        there and moves no ref. Otherwise it fetches origin's B (`+refs/heads/B:refs/remotes/origin/B`, which
        also overwrites a forged tracking ref), refuses (exit 2, refs unchanged) while local B holds commits not
        on origin unless --drop-local names B's current sha (each such commit listed, the close-out ones marked),
        or while HEAD is on a deleted B; then moves B to origin's B (`reset --keep` when HEAD is on B, else a
        guarded `update-ref`). A drop prints the old sha and the `git branch git-env-rescue-<stamp> <sha>` that
        recovers it.

The common pass (`arm`, `check`, `check-all`, `ack`), under the lock: (1) re-log every `tripped` record whose
trip line is missing from the log; (2) read the state once and compare every `armed` record with it: a
difference marks the record `tripped` (left open while its owner holds), appends its trip line and re-reads the
note to confirm it; a clean record whose owner no longer holds is closed `checked`; (3) exit 3 if the note holds
an unacked trip or any record reads `tripped`, else 0.

Owner rule: an `armed` window can only be open while its vault owner holds: kind `task` while the task note's queue
state is `running`; `integrate`, `verify` and `race-verify` while the note carries `integrating:`. A note missing
from an existing tasks dir counts as holding (fail-closed), with a stderr WARN. An orphan is compared once and
closed.

The comparison (baseline against now; B and O are read by `_read_state`, the only state reader):
  - bareness changed, either ref absent (but not both), or origin's B absent -> a trip;
  - the same ref -> clean;
  - otherwise clean only when every commit of `rev-list new ^O` and of `rev-list old ^new ^O` is close-out-shaped
    and `merge-base old O` is an ancestor of new. That covers land.sh's moves of a local default (S4's
    fast-forward, S5's close-out commit, S11's scratch rebase) and merge-task's `refresh_local_base`, so a
    close-out landed mid-run trips no window (execute § 2.7).
A commit is close-out-shaped when it is not a merge and `git diff-tree --no-commit-id --name-only -r -z --root <c>`
(land.sh S9's command) lists at least one path and only paths `closeout_shaped` accepts (a port of land.sh's:
THREAD.md, */THREAD.md, or a file directly under (*/)docs/handoffs/). This is stricter than land.sh S9, which also
carries an empty non-merge commit and a merge whose other parents are on origin: the canary trips on both, which
fails closed.

Validation, before any git call or write (after the lock for the locking verbs): --repo must resolve (realpath) to
the rollout's `Project root:` (none: exit 2), to every record's repo and to every unacked trip line's `repo`;
--default must pass `git check-ref-format refs/heads/<B>`, carry no `*`, `?` or `[`, and equal every record's
default and every unacked `refs/heads/<B>` trip line's branch. `check-all` and `retire` use the records' own values
(records that disagree: exit 2).

Records live outside the repo: ${THREAD_GIT_ENV_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/thread/git-env}/
<rollout-stem>/<slug>.<kind>.json, {v, slug, kind, repo, default, ref, bare, state, closed, armedAt, trip}, so an
agent's `git clean` or `rm -rf .claude` in the shared checkout never reaches them. Every verb but `restore` holds
`<dir>/<rollout-stem>.lock` (fcntl.flock; 30 s, or THREAD_GIT_ENV_LOCK_TIMEOUT seconds; a timeout is exit 2).
Every git call runs with git's own --local-env-vars list (GIT_DIR, GIT_CONFIG_PARAMETERS, …) and the
GIT_CONFIG_KEY_*/VALUE_* channels scrubbed.

Line formats (the markers and the section heading are reconcile-rollout.py's GIT_ENV_TRIP_MARK, GIT_ENV_ACK_MARK
and GIT_ENV_LOG_SECTION, imported, never copied):
  - <stamp> <GIT_ENV_TRIP_MARK> [[<slug>]] <kind>: <refs/heads/B old→new | core.bare false→true | record missing |
    record unreadable | record not armed | core.bare true at arm>; repo <R>
  - <stamp> <GIT_ENV_ACK_MARK> [[a]], [[b]]: refs/heads/B at <sha|absent>, core.bare false

Exit codes: 0 clean, 3 a trip or a hold, 1 nothing to ack, 2 a failure, a usage or a validation error. The lead
treats every non-zero exit as a halt.
"""

import argparse
import fcntl
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

KINDS = ("task", "integrate", "verify", "race-verify")
LOCK_TIMEOUT = 30.0


def _load_reconcile():
    """reconcile-rollout.py, one source for the markers, queue states, project root and vault path
    (reconcile-project.py's load_note_class pattern; importing it has no side effects)."""
    sys.dont_write_bytecode = True
    src = Path(__file__).resolve().parent / "reconcile-rollout.py"
    spec = importlib.util.spec_from_file_location("reconcile_rollout", src)
    if spec is None or spec.loader is None:
        raise ImportError(f"no loader for {src}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load_reconcile()
Note = RR.Note
_git_env_hold = RR._git_env_hold
_queue_state = RR._queue_state
_scalar = RR._scalar
_scan = RR._scan
_project_root = RR._project_root
DEFAULT_TASKS_DIR = RR.DEFAULT_TASKS_DIR


class CanaryError(Exception):
    def __init__(self, msg, code=2):
        super().__init__(msg)
        self.code = code


def _err(msg):
    print(f"git-env-canary: {msg}", file=sys.stderr)


# ---- git, scrubbed ------------------------------------------------------------------------------------------

_SCRUBBED = None


def _env():
    """os.environ minus git's own repo-local variables (its --local-env-vars list, the GIT_CONFIG_* channels
    included), so an inherited GIT_DIR or `git -c` can never point a read or a write at another repository."""
    global _SCRUBBED
    if _SCRUBBED is None:
        try:
            p = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True)
        except OSError as e:
            raise CanaryError(f"git not runnable: {e}")
        names = p.stdout.split()
        if p.returncode != 0 or not names:
            raise CanaryError("git rev-parse --local-env-vars failed")
        env = {k: v for k, v in os.environ.items()
               if k not in names and not k.startswith(("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"))}
        for k in ("GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"):
            env.pop(k, None)
        _SCRUBBED = env
    return _SCRUBBED


def _git_global(*args):
    """A git call outside any repository (check-ref-format), scrubbed."""
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, env=_env())
    except OSError as e:
        raise CanaryError(f"git {args[0]}: {e}")


def _git(repo, *args):
    """One git call in repo R, scrubbed: the CompletedProcess (returncode, stdout, stderr)."""
    try:
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, env=_env())
    except OSError as e:
        raise CanaryError(f"git {args[0]}: {e}")


def _must(repo, *args):
    p = _git(repo, *args)
    if p.returncode != 0:
        last = ((p.stderr or p.stdout or "").strip().splitlines() or [""])[-1]
        raise CanaryError(f"git -C {repo} {' '.join(args)} exited {p.returncode}: {last}")
    return p.stdout


def _read_state(repo, branch):
    """(bare, ref, origin) of the shared checkout: three separate reads in this fixed order, each a sha or None.

    B is read before O on purpose. Every writer that moves local B onto origin's commits fetches O first and then
    moves B (merge-task.sh refresh_local_base, land.sh S4, S11's scratch_rebase plus move_branch), so an O read
    after the B read is at least as new as the O that B was moved onto. Reading O first could pair a pre-fetch O
    with a post-fast-forward B and trip on origin's own code commits. Each `for-each-ref` must print at most one
    line, naming exactly the ref asked for; anything else (a pattern, a hierarchy, a failed read) is exit 2.
    This is the only place in the script that runs for-each-ref: every later command takes the shas it returns."""
    p = _git(repo, "rev-parse", "--is-bare-repository")
    out = (p.stdout or "").strip()
    if p.returncode != 0 or out not in ("true", "false"):
        raise CanaryError(f"cannot read the bareness of {repo}: {(p.stderr or out).strip()}")
    bare = out == "true"
    shas = []
    for ref in (f"refs/heads/{branch}", f"refs/remotes/origin/{branch}"):
        q = _git(repo, "for-each-ref", "--format=%(objectname) %(refname)", ref)
        if q.returncode != 0:
            raise CanaryError(f"cannot read {ref} in {repo}: {(q.stderr or '').strip()}")
        lines = [ln for ln in (q.stdout or "").splitlines() if ln.strip()]
        if not lines:
            shas.append(None)
            continue
        parts = lines[0].split(" ", 1)
        if len(lines) > 1 or len(parts) != 2 or parts[1].strip() != ref or not re.fullmatch(r"[0-9a-f]{40,64}", parts[0]):
            raise CanaryError(f"{ref} in {repo} does not read as exactly one ref: {' | '.join(lines)}")
        shas.append(parts[0])
    return bare, shas[0], shas[1]


# ---- the comparison -------------------------------------------------------------------------------------------

def closeout_shaped(path):
    """land.sh's closeout_shaped, ported: THREAD.md, */THREAD.md, or a file directly under (*/)docs/handoffs/."""
    if path == "THREAD.md" or path.endswith("/THREAD.md"):
        return True
    if path.startswith("docs/handoffs/"):
        rest = path[len("docs/handoffs/"):]
    elif "/docs/handoffs/" in path:
        rest = path.rsplit("/docs/handoffs/", 1)[1]
    else:
        return False
    return bool(rest) and "/" not in rest


def _closeout_commit(repo, sha):
    """A non-merge commit whose diff lists at least one path, every one close-out-shaped (stricter than S9)."""
    parents = _must(repo, "rev-list", "--parents", "-n", "1", sha).split()[1:]
    if len(parents) > 1:
        return False
    names = [n for n in _must(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--root", sha).split("\0") if n]
    return bool(names) and all(closeout_shaped(n) for n in names)


def _revs(repo, *spec):
    return _must(repo, "rev-list", *spec).split()


def _compare(rec, state):
    """None when the window saw no change that matters, else the trip's reason."""
    bare, new, origin = state
    if bool(rec.get("bare")) != bare:
        return f"core.bare {str(bool(rec.get('bare'))).lower()}→{str(bare).lower()}"
    old = rec.get("ref")
    if old == new:
        return None
    branch = rec.get("default")
    reason = f"refs/heads/{branch} {old or 'absent'}→{new or 'absent'}"
    if old is None or new is None or origin is None:
        return reason
    repo = rec["repo"]
    if not all(_closeout_commit(repo, c) for c in _revs(repo, new, f"^{origin}")):
        return reason
    if not all(_closeout_commit(repo, c) for c in _revs(repo, old, f"^{new}", f"^{origin}")):
        return reason
    mb = _git(repo, "merge-base", old, origin)
    if mb.returncode != 0:
        return reason
    base = mb.stdout.strip()
    anc = _git(repo, "merge-base", "--is-ancestor", base, new)
    if anc.returncode not in (0, 1):
        raise CanaryError(f"git merge-base --is-ancestor exited {anc.returncode}: {anc.stderr.strip()}")
    return None if anc.returncode == 0 else reason


# ---- the rollout's records ------------------------------------------------------------------------------------

class Ctx:
    def __init__(self, args):
        self.rollout = Path(os.path.expanduser(args.rollout))
        if not self.rollout.is_file():
            raise CanaryError(f"rollout note not found at {self.rollout}")
        self.stem = self.rollout.stem
        base = os.environ.get("THREAD_GIT_ENV_DIR") or os.path.join(
            os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state"),
            "thread", "git-env")
        self.base = Path(base)
        self.dir = self.base / self.stem
        self.lock_path = self.base / f"{self.stem}.lock"
        self.retired_path = self.base / f"{self.stem}.retired"
        td = getattr(args, "tasks_dir", None)
        self.tasks_dir = Path(os.path.expanduser(td)) if td is not None else None
        if self.tasks_dir is not None and not self.tasks_dir.is_dir():
            raise CanaryError(f"tasks dir not found: {self.tasks_dir}")
        self.repo = None
        self.default = None
        self._index = None
        self._lock = None

    # -- the note
    def note(self):
        try:
            return Note(self.rollout)
        except (OSError, ValueError) as e:
            raise CanaryError(f"cannot read {self.rollout}: {e}")

    def log_lines(self):
        return [ln.rstrip() for ln in self.note().section_text(RR.GIT_ENV_LOG_SECTION).split("\n") if ln.strip()]

    def append(self, lines):
        """Append each line not already in the log section, then re-read the note to confirm every one."""
        if not lines:
            return
        note = self.note()
        present = {ln.rstrip() for ln in note.section_text(RR.GIT_ENV_LOG_SECTION).split("\n")}
        for line in lines:
            if line not in present:
                note.append_line(RR.GIT_ENV_LOG_SECTION, line)
                present.add(line)
        try:
            note.save()
        except OSError as e:
            raise CanaryError(f"cannot write {self.rollout}: {e}")
        now = set(self.log_lines())
        missing = [ln for ln in lines if ln not in now]
        if missing:
            raise CanaryError(f"the line did not land in {self.rollout}'s {RR.GIT_ENV_LOG_SECTION}: {missing[0]}")

    def hold(self):
        return _git_env_hold(self.note())

    # -- the lock
    def lock(self):
        try:
            self.base.mkdir(parents=True, exist_ok=True)
            fh = open(self.lock_path, "a")
        except OSError as e:
            raise CanaryError(f"cannot open the lock {self.lock_path}: {e}")
        try:
            timeout = float(os.environ.get("THREAD_GIT_ENV_LOCK_TIMEOUT") or LOCK_TIMEOUT)
        except ValueError:
            timeout = LOCK_TIMEOUT
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    fh.close()
                    raise CanaryError(f"timed out after {timeout:g}s waiting for the lock {self.lock_path}")
                time.sleep(0.1)
            except OSError as e:
                fh.close()
                raise CanaryError(f"cannot lock {self.lock_path}: {e}")
        self._lock = fh

    def retired(self):
        return self.retired_path.exists()

    # -- records
    def rec_path(self, slug, kind):
        return self.dir / f"{slug}.{kind}.json"

    def records(self):
        """Every record of this rollout; an unreadable one comes back as {slug, kind, unreadable: True}."""
        if not self.dir.is_dir():
            return []
        out = []
        for p in sorted(self.dir.glob("*.json")):
            name = p.name[:-len(".json")]
            slug, _, kind = name.rpartition(".")
            try:
                rec = json.loads(p.read_text())
                ok = (isinstance(rec, dict) and rec.get("state") in ("armed", "tripped", "checked", "acked")
                      and isinstance(rec.get("slug"), str) and isinstance(rec.get("kind"), str)
                      and isinstance(rec.get("closed"), bool) and isinstance(rec.get("bare"), bool)
                      and (rec.get("ref") is None or isinstance(rec.get("ref"), str))
                      and isinstance(rec.get("repo"), str) and isinstance(rec.get("default"), str)
                      and (rec.get("state") != "tripped" or isinstance((rec.get("trip") or {}).get("line"), str)))
            except (OSError, ValueError):
                ok, rec = False, None
            if not ok:
                rec = {"slug": slug, "kind": kind, "unreadable": True}
            rec["_path"] = p
            out.append(rec)
        return out

    def save(self, rec):
        if self.retired():
            return
        path = self.rec_path(rec["slug"], rec["kind"])
        data = {k: v for k, v in rec.items() if not k.startswith("_") and k != "unreadable"}
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
            os.replace(tmp, path)
        except OSError as e:
            raise CanaryError(f"cannot write the record {path}: {e}")
        rec["_path"] = path

    # -- the owner rule
    def owner_holds(self, rec):
        if self._index is None:
            tasks_dir = self.tasks_dir or DEFAULT_TASKS_DIR
            self._index = _scan(self.rollout, tasks_dir)[1]
        hit = self._index.get(rec["slug"].lower())
        if hit is None:
            print(f"WARN: owner note {rec['slug']} not found under {self.tasks_dir or DEFAULT_TASKS_DIR}", file=sys.stderr)
            return True
        note = hit[1]
        if rec["kind"] == "task":
            return _queue_state(note)[0] == "running"
        return bool(_scalar(note.get("integrating")))


def _stamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _trip_line(slug, kind, reason, repo):
    return f"- {_stamp()} {RR.GIT_ENV_TRIP_MARK} [[{slug}]] {kind}: {reason}; repo {repo}"


def _tripped(rec, reason, repo, closed):
    rec.update(state="tripped", closed=closed, trip={"reason": reason, "line": _trip_line(rec["slug"], rec["kind"], reason, repo)})
    return rec


def _record_target(ctx, recs):
    """(R, B) for the pass's read: the verb's validated flags, else the records' own (which must agree)."""
    if ctx.repo is not None:
        return ctx.repo, ctx.default
    pairs = {(r["repo"], r["default"]) for r in recs if not r.get("unreadable") and r.get("repo")}
    if len(pairs) > 1:
        raise CanaryError(f"the records of {ctx.stem} disagree on the repo or default branch: {sorted(pairs)}")
    return next(iter(pairs)) if pairs else (None, None)


def _pass(ctx, want_state=False):
    """The common pass. Returns (rc, state, records): rc 3 on a hold or any tripped record, else 0."""
    recs = ctx.records()
    repo, branch = _record_target(ctx, recs)
    # Unreadable records trip (closed: their window cannot be known).
    for rec in recs:
        if rec.get("unreadable"):
            rec.update(v=1, repo=repo or "", default=branch or "", ref=None, bare=False, armedAt=None)
            _tripped(rec, "record unreadable", repo or "?", True)
            rec.pop("unreadable", None)
            ctx.save(rec)
    # (1) re-log every tripped record whose line is missing.
    present = set(ctx.log_lines())
    ctx.append([r["trip"]["line"] for r in recs if r["state"] == "tripped" and r["trip"]["line"] not in present])
    # (2) one read, every armed record compared.
    armed = [r for r in recs if r["state"] == "armed"]
    state = None
    if (armed or want_state) and repo is not None:
        state = _read_state(repo, branch)
    lines = []
    for rec in armed:
        reason = _compare(rec, state)
        holds = ctx.owner_holds(rec)
        if reason:
            _tripped(rec, reason, rec["repo"], not holds)
            ctx.save(rec)
            lines.append(rec["trip"]["line"])
        elif not holds:
            rec.update(state="checked", closed=True)
            ctx.save(rec)
    ctx.append(lines)
    # (3) the exit.
    rc = 3 if ctx.hold() or any(r["state"] == "tripped" for r in recs) else 0
    return rc, state, recs


def _report(ctx, rc):
    if rc == 3:
        for t in ctx.hold():
            print(f"HOLD: {t['line']}", file=sys.stderr)
        print(f"git-env: the shared checkout changed during a window: /thread:repair [[{ctx.stem}]] shows the "
              "evidence and records the ack (never acked from execute)", file=sys.stderr)
    return rc


# ---- validation -------------------------------------------------------------------------------------------------

def _validate(ctx, repo=None, default=None):
    """Bind --repo to the rollout's Project root and --default to a plain branch name, both to the records and to
    every unacked trip line. Before any git call on R or any write."""
    hold = ctx.hold()
    recs = [r for r in ctx.records() if not r.get("unreadable")]
    if default is not None:
        if not default or any(c in default for c in "*?[") or _git_global("check-ref-format", f"refs/heads/{default}").returncode != 0:
            raise CanaryError(f"ERROR: --default {default} is not a plain branch name")
        for r in recs:
            if r["default"] and r["default"] != default:
                raise CanaryError(f"ERROR: --default {default} differs from the rollout's recorded default {r['default']}")
        for t in hold:
            m = re.search(r"refs/heads/(\S+) \S+→\S+", t["line"])
            if m and m.group(1) != default:
                raise CanaryError(f"ERROR: --default {default} differs from the rollout's recorded default {m.group(1)}")
        ctx.default = default
    if repo is not None:
        root = _project_root(ctx.note())
        if root is None:
            raise CanaryError(f"ERROR: {ctx.stem} has no `Project root:` line: the canary cannot bind --repo")
        real_root = os.path.realpath(str(root))
        real = os.path.realpath(os.path.expanduser(repo))
        if real != real_root:
            raise CanaryError(f"ERROR: --repo {repo} is not this rollout's repo {real_root}")
        for r in recs:
            if r["repo"] and os.path.realpath(r["repo"]) != real:
                raise CanaryError(f"ERROR: --repo {repo} is not this rollout's repo {r['repo']} (its records)")
        for t in hold:
            m = re.search(r"; repo (.+)$", t["line"])
            if m and m.group(1) != "?" and os.path.realpath(m.group(1)) != real:
                raise CanaryError(f"ERROR: --repo {repo} is not this rollout's repo {m.group(1)} (its trip lines)")
        ctx.repo = real


def _slug_arg(s):
    s = s.strip()
    if s.startswith("[[") and s.endswith("]]"):
        s = s[2:-2]
    return RR._wikilink_slug(s) or s


# ---- verbs ------------------------------------------------------------------------------------------------------

def cmd_arm(ctx, args):
    if ctx.retired():
        raise CanaryError(f"rollout retired: {ctx.stem} takes no new window")
    _validate(ctx, args.repo, args.default)
    rc, state, recs = _pass(ctx, want_state=True)
    bare, ref, _origin = state
    if bare:
        ctx.append([_trip_line(args.slug, args.kind, "core.bare true at arm", ctx.repo)])
        return _report(ctx, 3)
    if rc != 0:
        return _report(ctx, rc)
    rec = {"v": 1, "slug": args.slug, "kind": args.kind, "repo": ctx.repo, "default": ctx.default, "ref": ref,
           "bare": False, "state": "armed", "closed": False, "armedAt": _stamp(), "trip": None}
    ctx.save(rec)
    print(f"armed [[{args.slug}]] {args.kind}: refs/heads/{ctx.default} at {ref or 'absent'}, core.bare false")
    return 0


def cmd_check(ctx, args):
    _validate(ctx, args.repo, args.default)
    rc, _state, recs = _pass(ctx)
    own = next((r for r in recs if r["slug"] == args.slug and r["kind"] == args.kind), None)
    if own is None:
        rec = {"v": 1, "slug": args.slug, "kind": args.kind, "repo": ctx.repo, "default": ctx.default, "ref": None,
               "bare": False, "armedAt": None}
        _tripped(rec, "record missing", ctx.repo, True)
        ctx.save(rec)
        ctx.append([rec["trip"]["line"]])
    elif own["state"] == "armed":
        own.update(state="checked", closed=True)
        ctx.save(own)
    elif own["state"] == "tripped" and not own["closed"]:
        own["closed"] = True
        ctx.save(own)
    elif own["state"] in ("checked", "acked"):
        # A tombstone of an earlier window: this one was never armed (fail closed, never a silent 0).
        rec = {"v": 1, "slug": args.slug, "kind": args.kind, "repo": ctx.repo, "default": ctx.default,
               "ref": own.get("ref"), "bare": False, "armedAt": None}
        _tripped(rec, "record not armed", ctx.repo, True)
        ctx.save(rec)
        ctx.append([rec["trip"]["line"]])
    rc = 3 if ctx.hold() or any(r["state"] == "tripped" for r in ctx.records()) else 0
    if rc == 0:
        print(f"checked [[{args.slug}]] {args.kind}: clean")
    return _report(ctx, rc)


def cmd_check_all(ctx, _args):
    rc, _state, recs = _pass(ctx)
    if rc == 0:
        print(f"check-all {ctx.stem}: clean ({sum(1 for r in recs if r['state'] == 'armed')} window(s) open)")
    return _report(ctx, rc)


def cmd_ack(ctx, args):
    _validate(ctx, args.repo, args.default)
    _pass(ctx)
    hold = ctx.hold()
    recs = ctx.records()
    unacked = {}
    for t in hold:
        unacked.setdefault(t["slug"].lower(), t["slug"])
    for r in recs:
        if r["state"] == "tripped":
            unacked.setdefault(r["slug"].lower(), r["slug"])
    bare, ref, _origin = _read_state(ctx.repo, ctx.default)
    if not unacked:
        print(f"git-env-canary: nothing to ack on {ctx.stem}", file=sys.stderr)
        return 1
    want = {_slug_arg(s).lower() for s in args.slugs.split(",") if s.strip()}
    shown = ", ".join(f"[[{s}]]" for s in unacked.values())
    if want != set(unacked):
        _err(f"--slugs does not match the unacked set {shown}: re-read the evidence and ask again; nothing acked")
        return 3
    if bare:
        _err(f"{ctx.repo} reads as bare: restore it first; nothing acked")
        return 3
    want_ref = None if args.ref == "absent" else args.ref
    if ref != want_ref:
        _err(f"refs/heads/{ctx.default} is at {ref or 'absent'}, not --ref {args.ref}: re-read the evidence and ask "
             "again; nothing acked")
        return 3
    for r in recs:
        if r["state"] in ("armed", "tripped") and not r["closed"] and ctx.owner_holds(r):
            r.update(state="armed", closed=False, ref=ref, bare=False, trip=None, armedAt=_stamp())
            ctx.save(r)
        elif r["state"] in ("armed", "tripped"):
            r.update(state="acked", closed=True)
            ctx.save(r)
    line = (f"- {_stamp()} {RR.GIT_ENV_ACK_MARK} {', '.join(f'[[{s}]]' for s in unacked.values())}: "
            f"refs/heads/{ctx.default} at {ref or 'absent'}, core.bare false")
    ctx.append([line])
    print(line[2:])
    return 0


def cmd_retire(ctx, args):
    rc = cmd_check_all(ctx, args)
    if rc != 0:
        return rc
    try:
        ctx.retired_path.write_text(_stamp() + "\n")
        if ctx.dir.is_dir():
            shutil.rmtree(ctx.dir)
    except OSError as e:
        raise CanaryError(f"cannot retire {ctx.dir}: {e}")
    print(f"retired {ctx.stem}: records removed, {ctx.retired_path.name} written")
    return 0


def _clear_bare(repo):
    """Clear core.bare in the local config, and in the worktree config when extensions.worktreeConfig is on.
    True when R read bare and now does not; a repo still bare after the fix is exit 2. It drops nothing."""
    p = _git(repo, "rev-parse", "--is-bare-repository")
    if p.returncode != 0 or p.stdout.strip() not in ("true", "false"):
        raise CanaryError(f"cannot read the bareness of {repo}: {(p.stderr or p.stdout).strip()}")
    if p.stdout.strip() == "false":
        return False
    _must(repo, "config", "--local", "core.bare", "false")
    wt = _git(repo, "config", "--local", "--bool", "--get", "extensions.worktreeConfig")
    if wt.stdout.strip() == "true":
        u = _git(repo, "config", "--worktree", "--unset-all", "core.bare")
        if u.returncode not in (0, 5):
            raise CanaryError(f"cannot unset the worktree core.bare: {u.stderr.strip()}")
    if _git(repo, "rev-parse", "--is-bare-repository").stdout.strip() != "false":
        raise CanaryError(f"{repo} still reads as bare after the config fix")
    return True


def cmd_restore(ctx, args):
    _validate(ctx, args.repo, args.default)
    repo, branch = ctx.repo, ctx.default
    if args.bare_only and args.drop_local is not None:
        raise CanaryError("usage: --bare-only moves no ref, so it takes no --drop-local")
    # Before every guard: clearing core.bare drops nothing, and ack refuses while R reads bare.
    cleared = _clear_bare(repo)
    if cleared:
        print("restore: core.bare cleared (local and worktree config)", file=sys.stderr)
    if args.bare_only:
        _bare, local, _origin = _read_state(repo, branch)
        print(f"restored: core.bare false; refs/heads/{branch} left at {local or 'absent'}")
        return 0
    f = _git(repo, "fetch", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}")
    if f.returncode != 0:
        raise CanaryError(f"fetch of origin's {branch} failed: {f.stderr.strip()}")
    bare, local, origin = _read_state(repo, branch)
    if origin is None:
        raise CanaryError(f"origin has no {branch} after the fetch: nothing to restore to")
    ahead = _revs(repo, local, f"^{origin}") if local else []
    if ahead and args.drop_local != local:
        print(f"restore: refs/heads/{branch} ({local}) holds {len(ahead)} commit(s) not on origin/{branch} ({origin}); "
              "restore drops them:", file=sys.stderr)
        for c in ahead:
            mark = "   <- a close-out § 2.7 wants landed: restore drops it; keep it with ack instead" if _closeout_commit(repo, c) else ""
            print(_must(repo, "log", "--oneline", "--stat", "-n", "1", c).rstrip() + mark, file=sys.stderr)
        print(f"restore: refs unchanged, core.bare false, so `ack --ref {local}` keeps them; to drop them "
              f"(recoverable), re-run with --drop-local {local}", file=sys.stderr)
        return 2
    head = _git(repo, "symbolic-ref", "-q", "HEAD")
    on_b = head.returncode == 0 and head.stdout.strip() == f"refs/heads/{branch}"
    if on_b and local is None:
        print(f"restore: HEAD is on refs/heads/{branch}, which is deleted; refs unchanged. By hand:\n"
              f"  git -C {repo} update-ref refs/heads/{branch} {origin}\n"
              f"  git -C {repo} status   # then reset --keep {origin} if the tree should match", file=sys.stderr)
        return 2
    if bare:
        raise CanaryError(f"{repo} reads as bare again after the config fix")
    if local != origin:
        if on_b:
            k = _git(repo, "reset", "--keep", origin)
            if k.returncode != 0:
                raise CanaryError(f"reset --keep {origin} refused, nothing moved: {(k.stderr or k.stdout).strip()}")
        else:
            _must(repo, "update-ref", f"refs/heads/{branch}", origin, local or "0" * 40)
    if ahead:
        stamp = datetime.now().strftime("%Y%m%d%H%M%S")
        print(f"dropped {len(ahead)} local commit(s); old {branch} was {local}; recover with: "
              f"git -C {repo} branch git-env-rescue-{stamp} {local}", file=sys.stderr)
    print(f"restored: refs/heads/{branch} at {origin}, core.bare false")
    return 0


VERBS = {"arm": cmd_arm, "check": cmd_check, "check-all": cmd_check_all, "ack": cmd_ack, "retire": cmd_retire,
         "restore": cmd_restore}


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise CanaryError(f"usage: {message}")


def main(argv=None):
    ap = _Parser(prog="git-env-canary.py", description="the lead's git-env canary (execute § 4.5)")
    sub = ap.add_subparsers(dest="verb", required=True, parser_class=_Parser)
    for name in ("arm", "check", "check-all", "ack", "retire", "restore"):
        p = sub.add_parser(name)
        p.add_argument("--rollout", required=True)
        if name != "restore":
            p.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
        if name in ("arm", "check", "ack", "restore"):
            p.add_argument("--repo", required=True)
            p.add_argument("--default", required=True)
        if name in ("arm", "check"):
            p.add_argument("--slug", required=True)
            p.add_argument("--kind", required=True, choices=KINDS)
        if name == "ack":
            p.add_argument("--slugs", required=True)
            p.add_argument("--ref", required=True)
        if name == "restore":
            p.add_argument("--drop-local", default=None)
            p.add_argument("--bare-only", action="store_true")
    try:
        args = ap.parse_args(argv)
        ctx = Ctx(args)
        if args.verb != "restore":
            ctx.lock()
        return VERBS[args.verb](ctx, args)
    except CanaryError as e:
        msg = str(e)
        print(msg if msg.startswith("ERROR:") else f"git-env-canary: {msg}", file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
