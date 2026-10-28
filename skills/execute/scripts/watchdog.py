#!/usr/bin/env python3
"""watchdog.py — the Watchdog's launchd fallback (ADR 0048, p29-7; status SKILL.md § The Watchdog's reading).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/watchdog.py check [--tasks-dir D] [--state F]
        [--stall-after MIN] [--chorus-url http://127.0.0.1:4747/] [--ntfy-server URL] [--gh-bin gh] [--now ISO]
        [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/watchdog.py plist [--interval 600]
        [--label com.thread.watchdog] [--log ~/Library/Logs/thread-watchdog.log] [--chorus-url URL]

The Watchdog has two layers (ADR 0048). thread-skill ships the reading, `reconcile-rollout.py moving`; Chorus's
Companion polls it and recovers a stalled rollout. When Chorus is not running, this script reads the same verdict, in
process (reconcile-rollout.py's moving_verdict), and only notifies Lachy through ntfy-push.py. It never resumes a lead,
never writes the vault or a Run record, and never starts anything: `stalled` is a reason to look, never by itself a
reason to start a second lead (status § The Watchdog's reading, *What `stalled` means*).

check, in order:
  (a) The Stage probe: GET <chorus-url>api/logins with a 1 s timeout, the read `scripts/stage/ctl.sh status` makes
      (Chorus's Stage-up signal). A 2xx prints `watchdog: Chorus is running (api/logins answered): the fallback stays
      silent` and exits 0, having read and written nothing. A refusal, a timeout or a non-2xx reads as not running.
      It never takes ~/.local/state/chorus/stage/host.lock: a probe that held that flock, even briefly, would make a
      Host starting at that instant exit `Held`. `--chorus-url ''` never probes.
      The interim gap: until the Chorus task that consumes `moving` lands, nothing reads it while the Stage is up, and
      a 2xx silences this fallback, so a stall then goes unnotified; `plist --chorus-url ''` installs a fallback that
      never probes, for the meantime (status § The Watchdog's reading, *The interim gap*).
  (b) The candidates: the `*.md` files directly in --tasks-dir whose name matches reconcile-rollout.py's
      ROLLOUT_NOTE_NAME_RE or ends `-rollout.md`, that parse, and that carry the `rollout` tag.
  (c) The mtime gate: a rollout whose Run record changed within --stall-after minutes prints `<slug> recent: not
      read` and is not read. A silence stall is never held back by it (its record went quiet); a halt stall's notice
      (the Stop hook's fresh halt line) can be delayed by up to --stall-after. Every other rollout is read with
      moving_verdict and --gh-bin, and prints one line, `<slug> <verdict> <cause>`.
  (d) One notification per stall, keyed on (slug, lastEvent), in the state file
      ${XDG_STATE_HOME:-~/.local/state}/thread/watchdog.json (or --state), {"v": 1, "notified": {slug: {lastEvent,
      at}}}, written atomically and only when it changes; a corrupt file reads as empty, with one WARN. A stall whose
      key is stored prints `already notified`. Otherwise one line goes to ntfy-push.py [--server], `see
      /thread:status <slug> — <slug>: rollout stalled (<cause>), no life sign for <age>m`, cut to 200 characters; its
      exit 0 records the key, any other exit records nothing. A key is dropped only when its rollout reads moving,
      waiting or skip this run, or its note has left the tasks dir; a `recent: not read`, a lost look (moving's
      MovingError, or any other exception moving_verdict raises, printed `<slug> not read: <type>: <why>`; the other
      rollouts are still read) or a note still there but no candidate keeps it.
  --stall-after is moving's own: its default reconcile-rollout.py STALL_AFTER_MIN (45), its bound 1 to STALL_AFTER_MAX
  (1440), both read from that module, so the fallback and the verb never disagree.
  --dry-run posts nothing and writes no state.
  Exit 0 whatever it finds; 1 when --tasks-dir cannot be read; 2 on usage.

plist prints the launchd job (plistlib) on stdout: ProgramArguments [this python, this script's absolute path, check,
--gh-bin <shutil.which("gh")>], plus `--chorus-url <URL>` when that flag is given ('' included); with no gh on PATH,
no --gh-bin and one WARN. EnvironmentVariables PATH is <gh's dir>:/usr/bin:/bin:/usr/sbin:/sbin, so `next`'s PR-hold
reads find gh under launchd. StartInterval --interval (600), RunAtLoad, ProcessType Background, and --log for stdout
and stderr. Installing it is Lachy's one-time step (README; status § The Watchdog's reading):
`watchdog.py plist > ~/Library/LaunchAgents/com.thread.watchdog.plist`, then
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.thread.watchdog.plist`.

Stdlib only, python >= 3.9. It sets sys.dont_write_bytecode before it loads reconcile-rollout.py, so no __pycache__
lands in the plugin directory.
"""
import argparse
import importlib.util
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
RECONCILE_PY = HERE / "reconcile-rollout.py"
NTFY_PY = HERE / "ntfy-push.py"
DEFAULT_CHORUS_URL = "http://127.0.0.1:4747/"   # Chorus's own ctl.sh URL
DEFAULT_INTERVAL = 600
DEFAULT_LABEL = "com.thread.watchdog"
DEFAULT_LOG = "~/Library/Logs/thread-watchdog.log"
STATE_VERSION = 1
MESSAGE_MAX = 200
PROBE_TIMEOUT = 1.0
NTFY_TIMEOUT = 60


def _load_reconcile():
    spec = importlib.util.spec_from_file_location("thread_reconcile_rollout_watchdog", RECONCILE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _state_path(arg):
    if arg:
        return Path(os.path.expanduser(arg))
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return Path(base) / "thread" / "watchdog.json"


def _read_state(path):
    """{slug: {lastEvent, at}}; a missing file is empty, a corrupt one empty with one WARN."""
    try:
        raw = path.read_text()
    except FileNotFoundError:
        return {}
    except OSError as e:
        print(f"WARN: watchdog: state {path} unreadable ({e}): read as empty", file=sys.stderr)
        return {}
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get("v") != STATE_VERSION or not isinstance(data.get("notified"), dict):
            raise ValueError("not a v1 watchdog state")
        return {k: v for k, v in data["notified"].items() if isinstance(k, str) and isinstance(v, dict)}
    except ValueError as e:
        print(f"WARN: watchdog: state {path} is corrupt ({e}): read as empty", file=sys.stderr)
        return {}


def _write_state(path, notified):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".watchdog-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as f:
            json.dump({"v": STATE_VERSION, "notified": notified}, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _stage_up(url):
    """True when the Chorus Stage answers GET <url>api/logins with a 2xx within PROBE_TIMEOUT (ctl.sh status's read).
    No proxy is consulted: the Stage is local."""
    if not url.endswith("/"):
        url += "/"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(urllib.request.Request(url + "api/logins", method="GET"), timeout=PROBE_TIMEOUT) as r:
            return 200 <= r.status < 300
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _candidates(rr, tasks_dir):
    """(slug, path) for each rollout note directly in tasks_dir ((b) above). Raises OSError when the dir cannot be read."""
    out = []
    for entry in sorted(os.listdir(tasks_dir)):
        if not entry.endswith(".md") or not (rr.ROLLOUT_NOTE_NAME_RE.search(entry) or entry.endswith("-rollout.md")):
            continue
        path = tasks_dir / entry
        if not path.is_file():
            continue
        try:
            note = rr.Note(path)
        except (OSError, ValueError):
            continue
        if "rollout" not in rr._tags(note):
            continue
        out.append((path.stem, path))
    return out


def _recent(rr, slug, now, stall_after):
    try:
        mtime = os.stat(rr._run_record().record_path(slug)).st_mtime
    except (OSError, Exception):  # noqa: BLE001 — no record, or none resolvable: no gate
        return False
    return now.timestamp() - mtime < stall_after * 60


def _message(v):
    age = v.get("ageMinutes")
    tail = f"no life sign for {age}m" if age is not None else "no life sign in the Run record"
    slug = v["rollout"]
    return f"see /thread:status {slug} — {slug}: rollout stalled ({v.get('cause')}), {tail}"[:MESSAGE_MAX]


def _notify(message, server):
    argv = [sys.executable, "-B", str(NTFY_PY)] + (["--server", server] if server else [])
    try:
        p = subprocess.run(argv, input=message + "\n", capture_output=True, text=True, timeout=NTFY_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"watchdog: ntfy-push did not run: {e}", file=sys.stderr)
        return 1
    for line in (p.stdout + p.stderr).splitlines():
        if line.strip():
            print(f"watchdog: {line.strip()}")
    return p.returncode


def cmd_check(args):
    rr = args.rr
    if not 1 <= args.stall_after <= rr.STALL_AFTER_MAX:
        print(f"ERROR: watchdog check: usage: --stall-after must be an integer from 1 to {rr.STALL_AFTER_MAX}",
              file=sys.stderr)
        return 2
    if args.chorus_url and _stage_up(args.chorus_url):
        print("watchdog: Chorus is running (api/logins answered): the fallback stays silent")
        return 0
    now = rr._parse_ts(args.now) if args.now else datetime.now().astimezone()
    if now is None:
        print(f"ERROR: watchdog check: usage: --now {args.now!r} is not an ISO timestamp", file=sys.stderr)
        return 2
    tasks_dir = Path(os.path.expanduser(args.tasks_dir or str(rr.DEFAULT_TASKS_DIR)))
    try:
        cands = _candidates(rr, tasks_dir)
    except OSError as e:
        print(f"ERROR: watchdog check: cannot read {tasks_dir}: {e}", file=sys.stderr)
        return 1
    state_path = _state_path(args.state)
    notified = _read_state(state_path)
    before = json.dumps(notified, sort_keys=True)
    for slug, path in cands:
        if _recent(rr, slug, now, args.stall_after):
            print(f"{slug} recent: not read")
            continue
        try:
            v = rr.moving_verdict(path, tasks_dir, now, args.stall_after, args.gh_bin)
        except rr.MovingError as e:
            print(f"{slug} not read: {e} (a lost look, never a stall)")
            continue
        except Exception as e:  # noqa: BLE001 — a defect or an unforeseen note is a lost look for this rollout alone
            print(f"{slug} not read: {type(e).__name__}: {e} (a lost look, never a stall)")
            continue
        if v["verdict"] != "stalled":
            print(f"{slug} {v['verdict']} {v.get('cause') or ''}".rstrip())
            notified.pop(slug, None)
            continue
        key = v.get("lastEvent") or "-"
        if (notified.get(slug) or {}).get("lastEvent") == key:
            print(f"{slug} stalled {v.get('cause')}: already notified")
            continue
        message = _message(v)
        if args.dry_run:
            print(f"{slug} stalled {v.get('cause')}: would notify: {message}")
            continue
        rc = _notify(message, args.ntfy_server)
        if rc == 0:
            notified[slug] = {"lastEvent": key, "at": now.isoformat(timespec="seconds")}
            print(f"{slug} stalled {v.get('cause')}: notified")
        else:
            print(f"{slug} stalled {v.get('cause')}: not notified (ntfy-push exit {rc})")
    # A key whose note has left the tasks dir goes; one whose note is still there but is no candidate stays.
    for slug in list(notified):
        if not (tasks_dir / f"{slug}.md").is_file():
            notified.pop(slug, None)
    if not args.dry_run and json.dumps(notified, sort_keys=True) != before:
        try:
            _write_state(state_path, notified)
        except OSError as e:
            print(f"WARN: watchdog: cannot write state {state_path}: {e}", file=sys.stderr)
    return 0


def cmd_plist(args):
    gh = shutil.which("gh")
    argv = [sys.executable, os.path.abspath(__file__), "check"]
    path_dirs = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    if gh:
        argv += ["--gh-bin", gh]
        path_dirs.insert(0, os.path.dirname(gh))
    else:
        print("WARN: watchdog plist: no gh on PATH: the job reads PR holds through a bare `gh`, which launchd's PATH "
              "may not find", file=sys.stderr)
    if args.chorus_url is not None:
        argv += ["--chorus-url", args.chorus_url]
    log = os.path.expanduser(args.log)
    job = {
        "Label": args.label,
        "ProgramArguments": argv,
        "EnvironmentVariables": {"PATH": ":".join(path_dirs)},
        "StartInterval": args.interval,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "StandardOutPath": log,
        "StandardErrorPath": log,
    }
    sys.stdout.write(plistlib.dumps(job).decode("utf-8"))
    return 0


def main(argv=None):
    # The bounds and the default are moving's own (reconcile-rollout.py STALL_AFTER_MIN and STALL_AFTER_MAX), so the
    # fallback and the verb never disagree on them.
    rr = _load_reconcile()
    p = argparse.ArgumentParser(prog="watchdog.py", description="The Watchdog's launchd fallback (ADR 0048): notify "
                                "once per stalled rollout while Chorus is not running.")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="read every rollout's moving verdict and notify once per stall")
    c.add_argument("--tasks-dir", default=None, help="task-note dir (default: the vault's Work/Tasks)")
    c.add_argument("--state", default=None, help="the state file (default ${XDG_STATE_HOME:-~/.local/state}/thread/"
                                                 "watchdog.json)")
    c.add_argument("--stall-after", type=int, default=rr.STALL_AFTER_MIN,
                   help=f"minutes (1 to {rr.STALL_AFTER_MAX}, default {rr.STALL_AFTER_MIN})")
    c.add_argument("--chorus-url", default=DEFAULT_CHORUS_URL, help="the Stage's URL ('' never probes)")
    c.add_argument("--ntfy-server", default=None, help="ntfy-push.py's --server")
    c.add_argument("--gh-bin", default="gh", help="the gh `next`'s PR-hold reads go through")
    c.add_argument("--now", default=None, help="the time to read against, ISO (default: now)")
    c.add_argument("--dry-run", action="store_true", help="post nothing and write no state")
    c.set_defaults(func=cmd_check, rr=rr)
    pl = sub.add_parser("plist", help="print the launchd job")
    pl.add_argument("--interval", type=int, default=DEFAULT_INTERVAL)
    pl.add_argument("--label", default=DEFAULT_LABEL)
    pl.add_argument("--log", default=DEFAULT_LOG)
    pl.add_argument("--chorus-url", default=None, help="passed to check ('' installs a fallback that never probes)")
    pl.set_defaults(func=cmd_plist)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
