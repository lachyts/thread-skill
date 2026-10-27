#!/usr/bin/env python3
"""step-boundary.py — the lead's side of a Chorus room stop (execute § Room stop; Chorus ADR 0071).

When the Chorus Stage says a Session's Login is at its week's or 5-hour line, or would reach its 5-hour line (a
spread, Chorus ADR 0109), the lead starts nothing, stops each Workflow call the moment its running agent's result
is in the run's journal, reports that nothing is mid-step, and resumes every stopped call on the Stage's re-send.
The engine (task.workflow.js) has no shell to read a flag, so the lead watches the journals with this script, and
records the stop on the rollout note's `## Pause log`, where a compaction cannot lose it. A room stop is never a
Pause: it writes no `paused:` stamp.

Verbs:

  mark    --out <state.json> --run <runId> [--run …] [--journals-root <abs>]
          Read each run's journal and record what runs now. The state holds `markedAt` and, per run,
          {journal, offset, running, label, stale, missing, reported, unwatched}. It is written whole and
          atomically (a tmp file, then os.replace) and replaces any earlier state at that path, so re-running
          `mark` on the same --out is the re-mark: it reads each call's running agent afresh. One line per run:
          `<runId>: mid-step <label>`, `<runId>: at a boundary`, or `WARN: <runId>: no journal at <path>`.

  watch   --state <state.json> [--interval 1] [--timeout <s>]
          Poll every unreported run. A run with no journal prints `unwatched <runId>` and counts as reported
          (and unwatched); a run at its boundary prints `boundary <runId> after <label>`, or
          `boundary <runId> (nothing running at the mark)`, and counts as reported. It exits 0 at the end of the
          first poll that reported anything, saving the `reported` flags atomically. Once every run is reported
          it prints a last line, `all at a boundary` when none is unwatched, else
          `all reported; unwatched: <runIds>`; a relaunch with every run reported prints only that line and
          exits 0 at once, so a relaunch loop always ends. On --timeout it prints `mid-step <runId> <label>` for
          each run left and exits 3. With no --timeout it polls until a run reports.

  begin   --rollout <note>   (one line of text on stdin)
          Record the start: `- <stamp> room stop: <text>` inside `## Pause log`, the section created at the
          note's end when absent. A room stop that already stands (a start line under the 6 h bound, as
          `stands` reads it) prints `room stop already stands since <stamp>` and writes nothing. Empty or
          multi-line text exits 2 and writes nothing, and so does text holding `[[`: slugs go in bare, because
          reconcile-rollout.py's _schedule_positions ranks the first wikilink on ANY list line, so one on a
          `## Pause log` line above `## Queue` would reorder the queue. This verb is the room-stop line's only
          writer, so the rule is enforced here, not only in execute's prose. Once it wrote the line (never on "already
          stands" or a refusal), it records the stop in the rollout's Run record (p29-10, ADR 0051): `stopped` {cause:
          usage-limit, inferred: false, calls (reconcile-rollout.py inflight_calls: the Slots and lane the record shows
          in flight), reason (the text, cut to 200 characters)}, best-effort: a record that cannot be read or written
          changes no output and no exit. The entry after the Stage's re-send (reconcile-rollout.py record-entry) is the
          resume's lead-entry.

  end     --rollout <note>
          When a room stop stands (the last room-stop line is a start line, lapsed or not), append
          `- <stamp> room stop ended` inside `## Pause log` and print `room stop ended (stood since <stamp>)`;
          otherwise print `no room stop stands` and write nothing. Exit 0 either way. It records no Run-record event:
          the entry's record-entry is the resume.

  stands  --rollout <note> [--hours 6] [--now <ISO>]   (read-only)
          The last `## Pause log` line matching `^- (\\S+) room stop(: | ended\\b)` decides: a start line under
          the bound exits 0; one at or past the bound, or with a stamp that does not parse, exits 4; an `ended`
          line, or none, exits 5. Every other line of the section (a hard pause's included) is ignored. 6 h is
          the Stage's horizon for an owed resume (Chorus's OWED_MAX_S, 21600 s).

The journal (`launched`, `started`, `result` and `failed` lines). A key is judged by its last `started`, `result`
or `failed` line and is open when that line is `started`. The running agent is the key of the journal's last
`started` line, if that key is open; any other open key is stale and is never waited on. A key is re-`started`
with a new agentId on a retry, so agentIds are never matched, and nothing is counted. `launched` lines, unknown
types and a line that is not a JSON object are ignored; a torn trailing line (no newline yet) is left for the next
read, and the offset stops before it. The label is the running key's last `started` label; when that line has
none, the latest label any `started` line of the key carried; failing that, `key v2:<first 12 hex>` (older
`started` lines carry no label).

The boundary. A run is at its boundary when nothing was running at the mark, or when the journal gained a
`result` or `failed` line for the key that was running at the mark, after the mark's offset. A `failed` line ends
the step too (stopping there cuts runAgent's in-run retry, which the resume re-dispatches fresh); a bare
re-`started` line never does.

The root. --journals-root wins. Otherwise the root comes from reconcile-rollout.py's _journal_dir (the session's
one transcript under ${CLAUDE_CONFIG_DIR:-~/.claude}/projects/*/<CLAUDE_CODE_SESSION_ID>.jsonl), with its leaf
swapped: _journal_dir names <parent>/<sid>/workflows, the run-file dir (<runId>.json, which fold-journals reads),
while each call's journal is <parent>/<sid>/subagents/workflows/<runId>/journal.jsonl. A runId must be a Workflow
runId (BIND_RUN_ID_RE) with no `..`.

Exit codes: 0 ok; 1 no journals root, an unreadable state file, or an unreadable or unwritable note; 2 usage (a
bad runId, `mark` with no --run, a --hours or --interval that is not positive, empty or multi-line `begin` text,
`begin` text holding `[[`; and the Engine snapshot guard, ADR 0043: `begin` and `end` on a rollout stamped with another
snapshot than this plugin root, or a live one whose snapshot is unusable, print engine-snapshot.py's
`engine-snapshot: ` line and write nothing, so re-run from the root it names; `stands` is a reader and exempt);
3 `watch` timed out; 4 `stands` found a room stop at or past its bound, or one whose stamp does not parse;
5 `stands` found no room stop standing.
"""

import argparse
import importlib.util
import json
import os
import re
import sys
import time
from argparse import Namespace
from datetime import datetime, timedelta
from pathlib import Path


def _load_reconcile():
    """reconcile-rollout.py, one source for the runId rule, the journal dir, the note editor and the stamp form
    (git-env-canary.py's _load_reconcile; importing it has no side effects and writes no bytecode)."""
    sys.dont_write_bytecode = True
    src = Path(__file__).resolve().parent / "reconcile-rollout.py"
    spec = importlib.util.spec_from_file_location("reconcile_rollout", src)
    if spec is None or spec.loader is None:
        raise ImportError(f"no loader for {src}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load_reconcile()

PAUSE_LOG = "## Pause log"
# The room-stop line's one source is reconcile-rollout.py's ROOM_STOP_LINE_RE (p30-4), which its _approved_marks reads
# too (an approved queue's room stops are no run mark): this module loads that one, never a copy, and since p28-4 reads
# the lines only through RR._last_room_stop (_last_room_line), the reader a lead's lease shares.
ROOM_LINE = RR.ROOM_STOP_LINE_RE
# The bound's one source is reconcile-rollout.py's ROOM_STOP_BOUND (p28-4), which a lead's lease reads too (a standing
# room stop keeps a lapsed lease): `stands` defaults to it.
BOUND_HOURS = RR.ROOM_STOP_BOUND.total_seconds() / 3600
STEP_TYPES = ("started", "result", "failed")


class Fail(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


def _usage(verb, msg):
    return Fail(2, f"ERROR: step-boundary {verb}: usage: {msg}")


def _now():
    return datetime.now().astimezone()


# ---- the journal ---------------------------------------------------------------------------------------------------

def _read(path, offset=0):
    """(lines, end): the journal's JSON-object lines from byte `offset`, stopping before a torn trailing line (one
    with no newline yet), and the offset just past the last whole line."""
    with open(path, "rb") as fh:
        fh.seek(offset)
        data = fh.read()
    out, pos = [], 0
    while True:
        nl = data.find(b"\n", pos)
        if nl < 0:
            break
        raw = data[pos:nl]
        pos = nl + 1
        try:
            line = json.loads(raw)
        except ValueError:
            continue
        if isinstance(line, dict):
            out.append(line)
    return out, offset + pos


def _short_key(key):
    prefix, sep, rest = key.partition(":")
    return f"key {prefix}:{rest[:12]}" if sep else f"key {key[:12]}"


def _model(lines):
    """(running, label, stale): the key running now (None when nothing is), its label, and the other open keys."""
    last = {}
    labels = {}
    last_started = None
    for line in lines:
        kind, key = line.get("type"), line.get("key")
        if kind not in STEP_TYPES or not isinstance(key, str) or not key:
            continue
        last[key] = kind
        if kind == "started":
            label = line.get("label")
            label = label if isinstance(label, str) and label.strip() else None
            if label:
                labels[key] = label
            last_started = (key, label)
    running = None
    label = None
    if last_started and last.get(last_started[0]) == "started":
        running = last_started[0]
        label = last_started[1] or labels.get(running) or _short_key(running)
    stale = [k for k, kind in last.items() if kind == "started" and k != running]
    return running, label, stale


def _boundary(lines, running):
    return any(line.get("type") in ("result", "failed") and line.get("key") == running for line in lines)


def _root(args):
    """The journals root, or Fail."""
    if args.journals_root:
        root = Path(os.path.expanduser(args.journals_root))
        if not root.is_absolute():
            raise _usage("mark", f"--journals-root {args.journals_root!r} is not an absolute path")
    else:
        jdir, err = RR._journal_dir(Namespace(journal_dir=None))
        if err:
            raise Fail(1, f"ERROR: step-boundary mark: no journals root: {err}")
        # _journal_dir names <parent>/<sid>/workflows, the run-file dir. Each call's journal lives under
        # <parent>/<sid>/subagents/workflows/<runId>/journal.jsonl (verified on disk), so the leaf differs on
        # purpose: never "fix" it back to _journal_dir's.
        root = Path(jdir).parent / "subagents" / "workflows"
    if not root.is_dir():
        raise Fail(1, f"ERROR: step-boundary mark: no journals root at {root}")
    return root


def _save_state(path, state):
    path = Path(path)
    tmp = path.with_name(f"{path.name}.tmp{os.getpid()}")
    try:
        tmp.write_text(json.dumps(state, indent=1) + "\n")
        os.replace(tmp, path)
    except OSError as e:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise Fail(1, f"ERROR: step-boundary: cannot write the state {path}: {e}")


def _load_state(path):
    try:
        state = json.loads(Path(path).read_text())
    except (OSError, ValueError) as e:
        raise Fail(1, f"ERROR: step-boundary watch: cannot read the state {path}: {e}")
    runs = state.get("runs") if isinstance(state, dict) else None
    ok = isinstance(runs, dict) and runs and all(
        isinstance(r, dict) and isinstance(r.get("journal"), str) and isinstance(r.get("offset"), int)
        and r["offset"] >= 0 and (r.get("running") is None or isinstance(r.get("running"), str))
        and isinstance(r.get("reported"), bool) for r in runs.values())
    if not ok:
        raise Fail(1, f"ERROR: step-boundary watch: {path} is not a mark state")
    return state


def cmd_mark(args):
    runs = list(dict.fromkeys(args.run or []))
    if not runs:
        raise _usage("mark", "at least one --run <runId>")
    for run in runs:
        if not RR.BIND_RUN_ID_RE.fullmatch(run) or ".." in run:
            raise _usage("mark", f"--run {run!r} is not a Workflow runId (wf_[A-Za-z0-9][A-Za-z0-9_.-]*, no ..)")
    root = _root(args)
    state = {"v": 1, "markedAt": _now().isoformat(timespec="seconds"), "runs": {}}
    for run in runs:
        path = root / run / "journal.jsonl"
        rec = {"journal": str(path), "offset": 0, "running": None, "label": None, "stale": [], "missing": False,
               "reported": False, "unwatched": False}
        try:
            lines, end = _read(path)
        except OSError:
            rec["missing"] = True
            print(f"WARN: {run}: no journal at {path}")
        else:
            running, label, stale = _model(lines)
            rec.update(offset=end, running=running, label=label, stale=stale)
            print(f"{run}: mid-step {label}" if running else f"{run}: at a boundary")
        state["runs"][run] = rec
    _save_state(args.out, state)
    return 0


def cmd_watch(args):
    if args.interval <= 0:
        raise _usage("watch", "--interval must be above 0")
    if args.timeout is not None and args.timeout < 0:
        raise _usage("watch", "--timeout must not be negative")
    state = _load_state(args.state)
    runs = state["runs"]
    deadline = None if args.timeout is None else time.monotonic() + args.timeout
    while True:
        reported = False
        for run, rec in runs.items():
            if rec["reported"]:
                continue
            path = Path(rec["journal"])
            lines = None
            if not rec.get("missing"):
                try:
                    lines, _end = _read(path, rec["offset"])
                except OSError:
                    lines = None
            if lines is None:
                print(f"unwatched {run}", flush=True)
                rec.update(reported=True, unwatched=True)
            elif rec["running"] is None:
                print(f"boundary {run} (nothing running at the mark)", flush=True)
                rec["reported"] = True
            elif _boundary(lines, rec["running"]):
                print(f"boundary {run} after {rec.get('label') or _short_key(rec['running'])}", flush=True)
                rec["reported"] = True
            else:
                continue
            reported = True
        if reported:
            _save_state(args.state, state)
        if all(rec["reported"] for rec in runs.values()):
            unwatched = [run for run, rec in runs.items() if rec.get("unwatched")]
            print("all at a boundary" if not unwatched else "all reported; unwatched: " + ", ".join(unwatched))
            return 0
        if reported:
            return 0
        if deadline is not None and time.monotonic() >= deadline:
            for run, rec in runs.items():
                if not rec["reported"]:
                    print(f"mid-step {run} {rec.get('label') or _short_key(rec['running'])}")
            return 3
        time.sleep(args.interval)


# ---- the note ------------------------------------------------------------------------------------------------------

def _note(path, verb):
    try:
        return RR.Note(Path(path))
    except (OSError, ValueError) as e:
        raise Fail(1, f"ERROR: step-boundary {verb}: cannot read {path}: {e}")


def _save_note(note, verb):
    try:
        note.save()
    except OSError as e:
        raise Fail(1, f"ERROR: step-boundary {verb}: cannot write {note.path}: {e}")


def _last_room_line(note):
    """(stamp, 'start' | 'ended') for the last room-stop line of `## Pause log`, or None: reconcile-rollout.py's
    _last_room_stop, the one reader (a lead's lease reads it too, p28-4)."""
    return RR._last_room_stop(note)


def _standing(last, now, hours):
    """0 under the bound, 4 at or past it (or an unparseable stamp), 5 with no start line last."""
    if last is None or last[1] == "ended":
        return 5
    ts = RR._parse_ts(last[0])
    if ts is None or now - ts >= timedelta(hours=hours):
        return 4
    return 0


def cmd_begin(args):
    text = sys.stdin.read()
    if text.endswith("\n"):
        text = text[:-1]
    if not text.strip() or "\n" in text or "\r" in text:
        raise _usage("begin", "one non-empty line of text on stdin; nothing written")
    if "[[" in text:
        # _schedule_positions ranks the first wikilink on any list line: one here, above `## Queue`, would
        # reorder the queue.
        raise _usage("begin", "slugs go in bare, never as [[wikilinks]] (a wikilink on a ## Pause log line "
                              "above ## Queue reorders the queue); nothing written")
    note = _note(args.rollout, "begin")
    last = _last_room_line(note)
    if _standing(last, _now(), BOUND_HOURS) == 0:
        print(f"room stop already stands since {last[0]}")
        return 0
    line = f"- {RR._stamp(_now())} room stop: {text.strip()}"
    note.append_line(PAUSE_LOG, line)
    _save_note(note, "begin")
    _record_room_stop(args.rollout, text.strip())
    print(line)
    return 0


def _record_room_stop(rollout, text):
    """The room stop's Run-record line (p29-10, ADR 0051; run_record.py's stop model): stopped {cause: usage-limit,
    inferred: false, calls, reason}. Best-effort: it never raises and prints only run_record's own warning."""
    try:
        stem = Path(os.path.expanduser(rollout)).stem
        lines = RR._record_read(stem) or []
        RR._event(stem, "stopped", None, {"cause": "usage-limit", "inferred": False, "calls": RR.inflight_calls(lines),
                                          "reason": text[:200]})
    except Exception:  # noqa: BLE001 — recording never breaks the stop
        pass


def cmd_end(args):
    note = _note(args.rollout, "end")
    last = _last_room_line(note)
    if last is None or last[1] == "ended":
        print("no room stop stands")
        return 0
    note.append_line(PAUSE_LOG, f"- {RR._stamp(_now())} room stop ended")
    _save_note(note, "end")
    print(f"room stop ended (stood since {last[0]})")
    return 0


def cmd_stands(args):
    if not args.hours > 0:
        raise _usage("stands", "--hours must be above 0")
    now = _now()
    if args.now is not None:
        now = RR._parse_ts(args.now)
        if now is None:
            raise _usage("stands", f"--now {args.now!r} is not an ISO timestamp")
    last = _last_room_line(_note(args.rollout, "stands"))
    rc = _standing(last, now, args.hours)
    if rc == 0:
        print(f"room stop stands since {last[0]}")
    elif rc == 4:
        why = "its stamp does not parse" if RR._parse_ts(last[0]) is None else f"at or past its {args.hours:g} h bound"
        print(f"room stop since {last[0]} has lapsed: {why}")
    else:
        print("no room stop stands")
    return rc


VERBS = {"mark": cmd_mark, "watch": cmd_watch, "begin": cmd_begin, "end": cmd_end, "stands": cmd_stands}


def _engine_guard(note):
    """engine-snapshot.py's guard() for the note, loaded from this tree (ADR 0043): its refusal line, else None."""
    try:
        sys.dont_write_bytecode = True
        src = os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "_shared", "scripts",
                           "engine-snapshot.py")
        spec = importlib.util.spec_from_file_location("thread_engine_snapshot", src)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:  # only positive evidence refuses
        return None
    return mod.guard(note, mod.ROOT, "skills/execute/scripts/step-boundary.py")


def main(argv=None):
    p = argparse.ArgumentParser(prog="step-boundary.py", description="The lead's side of a Chorus room stop "
                                "(execute § Room stop): stop each Workflow call at a step boundary, and record the "
                                "stop on the rollout note.")
    sub = p.add_subparsers(dest="verb", required=True)
    m = sub.add_parser("mark", help="record what each run is running now")
    m.add_argument("--out", required=True)
    m.add_argument("--run", action="append", default=[])
    m.add_argument("--journals-root")
    w = sub.add_parser("watch", help="poll the marked runs until one reaches its boundary")
    w.add_argument("--state", required=True)
    w.add_argument("--interval", type=float, default=1.0)
    w.add_argument("--timeout", type=float)
    for verb, helptext in (("begin", "record a room stop's start (one line on stdin)"),
                           ("end", "record a standing room stop's end"),
                           ("stands", "read whether a room stop stands (read-only)")):
        s = sub.add_parser(verb, help=helptext)
        s.add_argument("--rollout", required=True)
        if verb == "stands":
            s.add_argument("--hours", type=float, default=BOUND_HOURS)
            s.add_argument("--now")
    args = p.parse_args(argv)
    if args.verb in ("begin", "end"):
        refusal = _engine_guard(args.rollout)
        if refusal:   # ADR 0043: the room-stop line is written from the rollout's own Engine snapshot
            print(refusal, file=sys.stderr)
            return 2
    try:
        return VERBS[args.verb](args)
    except Fail as e:
        print(e.msg, file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
