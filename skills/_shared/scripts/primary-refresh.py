#!/usr/bin/env python3
"""primary-refresh.py — the Primary refresh (ADR 0066): keep the live-loaded checkouts current with origin.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/primary-refresh.py run [--primary DIR] [--also DIR]...
        [--state F] [--ntfy-server URL] [--now ISO] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/primary-refresh.py install [--primary DIR] [--also DIR]...
        [--bin-dir DIR] [--plist F] [--interval 300] [--label com.thread.primary-refresh]
        [--log ~/Library/Logs/thread-primary-refresh.log]

Every session loads this plugin live from its primary checkout (the directory-source install), and nothing else moves
that checkout for another project's rollout: `self-rollout-check.sh --refresh-in-place` runs only after this repo's own
merges. The Primary refresh is the background job that does: every pass it fast-forwards the primary to origin while
ADR 0031's hold is clear, and each `--also` checkout (`~/.agents`, which holds /fresh-review and the shared skills)
whenever it is behind.

run, one pass. For each checkout (the primary first), in order, stopping at the first step that says no; one log line
each, `<ISO time> primary-refresh <dir>: <outcome>`:
  1. The checkout: its own toplevel, a main checkout (its git dir is its common dir, so never a linked worktree or an
     Engine snapshot) whose name does not end `-rollout` (a Rollout clone). Else `not a primary checkout: <why>`.
     --primary defaults to this script's plugin root, three levels up.
  2. `git fetch --quiet origin` (60 s, GIT_TERMINAL_PROMPT=0), first: it only moves origin's refs, so it is safe under
     a hold and lets every later step know whether the checkout is behind. A failure is `fetch failed: <why>`.
  3. HEAD at origin/<default> (origin/HEAD's target, else master, else main): `current`, whatever else is going on.
     Origin an ancestor of HEAD: `ahead <n>: left to its landing route`. Neither an ancestor of the other: `diverged
     (ahead <a>, behind <b>)`: never integrated (ADR 0042's rule); a close's landing PR merges with --merge, so its
     commits become ancestors of origin and the next pass moves. Read before busy and the hold, so a diverged
     checkout always reads diverged.
  4. Behind, and busy: `.git/index.lock`, a rebase or a merge in progress, or HEAD not on the default
     branch prints `busy: <why>` and moves nothing.
  5. Behind, the primary only, and held: `bash <primary>/skills/_shared/scripts/primary-hold.sh
     <primary>`, the primary's own copy, since it is the rule the rollouts reading the primary run by. Any output is
     `held: <it>`. A missing script, a non-zero exit or a timeout holds too (fail closed). An `--also` checkout has no
     hold: sessions commit there in place, so a fast-forward is no different from a peer's commit.
  5a. Behind, neither busy nor held: `git merge --ff-only --no-autostash origin/<default>`, printing `moved
     <old12>..<new12> (<n> commits)`, or `refused: <git's reason>` when git will not (an uncommitted edit it would
     overwrite): retried next pass.
  6. Notify: a stuck spell is every pass from the first that reads not a primary checkout, busy, held, fetch
     failed, refused or diverged to the next that reads current, moved or ahead. Its clock never restarts within the
     spell, whatever origin does meanwhile and whichever stuck outcome a pass reads. A hold is a meant wait while a
     rollout runs, but one standing a day (a rollout whose ceremony never ran, a broken hold check) is reported like
     any other stuck spell. A spell 24 h old gets one ntfy push (skills/execute/scripts/ntfy-push.py). The spells live in the state file
     ${XDG_STATE_HOME:-~/.local/state}/thread/primary-refresh.json (or --state), written atomically, only when it
     changes; a corrupt file reads as empty with one WARN.
  The self-update: on a pass that has just fetched and found the primary at origin's tip (current, or moved there by
  this pass), origin's committed copy of this script replaces this file once it compiles, so the job catches up
  however the primary got there. The copy tracks origin's tip: a copy installed from a branch ahead of origin is
  replaced by origin's own at the next such pass. Only the copy install placed (the marker file
  primary-refresh.installed beside it) is ever rewritten: never a checkout's file, the version cache or any other copy.
  The fast-forward itself runs with no timeout, since a merge killed mid-checkout would leave a half-updated tree.
  --dry-run fetches, then says what it would do, moves nothing, updates nothing, notifies nothing and writes no
  state. --now pins the clock (tests). Exit 0 whatever it finds; 2 on usage.

install copies this script into --bin-dir (~/.local/state/thread/bin) and writes the launchd job to --plist
(~/Library/LaunchAgents/<label>.plist): ProgramArguments [this python, the copy, run, --primary <dir>, --also <dir>...],
StartInterval --interval (300), RunAtLoad, ProcessType Background, --log for stdout and stderr. It runs the copy, never
the primary's file, so the job exists before the primary holds this script (the first refresh brings it), its path
never moves, and it updates itself (run's self-update). Then it prints the one step left to Lachy's shell:
`launchctl bootstrap gui/<uid> <plist>` (after `launchctl bootout gui/<uid>/<label>` when the job is already loaded).

Stdlib only, python >= 3.9. Never writes the vault, a rollout note or a Run record.
"""
import argparse
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
PLUGIN_ROOT = HERE.parent.parent.parent
HOLD_REL = "skills/_shared/scripts/primary-hold.sh"
NTFY_REL = "skills/execute/scripts/ntfy-push.py"
SELF_REL = "skills/_shared/scripts/primary-refresh.py"
MARKER = "primary-refresh.installed"  # install writes it beside the copy: the one file the self-update may rewrite
DEFAULT_INTERVAL = 300
DEFAULT_LABEL = "com.thread.primary-refresh"
DEFAULT_LOG = "~/Library/Logs/thread-primary-refresh.log"
DEFAULT_BIN = "~/.local/state/thread/bin"
STATE_VERSION = 1
NOTIFY_AFTER = timedelta(hours=24)
GIT_TIMEOUT = 60
HOLD_TIMEOUT = 120
NTFY_TIMEOUT = 60
_STAMP = ""  # the pass's time, for the lines refresh() prints itself


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


def git(d, *args, timeout=GIT_TIMEOUT):
    """(returncode, stdout stripped, stderr stripped); a git that cannot run reads as 128."""
    try:
        p = subprocess.run(["git", "-C", str(d), *args], capture_output=True, text=True, env=ENV, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return 128, "", str(e)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def _git_raw(d, *args, timeout=GIT_TIMEOUT):
    """git() returning stdout as bytes, unstripped (a file's exact content)."""
    try:
        p = subprocess.run(["git", "-C", str(d), *args], capture_output=True, env=ENV, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return 128, b"", str(e)
    return p.returncode, p.stdout, p.stderr.decode("utf-8", "replace").strip()


def _real(p):
    return Path(os.path.realpath(os.path.expanduser(str(p))))


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


def default_branch(d):
    rc, ref, _ = git(d, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    if rc == 0 and ref.startswith("origin/"):
        return ref[len("origin/"):]
    for b in ("master", "main"):
        if git(d, "rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{b}")[0] == 0:
            return b
    return None


def busy(d, branch):
    """Why the checkout must not move now, or None."""
    rc, gd, _ = git(d, "rev-parse", "--path-format=absolute", "--git-dir")
    gd = Path(gd)
    if (gd / "index.lock").exists():
        return "index.lock present"
    for name, why in (("rebase-merge", "a rebase"), ("rebase-apply", "a rebase"), ("MERGE_HEAD", "a merge"),
                      ("CHERRY_PICK_HEAD", "a cherry-pick"), ("REVERT_HEAD", "a revert")):
        if (gd / name).exists():
            return f"{why} in progress"
    rc, head_ref, _ = git(d, "symbolic-ref", "--quiet", "--short", "HEAD")
    if rc != 0:
        return "HEAD detached"
    if branch is None:
        return "no origin default branch"
    if head_ref != branch:
        return f"on {head_ref}, not {branch}"
    return None


def hold(primary):
    """primary-hold.sh's line, or None when nothing holds. Fails closed."""
    script = Path(primary) / HOLD_REL
    if not script.is_file():
        return f"no {HOLD_REL} in the primary"
    try:
        p = subprocess.run(["bash", str(script), str(primary)], capture_output=True, text=True, env=ENV,
                           timeout=HOLD_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        return f"the hold check did not run ({e})"
    if p.returncode != 0:
        return f"the hold check exited {p.returncode}: {(p.stderr or p.stdout).strip()[:200]}"
    out = p.stdout.strip()
    return out or None


def _count(d, rng):
    rc, n, _ = git(d, "rev-list", "--count", rng)
    return int(n) if rc == 0 and n.isdigit() else -1


def refresh(d, is_primary, dry_run):
    """One checkout's pass: (outcome, stuck). stuck is True for an outcome that leaves the checkout behind origin
    with nothing on its way to fix it (step 6), False for one that clears a stuck spell, None for neither. It fetches
    first (a fetch only moves origin's refs, so it is safe under a hold), so busy and held count as stuck only for a
    checkout that is actually behind origin."""
    why = checkout_problem(d)
    if why:
        return f"not a primary checkout: {why}", True
    branch = default_branch(d)
    if branch is None:
        return "busy: no origin default branch", True
    rc, _, err = git(d, "fetch", "--quiet", "origin")
    if rc != 0:
        return f"fetch failed: {err.splitlines()[-1] if err else rc}", True
    upstream = f"origin/{branch}"
    head = git(d, "rev-parse", "HEAD")[1]
    tip = git(d, "rev-parse", upstream)[1]
    if not head or not tip:
        return f"cannot read HEAD or {upstream}", True
    if head == tip:
        if is_primary and not dry_run:
            _self_update_line(d, branch)
        return "current", False
    behind, ahead = _count(d, f"HEAD..{upstream}"), _count(d, f"{upstream}..HEAD")
    if git(d, "merge-base", "--is-ancestor", tip, head)[0] == 0:
        return f"ahead {ahead}: left to its landing route", False
    # Diverged before busy and the hold: a diverged checkout is never moved here, so it reads as what it is, and a
    # notice names the state someone has to fix, never a hold that may clear first.
    if git(d, "merge-base", "--is-ancestor", head, tip)[0] != 0:
        return f"diverged (ahead {ahead}, behind {behind}): never integrated here", True
    why = busy(d, branch)
    if why:
        return f"busy: {why}", True
    if is_primary:
        h = hold(d)
        if h:
            return f"held: {h}", True
    if dry_run:
        return f"would move {head[:12]}..{tip[:12]} ({behind} commits)", None
    # No timeout: a merge killed mid-checkout would leave the live-loaded tree half old, half new.
    rc, _, err = git(d, "merge", "--ff-only", "--no-autostash", "--quiet", upstream, timeout=None)
    if rc != 0:
        reason = " ".join(err.split())[:240] or f"exit {rc}"
        return f"refused: {reason}", True
    if is_primary:
        _self_update_line(d, branch)
    return f"moved {head[:12]}..{tip[:12]} ({behind} commits)", False


# ---- state and notify ------------------------------------------------------------------------------------

def _state_path(arg):
    if arg:
        return Path(os.path.expanduser(arg))
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return Path(base) / "thread" / "primary-refresh.json"


def _read_state(path):
    try:
        raw = path.read_text()
    except FileNotFoundError:
        return {}
    except OSError as e:
        print(f"WARN: primary-refresh: state {path} unreadable ({e}): read as empty", file=sys.stderr)
        return {}
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get("v") != STATE_VERSION or not isinstance(data.get("stuck"), dict):
            raise ValueError("not a v1 primary-refresh state")
        return {k: v for k, v in data["stuck"].items() if isinstance(k, str) and isinstance(v, dict)}
    except ValueError as e:
        print(f"WARN: primary-refresh: state {path} is corrupt ({e}): read as empty", file=sys.stderr)
        return {}


def _atomic_write(path, text, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _notify(primary, message, server):
    script = Path(primary) / NTFY_REL
    if not script.is_file():
        script = PLUGIN_ROOT / NTFY_REL
    argv = [sys.executable, "-B", str(script)] + (["--server", server] if server else [])
    try:
        p = subprocess.run(argv, input=message + "\n", capture_output=True, text=True, timeout=NTFY_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"primary-refresh: ntfy-push did not run: {e}", file=sys.stderr)
        return 1
    return p.returncode


def _parse_now(s):
    if not s:
        return datetime.now().astimezone()
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.astimezone()


def _self_update_line(primary, branch):
    line = self_update(primary, branch)
    if line:
        print(f"{_STAMP} primary-refresh {primary}: {line}", flush=True)


def self_update(primary, branch):
    """Bring the installed copy up to origin's committed script. Called only on a pass that has just fetched and found
    the primary at origin/<branch>'s tip (current, or moved there), so the source is never older than what it
    replaces; read from that commit, never the working tree, and installed only once it compiles. Only the copy
    install placed rewrites itself (MARKER beside it), never a checkout's file, the version cache or any other copy.
    Returns a log line or None; a failed read or write is a line, never an exception."""
    me = Path(__file__).resolve()
    if not (me.parent / MARKER).is_file():
        return None
    rc, src, _ = _git_raw(primary, "show", f"refs/remotes/origin/{branch}:{SELF_REL}")
    if rc != 0 or not src:
        return None
    try:
        if src == me.read_bytes():
            return None
        compile(src, SELF_REL, "exec")
        _atomic_write(me, src.decode("utf-8"), mode=0o755)
    except (SyntaxError, ValueError, UnicodeDecodeError) as e:
        return f"origin's {SELF_REL} does not compile ({e}): the installed copy is kept"
    except OSError as e:
        return f"the installed copy could not be updated ({e})"
    return f"the installed copy {me} now matches origin/{branch}"


def cmd_run(args):
    global _STAMP
    now = _parse_now(args.now)
    if now is None:
        print(f"ERROR: primary-refresh run: usage: --now {args.now!r} is not an ISO timestamp", file=sys.stderr)
        return 2
    primary = _real(args.primary or PLUGIN_ROOT)
    targets = [(primary, True)] + [(_real(a), False) for a in args.also if _real(a) != primary]
    state_path = _state_path(args.state)
    stuck = _read_state(state_path)
    before = json.dumps(stuck, sort_keys=True)
    _STAMP = stamp = now.isoformat(timespec="seconds")
    for d, is_primary in targets:
        outcome, is_stuck = refresh(d, is_primary, args.dry_run)
        print(f"{stamp} primary-refresh {d}: {outcome}", flush=True)
        k = str(d)
        if is_stuck is False:
            stuck.pop(k, None)
            continue
        if not is_stuck:
            continue
        # A stuck spell runs from its first stuck pass to the next pass that clears it, whatever origin does meanwhile
        # and whichever stuck outcome each pass reads, so new commits on origin and a blip never restart its clock.
        entry = stuck.get(k)
        since = _parse_now(entry.get("since")) if entry and isinstance(entry.get("since"), str) else None
        if since is None:
            stuck[k] = {"since": stamp}
            continue
        if entry.get("notified") or now - since < NOTIFY_AFTER:
            continue
        message = (f"thread: {d.name} has not caught up with origin since {entry['since'][:16]}: {outcome}"
                   f" (git -C {d} status)")[:200]
        if args.dry_run:
            print(f"{stamp} primary-refresh {d}: would notify: {message}", flush=True)
            continue
        rc = _notify(primary, message, args.ntfy_server)
        if rc == 0:
            entry["notified"] = stamp
            print(f"{stamp} primary-refresh {d}: notified", flush=True)
        else:
            print(f"{stamp} primary-refresh {d}: not notified (ntfy-push exit {rc})", flush=True)
    if not args.dry_run and json.dumps(stuck, sort_keys=True) != before:
        try:
            _atomic_write(state_path, json.dumps({"v": STATE_VERSION, "stuck": stuck}, indent=2, sort_keys=True)
                          + "\n")
        except OSError as e:
            print(f"WARN: primary-refresh: cannot write state {state_path}: {e}", file=sys.stderr)
    return 0


def cmd_install(args):
    primary = _real(args.primary or PLUGIN_ROOT)
    why = checkout_problem(primary)
    if why:
        print(f"ERROR: primary-refresh install: {primary} is {why}: pass --primary <the primary checkout>",
              file=sys.stderr)
        return 2
    bin_dir = _real(args.bin_dir)
    copy = bin_dir / "primary-refresh.py"
    _atomic_write(copy, Path(__file__).read_text(), mode=0o755)
    _atomic_write(bin_dir / MARKER, f"installed by primary-refresh.py install for {primary}\n")
    argv = [sys.executable, str(copy), "run", "--primary", str(primary)]
    for a in args.also:
        argv += ["--also", str(_real(a))]
    log = os.path.expanduser(args.log)
    job = {
        "Label": args.label,
        "ProgramArguments": argv,
        "EnvironmentVariables": {"PATH": ":".join(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
                                                  + ([os.path.dirname(shutil.which("git"))]
                                                     if shutil.which("git") else []))},
        "StartInterval": args.interval,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "StandardOutPath": log,
        "StandardErrorPath": log,
    }
    plist = Path(os.path.expanduser(args.plist or f"~/Library/LaunchAgents/{args.label}.plist"))
    _atomic_write(plist, plistlib.dumps(job).decode("utf-8"))
    uid = os.getuid()
    print(f"primary-refresh install: wrote {copy} and {plist}")
    print(f"next: launchctl bootout gui/{uid}/{args.label} 2>/dev/null; launchctl bootstrap gui/{uid} {plist}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="primary-refresh.py", description="The Primary refresh (ADR 0066): keep the "
                                "live-loaded checkouts current with origin.")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="one pass over the primary and each --also checkout")
    r.add_argument("--primary", default=None, help="the primary checkout (default: this script's plugin root)")
    r.add_argument("--also", action="append", default=[], help="another live-loaded checkout (no rollout hold)")
    r.add_argument("--state", default=None, help="the state file (default ${XDG_STATE_HOME:-~/.local/state}/thread/"
                                                 "primary-refresh.json)")
    r.add_argument("--ntfy-server", default=None, help="ntfy-push.py's --server")
    r.add_argument("--now", default=None, help="the time to read against, ISO (default: now)")
    r.add_argument("--dry-run", action="store_true", help="move nothing, notify nothing, write no state")
    r.set_defaults(func=cmd_run)
    i = sub.add_parser("install", help="install the copy and the launchd job")
    i.add_argument("--primary", default=None)
    i.add_argument("--also", action="append", default=[])
    i.add_argument("--bin-dir", default=DEFAULT_BIN)
    i.add_argument("--plist", default=None)
    i.add_argument("--interval", type=int, default=DEFAULT_INTERVAL)
    i.add_argument("--label", default=DEFAULT_LABEL)
    i.add_argument("--log", default=DEFAULT_LOG)
    i.set_defaults(func=cmd_install)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
