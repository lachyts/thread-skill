#!/usr/bin/env python3
"""The next-action slot's one writer and reader (estate ADR 0008; task-writer.md § 4b).

Stdlib only, python >= 3.8. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py <verb> ... [--vault PATH]

Verbs:

  set-down <task> --action <line>   The set-down write (stash, defer, close): overwrite the task's
                                    `next_action:`, then point `next_task:` at the task on every project
                                    note its `projects:` links. Task file first, so the pointer never
                                    lands before its target.
  fill <task> [--action <line>]     Every other writer (orient): the same targets, but `next_task:` only
                                    where the slot is blank or dead, `next_action:` only where blank.
  read <project>...                 Each project's slot: live, blank, or dead (with the reason).
  captures [--slug S] [--thread-file P]
                                    Open (`open` / `in_progress`) tasks under Work/Tasks that may carry a
                                    thread: `thread`-tagged ones, the one named <slug>, and any whose body
                                    names <thread-file>. Tag lists in either YAML form.

<task> is a task file path or basename; <project> a project note path or basename.

Output is one tab-separated row per outcome (`--json` for a list of objects):

    task      <task>     next_action  written | kept | unchanged
    project   <name>     next_task    written | kept | unchanged    <vault-relative path>
    skip      <name>     <reason>                                   (area note, not a project note, …)
    slot      <name>     live | blank | dead:<reason>   <task>   <next_action or task title>
    capture   <task>     <status>     <match,…>

A dead link is a target that is missing, lives only under an Archive/ folder, carries the
`archived` tag, or has status done, merged or dropped — the rule every reader shares with the
estate's next-action-blanks.py. An unreadable target is never called dead.

Frontmatter edits are line edits of one top-level key: the key's line (and any indented or
`- ` continuation lines under it) becomes one `key: "<value>"` line, or the line is added before
the closing `---`. Nothing else in the file changes. Values are always double-quoted with JSON
escaping, which is valid YAML for any one-line text. A file whose frontmatter cannot be edited
safely (none, unclosed, the key twice) is refused, never guessed at.

Exit 0 on success (skips included). Exit 2 when the input is refused (the task is missing, dead or
not editable; an action that is blank or spans lines); stderr then carries one line starting
`next-action: ` and nothing was written. Exit 3 when the vault is missing.
"""
import argparse
import json
import os
import re
import sys
import tempfile

VAULT_DEFAULT = os.path.expanduser("~/repos/obsidian")
DEAD_STATUSES = {"done", "merged", "dropped"}
OPEN_STATUSES = {"open", "in_progress"}
KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):(.*)$")
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")


class Refused(Exception):
    pass


def fail(code, reason):
    sys.stderr.write("next-action: %s\n" % reason)
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


# ---- Frontmatter: a minimal reader and a one-key line editor -------------------------------------

class Note:
    """A note's text split around its frontmatter. `fm` is None when there is none, or it is unclosed."""

    def __init__(self, path):
        self.path = path
        with open(path, encoding="utf-8", newline="") as fh:  # newline="": keep CRLF as written
            self.text = fh.read()
        self.nl = "\r\n" if "\r\n" in self.text else "\n"
        self.lines = self.text.split(self.nl)
        self.fm = None  # (start, end): lines[start:end] is the frontmatter body
        if self.lines and self.lines[0].rstrip() == "---":
            for i in range(1, len(self.lines)):
                if self.lines[i].rstrip() == "---":
                    self.fm = (1, i)
                    break

    def _keys(self, key):
        if self.fm is None:
            return []
        s, e = self.fm
        return [i for i in range(s, e) if (m := KEY_RE.match(self.lines[i])) and m.group(1) == key]

    def _extent(self, i):
        """Line i plus the continuation lines of its value (indented, or block-list `- ` items)."""
        j = i + 1
        while j < self.fm[1] and (self.lines[j][:1] in (" ", "\t") or self.lines[j].startswith("- ")):
            j += 1
        return j

    def get(self, key):
        """The value: a string, a list of strings, or None when absent or empty."""
        hits = self._keys(key)
        if not hits:
            return None
        i = hits[0]
        inline = KEY_RE.match(self.lines[i]).group(2).strip()
        if inline:
            if inline.startswith("[") and inline.endswith("]") and not inline.startswith("[["):
                return [unquote(x) for x in split_flow(inline[1:-1]) if x.strip()]
            return unquote(inline)
        items = []
        for line in self.lines[i + 1:self._extent(i)]:
            m = re.match(r"^\s*-\s*(.*)$", line)
            if m and m.group(1).strip():
                items.append(unquote(m.group(1).strip()))
        return items or None

    def set(self, key, value):
        """Replace (or add) `key: "<value>"`. Returns True when the text changed."""
        if self.fm is None:
            raise Refused("%s has no closed frontmatter" % self.path)
        hits = self._keys(key)
        if len(hits) > 1:
            raise Refused("%s carries `%s:` more than once" % (self.path, key))
        new = "%s: %s" % (key, json.dumps(value, ensure_ascii=False))
        if hits:
            i = hits[0]
            j = self._extent(i)
            if self.lines[i:j] == [new]:
                return False
            self.lines[i:j] = [new]
            self.fm = (self.fm[0], self.fm[1] - (j - i) + 1)
        else:
            self.lines.insert(self.fm[1], new)
            self.fm = (self.fm[0], self.fm[1] + 1)
        return True

    def save(self):
        text = self.nl.join(self.lines)
        d = os.path.dirname(self.path)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".next-action-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
            os.chmod(tmp, os.stat(self.path).st_mode & 0o7777)
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise


def split_flow(text):
    """Split a flow sequence body on top-level commas, respecting quotes and [[links]]."""
    out, cur, depth, quote = [], "", 0, None
    for ch in text:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            cur += ch
        elif ch == "[":
            depth += 1
            cur += ch
        elif ch == "]":
            depth -= 1
            cur += ch
        elif ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [x.strip() for x in out]


def unquote(text):
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] == '"':
        try:
            return json.loads(text)
        except ValueError:
            return text[1:-1]
    if len(text) >= 2 and text[0] == text[-1] == "'":
        return text[1:-1].replace("''", "'")
    return re.sub(r"\s+#.*$", "", text)


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def tags_of(note):
    return {str(t).strip().lstrip("#") for t in as_list(note.get("tags")) if str(t).strip()}


def status_of(note):
    return str(note.get("status") or "").strip().lower()


def links_in(value):
    out = []
    for item in as_list(value):
        found = LINK_RE.findall(str(item))
        out += [f.strip() for f in found] if found else ([str(item).strip()] if str(item).strip() else [])
    return out


# ---- The vault --------------------------------------------------------------------------------------

class Vault:
    def __init__(self, root):
        if not os.path.isdir(root):
            fail(3, "no vault at %s" % root)
        self.root = root
        self.index = {}  # basename -> [vault-relative path]
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if not x.startswith(".")]
            for name in files:
                if name.lower().endswith(".md"):
                    rel = os.path.relpath(os.path.join(d, name), root)
                    self.index.setdefault(name[:-3], []).append(rel)

    def abs(self, rel):
        return os.path.join(self.root, rel)

    @staticmethod
    def archived(rel):
        return "Archive" in rel.split(os.sep)[:-1]

    def read(self, rel):
        try:
            return Note(self.abs(rel))
        except (OSError, UnicodeDecodeError):
            return None

    def dead_reason(self, target):
        """None when some live copy of `target` is usable; else why the link is dead."""
        paths = self.index.get(target, [])
        if not paths:
            return "missing"
        live = [p for p in paths if not self.archived(p)]
        if not live:
            return "archived"
        reasons = []
        for rel in live:
            note = self.read(rel)
            if note is None:
                return None  # unreadable: never call a pointer dead on no evidence
            if "archived" in tags_of(note):
                reasons.append("archived")
            elif status_of(note) in DEAD_STATUSES:
                reasons.append(status_of(note))
            else:
                return None
        return reasons[0]

    def resolve_task(self, arg):
        for path in (os.path.expanduser(arg), os.path.join(self.root, arg)):  # as given, or vault-relative
            if os.path.isfile(path):
                return os.path.relpath(os.path.abspath(path), self.root)
        name = os.path.basename(arg)
        name = name[:-3] if name.lower().endswith(".md") else name
        live = [p for p in self.index.get(name, []) if not self.archived(p)]
        tasks = [p for p in live if p.split(os.sep)[:2] == ["Work", "Tasks"]]
        if len(tasks) == 1:
            return tasks[0]
        if not tasks:
            raise Refused("no task note %r under Work/Tasks" % arg)
        raise Refused("%r names %d task notes: %s" % (arg, len(tasks), ", ".join(tasks)))

    def resolve_project(self, name):
        """(rel, None) for a project note, or (None, why it is skipped)."""
        paths = self.index.get(name, [])
        live = [p for p in paths if not self.archived(p)]
        under = [p for p in live if p.split(os.sep)[:2] == ["Work", "Projects"]]
        if not paths:
            return None, "no note"
        if not live:
            return None, "archived"
        if not under:
            return None, "not a project note (%s)" % live[0]
        if len(under) > 1:
            return None, "ambiguous (%s)" % ", ".join(under)
        note = self.read(under[0])
        if note is None:
            return None, "unreadable (%s)" % under[0]
        tags = tags_of(note)
        if "project" in tags:
            return under[0], None
        if "area" in tags:
            return None, "area note (%s)" % under[0]
        return None, "not a project note (%s)" % under[0]


# ---- Verbs ------------------------------------------------------------------------------------------

def check_action(action):
    if action is None:
        return None
    action = action.strip()
    if not action:
        raise Refused("--action is blank")
    if "\n" in action or "\r" in action:
        raise Refused("--action must be one line")
    return action


def write(vault, task_arg, action, overwrite):
    action = check_action(action)
    rel = vault.resolve_task(task_arg)
    task = vault.read(rel)
    if task is None:
        raise Refused("cannot read %s" % rel)
    if task.fm is None:
        raise Refused("%s has no closed frontmatter" % rel)
    name = os.path.basename(rel)[:-3]
    if status_of(task) in DEAD_STATUSES:
        raise Refused("%s is %s; a pointer to it would be dead" % (rel, status_of(task)))
    if "archived" in tags_of(task) or vault.archived(rel):
        raise Refused("%s is archived; a pointer to it would be dead" % rel)
    if overwrite and action is None:
        raise Refused("set-down needs --action")

    # Resolve every target and check it is editable before writing anything.
    rows, projects = [], []
    for link in links_in(task.get("projects")):
        prel, why = vault.resolve_project(link)
        if why:
            rows.append({"kind": "skip", "name": link, "result": why})
            continue
        note = vault.read(prel)
        if note.fm is None or len(note._keys("next_task")) > 1:
            rows.append({"kind": "skip", "name": link, "result": "frontmatter not editable (%s)" % prel})
            continue
        projects.append((link, prel, note))

    pointer = "[[%s]]" % name
    if action is not None and (overwrite or not str(task.get("next_action") or "").strip()):
        changed = task.set("next_action", action)
        if changed:
            task.save()
        head = {"kind": "task", "name": name, "field": "next_action", "result": "written" if changed else "unchanged"}
    else:
        head = {"kind": "task", "name": name, "field": "next_action", "result": "kept"}

    for link, prel, note in projects:
        current = links_in(note.get("next_task"))
        blank = not current or all(vault.dead_reason(t) for t in current)
        if overwrite or blank:
            changed = note.set("next_task", pointer)
            if changed:
                note.save()
            result = "written" if changed else "unchanged"
        else:
            result = "kept"
        rows.append({"kind": "project", "name": link, "field": "next_task", "result": result, "path": prel})
    return [head] + rows


def read_slots(vault, names):
    rows = []
    for arg in names:
        path = os.path.expanduser(arg)
        if os.path.isfile(path):
            prel, why = os.path.relpath(os.path.abspath(path), vault.root), None
            name = os.path.basename(prel)[:-3]
        else:
            name = arg
            prel, why = vault.resolve_project(name)
        if why:
            rows.append({"kind": "skip", "name": name, "result": why})
            continue
        note = vault.read(prel)
        links = links_in(note.get("next_task")) if note else []
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
        tnote = next((vault.read(p) for p in vault.index.get(target, []) if not vault.archived(p)), None)
        line = str(tnote.get("next_action") or "").strip() if tnote else ""
        rows.append({"kind": "slot", "name": name, "result": "live", "task": target, "next_action": line or target})
    return rows


def captures(vault, slug, thread_file):
    tasks_dir = os.path.join("Work", "Tasks")
    needle = os.path.expanduser(thread_file) if thread_file else None
    rows = []
    for base, paths in sorted(vault.index.items()):
        for rel in paths:
            if os.path.dirname(rel) != tasks_dir:
                continue
            note = vault.read(rel)
            if note is None or status_of(note) not in OPEN_STATUSES or "archived" in tags_of(note):
                continue
            why = []
            if slug and base == slug:
                why.append("slug")
            if needle and (needle in note.text or thread_file in note.text):
                why.append("thread-file")
            if "thread" in tags_of(note):
                why.append("thread-tag")
            if why:
                rows.append({"kind": "capture", "name": base, "result": status_of(note), "match": ",".join(why)})
    return rows


def emit(rows, as_json):
    if as_json:
        sys.stdout.write(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
        return
    for r in rows:
        if r["kind"] == "slot":
            cols = [r["kind"], r["name"], r["result"], r["task"] or "", r["next_action"] or ""]
        elif r["kind"] == "capture":
            cols = [r["kind"], r["name"], r["result"], r["match"]]
        elif r["kind"] == "skip":
            cols = [r["kind"], r["name"], r["result"]]
        else:
            cols = [r["kind"], r["name"], r["field"], r["result"]] + ([r["path"]] if "path" in r else [])
        sys.stdout.write("\t".join(cols) + "\n")


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
