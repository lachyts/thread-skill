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

No file (nothing at the path, not even a dangling symlink) gives the built-in ladder: the two rungs above.
It names no model above Opus and no `max` (ADR 0029 decision 2), and reading it needs no tomllib, so it
works on any python 3. Reading a present file needs python >= 3.11 (tomllib).

Validation. A present file that does not validate is refused, never replaced by the built-in ladder: an
empty or comment-only file included, because the operator wrote it. The first error in file order is
reported, one per run:
- the path is readable and the bytes are UTF-8 and valid TOML;
- the only top-level key is `rung` (a `[[rungs]]` typo is an unknown key), and it holds at least one rung;
- `rung` is an array of tables (`[[rung]]`, never a single `[rung]`);
- within each rung, unknown keys first, then each key in turn: present, a string, then valid as above.
  A duplicate name names its first line too.
The line named is tomllib's for a syntax error, and the bad key's own line otherwise. A key that line
scanning cannot place (the inline form, say) falls back to its rung's `[[rung]]` line, then the `rung =`
line, then no line.

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
import sys

# Must equal the engine's model set (task.workflow.js TIER_RANK's keys); tests/ladder.test.mjs pins it.
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
_KEY_RE = re.compile(r"(" + _SEG + r")\s*[.=]")
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
    """

    def __init__(self, text):
        self.top = {}
        self.headers = []
        self.keys = []
        rung = None  # index into headers while inside a [[rung]]; "other" inside any other table
        multiline = None
        for n, line in enumerate(text.split("\n"), 1):
            s = line.strip()
            if multiline:  # inside a multi-line string: only its closing quotes matter
                if s.count(multiline) % 2:
                    multiline = None
                continue
            if not s or s.startswith("#"):
                continue
            m = _AOT_RE.match(s)
            if m:
                name = _unquote(m.group(1))
                self.top.setdefault(name, n)
                if name == "rung" and m.group(2) is None:
                    self.headers.append(n)
                    self.keys.append({})
                    rung = len(self.headers) - 1
                else:
                    rung = "other"
                continue
            m = _TABLE_RE.match(s)
            if m:
                self.top.setdefault(_unquote(m.group(1)), n)
                rung = "other"
                continue
            m = _KEY_RE.match(s)
            if m:
                key = _unquote(m.group(1))
                if rung is None:
                    self.top.setdefault(key, n)
                elif rung != "other":
                    self.keys[rung].setdefault(key, n)
            for quotes in ('"""', "'''"):
                if s.count(quotes) % 2:
                    multiline = quotes
                    break


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

    aligned = len(idx.headers) == len(rungs)
    seen = {}  # name -> (rung number, line)
    out = []
    for i, rung in enumerate(rungs):
        number = i + 1
        header = idx.headers[i] if aligned else rung_line

        def line_of(key):
            found = idx.keys[i].get(key) if aligned else None
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
        seen[name] = (number, idx.keys[i].get("name") if aligned else None)
        out.append({key: rung[key] for key in FIELDS})
    return out


def load(path=None):
    """The resolved ladder: {"source": <path> | "built-in", "rungs": [rung, ...]}, bottom first.

    Raises LadderError (with .line and .code) when a present file cannot be read or does not validate.
    """
    path = default_path() if path is None else path
    if not os.path.lexists(path):
        return {"source": "built-in", "rungs": [dict(r) for r in BUILT_IN]}
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        if os.path.islink(path) and not os.path.exists(path):
            raise LadderError("cannot read it: a symlink to a missing file (%s)" % os.readlink(path))
        raise LadderError("cannot read it: %s" % (e.strerror or e))
    text, doc = _parse(data)
    return {"source": path, "rungs": _validate(text, doc)}


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
