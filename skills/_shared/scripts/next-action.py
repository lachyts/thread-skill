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
  captures [--slug S] [--thread-file P]
                                     Open tasks directly under Work/Tasks that are `thread`-tagged, named
                                     <S>, or name <P> in their text, with which of the three matched.

`--action -` reads the line from stdin, so any character is safe:
    next-action.py set-down <task> --action - <<'EOF'
    Find the council's phone number
    EOF

<task> and <project> are a basename, or a path inside the vault (absolute, or relative to the vault —
never to the working directory). A task must sit directly under Work/Tasks.

Links resolve as Obsidian resolves them: case-insensitive, an optional `.md`, and a path-qualified
`[[Work/Tasks/x]]`. A link is dead when its target is missing, lives only under an Archive/ folder,
carries the `archived` tag, or has status done, merged or dropped. An unreadable target is never dead.

Writes change one top-level key: its line (and its value's continuation lines) becomes one
`key: "<value>"` line with JSON escaping, or the line is added before the closing `---`. Before
anything is saved, every edited frontmatter is re-parsed: the key must hold exactly the new value and
every other key must be unchanged, else the write is refused. Files are rewritten in place, so a
note's creation time survives. All targets are checked before the first write.

Output: one tab-separated row per outcome (tab, newline and backslash escaped as \\t \\n \\\\), or
`--json` for a list of objects:

    task      <task>     next_action  written | kept | unchanged
    project   <name>     next_task    written | kept | unchanged    <vault-relative path>
    skip      <name>     <reason>
    slot      <name>     live | blank | dead:<reason>   <task>   <next_action or task name>
    capture   <task>     <status>     <match,…>

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
TASKS = ("Work", "Tasks")
PROJECTS = ("Work", "Projects")
KEY_RE = re.compile(r"^([^\s#:'\"\-?][^:]*?)\s*:(?:\s|$)")
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")


class Refused(Exception):
    pass


def fail(code, reason):
    sys.stderr.write("next-action: %s\n" % reason)
    sys.exit(code)


try:
    import yaml
except ImportError:
    yaml = None


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


# ---- Frontmatter ------------------------------------------------------------------------------------

class Note:
    """A note's lines (endings kept) and its frontmatter, parsed by PyYAML.

    `span` is (first, closing) line indexes of the frontmatter body, or None when the note has no
    closed frontmatter. `fm` is the parsed mapping, or None when there is no span or it does not
    parse to a mapping (`error` says which)."""

    def __init__(self, path):
        self.path = path
        with open(path, encoding="utf-8", newline="") as fh:
            self.lines = fh.read().splitlines(keepends=True)
        self.span = None
        if self.lines and self.lines[0].rstrip("\r\n").rstrip() == "---":
            for i in range(1, len(self.lines)):
                if self.lines[i].rstrip("\r\n").rstrip() == "---":
                    self.span = (1, i)
                    break
        self.fm, self.error = self._parse()

    def _parse(self):
        if self.span is None:
            return None, "no closed frontmatter"
        try:
            fm = yaml.safe_load("".join(self.lines[self.span[0]:self.span[1]]))
        except yaml.YAMLError:
            return None, "frontmatter does not parse"
        if fm is None:
            return {}, None
        if not isinstance(fm, dict):
            return None, "frontmatter is not a mapping"
        return fm, None

    def get(self, key):
        return (self.fm or {}).get(key)

    @property
    def text(self):
        return "".join(self.lines)

    def _key_lines(self, key):
        s, e = self.span
        return [i for i in range(s, e) if (m := KEY_RE.match(self.lines[i])) and m.group(1) == key]

    def _extent(self, i):
        """Line i plus its value's continuation lines: indented or `- ` lines, blank lines between them."""
        end, j = i + 1, i + 1
        while j < self.span[1]:
            line = self.lines[j]
            if line.strip() == "":
                j += 1
                continue
            if line[:1] in (" ", "\t") or line.startswith("-"):
                j += 1
                end = j
                continue
            break
        return end

    def edited(self, key, value):
        """The note's lines with `key: "<value>"` set, checked by re-parsing. Raises Refused."""
        if self.fm is None:
            raise Refused("%s: %s" % (self.path, self.error))
        hits = self._key_lines(key)
        if len(hits) > 1:
            raise Refused("%s carries `%s:` more than once" % (self.path, key))
        lines = list(self.lines)
        if hits:
            i = hits[0]
            ending = lines[i][len(lines[i].rstrip("\r\n")):] or "\n"
            lines[i:self._extent(i)] = ["%s: %s%s" % (key, json.dumps(value, ensure_ascii=False), ending)]
        else:
            close = self.span[1]
            ending = lines[close - 1][len(lines[close - 1].rstrip("\r\n")):] if close > 1 else ""
            ending = ending or lines[0][len(lines[0].rstrip("\r\n")):] or "\n"
            lines.insert(close, "%s: %s%s" % (key, json.dumps(value, ensure_ascii=False), ending))
        check = Note.__new__(Note)
        check.path, check.lines, check.span = self.path, lines, None
        for k in range(1, len(lines)):
            if lines[k].rstrip("\r\n").rstrip() == "---":
                check.span = (1, k)
                break
        check.fm, check.error = check._parse()
        want = dict(self.fm)
        want[key] = value
        if check.fm != want:
            raise Refused("%s: editing `%s:` would change other frontmatter; left alone" % (self.path, key))
        return lines

    def save(self, lines):
        with open(self.path, "r+", encoding="utf-8", newline="") as fh:  # in place: keep the inode
            fh.write("".join(lines))
            fh.truncate()


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def tags_of(note):
    return {str(t).strip().lstrip("#") for t in as_list(note.get("tags")) if str(t).strip()}


def status_of(note):
    return str(note.get("status") or "").strip().lower().replace("-", "_")


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
        self.by_name, self.by_path = {}, {}  # lower basename -> [rel]; lower rel without .md -> rel
        for d, dirs, files in os.walk(self.root):
            dirs[:] = [x for x in dirs if not x.startswith(".")]
            for name in files:
                if name.lower().endswith(".md"):
                    rel = os.path.relpath(os.path.join(d, name), self.root)
                    self.by_name.setdefault(name[:-3].lower(), []).append(rel)
                    self.by_path[rel[:-3].replace(os.sep, "/").lower()] = rel
        self._notes = {}

    @staticmethod
    def archived(rel):
        return "Archive" in rel.split(os.sep)[:-1]

    @staticmethod
    def under(rel, parts):
        return tuple(rel.split(os.sep)[:len(parts)]) == parts

    def note(self, rel):
        """The parsed note, or None when it cannot be read at all."""
        if rel not in self._notes:
            try:
                self._notes[rel] = Note(os.path.join(self.root, rel))
            except (OSError, UnicodeDecodeError):
                self._notes[rel] = None
        return self._notes[rel]

    def targets(self, link):
        """Every note a wikilink target can mean, as Obsidian resolves it."""
        t = link.strip()
        t = t[:-3] if t.lower().endswith(".md") else t
        if "/" in t:
            rel = self.by_path.get(t.strip("/").lower())
            return [rel] if rel else []
        hits = self.by_name.get(t.lower(), [])
        exact = [p for p in hits if os.path.basename(p)[:-3] == t]
        return exact or list(hits)  # an exact-case name wins, as in Obsidian

    def dead_reason(self, link):
        """None when some live copy of the target is usable; else why the link is dead."""
        paths = self.targets(link)
        if not paths:
            return "missing"
        live = [p for p in paths if not self.archived(p)]
        if not live:
            return "archived"
        reasons = []
        for rel in live:
            note = self.note(rel)
            if note is None or note.fm is None:
                return None  # unreadable: never call a pointer dead on no evidence
            if "archived" in tags_of(note):
                reasons.append("archived")
            elif status_of(note) in DEAD_STATUSES:
                reasons.append(status_of(note))
            else:
                return None
        return reasons[0]

    def path_arg(self, arg):
        """A vault-relative path for an argument that names a file, or None for a bare name."""
        if os.sep not in arg and "/" not in arg and not arg.lower().endswith(".md"):
            return None
        raw = os.path.expanduser(arg)
        full = os.path.realpath(raw if os.path.isabs(raw) else os.path.join(self.root, raw))
        if os.path.commonpath([full, self.root]) != self.root:
            raise Refused("%s is outside the vault (%s)" % (arg, self.root))
        if not os.path.isfile(full):
            if os.sep in arg or "/" in arg:
                raise Refused("no note at %s" % arg)
            return None  # `name.md`: a bare name after all, never a file in the working directory
        return os.path.relpath(full, self.root)

    def resolve_task(self, arg):
        rel = self.path_arg(arg)
        if rel is None:
            hits = [p for p in self.targets(arg) if os.path.dirname(p) == os.path.join(*TASKS)]
            if not hits:
                raise Refused("no task note %r directly under %s" % (arg, "/".join(TASKS)))
            if len(hits) > 1:
                raise Refused("%r names %d task notes: %s" % (arg, len(hits), ", ".join(hits)))
            rel = hits[0]
        if os.path.dirname(rel) != os.path.join(*TASKS):
            raise Refused("%s is not directly under %s" % (rel, "/".join(TASKS)))
        return rel

    def resolve_project(self, link):
        """(rel, None) for a project note, or (None, why it is skipped)."""
        paths = self.targets(link)
        live = [p for p in paths if not self.archived(p)]
        inside = [p for p in live if self.under(p, PROJECTS)]
        if not paths:
            return None, "no note"
        if not live:
            return None, "archived"
        if not inside:
            return None, "not a project note (%s)" % live[0]
        if len(inside) > 1:
            return None, "ambiguous (%s)" % ", ".join(inside)
        note = self.note(inside[0])
        if note is None or note.fm is None:
            return None, "%s (%s)" % (note.error if note else "unreadable", inside[0])
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
    if task is None:
        raise Refused("cannot read %s" % rel)
    if task.fm is None:
        raise Refused("%s: %s" % (rel, task.error))
    if status_of(task) in DEAD_STATUSES:
        raise Refused("%s is %s; a pointer to it would be dead" % (rel, status_of(task)))
    if "archived" in tags_of(task):
        raise Refused("%s is archived; a pointer to it would be dead" % rel)
    name = os.path.basename(rel)[:-3]
    pointer = "[[%s]]" % name

    # Plan every edit, and check each one re-parses, before the first write.
    plan, rows = [], []
    if action is not None and (overwrite or not text_of(task.get("next_action"))):
        if task.get("next_action") == action:
            head = "unchanged"
        else:
            plan.append((task, task.edited("next_action", action)))
            head = "written"
    else:
        head = "kept"
    rows.append({"kind": "task", "name": name, "field": "next_action", "result": head})

    seen = set()
    for link in links_in(task.get("projects")):
        prel, why = vault.resolve_project(link)
        if why:
            rows.append({"kind": "skip", "name": link, "result": why})
            continue
        if prel in seen:
            continue
        seen.add(prel)
        note = vault.note(prel)
        current = links_in(note.get("next_task"))
        blank = not current or all(vault.dead_reason(t) for t in current)
        if not (overwrite or blank):
            result = "kept"
        elif note.get("next_task") == pointer:
            result = "unchanged"
        else:
            try:
                plan.append((note, note.edited("next_task", pointer)))
            except Refused as e:
                rows.append({"kind": "skip", "name": link, "result": "frontmatter not editable (%s)" % str(e)})
                continue
            result = "written"
        rows.append({"kind": "project", "name": link, "field": "next_task", "result": result, "path": prel})

    for note, lines in plan:  # the task file first: the pointer never lands before its target
        note.save(lines)
    return rows


def read_slots(vault, args):
    rows = []
    for arg in args:
        rel = vault.path_arg(arg)
        if rel is not None:
            name, why = os.path.basename(rel)[:-3], None
        else:
            name = arg
            rel, why = vault.resolve_project(arg)
        if why:
            rows.append({"kind": "skip", "name": name, "result": why})
            continue
        note = vault.note(rel)
        if note is None or note.fm is None:
            rows.append({"kind": "skip", "name": name, "result": "%s (%s)" % (note.error if note else "unreadable", rel)})
            continue
        links = links_in(note.get("next_task"))
        if not links:
            rows.append({"kind": "slot", "name": name, "result": "blank", "task": None, "next_action": None})
            continue
        dead = {t: vault.dead_reason(t) for t in links}
        live = [t for t in links if dead[t] is None]
        if not live:
            reason = "; ".join("%s %s" % (t, r) for t, r in dead.items())
            rows.append({"kind": "slot", "name": name, "result": "dead:" + reason, "task": links[0], "next_action": None})
            continue
        target = live[0]
        tnote = next((vault.note(p) for p in vault.targets(target) if not vault.archived(p)), None)
        line = text_of(tnote.get("next_action")) if tnote and tnote.fm is not None else ""
        rows.append({"kind": "slot", "name": name, "result": "live", "task": target, "next_action": line or target})
    return rows


def captures(vault, slug, thread_file):
    tasks_dir = os.path.join(*TASKS)
    needles = {thread_file, os.path.expanduser(thread_file)} if thread_file else set()
    rows = []
    for rels in sorted(vault.by_name.values()):
        for rel in rels:
            if os.path.dirname(rel) != tasks_dir:
                continue
            note = vault.note(rel)
            if note is None or note.fm is None or status_of(note) not in OPEN_STATUSES or "archived" in tags_of(note):
                continue
            base = os.path.basename(rel)[:-3]
            why = []
            if slug and base.lower() == slug.lower():
                why.append("slug")
            if needles and any(n in note.text for n in needles):
                why.append("thread-file")
            if "thread" in tags_of(note):
                why.append("thread-tag")
            if why:
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
            rows = captures(vault, args.slug, args.thread_file)
    except Refused as e:
        fail(2, str(e))
    emit(rows, args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
