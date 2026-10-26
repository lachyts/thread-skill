#!/usr/bin/env python3
"""The estate pass's ranker, and the snooze record's one writer and reader (ADR 0041; CONTEXT.md **Readiness grade**,
**Review load**, **Unpark offer**, **Ranked slate**).

Scripts scan, the model decides: estate-scan.py lists the estate, the per-project grading agents give each gradeable
task a Readiness grade (skills/_shared/readiness-grade.md is their brief and this script's prose contract), and this
script does the deterministic rest. It validates and normalises the grades and applies the raise, flags dependency
holds, ranks, groups candidate runs with their Review load, orders the decision rounds, lists the Orient projects and
yields the Unpark offers. It spawns nothing and asks nothing. python >= 3.9 with PyYAML. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py rank --scan FILE|- --grades FILE
        [--grades FILE]... [--superseding PRIOR] [--today YYYY-MM-DD] [--vault PATH] [--compact]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py snooze <project> (--ready N | --clear)
        [--today YYYY-MM-DD] [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py unpark <project> [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py kill <project> [--today YYYY-MM-DD]
        [--vault PATH]

Defaults: rank takes today and the vault from the scan JSON's `today` and `vault`; snooze, unpark and kill take the
local date and ~/repos/obsidian. `rank` writes nothing: it reads the scan, the grades files and, for each parked
project, its note's snooze keys. `snooze` writes two frontmatter keys on one project note, or with --clear removes
them; `unpark` and `kill` are the Unpark offer's other two writes (readiness-grade.md § The Unpark offer), each one
save of one project note. No subprocess, no network, no bytecode (sys.dont_write_bytecode is set before any sibling
loads). Exit 0 when done (every per-task problem is inside the JSON); 2 on a usage error or a refusal (one
`estate-rank:` stderr line, nothing written): a scan that is not JSON or whose `schema` is not 1, a grades file that
is not JSON or not an object or array, an unknown verb or flag, and every snooze, unpark and kill refusal; 3 when the
vault, PyYAML or a sibling script is missing.

What it reuses. Loaded by path inside main(), so importing this file runs nothing (the contract test reads its
constants that way): resolve-target.py (RT: dead_why), and through it next-action.py (RT.NA: Vault, resolve_project,
Note with its edited and save, status_of, Refused, and the ODD_BREAKS, LOADER and yaml its edit reads by);
estate-scan.py (ES: as_date, jsonable, STANDING_RANK, standing_of and still_to_start), so the estate pass keeps one
frontmatter reader, one date reader, one status-to-standing rule and one statement of § In flight's exception.

The inputs:
- The scan: estate-scan.py's schema 1. Read: tasks {slug, note, title, statusClass, inFlight, projects, due,
  dependsOn}; projects {name, note, standing, repos}; repos {path, declared, rolloutRoot, blockers, unchecked};
  today, vault, deadlineHit, vaultErrors. Standing is only ever the row's `standing` (crowned means `standing ==
  "crowned"`); the row's `crowned` field is the raw `crowned:` date, never read.
- The grades: each --grades file holds one object {project, tasks: [...]} or an array of them, each task entry
  keyed by `slug` (readiness-grade.md § Output). A slug matches an open scan task case-insensitively. Grades for an
  unknown slug, or for a task that is not gradeable, are warned and ignored. Two entries for one slug: the one whose
  file `project` is the task's home wins, else the first by file and position; the rest are warned.

Gradeable: a scan task with statusClass `active`, inFlight false and a live project. Its home is projects[0], mapped to
the first scan project row of that name (a second row of the name is warned). The rest are `skipped`, the first reason
that fits: `unhomed`, `in flight`, `hold`. The one exception, at schedule's Pre-flight on a supersede (schedule § 1.5,
ADR 0047): with --superseding PRIOR, a task the scan marks inFlight is read as not in flight when ES.still_to_start
holds for it (its status, as NA.status_of reads the row, `open`, and its `rollout:` naming PRIOR under slug_key's
fold): a carried task still queued is graded, and holds its dependants by its grade; one that has started stays in
flight. Without it (orient-all) the scan's inFlight stands.

Validation. Invalid (listed with every error, never ranked): a grade outside GRADES (read case-insensitively, `-` and
`_` as spaces) or a shape outside SHAPES; `decisions` that is not a list; a One call or Grill with no decision; a
decision that is not an object, or has no non-empty `question` or `recommendation`, or whose `options` is missing, not
a list, or not OPTIONS_MIN to OPTIONS_MAX distinct non-empty strings, or does not hold the recommendation (compared
stripped and case-insensitively). A decision's optional `fork` (the open fork it answers, worded as its orient end
line words it) is passed through when it is a non-empty string, and left out otherwise. Warned and kept: a missing or
unknown `size` reads as M; a missing or unknown decision `confidence` as low; a malformed `deadline`, or one before
today (an event already past cannot be met; the scan's overdue `due:` still counts), is dropped; a gate kind outside
GATE_KINDS is dropped; a non-boolean `eyeCheck` reads as false; a `repo` on a task that is not parallel is ignored.

The raise (readiness-grade.md § The raise): the decision count implies a grade (0 Ready, 1 One call, 2+ Grill) and the
task takes the higher of that and the agent's grade (`why: "decisions"`); then any `low` decision raises it one step
(`why: "confidence"`); Orient stays Orient.

Figures: agentMinutes = SIZE_MINUTES[size]; decisionMinutes = DECISION_MINUTES[grade] per decision (0 for Ready and
Orient); review {pr: 1 for a parallel task, signOff: 1 with any gate, eyeCheck: 1 when set, minutes}; attentionMinutes =
decision + review minutes, plus agentMinutes for a session task; leverage = agentMinutes / max(ATTENTION_FLOOR,
attentionMinutes), sorted exact and printed to 2 places; deadline = the earlier of the scan row's `due` (ES.as_date)
and the grade's `deadline.date`, with its source; dueSoon = deadline <= today + DUE_SOON_DAYS.

Holds (readiness-grade.md § Dependencies): each `dependsOn` entry is cut to its basename (no `.md`) and matched to an
open scan task by slug, case-insensitively; no match is satisfied. A matched d holds a graded task t that is not
Orient unless d is in flight, or d is graded Ready, is not held itself and is not in a parked project other than t's
home. The why (HOLD_WHYS): `cycle` when d reaches t through the dependency edges (d == t included), else d's skip
reason (`hold`, `unhomed`), `invalid`, `ungraded`, d's grade, `parked`, or `held`. Holds never change a rank.

The ranking key (readiness-grade.md § The ranking): parked homes last; dueSoon first, the earliest deadline first;
crowned homes first; leverage, highest first; ES.STANDING_RANK of the home; home name, home note, slug. `rank` counts
from 1 over the graded tasks other than Orient; Orient tasks follow with rank null, by home then slug.

Output, one JSON object (schema 1; --compact for one line):
  schema, today, scan {today, vault, deadlineHit, vaultErrors (a count)},
  counts {gradeable, graded, ranked, orient, held, ungraded, invalid, skipped, runs, decisions, decisionMinutes, unpark,
          offers, warnings},
  tasks[]     {slug, note, title, home, projects[], standing, grade, agentGrade, raised[] {from, to, why}, shape, repo,
               root, size, agentMinutes, decisions[] {question, recommendation, options[] (the recommendation first),
               confidence, why, fork?}, decisionMinutes, review {pr, signOff, eyeCheck, minutes}, attentionMinutes,
               leverage, deadline {date, source: due|grader, why} | null, dueSoon, gates[], eyeCheck, why, dependsOn[],
               blockedBy[] {slug, why}, rank, run}: ranked in rank order, then Orient;
  runs[]      {id (<home>/<shape>/<root or ->), project, note, shape, root, rolloutRoot, why (repo unknown | no repo
               declared | null), parked, ready[], waiting[], blocked[] (slugs in rank order), agentMinutes,
               decisionMinutes, review {pr, signOff, eyeCheck, minutes}, attentionMinutes, leverage, blockers[],
               unchecked[] (the scan repo row's, verbatim), sameRoot[] (other parallel run ids on the root), rank (the
               best of ready and waiting, null when all are blocked)}, by rank (nulls last) then id. Parallel and
               serial tasks other than Orient only, grouped by (home, shape, root); a serial run's root is null;
  decisions[] {slug, home, round (one-call | grill), grade, minutes, cumulativeMinutes, decisions[], blockedBy[]}: the
               One calls in rank order, then the Grills, parked homes' tasks left out;
  orient[]    {project, note, tasks[]}: the Orient tasks by home, by project name, parked homes left out (their work
               waits on the Unpark offer, as in decisions[]); counts.orient counts every Orient task, parked included;
  unpark[]    {project, note, ready, readyTasks[], offer, why, snooze {until, ready} | null, options[] (unpark, snooze,
               kill; only when offered), snoozeWrite {snoozed_until, snoozed_ready}}: each parked project with a home
               task graded Ready and not held, by name. It is snoozed while today < snoozed_until and the Ready count is
               at most snoozed_ready (a missing snoozed_ready: date only);
  skipped[]   {slug, why}, ungraded[] {slug, home, why: "no grade"}, invalid[] {slug, home, errors[]}, by slug;
  warnings[]  one line each, in the order found.

snooze <project> --ready N: the project by name or vault path (next-action's resolve_project); refused unless it is a
live project (RT.dead_why) whose ES.standing_of(status) is parked, with N an integer >= 0. It sets `snoozed_until:
"<today + SNOOZE_DAYS>"` and `snoozed_ready: N` through next-action's one-key edit, re-parses (the frontmatter must be
the old one plus the two keys), writes the note in place once and prints `snoozed <note> until <date> (ready <N>)`.

snooze <project> --clear: removes the record, so a project parked again later starts with no snooze; unpark and kill
make the same removal, through the same `cleared`, in the save that writes their status. Any live project, parked or
not; refused when dead or when its frontmatter does not parse. It removes every SNOOZE_KEYS entry (a key given twice
included), re-parses (the frontmatter must be the old one minus those keys, else refused), writes the note in place
once and prints `cleared the snooze on <note>`; a note with neither key is left untouched, `no snooze on <note>`, exit
0.

unpark <project>: refused unless the project is live and its ES.standing_of(status) is parked. One save: every
SNOOZE_KEYS entry removed (`cleared`) and `status: "queued"` set through next-action's one-key edit, re-parsed (the
frontmatter must be the old one minus the snooze keys, with status queued, else refused); prints `unparked <note>
(status: queued)`.

kill <project>: the Unpark offer's kill is Mark done (the vault's _System/Scripts/mark-project-done.js): the same
checks as unpark, and an umbrella refused as that script refuses it (a folder note, `<dir>/<dir>.md` below
Work/Projects, beside a live project note anywhere under its folder outside Archive/: the sweep archives a done
folder note's whole folder). One save: every SNOOZE_KEYS entry and `crowned` removed, `done: true` and `completed:
"<today>"` set, re-parsed the same way; prints `killed <note> (done: true, completed <today>)`. The nightly sweep
archives it; its open tasks are left unhomed, which the question names.
"""
import argparse
import datetime
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
RESOLVE_TARGET_PY = os.path.join(HERE, "resolve-target.py")
ESTATE_SCAN_PY = os.path.join(HERE, "estate-scan.py")

SCHEMA = 1
SCAN_SCHEMA = 1
VAULT_DEFAULT = "~/repos/obsidian"
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")

# The tunable constants: readiness-grade.md § The ranking's table pins each one
# (tests/contracts/readiness-grade.test.mjs).
GRADES = ("Ready", "One call", "Grill", "Orient")
SHAPES = ("parallel", "serial", "session")
SIZE_MINUTES = {"S": 30, "M": 120, "L": 480}
DECISION_MINUTES = {"One call": 1, "Grill": 2}
REVIEW_MINUTES = {"pr": 2, "signOff": 1, "eyeCheck": 3}
ATTENTION_FLOOR = 1
OPTIONS_MIN, OPTIONS_MAX = 2, 4
DUE_SOON_DAYS = 14
SNOOZE_DAYS = 14
SNOOZE_KEYS = ("snoozed_until", "snoozed_ready")
GATE_KINDS = ("spend", "credential", "irreversible")
CONFIDENCE = ("high", "medium", "low")
# Every `blockedBy` why, each named in readiness-grade.md § Dependencies.
HOLD_WHYS = ("One call", "Grill", "Orient", "ungraded", "invalid", "hold", "unhomed", "parked", "held", "cycle")
UNPARK_OPTIONS = ("unpark", "snooze", "kill")
KILL_KEYS = ("crowned",)  # mark-project-done.js drops a crowned: stamp with the done write
ROUNDS = (("one-call", "One call"), ("grill", "Grill"))
GRADE_RANK = {g: i for i, g in enumerate(GRADES)}


def fail(code, reason):
    sys.stderr.write("estate-rank: %s\n" % reason)
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


def _load(name, path):
    """A sibling script as a module, by path (resolve-target.py's _load)."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_siblings():
    out = []
    for name, path in (("thread_resolve_target", RESOLVE_TARGET_PY), ("thread_estate_scan", ESTATE_SCAN_PY)):
        try:
            out.append(_load(name, path))
        except SystemExit:  # resolve-target's own exit 3 (next-action.py would not load), already on stderr
            fail(3, "cannot load %s" % path)
        except Exception as e:
            fail(3, "cannot load %s: %s" % (path, e))
    RT, ES = out
    if RT.NA.yaml is None:
        fail(3, "PyYAML is required: python3 -m pip install pyyaml")
    return RT, ES


# ---- values ------------------------------------------------------------------------------------------------------

def shown(v):
    return json.dumps(v, ensure_ascii=False, default=str)


def text(v):
    """A non-empty stripped string, else None."""
    return v.strip() if isinstance(v, str) and v.strip() else None


def canon_grade(v):
    if not isinstance(v, str):
        return None
    k = re.sub(r"[\s_-]+", " ", v).strip().lower()
    return next((g for g in GRADES if g.lower() == k), None)


def slug_key(link):
    """A dependency link or a graded slug, as the lower-case basename it names (`[[Work/Tasks/X|a]]` -> `x`).
    estate-scan.py's _link_key is the same fold, written there for still_to_start; tests/estate-scan.test.mjs 18 pins
    the two alike."""
    s = str(link).strip()
    if s.startswith("[[") and s.endswith("]]"):
        s = s[2:-2]
    s = s.split("|")[0].split("#")[0].strip().replace("\\", "/").rstrip("/")
    s = s.rsplit("/", 1)[-1]
    if s.lower().endswith(".md"):
        s = s[:-3]
    return s.strip().lower()


def parse_date(raw, flag):
    try:
        if not ISO_DATE.fullmatch(raw):
            raise ValueError
        return datetime.date.fromisoformat(raw)
    except ValueError:
        fail(2, "%s must be a date, YYYY-MM-DD: %r" % (flag, raw))


def read_json(path, what):
    try:
        if path == "-":
            raw = sys.stdin.read()
        else:
            with open(path, encoding="utf-8") as fh:
                raw = fh.read()
    except (OSError, UnicodeDecodeError) as e:
        fail(2, "cannot read the %s %s: %s" % (what, path, getattr(e, "strerror", None) or e))
    try:
        return json.loads(raw)
    except ValueError as e:
        fail(2, "the %s %s is not JSON: %s" % (what, path, e))


def read_scan(path):
    scan = read_json(path, "scan")
    if not isinstance(scan, dict):
        fail(2, "the scan %s is not an object" % path)
    schema = scan.get("schema")
    if isinstance(schema, bool) or schema != SCAN_SCHEMA:
        fail(2, "the scan %s has schema %s; this ranker reads schema %d" % (path, shown(schema), SCAN_SCHEMA))
    for key in ("projects", "tasks", "repos"):
        if not isinstance(scan.get(key), list):
            fail(2, "the scan %s has no %s list" % (path, key))
    return scan


def read_grades(path):
    data = read_json(path, "grades file")
    if not isinstance(data, (dict, list)):
        fail(2, "the grades file %s is not an object or array" % path)
    return data


# ---- the ranking ---------------------------------------------------------------------------------------------------

class Ranker:
    def __init__(self, RT, ES, scan, today, vault_root, grade_files, superseding=None):
        self.RT, self.ES, self.NA = RT, ES, RT.NA
        self.scan, self.today, self.vault_root = scan, today, vault_root
        self.grade_files = grade_files
        self.superseding = superseding
        self.warnings = []
        self._vault = None
        self._reach = {}

    def warn(self, line):
        self.warnings.append(line)

    def vault(self):
        if self._vault is None:
            self._vault = self.NA.Vault(self.vault_root)
        return self._vault

    # ---- the scan ------------------------------------------------------------------------------------------------

    def index(self):
        ES = self.ES
        self.projects = {}
        for p in self.scan["projects"]:
            if not isinstance(p, dict) or not isinstance(p.get("name"), str):
                continue
            first = self.projects.get(p["name"])
            if first is not None:
                self.warn("two projects are named %s (%s, %s); their tasks home to the first"
                          % (p["name"], first.get("note"), p.get("note")))
                continue
            self.projects[p["name"]] = p
        self.tasks, self.lower, self.inflight = {}, {}, {}
        for t in self.scan["tasks"]:
            if not isinstance(t, dict) or not isinstance(t.get("slug"), str) or t["slug"] in self.tasks:
                continue
            self.tasks[t["slug"]] = t
            self.lower.setdefault(t["slug"].lower(), t["slug"])
            # The module docstring's Gradeable exception: a carried task still queued, at schedule's Pre-flight.
            self.inflight[t["slug"]] = bool(t.get("inFlight")) and not ES.still_to_start(
                self.NA.status_of(t), t.get("rollout"), self.superseding)
        self.skip, self.home = {}, {}
        for slug in sorted(self.tasks):
            t = self.tasks[slug]
            projects = [x for x in (t.get("projects") or []) if isinstance(x, str)]
            if not projects or projects[0] not in self.projects:
                self.skip[slug] = "unhomed"
            elif self.inflight[slug]:
                self.skip[slug] = "in flight"
            elif t.get("statusClass") != "active":
                self.skip[slug] = "hold"
            else:
                self.home[slug] = self.projects[projects[0]]
        self.edges = {}
        for slug, t in self.tasks.items():
            out = []
            for link in t.get("dependsOn") or []:
                d = self.lower.get(slug_key(link))
                if d is not None and d not in out:
                    out.append(d)
            self.edges[slug] = out
        self.standing_rank = ES.STANDING_RANK

    def standing(self, project):
        s = project.get("standing")
        return s if s in self.standing_rank else "none"

    # ---- the grades ----------------------------------------------------------------------------------------------

    def entries(self):
        """{slug: (file project, entry, where)} for the winning entry of each gradeable slug."""
        by_slug = {}
        for path, data in self.grade_files:
            items = data if isinstance(data, list) else [data]
            for i, item in enumerate(items, 1):
                where = "%s item %d" % (path, i) if isinstance(data, list) else path
                if not isinstance(item, dict):
                    self.warn("%s is not an object; ignored" % where)
                    continue
                tasks = item.get("tasks")
                if not isinstance(tasks, list):
                    self.warn("%s has no tasks list; ignored" % where)
                    continue
                for k, e in enumerate(tasks, 1):
                    at = "%s task %d" % (where, k)
                    raw = text(e.get("slug")) if isinstance(e, dict) else None
                    if raw is None:
                        self.warn("%s has no slug; ignored" % at)
                        continue
                    slug = self.lower.get(slug_key(raw))
                    if slug is None:
                        self.warn("grade for %s (%s): no open task has that slug; ignored" % (raw, at))
                    elif slug not in self.home:
                        self.warn("grade for %s (%s): the task is %s, never graded; ignored"
                                  % (slug, at, self.skip[slug]))
                    else:
                        by_slug.setdefault(slug, []).append((item.get("project"), e, at))
        chosen = {}
        for slug, cands in by_slug.items():
            home = self.home[slug]["name"]
            pick = next((c for c in cands if c[0] == home), cands[0])
            for c in cands:
                if c is not pick:
                    self.warn("grade for %s (%s): a second grade; the one at %s is used" % (slug, c[2], pick[2]))
            chosen[slug] = pick
        return chosen

    def decision(self, i, d, warns, slug):
        at = "decision %d" % i
        if not isinstance(d, dict):
            return None, ["%s is not an object" % at]
        errs = []
        question, rec = text(d.get("question")), text(d.get("recommendation"))
        if question is None:
            errs.append("%s: no question" % at)
        if rec is None:
            errs.append("%s: no recommendation" % at)
        opts, labels = d.get("options"), None
        if opts is None:
            errs.append("%s: no options" % at)
        elif not isinstance(opts, list):
            errs.append("%s: options is not a list" % at)
        else:
            good = True
            if not OPTIONS_MIN <= len(opts) <= OPTIONS_MAX:
                errs.append("%s: needs %d to %d options, has %d" % (at, OPTIONS_MIN, OPTIONS_MAX, len(opts)))
                good = False
            clean, seen = [], set()
            for j, o in enumerate(opts, 1):
                label = text(o)
                if label is None:
                    errs.append("%s: option %d is empty" % (at, j))
                    good = False
                elif label.casefold() in seen:
                    errs.append('%s: option "%s" is given twice' % (at, label))
                    good = False
                else:
                    seen.add(label.casefold())
                    clean.append(label)
            labels = clean if good else None
        pick = None
        if labels is not None and rec is not None:
            pick = next((n for n, o in enumerate(labels) if o.casefold() == rec.casefold()), None)
            if pick is None:
                errs.append('%s: recommendation "%s" is not one of its options' % (at, rec))
        if errs:
            return None, errs
        conf = d.get("confidence")
        level = conf.strip().lower() if isinstance(conf, str) else None
        if level not in CONFIDENCE:
            warns.append("%s %s: confidence %s is not high, medium or low; read as low" % (slug, at, shown(conf)))
            level = "low"
        out = {"question": question, "recommendation": labels[pick],
               "options": [labels[pick]] + labels[:pick] + labels[pick + 1:],
               "confidence": level, "why": text(d.get("why"))}
        fork = text(d.get("fork"))
        if fork is not None:
            out["fork"] = fork
        return out, []

    def validate(self, slug, e):
        """(record, errors, warnings): a normalised grade, or the errors that make it invalid."""
        errs, warns = [], []
        grade = canon_grade(e.get("grade"))
        if grade is None:
            errs.append("grade %s is not one of %s" % (shown(e.get("grade")), ", ".join(GRADES)))
        raw_shape = e.get("shape")
        shape = raw_shape.strip().lower() if isinstance(raw_shape, str) else None
        if shape not in SHAPES:
            errs.append("shape %s is not one of %s" % (shown(raw_shape), ", ".join(SHAPES)))
        raw = e.get("decisions")
        raw = [] if raw is None else raw
        decisions = []
        if not isinstance(raw, list):
            errs.append("decisions is not a list")
        else:
            if grade in DECISION_MINUTES and not raw:
                errs.append("%s needs at least one decision" % grade)
            for i, d in enumerate(raw, 1):
                out, more = self.decision(i, d, warns, slug)
                errs += more
                if out is not None:
                    decisions.append(out)
        if errs:
            return None, errs, []

        size = e.get("size")
        size = size.strip().upper() if isinstance(size, str) else None
        if size not in SIZE_MINUTES:
            warns.append("%s: size %s is not S, M or L; read as M" % (slug, shown(e.get("size"))))
            size = "M"
        deadline = None
        if e.get("deadline") is not None:
            dl = e["deadline"]
            date = self.ES.as_date(dl.get("date")) if isinstance(dl, dict) else None
            if date is None:
                warns.append("%s: deadline %s is not {date: YYYY-MM-DD, why}; dropped" % (slug, shown(dl)))
            elif date < self.today:  # an event already past cannot be met; the scan's overdue `due:` still counts
                warns.append("%s: deadline %s is before today, already past; dropped" % (slug, date.isoformat()))
            else:
                deadline = (date, text(dl.get("why")))
        gates = e.get("gates")
        gates = [] if gates is None else gates
        if not isinstance(gates, list):
            warns.append("%s: gates %s is not a list; read as none" % (slug, shown(gates)))
            gates = []
        kinds = set()
        for g in gates:
            k = g.strip().lower() if isinstance(g, str) else None
            if k in GATE_KINDS:
                kinds.add(k)
            else:
                warns.append("%s: gate %s is not one of %s; dropped" % (slug, shown(g), ", ".join(GATE_KINDS)))
        eye = e.get("eyeCheck")
        if eye is None:
            eye = False
        elif not isinstance(eye, bool):
            warns.append("%s: eyeCheck %s is not true or false; read as false" % (slug, shown(eye)))
            eye = False
        repo = e.get("repo")
        if repo is not None and repo != "":
            if shape != "parallel":
                warns.append("%s: repo %s is for a parallel task; ignored on a %s one" % (slug, shown(repo), shape))
                repo = None
            elif text(repo) is None:
                warns.append("%s: repo %s is not a path; ignored" % (slug, shown(repo)))
                repo = None
            else:
                repo = text(repo)
        else:
            repo = None

        final, raised = grade, []
        implied = GRADES[min(len(decisions), 2)]
        if GRADE_RANK[implied] > GRADE_RANK[final]:
            raised.append({"from": final, "to": implied, "why": "decisions"})
            final = implied
        if final != "Orient" and any(d["confidence"] == "low" for d in decisions):
            up = GRADES[GRADE_RANK[final] + 1]
            raised.append({"from": final, "to": up, "why": "confidence"})
            final = up
        return {"agentGrade": grade, "grade": final, "raised": raised, "shape": shape, "repo": repo, "size": size,
                "decisions": decisions, "graderDeadline": deadline, "gates": [k for k in GATE_KINDS if k in kinds],
                "eyeCheck": eye, "why": text(e.get("why"))}, [], warns

    # ---- figures ---------------------------------------------------------------------------------------------------

    def figures(self, slug, g):
        t, home = self.tasks[slug], self.home[slug]
        agent = SIZE_MINUTES[g["size"]]
        dmin = DECISION_MINUTES.get(g["grade"], 0) * len(g["decisions"])
        review = {"pr": 1 if g["shape"] == "parallel" else 0, "signOff": 1 if g["gates"] else 0,
                  "eyeCheck": 1 if g["eyeCheck"] else 0}
        review["minutes"] = sum(review[k] * REVIEW_MINUTES[k] for k in REVIEW_MINUTES)
        attention = dmin + review["minutes"] + (agent if g["shape"] == "session" else 0)
        cands = []
        due = self.ES.as_date(t.get("due"))
        if due is not None:
            cands.append((due, 0, "due", None))
        if g["graderDeadline"] is not None:
            cands.append((g["graderDeadline"][0], 1, "grader", g["graderDeadline"][1]))
        deadline = min(cands) if cands else None
        soon = deadline is not None and deadline[0] <= self.today + datetime.timedelta(days=DUE_SOON_DAYS)
        return {
            "slug": slug, "note": t.get("note"), "title": t.get("title"), "home": home["name"],
            "projects": list(t.get("projects") or []), "standing": self.standing(home),
            "grade": g["grade"], "agentGrade": g["agentGrade"], "raised": g["raised"], "shape": g["shape"],
            "repo": g["repo"], "root": None, "size": g["size"], "agentMinutes": agent, "decisions": g["decisions"],
            "decisionMinutes": dmin, "review": review, "attentionMinutes": attention,
            "leverage": None, "deadline": ({"date": deadline[0].isoformat(), "source": deadline[2], "why": deadline[3]}
                                           if deadline else None),
            "dueSoon": soon, "gates": g["gates"], "eyeCheck": g["eyeCheck"], "why": g["why"],
            "dependsOn": list(t.get("dependsOn") or []), "blockedBy": [], "rank": None, "run": None,
            "_leverage": agent / max(ATTENTION_FLOOR, attention), "_deadline": deadline[0] if deadline else None,
            "_homeNote": home.get("note") or "",
        }

    # ---- holds ---------------------------------------------------------------------------------------------------

    def reach(self, src):
        """Every task reachable from src through one or more dependency edges."""
        if src not in self._reach:
            seen, todo = set(), list(self.edges.get(src, []))
            while todo:
                n = todo.pop()
                if n not in seen:
                    seen.add(n)
                    todo.extend(self.edges.get(n, []))
            self._reach[src] = seen
        return self._reach[src]

    def holds(self, slug, rows, memo, visiting):
        """The task's blockedBy rows, memoised; recursion only follows a Ready dependency that does not reach back."""
        if slug in memo:
            return memo[slug]
        if slug in visiting:  # unreachable: a dependency that reaches back is a cycle, never recursed into
            return [{"slug": slug, "why": "cycle"}]
        visiting.add(slug)
        out = []
        for d in self.edges.get(slug, []):
            why = self.hold_why(slug, d, rows, memo, visiting)
            if why:
                out.append({"slug": d, "why": why})
        visiting.discard(slug)
        memo[slug] = out
        return out

    def hold_why(self, t, d, rows, memo, visiting):
        if self.inflight[d]:
            return None
        if t in self.reach(d):
            return "cycle"
        if d in self.skip:
            return self.skip[d]
        if d in self.invalid:
            return "invalid"
        r = rows.get(d)
        if r is None:
            return "ungraded"
        if r["grade"] != "Ready":
            return r["grade"]
        if r["standing"] == "parked" and r["_homeNote"] != rows[t]["_homeNote"]:
            return "parked"
        if self.holds(d, rows, memo, visiting):
            return "held"
        return None

    # ---- runs ------------------------------------------------------------------------------------------------------

    def root_of(self, r):
        """(repo row or None, why) for a parallel task."""
        home = self.projects[r["home"]] if r["home"] in self.projects else {}
        declared = set(x for x in (home.get("repos") or []) if isinstance(x, str))
        rows = [x for x in self.scan["repos"] if isinstance(x, dict) and declared & set(x.get("declared") or [])]
        if not rows:
            return None, "no repo declared"
        repo = r["repo"]
        if repo:
            exp = os.path.expanduser(repo)
            want = os.path.realpath(exp) if os.path.isabs(exp) else repo
            hit = next((x for x in rows if repo in (x.get("declared") or []) or x.get("path") == want), None)
            return (hit, None) if hit is not None else (None, "repo unknown")
        return (rows[0], None) if len(rows) == 1 else (None, "repo unknown")

    def runs(self, ranked):
        groups = {}
        for r in ranked:
            if r["shape"] not in ("parallel", "serial"):
                continue
            row, why = self.root_of(r) if r["shape"] == "parallel" else (None, None)
            root = row.get("path") if row else None
            key = (r["home"], r["_homeNote"], r["shape"], root or "")
            run = groups.get(key)
            if run is None:
                run = groups[key] = {
                    "id": "%s/%s/%s" % (r["home"], r["shape"], root or "-"), "project": r["home"],
                    "note": r["_homeNote"], "shape": r["shape"], "root": root,
                    "rolloutRoot": row.get("rolloutRoot") if row else None, "why": why,
                    "parked": r["standing"] == "parked", "ready": [], "waiting": [], "blocked": [],
                    "blockers": list(row.get("blockers") or []) if row else [],
                    "unchecked": list(row.get("unchecked") or []) if row else [],
                    "_members": [],
                }
            group = "blocked" if r["blockedBy"] else ("ready" if r["grade"] == "Ready" else "waiting")
            run[group].append(r["slug"])
            if group != "blocked":
                run["_members"].append(r)
            r["run"], r["root"] = run["id"], root
        out = []
        for run in groups.values():
            live = run.pop("_members")
            review = {k: sum(m["review"][k] for m in live) for k in ("pr", "signOff", "eyeCheck", "minutes")}
            agent = sum(m["agentMinutes"] for m in live)
            dmin = sum(m["decisionMinutes"] for m in live)
            attention = dmin + review["minutes"]
            run.update(agentMinutes=agent, decisionMinutes=dmin, review=review, attentionMinutes=attention,
                       leverage=round(agent / max(ATTENTION_FLOOR, attention), 2),
                       rank=min((m["rank"] for m in live), default=None))
            out.append(run)
        for run in out:
            run["sameRoot"] = sorted(x["id"] for x in out if x is not run and x["shape"] == "parallel"
                                     and run["shape"] == "parallel" and run["root"] and x["root"] == run["root"])
        order = ("id", "project", "note", "shape", "root", "rolloutRoot", "why", "parked", "ready", "waiting",
                 "blocked", "agentMinutes", "decisionMinutes", "review", "attentionMinutes", "leverage", "blockers",
                 "unchecked", "sameRoot", "rank")
        out.sort(key=lambda x: (x["rank"] is None, x["rank"] or 0, x["id"], x["note"]))
        return [{k: run[k] for k in order} for run in out]

    # ---- unpark ----------------------------------------------------------------------------------------------------

    def snooze_of(self, project):
        """(until, ready) from the project note's snooze keys, or None: no keys, or a bad date (warned)."""
        rel = project.get("note")
        if not isinstance(rel, str):
            return None
        note = self.vault().note(os.path.join(*rel.split("/")))
        if note.fm is None:
            self.warn("%s: %s; read as no snooze" % (rel, note.error))
            return None
        raw_until, raw_ready = note.get(SNOOZE_KEYS[0]), note.get(SNOOZE_KEYS[1])
        if raw_until is None:
            return None
        until = self.ES.as_date(raw_until)
        if until is None:
            self.warn("%s: %s %s is not a date; read as no snooze"
                      % (rel, SNOOZE_KEYS[0], shown(self.ES.jsonable(raw_until))))
            return None
        ready = None
        if raw_ready is not None:
            if isinstance(raw_ready, int) and not isinstance(raw_ready, bool) and raw_ready >= 0:
                ready = raw_ready
            else:
                self.warn("%s: %s %s is not a count; read as a date-only snooze"
                          % (rel, SNOOZE_KEYS[1], shown(self.ES.jsonable(raw_ready))))
        return until, ready

    def unpark(self, ranked):
        out = []
        parked = sorted((p for p in self.projects.values() if self.standing(p) == "parked"),
                        key=lambda p: (p["name"], p.get("note") or ""))
        until_write = (self.today + datetime.timedelta(days=SNOOZE_DAYS)).isoformat()
        for p in parked:
            ready = [r["slug"] for r in ranked if r["_homeNote"] == (p.get("note") or "") and r["grade"] == "Ready"
                     and not r["blockedBy"]]
            if not ready:
                continue
            n = len(ready)
            snooze = self.snooze_of(p)
            until, at = snooze if snooze else (None, None)
            snoozed = until is not None and self.today < until and (at is None or n <= at)
            if snoozed and at is None:
                why = "snoozed until %s (date only); %d ready now" % (until.isoformat(), n)
            elif snoozed:
                why = "snoozed until %s: %d ready now, %d at the snooze" % (until.isoformat(), n, at)
            elif until is None:
                why = "parked with %d ready task%s" % (n, "" if n == 1 else "s")
            elif self.today >= until:
                why = "the snooze ended %s; %d ready now" % (until.isoformat(), n)
            else:
                why = "the ready work grew from %d at the snooze to %d" % (at, n)
            row = {"project": p["name"], "note": p.get("note"), "ready": n, "readyTasks": ready, "offer": not snoozed,
                   "why": why, "snooze": {"until": until.isoformat(), "ready": at} if until is not None else None}
            if not snoozed:
                row["options"] = list(UNPARK_OPTIONS)
            row["snoozeWrite"] = {SNOOZE_KEYS[0]: until_write, SNOOZE_KEYS[1]: n}
            out.append(row)
        return out

    # ---- the run ---------------------------------------------------------------------------------------------------

    def run(self):
        self.index()
        chosen = self.entries()
        rows, self.invalid, invalid = {}, set(), []
        for slug in sorted(chosen):
            _, e, _ = chosen[slug]
            g, errs, warns = self.validate(slug, e)
            if errs:
                self.invalid.add(slug)
                invalid.append({"slug": slug, "home": self.home[slug]["name"], "errors": errs})
                continue
            self.warnings.extend(warns)
            rows[slug] = self.figures(slug, g)
        ungraded = [{"slug": s, "home": self.home[s]["name"], "why": "no grade"}
                    for s in sorted(self.home) if s not in rows and s not in self.invalid]

        memo, visiting = {}, set()
        for slug in sorted(rows):
            if rows[slug]["grade"] != "Orient":
                rows[slug]["blockedBy"] = self.holds(slug, rows, memo, visiting)

        soon_cut = datetime.date.min

        def key(r):
            return (r["standing"] == "parked", not r["dueSoon"], r["_deadline"] if r["dueSoon"] else soon_cut,
                    r["standing"] != "crowned", -r["_leverage"], self.standing_rank[r["standing"]], r["home"],
                    r["_homeNote"], r["slug"])
        ranked = sorted((r for r in rows.values() if r["grade"] != "Orient"), key=key)
        for i, r in enumerate(ranked, 1):
            r["rank"] = i
        orient_rows = sorted((r for r in rows.values() if r["grade"] == "Orient"),
                             key=lambda r: (r["home"], r["_homeNote"], r["slug"]))

        runs = self.runs(ranked)
        decisions, total = [], 0
        for rnd, grade in ROUNDS:
            for r in ranked:
                if r["grade"] == grade and r["standing"] != "parked":
                    total += r["decisionMinutes"]
                    decisions.append({"slug": r["slug"], "home": r["home"], "round": rnd, "grade": grade,
                                      "minutes": r["decisionMinutes"], "cumulativeMinutes": total,
                                      "decisions": r["decisions"], "blockedBy": r["blockedBy"]})
        orient = {}
        for r in orient_rows:
            if r["standing"] != "parked":  # parked: its Orient tasks wait on its Unpark offer, as its decisions do
                orient.setdefault((r["home"], r["_homeNote"]), []).append(r["slug"])
        orient = [{"project": name, "note": note, "tasks": slugs} for (name, note), slugs in sorted(orient.items())]
        unpark = self.unpark(ranked)

        tasks = []
        for r in ranked + orient_rows:
            r["leverage"] = round(r["_leverage"], 2)
            tasks.append({k: v for k, v in r.items() if not k.startswith("_")})
        skipped = [{"slug": s, "why": self.skip[s]} for s in sorted(self.skip)]
        scan = self.scan
        return {
            "schema": SCHEMA, "today": self.today.isoformat(),
            "scan": {"today": scan.get("today"), "vault": scan.get("vault"), "deadlineHit": scan.get("deadlineHit"),
                     "vaultErrors": len(scan.get("vaultErrors") or [])},
            "counts": {"gradeable": len(self.home), "graded": len(tasks), "ranked": len(ranked),
                       "orient": len(orient_rows), "held": sum(1 for t in tasks if t["blockedBy"]),
                       "ungraded": len(ungraded), "invalid": len(invalid), "skipped": len(skipped), "runs": len(runs),
                       "decisions": len(decisions), "decisionMinutes": total, "unpark": len(unpark),
                       "offers": sum(1 for u in unpark if u["offer"]), "warnings": len(self.warnings)},
            "tasks": tasks, "runs": runs, "decisions": decisions, "orient": orient, "unpark": unpark,
            "skipped": skipped, "ungraded": ungraded, "invalid": invalid, "warnings": list(self.warnings),
        }


# ---- snooze --------------------------------------------------------------------------------------------------------

def cleared(NA, note, keys=SNOOZE_KEYS):
    """The note's text with every `keys` entry removed (the snooze keys by default), or None when it carries none.
    Raises NA.Refused.

    next-action's one-key edit only sets a key, so the removal lives here, located the way it locates one (the key and
    value nodes' marks from yaml.compose) and checked the way it checks one: the re-parsed frontmatter must be the old
    one minus those keys, so a layout the line cut would damage (a flow mapping) is refused, never written."""
    body = note.body()
    if NA.ODD_BREAKS.search(body):
        raise NA.Refused("%s: frontmatter has line breaks other than \\n" % note.path)
    root = NA.yaml.compose(body, Loader=NA.LOADER)
    first, lines, spans = note.span[0], list(note.lines), []
    for k, v in (root.value if root is not None else []):
        if isinstance(k, NA.yaml.ScalarNode) and k.value in keys:
            start = first + k.start_mark.line
            end = first + v.end_mark.line + (1 if v.end_mark.column else 0)
            while end - 1 > start and lines[end - 1].strip() == "":  # keep blank lines after the value
                end -= 1
            spans.append((start, max(end, start + 1)))
    if not spans:
        return None
    for start, end in sorted(spans, reverse=True):
        del lines[start:end]
    check = NA.Note(note.path, "".join(lines))
    if check.fm != {k: v for k, v in note.fm.items() if k not in keys}:
        raise NA.Refused("%s: clearing the snooze would change other frontmatter; left alone" % note.path)
    return check.text


def project_note(RT, args, dead_tail):
    """(vault, rel, shown rel, note) for a live project named by args.project; refused (exit 2) when it is unknown,
    not a project, dead (`dead_tail` ends the line) or its frontmatter does not parse."""
    NA = RT.NA
    vroot = os.path.expanduser(args.vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    vault = NA.Vault(vroot)
    try:
        rel, why = vault.resolve_project(args.project)
    except NA.Refused as e:
        fail(2, str(e))
    if why:
        fail(2, "%s: %s" % (args.project, why))
    shown_rel = rel.replace(os.sep, "/")
    note = vault.note(rel)
    dead = RT.dead_why(rel, note)
    if dead:
        fail(2, "%s is %s; %s" % (shown_rel, dead, dead_tail))
    if note.fm is None:
        fail(2, "%s: %s" % (shown_rel, note.error))
    return vault, rel, shown_rel, note


def snooze(RT, ES, args):
    NA = RT.NA
    _, rel, shown_rel, note = project_note(RT, args, "only a live project's snooze is cleared" if args.clear
                                           else "only a parked project is snoozed")
    if args.clear:  # any live project: the unpark and kill writes clear the record whatever the order of their writes
        try:
            out = cleared(NA, note)
        except NA.Refused as e:
            fail(2, str(e))
        if out is None:
            sys.stdout.write("no snooze on %s\n" % shown_rel)
            return
        try:
            note.save(out)
        except OSError as e:
            fail(2, "cannot write %s: %s" % (shown_rel, e))
        sys.stdout.write("cleared the snooze on %s\n" % shown_rel)
        return
    standing = ES.standing_of(NA.status_of(note))
    if standing != "parked":
        fail(2, "%s is not parked (standing: %s); only a parked project is snoozed" % (shown_rel, standing))
    until = (args.today + datetime.timedelta(days=SNOOZE_DAYS)).isoformat()
    try:
        first = note.edited(SNOOZE_KEYS[0], until)
        both = NA.Note(note.path, first).edited(SNOOZE_KEYS[1], args.ready)
    except NA.Refused as e:
        fail(2, str(e))
    want = dict(note.fm)
    want.update({SNOOZE_KEYS[0]: until, SNOOZE_KEYS[1]: args.ready})
    if NA.Note(note.path, both).fm != want:
        fail(2, "%s: the snooze would change other frontmatter; left alone" % shown_rel)
    try:
        note.save(both)
    except OSError as e:
        fail(2, "cannot write %s: %s" % (shown_rel, e))
    sys.stdout.write("snoozed %s until %s (ready %d)\n" % (shown_rel, until, args.ready))


def parked_or_refuse(NA, ES, shown_rel, note, verb):
    standing = ES.standing_of(NA.status_of(note))
    if standing != "parked":
        fail(2, "%s is not parked (standing: %s); only a parked project is %s" % (shown_rel, standing, verb))


def live_sub_projects(RT, vault, rel):
    """mark-project-done.js's umbrella guard: when the note is a folder note (`<dir>/<dir>.md` below Work/Projects),
    every other project-tagged note under that folder, outside Archive/, that is not done (`done: true` or "true", or
    status done), as vault-relative paths; [] for any other note."""
    NA = RT.NA
    folder = os.path.dirname(rel)
    if folder == NA.PROJECTS_DIR or os.path.basename(folder) != os.path.basename(rel)[:-3]:
        return []
    out = []
    for d, dirs, files in os.walk(os.path.join(vault.root, folder)):
        dirs[:] = sorted(x for x in dirs if x != "Archive")
        for f in sorted(files):
            other = os.path.relpath(os.path.join(d, f), vault.root)
            if not f.lower().endswith(".md") or other == rel:
                continue
            n = vault.note(other)
            if n.fm is None or "project" not in NA.tags_of(n):
                continue
            if RT.done_flag(n) or NA.status_of(n) == "done":
                continue
            out.append(other.replace(os.sep, "/"))
    return out


def status_write(NA, note, removed, sets):
    """One save's text: `removed` keys cut (`cleared`), then each (key, value) in `sets` set by next-action's one-key
    edit, re-parsed against the old frontmatter. Refused (exit 2) on any layout the edits would damage."""
    try:
        base = cleared(NA, note, removed)
        cur = NA.Note(note.path, base) if base is not None else note
        for key, value in sets:
            cur = NA.Note(note.path, cur.edited(key, value))
    except NA.Refused as e:
        fail(2, str(e))
    want = {k: v for k, v in note.fm.items() if k not in removed}
    want.update(sets)
    if cur.fm != want:
        fail(2, "%s: the write would change other frontmatter; left alone" % note.path)
    return cur.text


def unpark(RT, ES, args):
    NA = RT.NA
    _, rel, shown_rel, note = project_note(RT, args, "only a parked project is unparked")
    parked_or_refuse(NA, ES, shown_rel, note, "unparked")
    out = status_write(NA, note, SNOOZE_KEYS, [("status", "queued")])
    try:
        note.save(out)
    except OSError as e:
        fail(2, "cannot write %s: %s" % (shown_rel, e))
    sys.stdout.write("unparked %s (status: queued)\n" % shown_rel)


def kill(RT, ES, args):
    NA = RT.NA
    vault, rel, shown_rel, note = project_note(RT, args, "only a parked project is killed")
    parked_or_refuse(NA, ES, shown_rel, note, "killed")
    subs = live_sub_projects(RT, vault, rel)
    if subs:
        fail(2, "%s is an umbrella with %d live sub-project%s (%s); finish or move those first: archiving a done "
             "folder note moves its whole folder"
             % (shown_rel, len(subs), "" if len(subs) == 1 else "s", ", ".join(subs)))
    today = args.today.isoformat()
    out = status_write(NA, note, SNOOZE_KEYS + KILL_KEYS, [("done", True), ("completed", today)])
    try:
        note.save(out)
    except OSError as e:
        fail(2, "cannot write %s: %s" % (shown_rel, e))
    sys.stdout.write("killed %s (done: true, completed %s)\n" % (shown_rel, today))


# ---- main ----------------------------------------------------------------------------------------------------------

def parse(argv):
    p = Parser(prog="estate-rank", allow_abbrev=False,
               description="The estate pass's ranker and the snooze record's writer (readiness-grade.md).")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    r = sub.add_parser("rank", allow_abbrev=False)
    r.add_argument("--scan", required=True)
    r.add_argument("--grades", action="append", required=True)
    r.add_argument("--superseding")
    r.add_argument("--today")
    r.add_argument("--vault")
    r.add_argument("--compact", action="store_true")
    s = sub.add_parser("snooze", allow_abbrev=False)
    s.add_argument("project")
    mode = s.add_mutually_exclusive_group(required=True)
    mode.add_argument("--ready")
    mode.add_argument("--clear", action="store_true")
    s.add_argument("--today")
    s.add_argument("--vault", default=VAULT_DEFAULT)
    u = sub.add_parser("unpark", allow_abbrev=False)
    u.add_argument("project")
    u.add_argument("--vault", default=VAULT_DEFAULT)
    u.set_defaults(today=None)
    k = sub.add_parser("kill", allow_abbrev=False)
    k.add_argument("project")
    k.add_argument("--today")
    k.add_argument("--vault", default=VAULT_DEFAULT)
    args = p.parse_args(argv)
    if not args.verb:
        fail(2, "a verb is required: rank | snooze | unpark | kill")
    if args.today is not None:
        args.today = parse_date(args.today, "--today")
    if args.verb == "snooze" and args.ready is not None:
        if not re.fullmatch(r"\d+", args.ready.strip()):
            fail(2, "--ready must be a count, an integer 0 or more: %r" % args.ready)
        args.ready = int(args.ready.strip())
    if args.verb in ("snooze", "unpark", "kill") and args.today is None:
        args.today = datetime.date.today()
    return args


def main(argv):
    args = parse(argv)
    if args.verb in WRITERS:
        RT, ES = load_siblings()
        WRITERS[args.verb](RT, ES, args)
        return 0
    scan = read_scan(args.scan)
    grade_files = [(path, read_grades(path)) for path in args.grades]
    RT, ES = load_siblings()
    today = args.today or ES.as_date(scan.get("today")) or datetime.date.today()
    vault = args.vault or text(scan.get("vault")) or VAULT_DEFAULT
    vroot = os.path.expanduser(vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    out = Ranker(RT, ES, scan, today, vroot, grade_files, superseding=args.superseding).run()
    body = json.dumps(out, ensure_ascii=False, separators=(",", ":")) if args.compact else \
        json.dumps(out, ensure_ascii=False, indent=2)
    sys.stdout.buffer.write((body + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()
    return 0


WRITERS = {"snooze": snooze, "unpark": unpark, "kill": kill}

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
