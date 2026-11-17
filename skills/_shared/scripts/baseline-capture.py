#!/usr/bin/env python3
"""baseline-capture.py — the verifier on clean main before the first dispatch, its reds the rollout's baseline
(schedule step 2.6, p51-2).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/baseline-capture.py --repo R --default B --verifier CMD
        [--bootstrap CMD] [--timeout S] [--slots N] [--slot-wait W] [--out DIR] [--no-fetch] [--date YYYY-MM-DD]

Why. A rollout whose main is already red blocked its tasks at the verifier on reds that were never theirs (Watch
3a59d5fe, health-check-rollout-2026-10-21: clean main was never run). This runs the verifier once on clean main, through
the machine's verify slots, and hands schedule the `## Known baseline failures` block execute threads into every agent
as knownBaselineFailures (execute SKILL § 4: "only these fail" is green, never a --deselect).

Stdlib only, python >= 3.8. It loads engine-snapshot.py (git_env()) from its own directory, and reconcile-rollout.py
(_failing_ids, DEFAULT_VERIFY_TIMEOUT, _slot_wait, FAILING_IDS_MAX) and verify-slot.py (its run's frame) from
skills/execute/scripts by path (importlib), and runs lead-integrate.py's `verify` as its child for the run itself. This
header is the one copy of its rules; schedule step 2.6 reads its output.

The frame (the in-turn wait). The run outlives a foreground Bash call, so schedule launches it in the background, and a
fork (orient-all § 6, the Backlog orient) ends its background runs when its turn ends. So it frames its run as
verify-slot.py's `run` does (that script's contract item 9): first, on stderr, `verify-slot: run <pid> started; wait
for its verdict with: python3 '<verify-slot.py>' wait --log '<its output file>' --pid <pid>`, and last, on every
return (a usage error and an unexpected exception included), `verify-slot: exit <rc> (run <pid>)`, after its JSON line
is flushed. That wait command reports the end inside the caller's turn, 540 s a call, again on its exit 75.
A stop. A TERM, INT or HUP is passed on to the verify, whose own stop path ends the suite through its guard and
removes the tree; the capture then prints a `noverdict` line (`why`: stopped by signal <n>) and exits 128+n.

The run, in order:
  1. Fetch. `git fetch --quiet origin B` in R under git_env(), bounded by FETCH_TIMEOUT; a failure is no stop: the
     capture runs on the origin/B R already holds and says `fetched: false` (--no-fetch skips the fetch).
  2. Main. `git rev-parse --verify origin/B^{commit}` in R: the sha the capture runs on. None: exit 2.
  3. The verify. `lead-integrate.py verify --repo R --detach-at <sha> --tree DIR/tree-<pid> --out DIR/main-<pid>
     --timeout S --slot-wait W [--slots N] [--bootstrap CMD] --verifier CMD`, so the clean tree is a detached worktree
     of R at main, removed whatever the verdict, the run waits for one of the machine's verify slots (a lone
     --slot-wait takes N from rollouts.toml's verify_slots) and the Heat hold and the Capacity stop hold it as they hold
     the lead's own verifies. S defaults to the lead's DEFAULT_VERIFY_TIMEOUT (1800), W to _slot_wait(S), so the whole
     run fits the harness's 7200 s background bound. DIR defaults to R/.claude/baseline; the log and rc stay there.
  4. The verdict, from DIR/main-<pid>.rc and its log:
     - `0`: green. Block `none`.
     - another integer, its log's `== verifier:` section naming failing tests (reconcile-rollout.py _failing_ids, the
       lead's own reader: pytest's FAILED/ERROR, unittest, TAP and node --test, jest, go, cargo): red. One block line
       per id, `- <id> — red on clean <B> at <sha7> before the first dispatch (<date>)`, so execute's
       `<test_id> — <reason>` form splits back to the id. At FAILING_IDS_MAX ids the list may be cut: `truncated`.
     - another integer naming no test: unnamed. Block `none` (a baseline is test ids; a red the engine cannot match
       by name is no baseline), and the line says main is red.
     - 124 (the deadline), `noslot`, `heat` (the Heat hold or the Capacity stop), the log's `env_bootstrap failed`,
       a stop (the log's `verify: stopped by signal`, or one this script passed on), or no rc at all: no verdict.
       Block `none`, `why` the cause.
Output: one JSON line on stdout, {status: green | red | unnamed | noverdict, sha, default, fetched, rc, failing,
truncated, why, block, line, log}: `block` the text for schedule's {{KNOWN_BASELINE_FAILURES}}, `line` step 8's
`Baseline:` line. Exit 0 for every verdict above (a capture is a fact, never a stop) but a stop's 128+n; 2 for a usage
error, a --repo that is no git work tree, no origin/B, or lead-integrate's own exit 2, with one `baseline-capture: …`
line on stderr.
"""
import argparse
import importlib.util
import json
import os
import signal
import subprocess
import sys
import traceback
from datetime import date
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
EXEC_SCRIPTS = HERE.parent.parent / "execute" / "scripts"
FETCH_TIMEOUT = 120
GIT_TIMEOUT = 60
STOPS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
STOPPED_LINE = "verify: stopped by signal"   # lead-integrate verify's log line for a stop


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ES = _load("thread_engine_snapshot_bc", HERE / "engine-snapshot.py")
rr = _load("thread_reconcile_rollout_bc", EXEC_SCRIPTS / "reconcile-rollout.py")
VS = _load("thread_verify_slot_bc", EXEC_SCRIPTS / "verify-slot.py")
LEAD_INTEGRATE = EXEC_SCRIPTS / "lead-integrate.py"


class CaptureError(Exception):
    pass


def _git(repo, *args, timeout=GIT_TIMEOUT):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          env=ES.git_env(), timeout=timeout)


def _toplevel(repo):
    try:
        p = _git(repo, "rev-parse", "--show-toplevel")
    except (OSError, subprocess.SubprocessError) as e:
        raise CaptureError(f"--repo {repo}: {e}")
    if p.returncode != 0:
        raise CaptureError(f"--repo {repo}: not a git work tree")
    return Path(p.stdout.strip())


def _fetch(repo, branch):
    try:
        return _git(repo, "fetch", "--quiet", "origin", branch, timeout=FETCH_TIMEOUT).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _main_sha(repo, branch):
    p = _git(repo, "rev-parse", "--verify", "--quiet", f"origin/{branch}^{{commit}}")
    if p.returncode != 0 or not p.stdout.strip():
        raise CaptureError(f"no origin/{branch} in {repo}")
    return p.stdout.strip()


def _read(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def verdict(rc_text, log_text, branch, sha, day, stopped=None):
    """The capture's verdict from the verify's rc file text (None: no rc), its log text and the stop signal this script
    passed on (None: none): {status, rc, failing, truncated, why, block, line}. Pure: the header's step 4."""
    short = sha[:7]
    out = {"rc": None, "failing": [], "truncated": False, "why": ""}
    rc = (rc_text or "").strip()
    log = log_text or ""
    if stopped is not None or STOPPED_LINE in log:
        why = f"stopped by signal {stopped}" if stopped is not None else "stopped by a signal"
        out.update(status="noverdict", why=why, rc=int(rc) if rc.isdigit() else (rc or None))
    elif rc_text is None or not rc:
        out.update(status="noverdict", why="no rc: the verify did not finish")
    elif rc == "noslot":
        out.update(status="noverdict", why="no verify slot came in time", rc=rc)
    elif rc == "heat":
        out.update(status="noverdict", why="the Mac was too hot, or the Capacity stopped suites", rc=rc)
    elif not rc.lstrip("-").isdigit():
        out.update(status="noverdict", why=f"an unreadable rc {rc!r}", rc=rc)
    elif int(rc) == 0:
        out.update(status="green", rc=0)
    elif int(rc) == 124:
        out.update(status="noverdict", why="the verifier ran past its timeout", rc=124)
    elif "env_bootstrap failed; verifier not run" in log:
        out.update(status="noverdict", why=f"env_bootstrap failed (rc {rc}); verifier not run", rc=int(rc))
    else:
        ids = rr._failing_ids(log.splitlines())
        out.update(rc=int(rc), failing=ids, truncated=len(ids) >= rr.FAILING_IDS_MAX,
                   status="red" if ids else "unnamed")
    if out["status"] == "red":
        reason = f"red on clean {branch} at {short} before the first dispatch ({day})"
        out["block"] = "\n".join(f"- {i} — {reason}" for i in out["failing"])
        more = " (cut at the parser's cap: more may be red)" if out["truncated"] else ""
        out["line"] = f"Baseline: {len(out['failing'])} red on clean {branch} at {short}{more}: " + ", ".join(
            out["failing"])
    else:
        out["block"] = "none"
        out["line"] = {
            "green": f"Baseline: none (clean {branch} green at {short})",
            "unnamed": f"Baseline: none (clean {branch} red at {short}, rc {out['rc']}, but no failing test named)",
        }.get(out["status"], f"Baseline: none (not captured: {out['why']})")
    return out


def capture(args):
    repo = _toplevel(Path(os.path.expanduser(args.repo)))
    fetched = None if args.no_fetch else _fetch(repo, args.default)
    sha = _main_sha(repo, args.default)
    out_dir = Path(os.path.expanduser(args.out)) if args.out else repo / ".claude" / "baseline"
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = os.getpid()
    tree, out = out_dir / f"tree-{tag}", out_dir / f"main-{tag}"
    timeout = args.timeout if args.timeout is not None else rr.DEFAULT_VERIFY_TIMEOUT
    slot_wait = args.slot_wait if args.slot_wait is not None else rr._slot_wait(timeout)
    cmd = [sys.executable, str(LEAD_INTEGRATE), "verify", "--repo", str(repo), "--detach-at", sha, "--tree", str(tree),
           "--out", str(out), "--timeout", str(timeout), "--slot-wait", str(slot_wait), "--verifier", args.verifier]
    if args.slots is not None:
        cmd += ["--slots", str(args.slots)]
    if args.bootstrap:
        cmd += ["--bootstrap", args.bootstrap]
    code, err, stopped = _verify(cmd)
    if code == 2 and stopped is None and not Path(f"{out}.rc").exists():
        raise CaptureError(f"lead-integrate verify: {(err or '').strip() or 'exit 2'}")
    res = verdict(_read(Path(f"{out}.rc")), _read(Path(f"{out}.log")), args.default, sha, args.date, stopped)
    res = dict(status=res.pop("status"), sha=sha, default=args.default, fetched=fetched, **res, log=f"{out}.log")
    return res, stopped


def _verify(cmd):
    """lead-integrate verify as this script's child: (its exit, its stderr, the first stop signal or None). A TERM, INT
    or HUP is passed on to it (its stop path ends the suite and removes the tree) and waited out; one before the spawn
    spawns nothing."""
    st = {"proc": None, "sig": None}

    def on_stop(signum, _frame):
        st["sig"] = st["sig"] or signum
        if st["proc"] is not None:
            try:
                st["proc"].send_signal(signum)
            except OSError:
                pass

    old = {s: signal.signal(s, on_stop) for s in STOPS}
    try:
        if st["sig"] is not None:
            return None, "", st["sig"]
        st["proc"] = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                      text=True, env=ES.git_env())
        if st["sig"] is not None:   # a stop between the spawn and the handle
            on_stop(st["sig"], None)
        _, err = st["proc"].communicate()
        return st["proc"].returncode, err, st["sig"]
    finally:
        for s, h in old.items():
            signal.signal(s, h)


def main(argv=None):
    """The framed run (the header's frame): the start line, the capture, then the exit line on every return."""
    pid = os.getpid()
    VS._frame(f"run {pid} started; wait for its verdict with: python3 {VS._shq(VS.SCRIPT)} wait --log "
              f"{VS._shq(VS._stderr_path() or VS.NO_PATH)} --pid {pid}")
    rc = 1
    try:
        rc = _main(argv)
    except SystemExit as e:   # argparse: a usage error (2) or --help (0)
        rc = e.code if isinstance(e.code, int) else (0 if e.code is None else 2)
    except Exception:
        traceback.print_exc()
        rc = 1
    finally:
        VS._frame(f"exit {rc} (run {pid})")
    return rc


def _main(argv):
    ap = argparse.ArgumentParser(prog="baseline-capture.py", description=__doc__.split("\n")[0])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--default", required=True, help="the default branch: the capture runs on origin/<default>")
    ap.add_argument("--verifier", required=True)
    ap.add_argument("--bootstrap", default="")
    ap.add_argument("--timeout", type=int, default=None)
    ap.add_argument("--slots", type=int, default=None)
    ap.add_argument("--slot-wait", type=float, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-fetch", action="store_true")
    ap.add_argument("--date", default=date.today().isoformat())
    args = ap.parse_args(argv)
    if args.timeout is not None and args.timeout <= 0:
        ap.error("--timeout must be a positive number of seconds")
    try:
        res, stopped = capture(args)
    except CaptureError as e:
        print(f"baseline-capture: {e}", file=sys.stderr, flush=True)
        return 2
    print(json.dumps(res, ensure_ascii=False), flush=True)
    return 128 + stopped if stopped is not None else 0


if __name__ == "__main__":
    sys.exit(main())
