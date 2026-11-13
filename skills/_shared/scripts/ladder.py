#!/usr/bin/env python3
"""ladder.py — load the operator's ladder file (ADR 0029 decisions 1 and 2, as amended by ADR 0079 decisions 1 to 4).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py

The ladder is `~/.config/thread/ladder.toml`: named rungs, bottom first. It replaces ADR 0024's top-tier
file and the rollout ceiling: the top rung is the ceiling, and escalation climbs one rung at a time. Stdlib
only. No arguments, no network, and it writes nothing.

The file. One `[[rung]]` table per rung, bottom first, each with these five string keys:

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

Two keys are optional (ADR 0079 decisions 1 and 3): a sixth key on any rung, `plan`, and at most one `[role]` table
for the whole ladder. An operator's file that uses both might read:

    [[rung]]
    name = "opus-high"
    model = "opus"
    effort = "high"
    judge = "high"
    review = "xhigh"
    plan = "fable"         # the plan model (ADR 0079 decision 1)

    [role]                 # a role's own model in place of the rung's (ADR 0079 decision 3)
    master-review = "fable"  # every master-review round
    builder = "opus"         # the implementer (its first pass and its retry) and the reviser
    investigator = "fable"   # the agent of a scope: read-only task

The table may also be written inline, `role = { builder = "...", ... }`, or as dotted keys, `role.builder = "..."`,
each before the first `[[rung]]`.

A third optional key is one `[share]` table (ADR 0079 decision 3, task p46-2): each drawn role's Fable share, the
chance in [0, 1] that a task (a rollout, for `lead`) falls in that role's Fable arm. It is the share's source until
p46-3 supplies the paced one:

    [share]
    master-review = 0.5    # an int or a float in [0, 1]; a boolean is refused
    builder = 0.5          # the builder of a hard task (work_depth: deep or scope: cross-cutting)
    investigator = 0.5
    lead = 0.5             # a rollout's lead, drawn by the rollout's name

Its keys are SHARE_ROLES (ROLES and `lead`), never `planner` or `plan-judge`: planning takes the rung's plan model and
is never drawn. A role that names its own model in `[role]` runs on that model for every task, so it is never drawn
and is refused in `[share]`. The inline form `share = { ... }` and dotted keys `share.<role> = ...` are accepted, as
`[role]`'s are. This loader only validates and passes it on: reconcile-rollout.py draws each task's arms from it at
the task's first dispatch and stamps them on the note (`arms:`), and the engine reads only that stamp.

The plan model and the role models. `plan` and each role's value are a model alias, as `model` is. A rung's `plan`
is the model its planner, plan reviser and plan judge run on, always at `high`: the judge rides with the planner. A
rung that names no `plan` plans on its own model at its own `effort`. So a plan-stage climb moves the task's rung,
and while both rungs name the same plan model it leaves the plan's model and effort as they are; a climb into a rung
that names no plan model plans on that rung. A role's own model replaces the rung's for that role only: at
`high` when it differs from the rung's model, at the rung's own effort for that role when it names the rung's model.
On an all-Fable rung (`model = "fable"` and `plan` absent or "fable") the rung wins for every role; below it a
role's own model wins. Integration takes neither: it runs on the highest rung that is not all-Fable (the top rung
when every rung is), at that rung's own model and efforts. This loader only validates and passes them on; the engine
(task.workflow.js runOn, planOn, integrationRungOf) applies them.

No file gives the built-in ladder: the first example's two rungs, with no `plan` and no `[role]`. It names no model
above Opus and no `max` (ADR 0029 decision 2), and reading it needs no tomllib, so it works on any python 3. Reading
a present file needs python >= 3.11 (tomllib). "No file" means only that nothing is at the path: it, or a directory
on the way to it, does not exist, or a step on the way is a plain file. Anything else is refused, never read as no
file: a dangling symlink at the path or on the way to it, and a path that cannot be checked at all (a
directory on the way that cannot be searched, say).

Validation. A present file that does not validate is refused, never replaced by the built-in ladder: an
empty or comment-only file included, because the operator wrote it. One error is reported per run: the
first found in this order, which is not always the earliest line in the file:
1. the path can be read, and the bytes are UTF-8 and valid TOML (tomllib's first syntax error);
2. the only top-level keys are `rung`, `role` and `share`. Any other key or table, a `[[rungs]]` or `[roles]` typo
   included, is an unknown key, reported ahead of every rung's own errors;
3. `rung` holds at least one rung and is an array of tables (`[[rung]]`, never a single `[rung]`);
4. the rungs in order. Within a rung its unknown keys come first, since each implies a missing key. Then
   the error on the earliest line among: a missing key (named at the rung's own line), a value that is
   not a string, and a value that is not valid as above (an optional `plan` included). A duplicate name names
   its first line too;
5. the role table: it is a table (`[role]`, never `[[role]]` or a value of another type); then its unknown role
   names, the first in the file; then the error on the earliest line among a value that is not a string and an
   unknown model;
6. the share table: it is a table (`[share]`, never `[[share]]` or a value of another type); then its unknown role
   names, the first in the file (`planner` and `plan-judge` among them); then the error on the earliest line among
   a value that is not a number (a boolean included), a number outside [0, 1], and a role the `[role]` table also
   names.
The line named is tomllib's for a syntax error, and the bad key's own line otherwise. A rung's own line is
its `[[rung]]` header, or in the inline form the line its `{` opens on (so there every key of a rung names
that line). A key the line scan cannot place falls back to its rung's own line, then the `rung =` line,
then no line. A role's line is its key's line in `[role]` (a `[role.<name>]` header's line for a table value, and
a top-level dotted `role.<name> =` key's own line), else the `role =` or `[role]` line. A share's line is found the
same way in `[share]`.

Output. Exit 0 and one JSON line on stdout:

    {"source": "<the file's path>" | "built-in", "rungs": [{"name", "model", "effort", "judge", "review"[, "plan"]}, ...]
     [, "roles": {"<role>": "<model>", ...}][, "share": {"<role>": <number>, ...}]}

`source` is the expanded path (HOME honoured, symlinks not resolved). The rungs come bottom first, each
with its keys in that order. A rung carries `plan` only when the file names it, the ladder carries `roles`
(in ROLES order) only when the file names at least one, and `share` (in SHARE_ROLES order, each value as written)
only when the file names at least one, so no file, and a file with none of them, print the same bytes as before
ADR 0079. Exit 2 when the file is refused (or on a usage error), exit 3 when a present
file needs tomllib and this python has none. On failure stdout is empty and stderr carries one line,
`ladder: <path>:<line>: <reason>`, or `ladder: <path>: <reason>` when no line applies.

Importable: load(path=None), read_toml(path) (shared with rollout-settings.py), BUILT_IN, MODELS, EFFORTS,
FIELDS, OPTIONAL_FIELDS, ROLES, SHARE_ROLES, LadderError.

Across versions. Each running rollout runs this file from its own Engine snapshot (engine-snapshot.md), and step 2
there refuses every top-level key, and step 4 every rung key, its version did not know: a snapshot cut before ADR
0079 refuses `plan` and `[role]`, and one cut before p46-2 refuses `[share]`. A rollout on such a snapshot halts at
its next call with "ladder refused". So a file that uses a newer key is written only once every live rollout's engine
root reads it: for each, `HOME=<tmp> python3 <its root>/skills/_shared/scripts/ladder.py` with the candidate file at
`<tmp>/.config/thread/ladder.toml` exits 0 (task p46-7 writes the operator's file by this rule).
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
# A rung's optional keys, each a model alias: `plan`, the plan model (ADR 0079 decision 1).
OPTIONAL_FIELDS = ("plan",)
EFFORT_FIELDS = ("effort", "judge", "review")
# The roles a `[role]` table may give their own model (ADR 0079 decision 3, the engine's names). Must equal the
# engine's LADDER_ROLES; tests/ladder.test.mjs pins it. A rollout's lead is no dispatch the engine makes, so it
# takes no own model here; it joins only the draw (SHARE_ROLES).
ROLES = ("master-review", "builder", "investigator")
# The roles a `[share]` table may give a Fable share (ADR 0079 decision 3): the drawn roles. Must equal the engine's
# LADDER_SHARE_ROLES and reconcile-rollout.py's draw; tests/ladder.test.mjs pins it. Never the planner or the plan judge.
SHARE_ROLES = ROLES + ("lead",)
# The optional one-per-file tables beside [[rung]]: each key's line is kept for its errors.
_SUB_TABLES = ("role", "share")

BUILT_IN = (
    {"name": "opus-high", "model": "opus", "effort": "high", "judge": "high", "review": "xhigh"},
    {"name": "opus-xhigh", "model": "opus", "effort": "xhigh", "judge": "high", "review": "xhigh"},
)

# A rung name is later written raw into YAML frontmatter (`rung: <name>`), so it stays a plain lowercase
# token that YAML reads back as the same string. The engine (LADDER_NAME, LADDER_YAML_WORDS) and
# reconcile-rollout.py (is_rung_name) apply the same rule; tests/ladder.test.mjs L9 pins that they agree.
NAME_RE = re.compile(r"[a-z][a-z0-9._-]*\Z")
YAML_WORDS = frozenset(("true", "false", "yes", "no", "on", "off", "y", "n", "null"))

# One TOML key segment: bare, "basic" or 'literal'.
_SEG = r'(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|\'[^\']*\')'
_AOT_RE = re.compile(r"\[\[\s*(" + _SEG + r")\s*(\.[^\]]*)?\]\]\s*(?:#.*)?\Z")
_TABLE_RE = re.compile(r"\[\s*(" + _SEG + r")\s*(\.[^\]]*)?\]\s*(?:#.*)?\Z")
_DOTTED_RE = re.compile(r"\.\s*(" + _SEG + r")")
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
    sub_keys: per optional table (_SUB_TABLES: role, share), each key's first line in the [<table>] table, each
    [<table>.<name>] header's line under <name>, and each top-level dotted `<table>.<name> =` key's line under <name>
    (the table written as dotted keys). role_keys is sub_keys["role"].

    Only a line that starts outside every value is read as a header or a key. The rest of each line is
    scanned as TOML values: strings and comments are skipped, so a quote or bracket inside one counts for
    nothing, and the multi-line strings and arrays left open at a line's end carry over to the next line.
    """

    def __init__(self, text):
        self.top = {}
        self.headers = []
        self.keys = []
        self.inline = []
        self.sub_keys = {name: {} for name in _SUB_TABLES}
        self.role_keys = self.sub_keys["role"]
        self._table = None  # index into headers inside a [[rung]]; "role" or "share" inside that table; "other" else
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
                name = _unquote(m.group(1))
                self.top.setdefault(name, n)
                self._table = "other"
                if name in _SUB_TABLES and m.group(2) is None:
                    self._table = name
                elif name in _SUB_TABLES:
                    d = _DOTTED_RE.match(m.group(2))
                    if d:
                        self.sub_keys[name].setdefault(_unquote(d.group(1)), n)
                return
            m = _KEY_RE.match(s)
            if m:
                key = _unquote(m.group(1))
                if self._table is None:
                    self.top.setdefault(key, n)
                    opens_rung = key == "rung" and m.group(2) == "="
                    if key in _SUB_TABLES and m.group(2) == ".":
                        d = _DOTTED_RE.match(s, m.end() - 1)
                        if d:
                            self.sub_keys[key].setdefault(_unquote(d.group(1)), n)
                elif self._table in _SUB_TABLES:
                    self.sub_keys[self._table].setdefault(key, n)
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
    if isinstance(value, str):
        return "a string"
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
        if key not in ("rung",) + _SUB_TABLES:
            raise LadderError("unknown top-level key %s (a ladder file holds only [[rung]] tables, one [role] table and "
                              "one [share] table)" % json.dumps(key), line=idx.top.get(key))
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
            if key not in FIELDS and key not in OPTIONAL_FIELDS:
                raise LadderError("%s: unknown key %s (a rung has %s, and optionally %s)"
                                  % (label, json.dumps(key), ", ".join(FIELDS), ", ".join(OPTIONAL_FIELDS)),
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
        for key in OPTIONAL_FIELDS:
            if key not in rung:
                continue
            value = rung[key]
            if not isinstance(value, str):
                errors.append((line_of(key), "%s: %s must be a string, not %s" % (label, key, _type_name(value))))
            elif value not in MODELS:
                errors.append((line_of(key), "%s: unknown %s model %s: a model is a tier alias, never a version "
                               "(known: %s)" % (label, key, json.dumps(value), ", ".join(MODELS))))
        if errors:
            line, reason = min(errors, key=lambda e: e[0] if e[0] is not None else float("inf"))
            raise LadderError(reason, line=line)
        seen[name] = (number, line_of("name") if aligned else None)
        out.append({key: rung[key] for key in FIELDS + OPTIONAL_FIELDS if key in rung})
    roles = _validate_roles(doc.get("role"), idx)
    return out, roles, _validate_share(doc.get("share"), roles, idx)


def _validate_roles(roles, idx):
    """The [role] table (validation step 5) as {role: model} in ROLES order, or None when the file names no role."""
    if roles is None:
        return None
    table_line = idx.top.get("role")
    if not isinstance(roles, dict):
        if isinstance(roles, list) and roles and all(isinstance(r, dict) for r in roles):
            raise LadderError("role must be a table: write [role], not [[role]]", line=table_line)
        raise LadderError("role must be a table ([role]), not %s" % _type_name(roles), line=table_line)

    def line_of(key):
        return idx.role_keys.get(key) or table_line

    for key in roles:
        if key not in ROLES:
            raise LadderError("unknown role %s (known: %s)" % (json.dumps(key), ", ".join(ROLES)), line=line_of(key))
    errors = []
    for key, value in roles.items():
        if not isinstance(value, str):
            errors.append((line_of(key), "role %s must be a string, not %s" % (key, _type_name(value))))
        elif value not in MODELS:
            errors.append((line_of(key), "role %s: unknown model %s: a model is a tier alias, never a version "
                           "(known: %s)" % (key, json.dumps(value), ", ".join(MODELS))))
    if errors:
        line, reason = min(errors, key=lambda e: e[0] if e[0] is not None else float("inf"))
        raise LadderError(reason, line=line)
    return {key: roles[key] for key in ROLES if key in roles} or None


def _validate_share(share, roles, idx):
    """The [share] table (validation step 6) as {role: share} in SHARE_ROLES order, or None when the file names none.

    roles: the validated [role] table (None when the file names none): a role named there is refused here.
    """
    if share is None:
        return None
    table_line = idx.top.get("share")
    if not isinstance(share, dict):
        if isinstance(share, list) and share and all(isinstance(r, dict) for r in share):
            raise LadderError("share must be a table: write [share], not [[share]]", line=table_line)
        raise LadderError("share must be a table ([share]), not %s" % _type_name(share), line=table_line)

    def line_of(key):
        return idx.sub_keys["share"].get(key) or table_line

    for key in share:
        if key in ("planner", "plan-judge"):
            raise LadderError("share %s: planning is never drawn, it takes the rung's plan model (known: %s)"
                              % (json.dumps(key), ", ".join(SHARE_ROLES)), line=line_of(key))
        if key not in SHARE_ROLES:
            raise LadderError("unknown share role %s (known: %s)" % (json.dumps(key), ", ".join(SHARE_ROLES)),
                              line=line_of(key))
    errors = []
    for key, value in share.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            errors.append((line_of(key), "share %s must be a number in [0, 1], not %s" % (key, _type_name(value))))
        elif not 0 <= value <= 1:
            errors.append((line_of(key), "share %s: %s is outside [0, 1]" % (key, value)))
        elif roles and key in roles:
            errors.append((line_of(key), "share %s: [role] gives it its own model (%s), so it is never drawn"
                           % (key, roles[key])))
    if errors:
        line, reason = min(errors, key=lambda e: e[0] if e[0] is not None else float("inf"))
        raise LadderError(reason, line=line)
    return {key: share[key] for key in SHARE_ROLES if key in share} or None


def load(path=None):
    """The resolved ladder: {"source": <path> | "built-in", "rungs": [rung, ...][, "roles": {...}][, "share": {...}]},
    bottom first.

    Raises LadderError (with .line and .code) when a present file cannot be read or does not validate.
    """
    path = default_path() if path is None else path
    read = read_toml(path)
    if read is None:
        return {"source": "built-in", "rungs": [dict(r) for r in BUILT_IN]}
    text, doc = read
    rungs, roles, share = _validate(text, doc)
    ladder = {"source": path, "rungs": rungs}
    if roles:
        ladder["roles"] = roles
    if share:
        ladder["share"] = share
    return ladder


def read_toml(path):
    """Read one operator TOML file: None when nothing is at the path, else (text, doc).

    Shared with rollout-settings.py (rollouts.toml), so both files are read by the same rules: "nothing at
    the path" is a missing file, a missing directory on the way, or a plain file as a step on the way. A
    dangling symlink at the path or on the way, a path that cannot be checked (an unsearchable directory),
    bytes that are not UTF-8 and a TOML syntax error raise LadderError, with the line where one applies;
    a present file on a python without tomllib raises it with code 3.
    """
    try:
        # lstat, not os.path.lexists: lexists reads every error as "nothing there", so a file in a directory
        # that cannot be searched would read as no file.
        st = os.lstat(path)
    except (FileNotFoundError, NotADirectoryError):
        _refuse_dangling_parent(path)
        return None
    except OSError as e:
        raise LadderError("cannot read it: %s" % (e.strerror or e))
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        if isinstance(e, FileNotFoundError) and stat.S_ISLNK(st.st_mode):
            raise LadderError("cannot read it: a symlink to a missing file (%s)" % _target(path))
        raise LadderError("cannot read it: %s" % (e.strerror or e))
    return _parse(data)


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
