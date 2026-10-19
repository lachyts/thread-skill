#!/usr/bin/env python3
"""The estate pass's deterministic half after the ranker (ADR 0041; CONTEXT.md **Decision round**, **Dispatch plan**).

Scripts scan, the model decides: estate-scan.py lists the estate, the grading agents grade it, estate-rank.py ranks
it, and this script does the rest that needs no judgement. It cuts the decision round to Lachy's budget and builds
its AskUserQuestion payloads (`rounds`), works out which runs go once the answers are in (`plan`), which sessions
start and with what (`sessions`), and writes each answer into its task note (`record`); `slices` cuts the scan into
the grading agents' inputs. skills/orient-all/SKILL.md is its one caller, and this docstring is the only copy of the
output schemas. python >= 3.9 with PyYAML. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py slices --scan FILE --dir DIR
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py rounds --rank FILE --scan FILE --budget N
        [--top K] [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py plan --rank FILE --scan FILE
        [--decided SLUG]... [--unparked NOTE]... [--signed SLUG]... [--rounds FILE --assume-answered] [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py sessions --plan FILE [--wrote PATH]...
        [--status SLUG=N]... [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task SLUG|PATH --question Q
        --answer A --recommended R [--fork F] [--today YYYY-MM-DD] [--vault PATH]

Defaults: rounds, plan and sessions take the vault from the scan's (or the plan's) `vault`; record takes
~/repos/obsidian and the local date. Only `slices` (its own files under --dir) and `record` (one task note) write;
rounds, plan and sessions write nothing and are byte-deterministic for the same inputs. No subprocess, no network, no
bytecode (sys.dont_write_bytecode is set before any sibling loads). Exit 0 when done; 2 on a usage error or a refusal
(one `estate-dispatch:` stderr line, nothing written): an unknown verb or flag, a scan, rank or plan that is not JSON
or whose `schema` is not 1, a negative budget, a bad --status or --wrote, an existing slice file, and every record
refusal; 3 when the vault, PyYAML or a sibling script is missing.

What it reuses. Loaded by path inside main(), so importing this file runs nothing (the contract tests read its
constants that way): estate-rank.py (ER: Ranker's index, the gradeable rule; slug_key; DECISION_MINUTES and
REVIEW_MINUTES), and through ER.load_siblings resolve-target.py's next-action.py (NA: Vault, Note, status_of,
OPEN_STATUSES, links_in, tags_of) and estate-scan.py (ES: first_link, link_live and in_flight, vault-grammar.md
§ In flight stated once); reconcile-rollout.py (RR: Note, GATE_PENDING_SECTION, GATE_BOUNCE_SECTION,
PROJECT_ROOT_RE, _shape and _start_unattended, the start stamp's reader); and, for `sessions` only, leg.py (LEG:
split_cells, LAUNCH_RE, LINK_RE and QUEUE, the serial Queue's row grammar).

slices --scan F --dir D: one file per home project with gradeable tasks (ER's rule: statusClass active, not in flight,
a live first project), `D/<NN>-<kebab name>.json`, NN from 01 in the scan's project order, holding {project (the scan
row), tasks[] (its gradeable scan task rows), repos[] (the scan repo rows whose declared paths meet the project's
`repos:`), today}. It creates D; any target file that already exists is exit 2 with nothing written. Prints
{homes[] {project, note, file, tasks}, gradeable, skipped}.

rounds --rank R --scan S --budget N [--top K=15] [--vault V]: the decision round, cut to N minutes.
  Sign-offs: each scan rollout summary's `pendingSignOffs` (with a null summary, the scan's open tasks at status
  RR.GATE_PENDING_STATUS whose `rollout:` names it), as {slug, rollout, note, gateText, gates[], bounced, bounce, ask,
  why}: gateText is RR.Note(task).section_text(RR.GATE_PENDING_SECTION), raw; gates[] its non-empty lines, a leading
  bullet mark stripped (the lines `reconcile-rollout.py approve-gates` signs, sub-bullets included); bounced is
  has_heading(RR.GATE_BOUNCE_SECTION) and bounce that section's text. ask is true unless why is `status unread` (a
  null summary), `paused` (a stamped pause other than pausedFor sign-off), `draining` (pause_requested) or `needs you`
  (its setAside entry carries needsHuman): repair § 1 runs approve-gates under no other pause. Every asked sign-off is
  asked whatever the budget, and charged first at REVIEW_MINUTES.signOff each.
  The cut, in order, after the sign-offs: the rank's One calls (decisions[] round one-call, in order) at
  DECISION_MINUTES['One call'] per decision; the offered Unpark rows at the One-call minute each; the Grills at their
  rank `minutes`. The first item that does not fit the minutes left stops the cut: it and everything after it go to
  later[]. A decision task whose holds this pass can never clear (a `blockedBy` why other than One call, Grill and
  held, followed through `held` dependencies with a memo and a cycle guard) goes to skipped[], charged nothing.
  Payloads: up to QUESTIONS_MAX questions per AskUserQuestion call, sign-offs first, then One calls, then Unpark offers;
  each {question, header (HEADERS, at most 12 chars), multiSelect: false, options[] {label, description}}. Every
  question opens with `[[slug]]` or `[[project]]`, so every text is unique. A label is at most LABEL_MAX chars, "
  (Recommended)" counted: a longer option is asked as `<k>. <leading words>…` (k its 1-based place, so labels stay
  distinct), its description opening with the full text. A One call's options are the decision's, the recommendation
  first and marked " (Recommended)", its description the grader's why; a sign-off's are `Sign off` (its description
  lists exactly the gates[] it signs) and `Not now`; an Unpark offer's are unpark, snooze and kill (the kill names the
  project's open tasks). Sign-offs and Unpark offers carry no recommendation.
  Output: {schema, today, budget, top[] {rank, slug, home, grade, shape, size, leverage, dueSoon, deadline, review,
  blockedBy}, live[] {slug, note, shape, progress, paused, pausedFor, pauseRequested, awaitingSignOff, live,
  pendingSignOffs[], error}, signOffs[], oneCalls[] {slug, home, minutes, decision, blockedBy}, unpark[] (the rank's
  rows, offered and in budget), grill[] {slug, home, minutes, decisions[], blockedBy}, later[] {kind, slug|project,
  minutes}, skipped[] {kind, slug, blockedBy}, asks[][] (AskUserQuestion's `questions`, one array per call), index[]
  {question, kind (sign-off | one-call | unpark), slug|project, note, labels[], texts[] (each label's full text),
  recommended (texts[0] for a One call, else null), fork?, bounced?}, minutes {signOffs, oneCalls, unpark, grill, used,
  budget}}.

plan --rank R --scan S [--decided SLUG]... [--unparked NOTE]... [--signed SLUG]... [--rounds F --assume-answered]:
  what the pass schedules and starts once the answers are in.
  Decided: a task graded Ready, or named by --decided; with --assume-answered, also every oneCalls[] and grill[] slug
  in F (the dry run's reading: every in-budget decision answered). A member is scheduled when it is decided and every
  hold on it clears: a One call or Grill hold when the dependency is decided and clear, a `held` hold when the
  dependency is clear, a `parked` hold when the dependency's home is in --unparked (by name or note) and it is clear;
  no other hold ever clears (memo and cycle guard).
  A run is scheduled when it has members left; it is parallel with a root, or serial; its repo row has no blocker
  (`unchecked` passes: schedule § 0 is the gate); it is not parked, unless unparked here (then only its Ready, unheld
  members go); and it is the best-ranked parallel run on its root (keyed on rolloutRoot when set, else root). Every
  other run waits, with why {kind: parked | nothing decided | repo unknown | no repo declared | blocker | same root |
  dependency not scheduled, detail}.
  Then the dependencies: a member whose rank dependsOn[] names an open (a scan task), not-in-flight task that no
  scheduled entry holds as a member is held, with blockedBy {slug, why: `dependency not scheduled`}, since
  reconcile-rollout's _dep_status would hold its row until that task lands, and it never would (its run waits, or it
  is session-lane work, which no run holds; on a `same root` waiter, a deadlock). The runs are then chosen again with
  those members held, to a fixpoint: a run that loses every member waits with that kind and frees its root, and its
  members' dependants are held in turn.
  Schedule entries: {run, project, note, projectSlug, batchKeys[], shape, root, rolloutRoot, members[], args
  ("--tasks a,b,c", never --regenerate), batch, review {pr, signOff, eyeCheck, minutes}}. projectSlug is the name
  NFKD-folded to ASCII and lower-cased, apostrophes (' and ’) deleted, every other run outside [a-z0-9] made a `-`, the
  ends trimmed ("Lachy's Tools" -> lachys-tools). batchKeys are the name's alphanumerics-only lower-case forms, taken
  NFKD-folded to ASCII and with non-ASCII dropped ("Café" -> cafe, caf): two entries whose keys meet may name the same
  note, and schedule step 6's naming (glob, then write) is not atomic, so they never share a batch. Parallel entries,
  in rank order, each take the lowest batch from 1 holding no entry whose keys meet theirs; serial entries each take a
  batch of their own after the last parallel one, in rank order. Listed by batch, then rank.
  rollouts[]: one per scan rollout, {slug, note, shape, projectRoot, pausedFor, owners? (the `owner:` tags of its open
  tasks), holds[], canExecute, canRepair, reinstate}. holds, in this order: superseded (supersededBy), lineage
  (another live rollout's supersedes names it), version (protocol_version not 5), incomplete, serial (status reads no
  Leg log yet), paused, draining (pause_requested), live queue (running + integrating > 0), start stamp
  (RR._start_unattended: the Stage starts it), status unread (a null summary). reinstate: awaitingSignOff with every
  pending sign-off in --signed. canExecute: no hold, or reinstate with paused the only hold. canRepair: none of
  superseded, lineage, version, serial and status unread.
  Output: {schema, vault, today, schedule[], waiting[] {run, project, note, shape, root, rolloutRoot, members[], why},
  rollouts[], reinstate[], orient[] {name, note, area[]} (the rank's, whatever the budget), held[] {slug, run, grade,
  blockedBy (the rank holds that stand, then the unscheduled dependencies)}, undecided[] {slug, run, grade},
  sessionLane[] {slug, home, grade}}.

sessions --plan P [--wrote PATH]... [--status SLUG=N]...: the sessions to start, in start order. STATUS_ACTIONS maps
  each status § 4 **Recommended action** rule (its number, as a status agent reports it) to the item it may start:
  6 and 13 an execute, 8 a reinstate, 7 and 11 a repair, every other number none (o10 pins the table to the rules).
  --wrote: each note a § 6 schedule fork wrote, directly in the vault's Work/Tasks (else exit 2). A parallel one
  (RR._shape) is an execute item in its Project root (no root: manual); a serial one is a `leg` item for Leg 1, in
  its `## Queue` row 1's launch folder, manual when its alias starts `cx-` (legs.md § Hand over).
  --status SLUG=N: SLUG one of plan.rollouts[], N an integer 1 to 13 (else exit 2). An execute item only with
  canExecute, a reinstate only with reinstate and canExecute (so a sign-off pause that every gate signed but another
  hold stands on, serial, a start stamp or a drain, gets none), a repair only with canRepair; every live rollout that
  gets no item goes to left[] {rollout, action (null: status unread), holds[], why}.
  Orient items: one per plan.orient[], prompt `/thread:orient [[<name>]]`, with one more line per --wrote note whose
  `projects:` resolves to that project, naming it. Order: the written-note items (in --wrote order), the live
  execute items by slug, the repair items by slug, the orient items last. A title over TITLE_MAX is cut to
  TITLE_MAX - 1 chars plus "…".
  Output: {schema, today, items[] {kind (execute | leg | repair | orient), rollout | project, note, title, cwd, alias?,
  prompt, tldr, manual, why}, left[]}.

record --task SLUG|PATH --question Q --answer A --recommended R [--fork F] [--today D]: one answer into its task. Q, A,
  R and F have every whitespace run (newlines included) folded to one space, and Q loses a leading link to its own
  task (`[[<slug>]] `, as a rounds index text opens; ER.slug_key compares), so the note never links to itself and a
  rerun with the bare question is [no-change]. Refused (exit 2, the file byte-identical): no such task note directly
  in Work/Tasks, a note that is not a `task`, a status outside Active (NA.status_of not in NA.OPEN_STATUSES), a task
  in flight (ES.in_flight over ES.link_live of its `rollout:`), a value empty after the fold (Q after its link is cut
  too), and a --fork that the latest `orient end:` line in its `## Notes` does not name as `fork for Lachy: F`. The
  bullet `- <Q> → <A> (asked at /thread:orient-all; recommended: <R>)` extends in place the section DECISIONS_HEADING
  of the same date (after its last line, before the next `## ` heading outside a fence), else opens that section at
  the note's end (schedule step 7's form). --fork also appends RULING_LINE (orient § 5's) as the last `## Notes`
  line. One in-place write (the inode kept), printing `recorded <note>: <Q> → <A>`; nothing to add prints
  `<note>: <Q> → <A> [no-change]`, exit 0.
"""
import argparse
import datetime
import importlib.util
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
ESTATE_RANK_PY = os.path.join(HERE, "estate-rank.py")
LEG_PY = os.path.join(SKILLS, "execute", "scripts", "leg.py")

SCHEMA = 1
RANK_SCHEMA = 1
SCAN_SCHEMA = 1
PLAN_SCHEMA = 1
VAULT_DEFAULT = "~/repos/obsidian"
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
FENCE = re.compile(r"^\s*(```|~~~)")

# AskUserQuestion's shape, as far as this script builds it (orient-all § Risks: assumed, not read from the tool).
QUESTIONS_MAX = 4
LABEL_MAX = 40
RECOMMENDED = " (Recommended)"
ELLIPSIS = "…"
HEADERS = {"sign-off": "Sign-off", "one-call": "One call", "unpark": "Unpark"}
SIGN_OFF_OPTIONS = ("Sign off", "Not now")
TOP_DEFAULT = 15
TITLE_MAX = 60  # create_thread's title (skills/execute/legs.md § Hand over)
KILL_NAMES_MAX = 8

# schedule step 7's ask-ahead heading and orient § 5's ruling line (tests/contracts/orient-all.test.mjs o4).
DECISIONS_HEADING = "## Decisions (asked ahead {date})"
RULING_LINE = "- {stamp} orient ruling: {fork} → {answer}"
DECISION_BULLET = "- {question} → {answer} (asked at /thread:orient-all; recommended: {recommended})"
NOTES_HEADING = "## Notes"
END_MARK = " orient end: "
FORK_MARK = "fork for Lachy: "

# status/SKILL.md § 4's **Recommended action** rules: number -> (the item it may start here, the rule's opening
# words). tests/contracts/orient-all.test.mjs o10 pins every entry to the rule it names.
STATUS_ACTIONS = {
    1: (None, "`superseded_by:`"),
    2: (None, "Named by another rollout's `supersedes:`"),
    3: (None, "Predates the queue"),
    4: (None, "Unsupported protocol version"),
    5: (None, "`incomplete`"),
    6: ("execute", "Every task merged"),
    7: ("repair", "An open escalation"),
    8: ("reinstate", "`paused`"),
    9: (None, "`pause_requested`"),
    10: (None, "A live queue"),
    11: ("repair", "Any drift flag"),
    12: (None, "Awaiting Integration"),
    13: ("execute", "Nothing started"),
}
HOLDS = ("superseded", "lineage", "version", "incomplete", "serial", "paused", "draining", "live queue", "start stamp",
         "status unread")
NO_REPAIR = frozenset({"superseded", "lineage", "version", "serial", "status unread"})
DEP_UNSCHEDULED = "dependency not scheduled"  # plan's own hold, and the why of a run it empties


def fail(code, reason):
    sys.stderr.write("estate-dispatch: %s\n" % reason)
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


def load(name, path):
    try:
        return _load(name, path)
    except SystemExit:
        fail(3, "cannot load %s" % path)
    except Exception as e:
        fail(3, "cannot load %s: %s" % (path, e))


class Mods:
    """The siblings, loaded once in main()."""

    def __init__(self, leg=False):
        self.ER = load("thread_estate_rank", ESTATE_RANK_PY)
        self.RT, self.ES = self.ER.load_siblings()  # its own one-line exit 3 on a missing sibling or PyYAML
        self.NA = self.RT.NA
        self.RR = load("thread_reconcile_rollout", self.ES.RECONCILE_ROLLOUT_PY)
        self.LEG = load("thread_leg", LEG_PY) if leg else None


# ---- values ------------------------------------------------------------------------------------------------------

def emit(out):
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False, indent=2) + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()


def fold(s):
    """Every whitespace run, newlines included, folded to one space; the ends trimmed."""
    return " ".join((s or "").split())


def parse_date(raw, flag):
    try:
        if not ISO_DATE.fullmatch(raw):
            raise ValueError
        return datetime.date.fromisoformat(raw)
    except ValueError:
        fail(2, "%s must be a date, YYYY-MM-DD: %r" % (flag, raw))


def read_json(path, what, schema):
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except (OSError, UnicodeDecodeError) as e:
        fail(2, "cannot read the %s %s: %s" % (what, path, getattr(e, "strerror", None) or e))
    try:
        data = json.loads(raw)
    except ValueError as e:
        fail(2, "the %s %s is not JSON: %s" % (what, path, e))
    if not isinstance(data, dict):
        fail(2, "the %s %s is not an object" % (what, path))
    got = data.get("schema")
    if isinstance(got, bool) or got != schema:
        fail(2, "the %s %s has schema %s; this script reads schema %d"
             % (what, path, json.dumps(got), schema))
    return data


def read_scan(path):
    scan = read_json(path, "scan", SCAN_SCHEMA)
    for key in ("projects", "tasks", "repos", "rollouts"):
        if not isinstance(scan.get(key), list):
            fail(2, "the scan %s has no %s list" % (path, key))
    return scan


def read_rank(path):
    rank = read_json(path, "rank", RANK_SCHEMA)
    for key in ("tasks", "runs", "decisions", "orient", "unpark"):
        if not isinstance(rank.get(key), list):
            fail(2, "the rank %s has no %s list" % (path, key))
    return rank


def vault_root(arg, data):
    v = arg or (data.get("vault") if isinstance(data.get("vault"), str) else None) or VAULT_DEFAULT
    root = os.path.expanduser(v)
    if not os.path.isdir(root):
        fail(3, "no vault at %s" % root)
    return os.path.realpath(root)


def today_of(data):
    raw = data.get("today")
    if isinstance(raw, str) and ISO_DATE.fullmatch(raw):
        return raw
    return datetime.date.today().isoformat()


def project_slug(name):
    """The name as schedule step 6's note slug: NFKD-folded to ASCII, lower-cased, apostrophes deleted, every other
    run outside [a-z0-9] a `-`, the ends trimmed."""
    s = name.replace("'", "").replace("’", "")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def batch_keys(name):
    """The name's alphanumerics-only lower-case forms, NFKD-folded to ASCII and with non-ASCII dropped."""
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    dropped = name.encode("ascii", "ignore").decode("ascii")
    return sorted({re.sub(r"[^a-z0-9]", "", x.lower()) for x in (folded, dropped)})


def status_key(v):
    """A raw `status:` value read as vault-grammar.md § Statuses reads one: lower-cased, `-` as `_`."""
    return str(v or "").strip().lower().replace("-", "_")


def titled(title):
    return title if len(title) <= TITLE_MAX else title[:TITLE_MAX - 1] + ELLIPSIS


def is_five(v):
    return (isinstance(v, int) and not isinstance(v, bool) and v == 5) or (isinstance(v, str) and v.strip() == "5")


# ---- slices ------------------------------------------------------------------------------------------------------

def cmd_slices(args):
    scan = read_scan(args.scan)
    M = Mods()
    today = scan.get("today")
    ranker = M.ER.Ranker(M.RT, M.ES, scan, None, None, [])
    ranker.index()
    by_home = {}
    for slug in sorted(ranker.home):
        by_home.setdefault(ranker.home[slug]["name"], []).append(slug)
    plan, n = [], 0
    for p in scan["projects"]:
        if not isinstance(p, dict) or p.get("name") not in by_home or ranker.projects.get(p["name"]) is not p:
            continue
        n += 1
        name = p["name"]
        declared = set(x for x in (p.get("repos") or []) if isinstance(x, str))
        repos = [r for r in scan["repos"] if isinstance(r, dict) and declared & set(r.get("declared") or [])]
        tasks = [ranker.tasks[s] for s in by_home[name]]
        fname = "%02d-%s.json" % (n, project_slug(name) or "project")
        plan.append((fname, {"project": p, "tasks": tasks, "repos": repos, "today": today}))
    d = os.path.expanduser(args.dir)
    taken = [f for f, _ in plan if os.path.lexists(os.path.join(d, f))]
    if taken:
        fail(2, "%s already holds %s; slices never overwrite" % (d, ", ".join(taken)))
    try:
        os.makedirs(d, exist_ok=True)
        for fname, body in plan:
            with open(os.path.join(d, fname), "x", encoding="utf-8") as fh:
                fh.write(json.dumps(body, ensure_ascii=False, indent=2) + "\n")
    except OSError as e:
        fail(2, "cannot write the slices under %s: %s" % (d, e))
    emit({"homes": [{"project": b["project"]["name"], "note": b["project"].get("note"), "file": os.path.join(d, f),
                     "tasks": [t["slug"] for t in b["tasks"]]} for f, b in plan],
          "gradeable": len(ranker.home), "skipped": len(ranker.skip)})


# ---- rounds ------------------------------------------------------------------------------------------------------

def label_for(k, full, recommended):
    """(label, shortened): the option's label, at most LABEL_MAX chars with the suffix counted."""
    suffix = RECOMMENDED if recommended else ""
    if len(full) + len(suffix) <= LABEL_MAX:
        return full + suffix, False
    prefix = "%d. " % k
    room = LABEL_MAX - len(prefix) - len(ELLIPSIS) - len(suffix)
    words, cut = full.split(), ""
    for w in words:
        nxt = (cut + " " + w) if cut else w
        if len(nxt) > room:
            break
        cut = nxt
    if not cut:
        cut = full[:room].rstrip()
    return prefix + cut + ELLIPSIS + suffix, True


class Rounds:
    def __init__(self, M, rank, scan, vroot, budget, top):
        self.M, self.rank, self.scan, self.vroot = M, rank, scan, vroot
        self.budget, self.top = budget, top
        self.rows = {t["slug"]: t for t in rank["tasks"] if isinstance(t, dict) and isinstance(t.get("slug"), str)}
        self._clear = {}

    # A hold this pass can clear: One call or Grill (asked in this round), or held by such a chain.
    def clears(self, slug, visiting):
        if slug in self._clear:
            return self._clear[slug]
        if slug in visiting:
            return False
        visiting.add(slug)
        ok = True
        for h in (self.rows.get(slug) or {}).get("blockedBy") or []:
            why = h.get("why")
            if why in ("One call", "Grill"):
                continue
            if why == "held" and self.clears(h.get("slug"), visiting):
                continue
            ok = False
            break
        visiting.discard(slug)
        self._clear[slug] = ok
        return ok

    def task_note(self, slug):
        row = next((t for t in self.scan["tasks"] if isinstance(t, dict) and t.get("slug") == slug), None)
        return row.get("note") if row and isinstance(row.get("note"), str) else "Work/Tasks/%s.md" % slug

    def sign_offs(self):
        RR, ER = self.M.RR, self.M.ER
        out = []
        for r in sorted((x for x in self.scan["rollouts"] if isinstance(x, dict)), key=lambda x: str(x.get("slug"))):
            s = r.get("summary")
            if isinstance(s, dict):
                slugs = [x for x in (s.get("pendingSignOffs") or []) if isinstance(x, str)]
                needs = {e.get("slug") for e in (s.get("setAside") or [])
                         if isinstance(e, dict) and e.get("needsHuman")}
            else:
                key, gate = ER.slug_key(r.get("slug") or ""), status_key(RR.GATE_PENDING_STATUS)
                slugs = sorted(t["slug"] for t in self.scan["tasks"] if isinstance(t, dict)
                               and status_key(t.get("status")) == gate
                               and t.get("rollout") and ER.slug_key(t["rollout"]) == key)
                needs = set()
            for slug in slugs:
                rel = self.task_note(slug)
                text, gates, bounced, bounce = "", [], False, ""
                path = Path(os.path.join(self.vroot, *rel.split("/")))
                try:
                    note = RR.Note(path)
                    text = note.section_text(RR.GATE_PENDING_SECTION)
                    gates = [re.sub(r"^[-*]\s+", "", ln.strip()) for ln in text.split("\n") if ln.strip()]
                    bounced = note.has_heading(RR.GATE_BOUNCE_SECTION)
                    bounce = note.section_text(RR.GATE_BOUNCE_SECTION) if bounced else ""
                except (OSError, ValueError, UnicodeDecodeError):
                    pass
                if not isinstance(s, dict):
                    why = "status unread"
                elif s.get("paused") and s.get("pausedFor") != "sign-off":
                    why = "paused"
                elif s.get("pause_requested"):
                    why = "draining"
                elif slug in needs:
                    why = "needs you"
                else:
                    why = None
                out.append({"slug": slug, "rollout": r.get("slug"), "note": rel, "gateText": text, "gates": gates,
                            "bounced": bounced, "bounce": bounce, "ask": why is None and bool(gates), "why":
                            why if why or gates else "no gates under %s" % RR.GATE_PENDING_SECTION})
        return out

    def live(self):
        out = []
        for r in sorted((x for x in self.scan["rollouts"] if isinstance(x, dict)), key=lambda x: str(x.get("slug"))):
            s = r.get("summary") if isinstance(r.get("summary"), dict) else None
            counts = (s or {}).get("counts") or {}
            out.append({"slug": r.get("slug"), "note": r.get("note"), "shape": r.get("shape"),
                        "progress": (s or {}).get("progress"), "paused": (s or {}).get("paused"),
                        "pausedFor": (s or {}).get("pausedFor"),
                        "pauseRequested": bool((s or {}).get("pause_requested")),
                        "awaitingSignOff": bool((s or {}).get("awaitingSignOff")),
                        "live": (counts.get("running") or 0) + (counts.get("integrating") or 0),
                        "pendingSignOffs": list((s or {}).get("pendingSignOffs") or []), "error": r.get("error")})
        return out

    def run(self):
        ER = self.M.ER
        sign = self.sign_offs()
        asked = [x for x in sign if x["ask"]]
        so_min = len(asked) * ER.REVIEW_MINUTES["signOff"]
        left = self.budget - so_min
        one_min = ER.DECISION_MINUTES["One call"]
        stages = []
        for d in self.rank["decisions"]:
            if not isinstance(d, dict):
                continue
            kind = "one-call" if d.get("round") == "one-call" else "grill"
            mins = one_min * len(d.get("decisions") or []) if kind == "one-call" else d.get("minutes") or 0
            stages.append((0 if kind == "one-call" else 2, kind, d, mins))
        for u in self.rank["unpark"]:
            if isinstance(u, dict) and u.get("offer"):
                stages.append((1, "unpark", u, one_min))
        stages.sort(key=lambda x: x[0])  # stable: rank order inside each stage
        one_calls, unpark, grill, later, skipped = [], [], [], [], []
        mins = {"one-call": 0, "unpark": 0, "grill": 0}
        stopped = False
        for _, kind, item, m in stages:
            if kind != "unpark" and not self.clears(item["slug"], set()):
                skipped.append({"kind": kind, "slug": item["slug"], "blockedBy": item.get("blockedBy") or []})
                continue
            if stopped or m > left:
                stopped = True
                later.append({"kind": kind, ("project" if kind == "unpark" else "slug"):
                              item["project"] if kind == "unpark" else item["slug"], "minutes": m})
                continue
            left -= m
            mins[kind] += m
            if kind == "one-call":
                one_calls.append({"slug": item["slug"], "home": item.get("home"), "minutes": m,
                                  "decision": (item.get("decisions") or [None])[0],
                                  "blockedBy": item.get("blockedBy") or []})
            elif kind == "grill":
                grill.append({"slug": item["slug"], "home": item.get("home"), "minutes": m,
                              "decisions": item.get("decisions") or [], "blockedBy": item.get("blockedBy") or []})
            else:
                unpark.append(item)
        questions, index = [], []
        for so in asked:
            self.sign_off_q(so, questions, index)
        for oc in one_calls:
            self.one_call_q(oc, questions, index)
        for u in unpark:
            self.unpark_q(u, questions, index)
        texts = [q["question"] for q in questions]
        if len(set(texts)) != len(texts):
            fail(2, "two questions share a text; every question must open with its own [[slug]] or [[project]]")
        asks = [questions[i:i + QUESTIONS_MAX] for i in range(0, len(questions), QUESTIONS_MAX)]
        top = [{"rank": t.get("rank"), "slug": t.get("slug"), "home": t.get("home"), "grade": t.get("grade"),
                "shape": t.get("shape"), "size": t.get("size"), "leverage": t.get("leverage"),
                "dueSoon": t.get("dueSoon"), "deadline": t.get("deadline"), "review": t.get("review"),
                "blockedBy": t.get("blockedBy") or []}
               for t in self.rank["tasks"] if isinstance(t, dict) and t.get("rank") is not None][:self.top]
        used = so_min + mins["one-call"] + mins["unpark"] + mins["grill"]
        return {"schema": SCHEMA, "today": self.rank.get("today") or today_of(self.scan), "budget": self.budget,
                "top": top, "live": self.live(), "signOffs": sign, "oneCalls": one_calls, "unpark": unpark,
                "grill": grill, "later": later, "skipped": skipped, "asks": asks, "index": index,
                "minutes": {"signOffs": so_min, "oneCalls": mins["one-call"], "unpark": mins["unpark"],
                            "grill": mins["grill"], "used": used, "budget": self.budget}}

    @staticmethod
    def options(fulls, descriptions, recommend):
        opts, labels = [], []
        for k, (full, desc) in enumerate(zip(fulls, descriptions), 1):
            label, short = label_for(k, full, recommend and k == 1)
            if short:
                desc = full + (" — " + desc if desc and desc != full else "")
            opts.append({"label": label, "description": desc or full})
            labels.append(label)
        return opts, labels

    def sign_off_q(self, so, questions, index):
        n = len(so["gates"])
        text = "[[%s]] in [[%s]]: sign off its %d gated input%s, shown verbatim above?" % (
            so["slug"], so["rollout"], n, "" if n == 1 else "s")
        if so["bounced"]:
            text += (" The plan judge bounced this plan (ADR 0038): its feedback is under %s."
                     % self.M.RR.GATE_BOUNCE_SECTION)
        descs = ["Signs exactly: " + " · ".join(so["gates"]), "Leaves it set aside; nothing is written"]
        opts, labels = self.options(SIGN_OFF_OPTIONS, descs, False)
        questions.append({"question": text, "header": HEADERS["sign-off"], "multiSelect": False, "options": opts})
        index.append({"question": text, "kind": "sign-off", "slug": so["slug"], "rollout": so["rollout"],
                      "note": so["note"], "labels": labels, "texts": list(SIGN_OFF_OPTIONS), "recommended": None,
                      "bounced": so["bounced"]})

    def one_call_q(self, oc, questions, index):
        d = oc["decision"] or {}
        fulls = [o for o in d.get("options") or []]
        text = "[[%s]] %s" % (oc["slug"], d.get("question") or "")
        why = d.get("why") or "the grader's recommendation"
        descs = [why] + ["" for _ in fulls[1:]]
        opts, labels = self.options(fulls, descs, True)
        row = self.rows.get(oc["slug"]) or {}
        questions.append({"question": text, "header": HEADERS["one-call"], "multiSelect": False, "options": opts})
        entry = {"question": text, "kind": "one-call", "slug": oc["slug"], "note": row.get("note"), "labels": labels,
                 "texts": fulls, "recommended": fulls[0] if fulls else None}
        if d.get("fork"):
            entry["fork"] = d["fork"]
        index.append(entry)

    def unpark_q(self, u, questions, index):
        p = next((x for x in self.scan["projects"] if isinstance(x, dict) and x.get("note") == u.get("note")), {})
        open_tasks = [t for t in p.get("tasks") or [] if isinstance(t, str)]
        n, ready = len(open_tasks), u.get("ready") or 0
        names = ", ".join(open_tasks[:KILL_NAMES_MAX]) + (
            " and %d more" % (n - KILL_NAMES_MAX) if n > KILL_NAMES_MAX else "")
        sw = u.get("snoozeWrite") or {}
        text = "[[%s]]: %s. Unpark, snooze or kill it?" % (
            u["project"], u.get("why") or "parked with %d ready task%s" % (ready, "" if ready == 1 else "s"))
        descs = ["status: queued; its Ready, unheld work starts this pass",
                 "asked again after %s, or sooner if its Ready work grows past %s"
                 % (sw.get("snoozed_until"), sw.get("snoozed_ready")),
                 "Mark done (done: true); its %d open task%s left unhomed%s" % (
                     n, " is" if n == 1 else "s are", ": " + names if names else "")]
        opts, labels = self.options(("unpark", "snooze", "kill"), descs, False)
        questions.append({"question": text, "header": HEADERS["unpark"], "multiSelect": False, "options": opts})
        index.append({"question": text, "kind": "unpark", "project": u["project"], "note": u.get("note"),
                      "labels": labels, "texts": ["unpark", "snooze", "kill"], "recommended": None,
                      "snoozeReady": sw.get("snoozed_ready")})


def cmd_rounds(args):
    rank, scan = read_rank(args.rank), read_scan(args.scan)
    M = Mods()
    vroot = vault_root(args.vault, scan)
    emit(Rounds(M, rank, scan, vroot, args.budget, args.top).run())


# ---- plan --------------------------------------------------------------------------------------------------------

class Plan:
    def __init__(self, M, rank, scan, vroot, decided, unparked, signed):
        self.M, self.rank, self.scan, self.vroot = M, rank, scan, vroot
        self.rows = {t["slug"]: t for t in rank["tasks"] if isinstance(t, dict) and isinstance(t.get("slug"), str)}
        self.decided = {s for s, t in self.rows.items() if t.get("grade") == "Ready"} | set(decided)
        self.unparked = set(unparked)
        self.signed = set(signed)
        self._clear = {}
        self.open = {}  # the scan's tasks (open: not landed, not archived) by lower-case slug, the first one kept
        for t in self.scan["tasks"]:
            if isinstance(t, dict) and isinstance(t.get("slug"), str):
                self.open.setdefault(t["slug"].lower(), t)

    def deps(self, slug):
        """The open, not-in-flight scan tasks the task's rank dependsOn[] names, matched as the ranker matches them
        (ER.slug_key, case-insensitively), in order. reconcile-rollout's _dep_status holds a row until each lands."""
        out = []
        for link in (self.rows.get(slug) or {}).get("dependsOn") or []:
            t = self.open.get(self.M.ER.slug_key(link))
            if t is not None and not t.get("inFlight") and t["slug"] not in out:
                out.append(t["slug"])
        return out

    def home_unparked(self, slug):
        t = self.rows.get(slug) or {}
        note = next((r.get("note") for r in self.rank["runs"] if slug in (r.get("ready") or [])
                     + (r.get("waiting") or []) + (r.get("blocked") or [])), None)
        return t.get("home") in self.unparked or (note is not None and note in self.unparked)

    def clear(self, slug, visiting):
        """Every hold on the task clears this pass."""
        if slug in self._clear:
            return self._clear[slug]
        if slug in visiting:
            return False
        visiting.add(slug)
        ok = True
        for h in (self.rows.get(slug) or {}).get("blockedBy") or []:
            d, why = h.get("slug"), h.get("why")
            if why in ("One call", "Grill"):
                good = d in self.decided and self.clear(d, visiting)
            elif why == "held":
                good = self.clear(d, visiting)
            elif why == "parked":
                good = self.home_unparked(d) and self.clear(d, visiting)
            else:
                good = False
            if not good:
                ok = False
                break
        visiting.discard(slug)
        self._clear[slug] = ok
        return ok

    def standing_holds(self, slug, unscheduled):
        return [h for h in (self.rows.get(slug) or {}).get("blockedBy") or [] if not self.clear_one(h)] + [
            {"slug": d, "why": DEP_UNSCHEDULED} for d in unscheduled.get(slug) or []]

    def clear_one(self, h):
        d, why = h.get("slug"), h.get("why")
        if why in ("One call", "Grill"):
            return d in self.decided and self.clear(d, set())
        if why == "held":
            return self.clear(d, set())
        if why == "parked":
            return self.home_unparked(d) and self.clear(d, set())
        return False

    def choose(self, unscheduled):
        """(held, undecided, entries, waiting): the runs chosen with every slug in `unscheduled` held."""
        held, undecided, entries, waiting = {}, {}, [], []
        roots = {}
        for order, run in enumerate(r for r in self.rank["runs"] if isinstance(r, dict)):
            slugs = sorted(set((run.get("ready") or []) + (run.get("waiting") or []) + (run.get("blocked") or [])),
                           key=lambda s: (self.rows.get(s, {}).get("rank") is None,
                                          self.rows.get(s, {}).get("rank") or 0, s))
            parked = bool(run.get("parked"))
            unparked = parked and (run.get("project") in self.unparked or run.get("note") in self.unparked)
            members, lost = [], []
            for s in slugs:
                t = self.rows.get(s) or {}
                if s in unscheduled:  # only ever a former member, so decided with every rank hold clear
                    lost.append(s)
                    held[s] = t
                elif parked:
                    if t.get("grade") == "Ready" and not t.get("blockedBy"):
                        members.append(s)
                    elif unparked:
                        (undecided if t.get("grade") != "Ready" else held)[s] = t
                elif s not in self.decided:
                    undecided[s] = t
                elif not self.clear(s, set()):
                    held[s] = t
                else:
                    members.append(s)
            why = None
            if parked and not unparked:
                why = {"kind": "parked", "detail": "the project is parked: its Unpark offer decides"}
            elif not members and lost:
                why = {"kind": DEP_UNSCHEDULED, "detail": "every member left depends on a task no scheduled run "
                       "holds: %s" % ", ".join(sorted({d for s in lost for d in unscheduled[s]}))}
            elif not members:
                why = {"kind": "nothing decided", "detail": "no member is decided with every hold clear"}
            elif run.get("shape") == "parallel" and not run.get("root"):
                kind = run.get("why") or "repo unknown"
                why = {"kind": kind, "detail": "a parallel run needs one declared repo to root it"
                       if kind == "repo unknown" else "the project declares no repos:"}
            elif run.get("blockers"):
                why = {"kind": "blocker", "detail": "; ".join("%s: %s" % (b.get("check"), b.get("why"))
                                                              for b in run["blockers"] if isinstance(b, dict))}
            elif run.get("shape") == "parallel":
                key = run.get("rolloutRoot") or run.get("root")
                if key in roots:
                    why = {"kind": "same root", "detail": "%s goes on %s" % (roots[key], key)}
                else:
                    roots[key] = run.get("id")
            row = {"run": run.get("id"), "project": run.get("project"), "note": run.get("note"),
                   "shape": run.get("shape"), "root": run.get("root"), "rolloutRoot": run.get("rolloutRoot"),
                   "members": members}
            if why:
                row["why"] = why
                waiting.append(row)
                continue
            review = {k: sum((self.rows[m].get("review") or {}).get(k) or 0 for m in members)
                      for k in ("pr", "signOff", "eyeCheck", "minutes")}
            name = run.get("project") or ""
            row.update(projectSlug=project_slug(name), batchKeys=batch_keys(name), args="--tasks " + ",".join(members),
                       batch=None, review=review, _order=order)
            entries.append(row)
        return held, undecided, entries, waiting

    def run(self):
        # A member whose dependency no scheduled entry holds would wait on it forever, so it is held, and the runs are
        # chosen again: a run can lose every member, freeing its root and stranding its dependants. `unscheduled`
        # only grows, so this stops within one round per task.
        unscheduled = {}
        while True:
            held, undecided, entries, waiting = self.choose(unscheduled)
            scheduled = {m for e in entries for m in e["members"]}
            more = {}
            for e in entries:
                for m in e["members"]:
                    missing = [d for d in self.deps(m) if d not in scheduled]
                    if missing:
                        more[m] = missing
            if not more:
                break
            unscheduled.update(more)
        # Batches: parallel entries take the lowest batch whose keys never meet theirs; serial ones follow, one each.
        batches = []
        for e in (x for x in entries if x["shape"] == "parallel"):
            keys = set(e["batchKeys"])
            for i, b in enumerate(batches):
                if not keys & b:
                    b |= keys
                    e["batch"] = i + 1
                    break
            else:
                batches.append(set(keys))
                e["batch"] = len(batches)
        n = len(batches)
        for e in (x for x in entries if x["shape"] != "parallel"):
            n += 1
            e["batch"] = n
        entries.sort(key=lambda e: (e["batch"], e["_order"]))
        order = ("run", "project", "note", "projectSlug", "batchKeys", "shape", "root", "rolloutRoot", "members",
                 "args", "batch", "review")
        schedule = [{k: e[k] for k in order} for e in entries]
        rollouts = self.rollouts()
        projects = {p.get("note"): p for p in self.scan["projects"] if isinstance(p, dict)}
        orient = [{"name": o.get("project"), "note": o.get("note"), "area": list((projects.get(o.get("note")) or {})
                   .get("area") or [])} for o in self.rank["orient"] if isinstance(o, dict)]
        run_of = {}
        for r in self.rank["runs"]:
            for s in (r.get("ready") or []) + (r.get("waiting") or []) + (r.get("blocked") or []):
                run_of[s] = r.get("id")
        return {
            "schema": SCHEMA, "vault": self.vroot, "today": self.rank.get("today") or today_of(self.scan),
            "schedule": schedule, "waiting": waiting, "rollouts": rollouts,
            "reinstate": [r["slug"] for r in rollouts if r["reinstate"]], "orient": orient,
            "held": [{"slug": s, "run": run_of.get(s), "grade": t.get("grade"),
                      "blockedBy": self.standing_holds(s, unscheduled)} for s, t in sorted(held.items())],
            "undecided": [{"slug": s, "run": run_of.get(s), "grade": t.get("grade")}
                          for s, t in sorted(undecided.items())],
            "sessionLane": [{"slug": t["slug"], "home": t.get("home"), "grade": t.get("grade")}
                            for t in sorted(self.rows.values(), key=lambda t: t["slug"])
                            if t.get("shape") == "session" and t.get("grade") != "Orient"],
        }

    def rollouts(self):
        RR, ER, NA = self.M.RR, self.M.ER, self.M.NA
        rows = [r for r in self.scan["rollouts"] if isinstance(r, dict)]
        named = {ER.slug_key(r["supersedes"]) for r in rows if r.get("supersedes")}
        owners = {}
        vault = NA.Vault(self.vroot)
        for t in self.scan["tasks"]:
            if isinstance(t, dict) and t.get("rollout") and isinstance(t.get("note"), str):
                owner = vault.note(os.path.join(*t["note"].split("/"))).get("owner")
                if isinstance(owner, str) and owner.strip():
                    owners.setdefault(ER.slug_key(t["rollout"]), set()).add(owner.strip())
        out = []
        for r in sorted(rows, key=lambda x: str(x.get("slug"))):
            s = r.get("summary") if isinstance(r.get("summary"), dict) else None
            note, stamped, shape = None, False, "parallel"
            try:
                note = RR.Note(Path(os.path.join(self.vroot, *str(r.get("note")).split("/"))))
                stamped, shape = RR._start_unattended(note), RR._shape(note)
            except (OSError, ValueError, UnicodeDecodeError):
                pass
            counts = (s or {}).get("counts") or {}
            holds = set()
            if r.get("supersededBy"):
                holds.add("superseded")
            if ER.slug_key(r.get("slug") or "") in named:
                holds.add("lineage")
            if not is_five(r.get("protocolVersion")):
                holds.add("version")
            if s and s.get("incomplete"):
                holds.add("incomplete")
            if shape == "serial":
                holds.add("serial")
            if s and s.get("paused"):
                holds.add("paused")
            if s and s.get("pause_requested"):
                holds.add("draining")
            if (counts.get("running") or 0) + (counts.get("integrating") or 0) > 0:
                holds.add("live queue")
            if stamped:
                holds.add("start stamp")
            if s is None:
                holds.add("status unread")
            holds = [h for h in HOLDS if h in holds]
            pending = [x for x in (s or {}).get("pendingSignOffs") or [] if isinstance(x, str)]
            reinstate = bool(s and s.get("awaitingSignOff") and all(p in self.signed for p in pending))
            row = {"slug": r.get("slug"), "note": r.get("note"), "shape": shape, "projectRoot": r.get("projectRoot"),
                   "pausedFor": (s or {}).get("pausedFor")}
            mine = owners.get(ER.slug_key(r.get("slug") or ""))
            if mine:
                row["owners"] = sorted(mine)
            row.update(holds=holds, canExecute=not holds or (reinstate and holds == ["paused"]),
                       canRepair=not (set(holds) & NO_REPAIR), reinstate=reinstate)
            out.append(row)
        return out


def cmd_plan(args):
    rank, scan = read_rank(args.rank), read_scan(args.scan)
    if args.assume_answered and not args.rounds:
        fail(2, "--assume-answered needs --rounds")
    if args.rounds and not args.assume_answered:
        fail(2, "--rounds is read only with --assume-answered (the dry run)")
    decided = list(args.decided or [])
    if args.rounds:
        r = read_json(args.rounds, "rounds", SCHEMA)
        decided += [x.get("slug") for x in (r.get("oneCalls") or []) + (r.get("grill") or [])
                    if isinstance(x, dict) and isinstance(x.get("slug"), str)]
    M = Mods()
    vroot = vault_root(args.vault, scan)
    emit(Plan(M, rank, scan, vroot, decided, args.unparked or [], args.signed or []).run())


# ---- sessions ----------------------------------------------------------------------------------------------------

def queue_row1(M, note):
    """(alias, folder) of the `## Queue` table's first data row, read with leg.py's own row grammar, or (None, None)."""
    LEG = M.LEG
    found = note._section_bounds(LEG.QUEUE)
    if found is None:
        return None, None
    lines, start, end = found
    for k in range(start + 1, end):
        cells = LEG.split_cells(lines[k])
        if len(cells) < 3 or not LEG.LINK_RE.search(cells[1]):
            continue
        m = LEG.LAUNCH_RE.match(cells[2])
        return (m.group(1), m.group(2)) if m else (None, None)
    return None, None


def cmd_sessions(args):
    plan = read_json(args.plan, "plan", PLAN_SCHEMA)
    for key in ("rollouts", "orient", "schedule"):
        if not isinstance(plan.get(key), list):
            fail(2, "the plan %s has no %s list" % (args.plan, key))
    rollouts = {r["slug"]: r for r in plan["rollouts"] if isinstance(r, dict) and isinstance(r.get("slug"), str)}
    status = {}
    for raw in args.status or []:
        slug, sep, n = raw.partition("=")
        if not sep or slug not in rollouts:
            fail(2, "--status %s: name a rollout of the plan as SLUG=N" % raw)
        if not re.fullmatch(r"\d+", n.strip()) or not 1 <= int(n) <= 13:
            fail(2, "--status %s: N is the status § 4 action number, 1 to 13" % raw)
        status[slug] = int(n)
    M = Mods(leg=True)
    RR, NA = M.RR, M.NA
    vroot = vault_root(args.vault, plan)
    tasks_dir = os.path.realpath(os.path.join(vroot, NA.TASKS_DIR))
    vault = NA.Vault(vroot)
    today = today_of(plan)
    wrote = []
    for p in args.wrote or []:
        full = os.path.realpath(os.path.expanduser(p))
        if os.path.dirname(full) != tasks_dir or not full.endswith(".md") or not os.path.isfile(full):
            fail(2, "--wrote %s: not a note directly in %s" % (p, tasks_dir))
        wrote.append(full)
    items = []
    for full in wrote:
        slug = os.path.basename(full)[:-3]
        rel = os.path.relpath(full, vault.root).replace(os.sep, "/")
        try:
            note = RR.Note(Path(full))
        except (OSError, ValueError, UnicodeDecodeError) as e:
            fail(2, "--wrote %s: %s" % (full, e))
        if RR._shape(note) == "serial":
            alias, folder = queue_row1(M, note)
            items.append({"kind": "leg", "rollout": slug, "note": rel, "title": titled("Leg 1: %s" % slug),
                          "cwd": os.path.expanduser(folder) if folder else None, "alias": alias,
                          "prompt": "/thread:execute [[%s]]\nLeg 1 of the serial chain; the brief is the rollout "
                                    "note: %s" % (slug, full),
                          "tldr": "Leg 1 of the serial rollout orient-all scheduled this pass. It works the chain's "
                                  "first tasks and hands the rest on.",
                          "manual": not alias or alias.startswith("cx-") or not folder, "why": "written this pass"})
        else:
            m = RR.PROJECT_ROOT_RE.search(note._body)
            cwd = os.path.expanduser(m.group(1).strip()) if m else None
            items.append({"kind": "execute", "rollout": slug, "note": rel, "title": titled("Execute: %s" % slug),
                          "cwd": cwd, "prompt": "/thread:execute [[%s]]" % slug,
                          "tldr": "Runs the parallel rollout orient-all scheduled this pass, to the end.",
                          "manual": cwd is None, "why": "written this pass"})
    executes, repairs, left = [], [], []
    for slug in sorted(rollouts):
        r = rollouts[slug]
        n = status.get(slug)
        if n is None:
            left.append({"rollout": slug, "action": None, "holds": r.get("holds") or [], "why": "status unread"})
            continue
        kind, words = STATUS_ACTIONS[n]
        root = os.path.expanduser(r["projectRoot"]) if r.get("projectRoot") else None
        # canExecute is every hold clear, but for the sign-off pause when every gate is signed (reinstate): so a
        # reinstate needs both, and a sign-off pause with any other hold (serial, a start stamp, a drain) gets nothing.
        if kind in ("execute", "reinstate") and r.get("canExecute") and (kind == "execute" or r.get("reinstate")):
            why = ("status action 8: the sign-off pause, every gate signed this pass" if kind == "reinstate"
                   else "status action %d: %s" % (n, words))
            executes.append({"kind": "execute", "rollout": slug, "note": r.get("note"),
                             "title": titled("Execute: %s" % slug), "cwd": root,
                             "prompt": "/thread:execute [[%s]]" % slug,
                             "tldr": "Moves a live rollout on, as its status report recommends.",
                             "manual": root is None, "why": why})
        elif kind == "repair" and r.get("canRepair"):
            repairs.append({"kind": "repair", "rollout": slug, "note": r.get("note"),
                            "title": titled("Repair: %s" % slug), "cwd": root, "prompt": "/thread:repair [[%s]]" % slug,
                            "tldr": "Sorts out a live rollout that status says needs repair.",
                            "manual": False, "why": "status action %d: %s" % (n, words)})
        else:
            if kind is None:
                why = "status action %d (%s) starts nothing from here" % (n, words)
            elif kind == "reinstate" and r.get("reinstate"):
                why = "status action 8 (%s): every gate signed, but held by %s" % (
                    words, ", ".join(h for h in r.get("holds") or [] if h != "paused") or "nothing")
            elif kind == "reinstate" and r.get("pausedFor") == "sign-off":
                why = "status action 8 (%s): a gate is still unsigned, so the sign-off pause holds" % words
            elif kind == "reinstate" and "paused" in (r.get("holds") or []):
                why = "status action 8 (%s): paused by you: the reinstate is yours" % words
            elif kind == "reinstate":
                why = "status action 8 (%s), but the plan reads no sign-off pause to reinstate" % words
            else:
                why = "status action %d (%s) held by %s" % (n, words, ", ".join(r.get("holds") or []) or "nothing")
            left.append({"rollout": slug, "action": n, "holds": r.get("holds") or [], "why": why})
    orients = []
    projects = {}
    for full in wrote:
        rel = os.path.relpath(full, vault.root)
        for link in NA.links_in(vault.note(rel).get("projects")):
            prel, why = vault.resolve_project(link, link=True)
            if prel:
                projects.setdefault(prel.replace(os.sep, "/"), []).append(os.path.basename(full)[:-3])
    for o in plan["orient"]:
        if not isinstance(o, dict) or not isinstance(o.get("name"), str):
            continue
        lines = ["/thread:orient [[%s]]" % o["name"]]
        for slug in projects.get(o.get("note"), []):
            lines.append("orient-all wrote [[%s]] for this project on %s and is starting its execute; leave that "
                         "rollout to it, its tasks are in flight." % (slug, today))
        orients.append({"kind": "orient", "project": o["name"], "note": o.get("note"),
                        "title": titled("Orient: %s" % o["name"]), "prompt": "\n".join(lines),
                        "tldr": "Orients this project: its open work needs decisions that shape it.",
                        "manual": False, "why": "graded Orient"})
    emit({"schema": SCHEMA, "today": today, "items": items + executes + repairs + orients, "left": left})


# ---- record ------------------------------------------------------------------------------------------------------

def body_headings(lines, first):
    """[(index, stripped text)] of every `## ` line from `first` on, outside a fence."""
    out, fence = [], False
    for i in range(first, len(lines)):
        ln = lines[i].rstrip("\r\n")
        if FENCE.match(ln):
            fence = not fence
            continue
        if not fence and ln.startswith("## "):
            out.append((i, ln.strip()))
    return out


def section_span(lines, first, heading):
    """(heading index, end index) of the first `heading` outside a fence, or None."""
    heads = body_headings(lines, first)
    for k, (i, text) in enumerate(heads):
        if text == heading:
            return i, heads[k + 1][0] if k + 1 < len(heads) else len(lines)
    return None


def insert_last(lines, span, line):
    """`line` placed after the section's last non-blank line (just under its heading, after a blank, when empty)."""
    h, end = span
    last = max((i for i in range(h + 1, end) if lines[i].strip()), default=None)
    if last is None:
        return lines[:h + 1] + ["\n", line + "\n"] + lines[h + 1:]
    if not lines[last].endswith("\n"):
        lines = lines[:last] + [lines[last] + "\n"] + lines[last + 1:]
    return lines[:last + 1] + [line + "\n"] + lines[last + 1:]


SELF_LINK = re.compile(r"\[\[([^\[\]]*)\]\](?:\s+|$)")


def without_self_link(q, slug, slug_key):
    """The folded question with a leading link to its own task (`[[<slug>]] `, as a rounds index text opens) cut, so
    the bullet never links the note to itself and the bare question reads as the same answer."""
    m = SELF_LINK.match(q)
    return q[m.end():] if m and slug_key("[[%s]]" % m.group(1)) == slug.lower() else q


def latest_end_forks(lines, span):
    """(index, forks) of the last `orient end:` line in the section, or (None, [])."""
    hit = None
    for i in range(span[0] + 1, span[1]):
        if END_MARK in lines[i]:
            hit = i
    if hit is None:
        return None, []
    forks = []
    for piece in lines[hit].rstrip("\r\n").split(FORK_MARK)[1:]:
        forks.append(fold(re.split(r";\s*evidence:|;", piece, maxsplit=1)[0]))
    return hit, forks


def cmd_record(args):
    q, a, rec = fold(args.question), fold(args.answer), fold(args.recommended)
    fork = fold(args.fork) if args.fork is not None else None
    for flag, v in (("--question", q), ("--answer", a), ("--recommended", rec), ("--fork", fork)):
        if v == "":
            fail(2, "%s is empty" % flag)
    M = Mods()
    NA, ES = M.NA, M.ES
    vroot = os.path.expanduser(args.vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    vault = NA.Vault(vroot)
    try:
        rel = vault.resolve_task(args.task)
    except NA.Refused as e:
        fail(2, str(e))
    shown = rel.replace(os.sep, "/")
    q = without_self_link(q, os.path.basename(rel)[:-3], M.ER.slug_key)
    if q == "":
        fail(2, "--question is empty once its leading [[%s]] is stripped" % os.path.basename(rel)[:-3])
    note = NA.Note.load(os.path.join(vault.root, rel))
    if note.fm is None:
        fail(2, "%s: %s" % (shown, note.error))
    if "task" not in NA.tags_of(note):
        fail(2, "%s is not a task note" % shown)
    st = NA.status_of(note)
    if st not in NA.OPEN_STATUSES:
        fail(2, "%s is at status %s, not Active; a decision is written only into Active work" % (shown, st or "none"))
    if ES.in_flight(st, ES.link_live(NA, vault, ES.first_link(NA, note.get("rollout")))):
        fail(2, "%s is in flight (vault-grammar.md § In flight); its run owns the note, so the answer is not written"
             % shown)
    lines = list(note.lines)
    first = note.span[1] + 1
    notes = section_span(lines, first, NOTES_HEADING)
    ruled = False
    if fork is not None:
        end_at, forks = latest_end_forks(lines, notes) if notes else (None, [])
        if fork not in forks:
            fail(2, "%s: its latest orient end line names no `fork for Lachy: %s`" % (shown, fork))
        tail = " orient ruling: %s → %s" % (fork, a)
        ruled = any(ln.rstrip("\r\n").endswith(tail) for ln in lines[end_at + 1:notes[1]])
    bullet = DECISION_BULLET.format(question=q, answer=a, recommended=rec)
    heading = DECISIONS_HEADING.format(date=args.today.isoformat())
    span = section_span(lines, first, heading)
    has = span is not None and any(lines[i].rstrip("\r\n") == bullet for i in range(span[0] + 1, span[1]))
    if has and (fork is None or ruled):
        sys.stdout.write("%s: %s → %s [no-change]\n" % (shown, q, a))
        return
    if fork is not None and not ruled:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        lines = insert_last(lines, notes, RULING_LINE.format(stamp=stamp, fork=fork, answer=a))
    if not has:
        span = section_span(lines, first, heading)
        if span is not None:
            lines = insert_last(lines, span, bullet)
        else:
            text = "".join(lines)
            if text and not text.endswith("\n"):
                text += "\n"
            if text and not text.endswith("\n\n"):
                text += "\n"
            lines = NA.split_lines(text + heading + "\n\n" + bullet + "\n")
    try:
        note.save("".join(lines))
    except OSError as e:
        fail(2, "cannot write %s: %s" % (shown, e))
    sys.stdout.write("recorded %s: %s → %s\n" % (shown, q, a))


# ---- main --------------------------------------------------------------------------------------------------------

def parse(argv):
    p = Parser(prog="estate-dispatch", allow_abbrev=False,
               description="The estate pass's decision round and dispatch plan (skills/orient-all/SKILL.md).")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    s = sub.add_parser("slices", allow_abbrev=False)
    s.add_argument("--scan", required=True)
    s.add_argument("--dir", required=True)
    r = sub.add_parser("rounds", allow_abbrev=False)
    r.add_argument("--rank", required=True)
    r.add_argument("--scan", required=True)
    r.add_argument("--budget", required=True)
    r.add_argument("--top", default=str(TOP_DEFAULT))
    r.add_argument("--vault")
    pl = sub.add_parser("plan", allow_abbrev=False)
    pl.add_argument("--rank", required=True)
    pl.add_argument("--scan", required=True)
    pl.add_argument("--decided", action="append", default=[])
    pl.add_argument("--unparked", action="append", default=[])
    pl.add_argument("--signed", action="append", default=[])
    pl.add_argument("--rounds")
    pl.add_argument("--assume-answered", action="store_true")
    pl.add_argument("--vault")
    se = sub.add_parser("sessions", allow_abbrev=False)
    se.add_argument("--plan", required=True)
    se.add_argument("--wrote", action="append", default=[])
    se.add_argument("--status", action="append", default=[])
    se.add_argument("--vault")
    rc = sub.add_parser("record", allow_abbrev=False)
    rc.add_argument("--task", required=True)
    rc.add_argument("--question", required=True)
    rc.add_argument("--answer", required=True)
    rc.add_argument("--recommended", required=True)
    rc.add_argument("--fork")
    rc.add_argument("--today")
    rc.add_argument("--vault", default=VAULT_DEFAULT)
    args = p.parse_args(argv)
    if not args.verb:
        fail(2, "a verb is required: slices | rounds | plan | sessions | record")
    if args.verb == "rounds":
        for flag in ("budget", "top"):
            v = getattr(args, flag)
            if not re.fullmatch(r"\d+", v.strip()):
                fail(2, "--%s must be a whole number of %s, 0 or more: %r"
                     % (flag, "minutes" if flag == "budget" else "rows", v))
            setattr(args, flag, int(v.strip()))
    if args.verb == "record":
        args.today = parse_date(args.today, "--today") if args.today else datetime.date.today()
    return args


VERBS = {"slices": cmd_slices, "rounds": cmd_rounds, "plan": cmd_plan, "sessions": cmd_sessions, "record": cmd_record}


def main(argv):
    args = parse(argv)
    VERBS[args.verb](args)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
