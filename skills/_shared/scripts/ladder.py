#!/usr/bin/env python3
"""ladder.py — load the operator's ladder file (ADR 0029 decisions 1 and 2).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py

The ladder is `~/.config/thread/ladder.toml`: named rungs, bottom first. It replaces ADR 0024's top-tier
file and the rollout ceiling: the top rung is the ceiling, and escalation climbs one rung at a time. Stdlib
only. No arguments, no network, and it writes nothing.

The file. One `[[rung]]` table per rung, bottom first, each with exactly these five string keys:

    # ~/.config/thread/ladder.toml: bottom rung first, the top rung is the ceiling
    [[rung]]
    name = "opus-high"     # unique; lowercase [a-z][a-z0-9._-]*, never a YAML word like yes/no/true
    model = "opus"         # a tier alias the engine knows (opus, fable), never a version
    effort = "high"        # the code-writing roles
    judge = "high"         # the plan-gate judge
    review = "xhigh"       # the master review

    [[rung]]
    name = "opus-xhigh"
    model = "opus"
    effort = "xhigh"
    judge = "high"
    review = "xhigh"

Each effort is one of low, medium, high, xhigh, max. Rungs may share a model, so an effort step and a model
step are the same kind of move. The order is the operator's statement: a rung may sit above one with more
effort, and nothing is clamped. The inline form `rung = [{ name = "...", ... }, ...]` is accepted too.

No file gives the built-in ladder: the two rungs above. It names no model above Opus and no `max` (ADR 0029
decision 2), and reading it needs no tomllib, so it works on any python 3. Reading a present file needs
python >= 3.11 (tomllib). "No file" means only that nothing is at the path: it, or a directory on the way
to it, does not exist, or a step on the way is a plain file. Anything else is refused, never read as no
file: a dangling symlink at the path or on the way to it, and a path that cannot be checked at all (a
directory on the way that cannot be searched, say).

Validation. A present file that does not validate is refused, never replaced by the built-in ladder: an
empty or comment-only file included, because the operator wrote it. One error is reported per run: the
first found in this order, which is not always the earliest line in the file:
1. the path can be read, and the bytes are UTF-8 and valid TOML (tomllib's first syntax error);
2. the only top-level key is `rung`. Any other key or table, a `[[rungs]]` typo included, is an unknown
   key, reported ahead of every rung's own errors;
3. `rung` holds at least one rung and is an array of tables (`[[rung]]`, never a single `[rung]`);
4. the rungs in order. Within a rung its unknown keys come first, since each implies a missing key. Then
   the error on the earliest line among: a missing key (named at the rung's own line), a value that is
   not a string, and a value that is not valid as above. A duplicate name names its first line too.
The line named is tomllib's for a syntax error, and the bad key's own line otherwise. A rung's own line is
its `[[rung]]` header, or in the inline form the line its `{` opens on (so there every key of a rung names
that line). A key the line scan cannot place falls back to its rung's own line, then the `rung =` line,
then no line.

Output. Exit 0 and one JSON line on stdout:

    {"source": "<the file's path>" | "built-in", "rungs": [{"name", "model", "effort", "judge", "review"}, ...]}

`source` is the expanded path (HOME honoured, symlinks not resolved). The rungs come bottom first, each
with its keys in that order. Exit 2 when the file is refused (or on a usage error), exit 3 when a present
file needs tomllib and this python has none. On failure stdout is empty and stderr carries one line,
`ladder: <path>:<line>: <reason>`, or `ladder: <path>: <reason>` when no line applies.

Importable: load(path=None), BUILT_IN, MODELS, EFFORTS, FIELDS, LadderError.
"""
import argparse
import json
import os
import re
import stat
import sys

# Must equal the engine's model set (task.workflow.js LADDER_MODELS); tests/ladder.test.mjs pins it.
MODELS = ("opus", "fable")
EFFORTS = ("low", "medium", "high", "xhigh", "max")
FIELDS = ("name", "model", "effort", "judge", "review")
EFFORT_FIELDS = ("effort", "judge", "review")

BUILT_IN = (
    {"name": "opus-high", "model": "opus", "effort": "high", "judge": "high", "review": "xhigh"},
    {"name": "opus-xhigh", "model": "opus", "effort": "xhigh", "judge": "high", "review": "xhigh"},
)

# A rung name is later written raw into YAML frontmatter (`rung: <name>`), so it stays a plain lowercase
# token that YAML reads back as the same string.
NAME_RE = re.compile(r"[a-z][a-z0-9._-]*\Z")
YAML_WORDS = frozenset(("true", "false", "yes", "no", "on", "off", "y", "n", "null"))

# One TOML key segment: bare, "basic" or 'literal'.
_SEG = r'(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|\'[^\']*\')'
_AOT_RE = re.compile(r"\[\[\s*(" + _SEG + r")\s*(\.[^\]]*)?\]\]\s*(?:#.*)?\Z")
_TABLE_RE = re.compile(r"\[\s*(" + _SEG + r")\s*(?:\.[^\]]*)?\]\s*(?:#.*)?\Z")
_KEY_RE = re.compile(r"(" + _SEG + r")\s*([.=])")
_TOML_POS_RE = re.compile(r"\s*\(at (?:line (\d+), column (\d+)|end of document)\)\s*\Z")


def default_path():
    return os.path.expanduser("~/.config/thread/ladder.toml")


class LadderError(Exception):
    def __init__(self, reason, line=None, code=2):
        Exception.__init__(self, reason)
        self.reason = reason
        self.line = line
        self.code = code


def _unquote(seg):
    if seg[:1] == '"':
        try:
            return json.loads(seg)
        except ValueError:
            return seg[1:-1]
    if seg[:1] == "'":
        return seg[1:-1]
    return seg


class _Index:
    """Where things sit in the file, by a line scan: tomllib reports no positions for semantic errors.

    top: each top-level name's first line (a key, a [table] or [[table]] header's first segment).
    headers: each [[rung]] header's line. keys: per [[rung]], each key's first line until the next header.
    inline: in the inline form `rung = [...]`, the line each rung's `{` opens on, in order.

    Only a line that starts outside every value is read as a header or a key. The rest of each line is
    scanned as TOML values: strings and comments are skipped, so a quote or bracket inside one counts for
    nothing, and the multi-line strings and arrays left open at a line's end carry over to the next line.
    """

    def __init__(self, text):
        self.top = {}
        self.headers = []
        self.keys = []
        self.inline = []
        self._table = None  # index into headers while inside a [[rung]]; "other" inside any other table
        self._string = None  # the delimiter of a multi-line string left open at the end of a line
        self._brackets = []  # the [ and { of the values left open at the end of a line, outermost first
        self._rung_array = False  # the outermost open [ is the top-level `rung = [`
        for n, line in enumerate(text.split("\n"), 1):
            self._line(n, line.strip())

    def _line(self, n, s):
        opens_rung = False
        if self._string is None and not self._brackets:
            if not s or s.startswith("#"):
                return
            m = _AOT_RE.match(s)
            if m:
                name = _unquote(m.group(1))
                self.top.setdefault(name, n)
                if name == "rung" and m.group(2) is None:
                    self.headers.append(n)
                    self.keys.append({})
                    self._table = len(self.headers) - 1
                else:
                    self._table = "other"
                return
            m = _TABLE_RE.match(s)
            if m:
                self.top.setdefault(_unquote(m.group(1)), n)
                self._table = "other"
                return
            m = _KEY_RE.match(s)
            if m:
                key = _unquote(m.group(1))
                if self._table is None:
                    self.top.setdefault(key, n)
                    opens_rung = key == "rung" and m.group(2) == "="
                elif self._table != "other":
                    self.keys[self._table].setdefault(key, n)
        self._scan(n, s, opens_rung)

    def _scan(self, n, s, opens_rung):
        i = 0
        while i < len(s):
            if self._string:
                i = self._close_multiline(s, i)
                continue
            c = s[i]
            if c == "#":  # a comment runs to the end of the line
                return
            if s.startswith('"""', i) or s.startswith("'''", i):
                self._string = s[i:i + 3]
                i += 3
                continue
            if c == '"':
                i = self._end_of_basic(s, i + 1)
                continue
            if c == "'":
                end = s.find("'", i + 1)
                i = len(s) if end < 0 else end + 1
                continue
            if c in "[{":
                if c == "{" and self._rung_array and self._brackets == ["["]:
                    self.inline.append(n)
                if c == "[" and opens_rung and not self._brackets:
                    self._rung_array = True
                self._brackets.append(c)
            elif c in "]}" and self._brackets:
                self._brackets.pop()
                if not self._brackets:
                    self._rung_array = False
            i += 1

    @staticmethod
    def _end_of_basic(s, i):
        """The index just past a one-line "basic" string's closing quote, from i just past its opening."""
        while i < len(s):
            if s[i] == "\\":
                i += 2
            elif s[i] == '"':
                return i + 1
            else:
                i += 1
        return len(s)

    def _close_multiline(self, s, i):
        """Inside a multi-line string from i: the index just past its closing quotes, or the line's end."""
        quote = self._string[0]
        while i < len(s):
            if quote == '"' and s[i] == "\\":  # an escape, or a line-ending backslash in a basic string
                i += 2
            elif s.startswith(self._string, i):
                # Up to two more quotes may directly precede the closing three: the whole run ends the string.
                while i < len(s) and s[i] == quote:
                    i += 1
                self._string = None
                return i
            else:
                i += 1
        return len(s)


def _type_name(value):
    if isinstance(value, bool):
        return "a boolean"
    if isinstance(value, int):
        return "an integer"
    if isinstance(value, float):
        return "a float"
    if isinstance(value, list):
        return "an array"
    if isinstance(value, dict):
        return "a table"
    return "a date or time"


def _last_line(text):
    return text.rstrip("\r\n").count("\n") + 1


def _parse(data):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise LadderError("not UTF-8 (byte 0x%02x)" % data[e.start], line=data[:e.start].count(b"\n") + 1)
    try:
        import tomllib
    except ImportError:
        raise LadderError("python >= 3.11 required to read this file (tomllib); this is python %d.%d"
                          % sys.version_info[:2], code=3)
    try:
        return text, tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        # tomllib names the position only in its message before python 3.14 (which adds .lineno), and
        # past the last newline at end of document there: that maps to the file's last line.
        reason, line = str(e), getattr(e, "lineno", None)
        m = _TOML_POS_RE.search(reason)
        if m and m.group(1) is None:
            reason, line = reason[:m.start()] + " (at end of document)", _last_line(text)
        elif m:
            reason, line = reason[:m.start()] + " (column %s)" % m.group(2), line or int(m.group(1))
        raise LadderError("invalid TOML: %s" % reason, line=line)


def _validate(text, doc):
    idx = _Index(text)
    rung_line = idx.top.get("rung")

    for key in doc:
        if key != "rung":
            raise LadderError("unknown top-level key %s (a ladder file holds only [[rung]] tables)"
                              % json.dumps(key), line=idx.top.get(key))
    rungs = doc.get("rung")
    if rungs is None or rungs == []:
        raise LadderError("a ladder needs at least one rung: add a [[rung]] table", line=rung_line)
    if isinstance(rungs, dict):
        raise LadderError("rung must be an array of tables: write [[rung]], not [rung]", line=rung_line)
    if not isinstance(rungs, list) or not all(isinstance(r, dict) for r in rungs):
        raise LadderError("rung must be an array of tables ([[rung]])", line=rung_line)

    # Each rung's own line: its [[rung]] header, or in the inline form the line its { opens on. A valid file
    # has one form or the other, never both. Per-key lines exist for [[rung]] tables only.
    starts = idx.headers or idx.inline
    aligned = len(starts) == len(rungs)
    keyed = aligned and bool(idx.headers)
    seen = {}  # name -> (rung number, line)
    out = []
    for i, rung in enumerate(rungs):
        number = i + 1
        header = starts[i] if aligned else rung_line

        def line_of(key):
            found = idx.keys[i].get(key) if keyed else None
            return found or header

        name = rung.get("name")
        usable = isinstance(name, str) and NAME_RE.match(name) and name not in YAML_WORDS
        label = "rung %d (%s)" % (number, json.dumps(name)) if usable else "rung %d" % number

        for key in rung:
            if key not in FIELDS:
                raise LadderError("%s: unknown key %s (a rung has %s)" % (label, json.dumps(key), ", ".join(FIELDS)),
                                  line=line_of(key))

        errors = []  # (line, reason); the first in file order wins
        for key in FIELDS:
            if key not in rung:
                errors.append((header, "%s: missing %s" % (label, json.dumps(key))))
                continue
            value = rung[key]
            if not isinstance(value, str):
                errors.append((line_of(key), "%s: %s must be a string, not %s" % (label, key, _type_name(value))))
            elif key == "name":
                if not NAME_RE.match(value):
                    errors.append((line_of(key), "%s: name %s must be lowercase [a-z][a-z0-9._-]*"
                                   % (label, json.dumps(value))))
                elif value in YAML_WORDS:
                    errors.append((line_of(key), "%s: name %s is a YAML boolean or null word (%s)"
                                   % (label, json.dumps(value), ", ".join(sorted(YAML_WORDS)))))
                elif value in seen:
                    first_rung, first_line = seen[value]
                    first = "first at line %d" % first_line if first_line else "first in rung %d" % first_rung
                    errors.append((line_of(key), "%s: duplicate name %s (%s)" % (label, json.dumps(value), first)))
            elif key == "model" and value not in MODELS:
                errors.append((line_of(key), "%s: unknown model %s: a model is a tier alias, never a version "
                               "(known: %s)" % (label, json.dumps(value), ", ".join(MODELS))))
            elif key in EFFORT_FIELDS and value not in EFFORTS:
                errors.append((line_of(key), "%s: %s %s is not one of %s"
                               % (label, key, json.dumps(value), ", ".join(EFFORTS))))
        if errors:
            line, reason = min(errors, key=lambda e: e[0] if e[0] is not None else float("inf"))
            raise LadderError(reason, line=line)
        seen[name] = (number, line_of("name") if aligned else None)
        out.append({key: rung[key] for key in FIELDS})
    return out


def load(path=None):
    """The resolved ladder: {"source": <path> | "built-in", "rungs": [rung, ...]}, bottom first.

    Raises LadderError (with .line and .code) when a present file cannot be read or does not validate.
    """
    path = default_path() if path is None else path
    try:
        # lstat, not os.path.lexists: lexists reads every error as "nothing there", so a file in a directory
        # that cannot be searched would give the built-in ladder.
        st = os.lstat(path)
    except (FileNotFoundError, NotADirectoryError):
        _refuse_dangling_parent(path)
        return {"source": "built-in", "rungs": [dict(r) for r in BUILT_IN]}
    except OSError as e:
        raise LadderError("cannot read it: %s" % (e.strerror or e))
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        if isinstance(e, FileNotFoundError) and stat.S_ISLNK(st.st_mode):
            raise LadderError("cannot read it: a symlink to a missing file (%s)" % _target(path))
        raise LadderError("cannot read it: %s" % (e.strerror or e))
    text, doc = _parse(data)
    return {"source": path, "rungs": _validate(text, doc)}


def _target(link):
    try:
        return os.readlink(link)
    except OSError as e:
        return "unreadable: %s" % (e.strerror or e)


def _refuse_dangling_parent(path):
    """Nothing is at the path. Refuse it when the cause is a dangling symlink on the way, not a missing step."""
    parent = os.path.dirname(path)
    while parent and parent != os.path.dirname(parent):
        if os.path.islink(parent) and not os.path.exists(parent):
            raise LadderError("cannot read it: %s is a symlink to a missing directory (%s)"
                              % (parent, _target(parent)))
        parent = os.path.dirname(parent)


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        sys.stderr.write("ladder: %s\n" % message)
        sys.exit(2)


def main(argv):
    _Parser(prog="ladder", description="Print the operator's ladder (%s) as JSON." % default_path()).parse_args(argv)
    path = default_path()
    try:
        ladder = load(path)
    except LadderError as e:
        where = path if e.line is None else "%s:%d" % (path, e.line)
        sys.stderr.write("ladder: %s: %s\n" % (where, e.reason))
        return e.code
    sys.stdout.write(json.dumps(ladder) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
