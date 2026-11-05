#!/usr/bin/env python3
"""The next-action slot's one writer and reader (estate ADR 0008; task-writer.md § 4b).

python >= 3.8 with PyYAML — the same reader as the estate's next-action-blanks.py. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py <verb> ... [--vault PATH] [--json]

Verbs:

  set-down <task> --action <line|->  The set-down write (stash, defer, close): overwrite the task's
                                     `next_action:`, then point `next_task:` at the task on every project
                                     note its `projects:` links.
  fill <task> [--action <line|->]    Every other writer (orient): the same targets, but `next_task:` only
                                     where the slot is blank or dead, `next_action:` only where blank.
  read <project>...                  Each project's slot: live, blank, dead (with the reason), or unparseable
                                     (a live task whose frontmatter does not parse: mend it, never fill over it).
                                     The first live link whose note can be read is the slot; only when every
                                     live one is broken does it read unparseable, with the first one's why.
  mend <task>                        Quote the plain values the task's YAML error names, so its frontmatter
                                     parses (orient § 4, schedule § 1.5): `parses`, `unmendable:<why>` or
                                     `mended:<key,…>`. Only a value that fails to scan on its own is quoted,
                                     as one JSON double-quoted string, which YAML reads back as exactly the
                                     text that was there; a value starting with one of '[{|>&*!%@` is never
                                     touched, nor a run-on value, nor a value that scans but will not
                                     construct (`due: 2026-02-30`). The quoting rule is the estate's
                                     frontmatter_yaml.quote_fix (~/repos/workspaces/_shared/hooks/), ported
                                     because the plugin cannot import from there, and pinned by the same
                                     cases in tests/next-action.test.mjs. Its checks stand in for the
                                     estate's PreToolUse frontmatter hook, which sees no script write: the
                                     result must load as a mapping with the original top-level keys, and
                                     each quoted line must read back as its old text, before the one save.
  captures [--slug S] [--thread-file P] [--for-close]
                                     Thread captures: open, `thread`-tagged tasks directly under
                                     Work/Tasks, each with whether its writer marked it
                                     (`capture: continuation`), whether it is named <S> and whether its
                                     text names <P>. --for-close keeps only a capture matched by <S> or
                                     <P> — close's concrete match; the marker alone is none.

`--action -` reads the line from stdin, so any character is safe:
    next-action.py set-down <task> --action - <<'EOF'
    Find the council's phone number
    EOF

<task> and <project> are a name, or — when the argument contains a `/` — a path inside the vault
(absolute, or relative to the vault; never to the working directory). A task must sit directly under
Work/Tasks; a project must be a `project`-tagged note under Work/Projects, outside Archive/.

Links resolve as Obsidian resolves them: an exact-case name first, else any case; an optional `.md`;
a path-qualified `[[Work/Tasks/x]]`. A link is dead when its target is missing, lives only under an
Archive/ folder, carries the `archived` tag, or has status done, merged or dropped. An unreadable
target is never dead.

A note's frontmatter does not parse when its load raises a YAMLError, or a ValueError or TypeError from
a constructor (`due: 2026-02-30`); its why then carries where, `frontmatter does not parse (line N,
<key>)`: N the file's own 1-based line, the key the top-level property it sits in. A note that never
opens `---` (an empty one included) has no frontmatter: out of scope, never broken.

Writes change one top-level key, located by the YAML parser itself: the key's lines become one
`key: "<value>"` line with JSON escaping, or the line is added before the closing `---`. Every edit is
re-parsed before anything is saved — the key must hold exactly the new value and every other key must
be unchanged, else the write is refused. Files are rewritten in place, so a note's creation time
survives. All targets are checked before the first write.

Output: one tab-separated row per outcome (tab, newline and backslash escaped as \\t \\n \\\\), or
`--json` for a list of objects:

    task      <task>     next_action  written | kept | unchanged
    project   <name>     next_task    written | kept | unchanged    <vault-relative path>
    skip      <name>     <reason>
    slot      <name>     live | blank | dead:<reason> | unparseable:<why>   <task>   <next_action or task name>
                         (<why>: `frontmatter does not parse (line N, <key>)`, `no closed frontmatter`,
                         `frontmatter is not a mapping` or `unreadable`)
    mend      <task>     parses | unmendable:<why> | mended:<key,…>
    capture   <task>     <status>     <match,…>        (thread-tag, plus marked, slug and/or thread-file)

Exit 0 on success (skips, and mend's `parses` and `unmendable:` rows, included). Exit 2 when the input
is refused (mend's included: a task that is not directly under Work/Tasks, or a name naming two notes)
— stderr then carries one line starting `next-action: ` and nothing was written. Exit 3 when the vault
or PyYAML is missing.
"""
import argparse
import json
import os
import re
import sys

VAULT_DEFAULT = os.path.expanduser("~/repos/obsidian")
DEAD_STATUSES = {"done", "merged", "dropped"}
OPEN_STATUSES = {"open", "in_progress"}  # after normalising `-` to `_`: the vault writes both
CAPTURE_MARKER = "continuation"  # `capture: continuation`, stamped by stash and defer (task-writer.md § 4)
TASKS_DIR = os.path.join("Work", "Tasks")
PROJECTS_DIR = os.path.join("Work", "Projects")
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
# Characters YAML counts as line breaks that splitting on "\n" would not: refuse to edit around them.
ODD_BREAKS = re.compile("\r(?!\n)|[\x85\u2028\u2029]")
# mend's quoting rule, ported verbatim from the estate's ~/repos/workspaces/_shared/hooks/frontmatter_yaml.py (its
# quote_fix): the plugin cannot import from the workspaces repo, so tests/next-action.test.mjs pins the same cases.
# KEY_LINE is a top-level or nested `key: value` line; a value starting with NOT_PLAIN is never plain text, so never
# touched; MAX_FIXES bounds the passes.
KEY_LINE = re.compile(r"^(?P<indent>[ \t]*)(?P<key>[A-Za-z0-9_][A-Za-z0-9_ .-]*?):[ \t]+(?P<value>\S.*?)[ \t]*$")
NOT_PLAIN = tuple("'[{|>&*!%@`")
MAX_FIXES = 50
# A top-level key line, its value possibly empty (`scheduled: `): the key set mend's result must keep.
TOP_KEY = re.compile(r"^(?P<key>[A-Za-z0-9_][A-Za-z0-9_ .-]*?):(?:[ \t]|$)")

try:
    import yaml
    LOADER = getattr(yaml, "CSafeLoader", None) or yaml.SafeLoader  # libyaml when present: same result, faster
    # What a load can raise on bad input (frontmatter_yaml.py's own tuple): a YAMLError for the syntax, and a plain
    # ValueError or TypeError from a constructor (`due: 2026-02-30`, `x: !!int abc`), which carries no mark.
    LOAD_ERRORS = (yaml.YAMLError, ValueError, TypeError)
except ImportError:
    yaml = None
    LOAD_ERRORS = (ValueError, TypeError)


class Refused(Exception):
    pass


def fail(code, reason):
    sys.stderr.write("next-action: %s\n" % reason)
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


# ---- Frontmatter ------------------------------------------------------------------------------------

def split_lines(text):
    """Lines with their endings, split on "\\n" only (a CRLF line keeps its "\\r\\n")."""
    return re.findall(r"[^\n]*\n|[^\n]+$", text)


def find_span(lines):
    """(1, closing) when line 0 opens frontmatter and a later `---` line closes it, else None."""
    if lines and lines[0].rstrip() == "---":
        for i in range(1, len(lines)):
            if lines[i].rstrip() == "---":
                return (1, i)
    return None


def ending_of(line):
    return line[len(line.rstrip("\r\n")):]


def load_error(text):
    """None when `text` loads as YAML, else the exception the load raised (one of LOAD_ERRORS)."""
    try:
        yaml.load(text, Loader=LOADER)
    except LOAD_ERRORS as e:
        return e
    return None


def mark_line(e):
    """A YAMLError's 0-based line: its problem mark first, else its context mark, else 0."""
    mark = getattr(e, "problem_mark", None) or getattr(e, "context_mark", None)
    return mark.line if mark is not None else 0


def where_of(body, e):
    """`line N, <key>` (N the file's own 1-based line), `line N`, or None: where a load error sits in a frontmatter
    block, `body` its lines without their endings.

    A YAMLError names the first of (mark_line, the line before) that is a KEY_LINE whose value fails on its own, the
    order mend tries, so a flow list that never closes (its mark on the next line, or past the block's end) names its
    own line; else the mark's line, clamped to the block. A mark-less constructor error names the first KEY_LINE whose
    value fails on its own (frontmatter_yaml._problem's rule), else nothing. The key is the nearest top-level key at
    or above that line, so a nested or run-on break names the property it belongs to."""
    if not body:
        return None
    if isinstance(e, yaml.YAMLError):
        at = mark_line(e)
        at = next((i for i in (at, at - 1) if 0 <= i < len(body) and isinstance(value_error(body[i]), yaml.YAMLError)),
                  min(at, len(body) - 1))
    else:
        at = next((i for i, ln in enumerate(body) if value_error(ln) is not None), None)
        if at is None:
            return None
    key = next((m.group("key") for m in (TOP_KEY.match(body[i]) for i in range(at, -1, -1)) if m), None)
    return "line %d, %s" % (at + 2, key) if key else "line %d" % (at + 2)


def value_error(line):
    """The error a KEY_LINE's value raises on its own (`k: <value>`), or None: no KEY_LINE, or a value that loads."""
    m = KEY_LINE.match(line)
    return load_error("k: " + m.group("value")) if m else None


def quoted(line):
    """The line with its value as a JSON double-quoted string, or None (frontmatter_yaml._quoted, ported).

    Only a value that fails to scan on its own is quoted: one that loads (`priority: 3` stays a number), or that scans
    but will not construct (`due: 2026-02-30`), is not what quoting mends. A value that starts and ends with `"` around
    bare inner quotes is quoted whole, outer pair included: whether that pair is delimiters (`"A "B" C"`) or the text's
    own (`"A" - "B"`) cannot be told from the line, and keeping it loses nothing. Escapes mixed with bare quotes, or a
    value starting with NOT_PLAIN, are left alone."""
    m = KEY_LINE.match(line)
    if not m:
        return None
    value = m.group("value")
    if not isinstance(load_error("k: " + value), yaml.YAMLError):
        return None
    if value.startswith('"'):
        if not (value.endswith('"') and len(value) >= 2):
            return None
        inner = value[1:-1]
        if '"' not in inner.replace('\\"', ""):
            return None  # a well-formed quoted value is not what broke
        if "\\" in inner:
            return None  # escapes mixed with bare quotes: too ambiguous to mend
    elif value.startswith(NOT_PLAIN):
        return None
    return "%s%s: %s" % (m.group("indent"), m.group("key"), json.dumps(value, ensure_ascii=False))


def continues(body, i):
    """Whether line i's value runs on to the next line (a multi-line plain scalar): frontmatter_yaml._continues."""
    if i + 1 >= len(body):
        return False
    here = len(body[i]) - len(body[i].lstrip(" \t"))
    nxt = body[i + 1]
    if not nxt.strip():
        return False
    there = len(nxt) - len(nxt.lstrip(" \t"))
    return there > here and not nxt.lstrip().startswith(("- ", "#")) and not KEY_LINE.match(nxt)


class Note:
    """A note's text, its lines (endings kept) and its frontmatter parsed by PyYAML.

    `fm` is the parsed mapping, or None — `error` then says why (no closed frontmatter, does not
    parse, not a mapping, unreadable), a bare token its readers match on. A load error also sets
    `where` (`line N, <key>`, or None when nothing can be placed), and `why` is the error with it."""

    def __init__(self, path, text):
        self.path, self.text = path, text
        self.lines = split_lines(text)
        self.span = find_span(self.lines)
        self.where = None
        self.fm, self.error = self._parse()

    @property
    def why(self):
        """The error, with ` (<where>)` when the load error could be placed."""
        return "%s (%s)" % (self.error, self.where) if self.error and self.where else self.error

    @property
    def broken(self):
        """Present but unreadable frontmatter: the one copy of the rule. A note that never opens `---` (an empty one
        included) has no frontmatter, so it is out of scope, never broken; one that opens and never closes is."""
        return self.fm is None and (self.error != "no closed frontmatter" or
                                    (bool(self.lines) and self.lines[0].rstrip() == "---"))

    @classmethod
    def load(cls, path):
        try:
            with open(path, encoding="utf-8", newline="") as fh:
                return cls(path, fh.read())
        except (OSError, UnicodeDecodeError):
            note = cls(path, "")
            note.fm, note.error = None, "unreadable"
            return note

    def body(self):
        return "".join(self.lines[self.span[0]:self.span[1]])

    def _parse(self):
        if self.span is None:
            return None, "no closed frontmatter"
        try:
            fm = yaml.load(self.body(), Loader=LOADER)
        except LOAD_ERRORS as e:
            self.where = where_of([ln.rstrip("\r\n") for ln in self.lines[self.span[0]:self.span[1]]], e)
            return None, "frontmatter does not parse"
        if fm is None:
            return {}, None
        if not isinstance(fm, dict):
            return None, "frontmatter is not a mapping"
        return fm, None

    def get(self, key):
        return (self.fm or {}).get(key)

    def edited(self, key, value):
        """The note's text with `key: "<value>"` set, checked by re-parsing. Raises Refused."""
        if self.fm is None:
            raise Refused("%s: %s" % (self.path, self.error))
        body = self.body()
        if ODD_BREAKS.search(body):
            raise Refused("%s: frontmatter has line breaks other than \\n" % self.path)
        root = yaml.compose(body, Loader=LOADER)
        hits = [(k, v) for k, v in (root.value if root is not None else [])
                if isinstance(k, yaml.ScalarNode) and k.value == key]
        if len(hits) > 1:
            raise Refused("%s carries `%s:` more than once" % (self.path, key))
        lines, first = list(self.lines), self.span[0]
        if hits:
            k, v = hits[0]
            start = first + k.start_mark.line
            end = first + v.end_mark.line + (1 if v.end_mark.column else 0)
            while end - 1 > start and lines[end - 1].strip() == "":  # keep blank lines after the value
                end -= 1
            end = max(end, start + 1)
            ending = ending_of(lines[end - 1]) or ending_of(lines[start]) or "\n"
            lines[start:end] = ["%s: %s%s" % (key, json.dumps(value, ensure_ascii=False), ending)]
        else:
            close = self.span[1]
            ending = ending_of(lines[close - 1]) or ending_of(lines[0]) or "\n"
            if lines[close - 1] and not ending_of(lines[close - 1]):
                lines[close - 1] += ending
            lines.insert(close, "%s: %s%s" % (key, json.dumps(value, ensure_ascii=False), ending))
        check = Note(self.path, "".join(lines))
        want = dict(self.fm)
        want[key] = value
        if check.fm != want:
            raise Refused("%s: editing `%s:` would change other frontmatter; left alone" % (self.path, key))
        return check.text

    def save(self, text):
        with open(self.path, "r+", encoding="utf-8", newline="") as fh:  # in place: keep the inode
            fh.write(text)
            fh.truncate()


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def tags_of(note):
    return {str(t).strip().lstrip("#") for t in as_list(note.get("tags")) if str(t).strip()}


def status_of(note):
    return str(note.get("status") or "").strip().lower().replace("-", "_")


def dead_note(note):
    """Why a readable note is no live target — `archived` or its dead status — else None."""
    if "archived" in tags_of(note):
        return "archived"
    return status_of(note) if status_of(note) in DEAD_STATUSES else None


def links_in(value):
    """Wikilink targets in a property. An unquoted `[[x]]` parses as [['x']]; plain text is no link."""
    out = []
    for item in as_list(value):
        if isinstance(item, list):
            out += [str(x).split("|")[0].split("#")[0].strip() for x in item if x]
        elif item is not None:
            out += [m.strip() for m in LINK_RE.findall(str(item))]
    return [t for t in out if t]


def text_of(value):
    return "" if value is None else str(value).strip()


# ---- The vault --------------------------------------------------------------------------------------

class Vault:
    def __init__(self, root):
        if not os.path.isdir(root):
            fail(3, "no vault at %s" % root)
        self.root = os.path.realpath(root)
        self._index = None
        self._notes = {}

    def index(self):
        """(lower name -> [rel], lower rel without .md -> rel), built on first use.

        Each directory's entries are walked in sorted order, so a name's notes list the same on every file system: a
        shallower copy before a deeper one (os.walk lists a directory's files before it descends), then sibling
        directories by name."""
        if self._index is None:
            by_name, by_path = {}, {}
            for d, dirs, files in os.walk(self.root):
                dirs[:] = sorted(x for x in dirs if not x.startswith("."))
                for name in sorted(files):
                    if name.lower().endswith(".md"):
                        rel = os.path.relpath(os.path.join(d, name), self.root)
                        by_name.setdefault(name[:-3].lower(), []).append(rel)
                        by_path[rel[:-3].replace(os.sep, "/").lower()] = rel
            self._index = (by_name, by_path)
        return self._index

    @staticmethod
    def archived(rel):
        return "Archive" in rel.split(os.sep)[:-1]

    def note(self, rel):
        if rel not in self._notes:
            self._notes[rel] = Note.load(os.path.join(self.root, rel))
        return self._notes[rel]

    def targets(self, link):
        """Every note a wikilink target can mean, as Obsidian resolves it."""
        by_name, by_path = self.index()
        t = link.strip()
        t = t[:-3] if t.lower().endswith(".md") else t
        if "/" in t:
            rel = by_path.get(t.strip("/").lower())
            return [rel] if rel else []
        hits = by_name.get(t.lower(), [])
        exact = [p for p in hits if os.path.basename(p)[:-3] == t]
        return exact or list(hits)  # an exact-case name wins, as in Obsidian

    def live_copy(self, link):
        """(rel of a live copy, None), or (None, why the link is dead)."""
        paths = self.targets(link)
        if not paths:
            return None, "missing"
        live = [p for p in paths if not self.archived(p)]
        if not live:
            return None, "archived"
        reasons = []
        for rel in live:
            note = self.note(rel)
            why = dead_note(note) if note.fm is not None else None  # unreadable: never dead on no evidence
            if why is None:
                return rel, None
            reasons.append(why)
        return None, reasons[0]

    def path_arg(self, arg):
        """The vault-relative path an argument containing a `/` names, or None for a name."""
        if "/" not in arg and os.sep not in arg:
            return None
        raw = os.path.expanduser(arg)
        full = os.path.realpath(raw if os.path.isabs(raw) else os.path.join(self.root, raw))
        if os.path.commonpath([full, self.root]) != self.root:
            raise Refused("%s is outside the vault (%s)" % (arg, self.root))
        if not os.path.isfile(full):
            raise Refused("no note at %s" % arg)
        return os.path.relpath(full, self.root)

    def resolve_task(self, arg):
        rel = self.path_arg(arg)
        if rel is None:
            hits = [p for p in self.targets(arg) if os.path.dirname(p) == TASKS_DIR]
            if not hits:
                raise Refused("no task note %r directly under %s" % (arg, TASKS_DIR))
            if len(hits) > 1:
                raise Refused("%r names %d task notes: %s" % (arg, len(hits), ", ".join(hits)))
            rel = hits[0]
        if os.path.dirname(rel) != TASKS_DIR:
            raise Refused("%s is not directly under %s" % (rel, TASKS_DIR))
        return rel

    def resolve_project(self, arg, link=False):
        """(rel, None) for a project note, or (None, why it is skipped). `arg` is a command-line name
        or vault path, or — with link=True — a wikilink target from `projects:`, resolved as a link."""
        rel = None if link else self.path_arg(arg)
        paths = [rel] if rel else self.targets(arg)
        live = [p for p in paths if not self.archived(p)]
        inside = [p for p in live if p.startswith(PROJECTS_DIR + os.sep)]
        if not paths:
            return None, "no note"
        if not live:
            return None, "archived"
        if not inside:
            return None, "not a project note (%s)" % live[0]
        if len(inside) > 1:
            return None, "ambiguous (%s)" % ", ".join(inside)
        note = self.note(inside[0])
        if note.fm is None:
            return None, "%s (%s)" % (note.error, inside[0])
        tags = tags_of(note)
        if "project" in tags:
            return inside[0], None
        if "area" in tags:
            return None, "area note (%s)" % inside[0]
        return None, "not a project note (%s)" % inside[0]


# ---- Verbs ------------------------------------------------------------------------------------------

def read_action(action):
    if action is None:
        return None
    if action == "-":
        action = sys.stdin.read()
        action = action[:-1] if action.endswith("\n") else action
        action = action[:-1] if action.endswith("\r") else action
    if "\n" in action or "\r" in action:
        raise Refused("the action must be one line")
    action = action.strip()
    if not action:
        raise Refused("the action is blank")
    return action


def write(vault, task_arg, action, overwrite):
    action = read_action(action)
    if overwrite and action is None:
        raise Refused("set-down needs --action")
    rel = vault.resolve_task(task_arg)
    task = vault.note(rel)
    if task.fm is None:
        raise Refused("%s: %s" % (rel, task.error))
    why = dead_note(task)
    if why:
        raise Refused("%s is %s; a pointer to it would be dead" % (rel, why))
    name = os.path.basename(rel)[:-3]
    pointer = "[[%s]]" % name

    # Plan every edit, and check each one re-parses, before the first write.
    plan, rows = [], []
    if action is None or not (overwrite or not text_of(task.get("next_action"))):
        head = "kept"
    elif task.get("next_action") == action:
        head = "unchanged"
    else:
        plan.append((task, task.edited("next_action", action)))
        head = "written"
    rows.append({"kind": "task", "name": name, "field": "next_action", "result": head})

    seen = set()
    for link in links_in(task.get("projects")):
        prel, why = vault.resolve_project(link, link=True)
        if why:
            rows.append({"kind": "skip", "name": link, "result": why})
            continue
        if prel in seen:
            continue
        seen.add(prel)
        note = vault.note(prel)
        blank = all(vault.live_copy(t)[0] is None for t in links_in(note.get("next_task")))
        if not (overwrite or blank):
            result = "kept"
        elif note.get("next_task") == pointer:
            result = "unchanged"
        else:
            try:
                plan.append((note, note.edited("next_task", pointer)))
            except Refused as e:
                rows.append({"kind": "skip", "name": link, "result": "frontmatter not editable (%s)" % e})
                continue
            result = "written"
        rows.append({"kind": "project", "name": link, "field": "next_task", "result": result, "path": prel})

    for note, text in plan:  # the task file first: the pointer never lands before its target
        note.save(text)
    return rows


def read_slots(vault, args):
    rows = []
    for arg in args:
        rel, why = vault.resolve_project(arg)
        name = os.path.basename(rel)[:-3] if rel else arg
        if why:
            rows.append({"kind": "skip", "name": name, "result": why})
            continue
        links = links_in(vault.note(rel).get("next_task"))
        if not links:
            rows.append({"kind": "slot", "name": name, "result": "blank", "task": None, "next_action": None})
            continue
        copies = [(t,) + vault.live_copy(t) for t in links]
        live = [(t, r) for t, r, _ in copies if r]
        if not live:
            reason = "; ".join("%s %s" % (t, why) for t, _, why in copies)
            rows.append({"kind": "slot", "name": name, "result": "dead:" + reason, "task": links[0], "next_action": None})
            continue
        # The first live link whose note can be read is the slot. Only when every live one is broken (Note.broken) does
        # it read `unparseable:` with the first one's why, never `live` with its next_action lost.
        readable = [(t, r) for t, r in live if not vault.note(r).broken]
        if not readable:
            target, trel = live[0]
            rows.append({"kind": "slot", "name": name, "result": "unparseable:" + vault.note(trel).why, "task": target,
                         "next_action": target})
            continue
        target, trel = readable[0]
        tnote = vault.note(trel)
        line = text_of(tnote.get("next_action"))
        rows.append({"kind": "slot", "name": name, "result": "live", "task": target, "next_action": line or target})
    return rows


def mend(vault, task_arg):
    """Quote the plain values a task note's YAML error names, so its frontmatter parses: one `mend` row.

    `parses` when the note is not broken (no frontmatter is not broken), and nothing is written; `unmendable:<why>`
    when quoting cannot mend it, and nothing is written; `mended:<key,...>` when it did, the note saved in place once.
    Only a note whose frontmatter does not parse is tried, one with no line break but "\n" (a CRLF ending is fine),
    and only a YAMLError: a value that scans but will not construct (`due: 2026-02-30`) is no quoting fault. Each pass
    takes the error's line, then the line before (a run-on value's line is never touched), and quotes the first one
    `quoted` accepts; up to MAX_FIXES passes, re-loading after each. The result is checked whole before the save,
    standing in for the estate's PreToolUse frontmatter hook, which sees no script write: it loads as a mapping, its
    top-level keys are the original block's (TOP_KEY, empty values included), and each quoted line composes back to a
    str scalar equal to its original value text."""
    rel = vault.resolve_task(task_arg)
    note = vault.note(rel)
    name = os.path.basename(rel)[:-3]

    def row(result):
        return [{"kind": "mend", "name": name, "result": result}]
    if not note.broken:
        return row("parses")
    if note.error != "frontmatter does not parse":
        return row("unmendable:" + note.why)
    lines = note.lines[note.span[0]:note.span[1]]
    if any(ODD_BREAKS.search(ln) for ln in lines):  # a lone CR, NEL, U+2028, U+2029; a CRLF ending is fine
        return row("unmendable:frontmatter has line breaks other than \\n")
    body = [ln.rstrip("\r\n") for ln in lines]
    original = list(body)

    def unmendable(e):
        where = where_of(body, e)
        return row("unmendable:frontmatter does not parse" + (" (%s)" % where if where else ""))
    e = load_error("\n".join(body))
    if not isinstance(e, yaml.YAMLError):
        return unmendable(e)
    tried, mended = set(), []
    for _ in range(MAX_FIXES):
        at = mark_line(e)
        for i in (at, at - 1):
            if 0 <= i < len(body) and i not in tried and not continues(body, i):
                fixed = quoted(body[i])
                if fixed is not None and fixed != body[i]:
                    tried.add(i)
                    mended.append(i)
                    body[i] = fixed
                    break
        else:
            return unmendable(e)
        e = load_error("\n".join(body))
        if e is None:
            break
        if not isinstance(e, yaml.YAMLError):
            return unmendable(e)
    else:
        return unmendable(e)
    text = "".join(note.lines[:note.span[0]] + [b + ending_of(ln) for b, ln in zip(body, lines)] + note.lines[note.span[1]:])
    if not mended_whole(Note(note.path, text), original, mended):
        return row("unmendable:mending would change other frontmatter")
    note.save(text)
    return row("mended:" + ",".join(KEY_LINE.match(original[i]).group("key") for i in sorted(mended)))


def mended_whole(check, original, mended):
    """Whether mend's result changes nothing but the quoting: it loads as a mapping whose top-level keys are the
    original block's, and each mended line's (key, value) pair composes to a str scalar equal to its old value text."""
    if not isinstance(check.fm, dict):
        return False
    keys = {m.group("key") for m in (TOP_KEY.match(ln) for ln in original) if m}
    if set(check.fm) != keys:
        return False
    pairs, todo = {}, [yaml.compose(check.body(), Loader=LOADER)]
    while todo:
        node = todo.pop()
        if isinstance(node, yaml.MappingNode):
            for k, v in node.value:
                pairs.setdefault(k.start_mark.line, (k, v))
                todo += [k, v]
        elif isinstance(node, yaml.SequenceNode):
            todo += node.value
    for i in mended:
        m = KEY_LINE.match(original[i])
        k, v = pairs.get(i, (None, None))
        if not (isinstance(k, yaml.ScalarNode) and k.value == m.group("key") and isinstance(v, yaml.ScalarNode) and
                v.tag == "tag:yaml.org,2002:str" and v.value == m.group("value")):
            return False
    return True


def captures(vault, slug, thread_file, for_close):
    needles = {thread_file, os.path.expanduser(thread_file)} if thread_file else set()
    rows = []
    tasks = os.path.join(vault.root, TASKS_DIR)
    for fname in sorted(os.listdir(tasks)) if os.path.isdir(tasks) else []:
        if not fname.lower().endswith(".md"):
            continue
        note = vault.note(os.path.join(TASKS_DIR, fname))
        if note.fm is None or "thread" not in tags_of(note) or dead_note(note) or status_of(note) not in OPEN_STATUSES:
            continue
        base = fname[:-3]
        why = ["thread-tag"]
        if text_of(note.get("capture")) == CAPTURE_MARKER:
            why.append("marked")
        if slug and base.lower() == slug.lower():
            why.append("slug")
        if needles and any(n in note.text for n in needles):
            why.append("thread-file")
        if for_close and not {"slug", "thread-file"} & set(why):
            continue
        rows.append({"kind": "capture", "name": base, "result": status_of(note), "match": ",".join(why)})
    return rows


def cell(value):
    return (value or "").replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def emit(rows, as_json):
    if as_json:
        sys.stdout.write(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
        return
    for r in rows:
        if r["kind"] == "slot":
            cols = [r["kind"], r["name"], r["result"], r["task"], r["next_action"]]
        elif r["kind"] == "capture":
            cols = [r["kind"], r["name"], r["result"], r["match"]]
        elif r["kind"] in ("skip", "mend"):
            cols = [r["kind"], r["name"], r["result"]]
        else:
            cols = [r["kind"], r["name"], r["field"], r["result"]] + ([r["path"]] if "path" in r else [])
        sys.stdout.write("\t".join(cell(c) for c in cols) + "\n")


def main(argv):
    p = Parser(prog="next-action", description="The next-action slot's writer and reader (estate ADR 0008).")
    p.add_argument("--vault", default=VAULT_DEFAULT)
    p.add_argument("--json", action="store_true")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    s = sub.add_parser("set-down")
    s.add_argument("task")
    s.add_argument("--action", required=True)
    f = sub.add_parser("fill")
    f.add_argument("task")
    f.add_argument("--action")
    r = sub.add_parser("read")
    r.add_argument("project", nargs="+")
    m = sub.add_parser("mend")
    m.add_argument("task")
    c = sub.add_parser("captures")
    c.add_argument("--slug")
    c.add_argument("--thread-file")
    c.add_argument("--for-close", action="store_true")
    for sp in (s, f, r, m, c):  # accept the global flags after the verb too
        sp.add_argument("--vault", default=argparse.SUPPRESS)
        sp.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    args = p.parse_args(argv)
    if not args.verb:
        fail(2, "a verb is required: set-down | fill | read | mend | captures")
    if yaml is None:
        fail(3, "PyYAML is required: python3 -m pip install pyyaml")

    vault = Vault(os.path.expanduser(args.vault))
    try:
        if args.verb == "set-down":
            rows = write(vault, args.task, args.action, overwrite=True)
        elif args.verb == "fill":
            rows = write(vault, args.task, args.action, overwrite=False)
        elif args.verb == "read":
            rows = read_slots(vault, args.project)
        elif args.verb == "mend":
            rows = mend(vault, args.task)
        else:
            rows = captures(vault, args.slug, args.thread_file, args.for_close)
    except Refused as e:
        fail(2, str(e))
    emit(rows, args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
