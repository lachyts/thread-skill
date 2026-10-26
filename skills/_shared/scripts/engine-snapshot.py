#!/usr/bin/env python3
"""engine-snapshot.py — a rollout runs on its Engine snapshot (ADR 0043; skills/_shared/engine-snapshot.md says when).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py cut [--verb V] [--prose-id H]
        [--tasks-dir D] [--now T]
    python3 <snapshot>/skills/_shared/scripts/engine-snapshot.py adopt --rollout <note> [--tasks-dir D] [--now T]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py resolve --rollout <note> [--verb V]
        [--prose-id H] [--tasks-dir D]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py retire [--tasks-dir D] [--now T]
        [--grace-hours 24]
    python3 <root>/skills/_shared/scripts/engine-snapshot.py guard-pr --pr-url U --root R --script S [--tasks-dir D]

Stdlib only, python >= 3.8, POSIX (fcntl). Every git call runs with git's repo-local env vars removed (`git rev-parse
--local-env-vars`; the GIT_CONFIG_* channels kept, as they cannot move the repo), GIT_TERMINAL_PROMPT=0 and, for the
two calls that reach origin (default-branch.sh's ls-remote and the fetch), `ssh -o BatchMode=yes` unless the operator
set an ssh command (GIT_SSH_COMMAND, GIT_SSH or core.sshCommand: land.sh's rule). This header is the one copy of the
rules below; the doc (skills/_shared/engine-snapshot.md) says when each verb runs.

The stamp grammar. `engine-snapshot.py adopt` writes two frontmatter lines just below `protocol_version:`, and nothing
else ever writes them (never by hand):

    engine_snapshot: "~/repos/tools/thread-skill-snapshots/0123456789ab"   # the snapshot's path, ~/-form under HOME
    engine_sha: 0123456789abcdef0123456789abcdef01234567                    # its HEAD, 40 (or 64) hex

A note with no `engine_snapshot:` is unstamped (scheduled before P29, or on a version-cache install).

The Primary (git_primary(root), the one copy of the rule; primary-hold.sh carries the same test in bash). `root` is
the realpath of a plugin root (this script's, three levels up, by default). Each step runs with the scrubbed env:
  (a) `git -C root rev-parse --show-toplevel` must succeed and its realpath equal `root`; otherwise there is no git
      Primary: "the plugin root is not its work tree's toplevel (a version-cache install)". A version-cache copy,
      even one nested in another repo (~/.claude's own config repo), stops here.
  (b) `common = realpath(git -C root rev-parse --path-format=absolute --git-common-dir)`; its basename must be
      `.git` and `dirname(common)` must be the toplevel of its own work tree; otherwise "no checkout owns <common>"
      (a bare repo with worktrees has no Primary).
  (c) The Primary is `dirname(common)`: the root itself for a main checkout, the main checkout for a snapshot or any
      other linked worktree.

A snapshot is a detached, `git worktree lock`ed linked worktree of the Primary's repo at `refs/remotes/origin/<d>`
read right after a fresh `git fetch origin <d>` (<d> from default-branch.sh), at
`<dirname(primary)>/<basename(primary)>-snapshots/<sha12>`: one per origin tip, shared by every rollout cut there.
It is never the Primary's HEAD or working tree. The lock reason is "thread Engine snapshot (ADR 0043)".
A snapshot is usable at sha S when its directory exists, is its own work tree's toplevel, sits detached at S, has no
tracked change (`git status --untracked-files=no`: __pycache__ and an `ident` expansion read clean) and holds this
script. Otherwise it is `gone`, `moved …`, `edited …` or `not an engine snapshot …`.

The engine root of a note (resolve's `root`, and the root guard() wants):
- unstamped: the Primary when git_primary() finds one (from the Primary or from any snapshot of it), else the running
  root (a version-cache install, even one nested in an unrelated repo);
- stamped, live (directly in the tasks dir, never under Archive/): the snapshot when it is usable, else resolve
  exits 3 with the reason and the remedy, and guard() refuses with them;
- stamped, archived (any path under an `Archive/` directory): the snapshot when it is usable; when it is not
  (`gone: true`), the unstamped root.

The move rule (resolve's `move: {due, why}`, its one copy; execute § 1.5 acts on it). due is true only for a stamped
note that is not archived, whose `status` is neither done nor dropped, with no `superseded_by:`, and:
- parallel (no `shape:` or anything but serial): `paused:` is set and `paused_for:` is empty: a hard pause, so this
  /thread:execute is its Reinstate. A sign-off pause (`paused_for: sign-off`, ADR 0034) is false, why "sign-off pause
  (ADR 0034): the engine's own pause, never a move": its reinstate runs on the note's snapshot and the session's
  signed-gate handles keep their cache replay. Any other `paused_for:` is the engine's pause too, and false;
- serial: the `## Leg log`'s last `Leg <N> closed:` line is `closed: stopped: …` and no `Leg <M> began:` line with
  M > N follows it. A halted, stuck, lost or handoff close moves nothing.
A launch, a heartbeat, a cold resume, a Stage re-send or a repair hand-off is none of these, so it cuts nothing.

The prose-id rule. skills/{schedule,execute,status,repair}/SKILL.md carry git's `ident` attribute (.gitattributes),
so each checkout expands the one `$Id$` marker in its hand-over block to `$Id: <blob id> $`, the id of that file as
committed. prose_id(path) collapses every `$Id: … $` back to `$Id$` and returns git's blob id of the result (sha1,
or sha256 when the file embeds a 64-hex id or the id compared is 64 hex), with no git call, so a cache root works too.
`prose.identical` is true only when --prose-id was given (40 or 64 hex; anything else is no id), it equals `rootId`
(the engine root's own skills/<verb>/SKILL.md id) and the running root's own copy does not contradict it: when that
copy embeds the same id, its recomputed id must equal it too (an edit under an unchanged `$Id` line is caught). The
script never compares two copies on disk with each other: only the id carried by the text being followed counts.

The retire keep-list (retire, and cut's best-effort sweep, under the home lock `<home>/.lock`). A `<sha12>`
directory in the home is kept when it is: this script's own root; the snapshot a cut just made; named by any live
note's `engine_snapshot:` (every `*.md` directly in the tasks dir, hard-paused or past its last merge included);
named by a `<tasks>/Archive/Rollouts/*.md` note whose mtime is within the grace (24 h) of --now (`kept <sha12>:
archived [[<slug>]] within 24h`: legs.md § Complete archives the note before its step 5 /thread:close runs, and both
archive writers write the note, then rename it, so the mtime is the archival time); or unnamed with a `.cut` marker
(`<home>/.cut/<sha12>`, else the directory itself) younger than the grace. Everything is kept when the tasks dir is
missing or unreadable, a live note cannot be read, or `Archive/Rollouts/` exists but cannot be listed (a missing one
is no archived notes). The rest is retired: `worktree unlock`, `worktree remove --force --force`, then one `worktree
prune`. A directory that is no worktree of the Primary is never removed (`kept <sha12>: … remove failed`).

Verbs.
  cut     No git Primary: exit 4, stdout empty, one stderr line with the reason; no git call reaches any origin.
          Otherwise default-branch.sh <primary>, then `git -C <primary> fetch -q origin +refs/heads/<d>:refs/remotes/
          origin/<d>` (retried once; a failure is exit 2, never a stale-ref fallback); a tip without this script is
          exit 3; a home whose parent is inside a work tree that does not ignore it is exit 3, nothing created; the
          home lock (exit 2 after 60 s). It reuses `<home>/<sha12>` only when that is a usable snapshot of the same
          repo at that sha (else exit 3: move it aside), or runs `worktree add --detach` then `worktree lock`. It
          touches `<home>/.cut/<sha12>`, runs the retire sweep sparing the snapshot just cut (its `retired` lines
          go to stderr), and prints one JSON line: {snapshot, sha, sha12, reused, primary, default,
          prose: {verb, rootId, identical} | null}.
  adopt   Run from a snapshot of git_primary() (a linked worktree, detached, tracked-clean, its directory named
          HEAD[:12] inside `<basename(primary)>-snapshots` beside the Primary), else exit 2. An archived note, or one
          not found, is exit 2. Under the note lock, through reconcile-rollout.py's Note save (loaded from this
          root), it writes the two stamps just below `protocol_version:`, runs MIGRATIONS (none yet) on a move, and
          on a move appends `- <now> engine snapshot moved at reinstate: <old12> → <new12> (ADR 0043)` to `## Notes`.
          Idempotent. Prints {snapshot, sha, from (the old engine_sha on a move, else null), changed}.
  resolve Read-only. Reads only engine_snapshot, engine_sha, shape, status, paused, paused_for, superseded_by and the
          Leg log's `closed:` and `began:` lines; never protocol_version. Exit 0 prints {rollout, note, snapshot, sha,
          root, same, gone, goneWhy, archived, prose, move: {due, why}, primary, primaryHead, ahead, behind}
          (`primary` and the three after it null with no git Primary; ahead and behind count engine_sha against the
          Primary's HEAD, null for an unstamped note). Exit 3 (a live note whose snapshot is unusable): stdout
          empty, one stderr line with the reason and the remedy. Exit 2: usage, or no note.
  retire  No git Primary: `retire: no git Primary (<why>): nothing to retire`, exit 0. Otherwise the keep-list
          above, one `retired <sha12>` or `kept <sha12>: <why>` line each; exit 0 (2 only on a usage error).
  guard-pr Every live task note (directly in the tasks dir) whose `pr:` names U (owner/name ignoring case, and the
          number) is checked with guard_task(); the first refusal is its stderr line and exit 2. Exit 0 passes (no
          vault, no such note, an unstamped rollout), 1 is its own failure. merge-task.sh calls it.

Importable (each guarded script loads this file from its own tree with importlib): guard(note, root, script_rel)
and guard_task(task_note, root, script_rel, tasks_dir=None) return None to pass or the refusal line, which always
starts `engine-snapshot: ` and names the root to re-run from; they never raise and refuse only on positive evidence
(a stamp naming another usable snapshot, or a live note's unusable one). The guarded CLIs print it on stderr, exit
2 and write nothing. prose_id(path), git_primary(root), engine_root(note), move_rule(), read_head().
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.realpath(__file__))
ROOT = os.path.realpath(os.path.join(HERE, "..", "..", ".."))
SELF_REL = "skills/_shared/scripts/engine-snapshot.py"
DEFAULT_BRANCH_REL = "skills/execute/scripts/default-branch.sh"
RR_REL = "skills/execute/scripts/reconcile-rollout.py"
DEFAULT_TASKS_DIR = "~/repos/obsidian/Work/Tasks"
LOCK_REASON = "thread Engine snapshot (ADR 0043)"
GRACE_HOURS = 24.0
LOCK_TIMEOUT = 60.0
FETCH_TIMEOUT = 300
HEAD_BYTES = 16384
SIGN_OFF_WHY = "sign-off pause (ADR 0034): the engine's own pause, never a move"
SHA12_RE = re.compile(r"[0-9a-f]{12}\Z")
SHA_RE = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
ID_RE = re.compile(rb"\$Id:[^$\n]*\$")
EMBED_RE = re.compile(rb"\$Id: ([0-9a-f]{40}|[0-9a-f]{64}) \$")
KEY_RE = re.compile(r"([A-Za-z0-9_-]+):(.*)$")
LEG_RE = re.compile(r"^- (\S+) Leg (\d+) (began|closed):(.*)$")
PR_URL_RE = re.compile(r"https?://github\.com/([^/\s]+)/([^/\s]+)/pull/([1-9][0-9]*)(?:[/?#]\S*)?", re.I)
# A note-format migration applied at a move, in order: fn(note, old_sha, new_sha). None yet: the stamps are the only
# per-rollout format a Reinstate crosses so far (ADR 0043 Consequences, cross-version state).
MIGRATIONS = []


class Fail(Exception):
    def __init__(self, code, msg):
        Exception.__init__(self, msg)
        self.code, self.msg = code, msg


# ---- git, scrubbed ------------------------------------------------------------------------------------------------

_ENV = None


def git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.; GIT_CONFIG_* kept), with GIT_TERMINAL_PROMPT=0."""
    global _ENV
    if _ENV is None:
        base = {k: v for k, v in os.environ.items() if not k.startswith("GIT_") or k.startswith("GIT_CONFIG_")}
        try:
            names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, timeout=30, env=base).stdout.split()
        except (OSError, subprocess.SubprocessError):
            names = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]
        env = dict(os.environ)
        for name in names:
            if not name.startswith("GIT_CONFIG_"):
                env.pop(name, None)
        env["GIT_TERMINAL_PROMPT"] = "0"
        _ENV = env
    return _ENV


def git(cwd, *args, timeout=120, env=None):
    try:
        return subprocess.run(["git", "-C", str(cwd)] + list(args), env=env or git_env(), capture_output=True,
                              text=True, stdin=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "timed out after %ss" % timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return subprocess.CompletedProcess(args, 99, "", str(e))


def git_out(cwd, *args, **kw):
    r = git(cwd, *args, **kw)
    return r.stdout.strip() if r.returncode == 0 else None


def first_line(text):
    for line in (text or "").split("\n"):
        if line.strip():
            return line.strip()
    return ""


def remote_env(primary):
    """git_env() plus land.sh's ssh rule: BatchMode unless the operator set an ssh command."""
    env = dict(git_env())
    if not env.get("GIT_SSH_COMMAND") and not env.get("GIT_SSH") and not git_out(primary, "config", "core.sshCommand"):
        env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes"
    return env


def run_group(argv, env, timeout):
    """argv in its own process group, killed whole on expiry: (rc, stdout, stderr)."""
    try:
        p = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, start_new_session=True)
    except OSError as e:
        return 99, "", str(e)
    try:
        out, err = p.communicate(timeout=timeout)
        return p.returncode, out, err
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        for f in (p.stdout, p.stderr):
            try:
                f.close()
            except OSError:
                pass
        p.wait()
        return 124, "", "timed out after %ss" % timeout


# ---- paths and notes ----------------------------------------------------------------------------------------------

def real(p):
    return os.path.realpath(os.path.expanduser(str(p)))


def tilde(p):
    """p in ~/-form when it sits under HOME (the stamp's form), else its realpath."""
    p, home = real(p), real("~")
    return "~/" + os.path.relpath(p, home) if p.startswith(home.rstrip("/") + "/") else p


def scalar(raw):
    """A frontmatter scalar: quotes, an inline ` # comment` and whitespace dropped; YAML's null reads ''."""
    if raw is None:
        return ""
    v = str(raw).strip()
    if v[:1] in ('"', "'"):
        end = v.find(v[0], 1)
        v = v[1:end] if end > 0 else v[1:]
    else:
        v = re.split(r"\s#", v, maxsplit=1)[0]
    v = v.strip()
    return "" if v.lower() in ("null", "~") else v


def wiki_slug(value):
    s = scalar(value).replace("[[", "").replace("]]", "").strip()
    s = re.split(r"[|#^]", s, maxsplit=1)[0].rstrip().rstrip("\\").split("/")[-1].strip()
    return s[:-3] if s.endswith(".md") else s


def read_head(path, limit=HEAD_BYTES):
    """The note's frontmatter as {key: raw value} (the first line of each key), {} when it has none. OSError when the
    note cannot be read. Only the head is read unless the frontmatter runs past `limit` bytes."""
    with open(path, "rb") as f:
        data = f.read(limit)
        text = data.decode("utf-8", "replace")
        if not text.startswith("---\n"):
            return {}
        end = text.find("\n---", 3)
        if end < 0 and len(data) == limit:
            text += f.read().decode("utf-8", "replace")
            end = text.find("\n---", 3)
    if end < 0:
        return {}
    fm = {}
    for line in text[4:end].split("\n"):
        m = KEY_RE.match(line)
        if m and m.group(1) not in fm:
            fm[m.group(1)] = m.group(2)
    return fm


def is_archived(path):
    return "Archive" in os.path.realpath(str(path)).split(os.sep)


def find_note(raw, tasks_dir):
    """The note for --rollout: a path, else `<tasks>/<slug>.md`, else its `Archive/Rollouts/` copy; None if none."""
    p = os.path.expanduser(raw)
    if os.path.isfile(p):
        return os.path.abspath(p)
    td = os.path.expanduser(tasks_dir or DEFAULT_TASKS_DIR)
    name = os.path.basename(p) if "/" in raw else (wiki_slug(raw) or raw)
    name = name if name.endswith(".md") else name + ".md"
    for cand in (os.path.join(td, name), os.path.join(td, "Archive", "Rollouts", name)):
        if os.path.isfile(cand):
            return os.path.abspath(cand)
    return None


def leg_events(text):
    """[(n, kind, rest)] for each `Leg <N> began:` / `Leg <N> closed:` line of the `## Leg log`, in order."""
    out, inlog = [], False
    for line in text.split("\n"):
        if line.startswith("## "):
            inlog = line.strip() == "## Leg log"
            continue
        if inlog:
            m = LEG_RE.match(line.rstrip())
            if m:
                out.append((int(m.group(2)), m.group(3), m.group(4).strip()))
    return out


# ---- the Primary and snapshots ------------------------------------------------------------------------------------

def git_primary(root=None):
    """(the Primary checkout's realpath, None), or (None, why there is none). The header's rule, its one copy."""
    root = real(root or ROOT)
    top = git_out(root, "rev-parse", "--show-toplevel")
    if not top or real(top) != root:
        return None, "the plugin root is not its work tree's toplevel (a version-cache install)"
    common = git_out(root, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if not common:
        return None, "git names no common dir for %s" % root
    common = real(common)
    main = os.path.dirname(common)
    if os.path.basename(common) != ".git":
        return None, "no checkout owns %s" % common
    t2 = git_out(main, "rev-parse", "--show-toplevel")
    if not t2 or real(t2) != main:
        return None, "no checkout owns %s" % common
    return main, None


def home_of(primary):
    return os.path.join(os.path.dirname(primary), os.path.basename(primary) + "-snapshots")


def snapshot_problem(path, sha=None, primary=None):
    """None when `path` is a usable snapshot (at `sha`, of `primary`'s repo, when given), else why not."""
    if not os.path.isdir(path):
        return "gone"
    p = real(path)
    top = git_out(p, "rev-parse", "--show-toplevel")
    if not top or real(top) != p:
        return "not its own work tree any more"
    if primary is not None:
        common = git_out(p, "rev-parse", "--path-format=absolute", "--git-common-dir")
        if not common or real(common) != os.path.join(real(primary), ".git"):
            return "not a worktree of %s" % primary
    head = git_out(p, "rev-parse", "--verify", "-q", "HEAD")
    if sha and head != sha:
        return "moved (HEAD %s, not %s)" % ((head or "unreadable")[:12], sha[:12])
    if git(p, "symbolic-ref", "-q", "HEAD").returncode == 0:
        return "moved (on a branch, not detached)"
    st = git(p, "status", "--porcelain", "--untracked-files=no")
    if st.returncode != 0:
        return "unreadable (git status failed: %s)" % first_line(st.stderr)
    if st.stdout.strip():
        return "edited (tracked files changed)"
    if not os.path.isfile(os.path.join(p, SELF_REL)):
        return "not an engine snapshot (no %s)" % SELF_REL
    return None


def remedy(snap, sha, problem):
    """The fix for an unusable snapshot of a live note: put the same engine back (the stamp's sha), never a move."""
    primary = git_primary(ROOT)[0] or "<the Primary checkout>"
    if problem == "gone":
        return ("restore it at its sha: git -C %s worktree add --detach %s %s, then git -C %s worktree lock --reason "
                "\"%s\" %s (a Reinstate re-cuts it onto origin's tip instead)" % (primary, snap, sha or "<engine_sha>",
                                                                                  primary, LOCK_REASON, snap))
    if problem.startswith("moved"):
        return "put it back: git -C %s checkout -q --detach %s" % (snap, sha or "<engine_sha>")
    if problem.startswith("edited"):
        return "a snapshot is never edited: see git -C %s status, then restore it with git -C %s checkout -- ." % (snap,
                                                                                                                 snap)
    return "restore %s at %s, or move the rollout at its next Reinstate (engine-snapshot.md)" % (snap,
                                                                                                   sha or "its sha")


def engine_root(path, root=None):
    """The note's engine root (the header's rule): a dict, `root` None when a live note's snapshot is unusable."""
    root = real(root or ROOT)
    fm = read_head(path)
    stamp, sha = scalar(fm.get("engine_snapshot")), scalar(fm.get("engine_sha"))
    archived = is_archived(path)
    out = {"fm": fm, "stamped": bool(stamp), "snapshot": real(stamp) if stamp else None, "sha": sha or None,
           "archived": archived, "gone": False, "goneWhy": None, "unusable": None}
    if stamp:
        problem = snapshot_problem(out["snapshot"], sha or None)
        if problem is None:
            out["root"] = out["snapshot"]
            return out
        if not archived:
            out["root"], out["unusable"] = None, problem
            return out
        out["gone"], out["goneWhy"] = True, problem
    primary = git_primary(root)[0]
    out["root"] = primary or root
    return out


def move_rule(fm, body, stamped, archived):
    """(due, why): the header's move rule, its one copy."""
    if not stamped:
        return False, "no engine_snapshot: stamp (an unstamped note runs from the Primary checkout, as before P29)"
    if archived:
        return False, "archived: the rollout is finished"
    status = scalar(fm.get("status")).lower()
    if status in ("done", "dropped"):
        return False, "status %s: nothing runs it" % status
    if scalar(fm.get("superseded_by")):
        return False, "superseded: nothing runs it"
    if scalar(fm.get("shape")).lower() == "serial":
        ev = leg_events(body)
        closed = [(i, n, rest) for i, (n, kind, rest) in enumerate(ev) if kind == "closed"]
        if not closed:
            return False, "serial: no Leg has closed stopped"
        i, n, rest = closed[-1]
        if not rest.startswith("stopped:"):
            word = (rest.split(" ", 1)[0] or "?").rstrip(":")
            return False, "serial: Leg %d closed %s: only a stopped close moves a chain" % (n, word)
        if any(kind == "began" and m > n for (m, kind, _r) in ev[i + 1:]):
            return False, "serial: a Leg began after Leg %d's stopped close: its Reinstate has passed" % n
        return True, "serial Reinstate: the first Leg begun after Leg %d closed stopped" % n
    if not scalar(fm.get("paused")):
        return False, "not paused: only a Reinstate (a hard pause, then /thread:execute) moves a rollout"
    pf = scalar(fm.get("paused_for"))
    if pf:
        if pf.lower() == "sign-off":
            return False, SIGN_OFF_WHY
        return False, "the engine's own pause (paused_for: %s), never a move" % pf
    return True, "a hard pause: this /thread:execute is its Reinstate"


# ---- the prose id -------------------------------------------------------------------------------------------------

def _read_bytes(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def embedded_id(path):
    data = _read_bytes(path)
    m = EMBED_RE.search(data) if data is not None else None
    return m.group(1).decode() if m else None


def prose_id(path, algo=None):
    """git's blob id of `path` with every `$Id: … $` collapsed to `$Id$` (what `git add` stores), or None."""
    data = _read_bytes(path)
    if data is None:
        return None
    if algo is None:
        m = EMBED_RE.search(data)
        algo = "sha256" if m and len(m.group(1)) == 64 else "sha1"
    body = ID_RE.sub(b"$Id$", data)
    h = hashlib.new(algo)
    h.update(b"blob %d\0" % len(body))
    h.update(body)
    return h.hexdigest()


def prose(verb, given, target_root, running_root=None):
    """{verb, rootId, identical} by the header's prose-id rule, or None with no verb."""
    if not verb:
        return None
    running_root = real(running_root or ROOT)
    rel = os.path.join("skills", verb, "SKILL.md")
    given = (given or "").strip().lower()
    if not SHA_RE.match(given):
        given = ""  # a bare `$Id$`, a mistyped or a missing id is no id: the text is re-read
    algo = "sha256" if len(given) == 64 else ("sha1" if given else None)
    root_id = prose_id(os.path.join(target_root, rel), algo)
    identical = bool(given and root_id and given == root_id)
    if identical:
        own = os.path.join(running_root, rel)
        if embedded_id(own) == given and prose_id(own, algo) != given:
            identical = False   # the running root's copy says it was edited under that id line
    return {"verb": verb, "rootId": root_id, "identical": identical}


# ---- guards -------------------------------------------------------------------------------------------------------

def _guard(note, root, script_rel):
    path = os.path.expanduser(str(note))
    if not os.path.isfile(path):
        return None
    fm = read_head(path)
    stamp = scalar(fm.get("engine_snapshot"))
    if not stamp:
        return None
    snap, here = real(stamp), real(root or ROOT)
    if snap == here:
        return None
    sha = scalar(fm.get("engine_sha"))
    slug = os.path.splitext(os.path.basename(path))[0]
    problem = snapshot_problem(snap, sha or None)
    if problem is None:
        where = os.path.join(snap, script_rel) if script_rel else snap
        return ("engine-snapshot: [[%s]] runs on its Engine snapshot %s (%s), not on %s: re-run the same command "
                "from that root (%s; skills/_shared/engine-snapshot.md)" % (slug, tilde(snap), (sha or "?")[:12], here,
                                                                           where))
    if is_archived(path):
        return None   # an archived note whose snapshot is gone runs anywhere (its Leg's close, file-followup)
    return "engine-snapshot: [[%s]]'s Engine snapshot %s is %s: %s" % (slug, tilde(snap), problem,
                                                                        remedy(snap, sha, problem))


def guard(note, root=None, script_rel=None):
    """None to go on, else the refusal line (starts `engine-snapshot: `). Never raises; only positive evidence
    refuses: a stamp naming another root that is a usable snapshot, or a live note whose snapshot is unusable."""
    try:
        return _guard(note, root, script_rel)
    except Exception:  # noqa: BLE001 — a guard that cannot read passes
        return None


def guard_task(task_note, root=None, script_rel=None, tasks_dir=None):
    """guard() for the rollout a task note's `rollout:` names (in tasks_dir, default the task's dir, then its
    Archive/Rollouts/ copy). None when it names none or the rollout note is not found."""
    try:
        path = os.path.expanduser(str(task_note))
        slug = wiki_slug(read_head(path).get("rollout"))
        if not slug:
            return None
        td = os.path.expanduser(str(tasks_dir)) if tasks_dir else os.path.dirname(os.path.abspath(path))
        for cand in (os.path.join(td, slug + ".md"), os.path.join(td, "Archive", "Rollouts", slug + ".md")):
            if os.path.isfile(cand):
                return guard(cand, root, script_rel)
        return None
    except Exception:  # noqa: BLE001
        return None


# ---- the home lock and the sweep ----------------------------------------------------------------------------------

class HomeLock:
    def __init__(self, home, timeout=LOCK_TIMEOUT):
        self.path, self.timeout, self.fh, self.ok = os.path.join(home, ".lock"), timeout, None, False

    def __enter__(self):
        try:
            self.fh = open(self.path, "a")
        except OSError:
            return self   # not ok: the caller says the lock could not be taken
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.ok = True
                return self
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    return self
                time.sleep(0.1)

    def __exit__(self, *exc):
        if self.fh is not None:
            self.fh.close()
        return False


def _hours(h):
    return "%dh" % h if float(h).is_integer() else "%gh" % h


def named_snapshots(tasks_dir, now, grace_h):
    """({snapshot realpath: why kept}, None), or (None, why everything is kept)."""
    td = real(tasks_dir)
    try:
        names = sorted(os.listdir(td))
    except OSError as e:
        return None, "the tasks dir %s cannot be read (%s): everything kept" % (tasks_dir, e.strerror or e)
    out = {}
    for n in names:
        p = os.path.join(td, n)
        if not n.endswith(".md") or not os.path.isfile(p):
            continue
        try:
            stamp = scalar(read_head(p).get("engine_snapshot"))
        except OSError as e:
            return None, "the live note %s cannot be read (%s): everything kept" % (n, e.strerror or e)
        if stamp:
            out.setdefault(real(stamp), "named by [[%s]]" % n[:-3])
    arch = os.path.join(td, "Archive", "Rollouts")
    try:
        anames = sorted(os.listdir(arch))
    except FileNotFoundError:
        anames = []
    except OSError as e:
        return None, "%s cannot be listed (%s): everything kept" % (arch, e.strerror or e)
    for n in anames:
        p = os.path.join(arch, n)
        if not n.endswith(".md"):
            continue
        try:
            if now - os.stat(p).st_mtime >= grace_h * 3600:
                continue
            stamp = scalar(read_head(p).get("engine_snapshot"))
        except OSError as e:
            return None, "the archived note %s cannot be read (%s): everything kept" % (n, e.strerror or e)
        if stamp:
            out.setdefault(real(stamp), "archived [[%s]] within %s" % (n[:-3], _hours(grace_h)))
    return out, None


def _age(home, s, p, now):
    for f in (os.path.join(home, ".cut", s), p):
        try:
            return now - os.stat(f).st_mtime
        except OSError:
            continue
    return None


def sweep(primary, home, tasks_dir, now, grace_h, spare=()):
    """The keep-list (the header's), run with the home lock held: one `retired`/`kept` line per snapshot dir."""
    try:
        snaps = sorted(e for e in os.listdir(home) if SHA12_RE.match(e) and os.path.isdir(os.path.join(home, e)))
    except OSError:
        return []
    if not snaps:
        return []
    named, why = named_snapshots(tasks_dir, now, grace_h)
    if named is None:
        return ["kept %s: %s" % (s, why) for s in snaps]
    own, spare, lines, removed = real(ROOT), {real(p) for p in spare}, [], False
    for s in snaps:
        p = real(os.path.join(home, s))
        if p == own:
            lines.append("kept %s: own root" % s)
        elif p in spare:
            lines.append("kept %s: just cut" % s)
        elif p in named:
            lines.append("kept %s: %s" % (s, named[p]))
        else:
            age = _age(home, s, p, now)
            if age is not None and age < grace_h * 3600:
                lines.append("kept %s: unnamed, cut %dh ago, within the %s grace" % (s, max(0, age) // 3600,
                                                                                    _hours(grace_h)))
                continue
            git(primary, "worktree", "unlock", p)
            r = git(primary, "worktree", "remove", "--force", "--force", p)
            if r.returncode != 0:
                if os.path.isdir(os.path.join(p, ".git")) or os.path.isfile(os.path.join(p, ".git")):
                    git(primary, "worktree", "lock", "--reason", LOCK_REASON, p)
                lines.append("kept %s: git worktree remove failed (%s)" % (s, first_line(r.stderr)))
                continue
            try:
                os.unlink(os.path.join(home, ".cut", s))
            except OSError:
                pass
            removed = True
            lines.append("retired %s" % s)
    if removed:
        git(primary, "worktree", "prune")
    return lines


# ---- verbs --------------------------------------------------------------------------------------------------------

def _now(raw):
    if not raw:
        return time.time()
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise Fail(2, "engine-snapshot usage: --now %r is not an ISO time" % raw)
    return (dt if dt.tzinfo else dt.astimezone()).timestamp()


def cmd_cut(a):
    primary, why = git_primary(ROOT)
    if primary is None:
        raise Fail(4, "engine-snapshot cut: no git Primary (%s): no snapshot cut; the rollout runs unstamped from the "
                      "session's plugin root %s" % (why, ROOT))
    env = remote_env(primary)
    rc, out, err = run_group(["bash", os.path.join(ROOT, DEFAULT_BRANCH_REL), primary], env, 60)
    default = out.strip()
    if rc != 0 or not default:
        raise Fail(2, "engine-snapshot cut: cannot resolve origin's default branch for %s (%s): nothing cut"
                      % (primary, first_line(err) or "exit %d" % rc))
    ref = "refs/remotes/origin/%s" % default
    for attempt in (1, 2):
        rc, _o, err = run_group(["git", "-C", primary, "fetch", "-q", "origin", "+refs/heads/%s:%s" % (default, ref)],
                                env, FETCH_TIMEOUT)
        if rc == 0:
            break
        if attempt == 1:
            time.sleep(2)   # a concurrent fetch holding the ref lock
    if rc != 0:
        raise Fail(2, "engine-snapshot cut: git fetch origin %s failed in %s (%s): nothing cut, never a stale ref"
                      % (default, primary, first_line(err) or "exit %d" % rc))
    sha = git_out(primary, "rev-parse", "--verify", "-q", ref + "^{commit}")
    if not sha:
        raise Fail(2, "engine-snapshot cut: %s does not resolve in %s after the fetch: nothing cut" % (ref, primary))
    sha12 = sha[:12]
    if git(primary, "cat-file", "-e", "%s:%s" % (sha, SELF_REL)).returncode != 0:
        raise Fail(3, "engine-snapshot cut: origin/%s at %s has no %s (it predates Engine snapshots): nothing cut"
                      % (default, sha12, SELF_REL))
    home, parent = home_of(primary), os.path.dirname(primary)
    ptop = git_out(parent, "rev-parse", "--show-toplevel")
    if ptop and git(parent, "check-ignore", "-q", "--", os.path.basename(home) + "/").returncode != 0:
        raise Fail(3, "engine-snapshot cut: the snapshots home %s would sit inside the work tree %s, which does not "
                      "ignore it: nothing created (ignore it there, or move the Primary checkout)" % (home, real(ptop)))
    try:
        os.makedirs(os.path.join(home, ".cut"), exist_ok=True)
    except OSError as e:
        raise Fail(2, "engine-snapshot cut: cannot make %s (%s)" % (home, e.strerror or e))
    now = _now(a.now)
    snap = os.path.join(home, sha12)
    with HomeLock(home) as lock:
        if not lock.ok:
            raise Fail(2, "engine-snapshot cut: %s/.lock was held past %ds (another cut or retire): nothing cut"
                          % (home, LOCK_TIMEOUT))
        reused = os.path.lexists(snap)
        if reused:
            problem = snapshot_problem(snap, sha, primary)
            if problem is not None:
                raise Fail(3, "engine-snapshot cut: %s exists and is not a clean snapshot at %s (%s): move it aside, "
                              "then re-run" % (snap, sha12, problem))
            git(primary, "worktree", "lock", "--reason", LOCK_REASON, snap)   # already locked: a no-op failure
        else:
            r = git(primary, "worktree", "add", "-q", "--detach", snap, sha, timeout=FETCH_TIMEOUT)
            if r.returncode != 0:
                # A registration left by a snapshot deleted by hand (locked, so prune spared it): drop it once.
                git(primary, "worktree", "unlock", snap)
                git(primary, "worktree", "prune")
                r = git(primary, "worktree", "add", "-q", "--detach", snap, sha, timeout=FETCH_TIMEOUT)
            if r.returncode != 0:
                raise Fail(2, "engine-snapshot cut: git worktree add %s failed (%s)" % (snap, first_line(r.stderr)))
            r = git(primary, "worktree", "lock", "--reason", LOCK_REASON, snap)
            if r.returncode != 0:
                git(primary, "worktree", "remove", "--force", snap)
                raise Fail(2, "engine-snapshot cut: git worktree lock %s failed (%s): nothing kept" % (snap,
                                                                                                    first_line(r.stderr)))
        try:
            with open(os.path.join(home, ".cut", sha12), "a"):
                pass
            os.utime(os.path.join(home, ".cut", sha12), (now, now))
        except OSError:
            pass
        try:
            swept = sweep(primary, home, a.tasks_dir or DEFAULT_TASKS_DIR, now, GRACE_HOURS, spare=(snap,))
        except Exception:  # noqa: BLE001 — the sweep is best-effort
            swept = []
    for line in swept:
        if line.startswith("retired "):
            sys.stderr.write("engine-snapshot cut: swept: %s\n" % line)
    snap = real(snap)
    print(json.dumps({"snapshot": snap, "sha": sha, "sha12": sha12, "reused": reused, "primary": primary,
                      "default": default, "prose": prose(a.verb, a.prose_id, snap)}))
    return 0


def _snapshot_root_problem(primary):
    """None when this script runs from a snapshot of `primary`, else why not."""
    gd = git_out(ROOT, "rev-parse", "--path-format=absolute", "--git-dir")
    common = git_out(ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if not gd or not common or real(gd) == real(common):
        return "%s is not a linked worktree" % ROOT
    problem = snapshot_problem(ROOT, None, primary)
    if problem is not None:
        return "%s is %s" % (ROOT, problem)
    head = git_out(ROOT, "rev-parse", "HEAD") or ""
    if os.path.basename(ROOT) != head[:12]:
        return "%s is not named by its HEAD %s" % (ROOT, head[:12])
    if os.path.dirname(ROOT) != home_of(primary):
        return "%s is not in %s" % (ROOT, home_of(primary))
    return None


def _load_rr():
    spec = importlib.util.spec_from_file_location("thread_reconcile_rollout_es", os.path.join(ROOT, RR_REL))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cmd_adopt(a):
    path = find_note(a.rollout, a.tasks_dir)
    if path is None:
        raise Fail(2, "engine-snapshot adopt: no rollout note at %s" % a.rollout)
    if is_archived(path):
        raise Fail(2, "engine-snapshot adopt: %s is archived: a finished rollout never moves" % path)
    primary, why = git_primary(ROOT)
    if primary is None:
        raise Fail(2, "engine-snapshot adopt: run it from a snapshot (no git Primary: %s)" % why)
    problem = _snapshot_root_problem(primary)
    if problem is not None:
        raise Fail(2, "engine-snapshot adopt: run it from a snapshot: %s" % problem)
    sha = git_out(ROOT, "rev-parse", "HEAD")
    rr = _load_rr()
    note = rr.Note(Path(path))
    old_stamp, old_sha = scalar(note.get("engine_snapshot")), scalar(note.get("engine_sha"))
    want = tilde(ROOT)
    changed = old_stamp != want or old_sha != sha
    moved_from = old_sha if old_sha and old_sha != sha else None
    if changed:
        note.set("engine_snapshot", '"%s"' % want, after=("protocol_version", "status"))
        note.set("engine_sha", sha, after=("engine_snapshot",))
        if moved_from:
            for migrate in MIGRATIONS:
                note.apply(migrate, moved_from, sha)
            note.append_line("## Notes", "- %s engine snapshot moved at reinstate: %s → %s (ADR 0043)"
                             % (rr._stamp(datetime.fromtimestamp(_now(a.now))), moved_from[:12], sha[:12]))
        try:
            note.save()
        except OSError as e:
            raise Fail(1, "engine-snapshot adopt: %s: nothing written" % e)
    print(json.dumps({"snapshot": ROOT, "sha": sha, "from": moved_from, "changed": changed}))
    return 0


def cmd_resolve(a):
    path = find_note(a.rollout, a.tasks_dir)
    if path is None:
        raise Fail(2, "engine-snapshot resolve: no rollout note at %s" % a.rollout)
    try:
        er = engine_root(path)
        with open(path, encoding="utf-8", errors="replace") as f:
            body = f.read()
    except OSError as e:
        raise Fail(2, "engine-snapshot resolve: cannot read %s (%s)" % (path, e.strerror or e))
    slug = os.path.splitext(os.path.basename(path))[0]
    if er["root"] is None:
        raise Fail(3, "engine-snapshot resolve: [[%s]]'s Engine snapshot %s is %s: %s"
                      % (slug, tilde(er["snapshot"]), er["unusable"], remedy(er["snapshot"], er["sha"],
                                                                              er["unusable"])))
    due, why = move_rule(er["fm"], body, er["stamped"], er["archived"])
    root = er["root"]
    primary = git_primary(root)[0]
    head = git_out(primary, "rev-parse", "--verify", "-q", "HEAD") if primary else None
    ahead = behind = None
    if primary and head and er["sha"]:
        counts = git_out(primary, "rev-list", "--left-right", "--count", "%s...%s" % (er["sha"], head))
        if counts and len(counts.split()) == 2:
            ahead, behind = (int(x) for x in counts.split())
    print(json.dumps({"rollout": slug, "note": path, "snapshot": er["snapshot"], "sha": er["sha"], "root": root,
                      "same": root == real(ROOT), "gone": er["gone"], "goneWhy": er["goneWhy"],
                      "archived": er["archived"], "prose": prose(a.verb, a.prose_id, root),
                      "move": {"due": due, "why": why}, "primary": primary, "primaryHead": head, "ahead": ahead,
                      "behind": behind}))
    return 0


def cmd_retire(a):
    primary, why = git_primary(ROOT)
    if primary is None:
        print("retire: no git Primary (%s): nothing to retire" % why)
        return 0
    home = home_of(primary)
    if not os.path.isdir(home):
        print("retire: no snapshots home at %s: nothing to retire" % home)
        return 0
    now = _now(a.now)
    with HomeLock(home) as lock:
        if not lock.ok:
            print("retire: %s/.lock was held past %ds (a cut or retire): nothing retired" % (home, LOCK_TIMEOUT))
            return 0
        lines = sweep(primary, home, a.tasks_dir or DEFAULT_TASKS_DIR, now, a.grace_hours)
    for line in lines:
        print(line)
    return 0


def cmd_guard_pr(a):
    m = PR_URL_RE.fullmatch(a.pr_url.strip())
    if not m:
        raise Fail(1, "engine-snapshot guard-pr: %r is not a https://github.com/<o>/<r>/pull/<N> URL" % a.pr_url)
    want = (m.group(1).lower(), m.group(2).lower(), int(m.group(3)))
    td = os.path.expanduser(a.tasks_dir or DEFAULT_TASKS_DIR)
    try:
        names = sorted(os.listdir(td))
    except OSError:
        return 0   # no vault: nothing names the PR
    for n in names:
        p = os.path.join(td, n)
        if not n.endswith(".md") or not os.path.isfile(p):
            continue
        try:
            pr = scalar(read_head(p).get("pr"))
        except OSError:
            continue
        mm = PR_URL_RE.match(pr) if pr else None
        if not mm or (mm.group(1).lower(), mm.group(2).lower(), int(mm.group(3))) != want:
            continue
        line = guard_task(p, a.root, a.script, td)
        if line:
            sys.stderr.write(line + "\n")
            return 2
    return 0


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Fail(2, "engine-snapshot usage: %s" % message)


def parser():
    p = Parser(prog="engine-snapshot.py", description="A rollout runs on its Engine snapshot (ADR 0043).")
    sub = p.add_subparsers(dest="cmd", parser_class=Parser)
    c = sub.add_parser("cut", help="cut a snapshot at origin's fresh tip of the default branch")
    c.add_argument("--verb")
    c.add_argument("--prose-id", dest="prose_id")
    c.add_argument("--tasks-dir", dest="tasks_dir")
    c.add_argument("--now")
    ad = sub.add_parser("adopt", help="stamp a rollout note with the snapshot this runs from")
    ad.add_argument("--rollout", required=True)
    ad.add_argument("--tasks-dir", dest="tasks_dir")
    ad.add_argument("--now")
    r = sub.add_parser("resolve", help="the rollout's engine root, the hand-over and the move rule (read-only)")
    r.add_argument("--rollout", required=True)
    r.add_argument("--verb")
    r.add_argument("--prose-id", dest="prose_id")
    r.add_argument("--tasks-dir", dest="tasks_dir")
    t = sub.add_parser("retire", help="remove the snapshots no rollout needs any more")
    t.add_argument("--tasks-dir", dest="tasks_dir")
    t.add_argument("--now")
    t.add_argument("--grace-hours", dest="grace_hours", type=float, default=GRACE_HOURS)
    g = sub.add_parser("guard-pr", help="refuse a merge from a root the PR's rollout does not run on")
    g.add_argument("--pr-url", dest="pr_url", required=True)
    g.add_argument("--root", required=True)
    g.add_argument("--script", required=True)
    g.add_argument("--tasks-dir", dest="tasks_dir")
    return p


VERBS = {"cut": cmd_cut, "adopt": cmd_adopt, "resolve": cmd_resolve, "retire": cmd_retire, "guard-pr": cmd_guard_pr}


def main(argv=None):
    try:
        a = parser().parse_args(argv)
        if not a.cmd:
            raise Fail(2, "engine-snapshot usage: name a verb: " + ", ".join(VERBS))
        if a.cmd == "retire" and not a.grace_hours > 0:
            raise Fail(2, "engine-snapshot usage: --grace-hours must be > 0")
        return VERBS[a.cmd](a)
    except Fail as e:
        sys.stderr.write(e.msg + "\n")
        return e.code


if __name__ == "__main__":
    sys.exit(main())
