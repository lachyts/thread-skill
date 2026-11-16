#!/usr/bin/env python3
"""green-tip.py — the live target of a repo: its Green tip (ADR 0084 d1 and Decided for you 11; built by p54-6).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/green-tip.py target --repo R --branch D [--checkout] [--no-gh]
        [--no-write] [--budget S] [--now ISO] [--json]

The Green tip is the newest commit on origin's default branch whose full suite passed there: full-suite.yml's last job,
`green-tip` (`publish the Green tip`), fast-forwards refs/thread/green to it. Live code runs from it and never past it
(ADR 0084 d1 and d2, "Everything waits"): an Engine snapshot is cut at it (engine-snapshot.py cut), and the movers of a
live checkout stop at it (primary-refresh.py's pass, land.sh S4 and O9, self-rollout-check.sh --refresh-in-place). This
docstring is the one copy of the rules every one of them reads through.

Importable: resolve(repo, branch, *, checkout=False, gh=True, write=True, budget=150, now=None, run=None,
nogh_why=None) returns {kind, target, green, origin, behind, publishes, verified, stepped, fallback, cause, why}:
kind `green` (target the Green tip, or a recorded verified commit before it), `origin` (target origin's tip: this repo
publishes no Green tip, or the checkout is not live) or `hold` (target None: nothing moves, and never to origin's tip).
green is refs/thread/green's commit when it was fetched, origin is refs/remotes/origin/<branch>'s, behind counts target
..origin (None on a hold), verified says the target was verified, stepped that it is a step back from an unverified
Green tip, fallback (a hold only, read only by the cut) the newest recorded verified ancestor of origin/<branch> or
None, cause (a hold only) absent | unreachable | not-ancestor | unverified | unreadable, and why one line in words. The
caller has fetched <branch> already: nothing here fetches it.

waits(repo, branch, *, run=None) returns (True, None) when <repo> waits on the Green tip, else (False, why): steps 0 and
1 alone, local, with no network call, no gh and no write (the record is read, never written, and its WARNs are
silent). It is how a reader that only advises tells a checkout whose movers stop at the Green tip from one that
follows origin's tip: thread-placement.py's `behind` finding (read-only, it never fetches) and pushed-base.sh's reset
hint (the CLI's `waits`). The Green tip itself is never read: a checkout that waits may stand at it, behind it or on a
hold.

The reading, in order, stopping at the first that decides:
  0. The live-checkout rule (checkout=True only, local). Only a main checkout takes the Green tip: its git dir is its
     common dir, it is its own toplevel, and its name does not end `-rollout` (a Rollout clone is the code being built).
     Any other checkout (a linked worktree, an Engine snapshot, a Rollout clone) reads kind origin, why `not a live
     checkout`, with no network call. The cut never passes it: a snapshot is cut at the Green tip from any checkout.
     An origin/<branch> that names no commit is a hold, cause unreadable, before anything else.
  1. Whether the repo publishes one, decided by facts a failed fetch cannot fake: the blob
     refs/remotes/origin/<branch>:.github/workflows/full-suite.yml holds a line `^  green-tip:` and the text
     refs/thread/green, or the record (below) has `seen` for this origin. Neither: kind origin, target origin's tip, no
     network call and no gh. Every repo but one that publishes reads this way.
  2. The fetch, by name: `git -C <repo> [-c core.sshCommand='ssh -o BatchMode=yes'] fetch --quiet --no-tags
     --no-write-fetch-head origin +refs/thread/green:refs/thread/fetched/green`, into a private namespace a `fetch
     --prune` never touches. The -c only when GIT_SSH_COMMAND, GIT_SSH and the repo's core.sshCommand are all unset
     (live-checkout.sh's lc_ssh_rule). The local ref is read only after this call's own exit 0, so a stale copy from an
     earlier fetch is never read. A failure asks `git ls-remote --exit-code origin refs/thread/green`: its exit 2 is
     cause absent (the why names `gone from origin after it was seen` when the record saw it, with the record key to
     drop if origin stopped publishing on purpose); its exit 0 (there, not fetched), any other failure, a timeout or no
     time left to ask is cause unreachable, the one transient cause, its why starting `refs/thread/green: `. A
     successful fetch records `seen` (the commit) and `seenAt`.
  3. The ancestor guard: `merge-base --is-ancestor G refs/remotes/origin/<branch>`. No: a hold, cause not-ancestor (the
     ref was moved by something other than master's own run; no ruleset can guard it on this repo). Any other exit:
     cause unreadable.
  4. Verification. G is verified when the record's `verified` list holds it. Otherwise an `unverified` entry for G
     younger than GH_RETRY (15 min) is not verified, with no call. Otherwise gh is asked, when gh=True, the origin has
     a GitHub slug (landing-register.py's three URL forms: https://github.com/, git@github.com:, ssh://git@github.com/),
     `gh` is on PATH, and at least 1 s of the budget is left: exactly
       env GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0 gh api -X GET repos/<slug>/commits/<sha>/check-runs
         -f check_name=publish the Green tip -f filter=latest
     (each -f one argument), bounded at min(30 s, what is left). Its answer reads three ways. Verified: a run named
     `publish the Green tip` whose .app.slug is github-actions, status completed, conclusion success, and head_sha G
     when it has one: recorded {sha, at, by: "gh"}, and G leaves `unverified`. Pending: such a run not completed, and no
     verified one: not verified, and nothing recorded (the publisher pushes the ref from inside that very run, and its
     timeout-minutes: 5 bounds a hung one). Negative: anything else (no such run, a completed non-success, a non-zero
     exit, unreadable JSON, a timeout at the full 30 s): recorded `unverified` {sha, at}. A call the budget clipped
     below 30 s that times out records nothing (it never had a fair answer). Under write=False nothing is recorded.
  5. The step-back. An unverified G steps back to the newest recorded verified commit that is an ancestor of G (newest
     by history: one no other candidate descends from): kind green, target V, stepped true, the why naming G as not
     verified and why (nogh_why, else `gh is not asked`, when gh=False). None recorded: a hold, cause unverified. So a
     ref moved to an untested commit, master's own tip included, is never followed.
  6. A hold has target None, its cause and why, and fallback. It never yields origin's tip.

The record, ${THREAD_GREEN_TIP_FILE:-${XDG_STATE_HOME:-~/.local/state}/thread/green-tip.json}: {"v": 1, "repos":
{<the origin's slug, lowercased, else its raw URL>: {"seen", "seenAt", "verified": [{sha, at, by}] (newest first, at
most 20), "unverified": [{sha, at}] (newest first, at most 20)}}}. Written by temp file and os.replace, under
fcntl.flock(LOCK_EX|LOCK_NB) on `<file>.lock`, re-read under the lock so a concurrent writer's entries are kept;
retried every 50 ms while more than 0.5 s of the budget is left, else `green-tip: WARN: the record is locked: this
reading is not recorded` and no write (a skipped write costs only a cache miss). Reads take no lock. A corrupt file is
one WARN and is rewritten valid at the next write. A repo whose origin has no URL has no record key.

The runner: run(argv, timeout) -> (rc, out, err, timed_out). The default gives each child temp files for stdout and
stderr, never pipes (so a leftover descendant can never block a read), with os.environ less git's repo-local vars (the
two config channels kept) and GIT_TERMINAL_PROMPT=0. Imported, resolve(run=None) starts each child in its own session
and kills its whole group at its bound and after it exits. The CLI keeps every child in the CLI's own process group and
kills only the child at its bound: its caller (land.sh's `bounded`, live-checkout.sh's `lc_bounded`) kills that group at
its own bound and after a normal exit, so an outer kill stops the whole read and a descendant an inner kill leaves
(ssh under git) is reaped there. Run by hand outside such a wrapper, a hung ssh may outlive an inner timeout until it
exits. primary-refresh.py passes its signal-aware _run; engine-snapshot.py an adapter over its run_group.

The budget (--budget S, default 150) clips each step's cap (the fetch 60 s, ls-remote 60 s, gh 30 s) to what is left.
A step with under 1 s left is skipped: the fetch reads cause unreachable (`no time left to fetch it`), the ls-remote
`not fetched`, and gh not verified with nothing recorded. The callers' budgets: the cut 150 with gh and writes; the
Primary refresh's real pass 150 with gh and writes, its --dry-run 30, no gh, no write; land.sh min(60, what is left of
LAND_DEADLINE - 10) under an outer gb + 5; self-rollout-check.sh --refresh-in-place 60 under lc_bounded 70.

CLI: `target` prints one line, `<kind> <sha|-> <why>`, or with --json the dict. `waits --repo R --branch D` prints
`waits` or `origin <why>` (waits()). Exit 0 for any reading, 2 on usage, 1 on an internal failure. Every caller
reads exit 1, a timeout or a bounded rc 124 as a hold (fail closed). --now pins the clock (tests). Stdlib only,
python >= 3.9, POSIX (fcntl).
"""
import argparse
import fcntl
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True

GREEN_REF = "refs/thread/green"
FETCHED_REF = "refs/thread/fetched/green"
WORKFLOW = ".github/workflows/full-suite.yml"
CHECK_NAME = "publish the Green tip"
GH_APP = "github-actions"
GH_RETRY = timedelta(minutes=15)
CAP = 20
FETCH_CAP = 60
LSR_CAP = 60
GH_CAP = 30
LOCAL_TIMEOUT = 30
DEFAULT_BUDGET = 150
LOCK_SPIN = 0.05
LOCK_FLOOR = 0.5
HEX_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
JOB_RE = re.compile(r"(?m)^  green-tip:")
OWNER = r"[A-Za-z0-9][A-Za-z0-9._-]*"
SEG = r"[A-Za-z0-9._-]+"
SLUG_RE = re.compile(r"(%s)/(%s)" % (OWNER, SEG))
# landing-register.py's ORIGIN_RE and parse_slug, mirrored: the three GitHub URL forms execution-fit admits.
ORIGIN_RE = re.compile(r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)(.*)")


def _warn(msg):
    print(f"green-tip: WARN: {msg}", file=sys.stderr, flush=True)


# ---- children ------------------------------------------------------------------------------------------------------

def _env():
    env = dict(os.environ)
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=LOCAL_TIMEOUT).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]
    for n in names:
        if n not in ("GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"):
            env.pop(n, None)
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def make_runner(own_group=True):
    """The default runner (the docstring's): own_group starts each child in its own session and kills its group; else
    the child stays in this process's group and only it is killed at its bound."""
    env = _env()

    def run(argv, timeout):
        with tempfile.TemporaryFile() as fo, tempfile.TemporaryFile() as fe:
            try:
                p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=fo, stderr=fe, env=env,
                                     start_new_session=own_group)
            except OSError as e:
                return 127, "", str(e), False
            timed_out = False
            try:
                p.wait(timeout=max(float(timeout), 0.01))
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    if own_group:
                        os.killpg(p.pid, signal.SIGKILL)
                    else:
                        p.kill()
                except OSError:
                    pass
                p.wait()
            except BaseException:
                try:
                    os.killpg(p.pid, signal.SIGKILL) if own_group else p.kill()
                except OSError:
                    pass
                p.wait()
                raise
            if own_group:
                try:
                    os.killpg(p.pid, signal.SIGKILL)  # a descendant left behind
                except OSError:
                    pass
            fo.seek(0)
            fe.seek(0)
            out = fo.read().decode("utf-8", "replace").strip()
            err = fe.read().decode("utf-8", "replace").strip()
        return p.returncode, out, err, timed_out

    return run


def _why_line(text, n=200):
    lines = [" ".join(x.split()) for x in str(text or "").splitlines() if x.strip()]
    said = [x for x in lines if x.startswith(("fatal:", "error:"))]
    return (said or lines or [""])[-1][:n]


# ---- the origin and the record -------------------------------------------------------------------------------------

def parse_slug(url):
    """owner/name for a GitHub origin URL (landing-register.py's three forms), else None."""
    m = ORIGIN_RE.fullmatch((url or "").strip())
    rest = m.group(1) if m else ""
    if rest.endswith("/"):
        rest = rest[:-1]
    if rest.endswith(".git"):
        rest = rest[:-4]
    s = SLUG_RE.fullmatch(rest)
    if not s or any(set(seg) == {"."} for seg in s.groups()):
        return None
    return f"{s.group(1)}/{s.group(2)}"


def record_path():
    p = os.environ.get("THREAD_GREEN_TIP_FILE")
    if p:
        return Path(os.path.expanduser(p))
    base = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    return Path(base) / "thread" / "green-tip.json"


def _entries(v, fields):
    out = []
    for x in v if isinstance(v, list) else []:
        if isinstance(x, dict) and isinstance(x.get("sha"), str) and HEX_RE.match(x["sha"]) \
                and isinstance(x.get("at"), str):
            out.append({k: x[k] for k in fields if k in x})
    return out


def read_record(path, warn=True):
    """(data, dirty): the record, each repo entry's lists checked; dirty when the file read as corrupt or anything was
    dropped (so a write rewrites it valid). Never raises."""
    empty = {"v": 1, "repos": {}}
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return empty, False
    except OSError as e:
        if warn:
            _warn(f"the record {path} cannot be read ({e}): read as empty")
        return empty, True
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("repos"), dict):
        if warn:
            _warn(f"the record {path} is corrupt: read as empty, rewritten at the next write")
        return empty, True
    repos, dirty = {}, False
    for k, e in data["repos"].items():
        if not isinstance(e, dict):
            dirty = True
            continue
        ne = {}
        if isinstance(e.get("seen"), str) and HEX_RE.match(e["seen"]):
            ne["seen"] = e["seen"]
            if isinstance(e.get("seenAt"), str):
                ne["seenAt"] = e["seenAt"]
        ne["verified"] = _entries(e.get("verified"), ("sha", "at", "by"))
        ne["unverified"] = _entries(e.get("unverified"), ("sha", "at"))
        dirty = dirty or any(ne.get(f) != e.get(f) for f in ("seen", "verified", "unverified"))
        repos[k] = ne
    return {"v": 1, "repos": repos}, dirty


def write_record(path, key, ops, left):
    """Apply ops (each fn(entry)) to key's entry under the record's lock, re-read first; temp file and os.replace.
    False, with one WARN, when the lock was not taken in time or the write failed."""
    path = Path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(path) + ".lock", os.O_RDWR | os.O_CREAT, 0o644)
    except OSError as e:
        _warn(f"cannot open the record's lock {path}.lock ({e}): this reading is not recorded")
        return False
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if left() > LOCK_FLOOR:
                    time.sleep(LOCK_SPIN)
                    continue
                _warn("the record is locked: this reading is not recorded")
                return False
        data, _ = read_record(path, warn=False)
        if key is not None:
            entry = data["repos"].setdefault(key, {"verified": [], "unverified": []})
            entry.setdefault("verified", [])
            entry.setdefault("unverified", [])
            for op in ops:
                op(entry)
        tmp = None
        try:
            with tempfile.NamedTemporaryFile("w", dir=str(path.parent), prefix=".green-tip.", suffix=".tmp",
                                             delete=False, encoding="utf-8") as f:
                tmp = f.name
                json.dump(data, f, indent=1, sort_keys=True)
                f.write("\n")
            os.replace(tmp, str(path))
            tmp = None
        finally:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
        return True
    except OSError as e:
        _warn(f"cannot write the record {path} ({e}): this reading is not recorded")
        return False
    finally:
        os.close(fd)


def _parse_now(now):
    if isinstance(now, datetime):
        return now if now.tzinfo else now.astimezone()
    if isinstance(now, str) and now:
        t = datetime.fromisoformat(now.replace("Z", "+00:00"))
        return t if t.tzinfo else t.astimezone()
    return datetime.now().astimezone()


def _iso(s):
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.astimezone()


# ---- the reading ---------------------------------------------------------------------------------------------------

class _Reader:
    def __init__(self, repo, run, budget):
        self.repo, self.run = str(repo), run
        self.end = time.monotonic() + float(budget)

    def left(self):
        return self.end - time.monotonic()

    def git(self, *args, timeout=LOCAL_TIMEOUT):
        rc, out, err, timed_out = self.run(["git", "-C", self.repo, *args], timeout)
        return (124 if timed_out else rc), (out or "").strip(), (err or "").strip()

    def rev(self, ref):
        rc, out, _ = self.git("rev-parse", "-q", "--verify", f"{ref}^{{commit}}")
        return out if rc == 0 and HEX_RE.match(out) else None

    def is_ancestor(self, a, b):
        return self.git("merge-base", "--is-ancestor", a, b)[0]

    def count(self, rng):
        rc, out, _ = self.git("rev-list", "--count", rng)
        return int(out) if rc == 0 and out.isdigit() else None


def _not_live(r):
    rc, top, _ = r.git("rev-parse", "--show-toplevel")
    if rc != 0 or os.path.realpath(top) != os.path.realpath(r.repo):
        return "not its own toplevel"
    rc1, gd, _ = r.git("rev-parse", "--path-format=absolute", "--git-dir")
    rc2, gc, _ = r.git("rev-parse", "--path-format=absolute", "--git-common-dir")
    if rc1 or rc2 or os.path.realpath(gd) != os.path.realpath(gc):
        return "a linked worktree"
    if os.path.basename(os.path.realpath(r.repo)).endswith("-rollout"):
        return "a Rollout clone"
    return None


def _record_key(r):
    """(slug, key): the origin's GitHub slug, and its record key (the slug lowercased, else the raw URL, else None)."""
    url = r.git("remote", "get-url", "origin")[1]
    slug = parse_slug(url)
    return slug, (slug.lower() if slug else (url or None))


def _publishes(r, branch, entry):
    """Step 1: origin/<branch>'s full-suite.yml, as last fetched, holds the green-tip job and the ref, or the record's
    entry has seen the ref."""
    rc, yml, _ = r.git("cat-file", "blob", f"refs/remotes/origin/{branch}:{WORKFLOW}")
    return (rc == 0 and bool(JOB_RE.search(yml)) and GREEN_REF in yml) or bool(entry.get("seen"))


def waits(repo, branch, *, run=None):
    """(True, None) when <repo> is a live checkout of a repo that publishes a Green tip, else (False, why): steps 0
    and 1 only (the module docstring's waits)."""
    r = _Reader(repo, run or make_runner(own_group=True), LOCAL_TIMEOUT * 6)
    why = _not_live(r)
    if why:
        return False, f"not a live checkout ({why})"
    _, key = _record_key(r)
    entry = read_record(record_path(), warn=False)[0]["repos"].get(key, {}) if key is not None else {}
    if not _publishes(r, branch, entry):
        return False, "this repo publishes no Green tip"
    return True, None


def _newest(r, shas, below):
    """The newest of the recorded shas that is `below` or an ancestor of it (one no other candidate descends from)."""
    best = None
    for s in shas:
        if s != below and r.is_ancestor(s, below) != 0:
            continue
        if best is None or (best != s and r.is_ancestor(best, s) == 0):
            best = s
    return best


def _gh_answer(out, sha):
    """verified | pending | negative for a check-runs reply."""
    try:
        runs = json.loads(out).get("check_runs")
    except (ValueError, AttributeError):
        return "negative"
    if not isinstance(runs, list):
        return "negative"
    ours = [x for x in runs if isinstance(x, dict) and x.get("name") == CHECK_NAME
            and isinstance(x.get("app"), dict) and x["app"].get("slug") == GH_APP
            and (not x.get("head_sha") or x.get("head_sha") == sha)]
    if any(x.get("status") == "completed" and x.get("conclusion") == "success" for x in ours):
        return "verified"
    if any(x.get("status") != "completed" for x in ours):
        return "pending"
    return "negative"


def resolve(repo, branch, *, checkout=False, gh=True, write=True, budget=DEFAULT_BUDGET, now=None, run=None,
            nogh_why=None):
    """The live target (the module docstring's reading)."""
    run = run or make_runner(own_group=True)
    r = _Reader(repo, run, budget)
    now = _parse_now(now)
    stamp = now.isoformat(timespec="seconds")
    od = f"refs/remotes/origin/{branch}"
    out = {"kind": None, "target": None, "green": None, "origin": None, "behind": None, "publishes": False,
           "verified": None, "stepped": False, "fallback": None, "cause": None, "why": None}
    ops = []
    state = {"key": None, "path": record_path(), "dirty": False, "verified": []}

    def finish():
        if write and (ops or state["dirty"]):
            write_record(state["path"], state["key"], ops if state["key"] is not None else [], r.left)
        return out

    def hold(cause, why):
        out.update(kind="hold", target=None, cause=cause, why=why)
        if out["origin"] and state["verified"]:
            out["fallback"] = _newest(r, state["verified"], out["origin"])
        return finish()

    def take(kind, target, why, **kw):
        out.update(kind=kind, target=target, why=why, **kw)
        if out["behind"] is None and out["origin"]:
            out["behind"] = r.count(f"{target}..{out['origin']}")
        return finish()

    origin = r.rev(od)
    if not origin:
        return hold("unreadable", f"{od} names no commit")
    out["origin"] = origin
    if checkout:
        why = _not_live(r)
        if why:
            return take("origin", origin, f"origin/{branch}: not a live checkout ({why})")
    slug, key = _record_key(r)
    state["key"] = key
    rec, state["dirty"] = read_record(state["path"])
    entry = rec["repos"].get(key, {}) if key is not None else {}
    state["verified"] = [v["sha"] for v in entry.get("verified", [])]
    publishes = _publishes(r, branch, entry)
    out["publishes"] = publishes
    if not publishes:
        return take("origin", origin, f"origin/{branch}: this repo publishes no Green tip")

    # 2. the fetch, by name
    ssh = []
    if not os.environ.get("GIT_SSH_COMMAND") and not os.environ.get("GIT_SSH") \
            and not r.git("config", "core.sshCommand")[1]:
        ssh = ["-c", "core.sshCommand=ssh -o BatchMode=yes"]
    if r.left() < 1:
        return hold("unreachable", f"{GREEN_REF}: no time left to fetch it")
    cap = min(FETCH_CAP, r.left())
    frc, _, ferr, fto = run(["git", "-C", r.repo, *ssh, "fetch", "--quiet", "--no-tags", "--no-write-fetch-head",
                             "origin", f"+{GREEN_REF}:{FETCHED_REF}"], cap)
    if frc != 0 or fto:
        said = f"the fetch ran past {int(cap)} s and was stopped" if fto else (_why_line(ferr) or f"exit {frc}")
        if r.left() < 1:
            return hold("unreachable", f"{GREEN_REF}: not fetched ({said})")
        lrc, _, _, lto = run(["git", "-C", r.repo, *ssh, "ls-remote", "--exit-code", "origin", GREEN_REF],
                             min(LSR_CAP, r.left()))
        if lrc == 2 and not lto:
            if entry.get("seen"):
                return hold("absent", f"{GREEN_REF} is gone from origin after it was seen (if origin stopped "
                                      f"publishing on purpose, drop \"{key}\" from {state['path']})")
            return hold("absent", f"{GREEN_REF} is not on origin, which publishes one ({WORKFLOW}'s green-tip job)")
        if lrc == 0 and not lto:
            return hold("unreachable", f"{GREEN_REF}: origin holds it, but the fetch failed ({said})")
        return hold("unreachable", f"{GREEN_REF}: origin did not answer ({said})")
    g = r.rev(FETCHED_REF)
    if not g:
        return hold("unreadable", f"{FETCHED_REF} names no commit after the fetch")
    out["green"] = g
    if key is not None and (entry.get("seen") != g):
        ops.append(lambda e, g=g: e.update(seen=g, seenAt=stamp))

    # 3. the ancestor guard
    arc = r.is_ancestor(g, origin)
    if arc == 1:
        return hold("not-ancestor", f"{GREEN_REF} ({g[:12]}) is not an ancestor of origin/{branch} ({origin[:12]}): "
                                    "moved by something other than master's own run")
    if arc != 0:
        return hold("unreadable", f"cannot compare {GREEN_REF} with origin/{branch} (git merge-base exit {arc})")

    # 4. verification
    if g in state["verified"]:
        n = r.count(f"{g}..{origin}")
        return take("green", g, f"the Green tip {g[:12]}, {n} behind origin/{branch}", verified=True, behind=n)
    reason = None
    recent = [u for u in entry.get("unverified", []) if u["sha"] == g and _iso(u["at"]) is not None
              and timedelta(0) <= now - _iso(u["at"]) < GH_RETRY]
    if recent:
        reason = "no passing publish run on it, asked within 15 min"
    elif not gh:
        reason = nogh_why or "gh is not asked"
    elif not slug:
        reason = "not a GitHub origin: only a recorded commit verifies"
    elif not shutil.which("gh"):
        reason = "no gh on PATH"
    elif r.left() < 1:
        reason = "no time left to ask gh"
    else:
        cap = min(GH_CAP, r.left())
        grc, gout, gerr, gto = run(["env", "GH_PROMPT_DISABLED=1", "GIT_TERMINAL_PROMPT=0", "gh", "api", "-X", "GET",
                                    f"repos/{slug}/commits/{g}/check-runs", "-f", f"check_name={CHECK_NAME}",
                                    "-f", "filter=latest"], cap)
        if gto and cap < GH_CAP:
            answer, reason = "clipped", f"gh ran past {int(cap)} s, the time left"
        elif gto or grc != 0:
            answer = "negative"
            reason = f"gh ran past {int(cap)} s" if gto else f"gh failed: {_why_line(gerr) or f'exit {grc}'}"
        else:
            answer = _gh_answer(gout, g)
            reason = {"pending": "its publish run is still running",
                      "negative": "no passing publish run on it"}.get(answer)
        if answer == "verified":
            def verify(e, g=g):
                e["verified"] = ([{"sha": g, "at": stamp, "by": "gh"}]
                                 + [v for v in e.get("verified", []) if v.get("sha") != g])[:CAP]
                e["unverified"] = [u for u in e.get("unverified", []) if u.get("sha") != g]
            ops.append(verify)
            state["verified"].insert(0, g)
            n = r.count(f"{g}..{origin}")
            return take("green", g, f"the Green tip {g[:12]}, {n} behind origin/{branch}", verified=True, behind=n)
        if answer == "negative":
            def unverify(e, g=g):
                e["unverified"] = ([{"sha": g, "at": stamp}]
                                   + [u for u in e.get("unverified", []) if u.get("sha") != g])[:CAP]
            ops.append(unverify)

    # 5. the step-back
    v = _newest(r, [s for s in state["verified"] if s != g], g)
    if v:
        return take("green", v, f"the Green tip {g[:12]} is not verified ({reason}): stepped back to {v[:12]}, the "
                                "newest verified commit before it", verified=True, stepped=True)
    return hold("unverified", f"the Green tip {g[:12]} is not verified ({reason}), and no verified commit is recorded "
                              "before it")


# ---- CLI -----------------------------------------------------------------------------------------------------------

class _Parser(argparse.ArgumentParser):
    def error(self, message):
        print(f"green-tip: usage: {message}", file=sys.stderr)
        sys.exit(2)


def main(argv=None):
    p = _Parser(prog="green-tip.py", description="The live target of a repo: its Green tip (ADR 0084).")
    sub = p.add_subparsers(dest="cmd", parser_class=_Parser)
    t = sub.add_parser("target", help="print the live target: <kind> <sha|-> <why>")
    t.add_argument("--repo", required=True)
    t.add_argument("--branch", required=True)
    t.add_argument("--checkout", action="store_true", help="apply the live-checkout rule (a mover of a checkout)")
    t.add_argument("--no-gh", dest="gh", action="store_false", help="never ask gh")
    t.add_argument("--no-write", dest="write", action="store_false", help="record nothing")
    t.add_argument("--budget", type=float, default=DEFAULT_BUDGET, help="seconds for the whole reading (default 150)")
    t.add_argument("--now", default=None, help="the time to read against, ISO (tests)")
    t.add_argument("--json", action="store_true", help="print the reading as JSON")
    w = sub.add_parser("waits", help="print waits, or origin <why>: local, no network (steps 0 and 1)")
    w.add_argument("--repo", required=True)
    w.add_argument("--branch", required=True)
    a = p.parse_args(argv)
    if a.cmd == "waits":
        try:
            ok, why = waits(a.repo, a.branch, run=make_runner(own_group=False))
        except Exception as e:  # noqa: BLE001
            print(f"green-tip: internal failure: {type(e).__name__}: {' '.join(str(e).split())[:200]}", file=sys.stderr)
            return 1
        print("waits" if ok else f"origin {why}")
        return 0
    if a.cmd != "target":
        print("green-tip: usage: green-tip.py target --repo R --branch D [--checkout] [--no-gh] [--no-write] "
              "[--budget S] [--now ISO] [--json] | waits --repo R --branch D", file=sys.stderr)
        return 2
    if a.budget <= 0:
        print("green-tip: usage: --budget must be > 0", file=sys.stderr)
        return 2
    try:
        _parse_now(a.now)
    except ValueError:
        print(f"green-tip: usage: --now {a.now!r} is not an ISO time", file=sys.stderr)
        return 2
    try:
        res = resolve(a.repo, a.branch, checkout=a.checkout, gh=a.gh, write=a.write, budget=a.budget, now=a.now,
                      run=make_runner(own_group=False))
    except Exception as e:  # noqa: BLE001 — every caller reads exit 1 as a hold
        print(f"green-tip: internal failure: {type(e).__name__}: {' '.join(str(e).split())[:200]}", file=sys.stderr)
        return 1
    if a.json:
        print(json.dumps(res, sort_keys=True))
    else:
        print(f"{res['kind']} {res['target'] or '-'} {' '.join(str(res['why']).split())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
