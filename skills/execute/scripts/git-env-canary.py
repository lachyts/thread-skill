#!/usr/bin/env python3
"""git-env-canary.py — the lead's git-env canary: did the shared checkout change during a window? (p14-6, ADR 0046)

The lead session (execute § 4.5 *Git-env canary*) opens a **window** around every launch that can run agents or a
verifier against the rollout's shared checkout R (its `Project root:`): a task call, a seeded revise, an integrate
call, a *Lost call* or § 3.7 resume, the lead's own Integration verify, a RACE re-verify and the completion verify. A task call's window (a
start, a restart, a seeded revise or a room-stopped call's resume) is armed by `reconcile-rollout.py mark-started
--arm-repo <R> --arm-default <B>` itself (p26-3), which runs `arm` before any write and passes its exit code through;
the lead runs `arm` directly for the rest. `arm` records R's `refs/heads/<B>` and its effective bareness before the
launch; `check` compares them when the window ends. A change that is not benign appends a trip line to the rollout
note's GIT_ENV_LOG_SECTION, which holds what it threatens (reconcile-rollout.py's `_git_env_hold`, each entry with its
`scope`) until a human acks it through /thread:repair (`ack`): a bare checkout (`core.bare` flipped, `core.bare true at
arm`, or a failed state check's `core.bare true`) holds the whole rollout (`next` halts "git-env" at once, exit 3); any
other trip holds the Integration lane only (`next` lists it under `laneHold`, task calls go on, exit 9 at every site
but a task window's). `carry` refuses either. Nothing here retries, restores or acks on its own. Stdlib only, POSIX
only (fcntl), like every script in this repo.

A **Bookkeeping miss** (ADR 0046) is a window the canary could not read: `record missing`, `record unreadable` or
`record not armed`. It observed nothing, so it never trips by itself: the canary runs the **state check** there and
then (once per verb call, cached), and only a failing state check trips (the trip line reads `<reason>, and the state
check failed: <failure>`, the failure sanitised: `;` -> `,`, the arrow -> `->`, newlines collapsed, at most 200
characters; a bare failure reads `core.bare true`, never `core.bare false`). With no repo known it trips as before.
The state check, local checks first and the network last:
  1. `rev-parse --is-bare-repository`: bare fails (`core.bare true`), no network;
  2. `git --no-optional-locks status --porcelain --untracked-files=no` is empty (untracked files such as
     `.claude/merge-task.status` are ignored): else `tracked changes`, no network;
  3. `_read_state` (still the only reader of the local refs): a missing `refs/heads/<B>` fails, no network;
  4. L1 = `git ls-remote --exit-code origin refs/heads/<B>`, never retried;
  5. `git -c gc.auto=0 fetch --quiet --no-tags --no-write-fetch-head origin refs/heads/<B>`, through the configured
     refspec (so a forged refspec or tracking ref stays visible); retried once, after 1 s, only when its stderr
     reads a ref lock (`cannot lock ref` or `Unable to create '….lock'`) and at least 2 s of the budget remain;
  6. `_read_state` again (bare, B and T, origin/<B>);
  7. T must equal L1; else L2 = a second ls-remote, and T must equal L2 (a peer's push between the reads passes); L is
     the reading T matched;
  8. `merge-base --is-ancestor B L`: no commit on B is missing from origin.
Steps 4, 5 and 7 share one budget: min(THREAD_GIT_ENV_STATE_TIMEOUT, default 12 s; 0.4 x the lock timeout in force),
so a verb waiting on the lock always gets it in time. Each network call runs in its own process group
(`start_new_session`, stdin closed, GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never) with only the time left; a timeout
kills its group (`<step> timed out after <n>s`) and is never retried; less than 1 s left fails (`no time left for
<step>`); any git error or missing ref fails closed. A passing state check logs one miss line (GIT_ENV_MISS_MARK,
imported) and holds nothing: `record missing` writes a closed `checked` tombstone carrying `miss`; `record not armed`
leaves the tombstone untouched, so its `ackedTrips` survive; `record unreadable` becomes a closed `checked` tombstone
with `miss: "record unreadable"` and `missChecked: false`, which that window's own later check consumes. That check
reads the state check there and then too (cached, so free when its own pass logged the miss), never an earlier verb's:
passing, it writes no second line; failing (a change since a `check-all` logged the miss), the window trips
(`record unreadable, and the state check failed: <failure>`).

Verbs (every verb takes --rollout <note>; every verb but `restore` takes --tasks-dir <dir>, default
reconcile-rollout.py's DEFAULT_TASKS_DIR, which must be an existing directory):

  arm --repo R --default B --slug S --kind task|integrate|verify|race-verify|completion-verify [--resume]
        Runs the common pass (below), then writes this window's open `armed` record, with the ref of the pass's
        single state read, only when the pass allows it. --resume (a *Lost call* or § 5 resume of the same run)
        keeps the `ackedTrips` of that window's record, open or closed by the check that sent the row to Lost
        call; a new run's arm over an earlier window nobody checked (a room stop's stopped verify) starts with none. R bare at arm is itself a trip (`core.bare true at arm`;
        no record; exit 3). A task window under a lane hold arms (exit 0), printing one `LANE HOLD:` stderr line per
        unacked trip: task worktrees are cut from origin, never from R's local ref. Under a whole-rollout hold it exits
        3, and any other kind under a lane hold exits 9, writing no record. A retired rollout: exit 2, nothing created.
        Refuses (exit 2, nothing written: no record, no log line, no pass) a window whose owner does not hold
        (the owner rule below), its stderr naming the missing stamp (§ 4's `status: in_progress` for a task
        window, right for mark-started's arm and a direct one alike; `mark-integrating` for the rest), so a
        skipped stamp stops at the arm, never as a later `record not armed` miss (p26-1). A task call's arm is
        run by `reconcile-rollout.py mark-started --arm-repo/--arm-default` (p26-3), as a subprocess before any
        write of its own, which passes this exit code through (a non-zero arm writes nothing for that note).
  check --repo R --default B --slug S --kind K
        Runs the pass, then closes this window's record: `armed` and clean -> a `checked` tombstone; tripped
        (now or by an earlier verb) -> `closed: true`, no second trip line; a closed tripped record -> unchanged.
        A missing record is the Bookkeeping miss `record missing`, a closed `checked` or `acked` tombstone `record
        not armed` (the owner holds at its own check, so a tombstone left by an earlier window with the same slug
        and kind means this window was never armed), and an unreadable record `record unreadable` (the pass turns
        it into a tombstone this check consumes, reading the state check again at this check, so a change since an
        earlier verb logged the miss trips here): each runs the state check above. A task window exits 3 only for a
        whole-rollout hold, else 0: its work is taken as it stands (its agent worked in its own tree cut from
        origin), and its stdout names any acked trip, any logged miss and any lane hold; a trip it saw is logged and
        joins the unacked set. Every other kind exits 3 for a whole-rollout hold, else 9 for a lane hold, else 4
        when its run gives no verdict (ADR 0053: an `armed` window that carries an acked trip, `ackedTrips`, below;
        or a passing miss whose tombstone carries `ackedTrips`, reads `acked`, or was `record unreadable`), naming
        each on stdout, else 0 (a clean miss on any other window keeps its verify: the state check showed the
        checkout unharmed).
  check-all
        The pass alone (R and B from the records): 3 under a whole-rollout hold, else 9 under a lane hold, else 0.
        No records: the hold alone decides.
  ack --repo R --default B --slugs a,b --ref <sha|absent>
        Runs the pass, re-reads the note and the state once more, and refuses (exit 3, nothing more written)
        unless --slugs is exactly the unacked set (the hold's slugs plus every record still `tripped`), R is not
        bare and refs/heads/B is --ref. Nothing to ack: exit 1. Otherwise every open window whose owner still
        holds is re-baselined to `armed` on that read, a tripped one keeping its trip line in `ackedTrips` so its
        own check still reports it (ADR 0053), every other tripped or orphaned record becomes an `acked`
        tombstone, and one ack line is appended and confirmed. The only writer of the ack mark.
  retire
        check-all (a non-zero exit, 3 or 9, is returned, nothing deleted), then writes `<dir>/<stem>.retired` and deletes
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
        recovers it. It has no in-flight guard of its own (the canary cannot see sessions): /thread:repair § 3e
        runs it, `--bare-only` included, only once nothing of the rollout is in flight.

The common pass (`arm`, `check`, `check-all`, `ack`), under the lock: (0) turn every unreadable record into a
Bookkeeping miss (the state check above); (1) re-log every `tripped` record whose trip line is missing from the log;
(2) read the state once and compare every `armed` record with it: a difference marks the record `tripped` (left open
while its owner holds), appends its trip line and re-reads the note to confirm it; a clean record whose owner no
longer holds is closed `checked`; (3) exit 3 if any unacked trip (the note's hold or a record still `tripped`) reads a
bare checkout (reconcile-rollout.py's `_git_env_scope`: `rollout`), else 9 if any stands (`lane`), else 0.

Owner rule: an `armed` window can only be open while its vault owner holds: kind `task` while the task note's queue
state is `running`; `integrate`, `verify` and `race-verify` while the note holds the Integration lane
(reconcile-rollout.py `_holds_lane`: `review` with a `pr:` and `integrating:`, or a current `integrated`
Integration-log line, the window an integrate call's reconciled row leaves before step 4's RACE re-verify);
`completion-verify` (estate ADR 0009 d6: the ceremony's run of the rollout's `completion_verifier`, its slug the
rollout's own stem; a parallel rollout's only: a serial chain's completion verify arms no window, ADR 0055) while the
rollout note is not done, so its check comes before the ceremony's `status: done`. A note
missing from an existing tasks dir counts as holding (fail-closed), with a stderr WARN. An orphan is compared once
and closed. `arm` refuses a window whose owner does not hold.

The comparison (baseline against now; B and O are read by `_read_state`, the only state reader):
  - bareness changed, either ref absent (but not both), or origin's B absent -> a trip;
  - the same ref -> clean;
  - otherwise clean only when every commit of `rev-list new ^O` and of `rev-list old ^new ^O` is close-out-shaped
    and `merge-base old O` is an ancestor of new. That covers land.sh's moves of a local default (S4's
    fast-forward, S5's close-out commit, S11's scratch rebase) and merge-task's `refresh_local_base`, so a
    close-out landed mid-run trips no window (execute § 2.7).
A commit is close-out-shaped when it is not a merge and `git diff-tree --no-commit-id --name-status -r -z --root <c>`
(land.sh S9's command) lists at least one path and only changes `closeout_change` accepts (a port of land.sh's:
a path `closeout_shaped` accepts, THREAD.md, */THREAD.md, or a file directly under (*/)docs/handoffs/; or the
deletion of a review doc, a file directly under docs/reviews/, which land.sh lands only once it is consumed). This
is stricter than land.sh S9, which also carries an empty non-merge commit and a merge whose other parents are on
origin: the canary trips on both, which fails closed.

Validation, before any git call or write (after the lock for the locking verbs): --repo must resolve (realpath) to
the rollout's `Project root:` (none: exit 2), to every record's repo and to every unacked trip line's `repo`;
--default must pass `git check-ref-format refs/heads/<B>`, carry no `*`, `?` or `[`, and equal every record's
default and every unacked `refs/heads/<B>` trip line's branch. `check-all` and `retire` use the records' own values
(records that disagree: exit 2).

Records live outside the repo: ${THREAD_GIT_ENV_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/thread/git-env}/
<rollout-stem>/<slug>.<kind>.json, {v, slug, kind, repo, default, ref, bare, state, closed, armedAt, trip,
ackedTrips (optional: the trip lines an ack re-baselined this window past), miss and missChecked (optional: a
Bookkeeping miss's tombstone)}, so an
agent's `git clean` or `rm -rf .claude` in the shared checkout never reaches them. Every verb but `restore` holds
`<dir>/<rollout-stem>.lock` (fcntl.flock; 30 s, or THREAD_GIT_ENV_LOCK_TIMEOUT seconds; a timeout is exit 2).
Every git call runs with git's own --local-env-vars list (GIT_DIR, GIT_CONFIG_PARAMETERS, …) and the
GIT_CONFIG_KEY_*/VALUE_* channels scrubbed.

Line formats (the markers and the section heading are reconcile-rollout.py's GIT_ENV_TRIP_MARK, GIT_ENV_ACK_MARK,
GIT_ENV_MISS_MARK and GIT_ENV_LOG_SECTION, imported, never copied):
  - <stamp> <GIT_ENV_TRIP_MARK> [[<slug>]] <kind>: <refs/heads/B old→new | core.bare false→true | core.bare true at arm |
    <record missing | record unreadable | record not armed>, and the state check failed: <failure> | <the miss
    reason> (no repo known)>; repo <R>
  - <stamp> <GIT_ENV_MISS_MARK> [[<slug>]] <kind>: <the miss reason>; refs/heads/<B> at <sha>; ls-remote origin <B>
    <L1>[, re-read <L2>]; origin/<B> <T> after a fetch; <B> on origin; no tracked changes; core.bare false; holds
    nothing; repo <R>
  - <stamp> <GIT_ENV_ACK_MARK> [[a]], [[b]]: refs/heads/B at <sha|absent>, core.bare false

Run record (p15-2, ADR 0032): every append to the log reads the hold (reconcile-rollout.py's _git_env_hold) before
and after; an empty -> non-empty edge (a trip opens it) records `hold-started hold=git-env` and a non-empty -> empty
edge (the ack) `hold-ended hold=git-env`, rollout the note's stem and task null, through reconcile-rollout.py's
_event: best-effort, never changing an exit. A miss line opens nothing.

Exit codes: 0 clean (or a task window taken as it stands, or a passing miss), 3 a whole-rollout hold (a bare
checkout), 9 a lane hold (any other unacked trip; never a task window's arm or check), 4 (check only, never a task
window) clean but this window's run gives no verdict (ADR 0053), 1 nothing to ack, 2 a failure, a usage or a
validation error. The lead treats 3 and 2 as a halt, 9 as the lane held (no halt: task calls go on), and on 4 runs the
window's verdict again (execute § 4.5's exit rule). An exit 2 whose stderr line starts `engine-snapshot: ` is the
Engine snapshot guard (ADR 0043): every verb first asks engine-snapshot.py's guard(), loaded from this tree, and a
rollout stamped with another snapshot (or a live one whose snapshot is unusable) is refused before the lock, with
nothing written: re-run the same command from the root that line names (skills/_shared/engine-snapshot.md), never a
halt.
"""

import argparse
import fcntl
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

KINDS = ("task", "integrate", "verify", "race-verify", "completion-verify")
LOCK_TIMEOUT = 30.0
# The state check's network budget (ADR 0046): THREAD_GIT_ENV_STATE_TIMEOUT seconds (default 12), capped at STATE_SHARE
# of the lock timeout in force, so a verb waiting on the lock never times out behind a slow origin.
STATE_TIMEOUT = 12.0
STATE_SHARE = 0.4
# A concurrent fetch's ref lock: the state check's fetch is retried once on it, never on a timeout.
REF_LOCK_RE = re.compile(r"cannot lock ref|Unable to create '.*\.lock'")


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
_holds_lane = RR._holds_lane
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


def review_doc(path):
    """land.sh's review_doc, ported: a file directly under the repo's docs/reviews/."""
    rest = path[len("docs/reviews/"):] if path.startswith("docs/reviews/") else ""
    return bool(rest) and "/" not in rest


def closeout_change(status, path):
    """land.sh's closeout_change, ported: a close-out path, or a review doc's deletion (shape only, as S9)."""
    return closeout_shaped(path) or (status == "D" and review_doc(path))


def _closeout_commit(repo, sha):
    """A non-merge commit whose diff lists at least one path, every change close-out-shaped (stricter than S9)."""
    parents = _must(repo, "rev-list", "--parents", "-n", "1", sha).split()[1:]
    if len(parents) > 1:
        return False
    out = _must(repo, "diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--root", sha)
    fields = out.split("\0")
    if fields and fields[-1] == "":
        fields.pop()
    if not fields or len(fields) % 2:
        return False
    return all(closeout_change(st, p) for st, p in zip(fields[0::2], fields[1::2]))


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


# ---- the state check (a Bookkeeping miss, ADR 0046) -----------------------------------------------------------

def _lock_timeout():
    """The lock timeout in force: THREAD_GIT_ENV_LOCK_TIMEOUT seconds, else LOCK_TIMEOUT."""
    try:
        return float(os.environ.get("THREAD_GIT_ENV_LOCK_TIMEOUT") or LOCK_TIMEOUT)
    except ValueError:
        return LOCK_TIMEOUT


def _state_budget():
    """The state check's network budget: min(THREAD_GIT_ENV_STATE_TIMEOUT or STATE_TIMEOUT, STATE_SHARE x the lock
    timeout in force), never negative."""
    try:
        own = float(os.environ.get("THREAD_GIT_ENV_STATE_TIMEOUT") or STATE_TIMEOUT)
    except ValueError:
        own = STATE_TIMEOUT
    return max(0.0, min(own, STATE_SHARE * _lock_timeout()))


def _last(text):
    """A git failure in one line: its first `fatal:` or `error:` line (git explains below it), else its last line."""
    lines = (text or "").strip().splitlines()
    return next((ln for ln in lines if ln.startswith(("fatal:", "error:"))), lines[-1] if lines else "")


def _sanitise(text):
    """A state-check failure as it may sit inside a trip line: `;` -> `,`, the arrow -> `->`, newlines collapsed (so no
    `; repo ` and no `old→new` a reader could take for the line's own fields), at most 200 characters."""
    s = " ".join((text or "").replace(";", ",").replace("→", "->").split())
    return s[:200]


class _Budget:
    def __init__(self, seconds):
        self.end = time.monotonic() + seconds

    def left(self):
        return self.end - time.monotonic()


def _net(repo, budget, step, *args):
    """One network git call of the state check, in its own process group with only the budget's time left:
    (result, None), or (None, why) on no time left, a start failure or a timeout (its group killed)."""
    left = budget.left()
    if left < 1.0:
        return None, f"no time left for {step}"
    env = dict(_env(), GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    try:
        proc = subprocess.Popen(["git", "-C", str(repo), *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
    except OSError as e:
        return None, f"{step}: {e}"
    try:
        out, err = proc.communicate(timeout=left)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:   # a grandchild outside the group still holds a pipe
            for fh in (proc.stdout, proc.stderr):
                try:
                    fh.close()
                except OSError:
                    pass
            proc.wait()
        return None, f"{step} timed out after {left:.0f}s"
    return SimpleNamespace(returncode=proc.returncode, stdout=out, stderr=err), None


def _ls_remote(repo, branch, budget, step):
    """(sha, None) for origin's refs/heads/<B> read with ls-remote, or (None, why)."""
    ref = f"refs/heads/{branch}"
    p, why = _net(repo, budget, step, "ls-remote", "--exit-code", "origin", ref)
    if why:
        return None, why
    if p.returncode == 2:
        return None, f"{step}: origin has no {ref}"
    if p.returncode != 0:
        return None, f"{step} exited {p.returncode}: {_last(p.stderr or p.stdout)}"
    lines = [ln for ln in (p.stdout or "").splitlines() if ln.strip()]
    parts = lines[0].split("\t") if len(lines) == 1 else []
    if len(parts) != 2 or parts[1].strip() != ref or not re.fullmatch(r"[0-9a-f]{40,64}", parts[0].strip()):
        return None, f"{step} does not read as exactly {ref}: {' | '.join(lines)}"
    return parts[0].strip(), None


def _state_check_run(repo, branch):
    """The state check (the module docstring's eight steps): {ok, failure, ref, l1, l2, t}."""
    res = {"ok": False, "failure": "", "ref": None, "l1": None, "l2": None, "t": None}

    def fail(why):
        res["failure"] = why
        return res

    p = _git(repo, "rev-parse", "--is-bare-repository")
    out = (p.stdout or "").strip()
    if p.returncode != 0 or out not in ("true", "false"):
        return fail(f"cannot read the bareness: {_last(p.stderr or out)}")
    if out == "true":
        return fail("core.bare true")
    p = _git(repo, "--no-optional-locks", "status", "--porcelain", "--untracked-files=no")
    if p.returncode != 0:
        return fail(f"git status exited {p.returncode}: {_last(p.stderr)}")
    if (p.stdout or "").strip():
        return fail("tracked changes")
    try:
        bare, ref, _t = _read_state(repo, branch)
    except CanaryError as e:
        return fail(str(e))
    if bare:
        return fail("core.bare true")
    if ref is None:
        return fail(f"refs/heads/{branch} absent")
    res["ref"] = ref
    budget = _Budget(_state_budget())
    l1, why = _ls_remote(repo, branch, budget, f"ls-remote origin {branch}")
    if why:
        return fail(why)
    res["l1"] = l1
    step = f"fetch origin {branch}"
    for attempt in (1, 2):
        p, why = _net(repo, budget, step, "-c", "gc.auto=0", "fetch", "--quiet", "--no-tags", "--no-write-fetch-head",
                      "origin", f"refs/heads/{branch}")
        if why:
            return fail(why)
        if p.returncode == 0:
            break
        if attempt == 1 and REF_LOCK_RE.search(p.stderr or "") and budget.left() >= 2.0:
            time.sleep(1.0)
            continue
        return fail(f"{step} exited {p.returncode}: {_last(p.stderr)}")
    try:
        bare, ref, t = _read_state(repo, branch)
    except CanaryError as e:
        return fail(str(e))
    if bare:
        return fail("core.bare true")
    if ref is None:
        return fail(f"refs/heads/{branch} absent")
    res.update(ref=ref, t=t)
    if t is None:
        return fail(f"origin/{branch} absent after a fetch")
    if t == l1:
        tip = l1
    else:
        l2, why = _ls_remote(repo, branch, budget, f"ls-remote origin {branch} (re-read)")
        if why:
            return fail(why)
        res["l2"] = l2
        if t != l2:
            return fail(f"origin/{branch} {t} after a fetch is neither ls-remote reading ({l1}, re-read {l2})")
        tip = l2
    anc = _git(repo, "merge-base", "--is-ancestor", ref, tip)
    if anc.returncode == 1:
        return fail(f"refs/heads/{branch} {ref} holds commits not on origin {branch} ({tip})")
    if anc.returncode != 0:
        return fail(f"git merge-base --is-ancestor exited {anc.returncode}: {_last(anc.stderr)}")
    res["ok"] = True
    return res


def _state_check(ctx, repo, branch):
    """The state check for (repo, branch), run once per verb call (cached on the Ctx)."""
    key = (repo, branch)
    if ctx._state_check is None or ctx._state_check[0] != key:
        ctx._state_check = (key, _state_check_run(repo, branch))
    return ctx._state_check[1]


def _miss_line(slug, kind, reason, branch, sc, repo):
    reads = f"ls-remote origin {branch} {sc['l1']}" + (f", re-read {sc['l2']}" if sc["l2"] else "")
    return (f"- {_stamp()} {RR.GIT_ENV_MISS_MARK} [[{slug}]] {kind}: {reason}; refs/heads/{branch} at {sc['ref']}; "
            f"{reads}; origin/{branch} {sc['t']} after a fetch; {branch} on origin; no tracked changes; core.bare false; "
            f"holds nothing; repo {repo}")


def _miss(ctx, rec, reason, repo, branch):
    """A Bookkeeping miss on `rec` (a window record, in memory): the state check decides. Passing, the miss line to log
    (the caller shapes the tombstone); failing, or with no repo known, `rec` is tripped (closed) and None comes back."""
    if not repo or not branch:
        _tripped(rec, reason, repo or "?", True)
        return None
    sc = _state_check(ctx, repo, branch)
    if not sc["ok"]:
        _tripped(rec, f"{reason}, and the state check failed: {_sanitise(sc['failure'])}", repo, True)
        return None
    rec["ref"] = sc["ref"]
    return _miss_line(rec["slug"], rec["kind"], reason, branch, sc, repo)


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
        self._state_check = None   # ((repo, branch), result): the state check runs once per verb call

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
        held_before = bool(_git_env_hold(note))
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
        # The Run record (p15-2): the hold's edges. A trip that opens it is hold-started, the ack that empties it
        # hold-ended; both best-effort (reconcile-rollout.py's _event), task null.
        held_after = bool(self.hold())
        if held_after != held_before:
            RR._event(self.stem, "hold-started" if held_after else "hold-ended", None, {"hold": "git-env"})

    def hold(self):
        return _git_env_hold(self.note())

    # -- the lock
    def lock(self):
        try:
            self.base.mkdir(parents=True, exist_ok=True)
            fh = open(self.lock_path, "a")
        except OSError as e:
            raise CanaryError(f"cannot open the lock {self.lock_path}: {e}")
        timeout = _lock_timeout()
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
                      and (rec.get("state") != "tripped" or isinstance((rec.get("trip") or {}).get("line"), str))
                      and isinstance(rec.get("ackedTrips", []), list)
                      and all(isinstance(x, str) for x in rec.get("ackedTrips", []))
                      and isinstance(rec.get("miss", ""), str) and isinstance(rec.get("missChecked", False), bool))
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
        if rec["kind"] == "completion-verify":
            return rec["slug"].lower() == self.stem.lower() and RR._status(self.note()) != "done"
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
        return _holds_lane(note)


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


def _hold_scope(ctx, recs):
    """What the unacked trips hold (ADR 0046): "rollout" when any reads a bare checkout (reconcile-rollout.py's
    _git_env_scope), else "lane" when any stands, else None. The trips are the note's hold plus every record still
    `tripped` (a line a read-only note could not take yet)."""
    lines = [h["line"] for h in ctx.hold()]
    lines += [r["trip"]["line"] for r in recs if r.get("state") == "tripped" and (r.get("trip") or {}).get("line")]
    if not lines:
        return None
    return "rollout" if any(RR._git_env_scope(ln) == "rollout" for ln in lines) else "lane"


SCOPE_RC = {None: 0, "lane": 9, "rollout": 3}


def _pass(ctx, want_state=False):
    """The common pass. Returns (rc, state, records): rc 3 under a whole-rollout hold, 9 under a lane hold, else 0."""
    recs = ctx.records()
    repo, branch = _record_target(ctx, recs)
    # (0) An unreadable record is a Bookkeeping miss (ADR 0046): the state check decides. Passing, it becomes a closed
    # `checked` tombstone its own window's check consumes; failing (or with no repo known) it trips, closed.
    misses = []
    for rec in recs:
        if rec.get("unreadable"):
            rec.update(v=1, repo=repo or "", default=branch or "", ref=None, bare=False, armedAt=None)
            rec.pop("unreadable", None)
            line = _miss(ctx, rec, "record unreadable", repo, branch)
            if line:
                rec.update(state="checked", closed=True, trip=None, miss="record unreadable", missChecked=False)
                misses.append(line)
            ctx.save(rec)
    ctx.append(misses)
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
    # (3) the exit, by what the unacked trips hold.
    return SCOPE_RC[_hold_scope(ctx, recs)], state, recs


def _report(ctx, rc):
    if rc == 3:
        for t in ctx.hold():
            print(f"HOLD: {t['line']}", file=sys.stderr)
        print(f"git-env: the shared checkout changed during a window (a bare checkout holds the whole rollout): "
              f"/thread:repair [[{ctx.stem}]] shows the evidence and records the ack (never acked from execute)",
              file=sys.stderr)
    elif rc == 9:
        _lane_lines(ctx)
        print(f"git-env: the shared checkout changed during a window: the Integration lane is held (task calls go on) "
              f"until /thread:repair [[{ctx.stem}]] shows the evidence and records the ack (never acked from execute)",
              file=sys.stderr)
    return rc


def _lane_lines(ctx):
    for t in ctx.hold():
        print(f"LANE HOLD: {t['line']}", file=sys.stderr)


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
    # The owner rule at the arm (p26-1): a window armed with no owner would close at the next pass and its own check
    # would trip `record not armed`. Refuse before the pass, so nothing is compared, logged or written.
    if not ctx.owner_holds({"slug": args.slug, "kind": args.kind}):
        if args.kind == "task":
            st = RR._status(ctx._index[args.slug.lower()][1]) or "none"
            # Only the § 4 stamp: mark-started's own arm (p26-3) runs this, so naming mark-started would be circular.
            raise CanaryError(f"refused: [[{args.slug}]] is not running (status {st}): stamp status: in_progress "
                              "(execute § 4) first; nothing armed")
        if args.kind == "completion-verify":
            raise CanaryError(f"refused: a completion-verify window is the rollout's own ([[{ctx.stem}]]) and opens "
                              "only before its status: done stamp; nothing armed")
        raise CanaryError(f"refused: [[{args.slug}]] holds no integrating: — run reconcile-rollout.py "
                          "mark-integrating first; nothing armed")
    rc, state, recs = _pass(ctx, want_state=True)
    bare, ref, _origin = state
    if bare:
        ctx.append([_trip_line(args.slug, args.kind, "core.bare true at arm", ctx.repo)])
        return _report(ctx, 3)
    # A lane hold (ADR 0046) holds only the Integration lane: a task window arms (its worktree is cut from origin,
    # never from R's local ref); every other kind is lane work and arms nothing. A whole-rollout hold arms nothing.
    if rc == 3 or (rc == 9 and args.kind != "task"):
        return _report(ctx, rc)
    if rc == 9:
        _lane_lines(ctx)
    rec = {"v": 1, "slug": args.slug, "kind": args.kind, "repo": ctx.repo, "default": ctx.default, "ref": ref,
           "bare": False, "state": "armed", "closed": False, "armedAt": _stamp(), "trip": None}
    # A resume's arm over its own still-open window (a Lost call, § 5: --resume) keeps the window's acked trips (ADR
    # 0053): its run carries on from the run they fell in. A new run's arm never inherits another run's trips.
    # The window it resumes may still be open, or closed by the check that sent its row to Lost call (a usage-limit
    # row): either way it is this slug and kind's last record.
    prior = next((r for r in recs if r["slug"] == args.slug and r["kind"] == args.kind
                  and r["state"] in ("armed", "checked")), None) if args.resume else None
    if prior is not None and prior.get("ackedTrips"):
        rec["ackedTrips"] = prior["ackedTrips"]
    ctx.save(rec)
    print(f"armed [[{args.slug}]] {args.kind}: refs/heads/{ctx.default} at {ref or 'absent'}, core.bare false")
    return 0


def cmd_check(ctx, args):
    _validate(ctx, args.repo, args.default)
    acked, missed, void = [], None, False
    _rc, _state, recs = _pass(ctx)
    own = next((r for r in recs if r["slug"] == args.slug and r["kind"] == args.kind), None)
    base = {"v": 1, "slug": args.slug, "kind": args.kind, "repo": ctx.repo, "default": ctx.default, "ref": None,
            "bare": False, "armedAt": None}
    if own is None:
        # A Bookkeeping miss (ADR 0046): the state check decides; passing, a closed `checked` tombstone carries it.
        rec = dict(base)
        line = _miss(ctx, rec, "record missing", ctx.repo, ctx.default)
        if line:
            rec.update(state="checked", closed=True, trip=None, miss="record missing")
            missed = "record missing"
        ctx.save(rec)
        ctx.append([line or rec["trip"]["line"]])
    elif own["state"] == "armed":
        own.update(state="checked", closed=True)
        ctx.save(own)
        acked = own.get("ackedTrips") or []
        void = bool(acked)
    elif own["state"] == "tripped" and not own["closed"]:
        own["closed"] = True
        ctx.save(own)
    elif own["state"] == "checked" and own.get("miss") == "record unreadable" and own.get("missChecked") is False:
        # The pass logged this window's own unreadable record as a miss just now (or an earlier verb did): consume
        # it. The state check is read there and then, at this check (cached: free when this check's own pass ran it),
        # never taken from an earlier verb's pass, so a change since that miss trips here. Passing: no second line,
        # and the window could not be read, so its run gives no verdict. Failing: the window trips, closed.
        own["missChecked"] = True
        sc = _state_check(ctx, ctx.repo, ctx.default)
        if sc["ok"]:
            ctx.save(own)
            missed, acked, void = "record unreadable", own.get("ackedTrips") or [], True
        else:
            _tripped(own, f"record unreadable, and the state check failed: {_sanitise(sc['failure'])}", ctx.repo, True)
            ctx.save(own)
            ctx.append([own["trip"]["line"]])
    elif own["state"] in ("checked", "acked"):
        # A tombstone of an earlier window: this one was never armed. A Bookkeeping miss: the state check decides,
        # and a passing one leaves the tombstone untouched, so its `ackedTrips` survive (ADR 0053).
        rec = dict(base, ref=own.get("ref"))
        line = _miss(ctx, rec, "record not armed", ctx.repo, ctx.default)
        if line:
            missed, acked = "record not armed", own.get("ackedTrips") or []
            void = bool(acked) or own["state"] == "acked" or own.get("miss") == "record unreadable"
            ctx.append([line])
        else:
            ctx.save(rec)
            ctx.append([rec["trip"]["line"]])
    scope = _hold_scope(ctx, ctx.records())
    said = ([f"a Bookkeeping miss ({missed}) was logged with the checkout's state"] if missed else []) + \
        ([f"a trip inside this window was acked (ADR 0053): {'; '.join(acked)}"] if acked else []) + \
        ([f"the Integration lane is held by {len(ctx.hold())} unacked trip(s) (/thread:repair)"] if scope == "lane" else [])
    if scope == "rollout":
        return _report(ctx, 3)
    if args.kind == "task":
        # A task call's work is taken as it stands (its agent worked in its own tree cut from origin): ADR 0053, and
        # ADR 0046's lane hold, which never holds a task call.
        if scope == "lane":
            _lane_lines(ctx)
        print(f"checked [[{args.slug}]] task: " + ("; ".join(["clean, taken as it stands"] + said) if not
              any(r.get("state") == "tripped" and r["slug"] == args.slug and r["kind"] == "task" for r in ctx.records())
              else "; ".join(["taken as it stands (this window tripped: logged, it joins the unacked set)"] + said)))
        return 0
    if scope == "lane":
        return _report(ctx, 9)
    if void:
        # ADR 0053: the ack re-baselined this window mid-run, or the window could not be read, so its run gives no
        # verdict.
        print(f"checked [[{args.slug}]] {args.kind}: no verdict ({'; '.join(said) or 'its window could not be read'}; "
              "execute § 4.5's exit rule says what this kind does with it)")
        return 4
    print(f"checked [[{args.slug}]] {args.kind}: clean" + (f"; {'; '.join(said)}" if said else ""))
    return 0


def cmd_check_all(ctx, _args):
    rc, _state, recs = _pass(ctx)   # 3 > 9 > 0
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
            if r["state"] == "tripped":
                r["ackedTrips"] = (r.get("ackedTrips") or []) + [r["trip"]["line"]]
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


def _engine_guard(note):
    """engine-snapshot.py's guard() for the note, loaded from this tree (ADR 0043): its refusal line, else None."""
    try:
        sys.dont_write_bytecode = True
        src = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "engine-snapshot.py"
        spec = importlib.util.spec_from_file_location("thread_engine_snapshot", src)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:  # only positive evidence refuses
        return None
    return mod.guard(note, src.parent.parent.parent.parent, "skills/execute/scripts/git-env-canary.py")


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
        if name == "arm":
            p.add_argument("--resume", action="store_true")
        if name == "ack":
            p.add_argument("--slugs", required=True)
            p.add_argument("--ref", required=True)
        if name == "restore":
            p.add_argument("--drop-local", default=None)
            p.add_argument("--bare-only", action="store_true")
    try:
        args = ap.parse_args(argv)
        ctx = Ctx(args)
        refusal = _engine_guard(ctx.rollout)
        if refusal:   # ADR 0043: a stamped rollout's canary runs on its own Engine snapshot; nothing written
            print(refusal, file=sys.stderr)
            return 2
        if args.verb != "restore":
            ctx.lock()
        return VERBS[args.verb](ctx, args)
    except CanaryError as e:
        msg = str(e)
        print(msg if msg.startswith("ERROR:") else f"git-env-canary: {msg}", file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
