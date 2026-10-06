#!/usr/bin/env python3
"""The Run record's one writer (ADR 0032; p15-1). This docstring is the schema's only copy.

python >= 3.8, stdlib only: hooks may run it under /usr/bin/python3, so no 3.10+ syntax. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py emit --kind <kind> \\
        [--rollout <slug>] [--task <slug>] [--json <object>|-] [--ts <stamp>]  || true
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py dir

or imported by path (importlib.util.spec_from_file_location, git-env-canary.py's _load_reconcile pattern):

    emit(rollout, kind, task=None, fields=None, *, ts=None, env=None, strict=False) -> bool
    events_dir(env=None) -> str            record_path(rollout, env=None) -> str
    normalise_slug(value) -> str           Refused, KINDS, TERMINAL_STATUSES, REVIEWS, TUNINGS, RESERVED

Callers: in-process callers use the default strict=False, which never raises; shell callers append
`|| true`. Recording must never break a rollout.

Directory: ${THREAD_EVENTS_DIR:-${XDG_STATE_HOME:-~/.local/state}/thread/events}. An empty value counts
as unset; `~` expands in the override. A relative override is a warned write failure (nothing written); a
relative XDG_STATE_HOME is ignored, as the XDG spec says. A dangling symlink is a warned failure, never a
fall back to another directory. Every writer resolves this chain itself: hooks, Codex and launchd export no
override, so the default path is the shared meeting point. On Lachy's machine ~/.local/state/thread/events is
a symlink to _shared/state/thread-events/ (in place since 2026-10-06), so the record is backed up; nothing
here creates the link, and on a machine without it the first emit's os.makedirs creates a real directory
there. THREAD_EVENTS_DIR is for tests and non-default setups. `dir` prints the resolved directory, so any writer can confirm it lands in
the same place.

Files: <rollout>.jsonl, one per rollout; review-round always goes to reviews.jsonl and tuning to
tunings.jsonl. Both names are RESERVED: refused as a rollout slug and as a carried `from`.

tunings.jsonl holds one line per Retro (skills/retro/scripts/tune.py is its one emitter, score.py its one
reader): the scored window, its seven headline scores and the Tunings Lachy picked (`applied`, most often []).
- Baseline: the next Retro on that repo (matched ignoring case) compares against the `scores` of the line with
  the latest window.activeEnd at or before its own window.activeStart, preferring a line not marked partial; a
  line whose activeEnd is null never qualifies. Comparing active spans, not ts or until, keeps a Retro run late
  (after the next rollout began) a valid baseline for that rollout.
- Void: when tune.py's config write fails after its line landed, it appends a second line carrying
  `voids: <the first line's id>`, an empty `applied` and the same scores. Readers drop a voided line's
  `applied` (it never took effect) and keep its scores as a baseline.

Slugs: --rollout, --task and carried's `from` accept a bare slug, [[slug]], [[slug|alias]], a
path-qualified [[dir/slug]] or a note path ending .md (its stem). The result is lowercased and must match
[a-z0-9][a-z0-9._-]*, so merge-task.sh passes a note path or a wikilink straight through and a task's
events never split between `Foo` and `foo`.

Line format: one JSON object per line, ASCII only, compact separators, no NaN or Infinity, at most 16 KiB
with its newline. The common keys come first, in this order:

    v        1
    ts       UTC, millisecond precision, `Z` suffix: 2026-10-03T22:23:00.000Z. The writer stamps it; an
             explicit --ts / ts= is converted to UTC and must match, on every python version,
             YYYY-MM-DD(T| )HH:MM[:SS[(.|,)fraction]] then Z, +HH, +HHMM or +HH:MM (a naive one is
             refused; the fraction is cut to microseconds). So `date +%Y-%m-%dT%H:%M:%S%z` works.
             Any other ISO timestamp field a caller adds must be UTC `Z` too; call-journal's
             startTime is the one epoch field (the journal's own epoch-ms integer, verbatim).
    host     the hostname up to its first dot
    rollout  the rollout slug (null only for review-round; a tuning's is a provenance stamp)
    task     the task slug, or null
    kind     one of the kinds below

The kind fields follow. Unknown extra keys are allowed (an optional `harness`, say); a key that collides
with a common key is refused.

Kinds (T: a task is required; `?` marks an optional field; every enum is closed):

  slot-taken      T  settings{parallel_ceiling (int >= 1), max_review_rounds?, max_iterations?,
                     max_plan_rounds? (ints >= 1), rung? (str)} (the effective values after per-task
                     overrides); start? (start | restart | revise | hand-back | resume); carriedFrom? (slug)
  run-bound       T  runId, journalDir; call? (task | revise | integrate | resume); resumedFrom?
  slot-freed      T  outcome (ready | set-aside | completed | lost | stopped | failed)
  ready           T  pr? (url or number)
  set-aside       T  stage (plan | implement | verify | review | integrate | gate), reasonClass;
                     setAsideAt? (run | integration | gate)
  lane-taken      T  (no fields)
  lane-freed      T  release (merge | set-aside | reject | halt); path?; triggers? (list of str);
                     conflict? (bool)
  merged          T  pr?; readOnly? (bool)
  paused             mode (soft | hard)
  resumed            (no fields)
  hold-started       hold (merge | git-env | race)
  hold-ended         hold (merge | git-env | race)
  idle-slots         reason (dependency | solo | pause-drain | queue-tail | awaiting-hand-back |
                     hold-merge | hold-git-env | hold-race); free (int >= 0); settings (as slot-taken)
  quota-stall        stage?; detail?
  call-journal       runId; status (the journal's own status, verbatim); mode?; tokens?, durationMs?,
                     agents? (ints >= 0); startTime? (int >= 0: the journal's epoch ms, verbatim)
  review-round       repo, head, digest; doc?; mode?; effort?; findings?, original?, regression?
                     (ints >= 0); verdict?. No rollout, no task; lands in reviews.jsonl.
  carried         T  from (the old rollout's slug), to (set to the new rollout). Appended to both
                     <from>.jsonl and <to>.jsonl, each line's `rollout` the file it sits in; each append
                     is best-effort on its own.
  tuning             id, repo, window{since, until, activeStart?, activeEnd?, partial?}, scores{throughput,
                     runningHours, merges, tokensPerMerge, setAsideRate, conflictRate, quotaStalls}, applied
                     (a list of at most 8 {key, from, to, ranAt, rule, evidence, agreeing}); binding?
                     (slot-bound | lane-bound | quota-bound | dependency-bound | none-clear); voids? (the id
                     of the line this one voids). A rollout is required and a task is refused; lands in
                     tunings.jsonl. window: since and until UTC `Z` stamps, activeStart and activeEnd a UTC
                     `Z` stamp or null, partial a boolean, no other key. scores: exactly the seven keys,
                     each a finite number or null, with merges and quotaStalls integers >= 0. applied: key
                     one of parallel_ceiling, max_review_rounds, max_iterations, max_plan_rounds; from, to
                     and ranAt integers >= 1 with from != to; rule a string of at most 64 characters;
                     evidence one of at most 300; agreeing an integer >= 0; no other key.

There is no ceiling-changed kind, and it is refused: the settings stamped on every slot-taken and
idle-slots replace it, which keeps `next` stateless and also covers round caps and per-task overrides.

Reading the record (the writers are reconcile-rollout.py's verbs and git-env-canary.py, p15-2; that module's
docstring lists each verb's events and the stage, reasonClass and idle-reason tables):
- Pairing. A Slot is slot-taken .. slot-freed (or a `carried` line in the from-file), per task; the lane is
  lane-taken .. lane-freed; a hold is hold-started .. hold-ended per (hold, task); a pause is paused ..
  resumed. A slot-taken while that task's Slot is open is the same Slot and keeps the first `start` (a
  Lost-call restart's `resume`, a restart after a dead lead). A slot-freed or lane-freed with nothing open
  for that task is ignored. A lane-taken while the same task holds the lane is the same holding; while
  another task holds it, that holding ends there, flagged as unrecorded. A hold-started while that (hold,
  task) is open is the same hold. A lane-freed also closes the task's open merge hold. A paused while paused
  is the same pause; a resumed with no pause is ignored. A `carried` line in the from-file (its `rollout`
  equals its `from`) closes that task's Slot, lane and holds there. Anything still open at the record's last
  line ends there and is flagged.
- slot-freed outcome: ready (approved with a PR), set-aside, completed (a read-only approval, or an
  in_progress note whose PR `resume` found merged), lost (a dead call's lead-written row), stopped (a hard
  pause, a defer or a carry ended it); `failed` is reserved.
- slot-taken start: start, restart (a stalled note restarted), revise (a seeded revise), hand-back (the
  restart after a hand-back, an approve-gates sign-off or a descope), resume (a Lost-call or signed-gate
  resume).
- set-aside stage is where the task stopped; setAsideAt is where it re-enters (merge-task's exit 1 reads
  stage integrate, setAsideAt run).
- Idle Slot time is a span. A Retro derives it from slot-taken / slot-freed pairs against the ceiling
  stamped on each event. An idle-slots event is a reason marker labelling the span it falls in: a change
  of reason splits the span, a repeat is harmless, a span with no marker reads as "unexplained".
- call-journal: for each runId, use its latest line with a terminal status (completed, failed, killed,
  stopped, cancelled); with none, use its latest line and treat the call as in flight. The writer folds
  under an exclusive flock on the file and skips a fold when that runId already has a terminal line, or
  when the fold equals that runId's latest line (ts and host aside). So a mid-run Retro records partial
  numbers, a close Retro's terminal fold always lands, and re-folding is safe. An unknown status counts
  as non-terminal: appended and later superseded, never dropped. Write call-journal only through this
  module, so every writer takes part in the lock.
- review-round: dedupe on (repo, head, digest), keeping the latest line.
- tuning: see tunings.jsonl under Files (the baseline and void rules).
- Skip a line that does not parse: a crash can leave a last line with no newline, which the next append
  then merges with (a known limit; checking the tail would mean locking every emit).

Mirror contract (p15-7). The fresh-review ledger writes review-round lines without importing this module.
It must keep to: the directory chain above (the override, then XDG_STATE_HOME, then the home default);
the line format and common keys above, with rollout and task null; one O_APPEND write of the whole line,
at most 16 KiB, no lock. Idempotency is the emitter's job: one event per review doc written, checked by
its own `doc` key. This writer never dedupes or locks review-round; readers dedupe as above.

Writing: os.makedirs, then os.open(O_WRONLY | O_APPEND | O_CREAT, 0o644) and ONE os.write of the whole
line, so concurrent emitters on a local filesystem never interleave a line (not promised on network or
sync filesystems). Any failure to write (a short write, an OSError, anything unexpected) prints
`run_record: warning: cannot write <path>: <err>` and writes nothing more; the CLI still exits 0.

Exit codes: 0 written, skipped as a duplicate fold, or a warned write failure; 2 refused (an unknown kind,
a missing or out-of-enum field, a task-scoped kind with no task, a tuning with one, a reserved rollout or
`from`, --json not a JSON object, a common-key
collision, NaN, a bad slug, a naive or malformed --ts, a line over 16 KiB), with one line starting `run_record: ` on
stderr and nothing written; `dir` exits 1 when the directory cannot be resolved.
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import re
import socket
import sys
import time

try:
    import fcntl
except ImportError:  # Windows: call-journal folds scan unlocked, with a warning
    fcntl = None

VERSION = 1
MAX_LINE = 16 * 1024
LOCK_WAIT = 5.0
COMMON = ("v", "ts", "host", "rollout", "task", "kind")
REVIEWS = "reviews"
TUNINGS = "tunings"
RESERVED = (REVIEWS, TUNINGS)  # record files that are no rollout's: refused as a rollout slug or a carried `from`
SLUG_RE = re.compile(r"[a-z0-9][a-z0-9._-]*")
# One accepted --ts shape on every python (fromisoformat widened in 3.11): date, time, fraction, offset.
STAMP_RE = re.compile(r"(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d)(?::(\d\d)(?:[.,](\d+))?)?"
                      r"(?:([Zz])|([+-])(\d\d)(?::?(\d\d))?)?", re.ASCII)
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
TERMINAL_STATUSES = frozenset({"completed", "failed", "killed", "stopped", "cancelled"})


class Refused(Exception):
    pass


# ---- field checks ----------------------------------------------------------------------------------------
# Each returns None when the value is fine, else the reason it is not.

def _str(v):
    return None if isinstance(v, str) and v else "a non-empty string"


def _int(lo):
    def check(v):
        ok = isinstance(v, int) and not isinstance(v, bool) and v >= lo
        return None if ok else "an integer >= %d" % lo
    return check


def _enum(*values):
    def check(v):
        return None if v in values else "one of %s" % ", ".join(values)
    return check


def _bool(v):
    return None if isinstance(v, bool) else "true or false"


def _strlist(v):
    ok = isinstance(v, list) and all(isinstance(x, str) for x in v)
    return None if ok else "a list of strings"


def _pr(v):
    return None if (isinstance(v, str) and v) or (isinstance(v, int) and not isinstance(v, bool)) else "a url or a number"


def _settings(v):
    if not isinstance(v, dict):
        return "an object"
    if _int(1)(v.get("parallel_ceiling")):
        return "an object with parallel_ceiling an integer >= 1"
    for k in ("max_review_rounds", "max_iterations", "max_plan_rounds"):
        if k in v and _int(1)(v[k]):
            return "an object with %s an integer >= 1" % k
    if "rung" in v and _str(v["rung"]):
        return "an object with rung a non-empty string"
    return None


SETTINGS = _settings

# ---- the tuning kind (skills/retro/scripts/tune.py) -------------------------------------------------------

UTC_Z_RE = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z\Z", re.ASCII)
# rollout-settings.py's KEYS (tests/run-record.test.mjs pins that the two agree).
TUNING_KEYS = ("parallel_ceiling", "max_review_rounds", "max_iterations", "max_plan_rounds")
SCORE_KEYS = ("throughput", "runningHours", "merges", "tokensPerMerge", "setAsideRate", "conflictRate",
              "quotaStalls")
APPLIED_KEYS = ("key", "from", "to", "ranAt", "rule", "evidence", "agreeing")
MAX_APPLIED = 8
BINDINGS = ("slot-bound", "lane-bound", "quota-bound", "dependency-bound", "none-clear")


def _utcz(v):
    return isinstance(v, str) and bool(UTC_Z_RE.match(v))


def _number(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return isinstance(v, int) or math.isfinite(v)


def _window(v):
    if not isinstance(v, dict):
        return "an object"
    extra = sorted(set(v) - {"since", "until", "activeStart", "activeEnd", "partial"})
    if extra:
        return "an object with no key %s" % ", ".join(extra)
    for k in ("since", "until"):
        if not _utcz(v.get(k)):
            return "an object with %s a UTC Z stamp" % k
    for k in ("activeStart", "activeEnd"):
        if k in v and v[k] is not None and not _utcz(v[k]):
            return "an object with %s a UTC Z stamp or null" % k
    if "partial" in v and not isinstance(v["partial"], bool):
        return "an object with partial true or false"
    return None


def _scores(v):
    if not isinstance(v, dict) or set(v) != set(SCORE_KEYS):
        return "an object with exactly the keys %s" % ", ".join(SCORE_KEYS)
    for k in SCORE_KEYS:
        if k in ("merges", "quotaStalls"):
            if _int(0)(v[k]):
                return "an object with %s an integer >= 0" % k
        elif v[k] is not None and not _number(v[k]):
            return "an object with %s a finite number or null" % k
    return None


def _applied(v):
    if not isinstance(v, list) or len(v) > MAX_APPLIED:
        return "a list of at most %d entries" % MAX_APPLIED
    for e in v:
        if not isinstance(e, dict) or set(e) != set(APPLIED_KEYS):
            return "a list of objects with exactly the keys %s" % ", ".join(APPLIED_KEYS)
        if e["key"] not in TUNING_KEYS:
            return "a list whose key is one of %s" % ", ".join(TUNING_KEYS)
        for k in ("from", "to", "ranAt"):
            if _int(1)(e[k]):
                return "a list whose %s is an integer >= 1" % k
        if e["from"] == e["to"]:
            return "a list whose from and to differ"
        if not isinstance(e["rule"], str) or not e["rule"] or len(e["rule"]) > 64:
            return "a list whose rule is a non-empty string of at most 64 characters"
        if not isinstance(e["evidence"], str) or not e["evidence"] or len(e["evidence"]) > 300:
            return "a list whose evidence is a non-empty string of at most 300 characters"
        if _int(0)(e["agreeing"]):
            return "a list whose agreeing is an integer >= 0"
    return None
HOLDS = ("merge", "git-env", "race")
# kind -> (task required, required fields, optional fields)
KINDS = {
    "slot-taken": (True, {"settings": SETTINGS},
                   {"start": _enum("start", "restart", "revise", "hand-back", "resume"), "carriedFrom": _str}),
    "run-bound": (True, {"runId": _str, "journalDir": _str},
                  {"call": _enum("task", "revise", "integrate", "resume"), "resumedFrom": _str}),
    "slot-freed": (True, {"outcome": _enum("ready", "set-aside", "completed", "lost", "stopped", "failed")}, {}),
    "ready": (True, {}, {"pr": _pr}),
    "set-aside": (True, {"stage": _enum("plan", "implement", "verify", "review", "integrate", "gate"),
                         "reasonClass": _str}, {"setAsideAt": _enum("run", "integration", "gate")}),
    "lane-taken": (True, {}, {}),
    "lane-freed": (True, {"release": _enum("merge", "set-aside", "reject", "halt")},
                   {"path": _str, "triggers": _strlist, "conflict": _bool}),
    "merged": (True, {}, {"pr": _pr, "readOnly": _bool}),
    "paused": (False, {"mode": _enum("soft", "hard")}, {}),
    "resumed": (False, {}, {}),
    "hold-started": (False, {"hold": _enum(*HOLDS)}, {}),
    "hold-ended": (False, {"hold": _enum(*HOLDS)}, {}),
    "idle-slots": (False, {"reason": _enum("dependency", "solo", "pause-drain", "queue-tail", "awaiting-hand-back",
                                           "hold-merge", "hold-git-env", "hold-race"),
                           "free": _int(0), "settings": SETTINGS}, {}),
    "quota-stall": (False, {}, {"stage": _str, "detail": _str}),
    "call-journal": (False, {"runId": _str, "status": _str},
                     {"mode": _str, "tokens": _int(0), "durationMs": _int(0), "agents": _int(0),
                      "startTime": _int(0)}),
    "review-round": (False, {"repo": _str, "head": _str, "digest": _str},
                     {"doc": _str, "mode": _str, "effort": _str, "findings": _int(0), "original": _int(0),
                      "regression": _int(0), "verdict": _str}),
    "carried": (True, {"from": _str, "to": _str}, {}),
    "tuning": (False, {"id": _str, "repo": _str, "window": _window, "scores": _scores, "applied": _applied},
               {"binding": _enum(*BINDINGS), "voids": _str}),
}


# ---- small pieces ----------------------------------------------------------------------------------------

def _say(line):
    try:
        sys.stderr.write("run_record: %s\n" % line)
        sys.stderr.flush()
    except Exception:
        pass


def normalise_slug(value, what="slug"):
    """A bare slug, [[slug]], [[slug|alias]], [[dir/slug]] or a note path ending .md -> the lowercased slug."""
    if not isinstance(value, str):
        raise Refused("%s must be a string" % what)
    s = value.strip()
    m = LINK_RE.fullmatch(s)
    if m:
        s = m.group(1).strip().rsplit("/", 1)[-1]
        if s.endswith(".md"):
            s = s[:-3]
    elif s.endswith(".md"):
        s = re.split(r"[\\/]", s)[-1][:-3]
    s = s.lower()
    if not SLUG_RE.fullmatch(s):
        raise Refused("%s %r is not a slug ([a-z0-9][a-z0-9._-]*)" % (what, value))
    return s


def _home(env):
    h = env.get("HOME")
    if h:
        return h
    try:  # HOME unset: the passwd entry, as expanduser does
        import pwd
        return pwd.getpwuid(os.getuid()).pw_dir
    except Exception:
        return os.path.expanduser("~")


def events_dir(env=None):
    """The resolved events directory (pure: reads only `env`, default os.environ). ValueError when unresolvable."""
    env = os.environ if env is None else env
    over = env.get("THREAD_EVENTS_DIR")
    if over:
        if over == "~" or over.startswith("~/"):
            over = _home(env) + over[1:]
        elif over.startswith("~"):
            over = os.path.expanduser(over)
        if not os.path.isabs(over):
            raise ValueError("THREAD_EVENTS_DIR is relative (%s); it must be absolute" % over)
        return os.path.normpath(over)
    xdg = env.get("XDG_STATE_HOME")
    base = xdg if xdg and os.path.isabs(xdg) else os.path.join(_home(env), ".local", "state")
    return os.path.normpath(os.path.join(base, "thread", "events"))


def record_path(rollout, env=None):
    """The file a rollout's events go to (pure). `rollout` None means reviews.jsonl."""
    name = REVIEWS if rollout is None else normalise_slug(rollout, "rollout")
    return os.path.join(events_dir(env), name + ".jsonl")


def _stamp(ts):
    if ts is None:
        t = datetime.datetime.now(datetime.timezone.utc)
    else:
        if not isinstance(ts, str):
            raise Refused("ts must be a string")
        m = STAMP_RE.fullmatch(ts.strip())
        if not m:
            raise Refused("ts %r is not an ISO 8601 stamp (YYYY-MM-DDTHH:MM[:SS[.fff]] with Z or an offset)" % ts)
        date, hm, sec, frac, zulu, sign, oh, om = m.groups()
        if not zulu and not sign:
            raise Refused("ts %r has no offset or Z" % ts)
        offset = "+00:00" if zulu else "%s%s:%s" % (sign, oh, om or "00")
        canon = "%sT%s:%s.%s%s" % (date, hm, sec or "00", (frac or "")[:6].ljust(6, "0"), offset)
        try:  # the canonical form parses the same on 3.8 and 3.11+
            t = datetime.datetime.fromisoformat(canon)
        except ValueError as e:
            raise Refused("ts %r is not a valid time: %s" % (ts, e))
        t = t.astimezone(datetime.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (t.microsecond // 1000)


def _host():
    try:
        return socket.gethostname().split(".")[0] or "unknown"
    except Exception:
        return "unknown"


def _check_fields(kind, fields):
    _, required, optional = KINDS[kind]
    for k in COMMON:
        if k in fields:
            raise Refused("%s: field %r collides with a common key" % (kind, k))
    for k, check in required.items():
        if k not in fields:
            raise Refused("%s: missing required field %r" % (kind, k))
        why = check(fields[k])
        if why:
            raise Refused("%s: %s must be %s" % (kind, k, why))
    for k, check in optional.items():
        if k in fields:
            why = check(fields[k])
            if why:
                raise Refused("%s: %s must be %s" % (kind, k, why))


def _line(ts, host, rollout, task, kind, fields):
    obj = {"v": VERSION, "ts": ts, "host": host, "rollout": rollout, "task": task, "kind": kind}
    obj.update(fields)
    try:
        text = json.dumps(obj, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    except ValueError as e:
        raise Refused("%s: %s" % (kind, e))
    except TypeError as e:
        raise Refused("%s: a field is not JSON: %s" % (kind, e))
    data = (text + "\n").encode("ascii")
    if len(data) > MAX_LINE:
        raise Refused("%s: the line is %d bytes, over the %d-byte limit" % (kind, len(data), MAX_LINE))
    return data


# ---- writing ---------------------------------------------------------------------------------------------

def _write_all(fd, data):
    n = os.write(fd, data)
    if n != len(data):
        raise OSError("short write (%d of %d bytes)" % (n, len(data)))


def _append(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        _write_all(fd, data)
    finally:
        os.close(fd)
    return True


def _same_fold(a, b):
    drop = ("ts", "host")
    return {k: v for k, v in a.items() if k not in drop} == {k: v for k, v in b.items() if k not in drop}


def _fold_skips(path, new):
    """True when the call-journal line `new` adds nothing: its runId has a terminal line, or it equals the latest."""
    latest = None
    try:
        with open(path, "rb") as f:
            for raw in f:
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(d, dict) or d.get("kind") != "call-journal" or d.get("runId") != new["runId"]:
                    continue
                if d.get("status") in TERMINAL_STATUSES:
                    return True
                latest = d
    except FileNotFoundError:
        return False
    return latest is not None and _same_fold(latest, new)


def _fold(path, data, new):
    """Append a call-journal line under an exclusive flock, unless _fold_skips. Returns True (written or skipped)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        if fcntl is None:
            _say("warning: no file locking here; the call-journal fold for %s scans %s unlocked" % (new["runId"], path))
        else:
            deadline = time.monotonic() + LOCK_WAIT
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except (BlockingIOError, PermissionError):
                    if time.monotonic() >= deadline:
                        raise OSError("the lock stayed busy for %d s" % LOCK_WAIT)
                    time.sleep(0.02)
        if not _fold_skips(path, new):
            _write_all(fd, data)
    finally:
        os.close(fd)  # releases the flock
    return True


def _write(path, data, new, kind):
    try:
        if kind == "call-journal":
            return _fold(path, data, new)
        return _append(path, data)
    except Exception as e:
        _say("warning: cannot write %s: %s" % (path, e))
        return False


# ---- emit ------------------------------------------------------------------------------------------------

def _emit(rollout, kind, task, fields, ts, env):
    if not isinstance(kind, str) or kind not in KINDS:
        raise Refused("unknown kind %r (known: %s)" % (kind, ", ".join(sorted(KINDS))))
    if fields is None:
        fields = {}
    if not isinstance(fields, dict):
        raise Refused("%s: fields must be a JSON object" % kind)
    fields = dict(fields)
    task_required = KINDS[kind][0]
    if kind == "review-round":
        if rollout is not None or task is not None:
            raise Refused("review-round has no rollout or task (it lands in reviews.jsonl)")
    else:
        if rollout is None:
            raise Refused("%s: a rollout is required" % kind)
        rollout = normalise_slug(rollout, "rollout")
        if rollout in RESERVED:
            raise Refused("rollout %r is reserved (%s.jsonl is no rollout's record)" % (rollout, rollout))
    if kind == "tuning" and task is not None:
        raise Refused("tuning has no task (it lands in %s.jsonl)" % TUNINGS)
    if task is not None:
        task = normalise_slug(task, "task")
    elif task_required:
        raise Refused("%s: a task is required" % kind)
    if kind == "slot-taken" and "carriedFrom" in fields:
        fields["carriedFrom"] = normalise_slug(fields["carriedFrom"], "carriedFrom")
    targets = [rollout]
    if kind == "carried":
        if "from" not in fields:
            raise Refused("carried: missing required field 'from'")
        old = normalise_slug(fields["from"], "from")
        if old in RESERVED:
            raise Refused("from %r is reserved (%s.jsonl is no rollout's record)" % (old, old))
        if "to" in fields and normalise_slug(fields["to"], "to") != rollout:
            raise Refused("carried: to %r is not the rollout %r" % (fields["to"], rollout))
        if old == rollout:
            raise Refused("carried: from and to are the same rollout %r" % rollout)
        fields["from"], fields["to"] = old, rollout
        targets = [old, rollout]
    _check_fields(kind, fields)
    stamp, host = _stamp(ts), _host()
    lines = [(r, _line(stamp, host, r, task, kind, fields)) for r in targets]
    try:
        base = events_dir(env)
    except Exception as e:
        _say("warning: cannot write the run record: %s" % e)
        return False
    ok = True
    for r, data in lines:
        name = REVIEWS if r is None else TUNINGS if kind == "tuning" else r
        path = os.path.join(base, name + ".jsonl")
        new = json.loads(data)
        ok = _write(path, data, new, kind) and ok
    return ok


def emit(rollout, kind, task=None, fields=None, *, ts=None, env=None, strict=False):
    """Record one event. Returns True when recorded (or skipped as a duplicate fold), else False.

    A refusal prints one `run_record: refused:` line and returns False, or raises Refused when strict.
    A write failure, or anything unexpected, prints a warning and returns False either way.
    """
    try:
        return _emit(rollout, kind, task, fields, ts, env)
    except Refused as e:
        _say("refused: %s" % e)
        if strict:
            raise
        return False
    except Exception as e:
        _say("warning: cannot write the run record (%s): %s: %s" % (kind, type(e).__name__, e))
        return False


# ---- CLI -------------------------------------------------------------------------------------------------

class Parser(argparse.ArgumentParser):
    def error(self, message):
        _say("refused: %s" % message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="run_record.py", description="The Run record's one writer (ADR 0032).")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    e = sub.add_parser("emit", help="append one event")
    e.add_argument("--kind", required=True)
    e.add_argument("--rollout")
    e.add_argument("--task")
    e.add_argument("--json", dest="fields", help="the kind fields as a JSON object, or - for stdin")
    e.add_argument("--ts", help="the event's time, with an offset or Z (default now)")
    sub.add_parser("dir", help="print the resolved events directory")
    a = p.parse_args(argv)
    if a.verb == "dir":
        try:
            print(events_dir())
        except Exception as err:
            _say("cannot resolve the events directory: %s" % err)
            return 1
        return 0
    if a.verb != "emit":
        p.error("a verb is required: emit or dir")
    fields = None
    if a.fields is not None:
        raw = sys.stdin.read() if a.fields == "-" else a.fields
        try:
            fields = json.loads(raw)
        except ValueError as err:
            _say("refused: --json is not valid JSON: %s" % err)
            return 2
        if not isinstance(fields, dict):
            _say("refused: --json must be a JSON object")
            return 2
    try:
        emit(a.rollout, a.kind, a.task, fields, ts=a.ts, strict=True)
    except Refused:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
