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
  2. Busy: `.git/index.lock`, a rebase or a merge in progress, or HEAD not on the default branch (origin/HEAD's
     target, else master, else main) prints `busy: <why>` and moves nothing.
  3. The hold, for the primary only: `bash <primary>/skills/_shared/scripts/primary-hold.sh <primary>`, the primary's
     own copy, since it is the rule the rollouts reading the primary run by. Any output is `held: <it>`. A missing
     script, a non-zero exit or a timeout holds too (fail closed). An `--also` checkout has no hold: sessions commit
     there in place, so a fast-forward is no different from a peer's commit.
  4. `git fetch --quiet origin` (60 s, GIT_TERMINAL_PROMPT=0). A failure is `fetch failed: <why>`.
  5. HEAD at origin/<default>: `current`. HEAD an ancestor of it: `git merge --ff-only --no-autostash
     origin/<default>`, printing `moved <old12>..<new12> (<n> commits)`, or `refused: <git's reason>` when git will
     not (an uncommitted edit it would overwrite): retried next pass. Origin an ancestor of HEAD: `ahead <n>: left to
     its landing route`. Otherwise `diverged (ahead <a>, behind <b>)`: never integrated (ADR 0042's rule); a close's
     landing PR merges with --merge, so its commits become ancestors of origin and the next pass moves.
  6. Notify: a checkout that has read diverged or refused at the same HEAD and origin tip for 24 h gets one ntfy push
     (skills/execute/scripts/ntfy-push.py), keyed on (HEAD, origin tip), in the state file
     ${XDG_STATE_HOME:-~/.local/state}/thread/primary-refresh.json (or --state), written atomically, only when it
     changes; a corrupt file reads as empty with one WARN. A checkout that reads anything else drops its entry.
  After a pass that moved the primary, the installed copy of this script (install's --bin-dir) is replaced by the
  primary's own, when they differ, so the job updates itself. --dry-run fetches, then says what it would do, moves
  nothing, notifies nothing and writes no state. --now pins the clock (tests). Exit 0 whatever it finds; 2 on usage.

install copies this script into --bin-dir (~/.local/state/thread/bin) and writes the launchd job to --plist
(~/Library/LaunchAgents/<label>.plist): ProgramArguments [this python, the copy, run, --primary <dir>, --also <dir>...],
StartInterval --interval (300), RunAtLoad, ProcessType Background, --log for stdout and stderr. It runs the copy, never
the primary's file, so the job exists before the primary holds this script (the first refresh brings it) and its path
never moves. Then it prints the one step left to Lachy's shell: `launchctl bootstrap gui/<uid> <plist>` (after
`launchctl bootout gui/<uid>/<label>` when the job is already loaded).

Stdlib only, python >= 3.9. Never writes the vault, a rollout note or a Run record.
"""
import argparse
import hashlib
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
DEFAULT_INTERVAL = 300
DEFAULT_LABEL = "com.thread.primary-refresh"
DEFAULT_LOG = "~/Library/Logs/thread-primary-refresh.log"
DEFAULT_BIN = "~/.local/state/thread/bin"
STATE_VERSION = 1
NOTIFY_AFTER = timedelta(hours=24)
GIT_TIMEOUT = 60
HOLD_TIMEOUT = 120
NTFY_TIMEOUT = 60


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
    """One checkout's pass: (outcome, key). key is (head, origin tip) for a state that may notify, else None."""
    why = checkout_problem(d)
    if why:
        return f"not a primary checkout: {why}", None
    branch = default_branch(d)
    why = busy(d, branch)
    if why:
        return f"busy: {why}", None
    if is_primary:
        h = hold(d)
        if h:
            return f"held: {h}", None
    rc, _, err = git(d, "fetch", "--quiet", "origin")
    if rc != 0:
        return f"fetch failed: {err.splitlines()[-1] if err else rc}", None
    upstream = f"origin/{branch}"
    head = git(d, "rev-parse", "HEAD")[1]
    tip = git(d, "rev-parse", upstream)[1]
    if not head or not tip:
        return f"cannot read HEAD or {upstream}", None
    if head == tip:
        return "current", None
    behind, ahead = _count(d, f"HEAD..{upstream}"), _count(d, f"{upstream}..HEAD")
    if git(d, "merge-base", "--is-ancestor", head, tip)[0] == 0:
        if dry_run:
            return f"would move {head[:12]}..{tip[:12]} ({behind} commits)", None
        rc, _, err = git(d, "merge", "--ff-only", "--no-autostash", "--quiet", upstream)
        if rc != 0:
            reason = " ".join(err.split())[:240] or f"exit {rc}"
            return f"refused: {reason}", (head, tip)
        return f"moved {head[:12]}..{tip[:12]} ({behind} commits)", None
    if git(d, "merge-base", "--is-ancestor", tip, head)[0] == 0:
        return f"ahead {ahead}: left to its landing route", None
    return f"diverged (ahead {ahead}, behind {behind}): never integrated here", (head, tip)


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


def _self_update(primary, bin_dir):
    """Replace the installed copy with the primary's own when they differ. Returns a log line or None."""
    src = Path(primary) / SELF_REL
    dst = _real(bin_dir) / "primary-refresh.py"
    if not src.is_file() or not dst.is_file():
        return None
    new = src.read_bytes()
    if hashlib.sha256(new).digest() == hashlib.sha256(dst.read_bytes()).digest():
        return None
    _atomic_write(dst, new.decode("utf-8"), mode=0o755)
    return f"the installed copy {dst} now matches the primary's"


def cmd_run(args):
    now = _parse_now(args.now)
    if now is None:
        print(f"ERROR: primary-refresh run: usage: --now {args.now!r} is not an ISO timestamp", file=sys.stderr)
        return 2
    primary = _real(args.primary or PLUGIN_ROOT)
    targets = [(primary, True)] + [(_real(a), False) for a in args.also if _real(a) != primary]
    state_path = _state_path(args.state)
    stuck = _read_state(state_path)
    before = json.dumps(stuck, sort_keys=True)
    stamp = now.isoformat(timespec="seconds")
    for d, is_primary in targets:
        outcome, key = refresh(d, is_primary, args.dry_run)
        print(f"{stamp} primary-refresh {d}: {outcome}", flush=True)
        if is_primary and outcome.startswith("moved ") and not args.dry_run:
            line = _self_update(d, args.bin_dir or DEFAULT_BIN)
            if line:
                print(f"{stamp} primary-refresh {d}: {line}", flush=True)
        k = str(d)
        if key is None:
            stuck.pop(k, None)
            continue
        entry = stuck.get(k)
        keystr = f"{key[0]}..{key[1]}"
        if not entry or entry.get("key") != keystr:
            stuck[k] = {"key": keystr, "since": stamp}
            continue
        since = _parse_now(entry.get("since"))
        if entry.get("notified") or since is None or now - since < NOTIFY_AFTER:
            continue
        message = (f"thread: {d.name} cannot fast-forward to origin since {entry['since'][:16]}: {outcome}"
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
    r.add_argument("--bin-dir", default=None, help=f"the installed copy's dir, for its self-update (default {DEFAULT_BIN})")
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
