#!/usr/bin/env python3
"""The Fast tier's selector (ADR 0073 d1, p43-2): the test files a diff reaches, read from tests/fast-tier.map.

`bash tests/run.sh --fast` (`make test-fast`, the self-rollout's verifier) runs `select` and then only the test files
it prints; `bash tests/run.sh`, `--fast` and `--only` all run `check` first. Stdlib only: it writes nothing, imports no
repo module, and silences SyntaxWarning while it parses a script. This docstring is the one copy of its rules; the map's
header holds only the line syntax and the glob rule.

Commands
  select [--base REV] [--paths P...] [--ignore-full]
      The first line is `FULL<TAB><reason>`, or `FAST<TAB><base sha><TAB><source><TAB><n changed paths>` followed by
      the selected entries, sorted, one per line (collected test paths and `@merge-task-self-tests`). With --paths
      the changed paths are those given, git is never asked for a diff, and the base and source fields are `-`.
      --ignore-full reads the reach as if no line were FULL (a FULL line then only places its paths); only the tests
      and the follow-ups pass it, never run.sh.
  check
      `fast-tier map: ok (...)`, exit 0, or one `fast-tier map: <problem>` line per problem, exit 1.
  Exit 0 on FAST or FULL, 1 on a check problem, 2 on usage.

Collected tests: the files run.sh runs (COLLECTED, its globs; tests/fast-tier.test.sh C3 pins them to run.sh).

Base: --base (run.sh passes the THREAD_VERIFY_BASE it captured before unsetting it), else origin/HEAD, else
origin/master, else origin/main, each checked with `git rev-parse --verify -q <rev>^{commit}`; the diff base is then
`git merge-base <base> HEAD`. A base that does not resolve, or a failed merge-base (a shallow clone), is FULL.

Changed paths: `git diff -z --name-only --no-renames <merge base>` (the working tree against it, so staged and
unstaged edits count, and a rename counts both paths), plus `git ls-files -z --others --exclude-standard`, minus
`.claude/**` (other sessions' worktrees and the harness's state). None left is FULL.

The index, built once per run:
  - Carriers: the files `git ls-files -z -co --exclude-standard` lists that exist on disk, lie outside `.claude/` and
    end in .py, .sh, .js, .mjs or .json. Collected tests, tests/run.sh and this file are never carriers: this file
    names merge-task.sh and run.sh names the harness, and a carrier that names a path is reached by it.
  - A carrier's naming text: for .py its str and bytes constants, docstrings dropped (an unparseable file: its whole
    text); for .sh every line whose first non-blank character is not `#`; for anything else its whole text. A test's
    text is always its whole text.
  - A basename made only of [A-Za-z0-9_.-] is named when a text holds it as a whole token: the text is split on
    every other character and each token's trailing dots are dropped. Any other basename matches as a substring.
  - The runner map: RUN_FORM over each test's naming text (the .sh carrier rule for a .sh test, the whole text for
    the rest). RUN_FORM is the word bash, sh or node, optionally followed by --test, at the start of a line or after
    whitespace, `;`, `&`, `|`, `(`, a backtick or a quote; its operand, quotes removed, equals a collected test's path
    or ends with `/` and that path. A test that runs itself is ignored.

The map (tests/fast-tier.map). A line matches a path when its pattern does; a matching line that is not ALSO places
the path. Lines: `<pattern>` alone places the path and leaves the result to its reach; `<pattern> FULL` is the full
suite; `<pattern> NONE` places it and selects nothing of its own (a path only NONE lines place selects only the ALSO
entries of its lines, the walkers); `<pattern> <entry>...` places it and selects the entries;
`<pattern> ALSO <entry>...` selects the entries on top and never places. An entry is a collected test path, a glob
over collected tests, or `@merge-task-self-tests` (run.sh's two merge-task.sh self-tests, plain lines only).
`FOREIGN <basename>...` names files the scripts read in other roots (a vault's notes, another repo's docs): such a
name pushes only tests/lib carriers, never a script, so a script that reads some note's SKILL.md is not reached by
this repo's SKILL.md files. `OWN-LISTINGS <test>... # (i)|(ii) <what it lists>` excuses tests from check (f).

Rules, for each changed path p, in sorted order; the first FULL is the result:
  (1) p is a collected test (present or deleted). It selects itself when it exists (a runner of a deleted test now
      fails, so the deleted one never runs), the plain and ALSO entries of every line matching it, and every
      collected test whose text names basename(p), one level, through the index: a runner's operand and a reader's
      path both hold that basename as a token. Rule (1) never gives FULL.
  (2) No line places p: FULL (`<p>: not in the map`).
  (3) Otherwise a worklist from p, breadth-first in sorted order. For each item q:
      - a FULL line places q: FULL (`<p>: marked FULL`, or `<p>: reaches <q>, marked FULL`);
      - no line places q, a reached carrier: FULL (`<p>: reaches <q>, not in the map`);
      - otherwise q adds the ALSO entries of its matching lines on top (never reach), and then
        - only NONE lines place q: q adds nothing more and pushes nothing, so a path only NONE lines place selects
          only the ALSO entries of its lines (the walkers: a diff under tests/e2e/ still changes text they read);
        - else q adds, as reach, the plain entries of its placing lines and every collected test that names
          basename(q); then every carrier that names basename(q) is pushed (a FOREIGN basename pushes only tests/lib
          carriers). A carrier's own text changes what it names, never who names it, so reach follows names from the
          changed path outward.
  (4) p is placed, not only by NONE lines, and its reach is empty: FULL (`<p>: reaches no test`).
  (5) Once every path is read and the result is FAST, the selection is closed over runners: every collected test
      that runs a selected test (the runner map) is added, until nothing new is. `@merge-task-self-tests` is no file
      and has no runners. --ignore-full applies (5) too.

check:
  (a) The map parses: known keywords only (FOREIGN, OWN-LISTINGS, FULL, NONE, ALSO), FULL and NONE stand alone,
      `@merge-task-self-tests` is the only `@` entry and sits on plain lines only, and each OWN-LISTINGS line names at
      least one test and carries a trailing `# (i) ...` or `# (ii) ...` comment.
  (b) Every exact pattern exists on disk, and every glob matches at least one tracked file.
  (c) Every entry resolves to collected tests, and an exact test entry (an OWN-LISTINGS one too) is collected.
  (d) Every source (SOURCES: skills/*/scripts/*, hooks/*, skills/*/*.workflow.js, skills/*/diagnostics/*.workflow.js)
      is placed, and its rule-(3) result is FULL or has a non-empty reach: every script maps to a test or to the
      full-suite list.
  (e) Every tests/fixtures/<d>/ has a `tests/fixtures/<d>/**` line whose plain entries hold every consumer of <d>: a
      collected test whose text holds <d> in either FIXTURE form, or one that names a tests/lib helper whose text
      does. FIXTURE_LITERAL is `fixtures/<d>` followed by a character outside [A-Za-z0-9_.-] or by the end of the
      text (so a dir named `ab` never claims the consumers of `ab-c`); FIXTURE_SEGMENTS is quoted path segments,
      `'fixtures', '<d>'` or `'tests/fixtures', "<d>/..."` as path.join takes them.
  (f) Every collected test that lists a directory is on the `** ALSO` line (the walkers, which every changed path
      selects) or on OWN-LISTINGS. A test lists a directory when its text holds a LISTING form:
      - any test: an import of contract-text.mjs binding walk, textFiles or skillCount, or a namespace or default
        import of it; readdirSync(, readdir(, opendirSync(, globSync(, ls-files, os.walk(, os.listdir(, os.scandir(
        or rglob(;
      - a node test: a spawned grep, find or ls (spawnSync, execSync, execFileSync, spawn, execFile or exec( whose
        first word is one), a spawned git whose argv holds 'grep' or 'ls-files' (or whose string runs git grep or git
        ls-files), flags ignored since they may come from variables; or cpSync( of root, ROOT or PLUGIN, bare or
        through path.join;
      - a .sh test, on a non-comment line: find, ls, grep with an r/R flag cluster, cp with an r/R/a flag, tar, rsync,
        or `for ... in` with a glob, whose command word follows the start of the line, whitespace, `;`, `&`, `|`, `(`,
        a backtick or a quote (a command inside a string the test runs later counts), with a root operand among its
        operands (up to the next `|`, `;`, `&`, `)` or backtick). A root operand is `.` or `./...` (on a line holding
        `cd <x>`, `.` stands for the nearest <x> before it), a token starting with skills, hooks, tests, docs, evals,
        .github or .claude-plugin, or one starting with $root, $ROOT, $ROOTDIR, $PLUGIN, $HERE, $CLAUDE_PLUGIN_ROOT,
        $PWD or $(pwd, quoted or braced. git grep, git ls-files and git ls-tree count with no -C, and with -C <x> when
        <x> is a root operand;
      - a test that runs another collected test (RUN_FORM) inherits that test's class.
      Also a problem: an OWN-LISTINGS entry that lists nothing, a contract-text walker import on OWN-LISTINGS, and a
      test that runs a walker without being on the walkers line itself.
      OWN-LISTINGS excuses two kinds of test, and each entry's comment says which and what it lists:
      (i) a test whose listings stay in its own temp dirs, or that copies the tree only to run named scripts from
          the copy;
      (ii) a test whose only repo walk is this selector's own index, and whose real-tree results change only through
          a FULL change or a change to a path the test names by basename, so that rule (1) or (3) selects it; its
          comment names those paths.
  (g) Every FOREIGN name is the basename of a tracked file.
  (h) Every repo file that tests/run.sh names, read by the .sh carrier rule (its non-comment lines), is marked FULL
      or carries `@merge-task-self-tests` on a line: run.sh's own inputs run in every mode.
"""
import ast
import fnmatch
import os
import re
import subprocess
import sys
import warnings

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAP = "tests/fast-tier.map"
SELF = "tests/lib/fast-tier.py"
RUNNER = "tests/run.sh"
SELF_TESTS = "@merge-task-self-tests"
COLLECTED = ("skills/execute/tests/*.test.mjs", "tests/*.test.mjs", "tests/contracts/*.test.mjs",
             "skills/execute/tests/*.test.sh", "tests/*.test.sh")
SOURCES = ("skills/*/scripts/*", "hooks/*", "skills/*/*.workflow.js", "skills/*/diagnostics/*.workflow.js")
CARRIER_SUFFIXES = (".py", ".sh", ".js", ".mjs", ".json")
FIXTURES = "tests/fixtures"
LIB = "tests/lib/"
WALKERS = "**"
KEYWORD = re.compile(r"[A-Z][A-Z-]*\Z")
GLOB_CHARS = re.compile(r"[*?\[]")
TOKEN = re.compile(r"[A-Za-z0-9_.-]+")
TOKEN_NAME = re.compile(r"[A-Za-z0-9_.-]+\Z")
_LEAD = r"(?:^|(?<=[\s;&|(`'\"]))"   # a command word's left edge: line start, blank, ; & | ( ` or a quote
RUN_FORM = re.compile(_LEAD + r"(?:bash|sh|node)(?:[ \t]+--test)?[ \t]+([^\s;&|)`]+)", re.M)
FIXTURE_LITERAL = r"fixtures/{d}(?![A-Za-z0-9_.-])"
FIXTURE_SEGMENTS = r"""['"](?:[^'"\n]*/)?fixtures['"]\s*,\s*['"]{d}['"/]"""
LISTING_ANY = re.compile(r"readdirSync\(|\breaddir\(|opendirSync\(|globSync\(|ls-files|os\.walk\(|os\.listdir\("
                         r"|os\.scandir\(|rglob\(")
LISTING_LITERALS = ("readdirSync(", "readdir(", "opendirSync(", "globSync(", "ls-files", "os.walk(", "os.listdir(",
                    "os.scandir(", "rglob(")
CONTRACT_IMPORT = re.compile(r"""\bimport\s+([^'";]*?)\s*from\s*['"][^'"]*contract-text\.mjs['"]""", re.S)
WALK_NAMES = ("walk", "textFiles", "skillCount")
_SPAWN = r"\b(?:spawnSync|execSync|execFileSync|spawn|execFile|exec)\(\s*"
NODE_SPAWN_LIST = re.compile(_SPAWN + r"""['"`](?:grep|find|ls)(?=['"`\s])""")
NODE_SPAWN_GIT = re.compile(_SPAWN + r"""(?:['"`]git\s+(?:-C\s+\S+\s+)?(?:grep|ls-files)\b"""
                            r"""|['"`]git['"`]\s*,\s*\[[^\]]*['"`](?:grep|ls-files)['"`])""")
NODE_CPSYNC = re.compile(r"cpSync\(\s*(?:path\.join\(\s*)?(?:root|ROOT|PLUGIN)\b")
SH_LIST = re.compile(_LEAD + r"(find|ls|grep|cp|tar|rsync)(?=[ \t])([^|;&)`\n]*)", re.M)
SH_FOR = re.compile(_LEAD + r"for[ \t]+\w+[ \t]+in[ \t]+([^;\n]*)", re.M)
SH_GIT = re.compile(_LEAD + r"git((?:[ \t]+-C[ \t]+\S+)?)[ \t]+(?:grep|ls-files|ls-tree)\b", re.M)
SH_CD = re.compile(_LEAD + r"cd[ \t]+(\S+)")
ROOT_DIRS = re.compile(r"(?:skills|hooks|tests|docs|evals|\.github|\.claude-plugin)(?![A-Za-z0-9_-])")
ROOT_VARS = re.compile(r"\$(?:\{(?:root|ROOT|ROOTDIR|PLUGIN|HERE|CLAUDE_PLUGIN_ROOT|PWD)\}"
                       r"|(?:root|ROOT|ROOTDIR|PLUGIN|HERE|CLAUDE_PLUGIN_ROOT|PWD)(?![A-Za-z0-9_])|\(pwd)")


_DOC_OWNERS = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
_NO_CONSTANTS = (ast.Name, ast.Load, ast.Store, ast.Del, ast.alias, ast.Pass, ast.Break, ast.Continue)


def git(*args):
    """(rc, stdout) of one git call in ROOT; never raises."""
    try:
        p = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return 127, b""
    return p.returncode, p.stdout


def match(pattern, path):
    """A map pattern against a repo-relative path, segment by segment: fnmatchcase on each segment (so `*`, `?` and
    `[...]` never cross a `/`), and a whole `**` segment matches zero or more segments."""
    return _match(tuple(pattern.split("/")), tuple(path.split("/")))


def _match(ps, xs):
    if not ps:
        return not xs
    if ps[0] == "**":
        return any(_match(ps[1:], xs[i:]) for i in range(len(xs) + 1))
    return bool(xs) and fnmatch.fnmatchcase(xs[0], ps[0]) and _match(ps[1:], xs[1:])


def collected(path):
    return any(match(g, path) for g in COLLECTED)


def read(path):
    try:
        with open(os.path.join(ROOT, path), encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def sh_code(text):
    """The .sh carrier rule: every line whose first non-blank character is not `#`."""
    return "\n".join(l for l in text.split("\n") if not l.lstrip().startswith("#"))


def py_strings(text):
    """A .py file's str and bytes constants, docstrings dropped; its whole text when it does not parse. A hand-rolled
    walk (ast.walk costs twice as much), which skips the nodes that hold no constant."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return text
    out, stack = [], [tree]
    while stack:
        node = stack.pop()
        cls = type(node)
        if cls is ast.Constant:
            v = node.value
            if type(v) is str:
                out.append(v)
            elif type(v) is bytes:
                out.append(v.decode("utf-8", "replace"))
            continue
        if cls in _NO_CONSTANTS:
            continue
        doc = None
        if cls in _DOC_OWNERS and node.body:
            first = node.body[0]
            if type(first) is ast.Expr and type(first.value) is ast.Constant and type(first.value.value) is str:
                doc = first
        for field in node._fields:
            v = getattr(node, field, None)
            if type(v) is list:
                stack.extend(x for x in v if x is not doc and isinstance(x, ast.AST))
            elif isinstance(v, ast.AST):
                stack.append(v)
    return "\n".join(out)


def naming_text(path, text):
    if path.endswith(".py"):
        return py_strings(text)
    if path.endswith(".sh"):
        return sh_code(text)
    return text


def tokens(text):
    return {t.rstrip(".") for t in TOKEN.findall(text)}


def unquote(s):
    return s.replace('"', "").replace("'", "")


class Line:
    """One map line: its number, pattern, kind (PLACE, PLAIN, FULL, NONE or ALSO) and resolved entries."""
    def __init__(self, no, pattern, kind):
        self.no, self.pattern, self.kind = no, pattern, kind
        self.entries = set()   # collected test paths and SELF_TESTS


class Repo:
    def __init__(self):
        rc, out = git("ls-files", "-z", "-co", "--exclude-standard")
        self.git_ok = rc == 0
        listed = sorted({p for p in out.decode("utf-8", "replace").split("\0") if p and not p.startswith(".claude/")})
        self.files = [p for p in listed if os.path.isfile(os.path.join(ROOT, p))]
        rc, out = git("ls-files", "-z")
        self.tracked = sorted({p for p in out.decode("utf-8", "replace").split("\0") if p})
        self.tests = [p for p in self.files if collected(p)]
        test_set = set(self.tests)
        never = test_set | {RUNNER, SELF}
        self.carriers = [p for p in self.files if p.endswith(CARRIER_SUFFIXES) and p not in never]
        self.naming = {p: naming_text(p, read(p)) for p in self.carriers}   # a carrier's naming text
        self.text = {p: read(p) for p in self.tests}                        # a test's whole text
        self.carrier_index = {}
        for p in self.carriers:
            for tok in tokens(self.naming[p]):
                self.carrier_index.setdefault(tok, set()).add(p)
        self.test_index = {}
        for p in self.tests:
            for tok in tokens(self.text[p]):
                self.test_index.setdefault(tok, set()).add(p)
        # The runner map: test -> the collected tests it runs; ran_by is its inverse.
        self.runs, self.ran_by = {}, {}
        by_base = {}
        for t in self.tests:
            by_base.setdefault(os.path.basename(t), []).append(t)
        for p in self.tests:
            body = sh_code(self.text[p]) if p.endswith(".sh") else self.text[p]
            got = set()
            for m in RUN_FORM.finditer(body):
                op = unquote(m.group(1))
                for t in by_base.get(os.path.basename(op), ()):
                    if t != p and (op == t or op.endswith("/" + t)):
                        got.add(t)
            self.runs[p] = got
            for t in got:
                self.ran_by.setdefault(t, set()).add(p)
        self.map_lines, self.foreign, self.own, self.parse_problems = parse_map(self)
        self._matching = {}

    # ---- naming ----
    def namers(self, base, pool):
        """The items of `pool` (carriers or tests) whose text names `base`."""
        index, texts = (self.carrier_index, self.naming) if pool == "carriers" else (self.test_index, self.text)
        if TOKEN_NAME.match(base):
            return set(index.get(base.rstrip("."), ()))
        items = self.carriers if pool == "carriers" else self.tests
        return {p for p in items if base in texts[p]}

    def matching(self, path):
        got = self._matching.get(path)
        if got is None:
            got = [l for l in self.map_lines if match(l.pattern, path)]
            self._matching[path] = got
        return got

    # ---- the rules ----
    def reach(self, p, ignore_full=False):
        """Rule (3) from p: (full reason | None, reach, also, none_only)."""
        def kind(l):
            return "PLACE" if (ignore_full and l.kind == "FULL") else l.kind
        placing = [l for l in self.matching(p) if l.kind != "ALSO"]
        if not placing:
            return f"{p}: not in the map", set(), set(), False
        none_only = all(kind(l) == "NONE" for l in placing)
        seen, level, reach, also = {p}, [p], set(), set()
        while level:
            nxt = []
            for q in sorted(level):
                lines = self.matching(q)
                placing = [l for l in lines if l.kind != "ALSO"]
                if any(kind(l) == "FULL" for l in placing):
                    return (f"{p}: marked FULL" if q == p else f"{p}: reaches {q}, marked FULL"), reach, also, False
                if not placing:
                    return f"{p}: reaches {q}, not in the map", reach, also, False
                # Every placed item adds its lines' ALSO entries (the walkers), a NONE-only one too: a diff to a NONE
                # path, tests/e2e/ say, still changes text a walker reads.
                for l in lines:
                    if l.kind == "ALSO":
                        also |= l.entries
                if all(kind(l) == "NONE" for l in placing):
                    continue
                base = os.path.basename(q)
                for l in placing:
                    reach |= l.entries
                reach |= self.namers(base, "tests")
                pushed = self.namers(base, "carriers")
                if base in self.foreign:
                    pushed = {c for c in pushed if c.startswith(LIB)}
                for c in pushed:
                    if c not in seen:
                        seen.add(c)
                        nxt.append(c)
            level = nxt
        return None, reach, also, none_only

    def select(self, paths, ignore_full=False):
        """(full reason | None, selected entries)."""
        selected = set()
        for p in sorted(paths):
            if collected(p):
                if p in self.text:
                    selected.add(p)
                for l in self.matching(p):
                    selected |= l.entries
                selected |= self.namers(os.path.basename(p), "tests")
                continue
            full, reach, also, none_only = self.reach(p, ignore_full)
            if full:
                return full, set()
            if not none_only and not reach:
                return f"{p}: reaches no test", set()
            selected |= reach | also
        todo = [t for t in selected if t != SELF_TESTS]
        while todo:
            t = todo.pop()
            for r in self.ran_by.get(t, ()):
                if r not in selected:
                    selected.add(r)
                    todo.append(r)
        return None, selected


def parse_map(repo):
    """(lines, FOREIGN names, OWN-LISTINGS (line, test) pairs, problems) of tests/fast-tier.map, entries resolved."""
    lines, foreign, own, problems = [], set(), [], []
    try:
        with open(os.path.join(ROOT, MAP), encoding="utf-8") as f:
            raw = f.read().split("\n")
    except OSError:
        return lines, foreign, own, [f"{MAP} is missing"]
    for no, text in enumerate(raw, 1):
        body, _, comment = text.partition("#")
        words = body.split()
        if not words:
            continue
        head, rest = words[0], words[1:]
        where = f"{MAP}:{no}"
        if head == "FOREIGN":
            if not rest:
                problems.append(f"{where}: FOREIGN names no basename (check a)")
            foreign.update(rest)
            continue
        if head == "OWN-LISTINGS":
            if not rest:
                problems.append(f"{where}: OWN-LISTINGS names no test (check a)")
            if not re.match(r"\s*\((?:i|ii)\)", comment):
                problems.append(f"{where}: an OWN-LISTINGS line ends with a `# (i) ...` or `# (ii) ...` comment saying "
                                f"which kind it is and what it lists (check a)")
            own.extend((no, t) for t in rest)
            continue
        if KEYWORD.match(head):
            problems.append(f"{where}: unknown keyword {head} (check a)")
            continue
        kind = "PLACE"
        if rest and rest[0] in ("FULL", "NONE"):
            kind = rest[0]
            if len(rest) > 1:
                problems.append(f"{where}: {rest[0]} stands alone on its line (check a)")
            rest = []
        elif rest and rest[0] == "ALSO":
            kind, rest = "ALSO", rest[1:]
            if not rest:
                problems.append(f"{where}: ALSO lists no entry (check a)")
        elif rest:
            kind = "PLAIN"
        line = Line(no, head, kind)
        for w in rest:
            if KEYWORD.match(w):
                problems.append(f"{where}: {w} is not an entry; FULL, NONE and ALSO come first on a line (check a)")
            elif w.startswith("@"):
                if w != SELF_TESTS:
                    problems.append(f"{where}: {w}: {SELF_TESTS} is the only @ entry (check a)")
                elif kind != "PLAIN":
                    problems.append(f"{where}: {SELF_TESTS} sits on plain lines only (check a)")
                else:
                    line.entries.add(w)
            elif GLOB_CHARS.search(w):
                got = {t for t in repo.tests if match(w, t)}
                if not got:
                    problems.append(f"{where}: the entry {w} matches no collected test (check c)")
                line.entries |= got
            else:
                if w not in repo.tests:
                    problems.append(f"{where}: the entry {w} is not a collected test (check c)")
                else:
                    line.entries.add(w)
        lines.append(line)
    return lines, foreign, own, problems


# ---- check (f): directory listings ------------------------------------------------------------------------------

def root_operand(tok, cd=None):
    t = unquote(tok)
    if t == "." or t.startswith("./"):
        return cd is None or root_operand(cd)
    return bool(ROOT_DIRS.match(t) or (t.startswith("$") and ROOT_VARS.match(t)))


def _nearest_cd(line, pos):
    found = None
    for m in SH_CD.finditer(line, 0, pos):
        found = m.group(1)
    return found


def sh_listing(text):
    """The first .sh LISTING form on a non-comment line, as a short label, or ''."""
    for line in sh_code(text).split("\n"):
        for m in SH_LIST.finditer(line):
            cmd, ops = m.group(1), m.group(2).split()
            if cmd == "grep" and not any(re.match(r"-[A-Za-z]*[rR][A-Za-z]*\Z", o) for o in ops):
                continue
            if cmd == "cp" and not any(re.match(r"-[A-Za-z]*[rRa][A-Za-z]*\Z", o) for o in ops):
                continue
            cd = _nearest_cd(line, m.start())
            if any(root_operand(o, cd) for o in ops if not o.startswith("-")):
                return f"{cmd} over the tree: {line.strip()[:80]}"
        for m in SH_FOR.finditer(line):
            ops = m.group(1).split()
            if any(GLOB_CHARS.search(o) and root_operand(o) for o in ops):
                return f"for-in over a tree glob: {line.strip()[:80]}"
        for m in SH_GIT.finditer(line):
            c = m.group(1).split()
            if not c or root_operand(c[-1]):
                return f"git listing: {line.strip()[:80]}"
    return ""


def contract_walker(text):
    """True when the text imports contract-text.mjs's walk, textFiles or skillCount, or all of it."""
    for m in CONTRACT_IMPORT.finditer(text):
        clause = m.group(1).strip()
        if not clause.startswith("{"):
            return True   # a default or namespace import (`X`, `* as X`, `X, { ... }`)
        names = [n.strip().split()[0] for n in clause.strip("{} \n").split(",") if n.strip()]
        if any(n in WALK_NAMES for n in names):
            return True
    return False


def listing_form(path, text):
    """The test's own LISTING form, as a short label, or ''. Each regex runs behind a substring guard, which keeps
    check near a second on this repo."""
    if "contract-text" in text and contract_walker(text):
        return "a contract-text walk import"
    if any(lit in text for lit in LISTING_LITERALS):
        m = LISTING_ANY.search(text)
        if m:
            return m.group(0)
    if path.endswith(".sh"):
        return sh_listing(text)
    if any(q + w in text for q in "'\"`" for w in ("grep", "find", "ls", "git")):
        for rx, label in ((NODE_SPAWN_LIST, "a spawned listing"), (NODE_SPAWN_GIT, "a spawned git listing")):
            m = rx.search(text)
            if m:
                return f"{label}: {m.group(0)[:60]}"
    if "cpSync(" in text:
        m = NODE_CPSYNC.search(text)
        if m:
            return f"a tree copy: {m.group(0)[:60]}"
    return ""


def fixture_form(text, d):
    """The FIXTURE form in which a text holds the fixture dir d, or ''."""
    if "fixtures/" + d in text and re.search(FIXTURE_LITERAL.format(d=re.escape(d)), text):
        return "fixtures/" + d
    if ("fixtures'" in text or 'fixtures"' in text) and re.search(FIXTURE_SEGMENTS.format(d=re.escape(d)), text):
        return f"'fixtures', '{d}'"
    return ""


# ---- check ------------------------------------------------------------------------------------------------------

def check(repo):
    if not repo.git_ok:
        return [f"git ls-files failed in {ROOT}: the map is checked against a git checkout"], ""
    problems = list(repo.parse_problems)
    by_pattern = {}
    for l in repo.map_lines:
        by_pattern.setdefault(l.pattern, []).append(l)
    # (b) patterns
    for l in repo.map_lines:
        if GLOB_CHARS.search(l.pattern):
            if not any(match(l.pattern, t) for t in repo.tracked):
                problems.append(f"{MAP}:{l.no}: the glob {l.pattern} matches no tracked file (check b)")
        elif not os.path.exists(os.path.join(ROOT, l.pattern)):
            problems.append(f"{MAP}:{l.no}: {l.pattern} does not exist (check b)")
    # (c) OWN-LISTINGS entries are collected tests
    for no, t in repo.own:
        if t not in repo.tests:
            problems.append(f"{MAP}:{no}: the OWN-LISTINGS entry {t} is not a collected test (check c)")
    # (d) sources
    sources = [p for p in repo.files if any(match(g, p) for g in SOURCES)]
    for s in sources:
        full, reach, _also, none_only = repo.reach(s)
        if full == f"{s}: not in the map":
            problems.append(f"{s}: not placed by any map line; give it a line (check d)")
        elif not full and not reach:
            problems.append(f"{s}: reaches no test; name it in a test, give its line entries, or mark it FULL (check d)")
    # (e) fixture dirs
    dirs = sorted({p.split("/")[2] for p in repo.tracked if p.startswith(FIXTURES + "/") and p.count("/") >= 3})
    helpers = [p for p in repo.files if p.startswith(LIB)]
    helper_text = {h: read(h) for h in helpers}
    for d in dirs:
        consumers = {}
        for t in repo.tests:
            form = fixture_form(repo.text[t], d)
            if form:
                consumers[t] = f"holds {form}"
        for h in helpers:
            form = fixture_form(helper_text[h], d)
            if form:
                for t in repo.namers(os.path.basename(h), "tests"):
                    consumers.setdefault(t, f"names {h}, which holds {form}")
        pat = f"{FIXTURES}/{d}/**"
        lines = [l for l in by_pattern.get(pat, ()) if l.kind == "PLAIN"]
        if not lines:
            problems.append(f"{FIXTURES}/{d}/: no `{pat} <test>...` line naming its consumers (check e)")
            continue
        have = set().union(*(l.entries for l in lines))
        for t in sorted(consumers):
            if t not in have:
                problems.append(f"{MAP}:{lines[0].no}: {t} {consumers[t]} but is missing from the {pat} line (check e)")
    # (f) directory listings
    walkers = set()
    for l in by_pattern.get(WALKERS, ()):
        if l.kind == "ALSO":
            walkers |= l.entries
    own = {t for _no, t in repo.own}
    direct = {t: listing_form(t, repo.text[t]) for t in repo.tests}
    lists = {}

    def lists_dir(t, stack=()):
        if t in lists:
            return lists[t]
        if direct[t]:
            lists[t] = direct[t]
            return lists[t]
        got = ""
        for u in sorted(repo.runs.get(t, ())):
            if u not in stack and lists_dir(u, stack + (t,)):
                got = f"runs {u}, which lists a directory"
                break
        lists[t] = got
        return got

    for t in repo.tests:
        why = lists_dir(t)
        ran_walkers = sorted(u for u in repo.runs.get(t, ()) if u in walkers)
        if ran_walkers and t not in walkers:
            problems.append(f"{t}: runs the walker {ran_walkers[0]}, so it belongs on the `** ALSO` walkers line itself "
                            f"(OWN-LISTINGS is not enough) (check f)")
        elif why and t not in walkers and t not in own:
            problems.append(f"{t}: lists a directory ({why}); add it to the `** ALSO` walkers line, or to OWN-LISTINGS "
                            f"with its kind (check f)")
    for no, t in repo.own:
        if t not in repo.text:
            continue
        if not lists_dir(t):
            problems.append(f"{MAP}:{no}: the OWN-LISTINGS entry {t} lists nothing; drop it (check f)")
        if contract_walker(repo.text[t]):
            problems.append(f"{MAP}:{no}: {t} walks the tree through contract-text.mjs, so it belongs on the `** ALSO` "
                            f"walkers line, never OWN-LISTINGS (check f)")
    # (g) FOREIGN names
    basenames = {}
    for p in repo.tracked:
        basenames.setdefault(os.path.basename(p), []).append(p)
    for name in sorted(repo.foreign):
        if name not in basenames:
            problems.append(f"{MAP}: the FOREIGN name {name} is the basename of no tracked file (check g)")
    # (h) run.sh's own inputs
    named = tokens(sh_code(read(RUNNER)))
    for name in sorted(named):
        for p in basenames.get(name, ()):
            lines = repo.matching(p)
            if not any(l.kind == "FULL" or SELF_TESTS in l.entries for l in lines):
                problems.append(f"{RUNNER} names {p}; mark it FULL or give it {SELF_TESTS} on a line (check h)")
    if problems:
        return problems, ""
    summary = (f"{len(repo.map_lines)} lines, {len(sources)} sources placed, {len(dirs)} fixture dirs, "
               f"{len(walkers)} walkers, {len(own)} own-listings")
    return [], summary


# ---- the CLI ----------------------------------------------------------------------------------------------------

def changed_paths(base):
    """(full reason | None, merge base, source, paths) from git."""
    revs = [("--base", base)] if base is not None else [(r, r) for r in ("origin/HEAD", "origin/master", "origin/main")]
    sha = source = None
    for source_name, rev in revs:
        rc, out = git("rev-parse", "--verify", "-q", rev + "^{commit}")
        if rc == 0 and out.strip():
            sha, source = out.decode().strip(), source_name
            break
    if sha is None:
        if base is not None:
            return f"base {base} does not resolve", None, None, []
        return "no base: origin/HEAD, origin/master and origin/main do not resolve", None, None, []
    rc, out = git("merge-base", sha, "HEAD")
    if rc != 0 or not out.strip():
        return f"no merge base of {sha[:12]} and HEAD (a shallow clone?)", None, None, []
    mb = out.decode().strip()
    rc, diff = git("diff", "-z", "--name-only", "--no-renames", mb)
    if rc != 0:
        return f"git diff from {mb[:12]} failed", None, None, []
    _rc, others = git("ls-files", "-z", "--others", "--exclude-standard")
    paths = {p for p in (diff + b"\0" + others).decode("utf-8", "replace").split("\0") if p}
    return None, mb, source, paths


def usage(msg=""):
    if msg:
        print(f"fast-tier: {msg}", file=sys.stderr)
    print("usage: fast-tier.py select [--base REV] [--paths P...] [--ignore-full] | check", file=sys.stderr)
    return 2


def main(argv):
    if not argv:
        return usage()
    cmd, rest = argv[0], argv[1:]
    if cmd == "check":
        if rest:
            return usage("check takes no arguments")
        problems, summary = check(Repo())
        for p in problems:
            print(f"fast-tier map: {p}")
        if problems:
            return 1
        print(f"fast-tier map: ok ({summary})")
        return 0
    if cmd != "select":
        return usage(f"unknown command {cmd}")
    base, paths, ignore_full = None, None, False
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--base" and i + 1 < len(rest):
            base, i = rest[i + 1], i + 2
        elif a == "--ignore-full":
            ignore_full, i = True, i + 1
        elif a == "--paths":
            paths, i = rest[i + 1:], len(rest)
        else:
            return usage(f"unknown argument {a}")
    if paths is not None:
        if base is not None:
            return usage("--paths takes no --base")
        mb = source = "-"
    else:
        full, mb, source, paths = changed_paths(base)
        if full:
            print(f"FULL\t{full}")
            return 0
    paths = sorted({p for p in paths if p and not p.startswith(".claude/")})
    if not paths:
        print(f"FULL\tno changed paths from {base if base is not None else (mb if mb != '-' else 'the given paths')}")
        return 0
    repo = Repo()
    full, selected = repo.select(paths, ignore_full)
    if full:
        print(f"FULL\t{full}")
        return 0
    print(f"FAST\t{mb}\t{source}\t{len(paths)}")
    for e in sorted(selected):
        print(e)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
