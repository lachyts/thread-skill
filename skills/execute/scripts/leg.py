#!/usr/bin/env python3
"""leg.py — a serial rollout's Leg bookkeeping (ADR 0040; skills/execute/legs.md is its one caller's protocol).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py <verb> --rollout <note> [common flags] [verb flags]

A serial rollout (`shape: serial`) runs as a chain of Legs: visible sessions that each work tasks themselves, close
and hand the rest to a fresh successor. This helper does every vault and git write a Leg makes, so a Leg never
hand-edits frontmatter. Stdlib only, python >= 3.9, POSIX (fcntl). It loads reconcile-rollout.py as a module (Note,
_scan, _queue_state, _dep_status, incomplete, _stamp, PHASED_STEM_RE, _norm_gate, _fm_block), as serial-chains.py
and unfinished-rollout.py do, and serial-chains.py for norm_origin.

Common flags: --rollout <path, or a slug under --tasks-dir> · --tasks-dir (default <vault>/Work/Tasks) · --vault
(default the tasks dir's grandparent when --tasks-dir is given, else ~/repos/obsidian) · --now <ISO> (stamps; the
clock otherwise) · --session <id> (default CLAUDE_CODE_SESSION_ID, then CODEX_THREAD_ID, else `unknown`) ·
--harness claude|codex (default: codex under CODEX_THREAD_ID alone, else claude) · --dry-run (compute and print,
write nothing, take no lock).

Output: one JSON line on stdout for every exit but a usage error. Exit codes: 0 ok · 1 refusal (nothing written) ·
2 usage (stdout empty, one `leg:` line on stderr) · 3 a stand (an unclosed Leg of another session, a standing halt,
a revert that would conflict or a dirty path to revert; nothing written) · 4 wrong launch (nothing written) · 5 the
rollout's lock was held past its timeout (nothing written). A refusal's JSON carries `exit`, `error` and, from
begin, the `status_line` its turn ends on. Every git call runs with git's repo-local env vars removed (`git rev-parse
--local-env-vars`), so an exported GIT_DIR never redirects it.

The Queue. Each `## Queue` table row is `| <n> | [[<slug>\\|<alias>]] | `<launch alias>` from `<folder>` |
<surfaces> |` (schedule § S5). A row whose task note exists but no longer names this rollout in `rollout:` was
deferred out of the chain: skipped and not counted. A row whose note is missing is held `note not found`. K is the
done rows, fix rows included; N every counted row.

Verbs (writing verbs: begin, claim, smoke, file-fix, done, set-aside, file-followup, close, handed, clear-halt):
  begin [--cwd <dir>] [--take-over | --resume <N>]
      Refuses (exit 1): a note not found, a non-serial note, an incomplete note (`incomplete: true`, or
      reconcile-rollout.py's incomplete), a dropped or superseded note, a done note, a `paused:` or
      `pause_requested:` stamp (`a serial note is never paused: delete its paused: (and pause_requested:) line, then
      /thread:execute [[<slug>]]`), and a cwd whose checkout's origin is this plugin's own repo (plugin.json's
      repository, norm_origin). A standing halt (the last `closed: halted:` line has no `halt cleared:` line after
      it) is exit 3. An unclosed Leg K: this session's own (its latest began or resumed session id, never `unknown`)
      resumes silently and writes nothing; `--resume K` logs `resumed` (another K is exit 1); `--take-over` closes K
      `lost` and begins K+1 that inherits K's claim; anything else is exit 3 naming K, `--resume K` and `--take-over`.
      Otherwise Leg N (the last + 1) begins, after the launch check: the cwd's realpath, case-folded, must be the
      folder of the first row the Leg must work (an inherited claim, else the first fix task, else the first
      claimable row), and a `cx-*` alias needs codex (any other, claude); a mismatch is exit 4 with the row's launch
      line and the Leg prompt, nothing written. A resume skips the check. Prints the Leg, its inherited tasks, its
      smoke list (every task the previous Leg stamped done, `leg: N-1`; every done task a not-done fix names in
      `verifies:`; every task whose latest smoke result is `fail` with no fix filed since; each with its
      `**Verify:**` line or null), the not-done fix tasks, the required MCP namespaces of this launch's unlanded rows
      (their `## Launch` `**MCP:** required …` items), `next` and `progress`.
  next                                       (read-only, no lock)
      The Leg's next act: `finish` (a task this Leg owns, or an inherited claim of a closed Leg: `inherit: true`),
      else `handoff` at five fresh claims (`claimed` lines; an inherited `took` never counts), else `claim` of the
      first claimable fix task (`verifies:`), else of the first claimable row in Queue order (status open, or
      in_progress with no owner: a hand-back's or a sign-off's re-entry), else `complete` (every counted row done),
      else `stuck`. A claimable row in another launch than the Leg's is a Leg boundary: `handoff`. A row whose
      dependency (depends-on/blocked-by) is not done is held `depends on [[d]] (<why>)`, and one whose done
      dependency has a not-done fix is held `depends on [[d]] (awaiting fix [[f]])`.
  claim --task <t> [--inherit] [--gate <gate>]...
      Re-runs next under the lock: <t> must be what it proposes (with --inherit, an inherited `finish`). Stamps
      `status: in_progress`, `owner: leg-N`, `leg: N`, `started:` (the first wins), consumes `handed_back:` and
      `gates_signed:`, and on a fresh claim `leg_base: ["<toplevel>@<sha40>", …]`: one entry per `repo:` surface of
      the row that is a git toplevel, the vault never (an inherited claim keeps its stamp). Logs `claimed` or `took`.
      Each --gate is compared with the note's `## Approved gates` (reconcile-rollout.py's _norm_gate): the
      unapproved ones are printed for `set-aside --kind gate`.
  change --task <t> [--top <toplevel>]       (read-only, no lock)
      Per `leg_base` checkout: the commits in `<sha>..HEAD` whose message has a `Task: [[<t>]]` line, their paths
      minus `docs/reviews/`, the `:(literal)` pathspecs, and a WARN per commit in the range with no `Task:` line at
      all, unless it touches only `docs/reviews/`. `codeWriting` is any such commit.
  smoke --task <t> --result pass|fail|not-run [--why <text>]
      Logs `smoke: [[t]] pass|fail|not run[: <why>]` for a task on this Leg's smoke list.
  file-fix --target <t> --cause own|chain|outside|drift [--culprit <L>] --evidence <line> [--excerpt <text>]
      A done chain task t whose Verify failed gets a fix task: `verifies: "[[t]]"` always; `fixes:` names the
      culprit only for own (`[[t]]`) and chain (`[[L]]`). The cause is checked against git, else exit 1: chain needs
      L a done chain row other than t whose `Task: [[L]]` commits touch one of t's paths in t's checkout; outside
      needs a commit after t's last trailered commit there that touches t's paths and carries no chain task's
      trailer; drift needs t's paths unchanged since t's last trailered commit (working tree included). A task
      with no paths (vault-only) passes own or drift only. The note `<project>-followup-fix-<t's descriptive
      tail>[-<k>]` copies t's `projects:` and `**Verify:**` line, takes this Leg's launch alias and `rollout:`; its
      Queue row (this Leg's launch, t's surfaces) goes ahead of the first queued row and every `#` cell is
      renumbered. Idempotent per `verifies:` target while a not-done fix exists, and a fix note left with no row
      (a crash between the two writes) gets its row and no second note.
  done --task <t> [--verify pass|none] [--review <abs doc>]... [--cwd <dir>]
      Refuses (exit 1) unless t is this Leg's in_progress claim; `--verify pass` when the note has a `**Verify:**`
      line; and, for each `leg_base` checkout with trailered commits, that checkout is the cwd's and a --review doc
      whose front matter has `repo:` that toplevel, `mode: code`, `effort:` xhigh or max, `status: consumed`, and a
      `head:` that descends from the leg_base sha, is an ancestor of HEAD and holds a trailered commit. Stamps
      `status: done`, `completed:`, `leg: N`, `reviewed:` (the docs), keeps `leg_base`; logs `done`.
  set-aside --task <t> --reason <text> [--kind block|gate] [--status blocked|review-blocked|plan-blocked]
            [--revert] [--gate <gate>]...
      Removes `owner:`. gate: `status: gate-pending` and `## Gated inputs (awaiting sign-off)` (no revert). block:
      the status (blocked by default) and a `## Blocker diagnosis` run. --revert reverts each checkout's trailered
      commits: exit 3 first when a path to revert has staged or unstaged changes; the commits are reverted
      newest-first in a scratch `git worktree add --detach` tree; a conflict removes it and exits 3 with the checkout
      untouched (no REVERT_HEAD, CHERRY_PICK_HEAD or sequencer state); success applies the scratch diff with `git
      apply --index` over those paths and commits them by pathspec with `Task: [[t]]` and `Set-aside: <reason>`
      lines. Every scratch tree is removed before the verb returns. The diagnosis and the log name `reverted <sha>
      in <top>`.
  post-items                                 (read-only, no lock)
      The `## Post-rollout` items (the top-level `- ` lines after `Rollout-specific items go here:`), indexed from
      1, each with its pointer (`→ [[f]]`) or null.
  file-followup --title <t> --why <w> [--item <k>]
      A loose open task (follow-on frontmatter: tags, status open, priority, work_depth, projects copied from the
      rollout, contexts, scheduled, due, captured; never rollout:, phase: or owner:), named
      `<project>-followup-<title words>[-<k>]`, and a `## Post-rollout` pointer: item k rewritten, or a new item.
      Logs `follow-on [[f]] (close|post-item <k>)` against the latest Leg, closed or not.
  close --outcome handoff|complete|stuck|stopped|halt [--reason <r>] [--cwd <dir>] [--disposition <k>=<text>]...
        [--log-line <text>]... [--also <path>]...
      Refuses handoff, complete and stuck while this Leg owns an in_progress task (stopped and halt leave it claimed
      for the next Leg), handoff with nothing to hand over, and complete unless every counted row is done. Writes the
      close line and prints `progress`, `commit_only` (the cwd's toplevel and every chain checkout: each `leg_base`
      top), `needs_you`, `handover` {title, prompt, tldr, cwd, harness} (handoff only) and `status_line` (every
      outcome but handoff). complete refuses first an Archive name collision and a Post-rollout item with neither a
      pointer nor a --disposition; before the lock it asks land.sh's own route for each chain checkout (`land.sh
      --route -- <top>`, 60 s): on `landable <d>` it lists the chain's `Task:`-trailered commits that the local
      `refs/remotes/origin/<d>` lacks (no fetch) and, when there are any, files
      `<project>-followup-land-chain-<YYYY-MM-DD>[-<k>]` (act: open a PR from them, or push them; ADR 0028 automates
      only close-out commits); on `not landed: <reason>` it files nothing; on `stuck: <reason>`, a failure or a
      timeout it files the follow-on with every chain commit there and the act prefixed `check the landing route
      (<reason>), then`. Then `status: done`, `completed:`, a `## Completion log` (a line per Leg: launch, begun–closed,
      done and set aside; each --log-line; `Post-rollout items:` with each disposition; a `Chain commits:` line per
      checkout or `Chain commits: none`; `Reflection: not scored (serial; p24-4)`), the move to
      `Archive/Rollouts/` (a git move when `git ls-files --error-unmatch` finds the note, else a rename), and one
      vault commit by pathspec (the archived note,
      the follow-ons this Leg filed, each --also path, the old path when tracked). A failed commit is
      `committed: false`, exit 0: the daily sweep commits it.
  handed --started <id> | --manual <why>
      Logs `hand-over: started <id>` or `hand-over: manual (<why>)` on this session's Leg closed with a handoff, and
      prints its status line. Idempotent once logged.
  clear-halt --reason <r>
      Logs `halt cleared: <r>` when a halt stands (else exit 1); the halted claim is then inherited by the next Leg.

The Leg log (`## Leg log`, at the note's end: below `## Queue` and `## Post-rollout`, so a queue reader never ranks
it). Its line forms are stable (p24-4 reads them); readers key them by Leg number, never by position:
  - <stamp> Leg <N> began: leg-<N> session <id|unknown> in <alias> from <folder>[; took over from Leg <K>]
  - <stamp> Leg <N> resumed: session <id>
  - <stamp> Leg <N> smoke: [[t]] pass|fail|not run[: <why>]
  - <stamp> Leg <N> filed [[f]] (verifies [[t]]; cause own|chain [[L]]|outside|drift)
  - <stamp> Leg <N> claimed [[t]]
  - <stamp> Leg <N> took [[t]] (inherited from Leg <K>)
  - <stamp> Leg <N> done [[t]] (verify pass|none[; reviewed <doc>])
  - <stamp> Leg <N> set aside [[t]] (<status>): <reason>
  - <stamp> Leg <N> reverted <sha> in <top>
  - <stamp> Leg <N> closed: handoff to Leg <N+1> in <alias> from <folder> | chain complete | chain stuck: <k> set
    aside | stopped: <reason> | halted: <reason> | lost (taken over by Leg <M>)
  - <stamp> Leg <N> hand-over: started <id> | manual (<why>)
  - <stamp> Leg <N> follow-on [[f]] (close|post-item <k>|land)
  - <stamp> halt cleared: <reason>

The status mapping (legs.md § Report): every Leg turn ends `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R>
state=<state>[ reason="…"]`, R 1 while this Leg owns an in_progress task. It is never `running`: handed --started
`done reason="handed off to Leg <N+1>"`; handed --manual `halted reason="manual handoff: Leg <N+1> in <alias> from
<folder>"`; complete `done`; stuck `halted reason="awaiting you: <k> set aside"`; stopped `halted reason="stopped:
<r>"`; halt `halted reason="halt: <r>"`; a refused begin `halted reason="<refusal>"`.

The lock. Every writing verb holds an exclusive fcntl.flock on `<lock dir>/<rollout stem>.lock` for its whole run,
git work included: `<lock dir>` is $THREAD_LEG_LOCK_DIR, else ${XDG_STATE_HOME:-~/.local/state}/thread/legs, outside
the vault (the note cannot be the lock: os.replace swaps its inode). Under it each verb re-reads every note it
changes, validates, and writes each through a temp file in the same directory plus os.replace, task notes first and
the rollout note last. A wait past $THREAD_LEG_LOCK_TIMEOUT seconds (default 30) is exit 5. The read-only verbs take
no lock: os.replace means they never read a torn note, and claim re-validates whatever next proposed.
"""
import argparse
import fcntl
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent.parent.parent
RR_SRC = HERE / "reconcile-rollout.py"
SC_SRC = PLUGIN / "skills" / "_shared" / "scripts" / "serial-chains.py"
LAND_SH = PLUGIN / "skills" / "_shared" / "scripts" / "land.sh"
PLUGIN_JSON = PLUGIN / ".claude-plugin" / "plugin.json"
DEFAULT_VAULT = "~/repos/obsidian"

LEG_LOG = "## Leg log"
COMPLETION_LOG = "## Completion log"
POST_ROLLOUT = "## Post-rollout"
QUEUE = "## Queue"
ITEMS_MARK = "Rollout-specific items go here:"
BLOCKER = "## Blocker diagnosis"
GATES_PENDING = "## Gated inputs (awaiting sign-off)"
APPROVED_GATES = "## Approved gates"
CAP = 5
OUTCOMES = ("handoff", "complete", "stuck", "stopped", "halt")
REVIEWS = "docs/reviews/"
SET_ASIDE = {"blocked", "review-blocked", "plan-blocked", "gate-pending"}
LAUNCH_RE = re.compile(r"^`([^`]+)`\s+from\s+`([^`]+)`$")
VERIFY_RE = re.compile(r"^\s*\*\*Verify:\*\*.*$", re.M)
MCP_RE = re.compile(r"\*\*MCP:\*\*\s*required\s+(.*?)(?:;\s*optional\b.*)?$", re.I)
LOG_RE = re.compile(r"^- (?P<stamp>\S+) Leg (?P<n>\d+) (?P<rest>.*)$")
CLEARED_RE = re.compile(r"^- (?P<stamp>\S+) halt cleared: (?P<reason>.*)$")
LINK_RE = re.compile(r"\[\[([^\]|#^\\]+)[^\]]*\]\]")
BEGAN_RE = re.compile(r"^began: leg-(\d+) session (\S+) in (\S+) from (.*?)(?:; took over from Leg (\d+))?$")


class Refuse(Exception):
    def __init__(self, code, msg, **extra):
        super().__init__(msg)
        self.code, self.msg, self.extra = code, msg, extra


class Usage(Exception):
    pass


def _load(name, src):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, src)
    if spec is None or spec.loader is None:
        raise Usage(f"cannot load {src}")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001 — any load failure is the same usage error
        raise Usage(f"cannot load {src}: {e}")
    return mod


rr = None
sc = None


# ---- git, with the repo-local env removed ----------------------------------------------------------------------

_ENV = None


def _env():
    global _ENV
    if _ENV is None:
        env = dict(os.environ)
        try:
            names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                   timeout=30, env={k: v for k, v in env.items() if not k.startswith("GIT_")}).stdout.split()
        except (OSError, subprocess.SubprocessError):
            names = []
        for name in names:
            env.pop(name, None)
        env.setdefault("GIT_TERMINAL_PROMPT", "0")
        _ENV = env
    return _ENV


def git(top, *args, input=None, timeout=120):
    try:
        return subprocess.run(["git", "-C", str(top), *args], env=_env(), capture_output=True, text=True,
                              input=input, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return subprocess.CompletedProcess(args, 99, "", str(e))


def git_out(top, *args):
    r = git(top, *args)
    return r.stdout.strip() if r.returncode == 0 else None


def toplevel(d):
    if not d or not os.path.isdir(d):
        return None
    top = git_out(d, "rev-parse", "--show-toplevel")
    return os.path.realpath(top) if top else None


def is_ancestor(top, a, b):
    return git(top, "merge-base", "--is-ancestor", a, b).returncode == 0


def _fold(p):
    return os.path.realpath(os.path.expanduser(p)).casefold()


# ---- context and output ----------------------------------------------------------------------------------------

class Ctx:
    def __init__(self, args):
        self.args = args
        vault = args.vault
        if vault is None:
            vault = str(Path(os.path.expanduser(args.tasks_dir)).parent.parent) if args.tasks_dir else DEFAULT_VAULT
        self.vault = Path(os.path.expanduser(vault))
        self.tasks = Path(os.path.expanduser(args.tasks_dir)) if args.tasks_dir else self.vault / "Work" / "Tasks"
        raw = args.rollout
        p = Path(os.path.expanduser(raw))
        if not p.exists() and "/" not in raw:
            p = self.tasks / f"{(rr._wikilink_slug(raw) or raw)}.md"
        self.rollout = p
        self.slug = p.stem
        if args.now:
            try:
                now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))
            except ValueError:
                raise Usage(f"--now {args.now!r} is not an ISO time")
            self.now = now if now.tzinfo else now.astimezone()
        else:
            self.now = datetime.now().astimezone()
        self.stamp = rr._stamp(self.now)
        self.date = self.now.astimezone().date().isoformat()
        self.session = (args.session or os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CODEX_THREAD_ID")
                        or "unknown").strip() or "unknown"
        if args.harness:
            self.harness = args.harness
        elif os.environ.get("CODEX_THREAD_ID") and not os.environ.get("CLAUDE_CODE_SESSION_ID"):
            self.harness = "codex"
        else:
            self.harness = "claude"
        self.dry = args.dry_run


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


def reason_text(s, cap=110):
    s = re.sub(r"\s+", " ", str(s).replace('"', "'")).strip()
    return s if len(s) <= cap else s[:cap - 1].rstrip() + "…"


def status_line(slug, prog, state, reason=None):
    line = f"ROLLOUT-STATUS: {slug} merged={prog['done']}/{prog['total']} running={prog['running']} state={state}"
    return line + (f' reason="{reason_text(reason, 300)}"' if reason else "")


# ---- the lock and atomic writes --------------------------------------------------------------------------------

class Lock:
    def __init__(self, ctx):
        d = os.environ.get("THREAD_LEG_LOCK_DIR") or os.path.join(
            os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "thread", "legs")
        self.path = os.path.join(os.path.expanduser(d), f"{ctx.slug}.lock")
        self.fd = None
        self.skip = ctx.dry

    def __enter__(self):
        if self.skip:
            return self
        raw = os.environ.get("THREAD_LEG_LOCK_TIMEOUT") or "30"
        try:
            timeout = float(raw)
        except ValueError:
            timeout = 30.0
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.monotonic() >= deadline:
                    os.close(self.fd)
                    self.fd = None
                    raise Refuse(5, f"rollout note locked: another Leg verb held {self.path} past {timeout:g}s; "
                                    "nothing written (retry once, then end the turn halted)")
                time.sleep(0.05)

    def __exit__(self, *exc):
        if self.fd is not None:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
        return False


def atomic_write(path, text):
    path = Path(path)
    tmp = path.with_name(f".{path.name}.leg-{os.getpid()}.tmp")
    try:
        with open(tmp, "w") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def save(ctx, note):
    if ctx.dry or not note.dirty:
        return
    atomic_write(note.path, note.render())
    note.dirty = False


# ---- the chain ---------------------------------------------------------------------------------------------------

def split_cells(line):
    cells, cur, i = [], "", 0
    while i < len(line):
        ch = line[i]
        if ch == "\\" and i + 1 < len(line) and line[i + 1] == "|":
            cur += "\\|"
            i += 2
            continue
        if ch == "|":
            cells.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    cells.append(cur)
    return [c.strip() for c in cells[1:-1]] if line.strip().startswith("|") else []


class Row:
    def __init__(self, i, cells, line_no):
        self.i, self.line_no = i, line_no
        self.cells = cells
        m = LINK_RE.search(cells[1] if len(cells) > 1 else "")
        self.slug = rr._wikilink_slug(m.group(1)) if m else None
        lm = LAUNCH_RE.match(cells[2]) if len(cells) > 2 else None
        self.alias, self.folder = (lm.group(1), lm.group(2)) if lm else (None, None)
        self.surfaces_cell = cells[3] if len(cells) > 3 else ""
        self.surfaces = re.findall(r"`([^`]+)`", self.surfaces_cell)
        self.path = self.note = None
        self.state = None  # done | queued | running | set-aside | missing | deferred | other

    @property
    def launch(self):
        return f"{self.alias} from {self.folder}"

    def same_launch(self, alias, folder):
        return self.alias == alias and _fold(self.folder or "") == _fold(folder or "")


def owner_leg(note):
    m = re.fullmatch(r"leg-(\d+)", rr._scalar(note.get("owner")))
    return int(m.group(1)) if m else None


class Chain:
    def __init__(self, ctx):
        self.ctx = ctx
        if not ctx.rollout.is_file():
            raise Refuse(1, f"rollout note not found at {ctx.rollout}")
        try:
            self.note = rr.Note(ctx.rollout)
        except ValueError as e:
            raise Refuse(1, str(e))
        self.linked, self.index = rr._scan(ctx.rollout, ctx.tasks)
        self.linked_keys = {p.stem.lower(): (p, n) for p, n in self.linked}
        self.rows = self._rows()
        self.log = self._log()
        self.legs = self._legs()

    # -- the Queue --
    def _rows(self):
        found = self.note._section_bounds(QUEUE)
        rows = []
        if found is None:
            return rows
        lines, start, end = found
        for k in range(start + 1, end):
            cells = split_cells(lines[k])
            if len(cells) < 3 or not LINK_RE.search(cells[1]):
                continue
            r = Row(len(rows), cells, k)
            if not r.slug:
                continue
            rows.append(r)
            entry = self.linked_keys.get(r.slug.lower())
            if entry is None:
                other = self.index.get(r.slug.lower())
                r.state = "deferred" if other is not None else "missing"
                if other is not None:
                    r.path, r.note = other
                continue
            r.path, r.note = entry
            st = rr._status(r.note)
            if st == "done":
                r.state = "done"
            elif st in ("", "open"):
                r.state = "queued"
            elif st == "in_progress":
                r.state = "running"
            elif st in SET_ASIDE:
                r.state = "set-aside"
            else:
                r.state = "other"
        return rows

    def counted(self):
        """The rows K/N count: every row but one deferred out of the chain, or folded or dropped (status other)."""
        return [r for r in self.rows if r.state not in ("deferred", "other")]

    def row(self, slug):
        for r in self.rows:
            if r.slug.lower() == slug.lower():
                return r
        return None

    # -- the Leg log --
    def _log(self):
        return parse_log(self.note)

    def _legs(self):
        return parse_legs(self.log)

    def open_leg(self):
        live = [n for n, g in self.legs.items() if g["began"] and g["closed"] is None]
        return self.legs[max(live)] if live else None

    def last_n(self):
        return max(self.legs) if self.legs else 0

    def halt(self):
        """The standing halt's reason, or None: the last `closed: halted:` line with no `halt cleared:` after it."""
        last = None
        for e in self.log:
            if e["kind"] == "closed" and e["rest"].split(":", 1)[1].strip().startswith("halted:"):
                last = e
            elif e["kind"] == "halt cleared":
                last = None
        if last is None:
            return None
        return last["rest"].split(":", 1)[1].strip()[len("halted:"):].strip(), last["n"]

    # -- derived --
    def progress(self, leg_n=None):
        rows = self.counted()
        running = 0
        if leg_n is not None:
            running = int(any(r.state == "running" and owner_leg(r.note) == leg_n for r in rows if r.note))
        return {"done": sum(r.state == "done" for r in rows), "total": len(rows), "running": running}

    def fixes(self):
        """(fix row, its verifies: slug) for every row whose note has `verifies:`."""
        out = []
        for r in self.rows:
            if r.note is not None and r.state != "deferred":
                v = rr._wikilink_slug(rr._scalar(r.note.get("verifies")))
                if v:
                    out.append((r, v))
        return out

    def fix_notes(self):
        """(path, note, verifies) for every linked note with `verifies:`, row or not."""
        out = []
        for p, n in self.linked:
            v = rr._wikilink_slug(rr._scalar(n.get("verifies")))
            if v:
                out.append((p, n, v))
        return out

    def open_fix_for(self, slug):
        for p, n, v in self.fix_notes():
            if v.lower() == slug.lower() and rr._status(n) != "done":
                return p.stem
        return None

    def chain_tops(self):
        tops = []
        for r in self.rows:
            if r.note is None or r.state == "deferred":
                continue
            for top, _sha in leg_base(r.note):
                if top not in tops:
                    tops.append(top)
        vault = os.path.realpath(self.ctx.vault)
        return [t for t in tops if t != vault]


KINDS = ("began:", "resumed:", "smoke:", "filed ", "claimed ", "took ", "done ", "set aside ", "reverted ", "closed:",
         "hand-over:", "follow-on ")


def parse_log(note):
    """The `## Leg log` lines, in write order: {pos, n (None for `halt cleared`), stamp, rest, kind, slug}."""
    found = note._section_bounds(LEG_LOG)
    out = []
    if found is None:
        return out
    lines, start, end = found
    for pos, line in enumerate(lines[start + 1:end]):
        m = LOG_RE.match(line.rstrip())
        if m:
            rest = m.group("rest")
            kind = next((k.rstrip(": ") for k in KINDS if rest.startswith(k)), None)
            if kind is None:
                continue
            lm = LINK_RE.search(rest)
            out.append({"pos": pos, "n": int(m.group("n")), "stamp": m.group("stamp"), "rest": rest, "kind": kind,
                        "slug": rr._wikilink_slug(lm.group(1)) if lm else None})
            continue
        c = CLEARED_RE.match(line.rstrip())
        if c:
            out.append({"pos": pos, "n": None, "stamp": c.group("stamp"), "rest": c.group("reason"),
                        "kind": "halt cleared", "slug": None})
    return out


def parse_legs(log):
    """Leg number -> {n, began, session (the latest began or resumed id), alias, folder, closed, closedStamp,
    handover, tookOver}."""
    legs = {}
    for e in log:
        if e["n"] is None:
            continue
        leg = legs.setdefault(e["n"], {"n": e["n"], "began": None, "session": None, "alias": None, "folder": None,
                                      "closed": None, "closedStamp": None, "handover": None, "tookOver": None})
        if e["kind"] == "began":
            m = BEGAN_RE.match(e["rest"])
            if m:
                leg.update(began=e["stamp"], session=m.group(2), alias=m.group(3), folder=m.group(4),
                           tookOver=int(m.group(5)) if m.group(5) else None)
        elif e["kind"] == "resumed":
            leg["session"] = e["rest"].split("session", 1)[-1].strip()
        elif e["kind"] == "closed":
            leg["closed"] = e["rest"].split(":", 1)[1].strip()
            leg["closedStamp"] = e["stamp"]
        elif e["kind"] == "hand-over":
            leg["handover"] = e["rest"].split(":", 1)[1].strip()
    return legs


def leg_base(note):
    out = []
    for item in note.get_list("leg_base"):
        top, sep, sha = item.rpartition("@")
        if sep and top and re.fullmatch(r"[0-9a-f]{7,40}", sha):
            out.append((top, sha))
    return out


def verify_line(note):
    m = VERIFY_RE.findall(note._body) if note is not None else []
    return m[-1].strip() if m else None


# ---- next ---------------------------------------------------------------------------------------------------------

def plan_next(chain, leg_n, alias, folder, cap=True, launch=True, dead=()):
    """The Leg's next act (the module docstring's `next`). `dead`: Legs to read as closed (a take-over's)."""
    held, aside, inherited = [], [], []
    for r in chain.rows:
        if r.state == "running" and r.note is not None:
            k = owner_leg(r.note)
            if k is not None and leg_n is not None and k == leg_n:
                return {"action": "finish", "task": r.slug, "inherit": False, "row": r}
            g = chain.legs.get(k) if k is not None else None
            if k is not None and (g is None or g["closed"] is not None or k in dead):
                inherited.append(r)
        if r.state == "set-aside":
            aside.append({"slug": r.slug, "status": rr._status(r.note)})
    if inherited:
        r = inherited[0]
        return {"action": "finish", "task": r.slug, "inherit": True, "from": owner_leg(r.note), "row": r,
                "held": held, "setAside": aside}
    claims = sum(1 for e in chain.log if e["n"] == leg_n and e["kind"] == "claimed") if leg_n else 0

    def claimable(r):
        if r.note is None or r.state not in ("queued", "running"):
            return False
        return r.state == "queued" or not rr._valued(r.note.get("owner"))

    def holds(r):
        why = []
        for dep in rr._dep_entries(r.note):
            ok, w = rr._dep_status(dep, chain.index)
            if not ok:
                why.append(f"depends on [[{dep}]] ({w})")
            else:
                f = chain.open_fix_for(dep)
                if f:
                    why.append(f"depends on [[{dep}]] (awaiting fix [[{f}]])")
        return why

    def choose(cands):
        for r in cands:
            if r.state == "missing":
                held.append({"slug": r.slug, "why": "note not found"})
                continue
            if not claimable(r):
                if r.state == "running" and r.note is not None and owner_leg(r.note) is None:
                    held.append({"slug": r.slug, "why": f"in progress ({rr._scalar(r.note.get('owner'))})"})
                continue
            why = holds(r)
            if why:
                held.append({"slug": r.slug, "why": "; ".join(why)})
                continue
            return r
        return None

    fix_rows = [r for r, _v in chain.fixes()]
    pick = choose(fix_rows)
    is_fix = pick is not None
    if pick is None:
        pick = choose([r for r in chain.rows if r not in fix_rows])
    base = {"held": held, "setAside": aside, "claims": claims}
    if pick is not None:
        if cap and leg_n is not None and claims >= CAP:
            return {"action": "handoff", "reason": f"{CAP} fresh claims", "row": pick, **base}
        if launch and alias is not None and not pick.same_launch(alias, folder):
            return {"action": "handoff", "reason": "Leg boundary: the next row opens in another launch", "row": pick,
                    **base}
        return {"action": "claim", "task": pick.slug, "fix": is_fix, "row": pick, **base}
    counted = chain.counted()
    if counted and all(r.state == "done" for r in counted):
        return {"action": "complete", **base}
    return {"action": "stuck", **base}


def next_json(plan):
    out = {k: v for k, v in plan.items() if k != "row"}
    r = plan.get("row")
    if r is not None:
        out["next"] = {"task": r.slug, "alias": r.alias, "folder": r.folder}
    return out


# ---- the log writer -----------------------------------------------------------------------------------------------

def log_line(note, line):
    found = note._section_bounds(LEG_LOG)
    if found is None:
        note.append_section(LEG_LOG, line)
        return
    lines, start, end = found
    filled = [i for i in range(start + 1, end) if lines[i].strip()]
    j = (filled[-1] + 1) if filled else start + 1
    if not filled:
        note._set_body_lines(lines[:start + 1] + ["", line, ""] + lines[end:])
        return
    tail = [""] if j == len(lines) or lines[j].strip() else []
    note._set_body_lines(lines[:j] + [line] + tail + lines[j:])


def leg_line(ctx, n, text):
    return f"- {ctx.stamp} Leg {n} {text}"


# ---- the leg's identity -------------------------------------------------------------------------------------------

def my_leg(ctx, chain, closed_ok=False):
    leg = chain.open_leg()
    if leg is None:
        if closed_ok and chain.legs:
            return chain.legs[chain.last_n()]
        raise Refuse(1, "no Leg has begun (or every Leg is closed): run `leg.py begin` first")
    if ctx.session != "unknown" and leg["session"] not in (None, "unknown") and leg["session"] != ctx.session:
        raise Refuse(1, f"Leg {leg['n']} belongs to session {leg['session']}, not {ctx.session}: "
                        "begin a Leg of your own (`leg.py begin`)")
    return leg


def validate_note(ctx, chain):
    note = chain.note
    if rr._shape(note) != "serial":
        raise Refuse(1, f"{ctx.slug} is not a serial rollout (shape: {rr._scalar(note.get('shape')) or 'parallel'}): "
                        "run it with /thread:execute's queue", reason="not a serial rollout")
    if rr._truthy_flag(note.get("incomplete")):
        raise Refuse(1, f"{ctx.slug} is incomplete (incomplete: true): /thread:schedule never finished it; stamp it "
                        "`status: dropped` to free its tasks", reason="incomplete rollout note")
    why = rr.incomplete(ctx.rollout, note, chain.linked, chain.index)
    if why:
        raise Refuse(1, f"{ctx.slug} is incomplete: {why}", reason="incomplete rollout note")
    st = rr._status(note)
    if st == "dropped" or rr._valued(note.get("superseded_by")):
        word = "dropped" if st == "dropped" else "superseded"
        raise Refuse(1, f"{ctx.slug} is {word}: nothing runs it", reason=f"rollout {word}")
    if st == "done":
        raise Refuse(1, f"{ctx.slug} is done: its chain is complete", reason="chain already complete")
    if rr._valued(note.get("paused")) or rr._truthy_flag(note.get("pause_requested")):
        raise Refuse(1, f"a serial note is never paused: delete its paused: (and pause_requested:) line, then "
                        f"/thread:execute [[{ctx.slug}]]", reason="a serial note is never paused")


def plugin_origin():
    try:
        data = json.loads(PLUGIN_JSON.read_text())
        repo = data.get("repository") if isinstance(data, dict) else None
        if isinstance(repo, dict):
            repo = repo.get("url")
        return sc.norm_origin(repo.strip()) if isinstance(repo, str) and repo.strip() else None
    except (OSError, ValueError):
        return None


def leg_prompt(ctx, n):
    return (f"/thread:execute [[{ctx.slug}]]\nLeg {n} of the serial chain; the brief is the rollout note's "
            f"## Leg log: {os.path.realpath(ctx.rollout)}")


# ---- smoke list ---------------------------------------------------------------------------------------------------

def smoke_list(chain, n):
    out, seen = [], set()

    def add(slug, why):
        r = chain.row(slug)
        key = slug.lower()
        if key in seen:
            for e in out:
                if e["task"].lower() == key and why not in e["why"]:
                    e["why"].append(why)
            return
        seen.add(key)
        note = r.note if r is not None else (chain.index.get(key) or (None, None))[1]
        out.append({"task": r.slug if r else slug, "verify": verify_line(note), "why": [why]})

    if n > 1:
        for r in chain.rows:
            if r.state == "done" and rr._scalar(r.note.get("leg")) == str(n - 1):
                add(r.slug, f"done by Leg {n - 1}")
    for _p, fnote, v in chain.fix_notes():
        r = chain.row(v)
        if rr._status(fnote) != "done" and r is not None and r.state == "done":
            add(r.slug, "a not-done fix verifies it")
    latest = {}
    for e in chain.log:
        if e["kind"] == "smoke" and e["slug"]:
            res = e["rest"].split("]]", 1)[-1].strip()
            latest[e["slug"].lower()] = (e["n"], e["pos"], res)
    for key, (ln, _pos, res) in latest.items():
        if not res.startswith("fail"):
            continue
        filed = any(e["kind"] == "filed" and e["n"] >= ln and f"(verifies [[{key}" in e["rest"].lower() for e in chain.log)
        if not filed:
            r = chain.row(key)
            add(r.slug if r else key, f"failed at Leg {ln}'s smoke test, no fix filed")
    order = {r.slug.lower(): r.i for r in chain.rows}
    return sorted(out, key=lambda e: order.get(e["task"].lower(), len(order)))


def launch_mcp(chain, alias, folder):
    req = []
    for r in chain.rows:
        if r.note is None or r.state == "done" or not r.same_launch(alias, folder):
            continue
        for line in r.note.section_text("## Launch").split("\n"):
            m = MCP_RE.search(line)
            if m:
                for item in re.findall(r"`([^`]+)`", m.group(1)) or [x.strip() for x in m.group(1).split(",")]:
                    if item and item not in req:
                        req.append(item)
    return req


# ---- verbs ----------------------------------------------------------------------------------------------------------

def cmd_begin(ctx, a):
    cwd = os.path.realpath(os.path.expanduser(a.cwd or os.getcwd()))
    chain = None
    try:
        chain = Chain(ctx)
        validate_note(ctx, chain)
        top = toplevel(cwd)
        own = plugin_origin()
        if top and own:
            url = git_out(top, "remote", "get-url", "origin")
            if url and sc.norm_origin(url) == own:
                raise Refuse(1, f"{top} is this plugin's own checkout: there are no serial self-rollouts (ADR 0040)",
                             reason="the plugin's own checkout")
        with Lock(ctx):
            chain = Chain(ctx)
            validate_note(ctx, chain)
            return _begin_locked(ctx, a, chain, cwd)
    except Refuse as e:
        if e.code in (1, 3, 4):
            prog = chain.progress() if chain is not None else {"done": 0, "total": 0, "running": 0}
            e.extra.setdefault("status_line", status_line(ctx.slug, prog, "halted", e.extra.get("reason") or e.msg))
        raise


def _begin_locked(ctx, a, chain, cwd):
    halt = chain.halt()
    if halt is not None:
        raise Refuse(3, f"halted at Leg {halt[1]}: {halt[0]}; nothing begins until `leg.py clear-halt --reason <why>`",
                     reason=f"halt: {halt[0]}")
    open_leg = chain.open_leg()
    took_over = None
    if open_leg is not None:
        k = open_leg["n"]
        if a.resume is not None:
            if a.resume != k:
                raise Refuse(1, f"--resume {a.resume} names the wrong Leg: Leg {k} is the unclosed one")
            if not ctx.dry:
                log_line(chain.note, leg_line(ctx, k, f"resumed: session {ctx.session}"))
                save(ctx, chain.note)
            return begin_out(ctx, Chain(ctx), k, resumed="logged")
        if ctx.session != "unknown" and open_leg["session"] == ctx.session:
            return begin_out(ctx, chain, k, resumed="silent")
        if not a.take_over:
            raise Refuse(3, f"Leg {k} (session {open_leg['session']}) is unclosed: if this conversation ran its "
                            f"begin, `leg.py begin --resume {k}`; if that Leg is dead, `leg.py begin --take-over`",
                         reason=f"Leg {k} unclosed: --resume {k} or --take-over")
        took_over = k
    elif a.resume is not None:
        raise Refuse(1, f"--resume {a.resume}: no Leg is unclosed")
    n = (took_over + 1) if took_over is not None else chain.last_n() + 1
    # The launch check: the first row this Leg must work.
    plan = plan_next(chain, n, None, None, cap=False, launch=False, dead=() if took_over is None else (took_over,))
    row = plan.get("row") if plan["action"] in ("finish", "claim") else None
    if row is not None:
        need = "codex" if (row.alias or "").startswith("cx-") else "claude"
        if _fold(row.folder or "") != cwd.casefold() or need != ctx.harness:
            why = (f"wrong launch: [[{row.slug}]] runs as `{row.alias}` from `{row.folder}` ({need}); this session is "
                   f"{ctx.harness} in {cwd}; nothing written, so start Leg {n} there with the prompt below")
            raise Refuse(4, why, launch=row.launch, prompt=leg_prompt(ctx, n),
                         reason=f"wrong launch: run Leg {n} as {row.alias} from {row.folder}")
        alias, folder = row.alias, row.folder
    else:
        alias, folder = ctx.harness, cwd
    if not ctx.dry:
        if took_over is not None:
            log_line(chain.note, leg_line(ctx, took_over, f"closed: lost (taken over by Leg {n})"))
        tail = f"; took over from Leg {took_over}" if took_over is not None else ""
        log_line(chain.note, leg_line(ctx, n, f"began: leg-{n} session {ctx.session} in {alias} from {folder}{tail}"))
        save(ctx, chain.note)
        chain = Chain(ctx)
    return begin_out(ctx, chain, n, resumed=False, took_over=took_over, alias=alias, folder=folder)


def begin_out(ctx, chain, n, resumed, took_over=None, alias=None, folder=None):
    g = chain.legs.get(n) or {}
    alias = g.get("alias") or alias
    folder = g.get("folder") or folder
    plan = plan_next(chain, n, alias, folder)
    inherited = [r.slug for r in chain.rows if r.state == "running" and r.note is not None
                 and owner_leg(r.note) not in (None, n)
                 and (chain.legs.get(owner_leg(r.note)) is None or chain.legs[owner_leg(r.note)]["closed"] is not None)]
    fixes = [r.slug for r, _v in chain.fixes() if r.state != "done"]
    return {"verb": "begin", "rollout": ctx.slug, "leg": n, "owner": f"leg-{n}", "session": ctx.session,
            "harness": ctx.harness, "resumed": resumed, "tookOver": took_over,
            "launch": {"alias": alias, "folder": folder}, "inherited": inherited, "smoke": smoke_list(chain, n),
            "fixes": fixes, "mcp": launch_mcp(chain, alias, folder), "next": next_json(plan),
            "progress": chain.progress(n), "dryRun": ctx.dry}


def cmd_next(ctx, a):
    chain = Chain(ctx)
    leg = my_leg(ctx, chain)
    plan = plan_next(chain, leg["n"], leg["alias"], leg["folder"])
    return {"verb": "next", "rollout": ctx.slug, "leg": leg["n"], **next_json(plan), "progress": chain.progress(leg["n"])}


def stamp_bases(ctx, row):
    out, vault = [], os.path.realpath(ctx.vault)
    for tok in row.surfaces:
        if not tok.lower().startswith("repo:"):
            continue
        p = os.path.realpath(os.path.expanduser(tok[5:].strip()))
        top = toplevel(p)
        if top is None or top != p or top == vault:
            continue
        sha = git_out(top, "rev-parse", "--verify", "HEAD^{commit}")
        if sha and f"{top}@{sha}" not in out:
            out.append(f"{top}@{sha}")
    return out


def cmd_claim(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        plan = plan_next(chain, n, leg["alias"], leg["folder"])
        want = "finish" if a.inherit else "claim"
        if plan["action"] != want or plan.get("task", "").lower() != a.task.lower() or \
                (a.inherit and not plan.get("inherit")):
            got = f"{plan['action']} {plan.get('task') or ''}".strip()
            raise Refuse(1, f"next is `{got}`, not {'an inherited ' if a.inherit else ''}claim of [[{a.task}]]: "
                            "nothing written")
        row = plan["row"]
        note = rr.Note(row.path)
        note.set("status", "in_progress")
        note.set("owner", f"leg-{n}")
        note.set("leg", str(n), after=("owner",))
        if not rr._valued(note.get("started")):
            note.set("started", ctx.stamp, after=("leg", "owner"))
        for key in ("handed_back", "gates_signed"):
            note.remove(key)
        bases = None
        if not a.inherit:
            bases = stamp_bases(ctx, row)
            note.set("leg_base", "[" + ", ".join(f'"{b}"' for b in bases) + "]", after=("started", "leg"))
        approved = [rr._norm_gate(l) for l in note.section_text(APPROVED_GATES).split("\n") if l.strip()]
        unapproved = [g for g in a.gate if rr._norm_gate(g) not in approved]
        save(ctx, note)
        text = (f"took [[{row.slug}]] (inherited from Leg {plan['from']})" if a.inherit else f"claimed [[{row.slug}]]")
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, n, text))
            save(ctx, chain.note)
        return {"verb": "claim", "rollout": ctx.slug, "leg": n, "task": row.slug, "inherit": bool(a.inherit),
                "fix": bool(plan.get("fix")), "leg_base": [f"{t}@{s}" for t, s in leg_base(note)] if bases is None else bases,
                "verify": verify_line(note), "unapproved": unapproved, "dryRun": ctx.dry}


def commits_for(top, base, slug):
    """[(sha, subject, paths)] in base..HEAD carrying `Task: [[slug]]`, oldest first; and the untrailered ones."""
    r = git(top, "log", "--reverse", "--format=%H%x1f%s%x1f%B%x1e", f"{base}..HEAD")
    if r.returncode != 0:
        return None, None
    mine, bare = [], []
    pat = re.compile(rf"^\s*Task:\s*\[\[{re.escape(slug)}(?:[|#][^\]]*)?\]\]\s*$", re.M | re.I)
    any_task = re.compile(r"^\s*Task:\s*\[\[", re.M | re.I)
    for rec in r.stdout.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, subj, body = (rec.split("\x1f") + ["", ""])[:3]
        paths = [p for p in (git_out(top, "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha) or "").split("\n") if p]
        if pat.search(body):
            mine.append((sha, subj, paths))
        elif not any_task.search(body):
            bare.append((sha, subj, paths))
    return mine, bare


def trailered_by_any(top, sha, slugs):
    body = git_out(top, "log", "-1", "--format=%B", sha) or ""
    for s in slugs:
        if re.search(rf"^\s*Task:\s*\[\[{re.escape(s)}(?:[|#][^\]]*)?\]\]\s*$", body, re.M | re.I):
            return True
    return False


def change_of(note, slug, only_top=None):
    tops = []
    for top, base in leg_base(note):
        if only_top and os.path.realpath(only_top) != top:
            continue
        head = git_out(top, "rev-parse", "--verify", "HEAD^{commit}")
        mine, bare = commits_for(top, base, slug)
        if mine is None:
            tops.append({"top": top, "base": base, "head": head, "error": f"cannot list {base}..HEAD in {top}",
                         "commits": [], "paths": [], "spec": [], "warns": []})
            continue
        paths = []
        for _sha, _subj, ps in mine:
            for p in ps:
                if not p.startswith(REVIEWS) and p not in paths:
                    paths.append(p)
        warns = [f"WARN: {sha[:12]} {subj!r} in {top} carries no Task: line"
                 for sha, subj, ps in bare if any(not p.startswith(REVIEWS) for p in ps)]
        tops.append({"top": top, "base": base, "head": head,
                     "commits": [{"sha": s, "subject": subj} for s, subj, _ in mine], "paths": paths,
                     "spec": [f":(literal){p}" for p in paths], "warns": warns})
    return tops


def task_note(chain, slug):
    r = chain.row(slug)
    if r is None or r.note is None or r.state == "deferred":
        raise Refuse(1, f"[[{slug}]] is not a task of this chain's Queue")
    return r


def cmd_change(ctx, a):
    chain = Chain(ctx)
    r = task_note(chain, a.task)
    tops = change_of(r.note, r.slug, a.top)
    return {"verb": "change", "rollout": ctx.slug, "task": r.slug, "tops": tops,
            "codeWriting": any(t["commits"] for t in tops)}


def cmd_smoke(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        r = task_note(chain, a.task)
        res = a.result.replace("-", " ")
        text = f"smoke: [[{r.slug}]] {res}" + (f": {reason_text(a.why, 200)}" if a.why else "")
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, leg["n"], text))
            save(ctx, chain.note)
        return {"verb": "smoke", "rollout": ctx.slug, "leg": leg["n"], "task": r.slug, "result": res, "dryRun": ctx.dry}


# ---- names --------------------------------------------------------------------------------------------------------

def kebab(s, words=6):
    w = re.findall(r"[a-z0-9]+", s.lower())
    return "-".join(w[:words]) or "item"


def project_of(ctx, slug=None):
    if slug:
        m = rr.PHASED_STEM_RE.match(slug)
        if m:
            return m.group("slug")
    stem = ctx.slug
    return stem.split("-rollout-", 1)[0] if "-rollout-" in stem else stem


def safe_name(name):
    for _ in range(5):
        new = re.sub(r"-p(?=\d)", "-p-", name).replace("-rollout-", "-roll-out-")
        if new == name:
            break
        name = new
    if rr.PHASED_STEM_RE.match(name) or "-rollout-" in name:
        raise Refuse(1, f"cannot form a safe follow-on name from {name}")
    return name


def free_name(chain, base):
    base = safe_name(base)
    taken = set(chain.index) | {p.stem.lower() for p in chain.ctx.tasks.glob("*.md")}
    name, k = base, 2
    while name.lower() in taken:
        name, k = f"{base}-{k}", k + 1
    return name


def new_task_text(ctx, projects_lines, extra_fm, body):
    fm = ["tags: [task]", "status: open", "priority: normal", "work_depth: shallow", *projects_lines,
          "contexts: []", "scheduled:", "due:", f"captured: {ctx.date}", *extra_fm]
    return "---\n" + "\n".join(fm) + "\n---\n" + body.rstrip("\n") + "\n"


# ---- file-fix -----------------------------------------------------------------------------------------------------

def last_trailered(top, base, slug):
    mine, _ = commits_for(top, base, slug)
    return mine[-1][0] if mine else None


def check_cause(chain, target, a):
    """Validate the cause against git; returns the culprit row (chain) or None. Refuse(1) on a misfit."""
    tops = change_of(target.note, target.slug)
    has_paths = any(t["paths"] for t in tops)
    if a.cause in ("chain", "outside") and not has_paths:
        raise Refuse(1, f"[[{target.slug}]] has no code paths (vault-only work): only own or drift fit")
    if a.cause == "chain":
        if not a.culprit:
            raise Refuse(2, "--cause chain needs --culprit <L>")
        cul = chain.row(a.culprit)
        if cul is None or cul.note is None or cul.state != "done" or cul.slug.lower() == target.slug.lower():
            raise Refuse(1, f"--culprit [[{a.culprit}]] is not a done task of this chain other than [[{target.slug}]]")
        for t in tops:
            mine = []
            for top, base in leg_base(cul.note):
                if top == t["top"]:
                    got, _ = commits_for(top, base, cul.slug)
                    mine.extend(got or [])
            if any(p in t["paths"] for _s, _j, ps in mine for p in ps):
                return cul
        raise Refuse(1, f"[[{cul.slug}]]'s Task: commits touch none of [[{target.slug}]]'s paths: not its culprit")
    if a.culprit:
        raise Refuse(2, "--culprit goes with --cause chain only")
    if a.cause == "outside":
        slugs = [r.slug for r in chain.rows]
        for t in tops:
            last = last_trailered(t["top"], t["base"], target.slug)
            if not last or not t["paths"]:
                continue
            for sha in (git_out(t["top"], "rev-list", f"{last}..HEAD", "--", *t["spec"]) or "").split():
                if not trailered_by_any(t["top"], sha, slugs):
                    return None
        raise Refuse(1, f"no commit after [[{target.slug}]]'s last Task: commit touches its paths without a chain "
                        "task's trailer: not an outside cause")
    if a.cause == "drift":
        for t in tops:
            last = last_trailered(t["top"], t["base"], target.slug)
            if last and t["paths"] and git(t["top"], "diff", "--quiet", last, "--", *t["spec"]).returncode != 0:
                raise Refuse(1, f"[[{target.slug}]]'s paths changed in {t['top']} since its last Task: commit: not "
                                "drift; use own, chain or outside")
    return None


def insert_row(chain, row_text):
    note = chain.note
    found = note._section_bounds(QUEUE)
    if found is None:
        raise Refuse(1, f"{chain.ctx.slug} has no {QUEUE} table")
    lines, start, end = found
    table = [k for k in range(start + 1, end) if lines[k].lstrip().startswith("|")]
    data = [r for r in chain.rows]
    at = None
    for r in data:
        if r.state == "queued":
            at = r.line_no
            break
    if at is None:
        at = (table[-1] + 1) if table else end
    lines = lines[:at] + [row_text] + lines[at:]
    n = 0
    for k in range(start + 1, end + 1):
        cells = split_cells(lines[k]) if k < len(lines) else []
        if len(cells) >= 3 and LINK_RE.search(cells[1]):
            n += 1
            lines[k] = re.sub(r"^(\s*\|\s*)[^|]*?(\s*\|)", lambda m: f"{m.group(1)}{n}{m.group(2)}", lines[k], count=1)
    note._set_body_lines(lines)


def cmd_file_fix(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        target = task_note(chain, a.target)
        if target.state != "done":
            raise Refuse(1, f"[[{target.slug}]] is not done: a failing Verify on unfinished work files no fix")
        culprit = check_cause(chain, target, a)
        cause_txt = {"own": "own", "chain": f"chain [[{culprit.slug if culprit else ''}]]", "outside": "outside",
                     "drift": "drift"}[a.cause]
        existing = None
        for p, fnote, v in chain.fix_notes():
            if v.lower() == target.slug.lower() and rr._status(fnote) != "done":
                existing = (p, fnote)
                break
        if existing is not None and chain.row(existing[0].stem) is not None:
            return {"verb": "file-fix", "rollout": ctx.slug, "leg": n, "fix": existing[0].stem, "target": target.slug,
                    "existing": True, "wrote": False, "dryRun": ctx.dry}
        if existing is not None:
            name, path = existing[0].stem, existing[0]
            wrote_note = False
        else:
            desc = target.slug
            m = rr.PHASED_STEM_RE.match(target.slug)
            if m:
                desc = re.sub(r"^\d+-", "", target.slug[m.end():]) or target.slug
            name = free_name(chain, f"{project_of(ctx, target.slug)}-followup-fix-{desc}")
            path = ctx.tasks / f"{name}.md"
            fixes = target.slug if a.cause == "own" else (culprit.slug if a.cause == "chain" else None)
            extra = [f'rollout: "[[{ctx.slug}]]"', f'verifies: "[[{target.slug}]]"']
            if fixes:
                extra.append(f'fixes: "[[{fixes}]]"')
            if leg["alias"] and leg["alias"] not in ("claude", "codex"):
                extra.append(f"launch: {leg['alias']}")
            vl = verify_line(target.note) or "**Verify:** re-run [[%s]]'s Acceptance criteria." % target.slug
            body = (f"\n## Notes\n\nFiled by Leg {n}'s smoke test (execute legs.md § Fix tasks): [[{target.slug}]]'s "
                    f"Verify failed. Cause: {cause_txt}. Evidence: {a.evidence.strip()}\n")
            if a.excerpt:
                body += "\n```\n" + a.excerpt.rstrip("\n")[-2000:] + "\n```\n"
            body += (f"\n## Acceptance criteria\n\n- [[{target.slug}]]'s Verify passes again; [[{target.slug}]] "
                     f"stays done.\n\n{vl}\n")
            text = new_task_text(ctx, rr._fm_block(target.note, "projects"), extra, body)
            if not ctx.dry:
                atomic_write(path, text)
            wrote_note = True
        am = re.search(r"\\?\|([^\]]+)\]\]", target.cells[1])
        short = f"fix {am.group(1).strip() if am else target.slug}"
        row_text = (f"| 0 | [[{name}\\|{short}]] | `{leg['alias']}` from `{leg['folder']}` | {target.surfaces_cell} |")
        insert_row(chain, row_text)
        log_line(chain.note, leg_line(ctx, n, f"filed [[{name}]] (verifies [[{target.slug}]]; cause {cause_txt})"))
        save(ctx, chain.note)
        return {"verb": "file-fix", "rollout": ctx.slug, "leg": n, "fix": name, "target": target.slug,
                "cause": a.cause, "fixes": (target.slug if a.cause == "own" else culprit.slug if culprit else None),
                "existing": existing is not None, "wroteNote": wrote_note, "path": str(path), "dryRun": ctx.dry}


# ---- done -----------------------------------------------------------------------------------------------------------

def front_matter(path):
    try:
        text = Path(path).read_text()
    except OSError:
        return None
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    out = {}
    for line in m.group(1).split("\n"):
        mm = re.match(r"^([A-Za-z_]+):\s*(.*?)\s*(?:#.*)?$", line)
        if mm and mm.group(1) not in out:
            out[mm.group(1)] = mm.group(2).strip().strip('"').strip("'")
    return out


def review_fits(doc, t):
    fm = front_matter(doc)
    if fm is None:
        return f"{doc}: no front matter"
    if os.path.realpath(os.path.expanduser(fm.get("repo", ""))) != t["top"]:
        return f"{doc}: repo: {fm.get('repo')!r} is not {t['top']}"
    if fm.get("mode") != "code":
        return f"{doc}: mode: {fm.get('mode')!r}, not code"
    if fm.get("effort") not in ("xhigh", "max"):
        return f"{doc}: effort: {fm.get('effort')!r}, not xhigh or max"
    if fm.get("status") != "consumed":
        return f"{doc}: status: {fm.get('status')!r}, not consumed"
    head = git_out(t["top"], "rev-parse", "--verify", f"{fm.get('head', '')}^{{commit}}") if fm.get("head") else None
    if not head:
        return f"{doc}: head: {fm.get('head')!r} is no commit in {t['top']}"
    if not is_ancestor(t["top"], t["base"], head):
        return f"{doc}: head {head[:12]} does not descend from leg_base {t['base'][:12]}"
    if not is_ancestor(t["top"], head, "HEAD"):
        return f"{doc}: head {head[:12]} is not an ancestor of HEAD"
    if not any(is_ancestor(t["top"], c["sha"], head) for c in t["commits"]):
        return f"{doc}: head {head[:12]} holds none of the task's Task: commits"
    return None


def cmd_done(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        r = task_note(chain, a.task)
        if r.state != "running" or owner_leg(r.note) != n:
            raise Refuse(1, f"[[{r.slug}]] is not Leg {n}'s in_progress claim")
        vl = verify_line(r.note)
        verify = a.verify or "none"
        if vl and verify != "pass":
            raise Refuse(1, f"[[{r.slug}]] has a Verify line: run it green, then `done --verify pass` ({vl})")
        tops = change_of(r.note, r.slug)
        code = [t for t in tops if t["commits"]]
        cwd_top = toplevel(os.path.realpath(os.path.expanduser(a.cwd or os.getcwd())))
        reviewed = []
        for t in code:
            if t["top"] != cwd_top:
                raise Refuse(1, f"[[{r.slug}]] changed {t['top']}, not this Leg's checkout {cwd_top}: set it aside "
                                f"with --revert (work it from a Leg launched in {t['top']})")
            whys = []
            for doc in a.review:
                why = review_fits(os.path.realpath(os.path.expanduser(doc)), t)
                if why is None:
                    reviewed.append(os.path.realpath(os.path.expanduser(doc)))
                    break
                whys.append(why)
            else:
                raise Refuse(1, f"[[{r.slug}]] wrote code in {t['top']}: it needs a consumed xhigh code review of its "
                                "change (legs.md § Review) before done" + (": " + "; ".join(whys) if whys else ""))
        note = rr.Note(r.path)
        note.set("status", "done")
        note.set("completed", ctx.date)
        note.set("leg", str(n), after=("owner",))
        if reviewed:
            note.set("reviewed", "[" + ", ".join(f'"{d}"' for d in reviewed) + "]", after=("leg",))
        save(ctx, note)
        tail = f"; reviewed {', '.join(reviewed)}" if reviewed else ""
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, n, f"done [[{r.slug}]] (verify {verify}{tail})"))
            save(ctx, chain.note)
        return {"verb": "done", "rollout": ctx.slug, "leg": n, "task": r.slug, "verify": verify, "reviewed": reviewed,
                "codeWriting": bool(code), "dryRun": ctx.dry}


# ---- set-aside ------------------------------------------------------------------------------------------------------

def plan_revert(ctx, r):
    """Per checkout (top, commits newest-first, paths). Exit 3 when a path to revert is dirty."""
    out = []
    for t in change_of(r.note, r.slug):
        if not t["commits"]:
            continue
        paths = []
        for c in t["commits"]:
            for p in (git_out(t["top"], "diff-tree", "--no-commit-id", "--name-only", "-r", "--root", c["sha"]) or "").split("\n"):
                if p and p not in paths:
                    paths.append(p)
        spec = [f":(literal){p}" for p in paths]
        dirty = git_out(t["top"], "status", "--porcelain", "--", *spec)
        if dirty:
            raise Refuse(3, f"a path to revert has uncommitted or staged changes in {t['top']}: "
                            f"{dirty.splitlines()[0].strip()} (commit, stash or discard it first); nothing reverted")
        out.append((t["top"], [c["sha"] for c in reversed(t["commits"])], spec))
    return out


def scratch_diff(top, shas, spec):
    """Revert shas (newest first) in a detached scratch worktree; the diff, or None on a conflict. Always removed."""
    wt = tempfile.mkdtemp(prefix="leg-revert-")
    os.rmdir(wt)
    added = git(top, "-c", "core.hooksPath=/dev/null", "worktree", "add", "-q", "--detach", wt, "HEAD")
    try:
        if added.returncode != 0:
            return None, f"cannot add a scratch worktree: {added.stderr.strip()[:200]}"
        rv = git(wt, "-c", "core.hooksPath=/dev/null", "revert", "--no-commit", "--no-edit", *shas)
        if rv.returncode != 0:
            return None, f"reverting {', '.join(x[:12] for x in shas)} conflicts"
        d = git(wt, "diff", "--cached", "--binary", "HEAD", "--", *spec)
        if d.returncode != 0:
            return None, f"cannot diff the scratch tree: {d.stderr.strip()[:200]}"
        return d.stdout, None
    finally:
        git(top, "worktree", "remove", "--force", wt)
        shutil.rmtree(wt, ignore_errors=True)
        git(top, "worktree", "prune")


def cmd_set_aside(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        r = task_note(chain, a.task)
        if r.state not in ("running", "queued"):
            raise Refuse(1, f"[[{r.slug}]] is {rr._status(r.note) or 'open'}: only a claimed or queued task is set aside")
        if r.state == "running" and owner_leg(r.note) not in (None, n):
            raise Refuse(1, f"[[{r.slug}]] is Leg {owner_leg(r.note)}'s claim, not Leg {n}'s")
        kind = a.kind
        if kind == "gate" and not a.gate:
            raise Refuse(2, "--kind gate needs one --gate per pending gate")
        if kind == "gate" and a.revert:
            raise Refuse(2, "a gate set-aside reverts nothing: gates come before any write")
        reverted = []
        if a.revert:
            plans = plan_revert(ctx, r)
            diffs = []
            for top, shas, spec in ([] if ctx.dry else plans):
                diff, why = scratch_diff(top, shas, spec)
                if diff is None:
                    raise Refuse(3, f"{why} in {top}: the checkout is untouched; close the Leg `--outcome halt` and "
                                    "resolve it by hand")
                diffs.append((top, shas, spec, diff))
            if not ctx.dry:
                for top, shas, spec, diff in diffs:
                    if not diff.strip():
                        continue  # the reverted commits' changes are already gone: nothing to commit
                    ap = git(top, "apply", "--index", "-", input=diff)
                    if ap.returncode != 0:
                        raise Refuse(3, f"git apply --index failed in {top}: {ap.stderr.strip()[:200]}")
                    msg = (f"🔧 chore(leg): revert {r.slug}, set aside\n\nTask: [[{r.slug}]]\n"
                           f"Set-aside: {reason_text(a.reason, 300)}\n")
                    cm = git(top, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", msg, "--", *spec)
                    if cm.returncode != 0:
                        raise Refuse(3, f"the revert commit failed in {top}: {cm.stderr.strip()[:200]}")
                    reverted.append((git_out(top, "rev-parse", "HEAD"), top))
        note = rr.Note(r.path)
        note.remove("owner")
        if kind == "gate":
            note.set("status", "gate-pending")
            note.upsert_section(GATES_PENDING, "\n".join(f"- {g.strip()}" for g in a.gate))
            status = "gate-pending"
        else:
            status = a.status or "blocked"
            note.set("status", status)
            diag = f"Set aside by Leg {n} of [[{ctx.slug}]]: {a.reason.strip()}"
            if reverted:
                diag += "\n\n" + "\n".join(f"- reverted {sha} in {top}" for sha, top in reverted)
                diag += "\n\nA re-entry restores the work with `git revert <sha>` in that checkout, or starts fresh."
            note.append_run(rr.BLOCKED_SECTIONS.get(status, BLOCKER), diag, ctx.now)
        save(ctx, note)
        if not ctx.dry:
            for sha, top in reverted:
                log_line(chain.note, leg_line(ctx, n, f"reverted {sha} in {top}"))
            log_line(chain.note, leg_line(ctx, n, f"set aside [[{r.slug}]] ({status}): {reason_text(a.reason, 200)}"))
            save(ctx, chain.note)
        return {"verb": "set-aside", "rollout": ctx.slug, "leg": n, "task": r.slug, "status": status,
                "reverted": [{"sha": s, "top": t} for s, t in reverted], "dryRun": ctx.dry}


# ---- post-items and file-followup ---------------------------------------------------------------------------------------

def post_items(note):
    found = note._section_bounds(POST_ROLLOUT)
    if found is None:
        return []
    lines, start, end = found
    mark = next((k for k in range(start + 1, end) if lines[k].strip() == ITEMS_MARK), None)
    lo = (mark + 1) if mark is not None else start + 1
    items = []
    for k in range(lo, end):
        if re.match(r"^[-*] ", lines[k]):
            text = lines[k][2:].strip()
            pm = re.search(r"→ \[\[([^\]|]+)", text)
            items.append({"k": len(items) + 1, "line": k, "text": text, "pointer": pm.group(1) if pm else None})
    return items


def cmd_post_items(ctx, a):
    chain = Chain(ctx)
    return {"verb": "post-items", "rollout": ctx.slug,
            "items": [{k: v for k, v in i.items() if k != "line"} for i in post_items(chain.note)]}


def set_pointer(note, item_k, name, title):
    found = note._section_bounds(POST_ROLLOUT)
    if found is None:
        note.append_section(POST_ROLLOUT, f"{ITEMS_MARK}\n\n- → [[{name}]]: {title}")
        return
    lines, start, end = found
    items = post_items(note)
    new = f"- → [[{name}]]: {title}"
    if item_k is not None:
        it = next((i for i in items if i["k"] == item_k), None)
        if it is None:
            raise Refuse(1, f"no Post-rollout item {item_k} (there are {len(items)})")
        lines[it["line"]] = new
        note._set_body_lines(lines)
        return
    if items:
        at = items[-1]["line"] + 1
    else:
        mark = next((k for k in range(start + 1, end) if lines[k].strip() == ITEMS_MARK), None)
        if mark is None:
            j = end
            while j > start + 1 and not lines[j - 1].strip():
                j -= 1
            note._set_body_lines(lines[:j] + ["", ITEMS_MARK, "", new] + lines[j:])
            return
        at = mark + 1
        while at < end and not lines[at].strip():
            at += 1
        if at < end and not re.match(r"^[-*] ", lines[at]):
            pass
    note._set_body_lines(lines[:at] + [new] + lines[at:])


def write_followup(ctx, chain, name_base, title, body_lines):
    name = free_name(chain, name_base)
    path = ctx.tasks / f"{name}.md"
    body = f"\n## Notes\n\n" + "\n".join(body_lines).rstrip() + "\n"
    text = new_task_text(ctx, rr._fm_block(chain.note, "projects"), [], body)
    if not ctx.dry:
        atomic_write(path, text)
    return name, path


def cmd_file_followup(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain, closed_ok=True)
        items = post_items(chain.note)
        if a.item is not None and not any(i["k"] == a.item for i in items):
            raise Refuse(1, f"no Post-rollout item {a.item} (there are {len(items)})")
        item_text = next((i["text"] for i in items if i["k"] == a.item), None)
        body = [f"# {a.title.strip()}", "", a.why.strip(), "",
                f"Filed by Leg {leg['n']} of [[{ctx.slug}]]" + (f" from its Post-rollout item {a.item}: {item_text}"
                                                              if a.item is not None else " at its close") + "."]
        name, path = write_followup(ctx, chain, f"{project_of(ctx)}-followup-{kebab(a.title)}", a.title, body)
        set_pointer(chain.note, a.item, name, reason_text(a.title, 120))
        tag = f"post-item {a.item}" if a.item is not None else "close"
        log_line(chain.note, leg_line(ctx, leg["n"], f"follow-on [[{name}]] ({tag})"))
        save(ctx, chain.note)
        return {"verb": "file-followup", "rollout": ctx.slug, "leg": leg["n"], "followup": name, "path": str(path),
                "item": a.item, "dryRun": ctx.dry}


# ---- close ----------------------------------------------------------------------------------------------------------

def needs_you(ctx, chain, outcome, reason):
    out = []
    for r in chain.rows:
        if r.state != "set-aside":
            continue
        st = rr._status(r.note)
        if st == "gate-pending":
            for g in r.note.section_text(GATES_PENDING).split("\n"):
                g = re.sub(r"^[-*]\s+", "", g.strip())
                if g:
                    out.append(f"[[{r.slug}]] sign off gated input: {g}")
        else:
            diag = r.note.latest_run_text(rr.BLOCKED_SECTIONS.get(st, BLOCKER)).split("\n")[0]
            out.append(f"[[{r.slug}]] set aside ({st}): {reason_text(diag, 140)}: hand it back with "
                       f"reconcile-rollout.py hand-back --tasks {r.slug}, or defer it")
    if outcome in ("stopped", "halt"):
        word = "stopped" if outcome == "stopped" else "halted"
        out.append(f"[[{ctx.slug}]] {word} ({ctx.date}): {reason_text(reason or '', 140)}: see /thread:status "
                   f"[[{ctx.slug}]], fix it and re-invoke")
    return out


def route(top):
    try:
        r = subprocess.run(["bash", str(LAND_SH), "--route", "--", top], env=_env(), capture_output=True, text=True,
                           timeout=60)
        line = (r.stdout.strip().split("\n") or [""])[-1]
    except subprocess.TimeoutExpired:
        return "stuck", "land.sh --route timed out"
    except OSError as e:
        return "stuck", f"land.sh --route failed: {e}"
    if line.startswith("landable "):
        return "landable", line[len("landable "):].strip()
    if line.startswith("not landed: "):
        return "deferred", line[len("not landed: "):]
    if line.startswith("stuck: "):
        return "stuck", line[len("stuck: "):]
    return "stuck", f"land.sh --route gave no route (rc {r.returncode})"


def chain_commits(chain, top):
    """[(sha, subject, task)] of every chain task's Task: commits in top, deduped, oldest first."""
    seen, out = set(), []
    for r in chain.rows:
        if r.note is None or r.state == "deferred":
            continue
        for t, base in leg_base(r.note):
            if t != top:
                continue
            mine, _ = commits_for(top, base, r.slug)
            for sha, subj, _p in mine or []:
                if sha not in seen:
                    seen.add(sha)
                    out.append((sha, subj, r.slug))
    return out


def land_plan(chain):
    """Per chain checkout: (top, kind, detail, commits needing action). Read-only."""
    plans = []
    for top in chain.chain_tops():
        kind, detail = route(top)
        commits = chain_commits(chain, top)
        if kind == "landable":
            ref = f"refs/remotes/origin/{detail}"
            has_ref = git(top, "rev-parse", "-q", "--verify", ref).returncode == 0
            missing = [c for c in commits if not (has_ref and is_ancestor(top, c[0], ref))]
            plans.append((top, kind, detail, missing))
        elif kind == "deferred":
            plans.append((top, kind, detail, []))
        else:
            plans.append((top, kind, detail, commits))
    return plans


def leg_summary(log, n_now, ctx):
    """The Completion log's line per Leg: its launch, begun–closed, the tasks it finished and set aside."""
    lines, legs = [], parse_legs(log)
    for n in sorted(legs):
        g = legs[n]
        done = [e["slug"] for e in log if e["n"] == n and e["kind"] == "done" and e["slug"]]
        aside = [e["slug"] for e in log if e["n"] == n and e["kind"] == "set aside" and e["slug"]]
        closed = g["closedStamp"] or (ctx.stamp if n == n_now else "?")
        lines.append(f"- Leg {n}: `{g['alias']}` from `{g['folder']}`, {g['began']}–{closed}; done "
                     f"{', '.join(f'[[{s}]]' for s in done) or 'none'}; set aside "
                     f"{', '.join(f'[[{s}]]' for s in aside) or 'none'}")
    return lines


def cmd_close(ctx, a):
    outcome = a.outcome
    if outcome in ("stopped", "halt") and not (a.reason or "").strip():
        raise Usage(f"--outcome {outcome} needs --reason")
    dispositions = {}
    for d in a.disposition:
        k, sep, text = d.partition("=")
        if not sep or not k.strip().isdigit():
            raise Usage(f"--disposition {d!r}: write <k>=<text>")
        dispositions[int(k)] = text.strip().strip('"')
    plans = None
    if outcome == "complete":
        pre = Chain(ctx)
        plans = land_plan(pre)
    with Lock(ctx):
        chain = Chain(ctx)
        leg = my_leg(ctx, chain)
        n = leg["n"]
        owned = [r.slug for r in chain.rows if r.state == "running" and r.note is not None and owner_leg(r.note) == n]
        if owned and outcome in ("handoff", "complete", "stuck"):
            raise Refuse(1, f"Leg {n} still owns [[{owned[0]}]] (in_progress): finish it (`done`) or set it aside "
                            "first; a Leg closes only between tasks")
        cwd_top = toplevel(os.path.realpath(os.path.expanduser(a.cwd or os.getcwd())))
        commit_only = ([cwd_top] if cwd_top else []) + [t for t in chain.chain_tops() if t != cwd_top]
        out = {"verb": "close", "rollout": ctx.slug, "leg": n, "outcome": outcome, "commit_only": commit_only}
        if outcome == "handoff":
            plan = plan_next(chain, n + 1, None, None, cap=False, launch=False)
            row = plan.get("row")
            if row is None:
                raise Refuse(1, f"nothing to hand over (next is {plan['action']}): close --outcome complete or stuck")
            line = f"closed: handoff to Leg {n + 1} in {row.alias} from {row.folder}"
            prog = chain.progress(n)
            title = f"Leg {n + 1}: {ctx.slug}"
            if len(title) > 60:
                title = title[:59].rstrip("-") + "…"
            out["handover"] = {
                "title": title, "prompt": leg_prompt(ctx, n + 1),
                "tldr": (f"Leg {n + 1} of the {project_of(ctx)} serial chain. {prog['done']} of {prog['total']} tasks "
                         "are done; it picks up at the next row."),
                "cwd": os.path.realpath(os.path.expanduser(row.folder)),
                "harness": "codex" if (row.alias or "").startswith("cx-") else "claude",
                "launch": row.launch, "task": row.slug}
        elif outcome == "complete":
            plan = plan_next(chain, n, None, None, cap=False, launch=False)
            if plan["action"] != "complete":
                raise Refuse(1, f"the chain is not complete (next is {plan['action']}): close it another way")
            dest = ctx.tasks / "Archive" / "Rollouts" / ctx.rollout.name
            if dest.exists():
                raise Refuse(1, f"archive collision: {dest} exists; nothing written (rename or remove it, then re-run)")
            items = post_items(chain.note)
            lacking = [i["k"] for i in items if i["pointer"] is None and i["k"] not in dispositions]
            if lacking:
                raise Refuse(1, f"Post-rollout item(s) {', '.join(map(str, lacking))} have neither a follow-on pointer "
                                "nor a --disposition: nothing written")
            line = "closed: chain complete"
        elif outcome == "stuck":
            k = sum(1 for r in chain.rows if r.state == "set-aside")
            line = f"closed: chain stuck: {k} set aside"
        elif outcome == "stopped":
            line = f"closed: stopped: {reason_text(a.reason, 200)}"
        else:
            line = f"closed: halted: {reason_text(a.reason, 200)}"
        if outcome == "complete":
            return _complete(ctx, a, chain, leg, plans, dispositions, items, out, line)
        if not ctx.dry:
            log_line(chain.note, leg_line(ctx, n, line))
            save(ctx, chain.note)
        prog = chain.progress(n)
        out["progress"] = prog
        out["needs_you"] = needs_you(ctx, chain, outcome, a.reason)
        if outcome == "stuck":
            out["status_line"] = status_line(ctx.slug, prog, "halted",
                                             f"awaiting you: {sum(1 for r in chain.rows if r.state == 'set-aside')} set aside")
        elif outcome == "stopped":
            out["status_line"] = status_line(ctx.slug, prog, "halted", f"stopped: {a.reason}")
        elif outcome == "halt":
            out["status_line"] = status_line(ctx.slug, prog, "halted", f"halt: {a.reason}")
        out["dryRun"] = ctx.dry
        return out


def _complete(ctx, a, chain, leg, plans, dispositions, items, out, line):
    n = leg["n"]
    written, chain_lines, followups = [], [], []
    need = [(top, kind, detail, commits) for top, kind, detail, commits in plans if commits and kind != "deferred"]
    land_name = None
    if need:
        body = ["# Land the serial chain's commits", "",
                f"[[{ctx.slug}]] finished, but some of its tasks' `Task:` commits are not on origin. ADR 0028 lands "
                "only close-out commits on its own, so these wait for you:", ""]
        for top, kind, detail, commits in need:
            act = "open a PR from them, or push them"
            if kind == "stuck":
                act = f"check the landing route ({detail}), then {act}"
            body.append(f"- `{top}` ({'origin/' + detail if kind == 'landable' else kind}): {act}")
            for sha, subj, task in commits:
                body.append(f"  - `{sha[:12]}` {subj} ([[{task}]])")
        base = f"{project_of(ctx)}-followup-land-chain-{ctx.date}"
        land_name, land_path = write_followup(ctx, chain, base, "Land the serial chain's commits", body)
        written.append(land_path)
        followups.append(land_name)
        set_pointer(chain.note, None, land_name, "land the chain's commits")
        log_line(chain.note, leg_line(ctx, n, f"follow-on [[{land_name}]] (land)"))
    for top, kind, detail, commits in plans:
        if kind == "landable":
            chain_lines.append(f"{top}: {len(commits)} not on origin/{detail} → [[{land_name}]]" if commits
                               else f"{top}: all on origin/{detail}")
        elif kind == "deferred":
            chain_lines.append(f"{top}: not landed: {detail}, nothing filed")
        else:
            chain_lines.append(f"{top}: stuck: {detail} → [[{land_name}]]" if commits
                               else f"{top}: stuck: {detail}, no chain commits")
    log_line(chain.note, leg_line(ctx, n, line))
    chain.note.set("status", "done")
    chain.note.set("completed", ctx.date, after=("status",))
    items = post_items(chain.note)
    disp = []
    for i in items:
        if i["k"] in dispositions:
            disp.append(f"{i['k']}. {dispositions[i['k']]}")
        elif i["pointer"]:
            disp.append(f"{i['k']}. → [[{i['pointer']}]]")
    # this Leg's earlier follow-ons, filed by file-followup before close
    for e in chain.log:
        if e["n"] == n and e["kind"] == "follow-on" and e["slug"] and e["slug"] not in followups:
            followups.append(e["slug"])
    content = leg_summary(parse_log(chain.note), n, ctx)
    content += [f"- {l.strip()}" if not l.strip().startswith("- ") else l.strip() for l in a.log_line]
    content.append("- Post-rollout items: " + ("; ".join(disp) if disp else "none"))
    if chain_lines:
        content += [f"- Chain commits: {l}" for l in chain_lines]
    else:
        content.append("- Chain commits: none")
    content.append("- Reflection: not scored (serial; p24-4)")
    chain.note.append_section(COMPLETION_LOG, "\n".join(content))
    prog = chain.progress(n)
    out.update(progress=prog, needs_you=[], followups=followups,
               status_line=status_line(ctx.slug, prog, "done"), dryRun=ctx.dry)
    if ctx.dry:
        out.update(archived=None, committed=False)
        return out
    save(ctx, chain.note)
    dest = ctx.tasks / "Archive" / "Rollouts" / ctx.rollout.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    vault = ctx.vault
    tracked = git(vault, "ls-files", "--error-unmatch", "--", str(ctx.rollout)).returncode == 0
    moved = False
    if tracked:
        moved = git(vault, "mv", "--", str(ctx.rollout), str(dest)).returncode == 0
    if not moved:
        os.rename(ctx.rollout, dest)
        tracked = False
    paths = [str(dest)] + [str(ctx.tasks / f"{f}.md") for f in followups if (ctx.tasks / f"{f}.md").exists()]
    paths += [str(Path(os.path.expanduser(p)).resolve()) for p in a.also]
    committed = False
    if toplevel(str(vault)):
        add = git(vault, "add", "--", *paths)
        msg = (f"📝 docs(rollout): {ctx.slug} complete, archived\n\nThe serial chain's last Leg (Leg {n}) ran its "
               "Complete (execute legs.md § Complete).\n")
        if add.returncode == 0:
            cm = git(vault, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", msg, "--",
                     *(paths + ([str(ctx.rollout)] if tracked else [])))
            committed = cm.returncode == 0
            if not committed:
                out["commitError"] = (cm.stderr or cm.stdout).strip()[:200]
        else:
            out["commitError"] = add.stderr.strip()[:200]
    out.update(archived=str(dest), committed=committed)
    return out


def cmd_handed(ctx, a):
    if bool(a.started) == bool(a.manual):
        raise Usage("handed takes exactly one of --started <id> and --manual <why>")
    with Lock(ctx):
        chain = Chain(ctx)
        cands = [g for g in chain.legs.values() if (g["closed"] or "").startswith("handoff to Leg")
                 and (ctx.session == "unknown" or g["session"] in (ctx.session, "unknown", None))]
        if not cands:
            raise Refuse(1, "no Leg of this session closed with a handoff: run `leg.py close --outcome handoff` first")
        leg = max(cands, key=lambda g: g["n"])
        n = leg["n"]
        m = re.match(r"handoff to Leg (\d+) in (\S+) from (.*)$", leg["closed"])
        nxt, alias, folder = (int(m.group(1)), m.group(2), m.group(3)) if m else (n + 1, "?", "?")
        if leg["handover"] is None and not ctx.dry:
            text = f"hand-over: started {a.started.strip()}" if a.started else f"hand-over: manual ({reason_text(a.manual, 200)})"
            log_line(chain.note, leg_line(ctx, n, text))
            save(ctx, chain.note)
            chain = Chain(ctx)
            leg = chain.legs[n]
        prog = chain.progress(n)
        if (leg["handover"] or "").startswith("started") or (leg["handover"] is None and a.started):
            line = status_line(ctx.slug, prog, "done", f"handed off to Leg {nxt}")
        else:
            line = status_line(ctx.slug, prog, "halted", f"manual handoff: Leg {nxt} in {alias} from {folder}")
        return {"verb": "handed", "rollout": ctx.slug, "leg": n, "handover": leg["handover"], "status_line": line,
                "dryRun": ctx.dry}


def cmd_clear_halt(ctx, a):
    with Lock(ctx):
        chain = Chain(ctx)
        halt = chain.halt()
        if halt is None:
            raise Refuse(1, "no halt stands: nothing to clear")
        if not ctx.dry:
            log_line(chain.note, f"- {ctx.stamp} halt cleared: {reason_text(a.reason, 200)}")
            save(ctx, chain.note)
        return {"verb": "clear-halt", "rollout": ctx.slug, "cleared": halt[0], "leg": halt[1], "dryRun": ctx.dry}


# ---- main -----------------------------------------------------------------------------------------------------------

class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Usage(message)


def parser():
    p = Parser(prog="leg.py", description="A serial rollout's Leg bookkeeping (see the module docstring).")
    common = Parser(add_help=False)
    common.add_argument("--rollout", required=True)
    common.add_argument("--tasks-dir")
    common.add_argument("--vault")
    common.add_argument("--now")
    common.add_argument("--session")
    common.add_argument("--harness", choices=("claude", "codex"))
    common.add_argument("--dry-run", action="store_true")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    s = sub.add_parser("begin", parents=[common])
    s.add_argument("--cwd")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--take-over", action="store_true")
    g.add_argument("--resume", type=int)
    sub.add_parser("next", parents=[common])
    s = sub.add_parser("claim", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--inherit", action="store_true")
    s.add_argument("--gate", action="append", default=[])
    s = sub.add_parser("change", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--top")
    s = sub.add_parser("smoke", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--result", required=True, choices=("pass", "fail", "not-run"))
    s.add_argument("--why")
    s = sub.add_parser("file-fix", parents=[common])
    s.add_argument("--target", required=True)
    s.add_argument("--cause", required=True, choices=("own", "chain", "outside", "drift"))
    s.add_argument("--culprit")
    s.add_argument("--evidence", required=True)
    s.add_argument("--excerpt")
    s = sub.add_parser("done", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--verify", choices=("pass", "none"))
    s.add_argument("--review", action="append", default=[])
    s.add_argument("--cwd")
    s = sub.add_parser("set-aside", parents=[common])
    s.add_argument("--task", required=True)
    s.add_argument("--reason", required=True)
    s.add_argument("--kind", choices=("block", "gate"), default="block")
    s.add_argument("--status", choices=("blocked", "review-blocked", "plan-blocked"))
    s.add_argument("--revert", action="store_true")
    s.add_argument("--gate", action="append", default=[])
    sub.add_parser("post-items", parents=[common])
    s = sub.add_parser("file-followup", parents=[common])
    s.add_argument("--title", required=True)
    s.add_argument("--why", required=True)
    s.add_argument("--item", type=int)
    s = sub.add_parser("close", parents=[common])
    s.add_argument("--outcome", required=True, choices=OUTCOMES)
    s.add_argument("--reason")
    s.add_argument("--cwd")
    s.add_argument("--disposition", action="append", default=[])
    s.add_argument("--log-line", action="append", default=[])
    s.add_argument("--also", action="append", default=[])
    s = sub.add_parser("handed", parents=[common])
    s.add_argument("--started")
    s.add_argument("--manual")
    s = sub.add_parser("clear-halt", parents=[common])
    s.add_argument("--reason", required=True)
    return p


VERBS = {"begin": cmd_begin, "next": cmd_next, "claim": cmd_claim, "change": cmd_change, "smoke": cmd_smoke,
         "file-fix": cmd_file_fix, "done": cmd_done, "set-aside": cmd_set_aside, "post-items": cmd_post_items,
         "file-followup": cmd_file_followup, "close": cmd_close, "handed": cmd_handed, "clear-halt": cmd_clear_halt}


def main(argv=None) -> int:
    global rr, sc
    verb = None
    try:
        args = parser().parse_args(argv)
        verb = args.verb
        if not verb:
            raise Usage("name a verb: " + ", ".join(VERBS))
        rr = _load("reconcile_rollout", RR_SRC)
        sc = _load("serial_chains", SC_SRC)
        ctx = Ctx(args)
        emit(VERBS[verb](ctx, args))
        return 0
    except Usage as e:
        print(f"leg: {e}", file=sys.stderr)
        return 2
    except Refuse as e:
        if e.code == 2:
            print(f"leg: {e.msg}", file=sys.stderr)
            return 2
        e.extra.pop("reason", None)
        emit({"verb": verb, "exit": e.code, "error": e.msg, **e.extra})
        print(f"leg: {e.msg}", file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
