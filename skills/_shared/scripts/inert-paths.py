#!/usr/bin/env python3
"""inert-paths.py — a move in Inert paths re-runs nothing (ADR 0045, p29-3): the path test, the Inert proof, and
schedule's propose, record and drop.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/inert-paths.py prove --repo R [--tree REV] --glob G...
        [--verifier CMD] [--bootstrap CMD] [--place DIR]...
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/inert-paths.py propose --repo R [--tree REV] --verifier CMD
        [--bootstrap CMD] [--candidate G]...
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/inert-paths.py record --repo R --glob G... --verifier CMD
        [--bootstrap CMD] [--tree REV] [--config P] [--tasks-dir D] [--force] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/inert-paths.py drop --repo R --glob G... [--config P] [--dry-run]

Stdlib only, python >= 3.8. It loads engine-snapshot.py (git_env(), real(), engine_root()), rollout-settings.py and
run_record.py from its own directory by path (importlib). This header is the one copy of every rule below; CONTEXT.md's
**Inert path** and **Inert proof** and ADR 0045's amendment point here.

Git. One _git() runs every git call (`diff`, `ls-tree -r -z`, `cat-file --batch` through Popen with piped stdin,
`worktree list --porcelain` and `rev-parse`), each with env=engine-snapshot.py's git_env(): the repo-local GIT_* names
removed (the GIT_CONFIG_* channels kept), GIT_TERMINAL_PROMPT=0 (the 2026-09-23 leak rule). A non-zero exit, a timeout
or a short read raises ProofError. Library functions never print or exit; only the CLI does (exit 2 on ProofError).

The path test. changed(repo, base, head) is `git diff --no-renames base head`'s paths, so a file moved into an
inert path still counts at the path it left. path_test(repo, base, head, globs) returns {changed, inert, nonInert,
matched, globs}: `matched` is what git itself matches with `':(glob)G'` for any glob G, `globs` the globs that matched a
changed path (every glob, when this script's own matcher cannot name the glob for a matched path). A path is inert only
when a glob matches it AND it has a prose extension (PROSE_EXT: .md .markdown .txt .rst .adoc .org) AND it is a regular
file on both sides (a symlink or a gitlink is never inert). One non-inert path means a re-run.

The Inert proof. prove(repo, tree, globs, steps, places=None) proves each glob on the tree `tree` (prepare passes the
merge commit M, the exact tree being merged) and returns {glob: {held, readers, readersTotal}}, each reader
{glob, path, line?, kind, origin?, text (at most 120 characters)}. One call builds one tree index (one `ls-tree`, one
`cat-file --batch`, one parse per blob) and shares it across every glob it proves; nothing is cached across calls. It
fails closed: anything it cannot read reads as a reader. A glob holds only when there is none of:
- Scope. Every tracked blob of the tree that is not prose (the glob's own files included: no own-files exclusion) is
  scanned, plus the verifier and bootstrap texts as steps (`<verifier>`, `<bootstrap>`), which run at the tree root. A
  blob holding a NUL byte is binary: the name rule reads it, nothing else does (it has no lines of code).
- unprovable: a glob with no literal segment (`**`, `*.md`) is never proved; past PROOF_BUDGET_S (60 s, a deadline
  check, no signals) every glob fails as unprovable with "proof budget exceeded".
- submodule: a gitlink anywhere in the tree fails every glob (its contents cannot be read).
- symlink: a tracked symlink whose target resolves into the glob (a link to a matching file, to a directory at or
  above the glob's literal directory, or below a directory glob's; a target outside the repo is compared with the
  places, as below).
- name: a scanned file or step that names the glob's tokens. The tokens are the glob's deepest literal segment (its
  last `/`-segment with no `*?[`), plus the basename of a literal-file glob: THREAD.md for THREAD.md, `handoffs` for
  docs/handoffs/**. Case-insensitive; only [A-Za-z0-9] are word characters, so `_ - . /` and quotes are boundaries; every
  line counts, comments and docstrings included. So `ROOT / 'docs' / 'handoffs' / n`, `path.join('docs','handoffs',f)`
  and `HANDOFFS_DIR` all hit. An intermediate segment (`docs` alone) is no name: a walk over it is the walk rule's.
- tool (every glob): a markdown tool named in a scanned file or step, word-bounded and case-sensitive (TOOLS: prettier,
  markdownlint (and -cli, -cli2), remark-cli, remark-lint*, cspell, mdformat, markdown-link-check, lychee, linkinator,
  textlint, pymarkdown, proselint, codespell, mkdocs, sphinx-build, doctoc; `remark` and `vale` only in command form,
  `npx remark …`, a `vale` command with an argument); or any tracked tool config (TOOL_CONFIG_RE: .prettierrc*,
  prettier.config.*, .markdownlint*, .vale.ini, .remarkrc*, cspell.json, .cspell*, .mdformat.toml, lychee.toml,
  .lycheeignore). A lock file counts: one named tool anywhere fails every glob.
- link (every glob): a literal `](` in a scanned file or step (code that parses markdown links).
- walk: a walk site whose root is not provably outside the repo and that covers the glob (below).

Walk sites. The API forms are matched in their language's code (by extension, or a shebang):
- Python (ast): os.walk, os.fwalk, os.listdir, os.scandir, glob.glob, glob.iglob, shutil.copytree; the methods
  .rglob, .glob, .iterdir and .walk on any receiver that is not an imported module (so ast.walk is none).
- JS/TS: fs.readdir*, fs.opendir* (Sync and promise forms), fs.globSync and fs.glob, glob/globSync, globby, fast-glob,
  and cpSync/cp with `recursive`, on any receiver.
- Swift: FileManager's contentsOfDirectory, enumerator, subpathsOfDirectory and subpaths.
The shell forms are matched on every non-comment line of every scanned file and step, strings included (a code
file's string literals, a config file's lines and strings, a shell file's lines): find, ls, `grep -r` (any recursive
form) and rg, `git ls-files`/`ls-tree`/`grep`, `for x in <glob>`, and a `**` glob (`**/` at a word's start, `/**` after
a path character, or a bare `**` word). An argv list is read de-quoted, so `['git', 'ls-files']` reads `git ls-files`;
a host expression in it (`['find', root]`) is resolved as code. A git listing with no pathspec is a whole-tree (cwd)
walk; with an exclude pathspec, or no `--` before a git grep's paths, it is whole-tree too. A line holding only a
comment is skipped.

The resolver. A walk's root resolves to a set of origins.
- A Python file that `ast.parse`s is resolved with scopes: function locals, enclosing functions, module globals,
  imports of tracked files (`from m import X`, `import m`, relative imports), and `self.x`/`cls.x`, meaning every
  `self.x =` (and class-level `x =`) in its class, its scanned bases (by name) and their scanned subclasses; a method
  is the first found along the bases. Any other file, and a Python file that fails to parse, uses the
  line resolver: a name resolves to the union of every same-file binding (`x =`, `const|let|var x =`, `this.x =`,
  `for (… x of E)`, shell `x=`) and every same-file parameter of that name, plus its import (`import {X} from './m'`,
  `require('./m').X`, `import X from …`); a union only adds origins. Bindings followed: assignment, `with E as x`,
  `for x in E`, walrus, a same-file (or imported) function's return or yield, and a class's constructor (an instance's
  attribute is its class's `self.x`).
- Memoised per (file, node, scope), with depth 8 (DEPTH) and a visited set: a cycle edge adds nothing, a result that
  cut a cycle is not memoised, and running out of depth reads `depth`.
- Parameter binding. A parameter's origins are its arguments at every call site of its function: every call of the
  function's name in every scanned file and step. `ClassName(...)`, `new ClassName(...)` and `super().__init__(...)`
  are call sites of `__init__`/`constructor`. An assignment target, a definition or a string naming the function is
  not a reference. Alignment per def: a Python method (a def in a class body, not @staticmethod) skips its first
  parameter for an attribute call (`self.f`, `cls.f`, `obj.f`, `super().f`) and for a constructor call, but not for
  `ClassName.f(...)` when ClassName is a class defined in a scanned file (an unbound call); a @classmethod always skips;
  module-level functions, @staticmethods, name-bound lambdas and every JS function align from their first parameter,
  `m.f(x)` included. Positionals fill in order and keywords by name. An omitted argument adds the parameter's
  default's origins (Python `p=X`, JS `p = X`); an omitted argument with no default reads `open`. Unalignable calls
  read `open`: `*args`, `**kwargs` or `...spread`; more positionals than parameters with no `*args`; an unknown keyword;
  `f.call`, `f.apply`, `f.bind` or `functools.partial(f, …)`; a function referenced other than by a call (passed,
  stored, returned, exported or decorated). A parameter with no call site reads `open` (Swift parameters always do),
  except under the fixture rule. An empty origin set reads `open` (a None, null or undefined default only, or nothing
  found).
- Fixture names (narrowing iv): a parameter named tmp_path, tmpdir or tmp_path_factory reads TMP only when it has no
  call site and no scanned file defines a function of that name (a fixture override). With a call site it is chased;
  with an override it reads `open`.
- Origins:
  - TMP (a fresh directory, never a place): tempfile.mkdtemp, TemporaryDirectory (its `as` name and `.name`),
    mkstemp, NamedTemporaryFile; fs.mkdtempSync and fs.mkdtemp; shell `$(mktemp …)`; `.mktemp()`
    (tmp_path_factory.mktemp); the fixture names above. Climbing above it (`dirname`, `.parent(s)`, `..`) gives the
    system temp dir, which is a PATH value.
  - PATH values: an absolute literal; `~` (shell), HOME, `$HOME`, Path.home(), os.homedir(), or expanduser of a literal;
    `$TMPDIR`, os.tmpdir() or tempfile.gettempdir(); each followed only by literal segments. They are resolved with
    this process's HOME and temp dir (the lead's, which the verifier inherits), `..` folded, and compared, as written
    and as realpath, with every place: `--repo`, the task tree (prepare's tree, `--place`), and every path in `git
    worktree list --porcelain`, each as given and as realpath. Equal to, inside, or an ancestor of a place COUNTS with
    origin `path`: its sub-root is its path below the place, or "" when it is equal to or an ancestor of the place.
    Disjoint from every place: ELSEWHERE.
  - HOME-open (narrowing ii): expanduser(E) for each origin of E that is not a literal or a path (argv, env, an open
    or depth origin). E's literal prefix (the text before its first non-literal part, `~` expanded) is compared with
    the places: equal to or inside a place COUNTS (`path`); otherwise (an ancestor, disjoint or relative) that origin
    reads HOME-open and is not itself added. E's other origins map one by one (a literal `~/…` to its PATH, the rest
    unchanged). Climbing from HOME-open stays HOME-open.
  - COUNTS, with an `origin`: `repo` (`__file__`, `__dirname`, `__filename`, import.meta, `$0`, BASH_SOURCE, `$PWD`,
    `$(pwd)`, getcwd, cwd(), process.cwd(), Path.cwd(), show-toplevel); `cwd` (no root; `.`, `./…` or `..`; a
    relative literal, its segments the sub-root; a relative pattern starting `*`/`**`; a git listing; any walk in a
    step); `path` (as above); `input` (argv, `$1…`, env other than HOME/TMPDIR, parse_args); `open` (an unbound name,
    an unresolvable call, the parameter rules above); `depth` (the resolver ran out of depth).
- Composition (os.path.join, Path(a, b), `/`, path.join/resolve, `+`, f-strings, template literals, `.format`, `%`,
  shell words): the first part's origin is the root and literal parts append to it (an absolute literal in a join
  resets it); every later non-literal part adds its own origins (it may be absolute or may climb) and makes the rest
  of the root unknown. abspath, realpath, normpath, resolve(), Path(), str(), fspath and fileURLToPath keep origins.
  Climbing above the repo root from repo or cwd reads as an ancestor of a place: origin `path`, sub-root "" (the
  whole tree). A glob character in an appended segment makes the rest unknown.
- A walk counts unless every origin is TMP, ELSEWHERE or HOME-open.

Coverage. Let S be a counting origin's sub-root and D the glob's literal directory (for THREAD.md, D = "" and the file
is THREAD.md). The walk covers the glob when S is a prefix of D (with the file, for a literal-file glob); for a
directory glob also when D is a prefix of S. An unknown segment covers everything under the known prefix. Listings
are treated as recursive. The walk's name filter (a pattern's last segment, find's -name/-iname/-path, rg -g/-t, grep
--include, a comprehension's `.endswith(...)`) must be absent or able to match the glob: for a literal-file glob it
must match its name; otherwise it must be able to match a prose name, so a filter that selects only a non-prose
extension (`*.py`, `.endswith(".tmp")`) does not cover.

Narrowings (each in ADR 0045's amendment, for Escape matching): (i) the call-site chase with the binding rules above;
(ii) HOME-open; (iii) static text: a name assembled at run time, or a walk reached only through eval, a registry or a
data-built subprocess, is missed; (iv) pytest fixture names as TMP. Nothing else is exempt.

CLI. JSON on stdout for prove and propose (one line), human lines for record and drop.
- prove: {repo, tree, globs: {G: {held, readers (at most 50), readersTotal}}}; exit 0 with the verdict in the JSON,
  2 on usage or ProofError (one `inert-paths: …` line on stderr).
- propose: the candidates (CANDIDATES: THREAD.md, docs/handoffs/**, docs/reviews/**, or each --candidate) and the
  repo's recorded globs proved on --tree (default HEAD): {repo, tree, recorded: [{glob, held, readers, streak}],
  proposed: [the candidates that held and are not recorded], refused: [{glob, readers}], drop: [...]}. The drop rule
  reads the Run record (run_record.py's events dir: every non-reserved <rollout>.jsonl): verify-skipped and
  inert-proof-failed lines for this repo (case ignored) in ts order; a glob's streak is its trailing run of failures
  (a failure: an inert-proof-failed line whose `failed`, else its readers, names the glob; a pass: any other line
  whose `globs` names it; a line with an `error` is neither). A recorded glob whose streak is DROP_AFTER (3) or more
  is in `drop`. Exit 2 on a refused settings file, no GitHub origin is `repo: null` and nothing proposed.
- record: re-proves every glob on --tree and refuses (exit 1, nothing written) any that fails. Then the edit on the
  config's realpath, line by line: in the origin's `[repo."owner/name"]` table (matched ignoring case) it replaces a
  one-line `inert_paths = [...]` (keeping a trailing comment), inserts one after the table's last key, or appends the
  table; a dotted, inline or multi-line form is refused (exit 2: edit it by hand). It raises the file's `schema` to 2
  through rollout-settings.py's raise_schema_lines(). The result goes to a temp file in the same directory and must
  resolve with exactly the intended list and every other table unchanged.
  The reader check, only when the edit raises the schema: every live rollout note (a `*.md` directly in --tasks-dir,
  default ~/repos/obsidian/Work/Tasks, with a `protocol_version:` line and a status neither done nor dropped) has its
  engine root read through engine-snapshot.py's engine_root(); for each distinct root, `python3 -I` loads that root's
  skills/_shared/scripts/rollout-settings.py and resolves the new file, under a 30 s timeout, with git_env(). A
  non-zero exit, a timeout or a missing script refuses: exit 1, nothing written, one stderr line per note
  (`inert-paths: [[<slug>]] runs on <root>, whose rollout-settings.py refuses the new file (<why>): update that
  checkout to a P29+ release, or wait for the rollout to finish, or re-run with --force`). --force writes anyway and
  prints the same lines as WARN. A missing tasks dir or an unusable snapshot is a WARN. There is no waiting. With the
  schema already 2, no check runs. --dry-run prints the diff and writes nothing.
- drop: the same edit removing globs (the line goes when the list empties); it raises no schema, so no reader check.

Importable (lead-integrate.py prepare loads this file lazily, inside its fail-closed try): ProofError, changed(),
path_test(), prove(), glob_match(), PROSE_EXT, CANDIDATES, PROOF_BUDGET_S, DROP_AFTER, ES, RS, RR.
"""
from __future__ import annotations

import argparse
import ast
import difflib
import fnmatch
import importlib.util
import json
import os
import posixpath
import re
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.realpath(__file__))


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ES = _load("thread_engine_snapshot", "engine-snapshot.py")
RS = _load("thread_rollout_settings", "rollout-settings.py")
RR = _load("thread_run_record", "run_record.py")

PROSE_EXT = (".md", ".markdown", ".rst", ".adoc", ".org")   # never .txt: pytest collects test*.txt, and a .txt is often data
CANDIDATES = ("THREAD.md", "docs/handoffs/**", "docs/reviews/**")
PROOF_BUDGET_S = 60
DROP_AFTER = 3
DEPTH = 8
GIT_TIMEOUT = 120
CHECK_TIMEOUT = 30
READER_TEXT = 120
READERS_OUT = 50
REGULAR = ("000000", "100644", "100755")
FIXTURES = ("tmp_path", "tmpdir", "tmp_path_factory")
GLOB_CHARS = "*?["

TOOLS = ("prettier", "markdownlint", "remark-cli", "remark-lint", "cspell", "mdformat", "markdown-link-check", "lychee",
         "linkinator", "textlint", "pymarkdown", "proselint", "codespell", "mkdocs", "sphinx-build", "doctoc", "pre-commit",
         "doctest", "markdown-docs", "mktestdocs", "phmdoctest")
TOOL_RE = re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(re.escape(t) for t in TOOLS) + r")(?![A-Za-z0-9])")
TOOL_CMD_RE = re.compile(r"(?:\b(?:npx|pnpx|bunx|pnpm|yarn|exec)\s+(?:--?\S+\s+)*remark(?![A-Za-z0-9])"
                         r"|(?:^|[;&|(`'\"]\s*|\b(?:npx|bunx|pnpx|exec)\s+)(?:remark|vale)\s+[-.\w/'\"*$])", re.M)
TOOL_CONFIG_RE = re.compile(r"(?:\.prettierrc.*|prettier\.config\..*|\.markdownlint.*|\.vale\.ini|\.remarkrc.*"
                            r"|cspell\.json|\.cspell.*|\.mdformat\.toml|lychee\.toml|\.lycheeignore"
                            r"|\.pre-commit-config\.ya?ml)\Z")
LINK = "]("


class ProofError(Exception):
    """A git call failed, timed out or read short, or the tree cannot be read: no verdict."""


class _Budget(Exception):
    pass


# ---- git ------------------------------------------------------------------------------------------------------------

def _git(cwd, *args, input=None, timeout=GIT_TIMEOUT):
    """git -C cwd args (bytes out), with the scrubbed env; ProofError on a non-zero exit, a timeout or no start."""
    argv = ["git", "-C", str(cwd)] + list(args)
    try:
        p = subprocess.Popen(argv, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ES.git_env())
    except OSError as e:
        raise ProofError("git %s will not start: %s" % (args[0], e))
    try:
        out, err = p.communicate(input=input, timeout=timeout)
    except subprocess.TimeoutExpired:
        p.kill()
        p.communicate()
        raise ProofError("git %s timed out after %ss" % (" ".join(args[:2]), timeout))
    if p.returncode != 0:
        msg = (err or b"").decode("utf-8", "replace").strip().splitlines()
        raise ProofError("git %s exited %d%s" % (" ".join(args[:2]), p.returncode, (": " + msg[-1]) if msg else ""))
    return out


def _dec(b):
    return b.decode("utf-8", "surrogateescape")


def is_prose(path):
    return os.path.splitext(path)[1].lower() in PROSE_EXT


# ---- globs ----------------------------------------------------------------------------------------------------------

def _has_glob(s):
    return any(c in s for c in GLOB_CHARS)


def _seg_re(seg):
    out, i = [], 0
    while i < len(seg):
        c = seg[i]
        if c == "*":
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c == "[":
            j = seg.find("]", i + 2)
            if j < 0:
                out.append(re.escape(c))
            else:
                body = seg[i + 1:j]
                if body[:1] in ("!", "^"):
                    body = "^" + body[1:]
                out.append("[" + body.replace("\\", "\\\\") + "]")
                i = j
        else:
            out.append(re.escape(c))
        i += 1
    return "".join(out)


_GLOB_RE = {}


def glob_match(glob, path):
    """git's `:(glob)` match of `glob` against a repo-relative `path` (wildmatch with pathname semantics)."""
    rx = _GLOB_RE.get(glob)
    if rx is None:
        segs = glob.split("/")
        parts = []
        for k, s in enumerate(segs):
            last = k == len(segs) - 1
            if s == "**":
                parts.append(".*" if last else "(?:[^/]*/)*")
            else:
                parts.append(_seg_re(s) + ("" if last else "/"))
        rx = _GLOB_RE[glob] = re.compile("".join(parts) + r"\Z", re.S)
    return bool(rx.match(path))


def literal_dir(glob):
    """(D, file): the glob's literal leading directory segments, and its file name for a literal-file glob, else None."""
    segs = glob.split("/")
    lits = []
    for s in segs:
        if _has_glob(s):
            break
        lits.append(s)
    if len(lits) == len(segs):
        return tuple(segs[:-1]), segs[-1]
    return tuple(lits), None


def tokens(glob):
    """The name rule's tokens: the deepest literal segment, plus the basename of a literal-file glob."""
    segs = glob.split("/")
    lits = [s for s in segs if not _has_glob(s) and s]
    out = []
    if lits:
        out.append(lits[-1])
    d, f = literal_dir(glob)
    if f and f not in out:
        out.append(f)
    return out


def _brace(pat):
    m = re.search(r"\{([^{}]*)\}", pat)
    if not m:
        return [pat]
    out = []
    for alt in m.group(1).split(","):
        out.extend(_brace(pat[:m.start()] + alt + pat[m.end():]))
    return out[:64]


def _filter_ok(filt, glob):
    """A walk's name filter (None, or a list of ("glob", pat) / ("suffix", s) alternatives) can select the glob's files."""
    if not filt:
        return True
    d, f = literal_dir(glob)
    for kind, val in filt:
        if kind == "suffix":
            s = val.lower()
            if f is not None:
                if f.lower().endswith(s):
                    return True
            elif not s or any(e.endswith(s) or s.endswith(e) for e in PROSE_EXT):
                return True
            continue
        for p in _brace(val):
            if f is not None:
                if fnmatch.fnmatchcase(f.lower(), p.lower()):
                    return True
                continue
            tail = p[p.rfind("*") + 1:] if "*" in p else p
            if not tail or "?" in tail or "[" in tail or tail.lower().endswith(PROSE_EXT):
                return True
    return False


def _covers(segs, unk, filt, glob):
    d, f = literal_dir(glob)
    if f is not None:
        t = d + (f,)
        if len(segs) > len(t) or tuple(segs) != t[:len(segs)]:
            return False
    else:
        n = min(len(segs), len(d))
        if tuple(segs[:n]) != d[:n]:
            return False
    return _filter_ok(filt, glob)


# ---- the path test --------------------------------------------------------------------------------------------------

def changed(repo, base, head, modes=False):
    """`git diff --no-renames base head`'s paths, as a list; with modes, [(path, old mode, new mode)]."""
    out = _git(repo, "diff", "--raw", "-z", "--no-renames", "--no-abbrev", base, head)
    parts = out.split(b"\0")
    entries, i = [], 0
    while i + 1 < len(parts):
        meta = _dec(parts[i])
        if not meta.startswith(":"):
            i += 1
            continue
        fields = meta[1:].split()
        entries.append((_dec(parts[i + 1]), fields[0], fields[1]))
        i += 2
    return entries if modes else [e[0] for e in entries]


def path_test(repo, base, head, globs):
    """{changed, inert, nonInert, matched, globs}: the header's path test."""
    entries = changed(repo, base, head, modes=True)
    paths = [e[0] for e in entries]
    matched = set()
    if globs and paths:
        out = _git(repo, "diff", "--name-only", "-z", "--no-renames", base, head, "--",
                   *[":(glob)" + g for g in globs])
        matched = set(_dec(p) for p in out.split(b"\0") if p)
    inert = [p for p, om, nm in entries if p in matched and is_prose(p) and om in REGULAR and nm in REGULAR]
    inert_set = set(inert)
    hit = [g for g in globs if any(glob_match(g, p) for p in matched)]
    if any(not any(glob_match(g, p) for g in globs) for p in matched):
        hit = list(globs)   # fail closed: git matched a path this matcher cannot place, so prove every glob
    return {"changed": paths, "inert": inert, "nonInert": [p for p in paths if p not in inert_set],
            "matched": sorted(matched), "globs": hit}


# ---- the tree -------------------------------------------------------------------------------------------------------

class SrcFile:
    __slots__ = ("fid", "path", "text", "lang", "step", "binary", "lines", "py", "lx", "segs")

    def __init__(self, fid, path, text, lang, step=False, binary=False):
        self.fid, self.path, self.text, self.lang, self.step, self.binary = fid, path, text, lang, step, binary
        self.lines = text.split("\n")
        self.py = None    # PyFile when it parsed
        self.lx = None    # LineFile (the line resolver's index)
        self.segs = tuple(path.split("/")) if not step else ()


PY_EXT = (".py", ".pyi", ".pyw")
JS_EXT = (".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts")
SH_EXT = (".sh", ".bash", ".zsh", ".ksh", ".bats")
CONF_EXT = (".json", ".jsonc", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".plist", ".xml", ".env")


def _lang(path, text):
    base = posixpath.basename(path)
    ext = os.path.splitext(base)[1].lower()
    if ext in PY_EXT:
        return "py"
    if ext in JS_EXT:
        return "js"
    if ext == ".swift":
        return "swift"
    if ext in SH_EXT:
        return "sh"
    if base in ("Makefile", "GNUmakefile", "makefile") or ext == ".mk":
        return "make"
    if ext in CONF_EXT or base.startswith("."):
        return "conf"
    first = text.split("\n", 1)[0]
    if first.startswith("#!"):
        if "python" in first:
            return "py"
        if "node" in first or "deno" in first or "bun" in first:
            return "js"
        if re.search(r"\b(?:ba|z|k|da)?sh\b", first):
            return "sh"
    return "other"


class Tree:
    """One tree's index: its regular blobs (non-prose read through cat-file --batch), symlinks and gitlinks."""

    def __init__(self, repo, rev):
        self.repo = repo
        self.sha = _dec(_git(repo, "rev-parse", "--verify", "-q", rev + "^{tree}")).strip()
        if not re.fullmatch(r"[0-9a-f]{40,64}", self.sha):
            raise ProofError("no tree at %s" % rev)
        out = _git(repo, "ls-tree", "-r", "-z", self.sha)
        self.blobs, self.links, self.gitlinks, self.paths = {}, {}, [], []
        for rec in out.split(b"\0"):
            if not rec:
                continue
            meta, _, path = rec.partition(b"\t")
            mode, typ, sha = _dec(meta).split()
            path = _dec(path)
            self.paths.append(path)
            if mode == "160000":
                self.gitlinks.append(path)
            elif mode == "120000":
                self.links[path] = sha
            elif typ == "blob" and not is_prose(path):
                self.blobs[path] = sha
        want = sorted(set(self.blobs.values()) | set(self.links.values()))
        self.content = self._cat(want) if want else {}

    def _cat(self, shas):
        out = _git(self.repo, "cat-file", "--batch", input=("\n".join(shas) + "\n").encode())
        got, i = {}, 0
        for sha in shas:
            nl = out.find(b"\n", i)
            if nl < 0:
                raise ProofError("git cat-file --batch read short at %s" % sha)
            head = _dec(out[i:nl]).split()
            if len(head) != 3 or head[1] == "missing":
                raise ProofError("git cat-file --batch: %s is missing" % sha)
            size = int(head[2])
            start, end = nl + 1, nl + 1 + size
            if end > len(out):
                raise ProofError("git cat-file --batch read short at %s" % sha)
            got[head[0]] = out[start:end]
            i = end + 1
        return got


def _worktrees(repo):
    out = _dec(_git(repo, "worktree", "list", "--porcelain"))
    return [line[len("worktree "):] for line in out.split("\n") if line.startswith("worktree ")]


# ---- values ---------------------------------------------------------------------------------------------------------
# A value is a tuple. Path-like: ("str", s) a literal string; ("path", base, unk) an absolute path (base None: an
# ancestor of a place, from a climb above the repo root); ("repo"|"cwd", segs, unk) a repo- or cwd-relative path;
# ("tmp",), ("homeopen",), ("input",), ("open",), ("depth",). Objects: ("none",), ("int", n), ("canon", dotted) a
# library object, ("func", key), ("cls", key), ("inst", key), ("module", fid), ("bound", value, attr), ("parents",
# value), ("env",), ("argv",), ("jsimport",), ("jsmeta",). `unk` marks an unknown tail below the known prefix.

NONE, TMP, HOMEOPEN, INPUT, OPEN, DEPTH_V = ("none",), ("tmp",), ("homeopen",), ("input",), ("open",), ("depth",)
STICKY = ("tmp", "homeopen", "input", "open", "depth")
PATHLIKE = ("str", "path", "repo", "cwd")
F = frozenset


def STR(s):
    return ("str", s)


def _home():
    return os.path.normpath(os.path.expanduser("~"))


def _tmpdir():
    return os.path.normpath(tempfile.gettempdir())


def _rel_segs(s):
    """A relative path string as (segs, unk, above): its segments with `.` dropped and `..` folded; a glob segment
    makes the rest unknown; `above` when `..` climbs above the start."""
    segs, unk = [], False
    for p in s.split("/"):
        if p in ("", "."):
            continue
        if p == "..":
            if segs:
                segs.pop()
                continue
            return (), False, True
        if _has_glob(p):
            unk = True
            break
        segs.append(p)
    return tuple(segs), unk, False


def _abs_norm(s):
    """An absolute path string normalised; a glob segment cuts it, with unk."""
    out, unk = [], False
    for p in s.split("/"):
        if _has_glob(p):
            unk = True
            break
        out.append(p)
    return posixpath.normpath("/".join(out) or "/"), unk


def as_origin(v):
    """A value as a root: an origin tuple, or None (no path: None, a number)."""
    k = v[0]
    if k == "str":
        s = v[1]
        if s.startswith("/"):
            base, unk = _abs_norm(s)
            return ("path", base, unk)
        segs, unk, above = _rel_segs(s)
        return ("path", None, False) if above else ("cwd", segs, unk)
    if k in ("path", "repo", "cwd") or k in STICKY:
        return v
    if k in ("none", "int"):
        return None
    if k in ("env", "argv"):
        return INPUT
    if k == "bound":
        if v[1][0] in STICKY:
            return v[1]
        if v[2] in ("path", "fspath", "absolute"):
            return as_origin(v[1])
        return OPEN
    return OPEN


def mark_unknown(v, concat=False):
    """v followed by an unknown part (a concat glues onto the last segment, so it is dropped)."""
    k = v[0]
    if k == "str":
        s = v[1]
        if concat and not s.endswith("/"):
            s = posixpath.dirname(s)
        o = as_origin(STR(s))
        return mark_unknown(o) if o is not None else OPEN
    if k == "path":
        base = v[1]
        if concat and base is not None and base != "/":
            base = posixpath.dirname(base)
        return ("path", base, True)
    if k in ("repo", "cwd"):
        segs = v[1][:-1] if concat and v[1] else v[1]
        return (k, segs, True)
    if k in STICKY:
        return v
    return OPEN


def climb(v, n=1):
    if n <= 0:
        return v
    k = v[0]
    if k == "str":
        if v[1].startswith("/"):
            s = posixpath.normpath(v[1])
            for _ in range(n):
                if s == "/":
                    break
                s = posixpath.dirname(s)
            return STR(s)
        o = as_origin(v)
        return climb(o, n) if o is not None else NONE
    if k in ("repo", "cwd"):
        if n > len(v[1]):
            return ("path", None, False)
        return (k, v[1][:len(v[1]) - n], v[2])
    if k == "path":
        if v[1] is None:
            return v
        b = v[1]
        for _ in range(n):
            if b == "/":
                break
            b = posixpath.dirname(b)
        return ("path", b, v[2])
    if k == "tmp":
        return climb(STR(_tmpdir()), n - 1)
    if k in STICKY:
        return v
    if k in ("none", "int"):
        return v
    return OPEN


def _append_segs(v, pieces):
    for p in pieces:
        if p in ("", "."):
            continue
        if p == "..":
            v = climb(v, 1)
            continue
        k = v[0]
        if _has_glob(p):
            return mark_unknown(v) if k != "str" else mark_unknown(as_origin(v) or OPEN)
        if k == "str":
            v = STR(posixpath.join(v[1], p) if v[1] else p)
        elif k in ("repo", "cwd"):
            if not v[2]:
                v = (k, v[1] + (p,), False)
        elif k == "path":
            if v[1] is not None and not v[2]:
                v = ("path", posixpath.join(v[1], p), False)
        elif k in STICKY:
            pass
        else:
            return OPEN
    return v


def append(v, s, join):
    k = v[0]
    if k == "str":
        if join:
            return STR(posixpath.join(v[1], s) if v[1] else s)
        return STR(v[1] + s)
    if k in ("none", "int"):
        return v
    if join:
        if s.startswith("/"):
            return STR(s)
        return _append_segs(v, s.split("/"))
    if s.startswith("/"):
        return _append_segs(v, s[1:].split("/"))
    if not s:
        return v
    # glued onto the last segment
    head, _, rest = s.partition("/")
    if k in ("repo", "cwd"):
        if v[2]:
            return v
        if not v[1]:
            return ("path", None, False)
        v = (k, v[1][:-1] + (v[1][-1] + head,), False)
        if _has_glob(head):
            v = (k, v[1][:-1], True)
    elif k == "path":
        if v[1] is None or v[2]:
            return v
        v = ("path", posixpath.normpath(v[1] + head), False)
    elif k not in STICKY:
        return OPEN
    return _append_segs(v, rest.split("/")) if rest else v


def compose(parts, join):
    """The header's composition rule over a list of value sets."""
    if not parts:
        return F()
    acc = set(parts[0])
    for part in parts[1:]:
        strs = [v for v in part if v[0] == "str"]
        others = [v for v in part if v[0] not in ("str", "none", "int")]
        if not strs and not others:
            continue
        new = set()
        for a in acc:
            for s in strs:
                new.add(append(a, s[1], join))
            if others:
                new.add(mark_unknown(a, concat=not join))
        new.update(others)
        acc = new
    return F(acc)


# ---- the Python index (ast) -----------------------------------------------------------------------------------------

class PyScope:
    __slots__ = ("kind", "parent", "func", "cls", "bindings", "params", "returns", "imports", "file")

    def __init__(self, kind, parent, file, func=None, cls=None):
        self.kind, self.parent, self.file, self.func, self.cls = kind, parent, file, func, cls
        self.bindings, self.params, self.returns, self.imports = {}, {}, [], {}

    def bind(self, name, ir):
        self.bindings.setdefault(name, []).append(ir)


class FuncInfo:
    __slots__ = ("key", "name", "file", "lang", "params", "positional", "has_var", "has_kw", "is_method", "is_static",
                 "is_classmethod", "cls", "scope", "def_scope", "line")

    def __init__(self, key, name, file, lang, line):
        self.key, self.name, self.file, self.lang, self.line = key, name, file, lang, line
        self.params, self.positional = {}, []
        self.has_var = self.has_kw = self.is_method = self.is_static = self.is_classmethod = False
        self.cls = None
        self.scope = None
        self.def_scope = None


class Param:
    __slots__ = ("name", "kind", "default", "func", "ir")

    def __init__(self, name, kind, default, func):
        self.name, self.kind, self.default, self.func = name, kind, default, func
        self.ir = ("param", self)   # memoised once per parameter, whatever reads it


class ClassInfo:
    __slots__ = ("key", "name", "file", "methods", "attrs", "bases")

    def __init__(self, key, name, file):
        self.key, self.name, self.file = key, name, file
        self.methods, self.attrs, self.bases = {}, {}, []


class CallSite:
    __slots__ = ("name", "kind", "args", "kwargs", "file", "scope", "line", "recv", "cls")

    def __init__(self, name, kind, args, kwargs, file, scope, line, recv=None, cls=None):
        self.name, self.kind, self.args, self.kwargs = name, kind, args, kwargs
        self.file, self.scope, self.line, self.recv, self.cls = file, scope, line, recv, cls


class Walk:
    __slots__ = ("file", "line", "text", "roots", "filt", "form")

    def __init__(self, file, line, roots, filt, form):
        self.file, self.line, self.roots, self.filt, self.form = file, line, roots, filt, form
        self.text = file.lines[line - 1].strip()[:READER_TEXT] if 0 < line <= len(file.lines) else ""


_IR = {}


def py_ir(node):
    """An ast expression as the evaluator's IR (memoised by node)."""
    if node is None:
        return ("const",)
    got = _IR.get(id(node))
    if got is not None and got[0] is node:
        return got[1]
    ir = _py_ir(node)
    _IR[id(node)] = (node, ir)
    return ir


def _py_ir(n):
    if isinstance(n, ast.Constant):
        if isinstance(n.value, str):
            return ("lit", n.value)
        if isinstance(n.value, bytes):
            return ("lit", n.value.decode("utf-8", "replace"))
        if isinstance(n.value, int) and not isinstance(n.value, bool):
            return ("int", n.value)
        return ("const",)
    if isinstance(n, ast.JoinedStr):
        parts = []
        for v in n.values:
            if isinstance(v, ast.Constant):
                parts.append(("lit", str(v.value)))
            elif isinstance(v, ast.FormattedValue):
                parts.append(py_ir(v.value))
            else:
                parts.append(("open",))
        return ("tmpl", parts)
    if isinstance(n, ast.Name):
        return ("name", n.id)
    if isinstance(n, ast.Attribute):
        return ("attr", py_ir(n.value), n.attr)
    if isinstance(n, ast.Subscript):
        sl = n.slice
        if sys.version_info < (3, 9) and isinstance(sl, ast.Index):  # pragma: no cover (3.8)
            sl = sl.value
        return ("index", py_ir(n.value), py_ir(sl))
    if isinstance(n, ast.Call):
        args = [("star", py_ir(a.value)) if isinstance(a, ast.Starred) else py_ir(a) for a in n.args]
        kwargs = [(k.arg, py_ir(k.value)) for k in n.keywords]
        return ("call", py_ir(n.func), args, kwargs, False)
    if isinstance(n, ast.BinOp):
        if isinstance(n.op, ast.Div):
            return ("join", [py_ir(n.left), py_ir(n.right)])
        if isinstance(n.op, ast.Add):
            return ("tmpl", [py_ir(n.left), py_ir(n.right)])
        if isinstance(n.op, ast.Mod):
            left = py_ir(n.left)
            if left[0] == "lit" and "%" in left[1]:
                return ("tmpl", [("lit", left[1].split("%", 1)[0]), py_ir(n.right), ("open",)])
            return ("tmpl", [left, py_ir(n.right)])
        return ("const",)
    if isinstance(n, ast.IfExp):
        return ("union", [py_ir(n.body), py_ir(n.orelse)])
    if isinstance(n, ast.BoolOp):
        return ("union", [py_ir(v) for v in n.values])
    if isinstance(n, (ast.List, ast.Tuple, ast.Set)):
        return ("union", [py_ir(e.value) if isinstance(e, ast.Starred) else py_ir(e) for e in n.elts])
    if isinstance(n, ast.Dict):
        return ("union", [py_ir(v) for v in n.values])
    if isinstance(n, ast.Starred):
        return py_ir(n.value)
    if isinstance(n, ast.Await):
        return py_ir(n.value)
    if isinstance(n, ast.NamedExpr):
        return py_ir(n.value)
    if isinstance(n, (ast.Compare, ast.UnaryOp)):
        return ("const",)
    if isinstance(n, (ast.ListComp, ast.GeneratorExp, ast.SetComp)):
        return ("union", [py_ir(g.iter) for g in n.generators])
    return ("open",)


PY_WALK_NAMES = ("walk", "fwalk", "listdir", "scandir", "glob", "iglob", "rglob", "iterdir", "copytree", "make_archive",
                 "dircmp", "add", "write")


class PyFile:
    def __init__(self, sf, ix, tree):
        self.sf = sf
        self.module = PyScope("module", None, sf)
        self.calls = []
        self.walk_calls = []   # (call node, scope, filters)
        self.shell = []        # (line, [segments] | ("argv", [words]), scope)
        _PyBuilder(self, ix).visit(tree)


class _PyBuilder(ast.NodeVisitor):
    def __init__(self, pf, ix):
        self.pf, self.ix = pf, ix
        self.scope = pf.module
        self.cls = None
        self.call_funcs = set()
        self.filters = {}
        self.self_name = None

    # scopes -------------------------------------------------------------------------------------------------------
    def _lookup_parent(self):
        s = self.scope
        while s is not None and s.kind == "class":
            s = s.parent
        return s

    def _func(self, node, name, lam=False):
        for d in getattr(node, "decorator_list", []):
            self.visit(d)
        a = node.args
        for d in list(a.defaults) + [d for d in a.kw_defaults if d is not None]:
            self.visit(d)
        key = (self.pf.sf.fid, node.lineno, node.col_offset, name)
        fi = FuncInfo(key, name, self.pf.sf, "py", node.lineno)
        fi.def_scope = self.scope
        decos = set()
        for d in getattr(node, "decorator_list", []):
            dn = d.func if isinstance(d, ast.Call) else d
            decos.add(dn.attr if isinstance(dn, ast.Attribute) else getattr(dn, "id", ""))
        if self.cls is not None and not lam:
            fi.is_method, fi.cls = True, self.cls
            fi.is_static = "staticmethod" in decos
            fi.is_classmethod = "classmethod" in decos
            self.cls.methods[name] = fi
        pos = list(getattr(a, "posonlyargs", [])) + list(a.args)
        defaults = [None] * (len(pos) - len(a.defaults)) + list(a.defaults)
        for arg, d in zip(pos, defaults):
            p = Param(arg.arg, "pos", py_ir(d) if d is not None else None, fi)
            fi.params[arg.arg] = p
            fi.positional.append(p)
        if a.vararg:
            fi.has_var = True
            fi.params[a.vararg.arg] = Param(a.vararg.arg, "var", None, fi)
        for arg, d in zip(a.kwonlyargs, a.kw_defaults):
            fi.params[arg.arg] = Param(arg.arg, "kwonly", py_ir(d) if d is not None else None, fi)
        if a.kwarg:
            fi.has_kw = True
            fi.params[a.kwarg.arg] = Param(a.kwarg.arg, "kw", None, fi)
        self.ix.funcs[key] = fi
        if name:
            self.ix.funcs_by_name.setdefault(name, []).append(fi)
        if lam:
            self.ix.lambda_of[id(node)] = fi
        scope = PyScope("function", self._lookup_parent(), self.pf.sf, func=fi, cls=self.cls if not lam else None)
        for pn in fi.params:
            scope.params[pn] = fi.params[pn]
        fi.scope = scope
        saved = (self.scope, self.cls, self.self_name)
        self.scope, self.cls = scope, None
        self.self_name = pos[0].arg if fi.is_method and not fi.is_static and pos else None
        if lam:
            scope.returns.append(py_ir(node.body))
            self.visit(node.body)
        else:
            for st in node.body:
                self.visit(st)
        self.scope, self.cls, self.self_name = saved
        return fi

    def visit_FunctionDef(self, node):
        fi = self._func(node, node.name)
        self.scope.bind(node.name, ("vals", F([("func", fi.key)])))

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node):
        self._func(node, None, lam=True)

    def visit_ClassDef(self, node):
        for d in node.decorator_list + node.bases + [k.value for k in node.keywords]:
            self.visit(d)
        key = (self.pf.sf.fid, node.lineno, node.name)
        ci = ClassInfo(key, node.name, self.pf.sf)
        ci.bases = [b.attr if isinstance(b, ast.Attribute) else b.id for b in node.bases
                    if isinstance(b, (ast.Name, ast.Attribute))]
        self.ix.classes[key] = ci
        self.ix.classes_by_name.setdefault(node.name, []).append(ci)
        self.scope.bind(node.name, ("vals", F([("cls", key)])))
        scope = PyScope("class", self.scope, self.pf.sf, cls=ci)
        saved = (self.scope, self.cls)
        self.scope, self.cls = scope, ci
        for st in node.body:
            self.visit(st)
        self.scope, self.cls = saved

    # bindings -----------------------------------------------------------------------------------------------------
    def _bind(self, t, ir):
        if isinstance(t, ast.Name):
            self.scope.bind(t.id, ir)
            if self.scope.kind == "class" and self.cls is not None:
                self.cls.attrs.setdefault(t.id, []).append((ir, self.scope))
        elif isinstance(t, (ast.Tuple, ast.List)):
            for e in t.elts:
                self._bind(e.value if isinstance(e, ast.Starred) else e, ("item", ir))
        elif isinstance(t, ast.Starred):
            self._bind(t.value, ("item", ir))
        elif isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and self.self_name and \
                t.value.id == self.self_name and self.scope.func is not None and self.scope.func.cls is not None:
            self.scope.func.cls.attrs.setdefault(t.attr, []).append((ir, self.scope))
        else:
            self.visit(t)

    def visit_Assign(self, node):
        self.visit(node.value)
        lam = isinstance(node.value, ast.Lambda)
        for t in node.targets:
            if lam and isinstance(t, ast.Name):
                fi = self.ix.lambda_of.get(id(node.value))
                if fi is not None:
                    fi.name = t.id
                    self.ix.funcs_by_name.setdefault(t.id, []).append(fi)
                    self.scope.bind(t.id, ("vals", F([("func", fi.key)])))
                    continue
            self._bind(t, py_ir(node.value))

    def visit_AnnAssign(self, node):
        if node.value is not None:
            self.visit(node.value)
            self._bind(node.target, py_ir(node.value))

    def visit_AugAssign(self, node):
        self.visit(node.value)
        if isinstance(node.target, ast.Name):
            cur = ("name", node.target.id)
            if isinstance(node.op, ast.Add):
                self._bind(node.target, ("tmpl", [cur, py_ir(node.value)]))
            elif isinstance(node.op, ast.Div):
                self._bind(node.target, ("join", [cur, py_ir(node.value)]))
            else:
                self._bind(node.target, ("open",))

    def visit_NamedExpr(self, node):
        self.visit(node.value)
        self._bind(node.target, py_ir(node.value))

    def visit_For(self, node):
        self.visit(node.iter)
        self._bind(node.target, ("item", py_ir(node.iter)))
        for st in node.body + node.orelse:
            self.visit(st)

    visit_AsyncFor = visit_For

    def visit_With(self, node):
        for item in node.items:
            self.visit(item.context_expr)
            if item.optional_vars is not None:
                self._bind(item.optional_vars, ("item", py_ir(item.context_expr)))
        for st in node.body:
            self.visit(st)

    visit_AsyncWith = visit_With

    def _comp(self, node):
        for g in node.generators:
            filt = []
            for cond in g.ifs:
                for c in ast.walk(cond):
                    if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "endswith" \
                            and c.args:
                        a0 = c.args[0]
                        vals = a0.elts if isinstance(a0, ast.Tuple) else [a0]
                        for v in vals:
                            if isinstance(v, ast.Constant) and isinstance(v.value, str):
                                filt.append(("suffix", v.value))
            if filt:
                it = g.iter
                while isinstance(it, ast.Call) and isinstance(it.func, ast.Name) and it.func.id in ("sorted", "list") \
                        and it.args:
                    it = it.args[0]
                if isinstance(it, ast.Call):
                    self.filters[id(it)] = filt
            self.visit(g.iter)
            self._bind(g.target, ("item", py_ir(g.iter)))
            for cond in g.ifs:
                self.visit(cond)
        for attr in ("elt", "key", "value"):
            v = getattr(node, attr, None)
            if v is not None:
                self.visit(v)

    visit_ListComp = visit_SetComp = visit_GeneratorExp = visit_DictComp = _comp

    def visit_Return(self, node):
        if node.value is not None:
            self.scope.returns.append(py_ir(node.value))
            self.visit(node.value)

    def visit_Yield(self, node):
        if node.value is not None:
            self.scope.returns.append(py_ir(node.value))
            self.visit(node.value)

    def visit_YieldFrom(self, node):
        self.scope.returns.append(("item", py_ir(node.value)))
        self.visit(node.value)

    def visit_ExceptHandler(self, node):
        if node.type is not None:
            self.visit(node.type)
        if node.name:
            self.scope.bind(node.name, ("open",))
        for st in node.body:
            self.visit(st)

    def visit_Import(self, node):
        for a in node.names:
            target = self.ix.module_file(self.pf.sf.path, a.name, 0)
            if a.asname:
                self.scope.bind(a.asname, ("vals", F([("module", target)])) if target is not None
                                else ("vals", F([("canon", a.name)])))
            else:
                head = a.name.split(".")[0]
                t2 = self.ix.module_file(self.pf.sf.path, head, 0)
                self.scope.bind(head, ("vals", F([("module", t2)])) if t2 is not None else ("vals", F([("canon", head)])))

    def visit_ImportFrom(self, node):
        mod = node.module or ""
        target = self.ix.module_file(self.pf.sf.path, mod, node.level or 0)
        for a in node.names:
            if a.name == "*":
                continue
            name = a.asname or a.name
            sub = self.ix.module_file(self.pf.sf.path, (mod + "." if mod else "") + a.name, node.level or 0)
            if sub is not None:
                self.scope.bind(name, ("vals", F([("module", sub)])))
            elif target is not None:
                self.scope.bind(name, ("importfrom", target, a.name))
            elif node.level:
                self.scope.bind(name, ("open",))
            else:
                self.scope.bind(name, ("vals", F([("canon", (mod + "." if mod else "") + a.name)])))

    # calls, references, walks and strings ---------------------------------------------------------------------------
    def visit_Call(self, node):
        self.call_funcs.add(id(node.func))
        f = node.func
        args = [("star", py_ir(a.value)) if isinstance(a, ast.Starred) else py_ir(a) for a in node.args]
        kwargs = [(k.arg, py_ir(k.value)) for k in node.keywords]
        line = node.lineno
        if isinstance(f, ast.Name):
            self.ix.add_site(CallSite(f.id, "name", args, kwargs, self.pf.sf, self.scope, line))
        elif isinstance(f, ast.Attribute):
            kind = "attr"
            if isinstance(f.value, ast.Call) and isinstance(f.value.func, ast.Name) and f.value.func.id == "super":
                kind = "super"
            recv = f.value.id if isinstance(f.value, ast.Name) else None
            self.ix.add_site(CallSite(f.attr, kind, args, kwargs, self.pf.sf, self.scope, line, recv=recv))
        name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
        if name in PY_WALK_NAMES:
            self.pf.walk_calls.append((node, self.scope, self.filters.get(id(node))))
        self.generic_visit(node)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load) and id(node) not in self.call_funcs:
            self.ix.refs.add(node.id)

    def visit_Attribute(self, node):
        if isinstance(node.ctx, ast.Load) and id(node) not in self.call_funcs:
            self.ix.refs.add(node.attr)
        self.visit(node.value)

    def visit_Constant(self, node):
        if isinstance(node.value, str) and node.value and _hint(node.value):
            for i, part in enumerate(node.value.split("\n")):
                if part.strip() and not part.strip().startswith("#") and _hint(part):
                    self.pf.shell.append((node.lineno + i, [("t", part)], self.scope))

    def visit_JoinedStr(self, node):
        segs = []
        for v in node.values:
            if isinstance(v, ast.Constant):
                segs.append(("t", str(v.value)))
            elif isinstance(v, ast.FormattedValue):
                segs.append(("x", py_ir(v.value)))
                self.visit(v.value)
        if _hint("".join(s[1] for s in segs if s[0] == "t")):
            self.pf.shell.append((node.lineno, segs, self.scope))

    def _seq(self, node):
        strs = [e for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
        if strs and len(node.elts) > 1 and SHELL_HINT.search(" ".join(e.value for e in strs)):
            words = []
            for e in node.elts:
                if isinstance(e, ast.Constant) and isinstance(e.value, str):
                    words.append([("lit", e.value, True)])
                elif isinstance(e, ast.Starred):
                    words.append([("host", py_ir(e.value))])
                else:
                    words.append([("host", py_ir(e))])
            self.pf.shell.append((node.lineno, ("argv", words), self.scope))
        for e in node.elts:
            self.visit(e)

    visit_List = visit_Tuple = visit_Set = _seq


# ---- the line resolver's index (JS, Swift, shell, config, a Python file that fails to parse) -------------------------

_TOKEN_RE = re.compile(r"\s+|[A-Za-z_$][\w$]*|\d[\w.]*|\?\.|\?\?|=>|\.\.\.|&&|\|\||[=!<>]=?=?|.", re.S)


def _js_tokens(text, lang, with_lines=False):
    """Tokens of a code text: ("str", value) | ("tmpl", parts) | ("id", name) | ("num",) | ("p", punct). Comments
    dropped. A Swift `\\(…)` and a JS `${…}` interpolation are tmpl parts (("x", text)). With with_lines, (tokens,
    lines): each token's 1-based start line."""
    out, i, n = [], 0, len(text)
    py = lang == "py"
    tl = []
    line, seen = 1, 0
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
            continue
        if with_lines:
            if len(tl) < len(out):   # the tokens the previous step appended start on its line
                tl.extend([line] * (len(out) - len(tl)))
            line += text.count("\n", seen, i)
            seen = i
        if text.startswith("//", i) and not py:
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "#" and py:
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i) and not py:
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if py and re.match(r"[rRbBuUfF]{1,2}['\"]", text[i:i + 3]):
            m = re.match(r"[rRbBuUfF]{1,2}", text[i:])
            pre = m.group(0).lower()
            i += len(pre)
            tok, i = _read_str(text, i, interp=("f" in pre and "py"), raw="r" in pre)
            out.append(tok)
            continue
        if c in "'\"`":
            interp = "js" if c == "`" else ("swift" if lang == "swift" and c == '"' else None)
            tok, i = _read_str(text, i, interp=interp)
            out.append(tok)
            continue
        m = _TOKEN_RE.match(text, i)
        s = m.group(0)
        i = m.end()
        if s[0].isalpha() or s[0] in "_$":
            out.append(("id", s))
        elif s[0].isdigit():
            out.append(("num", s))
        else:
            out.append(("p", s))
    if with_lines:
        tl.extend([line] * (len(out) - len(tl)))
        return out, tl
    return out


def _read_str(text, i, interp=None, raw=False):
    q = text[i]
    triple = text.startswith(q * 3, i) and q != "`"
    end_q = q * 3 if triple else q
    i += len(end_q)
    parts, buf = [], []
    n = len(text)
    while i < n:
        if text.startswith(end_q, i):
            i += len(end_q)
            break
        c = text[i]
        if c == "\\" and not raw and i + 1 < n:
            if interp == "swift" and text[i + 1] == "(":
                j = _balanced(text, i + 1, "(", ")")
                parts.append(("t", "".join(buf)))
                buf = []
                parts.append(("x", text[i + 2:j - 1]))
                i = j
                continue
            nxt = text[i + 1]
            buf.append({"n": "\n", "t": "\t"}.get(nxt, nxt))
            i += 2
            continue
        if interp == "js" and text.startswith("${", i):
            j = _balanced(text, i + 1, "{", "}")
            parts.append(("t", "".join(buf)))
            buf = []
            parts.append(("x", text[i + 2:j - 1]))
            i = j
            continue
        if interp == "py" and c == "{":
            if text.startswith("{{", i):
                buf.append("{")
                i += 2
                continue
            j = _balanced(text, i, "{", "}")
            parts.append(("t", "".join(buf)))
            buf = []
            inner = text[i + 1:j - 1]
            parts.append(("x", re.split(r"[!:](?![=])", inner, 1)[0] if not inner.startswith(":") else inner))
            i = j
            continue
        if not triple and c == "\n" and q != "`":
            break
        buf.append(c)
        i += 1
    parts.append(("t", "".join(buf)))
    parts = [p for p in parts if not (p[0] == "t" and not p[1])] or [("t", "")]
    if len(parts) == 1 and parts[0][0] == "t":
        return ("str", parts[0][1]), i
    return ("tmpl", parts), i


def _balanced(text, i, o, c):
    """The index just past the bracket that closes text[i] == o (strings skipped)."""
    depth, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in "'\"`":
            _tok, i = _read_str(text, i)
            continue
        if ch == o:
            depth += 1
        elif ch == c:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


class _Parser:
    """A small expression parser over _js_tokens (JS, Swift, and a Python file that fails to parse): the IR, or
    ("open",) for anything it cannot read."""

    def __init__(self, toks, lang):
        self.t, self.i, self.lang = toks, 0, lang

    def peek(self, k=0):
        j = self.i + k
        return self.t[j] if j < len(self.t) else ("eof", "")

    def eat(self, p=None):
        tok = self.peek()
        if p is not None and tok != ("p", p):
            raise ValueError("expected %s" % p)
        self.i += 1
        return tok

    def expr(self):
        e = self.binary()
        if self.peek() == ("p", "?"):
            self.eat()
            a = self.expr()
            self.eat(":")
            b = self.expr()
            return ("union", [a, b])
        if self.peek() == ("p", "=>"):
            raise ValueError("arrow")
        return e

    def binary(self):
        e = self.unary()
        while True:
            tok = self.peek()
            if tok in (("p", "??"), ("p", "||"), ("p", "&&")) or tok == ("id", "or") and self.lang == "py":
                self.eat()
                e = ("union", [e, self.unary()])
            elif tok == ("p", "+"):
                self.eat()
                e = ("tmpl", [e, self.unary()])
            elif tok == ("p", "/") and self.lang == "py":
                self.eat()
                e = ("join", [e, self.unary()])
            elif tok[0] == "p" and tok[1] in ("-", "*", "/", "%", "<", ">", "<=", ">=", "==", "===", "!=", "!==",
                                                 "&", "|", "^", "<<", ">>"):
                self.eat()
                self.unary()
                e = ("const",)
            else:
                return e

    def unary(self):
        tok = self.peek()
        if tok in (("id", "await"), ("id", "typeof"), ("id", "void"), ("id", "try"), ("p", "!"), ("p", "-")):
            self.eat()
            v = self.unary()
            return v if tok[1] in ("await", "try") else ("const",)
        return self.postfix(self.primary())

    def primary(self):
        tok = self.eat()
        k, v = tok
        if k == "str":
            return ("lit", v)
        if k == "tmpl":
            return ("tmpl", [("lit", p[1]) if p[0] == "t" else _parse_text(p[1], self.lang) for p in v])
        if k == "num":
            try:
                return ("int", int(v))
            except ValueError:
                return ("const",)
        if k == "id":
            if v in ("true", "false", "null", "undefined", "None", "True", "False", "nil"):
                return ("const",)
            if v == "new":
                callee = self.primary()
                while self.peek() in (("p", "."),):
                    self.eat()
                    callee = ("attr", callee, self.eat()[1])
                args, kwargs = self.args() if self.peek() == ("p", "(") else ([], [])
                return ("call", callee, args, kwargs, True)
            if v in ("function", "async") or v == "lambda" and self.lang == "py":
                raise ValueError("function")
            return ("name", v)
        if tok == ("p", "("):
            e = self.expr()
            if self.peek() == ("p", ","):   # a tuple
                items = [e]
                while self.peek() == ("p", ","):
                    self.eat()
                    if self.peek() == ("p", ")"):
                        break
                    items.append(self.expr())
                e = ("union", items)
            self.eat(")")
            if self.peek() == ("p", "=>"):
                raise ValueError("arrow")
            return e
        if tok == ("p", "["):
            items = []
            while self.peek() != ("p", "]"):
                if self.peek() == ("eof", ""):
                    raise ValueError("eof")
                if self.peek() == ("p", "..."):
                    self.eat()
                items.append(self.expr())
                if self.peek() == ("p", ","):
                    self.eat()
            self.eat("]")
            return ("union", items)
        if tok == ("p", "{"):
            obj = {}
            while self.peek() != ("p", "}"):
                if self.peek() == ("eof", ""):
                    raise ValueError("eof")
                if self.peek() == ("p", "..."):
                    self.eat()
                    obj["..."] = self.expr()
                else:
                    key = self.eat()
                    if self.peek() == ("p", ":"):
                        self.eat()
                        obj[key[1]] = self.expr()
                    elif key[0] == "id":
                        obj[key[1]] = ("name", key[1])
                if self.peek() == ("p", ","):
                    self.eat()
            self.eat("}")
            return ("obj", obj)
        if tok == ("p", "#") and self.peek()[0] == "id":   # Swift #file / #filePath
            return ("name", "#" + self.eat()[1])
        raise ValueError("unexpected %r" % (tok,))

    def args(self):
        self.eat("(")
        args, kwargs = [], []
        while self.peek() != ("p", ")"):
            if self.peek() == ("eof", ""):
                raise ValueError("eof")
            if self.peek() == ("p", "..."):
                self.eat()
                args.append(("star", self.expr()))
            elif self.peek()[0] == "id" and self.peek(1) in (("p", ":"),) and self.lang == "swift":
                label = self.eat()[1]
                self.eat(":")
                kwargs.append((label, self.expr()))
            elif self.peek()[0] == "id" and self.peek(1) == ("p", "=") and self.lang == "py":
                label = self.eat()[1]
                self.eat("=")
                kwargs.append((label, self.expr()))
            elif self.peek() == ("p", "*") and self.lang == "py":
                self.eat()
                if self.peek() == ("p", "*"):
                    self.eat()
                    kwargs.append((None, self.expr()))
                else:
                    args.append(("star", self.expr()))
            else:
                args.append(self.expr())
            if self.peek() == ("p", ","):
                self.eat()
        self.eat(")")
        return args, kwargs

    def postfix(self, e):
        while True:
            tok = self.peek()
            if tok in (("p", "."), ("p", "?.")) or (tok == ("p", "!") and self.peek(1) == ("p", ".")):
                if tok == ("p", "!"):
                    self.eat()
                self.eat()
                nxt = self.eat()
                if nxt == ("p", "("):   # ?.( call
                    self.i -= 1
                    a, k = self.args()
                    e = ("call", e, a, k, False)
                    continue
                e = ("attr", e, nxt[1])
            elif tok == ("p", "["):
                self.eat()
                idx = self.expr() if self.peek() != ("p", "]") else ("const",)
                while self.peek() == ("p", ":"):   # a slice
                    self.eat()
                    if self.peek() != ("p", "]"):
                        self.expr()
                    idx = ("const",)
                self.eat("]")
                e = ("index", e, idx)
            elif tok == ("p", "("):
                a, k = self.args()
                e = ("call", e, a, k, False)
            else:
                return e


def _parse_text(text, lang):
    try:
        p = _Parser(_js_tokens(text, lang), lang)
        e = p.expr()
        return e
    except (ValueError, IndexError, RecursionError):
        return ("open",)


JS_KEYWORDS = frozenset("if for while switch catch function return typeof new delete void in of instanceof await "
                        "yield else do try case throw class const let var import export from with super this "
                        "def elif lambda not and or is pass assert raise print func guard let".split())
JS_WALK = ("readdirSync", "readdir", "opendirSync", "opendir", "globSync", "glob", "globby", "globbySync",
           "globStream", "globIterate", "cpSync", "cp")
SWIFT_WALK = ("contentsOfDirectory", "enumerator", "subpathsOfDirectory", "subpaths", "copyItem")


class LineFile:
    """The line resolver's index of one non-Python (or unparsed Python) file."""

    def __init__(self, sf, ix):
        self.sf, self.ix = sf, ix
        self.bindings = {}    # name -> [(text, line)]
        self.this_attrs = {}  # name -> [(text, line)]
        self.params = {}      # name -> [Param]
        self.imports = {}     # name -> value-ish ("vals", ...) | ("importfrom", fid, attr)
        self.shell_vars = {}  # name -> [(words, line)]
        self.views = []       # (line, [items])
        self.heredoc = set()  # the lines of a shell file's heredoc bodies (the shell globs none of them)
        self.walks = []       # (line, kind, callee_text, args, kwargs)
        lang = sf.lang
        if lang in ("js", "swift", "py"):
            self._code(lang)
        else:
            self._shell(lang)

    # code ---------------------------------------------------------------------------------------------------------
    def _code(self, lang):
        """One pass over the file's tokens: bindings, parameters, imports, call sites, references, walks and the
        de-quoted views of the lines that could hold a shell form."""
        text = self.sf.text
        toks, tl = _js_tokens(text, lang, with_lines=True)
        n = len(toks)
        P = _Parser(toks, lang)
        closer = _closers(toks)
        src_lines = self.sf.lines

        def expr_at(i):
            P.i = i
            try:
                return P.expr()
            except (ValueError, IndexError, RecursionError):
                return ("open",)

        def args_at(i):
            P.i = i
            try:
                return P.args()
            except (ValueError, IndexError, RecursionError):
                return None

        for m in re.finditer(r"(?m)^\s*import\s+(.*?)\s+from\s+['\"]([^'\"]+)['\"]", text):
            spec, mod = m.group(1), m.group(2)
            named = re.search(r"\{([^}]*)\}", spec)
            default = spec.split(",")[0].strip() if not spec.strip().startswith("{") else ""
            if default.startswith("* as "):
                self.imports[default[5:].strip()] = self._import_val(mod, None)
            elif default and re.fullmatch(r"[A-Za-z_$][\w$]*", default):
                self.imports[default] = self._import_val(mod, "default")
            if named:
                for piece in named.group(1).split(","):
                    piece = piece.strip()
                    if piece:
                        src, _, alias = piece.partition(" as ")
                        self.imports[(alias or src).strip()] = self._import_val(mod, src.strip())
        in_import = False
        named_defs = set()   # token index of each named def's `(`
        for i in range(n):
            k, v = toks[i]
            prev = toks[i - 1] if i else ("bof", "")
            nxt = toks[i + 1] if i + 1 < n else ("eof", "")
            line = tl[i]
            if (k, v) == ("id", "import") and prev in (("bof", ""), ("p", ";"), ("p", "}")) or \
                    (k, v) == ("id", "import") and tl[i - 1] != line if i else False:
                in_import = nxt != ("p", "(") and nxt != ("p", ".")
            if in_import:
                if k == "str":
                    in_import = False
                continue
            if k == "p" and v in ("{", "[") and prev in (("id", "const"), ("id", "let"), ("id", "var")):
                j = closer.get(i, n)
                if j < n and toks[j] == ("p", "="):
                    rhs = expr_at(j + 1)
                    mod = _import_of(rhs)
                    for q in range(i + 1, j - 1):
                        if toks[q][0] == "id" and toks[q + 1] in (("p", ","), ("p", "}"), ("p", "]")):
                            alias = toks[q][1]
                            src = toks[q - 2][1] if toks[q - 1] == ("p", ":") else alias
                            if mod is not None:
                                self.imports[alias] = self._import_val(mod, src)
                            else:
                                self.bindings.setdefault(alias, []).append((("open",), line))
                continue
            if k != "id":
                continue
            if v in ("this", "self") and nxt == ("p", ".") and i + 3 < n and toks[i + 2][0] == "id" and \
                    toks[i + 3] == ("p", "="):
                self.this_attrs.setdefault(toks[i + 2][1], []).append((expr_at(i + 4), line))
                continue
            if v in ("for",):
                j = i + 1
                if j < n and toks[j] == ("p", "("):
                    j += 1
                if j < n and toks[j] in (("id", "const"), ("id", "let"), ("id", "var")):
                    j += 1
                if j + 1 < n and toks[j][0] == "id" and toks[j + 1] in (("id", "of"), ("id", "in")):
                    self.bindings.setdefault(toks[j][1], []).append((("item", expr_at(j + 2)), line))
                continue
            if v in JS_KEYWORDS and v not in ("constructor",):
                if v in ("function", "def", "func") and nxt[0] == "id" and i + 2 < n and toks[i + 2] == ("p", "("):
                    named_defs.add(i + 2)
                    if v == "func":
                        for q in range(i + 3, closer.get(i + 2, n) - 1):
                            if toks[q][0] == "id" and toks[q + 1] == ("p", ":"):
                                self.params.setdefault(toks[q][1], []).append(Param(toks[q][1], "open", None, None))
                    else:
                        self._func(nxt[1], line, self._params(toks, i + 2, closer, expr_at, lang))
                elif v == "function" and nxt == ("p", "("):
                    for pn, _d in self._params(toks, i + 1, closer, expr_at, lang):
                        self.params.setdefault(pn.lstrip(".*"), []).append(Param(pn.lstrip(".*"), "open", None, None))
                    named_defs.add(i + 1)
                continue
            # a named function bound by `=` or `:`
            if nxt in (("p", "="), ("p", ":")) and prev != ("p", "."):
                j = i + 2
                if j < n and toks[j] == ("id", "async"):
                    j += 1
                if j < n and toks[j] == ("id", "function"):
                    j += 1
                    if j < n and toks[j][0] == "id":
                        j += 1
                    if j < n and toks[j] == ("p", "("):
                        named_defs.add(j)
                        self._func(v, line, self._params(toks, j, closer, expr_at, lang))
                        continue
                elif j < n and toks[j] == ("p", "(") and closer.get(j, n) < n and toks[closer[j]] == ("p", "=>"):
                    named_defs.add(j)
                    self._func(v, line, self._params(toks, j, closer, expr_at, lang))
                    continue
                elif j + 1 < n and toks[j][0] == "id" and toks[j + 1] == ("p", "=>"):
                    named_defs.add(j)
                    self._func(v, line, [(toks[j][1], None)])
                    continue
            if nxt == ("p", "=") and prev not in (("p", "."), ("p", "?.")):
                rhs = expr_at(i + 2)
                mod = _import_of(rhs)
                if mod is not None:
                    self.imports[v] = self._import_val(mod, None)
                else:
                    self.bindings.setdefault(v, []).append((rhs, line))
                continue
            if nxt == ("p", "=>") and i not in named_defs and prev not in (("p", "="), ("p", ":")):
                self.params.setdefault(v, []).append(Param(v, "open", None, None))
                continue
            if nxt == ("p", "(") or nxt == ("p", "?.") and i + 2 < n and toks[i + 2] == ("p", "("):
                at = i + 1 if nxt == ("p", "(") else i + 2
                end = closer.get(at, n)
                after = toks[end] if end < n else ("eof", "")
                if after in (("p", "{"),) and prev not in (("p", "."), ("id", "new")) and lang != "py":
                    named_defs.add(at)   # a method definition
                    self._func(v, line, self._params(toks, at, closer, expr_at, lang))
                    continue
                if after == ("p", "=>"):
                    continue
                got = args_at(at)
                args, kwargs = got if got is not None else ([("star", ("open",))], [])
                recv = ""
                if prev in (("p", "."), ("p", "?.")):
                    q, parts = i - 1, []
                    while q >= 1 and toks[q] in (("p", "."), ("p", "?.")) and toks[q - 1][0] == "id":
                        parts.insert(0, toks[q - 1][1])
                        q -= 2
                    recv = ".".join(parts) if parts else "<expr>"
                kind = "new" if prev == ("id", "new") else ("attr" if recv else "name")
                self.ix.add_site(CallSite(v, kind, args, kwargs, self.sf, None, line, recv=recv or None))
                callee = (recv + "." if recv else "") + v
                if (lang == "js" and v in JS_WALK) or (lang == "swift" and v in SWIFT_WALK):
                    span = " ".join(str(toks[q][1]) for q in range(at, min(end, n)) if toks[q][0] == "id")
                    self.walks.append((line, v, callee, args, kwargs, span + " " + src_lines[line - 1]))
                continue
            if prev not in (("p", "."), ("p", "?."), ("id", "new"), ("id", "class"), ("id", "const"), ("id", "let"),
                            ("id", "var")):
                self.ix.refs.add(v)
        # the anonymous arrows' parameters
        for i in range(n):
            if toks[i] == ("p", "(") and i not in named_defs and closer.get(i, n) < n and toks[closer[i]] == ("p", "=>"):
                for pn, _d in self._params(toks, i, closer, expr_at, lang):
                    pn = pn.lstrip(".*")
                    self.params.setdefault(pn, []).append(Param(pn, "open", None, None))
        # the de-quoted views, only for lines that could hold a shell form
        by_line = {}
        for i in range(n):
            by_line.setdefault(tl[i], []).append(i)
        for line, idxs in sorted(by_line.items()):
            seg = " ".join(str(toks[i][1]) if toks[i][0] != "tmpl" else _tmpl_text(toks[i][1]) for i in idxs
                           if toks[i][0] in ("str", "tmpl"))
            if not seg or not _hint(seg):
                continue
            self.views.append((line, _code_items([toks[i] for i in idxs], lang)))

    def _params(self, toks, at, closer, expr_at, lang):
        """[(name, default IR or None)] of the parameter list whose `(` is toks[at]; a rest parameter keeps its
        `...`/`*`; a destructured name is `...name` (it reads open)."""
        end = closer.get(at, len(toks)) - 1
        out, i = [], at + 1
        while i < end:
            j, depth = i, 0
            while j < end and not (depth == 0 and toks[j] == ("p", ",")):
                if toks[j][0] == "p" and toks[j][1] in "([{":
                    depth += 1
                elif toks[j][0] == "p" and toks[j][1] in ")]}":
                    depth -= 1
                j += 1
            seg = toks[i:j]
            if seg:
                if seg[0] in (("p", "{"), ("p", "[")):
                    for t in seg:
                        if t[0] == "id":
                            out.append(("..." + t[1], None))
                elif seg[0] in (("p", "..."), ("p", "*")):
                    rest = [t for t in seg if t[0] == "id"]
                    if rest:
                        out.append(("..." + rest[0][1], None))
                elif seg[0][0] == "id":
                    name = seg[0][1]
                    eq = next((q for q in range(i, j) if toks[q] == ("p", "=")), None)
                    out.append((name, expr_at(eq + 1) if eq is not None else None))
            i = j + 1
        return out

    def _import_val(self, mod, attr):
        target = self.ix.js_module_file(self.sf.path, mod)
        if target is not None:
            if attr in (None, "default"):
                return ("vals", F([("module", target)]))
            return ("importfrom", target, attr)
        canon = _js_canon_module(mod)
        if attr in (None, "default"):
            return ("vals", F([("canon", canon)]))
        return ("vals", F([("canon", canon + "." + attr)]))

    def _func(self, name, line, params):
        key = (self.sf.fid, line, name)
        fi = self.ix.funcs.get(key)
        if fi is None:
            fi = FuncInfo(key, name, self.sf, "js" if self.sf.lang != "py" else "pyline", line)
            for pn, d in params:
                rest = pn.startswith(("...", "*"))
                pn = pn.lstrip(".*")
                if not pn:
                    continue
                p = Param(pn, "var" if rest else "pos", d, fi)
                fi.params[pn] = p
                if rest:
                    fi.has_var = True
                else:
                    fi.positional.append(p)
            self.ix.funcs[key] = fi
            if name:
                self.ix.funcs_by_name.setdefault(name, []).append(fi)
        for p in fi.params.values():
            self.params.setdefault(p.name, []).append(p)
        return fi

    # shell --------------------------------------------------------------------------------------------------------
    def _shell(self, lang):
        lines = self.sf.lines
        i = 0
        delim = None
        while i < len(lines):
            start, buf = i + 1, lines[i]
            while buf.endswith("\\") and i + 1 < len(lines):
                i += 1
                buf = buf[:-1] + " " + lines[i]
            i += 1
            s = buf.strip()
            if delim is not None:
                if s == delim:
                    delim = None
                    continue
                self.heredoc.add(start)
            elif lang == "sh":
                m = HEREDOC_RE.search(buf)
                delim = m.group(2) if m else None
            if not s or s.startswith("#") or (lang == "conf" and s.startswith(("//", ";"))):
                continue
            if lang == "make":
                s = s.lstrip("@-+")
                m = re.match(r"([A-Za-z_][\w.]*)\s*[:?+]?=\s*(.*)$", s)
                if m and not s.startswith("\t"):
                    self.shell_vars.setdefault(m.group(1), []).append(([[("lit", m.group(2), True)]], start))
            if not SHELL_HINT.search(s) and not re.search(r"[A-Za-z_]\w*=|\bread\b", s) and \
                    not (lang in ("sh", "make") and "*" in s):
                continue
            items = shell_items([("t", s)], self.sf.lang)
            self.views.append((start, items))
            self._shell_bindings(start, items)
            if lang == "conf":
                strs = [t for t in _js_tokens(s, "js") if t[0] in ("str", "tmpl")]
                if strs:
                    segs = []
                    for t in strs:
                        segs.append(("t", t[1] if t[0] == "str" else "".join(p[1] for p in t[1] if p[0] == "t")))
                        segs.append(("t", " "))
                    self.views.append((start, shell_items(segs, "sh")))

    def _shell_bindings(self, line, items):
        k = 0
        while k < len(items):
            w = items[k]
            if w is not SEP and w and w[0][0] == "lit":
                m = re.match(r"([A-Za-z_]\w*)=(.*)$", w[0][1], re.S)
                if m and not w[0][2]:
                    rest = [("lit", m.group(2), False)] + list(w[1:]) if m.group(2) else list(w[1:])
                    self.shell_vars.setdefault(m.group(1), []).append(([rest or [("lit", "", False)]], line))
                elif _wtext(w) == "for" and k + 2 < len(items) and _wtext(items[k + 2]) == "in":
                    name = _wtext(items[k + 1]) or ""
                    vals, j = [], k + 3
                    while j < len(items) and items[j] is not SEP and _wtext(items[j]) != "do":
                        vals.append(items[j])
                        j += 1
                    self.shell_vars.setdefault(name, []).append((vals or [[("lit", "", False)]], line))
                elif _wtext(w) == "read":
                    j = k + 1
                    while j < len(items) and items[j] is not SEP:
                        t = _wtext(items[j]) or ""
                        if t and not t.startswith("-"):
                            self.shell_vars.setdefault(t, []).append((None, line))
                        j += 1
            k += 1


def _hint(text):
    """A code string (or a code line's strings) that could hold a shell form: a SHELL_HINT word or `**`, or a GLOB_CMDS
    word with a `*` after it on its line (a bare glob)."""
    return bool(SHELL_HINT.search(text) or GLOB_HINT.search(text))


HEREDOC_RE = re.compile(r"(?<!<)<<-?\s*(['\"]?)([A-Za-z_][\w.-]*)\1")
SHELL_HINT = re.compile(r"(?<![\w.$-])(?:find|ls|grep|egrep|fgrep|rg|ripgrep|git|for|cp|gcp|rsync|ditto|tar|gtar|bsdtar|zip)"
                        r"(?![\w$-])|\*\*")


def _closers(toks):
    """{index of an opening bracket token: index just past its closer}."""
    out, stack = {}, []
    for i, t in enumerate(toks):
        if t[0] == "p":
            if t[1] in ("(", "[", "{"):
                stack.append(i)
            elif t[1] in (")", "]", "}") and stack:
                out[stack.pop()] = i + 1
    return out


def _import_of(ir):
    """The module a `require('m')` / `import('m')` IR names, or None."""
    while ir[0] == "item":
        ir = ir[1]
    if ir[0] == "call" and ir[1][0] == "name" and ir[1][1] in ("require", "import") and ir[2] and ir[2][0][0] == "lit":
        return ir[2][0][1]
    return None


def _js_canon_module(mod):
    mod = mod[5:] if mod.startswith("node:") else mod
    return {"fs/promises": "fs.promises", "path/posix": "path.posix", "timers/promises": "timers.promises"}.get(mod, mod)


def _tmpl_text(parts):
    return "".join(p[1] for p in parts if p[0] == "t")


def _code_items(toks, lang):
    """The de-quoted view of a code line's tokens: each string literal's content shell-lexed (interpolations as host
    parts), each identifier chain a host word, `;` a separator."""
    items = []
    k = 0
    while k < len(toks):
        t = toks[k]
        if t[0] == "str":
            items.extend(shell_items([("t", t[1])], "sh", argv_quoted=True))
        elif t[0] == "tmpl":
            segs = [("t", p[1]) if p[0] == "t" else ("x", _parse_cached(p[1], lang)) for p in t[1]]
            items.extend(shell_items(segs, "sh", argv_quoted=True))
        elif t[0] == "id" and t[1] not in JS_KEYWORDS:
            ir = ("name", t[1])
            while k + 2 < len(toks) and toks[k + 1] == ("p", ".") and toks[k + 2][0] == "id":
                ir = ("attr", ir, toks[k + 2][1])
                k += 2
            items.append([("host", ir)])
        elif t == ("p", ";"):
            items.append(SEP)
        k += 1
    return items


# ---- shell words ----------------------------------------------------------------------------------------------------

SEP = None   # a command separator among words


def shell_items(segs, lang, argv_quoted=False):
    """Words (each a list of parts: ("lit", s, quoted), ("var", name), ("cmd", text), ("host", ir), ("tilde",)) and
    SEP markers, from text segments ("t", text) and host placeholders ("x", ir)."""
    items, cur = [], []
    state = {"q": None}

    def lit(s, quoted):
        if cur and cur[-1][0] == "lit" and cur[-1][2] == quoted:
            cur[-1] = ("lit", cur[-1][1] + s, quoted)
        else:
            cur.append(("lit", s, quoted))

    def flush():
        if cur:
            items.append(list(cur))
            del cur[:]

    for seg in segs:
        if seg[0] == "x":
            cur.append(("host", seg[1]))
            continue
        text, i, n = seg[1], 0, len(seg[1])
        while i < n:
            c = text[i]
            q = state["q"]
            if q == "'":
                if c == "'":
                    state["q"] = None
                    if not cur:
                        lit("", True)
                else:
                    lit(c, True)
                i += 1
                continue
            if q == '"':
                if c == '"':
                    state["q"] = None
                    if not cur:
                        lit("", True)
                    i += 1
                elif c == "\\" and i + 1 < n and text[i + 1] in '$`"\\':
                    lit(text[i + 1], True)
                    i += 2
                elif c == "$":
                    i = _dollar(text, i, cur, lit, True, lang)
                elif c == "`":
                    j = text.find("`", i + 1)
                    j = n if j < 0 else j
                    cur.append(("cmd", text[i + 1:j]))
                    i = j + 1
                else:
                    lit(c, True)
                    i += 1
                continue
            if c in " \t\r":
                flush()
                i += 1
            elif c in ";|&()\n":
                flush()
                if not items or items[-1] is not SEP:
                    items.append(SEP)
                i += 1
            elif c == "'":
                state["q"] = "'"
                i += 1
            elif c == '"':
                state["q"] = '"'
                i += 1
            elif c == "\\" and i + 1 < n:
                lit(text[i + 1], True)
                i += 2
            elif c == "$":
                i = _dollar(text, i, cur, lit, False, lang)
            elif c == "`":
                j = text.find("`", i + 1)
                j = n if j < 0 else j
                cur.append(("cmd", text[i + 1:j]))
                i = j + 1
            elif c == "#" and not cur and not argv_quoted:
                j = text.find("\n", i)
                i = n if j < 0 else j
            elif c == "~" and not cur and (i + 1 == n or text[i + 1] in "/ \t;|&)"):
                cur.append(("tilde",))
                i += 1
            else:
                lit(c, False)
                i += 1
    flush()
    return items


def _dollar(text, i, cur, lit, quoted, lang):
    n = len(text)
    if text.startswith("$((", i):
        j = _balanced(text, i + 1, "(", ")")
        lit(text[i:j], True)   # arithmetic: its `*` is no glob
        return j
    if text.startswith("$(", i):
        j = _balanced(text, i + 1, "(", ")")
        inner = text[i + 2:j - 1]
        if lang == "make" and re.fullmatch(r"[A-Za-z_][\w.]*", inner):
            cur.append(("var", inner))
        else:
            cur.append(("cmd", inner))
        return j
    if text.startswith("${", i):
        j = text.find("}", i)
        j = n if j < 0 else j
        m = re.match(r"[#!]?([A-Za-z_]\w*|\d+|[@*#?$!0-])", text[i + 2:j])
        cur.append(("var", m.group(1) if m else "?"))
        return j + 1
    m = re.match(r"[A-Za-z_]\w*|\d|[@*#?$!0-]", text[i + 1:])
    if m:
        cur.append(("var", m.group(0)))
        return i + 1 + m.end()
    lit("$", quoted)
    return i + 1


def _wtext(w):
    """A word's literal text, or None when any part is not literal."""
    if w is SEP or not w:
        return None
    if all(p[0] == "lit" for p in w):
        return "".join(p[1] for p in w)
    return None


def _wshape(w):
    """A word as a pattern shape: its literal text with every non-literal part read as `*`."""
    if w is SEP:
        return ""
    return "".join(p[1] if p[0] == "lit" else "*" for p in w)


def _starstar(w):
    s = _wshape(w)
    return s == "**" or s.startswith("**/") or "/**/" in s or s.endswith("/**")


def _pattern_filter(shape):
    seg = shape.rsplit("/", 1)[-1]
    return [("glob", seg)] if _has_glob(seg) and seg not in ("**",) else None


# ---- the resolver ---------------------------------------------------------------------------------------------------

JOIN = ("os.path.join", "posixpath.join", "path.join", "path.posix.join", "path.resolve", "path.posix.resolve")
PATHCTOR = ("pathlib.Path", "pathlib.PurePath", "pathlib.PosixPath", "pathlib.PurePosixPath", "URL.fileURLWithPath")
KEEP = ("os.path.abspath", "os.path.realpath", "os.path.normpath", "os.path.normcase", "os.fspath", "os.fsdecode",
        "os.fsencode", "str", "bytes", "sorted", "list", "tuple", "set", "frozenset", "iter", "reversed", "next",
        "path.normalize", "url.fileURLToPath", "String", "fs.realpathSync", "fs.realpathSync.native",
        "fs.promises.realpath", "Array.from", "Path", "URL")
CLIMB = ("os.path.dirname", "path.dirname", "path.posix.dirname")
HOMES = ("pathlib.Path.home", "os.homedir", "NSHomeDirectory")
CWDS = ("os.getcwd", "os.getcwdb", "pathlib.Path.cwd", "process.cwd")
TMPS = ("tempfile.mkdtemp", "tempfile.TemporaryDirectory", "tempfile.mkstemp", "tempfile.NamedTemporaryFile",
        "tempfile.mktemp", "tempfile.SpooledTemporaryFile", "tempfile.TemporaryFile", "fs.mkdtempSync", "fs.mkdtemp",
        "fs.promises.mkdtemp")
TMPDIRS = ("tempfile.gettempdir", "tempfile.gettempdirb", "os.tmpdir", "NSTemporaryDirectory")
ENVGET = ("os.getenv", "os.environ.get")
INPUTS = ("input", "sys.stdin.read", "sys.stdin.readline")
WALKVAL = ("os.walk", "os.fwalk", "os.scandir", "glob.glob", "glob.iglob", "shutil.copytree")
ARCHIVES = {"tarfile.open": "<tarfile>", "tarfile.TarFile": "<tarfile>", "tarfile.TarFile.open": "<tarfile>",
            "tarfile.TarFile.taropen": "<tarfile>", "tarfile.TarFile.gzopen": "<tarfile>",
            "tarfile.TarFile.bz2open": "<tarfile>", "tarfile.TarFile.xzopen": "<tarfile>", "zipfile.ZipFile": "<zipfile>",
            "zipfile.PyZipFile": "<zipfile>"}
CANON_VALUES = {
    "os.curdir": lambda r: STR("."), "os.pardir": lambda r: STR(".."), "tempfile.tempdir": lambda r: STR(_tmpdir()),
    "sys.argv": lambda r: ("argv",), "process.argv": lambda r: ("argv",), "CommandLine.arguments": lambda r: ("argv",),
    "os.environ": lambda r: ("env",), "process.env": lambda r: ("env",),
    "ProcessInfo.processInfo.environment": lambda r: ("env",),
    "FileManager.default.temporaryDirectory": lambda r: STR(_tmpdir()),
    "FileManager.default.currentDirectoryPath": lambda r: ("repo", (), False),
    "FileManager.default.homeDirectoryForCurrentUser": lambda r: STR(_home()),
}
KEEP_METHODS = ("resolve", "absolute", "as_posix", "strip", "rstrip", "lstrip", "decode", "encode", "__fspath__",
                "toString", "normalize", "realpath", "readlink", "standardized", "standardizedFileURL",
                "resolvingSymlinksInPath", "trim", "trimEnd", "trimStart", "valueOf")
UNDER_METHODS = ("iterdir", "glob", "rglob", "walk")
PY_BUILTINS = frozenset("str bytes sorted list tuple set frozenset iter reversed next input open print len dict "
                        "enumerate zip map filter range min max sum any all repr int float bool type isinstance "
                        "getattr setattr hasattr super object Exception".split())
JS_GLOBALS = frozenset("process require URL String Array Object JSON Math Number Boolean Promise Buffer console "
                       "Symbol Map Set Date RegExp Error".split())


class Index:
    def __init__(self, files, places, deadline):
        self.files = files
        self.by_path = {f.path: f for f in files if not f.step}
        self.places = places
        self.deadline = deadline
        self.funcs, self.funcs_by_name, self.classes, self.classes_by_name = {}, {}, {}, {}
        self.sites = {}
        self.refs = set()
        self.lambda_of = {}
        self.home, self.tmpdir = _home(), _tmpdir()
        self.place_pairs = []
        for p in places:
            for q in {os.path.normpath(p), os.path.realpath(p)}:
                if q not in self.place_pairs:
                    self.place_pairs.append(q)
        for f in files:
            self.tick()
            if f.binary:
                continue
            if f.lang == "py" and not f.step:
                try:
                    tree = ast.parse(f.text, f.path)
                except (SyntaxError, ValueError, RecursionError, MemoryError):
                    tree = None
                if tree is not None:
                    try:
                        f.py = PyFile(f, self, tree)
                        continue
                    except RecursionError:
                        f.py = None
            f.lx = LineFile(f, self)

    def tick(self):
        if time.monotonic() > self.deadline:
            raise _Budget()

    def add_site(self, site):
        self.sites.setdefault(site.name, []).append(site)

    def module_file(self, importer, mod, level):
        """The tracked Python file a module name names, from `importer` (repo-relative), or None."""
        if not mod and not level:
            return None
        base = posixpath.dirname(importer)
        if level:
            for _ in range(level - 1):
                base = posixpath.dirname(base)
            cands = [base]
        else:
            cands = [base, ""]
            d = base
            while d:
                d = posixpath.dirname(d)
                cands.append(d)
        rel = mod.replace(".", "/") if mod else ""
        for d in cands:
            for p in ((posixpath.join(d, rel) + ".py") if rel else None, posixpath.join(d, rel, "__init__.py")):
                if p and p in self.by_path:
                    return self.by_path[p].fid
        return None

    def js_module_file(self, importer, mod):
        if not mod.startswith("."):
            return None
        p = posixpath.normpath(posixpath.join(posixpath.dirname(importer), mod))
        for c in [p] + [p + e for e in JS_EXT] + [posixpath.join(p, "index" + e) for e in JS_EXT]:
            if c in self.by_path:
                return self.by_path[c].fid
        return None

    def place_rel(self, p):
        """("equal"|"ancestor", ()) or ("inside", segs) for an absolute path against the places, or None."""
        best = None
        for cand in {os.path.normpath(p), os.path.realpath(p)}:
            for q in self.place_pairs:
                if cand == q:
                    return ("equal", ())
                if q.startswith(cand.rstrip("/") + "/") or cand == "/":
                    best = best or ("ancestor", ())
                elif cand.startswith(q.rstrip("/") + "/"):
                    segs = tuple(x for x in cand[len(q):].split("/") if x)
                    if best is None or best[0] == "inside" and len(segs) < len(best[1]):
                        best = ("inside", segs)
        return best


class Resolver:
    def __init__(self, ix):
        self.ix = ix
        self.memo = {}
        self.stack = []
        self.on = {}
        self.files = {f.fid: f for f in ix.files}

    # entry ---------------------------------------------------------------------------------------------------------
    def ev(self, ir, ctx, depth):
        """The values of `ir` evaluated in ctx (file, scope, line)."""
        if depth > DEPTH:
            return F([DEPTH_V])
        key = ("param", id(ir)) if ir[0] == "param" else (ctx[0].fid, id(ir), id(ctx[1]))
        if key in self.memo:
            return self.memo[key]
        if key in self.on:
            pos = self.on[key]
            for fr in self.stack[pos + 1:]:
                fr[1] = True
            return F()
        self.on[key] = len(self.stack)
        frame = [key, False]
        self.stack.append(frame)
        try:
            self.ix.tick()
            out = self._ev(ir, ctx, depth)
        finally:
            self.stack.pop()
            del self.on[key]
        # A result that cut a cycle is exact for this evaluation (the cycle edge added nothing), but another entry
        # point could reach more through that edge: it is memoised with `open` added, so a reuse over-counts and
        # never under-counts (and the chase stays linear in the graph).
        self.memo[key] = out if not frame[1] else out | F([OPEN])
        return out

    def _ev(self, ir, ctx, depth):
        k = ir[0]
        if k == "lit":
            return F([STR(ir[1])])
        if k == "int":
            return F([("int", ir[1])])
        if k == "const":
            return F([NONE])
        if k == "open":
            return F([OPEN])
        if k == "vals":
            return ir[1]
        if k == "param":
            return self.param(ir[1], depth)
        if k == "union":
            out = set()
            for p in ir[1]:
                out |= self.ev(p, ctx, depth)
            return F(out)
        if k in ("item",):
            return self.ev(ir[1], ctx, depth)
        if k == "nonecwd":
            # a root where None (or undefined) means the cwd (os.listdir(None), glob's root_dir=None, a JS glob's
            # cwd: undefined); a number there is a descriptor nobody can place
            return F(STR(".") if v[0] == "none" else (OPEN if v[0] == "int" else v) for v in self.ev(ir[1], ctx, depth))
        if k == "tmpl":
            return compose([self.ev(p, ctx, depth) for p in ir[1]], join=False)
        if k == "join":
            return compose([self.ev(p, ctx, depth) for p in ir[1]], join=True)
        if k == "name":
            return self.name(ir[1], ctx, depth)
        if k == "attr":
            out = set()
            for v in self.ev(ir[1], ctx, depth):
                out |= self.attr(v, ir[2], ctx, depth)
            return F(out)
        if k == "index":
            return self.index(self.ev(ir[1], ctx, depth), self.ev(ir[2], ctx, depth))
        if k == "call":
            return self.call(ir, ctx, depth)
        if k == "importfrom":
            f = self.files[ir[1]]
            return self.module_name(f, ir[2], depth + 1)
        if k == "obj":
            out = set()
            for v in ir[1].values():
                out |= self.ev(v, ctx, depth)
            return F(out)
        if k == "shellword":
            return self.word(ir[1], ctx, depth)
        return F([OPEN])

    def files_lang(self, ctx):
        return ctx[0].lang if ctx[0].lang in ("js", "swift", "py") else "js"

    # names ---------------------------------------------------------------------------------------------------------
    def name(self, n, ctx, depth):
        f, scope, line = ctx
        if f.py is not None and scope is not None:
            s = scope
            while s is not None:
                vals, found = set(), False
                if n in s.params:
                    found = True
                    fi = s.func
                    if fi is not None and fi.is_method and not fi.is_static and fi.positional and \
                            fi.positional[0].name == n and fi.cls is not None:
                        vals.add(("cls" if fi.is_classmethod else "inst", fi.cls.key))
                    else:
                        vals |= self.ev(s.params[n].ir, ctx, depth)
                if n in s.bindings:
                    found = True
                    for b in s.bindings[n]:
                        vals |= self.ev(b, (f, s, 0), depth + 1)
                if found:
                    return F(vals)
                s = s.parent
            if n == "__file__":
                return F([("repo", f.segs, False)])
            if n in PY_BUILTINS:
                return F([("canon", n)])
            return F([OPEN])
        return self.line_name(f, n, depth)

    def line_name(self, f, n, depth):
        lx = f.lx
        if n in ("__dirname",):
            return F([("repo", f.segs[:-1], False)])
        if n in ("__filename", "#file", "#filePath"):
            return F([("repo", f.segs, False)])
        if n == "__file__" and f.lang == "py":
            return F([("repo", f.segs, False)])
        if n == "import":
            return F([("jsimport",)])
        if n in ("this", "self") and lx is not None and f.lang in ("js", "swift"):
            return F([("jsthis", f.fid)])
        if lx is None:
            return F([OPEN])
        if n in lx.imports:
            return self.ev(lx.imports[n], (f, None, 0), depth + 1)
        vals, found = set(), False
        for ir, line in lx.bindings.get(n, ()):
            found = True
            vals |= self.ev(ir, (f, None, line), depth + 1)
        for p in lx.params.get(n, ()):
            found = True
            vals |= self.ev(p.ir, (f, None, 0), depth)
        if found:
            return F(vals)
        if f.lang == "py" and n in PY_BUILTINS or n in JS_GLOBALS:
            return F([("canon", n)])
        if f.lang == "swift" and n[:1].isupper():
            return F([("canon", n)])
        return F([OPEN])

    def module_name(self, f, n, depth):
        if f.py is not None:
            return self.name(n, (f, f.py.module, 0), depth)
        return self.line_name(f, n, depth)

    # parameters (the call-site chase) ------------------------------------------------------------------------------
    def param(self, p, depth):
        fi = p.func
        if fi is None or p.kind in ("var", "kw", "open"):
            return F([OPEN])
        if not fi.name:
            return F([OPEN])
        if fi.name in self.ix.refs:
            return F([OPEN])
        sites = self.sites_of(fi)
        if not sites:
            if p.name in FIXTURES:
                if p.name in self.ix.funcs_by_name:
                    return F([OPEN])
                return F([TMP])
            return F([OPEN])
        out = set()
        for s in sites:
            out |= self.align(fi, p, s, depth)
        return F(out) if out else F([OPEN])

    def sites_of(self, fi):
        if fi.name == "__init__" and fi.cls is not None:
            return [s for s in self.ix.sites.get(fi.cls.name, ()) if s.kind in ("name", "new")] + \
                list(self.ix.sites.get("__init__", ()))
        if fi.name == "constructor":
            return [s for sites in self.ix.sites.values() for s in sites if s.kind == "new"]
        return list(self.ix.sites.get(fi.name, ()))

    def align(self, fi, p, s, depth):
        skip = 0
        if fi.lang == "py" and fi.is_method:
            if fi.is_classmethod:
                skip = 1
            elif fi.is_static:
                skip = 0
            elif s.kind in ("attr", "super", "new") or (fi.name == "__init__" and s.kind == "name"):
                skip = 1
                if s.kind == "attr" and s.recv and s.recv in self.ix.classes_by_name:
                    skip = 0   # ClassName.f(...): an unbound call
        if any(a[0] == "star" for a in s.args) or any(k is None for k, _ in s.kwargs):
            return F([OPEN])
        plist = fi.positional[skip:]
        names = set(fi.params)
        if len(s.args) > len(plist) and not fi.has_var:
            return F([OPEN])
        for k, _ in s.kwargs:
            if k not in names and not fi.has_kw:
                return F([OPEN])
        sctx = (s.file, s.scope, s.line)
        if p.kind == "pos":
            if p not in plist:
                return F([OPEN])
            i = plist.index(p)
            if i < len(s.args):
                return self.ev(s.args[i], sctx, depth + 1)
        for k, v in s.kwargs:
            if k == p.name:
                return self.ev(v, sctx, depth + 1)
        if p.default is not None:
            if fi.lang != "py":
                return self.ev(p.default, (fi.file, None, fi.line), depth + 1)
            return self.ev(p.default, (fi.file, fi.def_scope, 0), depth + 1)
        return F([OPEN])

    # attributes, indexes and calls ----------------------------------------------------------------------------------
    def attr(self, v, a, ctx, depth):
        k = v[0]
        if k == "canon":
            d = v[1] + "." + a
            if d in CANON_VALUES:
                return F([CANON_VALUES[d](self)])
            return F([("canon", d)])
        if k == "module":
            return self.module_name(self.files[v[1]], a, depth + 1)
        if k == "inst" or k == "cls":
            # the class and its scanned bases (by name): a method is the first found; an attribute is the union of every
            # binding along the chain, and of every scanned subclass that binds it too
            todo, seen, chain = [self.ix.classes.get(v[1])], set(), []
            while todo:
                ci = todo.pop(0)
                if ci is None or ci.key in seen or len(seen) > 16:
                    continue
                seen.add(ci.key)
                chain.append(ci)
                for b in ci.bases:
                    todo.extend(self.ix.classes_by_name.get(b, ()))
            binders = [ci for ci in chain if a in ci.attrs]
            names = {ci.name for ci in chain}
            binders += [o for o in self.ix.classes.values() if o not in binders and a in o.attrs and set(o.bases) & names]
            if binders:
                out = set()
                for ci in binders:
                    for ir, scope in ci.attrs[a]:
                        out |= self.ev(ir, (ci.file, scope, 0), depth + 1)
                return F(out)
            for ci in chain:
                if a in ci.methods:
                    return F([("bound", ("func", ci.methods[a].key), "__method__")]) if k == "inst" else \
                        F([("func", ci.methods[a].key)])
            return F([OPEN])
        if k == "env":
            return F([STR(self.ix.home)]) if a == "HOME" else (F([STR(self.ix.tmpdir)]) if a == "TMPDIR" else F([INPUT]))
        if k == "jsimport":
            return F([("jsmeta",)]) if a == "meta" else F([OPEN])
        if k == "jsmeta":
            f = ctx[0]
            if a in ("url", "filename"):
                return F([("repo", f.segs, False)])
            if a == "dirname":
                return F([("repo", f.segs[:-1], False)])
            return F([OPEN])
        if k == "jsthis":
            f = self.files[v[1]]
            out = set()
            for ir, line in f.lx.this_attrs.get(a, ()):
                out |= self.ev(ir, (f, None, line), depth + 1)
            return F(out) if out else F([OPEN])
        if k in ("str", "path", "repo", "cwd") or k in STICKY:
            if a == "parent":
                return F([climb(v, 1)])
            if a == "parents":
                return F([("parents", v)])
            return F([("bound", v, a)])
        if k == "none":
            return F([NONE])
        return F([("bound", v, a)])

    def index(self, bases, idxs):
        out = set()
        for b in bases:
            k = b[0]
            if k == "argv":
                out.add(INPUT)
            elif k == "env":
                for i in idxs:
                    if i == STR("HOME"):
                        out.add(STR(self.ix.home))
                    elif i == STR("TMPDIR"):
                        out.add(STR(self.ix.tmpdir))
                    else:
                        out.add(INPUT)
            elif k == "parents":
                ns = [i[1] for i in idxs if i[0] == "int"]
                if not ns or len(ns) != len(idxs):
                    out.add(climb(b[1], 10 ** 6))
                for n in ns:
                    out.add(climb(b[1], n + 1))
            elif k == "bound" and b[1][0] in STICKY:
                out.add(b[1])
            else:
                out.add(b)
        return F(out)

    def call(self, ir, ctx, depth):
        _k, fir, args, kwargs, new = ir
        # `this.x(...)` / `self.x(...)` in a line-resolved file: its this-attr bindings are no callee we can read
        callees = self.ev(fir, ctx, depth)
        out = set()
        for cv in callees:
            out |= self.call_value(cv, fir, args, kwargs, new, ctx, depth)
        return F(out)

    def argvals(self, args, kwargs, ctx, depth, i=0, kw=None):
        if kw is not None:
            for k, v in kwargs:
                if k == kw:
                    return self.ev(v, ctx, depth)
        if i < len(args):
            a = args[i]
            return self.ev(a[1] if a[0] == "star" else a, ctx, depth)
        return None

    def call_value(self, cv, fir, args, kwargs, new, ctx, depth):
        k = cv[0]
        if k == "canon":
            return self.canon_call(cv[1], fir, args, kwargs, new, ctx, depth)
        if k == "func":
            fi = self.ix.funcs.get(cv[1])
            if fi is None or fi.scope is None and fi.lang == "py":
                return F([OPEN])
            if fi.lang != "py":
                return F([OPEN])
            if not fi.scope.returns:
                return F([NONE])
            out = set()
            for r in fi.scope.returns:
                out |= self.ev(r, (fi.file, fi.scope, 0), depth + 1)
            return F(out)
        if k == "cls":
            return F([("inst", cv[1])])
        if k == "bound":
            return self.method(cv[1], cv[2], args, kwargs, ctx, depth)
        if k in STICKY:
            return F([cv])
        if k == "none":
            return F([NONE])
        return F([OPEN])

    def canon_call(self, d, fir, args, kwargs, new, ctx, depth):
        av = lambda i=0, kw=None: self.argvals(args, kwargs, ctx, depth, i, kw)  # noqa: E731
        allargs = [a[1] if a[0] == "star" else a for a in args] + [v for _k, v in kwargs]
        if d in JOIN:
            if any(a[0] == "star" for a in args):
                return F([OPEN])
            return compose([self.ev(a, ctx, depth) for a in args], join=True)
        if d in PATHCTOR or (d in ("Path",) and ctx[0].lang == "py"):
            if not args:
                return F([STR(".")])
            return compose([self.ev(a[1] if a[0] == "star" else a, ctx, depth) for a in args], join=True)
        if d == "URL" and new:
            base = av(1)
            rel = av(0)
            out = set()
            if rel is None:
                return F([OPEN])
            for r in rel:
                if r[0] == "str" and r[1].startswith("file://"):
                    out.add(STR(r[1][len("file://"):]))
                elif r[0] == "str" and base is not None:
                    for b in base:
                        out.add(_append_segs(climb(b, 1), r[1].split("/")))
                else:
                    out.add(OPEN if base is None else r)
                    if base is not None:
                        out |= {mark_unknown(climb(b, 1)) for b in base}
            return F(out)
        if d in KEEP:
            v = av(0)
            return v if v is not None else F([NONE])
        if d in CLIMB:
            v = av(0)
            return F(climb(x, 1) for x in v) if v is not None else F([OPEN])
        if d == "os.path.expanduser":
            v = av(0, "path")
            if v is None:
                return F([OPEN])
            e = args[0] if args else kwargs[0][1]
            return self.expanduser(v, e, ctx, depth)
        if d in HOMES:
            return F([STR(self.ix.home)])
        if d in CWDS:
            return F([("repo", (), False)])
        if d in TMPS:
            return F([TMP])
        if d in TMPDIRS:
            return F([STR(self.ix.tmpdir)])
        if d in ENVGET:
            key = av(0)
            out = set()
            for kv in key or ():
                if kv == STR("HOME"):
                    out.add(STR(self.ix.home))
                elif kv == STR("TMPDIR"):
                    out.add(STR(self.ix.tmpdir))
                else:
                    out.add(INPUT)
            dflt = av(1, "default")
            if dflt is not None:
                out |= dflt
            return F(out or [INPUT])
        if d in INPUTS:
            return F([INPUT])
        if d in ARCHIVES:
            return F([("canon", ARCHIVES[d])])   # an archive object: its .add / .write are walks (_py_walks)
        if d in WALKVAL:
            v = av(0)
            if d.startswith("glob."):
                pat = av(0, "pathname")
                return F(mark_unknown(x) if x[0] != "str" else (as_origin(x) or OPEN) for x in (pat or [STR(".")]))
            return F(mark_unknown(x) for x in (v or [STR(".")]))
        if d.startswith(("subprocess.", "child_process.")) or d in ("execSync", "execFileSync", "spawnSync"):
            for a in allargs:
                for v in self.ev(a, ctx, depth):
                    if v[0] == "str" and "--show-toplevel" in v[1]:
                        return F([("repo", (), False)])
            return F([OPEN])
        if d == "require" and args:
            m = args[0]
            if m[0] == "lit":
                t = self.ix.js_module_file(ctx[0].path, m[1])
                return F([("module", t)]) if t is not None else F([("canon", _js_canon_module(m[1]))])
            return F([OPEN])
        if d.endswith(".mktemp") or d == "mktemp":
            return F([TMP])
        if d.endswith((".parse_args", ".parse_known_args")):
            return F([INPUT])
        return F([OPEN])

    def method(self, v, m, args, kwargs, ctx, depth):
        k = v[0]
        if m == "__method__":
            return self.call_value(v, None, args, kwargs, False, ctx, depth)
        if k == "func":
            return F([OPEN])
        if k == "env" or (k == "bound" and False):
            return F([INPUT])
        if m in ("mktemp",):
            return F([TMP])
        if m in ("parse_args", "parse_known_args"):
            return F([INPUT])
        if k in STICKY:
            if k == "tmp" and m in ("parent",):
                return F([climb(v, 1)])
            return F([v])
        if k == "argv":
            return F([INPUT])
        if k not in PATHLIKE:
            return F([OPEN])
        if m in KEEP_METHODS:
            return F([v])
        if m == "expanduser":
            return self.expanduser(F([v]), ("vals", F([v])), ctx, depth)
        if m in ("joinpath", "appendingPathComponent", "appending"):
            return compose([F([v])] + [self.ev(a[1] if a[0] == "star" else a, ctx, depth) for a in args] +
                           [self.ev(x, ctx, depth) for _kk, x in kwargs], join=True)
        if m in ("with_name", "with_suffix", "with_stem", "deletingPathExtension"):
            return F([mark_unknown(climb(v, 1))])
        if m in ("deletingLastPathComponent",):
            return F([climb(v, 1)])
        if m in UNDER_METHODS:
            return F([mark_unknown(v)])
        if m == "format" and k == "str":
            parts = [F([STR(v[1].split("{", 1)[0])]), F([OPEN])]
            parts += [self.ev(a[1] if a[0] == "star" else a, ctx, depth) for a in args]
            parts += [self.ev(x, ctx, depth) for _kk, x in kwargs]
            return compose(parts, join=False)
        return F([OPEN])

    def expanduser(self, vals, e_ir, ctx, depth):
        out = set()
        prefix = None
        for v in vals:
            if v[0] == "bound":
                v = as_origin(v) or NONE
            k = v[0]
            if k == "str":
                s = v[1]
                out.add(STR(self.ix.home + s[1:]) if s == "~" or s.startswith("~/") else v)
            elif k == "cwd" and v[1][:1] == ("~",):
                out.add(("path", posixpath.join(self.ix.home, *v[1][1:]), v[2]) if v[1][1:] else
                        ("path", self.ix.home, v[2]))
            elif k in ("path", "repo", "cwd", "tmp", "homeopen") or k in ("none", "int"):
                out.add(v)
            else:
                if prefix is None:
                    prefix = self.literal_prefix(e_ir, ctx, depth)
                    if prefix == "~" or prefix.startswith("~/"):
                        prefix = self.ix.home + prefix[1:]
                if prefix.startswith("/"):
                    rel = self.ix.place_rel(posixpath.normpath(prefix))
                    if rel is not None and rel[0] in ("equal", "inside"):
                        out.add(("path", posixpath.normpath(prefix), True))
                        continue
                out.add(HOMEOPEN)
        return F(out)

    def literal_prefix(self, ir, ctx, depth):
        k = ir[0]
        if k == "lit":
            return ir[1]
        if k == "tmpl":
            s = ""
            for p in ir[1]:
                if p[0] != "lit":
                    break
                s += p[1]
            return s
        if k == "join":
            s = ""
            for p in ir[1]:
                if p[0] != "lit":
                    break
                s = posixpath.join(s, p[1]) if s else p[1]
            return s
        if k == "call":
            canon = [v[1] for v in self.ev(ir[1], ctx, depth) if v[0] == "canon"]
            if canon and all(c in JOIN or c in PATHCTOR for c in canon):
                return self.literal_prefix(("join", [a for a in ir[2] if a[0] != "star"]), ctx, depth)
        return ""

    # shell words ---------------------------------------------------------------------------------------------------
    def word(self, w, ctx, depth):
        parts = []
        for p in w:
            k = p[0]
            if k == "lit":
                parts.append(F([STR(p[1])]))
            elif k == "tilde":
                parts.append(F([STR(self.ix.home)]))
            elif k == "var":
                parts.append(self.shell_var(p[1], ctx, depth))
            elif k == "cmd":
                parts.append(self.subst(p[1], ctx, depth))
            elif k == "host":
                parts.append(self.ev(p[1], ctx, depth))
            else:
                parts.append(F([OPEN]))
        return compose(parts, join=False) if parts else F([STR("")])

    def shell_var(self, n, ctx, depth):
        f = ctx[0]
        if n == "HOME":
            return F([STR(self.ix.home)])
        if n == "TMPDIR":
            return F([STR(self.ix.tmpdir)])
        if n in ("PWD", "CURDIR"):
            return F([("repo", (), False)])
        if n in ("0", "BASH_SOURCE"):
            return F([("repo", f.segs, False)]) if not f.step else F([("cwd", (), True)])
        if n[:1].isdigit() or n in ("@", "*", "#", "?", "!", "$", "-"):
            return F([INPUT])
        lx = f.lx
        if depth > DEPTH:
            return F([DEPTH_V])
        if lx is not None and n in lx.shell_vars:
            out = set()
            for words, line in lx.shell_vars[n]:
                if words is None:
                    out.add(INPUT)
                    continue
                for w in words:
                    out |= self.ev(("shellword", w), (f, None, line), depth + 1)
            return F(out)
        return F([INPUT])

    def subst(self, text, ctx, depth):
        items = shell_items([("t", text)], "sh")
        words = [w for w in items if w is not SEP]
        texts = [_wtext(w) for w in words]
        if "--show-toplevel" in texts:
            return F([("repo", (), False)])
        if texts and texts[0] == "mktemp":
            return F([TMP])
        if "pwd" in texts:
            if "cd" in texts:
                i = texts.index("cd")
                if i + 1 < len(words):
                    return self.word(words[i + 1], ctx, depth + 1)
            return F([("repo", (), False)])
        if texts and texts[0] == "dirname" and len(words) > 1:
            return F(climb(v, 1) for v in self.word(words[-1], ctx, depth + 1))
        if texts and texts[0] in ("realpath", "readlink") and len(words) > 1:
            return self.word(words[-1], ctx, depth + 1)
        return F([OPEN])


_PARSED = {}


def _parse_cached(text, lang):
    key = (text, lang)
    got = _PARSED.get(key)
    if got is None:
        got = _PARSED[key] = _parse_text(text, lang)
    return got


# ---- walk sites -----------------------------------------------------------------------------------------------------

def _py_walks(f, res):
    """The Python API walk sites of a parsed file: [Walk]."""
    out = []
    for node, scope, filt in f.py.walk_calls:
        ctx = (f, scope, 0)
        fn = node.func
        callee = res.ev(py_ir(fn), ctx, 0)
        canons = [v[1] for v in callee if v[0] == "canon"]
        args = node.args
        kw = {k.arg: k.value for k in node.keywords if k.arg}
        roots, pfilt = [], None
        if any(c in ("os.listdir", "os.scandir") for c in canons):
            # os.listdir(None) and os.scandir(None) list the cwd
            a = args[0] if args else kw.get("path")
            roots.append(("nonecwd", py_ir(a)) if a is not None else ("lit", "."))
        elif any(c in ("os.walk", "os.fwalk", "shutil.copytree") for c in canons):
            a = args[0] if args else kw.get("top") or kw.get("src")
            roots.append(py_ir(a) if a is not None else ("lit", "."))
        elif any(c in ("glob.glob", "glob.iglob") for c in canons):
            pat = args[0] if args else kw.get("pathname")
            pir = py_ir(pat) if pat is not None else ("lit", "*")
            rd = kw.get("root_dir")
            roots.append(("join", [("nonecwd", py_ir(rd)), pir]) if rd is not None else pir)
            pfilt = _pattern_filter(_ir_shape(pir))
        elif any(c == "shutil.make_archive" for c in canons):
            # make_archive(base_name, format, root_dir=None, base_dir=None): it archives root_dir/base_dir, each None
            # meaning the cwd (root_dir) or root_dir itself (base_dir)
            rd = args[2] if len(args) > 2 else kw.get("root_dir")
            bd = args[3] if len(args) > 3 else kw.get("base_dir")
            roots.append(("join", [("nonecwd", py_ir(rd)), ("nonecwd", py_ir(bd))]))
        elif any(c == "filecmp.dircmp" for c in canons):
            for a in list(args[:2]) + [kw[k] for k in ("a", "b") if k in kw]:
                roots.append(py_ir(a))
        elif any(c in ("<tarfile>.add", "<zipfile>.write") for c in canons):
            # TarFile.add(name) (recursive by default) and ZipFile.write(filename), on a receiver typed by
            # tarfile.open / TarFile / ZipFile (canon_call)
            a = args[0] if args else kw.get("name") or kw.get("filename")
            roots.append(py_ir(a) if a is not None else ("open",))
        elif isinstance(fn, ast.Attribute) and fn.attr in ("rglob", "glob", "iterdir", "walk"):
            recv = res.ev(py_ir(fn.value), ctx, 0)
            if recv and all(v[0] in ("canon", "module") for v in recv):
                continue   # a module's function (ast.walk, glob.glob handled above): no Path method
            if fn.attr in ("rglob", "glob"):
                # The pattern's shape (a non-literal part read as `*`) gives the filter, its last segment; rglob
                # matches at any depth, so its root is the receiver; glob's leading literal directories descend.
                pat = args[0] if args else kw.get("pattern")
                shape = _ir_shape(py_ir(pat)) if pat is not None else "*"
                segs = shape.split("/")
                lead = []
                if fn.attr == "glob":
                    for s in segs[:-1]:
                        if _has_glob(s):
                            break
                        lead.append(s)
                roots.append(("join", [py_ir(fn.value)] + [("lit", s) for s in lead]) if lead else py_ir(fn.value))
                last = segs[-1]
                pfilt = None if last in ("", "**") else [("glob", last)]
            else:
                roots.append(py_ir(fn.value))
        else:
            continue
        filters = pfilt or None
        if filt:
            filters = (filters or []) + filt if not filters else filters
            if pfilt is None:
                filters = filt
        out.append(Walk(f, node.lineno, [(r, ctx) for r in roots], filters, "api"))
    return out


def _ir_shape(ir):
    if ir[0] == "lit":
        return ir[1]
    if ir[0] == "tmpl":
        return "".join(p[1] if p[0] == "lit" else "*" for p in ir[1])
    return "*"


def _line_walks(f, res):
    """The JS and Swift API walk sites of a line-resolved file: [Walk]."""
    out = []
    lx = f.lx
    lang = res.files_lang((f, None, 0))
    for line, name, callee, args, kwargs, text in lx.walks:
        ctx = (f, None, line)
        if name in ("cpSync", "cp") and "recursive" not in text:
            continue
        if name == "cp" and not re.search(r"\bfs\w*\s*\.\s*(?:promises\s*\.\s*)?cp\s*\(", text):
            continue
        roots, filt = [], None
        if f.lang == "swift":
            a = args[0] if args else (kwargs[0][1] if kwargs else ("lit", "."))
            roots.append(a if a[0] != "star" else a[1])
        elif name.startswith("glob") or name in ("globby", "globbySync", "globStream", "globIterate"):
            pat = args[0] if args else ("lit", "*")
            pat = pat[1] if pat[0] == "star" else pat
            opts = args[1] if len(args) > 1 else None
            cwd = None
            if opts is not None and opts[0] == "obj" and "cwd" in opts[1]:
                cwd = opts[1]["cwd"]
            pats = pat[1] if pat[0] == "union" else [pat]
            shapes = []
            for p in pats:
                roots.append(("join", [("nonecwd", cwd), p]) if cwd is not None else p)   # cwd: undefined is the cwd
                shapes.append(_ir_shape(p))
            fl = [_pattern_filter(s) for s in shapes]
            filt = None if any(x is None for x in fl) else [y for x in fl for y in x]
        else:
            a = args[0] if args else ("lit", ".")
            roots.append(a[1] if a[0] == "star" else a)
        out.append(Walk(f, line, [(r, ctx) for r in roots], filt, "api"))
    del lang
    return out


GREP_RECURSIVE = re.compile(r"-[A-Za-z]*[rR][A-Za-z]*\Z")
RG_VALUE_OPTS = frozenset("-g --glob --iglob -t --type -T --type-not -e --regexp -f --file -m --max-count -A -B -C "
                          "--max-depth -d -j --threads -M --max-columns -E --encoding --sort --sortr --color --colors "
                          "--path-separator --pre --pre-glob --replace -r --context-separator --type-add "
                          "--ignore-file --max-filesize".split())
PROSE_TYPES = {"md": "*.md", "markdown": "*.md", "rst": "*.rst", "org": "*.org", "asciidoc": "*.adoc"}
SH_KEYWORDS = frozenset("if then else elif do while until ! { } time".split())
# In a code file's string a bare glob counts only after one of these words (a docstring's **emphasis** is no glob).
GLOB_CMDS = frozenset("cat ls wc head tail grep egrep fgrep rg sed awk cp mv rm echo printf xargs stat du md5sum shasum "
                      "sha1sum sha256sum cksum diff cmp tar zip rsync ditto chmod touch git python python3 node bash sh "
                      "zsh perl pandoc".split())
GLOB_HINT = re.compile(r"(?<![\w.$-])(?:%s)(?![\w$-])[^\n]*\*" % "|".join(sorted(GLOB_CMDS)))
SUBST_DEPTH = 4
_ASSIGN_RE = re.compile(r"[A-Za-z_]\w*\+?=")


def _glob_arg(w):
    """A word the shell expands as a glob: an unquoted `*` in a literal part (a `**` word has its own form), and not an
    option (`--include=*.md`) or an assignment (`X=*.md`), which the shell does not expand."""
    if w is SEP or not w or _starstar(w):
        return False
    p0 = w[0]
    if p0[0] == "lit" and not p0[2] and (p0[1].startswith("-") or _ASSIGN_RE.match(p0[1])):
        return False
    return any(p[0] == "lit" and not p[2] and "*" in p[1] for p in w)


def _under(cdir, w):
    """A path word as seen from a `-C cdir` option (an absolute literal word is itself)."""
    if cdir is None or (w and w[0][0] == "lit" and w[0][1].startswith("/")):
        return w
    return list(cdir) + [("lit", "/", False)] + list(w)


def _positional(a, opts):
    return [x for x, o in zip(a, opts) if not o or not o.startswith("-")]


def _shell_walks(f, items, line, ctx, step, globs=None, depth=0):
    """Shell walk sites among words: [Walk] (roots are ("shellword", word) IRs). `globs` reads an argument word with an
    unquoted `*` as a walk too: "shell" (a shell or make file's line outside a heredoc body, a step) after any command;
    "code" (a code file's string) only after a GLOB_CMDS word in the same command; None (a config or unknown file's
    line, a heredoc body) never."""
    out = []

    def args_from(i):
        a = []
        while i < len(items) and items[i] is not SEP:
            a.append(items[i])
            i += 1
        return a

    def walk(roots, filt, form):
        out.append(Walk(f, line, [(("shellword", r), ctx) for r in roots] or [(("lit", "."), ctx)], filt, form))

    # a command substitution ($(...), `...`, make's $(shell ...) and $(wildcard ...)) is read as words of its own
    if depth < SUBST_DEPTH:
        for w in items:
            for p in (w if w is not SEP else ()):
                if p[0] == "cmd" and p[1].strip():
                    out.extend(_shell_walks(f, shell_items([("t", p[1])], "sh"), line, ctx, step, globs, depth + 1))
    # a glob argument: the shell lists the directory. Not in command position (a `case` pattern line `*.md)`), and
    # not inside `[[ ]]`, `[`, `test` or a `case` (patterns, not globs).
    if globs:
        cmd, in_test, in_case, known = None, False, False, False
        for w in items:
            if w is SEP:
                cmd, known = None, False
                continue
            t = _wtext(w)
            if t == "]]":
                in_test = False
                continue
            if t == "esac":
                in_case = False
                continue
            if cmd is None:
                if t in SH_KEYWORDS or (t is not None and _ASSIGN_RE.match(t)):
                    continue
                cmd = t if t is not None else ""
                in_test = in_test or cmd == "[["
                in_case = in_case or cmd == "case"
                continue
            known = known or cmd in GLOB_CMDS
            if in_test or in_case or cmd in ("[", "test"):
                continue
            if _glob_arg(w) and (globs == "shell" or known):
                walk([w], _pattern_filter(_wshape(w)), "glob")
            known = known or _wtext(w) in GLOB_CMDS

    for i, w in enumerate(items):
        if w is SEP:
            continue
        if _starstar(w):
            walk([w], _pattern_filter(_wshape(w)), "**")
        t = _wtext(w)
        if t is None:
            continue
        if t in ("cp", "gcp"):
            # a recursive copy reads its sources (every positional word but the destination; all of them with -t)
            a = args_from(i + 1)
            opts = [_wtext(x) or "" for x in a]
            if not any(o in ("--recursive", "--archive") or re.fullmatch(r"-[A-Za-z]*[rRa][A-Za-z]*", o) for o in opts):
                continue
            target = any(o.startswith("--target-directory") or re.fullmatch(r"-[A-Za-z]*t", o) for o in opts)
            pos = _positional(a, opts)
            roots = pos if target or len(pos) < 2 else pos[:-1]
            if roots:
                walk(roots, None, t)
        elif t in ("rsync", "ditto"):
            a = args_from(i + 1)
            pos = _positional(a, [_wtext(x) or "" for x in a])
            roots = pos if len(pos) < 2 else pos[:-1]
            if roots:
                walk(roots, None, t)
        elif t in ("tar", "gtar", "bsdtar"):
            # a tar that creates, appends or updates reads its paths (each under the -C before it)
            a = args_from(i + 1)
            opts = [_wtext(x) or "" for x in a]
            modes, j = set(), 0
            if opts and re.fullmatch(r"[A-Za-z]+", opts[0]):   # the old style: `tar czf out.tgz dir`
                modes |= set(opts[0])
                j = 1
            for o in opts[j:]:
                if re.fullmatch(r"-[A-Za-z0-9]+", o):
                    modes |= set(o[1:])
                elif o in ("--create", "--append", "--update"):
                    modes.add("c")
            if not modes & set("cru"):
                continue
            cdir, roots = None, []
            while j < len(a):
                o = opts[j]
                if o in ("-C", "--directory") and j + 1 < len(a):
                    cdir = a[j + 1]
                    j += 2
                    continue
                if o.startswith("--directory="):
                    cdir = [("lit", o.split("=", 1)[1], False)]
                elif not o or not o.startswith("-"):
                    roots.append(_under(cdir, a[j]))
                j += 1
            if roots:
                walk(roots, None, t)
        elif t == "zip":
            # zip -r out.zip <paths>: the paths after the archive (an -x/-i pattern list skipped); -R walks the cwd
            a = args_from(i + 1)
            opts = [_wtext(x) or "" for x in a]
            flags = set("".join(o[1:] for o in opts if re.fullmatch(r"-[A-Za-z0-9@$]+", o)))
            pat = "R" in flags or "--recurse-patterns" in opts
            if not (pat or "r" in flags or "--recurse-paths" in opts):
                continue
            pos, listing = [], False
            for x, o in zip(a, opts):
                if o in ("-x", "-i", "--exclude", "--include"):
                    listing = True
                elif o and o.startswith("-"):
                    listing = False
                elif not (listing and _has_glob(_wshape(x))):
                    pos.append(x)
            roots = pos[1:] + ([[("lit", ".", False)]] if pat else [])
            if roots:
                walk(roots, None, "zip")
        elif t == "find":
            a = args_from(i + 1)
            roots = []
            for x in a:
                xt = _wtext(x)
                if xt is not None and (xt.startswith("-") or xt in ("(", "!", ",")):
                    break
                roots.append(x)
            filt = []
            for j, x in enumerate(a):
                if _wtext(x) in ("-name", "-iname", "-path", "-ipath", "-wholename") and j + 1 < len(a):
                    filt.append(("glob", _wshape(a[j + 1]).rsplit("/", 1)[-1]))
            walk(roots or [[("lit", ".", False)]], filt or None, "find")
        elif t == "ls":
            a = [x for x in args_from(i + 1) if not (_wtext(x) or "").startswith("-")]
            walk(a or [[("lit", ".", False)]], None, "ls")
        elif t in ("grep", "egrep", "fgrep"):
            a = args_from(i + 1)
            opts = [_wtext(x) or "" for x in a]
            if not any(GREP_RECURSIVE.match(o) and not o.startswith("--") or o in ("--recursive",
                       "--dereference-recursive") or o.startswith("--directories=recurse") for o in opts):
                continue
            has_e = any(o in ("-e", "-f") or o.startswith(("--regexp", "--file")) for o in opts)
            pos, filt, j = [], [], 0
            while j < len(a):
                o = opts[j]
                if o.startswith("--include="):
                    filt.append(("glob", o.split("=", 1)[1]))
                elif o == "--include" and j + 1 < len(a):
                    filt.append(("glob", _wshape(a[j + 1])))
                    j += 1
                elif o in ("-e", "-f") and j + 1 < len(a):
                    j += 1
                elif not o.startswith("-") or not o:
                    pos.append(a[j])
                j += 1
            roots = pos if has_e else pos[1:]
            walk(roots or [[("lit", ".", False)]], filt or None, "grep -r")
        elif t in ("rg", "ripgrep"):
            a = args_from(i + 1)
            opts = [_wtext(x) or "" for x in a]
            files = "--files" in opts
            has_e = any(o in ("-e", "--regexp", "-f", "--file") or o.startswith(("--regexp=", "--file=")) for o in opts)
            pos, filt, j = [], [], 0
            while j < len(a):
                o = opts[j]
                if o in ("-g", "--glob", "--iglob") and j + 1 < len(a):
                    g = _wshape(a[j + 1])
                    if not g.startswith("!"):
                        filt.append(("glob", g.rsplit("/", 1)[-1]))
                    j += 2
                    continue
                if o.startswith(("--glob=", "--iglob=")):
                    g = o.split("=", 1)[1]
                    if not g.startswith("!"):
                        filt.append(("glob", g.rsplit("/", 1)[-1]))
                elif o in ("-t", "--type") and j + 1 < len(a):
                    ty = _wtext(a[j + 1]) or ""
                    filt.append(("glob", PROSE_TYPES.get(ty, "*." + ty + ".nonprose")))
                    j += 2
                    continue
                elif o in RG_VALUE_OPTS and j + 1 < len(a):
                    j += 2
                    continue
                elif not o.startswith("-") or not o:
                    pos.append(a[j])
                j += 1
            roots = pos if (files or has_e) else pos[1:]
            walk(roots or [[("lit", ".", False)]], filt or None, "rg")
        elif t == "git":
            a = args_from(i + 1)
            opts = [_wtext(x) for x in a]
            j, cdir = 0, None
            while j < len(a) and opts[j] is not None and opts[j].startswith("-"):
                if opts[j] in ("-C", "-c") and j + 1 < len(a):
                    if opts[j] == "-C":
                        cdir = a[j + 1]
                    j += 2
                    continue
                j += 1
            if j >= len(a):
                continue
            if opts[j] == "clone":
                # a clone copies its source (every positional word is read as a root, the destination too)
                roots = [_under(cdir, x) for x, o in zip(a[j + 1:], opts[j + 1:]) if o is None or not o.startswith("-")]
                if roots:
                    walk(roots, None, "git clone")
                continue
            if opts[j] == "archive" or opts[j] == "worktree" and \
                    next((o for o in opts[j + 1:] if o is None or not o.startswith("-")), None) == "add":
                # an archive or a new worktree copies the repo's tree: a whole-tree walk of the repo (cwd or -C)
                walk([_under(cdir, [("lit", ".", False)])], None, "git " + opts[j])
                continue
            if opts[j] not in ("ls-files", "ls-tree", "grep"):
                continue
            sub, rest, ropts = opts[j], a[j + 1:], opts[j + 1:]
            whole = False
            if "--" in ropts:
                specs = rest[ropts.index("--") + 1:]
            else:
                pos = [x for x, o in zip(rest, ropts) if o is None or not o.startswith("-")]
                if sub == "ls-files":
                    specs = pos
                elif sub == "ls-tree":
                    specs = pos[1:]
                    if pos and ":" in (_wshape(pos[0]) or ""):
                        whole = True
                else:
                    specs, whole = [], True
            roots, filt = [], []
            for s in specs:
                sh = _wshape(s)
                if sh.startswith(":"):
                    whole = True
                    continue
                roots.append(s)
                pf = _pattern_filter(sh)
                if pf and filt is not None:
                    filt.extend(pf)
                else:
                    filt = None
            if whole or not roots:
                roots = roots + [[("lit", ".", False)]]
                filt = None
            roots = [_under(cdir, r) for r in roots]
            walk(roots, filt or None, "git " + sub)
        elif t == "for" and i + 2 < len(items) and _wtext(items[i + 2]) == "in":
            j = i + 3
            while j < len(items) and items[j] is not SEP and _wtext(items[j]) != "do":
                x = items[j]
                if any(p[0] == "lit" and ("*" in p[1] or "?" in p[1]) for p in x):
                    walk([x], _pattern_filter(_wshape(x)), "for")
                j += 1
    return out


# ---- prove ----------------------------------------------------------------------------------------------------------

def _reader(glob, path, kind, line=None, text=None, origin=None):
    r = {"glob": glob, "path": path, "kind": kind}
    if line is not None:
        r["line"] = line
    if origin is not None:
        r["origin"] = origin
    if text is not None:
        r["text"] = text[:READER_TEXT]
    return r


def _line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def _files(tree, steps):
    files = []
    for path, sha in sorted(tree.blobs.items()):
        data = tree.content.get(sha, b"")
        binary = b"\0" in data[:8000]
        text = data.decode("utf-8", "replace")
        files.append(SrcFile(len(files), path, text, "bin" if binary else _lang(path, text), binary=binary))
    for name, text in steps:
        if text:
            files.append(SrcFile(len(files), "<%s>" % name, text, "sh", step=True))
    return files


ORIGIN_ORDER = ("repo", "cwd", "path", "input", "open", "depth")


def _classify(vals, ix, step):
    """The counting origins of a walk's root values: [(label, segs, unk)] (empty: every origin is exempt)."""
    out = []
    origins = [as_origin(v) for v in vals]
    origins = [o for o in origins if o is not None]
    if not origins:
        return [("open", (), True)]
    for o in origins:
        k = o[0]
        if step:
            if k == "cwd":
                out.append(("cwd", o[1], o[2]))
            else:
                out.append(("cwd", (), True))
            continue
        if k in ("tmp", "homeopen"):
            continue
        if k == "path":
            if o[1] is None:
                out.append(("path", (), False))
                continue
            rel = ix.place_rel(o[1])
            if rel is None:
                continue   # ELSEWHERE
            if rel[0] == "inside":
                out.append(("path", rel[1], o[2]))
            else:
                out.append(("path", (), o[2] if rel[0] == "equal" else False))
            continue
        if k in ("repo", "cwd"):
            out.append((k, o[1], o[2]))
            continue
        out.append((k if k in ORIGIN_ORDER else "open", (), True))
    return out


def prove(repo, tree, globs, steps=(), places=None):
    """The header's Inert proof of each glob on `tree`: {glob: {held, readers, readersTotal}}. ProofError on git."""
    repo = os.path.abspath(os.path.expanduser(str(repo)))
    globs = list(dict.fromkeys(globs))
    start = time.monotonic()
    deadline = start + PROOF_BUDGET_S
    readers = {g: [] for g in globs}
    t = Tree(repo, tree)
    place_list = [repo] + [os.path.abspath(os.path.expanduser(p)) for p in (places or ())] + _worktrees(repo)
    step_list = [(n, s) for n, s in (steps if not isinstance(steps, dict) else steps.items())]
    provable = [g for g in globs if tokens(g)]
    for g in globs:
        if g not in provable:
            readers[g].append(_reader(g, "-", "unprovable", text="no literal segment: nothing to prove it by"))
    try:
        _prove(t, repo, provable, step_list, place_list, readers, deadline)
    except _Budget:
        for g in globs:
            readers[g].append(_reader(g, "-", "unprovable", text="proof budget exceeded"))
    out = {}
    for g in globs:
        rs = sorted(readers[g], key=lambda r: (r["path"], r.get("line") or 0, r["kind"]))
        seen, uniq = set(), []
        for r in rs:
            key = (r["path"], r.get("line"), r["kind"], r.get("origin"))
            if key not in seen:
                seen.add(key)
                uniq.append(r)
        out[g] = {"held": not uniq, "readers": uniq[:READERS_OUT], "readersTotal": len(uniq)}
    return out


def _prove(t, repo, globs, steps, places, readers, deadline):
    if not globs:
        return
    files = _files(t, steps)
    # submodules, tool configs and symlinks need no parse
    for gl in t.gitlinks:
        for g in globs:
            readers[g].append(_reader(g, gl, "submodule", text="a gitlink: its contents cannot be read"))
    for p in t.paths:
        if TOOL_CONFIG_RE.match(posixpath.basename(p)):
            for g in globs:
                readers[g].append(_reader(g, p, "tool", text="a markdown tool's config"))
    name_res = {g: re.compile(r"(?<![A-Za-z0-9])(?:%s)(?![A-Za-z0-9])" % "|".join(re.escape(x) for x in tokens(g)),
                              re.I) for g in globs}
    for f in files:
        if time.monotonic() > deadline:
            raise _Budget()
        for g in globs:
            m = name_res[g].search(f.text)
            if m:
                ln = _line_of(f.text, m.start())
                readers[g].append(_reader(g, f.path, "name", ln, f.lines[ln - 1].strip()))
        if f.binary:
            continue
        m = TOOL_RE.search(f.text) or TOOL_CMD_RE.search(f.text)
        if m:
            ln = _line_of(f.text, m.start())
            for g in globs:
                readers[g].append(_reader(g, f.path, "tool", ln, f.lines[ln - 1].strip()))
        i = f.text.find(LINK)
        if i >= 0:
            ln = _line_of(f.text, i)
            for g in globs:
                readers[g].append(_reader(g, f.path, "link", ln, f.lines[ln - 1].strip()))
    ix = Index(files, places, deadline)
    for link, sha in t.links.items():
        target = _dec(t.content.get(sha, b""))
        if target.startswith("/"):
            rel = ix.place_rel(posixpath.normpath(target))
            if rel is None:
                continue
            segs = rel[1] if rel[0] == "inside" else ()
            norm = "/".join(segs)
        else:
            norm = posixpath.normpath(posixpath.join(posixpath.dirname(link), target))
            if norm == "." or norm == ".." or norm.startswith("../"):
                segs, norm = (), ""
            else:
                segs = tuple(norm.split("/"))
        for g in globs:
            if _covers(segs, False, None, g) or (norm and glob_match(g, norm)):
                readers[g].append(_reader(g, link, "symlink", text="-> " + target))
    res = Resolver(ix)
    walks = []
    for f in files:
        ix.tick()
        if f.binary:
            continue
        if f.py is not None:
            walks.extend(_py_walks(f, res))
            for line, segs, scope in f.py.shell:
                ctx = (f, scope, line)
                items = segs[1] if isinstance(segs, tuple) and segs[0] == "argv" else shell_items(segs, "sh",
                                                                                               argv_quoted=True)
                walks.extend(_shell_walks(f, items, line, ctx, f.step, "code"))
        elif f.lx is not None:
            walks.extend(_line_walks(f, res))
            mode = "shell" if f.lang in ("sh", "make") else ("code" if f.lang in ("py", "js", "swift") else None)
            for line, items in f.lx.views:
                walks.extend(_shell_walks(f, items, line, (f, None, line), f.step,
                                          mode if line not in f.lx.heredoc else None))
    for w in walks:
        ix.tick()
        vals = set()
        for ir, ctx in w.roots:
            vals |= res.ev(ir, ctx, 0)
        counted = _classify(vals, ix, w.file.step)
        for g in globs:
            for label, segs, unk in sorted(counted, key=lambda o: ORIGIN_ORDER.index(o[0])):
                if _covers(segs, unk, w.filt, g):
                    readers[g].append(_reader(g, w.file.path, "walk", w.line, w.text, origin=label))
                    break


# ---- the Run record's drop rule -------------------------------------------------------------------------------------

def outcomes(repo_slug, env=None):
    """[(ts, kind, line dict)] of this repo's verify-skipped and inert-proof-failed lines, every rollout, in ts order."""
    try:
        d = RR.events_dir(env)
    except ValueError:
        return []
    if not os.path.isdir(d):
        return []
    got = []
    for name in sorted(os.listdir(d)):
        if not name.endswith(".jsonl") or name[:-6] in RR.RESERVED:
            continue
        try:
            with open(os.path.join(d, name), encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    try:
                        line = json.loads(raw)
                    except ValueError:
                        continue
                    if not isinstance(line, dict) or line.get("kind") not in ("verify-skipped", "inert-proof-failed"):
                        continue
                    if str(line.get("repo") or "").lower() != str(repo_slug).lower():
                        continue
                    got.append((str(line.get("ts") or ""), line))
        except OSError:
            continue
    got.sort(key=lambda x: x[0])
    return [line for _ts, line in got]


def streak(glob, lines):
    """The glob's trailing run of failures at skips (the header's drop rule)."""
    n = 0
    for line in lines:
        if line.get("error"):
            continue
        if line["kind"] == "inert-proof-failed":
            failed = line.get("failed")
            if not isinstance(failed, list):
                failed = [r.get("glob") for r in line.get("readers") or [] if isinstance(r, dict)]
            if glob in failed:
                n += 1
                continue
        if glob in (line.get("globs") or ()):
            n = 0
    return n


# ---- the config edit ------------------------------------------------------------------------------------------------

class EditRefused(Exception):
    pass


_INERT_LINE_RE = re.compile(r"^(\s*(?:inert_paths|\"inert_paths\"|'inert_paths')\s*=\s*)(\[.*\])(\s*(?:#.*)?)$")


def _render(globs):
    return "[" + ", ".join(json.dumps(g) for g in globs) + "]"


def edit_inert(text, slug, globs, current_schema):
    """The config text with the repo's inert_paths set to `globs` ([] removes the line), and the schema raised to 2
    when a list is written. EditRefused for a form it will not edit."""
    lines = text.split("\n") if text else []
    trailing = bool(lines) and lines[-1] == ""
    if trailing:
        lines = lines[:-1]
    table, header, end, last_key, at = (), None, None, None, None
    for i, line in enumerate(lines):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = RS._AOT_RE.match(s) or RS._TABLE_RE.match(s)
        if m:
            table = RS._segments(m.group(1))
            if header is not None and end is None:
                end = i
            if len(table) == 2 and table[0] == "repo" and table[1].lower() == slug.lower():
                header = i
            continue
        m = RS._KEY_RE.match(s)
        if not m:
            continue
        segs = RS._segments(m.group(1))
        path = table + segs
        if path[0] != "repo":
            continue
        if header is not None and end is None and len(segs) == 1 and len(table) == 2:
            last_key = i
            if segs[0] == "inert_paths":
                at = i
        elif len(path) == 1 or path[1].lower() == slug.lower():
            raise EditRefused("[repo.%s] is set in dotted or inline-table form in the config: edit it by hand"
                              % json.dumps(slug))
    if at is not None:
        m = _INERT_LINE_RE.match(lines[at])
        if not m:
            raise EditRefused("cannot read the inert_paths line in [repo.%s] (line %d; a one-line array only): edit it "
                              "by hand" % (json.dumps(slug), at + 1))
        if globs:
            lines[at] = m.group(1) + _render(globs) + m.group(3)
        else:
            del lines[at]
    elif globs:
        if header is not None:
            pos = (last_key if last_key is not None else header) + 1
            lines[pos:pos] = ["inert_paths = %s" % _render(globs)]
        else:
            if lines and lines[-1].strip():
                lines.append("")
            lines.append("[repo.%s]" % json.dumps(slug))
            lines.append("inert_paths = %s" % _render(globs))
    if globs:
        try:
            lines = RS.raise_schema_lines(lines, RS.KEY_SCHEMA[("rollout", "inert_paths")], current_schema)
        except RS.SettingsError as e:
            raise EditRefused(str(e))
    return "\n".join(lines) + "\n" if lines else ""


# ---- the reader check -----------------------------------------------------------------------------------------------

CHECK_CODE = r"""
import sys
sys.dont_write_bytecode = True
import importlib.util
try:
    spec = importlib.util.spec_from_file_location("rs", sys.argv[1])
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.resolve(path=sys.argv[2])
except Exception as e:
    sys.stderr.write("%s\n" % (e,))
    sys.exit(2)
"""


def live_notes(tasks_dir):
    """The live rollout notes directly in tasks_dir: [(slug, path)]; None when the directory is missing."""
    td = os.path.expanduser(tasks_dir)
    if not os.path.isdir(td):
        return None
    out = []
    for name in sorted(os.listdir(td)):
        p = os.path.join(td, name)
        if not name.endswith(".md") or not os.path.isfile(p):
            continue
        try:
            fm = ES.read_head(p)
        except OSError:
            continue
        if "protocol_version" not in fm:
            continue
        if ES.scalar(fm.get("status")).lower() in ("done", "dropped"):
            continue
        out.append((name[:-3], p))
    return out


def reader_check(new_file, tasks_dir):
    """(refusals, warnings): each live rollout's engine root asked to read `new_file` (the header's reader check)."""
    notes = live_notes(tasks_dir)
    warns, refusals = [], []
    if notes is None:
        return [], ["WARN: inert-paths: no tasks dir at %s: the reader check read no live rollout" % tasks_dir]
    roots = {}
    for slug, path in notes:
        try:
            er = ES.engine_root(path)
        except Exception as e:  # an unreadable note: warn, never block
            warns.append("WARN: inert-paths: [[%s]] cannot be read (%s): skipped" % (slug, e))
            continue
        if er.get("root") is None:
            warns.append("WARN: inert-paths: [[%s]] runs on an unusable snapshot (%s): skipped (its own guard refuses "
                         "it)" % (slug, er.get("unusable")))
            continue
        roots.setdefault(er["root"], []).append(slug)
    for root, slugs in sorted(roots.items()):
        script = os.path.join(root, "skills", "_shared", "scripts", "rollout-settings.py")
        why = None
        if not os.path.isfile(script):
            why = "no skills/_shared/scripts/rollout-settings.py there"
        else:
            try:
                p = subprocess.run([sys.executable, "-I", "-B", "-c", CHECK_CODE, script, new_file], capture_output=True,
                                   text=True, timeout=CHECK_TIMEOUT, stdin=subprocess.DEVNULL, env=ES.git_env())
                if p.returncode != 0:
                    lines = [x for x in (p.stderr or "").strip().splitlines() if x.strip()]
                    why = lines[-1].strip() if lines else "exit %d" % p.returncode
            except subprocess.TimeoutExpired:
                why = "it did not answer within %ds" % CHECK_TIMEOUT
            except OSError as e:
                why = "it will not start: %s" % e
        if why:
            for slug in slugs:
                refusals.append("inert-paths: [[%s]] runs on %s, whose rollout-settings.py refuses the new file (%s): "
                                "update that checkout to a P29+ release, or wait for the rollout to finish, or re-run "
                                "with --force" % (slug, root, why))
    return refusals, warns


# ---- CLI ------------------------------------------------------------------------------------------------------------

class Usage(Exception):
    pass


def _steps(a):
    return [("verifier", a.verifier or ""), ("bootstrap", getattr(a, "bootstrap", None) or "")]


def _out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")


def cmd_prove(a):
    res = prove(a.repo, a.tree, a.glob, _steps(a), places=a.place)
    _out({"repo": os.path.abspath(os.path.expanduser(a.repo)), "tree": a.tree, "globs": res})
    return 0


def cmd_propose(a):
    repo = os.path.abspath(os.path.expanduser(a.repo))
    try:
        slug = RS._origin_slug(repo)
        recorded = RS.resolve(repo=repo)["inert_paths"]["value"] if slug else []
    except RS.SettingsError as e:
        raise Usage("rollout-settings: %s" % e)
    cands = list(dict.fromkeys(a.candidate or CANDIDATES))
    res = prove(repo, a.tree, list(dict.fromkeys(list(recorded) + cands)), _steps(a))
    lines = outcomes(slug) if slug else []
    rec = [{"glob": g, "held": res[g]["held"], "readers": res[g]["readers"][:5], "streak": streak(g, lines)}
           for g in recorded]
    out = {"repo": slug, "tree": a.tree, "recorded": rec,
           "proposed": [g for g in cands if slug and g not in recorded and res[g]["held"]],
           "refused": [{"glob": g, "readers": res[g]["readers"][:5]} for g in cands if not res[g]["held"]],
           "drop": [r["glob"] for r in rec if r["streak"] >= DROP_AFTER]}
    if not slug:
        out["note"] = "no GitHub origin: nothing can be recorded"
    _out(out)
    return 0


def _write_edit(a, slug, new_globs_for, check):
    """The shared record/drop write: edit, validate, (reader check), replace. Returns the exit code."""
    config = os.path.expanduser(a.config or RS.default_path())
    real = os.path.realpath(config)
    try:
        before = RS.load_tables(config)
    except RS.SettingsError as e:
        raise Usage("rollout-settings: %s" % e)
    text = ""
    if os.path.exists(real):
        with open(real, encoding="utf-8") as fh:
            text = fh.read()
    cur_schema = before["schema"] if before else 1
    table = ((before or {}).get("repo") or {}).get(slug.lower(), {})
    current = list(table.get("inert_paths", []))
    want = new_globs_for(current)
    if want == current:
        print("inert-paths: nothing to change for %s in %s" % (slug, config))
        return 0
    try:
        new_text = edit_inert(text, slug, want, cur_schema)
    except EditRefused as e:
        sys.stderr.write("inert-paths: %s\n" % e)
        return 2
    parent = os.path.dirname(real)
    made = []
    d = parent
    while d and not os.path.isdir(d):
        made.append(d)
        d = os.path.dirname(d)
    tmp = None
    try:
        os.makedirs(parent, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=parent, prefix="." + os.path.basename(real) + ".", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(new_text)
        try:
            after = RS.load_tables(tmp)
        except RS.SettingsError as e:
            sys.stderr.write("inert-paths: the edit does not validate (%s): nothing written\n" % e)
            return 2
        got = ((after or {}).get("repo") or {}).get(slug.lower(), {}).get("inert_paths", [])
        same = all((before or {}).get(k, {}) == (after or {}).get(k, {}) for k in ("defaults", "guardrails", "notify"))
        others = {s: t for s, t in ((before or {}).get("repo") or {}).items() if s != slug.lower()} == \
            {s: t for s, t in ((after or {}).get("repo") or {}).items() if s != slug.lower()}
        mine = {k: v for k, v in table.items() if k != "inert_paths"} == \
            {k: v for k, v in ((after or {}).get("repo") or {}).get(slug.lower(), {}).items() if k != "inert_paths"}
        if got != want or not same or not others or not mine:
            sys.stderr.write("inert-paths: the edit resolves another result than intended: nothing written\n")
            return 2
        raised = want and (after or {}).get("schema", 1) > cur_schema
        if raised and check:
            refusals, warns = reader_check(tmp, a.tasks_dir)
            for w in warns:
                sys.stderr.write(w + "\n")
            if refusals and not a.force:
                for r in refusals:
                    sys.stderr.write(r + "\n")
                sys.stderr.write("inert-paths: nothing written\n")
                return 1
            for r in refusals:
                sys.stderr.write("WARN: " + r + "\n")
        if a.dry_run:
            diff = difflib.unified_diff(text.splitlines(True), new_text.splitlines(True), config, config + " (edited)")
            sys.stdout.write("".join(diff))
            return 0
        os.replace(tmp, real)
        tmp = None
        made = []
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)
        for d in made:
            try:
                os.rmdir(d)
            except OSError:
                pass
    return None


def cmd_record(a):
    repo = os.path.abspath(os.path.expanduser(a.repo))
    try:
        slug = RS._origin_slug(repo)
    except RS.SettingsError as e:
        raise Usage(str(e))
    if not slug:
        raise Usage("--repo %s has no GitHub origin: nothing can be recorded" % repo)
    for g in a.glob:
        why = RS.glob_problem(g)
        if why:
            raise Usage("the glob %s %s" % (json.dumps(g), why))
    res = prove(repo, a.tree, a.glob, _steps(a))
    failing = [g for g in a.glob if not res[g]["held"]]
    if failing:
        for g in failing:
            for r in res[g]["readers"][:5]:
                sys.stderr.write("inert-paths: %s fails its proof: %s%s %s%s\n" % (
                    g, r["path"], ":%d" % r["line"] if r.get("line") else "", r["kind"],
                    " (%s)" % r["origin"] if r.get("origin") else ""))
        sys.stderr.write("inert-paths: nothing written (%d glob(s) fail their proof)\n" % len(failing))
        return 1
    rc = _write_edit(a, slug, lambda cur: cur + [g for g in a.glob if g not in cur], check=True)
    if rc is not None:
        return rc
    print("inert-paths: recorded %s for %s in %s" % (", ".join(a.glob), slug, a.config or RS.default_path()))
    return 0


def cmd_drop(a):
    repo = os.path.abspath(os.path.expanduser(a.repo))
    try:
        slug = RS._origin_slug(repo)
    except RS.SettingsError as e:
        raise Usage(str(e))
    if not slug:
        raise Usage("--repo %s has no GitHub origin: nothing recorded to drop" % repo)
    rc = _write_edit(a, slug, lambda cur: [g for g in cur if g not in a.glob], check=False)
    if rc is not None:
        return rc
    print("inert-paths: dropped %s for %s in %s" % (", ".join(a.glob), slug, a.config or RS.default_path()))
    return 0


class _ArgParser(argparse.ArgumentParser):
    def error(self, message):
        raise Usage(message)


def main(argv=None):
    p = _ArgParser(prog="inert-paths", description="Inert paths (ADR 0045): the path test, the proof, propose/record/drop.")
    sub = p.add_subparsers(dest="cmd")
    pv = sub.add_parser("prove")
    pv.add_argument("--repo", required=True)
    pv.add_argument("--tree", default="HEAD")
    pv.add_argument("--glob", action="append", required=True)
    pv.add_argument("--verifier", default="")
    pv.add_argument("--bootstrap", default="")
    pv.add_argument("--place", action="append", default=[])
    pp = sub.add_parser("propose")
    pp.add_argument("--repo", required=True)
    pp.add_argument("--tree", default="HEAD")
    pp.add_argument("--verifier", required=True)
    pp.add_argument("--bootstrap", default="")
    pp.add_argument("--candidate", action="append", default=[])
    pr = sub.add_parser("record")
    pr.add_argument("--repo", required=True)
    pr.add_argument("--glob", action="append", required=True)
    pr.add_argument("--verifier", required=True)
    pr.add_argument("--bootstrap", default="")
    pr.add_argument("--tree", default="HEAD")
    pr.add_argument("--config", default=None)
    pr.add_argument("--tasks-dir", default=ES.DEFAULT_TASKS_DIR)
    pr.add_argument("--force", action="store_true")
    pr.add_argument("--dry-run", action="store_true")
    pd = sub.add_parser("drop")
    pd.add_argument("--repo", required=True)
    pd.add_argument("--glob", action="append", required=True)
    pd.add_argument("--config", default=None)
    pd.add_argument("--dry-run", action="store_true")
    try:
        a = p.parse_args(argv)
        if not a.cmd:
            raise Usage("a verb is required: prove, propose, record or drop")
        return {"prove": cmd_prove, "propose": cmd_propose, "record": cmd_record, "drop": cmd_drop}[a.cmd](a)
    except Usage as e:
        sys.stderr.write("inert-paths: %s\n" % e)
        return 2
    except ProofError as e:
        sys.stderr.write("inert-paths: ProofError: %s\n" % e)
        return 2


if __name__ == "__main__":
    sys.exit(main())
