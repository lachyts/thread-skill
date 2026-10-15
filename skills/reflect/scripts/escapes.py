#!/usr/bin/env python3
"""escapes.py — a rollout's Escapes and Quality, for score.py (p21-4, ADR 0037 d7). Reads only; writes nothing.

python >= 3.8, stdlib only. score.py loads it and calls

    score(landed, tasks_dir, repo, repo_slug, env) -> (block, flags)

`landed` is {task: {pr, readOnly, at}} from the scored window's `merged` lines; `tasks_dir` the vault's Work/Tasks;
`repo` any directory in the Project root's clone (or None); `repo_slug` its owner/name (or None); `env` the caller's
environment. It never raises: a source that fails reads `unread: <why>`. It never fetches, touches no network and
prints nothing (score.py's stderr is its one summary line). It loads reconcile-rollout.py for Note, _wikilink_slug,
_status and _fold_unit, unchanged, so it reads a note, a slug and a folded member exactly as the queue does.

An Escape (CONTEXT.md, the Escape entry) is landed work that later needs a fix it should not have needed. Three
sources, each read up to now: the window bounds the landed set, never the evidence (ADR 0037 d4, d7), so a re-score
counts a late Escape against the earlier rollout and can lower its Quality. Nothing is stored.

Slugs. Every slug compared is canonical: `_canon(v) = (_wikilink_slug(v) or "").lower()`, for the landed keys (the
record's `task`, already run_record.normalise_slug output), each `fixes:` entry, each `merged_into:` target and each
note stem. `[[A1]]`, `a1.md`, `[[a1|alias]]`, `[[dir/a1#h]]` and an `A1.md` basename all name `a1`. Two landed keys
that canonicalise to one slug (a hand-edited record) are one landed task, flagged; the later line's pr wins.

(a) fixes. Every `*.md` under tasks_dir, Archive included, read with reconcile's Note; an OSError or ValueError (no
    frontmatter, not UTF-8) skips the note, counted in excluded.unreadNotes. The index is {stem.lower(): (path,
    Note)}, a root copy preferred over an archived one (reconcile's _scan), and each indexed note's `fixes:` is read
    with Note.get_list (scalar, inline list or block list). An entry names a landed task when its slug is a landed
    key, or when _fold_unit follows it through `merged_into:` to a landed key (a member schedule step 4.5 folded:
    its tombstone gets no `merged` line, its combined note does); the evidence then carries `via`. Evidence is
    {source: fixes, note, status[, via]}, once per (fixer, landed task). Ignored: a self-named fixer (the task is
    the fixer itself, or the unit the fixer folds into: excluded.selfNamed), a fixer at `status: dropped` (judged
    not needed; a reshuffle merge moves its `fixes:` to the survivor: excluded.dropped), and, silently, an entry
    that names no landed task even after the fold (a phase, a rollout, an unknown name). A fixer at `status:
    merged` (a tombstone) counts: its work was dispatched through its combined note. Read whenever tasks_dir is a
    directory; else `unread: tasks dir <p> not found`.

Git. `top` is `git -C <repo> rev-parse --show-toplevel` (else reverts and reviews are `unread: --repo <p> is not a
git work tree`), and every later call is `git -C <top> ...`, so `docs/reviews/` and blame paths are repo-relative.
Every call runs with the caller's env minus every name `git rev-parse --local-env-vars` prints (an empty list when
that fails), stdin closed, output decoded utf-8 with errors replaced, and a GIT_TIMEOUT s timeout: rollout-settings.py's
_git_env(), lead-integrate.py and unfinished-rollout.py's git_env() build the same env. With no --repo, both are
`unread: no --repo`.

The ref. refs/remotes/origin/HEAD; else exactly one of origin/main or origin/master, flagged ("origin/HEAD unset:
...; `git remote set-head origin --auto` pins it"); else HEAD, flagged. It is never fetched, so the block reports
ref {name, tip, tipDate}: a revert or review pushed since the last fetch is missed. No commit on it: `unread: no
commit on <ref>`. One full log of it (`git log --format=%H%x1f%P%x1f%s%x1f%b%x1e <tip>`, every reachable commit,
never --first-parent: a squash can be reachable only through a second parent) feeds both the task commits and the
reverts; if it fails both are `unread: git log failed: <first stderr line>`.

Task commits. A landed task's `pr` is an int, a numeric string or a `.../pull/<N>` URL. A URL whose owner/name is not
the repo identity (repo_slug, ignoring case) leaves its git evidence unresolved ("pr <url> is not <slug>'s"); with
no repo identity a URL is read by its number, flagged once. Its commits are every single-parent commit whose subject
ends ` (#N)` (merge-task.sh squash-merges), and for a PR merged with a merge commit the two-parent commit whose
subject starts `Merge pull request #N from ` plus `git rev-list P1..P2`. More than one match: all are its commits,
flagged. No pr, or no match: unresolved (excluded.unresolved [{task, why}], flagged). `readOnly: true` expects no
commit: only fixes evidence applies and it is never unresolved. Tasks sharing one PR (sequential-merged members) share
its commits, so one revert counts once for each of them, flagged.

(b) reverts. A reachable commit whose body says `This reverts commit <7-40 hex>`, the hex a prefix of a task commit
    (a revert squash-merged onto main, or landed on a `Merge pull request` commit's second parent). Naming the squash
    sha makes it later, so there is no ordering check. With no such body line, a subject `Revert "<S>"` with an
    optional ` (#M)` counts when S is the subject of exactly one task commit, with or without its ` (#N)`, and that
    commit is an ancestor of the revert (`merge-base --is-ancestor`). A Reapply names the revert, never a task
    commit, so it adds nothing; a revert the ref does not reach never counts; a task's own commit reverting its own
    work is no Escape. Evidence is {source: revert, commit, subject}.

(c) reviews, mirroring the fresh-review ledger's reading (personal, outside the plugin, so not imported). The docs:
    the newest add or modify of each `docs/reviews/*.md` in `git log --all --diff-filter=AM --format=@@%H
    --name-only -- docs/reviews/` (the lifecycle deletes consumed docs, so history is the main source), read in one
    `git cat-file --batch`; a working-tree `<top>/docs/reviews/*.md` wins over its history. No doc in either is a
    fact, not a failure: reviews read, reviewDocs 0. Reviews are unread only with no --repo, no top, no ref, a
    failed full log or a failed doc log. A doc: front matter `head:` and `status:`; its findings table is the first
    table with numbered rows, ending at the first non-row line; the header gives the `file:line` column (else cell
    2) and the `verdict` column; the first `([\\w./+-]+\\.\\w+):(\\d+)` in the cell is its citation; a later table
    headed `| # | outcome`, `| # | disposition` or `| # | resolution` gives each row's disposition (a later one
    wins). A row never counts (excluded.rejectedRows) when its verdict or disposition, `*` and backticks removed,
    trimmed and lowercased, starts with one of REJECTED; `fixed`, `held`, `deferred`, `moved` and a pending doc's
    rows count. Heads resolve in one `git cat-file --batch-check`; a missing, ambiguous or non-sha head is
    excluded.unresolvedDocs. Blame is bounded: for each landing commit C (a squash, or a PR's merge commit) one `git
    rev-list --ancestry-path ^C <every resolved head>` and one `git diff-tree -r --name-only <C's first parent> C`;
    only a row whose doc head is C or descends from it, citing a file C changed, is blamed (`git blame -L n,n
    --porcelain <head> -- <file>`). A blamed sha among the task's commits is evidence {source: review, doc, head, row,
    cite, status, disposition}; a failed blame is excluded.unresolvedRows. A review of the task's own PR before it
    merged never counts: its head does not descend from the squash. Attribution is by blame, so a finding on an old
    line counts against whichever task last wrote it.

The block: {count, landed, quality, partial, bySource {fixes, reverts, reviews}, reviewDocs, tasks [{task, pr,
commits, evidence}], sources {fixes, reverts, reviews: "read" | "unread: <why>"}, ref, excluded {dropped, selfNamed,
unreadNotes, rejectedRows, unresolved, unresolvedDocs, unresolvedRows}}. Escapes are deduped per landed task: count
is the landed tasks with any evidence (null when every source is unread), and every piece is listed. bySource.<s>
counts the landed tasks with evidence from s (null when s is unread); reviewDocs the docs read (null when reviews
are unread). quality = round(1 - count / landed, 4), null with nothing landed or every source unread. partial is true
when a source is unread or a landed task that is not read-only has unresolved git evidence: Quality can then only
read too high, and a flag says what it rests on.
"""
from __future__ import annotations

import datetime
import glob
import importlib.util
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
RECONCILE_PY = os.path.join(os.path.dirname(os.path.dirname(HERE)), "execute", "scripts", "reconcile-rollout.py")

SOURCES = ("fixes", "reverts", "reviews")
EVIDENCE = {"fixes": "fixes", "reverts": "revert", "reviews": "review"}  # bySource key -> evidence `source`
GIT_TIMEOUT = 60
REVIEWS = "docs/reviews"
REJECTED = ("skip", "reject", "deliberate", "false positive", "won't fix", "wontfix", "not a bug", "invalid",
            "withdrawn")

SQUASH_RE = re.compile(r" \(#(\d+)\)$")
MERGE_PR_RE = re.compile(r"^Merge pull request #(\d+) from ")
REVERTS_RE = re.compile(r"This reverts commit ([0-9a-f]{7,40})\b", re.I)
REVERT_SUBJECT_RE = re.compile(r'^Revert "(.*)"(?: \(#\d+\))?$')
PR_NUM_RE = re.compile(r"^#?(\d+)$")
PR_URL_RE = re.compile(r"^https?://[^/\s]+/([^/\s]+)/([^/\s]+)/pull/(\d+)/?$", re.I)
OBJECT_RE = re.compile(r"^([0-9a-f]{40,64}) (\w+) (\d+)$")
HEAD_RE = re.compile(r"^[0-9a-fA-F]{4,64}$")
BLAME_RE = re.compile(r"^([0-9a-f]{40,64}) \d+ \d+")
FM_RE = re.compile(r"^(\w+):[ \t]*(.*)$", re.M)
ROW_RE = re.compile(r"^\s*\|\s*(\d+)\s*\|")
DISPOSITION_RE = re.compile(r"^\s*\|\s*#\s*\|\s*[*`\s]*(?:outcome|disposition|resolution)\b", re.I)
CITE_RE = re.compile(r"([\w./+-]+\.\w+):(\d+)")


def _load(name, path):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_RR = _load("thread_escapes_reconcile", RECONCILE_PY)
Note, _wikilink_slug, _status, _fold_unit = _RR.Note, _RR._wikilink_slug, _RR._status, _RR._fold_unit


class _Unread(Exception):
    """A source cannot be read: its message is the why."""


def _canon(value):
    return (_wikilink_slug(value) or "").lower() if isinstance(value, str) else ""


def _why(exc):
    return str(exc) if isinstance(exc, _Unread) else "%s: %s" % (type(exc).__name__, exc)


def _first(text):
    lines = [x.strip() for x in (text or "").splitlines() if x.strip()]
    return lines[0] if lines else "no message"


def _utc(epoch):
    dt = datetime.datetime.fromtimestamp(int(epoch), tz=datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _git_env(env):
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as rollout-settings.py's _git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env,
                               timeout=GIT_TIMEOUT).stdout.decode("utf-8", "replace").split()
    except (OSError, subprocess.SubprocessError):
        names = []
    out = dict(env)
    for name in names:
        out.pop(name, None)
    return out


def _cells(line):
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|") and not inner.endswith("\\|"):
        inner = inner[:-1]
    return [c.strip() for c in re.split(r"(?<!\\)\|", inner)]


def _plain(cell):
    return re.sub(r"[*`]", "", cell or "").strip().lower().replace("\u2019", "'")


def _rejected(*cells):
    return any(_plain(c).startswith(REJECTED) for c in cells if c)


def _parse_doc(text):
    """{head, status, rows: [{n, cite, file, line, verdict, disposition}]} of one review doc."""
    fm, body = {}, text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end >= 0:
            fm = {k: v.strip() for k, v in FM_RE.findall(text[3:end])}
            body = text[end + 4:]
    lines = body.splitlines()
    start = next((k for k, x in enumerate(lines) if ROW_RE.match(x)), None)
    doc = {"head": fm.get("head") or None, "status": fm.get("status") or None, "rows": []}
    if start is None:
        return doc
    top = start
    while top > 0 and lines[top - 1].lstrip().startswith("|"):
        top -= 1
    names = [_plain(c) for c in _cells(lines[top])] if top < start else []
    cite_col = next((k for k, x in enumerate(names) if "file" in x and "line" in x), 1)
    verdict_col = next((k for k, x in enumerate(names) if x.startswith("verdict")), None)
    end = start
    while end < len(lines) and ROW_RE.match(lines[end]):
        cells = _cells(lines[end])
        m = CITE_RE.search(cells[cite_col]) if cite_col < len(cells) else None
        verdict = cells[verdict_col] if verdict_col is not None and verdict_col < len(cells) else None
        doc["rows"].append({"n": int(ROW_RE.match(lines[end]).group(1)), "cite": m.group(0) if m else None,
                            "file": m.group(1) if m else None, "line": int(m.group(2)) if m else None,
                            "verdict": verdict, "disposition": None})
        end += 1
    disposition = {}
    k = end
    while k < len(lines):
        if not DISPOSITION_RE.match(lines[k]):
            k += 1
            continue
        names = [_plain(c) for c in _cells(lines[k])]
        col = next((i for i, x in enumerate(names) if x.startswith(("outcome", "disposition", "resolution"))), 1)
        k += 1
        while k < len(lines) and lines[k].lstrip().startswith("|"):
            m = ROW_RE.match(lines[k])
            if m:
                cells = _cells(lines[k])
                if col < len(cells):
                    disposition[int(m.group(1))] = cells[col]
            k += 1
    for row in doc["rows"]:
        row["disposition"] = disposition.get(row["n"])
    return doc


def _shown(row):
    """The row's disposition as the evidence shows it: its disposition, else its verdict, else null (a bare dash)."""
    for v in (row["disposition"], row["verdict"]):
        if v and v.strip(" -\u2013\u2014"):
            return v
    return None


class _Escapes:
    def __init__(self, landed, tasks_dir, repo, repo_slug, env):
        self.flags = []
        self.env = dict(os.environ if env is None else env)
        self.tasks_dir, self.repo, self.repo_slug = tasks_dir, repo, repo_slug
        self.sources = {}
        self.landed = self._landed(landed or {})
        self.evidence = {t: [] for t in self.landed}
        self.commits = {}   # task -> its commit shas (squash or merge commit first, then the PR's own commits)
        self.landings = {}  # task -> [(landing commit, its first parent)]
        self.excluded = {"dropped": [], "selfNamed": [], "unreadNotes": 0, "rejectedRows": 0, "unresolved": [],
                         "unresolvedDocs": [], "unresolvedRows": []}
        self.ref = self.top = self.genv = None
        self.log, self.by_sha = [], {}
        self.review_docs = None

    def flag(self, text):
        if text not in self.flags:
            self.flags.append(text)

    def _landed(self, landed):
        out, names = {}, {}
        def at(key):
            return str(landed[key].get("at") or "") if isinstance(landed[key], dict) else ""

        for key in sorted(landed, key=lambda k: (at(k), k)):
            slug = _canon(key)
            if not slug:
                continue
            d = landed[key] if isinstance(landed[key], dict) else {}
            names.setdefault(slug, []).append(key)
            prev = out.get(slug, {})
            pr = d.get("pr") if d.get("pr") not in (None, "") else prev.get("pr")
            out[slug] = {"pr": pr, "readOnly": d.get("readOnly") is True}
        for slug, keys in sorted(names.items()):
            if len(keys) > 1:
                self.flag("the record lands [[%s]] under %d slugs (%s): read as one landed task"
                          % (slug, len(keys), ", ".join(keys)))
        return out

    # ---- the whole block ---------------------------------------------------------------------------------------

    def run(self):
        try:
            self.read_fixes()
            self.read_git()
        except Exception as e:  # never raises: whatever escaped a source's own guard leaves every source unread
            why = "escapes.py failed: %s" % _why(e)
            self.sources = {s: "unread: " + why for s in SOURCES}
            self.evidence = {t: [] for t in self.landed}
        return self.block(), self.flags

    def block(self):
        read = [s for s in SOURCES if self.sources.get(s) == "read"]
        unread = [(s, (self.sources.get(s) or "unread: not read")[len("unread: "):]) for s in SOURCES if s not in read]
        by = {s: (sum(1 for t in self.landed if any(e["source"] == EVIDENCE[s] for e in self.evidence[t]))
                  if s in read else None) for s in SOURCES}
        escaped = [t for t in sorted(self.landed) if self.evidence[t]]
        n = len(self.landed)
        count = len(escaped) if read else None
        quality = round(1 - count / n, 4) if n and count is not None else None
        unresolved = sorted(self.excluded["unresolved"], key=lambda u: u["task"])
        if not n:
            self.flag("nothing landed in the window: Quality is null")
        why = "; ".join("%s unread (%s)" % (s, w) for s, w in unread)
        if not read:
            self.flag("Quality unknown: %s" % why)
        elif unread:
            self.flag("Quality rests on %s only: %s; it can only read too high" % (" and ".join(read), why))
        if unresolved:
            self.flag("Quality misses git evidence for %d landed task(s): %s; it can only read too high"
                      % (len(unresolved), "; ".join("[[%s]] (%s)" % (u["task"], u["why"]) for u in unresolved)))
        excluded = dict(self.excluded, unresolved=unresolved)
        return {
            "count": count, "landed": n, "quality": quality, "partial": bool(unread or unresolved),
            "bySource": by, "reviewDocs": self.review_docs if "reviews" in read else None,
            "tasks": [{"task": t, "pr": self.landed[t]["pr"], "commits": self.commits.get(t, []),
                       "evidence": self.evidence[t]} for t in escaped],
            "sources": {s: self.sources.get(s, "unread: not read") for s in SOURCES},
            "ref": self.ref, "excluded": excluded,
        }

    # ---- (a) fixes -----------------------------------------------------------------------------------------------

    def read_fixes(self):
        if not self.tasks_dir or not os.path.isdir(self.tasks_dir):
            self.sources["fixes"] = "unread: tasks dir %s not found" % self.tasks_dir
            return
        try:
            found, dropped, selfnamed, unread = self._fixes(Path(self.tasks_dir))
        except Exception as e:
            self.sources["fixes"] = "unread: " + _why(e)
            return
        for task, ev in found:
            self.evidence[task].append(ev)
        self.excluded.update(dropped=dropped, selfNamed=selfnamed, unreadNotes=unread)
        self.sources["fixes"] = "read"

    def _fixes(self, tasks_dir):
        index, unread = {}, 0
        for path in sorted(tasks_dir.rglob("*.md")):
            try:
                note = Note(path)
            except (OSError, ValueError):
                unread += 1
                continue
            key = path.stem.lower()
            prev = index.get(key)
            if prev is None or (prev[0].parent != tasks_dir and path.parent == tasks_dir):
                index[key] = (path, note)
        found, dropped, selfnamed, seen = [], [], [], set()
        for key in sorted(index):
            path, note = index[key]
            status = _status(note) or None
            own = None
            for entry in note.get_list("fixes"):
                slug, via = _canon(entry), None
                if not slug:
                    continue
                if slug in self.landed:
                    target = slug
                else:
                    unit, _entry, folded = _fold_unit(slug, index)
                    target = _canon(unit)
                    if not folded or target not in self.landed:
                        continue  # names no landed task, even after the fold: a phase, a rollout, an unknown name
                    via = "[[%s]] merged_into [[%s]]" % (slug, unit)
                if (key, target) in seen:
                    continue
                seen.add((key, target))
                if own is None:
                    own = _canon(_fold_unit(key, index)[0])
                if target in (key, own):
                    selfnamed.append({"note": path.stem, "task": target})
                elif status == "dropped":
                    dropped.append({"note": path.stem, "task": target})
                else:
                    ev = {"source": "fixes", "note": path.stem, "status": status}
                    if via:
                        ev["via"] = via
                    found.append((target, ev))
        found.sort(key=lambda x: (x[0], x[1]["note"].lower()))
        return found, dropped, selfnamed, unread

    # ---- git -----------------------------------------------------------------------------------------------------

    def git(self, *args, stdin=None, raw=False):
        """(returncode, stdout, stderr) of `git -C <top> <args>`; returncode -1 when git will not run or times out."""
        kw = {"input": stdin} if stdin is not None else {"stdin": subprocess.DEVNULL}
        try:
            p = subprocess.run(["git", "-C", self.top] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=self.genv, timeout=GIT_TIMEOUT, **kw)
        except (OSError, subprocess.SubprocessError) as e:
            return -1, b"" if raw else "", str(e)
        out = p.stdout if raw else p.stdout.decode("utf-8", "replace")
        return p.returncode, out, p.stderr.decode("utf-8", "replace")

    def read_git(self):
        try:
            why = self._open()
        except Exception as e:
            why = _why(e)
        if why:
            self.sources["reverts"] = self.sources["reviews"] = "unread: " + why
            return
        for source, read in (("reverts", self._reverts), ("reviews", self._reviews)):
            try:
                found = read()
            except Exception as e:
                self.sources[source] = "unread: " + _why(e)
                continue
            for task, ev in found:
                self.evidence[task].append(ev)
            self.sources[source] = "read"

    def _open(self):
        """Resolve top, the ref, the full log and the task commits; a why when reverts and reviews are unread."""
        if not self.repo:
            return "no --repo"
        self.genv = _git_env(self.env)
        self.top = self.repo
        rc, out, _err = self.git("rev-parse", "--show-toplevel")
        if rc != 0 or not out.strip():
            return "--repo %s is not a git work tree" % self.repo
        self.top = out.strip()
        rev, name = self._resolve_ref()
        rc, out, _err = self.git("show", "-s", "--format=%H%x1f%ct", rev + "^{commit}", "--")
        parts = out.strip().split("\x1f")
        if rc != 0 or len(parts) != 2:
            return "no commit on %s" % name
        tip = parts[0]
        self.ref = {"name": name, "tip": tip, "tipDate": _utc(parts[1])}
        rc, out, err = self.git("log", "--format=%H%x1f%P%x1f%s%x1f%b%x1e", tip, "--")
        if rc != 0:
            return "git log failed: %s" % _first(err)
        for rec in out.split("\x1e"):
            parts = rec.lstrip("\n").split("\x1f")
            if len(parts) < 4:
                continue
            c = {"sha": parts[0], "parents": parts[1].split(), "subject": parts[2], "body": "\x1f".join(parts[3:])}
            self.log.append(c)
            self.by_sha[c["sha"]] = c
        self._task_commits()
        return None

    def _verify(self, ref):
        rc, out, _err = self.git("rev-parse", "--verify", "--quiet", ref + "^{commit}")
        return rc == 0 and bool(out.strip())

    def _resolve_ref(self):
        if self._verify("refs/remotes/origin/HEAD"):
            rc, out, _err = self.git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
            return "refs/remotes/origin/HEAD", (out.strip() if rc == 0 and out.strip() else "origin/HEAD")
        have = [b for b in ("main", "master") if self._verify("refs/remotes/origin/" + b)]
        if len(have) == 1:
            self.flag("origin/HEAD unset: read origin/%s; `git remote set-head origin --auto` pins it" % have[0])
            return "refs/remotes/origin/" + have[0], "origin/" + have[0]
        if have:
            self.flag("origin/HEAD unset and both origin/main and origin/master exist: read HEAD; "
                      "`git remote set-head origin --auto` pins origin/HEAD")
        else:
            self.flag("no origin/HEAD, origin/main or origin/master: read HEAD (the checkout's own branch)")
        return "HEAD", "HEAD"

    def _pr_number(self, pr):
        """(N, None) for a landed pr, or (None, why)."""
        if pr is None or pr == "":
            return None, "no pr on its merged line"
        if isinstance(pr, int) and not isinstance(pr, bool) and pr > 0:
            return pr, None
        if isinstance(pr, str):
            s = pr.strip()
            m = PR_NUM_RE.match(s)
            if m:
                return int(m.group(1)), None
            m = PR_URL_RE.match(s)
            if m:
                if self.repo_slug is None:
                    self.flag("no repo identity: pr URLs are read by their number, unchecked")
                elif ("%s/%s" % (m.group(1), m.group(2))).lower() != self.repo_slug.lower():
                    return None, "pr %s is not %s's" % (s, self.repo_slug)
                return int(m.group(3)), None
        return None, "pr %r is not a number or a pull request URL" % (pr,)

    def _task_commits(self):
        squash, merges = {}, {}
        for c in self.log:
            if len(c["parents"]) == 1:
                m = SQUASH_RE.search(c["subject"])
                if m:
                    squash.setdefault(int(m.group(1)), []).append(c)
            elif len(c["parents"]) == 2:
                m = MERGE_PR_RE.match(c["subject"])
                if m:
                    merges.setdefault(int(m.group(1)), []).append(c)
        by_pr = {}
        for task in sorted(self.landed):
            d = self.landed[task]
            if d["readOnly"]:
                continue  # a read-only task expects no commit: fixes evidence only, never unresolved
            n, why = self._pr_number(d["pr"])
            if n is None:
                self.excluded["unresolved"].append({"task": task, "why": why})
                continue
            hits = squash.get(n, []) + merges.get(n, [])
            if not hits:
                self.excluded["unresolved"].append({"task": task, "why": "no commit on %s names pr #%d (a squash "
                                                    "ending ` (#%d)` or a `Merge pull request #%d from`)"
                                                    % (self.ref["name"], n, n, n)})
                continue
            if len(hits) > 1:
                self.flag("pr #%d of [[%s]] matches %d commits on %s: all of them are its commits"
                          % (n, task, len(hits), self.ref["name"]))
            shas, lands = [], []
            for c in hits:
                shas.append(c["sha"])
                lands.append((c["sha"], c["parents"][0]))
                if len(c["parents"]) == 2:
                    rc, out, err = self.git("rev-list", "%s..%s" % (c["parents"][0], c["parents"][1]), "--")
                    if rc != 0:
                        raise _Unread("git rev-list failed: %s" % _first(err))
                    shas.extend(out.split())
            self.commits[task] = list(dict.fromkeys(shas))
            self.landings[task] = lands
            by_pr.setdefault(n, []).append(task)
        for n, tasks in sorted(by_pr.items()):
            if len(tasks) > 1:
                self.flag("pr #%d landed %s: they share its commits, so each of its Escapes counts once per task"
                          % (n, ", ".join("[[%s]]" % t for t in tasks)))

    # ---- (b) reverts ---------------------------------------------------------------------------------------------

    def _reverts(self):
        owner = {}
        for task, shas in self.commits.items():
            for sha in shas:
                owner.setdefault(sha, []).append(task)
        subjects = {}
        for sha in owner:
            c = self.by_sha.get(sha)
            if c is not None:
                for s in {c["subject"], SQUASH_RE.sub("", c["subject"])}:
                    subjects.setdefault(s, set()).add(sha)
        found, seen = [], set()
        for c in self.log:
            named = [h.lower() for h in REVERTS_RE.findall(c["body"])]
            hit = []
            if named:
                hit = [t for h in named for sha, tasks in owner.items() if sha.startswith(h) for t in tasks]
            else:
                m = REVERT_SUBJECT_RE.match(c["subject"])
                cands = subjects.get(m.group(1), set()) if m else set()
                if len(cands) == 1:
                    sha = next(iter(cands))
                    rc, _out, _err = self.git("merge-base", "--is-ancestor", sha, c["sha"])
                    if rc == 0:
                        hit = list(owner[sha])
            for task in hit:
                if c["sha"] in self.commits[task] or (task, c["sha"]) in seen:
                    continue
                seen.add((task, c["sha"]))
                found.append((task, {"source": "revert", "commit": c["sha"], "subject": c["subject"]}))
        return found

    # ---- (c) reviews ---------------------------------------------------------------------------------------------

    def _reviews(self):
        rc, out, err = self.git("-c", "core.quotePath=false", "log", "--all", "--diff-filter=AM", "--format=@@%H",
                                "--name-only", "--", REVIEWS + "/")
        if rc != 0:
            raise _Unread("git log failed: %s" % _first(err))
        newest, commit = {}, None
        for line in out.splitlines():
            if line.startswith("@@"):
                commit = line[2:].strip()
                continue
            p = line.strip()
            if commit and p.startswith(REVIEWS + "/") and p.endswith(".md") and "/" not in p[len(REVIEWS) + 1:]:
                newest.setdefault(p, commit)  # the log is newest first
        specs = {p: "%s:%s" % (c, p) for p, c in newest.items()}
        texts = self._cat(list(specs.values()))
        docs = {p: texts[s] for p, s in specs.items() if s in texts}
        for f in sorted(glob.glob(os.path.join(glob.escape(self.top), REVIEWS, "*.md"))):
            try:
                with open(f, encoding="utf-8", errors="replace") as fh:
                    docs["%s/%s" % (REVIEWS, os.path.basename(f))] = fh.read()
            except OSError:
                continue
        parsed = [(p, _parse_doc(docs[p])) for p in sorted(docs)]
        self.review_docs = len(parsed)
        cited = [(p, d) for p, d in parsed if any(r["cite"] for r in d["rows"])]
        heads = self._resolve_heads(sorted({d["head"] for _p, d in cited if d["head"] and HEAD_RE.match(d["head"])}))
        live = []  # (doc path, parsed doc, resolved head)
        for p, d in cited:
            h = d["head"]
            if not h:
                why = "no head: in its front matter"
            elif not HEAD_RE.match(h):
                why = "head %s is not a commit sha" % h
            else:
                sha, why = heads.get(h, (None, "unresolved"))
                if sha:
                    live.append((p, d, sha))
                    continue
            self.excluded["unresolvedDocs"].append({"doc": p, "head": h, "why": why})
        return self._blame_rows(live)

    def _cat(self, specs):
        """{spec: text} for every `<commit>:<path>` spec, read in one `git cat-file --batch`."""
        if not specs:
            return {}
        rc, out, err = self.git("cat-file", "--batch", stdin=("\n".join(specs) + "\n").encode("utf-8"), raw=True)
        if rc != 0:
            raise _Unread("git cat-file failed: %s" % _first(err))
        res, pos = {}, 0
        for spec in specs:
            nl = out.find(b"\n", pos)
            if nl < 0:
                break
            m = OBJECT_RE.match(out[pos:nl].decode("utf-8", "replace"))
            pos = nl + 1
            if m:
                size = int(m.group(3))
                if m.group(2) == "blob":
                    res[spec] = out[pos:pos + size].decode("utf-8", "replace")
                pos += size + 1
        return res

    def _resolve_heads(self, heads):
        """{head: (its full sha, None) or (None, why it did not resolve)}, in one `git cat-file --batch-check`."""
        if not heads:
            return {}
        rc, out, err = self.git("cat-file", "--batch-check",
                                stdin=("\n".join(h + "^{commit}" for h in heads) + "\n").encode("utf-8"))
        if rc != 0:
            raise _Unread("git cat-file --batch-check failed: %s" % _first(err))
        res = {}
        for h, line in zip(heads, out.splitlines()):
            m = OBJECT_RE.match(line.strip())
            if m and m.group(2) == "commit":
                res[h] = (m.group(1), None)
            else:  # `<name> missing` or `<name> ambiguous`
                res[h] = (None, line.strip().rsplit(" ", 1)[-1] or "unresolved")
        return res

    def _blame_rows(self, live):
        found, seen, rejected, failed, blamed = [], set(), set(), set(), {}
        all_heads = sorted({h for _p, _d, h in live})
        for task in sorted(self.landings):
            for sha, parent in self.landings[task]:
                if not all_heads:
                    break
                rc, out, err = self.git("rev-list", "--ancestry-path", "^" + sha, *all_heads, "--")
                if rc != 0:
                    raise _Unread("git rev-list --ancestry-path failed: %s" % _first(err))
                desc = set(out.split()) | {sha}
                rows = [(p, d, h) for p, d, h in live if h in desc]
                if not rows:
                    continue
                rc, out, err = self.git("-c", "core.quotePath=false", "diff-tree", "-r", "--name-only",
                                        "--no-commit-id", parent, sha)
                if rc != 0:
                    raise _Unread("git diff-tree failed: %s" % _first(err))
                touched = set(out.splitlines())
                for p, d, h in rows:
                    for row in d["rows"]:
                        if row["file"] not in touched:
                            continue
                        key = (p, row["n"])
                        if _rejected(row["verdict"], row["disposition"]):
                            rejected.add(key)
                            continue
                        spot = (h, row["file"], row["line"])
                        if spot not in blamed:
                            blamed[spot] = self._blame(*spot)
                        who = blamed[spot]
                        if who is None or not BLAME_RE.match(who):
                            if key not in failed:
                                failed.add(key)
                                self.excluded["unresolvedRows"].append({"doc": p, "row": row["n"], "cite": row["cite"],
                                                                        "why": who or "git blame failed"})
                            continue
                        if who.split()[0] in self.commits[task] and (task, key) not in seen:
                            seen.add((task, key))
                            found.append((task, {"source": "review", "doc": p, "head": h, "row": row["n"],
                                                 "cite": row["cite"], "status": d["status"],
                                                 "disposition": _shown(row)}))
        self.excluded["rejectedRows"] = len(rejected)
        return found

    def _blame(self, head, path, line):
        """The porcelain header line of `git blame -L line,line <head> -- <path>`, or a why when blame fails."""
        rc, out, err = self.git("blame", "-L", "%d,%d" % (line, line), "--porcelain", head, "--", path)
        if rc != 0:
            return "git blame failed: %s" % _first(err)
        first = out.split("\n", 1)[0]
        return first if BLAME_RE.match(first) else "git blame printed no commit"


def score(landed, tasks_dir, repo, repo_slug, env):
    """(block, flags): the rollout's Escapes and Quality. Never raises (see the module docstring)."""
    try:
        e = _Escapes(landed, tasks_dir, repo, repo_slug, env)
    except Exception as exc:  # malformed input: an all-unread block
        e = _Escapes({}, None, None, None, {})
        e.sources = {s: "unread: escapes.py failed: %s" % _why(exc) for s in SOURCES}
        return e.block(), e.flags
    return e.run()
