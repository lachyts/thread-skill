#!/usr/bin/env python3
"""Orient's target resolver (ADR 0036 d1-d4; CONTEXT.md **Target**): what an orient picks up, decided before
anything is read, and the one `repos:` write that teaches it a directory.

python >= 3.8 with PyYAML. It reads frontmatter through next-action.py (imported by path, never run), so the
vault keeps one frontmatter reader. Called as:

    resolve-target.py [<argument>...] [--cwd DIR] [--vault PATH] [--launch-folders PATH]
    resolve-target.py --learn <dir> <note> [--vault PATH] [--launch-folders PATH]

Defaults: the working directory, ~/repos/obsidian and ~/repos/workspaces/_shared/state/launch-folders.json.
HOME comes from the environment; every path is realpath'd. The projects root is HOME/Projects.

Output: one JSON object on stdout:

    outcome     resolved | candidates | none
    rung        argument | directory | workspace | directory-name
    target      {kind: project|area|note|file, name, note, folder, area}, or null
    candidates  up to three, best first: {name, note, kind, folder, area, score, why}. The exact hits, then
                the highest non-zero scores; for `resolved` the pick comes first, so a re-ask has the runners-up.
                At rung 2 they are the declaring notes.
    dir_anchor  {name, note, kind, folder, area} of the area the directory sits in (rung 4), or null
    reason      one line
    learn_dir   "~/..." that `--learn` would accept for this directory, or null

`note` is vault-relative. `folder` is the top-level Work/Projects/<Folder>; `area` is the first non-empty
string of `area:` (nesting flattened, a [[link]] unwrapped, |alias and #heading dropped), else the folder
minus " (area)". A kind `note` or `file` target has null folder and area; a `file` target outside the vault
has a null `note` and its path as `name`.

The ladder. Rung 1, an argument: a [[link]]; a path (it contains `/` or starts with `~`) inside the vault (a
note, a folder through its folder note) or outside it (a file is a scoped target, a directory runs the
directory rungs); else a typed name, matched over every live key. The directory rungs read a linked worktree
as the same sub-path of its main checkout (the checkout's root when it lacks that path), so a worktree of an
umbrella repo keeps its sub-path; then a directory in a rollout clone (ADR 0042) as its in-place twin's same
directory (`self-rollout-check.sh --in-place`, asked only for a `*-rollout` toplevel), so the clone's top-level,
main root and learn_dir are the twin's and a lead's session in the clone resolves its project exactly as one in
the in-place checkout (a hand-made ~/Projects-rollout/<A>/<P> reads as ~/Projects/<A>/<P>). Rung 2, the directory: the longest live `repos:` entry that is the cwd,
that sub-path, its git top-level or its git main root, or a whole-component prefix of one; several declarers
ask. Rung 3, a workspace (launch-folders.json) holding the directory more deeply than any declaration: its
name, matched against area and folder-project notes. Rung 4, the directory's own name, matched within the
area its nearest area-named ancestor names; with no such area, suggestions only.

Live targets: notes under Work/Projects whose `tags:` include `project` or `area`, outside Archive/, not
dead (next-action's dead_note: the `archived` tag or status done/merged/dropped) and not `done: true`. Their
keys are the basename and every `aliases:` entry; anchors are the folder notes (Work/Projects/<T>/<T>.md and
Work/Projects/<T>/<F>/<F>.md).

Matching. A name is lowercased, loses " (area)" and a leading yy-mm-dd date, and splits on non-alphanumerics
(one-letter tokens dropped). Two tokens score 1 when equal or when one is a 3+-letter prefix of the other,
else their difflib ratio when both have 4+ letters and it reaches 0.8. A key scores the mean of its two
directions' best-token means; a target scores its best key. Any exact key resolves (several ask); else a
best below FLOOR is `none`; else a best MARGIN clear of the runner-up resolves; else the top three ask.

The own directory. A directory is named by its own directory O: the component just below the deepest frame
holding it (a ~/Projects child, an _archive dir, ~/.agents/skills, a workspaces parent, the parent of a
declared entry, or an area-named dir at or above the git root), or its git root when that is deeper; with
no frame, its git root, else the directory itself. So a dated dir inside the ~/Projects umbrella repo, or a
skill inside ~/.agents, names itself, never the umbrella. `learn_dir` is O when it is under HOME, no
umbrella (HOME, ~/Projects, ~/.agents, ~/.agents/skills, a workspaces parent) or ancestor of one, declared
by no note, not area-named or _-prefixed, and holds no declared entry or workspace. A declared directory, a
matched workspace root and a matched area directory have none.

--learn <dir> <note> appends <dir>, as "~/...", to the note's `repos:` when <dir> is exactly the learn_dir
this script gives for it. <note> is a live project note by name or vault path (the path when two notes share
a basename). A block list gains one line at its items' indent; a null, empty or missing `repos:` becomes a
one-item block list; a flow list or a scalar is rewritten whole. The edit is re-parsed (`repos:` must equal
the old list plus <dir>, every other key unchanged) and written in place. Prints {"learned": ..., "note": ...}.

Exit 0 on any answer, `none` included. Exit 2 on a refusal (a usage error, an unusable --cwd when a
directory rung reads it, any --learn refusal): stderr carries one line starting `resolve-target: ` and
nothing was written. Exit 3 when the vault or PyYAML is missing.
"""
import argparse
import difflib
import importlib.util
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NEXT_ACTION_PY = os.path.join(HERE, "next-action.py")
SELF_ROLLOUT_SH = os.path.join(HERE, "..", "..", "execute", "scripts", "self-rollout-check.sh")
VAULT_DEFAULT = "~/repos/obsidian"
LAUNCH_FOLDERS_DEFAULT = "~/repos/workspaces/_shared/state/launch-folders.json"
FLOOR = 0.65    # below this best score, nothing is a match
MARGIN = 0.15   # a fuzzy best goes ahead only this far clear of the runner-up
TOP = 3
EPS = 1e-9
PROJECTS = os.path.join("Work", "Projects")
DATE_PREFIX = re.compile(r"^\d{2}-\d{2}-\d{2}[_-]")
AREA_SUFFIX = re.compile(r"\s*\(area\)")
TOKEN = re.compile(r"[^\W_]+")
LINK_ARG = re.compile(r"\[\[(.*)\]\]", re.S)
LAUNCHERS = re.compile(r"/launchers(?:/|$)")


def fail(code, reason):
    sys.stderr.write("resolve-target: %s\n" % reason)
    sys.exit(code)


def _load(name, path):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


try:
    NA = _load("thread_next_action", NEXT_ACTION_PY)
except Exception as e:  # a broken install: report it as the resolver, never as a traceback
    fail(3, "cannot load %s: %s" % (NEXT_ACTION_PY, e))


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


# ---- Paths ---------------------------------------------------------------------------------------------------

def real(p):
    return os.path.realpath(os.path.abspath(p))


def within(p, r):
    return p == r or p.startswith(r.rstrip("/") + "/")


class Home:
    def __init__(self):
        self.root = real(os.path.expanduser("~"))
        self.projects = os.path.join(self.root, "Projects")
        self.agents = os.path.join(self.root, ".agents")
        self.skills = os.path.join(self.agents, "skills")

    def tilde(self, p):
        if p == self.root:
            return "~"
        return "~/" + os.path.relpath(p, self.root) if within(p, self.root) else p

    def below(self, p):
        return within(p, self.root) and p != self.root


def checked_dir(path, label):
    """The realpath of a usable directory, else exit 2 — only ever called when a rung reads it."""
    if not os.path.exists(path):
        fail(2, "%s %s does not exist" % (label, path))
    if not os.path.isdir(path):
        fail(2, "%s %s is not a directory" % (label, path))
    if not os.access(path, os.R_OK | os.X_OK):
        fail(2, "%s %s is not readable" % (label, path))
    return real(path)


# ---- Names ---------------------------------------------------------------------------------------------------

def tokens(text):
    """Lowercase, no " (area)", no leading yy-mm-dd date, split on non-alphanumerics, one-letter tokens dropped."""
    s = AREA_SUFFIX.sub("", str(text).strip().lower())
    s = DATE_PREFIX.sub("", s.strip())
    return tuple(t for t in TOKEN.findall(s) if len(t) > 1)


def sim(a, b):
    if a == b:
        return 1.0
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 3 and long_.startswith(short):
        return 1.0
    if len(a) >= 4 and len(b) >= 4:
        r = difflib.SequenceMatcher(None, a, b).ratio()
        if r >= 0.8:
            return r
    return 0.0


def key_score(q, k):
    if not q or not k:
        return 0.0
    fwd = sum(max(sim(a, b) for b in k) for a in q) / len(q)
    back = sum(max(sim(b, a) for a in q) for b in k) / len(k)
    return (fwd + back) / 2


def flatten(value):
    if isinstance(value, list):
        for x in value:
            yield from flatten(x)
    elif value is not None:
        yield value


def unlink(s):
    m = LINK_ARG.fullmatch(s.strip())
    s = m.group(1) if m else s
    return s.split("|")[0].split("#")[0].strip()


def area_of(value, folder):
    for item in flatten(value):
        if isinstance(item, str) and item.strip():
            s = unlink(item)
            if s:
                return s
    return AREA_SUFFIX.sub("", folder).strip() if folder else None


def done_flag(note):
    v = note.get("done")
    return v is True or (isinstance(v, str) and v.strip().lower() == "true")


def dead_why(rel, note):
    if NA.Vault.archived(rel):
        return "archived"
    if note.fm is None:
        return None  # unreadable: never dead on no evidence
    return NA.dead_note(note) or ("done (done: true)" if done_flag(note) else None)


def slash(rel):
    return rel.replace(os.sep, "/")


# ---- The index -----------------------------------------------------------------------------------------------

class Target:
    def __init__(self, rel, note):
        parts = rel.split(os.sep)
        self.rel = rel
        self.name = parts[-1][:-3]
        self.kind = "area" if "area" in NA.tags_of(note) else "project"
        self.folder = parts[2] if len(parts) > 3 else None
        self.area = area_of(note.get("area"), self.folder)
        self.dir = os.path.dirname(rel)
        # A folder note: Work/Projects/<T>/<T>.md or Work/Projects/<T>/<F>/<F>.md.
        self.anchor = len(parts) in (4, 5) and parts[-2] == self.name
        labels = [(self.name, False)] + [(str(a).strip(), True) for a in flatten(note.get("aliases")) if str(a).strip()]
        self.keys, seen = [], set()
        for label, alias in labels:
            t = tokens(label)
            if t and t not in seen:
                seen.add(t)
                self.keys.append((label, t, alias))
        self.declared = []
        for item in NA.as_list(note.get("repos")):
            if isinstance(item, str) and item.strip():
                p = os.path.expanduser(item.strip())
                if os.path.isabs(p):
                    self.declared.append(real(p))

    def public(self):
        return {"kind": self.kind, "name": self.name, "note": slash(self.rel), "folder": self.folder, "area": self.area}


class Hit:
    def __init__(self, target, score, exact, why):
        self.target, self.score, self.exact, self.why = target, score, exact, why

    def public(self):
        out = self.target.public()
        out.update(score=round(self.score, 3), why=self.why)
        return out


class Index:
    def __init__(self, vault):
        self.vault = vault
        self.targets = []
        top = os.path.join(vault.root, PROJECTS)
        for d, dirs, files in os.walk(top):
            dirs[:] = sorted(x for x in dirs if not x.startswith(".") and x != "Archive")
            for f in sorted(files):
                if not f.lower().endswith(".md"):
                    continue
                rel = os.path.relpath(os.path.join(d, f), vault.root)
                note = vault.note(rel)
                if note.fm is None or not ({"project", "area"} & NA.tags_of(note)) or dead_why(rel, note):
                    continue
                self.targets.append(Target(rel, note))
        self.targets.sort(key=lambda t: t.rel)
        self.by_rel = {t.rel: t for t in self.targets}
        self.anchors = [t for t in self.targets if t.anchor]

    def rank(self, q, pool):
        """Every target in `pool` with a non-zero score: exact hits first, then by score, ties by vault path."""
        hits = []
        for t in pool:
            best = None
            for label, k, alias in t.keys:
                exact = k == q
                s = 1.0 if exact else key_score(q, k)
                if best is None or (exact, s) > (best[1], best[0]):
                    best = (s, exact, label, alias)
            if best and best[0] > 0:
                s, exact, label, alias = best
                what = ("alias %s" % label) if alias else "name"
                hits.append(Hit(t, s, exact, ("exact " + what) if exact else "%s, %.3g" % (what, s)))
        hits.sort(key=lambda h: (not h.exact, -h.score, h.target.rel))
        return hits

    def decide(self, q, pool):
        """(outcome, hits): any exact hit wins (several ask); else a clear fuzzy winner above FLOOR; else ask or none."""
        hits = self.rank(q, pool)
        exact = [h for h in hits if h.exact]
        if exact:
            return ("resolved" if len(exact) == 1 else "candidates"), hits[:TOP]
        if not hits or hits[0].score < FLOOR - EPS:
            return "none", hits[:TOP]
        second = hits[1].score if len(hits) > 1 else 0.0
        return ("resolved" if hits[0].score - second >= MARGIN - EPS else "candidates"), hits[:TOP]

    def anchor_named(self, name):
        """The one anchor (folder note) a directory name matches exactly, else None."""
        q = tokens(name)
        exact = [t for t in self.anchors if q and any(k == q for _, k, _ in t.keys)]
        return exact[0] if len(exact) == 1 else None

    def note_target(self, rel, kind="note"):
        return {"kind": kind, "name": os.path.basename(rel)[:-3] if kind == "note" else os.path.basename(rel),
                "note": slash(rel), "folder": None, "area": None}

    def classify(self, rel):
        """('target', Target) | ('dead', why) | ('note', target dict) for a vault-relative .md."""
        t = self.by_rel.get(rel)
        if t:
            return "target", t
        why = dead_why(rel, self.vault.note(rel))
        return ("dead", why) if why else ("note", self.note_target(rel))


# ---- Answers -------------------------------------------------------------------------------------------------

def answer(outcome, rung, target, candidates, reason, dir_anchor=None, learn_dir=None):
    return {"outcome": outcome, "rung": rung, "target": target, "candidates": candidates,
            "dir_anchor": dir_anchor, "reason": reason, "learn_dir": learn_dir}


def from_hits(outcome, rung, hits, reason, **kw):
    target = hits[0].target.public() if outcome == "resolved" else None
    return answer(outcome, rung, target, [h.public() for h in hits], reason, **kw)


def fuzzy_reason(outcome, hits, what):
    if outcome == "resolved":
        h = hits[0]
        if h.exact:
            return "%s: %s (%s)" % (what, h.why, h.target.name)
        nxt = hits[1].score if len(hits) > 1 else 0.0
        return "%s: best match %s (%.3g, next %.3g)" % (what, h.target.name, h.score, nxt)
    if outcome == "candidates":
        return "%s: a close call between %s" % (what, ", ".join(h.target.name for h in hits))
    return "%s matches no project or area" % what


class Resolver:
    def __init__(self, vault, index, home, launch_folders):
        self.vault, self.index, self.home = vault, index, home
        self.lf_path = launch_folders
        self._roots = None
        self._declared = None
        self._twins = {}

    # -- rung 1 --

    def by_name(self, text, prefix=""):
        q = tokens(text)
        outcome, hits = self.index.decide(q, self.index.targets)
        return from_hits(outcome, "argument", hits, prefix + fuzzy_reason(outcome, hits, '"%s"' % text.strip()))

    def argument(self, arg, cwd_arg):
        m = LINK_ARG.fullmatch(arg)
        if m:
            return self.link(unlink(arg))
        if "/" in arg or arg.startswith("~"):
            return self.path(arg, cwd_arg)
        return self.by_name(arg)

    def from_rels(self, rels, what):
        """The answer for vault notes a link or path names."""
        live, notes, dead = [], [], []
        for rel in rels:
            kind, val = self.index.classify(rel)
            (live if kind == "target" else notes if kind == "note" else dead).append(val)
        if len(live) == 1:
            return answer("resolved", "argument", live[0].public(), [Hit(live[0], 1.0, True, "link").public()],
                          "%s is %s" % (what, slash(live[0].rel)))
        if live:
            hits = [Hit(t, 1.0, True, "link") for t in live][:TOP]
            return answer("candidates", "argument", None, [h.public() for h in hits], "%s names %d notes" % (what, len(live)))
        if len(notes) == 1:
            return answer("resolved", "argument", notes[0], [dict(notes[0], score=1.0, why="link")],
                          "%s is a single note: a scoped reshuffle" % what)
        if notes:
            return answer("candidates", "argument", None, [dict(n, score=1.0, why="link") for n in notes[:TOP]],
                          "%s names %d notes" % (what, len(notes)))
        return answer("none", "argument", None, [], "%s is %s" % (what, dead[0]))

    def link(self, text):
        if not text:
            return answer("none", "argument", None, [], "an empty link")
        rels = self.vault.targets(text)
        if not rels:
            return self.by_name(text, "no note [[%s]]; " % text)
        return self.from_rels(rels, "[[%s]]" % text)

    def path(self, arg, cwd_arg):
        raw = os.path.expanduser(arg)
        if os.path.isabs(raw):
            cand = raw
        else:
            cand = None
            cwd = os.path.abspath(os.path.expanduser(cwd_arg)) if cwd_arg else None
            if cwd and os.path.isdir(cwd) and os.access(cwd, os.R_OK | os.X_OK) and os.path.lexists(os.path.join(cwd, raw)):
                cand = os.path.join(cwd, raw)
            if cand is None:
                cand = os.path.join(self.vault.root, raw)
        p = real(cand)
        stem = os.path.basename(p.rstrip("/"))
        stem = stem[:-3] if stem.lower().endswith(".md") else stem
        if os.path.commonpath([p, self.vault.root]) == self.vault.root:
            if os.path.isfile(p):
                try:
                    rel = self.vault.path_arg(p)
                except NA.Refused:
                    return self.by_name(stem)
                if not rel.lower().endswith(".md"):
                    pick = self.index.note_target(rel, "file")
                    return answer("resolved", "argument", pick, [dict(pick, score=1.0, why="path")], "a vault file: a scoped reshuffle")
                return self.from_rels([rel], slash(rel))
            if os.path.isdir(p):
                fn = os.path.join(p, os.path.basename(p) + ".md")
                if os.path.isfile(fn):
                    rel = os.path.relpath(fn, self.vault.root)
                    return self.from_rels([rel], slash(rel))
                return answer("none", "argument", None, [], "%s is a vault folder, not a note" % arg)
            return self.by_name(stem, "no note at %s; " % arg)
        if os.path.isfile(p):
            pick = {"kind": "file", "name": self.home.tilde(p), "note": None, "folder": None, "area": None}
            return answer("resolved", "argument", pick, [dict(pick, score=1.0, why="path")], "a file outside the vault: a scoped reshuffle")
        if os.path.isdir(p):
            return self.directory(checked_dir(p, "the argument"))[0]
        return answer("none", "argument", None, [], "no such path: %s" % arg)

    # -- the directory rungs --

    def workspace_roots(self):
        """(roots, why rung 3 is skipped or None): each by_workspace_profile path cut at /launchers/."""
        if self._roots is None:
            path = os.path.expanduser(self.lf_path)
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
            except FileNotFoundError:
                self._roots = ([], "no launch folders at %s" % self.home.tilde(real(path)))
                return self._roots
            except (OSError, ValueError) as e:
                self._roots = ([], "launch folders unreadable (%s)" % str(e).splitlines()[0])
                return self._roots
            by = data.get("by_workspace_profile") if isinstance(data, dict) else None
            if not isinstance(by, dict):
                self._roots = ([], "launch folders hold no by_workspace_profile")
                return self._roots
            roots = set()
            for profiles in by.values():
                for p in (profiles.values() if isinstance(profiles, dict) else []):
                    if isinstance(p, str) and p.strip():
                        p = os.path.expanduser(p.strip())
                        m = LAUNCHERS.search(p)
                        p = p[:m.start()] if m else p
                        if os.path.isabs(p):
                            roots.add(real(p))
            self._roots = (sorted(roots), None)
        return self._roots

    def declared(self):
        """(entry, target) for every live `repos:` entry."""
        if self._declared is None:
            self._declared = [(e, t) for t in self.index.targets for e in t.declared]
        return self._declared

    def git_roots(self, cwd):
        """(toplevel, G): the git top-level and the main worktree root, or Nones. A git failure is no error."""
        try:
            names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, timeout=30).stdout.split()
        except (OSError, subprocess.SubprocessError):
            return None, None
        env = dict(os.environ)
        for name in names:
            env.pop(name, None)
        try:
            r = subprocess.run(["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL, env=env, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return None, None
        out = r.stdout.splitlines()
        if r.returncode != 0 or len(out) != 2:
            return None, None
        common, top = real(out[0]), real(out[1])
        main = os.path.dirname(common) if os.path.basename(common) == ".git" else top
        return top, main

    def in_place(self, d):
        """`self-rollout-check.sh --in-place d`: the in-place twin's path for a directory inside a rollout clone
        (ADR 0042), else None. Cached; any failure to run is None (no clone)."""
        if d not in self._twins:
            twin = None
            try:
                names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                       stdin=subprocess.DEVNULL, timeout=30).stdout.split()
                env = dict(os.environ)
                for name in names:
                    env.pop(name, None)
                r = subprocess.run(["bash", SELF_ROLLOUT_SH, "--in-place", d], capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, env=env, timeout=60)
                if r.returncode == 0 and r.stdout.strip() and os.path.isdir(r.stdout.strip()):
                    twin = real(r.stdout.strip())
            except (OSError, subprocess.SubprocessError):
                twin = None
            self._twins[d] = twin
        return self._twins[d]

    def learnable(self, o):
        """(o, None) when `--learn` may write `o`, else (None, why)."""
        home = self.home
        roots, _ = self.workspace_roots()
        entries = self.declared()
        if o is None:
            return None, "no directory of its own"
        if not within(o, home.root):
            return None, "%s is outside HOME" % o
        umbrellas = {home.root, home.projects, home.agents, home.skills} | {os.path.dirname(w) for w in roots}
        if any(within(u, o) for u in umbrellas):
            return None, "%s is an umbrella directory" % home.tilde(o)
        owners = [t for e, t in entries if e == o]
        if owners:
            return None, "%s is already declared by %s" % (home.tilde(o), slash(owners[0].rel))
        anchor = self.index.anchor_named(os.path.basename(o))
        if anchor:
            return None, "%s is an area directory (%s)" % (home.tilde(o), anchor.name)
        if os.path.basename(o).startswith("_"):
            return None, "%s is a resource folder (_-prefixed)" % home.tilde(o)
        if any(within(p, o) and p != o for p in [e for e, _ in entries] + roots):
            return None, "%s holds other projects' directories" % home.tilde(o)
        return o, None

    def frames(self, L, G):
        """The deepest frame holding L (always strictly below HOME), or None."""
        home = self.home
        roots, _ = self.workspace_roots()
        parents = {os.path.dirname(w) for w in roots} | {os.path.dirname(e) for e, _ in self.declared()}
        d = L
        while home.below(d):
            if (os.path.dirname(d) == home.projects
                    or (os.path.basename(d) == "_archive" and within(d, home.projects))
                    or d == home.skills
                    or d in parents
                    or ((G is None or within(G, d)) and self.index.anchor_named(os.path.basename(d)))):
                return d
            d = os.path.dirname(d)
        return None

    def projects_child_anchor(self, d):
        """An anchor a ~/Projects child names exactly, or by a clear fuzzy winner."""
        outcome, hits = self.index.decide(tokens(os.path.basename(d)), self.index.anchors)
        return hits[0].target if outcome == "resolved" else None

    def dir_anchor(self, o):
        home = self.home
        d = os.path.dirname(o)
        while home.below(d):
            t = self.index.anchor_named(os.path.basename(d))
            if t is None and os.path.dirname(d) == home.projects:
                t = self.projects_child_anchor(d)
            if t:
                return t, d
            d = os.path.dirname(d)
        return None, None

    def directory(self, C):
        """Rungs 2-4 for the realpath'd directory C. Returns the answer plus the own directory O."""
        home = self.home
        top, G = self.git_roots(C)
        L = C
        if G and top and top != G:  # a linked worktree: the same sub-path of the main checkout, else its root
            L = real(os.path.join(G, os.path.relpath(C, top))) if within(C, top) else G
            L = L if os.path.isdir(L) else G
        if G and os.path.basename(G).endswith("-rollout"):  # a rollout clone: its in-place twin (ADR 0042)
            twin = self.in_place(L)
            if twin:
                L = twin
                top, G = self.git_roots(L)
        roots, lf_why = self.workspace_roots()
        note = "; rung 3 skipped: %s" % lf_why if lf_why else ""
        F = self.frames(L, G)
        if F is None:
            O = G or L
        elif L == F:
            O = F
        else:
            O = os.path.join(F, os.path.relpath(L, F).split(os.sep)[0])
            if G and within(G, F) and G != F and len(G) > len(O):
                O = G

        probes = [p for p in (C, L, top, G) if p]
        E = None
        for e, _ in self.declared():
            if any(within(p, e) for p in probes) and (E is None or len(e) > len(E)):
                E = e
        WL = max((w for w in roots if within(L, w)), key=len, default=None)

        if E and not (WL and len(WL) > len(E)):  # rung 2; a tie goes to the declaration
            owners = [t for e, t in self.declared() if e == E]
            owners = sorted({t.rel: t for t in owners}.values(), key=lambda t: t.rel)
            hits = [Hit(t, 1.0, True, "declares %s" % home.tilde(E)) for t in owners][:TOP]
            if len(owners) == 1:
                return from_hits("resolved", "directory", hits, "%s is declared by %s%s" % (home.tilde(E), owners[0].name, note)), O
            learn = G if (G and within(G, E) and G != E) else None
            return from_hits("candidates", "directory", hits, "%s is declared by %d projects%s" % (home.tilde(E), len(owners), note),
                             learn_dir=self.learn_out(learn)), O

        if WL:  # rung 3
            name = os.path.basename(WL)
            name = name[:-len("-workspace")] if name.endswith("-workspace") else name
            outcome, hits = self.index.decide(tokens(name), self.index.anchors)
            learn = None if (outcome != "none" and O == WL) else O
            return from_hits(outcome, "workspace", hits, fuzzy_reason(outcome, hits, "workspace %s" % os.path.basename(WL)),
                             learn_dir=self.learn_out(learn)), O

        # rung 4
        if L == home.root:
            return answer("none", "directory-name", None, [], "the home directory names no project" + note), O
        if F is not None and L == F:
            t = self.index.anchor_named(os.path.basename(F))
            if t is None and os.path.dirname(F) == home.projects:
                t = self.projects_child_anchor(F)
            q = tokens(os.path.basename(F))
            if t:
                hits = self.index.rank(q, self.index.anchors)
                hits = ([h for h in hits if h.target is t] + [h for h in hits if h.target is not t])[:TOP]
                return from_hits("resolved", "directory-name", hits, "%s is the directory of %s%s" % (home.tilde(F), t.name, note)), O
            _, hits = self.index.decide(q, self.index.targets)
            return from_hits("none", "directory-name", hits, "%s matches no area%s" % (home.tilde(F), note),
                             learn_dir=self.learn_out(O)), O
        own = os.path.basename(O)
        q = tokens(own)
        anchor, adir = self.dir_anchor(O)
        if anchor is None:
            _, hits = self.index.decide(q, self.index.targets)
            return from_hits("none", "directory-name", hits, "no area holds %s, so only suggestions%s" % (own, note),
                             learn_dir=self.learn_out(O)), O
        mine = set(tokens(anchor.name)) | set(tokens(os.path.basename(adir)))
        q = tuple(t for t in q if t not in mine) or q
        pool = [t for t in self.index.targets if within(t.dir, anchor.dir)]
        outcome, hits = self.index.decide(q, pool)
        where = anchor.public()
        if outcome == "none":
            _, hits = self.index.decide(q, self.index.targets)
            return from_hits("none", "directory-name", hits, "no project in %s matches %s%s" % (anchor.name, own, note),
                             dir_anchor=where, learn_dir=self.learn_out(O)), O
        return from_hits(outcome, "directory-name", hits, fuzzy_reason(outcome, hits, "directory %s in %s" % (own, anchor.name)) + note,
                         dir_anchor=where, learn_dir=self.learn_out(O)), O

    def learn_out(self, o):
        o, _ = self.learnable(o) if o else (None, None)
        return self.home.tilde(o) if o else None


# ---- --learn ---------------------------------------------------------------------------------------------------

def plain_item(item):
    """The item as a block-list entry: bare when YAML reads it back unchanged, else JSON-quoted."""
    try:
        if NA.yaml.load("- " + item, Loader=NA.LOADER) == [item]:
            return item
    except NA.yaml.YAMLError:
        pass
    return json.dumps(item, ensure_ascii=False)


def with_repo(note, item):
    """The note's text with `item` appended to `repos:`, checked by re-parsing. Raises NA.Refused."""
    if note.fm is None:
        raise NA.Refused("%s: %s" % (note.path, note.error))
    body = note.body()
    if NA.ODD_BREAKS.search(body):
        raise NA.Refused("%s: frontmatter has line breaks other than \\n" % note.path)
    root = NA.yaml.compose(body, Loader=NA.LOADER)
    hits = [(k, v) for k, v in (root.value if root is not None else [])
            if isinstance(k, NA.yaml.ScalarNode) and k.value == "repos"]
    if len(hits) > 1:
        raise NA.Refused("%s carries `repos:` more than once" % note.path)
    old = list(NA.as_list(note.get("repos")))
    lines, first = list(note.lines), note.span[0]
    entry = plain_item(item)
    if not hits:  # no key: the key and the item go before the closing ---
        close = note.span[1]
        ending = NA.ending_of(lines[close - 1]) or NA.ending_of(lines[0]) or "\n"
        if lines[close - 1] and not NA.ending_of(lines[close - 1]):
            lines[close - 1] += ending
        lines[close:close] = ["repos:" + ending, "  - %s%s" % (entry, ending)]
        text = "".join(lines)
    else:
        k, v = hits[0]
        null = isinstance(v, NA.yaml.ScalarNode) and note.get("repos") is None
        empty = isinstance(v, NA.yaml.SequenceNode) and not v.value
        if isinstance(v, NA.yaml.SequenceNode) and v.value and not v.flow_style:  # a block list: one line more
            last = v.value[-1]
            at = first + last.start_mark.line
            prefix = lines[at][:last.start_mark.column]
            if not re.fullmatch(r"[ \t]*-[ \t]+", prefix):
                raise NA.Refused("%s: `repos:` is not a plain block list; left alone" % note.path)
            end = first + last.end_mark.line + (1 if last.end_mark.column else 0)
            ending = NA.ending_of(lines[end - 1]) or "\n"
            lines.insert(end, "%s%s%s" % (prefix, entry, ending))
            text = "".join(lines)
        elif null or empty:  # the key plus one item
            start = first + k.start_mark.line
            end = first + v.end_mark.line + (1 if v.end_mark.column else 0)
            end = max(end, start + 1)
            ending = NA.ending_of(lines[end - 1]) or NA.ending_of(lines[start]) or "\n"
            lines[start:end] = ["repos:" + ending, "  - %s%s" % (entry, ending)]
            text = "".join(lines)
        else:  # a flow list or a scalar: the full list, through next-action's one-key edit
            text = note.edited("repos", old + [item])
    check = NA.Note(note.path, text)
    want = dict(note.fm)
    want["repos"] = old + [item]
    if check.fm != want:
        raise NA.Refused("%s: adding to `repos:` would change other frontmatter; left alone" % note.path)
    return text


def learn(resolver, dir_arg, note_arg):
    vault, home = resolver.vault, resolver.home
    d = os.path.expanduser(dir_arg)
    if not os.path.isdir(d):
        fail(2, "no such directory: %s" % dir_arg)
    d = checked_dir(d, "the directory")
    try:
        rel, why = vault.resolve_project(note_arg)
    except NA.Refused as e:
        fail(2, str(e))
    if why:
        fail(2, "%s: %s" % (note_arg, why))
    note = vault.note(rel)
    why = dead_why(rel, note)
    if why:
        fail(2, "%s is %s; it takes no directory" % (slash(rel), why))
    owners = [t for e, t in resolver.declared() if e == d]
    if owners:
        fail(2, "%s is already declared by %s" % (home.tilde(d), slash(owners[0].rel)))
    res, O = resolver.directory(d)
    if res["learn_dir"] != home.tilde(d):
        if O is not None and O != d:
            fail(2, "the resolver names %s for this directory, not %s" % (home.tilde(O), home.tilde(d)))
        _, why = resolver.learnable(O)
        fail(2, why or "no learnable directory here: %s" % res["reason"])
    item = home.tilde(d)
    try:
        text = with_repo(note, item)
    except NA.Refused as e:
        fail(2, str(e))
    try:
        note.save(text)
    except OSError as e:
        fail(2, "cannot write %s: %s" % (slash(rel), e))
    sys.stdout.write(json.dumps({"learned": item, "note": slash(rel)}, ensure_ascii=False) + "\n")


# ---- Main ----------------------------------------------------------------------------------------------------

def main(argv):
    p = Parser(prog="resolve-target", allow_abbrev=False,
               description="Orient's target resolver and its repos: learner (ADR 0036).")
    p.add_argument("argument", nargs="*")
    p.add_argument("--cwd")
    p.add_argument("--vault", default=VAULT_DEFAULT)
    p.add_argument("--launch-folders", default=LAUNCH_FOLDERS_DEFAULT)
    p.add_argument("--learn", nargs=2, metavar=("DIR", "NOTE"))
    args = p.parse_args(argv)
    if args.learn and (args.argument or args.cwd is not None):
        fail(2, "--learn takes no argument words and no --cwd")
    if NA.yaml is None:
        fail(3, "PyYAML is required: python3 -m pip install pyyaml")
    vroot = os.path.expanduser(args.vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    home = Home()
    vault = NA.Vault(vroot)
    resolver = Resolver(vault, Index(vault), home, args.launch_folders)
    if args.learn:
        learn(resolver, *args.learn)
        return 0
    cwd = args.cwd
    if cwd is None:
        try:
            cwd = os.getcwd()
        except OSError:
            cwd = None
    arg = " ".join(args.argument).strip()
    if arg:
        out = resolver.argument(arg, cwd)  # an argument run never fails on the cwd
    else:
        if cwd is None:
            fail(2, "the working directory is gone")
        out, _ = resolver.directory(checked_dir(os.path.abspath(os.path.expanduser(cwd)), "--cwd"))
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
