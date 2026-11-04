#!/usr/bin/env python3
"""serial-chains.py — schedule § Serial path's plan: a serial set's chains, surfaces and launches (ADR 0040).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/serial-chains.py plan --tasks <a,b,...>
        [--surface <slug>=<raw>]... [--dep <slug>=<slug>]... [--vault <dir>] [--launch-folders <json>]

/thread:schedule § Serial path runs it at S2 (and again at S4 after a confirmed dependency or an added surface).
Stdlib only, python >= 3.9. No network, and it writes nothing. Git runs only as `git rev-parse --local-env-vars`
(to scrub repo-local env vars such as a hook's GIT_DIR, landing-register.py's rule), `git -C <dir> rev-parse
--show-toplevel`, `git -C <toplevel> rev-parse --path-format=absolute --git-common-dir` (a checkout's key, below) and
`git -C <dir> remote get-url origin`, each read-only with a 30 s timeout. It reads the task notes
(`<vault>/Work/Tasks`, root first, then Archive/), their project notes (`<vault>/Work/Projects/**`), the
launch-folders file and its own tree's `.claude-plugin/plugin.json`; it never reads a launcher marker. Defaults:
--vault ~/repos/obsidian, --launch-folders ~/repos/workspaces/_shared/state/launch-folders.json.

Surfaces (CONTEXT.md **Surface**; ADR 0067 d4). A surface is a place a chain is predicted to write, as a canonical
token of one of six kinds. Predicted claims group, order and wait; they never refuse a schedule.
  repo:<key>//<path>    a file in a git checkout, or a folder with a trailing `/` (`repo:<key>//<dir>/`): <key> is the
                        checkout's in-place twin (Git.primary: a linked worktree's main worktree), so the token reads
                        the same from any copy, and <path> is relative to it (no leading `/`, no `..`; an empty one
                        reads as the bare key). Two keyed tokens overlap only when their keys are equal and one path
                        contains the other at a `/` boundary, case-folded (APFS): purely textual, so sibling files of
                        one checkout are apart. The folder mark is information only.
  repo:<absolute path>  a bare token: a whole checkout (its toplevel), or a path in no checkout. It overlaps on
                        equality or containment at a `/` boundary, case-folded, so a bare toplevel covers every file
                        under it; two checkouts of one origin are disjoint (the rollout clone is its own checkout),
                        and so is a checkout nested inside another by path (a separate repo with its own index, as
                        `~/Projects` holds its own Narcissus clone): containment parts when both paths sit in git
                        checkouts and the inner one's toplevel is not the outer one's (p33-3), a keyed side's toplevel
                        read from its key. An outer path in no checkout still covers every checkout beneath it.
  vault:<path>          a path relative to the vault root: overlaps on a case-folded prefix at a segment boundary.
  vault                 the whole vault: overlaps every vault token. Only a member that names no project and no
                        path claims it unasked, or one that writes it as a literal token (ADR 0059).
  ext:<name>            an external system (CMS, DNS zone, console): overlaps on case-folded equality.
  any                   the unknown: overlaps every token of every kind.
Kinds never overlap one another, save `any`. Bookkeeping is never a surface (ADR 0059, ADR 0067 d5): the chain's note
and the engine's other writes under Work/Tasks, and the ledgers every run appends to, a keyed token at or under
`_shared/state/thread-events/` (the Run record, reviews.jsonl, grades.jsonl, tunings.jsonl) or `docs/reviews/`. A
member's own task note is claimed only beside its project's place, or alone by a member that only reaches a checkout
(below).

How a path becomes a token (claim, through locate; the same for a declared `repo:` path, a `## Launch` path, a
project's `Local:`, a launch folder, a `touches:` item and a --surface path):
  1. `~` expanded; the path must be absolute. The realpath of its nearest existing ancestor, with the rest appended
     and normalised; a path that does not exist yet is claimed through that ancestor, with a WARN naming it (printed
     only when the token is kept).
  2. At or under the vault root's realpath (case-folded): `vault` (the root itself) or `vault:<rel>`. The vault is a
     note space, not a checkout: every chain writes its own task notes there. A derived or added `vault` (the root)
     narrows in the plan, and a derived or added path under Work/Tasks is dropped (below); claim itself returns the
     truthful token.
  3. Inside a git checkout (`git -C <nearest existing directory> rev-parse --show-toplevel`): `repo:<key>//<rel>`
     (`/` when the path is an existing directory, or is written with one), or the bare `repo:<key>` for the toplevel
     itself. A claim covers what it names, at its own depth, declared or derived; a bare toplevel covers the checkout.
  4. Otherwise `repo:<realpath>`, path-only, with a WARN that it covers everything beneath it.

Reach and prediction (ADR 0067 d4). A reach path only says where a member works: it names the checkout and predicts
nothing there. Reach paths are its launch folder, each launch-command `cd` or `--add-dir` path (below), each `Local:` of
its first project, the first path span of a where-label `## Launch` item (WHERE_LABEL_RE: **Launch:**, **Repo:**,
**Repos:**, **Workspace:**, **Project:**, **Engine:**, **Working tree:**, **Dir:**, **Cwd:**; the item's value, as
pickups' Repo rule reads it, so `**Repo:** ~/.agents/skills/` is reach at any depth) and any other `## Launch` path span
that is a checkout's toplevel. A reach path inside a checkout gives no token: it adds that checkout (its key) to the
member's `works`. One in the vault or in no checkout keeps claim's handling (a vault token or root hit, or path-only
with its WARN). Every other `## Launch` path span below a toplevel (a **Files:** or **Ledger:** span, a later span on a
**Repo:** line, an unlabelled line), `touches:`, a declared `surfaces:` and a --surface path are predictions.

Each member's surfaces:
  1. Declared: a non-empty frontmatter `surfaces:` list (an empty one reads as absent), one token per block-list
     item, never split on commas (read_surfaces). A `repo:` value may be written with `~/` and goes through claim at
     its own depth (a toplevel stays bare, anything deeper is a file or folder token); `vault`, `vault:<rel>`,
     `ext:<name>` and `any` are kept, normalised by parse_token. The declaration is the member's whole claim before
     additions: it replaces derivation.
  2. Derived (no declaration): every backticked path span in its `## Launch` outside a **Read...** or **MCP** item
     (a span that starts `~/` or `/`, holds no whitespace or `:`, and, `/`-rooted, has two segments or more, so
     `/seo:impact`, `/morning` and alias spans are skipped); every launch-command path there (below); each
     `` Local: `<path>` `` in the body of its first project note (the first `projects:` wikilink's); its launch
     folder, for a member with an alias; and each frontmatter `touches:` item, a relative one keyed to the member's
     one checkout in `works` by then (with zero or several, the relative items are skipped with one WARN), an
     absolute or `~` one through claim. Reach adds to `works` (above); a prediction gives its token. A derived path
     that is the vault root is a root hit and claims nothing itself (step 4); a derived bookkeeping token is dropped,
     with no WARN.
  3. Added: each `--surface <slug>=<raw>` unions in, declared member or not (a path or `repo:` value through claim,
     any other token through parse_token), and is listed in the member's `added`. An added path that is the vault
     root is a root hit (step 4, with a WARN when it narrows); one under Work/Tasks, or a ledger, is dropped with a
     WARN. A literal token (`vault`, `vault:<rel>`, `ext:`, `any`) is kept as written, and so is every declared token,
     a ledger included: a declaration is deliberate. `added` lists only the tokens kept.
  4. The project claim (ADR 0059), on a root hit or when 1-3 gave nothing and it reaches no checkout: its first
     project's place and its own task note (`vault:Work/Tasks/<slug>.md`, or its Archive/ path, as found), relative
     to --vault. The place of a folder note (`<dir>/<dir>.md`, `<dir>` strictly below Work/Projects) is `vault:<dir>`;
     of a flat note, the note and the folder it would become (`vault:<dir>/<name>.md` and `vault:<dir>/<name>`). A
     first project named but with no note under Work/Projects gets a WARN and counts as none. With no project: a root
     hit claims `vault` with a WARN to link its project or declare `surfaces:`; nothing at all claims `vault` with the
     default WARN to declare `surfaces:`.
  5. Reach only (1-3 gave nothing, no root hit, and it reaches a checkout): it writes a checkout, not the vault, so it
     claims only its own task note (as step 4 finds it), never its project's place or the whole vault, with one WARN
     (`<slug>: names no file in <top>: it predicts nothing there, so it orders against no chain's files (ADR 0067
     d4); declare surfaces: for the files it writes`). Its Queue cell is so never empty.
`source` is `declared` (1 non-empty), else `derived` (2 or 3 kept a token, a root hit was seen, 4 claimed a project's
place, or 5), else `default`. The guarantee: a member predicts each path its `## Launch` names below a checkout's
toplevel, each `touches:` item and each surface added for it, the vault root, Work/Tasks and the ledgers aside, or
exactly what it declares; its launch folder, its launch commands' `--add-dir` and `cd` paths, its where-label values,
its toplevel spans and its first project's `Local:` paths are its `works`.
It never claims its launch profile's other Working roots (a workspace launcher's `add_dirs`), another project's
`Local:`, a project's `repos:` entries, nor a repo or external system it writes but names nowhere: those are
outside schedule's sight.

Launch-command paths. In `## Launch`, outside a **Read...** or **MCP** item, each line of a fenced block (a `\\`
line end continues it) and each backticked span that is not a path span is read as shell: quotes stripped, `#`
starts a comment, and `&&`, `||`, `;`, `|` and `&` start a new command. A command's path is the argument of
each `--add-dir <path>` (with any further path spans after it: the flag takes several) or `--add-dir=<path>`,
and of a `cd <path>` that starts the command, where a path starts `/`, `~/` or `$HOME/` (`${HOME}/`). Any other
path in a fenced block is not claimed: a fence holds commands, and a path a command only reads is no surface.
A `## Launch` path (a path span or a launch-command path) that is `/`, the home directory or an ancestor of it (a
bare `cd ~`, `--add-dir ~`) is never claimed, with a WARN: it would contain every repo token and so over-claim
the estate (too_broad).

Launch, per member. Alias: the task's `launch:`, else the `launch:` of its first project note (the `projects:`
wikilink's file under `<vault>/Work/Projects/**`, a match outside Archive/ first). Folder: `by_alias[alias]`, else
`plain_aliases[alias]`. `works` is the checkouts a member works (works_of): the key of each keyed `repo:` token, each
bare one that is a git toplevel, and each reach checkout. A member with no alias (or `claude`) opens with `claude`
from its one `works` checkout when it has exactly one; with none, from its one bare `repo:` token in no checkout when
it has exactly one, else from the vault root. A code row never opens where its Leg cannot finish it (leg.py done
finishes only commits in the Leg's own checkout; ADR 0059): an alias-less member working two checkouts or more is
refused, and so is an aliased one whose launch folder is in the vault (realpaths, case-folded, as claim compares)
while it works a checkout. Each row keeps its own launch: a launch change between two rows is a Leg boundary (ADR
0040).

Ruling (c), no serial self-rollouts: plugin.json's `repository`, normalised (norm_origin), against the origin of
each launch-command path in a member's `## Launch` and each reach path span there (its checkout; declared member or
not), the checkout of each of its `repo:` tokens (checkout_of), its launch folder, every `` Local: `<path>` `` in its
project notes' bodies and their `repos:` entries. A match sends the member to `sessionLane`, with a `why` naming the
source (the first match, in that order: a reach span reads `its ## Launch path <p>`). Ruling (c) runs before the
launch refusals, so a session-lane member is never refused for its launch.

Grouping: connected components over surface overlap, plus `depends-on:` / `blocked-by:` / --dep edges inside the
set. Each chain is ordered topologically (Kahn's); among the ready tasks the next row is the lowest phase N of
`-p<N>-<M>` (a slug without it sorts after every numbered one), then one whose launch equals the previous row's,
then the lowest M, then the slug. A dependency outside the set (or on a session-lane member) is listed in the
chain's `externalDeps`.

Output: one JSON line on stdout, exit 0, nothing on stderr:
  {"chains": [{"tasks": [...], "surfaces": [...], "checkouts": [...], "members": {slug: {"surfaces": [...],
   "source": ..., "added": [...], "launch": {"alias": ..., "folder": ...}, "works": [...]}}, "externalDeps":
   [{"task": ..., "dependsOn": ...}]}], "sessionLane": [{"slug": ..., "why": ...}], "warns": ["WARN: ...", ...]}
A chain's `checkouts` is checkouts_of over its `surfaces` and its members' launch folders, the vault excluded: exactly
what its note records (`surfaces:` and the Queue's Launch cells), so S3's `--checkout`, S4 and reconcile-rollout.py's
`_serial_root` read the same list. A member's `works` also counts the `--add-dir` and `Local:` reach no Leg commits to.
Exit 3 prints no stdout and one `REFUSE:` line per refusal, with its remedy: an alias in neither map, an alias with
a null folder, a launch folder that is missing, a launch-folders file missing or unreadable while an alias needs it
(an unreadable file no alias needs is only a WARN), a dependency cycle, a malformed declared token, a code row whose
Leg would open outside the checkout it works (an alias-less row working two checkouts, or a vault launch working
one; never a session-lane member). Exit 2 prints
one `serial-chains:` line: no --tasks, a task note not found, a malformed --surface or --dep, reconcile-rollout.py
unloadable, or plugin.json unreadable (ruling (c) cannot be checked, so the plan fails closed).

Chain copies (ADR 0067 d2). A serial note that carries `chain_copies:` works each git checkout it writes in its own
Chain copy: a git worktree of that checkout on `chain/<rollout-slug>`, outside `~/repos` and `~/Projects`, which
leg.py's `copies` verb makes (schedule S5) and `begin` remakes. Each item is `"<abs checkout> -> <abs copy>"`
(read_chain_copies, fmt_chain_copies; `[]` is copy mode with nothing to copy, and a note with no key works every
checkout in place). A copy's directory is `<checkout basename>-<rollout slug>`, `-<k>-` before the slug when another
checkout of the chain has that basename (copy_name). A Queue folder is always a primary path: copy_folder maps it to
the same relative folder inside its checkout's copy (the longest checkout prefix, case-folded, so a checkout nested
inside another by path maps to its own copy), and primary_folder maps a copy path back. Tokens never change: a keyed
token is written against the in-place twin (Git.primary), so it reads the same from a copy.

The estate rank (ADR 0067 d9; CONTEXT.md **Estate rank**). orient-all stamps `estate_rank: <n>` and `estate_rank_at:
"<pass time>"` (ESTATE_RANK_KEYS) on each rollout note it dispatches and re-stamps the live ones (estate-dispatch.py
rank-stamp). read_estate_rank is the one parser of the pair, and rank_tokens the one statement of which tokens rank-wait
between two chains in Chain copies: `repo:` (a code file) and `any`, never vault or `ext:` (d6).

The pure helpers (parse_token, fmt_token, repo_parts, checkout_of, overlaps, overlap_pairs, read_list, read_surfaces,
read_chain_copies, fmt_chain_copies, copy_name, rank_tokens, norm_origin, and read_estate_rank given its stamp parser)
touch neither the filesystem nor git; checkouts_of,
copy_folder and primary_folder read it only through realpath (and checkouts_of through the toplevel resolver it is
given). unfinished-rollout.py imports them (rank_tokens for its (O) holder half), leg.py loads the surface grammar, the
Chain copy helpers and the rank's two, estate-dispatch.py read_chain_copies, copy_folder and read_estate_rank (rank-stamp),
and reconcile-rollout.py read_surfaces, checkouts_of and read_chain_copies:
repo_parts, checkout_of and checkouts_of are this file's one statement of a chain's checkouts. overlaps
and overlap_pairs take an optional toplevel resolver (Git.checkout) for the nested-checkout rule, and are purely
textual without one. locate (claim), the grouping's nested-checkout read, the `checkouts` read and the ruling-(c)
origin read are the only code that runs git; of it, only the Git class is exported, for unfinished-rollout.py's own
nested-checkout and launch-folder reads. Importing this file has no side effects.
"""
import argparse
import importlib.util
import json
import os
import posixpath
import re
import shlex
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RR_SRC = HERE.parent.parent / "execute/scripts/reconcile-rollout.py"
PLUGIN_JSON = HERE.parent.parent.parent / ".claude-plugin/plugin.json"
RR_NAMES = ("Note", "_scalar", "_wikilink_slug", "_dep_entries", "_parse_ts")
DEFAULT_VAULT = "~/repos/obsidian"
DEFAULT_LAUNCH_FOLDERS = "~/repos/workspaces/_shared/state/launch-folders.json"
GITHUB_PREFIXES = ("https://github.com/", "git@github.com:", "ssh://git@github.com/")
KINDS = ("repo", "vault", "ext")
TOKEN_FORMS = ("repo:<toplevel>//<path in it>, repo:<absolute path>, vault, vault:<path in the vault>, ext:<name> "
               "or any")


# ---- the surface grammar (pure) -----------------------------------------------------------------

def _repo_value(value):
    """A `repo:` value in canonical form, or ValueError: the leading slashes normalised to one, then split on the
    first `//` (posixpath.normpath would collapse it) into the toplevel and the path in it, each normalised. A rel
    that is absolute or escapes with `..` is refused; an empty one (`/x//`) reads as the bare toplevel; a trailing
    `/` on the rel is kept as the folder mark."""
    if not value.startswith("/"):
        raise ValueError("a repo: path is absolute (no ~ and no relative path)")
    v = "/" + value.lstrip("/")
    top, sep, rel = v.partition("//")
    top = posixpath.normpath(top)
    if not sep:
        return top
    if rel.startswith("/"):
        raise ValueError("a repo: token's path after // is relative to its toplevel (no leading /)")
    folder = rel.endswith("/")
    r = posixpath.normpath(rel) if rel.strip() else "."
    if r == ".":
        return top
    if r == ".." or r.startswith("../"):
        raise ValueError("a repo: token's path after // stays inside its toplevel (no ..)")
    if top == "/":
        return "/" + r
    return f"{top}//{r}" + ("/" if folder else "")


def parse_token(s):
    """A surface token's syntax check: (kind, value) in canonical form, or ValueError. `any` and `vault` carry ''.
    A `repo:` value is absolute with no `~`: `<toplevel>//<path in it>` (a file, or a folder with a trailing `/`) or
    a bare path (a whole checkout, or a path in none), as _repo_value reads it; a `vault:` value is relative, with no
    `..` and no leading `/`; an `ext:` name is non-empty; a trailing `/` is dropped, save a keyed token's folder
    mark. The kind is case-folded; the value keeps its case."""
    if not isinstance(s, str):
        raise ValueError("not a string")
    t = s.strip()
    if not t:
        raise ValueError("empty")
    if t.lower() in ("any", "vault"):
        return (t.lower(), "")
    kind, sep, value = t.partition(":")
    kind = kind.strip().lower()
    if not sep or kind not in KINDS:
        raise ValueError(f"unknown kind {kind!r}: a token is one of {TOKEN_FORMS}")
    value = value.strip()
    if kind == "repo":
        return ("repo", _repo_value(value))
    if kind == "vault":
        if value.startswith("/"):
            raise ValueError("a vault: path is relative to the vault root (no leading /)")
        parts = [p for p in value.split("/") if p not in ("", ".")]
        if ".." in parts:
            raise ValueError("a vault: path holds no ..")
        if not parts:
            raise ValueError("vault: names no path (write vault for the whole vault)")
        return ("vault", "/".join(parts))
    value = value.rstrip("/").strip()
    if not value:
        raise ValueError("ext: names no system")
    return ("ext", value)


def fmt_token(tok) -> str:
    """The canonical text of a (kind, value) token."""
    kind, value = tok
    return kind if kind in ("any", "vault") and not value else f"{kind}:{value}"


def _tok(x):
    return parse_token(x) if isinstance(x, str) else x


def repo_parts(value):
    """A canonical `repo:` value as (toplevel, rel or None, is_dir): `/x//a/b.py` is ('/x', 'a/b.py', False),
    `/x//a/` is ('/x', 'a', True), and a bare `/x` is ('/x', None, False)."""
    top, sep, rel = value.partition("//")
    if not sep:
        return (value, None, False)
    return (top, rel.rstrip("/"), rel.endswith("/"))


def _abs(top, rel):
    return top if rel is None else f"{top.rstrip('/')}/{rel}"


def checkout_of(tok):
    """The checkout a `repo:` token names, as a token: `repo:<key>` for a keyed token, the bare token itself
    otherwise; None for any other kind. One of this file's statements of a chain's checkouts (with checkouts_of)."""
    kind, value = _tok(tok)
    if kind != "repo":
        return None
    return ("repo", repo_parts(value)[0])


def checkouts_of(tokens, folders, toplevel=None, vault_real=None):
    """A chain's checkouts, the one statement S2's JSON, S3's `--checkout`, S4, `_serial_root`, stamp_bases and
    check_resume read: a sorted, unique list of paths holding checkout_of of each `repo:` token (a malformed one is
    skipped) plus toplevel(realpath(expanduser(folder))) for each launch folder, a folder in the vault (at or under
    vault_real, case-folded) or in no checkout (toplevel None, or no resolver) skipped. It reads the filesystem only
    through realpath and the resolver."""
    out, vf = {}, vault_real.casefold() if vault_real else None

    def add(p):
        if not p:
            return
        pf = p.casefold()
        if vf and (pf == vf or pf.startswith(vf.rstrip("/") + "/")):
            return
        out.setdefault(pf, p)

    for t in tokens or []:
        try:
            c = checkout_of(t)
        except ValueError:
            continue
        if c is not None:
            add(c[1])
    for f in folders or []:
        if f and toplevel is not None:
            add(toplevel(os.path.realpath(os.path.expanduser(str(f)))))
    return sorted(out.values())


def _within(x: str, y: str) -> bool:
    return x == y or x.startswith(y + "/") or y.startswith(x + "/")


def _nested_apart(va: str, vb: str, toplevel) -> bool:
    """Two repo: paths, one strictly inside the other: apart when both sit in git checkouts and the inner one's is not
    the outer one's (a separate checkout nested by path, with its own index). toplevel maps a path to its checkout's
    toplevel, or None (in no checkout); an outer path in no checkout covers everything beneath it, so it never parts."""
    xf, yf = va.casefold(), vb.casefold()
    if xf == yf:
        return False
    outer, inner = (va, vb) if xf == "/" or yf.startswith(xf + "/") else (vb, va)
    to, ti = toplevel(outer), toplevel(inner)
    return bool(to and ti) and to.casefold() != ti.casefold()


def overlaps(a, b, toplevel=None) -> bool:
    """Whether two tokens (strings or (kind, value) pairs) name a shared place, by the rules in the header. Two keyed
    `repo:` tokens meet only when their keys are equal (case-folded) and one path contains the other: purely textual.
    With a bare `repo:` token on either side, containment decides, and with a toplevel resolver (Git.checkout) two
    paths that meet only by containment across nested checkouts are disjoint, a keyed side's toplevel read from its
    key (no git); without a resolver, the comparison is purely textual. A folder mark is information only."""
    (ka, va), (kb, vb) = _tok(a), _tok(b)
    if ka == "any" or kb == "any":
        return True
    if ka != kb:
        return False
    if ka == "ext":
        return va.casefold() == vb.casefold()
    if ka == "vault":
        x, y = va.casefold(), vb.casefold()
        return not x or not y or _within(x, y)
    (ta, ra, _), (tb, rb, _) = repo_parts(va), repo_parts(vb)
    pa, pb = _abs(ta, ra), _abs(tb, rb)
    x, y = pa.casefold(), pb.casefold()
    if ra is not None and rb is not None:
        return ta.casefold() == tb.casefold() and _within(x, y)
    if not (x == "/" or y == "/" or _within(x, y)):
        return False
    if toplevel is None:
        return True
    keys = {p.casefold(): t for p, t, r in ((pa, ta, ra), (pb, tb, rb)) if r is not None}
    return not _nested_apart(pa, pb, lambda p: keys.get(p.casefold()) or toplevel(p))


def overlap_pairs(A, B, toplevel=None):
    """Every (a, b) with a from A and b from B that overlap, in order (toplevel as overlaps takes it)."""
    return [(a, b) for a in A for b in B if overlaps(a, b, toplevel)]


def _item_value(raw: str) -> str:
    """One list item's value: a quoted item up to its closing quote (commas and `#` kept), else the text with an
    inline ` # comment` dropped."""
    raw = raw.strip()
    if raw and raw[0] in "\"'":
        end = raw.find(raw[0], 1)
        return (raw[1:end] if end > 0 else raw[1:]).strip()
    return re.sub(r"\s+#.*$", "", raw).strip()


def _split_inline(v: str):
    """An inline `[a, "b, c"]` list's items, split only on commas outside quotes."""
    out, cur, quote = [], "", None
    for ch in v:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            cur += ch
        elif ch == ",":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [t for t in (_item_value(p) for p in out) if t]


def read_surfaces(note):
    """A note's `surfaces:` as raw token strings, [] when absent or empty (read_list's reading)."""
    return read_list(note, "surfaces") or []


def read_list(note, key):
    """A note's frontmatter `key:` list as raw strings, or None when the key is absent. A block list gives one item per
    `- ` line (quotes stripped, never split on commas); an inline `[...]` list is split only on commas outside quotes; a
    lone scalar is one item; an empty value with no items is []. (reconcile-rollout.py's get_list splits on every
    comma, so it cannot read these.)"""
    lines = note._fm
    pat = re.compile(rf"^{re.escape(key)}:(.*)$")
    for i, line in enumerate(lines):
        m = pat.match(line)
        if not m:
            continue
        value = m.group(1).strip()
        if value and value[0] not in "\"'":
            value = re.sub(r"\s+#.*$", "", value).strip()
        if value:
            if value.startswith("[") and value.endswith("]"):
                return _split_inline(value[1:-1])
            v = _item_value(value)
            return [v] if v else []
        out = []
        for item in lines[i + 1:]:
            mi = re.match(r"^\s*-\s*(.*)$", item)
            if mi:
                v = _item_value(mi.group(1))
                if v:
                    out.append(v)
            elif item.strip():
                break
        return out
    return None


# ---- Chain copies (ADR 0067 d2; pure: no git, the filesystem only through realpath) --------------

COPY_ARROW = " -> "


def read_chain_copies(note):
    """A serial note's `chain_copies:` as [(checkout, copy)], or None when the key is absent (the chain works each
    checkout in place). Each item is `"<abs checkout> -> <abs copy>"`, both sides normalised; an item with no ` -> `,
    an empty side or a relative one is a ValueError naming it. `[]` is copy mode with nothing to copy."""
    items = read_list(note, "chain_copies")
    if items is None:
        return None
    out = []
    for it in items:
        c, sep, p = it.partition(COPY_ARROW)
        c, p = c.strip(), p.strip()
        if not sep or not c or not p:
            raise ValueError(f"{it!r} is not `<checkout> -> <copy>`")
        if not (c.startswith("/") and p.startswith("/")):
            raise ValueError(f"{it!r}: both sides are absolute paths")
        out.append((posixpath.normpath(c), posixpath.normpath(p)))
    return out


def fmt_chain_copies(pairs) -> str:
    """The inline list read_chain_copies reads back: `["<checkout> -> <copy>", …]`."""
    return "[" + ", ".join(f'"{c}{COPY_ARROW}{p}"' for c, p in pairs) + "]"


def copy_name(checkout, slug, taken=()):
    """A Chain copy's directory name: `<basename>-<slug>`, or `<basename>-<k>-<slug>` for the first free k >= 2 when
    another checkout in `taken` (the [(checkout, copy)] pairs already named) holds that name, case-folded."""
    base = posixpath.basename(posixpath.normpath(checkout)) or "root"
    held = {posixpath.basename(p).casefold(): c.casefold() for c, p in taken}
    name, k = f"{base}-{slug}", 2
    while held.get(name.casefold(), checkout.casefold()) != checkout.casefold():
        name, k = f"{base}-{k}-{slug}", k + 1
    return name


def _remap(path, pairs):
    """path (a realpath) through the longest case-folded `src` prefix at a `/` boundary of [(src, dst)] to
    `<dst>/<rel>`, or None when no src holds it."""
    pf, best = path.casefold(), None
    for src, dst in pairs:
        s = src.rstrip("/") or "/"
        sf = s.casefold()
        if pf == sf or pf.startswith(sf.rstrip("/") + "/"):
            if best is None or len(sf) > len(best[0]):
                best = (sf, s, dst)
    if best is None:
        return None
    rel = path[len(best[1].rstrip("/")):].lstrip("/")
    return posixpath.join(best[2], rel) if rel else best[2]


def copy_folder(folder, pairs):
    """A folder's place in its Chain copy: realpath(expanduser(folder)) mapped by the longest case-folded checkout
    prefix of pairs ([(checkout, copy)], read_chain_copies') to `<copy>/<rel>`, or None (no pairs, or no checkout holds
    it: the vault, a folder in no checkout). A checkout nested inside another by path maps to the inner one's copy."""
    if not folder or not pairs:
        return None
    return _remap(os.path.realpath(os.path.expanduser(str(folder))), pairs)


def primary_folder(path, pairs):
    """copy_folder's inverse: a path inside a Chain copy mapped by the longest copy prefix back to `<checkout>/<rel>`,
    or None when no copy holds it."""
    if not path or not pairs:
        return None
    return _remap(os.path.realpath(os.path.expanduser(str(path))), [(p, c) for c, p in pairs])


# ---- the estate rank and the counted tokens (ADR 0067 d9; pure: no git, no filesystem) ----------

ESTATE_RANK_KEYS = ("estate_rank", "estate_rank_at")


def read_estate_rank(note, parse_ts=None):
    """A rollout note's estate rank (ADR 0067 d9; CONTEXT.md **Estate rank**), the one parser of orient-all's stamp:
    {n, at, ts} from `estate_rank: <n>` and `estate_rank_at: "<pass time>"`, or None (unstamped). n is an int >= 1
    and at an ISO stamp reconcile-rollout.py's _parse_ts accepts (parse_ts, else loaded through load_rr); ts is its
    epoch seconds. Anything malformed (one key without the other, an n of 0, -1 or x, a stamp that will not parse)
    reads as unstamped: the caller WARNs when either key is present."""
    raw_n, raw_at = (_item_value(note.get(k) or "") for k in ESTATE_RANK_KEYS)
    if not raw_n or not raw_at or not re.fullmatch(r"[0-9]+", raw_n) or int(raw_n) < 1:
        return None
    parse = parse_ts if parse_ts is not None else load_rr()._parse_ts
    ts = parse(raw_at)
    if ts is None:
        return None
    return {"n": int(raw_n), "at": raw_at, "ts": ts.timestamp()}


def rank_tokens(xs):
    """The tokens that rank-wait between two chains in Chain copies (ADR 0067 d9): kind `repo` (a code file) or `any`
    (an unknown cell), as (kind, value) pairs, in order, each once; vault and `ext:` never wait (d6), and a malformed
    token is skipped. The one copy leg.py's claim and unfinished-rollout.py's (O) holder half count."""
    out = []
    for x in xs or []:
        try:
            t = _tok(x)
        except ValueError:
            continue
        if t[0] in ("repo", "any") and t not in out:
            out.append(t)
    return out


def norm_origin(url: str) -> str:
    low = url.lower()
    for prefix in GITHUB_PREFIXES:
        if low.startswith(prefix):
            rest = url[len(prefix):]
            if rest.endswith("/"):
                rest = rest[:-1]
            if rest.endswith(".git"):
                rest = rest[:-4]
            return "github.com/" + rest.lower()
    return url


# ---- exits ---------------------------------------------------------------------------------------

def die(msg):
    print(f"serial-chains: {msg}", file=sys.stderr)
    sys.exit(2)


class Parser(argparse.ArgumentParser):
    """argparse's errors as the script's one-line exit 2 (subparsers inherit the class)."""

    def error(self, message):
        die(message)


def load_rr():
    """reconcile-rollout.py as a module (side-effect-free on import), as unfinished-rollout.py loads it."""
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("reconcile_rollout", RR_SRC)
        if spec is None or spec.loader is None:
            raise ImportError("no loader for this path")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for name in RR_NAMES:
            getattr(mod, name)
        return mod
    except Exception as e:  # noqa: BLE001 — any failure to load is the same exit-2 condition
        die(f"cannot load {RR_SRC} (skills/execute/scripts/reconcile-rollout.py): {e}")


def plugin_origin() -> str:
    """plugin.json's `repository`, normalised; exit 2 when it cannot be read (ruling (c) fails closed)."""
    try:
        data = json.loads(PLUGIN_JSON.read_text())
        repo = data.get("repository") if isinstance(data, dict) else None
        if isinstance(repo, dict):
            repo = repo.get("url")
        if not isinstance(repo, str) or not repo.strip():
            raise ValueError("no repository")
        return norm_origin(repo.strip())
    except (OSError, ValueError) as e:
        die(f"cannot read the plugin's repository from {PLUGIN_JSON}: {e}: ruling (c) cannot be checked")


# ---- git (claim, the nested-checkout reads and the ruling-(c) read; only Git is exported) --------

class Git:
    """Read-only git calls with the repo-local env vars scrubbed, cached per directory."""

    def __init__(self):
        try:
            names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                   timeout=30).stdout.split()
        except (OSError, subprocess.SubprocessError):
            names = []
        self.env = dict(os.environ)
        for name in names:
            self.env.pop(name, None)
        self._top, self._origin, self._primary = {}, {}, {}

    def _run(self, d, *cmd):
        try:
            r = subprocess.run(["git", "-C", d, *cmd], env=self.env, capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return None
        out = r.stdout.strip()
        return out if r.returncode == 0 and out else None

    def toplevel(self, d):
        if d not in self._top:
            top = self._run(d, "rev-parse", "--show-toplevel")
            self._top[d] = os.path.realpath(top) if top else None
        return self._top[d]

    def primary(self, top):
        """A checkout's key, the toplevel its tokens are written against so they read the same from any copy: the
        main worktree when `realpath(git rev-parse --path-format=absolute --git-common-dir)` is `<main>/.git` and
        `<main>` is its own toplevel (a linked worktree, a task tree, a snapshot: engine-snapshot.py's git_primary
        rule), else top itself (a bare repo, `--separate-git-dir`, `core.worktree`). A separate clone keeps its own
        key (ADR 0042)."""
        if top not in self._primary:
            key = top
            common = self._run(top, "rev-parse", "--path-format=absolute", "--git-common-dir")
            if common:
                common = os.path.realpath(common)
                main = os.path.dirname(common)
                if os.path.basename(common) == ".git" and self.toplevel(main) == main:
                    key = main
            self._primary[top] = key
        return self._primary[top]

    def checkout(self, path):
        """The toplevel of the checkout a path is in, read from its nearest existing directory, or None: the
        resolver overlaps takes to part two repo: tokens nested across separate checkouts."""
        d = os.path.normpath(path)
        while not os.path.isdir(d):
            parent = os.path.dirname(d)
            if parent == d:
                return None
            d = parent
        return self.toplevel(d)

    def origin(self, d):
        if d not in self._origin:
            url = self._run(d, "remote", "get-url", "origin") if os.path.isdir(d) else None
            self._origin[d] = norm_origin(url) if url else None
        return self._origin[d]


def locate(raw, who, vault_real, git):
    """(token, key, warns): a path by the header's four claim steps. key is the checkout's key (Git.primary) when the
    path is inside a git checkout, else None; the token is then `repo:<key>//<rel>` (`/` when the path is an existing
    directory or is written with one) or the bare `repo:<key>` for the toplevel itself. warns are the WARN lines a
    kept token carries, prefixed with `who`: the caller drops them with a token it does not keep."""
    folder = raw.strip().endswith("/")
    p = os.path.expanduser(raw.strip())
    if not os.path.isabs(p):
        raise ValueError(f"{raw} is not an absolute path")
    p = os.path.normpath(p)
    cur, rest = p, []
    while not os.path.exists(cur):
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        rest.insert(0, os.path.basename(cur))
        cur = parent
    real = os.path.realpath(cur)
    full = os.path.normpath(os.path.join(real, *rest)) if rest else real
    warns = []
    if rest:
        warns.append(f"WARN: {who}: {raw} does not exist yet: claimed through its nearest existing ancestor {real}")
    vf, ff = vault_real.casefold(), full.casefold()
    if ff == vf:
        return ("vault", ""), None, warns
    if ff.startswith(vf + "/"):
        return ("vault", full[len(vault_real) + 1:]), None, warns
    d = real if os.path.isdir(real) else os.path.dirname(real)
    top = git.toplevel(d)
    if top:
        key = git.primary(top)
        tf = top.casefold()
        if ff == tf or not ff.startswith(tf.rstrip("/") + "/"):
            return ("repo", key), key, warns
        rel = full[len(top.rstrip("/")) + 1:]
        mark = "/" if folder or os.path.isdir(full) else ""
        return parse_token(f"repo:{key}//{rel}{mark}"), key, warns
    warns.append(f"WARN: {who}: {full} is in no git checkout: repo:{full} covers everything beneath it "
                 "(a declared `surfaces:` can narrow it)")
    return ("repo", full), None, warns


def claim(raw, who, vault_real, git, warns):
    """A path as a token, by the header's four steps (locate); WARNs go to `warns`, prefixed with `who`."""
    tok, _key, w = locate(raw, who, vault_real, git)
    warns.extend(w)
    return tok


# ---- reading the notes ---------------------------------------------------------------------------

FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
SPAN_RE = re.compile(r"`([^`\n]+)`")
LIST_ITEM_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$")
SKIP_LABEL_RE = re.compile(r"^[*_\s]*(?:read\w*|mcp)\b", re.I)
# A where-label item names where the row works, never what it writes: its first path span is reach (ADR 0067 d4).
WHERE_LABEL_RE = re.compile(r"^[*_\s]*(?:launch|repos?|workspace|project|engine|working[ -]tree|dir|cwd)[*_\s]*:", re.I)
PHASE_RE = re.compile(r"(?:^|-)p(\d+(?:\.\d+)?)-(\d+)(?=-|$)", re.I)
LOCAL_RE = re.compile(r"Local:\s*`(~?/[^`\n]*)`")
CMD_PUNCT = ";&|"
HOME_RE = re.compile(r"^\$(?:HOME|\{HOME\})(?=/|$)")


def is_path_span(s: str) -> bool:
    if re.search(r"[\s:]", s):
        return False
    if s.startswith("~/"):
        return True
    return s.startswith("/") and len([p for p in s.split("/") if p]) >= 2


def _cmd_words(cmd: str):
    """A shell line's words: quotes stripped, `#` a comment, each run of `;`, `&` and `|` a word of its own."""
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=CMD_PUNCT)
    lex.whitespace_split = True
    try:
        return list(lex)
    except ValueError:  # an unbalanced quote: plain whitespace words
        return cmd.split()


def _path_arg(w: str):
    """A command argument as a path to claim (`$HOME` read as `~`), or None when it is not absolute."""
    w = HOME_RE.sub("~", w)
    return w if w == "~" or w.startswith(("~/", "/")) else None


def too_broad(path: str) -> bool:
    """A `## Launch` path that is `/`, the home directory or an ancestor of it (compared as written and as
    realpaths): claimed, it would contain every repo token, so the plan skips it with a WARN."""
    full = os.path.expanduser(path)
    home = os.path.expanduser("~")
    fulls = {posixpath.normpath(full), os.path.realpath(full)}
    homes = {posixpath.normpath(home), os.path.realpath(home)}
    return any(f == "/" or f == h or h.startswith(f + "/") for f in fulls for h in homes)


def command_paths(cmd: str):
    """(path, via) for each launch-command path of one shell line (the header's rule): via is `--add-dir` or `cd`."""
    words, out, i, first = _cmd_words(cmd), [], 0, True
    while i < len(words):
        w = words[i]
        i += 1
        if w and set(w) <= set(CMD_PUNCT):
            first = True
            continue
        if first and w == "cd":
            p = _path_arg(words[i]) if i < len(words) else None
            if p:
                out.append((p, "cd"))
        elif w == "--add-dir":
            p = _path_arg(words[i]) if i < len(words) else None
            while p:
                out.append((p, "--add-dir"))
                i += 1
                nxt = HOME_RE.sub("~", words[i]) if i < len(words) else ""
                p = nxt if is_path_span(nxt) else None
        elif w.startswith("--add-dir="):
            p = _path_arg(w[len("--add-dir="):])
            if p:
                out.append((p, "--add-dir"))
        first = False
    return out


def launch_paths(text: str):
    """(path, via, where) for each path a `## Launch` body names, outside a **Read...** or **MCP** item (a list item,
    an unindented line or an unindented fence starts an item; an indented line continues it; a blank line outside a
    fence ends it): via is None for a backticked path span, else the launch-command path's flag (`--add-dir` or
    `cd`), read from each fenced line and each backticked span that is not a path span. where is True for the first
    path span of a where-label item (WHERE_LABEL_RE: **Launch:**, **Repo:** and their kin), the item's value as
    pickups' Repo rule reads it."""
    out, fence, skip, cont, where, taken = [], False, False, "", False, False
    for line in text.split("\n"):
        if FENCE_RE.match(line):
            if not fence and not line[:1].isspace():
                skip = where = False
            fence, cont = not fence, ""
            continue
        if fence:
            if skip:
                continue
            if line.rstrip().endswith("\\"):
                cont += line.rstrip()[:-1] + " "
                continue
            out.extend((p, via, False) for p, via in command_paths(cont + line))
            cont = ""
            continue
        if not line.strip():
            skip = where = False
            continue
        m = LIST_ITEM_RE.match(line)
        item = m.group(2) if m else (line if not line[:1].isspace() else None)
        if item is not None:
            skip, where, taken = bool(SKIP_LABEL_RE.match(item)), bool(WHERE_LABEL_RE.match(item)), False
        if not skip:
            for s in SPAN_RE.findall(line):
                if is_path_span(s):
                    out.append((s, None, where and not taken))
                    taken = taken or where
                else:
                    out.extend((p, via, False) for p, via in command_paths(s))
    return out


def find_task(tasks_dir: Path, slug: str):
    """A task note by name: the root copy, else the first under Archive/ (as unfinished-rollout.py finds one)."""
    root = tasks_dir / f"{slug}.md"
    if root.is_file():
        return root
    archive = tasks_dir / "Archive"
    if archive.is_dir():
        found = sorted(archive.rglob(f"{slug}.md"))
        if found:
            return found[0]
    return None


class Projects:
    """Project notes under <vault>/Work/Projects/**, by case-folded name, a match outside Archive/ first."""

    def __init__(self, rr, vault: Path):
        self.rr, self.root, self._index, self._notes = rr, vault / "Work" / "Projects", None, {}

    def find(self, name):
        if self._index is None:
            self._index = {}
            if self.root.is_dir():
                for dirpath, _, files in os.walk(self.root):
                    for f in files:
                        if f.endswith(".md"):
                            self._index.setdefault(f[:-3].casefold(), []).append(Path(dirpath) / f)
            for paths in self._index.values():
                paths.sort(key=lambda p: ("Archive" in p.relative_to(self.root).parts, str(p)))
        hits = self._index.get(name.casefold())
        return hits[0] if hits else None

    def read(self, name):
        """(note or None, text or '') for the project named `name`; (None, '') when not found."""
        if name not in self._notes:
            path = self.find(name)
            note, text = None, ""
            if path is not None:
                try:
                    text = path.read_text()
                    note = self.rr.Note(path)
                except (OSError, ValueError):
                    note = None
            self._notes[name] = (note, text)
        return self._notes[name]


def phase_key(slug: str):
    m = PHASE_RE.search(slug)
    if m:
        return (0, float(m.group(1)), int(m.group(2)))
    return (1, 0.0, 0)


# ---- the plan ------------------------------------------------------------------------------------

def split_pair(flag, value):
    a, sep, b = value.partition("=")
    a, b = a.strip(), b.strip()
    if not sep or not a or not b:
        die(f"{flag} {value}: write it as <slug>=<value>")
    return a, b


def added_token(raw):
    """A --surface value as a claimable path (returned as ('path', p)) or a parsed token; ValueError otherwise."""
    r = raw.strip()
    if r.lower().startswith("repo:"):
        r = r[5:].strip()
    if r.startswith("~/") or r.startswith("/") or r == "~":
        p = os.path.expanduser(r)
        if not os.path.isabs(p):
            raise ValueError(f"{raw} is not an absolute path")
        return ("path", r)
    if raw.strip().lower().startswith("repo:"):
        raise ValueError("a repo: path is absolute or starts ~/")
    return parse_token(r)


def resolve_launch(slug, alias, lf, lf_path, lf_err):
    """(folder, refusal): the alias's launch folder, or the refusal line for R5's four cases."""
    if lf is None:
        return None, (f"{slug}: launch alias {alias} needs {lf_path}, which is missing or unreadable ({lf_err}): "
                      "restore it, or pass --launch-folders <json>")
    by_alias, plain = lf
    if alias in by_alias:
        folder = by_alias[alias]
    elif alias in plain:
        folder = plain[alias]
    else:
        return None, (f"{slug}: unknown alias {alias}: it is in neither by_alias nor plain_aliases of {lf_path}: "
                      "fix the task's `launch:` (or its project's), or launch-folders.json")
    if not isinstance(folder, str) or not folder.strip():
        return None, (f"{slug}: {alias} has no launch folder: set `launch:` to an alias with one, or remove it so "
                      "its Leg opens with `claude`")
    folder = os.path.expanduser(folder.strip())
    if not os.path.isdir(folder):
        return None, (f"{slug}: launch folder {folder} for {alias} is missing: fix launch-folders.json or the "
                      "task's `launch:`")
    return folder, None


BOOKKEEPING = "work/tasks"
# The ledgers every run appends to (ADR 0067 d5): the Run record, reviews.jsonl, grades.jsonl and tunings.jsonl under
# the workspaces' thread-events dir, and leg.py's REVIEWS, a checkout's review docs.
LEDGERS = ("_shared/state/thread-events", "docs/reviews")


def bookkeeping(tok) -> bool:
    """Whether a token is the engine's own bookkeeping, case-folded: a vault path at or under Work/Tasks (ADR 0059), or
    a keyed `repo:` token whose path in its checkout is at or under one of LEDGERS (ADR 0067 d5)."""
    kind, value = tok
    if kind == "repo":
        rel = repo_parts(value)[1]
        r = rel.casefold() if rel is not None else None
        return r is not None and any(r == x or r.startswith(x + "/") for x in LEDGERS)
    v = value.casefold()
    return kind == "vault" and (v == BOOKKEEPING or v.startswith(BOOKKEEPING + "/"))


def project_claim(vault: Path, proj_path: Path, task_path: Path):
    """A member's narrowed vault claim (ADR 0059): its first project's place and its own task note, as tokens
    relative to the --vault path (the lexical base Projects and find_task walk). A folder note (its stem is its
    folder's name, the folder strictly below Work/Projects) gives its folder; a flat note gives itself and the folder
    it would become, so a flat-to-folder-note move keeps the claim and a literal note path still overlaps it."""
    root = vault / "Work" / "Projects"
    parent = proj_path.parent
    if proj_path.stem.casefold() == parent.name.casefold() and root in parent.parents:
        out = [parse_token("vault:" + parent.relative_to(vault).as_posix())]
    else:
        rel = proj_path.relative_to(vault)
        out = [parse_token("vault:" + rel.as_posix()), parse_token("vault:" + rel.with_suffix("").as_posix())]
    out.append(parse_token("vault:" + task_path.relative_to(vault).as_posix()))
    return out


def works_of(tokens, reach, git):
    """The checkouts a member works, sorted and unique (case-folded): checkout_of each keyed `repo:` token, each bare
    one that is a git toplevel, and each reach checkout (a key). A bare token in no checkout is not one."""
    out = {}
    for t in tokens:
        kind, value = _tok(t)
        if kind != "repo":
            continue
        top, rel, _ = repo_parts(value)
        if rel is not None or git.toplevel(top) == top:
            out.setdefault(top.casefold(), top)
    for r in reach:
        out.setdefault(r.casefold(), r)
    return sorted(out.values())


def in_vault(folder, vault_real) -> bool:
    """Whether a launch folder is at or under the vault root, by claim's comparison (realpaths, case-folded)."""
    r, vf = os.path.realpath(os.path.expanduser(folder)).casefold(), vault_real.casefold()
    return r == vf or r.startswith(vf + "/")


def load_launch_folders(path):
    try:
        data = json.loads(Path(path).read_text())
        if not isinstance(data, dict):
            raise ValueError("not a JSON object")
        by_alias, plain = data.get("by_alias") or {}, data.get("plain_aliases") or {}
        if not isinstance(by_alias, dict) or not isinstance(plain, dict):
            raise ValueError("by_alias or plain_aliases is not an object")
        return (by_alias, plain), None
    except (OSError, ValueError) as e:
        return None, str(e)


def order_chain(members, deps, launch_of):
    """(rows, cycle): Kahn's order over one component by the header's tie-break, or the members left in a cycle."""
    indeg = {m: 0 for m in members}
    after = {m: [] for m in members}
    for m in members:
        for d in deps[m]:
            if d in indeg:
                indeg[m] += 1
                after[d].append(m)
    ready = [m for m in members if indeg[m] == 0]
    rows, prev = [], None
    while ready:
        def key(m):
            g, n, mm = phase_key(m)
            same = 0 if prev is None or launch_of[m] == launch_of[prev] else 1
            return (g, n, same, mm, m.lower(), m)
        nxt = min(ready, key=key)
        ready.remove(nxt)
        rows.append(nxt)
        prev = nxt
        for m in after[nxt]:
            indeg[m] -= 1
            if indeg[m] == 0:
                ready.append(m)
    left = sorted((m for m in members if m not in rows), key=str.lower)
    return rows, left


def cmd_plan(args) -> int:
    slugs, seen = [], set()
    for s in (args.tasks or "").split(","):
        s = s.strip()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            slugs.append(s)
    if not slugs:
        die("--tasks names no task")
    surface_pairs, dep_pairs = [], []
    for v in args.surface or []:
        slug, raw = split_pair("--surface", v)
        try:
            added_token(raw)
        except ValueError as e:
            die(f"--surface {v}: {e}")
        surface_pairs.append((v, slug, raw))
    for v in args.dep or []:
        dep_pairs.append((v,) + split_pair("--dep", v))
    rr = load_rr()
    norm = lambda s: (rr._wikilink_slug(s) or s).lower()  # noqa: E731
    members = {norm(s) for s in slugs}
    adds, extra_deps = {}, {}
    for v, slug, raw in surface_pairs:
        if norm(slug) not in members:
            die(f"--surface {v}: {slug} is not one of --tasks")
        adds.setdefault(norm(slug), []).append(raw)
    for v, a, b in dep_pairs:
        if norm(a) not in members:
            die(f"--dep {v}: {a} is not one of --tasks")
        extra_deps.setdefault(norm(a), []).append(rr._wikilink_slug(b) or b)
    porigin = plugin_origin()

    vault = Path(os.path.expanduser(args.vault))
    vault_real = os.path.realpath(vault)
    tasks_dir = vault / "Work" / "Tasks"
    notes = {}
    for s in slugs:
        name = rr._wikilink_slug(s) or s
        path = find_task(tasks_dir, name)
        if path is None:
            die(f"--tasks {name}: no note at {tasks_dir / (name + '.md')} or under Archive/")
        try:
            notes[path.stem] = rr.Note(path)
        except ValueError as e:
            die(f"--tasks {name}: {e}")
    by_key = {k.lower(): k for k in notes}

    lf_path = os.path.expanduser(args.launch_folders)
    lf, lf_err = load_launch_folders(lf_path)
    git = Git()
    projects = Projects(rr, vault)
    warns, refusals, session, info = [], [], [], {}

    for slug, note in notes.items():
        proj_names = [n for n in (rr._wikilink_slug(rr._scalar(v)) for v in note.get_list("projects")) if n]
        alias = rr._scalar(note.get("launch"))
        if not alias and proj_names:
            pnote, _ = projects.read(proj_names[0])
            alias = rr._scalar(pnote.get("launch")) if pnote is not None else ""
        if alias.lower() == "claude":
            alias = ""
        folder = None
        if alias:
            folder, why = resolve_launch(slug, alias, lf, lf_path, lf_err)
            if why:
                refusals.append(why)

        cw = []
        declared = read_surfaces(note)
        # Each `## Launch` path, located once: a launch-command path or a where-label item's value is reach, and so is
        # any other path span that is a checkout's toplevel; the rest are predictions (ADR 0067 d4).
        launch_named = []
        for path, via, where in launch_paths(note.section_text("## Launch")):
            if too_broad(path):
                if not declared:
                    cw.append(f"WARN: {slug}: its ## Launch {via or 'path'} {path} is / or the home directory (or "
                              "above it): not claimed, since it would contain every repo; declare `surfaces:` for what "
                              "the task writes there")
                continue
            tok, key, tw = locate(path, slug, vault_real, git)
            reach = bool(via or where or (key is not None and tok == ("repo", key)))
            launch_named.append((path, via, reach, tok, key, tw))
        tokens, added, reach_tops = [], [], []
        if declared:
            for raw in declared:
                try:
                    r = raw.strip()
                    if r.lower().startswith("repo:"):
                        p = os.path.expanduser(r[5:].strip())
                        if not os.path.isabs(p):
                            raise ValueError("a repo: path is absolute or starts ~/")
                        tokens.append(claim(p, slug, vault_real, git, cw))
                    else:
                        tokens.append(parse_token(r))
                except ValueError as e:
                    refusals.append(f"{slug}: surfaces: {raw} is not a surface token ({e}): write one of "
                                    f"{TOKEN_FORMS}")
        root_src, root_adds, derived = None, [], False
        if not declared:
            # Derived claims: a reach path in a checkout names only that checkout (works); the vault root narrows below;
            # Work/Tasks paths and the ledgers are bookkeeping, dropped with no WARN (ADR 0059, ADR 0067 d5).
            places = [(tok, key, tw, reach, f"its ## Launch {via or 'path'} {path}")
                      for path, via, reach, tok, key, tw in launch_named]
            if proj_names:
                pname = proj_names[0]
                places += [locate(loc, slug, vault_real, git) + (True, f"its project [[{pname}]]'s Local: {loc}")
                           for loc in LOCAL_RE.findall(projects.read(pname)[1])]
            if folder:
                places.append(locate(folder, slug, vault_real, git) + (True, f"its launch folder {folder} ({alias})"))
            for t, key, tw, reach, label in places:
                if reach and key is not None:
                    reach_tops.append(key)
                    continue
                if bookkeeping(t):
                    continue
                cw.extend(tw)
                if t == ("vault", ""):
                    root_src = root_src or label
                else:
                    tokens.append(t)
                    derived = True
            # `touches:`: predicted file tokens; a relative item is keyed to the one checkout the member works by its
            # launch and ## Launch (before its touches: add any), an absolute one claimed.
            rels, tops = [], works_of(tokens, reach_tops, git)
            for item in note.get_list("touches"):
                v = rr._scalar(item).strip()
                if not v:
                    continue
                if v.startswith(("/", "~")):
                    t, _key, tw = locate(v, slug, vault_real, git)
                    if bookkeeping(t):
                        continue
                    cw.extend(tw)
                    if t == ("vault", ""):
                        root_src = root_src or f"its touches: {v}"
                    else:
                        tokens.append(t)
                        derived = True
                else:
                    rels.append(v)
            if rels:
                if len(tops) == 1:
                    for v in rels:
                        mark = "/" if v.endswith("/") or os.path.isdir(os.path.join(tops[0], v)) else ""
                        try:
                            t = parse_token(f"repo:{tops[0]}//{v.rstrip('/')}{mark}")
                        except ValueError as e:
                            cw.append(f"WARN: {slug}: its touches: {v} is not a path in {tops[0]} ({e}): not claimed")
                            continue
                        if t[0] == "repo" and repo_parts(t[1])[1] is not None and not bookkeeping(t):
                            tokens.append(t)
                            derived = True
                else:
                    cw.append(f"WARN: {slug}: its touches: {', '.join(rels)} name paths in a checkout, and it works "
                              f"{len(tops)} checkouts ({', '.join(tops) or 'none'}): not claimed; declare `surfaces:` "
                              "for the files it writes")
        for raw in adds.get(slug.lower(), []):
            t = added_token(raw)
            if t[0] == "path":
                tw = []
                t = claim(t[1], slug, vault_real, git, tw)
                if t == ("vault", ""):
                    root_adds.append(raw)
                    continue
                if bookkeeping(t):
                    if t[0] == "vault":
                        cw.append(f"WARN: {slug}: --surface {raw} is under Work/Tasks: task and rollout notes are "
                                  "bookkeeping, never a claim (ADR 0059); pass the token `vault:Work/Tasks/...` to "
                                  "claim one on purpose")
                    else:
                        cw.append(f"WARN: {slug}: --surface {raw} is a ledger every run appends to (the Run record "
                                  "or a review ledger): bookkeeping, never a claim (ADR 0067 d5); declare it in the "
                                  "task's `surfaces:` to claim it on purpose")
                    continue
                cw.extend(tw)
            tokens.append(t)
            added.append(fmt_token(t))
        narrowed, reach_only = False, bool(reach_tops) and not tokens and not root_src and not root_adds
        if reach_only:
            # It writes a checkout, not the vault: it claims only its own task note, so its Queue cell is never empty.
            tokens.append(parse_token("vault:" + notes[slug].path.relative_to(vault).as_posix()))
            reached = ", ".join(sorted(set(reach_tops), key=str.casefold))
            cw.append(f"WARN: {slug}: names no file in {reached}: it predicts nothing there, so it orders against no "
                      "chain's files (ADR 0067 d4); declare `surfaces:` for the files it writes")
        elif root_src or root_adds or not tokens:
            ppath = projects.find(proj_names[0]) if proj_names else None
            if ppath is not None:
                tokens.extend(project_claim(vault, ppath, notes[slug].path))
                narrowed = True
                for raw in root_adds:
                    cw.append(f"WARN: {slug}: --surface {raw} is the vault root: it claims its first project's place "
                              "and its own task note instead; pass the vault path it writes, or the token `vault` to "
                              "claim the whole vault")
            else:
                if proj_names:
                    cw.append(f"WARN: {slug}: its first project [[{proj_names[0]}]] has no note under Work/Projects: "
                              "its vault claim cannot narrow to it")
                if root_src or root_adds:
                    tokens.append(("vault", ""))
                    cw.append(f"WARN: {slug}: {root_src or f'--surface {root_adds[0]}'} is the vault root and it "
                              "names no project: it claims the whole vault; link its project in `projects:` or "
                              "declare `surfaces:` for what it writes")
                else:
                    tokens.append(("vault", ""))
                    cw.append(f"WARN: {slug}: no surface declared or derived: it claims only the vault; declare "
                              "`surfaces:` for any repo or external system it writes")
        source = ("declared" if declared else "derived" if derived or added or root_src or root_adds or narrowed
                  or reach_only else "default")
        warns.extend(cw)
        canon = sorted({fmt_token(t) for t in tokens})
        # A code row's Leg finishes only commits in its own checkout, so it never opens outside the one it writes
        # (ADR 0059 d4); the refusal waits for ruling (c), which sends a session-lane member away unrefused. `works`:
        # the checkouts its tokens name and those it reaches; a bare token in no checkout is the path-only fallback.
        works = works_of([parse_token(t) for t in canon], reach_tops, git)
        pathonly = [v for k, v in (parse_token(t) for t in canon)
                    if k == "repo" and repo_parts(v)[1] is None and v.casefold() not in {w.casefold() for w in works}]
        pending = None
        if not alias:
            if len(works) == 1:
                folder = works[0]
            elif works:
                folder = vault_real
                pending = (f"{slug}: it writes the checkouts {', '.join(works)} and has no launch alias: leg.py "
                           "done finishes only commits in the Leg's own checkout, so give it a `launch:` whose folder "
                           "is in the checkout it commits to, split it into one task per checkout chained by "
                           "`depends-on:`, or declare `surfaces:` without a checkout it only reads")
            else:
                folder = pathonly[0] if len(pathonly) == 1 else vault_real
        elif folder and works and in_vault(folder, vault_real):
            which = f"checkout {works[0]}" if len(works) == 1 else f"checkouts {', '.join(works)}"
            pending = (f"{slug}: its launch {alias} opens in {folder}, inside the vault, but it writes the {which}: "
                       "leg.py done finishes only commits in the Leg's own checkout, so give it a `launch:` whose "
                       "folder is in that checkout, split it into one task per checkout chained by `depends-on:`, or "
                       "declare `surfaces:` without a checkout it only reads")
        launch = {"alias": alias or "claude", "folder": folder}

        # Ruling (c): no serial self-rollouts. A reach path is a source of its own: it leaves no token behind.
        sources = []
        for p, via, reach, _tok, key, _tw in launch_named:
            if via:
                sources.append((f"its ## Launch {via} {p}", os.path.expanduser(p)))
            elif reach and key is not None:
                sources.append((f"its ## Launch path {p}", key))
        sources += [(f"its surface {t}", checkout_of(t)[1]) for t in canon if t.startswith("repo:")]
        if alias and folder:
            sources.append((f"its launch folder {folder} ({alias})", folder))
        for pname in proj_names:
            pnote, text = projects.read(pname)
            for loc in LOCAL_RE.findall(text):
                sources.append((f"its project [[{pname}]]'s Local: {loc}", os.path.expanduser(loc.strip())))
            if pnote is not None:
                for r in pnote.get_list("repos"):
                    sources.append((f"its project [[{pname}]]'s repos: {r}", os.path.expanduser(rr._scalar(r))))
        lane = next((f"{label} is a checkout of {porigin}" for label, d in sources
                     if os.path.isdir(d) and git.origin(d) == porigin), None)
        deps = list(rr._dep_entries(note)) + extra_deps.get(slug.lower(), [])
        info[slug] = {"surfaces": canon, "source": source, "added": sorted(set(added)), "launch": launch,
                      "works": works, "deps": deps}
        if lane:
            session.append({"slug": slug, "why": lane})
        elif pending:
            refusals.append(pending)

    lane_slugs = {s["slug"] for s in session}
    chained = [s for s in notes if s not in lane_slugs]
    # Union-find over surface overlap and in-set dependency edges.
    parent = {s: s for s in chained}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i, a in enumerate(chained):
        for b in chained[i + 1:]:
            if overlap_pairs(info[a]["surfaces"], info[b]["surfaces"], git.checkout):
                union(a, b)
    in_deps, ext = {}, {}
    for s in chained:
        in_deps[s], ext[s] = [], []
        for d in info[s]["deps"]:
            k = by_key.get(d.lower())
            if k and k in parent and k != s:
                in_deps[s].append(k)
                union(s, k)
            elif k != s:
                ext[s].append({"task": s, "dependsOn": k or d})
    comps = {}
    for s in chained:
        comps.setdefault(find(s), []).append(s)
    launch_of = {s: (info[s]["launch"]["alias"], info[s]["launch"]["folder"]) for s in chained}
    chains = []
    for members in comps.values():
        rows, cycle = order_chain(members, in_deps, launch_of)
        if cycle:
            refusals.append("dependency cycle among " + ", ".join(f"[[{m}]]" for m in cycle) + ": break it in "
                            "their `depends-on:` / `blocked-by:` (or drop the --dep), then re-run")
            continue
        chains.append({
            "tasks": rows,
            "surfaces": sorted({t for m in rows for t in info[m]["surfaces"]}),
            "checkouts": checkouts_of(sorted({t for m in rows for t in info[m]["surfaces"]}),
                                      [info[m]["launch"]["folder"] for m in rows], git.toplevel, vault_real),
            "members": {m: {k: info[m][k] for k in ("surfaces", "source", "added", "launch", "works")} for m in rows},
            "externalDeps": [e for m in rows for e in ext[m]],
        })
    if refusals:
        for r in refusals:
            print(f"REFUSE: {r}", file=sys.stderr)
        return 3
    if lf is None and not any(info[s]["launch"]["alias"] != "claude" for s in info):
        warns.append(f"WARN: {lf_path} is missing or unreadable ({lf_err}): no member names a launch alias, so "
                     "none needs it")
    chains.sort(key=lambda c: (phase_key(c["tasks"][0]), c["tasks"][0].lower()))
    out = {"chains": chains, "sessionLane": session, "warns": list(dict.fromkeys(warns))}
    print(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return 0


def main() -> int:
    p = Parser(prog="serial-chains.py", description="A serial set's chains, surfaces and launches (schedule "
                                                    "§ Serial path, ADR 0040).")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("plan", help="print the chains, the session-lane members and the WARNs as one JSON line")
    c.add_argument("--tasks", default=None, help="comma-separated task slugs: the serial-shaped members")
    c.add_argument("--surface", action="append", default=None,
                   help="<slug>=<path or token>: a surface added for that member (repeatable; always unions in)")
    c.add_argument("--dep", action="append", default=None,
                   help="<slug>=<slug>: the first depends on the second (a dependency confirmed at S4; repeatable)")
    c.add_argument("--vault", default=DEFAULT_VAULT, help="the vault root (tasks at Work/Tasks, projects under "
                                                          "Work/Projects)")
    c.add_argument("--launch-folders", default=DEFAULT_LAUNCH_FOLDERS, help="the launch-folders JSON")
    args = p.parse_args()
    return cmd_plan(args)


if __name__ == "__main__":
    sys.exit(main())
