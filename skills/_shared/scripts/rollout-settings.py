#!/usr/bin/env python3
"""rollout-settings.py — resolve the operator's rollout settings (p15-4; ADR 0032, a Tuning's home).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py [--repo <dir>]

The file is `~/.config/thread/rollouts.toml`, a sibling of ADR 0029's `ladder.toml` (HOME is honoured; there
is no env override). Stdlib only. It writes nothing and makes no network call. This header is the one copy
of the file format:

    # ~/.config/thread/rollouts.toml
    [defaults]                   # every rollout on this machine
    parallel_ceiling = 4
    max_review_rounds = 4
    max_iterations = 3
    max_plan_rounds = 3

    [guardrails]                 # the Retro's bounds, machine-wide only
    tokens_per_merge_pct = 25    # tokens per merge may rise at most +25%
    set_aside_rate_points = 5    # set-aside rate may rise at most +5 points
    conflict_rate_points = 10    # conflict rate may rise at most +10 points
    quota_stalls = 0             # more than this many quota stalls breaches (0 = any stall)

    [repo."lachyts/thread-skill"] # one repo, keyed by its GitHub origin's owner/name
    parallel_ceiling = 5

The only top-level keys are `defaults`, `guardrails` and `repo`. A repo table holds only the four rollout
keys. Dotted keys (`repo."o/r".parallel_ceiling = 5`) and inline tables are read the same as table form.

Repo keys. A repo key must be quoted (`[repo."owner/name"]`) and is an `owner/name` by land.sh's slug rule
(`[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+`, a name that is not all dots), never ending `.git`. It is
matched, ignoring case, against `land.sh --origin-slug <--repo>`: the clone's local `git remote get-url
origin` (no network) in any of the three GitHub URL forms, with a trailing `/` and `.git` stripped. So a
self-rollout's separate clone resolves the same as its primary checkout. Two repo keys equal ignoring case
are refused as a duplicate. land.sh is run only when the file holds at least one repo table and `--repo`
was given, under ORIGIN_TIMEOUT seconds, in its own process group (killed whole on expiry).

Precedence for each rollout key (the callers apply the first two): task frontmatter → rollout frontmatter →
`[repo."<slug>"]` (source `file:repo`) → `[defaults]` (`file:defaults`) → `built-in`. Guardrail sources are
`file:guardrails` or `built-in`. Built-ins: parallel_ceiling 4, max_review_rounds 4, max_iterations 3,
max_plan_rounds 3; guardrails 25 / 5 / 10 / 0.

Validation (ADR 0016: anything unknown or wrong is refused, never dropped):
- an unknown top-level key or table key, `defaults` or `guardrails` that is not a table, a `repo` that is
  not a table, a value under `repo` that is not a table (named by its key: `[repo."o/r"] must be a table`);
- a rollout value that is not an integer >= 1 (a boolean, float, string or 0 is refused);
- a guardrail that is not a non-negative integer or float (a boolean is refused; `quota_stalls` is an
  integer >= 0);
- a bad or case-duplicate repo key.
No file (nothing at the path, a missing directory on the way, a plain file as a step on the way) gives the
built-ins, and so does an empty or comment-only file. The file is read by ladder.py's read_toml(), so a
dangling symlink, an unsearchable directory, bytes that are not UTF-8 and a TOML syntax error are refused as
ladder.toml's are.

Order of checks: `--repo` (with `~` expanded) is a directory; the file reads and validates; only then, when a
repo table exists and `--repo` was given, land.sh reads the origin; then the values resolve.

Output. Exit 0 and one JSON line on stdout:

    {"path": "<expanded path>", "file": true|false, "repo": "<owner/name>"|null,
     "settings": {"parallel_ceiling": {"value": 4, "source": "built-in"}, "max_review_rounds": {...},
                  "max_iterations": {...}, "max_plan_rounds": {...}},
     "guardrails": {"tokens_per_merge_pct": {"value": 25, "source": "built-in"}, ...}}

`repo` is the origin's owner/name as land.sh printed it (case kept), or null when no repo table could apply:
no `--repo`, no file, no repo table, or no GitHub origin (no repo, no origin, another host: land.sh exit 4).

Exit 2 when the file is refused, `--repo` is not a directory, the origin cannot be read (land.sh will not
start, exits other than 0 or 4, or times out), or on a usage error. Exit 3 when a present file needs tomllib
and this python has none. On failure stdout is empty and stderr carries one line:
`rollout-settings: <path>:<line>: <reason>`, `rollout-settings: <path>: <reason>` when no line applies, or
`rollout-settings: --repo <p>: <reason>`.

Importable: resolve(repo=None, path=None), BUILT_IN, GUARDRAILS_BUILT_IN, KEYS, GUARDRAIL_KEYS,
ORIGIN_TIMEOUT, default_path(), SettingsError(reason, line=None, code=2, subject=None).
"""
import argparse
import importlib.util
import json
import math
import os
import re
import signal
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAND_SH = os.path.join(HERE, "land.sh")

KEYS = ("parallel_ceiling", "max_review_rounds", "max_iterations", "max_plan_rounds")
BUILT_IN = {"parallel_ceiling": 4, "max_review_rounds": 4, "max_iterations": 3, "max_plan_rounds": 3}
GUARDRAIL_KEYS = ("tokens_per_merge_pct", "set_aside_rate_points", "conflict_rate_points", "quota_stalls")
GUARDRAILS_BUILT_IN = {"tokens_per_merge_pct": 25, "set_aside_rate_points": 5, "conflict_rate_points": 10,
                       "quota_stalls": 0}
TABLES = ("defaults", "guardrails", "repo")
ORIGIN_TIMEOUT = 20  # seconds for land.sh --origin-slug (one local git call); the whole group dies on expiry

# land.sh's origin_slug rule, so a key can only ever equal a slug land.sh prints.
SLUG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+\Z")

# One TOML key segment (bare, "basic" or 'literal'), as ladder.py's _SEG; a dotted key is segments joined by `.`.
_SEG = r'(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|\'[^\']*\')'
_DOTTED = _SEG + r"(?:\s*\.\s*" + _SEG + r")*"
_SEG_RE = re.compile(_SEG)
_AOT_RE = re.compile(r"\[\[\s*(" + _DOTTED + r")\s*\]\]\s*(?:#.*)?\Z")
_TABLE_RE = re.compile(r"\[\s*(" + _DOTTED + r")\s*\]\s*(?:#.*)?\Z")
_KEY_RE = re.compile(r"(" + _DOTTED + r")\s*=")


def default_path():
    return os.path.expanduser("~/.config/thread/rollouts.toml")


class SettingsError(Exception):
    """A refusal: str() is `<subject>[:<line>]: <reason>`; the CLI prefixes `rollout-settings: `."""

    def __init__(self, reason, line=None, code=2, subject=None):
        Exception.__init__(self, reason)
        self.reason = reason
        self.line = line
        self.code = code
        self.subject = subject

    def __str__(self):
        where = self.subject or ""
        if self.line is not None:
            where = "%s:%d" % (where, self.line)
        return "%s: %s" % (where, self.reason) if where else self.reason


def _ladder():
    spec = importlib.util.spec_from_file_location("thread_ladder", os.path.join(HERE, "ladder.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _unquote(seg):
    if seg[:1] == '"':
        try:
            return json.loads(seg)
        except ValueError:
            return seg[1:-1]
    if seg[:1] == "'":
        return seg[1:-1]
    return seg


def _segments(dotted):
    return tuple(_unquote(m.group(0)) for m in _SEG_RE.finditer(dotted))


class _Lines:
    """Where each key sits in the file, by a line scan (tomllib reports no positions for semantic errors).

    The twin of ladder.py's _Index, generalised to nested paths: `lines` maps a key path (a tuple, e.g.
    ("repo", "o/r", "parallel_ceiling")) to the first line it appears on. A `[a."b"]` or `[[a."b"]]` header
    records its path and each prefix; a key records its path relative to the current table, each dotted
    prefix included. Keys inside an inline table are not scanned: they fall back to the line of the key
    their `{` opens on (line_of's nearest recorded prefix). Only a line that starts outside every value is
    read as a header or a key; the rest of each line is scanned as TOML values, as _Index scans it, so
    strings and comments count for nothing and multi-line strings and arrays carry over to the next line.

    Why a copy and not a share (unlike read_toml): _Index's value scan carries the ladder's own hooks inside
    its loop (the `rung = [` array and each inline rung's `{` line, which its refusals cite), and its records
    are flat (top-level names, per-[[rung]] keys) where this one is path-keyed. Sharing it would mean
    re-cutting the ladder's line attribution, which tests/ladder.test.mjs pins line by line, to serve a second
    file. The copied part is only the string/comment/bracket skip (_scan, _close_multiline); a fix to one of
    them belongs in both, and tests/rollout-settings.test.mjs pins this copy's lines on its own.
    """

    def __init__(self, text):
        self.lines = {}
        self._table = ()
        self._string = None
        self._brackets = []
        for n, line in enumerate(text.split("\n"), 1):
            self._line(n, line.strip())

    def _record(self, path, n):
        for i in range(1, len(path) + 1):
            self.lines.setdefault(path[:i], n)

    def line_of(self, path):
        """The path's own line, else its nearest recorded prefix's, else None."""
        for i in range(len(path), 0, -1):
            if path[:i] in self.lines:
                return self.lines[path[:i]]
        return None

    def _line(self, n, s):
        if self._string is None and not self._brackets:
            if not s or s.startswith("#"):
                return
            m = _AOT_RE.match(s) or _TABLE_RE.match(s)
            if m:
                self._table = _segments(m.group(1))
                self._record(self._table, n)
                return
            m = _KEY_RE.match(s)
            if m:
                self._record(self._table + _segments(m.group(1)), n)
                s = s[m.end():]
        self._scan(s)

    def _scan(self, s):
        i = 0
        while i < len(s):
            if self._string:
                i = self._close_multiline(s, i)
                continue
            c = s[i]
            if c == "#":
                return
            if s.startswith('"""', i) or s.startswith("'''", i):
                self._string = s[i:i + 3]
                i += 3
                continue
            if c == '"':
                i += 1
                while i < len(s) and s[i] != '"':
                    i += 2 if s[i] == "\\" else 1
                i += 1
                continue
            if c == "'":
                end = s.find("'", i + 1)
                i = len(s) if end < 0 else end + 1
                continue
            if c in "[{":
                self._brackets.append(c)
            elif c in "]}" and self._brackets:
                self._brackets.pop()
            i += 1

    def _close_multiline(self, s, i):
        quote = self._string[0]
        while i < len(s):
            if quote == '"' and s[i] == "\\":
                i += 2
            elif s.startswith(self._string, i):
                while i < len(s) and s[i] == quote:
                    i += 1
                self._string = None
                return i
            else:
                i += 1
        return len(s)


def _describe(value):
    if isinstance(value, bool):
        return "a boolean (%s)" % ("true" if value else "false")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return "a float (%r)" % value
    if isinstance(value, str):
        return "a string (%s)" % json.dumps(value)
    if isinstance(value, list):
        return "an array"
    if isinstance(value, dict):
        return "a table"
    return "a date or time"


def _validate(text, doc, path):
    """{"defaults": {...}, "guardrails": {...}, "repo": {slug: {...}}} from a parsed file, or SettingsError."""
    idx = _Lines(text)

    def refuse(reason, at):
        raise SettingsError(reason, line=idx.line_of(at), subject=path)

    for key in doc:
        if key not in TABLES:
            refuse("unknown top-level key %s (rollouts.toml holds only [defaults], [guardrails] and "
                   "[repo.\"owner/name\"] tables)" % json.dumps(key), (key,))

    def rollout_table(table, label, at):
        for key, value in table.items():
            if key not in KEYS:
                refuse("%s: unknown key %s (a rollout table holds %s)" % (label, json.dumps(key), ", ".join(KEYS)),
                       at + (key,))
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                refuse("%s %s must be an integer >= 1, got %s" % (label, key, _describe(value)), at + (key,))
        return dict(table)

    out = {"defaults": {}, "guardrails": {}, "repo": {}}
    defaults = doc.get("defaults", {})
    if not isinstance(defaults, dict):
        refuse("defaults must be a table ([defaults]), got %s" % _describe(defaults), ("defaults",))
    out["defaults"] = rollout_table(defaults, "[defaults]", ("defaults",))

    guardrails = doc.get("guardrails", {})
    if not isinstance(guardrails, dict):
        refuse("guardrails must be a table ([guardrails]), got %s" % _describe(guardrails), ("guardrails",))
    for key, value in guardrails.items():
        at = ("guardrails", key)
        if key not in GUARDRAIL_KEYS:
            refuse("[guardrails]: unknown key %s (guardrails are %s)" % (json.dumps(key), ", ".join(GUARDRAIL_KEYS)), at)
        if key == "quota_stalls":
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                refuse("[guardrails] quota_stalls must be an integer >= 0, got %s" % _describe(value), at)
        elif (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0
              or (isinstance(value, float) and not math.isfinite(value))):
            refuse("[guardrails] %s must be a non-negative number, got %s" % (key, _describe(value)), at)
    out["guardrails"] = dict(guardrails)

    repos = doc.get("repo", {})
    if not isinstance(repos, dict):
        refuse("repo must be a table of tables ([repo.\"owner/name\"]), got %s" % _describe(repos), ("repo",))
    seen = {}  # lowered slug -> the key as written
    for slug, table in repos.items():
        at = ("repo", slug)
        label = "[repo.%s]" % json.dumps(slug)
        if not isinstance(table, dict):  # `repo."o/r" = 5`, or a rollout key written straight under `[repo]`
            refuse("%s must be a table, got %s (a repo's keys go under [repo.\"owner/name\"])"
                   % (label, _describe(table)), at)
        if slug.lower().endswith(".git"):
            refuse("%s: a repo key never ends .git (write the origin's owner/name)" % label, at)
        if not SLUG_RE.match(slug) or not slug.split("/", 1)[1].strip("."):
            refuse("%s: a repo key is a GitHub owner/name ([A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+, "
                   "a name that is not all dots)" % label, at)
        first = seen.get(slug.lower())
        if first is not None:
            first_line = idx.line_of(("repo", first))
            where = ", first at line %d" % first_line if first_line is not None else ""
            refuse("duplicate repo %s (same as %s%s, ignoring case)" % (json.dumps(slug), json.dumps(first), where), at)
        seen[slug.lower()] = slug
        out["repo"][slug.lower()] = rollout_table(table, label, at)
    return out


def _git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as unfinished-rollout.py's git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=ORIGIN_TIMEOUT).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []  # land.sh scrubs them again itself
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def _origin_slug(repo):
    """land.sh --origin-slug <repo>: the owner/name, or None when the directory has no GitHub origin (exit 4)."""
    subject = "--repo %s" % repo
    try:
        p = subprocess.Popen(["bash", LAND_SH, "--origin-slug", repo], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_git_env(),
                             start_new_session=True, text=True)
    except OSError as e:
        raise SettingsError("cannot read its origin (land.sh will not start: %s)" % (e.strerror or e), subject=subject)
    try:
        out, _err = p.communicate(timeout=ORIGIN_TIMEOUT)
    except subprocess.TimeoutExpired:
        # Kill the whole group before draining: a grandchild git holding the pipe would hang communicate().
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        for f in (p.stdout, p.stderr):
            try:
                f.close()
            except OSError:
                pass
        p.wait()
        raise SettingsError("reading its origin timed out after %ss" % ORIGIN_TIMEOUT, subject=subject)
    if p.returncode == 4:
        return None
    slug = out.strip()
    if p.returncode != 0 or not slug:
        raise SettingsError("cannot read its origin (land.sh exit %d)" % p.returncode, subject=subject)
    return slug


def resolve(repo=None, path=None):
    """The resolved settings (the CLI's JSON object). Raises SettingsError (with .line, .code, .subject)."""
    if repo is not None:
        repo = os.path.expanduser(repo)
        if not os.path.isdir(repo):
            raise SettingsError("not a directory", subject="--repo %s" % repo)
    path = default_path() if path is None else path
    ladder = _ladder()
    try:
        read = ladder.read_toml(path)
    except ladder.LadderError as e:
        raise SettingsError(e.reason, line=e.line, code=e.code, subject=path)
    tables = _validate(read[0], read[1], path) if read is not None else {"defaults": {}, "guardrails": {}, "repo": {}}

    slug, overrides = None, {}
    if repo is not None and tables["repo"]:
        slug = _origin_slug(repo)
        if slug is not None:
            overrides = tables["repo"].get(slug.lower(), {})

    settings = {}
    for key in KEYS:
        if key in overrides:
            settings[key] = {"value": overrides[key], "source": "file:repo"}
        elif key in tables["defaults"]:
            settings[key] = {"value": tables["defaults"][key], "source": "file:defaults"}
        else:
            settings[key] = {"value": BUILT_IN[key], "source": "built-in"}
    guardrails = {}
    for key in GUARDRAIL_KEYS:
        if key in tables["guardrails"]:
            guardrails[key] = {"value": tables["guardrails"][key], "source": "file:guardrails"}
        else:
            guardrails[key] = {"value": GUARDRAILS_BUILT_IN[key], "source": "built-in"}
    return {"path": path, "file": read is not None, "repo": slug, "settings": settings, "guardrails": guardrails}


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        sys.stderr.write("rollout-settings: %s\n" % message)
        sys.exit(2)


def main(argv):
    parser = _Parser(prog="rollout-settings",
                     description="Print the operator's rollout settings (%s) as JSON." % default_path())
    parser.add_argument("--repo", help="a directory in the clone whose GitHub origin picks a [repo.\"owner/name\"] table")
    args = parser.parse_args(argv)
    try:
        out = resolve(repo=args.repo)
    except SettingsError as e:
        sys.stderr.write("rollout-settings: %s\n" % e)
        return e.code
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
