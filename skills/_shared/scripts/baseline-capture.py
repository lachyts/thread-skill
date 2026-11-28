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
A stop. The stop handlers go in first, so a TERM, INT or HUP at any point ends the same way. Before the verify is
spawned (the fetch, the sha, the mkdir) it ends the capture there, the fetch's git killed, and spawns nothing; once
the verify is live it is passed on to it once, and its own stop path ends the suite through its guard and removes the
tree. Either way the capture prints a `noverdict` line (`why`: stopped by signal <n>; `sha` null when the stop came
before the sha was read) and exits 128+n; a SIGINT before the handlers is 130. The exit line is written with stops
ignored.

The run, in order:
  1. Fetch. `git fetch --quiet origin B` in R under git_env(), bounded by FETCH_TIMEOUT; a failure is no stop: the
     capture runs on the origin/B R already holds and says `fetched: false` (--no-fetch skips the fetch).
  2. Main. `git rev-parse --verify origin/B^{commit}` in R: the sha the capture runs on. None: exit 2.
  3. The verify. `lead-integrate.py verify --repo R --detach-at <sha> --tree DIR/tree-<pid> --out DIR/main-<pid>
     --timeout S --slot-wait W [--slots N] [--bootstrap CMD] --verifier CMD`, so the clean tree is a detached worktree
     of R at main, removed whatever the verdict, the run waits for one of the machine's verify slots (a lone
     --slot-wait takes N from rollouts.toml's verify_slots) and the Heat hold and the Capacity stop hold it as they hold
     the lead's own verifies. S defaults to the lead's DEFAULT_VERIFY_TIMEOUT (1800), W to _slot_wait(S), so the whole
     run fits the harness's 7200 s background bound. DIR defaults to R/.claude/baseline. This run's log and rc stay
     there (the JSON line's `log` names the log); before the verify, the capture removes earlier captures'
     `main-<pid>.*` files in DIR older than PRUNE_AGE (a day, far past a capture's 7200 s), never this run's own.
  4. The verdict, from DIR/main-<pid>.rc and only lead-integrate verify's own lines in its log, never a step's output
     (a suite whose tests print `verify: stopped by signal` is still red). Its own lines are those after the last
     step section's `== <step> rc N` line; a section left open (a deadline or a stop ended its step) ends in verify's
     own last line, so only its last deadline or stop line counts; with no section, every line is its own.
     - A stop: a stop this script passed on, or verify's own `verify: stopped by signal n` line with an rc of 128+n
       or none. No verdict.
     - No rc, `noslot`, `heat` (the Heat hold or the Capacity stop) or an rc that is no integer: no verdict.
     - `0`: green. Block `none`.
     - 124 with verify's own `verify: timed out after` line (the deadline): no verdict. A step's own exit 124 is
       read as any other rc.
     - A failed bootstrap, verify's own `env_bootstrap failed; verifier not run` right after the last section's
       `== env_bootstrap rc N` (so no `== verifier:` line after it): no verdict.
     - Any other integer, its log's last `== verifier:` section naming failing tests (reconcile-rollout.py
       _failing_ids, the lead's own reader: pytest's FAILED/ERROR, unittest, TAP and node --test, jest, go, cargo):
       red. One block line per id, `- <id> — red on clean <B> at <sha7> before the first dispatch (<date>)`, so
       execute's `<test_id> — <reason>` form splits back to the id. At FAILING_IDS_MAX ids the list may be cut:
       `truncated`, and the line says so. A truncated red is also a `stop` (below): no baseline can hold main's reds.
     - Any other integer naming no test: unnamed. Block `none` (a baseline is test ids; a red the engine cannot
       match by name is no baseline), the line says main is red, and it is a `stop` (below).
     No verdict is block `none`, `why` the cause.
   The stop (p47-18). A red no baseline can hold, `unnamed` or a `truncated` red, would write a note whose every task's
   verify is red with nothing to subtract, so its `stop` is the line schedule step 2.6 stops on: `stop: clean B is red
   at <sha7> (rc N) and its output names no failing test, …` or `stop: clean B has <n> or more reds at <sha7>, past the
   parser's cap, …`. Every other verdict's `stop` is null: a named, uncut red is the baseline, and no verdict leaves
   main's state unknown. The stop is the one verdict schedule stops on; the exit stays 0.
Output: one JSON line on stdout, {status: green | red | unnamed | noverdict, sha, default, fetched, rc, failing,
truncated, why, block, line, stop, log}: `block` the text for schedule's {{KNOWN_BASELINE_FAILURES}}, `line` step 8's
`Baseline:` line, `stop` the stop line or null, `sha` and `log` null when a stop came before them. Exit 0 for every
verdict above (a capture is a fact, never a stop: only its `stop` stops schedule) but a stop's 128+n; 2 for a usage
error, a --repo that is no git work tree, no origin/B, or lead-integrate's own exit 2, with one `baseline-capture: …`
line on stderr.
"""
import argparse
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import time
import traceback
from datetime import date
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
EXEC_SCRIPTS = HERE.parent.parent / "execute" / "scripts"
FETCH_TIMEOUT = 120
GIT_TIMEOUT = 60
PRUNE_AGE = 86400   # an earlier capture's main-<pid>.* files older than this are removed at startup
STOPS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
# lead-integrate verify's own log lines (cmd_verify): a step's section header, a stop, the deadline, a failed bootstrap.
STEP_RE = re.compile(r"== (env_bootstrap|verifier): ")
STOP_RE = re.compile(r"verify: stopped by signal (\d+);")
DEADLINE_RE = re.compile(r"verify: timed out after \S+ during the (\w+);")
BOOTSTRAP_FAILED = "env_bootstrap failed; verifier not run"


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


def _verify_ends(log):
    """How lead-integrate verify's own lines say its run ended (the header's step 4), never from a step's output:
    {stop: the signal of its own `verify: stopped by signal n` line or None, deadline: the step its own `verify: timed
    out after` line names or None, bootstrap: True when its own `env_bootstrap failed` line follows the last section's
    `== env_bootstrap rc N`}. Pure."""
    lines = log.splitlines()
    own, step, closed = lines, None, False
    heads = [i for i, line in enumerate(lines) if STEP_RE.match(line)]
    if heads:
        step = STEP_RE.match(lines[heads[-1]]).group(1)
        closes = [i for i in range(heads[-1] + 1, len(lines)) if lines[i].startswith(f"== {step} rc ")]
        closed = bool(closes)
        # Closed: verify writes only its own lines after it. Open: the step's output, then verify's own last line.
        own = lines[closes[-1] + 1:] if closed else lines[heads[-1] + 1:]
    end = next((line for line in reversed(own) if STOP_RE.match(line) or DEADLINE_RE.match(line)), "")
    stop, deadline = STOP_RE.match(end), DEADLINE_RE.match(end)
    return {"stop": int(stop.group(1)) if stop else None,
            "deadline": deadline.group(1) if deadline else None,
            "bootstrap": step == "env_bootstrap" and closed and own[:1] == [BOOTSTRAP_FAILED]}


def verdict(rc_text, log_text, branch, sha, day, stopped=None):
    """The capture's verdict from the verify's rc file text (None: no rc), its log text and the stop signal this script
    passed on (None: none): {status, rc, failing, truncated, why, block, line, stop}. Pure: the header's step 4, read
    from lead-integrate verify's own log lines only (_verify_ends), and its stop (p47-18)."""
    short = (sha or "")[:7]
    out = {"rc": None, "failing": [], "truncated": False, "why": ""}
    rc = (rc_text or "").strip()
    log = log_text or ""
    ends = _verify_ends(log)
    sig = stopped if stopped is not None else ends["stop"]
    if sig is not None and (stopped is not None or not rc or rc == str(128 + sig)):
        out.update(status="noverdict", why=f"stopped by signal {sig}", rc=int(rc) if rc.isdigit() else (rc or None))
    elif not rc:
        out.update(status="noverdict", why="no rc: the verify did not finish")
    elif rc == "noslot":
        out.update(status="noverdict", why="no verify slot came in time", rc=rc)
    elif rc == "heat":
        out.update(status="noverdict", why="the Mac was too hot, or the Capacity stopped suites", rc=rc)
    elif not rc.lstrip("-").isdigit():
        out.update(status="noverdict", why=f"an unreadable rc {rc!r}", rc=rc)
    elif int(rc) == 0:
        out.update(status="green", rc=0)
    elif int(rc) == 124 and ends["deadline"]:
        out.update(status="noverdict", why=f"the {ends['deadline']} ran past its timeout", rc=124)
    elif ends["bootstrap"]:
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
    out["stop"] = None
    if out["status"] == "unnamed":
        out["stop"] = (f"stop: clean {branch} is red at {short} (rc {out['rc']}) and its output names no failing test, "
                       f"so no task's verify could pass; fix {branch}, then re-run")
    elif out["status"] == "red" and out["truncated"]:
        out["stop"] = (f"stop: clean {branch} has {len(out['failing'])} or more reds at {short}, past the parser's cap, "
                       f"so no baseline can hold them and no task's verify could pass; fix {branch}, then re-run")
    return out


def _prune(out_dir, pid, now=None):
    """Remove earlier captures' main-<pid>.* files in out_dir last written over PRUNE_AGE ago, never pid's own (the
    header's step 3). Best effort: a file that cannot be read or removed is left."""
    now = time.time() if now is None else now
    for p in out_dir.glob("main-*"):
        try:
            if p.name.startswith(f"main-{pid}.") or not p.is_file() or now - p.stat().st_mtime < PRUNE_AGE:
                continue
            p.unlink()
        except OSError:
            pass


def _result(v, ctx):
    """The JSON line: the verdict v with what the capture knows so far (ctx: default, sha, fetched, log)."""
    return dict(status=v.pop("status"), sha=ctx["sha"], default=ctx["default"], fetched=ctx["fetched"], **v,
                log=ctx["log"])


def capture(args, ctx):
    """The run (the header's steps 1 to 4): (the JSON line's dict, the stop signal or None). ctx collects what is known
    as it goes, so a stop that ends the capture early (_Stopped) still names it."""
    repo = _toplevel(Path(os.path.expanduser(args.repo)))
    ctx["fetched"] = None if args.no_fetch else _fetch(repo, args.default)
    ctx["sha"] = sha = _main_sha(repo, args.default)
    out_dir = Path(os.path.expanduser(args.out)) if args.out else repo / ".claude" / "baseline"
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = os.getpid()
    _prune(out_dir, tag)
    tree, out = out_dir / f"tree-{tag}", out_dir / f"main-{tag}"
    timeout = args.timeout if args.timeout is not None else rr.DEFAULT_VERIFY_TIMEOUT
    slot_wait = args.slot_wait if args.slot_wait is not None else rr._slot_wait(timeout)
    cmd = [sys.executable, str(LEAD_INTEGRATE), "verify", "--repo", str(repo), "--detach-at", sha, "--tree", str(tree),
           "--out", str(out), "--timeout", str(timeout), "--slot-wait", str(slot_wait), "--verifier", args.verifier]
    if args.slots is not None:
        cmd += ["--slots", str(args.slots)]
    if args.bootstrap:
        cmd += ["--bootstrap", args.bootstrap]
    code, err = _verify(cmd)
    stopped = _stop["sig"]   # every stop up to now: the JSON line and the exit agree
    if code is not None:
        ctx["log"] = f"{out}.log"
    if code == 2 and stopped is None and not Path(f"{out}.rc").exists():
        raise CaptureError(f"lead-integrate verify: {(err or '').strip() or 'exit 2'}")
    return _result(verdict(_read(Path(f"{out}.rc")), _read(Path(f"{out}.log")), args.default, sha, args.date,
                           stopped), ctx), stopped


class _Stopped(BaseException):
    """A stop before the verify was spawned: it ends the capture where it lands (a BaseException, so no `except
    Exception` takes it; a subprocess.run it lands in kills its child)."""

    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


# The stop state, reset by main(): the first stop's signal, the live verify, whether a stop still raises (before the
# spawn) and, popped once, whether it is still to be passed on.
_stop = {"sig": None, "proc": None, "raises": True, "unsent": True}


def _on_stop(signum, _frame):
    """The handler for every stop, from main's top (the header's frame): the first is recorded. Before the verify is
    spawned it raises _Stopped; once the verify is live it is passed on to it, once."""
    first = _stop["sig"] is None
    if first:
        _stop["sig"] = signum
    if _stop["proc"] is not None:
        _pass_on()
    elif first and _stop["raises"]:
        _stop["raises"] = False
        raise _Stopped(signum)


def _pass_on():
    """The recorded stop sent to the live verify, at most once (dict.pop is one step, so a handler that lands in here
    finds it gone)."""
    proc, sig = _stop["proc"], _stop["sig"]
    if proc is not None and sig is not None and _stop.pop("unsent", False):
        try:
            proc.send_signal(sig)
        except OSError:
            pass


def _verify(cmd):
    """lead-integrate verify as this script's child: (its exit, its stderr), or (None, "") when a stop came first and
    nothing was spawned. From here a stop is never raised: _on_stop passes it on to the child (its stop path ends the
    suite and removes the tree), which is waited out."""
    _stop["raises"] = False
    if _stop["sig"] is not None:
        return None, ""
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            text=True, env=ES.git_env())
    _stop["proc"] = proc
    _pass_on()   # a stop between the spawn and the handle
    try:
        _, err = proc.communicate()
    finally:
        _stop["proc"] = None
    return proc.returncode, err


def main(argv=None):
    """The framed run (the header's frame): the stop handlers first, then the start line, the capture, and the exit
    line on every return, written with stops ignored."""
    pid = os.getpid()
    rc = 1
    ctx = {"default": None, "sha": None, "fetched": None, "log": None, "date": date.today().isoformat()}
    try:
        try:
            _stop.update(sig=None, proc=None, raises=True, unsent=True)
            for s in STOPS:
                signal.signal(s, _on_stop)
            VS._frame(f"run {pid} started; wait for its verdict with: python3 {VS._shq(VS.SCRIPT)} wait --log "
                      f"{VS._shq(VS._stderr_path() or VS.NO_PATH)} --pid {pid}")
            rc = _main(argv, ctx)
        except SystemExit as e:   # argparse: a usage error (2) or --help (0)
            rc = e.code if isinstance(e.code, int) else (0 if e.code is None else 2)
        except KeyboardInterrupt:   # a SIGINT before the handlers, as verify-slot.py's _run_framed
            rc = 130
        except Exception:
            traceback.print_exc()
            rc = 1
    except _Stopped as s:
        rc = 128 + s.signum
        try:
            print(json.dumps(_result(verdict(None, None, ctx["default"], ctx["sha"], ctx["date"], s.signum), ctx),
                             ensure_ascii=False), flush=True)
        except (OSError, ValueError):
            pass
    finally:
        _stop["raises"] = False
        VS._quiet()
        VS._frame(f"exit {rc} (run {pid})")
    return rc


def _main(argv, ctx):
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
    ap.add_argument("--date", default=ctx["date"])
    args = ap.parse_args(argv)
    ctx.update(default=args.default, date=args.date)
    if args.timeout is not None and args.timeout <= 0:
        ap.error("--timeout must be a positive number of seconds")
    try:
        res, stopped = capture(args, ctx)
    except CaptureError as e:
        print(f"baseline-capture: {e}", file=sys.stderr, flush=True)
        return 2
    print(json.dumps(res, ensure_ascii=False), flush=True)
    return 128 + stopped if stopped is not None else 0


if __name__ == "__main__":
    sys.exit(main())
