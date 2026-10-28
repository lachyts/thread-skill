#!/usr/bin/env python3
"""attention.py — the weekly reading's attention ledger (p30-7, ADR 0056). This docstring is the one copy of its rules.

python >= 3.9, stdlib only (zoneinfo). skills/reflect/scripts/reflect.py loads it by path, as it loads ledger.py: span's
`attention` block (block()), the `attention` verb (ledger_line(), circling_items(), fresh_items(), watch_line()), `watch`'s
refusal of a circling rule (CIRCLING_RULE_TEXTS), and the decide and close gates. It reads only and writes nothing but
--out. The CLI is for tests and by-hand reads, and loads reflect.py inside main() (as grades.py does), so the two never
import each other in a cycle:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/attention.py span-block --since TS --until TS [--tasks-dir D] \\
        [--out F]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/attention.py tally --span F [--owners F] --session P [...]

What it reuses, loaded by path and never copied: run_record.py (RR: SLUG_RE, RESERVED, watch_id, ATTENTION_OWNERS, the
schema of the `attention` line), score.py (SCORE: read_lines, to_ms, fmt), reconcile-project.py (RP: Rec, LANDED),
escapes.py (ESC: GIT_TIMEOUT, MERGE_PR_RE) and ledger.py (LEDGER: CLOSED, its closed rollout statuses; never its rows).
reflect.py passes the rest as callbacks, so each rule stays stated once: the Run record read whole (Span.whole), the vault's
find and index (Vault: Work/Tasks, then anywhere under it, Archive included), a quiet origin (land.sh --origin-slug,
cached), git_env(), tune.py's close_line over tunings.jsonl, and mdate (an instant's Melbourne date).

Words. The ask tool is ASK_TOOL; the rule every verb follows before it asks Lachy anything is
skills/_shared/asking.md (the question gate, ADR 0054), whose § 1 labels each question's Owner. "Loop" is never this
module's word: ~/.agents/knowledge/reflection-loops.md calls each Reflection a loop, and the engine's convergence of
plan, verify and review rounds is the review loop (CONTEXT.md). What this module finds is a Review trail, a Wait to start
and Circling (CONTEXT.md § Run record and tuning).

No stderr during span: every fault is a flag prefixed `attention: ` or a cannotShow line, and a fault that escapes is
span's `attention: read failed (...)` flag with a null block. No network, and no git write: every git call is read-only,
under git_env() and ESC.GIT_TIMEOUT, cached per (repo, arguments).

The transcripts. transcript_dirs(): THREAD_TRANSCRIPTS_DIR when set (tests; a missing one is an empty read and a flag),
else the union of ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects and $HOME/.claude-profiles/*/projects, deduplicated by
realpath. Only <dir>/*/*.jsonl is read, never a subagents/ directory. A file is read when its mtime is at or after the
floor: the earliest of since, until - TOUCH_DAYS and the first round of each Review trail read (one with a round in
[since, until]: the trails are keyed before any transcript is read, so a round in no such trail never moves the floor,
and none is older than since - TRAIL_DAYS). A line is parsed only when it holds ASK_TOOL, `[[`, `Work/Tasks/` or
`skills/reflect/scripts/`, or is a tool_result naming a call of ASK_TOOL already seen; only entries of `type` user or
assistant with a `timestamp` and no `isSidechain` are read (a subagent's chain and any other copy, an api-request say,
are not). Each entry is the Session's named by its `sessionId` (else the file's
stem), with its `cwd` and `gitBranch`. An unreadable file is named in cannotShow.

The Question ledger. Every ASK_TOOL call whose tool_use stamp falls in [since, until], read once by its call id (a
resumed or forked copy is the same call: the earliest copy is kept). Each question is one item, id `<callId>#<i>`
(i from 0): session, cwd, at, repo (the cwd with `/.claude/worktrees/<x>` folded off, then its origin's owner/name,
else the folded path's basename), header (cut to 60), question (cut to QUESTION_MAX), options (label; description cut
to DESCRIPTION_MAX), multiSelect, recommended (the first option whose label holds `(Recommended)`, any case, else null),
answer (cut to QUESTION_MAX), ownWords, pickedRecommended, note, outcome, answeredAt, heldHours, callQuestions and
handedAfterStop. The call's result is its earliest tool_result at or before until, read from the entry's
toolUseResult (answers and annotations keyed by the question's text), else from its text. Outcomes:
- answered: an answer that is no dismissal. ownWords: the answer is none of the labels (a multi-select: something left
  once every label is taken out); pickedRecommended (null with no recommended option): the recommended label is the
  answer (a multi-select: it is present in it); note: the annotation's notes (cut to QUESTION_MAX), else null.
- dismissed: the call or that question dismissed (`[User dismissed`, `The user doesn't want to proceed`, `The user did not
  answer`).
- dropped: the Turn ended or the call was interrupted before a result (`the Turn ended`, `[Tool call interrupted`).
- failed: a tool-use error (`<tool_use_error>`, an InputValidationError) or a permission abort (`Tool permission
  request failed`): he never saw it, so it is never counted as asked.
- open: no result at or before until.
- unparsed: a result none of the above reads, or an answered call with no answer for this question: counted as asked,
  and flagged.
Held hours are the result's stamp (until for an open call) less the ask's, per call; a call counts once, and its hours
split evenly over its questions by Owner. question_counts(items, owners=None) is the one counter, for the line and for
`tally`: asked (every outcome but failed), calls, answered, dismissed, dropped, open, failed, unparsed;
recommended {offered, picked} over answered questions only; notes and ownWords over answered questions; hoursHeld (per
call); longest (the LONGEST calls held longest); byRepo (asked per repo, the top BY_REPO and `other`); and with owners
({id: owner}, an owner one of RR.ATTENTION_OWNERS) byOwner and hoursByOwner over every owner, plus unlabelled, the
asked questions the map leaves out, counted as `unknown`. The Owner is the reading's label by asking.md § 1, never this
module's: span leaves it out, and `reflect.py attention --owners` brings it in.

Review trails. The /fresh-review rounds in reviews.jsonl (run_record's REVIEWS), its `review-round` lines stamped at or
before until, deduplicated by run_record's reader rule: the latest line per (repo, doc) when doc is set, else per (repo,
head, digest) (a local copy: score.py's fresh_review_rounds and reflect.py's Span.fresh_review keep their own, and a
shared reader, once one lands, replaces all three). A round's time is its `reviewedAt`, else the first line of its key;
a round whose time is before since - TRAIL_DAYS is never keyed, so the git reads and the transcripts' floor stay
bounded as the file grows (a trail reaches back at most that far).
Each round's checkout (its `repo`) resolves to a main repo: an existing path through `git rev-parse --path-format=absolute --git-common-dir`; a gone path
holding `/.claude/worktrees/`, the part before it; another gone path `<parent>/<base>`, the longest sibling
`<parent>/<name>` with `<base>` starting `<name>-` whose repo holds the head's object; else none (cannotShow, for a
trail read). The identity is the main repo's origin (owner/name), else its path; the ref is refs/remotes/origin/HEAD,
else exactly one of origin/main and origin/master, else HEAD. Nothing is fetched, so trails read local refs as they
stand. A round's key, the first that matches:
1. landing: the head is on the ref and the oldest commit of the ref's first-parent chain that holds it (the chain read
   once per repo, against `git rev-list --ancestry-path <head>..<ref>`) is a merge whose first parent is not the head:
   key (identity, the merge), label `#N` by MERGE_PR_RE on its subject, else the short sha;
2. branch: the line's `branch`, or exactly one branch tip holding the head (refs/heads and refs/remotes, a remote's
   name and `HEAD` dropped, so `x` and `origin/x` are one branch), only while the head is not on the ref: key
   (identity, the branch);
3. no key: a head on the ref with no landing merge (a fast-forward), several branches, or an unreadable repo. The round
   joins its checkout's previous keyless trail when it is at most KEYLESS_GAP_HOURS later and its head descends from
   that trail's last head (with ancestry unreadable, the gap alone decides); else it starts a path run of its own,
   labelled by the checkout's basename.
A trail with a round in [since, until] is read whole (back to since - TRAIL_DAYS), up to until; one with none is not
read. Keying needs git alone; only stopsHanded needs the transcripts. Per trail: label, key (landing | branch | path),
identity, checkouts, rounds, codeRounds, simplifyRounds, stopRounds, stops (STOP entries: the stop rounds that follow
a round that was no stop, or open the trail), stopsHanded (the stop rounds a question followed within HANDED_MINUTES
from a main-chain Session whose cwd is that round's checkout), handedAfterStop (those
questions' ids, at most HANDED_MAX), findings, regression, first, last and docsOnly: the paths `git diff --name-only
<base> <last head> -- . ':!docs/reviews'` lists, from the base `git merge-base <last head> <merge>^1` on a landing,
else `git merge-base <last head> <ref>`; true when the list is not empty and every path is under docs/ or a top-level
*.md, false otherwise, and null (cannotShow) when no base reads: a gone repo or object, or a keyless run whose head is on
the ref (a fast-forward or a squash's own commit leaves no merge to read the PR from). The counts sum the trails, and
engineStops counts the Run record's `set-aside` lines in [since, until] with reasonClass `review-rounds` (the engine's
own round cap, beside the trails).

Waits to start. One row per rollout whose first `slot-taken` falls in [since, until], or that is open at until (by
rollout_end()) with none. ask: the earliest `captured:` of the task notes its `## Queue` rows link (`| # | Task | Scope |
Mode |`, a `[[slug|label]]` through find, a row whose Mode starts `carried (` skipped: that task was asked for another
rollout), else the rollout note's own `captured:`, counted from the start of its Melbourne day; scheduled: the note's
`captured:`; started: the first slot-taken. hours and scheduleHours run from ask and scheduled to started (until while
open, never below 0); open is no start by until. A serial chain has no Slot, so it has no row (cannotShow). A linked
task with no note is flagged; with no date anywhere the row is skipped and flagged. A `captured:` no calendar holds
(2026-02-30), wherever it is read (a queue's task, a rollout note, a superseding note), reads as none and is named in
cannotShow (captured_day()), never a fault that costs the block.

rollout_end(), the first that matches: (1) its close line's stamp (tune.py's close_line); (2) its `completed:`; (3) the
`captured:` of the note `superseded_by:` names; (4) a status in LEDGER.CLOSED: the record's last line (a note with no
record never reaches this rule: its status already decided it, below); (5) none, open. A date-only end lasts through its
Melbourne day. Notes resolve through find, Archive included, never by Span's rollout_note; being archived never by itself
means merged or closed.

Circling. Two detectors, each a Watch under ADR 0037 counted in readings (RULES, worded here once; no ADR number in the
text, so a renumbered ADR changes no id):
- A touch is a slug named in a main-chain user prompt (never a tool_result) or a tool_use's input, as `[[slug` followed by
  `]`, `|` or `#`, or as `Work/Tasks/.../<slug>.md`, stamped in [until - TOUCH_DAYS, until]; it counts once per Session.
  A touch means the note was named, not that work was done.
- A reading's own Sessions never count, on either rule. reading_sessions(): a Session whose main chain runs one of the
  Reflection's reading steps, a `Bash` tool_use whose command matches READING_RE (an interpreter, then the script's
  path, then reflect.py's `span` verb, a reflect.py or attention.py verb with `--span`, or score.py or serial-score.py),
  read anywhere in its file, whatever the stamp. Why: the reading's step 11 trace and step 15 `why` name each item it
  lists, so counting it would feed the detector its own reads (the 25 Oct reading traced p27-5, and would have been its
  sixth Session by 27 Oct). A grep, an edit or `rung` marks nothing; a dev Session that runs those verbs to test them
  loses its touches, and a reading run through a shell variable keeps its own (cannotShow). circling.readings lists the
  first 8 characters of each such Session that touched any slug in the window (at most READINGS_MAX): span's alone,
  never the line's.
- W1: a slug touched by CIRCLE_SESSIONS or more Sessions whose note (through find) has that exact stem, passes SLUG_RE
  and is not RESERVED, passes RP.Rec.is_task and carries `phase:`, `pr:` or `rollout:` (a work item); any other is
  skipped, and named in cannotShow when its note exists. It must be unmerged at until: no `merged:` stamp at or before
  it, no `completed:` day ended by it, no record `merged` line for it at or before it, and not Landed with no stamp (an
  archived open note is not merged). And no rollout holds it at until: no `slot-taken` for it at or before until in any
  record, or its last `set-aside` at or before until is later than its last `slot-taken` at or before until. Why: an item
  in a Slot, in review or in the Integration lane is the engine's, whose round settings cap its rounds and whose
  Time-lost ledger prices its rework, plan blocks and stalls; the Sessions that schedule and lead a rollout name its
  items, so counting them would measure how long the rollout ran; and once set aside it circles again, so W1 counts it.
  An item's entry carries heldBy {rollout, reasonClass, stage, at} of that set-aside, else null.
- W2: every non-reserved record with a line at or before until (its note through find; one with none is skipped and
  named), and each note-only candidate from the index's paths: tagged `rollout` and not `reference`, a status outside
  LEDGER.CLOSED, no record, a stem passing SLUG_RE and not RESERVED, and a `protocol_version:` or a `## Queue` heading;
  it starts at its `captured:` day. A `reference` note (the Rollouts hub) and a note-only one whose status is closed are
  skipped silently; any other is named, `<relative path>: tagged rollout but not a rollout note (<why>)`. Listed when it
  began at or before until, is open at until by rollout_end(), has run OPEN_HOURS or more, and has no `merged` line at
  or before until (a serial chain: no Leg-log `done` either).
- Each item carries slug, sessions (its touching Sessions, readings left out), questions (asked in those Sessions in
  [since, until]) and, on W2, hours.
circling_items(block) is the one source of the line's lists and the Watch lines: an item whose slug fails SLUG_RE or is
RESERVED is dropped there, with its rule, so run_record never refuses the write. fresh_items(lines, rule, items) walks
the rule's `watch` and `watch-raised` lines by the Watch rule's cycles and returns the items no closed cycle named: a
decided item (yes or no) never returns on its rule, and a partial overlap writes its fresh items alone, in a cycle that is
quiet until its second reading. watch_line(rule, items, rid): the rule's id, rule and shape, `circling` the rule, rollouts
the items by sessions (W2: hours) descending then slug, cut to 64, count their number.

block(): {questions {items, counts}, trails {items, counts}, waits, circling {W1, W2, readings}, watches {W1, W2: {id,
rule, shape, fresh, held}}, trend (up to TREND earlier readings' `attention` lines, the last per Reflection), flags,
cannotShow}. ledger_line(block, owners, rest_unknown): the `attention` line (run_record's schema): reflection, since,
until, questions (question_counts with owners), trails (the counts), waits (at most WAITS_MAX) and circling {W1, W2} (at
most CIRCLE_MAX each); a line over run_record's MAX_LINE is trimmed, the circling lists and the waits first, flagged.

tally (read-only). The questions of span.json's attention block whose session starts with a --session prefix (at least
8 characters, matching exactly one Session), with --owners F joined: {sessions {id: counts}, total: counts}, each
question_counts() over those items. Exit 2: a prefix under 8 characters, unmatched or ambiguous, a span with no
attention block, an owners file that is no object; 1: a file cannot be read.

Exit codes (the CLI): 0 printed; 1 a file cannot be read or written; 2 usage or a refusal above; 3 no tz data.
"""
from __future__ import annotations

import argparse
import datetime
import glob
import importlib.util
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
SHARED = os.path.join(SKILLS, "_shared", "scripts")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", os.path.join(SHARED, "run_record.py"))
SCORE = _load("thread_score", os.path.join(HERE, "score.py"))
RP = _load("thread_reconcile_project", os.path.join(SHARED, "reconcile-project.py"))
ESC = _load("thread_escapes", os.path.join(HERE, "escapes.py"))
LEDGER = _load("thread_ledger", os.path.join(HERE, "ledger.py"))

ZONE = "Australia/Melbourne"
ASK_TOOL = "AskUserQuestion"   # the question tool; skills/_shared/asking.md is the rule before every ask (q2)
HOUR = 3600 * 1000
MINUTE = 60 * 1000
TOUCH_DAYS = 14
TRAIL_DAYS = 28
CIRCLE_SESSIONS = 3
OPEN_HOURS = 48
HANDED_MINUTES = 30
KEYLESS_GAP_HOURS = 12
QUESTION_MAX = 300
DESCRIPTION_MAX = 160
HEADER_MAX = 60
LABEL_MAX = 120
BY_REPO = 12
LONGEST = 5
WAITS_MAX = 16
CIRCLE_MAX = 32
HANDED_MAX = 8
READINGS_MAX = 16
WATCH_MAX = RR.MAX_ROLLOUTS
TREND = 8
OWNERS = RR.ATTENTION_OWNERS
FLAG = "attention: "

RULES = {"W1": ("Circling: three or more Sessions touch a work item without it merging",
                "a work item circles across Sessions"),
         "W2": ("Circling: a rollout open 48 hours with nothing merged",
                "a rollout merges nothing in its first 48 hours")}
CIRCLING_IDS = {k: RR.watch_id(*v) for k, v in RULES.items()}
CIRCLING_RULE_TEXTS = {v[0] for v in RULES.values()}

# A Session that runs one of the Reflection's reading steps (the module docstring's Circling rule).
READING_RE = re.compile(r"python3?(?:\.\d+)?\s+(?:-\S+\s+)*[\"']?\S*skills/reflect/scripts/(?:(?:reflect|attention)\.py[\"']?\s+(?:span(?![\w-])|[a-z][a-z-]*\s+(?:[^|;&\n]*\s)?--span\b)|(?:serial-)?score\.py\b)")
READING_HINT = "skills/reflect/scripts/"
RESULT_MARK = '"type":"tool_result"'
RESULT_ID_RE = re.compile(r'"tool_use_id":\s*"([^"]+)"')
WIKI_TOUCH_RE = re.compile(r"\[\[([^\[\]|#\n]+?)(?=[\]|#])")
PATH_TOUCH_RE = re.compile(r"Work/Tasks/(?:[^\s\"'`()\[\]|]*/)?([^/\s\"'`()\[\]|]+)\.md")
RECOMMENDED_RE = re.compile(r"\((?:[^)]*\b)?recommended\b[^)]*\)", re.I)
DATE_RE = re.compile(r"\d{4}-\d\d-\d\d\Z")
LEG_DONE_RE = re.compile(r"^- (\S+) Leg \d+ done\b")
QUEUE_HEAD_RE = re.compile(r"^##\s+Queue\b", re.M)
CELL_SPLIT_RE = re.compile(r"(?<!\\)\|")
DISMISSED = ("[User dismissed", "The user doesn't want to proceed", "The user did not answer")
DROPPED = ("the Turn ended", "[Tool call interrupted")
FAILED = ("<tool_use_error>", "InputValidationError", "Tool permission request failed")
ANSWERED = ("Your questions have been answered", "The user answered")

_TZ = []


def zone():
    if not _TZ:
        from zoneinfo import ZoneInfo  # ImportError or ZoneInfoNotFoundError: reflect.py's zone() said exit 3 first
        _TZ.append(ZoneInfo(ZONE))
    return _TZ[0]


def to_ms(stamp):
    """An instant's epoch ms, or None when it does not read."""
    if not isinstance(stamp, str) or not stamp.strip():
        return None
    try:
        return SCORE.to_ms(stamp.strip())
    except Exception:
        return None


def fmt(ms):
    return SCORE.fmt(ms)


def day_start(day):
    d = datetime.date.fromisoformat(day)
    return int(datetime.datetime(d.year, d.month, d.day, tzinfo=zone()).timestamp() * 1000)


def day_end(day):
    """The end of a Melbourne date: the start of the next one (a date-only end lasts through its day)."""
    d = datetime.date.fromisoformat(day) + datetime.timedelta(days=1)
    return int(datetime.datetime(d.year, d.month, d.day, tzinfo=zone()).timestamp() * 1000)


def hours(ms):
    return round(max(0, ms) / HOUR, 3)


def cut(text, n):
    s = " ".join(str(text or "").split())
    return s[:n]


def is_slug(s):
    return isinstance(s, str) and bool(RR.SLUG_RE.fullmatch(s)) and s not in RR.RESERVED


def link_slug(value):
    """A wikilink or string (`"[[dir/foo#h|alias]]"`, `foo\\|alias`) as its leaf note name, or None."""
    if not isinstance(value, str):
        return None
    s = value.strip().strip('"').strip("'").replace("[[", "").replace("]]", "").strip()
    s = re.split(r"[|#^]", s, maxsplit=1)[0].rstrip().rstrip("\\").split("/")[-1].strip()
    if s.endswith(".md"):
        s = s[:-3]
    return s or None


class Out:
    """The block's flags and cannotShow, each line once, in order."""

    def __init__(self):
        self.flags, self.cannot = [], []

    def flag(self, text):
        text = FLAG + text
        if text not in self.flags:
            self.flags.append(text)

    def cannot_show(self, text):
        if text not in self.cannot:
            self.cannot.append(text)


# ---- the vault -------------------------------------------------------------------------------------------------------

class Notes:
    """The vault through reflect's find and index: each note read once."""

    def __init__(self, find, index, root):
        self.find, self.index, self.root = find, index, root
        self._recs, self._lists = {}, {}

    def rec(self, path):
        key = str(path)
        if key not in self._recs:
            self._recs[key] = RP.Rec(path, "")
        return self._recs[key]

    def note(self, slug):
        try:
            return self.find(slug)
        except Exception:
            return None

    def exact(self, path, slug):
        """Whether the note at `path` is named exactly `<slug>.md` (a case-insensitive disk resolves any case)."""
        parent = str(path.parent)
        if parent not in self._lists:
            try:
                self._lists[parent] = set(os.listdir(parent))
            except OSError:
                self._lists[parent] = set()
        return path.name == "%s.md" % slug and path.name in self._lists[parent]

    def rel(self, path):
        try:
            return os.path.relpath(str(path), str(self.root))
        except ValueError:
            return str(path)


def stamp_by(value, until, mdate):
    """True when a frontmatter stamp is at or before until: an instant by its value, a date-only one through its
    Melbourne day (before until's date: date_in's rule, so until's date is the next reading's); None when unreadable."""
    v = (value or "").strip()
    if not v:
        return None
    if DATE_RE.match(v):
        return v < mdate(until)
    t = to_ms(v)
    return None if t is None else t <= until


def stamp_end(value):
    """A frontmatter stamp as an end in ms: an instant as it is, a date through its Melbourne day; None unreadable."""
    v = (value or "").strip()
    if not v:
        return None
    if DATE_RE.match(v):
        try:
            return day_end(v)
        except ValueError:
            return None
    return to_ms(v)


def captured_day(rec, out, where):
    """A note's `captured:` date, else None: none set, or one no calendar holds (2026-02-30), which is named in cannotShow
    as `where` (its path from the tasks root), so day_start() and day_end() only ever see a real date."""
    v = rec.scalar("captured")[:10] if rec.fm is not None else ""
    if not DATE_RE.match(v):
        return None
    try:
        datetime.date.fromisoformat(v)
    except ValueError:
        out.cannot_show("%s: captured: %s is no calendar date: read as none" % (where, v))
        return None
    return v


# ---- the transcripts ---------------------------------------------------------------------------------------------------

def transcript_dirs(env=None):
    """(dirs, why): THREAD_TRANSCRIPTS_DIR when set, else the union of the config dir's projects and every profile's,
    deduplicated by realpath; why names a missing override."""
    env = os.environ if env is None else env
    over = env.get("THREAD_TRANSCRIPTS_DIR")
    if over:
        over = os.path.expanduser(over)
        return ([over], None) if os.path.isdir(over) else ([], "THREAD_TRANSCRIPTS_DIR %s is no directory" % over)
    home = RR._home(env)
    cands = [os.path.join(env.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude"), "projects")]
    cands += sorted(glob.glob(os.path.join(home, ".claude-profiles", "*", "projects")))
    out, seen = [], set()
    for d in cands:
        if not os.path.isdir(d):
            continue
        real = os.path.realpath(d)
        if real in seen:
            continue
        seen.add(real)
        out.append(d)
    return out, (None if out else "no transcripts directory under %s" % home)


def transcript_files(dirs, floor, out):
    files = []
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, "*", "*.jsonl"))):
            try:
                if os.path.getmtime(p) * 1000 >= floor:
                    files.append(p)
            except OSError as e:
                out.cannot_show("transcript %s cannot be read (%s): not read" % (p, e))
    return files


def _strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


def touched_slugs(text):
    out = set()
    for m in WIKI_TOUCH_RE.finditer(text):
        s = link_slug(m.group(1))
        if s:
            out.add(s)
    for m in PATH_TOUCH_RE.finditer(text):
        out.add(m.group(1))
    return out


class Transcripts:
    """One pass over the transcript files: the asks and their results, the touches and the reading Sessions."""

    def __init__(self):
        self.asks = {}       # call id -> {t, session, cwd, branch, input}
        self.results = {}    # call id -> {t, text, error, tur}
        self.touches = {}    # slug -> {session: True}
        self.touched_by = {}  # session -> set of slugs (in the touch window)
        self.readings = set()
        self.sessions = set()

    def read(self, files, floor, until, out):
        lo = until - TOUCH_DAYS * 24 * HOUR
        for path in files:
            stem = os.path.basename(path)[:-len(".jsonl")]
            try:
                f = open(path, encoding="utf-8", errors="replace")
            except OSError as e:
                out.cannot_show("transcript %s cannot be read (%s): not read" % (path, e))
                continue
            with f:
                try:
                    for raw in f:
                        self.line(raw, stem, floor, lo, until)
                except OSError as e:
                    out.cannot_show("transcript %s cannot be read whole (%s): read up to the fault" % (path, e))

    def line(self, raw, stem, floor, lo, until):
        if RESULT_MARK in raw and ASK_TOOL not in raw:
            if not self.asks or not any(i in self.asks for i in RESULT_ID_RE.findall(raw)):
                return
        elif not (ASK_TOOL in raw or "[[" in raw or "Work/Tasks/" in raw or READING_HINT in raw):
            return
        try:
            d = json.loads(raw)
        except ValueError:
            return
        if not isinstance(d, dict) or d.get("type") not in ("user", "assistant") or d.get("isSidechain"):
            return
        t = to_ms(d.get("timestamp"))
        if t is None:
            return
        sid = d.get("sessionId") if isinstance(d.get("sessionId"), str) and d.get("sessionId") else stem
        msg = d.get("message") if isinstance(d.get("message"), dict) else {}
        content = msg.get("content")
        touch = lo <= t <= until
        if d["type"] == "assistant":
            for c in content if isinstance(content, list) else []:
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                name, inp = c.get("name"), c.get("input")
                if name == ASK_TOOL and isinstance(c.get("id"), str) and floor <= t <= until:
                    prev = self.asks.get(c["id"])
                    if prev is None or t < prev["t"]:
                        self.asks[c["id"]] = {"t": t, "session": sid, "cwd": d.get("cwd"), "branch": d.get("gitBranch"),
                                              "input": inp if isinstance(inp, dict) else {}}
                if name == "Bash" and isinstance(inp, dict) and isinstance(inp.get("command"), str) \
                        and READING_RE.search(inp["command"]):
                    self.readings.add(sid)
                if touch:
                    for s in _strings(inp):
                        self.touch(touched_slugs(s), sid)
            return
        if isinstance(content, str):
            if touch:
                self.touch(touched_slugs(content), sid)
            return
        for c in content if isinstance(content, list) else []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_result":
                cid = c.get("tool_use_id")
                if cid in self.asks and t <= until:
                    prev = self.results.get(cid)
                    if prev is None or t < prev["t"]:
                        text = c.get("content")
                        if isinstance(text, list):
                            text = " ".join(x.get("text", "") for x in text if isinstance(x, dict))
                        self.results[cid] = {"t": t, "text": str(text or ""), "error": bool(c.get("is_error")),
                                             "tur": d.get("toolUseResult")}
            elif c.get("type") == "text" and touch:
                self.touch(touched_slugs(str(c.get("text") or "")), sid)

    def touch(self, slugs, sid):
        if not slugs:
            return
        self.touched_by.setdefault(sid, set()).update(slugs)
        for s in slugs:
            self.touches.setdefault(s, {})[sid] = True


def reading_sessions(tx):
    """The Sessions whose main chain runs a reading step (READING_RE over a Bash tool_use's command), read whole."""
    return set(tx.readings)


# ---- the Question ledger -----------------------------------------------------------------------------------------------

def _answer_from_text(text, question):
    """The answer the result's text gives `question`, else None: `"<q>"="<answer>"`, the answer ending at the quote
    that a separator follows."""
    key = '"%s"="' % question
    i = text.find(key)
    if i < 0:
        return None, None
    start = i + len(key)
    j = start
    while True:
        j = text.find('"', j)
        if j < 0:
            return text[start:].strip(), None
        rest = text[j + 1:]
        if rest.startswith(" notes: "):
            note = rest[len(" notes: "):]
            stop = min([k for k in (note.find('", "'), note.find(". Read the answers"), note.find(". You can now"))
                        if k >= 0] or [len(note)])
            return text[start:j], note[:stop].strip() or None
        if rest == "" or rest.startswith((". ", ", \"", ".", ",")):
            return text[start:j], None
        j += 1


def _labels(q):
    return [o.get("label") for o in q.get("options") or [] if isinstance(o, dict) and isinstance(o.get("label"), str)]


def _picked(answer, label, multi):
    if multi:
        return label in answer
    return answer.strip() == label.strip()


def _own_words(answer, labels, multi):
    if not multi:
        return answer.strip() not in [x.strip() for x in labels]
    rest = answer
    for x in sorted(labels, key=len, reverse=True):
        rest = rest.replace(x, "")
    return bool(rest.replace(",", " ").strip())


def classify(res):
    """A call's result: (kind, per-question answers {question: (answer, note)} or None)."""
    if res is None:
        return "open", None
    text = res["text"].strip()
    if text.startswith(FAILED) or (res["error"] and "InputValidationError" in text[:200]):
        return "failed", None
    if text.startswith(DISMISSED):
        return "dismissed", None
    if text.startswith(DROPPED):
        return "dropped", None
    tur = res.get("tur")
    if isinstance(tur, dict) and isinstance(tur.get("answers"), dict):
        notes = tur.get("annotations") if isinstance(tur.get("annotations"), dict) else {}
        out = {}
        for q, a in tur["answers"].items():
            ann = notes.get(q) if isinstance(notes.get(q), dict) else {}
            out[q] = (a if isinstance(a, str) else json.dumps(a), ann.get("notes") if isinstance(ann.get("notes"), str) else None)
        return "answered", out
    if text.startswith(ANSWERED):
        return "answered", "text"
    return "unparsed", None


def question_items(tx, since, until, repo_of, out):
    """The Question ledger's items: every question of every call in [since, until] (the module docstring)."""
    items = []
    unparsed = 0
    for cid in sorted(tx.asks, key=lambda c: (tx.asks[c]["t"], c)):
        a = tx.asks[cid]
        if not since <= a["t"] <= until:
            continue
        qs = [q for q in a["input"].get("questions") or [] if isinstance(q, dict)]
        res = tx.results.get(cid)
        kind, answers = classify(res)
        end = res["t"] if res is not None else until
        held = hours(end - a["t"])
        n = len(qs)
        for i, q in enumerate(qs):
            text = q.get("question") if isinstance(q.get("question"), str) else ""
            labels = _labels(q)
            multi = q.get("multiSelect") is True
            rec = next((x for x in labels if RECOMMENDED_RE.search(x)), None)
            outcome, answer, note = kind, None, None
            if kind == "answered":
                if answers == "text":
                    answer, note = _answer_from_text(res["text"], text)
                else:
                    answer, note = (answers.get(text) or (None, None))
                if answer is None:
                    outcome = "unparsed"
                elif answer.strip().startswith(DISMISSED):
                    outcome, answer = "dismissed", None
            if outcome == "unparsed":
                unparsed += 1
            item = {
                "id": "%s#%d" % (cid, i), "call": cid, "session": a["session"], "cwd": a["cwd"], "at": fmt(a["t"]),
                "repo": repo_of(a["cwd"]), "header": cut(q.get("header"), HEADER_MAX), "question": cut(text, QUESTION_MAX),
                "options": [{"label": cut(o.get("label"), QUESTION_MAX), "description": cut(o.get("description"), DESCRIPTION_MAX)}
                            for o in q.get("options") or [] if isinstance(o, dict)],
                "multiSelect": multi, "recommended": rec, "answer": cut(answer, QUESTION_MAX) if answer is not None else None,
                "ownWords": bool(answer is not None and _own_words(answer, labels, multi)),
                "pickedRecommended": (_picked(answer, rec, multi) if rec is not None else None) if answer is not None else None,
                "note": cut(note, QUESTION_MAX) if note else None, "outcome": outcome,
                "answeredAt": fmt(res["t"]) if res is not None and outcome == "answered" else None,
                "heldHours": 0 if outcome == "failed" else held, "callQuestions": n, "handedAfterStop": False,
            }
            items.append(item)
    if unparsed:
        out.flag("%d question(s) whose result reads as no known outcome: counted as asked, outcome unparsed" % unparsed)
    return items


def question_counts(items, owners=None):
    """The one counter (the module docstring), for the line and for tally."""
    asked = [x for x in items if x.get("outcome") != "failed"]
    out = {"asked": len(asked), "calls": len({x["call"] for x in asked})}
    for k in ("answered", "dismissed", "dropped", "open", "failed", "unparsed"):
        out[k] = sum(1 for x in items if x.get("outcome") == k)
    answered = [x for x in asked if x.get("outcome") == "answered"]
    offered = [x for x in answered if x.get("recommended")]
    out["recommended"] = {"offered": len(offered), "picked": sum(1 for x in offered if x.get("pickedRecommended") is True)}
    out["notes"] = sum(1 for x in answered if x.get("note"))
    out["ownWords"] = sum(1 for x in answered if x.get("ownWords"))
    calls = {}
    for x in asked:
        calls.setdefault(x["call"], x)
    out["hoursHeld"] = round(sum(float(x.get("heldHours") or 0) for x in calls.values()), 3)
    longest = sorted(calls.values(), key=lambda x: (-float(x.get("heldHours") or 0), x["call"]))[:LONGEST]
    out["longest"] = [{"call": x["call"], "session": str(x.get("session") or "")[:8], "repo": str(x.get("repo") or "unknown"),
                       "header": cut(x.get("header"), HEADER_MAX), "hours": round(float(x.get("heldHours") or 0), 3),
                       "outcome": x.get("outcome")} for x in longest]
    repos = {}
    for x in asked:
        r = str(x.get("repo") or "unknown")
        repos[r] = repos.get(r, 0) + 1
    ranked = sorted(repos.items(), key=lambda kv: (-kv[1], kv[0]))
    out["byRepo"] = dict(ranked[:BY_REPO])
    if len(ranked) > BY_REPO:
        out["byRepo"]["other"] = out["byRepo"].get("other", 0) + sum(n for _r, n in ranked[BY_REPO:])
    if owners is not None:
        by = {o: 0 for o in OWNERS}
        hrs = {o: 0.0 for o in OWNERS}
        unlabelled = 0
        for x in asked:
            o = owners.get(x["id"])
            if o not in OWNERS:
                unlabelled += 1
                o = "unknown"
            by[o] += 1
            hrs[o] += float(x.get("heldHours") or 0) / max(1, int(x.get("callQuestions") or 1))
        out["byOwner"] = by
        out["hoursByOwner"] = {o: round(h, 3) for o, h in hrs.items()}
        out["unlabelled"] = unlabelled
    return out


def check_owners(items, owners, rest_unknown, given):
    """The owners file's refusals (a list of reasons; [] when it may be written) and the asked ids it leaves out."""
    asked = [x["id"] for x in items if x.get("outcome") != "failed"]
    if not given:
        if asked and not rest_unknown:
            return ["%d questions and no --owners: label them (SKILL step 11) or pass --rest-unknown" % len(asked)], asked
        return [], asked
    if not isinstance(owners, dict):
        return ["the owners file is no JSON object {<question id>: <owner>}"], []
    known = {x["id"] for x in items}
    errors = []
    extra = sorted(k for k in owners if k not in known)
    if extra:
        errors.append("the owners file names %d id(s) the span lacks: %s" % (len(extra), ", ".join(extra[:10])))
    bad = sorted(k for k, v in owners.items() if v not in OWNERS)
    if bad:
        errors.append("the owners file gives %d id(s) an owner outside %s: %s" % (len(bad), ", ".join(OWNERS), ", ".join(
            "%s=%r" % (k, owners[k]) for k in bad[:10])))
    missing = [i for i in asked if i not in owners]
    if missing and not rest_unknown and not errors:
        errors.append("the owners file leaves out %d asked question(s): %s (label them, or pass --rest-unknown)"
                      % (len(missing), ", ".join(missing[:10])))
    return errors, missing


# ---- the repos -----------------------------------------------------------------------------------------------------

class Git:
    """Read-only git, under git_env() and ESC.GIT_TIMEOUT, each (repo, arguments) run once."""

    def __init__(self, env):
        self.env, self.cache = env, {}

    def run(self, repo, *args):
        key = (repo,) + args
        if key not in self.cache:
            try:
                p = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, env=self.env, timeout=ESC.GIT_TIMEOUT)
                self.cache[key] = (p.returncode, p.stdout)
            except (OSError, subprocess.SubprocessError):
                self.cache[key] = (None, "")
        return self.cache[key]

    def ok(self, repo, *args):
        return self.run(repo, *args)[0] == 0

    def anc(self, repo, a, b):
        """True, False, or None (unreadable): whether a is an ancestor of b."""
        rc, _o = self.run(repo, "merge-base", "--is-ancestor", a, b)
        return True if rc == 0 else False if rc == 1 else None


def fold_worktree(path):
    return path.split("/.claude/worktrees/")[0] if isinstance(path, str) else path


class Repos:
    def __init__(self, git, origin, out):
        self.git, self.origin, self.out = git, origin, out
        self._main, self._ref, self._ident, self._label = {}, {}, {}, {}

    def label(self, cwd):
        """A question's repo: its cwd's worktree folded off, then its origin, else the folded path's basename."""
        if not isinstance(cwd, str) or not cwd:
            return "unknown"
        p = fold_worktree(cwd).rstrip("/") or "/"
        if p not in self._label:
            slug = None
            if os.path.isdir(p):
                try:
                    slug = self.origin(p)
                except Exception:
                    slug = None
            self._label[p] = slug or os.path.basename(p) or p
        return self._label[p]

    def common(self, path):
        if path not in self._main:
            rc, o = self.git.run(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
            c = o.strip() if rc == 0 else ""
            self._main[path] = (os.path.dirname(c) if os.path.basename(c) == ".git" else c) or None
        return self._main[path]

    def main(self, path, head):
        """The main repo of a round's checkout (the module docstring's order), or None."""
        if os.path.isdir(path):
            return self.common(path)
        if "/.claude/worktrees/" in path:
            base = path.split("/.claude/worktrees/")[0]
            return self.common(base) if os.path.isdir(base) else None
        parent, base = os.path.split(path.rstrip("/"))
        try:
            sibs = [n for n in os.listdir(parent) if base.startswith(n + "-") and os.path.isdir(os.path.join(parent, n))]
        except OSError:
            return None
        for n in sorted(sibs, key=lambda n: (-len(n), n)):
            m = self.common(os.path.join(parent, n))
            if m and self.has(m, head):
                return m
        return None

    def has(self, main, head):
        return bool(head) and self.git.ok(main, "cat-file", "-e", "%s^{commit}" % head)

    def ref(self, main):
        if main not in self._ref:
            rc, o = self.git.run(main, "symbolic-ref", "-q", "refs/remotes/origin/HEAD")
            ref = o.strip() if rc == 0 and o.strip() else None
            if ref is None:
                hits = [r for r in ("refs/remotes/origin/main", "refs/remotes/origin/master")
                        if self.git.ok(main, "rev-parse", "--verify", "-q", "%s^{commit}" % r)]
                ref = hits[0] if len(hits) == 1 else "HEAD"
            self._ref[main] = ref
        return self._ref[main]

    def identity(self, main):
        if main not in self._ident:
            try:
                slug = self.origin(main)
            except Exception:
                slug = None
            self._ident[main] = slug or main
        return self._ident[main]

    def landing(self, main, head):
        """(on_ref, merge sha or None): the merge that brought `head` onto the ref, the oldest first-parent commit of the
        ref that holds it, when that commit is a merge whose first parent is not the head itself."""
        ref = self.ref(main)
        if not self.git.anc(main, head, ref):
            return False, None
        rc, o = self.git.run(main, "rev-list", "--ancestry-path", "%s..%s" % (head, ref))
        holds = set(o.split()) if rc == 0 else set()
        c = next((row for row in reversed(self.chain(main)) if row[0] in holds), None)
        if c is None or len(c) < 3 or c[1].startswith(head.lower()):
            return True, None
        return True, c[0]

    def chain(self, main):
        """The ref's first-parent chain, newest first, each row [sha, parents...]."""
        rc, o = self.git.run(main, "rev-list", "--first-parent", "--parents", self.ref(main))
        return [x.split() for x in o.split("\n") if x.strip()] if rc == 0 else []

    def merge_label(self, main, merge):
        rc, o = self.git.run(main, "log", "-1", "--format=%s", merge)
        m = ESC.MERGE_PR_RE.match(o.strip()) if rc == 0 else None
        return "#%s" % m.group(1) if m else merge[:7]

    def branches(self, main, head, ref):
        rc, o = self.git.run(main, "for-each-ref", "--contains", head, "--format=%(refname)", "refs/heads", "refs/remotes")
        if rc != 0:
            return {}
        refname = ref.split("/")[-1] if ref != "HEAD" else None
        names = {}
        for r in o.split():
            if r.startswith("refs/heads/"):
                name, show = r[len("refs/heads/"):], r[len("refs/heads/"):]
            elif r.startswith("refs/remotes/"):
                parts = r[len("refs/remotes/"):].split("/", 1)
                if len(parts) < 2 or parts[1] == "HEAD":
                    continue
                name, show = parts[1], "%s/%s" % (parts[0], parts[1])
            else:
                continue
            if name == refname:
                continue
            names.setdefault(name, show)
        return names


def review_rounds(ev, lo, until, out):
    """The /fresh-review rounds whose lines are stamped at or before until, deduplicated (the module docstring), each
    with its time at or after lo (since - TRAIL_DAYS: an older round is never keyed), oldest first."""
    path = os.path.join(ev, RR.REVIEWS + ".jsonl")
    if not os.path.exists(path):
        return []
    try:
        lines, skipped = SCORE.read_lines(path)
    except OSError as e:
        out.flag("reviews.jsonl cannot be read (%s): no Review trail" % e)
        return []
    if skipped:
        out.flag("reviews.jsonl: %d line(s) did not parse: skipped" % skipped)
    latest, first = {}, {}
    for t, n, d in lines:
        if d.get("kind") != "review-round" or t > until or not isinstance(d.get("repo"), str) or not d["repo"]:
            continue
        doc = d.get("doc")
        key = ("doc", d["repo"], doc) if isinstance(doc, str) and doc else ("head", d["repo"], d.get("head"), d.get("digest"))
        first.setdefault(key, t)
        latest[key] = d
    rounds = []
    for key, d in latest.items():
        at = to_ms(d.get("reviewedAt"))
        rounds.append({"repo": d["repo"].rstrip("/") or d["repo"], "head": d.get("head") if isinstance(d.get("head"), str) else "",
                       "branch": d.get("branch") if isinstance(d.get("branch"), str) and d.get("branch") else None,
                       "mode": d.get("mode"), "verdict": d.get("verdict"),
                       "findings": d.get("findings") if isinstance(d.get("findings"), int) else 0,
                       "regression": d.get("regression") if isinstance(d.get("regression"), int) else 0,
                       "at": at if at is not None else first[key]})
    rounds = [r for r in rounds if r["at"] >= lo]
    rounds.sort(key=lambda r: (r["at"], r["repo"], r["head"]))
    return rounds


def key_trails(rounds, repos, since, until):
    """The Review trails read: the deduplicated rounds keyed (the module docstring's keys), each trail kept when it has a
    round in [since, until], in order of its first round. Keying reads git alone, never a transcript, so block() takes
    the transcripts' floor from these trails' first rounds before it reads one; trails() then counts them."""
    by_key, order, keyless = {}, [], {}
    for r in rounds:
        main = repos.main(r["repo"], r["head"])
        has = main is not None and repos.has(main, r["head"])
        ident = repos.identity(main) if main else r["repo"]
        key = label = kind = None
        landing = None
        on_ref = False
        if has:
            on_ref, merge = repos.landing(main, r["head"])
            if merge:
                key, kind, label, landing = (ident, "landing", merge), "landing", repos.merge_label(main, merge), merge
        if key is None and not on_ref:
            if r["branch"]:
                b = r["branch"]
                name = b.split("/", 1)[1] if b.startswith("origin/") else b
                key, kind, label = (ident, "branch", name), "branch", b
            elif has:
                names = repos.branches(main, r["head"], repos.ref(main))
                if len(names) == 1:
                    name, show = next(iter(names.items()))
                    key, kind, label = (ident, "branch", name), "branch", show
        if key is None:
            prev = keyless.get(r["repo"])
            joined = False
            if prev is not None and r["at"] - prev["lastAt"] <= KEYLESS_GAP_HOURS * HOUR:
                anc = repos.git.anc(main, prev["lastHead"], r["head"]) if has and main and prev["lastHead"] else None
                joined = anc is not False
            if joined:
                key = prev["key"]
            else:
                key = ("path", r["repo"], len(order))
                kind, label = "path", os.path.basename(r["repo"]) or r["repo"]
            keyless[r["repo"]] = {"key": key, "lastAt": r["at"], "lastHead": r["head"]}
        tr = by_key.get(key)
        if tr is None:
            tr = by_key[key] = {"key": kind, "label": label, "identity": ident, "checkouts": [], "rounds": [], "main": main,
                                "landing": landing}
            order.append(key)
        if r["repo"] not in tr["checkouts"]:
            tr["checkouts"].append(r["repo"])
        tr["rounds"].append(dict(r, main=main, has=has, onRef=on_ref))
        if main and not tr["main"]:
            tr["main"] = main
    read = []
    for key in order:
        tr = by_key[key]
        tr["rounds"].sort(key=lambda r: r["at"])
        if any(since <= r["at"] <= until for r in tr["rounds"]):
            read.append(tr)
    return read


def trails(read, repos, asks, out):
    """The Review trails' items (the module docstring) over key_trails()'s; asks are [(t, session, cwd, call ids)]."""
    items = []
    for tr in read:
        rs = tr["rounds"]
        for r in rs:
            if r["main"] is None:
                out.cannot_show("a /fresh-review checkout %s resolves to no repo: its rounds are keyed by path, docs-only "
                                "unknown" % r["repo"])
        stops = stop_rounds = handed = 0
        handed_ids = []
        prev_stop = False
        for r in rs:
            stop = r["verdict"] == "stop"
            if stop:
                stop_rounds += 1
                if not prev_stop:
                    stops += 1
                hits = [ids for t, _sid, cwd, ids in asks
                        if (cwd or "").rstrip("/") == r["repo"] and r["at"] <= t <= r["at"] + HANDED_MINUTES * MINUTE]
                if hits:
                    handed += 1
                    for ids in hits:
                        for i in ids:
                            if i not in handed_ids:
                                handed_ids.append(i)
            prev_stop = stop
        last = rs[-1]
        items.append({"label": cut(tr["label"], LABEL_MAX), "key": tr["key"], "identity": tr["identity"],
                      "checkouts": sorted(tr["checkouts"]), "rounds": len(rs),
                      "codeRounds": sum(1 for r in rs if r["mode"] == "code"),
                      "simplifyRounds": sum(1 for r in rs if r["mode"] == "simplify"),
                      "stopRounds": stop_rounds, "stops": stops, "stopsHanded": handed, "handedAfterStop": handed_ids,
                      "findings": sum(r["findings"] for r in rs), "regression": sum(r["regression"] for r in rs),
                      "first": fmt(rs[0]["at"]), "last": fmt(last["at"]),
                      "docsOnly": docs_only(tr, last, repos, out)})
    return items


def docs_only(tr, last, repos, out):
    main, head = last["main"] or tr["main"], last["head"]
    why = None
    base = None
    if not main or not last["has"]:
        why = "its repo or head %s is gone" % (head[:12] or "(none)")
    elif tr["key"] == "landing":
        rc, o = repos.git.run(main, "merge-base", head, "%s^1" % tr["landing"])
        base = o.strip() if rc == 0 else None
    elif tr["key"] == "path" and last["onRef"]:
        why = "its head is on %s with no merge commit (a fast-forward or a squash)" % repos.ref(main)
    else:
        rc, o = repos.git.run(main, "merge-base", head, repos.ref(main))
        base = o.strip() if rc == 0 else None
    if why is None and not base:
        why = "no merge base with %s reads" % repos.ref(main)
    if why is not None:
        out.cannot_show("Review trail %s: docs-only is unknown (%s)" % (tr["label"], why))
        return None
    rc, o = repos.git.run(main, "diff", "--name-only", base, head, "--", ".", ":!docs/reviews")
    if rc != 0:
        out.cannot_show("Review trail %s: docs-only is unknown (git diff failed)" % tr["label"])
        return None
    paths = [p for p in o.split("\n") if p.strip()]
    return bool(paths) and all(p.startswith("docs/") or ("/" not in p and p.endswith(".md")) for p in paths)


def trail_counts(items, engine_stops):
    out = {"count": len(items)}
    for k in ("rounds", "codeRounds", "simplifyRounds", "stopRounds", "stops", "stopsHanded", "findings", "regression"):
        out[k] = sum(t[k] for t in items)
    docs = [t for t in items if t["docsOnly"] is True]
    out["docsOnly"] = {"trails": len(docs), "rounds": sum(t["rounds"] for t in docs)}
    out["engineStops"] = engine_stops
    longest = sorted(items, key=lambda t: (-t["rounds"], t["first"] or "", t["label"]))[:LONGEST]
    out["longest"] = [{"label": t["label"], "rounds": t["rounds"], "stopRounds": t["stopRounds"], "stops": t["stops"],
                       "stopsHanded": t["stopsHanded"], "docsOnly": t["docsOnly"],
                       "handedAfterStop": t["handedAfterStop"][:HANDED_MAX]} for t in longest]
    return out


# ---- rollouts: their ends and their waits ----------------------------------------------------------------------------

def rollout_end(slug, rec, lines, close_line, notes, out):
    """When a rollout ended (the module docstring's order), in ms, or None while it is open."""
    try:
        cl = close_line(slug)
    except Exception as e:  # tune.py's OSError on an unreadable tunings.jsonl
        out.flag("tunings.jsonl cannot be read for [[%s]]'s close line (%s)" % (slug, e))
        cl = None
    t = to_ms(cl.get("ts")) if isinstance(cl, dict) else None
    if t is not None:
        return t
    if rec is not None and rec.fm is not None:
        end = stamp_end(rec.scalar("completed"))
        if end is not None:
            return end
        sb = link_slug(rec.scalar("superseded_by"))
        if sb:
            p = notes.note(sb)
            if p is not None:
                day = captured_day(notes.rec(p), out, notes.rel(p))
                if day:
                    return day_end(day)
        if rec.status in LEDGER.CLOSED and lines:
            return lines[-1][0]
    return None


def is_serial(rec):
    return rec is not None and rec.fm is not None and rec.scalar("shape").split("#")[0].strip().lower() == "serial"


def leg_done_by(rec, until):
    for line in (rec.body or "").split("\n"):
        m = LEG_DONE_RE.match(line)
        t = to_ms(m.group(1)) if m else None
        if t is not None and t <= until:
            return True
    return False


def queue_links(body):
    """The task slugs a rollout note's ## Queue table links, rows whose Mode starts `carried (` left out."""
    out, inside, cols = [], False, None
    for line in (body or "").split("\n"):
        if line.startswith("## "):
            inside = bool(QUEUE_HEAD_RE.match(line))
            cols = None
            continue
        if not inside or not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in CELL_SPLIT_RE.split(line.strip())[1:-1]]
        if cols is None:
            low = [c.lower() for c in cells]
            if "task" in low:
                cols = (low.index("task"), low.index("mode") if "mode" in low else None)
            continue
        if all(set(c) <= set("-: ") for c in cells):
            continue
        ti, mi = cols
        if ti >= len(cells):
            continue
        if mi is not None and mi < len(cells) and cells[mi].lower().startswith("carried ("):
            continue
        m = re.search(r"\[\[([^\]]+)\]\]", cells[ti])
        s = link_slug(m.group(1)) if m else None
        if s:
            out.append(s)
    return out


def rollouts(whole, notes, until, out):
    """The rollouts W2 and the waits read: {slug: (note path, Rec, record lines)} (the module docstring's W2 candidates)."""
    cands = {}
    for slug in sorted(whole):
        if slug in RR.RESERVED:
            continue
        lines = [x for x in whole[slug] if x[0] <= until]
        if not lines:
            continue
        p = notes.note(slug)
        if p is None:
            out.cannot_show("record %s has no rollout note: never a circling rollout or a wait to start" % slug)
            continue
        cands[slug] = (p, notes.rec(p), lines)
    try:
        paths = sorted(set(notes.index().values()), key=str)
    except Exception as e:
        out.flag("the vault index cannot be read (%s): no note-only rollout" % e)
        paths = []
    for p in paths:
        rec = notes.rec(p)
        if rec.fm is None or "rollout" not in rec.tags or "reference" in rec.tags:
            continue
        if rec.status in LEDGER.CLOSED:
            continue
        stem = p.stem
        if not is_slug(stem):
            out.cannot_show("%s: tagged rollout but not a rollout note (its name is no slug)" % notes.rel(p))
            continue
        if stem in whole:
            continue
        if not rec.scalar("protocol_version") and not QUEUE_HEAD_RE.search(rec.body or ""):
            out.cannot_show("%s: tagged rollout but not a rollout note (no protocol_version: and no ## Queue)" % notes.rel(p))
            continue
        cands[stem] = (p, rec, [])
    return cands


def waits(cands, whole, notes, since, until, close_line, out):
    rows, serial = [], []
    for slug, (p, rec, lines) in sorted(cands.items()):
        if is_serial(rec):
            serial.append(slug)
            continue
        starts = [t for t, _n, d in whole.get(slug, []) if d.get("kind") == "slot-taken"]
        started = min(starts) if starts else None
        if started is not None and started > until:
            started = None
        if started is not None:
            if not since <= started <= until:
                continue
        else:
            end = rollout_end(slug, rec, lines, close_line, notes, out)
            if end is not None and end <= until:
                continue
        days = []
        for t in queue_links(rec.body):
            tp = notes.note(t)
            if tp is None:
                out.flag("wait of [[%s]]: its queue links [[%s]], which has no note" % (slug, t))
                continue
            d = captured_day(notes.rec(tp), out, notes.rel(tp))
            if d:
                days.append(d)
        own = captured_day(rec, out, notes.rel(p))
        ask = min(days) if days else own
        if ask is None:
            out.flag("wait of [[%s]]: no captured: date on it or its queue's tasks: no row" % slug)
            continue
        end = started if started is not None else until
        row = {"rollout": slug, "ask": fmt(day_start(ask)), "scheduled": fmt(day_start(own)) if own else None,
               "started": fmt(started) if started is not None else None, "hours": hours(end - day_start(ask)),
               "scheduleHours": hours(end - day_start(own)) if own else None, "open": started is None}
        rows.append(row)
    if serial:
        out.cannot_show("a serial chain has no wait to start (its Legs take no Slot): %s" % ", ".join(
            "[[%s]]" % s for s in serial[:8]) + (" and %d more" % (len(serial) - 8) if len(serial) > 8 else ""))
    rows.sort(key=lambda r: (-r["hours"], r["rollout"]))
    return rows


# ---- circling ------------------------------------------------------------------------------------------------------

def _named(out, why, slugs):
    if slugs:
        out.cannot_show("circling: touched by %d or more Sessions but %s: %s" % (
            CIRCLE_SESSIONS, why, ", ".join("[[%s]]" % s for s in slugs[:16]) +
            (" and %d more" % (len(slugs) - 16) if len(slugs) > 16 else "")))


def circling(tx, items, whole, cands, notes, since, until, mdate, close_line, out):
    readings = reading_sessions(tx)
    sessions = {s: sorted(k for k in by if k not in readings) for s, by in tx.touches.items()}
    asked_by = {}
    for x in items:
        if x.get("outcome") != "failed":
            asked_by[x["session"]] = asked_by.get(x["session"], 0) + 1
    # what every record says of each task up to until: its last slot-taken, its last set-aside, a merged line
    slots, asides, merged = {}, {}, set()
    for slug, lines in whole.items():
        for t, _n, d in lines:
            task = d.get("task")
            if t > until or not isinstance(task, str):
                continue
            k = d.get("kind")
            if k == "slot-taken" and t >= slots.get(task, (-1,))[0]:
                slots[task] = (t, slug)
            elif k == "set-aside" and t >= asides.get(task, (-1,))[0]:
                asides[task] = (t, slug, d)
            elif k == "merged":
                merged.add(task)
    w1, fails = [], {"stem": [], "slug": [], "task": [], "keys": []}
    for slug in sorted(sessions):
        ss = sessions[slug]
        if len(ss) < CIRCLE_SESSIONS:
            continue
        p = notes.note(slug)
        if p is None:
            continue
        if not is_slug(slug):
            fails["slug"].append(slug)
            continue
        if not notes.exact(p, slug):
            fails["stem"].append(slug)
            continue
        rec = notes.rec(p)
        if not rec.is_task():
            fails["task"].append(slug)
            continue
        if not any(rec.scalar(k) for k in ("phase", "pr", "rollout")):
            fails["keys"].append(slug)
            continue
        task = slug.lower()
        if stamp_by(rec.scalar("merged"), until, mdate) or stamp_by(rec.scalar("completed"), until, mdate) \
                or task in merged:
            continue
        if rec.status in RP.LANDED and not rec.scalar("merged") and not rec.scalar("completed"):
            continue
        held_by = None
        if task in slots:
            a = asides.get(task)
            if a is None or a[0] <= slots[task][0]:
                continue
            held_by = {"rollout": a[1], "reasonClass": a[2].get("reasonClass"), "stage": a[2].get("stage"), "at": fmt(a[0])}
        elif task in asides:
            a = asides[task]
            held_by = {"rollout": a[1], "reasonClass": a[2].get("reasonClass"), "stage": a[2].get("stage"), "at": fmt(a[0])}
        w1.append({"slug": slug, "note": notes.rel(p), "sessions": len(ss), "sessionIds": [s[:8] for s in ss][:16],
                   "questions": sum(asked_by.get(s, 0) for s in ss), "heldBy": held_by})
    _named(out, "its note's name is no slug", fails["slug"])
    _named(out, "no note is named exactly so", fails["stem"])
    _named(out, "its note is no task (a rollout, phase or project note)", fails["task"])
    _named(out, "its note carries no phase:, pr: or rollout: (no work item)", fails["keys"])
    w2 = []
    for slug, (p, rec, lines) in sorted(cands.items()):
        day = None if lines else captured_day(rec, out, notes.rel(p))
        start = lines[0][0] if lines else (day_start(day) if day else None)
        if start is None:
            out.cannot_show("%s: a rollout note with no record and no captured: date: never a circling rollout" % notes.rel(p))
            continue
        if start > until or until - start < OPEN_HOURS * HOUR:
            continue
        end = rollout_end(slug, rec, lines, close_line, notes, out)
        if end is not None and end <= until:
            continue
        if any(d.get("kind") == "merged" for _t, _n, d in lines):
            continue
        if is_serial(rec) and leg_done_by(rec, until):
            continue
        ss = sessions.get(slug, [])
        w2.append({"slug": slug, "note": notes.rel(p), "sessions": len(ss), "sessionIds": [s[:8] for s in ss][:16],
                   "questions": sum(asked_by.get(s, 0) for s in ss), "hours": hours(until - start),
                   "started": fmt(start)})
    w1.sort(key=lambda x: (-x["sessions"], x["slug"]))
    w2.sort(key=lambda x: (-x["hours"], x["slug"]))
    seen = sorted(s for s in readings if tx.touched_by.get(s))
    return {"W1": w1, "W2": w2, "readings": [s[:8] for s in seen][:READINGS_MAX]}


def circling_items(block):
    """({W1: items, W2: items}, [(rule, slug)] dropped): the circling lists the line and the Watches carry, any item whose
    slug is no rollout slug (SLUG_RE, RESERVED) dropped. readings is never read here."""
    circ = (block or {}).get("circling") if isinstance((block or {}).get("circling"), dict) else {}
    lists, dropped = {}, []
    for rule in ("W1", "W2"):
        keep = []
        for x in circ.get(rule) or []:
            if not isinstance(x, dict):
                continue
            if is_slug(x.get("slug")):
                keep.append(x)
            else:
                dropped.append((rule, str(x.get("slug"))))
        lists[rule] = keep
    return lists, dropped


def _cycles(lines, rule):
    wid = CIRCLING_IDS[rule]
    cycles = []
    for d in lines:
        if not isinstance(d, dict) or d.get("id") != wid:
            continue
        if d.get("kind") == "watch":
            if not cycles or cycles[-1]["closed"]:
                cycles.append({"names": set(), "closed": False})
            cycles[-1]["names"] |= {x for x in d.get("rollouts") or [] if isinstance(x, str)}
        elif d.get("kind") == "watch-raised" and cycles and not cycles[-1]["closed"]:
            cycles[-1]["closed"] = True
    return cycles


def fresh_items(lines, rule, items):
    """The items no closed cycle of the rule's Watch named (the Watch rule's cycles, as reflect.py's watches() splits
    them)."""
    closed = set()
    for c in _cycles(lines, rule):
        if c["closed"]:
            closed |= c["names"]
    return [x for x in items if x.get("slug") not in closed]


def _weight(rule):
    return "sessions" if rule == "W1" else "hours"


def watch_line(rule, items, rid):
    w = _weight(rule)
    ordered = sorted(items, key=lambda x: (-(x.get(w) or 0), x["slug"]))
    names = []
    for x in ordered:
        if x["slug"] not in names:
            names.append(x["slug"])
    names = names[:WATCH_MAX]
    return {"id": CIRCLING_IDS[rule], "rule": RULES[rule][0], "shape": RULES[rule][1], "rollouts": names,
            "count": len(names), "reflection": rid, "circling": rule}


def watch_previews(lines, circ):
    lists, _dropped = circling_items({"circling": circ})
    out = {}
    for rule in ("W1", "W2"):
        fresh = fresh_items(lines, rule, lists[rule])
        names = {x["slug"] for x in fresh}
        out[rule] = {"id": CIRCLING_IDS[rule], "rule": RULES[rule][0], "shape": RULES[rule][1],
                     "fresh": [x["slug"] for x in fresh], "held": [x["slug"] for x in lists[rule] if x["slug"] not in names]}
    return out


# ---- the line --------------------------------------------------------------------------------------------------------

def attention_lines(lines, rid=None):
    """reflections.jsonl's `attention` lines, the last per Reflection, in order of each Reflection's first; with rid,
    that Reflection's own are left out."""
    last, order = {}, []
    for d in lines:
        if not isinstance(d, dict) or d.get("kind") != "attention" or not isinstance(d.get("reflection"), str):
            continue
        r = d["reflection"]
        if r not in last:
            order.append(r)
        last[r] = d
    return [last[r] for r in order if r != rid]


def trend(lines, rid):
    out = []
    for d in attention_lines(lines, rid)[-TREND:]:
        q = d.get("questions") if isinstance(d.get("questions"), dict) else {}
        tr = d.get("trails") if isinstance(d.get("trails"), dict) else {}
        c = d.get("circling") if isinstance(d.get("circling"), dict) else {}
        by = q.get("byOwner") if isinstance(q.get("byOwner"), dict) else {}
        out.append({"reflection": d["reflection"], "since": d.get("since"), "until": d.get("until"), "asked": q.get("asked"),
                    "yours": by.get("yours"), "unlabelled": q.get("unlabelled"), "trails": tr.get("count"),
                    "rounds": tr.get("rounds"), "stops": tr.get("stops"), "W1": len(c.get("W1") or []),
                    "W2": len(c.get("W2") or [])})
    return out


def _line_item(rule, x):
    out = {"slug": x["slug"], "sessions": int(x.get("sessions") or 0), "questions": int(x.get("questions") or 0)}
    if rule == "W2":
        out["hours"] = float(x.get("hours") or 0)
    return out


def ledger_line(block, owners, rest_unknown, rid, since, until):
    """The `attention` line (the module docstring), and its flags. ValueError when the owners file is refused."""
    items = block["questions"]["items"]
    errors, _missing = check_owners(items, owners if owners is not None else {}, rest_unknown, owners is not None)
    if errors:
        raise ValueError("; ".join(errors))
    q = question_counts(items, owners or {})
    lists, _dropped = circling_items(block)
    circ = {}
    for rule in ("W1", "W2"):
        w = _weight(rule)
        ordered = sorted(lists[rule], key=lambda x: (-(x.get(w) or 0), x["slug"]))
        circ[rule] = [_line_item(rule, x) for x in ordered[:CIRCLE_MAX]]
    fields = {"reflection": rid, "since": since, "until": until, "questions": q, "trails": block["trails"]["counts"],
              "waits": [dict(w) for w in (block.get("waits") or [])[:WAITS_MAX]], "circling": circ}
    flags = []
    while RR.line_bytes("attention", fields) > RR.MAX_LINE:
        biggest = max(("W1", "W2"), key=lambda r: len(fields["circling"][r]))
        if len(fields["circling"][biggest]) > 1:
            fields["circling"][biggest] = fields["circling"][biggest][:len(fields["circling"][biggest]) // 2]
            flags.append("the line was over the Run record's limit: circling %s cut to %d" % (biggest, len(fields["circling"][biggest])))
        elif len(fields["waits"]) > 1:
            fields["waits"] = fields["waits"][:len(fields["waits"]) // 2]
            flags.append("the line was over the Run record's limit: waits cut to %d" % len(fields["waits"]))
        else:
            break
    return fields, flags


# ---- the block ---------------------------------------------------------------------------------------------------------

def block(whole, reflections, since, until, rid, ev, find, index, tasks_root, origin, genv, close_line, mdate, env=None):
    """span's `attention` block over [since, until] (ms) for Reflection `rid` (the module docstring)."""
    out = Out()
    notes = Notes(find, index, tasks_root)
    git = Git(genv)
    repos = Repos(git, origin, out)
    read = key_trails(review_rounds(ev, since - TRAIL_DAYS * 24 * HOUR, until, out), repos, since, until)
    floor = min([since, until - TOUCH_DAYS * 24 * HOUR] + [tr["rounds"][0]["at"] for tr in read])
    dirs, why = transcript_dirs(env)
    if why:
        out.flag("%s: no questions or touches read" % why)
    tx = Transcripts()
    tx.read(transcript_files(dirs, floor, out), floor, until, out)
    items = question_items(tx, since, until, repos.label, out)
    asks = []
    for cid, a in tx.asks.items():
        n = len([q for q in a["input"].get("questions") or [] if isinstance(q, dict)])
        res = tx.results.get(cid)
        kind, _ans = classify(res)
        if kind != "failed":
            asks.append((a["t"], a["session"], a["cwd"], ["%s#%d" % (cid, i) for i in range(n)]))
    asks.sort(key=lambda x: (x[0], x[3][:1]))
    trail_items = trails(read, repos, asks, out)
    handed = {i for t in trail_items for i in t["handedAfterStop"]}
    for x in items:
        x["handedAfterStop"] = x["id"] in handed
    for t in trail_items:
        t["handedAfterStop"] = t["handedAfterStop"][:HANDED_MAX]
    engine = 0
    for _slug, lines in sorted(whole.items()):
        for t, _n, d in lines:
            if d.get("kind") == "set-aside" and d.get("reasonClass") == "review-rounds" and since <= t <= until:
                engine += 1
    cands = rollouts(whole, notes, until, out)
    circ = circling(tx, items, whole, cands, notes, since, until, mdate, close_line, out)
    return {"questions": {"items": items, "counts": question_counts(items)},
            "trails": {"items": trail_items, "counts": trail_counts(trail_items, engine)},
            "waits": waits(cands, whole, notes, since, until, close_line, out),
            "circling": circ, "watches": watch_previews(reflections, circ), "trend": trend(reflections, rid),
            "flags": out.flags, "cannotShow": out.cannot}


# ---- the CLI ---------------------------------------------------------------------------------------------------------

class Stop(Exception):
    def __init__(self, message, code):
        Exception.__init__(self, message)
        self.code = code


def read_json(path, what):
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        raise Stop("%s %s cannot be read as JSON: %s" % (what, path, e), 1)


def cmd_tally(a):
    span = read_json(a.span, "--span")
    att = span.get("attention") if isinstance(span, dict) else None
    items = ((att or {}).get("questions") or {}).get("items") if isinstance(att, dict) else None
    if not isinstance(items, list):
        raise Stop("--span %s has no attention block: tally reads the questions span wrote" % a.span, 2)
    owners = None
    if a.owners:
        owners = read_json(a.owners, "--owners")
        if not isinstance(owners, dict):
            raise Stop("--owners %s is no JSON object {<question id>: <owner>}" % a.owners, 2)
    ids = sorted({x.get("session") for x in items if isinstance(x, dict) and isinstance(x.get("session"), str)})
    chosen = []
    for p in a.session:
        if len(p) < 8:
            raise Stop("--session %s: a prefix needs at least 8 characters" % p, 2)
        hit = [s for s in ids if s.startswith(p)]
        if not hit:
            raise Stop("--session %s matches no Session in the span" % p, 2)
        if len(hit) > 1:
            raise Stop("--session %s matches %d Sessions: %s" % (p, len(hit), ", ".join(hit)), 2)
        if hit[0] not in chosen:
            chosen.append(hit[0])
    mine = [x for x in items if isinstance(x, dict) and x.get("session") in chosen]
    print(json.dumps({"sessions": {s: question_counts([x for x in mine if x["session"] == s], owners) for s in chosen},
                      "total": question_counts(mine, owners)}, indent=2, ensure_ascii=False))
    return 0


def cmd_span_block(a):
    REF = _load("thread_reflect", os.path.join(HERE, "reflect.py"))
    try:
        until = REF.to_ms(a.until, "--until") if a.until else REF.now_ms()
        since = REF.to_ms(a.since, "--since") if a.since else until - 7 * REF.DAY_MS
        if since > until:
            raise REF.Stop("--since %s is after --until %s" % (fmt(since), fmt(until)), 2)
        REF.zone()
        ev = REF.events_dir()
        sp = REF.Span(argparse.Namespace(tasks_dir=a.tasks_dir, out=a.out or os.devnull))
        records = sp.records(ev)
        blk = sp.attention(ev, records, REF.read_reflections(), since, until, None)
    except REF.Stop as e:
        raise Stop(str(e), e.code)
    text = json.dumps({"attention": blk, "flags": sp.flags, "cannotShow": sp.cannot}, indent=2, ensure_ascii=False) + "\n"
    if a.out:
        try:
            with open(os.path.expanduser(a.out), "w", encoding="utf-8") as f:
                f.write(text)
        except OSError as e:
            raise Stop("cannot write --out %s: %s" % (a.out, e), 1)
    else:
        sys.stdout.write(text)
    return 0


class Parser(argparse.ArgumentParser):
    def error(self, message):
        sys.stderr.write("attention: %s\n" % message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="attention.py", description="The weekly reading's attention ledger (p30-7, ADR 0056).")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    s = sub.add_parser("span-block")
    s.add_argument("--since")
    s.add_argument("--until")
    s.add_argument("--tasks-dir")
    s.add_argument("--out")
    t = sub.add_parser("tally")
    t.add_argument("--span", required=True)
    t.add_argument("--owners")
    t.add_argument("--session", action="append", required=True)
    a = p.parse_args(argv)
    verbs = {"span-block": cmd_span_block, "tally": cmd_tally}
    if a.verb not in verbs:
        p.error("a verb is required: %s" % ", ".join(verbs))
    try:
        return verbs[a.verb](a)
    except Stop as e:
        sys.stderr.write("attention: %s\n" % e)
        return e.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
