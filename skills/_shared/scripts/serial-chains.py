#!/usr/bin/env python3
"""serial-chains.py — schedule § Serial path's plan: a serial set's chains, surfaces and launches (ADR 0040).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/serial-chains.py plan --tasks <a,b,...>
        [--surface <slug>=<raw>]... [--dep <slug>=<slug>]... [--vault <dir>] [--launch-folders <json>]

/thread:schedule § Serial path runs it at S2 (and again at S4 after a confirmed dependency or an added surface).
Stdlib only, python >= 3.9. No network, and it writes nothing. Git runs only as `git rev-parse --local-env-vars`
(to scrub repo-local env vars such as a hook's GIT_DIR, landing-register.py's rule), `git -C <dir> rev-parse
--show-toplevel` and `git -C <dir> remote get-url origin`, each read-only with a 30 s timeout. It reads the task
notes (`<vault>/Work/Tasks`, root first, then Archive/), their project notes (`<vault>/Work/Projects/**`), the
launch-folders file and its own tree's `.claude-plugin/plugin.json`; it never reads a launcher marker. Defaults:
--vault ~/repos/obsidian, --launch-folders ~/repos/workspaces/_shared/state/launch-folders.json.

Surfaces (CONTEXT.md **Surface**). A surface is a place a chain writes, as a canonical token of one of five kinds:
  repo:<absolute path>  a filesystem place: overlaps on equality or containment at a `/` boundary, case-folded
                        (APFS); two checkouts of one origin are disjoint (the rollout clone is its own checkout).
  vault:<path>          a path relative to the vault root: overlaps on a case-folded prefix at a segment boundary.
  vault                 the whole vault: overlaps every vault token.
  ext:<name>            an external system (CMS, DNS zone, console): overlaps on case-folded equality.
  any                   the unknown: overlaps every token of every kind.
Kinds never overlap one another, save `any`. A task's own note and the chain's note are never surfaces.

How a path becomes a token (claim; the same for a declared `repo:` path, a `## Launch` path, a project's `Local:`,
a launch folder and a --surface path):
  1. `~` expanded; the path must be absolute. The realpath of its nearest existing ancestor, with the rest appended
     and normalised; a path that does not exist yet is claimed through that ancestor, with a WARN naming it.
  2. At or under the vault root's realpath: `vault` (the root itself) or `vault:<rel>`. The vault is a note space,
     not a checkout, for ADR 0040's ownership ruling: every chain writes its own task notes there.
  3. Inside a git checkout (`git -C <nearest existing directory> rev-parse --show-toplevel`): `repo:<realpath of
     the toplevel>`. Its index and HEAD are what Legs share, so a claim anywhere in a checkout owns all of it,
     declared or derived.
  4. Otherwise `repo:<realpath>`, path-only, with a WARN that it covers everything beneath it.

Each member's surfaces:
  1. Declared: a non-empty frontmatter `surfaces:` list (an empty one reads as absent), one token per block-list
     item, never split on commas (read_surfaces). A `repo:` value may be written with `~/` and goes through claim, so
     it widens inside a checkout; `vault`, `vault:<rel>`, `ext:<name>` and `any` are kept, normalised by parse_token.
     The declaration is the member's whole claim before additions: it replaces derivation.
  2. Derived (no declaration): every backticked path span in its `## Launch` outside a **Read...** or **MCP** item
     (a span that starts `~/` or `/`, holds no whitespace or `:`, and, `/`-rooted, has two segments or more, so
     `/seo:impact`, `/morning` and alias spans are skipped); every launch-command path there (below); each
     `` Local: `<path>` `` in the body of its first project note (the first `projects:` wikilink's); and its
     launch folder, for a member with an alias.
  3. Added: each `--surface <slug>=<raw>` unions in, declared member or not (a path or `repo:` value through claim,
     any other token through parse_token), and is listed in the member's `added`.
  4. Default (nothing from 1-3): `vault`, with a WARN to declare `surfaces:`.
`source` is `declared` (1 non-empty), else `derived` (2 or 3 gave a token), else `default`. The guarantee: a
member claims its launch folder, each path its `## Launch` names (its launch commands' `--add-dir` and `cd` paths
among them), each `Local:` path of its first project and each surface added for it, or exactly what it declares.
It never claims its launch profile's other Working roots (a workspace launcher's `add_dirs`), another project's
`Local:`, a project's `repos:` entries, nor a repo or external system it writes but names nowhere: those are
outside schedule's sight.

Launch-command paths. In `## Launch`, outside a **Read...** or **MCP** item, each line of a fenced block (a `\`
line end continues it) and each backticked span that is not a path span is read as shell: quotes stripped, `#`
starts a comment, and `&&`, `||`, `;`, `|` and `&` start a new command. A command's path is the argument of
each `--add-dir <path>` (with any further path spans after it: the flag takes several) or `--add-dir=<path>`,
and of a `cd <path>` that starts the command, where a path starts `/`, `~/` or `$HOME/` (`${HOME}/`). Any other
path in a fenced block is not claimed: a fence holds commands, and a path a command only reads is no surface.

Launch, per member. Alias: the task's `launch:`, else the `launch:` of its first project note (the `projects:`
wikilink's file under `<vault>/Work/Projects/**`, a match outside Archive/ first). Folder: `by_alias[alias]`, else
`plain_aliases[alias]`. A member with no alias (or `claude`) opens with `claude` from its one `repo:` surface when
it has exactly one, else from the vault root. Each row keeps its own launch: a launch change between two rows is a
Leg boundary (ADR 0040).

Ruling (c), no serial self-rollouts: plugin.json's `repository`, normalised (norm_origin), against the origin of
each launch-command path in a member's `## Launch` (declared member or not), each of its `repo:` checkouts, its
launch folder, every `` Local: `<path>` `` in its project notes' bodies and their `repos:` entries. A match sends
the member to `sessionLane`, with a `why` naming the source (the first match, in that order).

Grouping: connected components over surface overlap, plus `depends-on:` / `blocked-by:` / --dep edges inside the
set. Each chain is ordered topologically (Kahn's); among the ready tasks the next row is the lowest phase N of
`-p<N>-<M>` (a slug without it sorts after every numbered one), then one whose launch equals the previous row's,
then the lowest M, then the slug. A dependency outside the set (or on a session-lane member) is listed in the
chain's `externalDeps`.

Output: one JSON line on stdout, exit 0, nothing on stderr:
  {"chains": [{"tasks": [...], "surfaces": [...], "members": {slug: {"surfaces": [...], "source": ...,
   "added": [...], "launch": {"alias": ..., "folder": ...}}}, "externalDeps": [{"task": ..., "dependsOn": ...}]}],
   "sessionLane": [{"slug": ..., "why": ...}], "warns": ["WARN: ...", ...]}
Exit 3 prints no stdout and one `REFUSE:` line per refusal, with its remedy: an alias in neither map, an alias with
a null folder, a launch folder that is missing, a launch-folders file missing or unreadable while an alias needs it
(an unreadable file no alias needs is only a WARN), a dependency cycle, a malformed declared token. Exit 2 prints
one `serial-chains:` line: no --tasks, a task note not found, a malformed --surface or --dep, reconcile-rollout.py
unloadable, or plugin.json unreadable (ruling (c) cannot be checked, so the plan fails closed).

The pure helpers (parse_token, fmt_token, overlaps, overlap_pairs, read_surfaces, norm_origin) touch neither the
filesystem nor git; unfinished-rollout.py imports them. claim and the ruling-(c) origin read are the only code that
runs git, and neither is exported. Importing this file has no side effects.
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
RR_NAMES = ("Note", "_scalar", "_wikilink_slug", "_dep_entries")
DEFAULT_VAULT = "~/repos/obsidian"
DEFAULT_LAUNCH_FOLDERS = "~/repos/workspaces/_shared/state/launch-folders.json"
GITHUB_PREFIXES = ("https://github.com/", "git@github.com:", "ssh://git@github.com/")
KINDS = ("repo", "vault", "ext")
TOKEN_FORMS = "repo:<absolute path>, vault, vault:<path in the vault>, ext:<name> or any"


# ---- the surface grammar (pure) -----------------------------------------------------------------

def parse_token(s):
    """A surface token's syntax check: (kind, value) in canonical form, or ValueError. `any` and `vault` carry ''.
    A `repo:` value is absolute with no `~`; a `vault:` value is relative, with no `..` and no leading `/`; an
    `ext:` name is non-empty; a trailing `/` is dropped. The kind is case-folded; the value keeps its case."""
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
        if not value.startswith("/"):
            raise ValueError("a repo: path is absolute (no ~ and no relative path)")
        return ("repo", re.sub(r"^/+", "/", posixpath.normpath(value)))
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


def _within(x: str, y: str) -> bool:
    return x == y or x.startswith(y + "/") or y.startswith(x + "/")


def overlaps(a, b) -> bool:
    """Whether two tokens (strings or (kind, value) pairs) name a shared place, by the rules in the header."""
    (ka, va), (kb, vb) = _tok(a), _tok(b)
    if ka == "any" or kb == "any":
        return True
    if ka != kb:
        return False
    x, y = va.casefold(), vb.casefold()
    if ka == "ext":
        return x == y
    if ka == "vault":
        return not x or not y or _within(x, y)
    return x == "/" or y == "/" or _within(x, y)


def overlap_pairs(A, B):
    """Every (a, b) with a from A and b from B that overlap, in order."""
    return [(a, b) for a in A for b in B if overlaps(a, b)]


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
    """A note's `surfaces:` as raw token strings, [] when absent or empty. A block list gives one token per `- `
    item (quotes stripped, never split on commas); an inline `[...]` list is split only on commas outside quotes; a
    lone scalar is one token. (reconcile-rollout.py's get_list splits on every comma, so it cannot read these.)"""
    lines = note._fm
    for i, line in enumerate(lines):
        m = re.match(r"^surfaces:(.*)$", line)
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
    return []


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


# ---- git (claim and the ruling-(c) read only) -------------------------------------------------------

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
        self._top, self._origin = {}, {}

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

    def origin(self, d):
        if d not in self._origin:
            url = self._run(d, "remote", "get-url", "origin") if os.path.isdir(d) else None
            self._origin[d] = norm_origin(url) if url else None
        return self._origin[d]


def claim(raw, who, vault_real, git, warns):
    """A path as a token, by the header's four steps; WARNs go to `warns`, prefixed with `who`."""
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
    if rest:
        warns.append(f"WARN: {who}: {raw} does not exist yet: claimed through its nearest existing ancestor {real}")
    vf, ff = vault_real.casefold(), full.casefold()
    if ff == vf:
        return ("vault", "")
    if ff.startswith(vf + "/"):
        return ("vault", full[len(vault_real) + 1:])
    d = real if os.path.isdir(real) else os.path.dirname(real)
    top = git.toplevel(d)
    if top:
        return ("repo", top)
    warns.append(f"WARN: {who}: {full} is in no git checkout: repo:{full} covers everything beneath it "
                 "(a declared `surfaces:` can narrow it)")
    return ("repo", full)


# ---- reading the notes ---------------------------------------------------------------------------

FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
SPAN_RE = re.compile(r"`([^`\n]+)`")
LIST_ITEM_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$")
SKIP_LABEL_RE = re.compile(r"^[*_\s]*(?:read\w*|mcp)\b", re.I)
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
    """(path, via) for each path a `## Launch` body names, outside a **Read...** or **MCP** item (a list item, an
    unindented line or an unindented fence starts an item; an indented line continues it; a blank line outside a
    fence ends it): via is None for a backticked path span, else the launch-command path's flag (`--add-dir` or
    `cd`), read from each fenced line and each backticked span that is not a path span."""
    out, fence, skip, cont = [], False, False, ""
    for line in text.split("\n"):
        if FENCE_RE.match(line):
            if not fence and not line[:1].isspace():
                skip = False
            fence, cont = not fence, ""
            continue
        if fence:
            if skip:
                continue
            if line.rstrip().endswith("\\"):
                cont += line.rstrip()[:-1] + " "
                continue
            out.extend(command_paths(cont + line))
            cont = ""
            continue
        if not line.strip():
            skip = False
            continue
        m = LIST_ITEM_RE.match(line)
        if m:
            skip = bool(SKIP_LABEL_RE.match(m.group(2)))
        elif not line[:1].isspace():
            skip = bool(SKIP_LABEL_RE.match(line))
        if not skip:
            for s in SPAN_RE.findall(line):
                out.extend([(s, None)] if is_path_span(s) else command_paths(s))
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
        launch_named = launch_paths(note.section_text("## Launch"))
        declared = read_surfaces(note)
        tokens, added = [], []
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
        else:
            for path, _ in launch_named:
                tokens.append(claim(path, slug, vault_real, git, cw))
            if proj_names:
                for loc in LOCAL_RE.findall(projects.read(proj_names[0])[1]):
                    tokens.append(claim(loc, slug, vault_real, git, cw))
            if folder:
                tokens.append(claim(folder, slug, vault_real, git, cw))
        for raw in adds.get(slug.lower(), []):
            t = added_token(raw)
            t = claim(t[1], slug, vault_real, git, cw) if t[0] == "path" else t
            tokens.append(t)
            added.append(fmt_token(t))
        source = "declared" if declared else ("derived" if tokens else "default")
        if not tokens:
            tokens = [("vault", "")]
            cw.append(f"WARN: {slug}: no surface declared or derived: it claims only the vault; declare `surfaces:` "
                      "for any repo or external system it writes")
        warns.extend(cw)
        canon = sorted({fmt_token(t) for t in tokens})
        if not alias:
            repos = [v for k, v in (parse_token(t) for t in canon) if k == "repo"]
            folder = repos[0] if len(repos) == 1 else vault_real
        launch = {"alias": alias or "claude", "folder": folder}

        # Ruling (c): no serial self-rollouts.
        sources = [(f"its ## Launch {via} {p}", os.path.expanduser(p)) for p, via in launch_named if via]
        sources += [(f"its surface {t}", parse_token(t)[1]) for t in canon if t.startswith("repo:")]
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
                      "deps": deps}
        if lane:
            session.append({"slug": slug, "why": lane})

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
            if overlap_pairs(info[a]["surfaces"], info[b]["surfaces"]):
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
            "members": {m: {k: info[m][k] for k in ("surfaces", "source", "added", "launch")} for m in rows},
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
