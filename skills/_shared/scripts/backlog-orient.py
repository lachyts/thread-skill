#!/usr/bin/env python3
"""The Backlog orient's one reader and writer (skills/orient/backlog.md; ADR 0071).

python >= 3.9 with PyYAML, built like next-action.py. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/backlog-orient.py <verb> ... [--vault PATH] [--json]

Verbs:

  sweep --area <note> [--json]
      The area's Backlog, read at one instant: `read_at` (Melbourne time, microseconds, taken before the first read),
      one row per member, `projects[]`, `excluded[]` and the declared trigger's read. Writes nothing.
  park --area <note> --task <t> --reason <r> [--today D]
      `status: parked`, a `parked-by: backlog-orient <D>` line just below `status:`, and the Notes line
      `- <D> parked by the Backlog orient: <r>`. A task the orient already parked is `[no-change]`. Also refused: a
      task the trigger's `urgent[]` names.
  reopen --task <t> --batch <b> [--today D]
      An orient park back to `status: open`, its `parked-by:` line removed, and `- <D> reopened by the Backlog orient:
      joins <b>`. Refused: a held park, a task that is not parked.
  obsolete --task <t> (--fixed-by <X> | --gone <W>) [--today D]
      `status: dropped` (an orient park's `parked-by:` removed) and `- <D> obsolete (Backlog orient): no longer true:
      fixed by <X>` or `…: no longer true: <W>`. Exactly one of the two flags.
  rehome --area <note> --task <t> --to <project> [--today D]
      The area's link in `projects:` swapped for the target (every other link kept) and `- <D> re-homed by the
      Backlog orient: [[<area>]] → [[<target>]]`. Refused: a target outside the area folder, under an excluded name,
      under Archive/, or not tagged `project` (a record note, a status log, a reference note); a task that already
      names it; a `projects:` that links the area nowhere.
  wait --task <t> --why <w> [--today D]
      One Notes line, `- <D> waits for the next Backlog orient: <w>`.
  record --area <note> --date D < json  |  record --append --note <path> < json
      The record note `<folder>/Backlog orients/<D> <Area> Backlog orient.md` (` (2)`, ` (3)` on the same day), tagged
      `backlog-orient` only, frontmatter `area`, `date`, `read_at`, `trigger_stamp` (or `none`), `seen_orient_at` (or
      `none`), then `last_orient_at` and `last_reason`, empty until `trigger --write` sets them. Its sections, in
      order, are SECTIONS. The JSON: {"read_at", "trigger_stamp", "seen_orient_at", "rows": {<section>: [<row>…]},
      "touched": [<slug>…]}; `--append` takes "rows", "touched" and a new "trigger_stamp" only. A row is one line
      (its whitespace folded), written `- <row>`; a touched slug is `- [[<slug>]]`, never twice.
  trigger --area <note> --read [--json] [--file P]
      The trigger file read: writes nothing. Its path is --file; otherwise, and only when the area note declares
      `backlog_trigger:`, $PULSE_TRIGGER_FILE or the declared path. With neither: `trigger: none declared on [[<area>]]`.
  trigger --area <note> --write --reason pile-up|urgent|manual --record <path> [--file P] [--at ISO]
      The write-back. An empty `last_orient_at:` in the record makes it write-back #1; a set one, a re-stamp. Guards,
      all checked before anything is written:
        1. the file's `stamped_at` (or none) is the record's `trigger_stamp`; else `stamp <value>`, then for each task in
           `tasks` and `urgent[].task` missing from the record's `## Trigger`: `unread <rel>` (named nowhere) or
           `seen <rel>` (named), with ` urgent` when `urgent[]` names it;
        2. every Backlog task whose mtime is after the record's `read_at` is named; else `unread <rel>`. A task is named
           when the record links it outside `## Answered, waiting`, when a rollout note the record's `## Batches` links
           (in Work/Tasks/ or Work/Tasks/Archive/Rollouts/) links it from its body, or when its own `rollout:` links one
           of those notes;
        3. the file's `last_orient_at` is the record's `seen_orient_at` (write-back #1) or its own `last_orient_at`
           (a re-stamp);
        4. a re-stamp only: `## Answered, waiting` holds no row; else `waiting <rel>`.
      A guard that fails: its lines on stdout, one `backlog-orient:` stderr line, exit 4, the file and the record
      unchanged. Else `last_orient_at` (now or --at, Melbourne time, rounded up to the next whole second; an --at more
      than FUTURE_TOLERANCE_MINUTES ahead is refused) and `last_reason` are written over the file's other keys, kept
      in order, the way the Pulse's investigations.atomic_write_json writes: a same-directory `<name>.<rand>.tmp`,
      indent 1, ensure_ascii off, a trailing newline, the file's mode kept (a new file 0600), and os.replace. Just
      before the replace (`_before_replace()`, the tests' seam) the file's bytes are read again: changed, the guards
      run once more on the new bytes; changed again, exit 4. Then the record's `last_orient_at:` and `last_reason:`
      are set and one `## Write-back` row added. A missing file is created with the two keys; an unparseable file or
      one that is not a JSON object is exit 2, its bytes untouched.

The Backlog: the one copy of the rule, line for line the Pulse's (~/repos/tools/metrics/animately/analyst/
backlog_trigger.py: Projects, Task, read_vault, the `status in BACKLOG_STATUSES` filter; file_backlog.py:
split_frontmatter, FIELD_RE, unquote), so the orient reads the Backlog the trigger counted. Line-based throughout, so
a task PyYAML cannot parse is still a member. A note in Work/Tasks/*.md (never Archive/), read with a BOM dropped
and CRLF made LF, whose first line is `---`, is a member when its `status` (the last `status:` line, unquoted,
lower-cased) is open or parked, its `tags` hold no `rollout`, and a name its `projects:` links (`[[X]]`,
`[[X|alias]]`, `[[X#h]]`, `[[path/X]]` or a bare name, in the inline, scalar or block form) is the area note's stem
or the stem or `aliases:` of any .md under the area's folder at any depth, casefolded. It is out when any such name,
or the stem it resolves to, casefolded, starts with a `backlog_excludes:` name (the area note's list of links, the
Pulse's EXCLUDED_PROJECT_PREFIX: `["[[GifLab]]"]` reads `giflab`).

A row carries `park`: `orient` for a park whose `parked-by:` reads `backlog-orient …`, `held` for any other park (his
own, or one made before ADR 0071: frozen, never reopened, scheduled, obsoleted or parked again); `areaOnly` (every
member project it names is the area note itself); `inFlight` (estate-scan.py's in_flight over link_live, vault-grammar
§ In flight); `frozen`: `thread`, `decisions`, `not a task`, `unparseable:<why>` (next-action.py's Note.why: mend it,
then sweep again) or null; `urgent` and `stamped` (the trigger's `urgent[]` and `tasks` name it). `projects[]` holds
the `project`-tagged notes under the area folder, outside Archive/ and the excludes; `excluded[]` every note under the
folder whose stem starts with an excluded name.

The write verbs (park, reopen, obsolete, rehome, wait) refuse, exit 2 with the vault byte-identical: a missing note
(none directly in Work/Tasks), an unparseable one (mend it first), one that is not a `task`, one tagged `thread` or
`decisions`, a landed one (done, dropped or merged), one in flight, a held park, and an empty reason. Byte edits use
next-action.py's split_lines, find_span and load_error (loaded by path, never copied), so a CRLF note keeps its line
endings and a BOM stays; every edit is re-parsed and must change exactly the keys it names before its one in-place
save (the inode kept).

Exit 0 on success; 2 on a refusal or a usage error (one `backlog-orient:` stderr line, nothing written); 3 when the
vault, PyYAML or a sibling script is missing; 4 when a write-back guard holds.
"""
import argparse
import datetime
import importlib.util
import json
import os
import re
import sys
import tempfile
from zoneinfo import ZoneInfo

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
NEXT_ACTION_PY = os.path.join(HERE, "next-action.py")
ESTATE_SCAN_PY = os.path.join(HERE, "estate-scan.py")
VAULT_DEFAULT = "~/repos/obsidian"
TASKS_DIR = os.path.join("Work", "Tasks")
PROJECTS_DIR = os.path.join("Work", "Projects")
ROLLOUT_ARCHIVE = os.path.join("Work", "Tasks", "Archive", "Rollouts")
MEL = ZoneInfo("Australia/Melbourne")
BACKLOG_STATUSES = ("open", "parked")       # backlog_trigger.py's BACKLOG_STATUSES
LANDED = ("done", "dropped", "merged")
FUTURE_TOLERANCE_MINUTES = 15               # backlog_trigger.py's: a later last_orient_at is unusable
PARKED_BY = "parked-by"
ORIENT_MARK = "backlog-orient"
RECORD_TAG = "backlog-orient"
RECORD_DIR = "Backlog orients"
REASONS = ("pile-up", "urgent", "manual")
SECTIONS = ("Trigger", "Batches", "Rollouts started", "Parks", "Reopens", "Obsoletes", "Re-homes",
            "Merges and unbundles", "Held parks", "Session lane and misfits", "Left out", "Drift fixes and mends",
            "Decided for you", "Questions asked", "Held by his answer", "Questions waiting", "Answered, waiting",
            "Folded", "Write-back", "Touched")
WAITING = "Answered, waiting"
FRONT_KEYS = ("area", "date", "read_at", "trigger_stamp", "seen_orient_at", "last_orient_at", "last_reason")

# The Pulse's line rules (backlog_trigger.py, file_backlog.py), ported line for line.
FIELD_RE = re.compile(r"^([A-Za-z_][\w-]*):(.*)$")
LINK_RE = re.compile(r"\[\[([^\]\n]+?)\]\]")
ITEM_RE = re.compile(r"^\s*-\s*(.*)$")
# A wikilink's target in prose (a record row, a rollout note's body).
BODY_LINK_RE = re.compile(r"\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]")
HEADING_RE = re.compile(r"^#{1,2}[ \t]")
FENCE_RE = re.compile(r"^ {0,3}(?:```|~~~)")


class Refused(Exception):
    def __init__(self, msg, code=2):
        super().__init__(msg)
        self.code = code


def fail(code, reason):
    sys.stderr.write("backlog-orient: %s\n" % reason)
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


NA = ES = None


def load_siblings():
    global NA, ES
    for name, path in (("thread_next_action", NEXT_ACTION_PY), ("thread_estate_scan", ESTATE_SCAN_PY)):
        try:
            mod = _load(name, path)
        except SystemExit:
            fail(3, "cannot load %s" % path)
        except Exception as e:  # a broken install: one line, never a traceback
            fail(3, "cannot load %s: %s" % (path, e))
        if name == "thread_next_action":
            NA = mod
        else:
            ES = mod
    if NA.yaml is None:
        fail(3, "PyYAML is required: python3 -m pip install pyyaml")


# ---- the Pulse's line rules ------------------------------------------------------------------------------------

def normalise(text):
    """backlog_trigger.normalise: a BOM dropped and CRLF made LF."""
    if text.startswith("﻿"):
        text = text[1:]
    return text.replace("\r\n", "\n")


def unquote(v):
    """file_backlog.unquote: whitespace and one layer of quotes stripped."""
    return str(v).strip().strip("\"'").strip()


def fm_lines(text):
    lines = text.split("\n")
    if lines[0] != "---":
        return []
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return lines[1:i]
    return []


def fields_of(lines):
    """file_backlog.split_frontmatter's fields: each `key: value` line's raw value, the last one winning."""
    out = {}
    for line in lines:
        m = FIELD_RE.match(line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def split_items(inner):
    items, cur, depth, i = [], "", 0, 0
    while i < len(inner):
        if inner.startswith("[[", i):
            depth, cur, i = depth + 1, cur + "[[", i + 2
        elif inner.startswith("]]", i) and depth:
            depth, cur, i = depth - 1, cur + "]]", i + 2
        elif inner[i] == "," and not depth:
            items.append(cur)
            cur, i = "", i + 1
        else:
            cur, i = cur + inner[i], i + 1
    items.append(cur)
    return items


def fm_list(lines, key):
    head = re.compile(rf"^{re.escape(key)}:(.*)$")
    for i, line in enumerate(lines):
        m = head.match(line)
        if not m:
            continue
        rest = m.group(1).strip()
        if rest.startswith("["):
            inner = rest[1:-1] if rest.endswith("]") else rest[1:]
            raw = split_items(inner)
        elif rest:
            raw = [rest]
        else:
            raw = []
            for nxt in lines[i + 1:]:
                item = ITEM_RE.match(nxt)
                if item:
                    raw.append(item.group(1))
                elif nxt.strip():
                    break
        return [v for v in (unquote(x) for x in raw) if v]
    return []


def link_names(items):
    names = []
    for item in items:
        links = LINK_RE.findall(item)
        for target in links or [item]:
            name = target.split("|", 1)[0].split("#", 1)[0].strip()
            name = name.rsplit("/", 1)[-1]
            name = name[:-3] if name.endswith(".md") else name
            if name:
                names.append(name)
    return names


def line_tags(lines):
    return {t.casefold().lstrip("#") for t in fm_list(lines, "tags")}


def read_text(path):
    with open(path, "rb") as fh:
        return normalise(fh.read().decode("utf-8", errors="replace"))


# ---- the area -----------------------------------------------------------------------------------------------

class Area:
    """The area note, its folder, its names (backlog_trigger.Projects) and its excludes."""

    def __init__(self, vault, arg):
        self.vault = vault
        try:
            rel = vault.path_arg(arg)
        except NA.Refused as e:
            raise Refused("--area %s: %s" % (arg, e))
        if rel is None:
            hits = [p for p in vault.targets(arg) if p.startswith(PROJECTS_DIR + os.sep) and not vault.archived(p)]
            if len(hits) != 1:
                raise Refused("--area %s names %s area note under %s" % (arg, "no" if not hits else "more than one",
                                                                         PROJECTS_DIR))
            rel = hits[0]
        parts = rel.split(os.sep)
        if len(parts) < 4 or os.sep.join(parts[:2]) != PROJECTS_DIR:
            raise Refused("--area %s is not a note under %s/<folder>/" % (arg, PROJECTS_DIR))
        self.rel = rel
        self.stem = os.path.basename(rel)[:-3]
        self.folder = os.sep.join(parts[:3])
        lines = fm_lines(read_text(os.path.join(vault.root, rel)))
        if "area" not in line_tags(lines):
            raise Refused("%s is not tagged `area`: --backlog takes an area" % rel)
        self.excludes = [n.casefold() for n in link_names(fm_list(lines, "backlog_excludes"))]
        declared = fields_of(lines).get("backlog_trigger")
        self.trigger_declared = unquote(declared) if declared is not None and unquote(declared) else None
        self.stems = {self.stem.casefold(): self.stem}
        # Every .md under the folder at any depth, in the order `sorted(root.rglob("*.md"))` gives (by path parts), so
        # a name two notes share resolves to the same stem as in the Pulse.
        found = []
        for d, _, files in os.walk(os.path.join(vault.root, self.folder)):
            found.extend(os.path.join(d, n) for n in files if n.endswith(".md"))
        rows = []   # (rel, stem, frontmatter lines) of each
        for path in sorted(found, key=lambda x: x.split(os.sep)):
            try:
                text = read_text(path)
            except OSError:
                continue
            nlines = fm_lines(text)
            stem = os.path.basename(path)[:-3]
            for n in [stem, *fm_list(nlines, "aliases")]:
                self.stems.setdefault(n.casefold(), stem)
            rows.append((os.path.relpath(path, vault.root), stem, nlines))
        self.notes = rows

    def link(self):
        return "[[%s]]" % self.stem

    def excluded(self, name):
        return any(name.casefold().startswith(x) for x in self.excludes)

    def resolve(self, names):
        return [(n, self.stems.get(n.casefold())) for n in names]

    def member_names(self, names):
        """(member, the stems its member names resolve to): backlog_trigger.Projects.is_animately with the
        area's own excludes."""
        resolved = self.resolve(names)
        for name, stem in resolved:
            if self.excluded(name) or (stem and self.excluded(stem)):
                return False, []
        stems = [s for _, s in resolved if s is not None]
        return bool(stems), stems

    def trigger_path(self, file_arg):
        if file_arg:
            return os.path.expanduser(file_arg)
        if self.trigger_declared is None:
            return None
        return os.path.expanduser(os.environ.get("PULSE_TRIGGER_FILE") or self.trigger_declared)


# ---- the Backlog -----------------------------------------------------------------------------------------------

class Member:
    def __init__(self, vault, area, rel, text, lines):
        self.rel = rel
        self.slug = os.path.basename(rel)[:-3]
        self.lines = lines
        f = fields_of(lines)
        self.fields = f
        self.status = unquote(f.get("status", "")).lower() or None
        self.tags = line_tags(lines)
        names = link_names(fm_list(lines, "projects"))
        _, self.stems = area.member_names(names)
        self.note = NA.Note(os.path.join(vault.root, rel), text)
        by = unquote(f.get(PARKED_BY, "")) if PARKED_BY in f else ""
        self.parked_by = by or None
        self.park = None
        if self.status == "parked":
            self.park = "orient" if by.startswith(ORIENT_MARK) else "held"
        if self.note.fm is not None:
            link = ES.first_link(NA, self.note.get("rollout"))
            st = NA.status_of(self.note)
        else:
            rl = fm_list(lines, "rollout")
            found = LINK_RE.findall(rl[0]) if rl else []
            link = found[0].split("|", 1)[0].split("#", 1)[0].strip() if found else (rl[0] if rl else None)
            st = (self.status or "").replace("-", "_")
        self.in_flight = ES.in_flight(st, ES.link_live(NA, vault, link))
        if self.note.fm is None:
            self.frozen = "unparseable:%s" % (self.note.why or "unreadable")
        elif "thread" in self.tags:
            self.frozen = "thread"
        elif "decisions" in self.tags:
            self.frozen = "decisions"
        elif "task" not in self.tags:
            self.frozen = "not a task"
        else:
            self.frozen = None


def backlog(vault, area):
    """{rel: Member} for the area's Backlog, by the Pulse's line rules (backlog_trigger.read_vault and its filter)."""
    out = {}
    tasks = os.path.join(vault.root, TASKS_DIR)
    if not os.path.isdir(tasks):
        raise Refused("no %s in the vault" % TASKS_DIR, code=3)
    for name in sorted(os.listdir(tasks)):
        path = os.path.join(tasks, name)
        if not name.endswith(".md") or not os.path.isfile(path):
            continue
        try:
            text = read_text(path)
        except OSError:
            continue
        lines = fm_lines(text)
        names = link_names(fm_list(lines, "projects"))
        member, _ = area.member_names(names)
        status = unquote(fields_of(lines).get("status", "")).lower()
        if not member or "rollout" in line_tags(lines) or status not in BACKLOG_STATUSES:
            continue
        rel = os.path.join(TASKS_DIR, name)
        out[rel] = Member(vault, area, rel, text, lines)
    return out


def now_mel(at=None):
    return at if at is not None else datetime.datetime.now(MEL)


def parse_ts(v):
    """backlog_trigger.parse_ts: an aware datetime (a naive one read as Melbourne), else None."""
    if not isinstance(v, str) or not v.strip():
        return None
    try:
        t = datetime.datetime.fromisoformat(v.strip())
    except ValueError:
        return None
    return t.replace(tzinfo=MEL) if t.tzinfo is None else t


def ns_of(t):
    epoch = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    d = t - epoch
    return (d.days * 86400 + d.seconds) * 10**9 + d.microseconds * 1000


def posix(rel):
    return rel.replace(os.sep, "/")


# ---- the trigger file ---------------------------------------------------------------------------------------------

def read_trigger_bytes(path):
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        return None
    except OSError as e:
        raise Refused("cannot read %s: %s" % (path, e))


def trigger_state(path, raw):
    """The file's object ({} when missing). Unparseable, or not an object: a refusal."""
    if raw is None:
        return {}
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise Refused("%s is not JSON: left untouched" % path)
    if not isinstance(obj, dict):
        raise Refused("%s is not a JSON object: left untouched" % path)
    return obj


def trigger_read(area, file_arg, now=None):
    path = area.trigger_path(file_arg)
    if path is None:
        return {"declared": False, "path": None, "line": "trigger: none declared on %s" % area.link()}
    raw = read_trigger_bytes(path)
    state = trigger_state(path, raw)
    now = now_mel(now)
    stamped = state.get("stamped_at")
    last = state.get("last_orient_at")
    t, L = parse_ts(stamped), parse_ts(last)
    usable = L if L is not None and L <= now + datetime.timedelta(minutes=FUTURE_TOLERANCE_MINUTES) else None
    pending = t is not None and (usable is None or t > usable)
    urgent = [u for u in state.get("urgent") or [] if isinstance(u, dict)]
    return {"declared": True, "path": path, "exists": raw is not None, "stamped_at": stamped,
            "reason": state.get("reason"), "pending": pending,
            "tasks": [x for x in state.get("tasks") or [] if isinstance(x, str)], "urgent": urgent,
            "last_orient_at": last, "last_reason": state.get("last_reason"),
            "runReason": (state.get("reason") or "pile-up") if pending else "manual"}


# ---- note edits ------------------------------------------------------------------------------------------------

class Edit:
    """A task note's raw text, split by next-action.py's split_lines (CRLF kept), its BOM kept aside."""

    def __init__(self, path):
        self.path = path
        try:
            with open(path, encoding="utf-8", newline="") as fh:
                raw = fh.read()
        except (OSError, UnicodeDecodeError) as e:
            raise Refused("cannot read %s: %s" % (path, e))
        self.raw = raw
        self.bom = "﻿" if raw.startswith("﻿") else ""
        self.lines = NA.split_lines(raw[len(self.bom):])
        self.span = NA.find_span(self.lines)
        if self.span is None:
            raise Refused("%s has no closed frontmatter" % path)
        first = self.lines[0]
        self.nl = first[len(first.rstrip("\r\n")):] or "\n"

    def fm_text(self, lines=None):
        lines = self.lines if lines is None else lines
        span = NA.find_span(lines)
        return "".join(lines[span[0]:span[1]]).replace("\r\n", "\n")

    def key_at(self, key):
        hits = [i for i in range(self.span[0], self.span[1]) if re.match(r"^%s:(?:[ \t]|\r?\n|$)" % re.escape(key),
                                                                          self.lines[i])]
        if len(hits) > 1:
            raise Refused("%s carries `%s:` more than once; left alone" % (self.path, key))
        return hits[0] if hits else None

    def set_line(self, key, value):
        i = self.key_at(key)
        line = "%s: %s%s" % (key, value, self.nl)
        if i is None:
            self.lines.insert(self.span[1], line)
            self.span = (self.span[0], self.span[1] + 1)
        else:
            self.lines[i] = line
        return i

    def insert_below(self, key, new_key, value):
        at = self.key_at(key)
        old = self.key_at(new_key)
        line = "%s: %s%s" % (new_key, value, self.nl)
        if old is not None:
            self.lines[old] = line
            return
        self.lines.insert(at + 1, line)
        self.span = (self.span[0], self.span[1] + 1)

    def drop_key(self, key):
        i = self.key_at(key)
        if i is not None:
            del self.lines[i]
            self.span = (self.span[0], self.span[1] - 1)

    def add_note_line(self, text):
        """`- <text>` as the last line of `## Notes` (a heading outside a fence), else a new `## Notes` at the end."""
        lines, nl = self.lines, self.nl
        fence, head = False, None
        for i in range(self.span[1] + 1, len(lines)):
            s = lines[i].rstrip("\r\n")
            if FENCE_RE.match(s):
                fence = not fence
            elif not fence and s.rstrip() == "## Notes":
                head = i
                break
        entry = "- %s%s" % (text, nl)
        if head is None:
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += nl
            if lines and lines[-1].strip():
                lines.append(nl)
            lines.extend(["## Notes" + nl, nl, entry])
            return
        end, fence = len(lines), False
        for i in range(head + 1, len(lines)):
            s = lines[i].rstrip("\r\n")
            if FENCE_RE.match(s):
                fence = not fence
            elif not fence and HEADING_RE.match(s):
                end = i
                break
        last = head
        for i in range(head + 1, end):
            if lines[i].strip():
                last = i
        if not lines[last].endswith("\n"):
            lines[last] += nl
        if last == head:
            lines.insert(head + 1, nl)
            last += 1
        lines.insert(last + 1, entry)

    def text(self):
        return self.bom + "".join(self.lines)

    def save(self, want):
        """Re-parse, check the frontmatter is exactly `want`, then one in-place save (the inode kept)."""
        fm = self.fm_text()
        err = NA.load_error(fm)
        if err is not None:
            raise Refused("%s: the edit would not parse; left alone" % self.path)
        got = NA.yaml.load(fm, Loader=NA.LOADER) or {}
        if got != want:
            raise Refused("%s: the edit would change other frontmatter; left alone" % self.path)
        try:
            with open(self.path, "r+", encoding="utf-8", newline="") as fh:
                fh.write(self.text())
                fh.truncate()
        except OSError as e:
            raise Refused("cannot write %s: %s" % (self.path, e))


def fold(s):
    return " ".join((s or "").split())


def task_for_write(vault, arg):
    """(rel, Note, Edit) for a write verb's task, after the shared refusals."""
    try:
        rel = vault.resolve_task(arg)
    except NA.Refused as e:
        raise Refused(str(e))
    shown = posix(rel)
    path = os.path.join(vault.root, rel)
    text = read_text(path)
    note = NA.Note(path, text)
    if note.fm is None:
        raise Refused("%s: %s: mend it first (next-action.py mend)" % (shown, note.why or note.error))
    tags = NA.tags_of(note)
    if "task" not in tags:
        raise Refused("%s is not a task note" % shown)
    for t in ("thread", "decisions"):
        if t in tags:
            raise Refused("%s is tagged `%s`: frozen, never written here" % (shown, t))
    st = NA.status_of(note)
    if st in LANDED:
        raise Refused("%s is %s: landed work is never written here" % (shown, st))
    link = ES.first_link(NA, note.get("rollout"))
    if ES.in_flight(st, ES.link_live(NA, vault, link)):
        raise Refused("%s is in flight (vault-grammar.md § In flight): its run owns the note" % shown)
    by = str(note.get(PARKED_BY) or "").strip()
    if st == "parked" and not by.startswith(ORIENT_MARK):
        raise Refused("%s is a held park (no `parked-by: backlog-orient`): frozen, never written here" % shown)
    return rel, note, Edit(path)


def today_of(args):
    if args.today:
        try:
            return datetime.date.fromisoformat(args.today).isoformat()
        except ValueError:
            fail(2, "--today must be a date, YYYY-MM-DD: %r" % args.today)
    return datetime.datetime.now(MEL).date().isoformat()


def need(value, flag):
    v = fold(value)
    if not v:
        raise Refused("%s is empty" % flag)
    return v


def cmd_park(vault, args):
    area = Area(vault, args.area)
    reason = need(args.reason, "--reason")
    rel, note, ed = task_for_write(vault, args.task)
    shown = posix(rel)
    st = NA.status_of(note)
    if st == "parked":
        return ["[no-change] %s: already parked by the Backlog orient" % shown]
    if st != "open":
        raise Refused("%s is at status %s, not open" % (shown, st or "none"))
    trig = trigger_read(area, None)
    if any(u.get("task") == shown for u in trig.get("urgent", [])):
        raise Refused("%s is urgent (the trigger's urgent[] names it): an urgent task is never parked" % shown)
    d = today_of(args)
    want = dict(note.fm)
    want["status"] = "parked"
    want[PARKED_BY] = "%s %s" % (ORIENT_MARK, d)
    ed.set_line("status", "parked")
    ed.insert_below("status", PARKED_BY, want[PARKED_BY])
    ed.add_note_line("%s parked by the Backlog orient: %s" % (d, reason))
    ed.save(want)
    return ["parked %s: %s" % (shown, reason)]


def cmd_reopen(vault, args):
    batch = need(args.batch, "--batch")
    rel, note, ed = task_for_write(vault, args.task)
    shown = posix(rel)
    if NA.status_of(note) != "parked":
        raise Refused("%s is not parked" % shown)
    d = today_of(args)
    want = dict(note.fm)
    want["status"] = "open"
    want.pop(PARKED_BY, None)
    ed.set_line("status", "open")
    ed.drop_key(PARKED_BY)
    ed.add_note_line("%s reopened by the Backlog orient: joins %s" % (d, batch))
    ed.save(want)
    return ["reopened %s: joins %s" % (shown, batch)]


def cmd_obsolete(vault, args):
    if (args.fixed_by is None) == (args.gone is None):
        raise Refused("obsolete takes exactly one of --fixed-by and --gone")
    why = "fixed by %s" % need(args.fixed_by, "--fixed-by") if args.fixed_by is not None else need(args.gone, "--gone")
    rel, note, ed = task_for_write(vault, args.task)
    shown = posix(rel)
    d = today_of(args)
    want = dict(note.fm)
    want["status"] = "dropped"
    want.pop(PARKED_BY, None)
    ed.set_line("status", "dropped")
    ed.drop_key(PARKED_BY)
    ed.add_note_line("%s obsolete (Backlog orient): no longer true: %s" % (d, why))
    ed.save(want)
    return ["obsolete %s: no longer true: %s" % (shown, why)]


def cmd_wait(vault, args):
    why = need(args.why, "--why")
    rel, note, ed = task_for_write(vault, args.task)
    d = today_of(args)
    ed.add_note_line("%s waits for the next Backlog orient: %s" % (d, why))
    ed.save(dict(note.fm))
    return ["waits %s: %s" % (posix(rel), why)]


def cmd_rehome(vault, args):
    area = Area(vault, args.area)
    to = need(args.to, "--to")
    rel, note, ed = task_for_write(vault, args.task)
    shown = posix(rel)
    try:
        target_rel = vault.path_arg(to)
    except NA.Refused as e:
        raise Refused("--to %s: %s" % (to, e))
    hits = [target_rel] if target_rel else vault.targets(to)
    inside = [p for p in hits if p.startswith(area.folder + os.sep)]
    if not inside:
        raise Refused("--to %s is no note under the area folder %s" % (to, posix(area.folder)))
    if len(inside) > 1:
        raise Refused("--to %s names %d notes under %s" % (to, len(inside), posix(area.folder)))
    target = inside[0]
    stem = os.path.basename(target)[:-3]
    if vault.archived(target):
        raise Refused("%s is under Archive/: never a re-home target" % posix(target))
    if area.excluded(stem):
        raise Refused("%s is under an excluded name (backlog_excludes:): never a re-home target" % posix(target))
    tlines = fm_lines(read_text(os.path.join(vault.root, target)))
    if "project" not in line_tags(tlines):
        raise Refused("%s is not tagged `project` (a record, a status log or a reference note): never a re-home "
                      "target" % posix(target))
    lines = fm_lines(read_text(os.path.join(vault.root, rel)))
    names = link_names(fm_list(lines, "projects"))
    if any(s == stem for _, s in area.resolve(names)):
        raise Refused("%s already names [[%s]]" % (shown, stem))
    i = ed.key_at("projects")
    if i is None:
        raise Refused("%s has no `projects:`" % shown)
    end = i + 1
    while end < ed.span[1] and (ed.lines[end][:1] in (" ", "\t", "-") or not ed.lines[end].strip()):
        end += 1
    swapped = [0]

    def swap(m):
        name = link_names([m.group(0)])
        if name and area.stems.get(name[0].casefold()) == area.stem:
            swapped[0] += 1
            return "[[%s]]" % stem
        return m.group(0)

    for k in range(i, end):
        ed.lines[k] = LINK_RE.sub(swap, ed.lines[k])
    if not swapped[0]:
        raise Refused("%s: its projects: links %s nowhere" % (shown, area.link()))
    d = today_of(args)
    want = dict(note.fm)
    if NA.load_error(ed.fm_text()) is not None:
        raise Refused("%s: the re-home would not parse; left alone" % shown)
    newfm = NA.yaml.load(ed.fm_text(), Loader=NA.LOADER) or {}
    if set(newfm) != set(want) or any(newfm[k] != want[k] for k in want if k != "projects"):
        raise Refused("%s: the re-home would change other frontmatter; left alone" % shown)
    want["projects"] = newfm.get("projects")
    ed.add_note_line("%s re-homed by the Backlog orient: %s → [[%s]]" % (d, area.link(), stem))
    ed.save(want)
    return ["re-homed %s: %s → [[%s]]" % (shown, area.link(), stem)]


# ---- sweep -----------------------------------------------------------------------------------------------------

def cmd_sweep(vault, args):
    read_at = now_mel()
    area = Area(vault, args.area)
    members = backlog(vault, area)
    try:
        trig = trigger_read(area, None)
    except Refused as e:
        trig = {"declared": True, "path": area.trigger_path(None), "error": str(e)}
    urgent = {u.get("task") for u in trig.get("urgent") or []}
    stamped = set(trig.get("tasks") or [])
    rows = []
    for rel, m in members.items():
        f = m.fields
        rows.append({"task": m.slug, "rel": posix(rel), "status": m.status, "park": m.park, "parkedBy": m.parked_by,
                     "areaOnly": all(s == area.stem for s in m.stems), "homes": sorted({s for s in m.stems
                                                                                         if s != area.stem}),
                     "inFlight": m.in_flight, "frozen": m.frozen, "urgent": posix(rel) in urgent,
                     "stamped": posix(rel) in stamped, "priority": unquote(f.get("priority", "")) or None,
                     "workDepth": unquote(f.get("work_depth", "")) or None, "phase": unquote(f.get("phase", "")) or None})
    projects, excluded = [], []
    for rel, stem, lines in area.notes:
        if area.excluded(stem):
            excluded.append({"note": posix(rel), "name": stem})
            continue
        if vault.archived(rel) or "project" not in line_tags(lines):
            continue
        projects.append({"note": posix(rel), "name": stem,
                         "status": unquote(fields_of(lines).get("status", "")) or None,
                         "repos": fm_list(lines, "repos")})
    out = {"schema": 1, "area": {"note": posix(area.rel), "name": area.stem, "folder": posix(area.folder)},
           "read_at": read_at.isoformat(timespec="microseconds"), "excludes": area.excludes, "rows": rows,
           "projects": projects, "excluded": excluded, "trigger": trig}
    if args.json:
        return out
    lines = ["read_at %s" % out["read_at"]]
    for r in rows:
        lines.append("\t".join(["row", r["task"], r["status"] or "-", r["park"] or "-",
                                "area-only" if r["areaOnly"] else "homed", "in-flight" if r["inFlight"] else "-",
                                r["frozen"] or "-", "urgent" if r["urgent"] else "-",
                                "stamped" if r["stamped"] else "-"]))
    lines += ["project\t%s\t%s" % (p["name"], p["note"]) for p in projects]
    lines += ["excluded\t%s\t%s" % (p["name"], p["note"]) for p in excluded]
    lines.append(trig.get("line") or "trigger %s" % json.dumps(trig, ensure_ascii=False))
    return lines


# ---- record ------------------------------------------------------------------------------------------------------

def read_json_stdin():
    try:
        obj = json.loads(sys.stdin.read())
    except ValueError as e:
        raise Refused("stdin is not JSON: %s" % e)
    if not isinstance(obj, dict):
        raise Refused("stdin is not a JSON object")
    return obj


def check_rows(obj, allowed):
    extra = sorted(set(obj) - set(allowed))
    if extra:
        raise Refused("unknown keys in the input: %s" % ", ".join(extra))
    rows = obj.get("rows") or {}
    if not isinstance(rows, dict):
        raise Refused("rows must be an object of section -> [row]")
    out = {}
    for sec, items in rows.items():
        if sec not in SECTIONS or sec == "Touched":
            raise Refused("no record section %r (touched slugs go in \"touched\")" % sec)
        if not isinstance(items, list) or not all(isinstance(x, str) for x in items):
            raise Refused("rows[%r] must be a list of strings" % sec)
        folded = [fold(x) for x in items]
        if any(not x for x in folded):
            raise Refused("rows[%r] holds an empty row" % sec)
        out[sec] = folded
    touched = obj.get("touched") or []
    if not isinstance(touched, list) or not all(isinstance(x, str) and fold(x) for x in touched):
        raise Refused("touched must be a list of task slugs")
    return out, [fold(x).strip("[]") for x in touched]


def fm_value(v):
    if v is None or v == "":
        return "none"
    return json.dumps(str(v), ensure_ascii=False)


def cmd_record(vault, args):
    if args.append:
        if not args.note or args.area or args.date:
            raise Refused("record --append takes --note <path>, never --area or --date")
        return record_append(vault, args.note, read_json_stdin())
    if not args.area or not args.date or args.note:
        raise Refused("record takes --area <note> and --date D (or --append --note <path>)")
    try:
        d = datetime.date.fromisoformat(args.date).isoformat()
    except ValueError:
        raise Refused("--date must be a date, YYYY-MM-DD: %r" % args.date)
    area = Area(vault, args.area)
    obj = read_json_stdin()
    rows, touched = check_rows(obj, ("read_at", "trigger_stamp", "seen_orient_at", "rows", "touched"))
    read_at = obj.get("read_at")
    if parse_ts(read_at) is None:
        raise Refused("read_at must be the sweep's ISO time")
    base = os.path.join(vault.root, area.folder, RECORD_DIR)
    name = "%s %s Backlog orient" % (d, area.stem)
    n = 1
    while os.path.exists(os.path.join(base, (name if n == 1 else "%s (%d)" % (name, n)) + ".md")):
        n += 1
    path = os.path.join(base, (name if n == 1 else "%s (%d)" % (name, n)) + ".md")
    front = ["---", "tags:", "  - %s" % RECORD_TAG, "area: %s" % json.dumps(area.link(), ensure_ascii=False),
             "date: %s" % d, "read_at: %s" % fm_value(read_at), "trigger_stamp: %s" % fm_value(obj.get("trigger_stamp")),
             "seen_orient_at: %s" % fm_value(obj.get("seen_orient_at")), "last_orient_at:", "last_reason:", "---", ""]
    body = ["# %s Backlog orient, %s" % (area.stem, d), ""]
    for sec in SECTIONS:
        body.append("## %s" % sec)
        body.append("")
        items = ["[[%s]]" % s for s in dict.fromkeys(touched)] if sec == "Touched" else rows.get(sec, [])
        if items:
            body.extend("- %s" % x for x in items)
            body.append("")
    os.makedirs(base, exist_ok=True)
    try:
        with open(path, "x", encoding="utf-8") as fh:
            fh.write("\n".join(front + body).rstrip("\n") + "\n")
    except OSError as e:
        raise Refused("cannot write %s: %s" % (path, e))
    return ["recorded %s" % posix(os.path.relpath(path, vault.root))]


class Record:
    """A record note's text, its frontmatter (by line rules) and its sections."""

    def __init__(self, vault, arg):
        raw = os.path.expanduser(arg)
        path = os.path.realpath(raw if os.path.isabs(raw) else os.path.join(vault.root, raw))
        if not path.endswith(".md"):
            path += ".md"
        if not os.path.isfile(path):
            raise Refused("no record note at %s" % arg)
        self.path = path
        with open(path, encoding="utf-8", newline="") as fh:
            self.text = fh.read()
        self.lines = self.text.split("\n")
        fm = fm_lines(normalise(self.text))
        if RECORD_TAG not in line_tags(fm):
            raise Refused("%s is not a Backlog orient record (tagged `%s`)" % (arg, RECORD_TAG))
        f = fields_of(fm)
        self.front = {k: (None if unquote(f.get(k, "")) in ("", "none") else unquote(f.get(k, ""))) for k in FRONT_KEYS}
        self.close = next(i for i in range(1, len(self.lines)) if self.lines[i].strip() == "---")

    def sections(self):
        """{name: (start, end)}: the line after each `## ` heading up to the next heading."""
        out, cur = {}, None
        for i in range(self.close + 1, len(self.lines)):
            m = re.match(r"^## (.+?)\s*$", self.lines[i])
            if m:
                if cur:
                    out[cur[0]] = (cur[1], i)
                cur = (m.group(1), i + 1)
        if cur:
            out[cur[0]] = (cur[1], len(self.lines))
        return out

    def rows(self, sec):
        span = self.sections().get(sec)
        if not span:
            return []
        return [ln[2:].strip() for ln in self.lines[span[0]:span[1]] if ln.startswith("- ")]

    def links(self, secs=None, skip=()):
        keys = []
        for name, (a, b) in self.sections().items():
            if (secs is not None and name not in secs) or name in skip:
                continue
            for ln in self.lines[a:b]:
                keys.extend(link_key(t) for t in BODY_LINK_RE.findall(ln))
        return keys

    def add_rows(self, sec, items):
        span = self.sections().get(sec)
        if span is None:
            raise Refused("%s has no ## %s section" % (self.path, sec))
        a, b = span
        last = a - 1
        for i in range(a, b):
            if self.lines[i].strip():
                last = i
        new = ["- %s" % x for x in items]
        if last == a - 1:
            self.lines[a:a] = [""] + new
        else:
            self.lines[last + 1:last + 1] = new

    def set_front(self, key, value):
        for i in range(1, self.close):
            if re.match(r"^%s:" % re.escape(key), self.lines[i]):
                self.lines[i] = "%s: %s" % (key, value)
                return
        self.lines.insert(self.close, "%s: %s" % (key, value))
        self.close += 1

    def save(self):
        try:
            with open(self.path, "r+", encoding="utf-8", newline="") as fh:
                fh.write("\n".join(self.lines))
                fh.truncate()
        except OSError as e:
            raise Refused("cannot write %s: %s" % (self.path, e))


def link_key(target):
    s = target.split("|", 1)[0].split("#", 1)[0].strip().replace("\\", "/").rsplit("/", 1)[-1]
    return (s[:-3] if s.lower().endswith(".md") else s).strip().casefold()


def record_append(vault, note_arg, obj):
    rec = Record(vault, note_arg)
    rows, touched = check_rows(obj, ("rows", "touched", "trigger_stamp"))
    for sec, items in rows.items():
        rec.add_rows(sec, items)
    have = set(rec.links(secs=("Touched",)))
    fresh = [s for s in dict.fromkeys(touched) if s.casefold() not in have]
    if fresh:
        rec.add_rows("Touched", ["[[%s]]" % s for s in fresh])
    if "trigger_stamp" in obj:
        rec.set_front("trigger_stamp", fm_value(obj.get("trigger_stamp")))
    rec.save()
    return ["appended %s: %d row(s), %d touched" % (posix(os.path.relpath(rec.path, vault.root)),
                                                     sum(len(v) for v in rows.values()), len(fresh))]


# ---- trigger ---------------------------------------------------------------------------------------------------

def _before_replace():
    """Called just before the trigger file's replace. A no-op; tests land a Pulse stamp here."""


def named_set(vault, rec):
    """Guard 2's named set, as link keys: every link of the record outside ## Answered, waiting, every link in the body
    of a rollout note its ## Batches links, and the tasks whose own `rollout:` links one of those notes."""
    named = set(rec.links(skip=(WAITING,)))
    notes = set()
    for key in set(rec.links(secs=("Batches",))):
        for d in (TASKS_DIR, ROLLOUT_ARCHIVE):
            full = os.path.join(vault.root, d)
            if not os.path.isdir(full):
                continue
            for name in os.listdir(full):
                if name.endswith(".md") and name[:-3].casefold() == key:
                    path = os.path.join(full, name)
                    text = read_text(path)
                    if "rollout" not in line_tags(fm_lines(text)):
                        continue
                    notes.add(key)
                    body = text.split("\n")
                    span = len(fm_lines(text)) + 2 if body and body[0] == "---" else 0
                    for ln in body[span:]:
                        named.update(link_key(t) for t in BODY_LINK_RE.findall(ln))
    return named, notes


def text_or_none(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def same_time(a, b):
    """Two optional ISO values agree: both none, the same text, or the same instant."""
    if a is None or b is None:
        return a is None and b is None
    if a == b:
        return True
    ta = parse_ts(a)
    return ta is not None and ta == parse_ts(b)


def guards(vault, area, rec, state, restamp):
    """[(guard, line)] for every guard that fails, in order."""
    out = []
    named, notes = named_set(vault, rec)
    stamp = text_or_none(state.get("stamped_at"))
    if not same_time(stamp, rec.front["trigger_stamp"]):
        out.append((1, "stamp %s" % (stamp if stamp else "none")))
        in_trigger = set(rec.links(secs=("Trigger",)))
        urgent = [u.get("task") for u in state.get("urgent") or [] if isinstance(u, dict) and isinstance(u.get("task"), str)]
        tasks = [t for t in state.get("tasks") or [] if isinstance(t, str)]
        for t in dict.fromkeys(tasks + urgent):
            key = link_key(t)
            if key in in_trigger:
                continue
            word = "seen" if key in named else "unread"
            out.append((1, "%s %s%s" % (word, t, " urgent" if t in urgent else "")))
    read_at = parse_ts(rec.front["read_at"])
    if read_at is None:
        raise Refused("%s: its read_at is unreadable" % rec.path)
    cut = ns_of(read_at)
    members = backlog(vault, area)
    for rel, m in members.items():
        if os.stat(os.path.join(vault.root, rel)).st_mtime_ns <= cut:
            continue
        key = m.slug.casefold()
        if key in named:
            continue
        rollout = [link_key(t) for t in LINK_RE.findall(" ".join(fm_list(m.lines, "rollout")))]
        if any(r in notes for r in rollout):
            continue
        out.append((2, "unread %s" % posix(rel)))
    seen = rec.front["last_orient_at"] if restamp else rec.front["seen_orient_at"]
    have = text_or_none(state.get("last_orient_at"))
    if not same_time(have, seen):
        out.append((3, "last_orient_at %s (the record read %s)" % (have or "none", seen or "none")))
    if restamp:
        for row in rec.rows(WAITING):
            targets = [t.strip() for t in BODY_LINK_RE.findall(row)]
            if not targets:
                out.append((4, "waiting %s" % row))
            for t in targets:
                rels = [r for r in vault.targets(t) if os.path.dirname(r) == TASKS_DIR]
                out.append((4, "waiting %s" % (posix(rels[0]) if rels else t)))
    return out


def held(found, restamp):
    lines = list(dict.fromkeys(line for _, line in found))
    gs = sorted({g for g, _ in found})
    what = "re-stamp" if restamp else "write-back"
    raise Held(lines, "%s held (guard %s): the trigger file and the record are unchanged" %
               (what, ", ".join(str(g) for g in gs)))


class Held(Exception):
    def __init__(self, lines, msg):
        super().__init__(msg)
        self.lines = lines


def cmd_trigger(vault, args):
    area = Area(vault, args.area)
    if args.read == args.write:
        raise Refused("trigger takes exactly one of --read and --write")
    if args.read:
        if args.reason or args.record or args.at:
            raise Refused("trigger --read takes no --reason, --record or --at")
        t = trigger_read(area, args.file)
        if args.json:
            return t
        if not t["declared"]:
            return [t["line"]]
        return ["trigger %s" % t["path"], "stamped_at %s" % (t["stamped_at"] or "none"),
                "pending %s" % ("yes" if t["pending"] else "no"), "reason %s" % (t["reason"] or "none"),
                "last_orient_at %s" % (t["last_orient_at"] or "none")] + \
            ["task %s" % x for x in t["tasks"]] + ["urgent %s %s" % (u.get("task"), u.get("rule")) for u in t["urgent"]]
    if args.reason not in REASONS:
        raise Refused("--reason must be one of %s" % ", ".join(REASONS))
    if not args.record:
        raise Refused("trigger --write takes --record <the record note>")
    path = area.trigger_path(args.file)
    if path is None:
        raise Refused("no backlog_trigger: declared on %s: no write-back, and no file created" % area.link())
    now = datetime.datetime.now(MEL)
    if args.at:
        at = parse_ts(args.at)
        if at is None:
            raise Refused("--at must be an ISO time: %r" % args.at)
        if at > now + datetime.timedelta(minutes=FUTURE_TOLERANCE_MINUTES):
            raise Refused("--at %s is more than %d minutes ahead: the Pulse would read it as unusable" %
                          (args.at, FUTURE_TOLERANCE_MINUTES))
        now = at
    now = now.astimezone(MEL)
    if now.microsecond:
        now = now.replace(microsecond=0) + datetime.timedelta(seconds=1)
    stamp = now.isoformat(timespec="seconds")
    rec = Record(vault, args.record)
    restamp = rec.front["last_orient_at"] is not None
    raw = read_trigger_bytes(path)
    state = trigger_state(path, raw)
    found = guards(vault, area, rec, state, restamp)
    if found:
        held(found, restamp)
    directory = os.path.dirname(os.path.abspath(path))
    try:
        os.makedirs(directory, exist_ok=True)
    except OSError as e:
        raise Refused("cannot make %s: %s" % (directory, e))
    mode = (os.stat(path).st_mode & 0o777) if raw is not None else 0o600
    for attempt in (0, 1):
        obj = dict(state)
        obj["last_orient_at"] = stamp
        obj["last_reason"] = args.reason
        fd = tempfile.NamedTemporaryFile("w", dir=directory, prefix=os.path.basename(path) + ".", suffix=".tmp",
                                         delete=False, encoding="utf-8")
        try:
            json.dump(obj, fd, indent=1, ensure_ascii=False)
            fd.write("\n")
            fd.close()
            os.chmod(fd.name, mode)
            _before_replace()
            again = read_trigger_bytes(path)
            if again == raw:
                os.replace(fd.name, path)
                break
            os.unlink(fd.name)
        except BaseException:
            fd.close()
            if os.path.exists(fd.name):
                os.unlink(fd.name)
            raise
        if attempt == 1:
            raise Held(["changed %s" % path], "the trigger file changed twice during the write-back: held, unchanged")
        raw, state = again, trigger_state(path, again)
        found = guards(vault, area, rec, state, restamp)
        if found:
            held(found, restamp)
    rec.set_front("last_orient_at", json.dumps(stamp))
    rec.set_front("last_reason", args.reason)
    rec.add_rows("Write-back", ["%s %s (%s) → %s" % (stamp, "re-stamp" if restamp else "write-back #1", args.reason,
                                                       path)])
    rec.save()
    return ["wrote %s: last_orient_at %s, last_reason %s" % (path, stamp, args.reason)]


# ---- main --------------------------------------------------------------------------------------------------------

def emit(out, as_json):
    if isinstance(out, (dict,)) or as_json:
        sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    else:
        for line in out:
            sys.stdout.write(line + "\n")


def main(argv):
    p = Parser(prog="backlog-orient", description="The Backlog orient's reader and writer (ADR 0071).")
    p.add_argument("--vault", default=VAULT_DEFAULT)
    p.add_argument("--json", action="store_true")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    sw = sub.add_parser("sweep")
    sw.add_argument("--area", required=True)
    pk = sub.add_parser("park")
    pk.add_argument("--area", required=True)
    pk.add_argument("--task", required=True)
    pk.add_argument("--reason", required=True)
    ro = sub.add_parser("reopen")
    ro.add_argument("--task", required=True)
    ro.add_argument("--batch", required=True)
    ob = sub.add_parser("obsolete")
    ob.add_argument("--task", required=True)
    ob.add_argument("--fixed-by")
    ob.add_argument("--gone")
    rh = sub.add_parser("rehome")
    rh.add_argument("--area", required=True)
    rh.add_argument("--task", required=True)
    rh.add_argument("--to", required=True)
    wt = sub.add_parser("wait")
    wt.add_argument("--task", required=True)
    wt.add_argument("--why", required=True)
    rc = sub.add_parser("record")
    rc.add_argument("--area")
    rc.add_argument("--date")
    rc.add_argument("--append", action="store_true")
    rc.add_argument("--note")
    tg = sub.add_parser("trigger")
    tg.add_argument("--area", required=True)
    tg.add_argument("--read", action="store_true")
    tg.add_argument("--write", action="store_true")
    tg.add_argument("--reason")
    tg.add_argument("--record")
    tg.add_argument("--file")
    tg.add_argument("--at")
    for sp in (sw, pk, ro, ob, rh, wt, rc, tg):  # the global flags after the verb too
        sp.add_argument("--vault", default=argparse.SUPPRESS)
        sp.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    for sp in (pk, ro, ob, rh, wt):
        sp.add_argument("--today")
    args = p.parse_args(argv)
    if not args.verb:
        fail(2, "a verb is required: sweep | park | reopen | obsolete | rehome | wait | record | trigger")
    load_siblings()
    root = os.path.expanduser(args.vault)
    if not os.path.isdir(root):
        fail(3, "no vault at %s" % root)
    vault = NA.Vault(root)
    verbs = {"sweep": cmd_sweep, "park": cmd_park, "reopen": cmd_reopen, "obsolete": cmd_obsolete,
             "rehome": cmd_rehome, "wait": cmd_wait, "record": cmd_record, "trigger": cmd_trigger}
    try:
        out = verbs[args.verb](vault, args)
    except Held as e:
        for line in e.lines:
            sys.stdout.write(line + "\n")
        fail(4, str(e))
    except Refused as e:
        fail(e.code, str(e))
    emit(out, args.json and args.verb in ("sweep", "trigger"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
