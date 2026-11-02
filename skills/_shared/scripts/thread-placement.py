#!/usr/bin/env python3
"""The placement check (ADR 0039 d5; CONTEXT.md **Placement check**, **Thread home**): where every THREAD.md sits
against its project's thread home, and the one repo a ~/Projects folder's thread belongs in.

python >= 3.8 with PyYAML. It imports resolve-target.py by path (never run), so the vault keeps one note index and
ADR 0036's one directory-to-note rule. Called as:

    thread-placement.py audit [--project <note>]... [--thread <path>] [--json] [--vault PATH] [--launch-folders PATH]
    thread-placement.py home (--dir <path> | --project <note>) [--vault PATH] [--launch-folders PATH]

Defaults: ~/repos/obsidian and resolve-target's launch-folders file (a missing one only skips its rung 3). HOME comes
from the environment; every path is realpath'd. Read-only: no writes, no network, no fetch. Every git call drops
`git rev-parse --local-env-vars` from its environment and has a 30 s timeout.

A <note> is a live project or area note (resolve-target's index), by vault path or basename.

The walks. The repo tier mirrors open's § Repo-thread lookup exactly: every entry below realpath ~/repos at depth <= 4
(no pruning, no symlink followed), minus the lookup's five path tests (`*/.claude/*`, `$r/obsidian/*`,
`$r/workspaces/*`, `$r/workspaces-*rollout/*` (workspaces' rollout clones, a second project's
`workspaces-<project>-rollout` among them, ADR 0064), `*/_archive/*`); THREAD.md is a repo thread, any other THREAD*.md a
misnamed one. The ~/Projects tier mirrors the lookup's ~/Projects walk (depth <= 5, `_archive`, `.claude`, `.git` and
`node_modules` pruned). Both drop a file whose git toplevel is a rollout clone (ADR 0042: named `<S>-rollout`, beside a
same-origin main checkout on its twin walk, `<S>` first; `self-rollout-check.sh --in-place`, asked once per `*-rollout` toplevel), whose
THREAD*.md is a copy of its twin's, never a thread: the lookup's `rc` test. The workspaces tier is every THREAD*.md
below ~/repos/workspaces at depth <= 4, `_shared`, `.claude`, `.git`, `node_modules` and `_archive` pruned.

A qualifying repo (ADR 0039 d1) is a main checkout (its `.git` a directory; a linked worktree, a submodule or a
--separate-git-dir checkout has a `.git` file) one to three directories below ~/repos, outside obsidian, workspaces,
workspaces' rollout clones (`workspaces-rollout`, `workspaces-<project>-rollout`: WORKSPACES_CLONE), `.claude`, `_archive`,
`node_modules` and dot-dirs. A note's thread home is its first qualifying `repos:` entry.

The thread identity of a repo-tier file f is `<home repo>/<f below its git toplevel>`: the home repo is f's main
checkout (a linked worktree reads as it) when a live note declares it, else the one declared qualifying repo sharing
its non-empty remote.origin.url (a clone), else the main checkout itself; a file outside git is its own identity.
Every repo-tier finding but a git check is reported once per identity, at the identity path (which may exist only
in a worktree), with `copies` naming every physical path. Git checks run once per main checkout, never for a
linked worktree, against the local origin/HEAD symref only.

A ~/Projects directory's folder note, in order: resolve-target's directory rungs resolve it at rung `directory` and
the declared entry lies at or below the folder's own directory O (an ancestor entry attributes nothing); or at rung
`directory-name` with an exact hit; or exactly one live note declares a qualifying repo named like O
(case-insensitively). Its owner is the folder note, else the one declarer of an ancestor entry.

Kinds (each finding's owners are the notes a --project run shows it under):
    split-home   a ~/Projects folder holding a THREAD*.md: basis `declared` when its folder note has a thread home,
                 else `same-named` when a qualifying repo is named like it (audit-only, never a home); or a repo
                 THREAD.md identity whose home repo a note lists after its first qualifying repo (basis `repo`)
    misnamed     a THREAD*.md other than THREAD.md (never for a seat file)
    undeclared   a repo THREAD.md identity no live note declares (no owner: estate and --thread only)
    no-slug      a ~/Projects THREAD.md with no front-matter slug:
    behind       HEAD lacks THREAD.md commits on origin's default branch, as last fetched
    side-branch  origin's default and the local default lack THREAD.md while another local branch has it
    workspace    a THREAD*.md in a workspace seat subfolder (ADR 0039 d3)
An `unchecked` entry (never a finding) is a main checkout holding a thread (on disk, in a linked worktree or on a
local branch) whose origin/HEAD is unresolved.

Scopes: no flag is the estate; --project keeps the entries a named note owns; --thread keeps that file's own: its
folder's findings for a ~/Projects path, its identity's findings plus its main checkout's git checks for a
repo-tier path (a worktree copy included), its workspace finding for a seat path, nothing for any other path.

Output: one `<kind>: <path> — <detail> · fix: <fix>` line per finding, one `unchecked: <repo> — no origin/HEAD ·
fix: …` line per unchecked repo, then `placement: none` or `placement: <N> finding(s) — <kind> <n>, …`, plus
` · unchecked <n>`. --json prints {findings: [{kind, basis, path, copies, owners, detail, fix}], unchecked: [{path,
owners, fix}], summary, scanned: {repo_threads, repo_misnamed, project_threads, project_misnamed,
workspace_threads}}; owners are vault paths, and every list of paths is bytewise sorted. `home` prints the repo or
nothing: for --dir only strictly below ~/Projects, through the folder note (resolve-target's directory rungs, which
read a nested rollout clone as its in-place twin); for --project, the note's first qualifying repo.

Exit 0 when it ran. Exit 2 for a usage error, a bad --project, a --thread that is not a file or a --dir that is not
a directory: stderr carries one line starting `thread-placement: `. Exit 3 when the vault, PyYAML or the import is
missing (resolve-target's own exit 3 passes through), except that `home --dir` for a directory not strictly below
~/Projects prints nothing and exits 0 before it needs PyYAML or the vault: handoff runs it from every launch directory.
"""
import argparse
import fnmatch
import importlib.util
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
RESOLVE_TARGET_PY = os.path.join(HERE, "resolve-target.py")
SELF_ROLLOUT_SH = os.path.join(HERE, "..", "..", "execute", "scripts", "self-rollout-check.sh")
KINDS = ("split-home", "misnamed", "undeclared", "no-slug", "behind", "side-branch", "workspace")
GIT_TIMEOUT = 30
PROJECTS_PRUNE = frozenset({"_archive", ".claude", ".git", "node_modules"})
WORKSPACES_PRUNE = frozenset({"_shared", ".claude", ".git", "node_modules", "_archive"})
# workspaces' rollout clones at depth 0 below ~/repos: `workspaces-rollout`, and a second project's
# `workspaces-<project>-rollout` (ADR 0064)
WORKSPACES_CLONE = re.compile(r"^workspaces(-[a-z0-9-]+)?-rollout$")
ORIGIN = "refs/remotes/origin/"
HEADS = "refs/heads/"


def fail(code, reason):
    sys.stderr.write("thread-placement: %s\n" % reason)
    sys.exit(code)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


try:
    RT = _load("thread_resolve_target", RESOLVE_TARGET_PY)
except SystemExit:
    raise  # resolve-target could not load next-action.py: its own exit 3 and line pass through
except Exception as e:  # a broken install: report it as the check, never as a traceback
    fail(3, "cannot load %s: %s" % (RESOLVE_TARGET_PY, e))

NA = RT.NA
real, within = RT.real, RT.within


def strictly_below(p, r):
    """`p` lies below `r`, never `r` itself (both physical paths)."""
    return within(p, r) and p != r


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


# ---- Files ------------------------------------------------------------------------------------------------------

def find(top, maxdepth, prune=frozenset()):
    """(path, name) for every entry below `top` at depth <= maxdepth, as find(1) lists them: no symlink followed,
    a pruned name neither listed nor descended."""
    stack = [(top, 0)]
    while stack:
        d, depth = stack.pop()
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            if e.name in prune:
                continue
            yield e.path, e.name
            if depth + 1 < maxdepth:
                try:
                    if e.is_dir(follow_symlinks=False):
                        stack.append((e.path, depth + 1))
                except OSError:
                    pass


def is_thread_file(name):
    return fnmatch.fnmatchcase(name, "THREAD*.md")


def fm_slug(path):
    """The front-matter slug: as open's fms reads it: CR-tolerant, quotes stripped, first-line `---` block only."""
    try:
        with open(path, "rb") as fh:
            text = fh.read().decode("utf-8", "surrogateescape")
    except OSError:
        return ""
    lines = text.replace("\r", "").split("\n")
    if lines[0] != "---":
        return ""
    for line in lines[1:]:
        if line == "---":
            return ""
        if line.startswith("slug:"):
            return line[len("slug:"):].lstrip().replace('"', "").replace("'", "").rstrip()
    return ""


def moved_stub(path):
    """A "Moved to …" stub: its first non-blank line says where the thread went."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.strip():
                    return line.strip().lower().startswith("moved to")
    except OSError:
        pass
    return False


def slash(rel):
    return rel.replace(os.sep, "/")


# ---- Git --------------------------------------------------------------------------------------------------------

class Git:
    def __init__(self):
        try:
            names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, timeout=GIT_TIMEOUT).stdout.split()
        except (OSError, subprocess.SubprocessError):
            names = []
        self.env = dict(os.environ)
        for name in names:
            self.env.pop(name, None)

    def run(self, repo, *args, stdin=None):
        """(returncode, stdout) of `git -C <repo> <args>`; (None, "") when git cannot run or times out."""
        kw = {"input": stdin} if stdin is not None else {"stdin": subprocess.DEVNULL}
        try:
            r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, encoding="utf-8",
                               errors="surrogateescape", env=self.env, timeout=GIT_TIMEOUT, **kw)
        except (OSError, subprocess.SubprocessError):
            return None, ""
        return r.returncode, r.stdout


# ---- The estate -------------------------------------------------------------------------------------------------

class Estate:
    def __init__(self, index, home, resolver):
        self.index, self.home, self.resolver = index, home, resolver
        self.git = Git()
        # Physical roots, as the lookup's `cd … && pwd -P` reads them.
        self.repos = real(os.path.join(home.root, "repos"))
        self.projects = real(home.projects)
        self.workspaces = real(os.path.join(self.repos, "workspaces"))
        self.by_entry = {}
        for t in index.targets:
            for e in t.declared:
                owners = self.by_entry.setdefault(e, [])
                if t not in owners:
                    owners.append(t)
        self._qual = None
        self._roots = {}
        self._urls = {}
        self._branches = {}
        self._folders = {}
        self._clones = {}
        # resolve-target's own git_roots, cached per repo: its directory rungs call it once per folder, and every
        # ~/Projects folder sits in the one umbrella repo.
        self._rt_roots = resolver.git_roots
        resolver.git_roots = self.roots

    # -- qualifying repos and their declarers --

    @property
    def qual(self):
        """Every qualifying repo (ADR 0039 d1): a main checkout one to three directories below ~/repos."""
        if self._qual is None:
            out, stack = set(), [(self.repos, 0)] if os.path.isdir(self.repos) else []
            while stack:
                d, depth = stack.pop()
                try:
                    entries = list(os.scandir(d))
                except OSError:
                    continue
                for e in entries:
                    if e.name.startswith(".") or e.name in ("_archive", "node_modules"):
                        continue
                    if depth == 0 and (e.name in ("obsidian", "workspaces") or WORKSPACES_CLONE.match(e.name)):
                        continue
                    try:
                        if not e.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    g = os.path.join(e.path, ".git")
                    if os.path.isdir(g) and not os.path.islink(g):
                        out.add(e.path)
                    if depth + 1 < 3:
                        stack.append((e.path, depth + 1))
            self._qual = out
        return self._qual

    def first_qual(self, t):
        return next((e for e in t.declared if e in self.qual), None) if t else None

    def declarers(self, repo):
        return sorted(self.by_entry.get(repo, []), key=lambda t: t.rel) if repo else []

    def origin_url(self, repo):
        if repo not in self._urls:
            rc, out = self.git.run(repo, "config", "--get", "remote.origin.url")
            self._urls[repo] = out.strip() if rc == 0 else ""
        return self._urls[repo]

    def may_have_url(self, repo, url):
        """False only when <repo>/.git/config is readable, includes nothing and never holds `url`: then git's
        remote.origin.url there cannot equal it, and no git call is needed."""
        try:
            with open(os.path.join(repo, ".git", "config"), encoding="utf-8", errors="surrogateescape") as fh:
                text = fh.read()
        except OSError:
            return True
        return url in text or "include" in text.lower()

    def home_repo(self, main):
        """The repo a main checkout's threads belong to: itself when declared, else the one declared qualifying
        repo sharing its origin (a clone), else itself."""
        if main in self.by_entry:
            return main
        url = self.origin_url(main)
        if url:
            same = sorted(d for d in self.by_entry if d in self.qual and d != main
                          and self.may_have_url(d, url) and self.origin_url(d) == url)
            if len(same) == 1:
                return same[0]
        return main

    def roots(self, d):
        """resolve-target's (toplevel, main checkout) for directory d, asked once per repo: git finds a repo at the
        nearest ancestor holding a `.git`, so every directory below it shares the answer (one inside the `.git`
        itself, or below no `.git` at all, is asked on its own)."""
        key = d
        x = d
        while True:
            if os.path.lexists(os.path.join(x, ".git")):
                if not within(d, os.path.join(x, ".git")):
                    key = x
                break
            up = os.path.dirname(x)
            if up == x:
                break
            x = up
        if key not in self._roots:
            self._roots[key] = self._rt_roots(d)
        return self._roots[key]

    def clone_copy(self, f):
        """True when file f sits in a rollout clone (ADR 0042): its toplevel is named *-rollout and
        `self-rollout-check.sh --in-place` names an in-place twin. Asked once per toplevel."""
        if "-rollout/" not in f:
            return False
        top, _ = self.roots(os.path.dirname(f))
        if not top or not os.path.basename(top).endswith("-rollout"):
            return False
        if top not in self._clones:
            try:
                r = subprocess.run(["bash", SELF_ROLLOUT_SH, "--in-place", top], capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, env=self.git.env, timeout=GIT_TIMEOUT)
                self._clones[top] = r.returncode == 0
            except (OSError, subprocess.SubprocessError):
                self._clones[top] = False
        return self._clones[top]

    def identity(self, f):
        """(identity path, home repo, toplevel, main checkout); a file outside git is its own identity."""
        top, main = self.roots(os.path.dirname(f))
        if top is None or main is None:
            return f, None, None, None
        hr = self.home_repo(main)
        return os.path.join(hr, os.path.relpath(f, top)), hr, top, main

    def branch(self, top):
        if top not in self._branches:
            rc, out = self.git.run(top, "symbolic-ref", "-q", "--short", "HEAD")
            self._branches[top] = out.strip() if rc == 0 and out.strip() else "a detached HEAD"
        return self._branches[top]

    # -- ~/Projects folders --

    def folder(self, G):
        """(folder note, attribution, own dir O, deepest declared entry E holding G) for a ~/Projects directory."""
        if G not in self._folders:
            ans, O = self.resolver.directory(G)
            E = max((e for e, _ in self.resolver.declared() if within(G, e)), key=len, default=None)
            fn, by = None, None
            cand = ans.get("candidates") or []
            if ans["outcome"] == "resolved" and ans["rung"] == "directory" and E is not None and within(E, O):
                fn, by = self.target(ans["target"]), "declared entry"
            elif (ans["outcome"] == "resolved" and ans["rung"] == "directory-name" and cand
                  and str(cand[0].get("why", "")).startswith("exact")):
                fn, by = self.target(ans["target"]), "exact name"
            if fn is None:
                name = os.path.basename(O).lower()
                notes = {t.rel: t for e, ts in self.by_entry.items() if e in self.qual and os.path.basename(e).lower() == name
                         for t in ts}
                if len(notes) == 1:
                    fn, by = list(notes.values())[0], "repo name"
            self._folders[G] = (fn, by, O, E)
        return self._folders[G]

    def target(self, pub):
        note = (pub or {}).get("note")
        return self.index.by_rel.get(note.replace("/", os.sep)) if note else None

    def folder_owners(self, G):
        fn, _, O, E = self.folder(G)
        if fn:
            return [fn]
        if E is not None and not within(E, O):
            ds = self.declarers(E)
            if len(ds) == 1:
                return ds
        return []

    def same_named(self, O):
        name = os.path.basename(O).lower()
        return sorted(q for q in self.qual if os.path.basename(q).lower() == name)

    def home_dir(self, d):
        """`home --dir`: the folder note's first qualifying repo, only strictly below ~/Projects."""
        if not strictly_below(d, self.projects):
            return None
        fn = self.folder(d)[0]
        return self.first_qual(fn)


# ---- The audit --------------------------------------------------------------------------------------------------

def finding(kind, path, detail, fix, owners, basis=None, copies=None):
    """One finding; `copies` defaults to the path itself (a path-keyed finding)."""
    return {"kind": kind, "basis": basis, "path": path, "copies": sorted(copies) if copies is not None else [path],
            "owners": sorted({slash(t.rel) for t in owners}), "detail": detail, "fix": fix}


class Audit:
    def __init__(self, est):
        self.est = est
        self.tl = est.home.tilde
        self.findings, self.unchecked = [], []
        self.scanned = {k: [] for k in ("repo_threads", "repo_misnamed", "project_threads", "project_misnamed", "workspace_threads")}

    # -- walks --

    def walk_repos(self):
        r = self.est.repos
        if not os.path.isdir(r):
            return
        for p, name in find(r, 4):
            if not is_thread_file(name):
                continue
            if ("/.claude/" in p or "/_archive/" in p or p.startswith(r + "/obsidian/") or p.startswith(r + "/workspaces/")
                    or fnmatch.fnmatchcase(p, r + "/workspaces-*rollout/*")):
                continue
            if self.est.clone_copy(p):
                continue
            self.scanned["repo_threads" if name == "THREAD.md" else "repo_misnamed"].append(p)

    def walk_projects(self):
        p = self.est.projects
        if not os.path.isdir(p):
            return
        for f, name in find(p, 5, PROJECTS_PRUNE):
            if is_thread_file(name) and not self.est.clone_copy(f):
                self.scanned["project_threads" if name == "THREAD.md" else "project_misnamed"].append(f)

    def walk_workspaces(self):
        w = self.est.workspaces
        if not os.path.isdir(w):
            return
        for f, name in find(w, 4, WORKSPACES_PRUNE):
            if is_thread_file(name):
                self.scanned["workspace_threads"].append(f)

    # -- the repo tier --

    def on_disk(self, I, copies, info):
        if copies == [I]:
            return ""
        labels = []
        for c in copies:
            top, main, hr = info[c]
            if top and main and top != main:
                labels.append("%s (linked worktree on %s)" % (c, self.est.branch(top)))
            elif main and hr and main != hr:
                labels.append("%s (a clone)" % c)
            else:
                labels.append(c)
        if I in copies or os.path.lexists(I):
            return "; on disk: " + ", ".join(labels)
        return "; on disk only in " + ", ".join(labels)

    def repo_tier(self):
        est, tl = self.est, self.tl
        groups = {}
        for kind, files in (("thread", self.scanned["repo_threads"]), ("misnamed", self.scanned["repo_misnamed"])):
            for f in files:
                I, hr, top, main = est.identity(f)
                g = groups.setdefault((kind, I), {"copies": [], "info": {}, "home": hr})
                g["copies"].append(f)
                g["info"][f] = (top, main, hr)
        for (kind, I), g in sorted(groups.items()):
            copies, hr = sorted(g["copies"]), g["home"]
            disk = self.on_disk(I, copies, g["info"])
            ds = est.declarers(hr)
            if kind == "misnamed":
                name = os.path.basename(I)
                arc = fm_slug(copies[0]) or name[len("THREAD"):-len(".md")].strip("-_ ") or "arc"
                where = hr or os.path.dirname(I)
                self.findings.append(finding(
                    "misnamed", I, "named %s, not THREAD.md: the lookup, close and land.sh never see it (ADR 0039 d2)%s" % (name, disk),
                    "move a finished arc to %s/docs/threads/%s.md, or merge it into THREAD.md" % (tl(where), arc),
                    ds, copies=copies))
                continue
            if not ds:
                what = ("no live note declares %s" % tl(hr)) if hr else "it is outside git, so no note can declare it"
                self.findings.append(finding(
                    "undeclared", I, what + disk,
                    "add the repo to its project's repos:, or move the thread to its project's thread home",
                    [], copies=copies))
                continue
            split = [(t, est.first_qual(t)) for t in ds]
            split = [(t, first) for t, first in split if first is not None and first != hr]
            if split:
                self.findings.append(finding(
                    "split-home", I,
                    "; ".join("%s lists %s first, so its thread home is %s/THREAD.md, not %s" % (t.name, tl(first), tl(first), tl(hr))
                              for t, first in split) + disk,
                    "; ".join("reorder %s's repos: so %s is first, or move the thread to %s/THREAD.md" % (t.name, tl(hr), tl(first))
                              for t, first in split),
                    [t for t, _ in split], basis="repo", copies=copies))

    # -- the ~/Projects tier --

    def projects_tier(self, only=None):
        est, tl = self.est, self.tl
        folders = {}
        for f in self.scanned["project_threads"] + self.scanned["project_misnamed"]:
            folders.setdefault(os.path.dirname(f), []).append(f)
        for G in sorted(folders):
            if only is not None and G != only:
                continue
            files = sorted(folders[G])
            fn, by, O, _ = est.folder(G)
            owners = est.folder_owners(G)
            key = os.path.join(G, "THREAD.md") if os.path.join(G, "THREAD.md") in files else files[0]
            H = est.first_qual(fn)
            if H:
                self.findings.append(finding(
                    "split-home", key, "the folder is %s's (by %s), whose thread home is %s (ADR 0039 d1)" % (fn.name, by, tl(H)),
                    "move the thread to %s/THREAD.md (merging it into the one there, if any), and keep this folder for files "
                    "that are not code" % tl(H), [fn], basis="declared"))
            else:
                same = est.same_named(O)
                if same:
                    names = ", ".join("%s (%s)" % (tl(s), "declared by " + ", ".join(t.name for t in est.declarers(s))
                                                   if est.declarers(s) else "declared by no note") for s in same)
                    lead = ("the folder is %s's (by %s), which declares no qualifying repo; " % (fn.name, by)) if fn else ""
                    extra = [t for s in same for t in est.declarers(s)]
                    self.findings.append(finding(
                        "split-home", key, "%ssame-named repo: %s; a same-named repo is never a thread home (ADR 0039 d5)" % (lead, names),
                        "declare the repo in the project's note and move the thread to its THREAD.md, or rename the folder",
                        owners + extra, basis="same-named"))
            for f in files:
                if os.path.basename(f) != "THREAD.md":
                    self.findings.append(finding(
                        "misnamed", f, "named %s, not THREAD.md: the lookup, close and land.sh never see it (ADR 0039 d2)" % os.path.basename(f),
                        "move a finished or parked arc to an _archive/ folder, or merge it into THREAD.md",
                        owners))
                elif not fm_slug(f):
                    self.findings.append(finding(
                        "no-slug", f, "no front-matter slug:, so no lookup by slug reaches it",
                        "add `slug: %s` to its front matter" % os.path.basename(G), owners))

    # -- the workspaces tier --

    def workspaces_tier(self, only=None):
        est, w = self.est, self.est.workspaces
        for f in self.scanned["workspace_threads"]:
            if only is not None and f != only:
                continue
            parts = os.path.relpath(f, w).split(os.sep)
            owners = []
            if len(parts) > 1:
                seat, d = os.path.join(w, parts[0]), os.path.dirname(f)
                inside = [e for e in est.by_entry if within(e, seat) and within(d, e)]
                if inside:
                    owners = est.declarers(max(inside, key=len))
                else:
                    name = parts[0][:-len("-workspace")] if parts[0].endswith("-workspace") else parts[0]
                    anchor = est.index.anchor_named(name)
                    owners = [anchor] if anchor else []
            if moved_stub(f):
                detail, fix = 'a "Moved to" stub left in a workspace seat subfolder', 'delete the stub: its thread lives where it says'
            else:
                slug = fm_slug(f) or os.path.basename(os.path.dirname(f))
                detail = "a workspace seat subfolder is not a thread home: open's lookup never reaches it (ADR 0039 d3)"
                fix = "move it to ~/repos/workspaces/_shared/threads/%s.md and add its INDEX line" % slug
            self.findings.append(finding("workspace", f, detail, fix, owners))

    # -- git checks --

    def git_checks(self, mains):
        est, tl = self.est, self.tl
        held = set()  # main checkouts holding a walked THREAD.md, in themselves or in a linked worktree
        for f in self.scanned["repo_threads"]:
            main = est.roots(os.path.dirname(f))[1]
            if main:
                held.add(main)
        for M in sorted(mains):
            g = est.git
            owners = est.declarers(est.home_repo(M))
            # One read of the local refs: every branch, and origin/HEAD's target (a broken symref is not listed).
            rc, out = g.run(M, "for-each-ref", "--format=%(refname) %(symref)", HEADS, ORIGIN + "HEAD")
            heads, defref = [], None
            for line in (out.split("\n") if rc == 0 else []):
                name, _, sym = line.partition(" ")
                if name.startswith(HEADS):
                    heads.append(name)
                elif name == ORIGIN + "HEAD" and sym.startswith(ORIGIN):
                    defref = sym.strip()
            queries = heads + ([defref] if defref else [])
            has = {}
            if queries:
                rc, out = g.run(M, "cat-file", "--batch-check", stdin="".join("%s:THREAD.md\n" % q for q in queries))
                lines = out.split("\n") if rc == 0 else []
                for q, line in zip(queries, lines):
                    has[q] = " blob " in line
            if defref is None:
                if M in held or os.path.isfile(os.path.join(M, "THREAD.md")) or any(has.get(h) for h in heads):
                    if est.origin_url(M):
                        fix = "git -C %s remote set-head origin --auto" % M
                    else:
                        fix = "add an origin remote, then git -C %s remote set-head origin --auto" % M
                    self.unchecked.append({"path": M, "owners": sorted({slash(t.rel) for t in owners}), "fix": fix})
                continue
            default = defref[len(ORIGIN):]
            path = os.path.join(M, "THREAD.md")
            if has.get(defref):
                rc, out = g.run(M, "rev-list", "--count", "HEAD..%s" % defref, "--", "THREAD.md")
                n = int(out.strip()) if rc == 0 and out.strip().isdigit() else 0
                if n:
                    self.findings.append(finding(
                        "behind", path, "HEAD (%s) lacks %d THREAD.md commit%s on origin/%s, as last fetched"
                        % (est.branch(M), n, "" if n == 1 else "s", default),
                        "bring origin/%s into %s's checkout (git -C %s merge --ff-only origin/%s on %s, or merge it into the branch)"
                        % (default, tl(M), M, default, default), owners, copies=[]))
            elif not has.get(HEADS + default):
                others = sorted(h[len(HEADS):] for h in heads if h != HEADS + default and has.get(h))
                if others:
                    self.findings.append(finding(
                        "side-branch", path, "THREAD.md is only on %s; origin/%s and the local %s lack it"
                        % (", ".join(others), default, default),
                        "merge %s into %s and push it, or delete the branch once its thread has moved" % (others[0], default),
                        owners, copies=[]))

    # -- running it --

    def run(self, projects=None, thread=None):
        est = self.est
        self.walk_repos()
        self.walk_projects()
        self.walk_workspaces()
        for k in self.scanned:
            self.scanned[k].sort()
        if thread is not None:
            self.run_thread(thread)
        else:
            self.repo_tier()
            self.projects_tier()
            self.workspaces_tier()
            mains = {m for m in (est.roots(os.path.dirname(f))[1]
                                 for f in self.scanned["repo_threads"] + self.scanned["repo_misnamed"]) if m}
            mains |= {e for e in est.by_entry if e in est.qual}
            if projects is not None:
                mains = {m for m in mains if {t.rel for t in est.declarers(est.home_repo(m))} & projects}
            self.git_checks(mains)
        if projects is not None:
            keep = {slash(r) for r in projects}
            self.findings = [f for f in self.findings if keep & set(f["owners"])]
            self.unchecked = [u for u in self.unchecked if keep & set(u["owners"])]
        self.findings.sort(key=lambda f: (KINDS.index(f["kind"]), f["path"]))
        self.unchecked.sort(key=lambda u: u["path"])

    def run_thread(self, p):
        est = self.est
        repo_files = set(self.scanned["repo_threads"]) | set(self.scanned["repo_misnamed"])
        if strictly_below(p, est.projects):
            self.projects_tier(only=os.path.dirname(p))
        elif p in repo_files:
            I, _, _, main = est.identity(p)
            self.repo_tier()
            self.findings = [f for f in self.findings if f["path"] == I]
            if main:
                self.git_checks({main})
        elif p in self.scanned["workspace_threads"]:
            self.workspaces_tier(only=p)

    def summary(self):
        n = len(self.findings)
        if not n:
            s = "placement: none"
        else:
            counts = [(k, sum(1 for f in self.findings if f["kind"] == k)) for k in KINDS]
            s = "placement: %d finding%s — %s" % (n, "" if n == 1 else "s", ", ".join("%s %d" % kc for kc in counts if kc[1]))
        if self.unchecked:
            s += " · unchecked %d" % len(self.unchecked)
        return s

    def emit(self, as_json):
        if as_json:
            out = {"findings": [{k: f[k] for k in ("kind", "basis", "path", "copies", "owners", "detail", "fix")} for f in self.findings],
                   "unchecked": self.unchecked, "summary": self.summary(), "scanned": self.scanned}
            sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
            return
        lines = ["%s: %s — %s · fix: %s" % (f["kind"], f["path"], f["detail"], f["fix"]) for f in self.findings]
        lines += ["unchecked: %s — no origin/HEAD · fix: %s" % (u["path"], u["fix"]) for u in self.unchecked]
        lines.append(self.summary())
        sys.stdout.write("\n".join(lines) + "\n")


# ---- Main -------------------------------------------------------------------------------------------------------

def resolve_note(vault, index, arg):
    """The live project or area note `arg` names, by vault path or basename; else exit 2."""
    a = arg.strip()
    if RT.LINK_ARG.fullmatch(a):
        a = RT.unlink(a)
    try:
        rel = vault.path_arg(a)
    except NA.Refused as e:
        fail(2, str(e))
    rels = [rel] if rel else vault.targets(a)
    if not rels:
        fail(2, "no note %s" % arg)
    live = [index.by_rel[r] for r in rels if r in index.by_rel]
    if not live:
        fail(2, "%s is not a live project or area note (%s)" % (arg, ", ".join(slash(r) for r in rels)))
    if len(live) > 1:
        fail(2, "%s is ambiguous: %s" % (arg, ", ".join(slash(t.rel) for t in live)))
    return live[0]


def main(argv):
    p = Parser(prog="thread-placement", allow_abbrev=False, description="The placement check (ADR 0039).")
    sub = p.add_subparsers(dest="cmd", parser_class=Parser)
    sub.required = True
    a = sub.add_parser("audit", allow_abbrev=False)
    a.add_argument("--project", action="append", default=[])
    a.add_argument("--thread")
    a.add_argument("--json", action="store_true")
    hm = sub.add_parser("home", allow_abbrev=False)
    g = hm.add_mutually_exclusive_group(required=True)
    g.add_argument("--dir")
    g.add_argument("--project")
    for s in (a, hm):
        s.add_argument("--vault", default=RT.VAULT_DEFAULT)
        s.add_argument("--launch-folders", default=RT.LAUNCH_FOLDERS_DEFAULT)
    args = p.parse_args(argv)
    thread = d = None
    if args.cmd == "audit" and args.thread is not None:
        thread = os.path.expanduser(args.thread)
        if not os.path.isfile(thread):
            fail(2, "--thread %s is not a file" % args.thread)
        thread = real(thread)
    if args.cmd == "home" and args.dir is not None:
        d = os.path.expanduser(args.dir)
        if not os.path.isdir(d):
            fail(2, "--dir %s is not a directory" % args.dir)
        d = real(d)
    home = RT.Home()
    if d is not None and not strictly_below(d, real(home.projects)):
        # No ~/Projects folder, so no folder note: nothing to print, and no reason to need PyYAML or the vault.
        # Handoff runs this from every launch directory, a repo included.
        return 0
    if NA.yaml is None:
        fail(3, "PyYAML is required: python3 -m pip install pyyaml")
    vroot = os.path.expanduser(args.vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    vault = NA.Vault(vroot)
    index = RT.Index(vault)
    est = Estate(index, home, RT.Resolver(vault, index, home, args.launch_folders))
    if args.cmd == "home":
        repo = est.home_dir(d) if d is not None else est.first_qual(resolve_note(vault, index, args.project))
        if repo:
            sys.stdout.write(repo + "\n")
        return 0
    projects = {resolve_note(vault, index, n).rel for n in args.project} if args.project else None
    au = Audit(est)
    au.run(projects=projects, thread=thread)
    au.emit(args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
