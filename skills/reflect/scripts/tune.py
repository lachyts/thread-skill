#!/usr/bin/env python3
"""tune.py — land the Tunings Lachy picked from a by-hand Reflection, or the knobs the weekly reading lands or reverts on
its own (ADR 0037 d5), and record each (p15-5, ADR 0032).

python >= 3.8, stdlib only (score.py, which it loads, keeps the same floor). The Reflection's only writer of
rollouts.toml (inert-paths.py writes only `inert_paths`, a repo's Inert paths; rollout-settings.py `declare`
writes any other key he has ruled on, Tuning keys included, and this script then reads that value as a hand edit: its
revert reason prints `a hand edit, left alone`) and the only writer of tunings.jsonl. An edit that adds a key above the file's `schema` raises its top-level `schema` line in the same edit
(rollout-settings.py's header, ADR 0043): raise_schema(), below. Three callers (ADR 0037 d4-d5): skills/reflect/SKILL.md step 7 runs it exactly once per by-hand
Reflection that reached its scores; skills/reflect/scripts/close-score.py runs `--record-only --close <kind>` once at
each rollout's close (its completion ceremony, or its supersede); and SKILL.md step 14 (the weekly reading) runs
`--revert` then `--auto`, zero or more times per repo:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/tune.py --scores <score.json|-> \\
        (--pick p1[,p2...] --repo <dir> | --record-only [--close completion|supersede] |
         --auto --repo <dir> --reflection <id> | --revert <tuning id> --repo <dir> --reflection <id>)
        [--config <path>] [--tasks-dir <dir>] [--dry-run]

--scores is score.py's JSON. --pick, --record-only, --auto and --revert are mutually exclusive and one is required.
--reflection (an r- id, the weekly reading's) is required with --auto and --revert and refused with the other two (exit
2, nothing written); --close with --auto or --revert is refused by --close's own rule (it needs --record-only).

Reads: --scores; rollouts.toml through rollout-settings.py (resolve() and _origin_slug()); tunings.jsonl (close_line()
for --close; for --auto and --revert, score.py's load_tunings(): a key's last move and the auto lines); and, for --auto
and --revert, reflections.jsonl at reflections_path() (run_record's events directory; the closed check and the
agreement): a missing file is no earlier Reflection, a line that does not parse is skipped, and a file that exists but
cannot be read prints `tune: reflections.jsonl cannot be read: ...` and exits 1, nothing written (as does an
unresolvable events directory, `tune: cannot resolve the events directory: ...`). Both modes refuse a --reflection that
already has its `reflection` (close) line: exit 2, `Reflection <id> is closed`.

--auto --repo <dir> --reflection <id> (ADR 0037 d5) lands every proposal in scores.proposals whose key is one of
rollout-settings.py's TUNING_KEYS (KEYS, then capacity_max and the two Weight keys, p53-5, then overtime_runs, p39-14)
and that passes auto_check(), as ONE tuning line stamped `auto: true` and `reflection`. auto_check's checks run in order,
and the first that fails is the reason: (1) no trade and no caution (Lachy's call, ADR 0037 d1); (2) no Guardrail
breached and the window not partial; (3) ranAt == from (a landing steps one past the value the run ran at, never a jump;
a Weight's ranAt is its estimate now, score.py's, so this check always passes for it, and score.py's one-unit step toward
the measure keeps "never a jump"); (3a) the floor: a from, to or ranAt below 1 is held with the floor's reason (below,
FLOOR); (4) no auto line of this Reflection has already moved the key (a revert included); (5) the agreement is at least AGREE (3): run_record.py's
Agreement rule, closed earlier Reflections' knob lines since the key's last move, each counted when it names a rollout
not yet seen, plus this proposal when its rollout is new; lines from the Reflection whose auto line made the last move
are that move's evidence and never count again; (6) last, the load hold (p29-11, ADR 0051; p53-5, ADR 0083): a Tuning
of a LOAD_KEYS key that admits more work (score.py's admits()) waits while this Reflection's Time-lost ledger is
load-topped: a `parallel_ceiling` raise, `machine load tops the Time-lost ledger (<h> h of <total> h): a Parallel ceiling
raise waits (ADR 0051)`; a capacity_max raise or a Weight lower, `machine load tops the Time-lost ledger (<h> h of <total>
h): a <key> raise|lower waits (ADR 0051, ADR 0083)`; each fails closed with no ledger line, `no Time-lost ledger line for
Reflection <id>: run reflect.py ledger first`. ADR 0051's "when the ledger puts load above it" is read as its Verify's
"a load-topped ledger": load is the top of reflections.jsonl's `time-lost` line with `source: record` for this Reflection
(load_hold(); an audit line is never read: its hours never move the hold). Lowers other than a Weight's, round-cap
raises, a Weight raise (it admits less work) and every revert are never held by load. A capacity_max raise
(budget-count-raise) always carries score.py's caution, so (1) holds it first: it reaches Lachy as a held trade, and
the load hold covers it only should that caution lift. Each entry records `agreeing` (the proposal's own, score.py's count)
and `agreed` (the agreement). A held proposal prints `held <key>: <reason>` (`agreement <n> of 3`, say); with nothing
eligible it exits 0 and writes nothing. The write is --pick's, below, with the same checks.

--revert <tuning id> --repo <dir> --reflection <id> undoes an auto landing a later run finds breaching. revert_check()
passes only when the id is a non-voided auto line of this repo that is no revert and whose entry is not reverted yet;
rollouts.toml still holds the entry's `to` (a hand edit since is left alone); this score's `ranAt[key]` is that `to`,
in a window whose activeStart is after the auto line and that is not partial; and a breached Guardrail is among
score.py's RULE_EFFECTS risks for its rule. It lands to = the entry's `from` as one auto line with `reverts: <id>`, rule
`revert:<rule>` (so it never counts toward <rule>) and `agreeing` = score.py's agreeing() for that rule and the reverse
direction; it carries no `agreed`. An auto line that moved several keys is reverted one key per call. A revert is never
reverted, and never load-held: it restores a value the Mac already ran at. rollouts.toml's value now is now_values() of
resolve(), so a capacity_max or Weight landing is found as a round cap's is. A refusal is exit 2, nothing written.

Void lines (a replace failure, below) in --auto or --revert carry the same `auto` and `reflection`, never `close`.

--record-only writes ONE `tuning` line (applied: []) through run_record.emit and never reads or touches the
config: every Reflection leaves its scores as the next Reflection's baseline. A line's `scores` are score.py's
`headline` read through run_record.SCORE_KEYS (the v2 line's ten, p21-2: the old seven, then handsOffRate, quality
and reviewChurn), so a key a stale score.json lacks is recorded null. The `trade`, `caution`, `serves` and `risks` a
proposal carries are Lachy's to weigh before he picks: tune.py reads none of them, and a proposal carrying a trade or a
caution is as pickable as any other. With `repo: null` in the scores (no GitHub origin) it writes nothing, prints
`tune: not recorded: ...` on stderr and exits 0 (checked first, --close or not).

A serial score (`shape: serial`, skills/reflect/scripts/serial-score.py's, p24-4) is recorded only as a close line:
--record-only --close (else exit 2, nothing written), its line stamped `shape: serial` with `repo: null` (a chain has
no one repo, so the null-repo rule above never applies to it, and the line is never a baseline). --pick, --auto and
--revert refuse a serial score (exit 2, nothing written): it carries no proposals.

--close completion|supersede (with --record-only only; else exit 2, nothing written) stamps the line's `close`: the
close that wrote it (run_record.py's Close rule). One close line per rollout, checked after the null-repo check and
before any write, --dry-run included: close_line() reads tunings.jsonl, skips a line that does not parse and every
line another line's `voids` names, and a remaining `tuning` line for scores.rollout with a `close` means this run
prints `already recorded <id> (<close>) in <file>: nothing written` and exits 0. A tunings.jsonl that exists but
cannot be read prints `tune: tunings.jsonl cannot be read: ...` and exits 1, nothing written. A by-hand line (no
--close) is never checked and never blocks: only a close line blocks a close line. The check and the append take no
lock, so two closes racing on one rollout could both write (one lead closes a rollout, so it is not guarded).

--pick, checked before any write:
- every pick names an id in scores.proposals (a withheld or unknown id is refused; a repeated id counts once;
  two picks on one key are refused);
- the repo identity is rollout-settings.py's _origin_slug(--repo) (land.sh --origin-slug, its timeout and its
  process group), never resolve()'s `repo`, which is null when no repo table applies yet: so the first Tuning
  on a repo passes. No GitHub origin, an unreadable origin, or a slug other than scores.repo (ignoring case)
  is refused;
- each pick's key is one of rollout-settings.py's TUNING_KEYS (KEYS, capacity_max, weight_mem_gb, weight_cores,
  overtime_runs) and its from, to and ranAt are integers;
- the floor (p39-14, ADR 0070 d8; _apply, so --pick, --auto and --revert share it): a Tuning moves a key only between
  values >= 1, so an entry whose from, to or ranAt is below 1 is refused before any write, exit 2, `<id>: <key> moves by
  Tuning only between values >= 1 (0, no Overtime, is set by hand): nothing written` (FLOOR), rollouts.toml and
  tunings.jsonl untouched. Only overtime_runs has a MINIMUM of 0 (rollout-settings.py), so it is the one key the rule
  holds: `overtime_runs: 0` turns the Overtime off, the operator's hand edit;
- each pick's `from` equals resolve(repo=--repo, path=--config)'s value for its key now, now_values(): `settings` for
  KEYS, capacity_max and overtime_runs, `weight` for a Weight key (else a stale `from`);
- the key is not set in dotted or inline-table form (edit those by hand);
- a config rollout-settings refuses is refused (exit 3 when a present file needs tomllib and there is none).
The edit works on the config's realpath (a symlink keeps its link), line by line, one table per key (_edit_table):
a machine-wide key (rollout-settings.py's MACHINE_ONLY: capacity_max, p53-5) in `[defaults]`, every other key (KEYS, the
Weights and overtime_runs) in the repo's `[repo."owner/name"]` table (matched ignoring case). In it the edit replaces the value and
keeps a trailing comment, or inserts the key after the table's last key; with no table it appends `[defaults]`, or
`[repo."<scores.repo>"]`, at the end (a key set only under [defaults] still gets a repo entry: Tunings are per repo).
A table whose keys are set in dotted or inline-table form, or a `defaults` key with no `[defaults]` header, is refused
(edit it by hand). The schema (raise_schema(), a thin wrapper over
rollout-settings.py's raise_schema_lines()): when a picked key's
rollout-settings.py KEY_SCHEMA number is above the file's `schema` (its top-level line, else 1), the edit raises that
line to it, never lowers it: an existing top-level `schema` line (before the first table header) is rewritten in
place, keeping its comment; otherwise `schema = <N>` and a blank line go before the first table header (above the
comment lines directly over it), or before the appended repo block; a `schema` line in a form it will not edit is
refused (edit it by hand). With no newer key the text is exactly as before. The post-edit validation below is the
backstop: an edit that forgets the raise does not validate, and nothing is written. No file, or a comment-only one, is created
or appended to; a missing parent directory is created, and removed again when a failure leaves it empty. The
result goes to a temp file in the same directory and must resolve with each picked key at its `to` (a machine-wide
key from `file:defaults`, a repo one from `file:repo`, a Weight key in `weight`), every other rollout key, Weight part
and Guardrail unchanged, and every
repo's `inert_paths` (p29-3, ADR 0045: schedule's inert-paths.py `record` and `drop` are its only writers),
every repo's `test_credentials` (ADR 0063: declared on his ruling only, never a Tuning), every repo's `metered_keys`
(p56-6: the same rule) and the resolved `[defaults] test_logins` (p37-4: the operator's declared test Logins, declared
on his ruling only, never a Tuning) unchanged.

The reader check (rollout-settings.py's header: a writer that raises the schema runs it), only when the edit raises the
file's `schema`: a capacity_max Tuning raises it to 4, a Weight Tuning to 6 and an overtime_runs Tuning to 8 (p39-14), an
unattended --auto landing (and a --revert) included, since all three share _apply(). A pre-P29 reader refuses any top-level `schema` line, and a refused
file halts every rollout on the machine at its next `verify-timeout`, so before anything is written each live rollout's
engine root reads the temp file: inert-paths.py's reader_check() (its header has the rule: the live notes directly in
--tasks-dir, default ~/repos/obsidian/Work/Tasks, each engine root's own rollout-settings.py under `python3 -I -B`,
30 s), loaded lazily, its lines led `tune`. A refusal is exit 1, nothing written: one stderr line per note,
`tune: [[<slug>]] runs on <root>, whose rollout-settings.py refuses the new file (<why>): update that checkout to a P29+
release, or wait for the rollout to finish`, then `tune: nothing written: a live rollout's engine cannot read the raised
`schema` line`. There is no --force (a hand edit is the operator's). A missing tasks dir, an unreadable note or an
unusable snapshot is a `WARN: tune: ...` line on stderr, and the write goes on; a check that will not load is exit 1
(fail closed). With the schema not raised, no check runs. --dry-run runs it too.

Write order: (1) every check above, the reader check last; (2) ONE `tuning` line carrying every pick, through
run_record.emit(strict=True), its returned bool checked: one os.write, so tunings.jsonl gains the whole set
or nothing; (3) os.replace(temp, realpath).
- emit returns False (an unwritable events dir, a short write): the temp file goes, rollouts.toml was never
  touched, exit 1. emit refuses: the same, exit 2.
- os.replace fails after the line landed: the temp file goes and a compensating `tuning` line follows with
  `voids: <id>`, `applied: []` and the same scores (score.py drops a voided line's applied and keeps its
  scores); exit 1. If that line fails too, stderr says tunings.jsonl claims a Tuning rollouts.toml lacks.
--dry-run prints the diff and the line it would write, and writes nothing.

On success stdout names the line's id and file, then one line per Tuning: `applied <key> <from> → <to> for
<repo>: <effect>`, the effect TAKES_EFFECT for the four keys a rollout note stamps (`takes effect at the next
/thread:schedule (or --regenerate); a rollout note already stamped keeps its own values`) and TAKES_EFFECT_BY's for the
four no note stamps, read live (p53-5): capacity_max `takes effect at every rollout's next `next` call on this Mac,
whatever its repo (machine-wide, read live while a fresh Capacity reading is in force); no rollout note stamps it`, a
Weight key `takes effect at <repo>'s next `next` call or start, running rollouts included, for a kind with fewer than
3 measured tasks (read live); no rollout note stamps it`, overtime_runs `takes effect at <repo>'s next automatic retry,
running rollouts included (read live); schedule stamps it on no rollout note` (p39-14).

Exit codes: 0 applied, recorded, already recorded (a --close run whose rollout has its close line), not recorded
for a null repo, or nothing eligible under --auto (each `held` line printed); 1 a write failed (nothing applied, or the
line voided), the reader check refuses (or will not load), tunings.jsonl cannot be read for --close, --auto or
--revert, or reflections.jsonl cannot be read; 2
refused (usage, scores, picks, identity, a stale from, a refused or unvalidated config, a closed Reflection, a revert
revert_check refuses); 3 no tomllib for a present config.
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import importlib.util
import json
import os
import secrets
import stat
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(os.path.dirname(os.path.dirname(HERE)), "_shared", "scripts")
TAKES_EFFECT = ("takes effect at the next /thread:schedule (or --regenerate); a rollout note already stamped "
                "keeps its own values")
# p53-5: the keys no rollout note stamps take effect sooner, as reconcile-rollout.py reads them live: capacity_max at every
# `next` call (_capacity_state -> _machine_settings, per call), a Weight estimate per process (_weight_estimate through
# _root_resolved, at a `next` call or a start, leg.py's claim included). `%s` is the repo.
TAKES_EFFECT_BY = {
    "capacity_max": ("takes effect at every rollout's next `next` call on this Mac, whatever its repo (machine-wide, "
                     "read live while a fresh Capacity reading is in force); no rollout note stamps it"),
    "weight_mem_gb": ("takes effect at %s's next `next` call or start, running rollouts included, for a kind with fewer "
                      "than 3 measured tasks (read live); no rollout note stamps it"),
    "weight_cores": ("takes effect at %s's next `next` call or start, running rollouts included, for a kind with fewer "
                     "than 3 measured tasks (read live); no rollout note stamps it"),
    # p39-14 (ADR 0070 d8): execute's verdict resolves it at every `inputs` and `auto-retry` (_retry_budget).
    "overtime_runs": ("takes effect at %s's next automatic retry, running rollouts included (read live); schedule stamps "
                      "it on no rollout note"),
}
# The Tuning floor (p39-14, ADR 0070 d8): a Tuning moves a key only between values >= 1; overtime_runs, whose MINIMUM is
# 0, is the one key it holds. `%s` are the entry's name and key. _apply refuses with it, auto_check holds with it.
FLOOR = "%s moves by Tuning only between values >= 1 (0, no Overtime, is set by hand)"


def below_floor(entry) -> bool:
    """Whether a Tuning entry or proposal has a from, to or ranAt below 1 (FLOOR)."""
    return any(isinstance(entry.get(k), int) and entry[k] < 1 for k in ("from", "to", "ranAt"))
# Check (6)'s keys (p29-11, ADR 0051; p53-5, ADR 0083): a Tuning of one that admits more work (score.py's admits()) waits
# while load tops the Time-lost ledger.
LOAD_KEYS = ("parallel_ceiling", "capacity_max", "weight_mem_gb", "weight_cores")


def _load(name, path):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", os.path.join(SHARED, "run_record.py"))
RS = _load("thread_rollout_settings", os.path.join(SHARED, "rollout-settings.py"))
# score.py (python >= 3.8 too): RULE_EFFECTS for --revert, load_tunings() and agreeing() for --auto and --revert
SCORE = _load("thread_score", os.path.join(HERE, "score.py"))
CLOSES = RR.CLOSES  # completion | supersede: the close that wrote a line (run_record.py's Close rule)
AGREE = 3  # ADR 0037 d5: a knob lands once three Reflections agree (run_record.py's Agreement rule)
LOAD_HELD = "machine load tops the Time-lost ledger"  # check (6)'s reason (reflect.py's span lists these as its holds)


class Stop(Exception):
    def __init__(self, message, code):
        Exception.__init__(self, message)
        self.code = code


def say(line):
    sys.stderr.write("tune: %s\n" % line)


def new_id():
    now = datetime.datetime.now(datetime.timezone.utc)
    return "t-%s-%s" % (now.strftime("%Y%m%dT%H%M%SZ"), secrets.token_hex(3))


def read_scores(src):
    try:
        raw = sys.stdin.read() if src == "-" else open(os.path.expanduser(src), encoding="utf-8").read()
        doc = json.loads(raw)
    except (OSError, ValueError) as e:
        raise Stop("--scores %s cannot be read as JSON: %s" % (src, e), 2)
    if not isinstance(doc, dict) or not isinstance(doc.get("rollout"), str) or \
            not isinstance(doc.get("window"), dict) or not isinstance(doc.get("headline"), dict) or \
            not isinstance(doc.get("proposals"), list):
        raise Stop("--scores %s is not score.py's output (rollout, window, headline, proposals)" % src, 2)
    return doc


def is_serial(scores):
    return scores.get("shape") == "serial"


def line_fields(scores, applied, tid, voids=None, close=None, auto=None):
    """A tuning line's fields. `auto` is the weekly reading's stamp ({auto, reflection[, reverts]}), never with close.
    A serial score's line carries `shape: serial` (run_record.py's Serial rule)."""
    w = scores["window"]
    fields = {"id": tid, "repo": scores.get("repo"),
              "window": {k: w[k] for k in ("since", "until", "activeStart", "activeEnd", "partial") if k in w},
              "scores": {k: scores["headline"].get(k) for k in RR.SCORE_KEYS}, "applied": applied}
    binding = (scores.get("binding") or {}).get("constraint") if isinstance(scores.get("binding"), dict) else None
    if binding in RR.BINDINGS:
        fields["binding"] = binding
    if voids:
        fields["voids"] = voids
    if close:
        fields["close"] = close
    if auto:
        fields.update(auto)
    if is_serial(scores):
        fields["shape"] = "serial"
    return fields


def tunings_path():
    try:
        return os.path.join(RR.events_dir(), RR.TUNINGS + ".jsonl")
    except ValueError:
        return RR.TUNINGS + ".jsonl"


def close_line(rollout, path=None):
    """The rollout's close line: the first `tuning` line in tunings.jsonl for `rollout` (a slug, [[slug]] or note
    path) whose `close` is one of CLOSES and whose id no other line's `voids` names, else None. A line that does not
    parse is skipped; a missing file is None; a file that exists but cannot be read raises OSError. close-score.py
    calls it before any step, and record_only() before a --close write."""
    rollout = RR.normalise_slug(rollout, "rollout")
    path = path or tunings_path()
    try:
        f = open(path, "rb")
    except FileNotFoundError:
        return None
    rows = []
    with f:
        for raw in f:
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if isinstance(d, dict):
                rows.append(d)
    voided = {d["voids"] for d in rows if isinstance(d.get("voids"), str)}
    for d in rows:
        if d.get("kind") == "tuning" and d.get("rollout") == rollout and d.get("close") in CLOSES and \
                d.get("id") not in voided:
            return d
    return None


def reflections_path():
    """reflections.jsonl under run_record's events directory (ValueError when it cannot be resolved)."""
    return os.path.join(RR.events_dir(), RR.REFLECTIONS + ".jsonl")


def read_reflections(path=None):
    """reflections.jsonl's lines (dicts) in file order: a line that does not parse is skipped, a missing file is [],
    and a file that exists but cannot be read raises OSError."""
    path = path or reflections_path()
    try:
        f = open(path, "rb")
    except FileNotFoundError:
        return []
    out = []
    with f:
        for raw in f:
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if isinstance(d, dict):
                out.append(d)
    return out


def _ms(stamp):
    try:
        return SCORE.to_ms(stamp)
    except Exception:
        return None


def _moves(tunings, repo, key):
    """The non-voided tuning lines for `repo` (case ignored; any repo for a machine-wide key, score.py's same_repo(),
    p53-5: capacity_max is one value for every rollout on the Mac) with an applied entry on `key`: picks, auto landings
    and reverts alike (a close line's applied is [], so it never moves a key)."""
    return [d for d in tunings if not d["_voided"] and SCORE.same_repo(key, d["repo"], repo) and
            any(isinstance(e, dict) and e.get("key") == key for e in d.get("applied") or [])]


def agreement(scores, proposal, reflection, tunings, reflections):
    """The weekly agreement on a knob (run_record.py's Agreement rule), an int: the agreeing earlier knob lines plus
    one when this proposal's rollout is new."""
    repo, key = scores["repo"], proposal["key"]
    kid = RR.knob_key(repo, key, proposal["rule"], proposal["direction"])
    moves = _moves(tunings, repo, key)
    last = max(moves, key=lambda d: d["_t"]) if moves else None
    last_t = last["_t"] if last else None
    mover = last.get("reflection") if last and last.get("auto") is True else None
    closed = {d.get("id") for d in reflections if d.get("kind") == "reflection"}
    seen, agreeing = set(), 0
    for d in reflections:
        if d.get("kind") != "proposal" or d.get("altitude") != "knob" or d.get("id") != kid:
            continue
        r = d.get("reflection")
        if r == reflection or r not in closed or r == mover:
            continue
        t = _ms(d.get("ts"))
        if t is None or (last_t is not None and t <= last_t):
            continue
        rollouts = [x for x in d.get("rollouts") or [] if isinstance(x, str)]
        if any(x not in seen for x in rollouts):
            agreeing += 1
        seen.update(rollouts)
    return agreeing + (0 if scores["rollout"] in seen else 1)


def load_hold(proposal, reflection, reflections):
    """Check (6)'s reason for a proposal, or None: a Tuning of a LOAD_KEYS key that admits more work (score.py's
    admits(): a parallel_ceiling or capacity_max raise, a Weight lower; p53-5) is held while this Reflection's
    `time-lost` record line has `top: load` (ADR 0051's "a load-topped ledger"), and fails closed with no such line. Only
    `source: record` lines are read, never an audit's. A Weight raise, which admits less, is never held."""
    direction = proposal.get("direction")
    if not isinstance(direction, int) or isinstance(direction, bool):
        f, t = proposal.get("from"), proposal.get("to")
        direction = (t > f) - (t < f) if isinstance(f, int) and isinstance(t, int) else 0
    key = proposal.get("key")
    if key not in LOAD_KEYS or SCORE.admits(key, direction) <= 0:
        return None
    line = next((d for d in reflections if d.get("kind") == "time-lost" and d.get("source") == "record"
                 and d.get("reflection") == reflection), None)
    if line is None:
        return "no Time-lost ledger line for Reflection %s: run reflect.py ledger first" % reflection
    if line.get("top") != "load":
        return None
    h = line.get("hours") if isinstance(line.get("hours"), dict) else {}
    nums = [v for v in h.values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    load = h.get("load") if isinstance(h.get("load"), (int, float)) else 0

    def fmt(x):  # up to 3 places, no trailing zeros
        return ("%.3f" % x).rstrip("0").rstrip(".")
    if key == "parallel_ceiling":
        return "%s (%s h of %s h): a Parallel ceiling raise waits (ADR 0051)" % (LOAD_HELD, fmt(load), fmt(sum(nums)))
    return "%s (%s h of %s h): a %s %s waits (ADR 0051, ADR 0083)" % (
        LOAD_HELD, fmt(load), fmt(sum(nums)), key, "raise" if direction > 0 else "lower")


def auto_check(scores, proposal, reflection, tunings, reflections):
    """(ok, reason, agreed) for one of score.py's proposals under --auto: the first check that fails is the reason, in
    order (1) no trade and no caution, (2) no Guardrail breached and the window not partial, (3) ranAt == from, (4) no
    auto line of this Reflection has moved the key yet (a revert included), (5) agreement >= AGREE, (6) the load hold
    (load_hold(): a Tuning that admits more work, a ceiling or capacity_max raise or a Weight lower, waits on a
    load-topped Time-lost ledger, or on none). Between (3) and (4), the floor: a from, to or ranAt below 1 (FLOOR). `agreed` is the agreement once (5) is reached, else None. Pure: reflect.py's span calls it with the same reads, its ledger's record line appended."""
    if proposal.get("trade"):
        t = proposal["trade"]
        return False, "a trade (gains %s, costs %s): Lachy decides" % (
            ", ".join(t.get("gains") or []), ", ".join(t.get("costs") or [])), None
    if proposal.get("caution"):
        return False, "a caution: Lachy decides", None
    breached = sorted(k for k, v in (scores.get("guardrails") or {}).items() if isinstance(v, dict) and v.get("breached"))
    if breached:
        return False, "a Guardrail is breached (%s)" % ", ".join(breached), None
    if (scores.get("window") or {}).get("partial") is True:
        return False, "a partial window (the run's tail has not landed)", None
    if proposal.get("ranAt") != proposal.get("from"):
        return False, "from %s is not the value the run ran at (%s)" % (proposal.get("from"), proposal.get("ranAt")), None
    if below_floor(proposal):
        return False, FLOOR % proposal["key"], None
    for d in _moves(tunings, scores["repo"], proposal["key"]):
        if d.get("auto") is True and d.get("reflection") == reflection:
            return False, "Reflection %s already moved %s (%s)" % (reflection, proposal["key"], d.get("id")), None
    n = agreement(scores, proposal, reflection, tunings, reflections)
    if n < AGREE:
        return False, "agreement %d of %d" % (n, AGREE), n
    held = load_hold(proposal, reflection, reflections)
    if held:
        return False, held, n
    return True, None, n


def reverted(tunings):
    """{(auto line id, key)} every non-voided revert line undoes."""
    out = set()
    for d in tunings:
        if d["_voided"] or not isinstance(d.get("reverts"), str):
            continue
        for e in d.get("applied") or []:
            if isinstance(e, dict):
                out.add((d["reverts"], e.get("key")))
    return out


def now_values(resolved):
    """rollouts.toml's values now for every Tuning key, from rollout-settings.py's resolve() object: {key: value} for
    KEYS, capacity_max and overtime_runs (its `settings`) and each Weight key (its `weight` part, p53-5). A part missing or ill-typed is
    left out; it never raises. revert(), _apply()'s staleness check and reflect.py's Span.now_values read it."""
    out = {}
    if not isinstance(resolved, dict):
        return out
    s = resolved.get("settings") if isinstance(resolved.get("settings"), dict) else {}
    for k in RS.KEYS + ("capacity_max", "overtime_runs"):
        if isinstance(s.get(k), dict) and "value" in s[k]:
            out[k] = s[k]["value"]
    w = resolved.get("weight") if isinstance(resolved.get("weight"), dict) else {}
    for k in RS.WEIGHT_KEYS:
        part = w.get(k[len("weight_"):])
        if isinstance(part, dict) and "value" in part:
            out[k] = part["value"]
    return out


def revert_check(scores, tid, tunings, now_values):
    """(entry, None) for the first entry of auto line `tid` a revert may undo now, else (None, why). `now_values` is
    rollouts.toml's resolved {key: value} for the repo (now_values() of rollout-settings.py's resolve()). It passes
    only when the id is a non-voided auto line of this repo that is no revert, the entry is not reverted yet,
    rollouts.toml still holds its `to`, this score ran at that `to` (ranAt) in a window that started after the auto line
    and is not partial, and a breached Guardrail is among score.py's RULE_EFFECTS risks for its rule. An auto line that
    moved several keys is reverted one key per call."""
    line = next((d for d in tunings if d.get("id") == tid), None)
    if line is None:
        return None, "%s is no tuning line" % tid
    if line["_voided"] or line.get("auto") is not True:
        return None, "%s is not a standing auto line (only the weekly reading's own landing is reverted unasked)" % tid
    if isinstance(line.get("reverts"), str):
        return None, "%s is itself a revert: a revert is never reverted" % tid
    if line["repo"].lower() != (scores.get("repo") or "").lower():
        return None, "%s is %s's, but the scores are for %s" % (tid, line["repo"], scores.get("repo"))
    window = scores.get("window") or {}
    if window.get("partial") is True:
        return None, "a partial window (the run's tail has not landed)"
    start = _ms(window.get("activeStart"))
    if start is None or start <= line["_t"]:
        return None, "the scored run started before %s landed: it is no evidence against it" % tid
    breached = [k for k, v in (scores.get("guardrails") or {}).items() if isinstance(v, dict) and v.get("breached")]
    done, why = reverted(tunings), None
    for e in line.get("applied") or []:
        key = e.get("key")
        if (tid, key) in done:
            why = why or "%s's %s is already reverted" % (tid, key)
            continue
        if now_values.get(key) != e.get("to"):
            why = why or "rollouts.toml no longer holds %s's %s %s (it is %s now): a hand edit, left alone" % (
                tid, key, e.get("to"), now_values.get(key))
            continue
        if (scores.get("ranAt") or {}).get(key) != e.get("to"):
            why = why or "this run did not run at %s's %s %s (ran at %s)" % (tid, key, e.get("to"),
                                                                            (scores.get("ranAt") or {}).get(key))
            continue
        risks = SCORE.RULE_EFFECTS.get(e.get("rule"), SCORE.UNDECLARED_EFFECT)[1]
        hit = [k for k in breached if k in risks]
        if not hit:
            why = why or "no breached Guardrail is among %s's risks (breached: %s)" % (e.get("rule"),
                                                                                       ", ".join(breached) or "none")
            continue
        return dict(e, breached=hit), None
    return None, why or "%s applied nothing" % tid


def emit(scores, fields):
    """True written; False a write failure; Stop(2) refused."""
    try:
        return RR.emit(scores["rollout"], "tuning", fields=fields, strict=True)
    except RR.Refused as e:
        raise Stop("the run record refused the line: %s" % e, 2)


# ---- the config edit ---------------------------------------------------------------------------------------

_key_line_re = RS._key_line_re


def raise_schema(lines, need, current):
    """`lines` with the top-level `schema` raised to `need` when it is above `current` (the file's, else 1): the
    module docstring's schema rule, through rollout-settings.py's raise_schema_lines() (the one copy every writer of
    the file shares). Never lowers it; a Stop(2) for a schema line it will not edit."""
    try:
        return RS.raise_schema_lines(lines, need, current)
    except RS.SettingsError as e:
        raise Stop(str(e), 2)


def reader_check(new_file, tasks_dir):
    """The module docstring's reader check, run by _apply only when the edit raises the file's `schema`:
    inert-paths.py's reader_check() (its one copy, loaded here and only here), led `tune`. Its WARN lines go to stderr;
    a refusal prints its lines, then is a Stop(1), nothing written; a check that will not load is a Stop(1) too (fail
    closed)."""
    try:
        ip = _load("thread_inert_paths", os.path.join(SHARED, "inert-paths.py"))
        refusals, warns = ip.reader_check(new_file, tasks_dir or ip.ES.DEFAULT_TASKS_DIR, who="tune", force=False)
    except Exception as e:
        raise Stop("the reader check did not run (%s: %s): nothing written" % (type(e).__name__, e), 1)
    for line in warns + refusals:
        sys.stderr.write(line + "\n")
    if refusals:
        raise Stop("nothing written: a live rollout's engine cannot read the raised `schema` line", 1)


def _edit_table(lines, target, label, picks, written):
    """`lines` with each pick's key set to its `to` in the table `target` (("defaults",), or ("repo", slug), the slug
    matched ignoring case): replaced in place keeping a trailing comment, else inserted after the table's last key, else
    the table appended at the end. `label` is its header text, `written` whether the parsed config holds the table. A
    Stop(2) for a form it won't edit: the table's keys set in dotted or inline-table form, or held with no header."""
    def same(table):
        if len(table) != len(target) or table[0] != target[0]:
            return False
        return len(target) == 1 or table[1].lower() == target[1].lower()

    table, header, end, last_key = (), None, None, None
    keys_at = {}
    for i, line in enumerate(lines):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = RS._AOT_RE.match(s) or RS._TABLE_RE.match(s)
        if m:
            table = RS._segments(m.group(1))
            if header is not None and end is None:
                end = i
            if same(table):
                header = i
            continue
        m = RS._KEY_RE.match(s)
        if not m:
            continue
        segs = RS._segments(m.group(1))
        path = table + segs
        if path[0] != target[0]:
            continue
        if header is not None and end is None and len(segs) == 1:
            last_key = i
            keys_at[segs[0]] = i
        elif len(path) < len(target) or same(path[:len(target)]):
            raise Stop("%s is set in dotted or inline-table form in the config: edit it by hand" % label, 2)
    if written and header is None:
        raise Stop("%s is set in dotted or inline-table form in the config: edit it by hand" % label, 2)
    if header is not None:
        inserts = []
        for p in picks:
            i = keys_at.get(p["key"])
            if i is None:
                inserts.append("%s = %d" % (p["key"], p["to"]))
                continue
            m = _key_line_re(p["key"]).match(lines[i])
            if not m:
                raise Stop("cannot read the %s line in %s (line %d): edit it by hand" % (p["key"], label, i + 1), 2)
            lines[i] = m.group(1) + str(p["to"]) + m.group(3)
        if inserts:
            at = (last_key if last_key is not None else header) + 1
            lines[at:at] = inserts
    else:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(label)
        lines.extend("%s = %d" % (p["key"], p["to"]) for p in picks)
    return lines


def edit_text(text, slug, picks, doc):
    """The config text with each pick's key set to its `to`: a machine-wide key (rollout-settings.py's MACHINE_ONLY,
    capacity_max) in [defaults], every other in [repo."<slug>"] (_edit_table: a Stop(2) for a form it won't edit), and
    the file's `schema` raised for a newer key (raise_schema)."""
    lines = text.split("\n") if text else []
    trailing = bool(lines) and lines[-1] == ""
    if trailing:
        lines = lines[:-1]
    machine = [p for p in picks if p["key"] in RS.MACHINE_ONLY]
    per_repo = [p for p in picks if p["key"] not in RS.MACHINE_ONLY]
    if machine:
        lines = _edit_table(lines, ("defaults",), "[defaults]", machine, "defaults" in (doc or {}))
    if per_repo:
        repos = (doc or {}).get("repo") or {}
        written = next((k for k in repos if isinstance(k, str) and k.lower() == slug.lower()), None)
        lines = _edit_table(lines, ("repo", slug), "[repo.%s]" % json.dumps(written or slug), per_repo,
                            written is not None)
    need = max([RS.KEY_SCHEMA.get(("rollout", p["key"]), 1) for p in picks] or [1])
    lines = raise_schema(lines, need, RS.file_schema(doc or {}) or 1)
    return "\n".join(lines) + "\n"


def _repo_tables(path, key):
    """{repo key (lowered): its `key`} over every repo table of the file at `path` that sets it ({} for no file): a
    repo-only key no Tuning may touch (inert_paths, test_credentials, metered_keys). The machine-wide `test_logins`
    (p37-4) is compared on resolve()'s result instead, in _apply."""
    try:
        tables = RS.load_tables(path)
    except RS.SettingsError as e:
        raise Stop("the edit does not validate (%s): nothing written" % e, 2)
    return {slug: table[key] for slug, table in ((tables or {}).get("repo") or {}).items() if key in table}


class Created:
    """Directories made for the temp file, removed again (deepest first) when left empty by a failure."""

    def __init__(self, directory):
        self.directory = directory
        self.made = []

    def make(self):
        """mkdir each missing level, outermost first; an OSError leaves `made` holding the ones made, for undo."""
        d = self.directory
        missing = []
        while d and not os.path.exists(d):
            missing.append(d)
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
        for d in reversed(missing):
            os.mkdir(d)
            self.made.append(d)

    def undo(self):
        for d in reversed(self.made):
            try:
                os.rmdir(d)
            except OSError:
                pass


def _unlink(path):
    try:
        os.unlink(path)
    except OSError:
        pass


# ---- the verbs ---------------------------------------------------------------------------------------------

def record_only(scores, dry_run, close=None):
    serial = is_serial(scores)
    if serial and not close:
        raise Stop("a serial score is recorded only as its close line (--close completion): with no repo it is no "
                   "baseline for a by-hand Reflection", 2)
    if not serial and scores.get("repo") is None:
        say("not recorded: the scores carry no repo (no GitHub origin), so no baseline is kept")
        return 0
    if close:
        try:
            hit = close_line(scores["rollout"])
        except RR.Refused as e:
            raise Stop("the run record refused the line: %s" % e, 2)
        except OSError as e:
            say("tunings.jsonl cannot be read: %s: nothing written" % e)
            return 1
        if hit is not None:
            print("already recorded %s (%s) in %s: nothing written" % (hit.get("id"), hit.get("close"), tunings_path()))
            return 0
    tid = new_id()
    fields = line_fields(scores, [], tid, close=close)
    if dry_run:
        print("would record %s in %s: %s" % (tid, tunings_path(), json.dumps(fields, ensure_ascii=False)))
        return 0
    if not emit(scores, fields):
        say("nothing recorded: the Reflection's line could not be written (see run_record above)")
        return 1
    print("recorded %s in %s: no Tuning applied (%s)"
          % (tid, tunings_path(), "a serial chain's close line: never a baseline" if serial
             else "a baseline for the next Reflection on %s" % scores["repo"]))
    return 0


def _identity(scores, repo, flag):
    """The --repo checks every config write shares: a directory whose GitHub origin is scores.repo (ignoring case)."""
    if repo is None:
        raise Stop("%s needs --repo <dir> (the clone whose GitHub origin names the repo)" % flag, 2)
    repo = os.path.expanduser(repo)
    if not os.path.isdir(repo):
        raise Stop("--repo %s is not a directory" % repo, 2)
    if scores.get("repo") is None:
        raise Stop("the scores carry no repo: nothing can be tuned", 2)
    try:
        origin = RS._origin_slug(repo)
    except RS.SettingsError as e:
        raise Stop(str(e), 2)
    if origin is None:
        raise Stop("--repo %s has no GitHub origin (land.sh exit 4): nothing can be tuned" % repo, 2)
    if origin.lower() != scores["repo"].lower():
        raise Stop("--repo %s is %s, but the scores are for %s" % (repo, origin, scores["repo"]), 2)
    return repo


def _resolve(repo, config):
    config = os.path.expanduser(config or RS.default_path())
    try:
        return config, RS.resolve(repo=repo, path=config)
    except RS.SettingsError as e:
        raise Stop("rollout-settings: %s" % e, e.code)


def pick(scores, picks_arg, repo, config, dry_run, tasks_dir=None):
    ids = []
    for x in picks_arg.split(","):
        x = x.strip()
        if x and x not in ids:
            ids.append(x)
    if not ids:
        raise Stop("--pick names no proposal", 2)
    proposals = {p.get("id"): p for p in scores["proposals"] if isinstance(p, dict)}
    withheld = {p.get("id"): p for p in scores.get("withheld") or [] if isinstance(p, dict)}
    picks = []
    for i in ids:
        if i in withheld:
            raise Stop("%s is withheld (%s): it cannot be picked" % (i, withheld[i].get("reason")), 2)
        if i not in proposals:
            raise Stop("%s is no proposal in the scores (proposals: %s)" % (i, ", ".join(sorted(proposals)) or "none"), 2)
        picks.append(proposals[i])
    keys = [p.get("key") for p in picks]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise Stop("two picks on one key (%s): pick one" % ", ".join(dup), 2)
    for p in picks:
        if p.get("key") not in RS.TUNING_KEYS or not all(isinstance(p.get(k), int) for k in ("from", "to", "ranAt")):
            raise Stop("%s is not a well-formed proposal (key, from, to, ranAt)" % p.get("id"), 2)
    repo = _identity(scores, repo, "--pick")
    config, before = _resolve(repo, config)
    applied = [{"key": p["key"], "from": p["from"], "to": p["to"], "ranAt": p["ranAt"],
                "rule": str(p.get("rule"))[:64], "evidence": str(p.get("evidence"))[:300],
                "agreeing": p.get("agreeing") if isinstance(p.get("agreeing"), int) else 0} for p in picks]
    return _apply(scores, applied, [p["id"] for p in picks], repo, config, before, dry_run, tasks_dir=tasks_dir)


def _apply(scores, applied, names, repo, config, before, dry_run, auto=None, tasks_dir=None):
    """Land `applied` (tuning entries) in rollouts.toml and record them as ONE tuning line (pick, --auto and --revert
    share it): each entry's `from` must be the key's value now, then the edit, its validation, the reader check when
    the edit raises the file's `schema`, the line, the replace. The floor (FLOOR) is checked first, before any read."""
    for e, name in zip(applied, names):
        if below_floor(e):
            raise Stop("%s: %s: nothing written" % (name, FLOOR % e["key"]), 2)
    values = now_values(before)
    for e, name in zip(applied, names):
        now = values.get(e["key"])
        if now != e["from"]:
            raise Stop("%s's from is stale: %s is %s now, not %s (re-run the Reflection's score)"
                       % (name, e["key"], now, e["from"]), 2)
    real = os.path.realpath(config)
    try:
        text = open(real, encoding="utf-8").read() if os.path.exists(real) else ""
        read = RS._ladder().read_toml(config)
    except Exception as e:
        raise Stop("cannot read %s: %s" % (config, e), 2)
    picks = [{"key": e["key"], "to": e["to"]} for e in applied]
    new_text = edit_text(text, scores["repo"], picks, read[1] if read else None)
    created = Created(os.path.dirname(real))
    tmp = None
    try:
        created.make()
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(real), prefix="." + os.path.basename(real) + ".", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(new_text)
        mode = stat.S_IMODE(os.stat(real).st_mode) if os.path.exists(real) else 0o644
        os.chmod(tmp, mode)
        try:
            after = RS.resolve(repo=repo, path=tmp)
        except RS.SettingsError as e:
            raise Stop("the edit does not validate (%s): nothing written" % e, 2)
        picked = {p["key"]: p["to"] for p in picks}
        # every rollout key: a picked machine-wide one at its `to` from [defaults], a picked repo one from its repo
        # table, every other unchanged; and each Weight part the same way (p53-5)
        for k in RS.SETTING_KEYS:
            src = "file:defaults" if k in RS.MACHINE_ONLY else "file:repo"
            want = {"value": picked[k], "source": src} if k in picked else before["settings"][k]
            if after["settings"][k] != want:
                raise Stop("the edit resolves %s to %s, not %s: nothing written" % (k, after["settings"][k], want), 2)
        for k in RS.WEIGHT_KEYS:
            part = k[len("weight_"):]
            want = {"value": picked[k], "source": "file:repo"} if k in picked else before["weight"][part]
            if after["weight"][part] != want:
                raise Stop("the edit resolves %s to %s, not %s: nothing written" % (k, after["weight"][part], want), 2)
        if after["guardrails"] != before["guardrails"]:
            raise Stop("the edit changes the Guardrails: nothing written", 2)
        # p29-3 (ADR 0045), ADR 0063 and p56-6: a Tuning never touches any repo's Inert paths, test-credential class
        # or metered keys.
        for key in ("inert_paths", "test_credentials", "metered_keys"):
            if _repo_tables(tmp, key) != _repo_tables(config, key):
                raise Stop("the edit changes a repo's %s: nothing written" % key, 2)
        # p37-4: the declared test Logins are declared on his ruling only (machine-wide, [defaults]): no Tuning moves
        # them.
        if after.get("test_logins") != before.get("test_logins"):
            raise Stop("the edit changes test_logins: nothing written", 2)
        if after["schema"]["file"] > before["schema"]["file"]:
            reader_check(tmp, tasks_dir)
        tid = new_id()
        fields = line_fields(scores, applied, tid, auto=auto)
        if dry_run:
            diff = difflib.unified_diff(text.splitlines(True), new_text.splitlines(True), config, config + " (tuned)")
            sys.stdout.write("".join(diff))
            print("would record %s in %s: %s" % (tid, tunings_path(), json.dumps(fields, ensure_ascii=False)))
            _unlink(tmp)
            created.undo()
            return 0
        if not emit(scores, fields):
            raise Stop("nothing applied: the Reflection's line could not be written (see run_record above); "
                       "rollouts.toml is unchanged", 1)
        try:
            os.replace(tmp, real)
        except OSError as e:
            _unlink(tmp)
            created.undo()
            vid = new_id()
            ok = False
            void_auto = {k: v for k, v in (auto or {}).items() if k in ("auto", "reflection")}  # never reverts
            try:
                ok = RR.emit(scores["rollout"], "tuning", fields=line_fields(scores, [], vid, voids=tid, auto=void_auto))
            except Exception:
                ok = False
            if not ok:
                say("the void line could not be written either: tunings.jsonl claims %s applied, but "
                    "rollouts.toml lacks it" % tid)
            raise Stop("rollouts.toml was not written (%s): nothing applied%s" % (e, "; %s voided by %s" % (tid, vid)
                                                                                 if ok else ""), 1)
    except Stop:
        if tmp:
            _unlink(tmp)
        created.undo()
        raise
    except OSError as e:
        if tmp:
            _unlink(tmp)
        created.undo()
        raise Stop("cannot write next to %s: %s" % (real, e), 1)
    print("recorded %s in %s" % (tid, tunings_path()))
    for a in applied:
        effect = TAKES_EFFECT_BY.get(a["key"], TAKES_EFFECT)
        print("applied %s %d → %d for %s: %s" % (a["key"], a["from"], a["to"], scores["repo"],
                                                 effect % scores["repo"] if "%s" in effect else effect))
    return 0


def _reflection_open(reflection):
    """reflections.jsonl's lines, once --reflection is known to have no `reflection` (close) line yet."""
    try:
        lines = read_reflections()
    except ValueError as e:
        raise Stop("cannot resolve the events directory: %s" % e, 1)
    except OSError as e:
        raise Stop("reflections.jsonl cannot be read: %s: nothing written" % e, 1)
    if any(d.get("kind") == "reflection" and d.get("id") == reflection for d in lines):
        raise Stop("Reflection %s is closed: nothing written" % reflection, 2)
    return lines


def _tunings():
    try:
        return SCORE.load_tunings(RR.events_dir())
    except ValueError as e:
        raise Stop("cannot resolve the events directory: %s" % e, 1)
    except OSError as e:
        raise Stop("tunings.jsonl cannot be read: %s: nothing written" % e, 1)


def auto(scores, repo, reflection, config, dry_run, tasks_dir=None):
    """--auto: land every proposal that passes auto_check, as ONE auto line; print `held <key>: <reason>` for the rest."""
    reflections = _reflection_open(reflection)
    repo = _identity(scores, repo, "--auto")
    tunings = _tunings()
    land, keys = [], set()
    for p in scores["proposals"]:
        if not isinstance(p, dict) or p.get("key") not in RS.TUNING_KEYS or \
                not all(isinstance(p.get(k), int) for k in ("from", "to", "ranAt", "direction")):
            print("held %s: not a well-formed proposal (key, from, to, ranAt, direction)" % (p.get("key") if isinstance(p, dict) else p))
            continue
        ok, reason, agreed = auto_check(scores, p, reflection, tunings, reflections)
        if ok and p["key"] in keys:
            ok, reason = False, "another proposal on %s lands first" % p["key"]
        if not ok:
            print("held %s: %s" % (p["key"], reason))
            continue
        keys.add(p["key"])
        land.append((p, agreed))
    if not land:
        return 0
    config, before = _resolve(repo, config)
    applied = [{"key": p["key"], "from": p["from"], "to": p["to"], "ranAt": p["ranAt"], "rule": str(p.get("rule"))[:64],
                "evidence": str(p.get("evidence"))[:300],
                "agreeing": p.get("agreeing") if isinstance(p.get("agreeing"), int) else 0, "agreed": n} for p, n in land]
    return _apply(scores, applied, [p["id"] for p, _n in land], repo, config, before, dry_run,
                  auto={"auto": True, "reflection": reflection}, tasks_dir=tasks_dir)


def revert(scores, tid, repo, reflection, config, dry_run, tasks_dir=None):
    """--revert <tid>: undo one key of an auto line that this run finds breaching a Guardrail its rule risks."""
    _reflection_open(reflection)
    repo = _identity(scores, repo, "--revert")
    tunings = _tunings()
    config, before = _resolve(repo, config)
    e, why = revert_check(scores, tid, tunings, now_values(before))
    if e is None:
        raise Stop("%s is not reverted: %s: nothing written" % (tid, why), 2)
    direction = 1 if e["to"] > e["from"] else -1
    rule = ("revert:%s" % e.get("rule"))[:64]
    entry = {"key": e["key"], "from": e["to"], "to": e["from"], "ranAt": e["to"], "rule": rule,
             "evidence": ("revert %s: breaches %s, which %s risks" % (tid, ", ".join(e["breached"]), e.get("rule")))[:300],
             "agreeing": SCORE.agreeing(tunings, scores["repo"], e["key"], rule, -direction)}
    return _apply(scores, [entry], ["%s's %s" % (tid, e["key"])], repo, config, before, dry_run,
                  auto={"auto": True, "reflection": reflection, "reverts": tid}, tasks_dir=tasks_dir)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        say(message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="tune.py", description="Apply a Reflection's picked Tunings to rollouts.toml and record the Reflection.")
    p.add_argument("--scores", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--pick")
    g.add_argument("--record-only", action="store_true")
    g.add_argument("--auto", action="store_true")
    g.add_argument("--revert", metavar="TUNING_ID")
    p.add_argument("--close", choices=CLOSES)
    p.add_argument("--reflection")
    p.add_argument("--repo")
    p.add_argument("--config")
    p.add_argument("--tasks-dir")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    if a.close and not a.record_only:
        say("--close needs --record-only")
        return 2
    weekly = a.auto or a.revert is not None
    if weekly and not a.reflection:
        say("--auto and --revert need --reflection <id> (the weekly reading's)")
        return 2
    if a.reflection is not None and not weekly:
        say("--reflection goes with --auto or --revert only")
        return 2
    if weekly and not RR.REFLECTION_ID_RE.match(a.reflection):
        say("--reflection %s is no r- id" % a.reflection)
        return 2
    try:
        scores = read_scores(a.scores)
        if is_serial(scores) and not a.record_only:
            raise Stop("a serial score proposes no Tuning: --pick, --auto and --revert take a parallel score only", 2)
        if a.record_only:
            return record_only(scores, a.dry_run, a.close)
        if a.auto:
            return auto(scores, a.repo, a.reflection, a.config, a.dry_run, a.tasks_dir)
        if a.revert is not None:
            return revert(scores, a.revert, a.repo, a.reflection, a.config, a.dry_run, a.tasks_dir)
        return pick(scores, a.pick, a.repo, a.config, a.dry_run, a.tasks_dir)
    except Stop as e:
        say(str(e))
        return e.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
