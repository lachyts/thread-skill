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
  read <project>...                  Each project's slot: live, blank, or dead (with the reason).
  captures [--slug S] [--thread-file P] [--for-close]
                                     Thread captures: open, `thread`-tagged tasks directly under
                                     Work/Tasks, each with whether it is named <S> and whether its text
                                     names <P>. --for-close keeps only a capture matched by one of those —
                                     close's concrete match.

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
    slot      <name>     live | blank | dead:<reason>   <task>   <next_action or task name>
    capture   <task>     <status>     <match,…>        (thread-tag, plus slug and/or thread-file)

Exit 0 on success (skips included). Exit 2 when the input is refused — stderr then carries one line
starting `next-action: ` and nothing was written. Exit 3 when the vault or PyYAML is missing.
"""
import argparse
import json
import os
import re
import sys

VAULT_DEFAULT = os.path.expanduser("~/repos/obsidian")
DEAD_STATUSES = {"done", "merged", "dropped"}
OPEN_STATUSES = {"open", "in_progress"}  # after normalising `-` to `_`: the vault writes both
TASKS_DIR = os.path.join("Work", "Tasks")
PROJECTS_DIR = os.path.join("Work", "Projects")
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
# Characters YAML counts as line breaks that splitting on "\n" would not: refuse to edit around them.
ODD_BREAKS = re.compile("\r(?!\n)|[\x85\u2028\u2029]")

try:
    import yaml
    LOADER = getattr(yaml, "CSafeLoader", None) or yaml.SafeLoader  # libyaml when present: same result, faster
except ImportError:
    yaml = None


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


class Note:
    """A note's text, its lines (endings kept) and its frontmatter parsed by PyYAML.

    `fm` is the parsed mapping, or None — `error` then says why (no closed frontmatter, does not
    parse, not a mapping, unreadable)."""

    def __init__(self, path, text):
        self.path, self.text = path, text
        self.lines = split_lines(text)
        self.span = find_span(self.lines)
        self.fm, self.error = self._parse()

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
        except yaml.YAMLError:
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
        """(lower name -> [rel], lower rel without .md -> rel), built on first use."""
        if self._index is None:
            by_name, by_path = {}, {}
            for d, dirs, files in os.walk(self.root):
                dirs[:] = [x for x in dirs if not x.startswith(".")]
                for name in files:
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
        target, trel = live[0]
        line = text_of(vault.note(trel).get("next_action"))
        rows.append({"kind": "slot", "name": name, "result": "live", "task": target, "next_action": line or target})
    return rows


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
        if slug and base.lower() == slug.lower():
            why.append("slug")
        if needles and any(n in note.text for n in needles):
            why.append("thread-file")
        if for_close and len(why) == 1:
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
        elif r["kind"] == "skip":
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
    c = sub.add_parser("captures")
    c.add_argument("--slug")
    c.add_argument("--thread-file")
    c.add_argument("--for-close", action="store_true")
    for sp in (s, f, r, c):  # accept the global flags after the verb too
        sp.add_argument("--vault", default=argparse.SUPPRESS)
        sp.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    args = p.parse_args(argv)
    if not args.verb:
        fail(2, "a verb is required: set-down | fill | read | captures")
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
        else:
            rows = captures(vault, args.slug, args.thread_file, args.for_close)
    except Refused as e:
        fail(2, str(e))
    emit(rows, args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
