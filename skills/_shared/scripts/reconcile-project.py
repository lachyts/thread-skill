#!/usr/bin/env python3
"""reconcile-project.py — find (and, with --apply, close) project-level Drift: finished work still open.

ADR 0026 § Decision 1: one shared, dry-run-by-default step. Callers are /thread:execute's completion
ceremony (`--kinds phase --phases <touched> --apply`) and /thread:orient (dry run in its audit,
`--apply` on a Reshuffle or Steer only answer, ADR 0027). Stdlib only, python >= 3.9. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/reconcile-project.py --project <slug>
        [--vault ~/repos/obsidian] [--phases N[,M...]] [--kinds phase,task,rollout] [--apply] [--json]
        [--today YYYY-MM-DD] [--gh-bin gh | --no-gh]

It prints two lists, UNAMBIGUOUS (U) and AMBIGUOUS (A), each item with a reason. A dry run (the default)
writes nothing. --apply writes the U list only; A items are never touched. It never commits the vault.

Paths. P = <vault>/Work/Phases (root only, never Phases/Archive). T = <vault>/Work/Tasks (root).
A = T/Archive/** (recursive, excluding R). R = T/Archive/Rollouts.

Classification is by `tags` only. A PHASE note has `phase` in its tags. A TASK note has `task` in its
tags and neither `rollout` nor `phase` in its tags; frontmatter keys named `phase:` or `rollout:` are
ignored for classification (every real task note carries a `phase: N` key). A ROLLOUT note has `rollout`
in its tags.

Terms. LANDED = {done, merged, dropped}. A HOLD status is any status other than landed, open,
in_progress or review (parked, blocked, ...): a deliberate hold, not drift. A task's rollout is LIVE when
its `rollout:` wikilink resolves to a file in T root, and RETIRED when it resolves into R, into A, or to
no note. A task with no `rollout:` link has no rollout: neither live nor retired.

Scoping. Task candidates are always `<slug>-p<N>-*` (so `--project chorus` never picks up a
`chorus-cmux-*` task). --phases N,M restricts phase candidates to those N and task candidates to
filenames starting `<slug>-pN-`; rollout detection ignores it. --kinds (default all three) selects
which kinds are listed and written; a kind outside --kinds is never written, even as a dependency.

1. FINISHED PHASE. Candidate: a phase note in P named `<slug>-p<N>-*.md` at `status: open`. Its tasks
   are the task notes in T and A whose filename starts with the literal `<slug>-p<N>-` (so `-p1-` never
   reaches `-p10-`); a slug present in both T and A counts twice.
   - Zero tasks: in neither list (planned-but-unsplit phases are not drift).
   - Every task landed: U, action `status: done` + `completed: <today>` (directly after `status:`),
     `depends_on: []`. The vault's daily sweep moves it to Phases/Archive.
   - Every non-landed task is a U finished task (rule 2): U with `depends_on: [those slugs]` when `task`
     is in --kinds; otherwise A, `needs task <slug> closed first`, and no task is written.
   - A QUIET task keeps the phase out of both lists, whatever its other tasks are: a hold, a task at
     `review` under a live rollout (status/repair own that step; reconcile-wave's LANDED_STATUSES counts
     `review` for resume) or with no `rollout:` at all (a human review step, nothing to repair), or a
     genuinely open task with no evidence. Resolving the other tasks could never close such a phase.
   - Otherwise any non-landed task that is A, skipped, unparseable, archived-but-open (in A or tagged
     `archived`, not landed), or at `review` under a retired rollout (one resolving into R, into A or
     to no note: `run /thread:repair`) makes the phase A, naming it.
2. FINISHED TASK. Candidate: a task note in T root named `<slug>-p<N>-*` at `open` or `in_progress`.
   Evidence precedence:
   - `pr:` a `https://github.com/.../pull/N` URL (quoted or bare): decided by (a) alone.
   - `pr:` present but not a URL (e.g. `pr: 7`): A, `pr: is not a URL; cannot verify`.
   - `pr:` absent or empty: decided by (b) alone.
   (a) PR. `gh pr view <url> --json state,mergedAt`, one call per distinct URL, cached, 20 s timeout.
       MERGED is evidence. OPEN or CLOSED is A (`pr: <url> is <STATE> but the completion log records
       it`) when (b) would have fired, else not drift. gh missing, disabled or erroring: skipped, never U.
   (b) Completion log. The task's `rollout:` resolves into R, and a line of that note's
       `## Completion log` section (up to the next `## ` heading) NAMES the task: a wikilink
       `[[<stem>` followed by `]]`, `|`, `\\|` (an escaped alias inside a table) or `#`; or its short
       id `p<N>-<M>`, bounded so `p8-1` never matches `p8-10` or `demo-p8-1`. A naming line is evidence
       only if all three hold, else the task is A:
       (1) it is a table row (`^\\s*\\|`) or a list bullet (`^\\s*([-*+]|\\d+\\.)\\s`), else
           `log names it only in prose`;
       (2) a PR ref (`/pull/N` or `#N`) lies in the mention's own SEGMENT, from the end of the mention to
           the next `[[`, `;`, ` · ` or end of line, else `log names it without a PR ref`;
       (3) the line has no negative marker (case-insensitive, word-bounded): deferred, follow-up, filed,
           not landed, partial(ly), held out, dropped, pointer, re-scoped, rewritten, superseded,
           reverted, not merged, unmerged, abandoned, cancel(l)ed, not dispatched, skipped, withdrawn.
           Link targets and URLs are not scanned (a task named `...-partial-log` is no disposition);
           the reason quotes the markers.
       Any failing naming line makes the task A. A rollout in R at `status: done` whose log never names
       the task is A (`its rollout is archived done, but the log does not record it`).
   A task with evidence is still A when (i) its body (fenced code stripped; link targets and URLs not
   scanned) reads as a partial landing (case-insensitive, deliberately broad: `open here`, `still open`,
   `not yet <word>`, `partially merged/...`, `remain(s|ing)`, `outstanding`, `still to do/build/...`,
   `TODO`, `only item/part/step <n>`, a bold `**Open...**` label or a line-leading `Open:`; the reason
   quotes the match) or has an unchecked `- [ ]`; (ii) it has
   `owner:` and its rollout is live; (iii) the note does not parse. The U write is `status: done`, the
   single write /thread:execute's mark-done makes.
3. MISFILED SUPERSEDED ROLLOUT. Candidate: a rollout note in T root or A (not R) named
   `<slug>-rollout*` with a non-empty `superseded_by:`. U, action `move to Archive/Rollouts/<name>`;
   A when that destination already exists.

Apply. Order: tasks, then phases, then rollout moves. Writes go through reconcile-wave.py's `Note`
(line-surgical frontmatter edits), loaded before any vault read; if it cannot be loaded the script exits
2. A phase is written only if every slug in its depends_on was written in this run and every one of its
task files re-reads from disk as landed; otherwise it is skipped with `phase <slug> skipped: dependency
<task> <reason>`. A rollout move never overwrites: R is created if missing, then `os.link` (which fails
atomically when the destination exists; that clash is reported and the item reclassified A) and
`unlink(src)`; where hard links are unsupported, an exclusive-create copy. If `unlink(src)` fails the
destination is removed again (rollback); a failed rollback names both copies (`two copies left: <src>,
<dst>`). Per-item failures go to `errors` and never stop independent items.

gh. --no-gh (gh `disabled`), or a --gh-bin that does not resolve (gh `missing`), skips every (a) lookup;
`skipped` then carries `PR evidence (gh unavailable) for <slugs>`. A per-URL gh error is skipped too.

Output. Text: a header (`dry run: nothing written; pass --apply` or `applied`), then `Unambiguous (n)`,
`Ambiguous (n)`, `Skipped (n)` and, on apply, `Written (n)` and `Errors (n)`. --json: {project, vault,
today, kinds, phases, applied, gh: ok|missing|disabled, unambiguous: [{kind, slug, path, action, reason,
depends_on}], ambiguous: [{kind, slug, path, reason}], skipped: [str], written: [str], errors: [str]};
paths are vault-relative.

Exit codes. 0: it ran (drift or none). 1: an --apply write or move failed, or a dependent phase was
skipped. 2: usage error (missing --project, bad --kinds/--phases/--today, no Work/ under --vault) or
reconcile-wave.py missing or unloadable.
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

KINDS = ("phase", "task", "rollout")
LANDED = {"done", "merged", "dropped"}
ACTIVE = {"open", "in_progress"}
NOTE_SRC = Path(__file__).resolve().parent.parent.parent / "execute/scripts/reconcile-wave.py"

PR_URL_RE = re.compile(r"^https://github\.com/[^/\s]+/[^/\s]+/pull/\d+/?$")
PR_REF_RE = re.compile(r"/pull/\d+|(?<![\w&])#\d+")
LINE_SHAPE_RE = re.compile(r"^\s*(\||([-*+]|\d+\.)\s)")
SEGMENT_END_RE = re.compile(r"\[\[|;| · ")
NEGATIVE_RE = re.compile(r"\b(deferred|follow-?up|filed|not landed|partial(ly)?|held out|dropped|pointer"
                         r"|re-?scoped|rewritten|superseded|reverted|not merged|unmerged|abandoned|cancell?ed"
                         r"|not dispatched|skipped|withdrawn)\b", re.I)
# A note that reads as a partial landing. Deliberately broad: a false hit only makes a task ambiguous
# (a human looks), a miss lets --apply close unfinished work.
PARTIAL_RE = re.compile(r"\bopen here\b|\bstill open\b|\bnot yet \w+|\bpartial(ly)? (landed|merged|built|done|shipped)"
                        r"|\bremain(s|ing)?\b|\boutstanding\b|\bstill to (do|build|land|come|ship)\b|\bTODO\b"
                        r"|\bonly (items?|parts?|steps?) \d|\*\*open\b[^*\n]*\*\*|^[ \t]*([-*+][ \t]+)?open:",
                        re.I | re.M)
UNCHECKED_RE = re.compile(r"^\s*[-*+]\s+\[ \]", re.M)
FENCE_RE = re.compile(r"^(```|~~~)[^\n]*\n.*?^\1[^\n]*$", re.M | re.S)
WIKILINK_RE = re.compile(r"\[\[([^\]|#\\]+)")
# What the negative-marker scan ignores: link targets and URLs are names, not prose (a task named
# `…-partial-log` or a `/follow-up` path is no disposition). Aliases stay: they are display text.
MARKER_BLIND_RE = re.compile(r"\[\[[^\]|#\\]*|https?://\S+")


def die(msg: str, code: int = 2):
    print(f"reconcile-project: {msg}", file=sys.stderr)
    sys.exit(code)


def load_note_class():
    """reconcile-wave.py's Note, the one sanctioned frontmatter writer (side-effect-free on import)."""
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("reconcile_wave", NOTE_SRC)
        if spec is None or spec.loader is None:
            raise ImportError("no loader for this path")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.Note
    except Exception as e:  # noqa: BLE001 — any failure to load is the same exit-2 condition
        die(f"cannot load Note from {NOTE_SRC} (skills/execute/scripts/reconcile-wave.py): {e}")


# ---- read-only frontmatter ----------------------------------------------------------------------------

def _unq(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def read_frontmatter(text: str):
    """(fields, body): scalars, block lists and inline `[a, b]` lists. ValueError when there is none."""
    m = re.match(r"^---\n(.*?\n)---\n(.*)$", text, re.S)
    if not m:
        raise ValueError("no YAML frontmatter block found")
    fields, key = {}, None
    for line in m.group(1).split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        kv = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if val.startswith("[") and val.endswith("]") and not val.startswith("[["):
                fields[key] = [_unq(x) for x in val[1:-1].split(",") if x.strip()]
            else:
                fields[key] = _unq(val)
            continue
        item = re.match(r"^\s*-\s+(.*)$", line)
        if item and key is not None:
            cur = fields.get(key)
            fields[key] = (cur if isinstance(cur, list) else []) + [_unq(item.group(1))]
    return fields, m.group(2)


class Rec:
    """One vault note, read-only."""

    def __init__(self, path: Path, where: str):
        self.path, self.where, self.stem = path, where, path.stem
        self.fm, self.body, self.err = None, "", None
        try:
            self.fm, self.body = read_frontmatter(path.read_text())
        except (OSError, UnicodeDecodeError, ValueError) as e:
            self.err = str(e)

    def scalar(self, key: str) -> str:
        v = (self.fm or {}).get(key)
        if isinstance(v, list):
            v = v[0] if v else ""
        return (v or "").strip()

    @property
    def tags(self) -> set:
        v = (self.fm or {}).get("tags") or []
        return {t.strip().lstrip("#").lower() for t in ([v] if isinstance(v, str) else v) if t.strip()}

    @property
    def status(self) -> str:
        return self.scalar("status").lower()

    def is_task(self) -> bool:
        return self.fm is not None and "task" in self.tags and not ({"rollout", "phase"} & self.tags)


# ---- the Completion-log reader ------------------------------------------------------------------------

def short_id(stem: str, slug: str):
    m = re.match(rf"^{re.escape(slug)}-(p\d+-\d+)(?=-|$)", stem)
    return m.group(1) if m else None


def find_mentions(stem: str, slug: str, line: str):
    """End offsets of every mention of the task `stem` on `line` (wikilink or bounded short id)."""
    ends = [m.end() for m in re.finditer(rf"\[\[{re.escape(stem)}(?=\]\]|\\?\||#)", line)]
    sid = short_id(stem, slug)
    if sid:
        ends += [m.end() for m in re.finditer(rf"(?<![\w-]){re.escape(sid)}(?![\w-])", line)]
    return sorted(ends)


def pr_ref_in_segment(line: str, end: int) -> bool:
    stop = SEGMENT_END_RE.search(line, end)
    return bool(PR_REF_RE.search(line[end:stop.start() if stop else len(line)]))


def completion_log_lines(body: str):
    out, inside = [], False
    for line in body.split("\n"):
        if re.match(r"^##\s+Completion log\b", line):
            inside = True
            continue
        if inside and line.startswith("## "):
            break
        if inside:
            out.append(line)
    return out


def excerpt(line: str, width: int = 120) -> str:
    s = line.strip()
    return s if len(s) <= width else s[: width - 1] + "…"


# ---- detection ----------------------------------------------------------------------------------------

class Detector:
    def __init__(self, vault: Path, slug: str, kinds, phases, today: str, gh_mode: str, gh_path):
        self.vault, self.slug, self.kinds, self.phases, self.today = vault, slug, kinds, phases, today
        self.gh_mode, self.gh_path, self.gh_cache = gh_mode, gh_path, {}
        work = vault / "Work"
        self.P, self.T = work / "Phases", work / "Tasks"
        self.A, self.R = self.T / "Archive", self.T / "Archive" / "Rollouts"
        md = lambda d: sorted(d.glob("*.md")) if d.is_dir() else []  # noqa: E731
        self.t_recs = [Rec(p, "T") for p in md(self.T)]
        self.a_recs = [Rec(p, "A") for p in (sorted(self.A.rglob("*.md")) if self.A.is_dir() else [])
                       if self.R not in p.parents]
        self.p_recs = [Rec(p, "P") for p in md(self.P)]
        self.a_stems = {r.stem for r in self.a_recs}
        self.task_memo = {}
        self.gh_unavailable = []
        self.U, self.Amb, self.skipped = [], [], []

    def rel(self, p: Path) -> str:
        try:
            return str(p.relative_to(self.vault))
        except ValueError:
            return str(p)

    def resolve_rollout(self, rec: Rec):
        """('live'|'R'|'A'|'none', path-or-None, stem) for a task's `rollout:` wikilink."""
        m = WIKILINK_RE.search(rec.scalar("rollout"))
        stem = m.group(1).strip() if m else ""
        if not stem:
            return "none", None, ""
        if (self.T / f"{stem}.md").is_file():
            return "live", self.T / f"{stem}.md", stem
        if (self.R / f"{stem}.md").is_file():
            return "R", self.R / f"{stem}.md", stem
        if stem in self.a_stems:
            return "A", None, stem
        return "none", None, stem

    def gh_state(self, url: str):
        """('state', STATE) or ('error', message). Only called when gh_mode == 'ok'."""
        if url not in self.gh_cache:
            try:
                p = subprocess.run([self.gh_path, "pr", "view", url, "--json", "state,mergedAt"],
                                   capture_output=True, text=True, timeout=20)
                if p.returncode != 0:
                    msg = (p.stderr.strip().splitlines() or [f"exit {p.returncode}"])[-1]
                    res = ("error", msg)
                else:
                    res = ("state", str(json.loads(p.stdout)["state"]).upper())
            except subprocess.TimeoutExpired:
                res = ("error", "timed out after 20 s")
            except (OSError, ValueError, KeyError, TypeError) as e:
                res = ("error", f"unreadable gh result: {e}")
            self.gh_cache[url] = res
        return self.gh_cache[url]

    def log_evidence(self, rec: Rec, rollout):
        """(b): ('evidence', text) | ('A', reason) | (None, None)."""
        kind, path, name = rollout
        if kind != "R":
            return None, None
        rnote = Rec(path, "R")
        if rnote.fm is None:
            return "A", f"its rollout [[{name}]] does not parse: {rnote.err}"
        naming = [(line, ends) for line in completion_log_lines(rnote.body)
                  for ends in [find_mentions(rec.stem, self.slug, line)] if ends]
        if not naming:
            if rnote.status == "done":
                return "A", f"its rollout [[{name}]] is archived done, but the log does not record it"
            return None, None
        for line, ends in naming:
            if not LINE_SHAPE_RE.match(line):
                return "A", f"log names it only in prose: {excerpt(line)}"
            if not any(pr_ref_in_segment(line, e) for e in ends):
                return "A", f"log names it without a PR ref: {excerpt(line)}"
            markers = []
            for mk in NEGATIVE_RE.finditer(MARKER_BLIND_RE.sub(" ", line)):
                if mk.group(0).lower() not in (x.lower() for x in markers):
                    markers.append(mk.group(0))
            if markers:
                return "A", f"log line carries {', '.join(markers)}: {excerpt(line)}"
        return "evidence", f"the completion log of [[{name}]] records it: {excerpt(naming[0][0])}"

    def eval_task(self, rec: Rec):
        """('U'|'A'|'skip'|None, reason) for a T-root task candidate; memoised by path."""
        if rec.path in self.task_memo:
            return self.task_memo[rec.path]
        res = self._eval_task(rec)
        self.task_memo[rec.path] = res
        return res

    def _eval_task(self, rec: Rec):
        if rec.fm is None:
            return "A", f"the note does not parse: {rec.err}"
        rollout = self.resolve_rollout(rec)
        pr = rec.scalar("pr")
        if pr:
            if not PR_URL_RE.match(pr):
                return "A", f"pr: {pr} is not a URL; cannot verify"
            if self.gh_mode != "ok":
                self.gh_unavailable.append(rec.stem)
                return "skip", "PR evidence (gh unavailable)"
            kind, val = self.gh_state(pr)
            if kind == "error":
                return "skip", f"PR evidence skipped: gh pr view {pr}: {val}"
            if val in ("OPEN", "CLOSED"):
                if self.log_evidence(rec, rollout)[0] == "evidence":
                    return "A", f"pr: {pr} is {val} but the completion log records it"
                return None, None
            if val != "MERGED":
                return "skip", f"PR evidence skipped: gh reports {val} for {pr}"
            evidence = f"pr: {pr} is MERGED"
        else:
            kind, text = self.log_evidence(rec, rollout)
            if kind != "evidence":
                return kind, text
            evidence = text
        body = FENCE_RE.sub("", rec.body)
        m = PARTIAL_RE.search(MARKER_BLIND_RE.sub(" ", body))
        if m:
            return "A", f"{evidence}, but the note reads as a partial landing: \"{m.group(0)}\""
        if UNCHECKED_RE.search(body):
            return "A", f"{evidence}, but the note has an unchecked - [ ] item"
        owner = rec.scalar("owner")
        if owner and rollout[0] == "live":
            return "A", f"{evidence}, but owner: {owner} and its rollout [[{rollout[2]}]] is live"
        return "U", evidence

    def in_phase_scope(self, stem: str) -> bool:
        """A task candidate is `<slug>-p<N>-*` (so `chorus` never reaches `chorus-cmux-*`), N in --phases."""
        m = re.match(rf"^{re.escape(self.slug)}-p(\d+)-", stem)
        return bool(m) and (self.phases is None or int(m.group(1)) in self.phases)

    # -- the three detectors --

    def detect_tasks(self):
        for rec in self.t_recs:
            if not self.in_phase_scope(rec.stem):
                continue
            if rec.fm is not None and not (rec.is_task() and rec.status in ACTIVE):
                continue
            verdict, reason = self.eval_task(rec)
            self.record("task", rec, verdict, reason, "status: done")

    def detect_phases(self):
        for rec in self.p_recs:
            m = re.match(rf"^{re.escape(self.slug)}-p(\d+)-", rec.stem)
            if not m or (self.phases is not None and int(m.group(1)) not in self.phases):
                continue
            if rec.fm is None:
                self.Amb.append(self.item("phase", rec, f"the note does not parse: {rec.err}"))
                continue
            if "phase" not in rec.tags or rec.status != "open":
                continue
            prefix = f"{self.slug}-p{m.group(1)}-"
            tasks = [t for t in self.t_recs + self.a_recs
                     if t.stem.startswith(prefix) and (t.fm is None or t.is_task())]
            if not tasks:
                continue
            blockers, depends, quiet = [], [], False
            for t in tasks:
                if t.fm is None:
                    blockers.append(f"task {t.stem} does not parse")
                    continue
                st = t.status
                if st in LANDED:
                    continue
                if t.where == "A" or "archived" in t.tags:
                    blockers.append(f"task {t.stem} is archived but {st or 'has no status'}")
                elif st == "review":
                    rkind, _, rstem = self.resolve_rollout(t)
                    if rkind == "live" or not rstem:
                        quiet = True  # a live rollout's review step, or a human review with no rollout
                    else:
                        blockers.append(f"task {t.stem} at review; run /thread:repair")
                elif st in ACTIVE:
                    verdict, reason = self.eval_task(t)
                    if verdict == "U":
                        depends.append(t.stem)
                    elif verdict == "A":
                        blockers.append(f"task {t.stem} is ambiguous ({reason})")
                    elif verdict == "skip":
                        blockers.append(f"task {t.stem} skipped ({reason})")
                    else:
                        quiet = True
                else:
                    quiet = True  # a hold (parked, blocked, ...): deliberate, not drift
            if quiet:
                continue  # resolving the ambiguous tasks could never close this phase
            if blockers:
                self.Amb.append(self.item("phase", rec, "; ".join(blockers)))
            elif depends and "task" not in self.kinds:
                self.Amb.append(self.item("phase", rec, f"needs task {', '.join(depends)} closed first"))
            else:
                noun = "task" if len(tasks) == 1 else "tasks"
                reason = f"all {len(tasks)} {noun} landed" + (f" once {', '.join(depends)} closes" if depends else "")
                it = self.item("phase", rec, reason, action=f"status: done + completed: {self.today}",
                               depends_on=depends)
                it["_tasks"] = [t.path for t in tasks]
                self.U.append(it)

    def detect_rollouts(self):
        for rec in self.t_recs + self.a_recs:
            if rec.fm is None or not rec.stem.startswith(f"{self.slug}-rollout") or "rollout" not in rec.tags:
                continue
            sup = (rec.fm or {}).get("superseded_by")
            sup = ", ".join(x for x in sup if x.strip()) if isinstance(sup, list) else (sup or "").strip()
            if not sup:
                continue
            dst = self.R / rec.path.name
            if dst.exists():
                self.Amb.append(self.item("rollout", rec, f"destination exists: {self.rel(dst)}"))
            else:
                self.U.append(self.item("rollout", rec, f"superseded_by: {sup}, but filed at {self.rel(rec.path)}",
                                        action=f"move to Archive/Rollouts/{rec.path.name}"))

    def item(self, kind, rec, reason, action=None, depends_on=None):
        it = {"kind": kind, "slug": rec.stem, "path": self.rel(rec.path), "reason": reason, "_path": rec.path}
        if action is not None:
            it["action"] = action
            it["depends_on"] = depends_on or []
        return it

    def record(self, kind, rec, verdict, reason, action):
        if verdict == "U":
            self.U.append(self.item(kind, rec, reason, action=action))
        elif verdict == "A":
            self.Amb.append(self.item(kind, rec, reason))
        elif verdict == "skip" and reason != "PR evidence (gh unavailable)":
            self.skipped.append(f"{kind} {rec.stem}: {reason}")

    def run(self):
        if "task" in self.kinds:
            self.detect_tasks()
        if "phase" in self.kinds:
            self.detect_phases()
        if "rollout" in self.kinds:
            self.detect_rollouts()
        for rec in self.t_recs:  # phase projection may have skipped tasks that are not listed as tasks
            v = self.task_memo.get(rec.path)
            if v and v[0] == "skip" and v[1] != "PR evidence (gh unavailable)" and "task" not in self.kinds:
                self.skipped.append(f"task {rec.stem}: {v[1]}")
        if self.gh_unavailable:
            self.skipped.insert(0, f"PR evidence (gh unavailable) for {', '.join(sorted(set(self.gh_unavailable)))}")


# ---- apply --------------------------------------------------------------------------------------------

class MoveError(Exception):
    pass


def move_no_clobber(src: Path, dst: Path):
    """Move src to dst without ever overwriting; roll back on a half-failure. FileExistsError on a clash."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except FileExistsError:
        raise
    except OSError:
        data = src.read_bytes()
        f = open(dst, "xb")  # exclusive create: FileExistsError on a clash, never an overwrite
        try:  # from here on dst is ours: any failure (write, close, copystat) removes it again
            with f:
                f.write(data)
            shutil.copystat(src, dst)
        except OSError:
            os.unlink(dst)
            raise
    try:
        os.unlink(src)
    except OSError as e:
        try:
            os.unlink(dst)
        except OSError as e2:
            raise MoveError(f"{e}; rollback failed ({e2}): two copies left: {src}, {dst}")
        raise MoveError(f"{e} (rolled back)")


def apply(det: Detector, Note):
    written, errors, done_tasks = [], [], set()
    for it in [i for i in det.U if i["kind"] == "task"]:
        try:
            note = Note(it["_path"])
            note.set("status", "done")
            note.save()
            done_tasks.add(it["slug"])
            written.append(f"task {it['slug']}: status: done")
        except Exception as e:  # noqa: BLE001 — a per-item failure never stops independent items
            errors.append(f"task {it['slug']} not written: {e}")
    for it in [i for i in det.U if i["kind"] == "phase"]:
        why = next((f"{d} not written" for d in it["depends_on"] if d not in done_tasks), None)
        if why is None:
            for p in it["_tasks"]:
                r = Rec(p, "")
                if r.fm is None or r.status not in LANDED:
                    why = f"{p.stem} reads {r.status or 'unparseable'} on disk"
                    break
        if why:
            errors.append(f"phase {it['slug']} skipped: dependency {why}")
            continue
        try:
            note = Note(it["_path"])
            note.set("status", "done")
            note.set("completed", det.today, after=("status",))
            note.save()
            written.append(f"phase {it['slug']}: status: done, completed: {det.today}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"phase {it['slug']} not written: {e}")
    for it in [i for i in det.U if i["kind"] == "rollout"]:
        src = it["_path"]
        dst = det.R / src.name
        try:
            move_no_clobber(src, dst)
            written.append(f"rollout {it['slug']}: moved to {det.rel(dst)}")
        except FileExistsError:
            errors.append(f"rollout {it['slug']} not moved: destination exists: {det.rel(dst)}")
            det.Amb.append({k: v for k, v in it.items() if k not in ("action", "depends_on")}
                           | {"reason": f"destination exists: {det.rel(dst)}"})
        except (OSError, MoveError) as e:
            errors.append(f"rollout {it['slug']} not moved: {e}")
    return written, errors


# ---- CLI ----------------------------------------------------------------------------------------------

def parse_args(argv):
    ap = argparse.ArgumentParser(prog="reconcile-project.py", description="Find and close project Drift.")
    ap.add_argument("--project", required=True, help="project slug, e.g. chorus")
    ap.add_argument("--vault", default="~/repos/obsidian")
    ap.add_argument("--phases", help="N[,M...]: restrict phase and task candidates")
    ap.add_argument("--kinds", default=",".join(KINDS), help="phase,task,rollout (default all)")
    ap.add_argument("--apply", action="store_true", help="write the unambiguous list")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--today", help="YYYY-MM-DD (default: the local date)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--gh-bin", default="gh")
    g.add_argument("--no-gh", action="store_true")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    Note = load_note_class()
    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
    if not kinds or any(k not in KINDS for k in kinds):
        die(f"--kinds takes a comma list of {', '.join(KINDS)}, got {args.kinds!r}")
    phases = None
    if args.phases is not None:
        try:
            phases = sorted({int(x) for x in args.phases.split(",") if x.strip()})
        except ValueError:
            die(f"--phases takes N[,M...], got {args.phases!r}")
        if not phases or any(n < 0 for n in phases):
            die(f"--phases takes N[,M...], got {args.phases!r}")
    today = args.today or date.today().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", today):
        die(f"--today takes YYYY-MM-DD, got {today!r}")
    try:
        date.fromisoformat(today)
    except ValueError:
        die(f"--today is not a date: {today!r}")
    vault = Path(os.path.expanduser(args.vault))
    if not (vault / "Work").is_dir():
        die(f"no Work/ under --vault {vault}")
    if args.no_gh:
        gh_mode, gh_path = "disabled", None
    else:
        gh_path = shutil.which(args.gh_bin)
        gh_mode = "ok" if gh_path else "missing"

    det = Detector(vault, args.project, kinds, phases, today, gh_mode, gh_path)
    det.run()
    written, errors = apply(det, Note) if args.apply else ([], [])
    order = lambda i: (KINDS.index(i["kind"]), i["slug"])  # noqa: E731
    public_u = [{k: i[k] for k in ("kind", "slug", "path", "action", "reason", "depends_on")}
                for i in sorted(det.U, key=order)]
    public_a = [{k: i[k] for k in ("kind", "slug", "path", "reason")} for i in sorted(det.Amb, key=order)]

    if args.json:
        print(json.dumps({"project": args.project, "vault": str(vault), "today": today, "kinds": kinds,
                          "phases": phases, "applied": bool(args.apply), "gh": gh_mode,
                          "unambiguous": public_u, "ambiguous": public_a, "skipped": det.skipped,
                          "written": written, "errors": errors}, indent=2, ensure_ascii=False))
    else:
        out = [f"reconcile-project: {args.project} (vault {vault}, today {today}, gh {gh_mode})",
               "applied" if args.apply else "dry run: nothing written; pass --apply",
               f"Unambiguous ({len(public_u)})"]
        out += [f"  - {i['kind']} {i['slug']}: {i['action']} ({i['reason']})" for i in public_u]
        out.append(f"Ambiguous ({len(public_a)})")
        out += [f"  - {i['kind']} {i['slug']}: {i['reason']}" for i in public_a]
        out.append(f"Skipped ({len(det.skipped)})")
        out += [f"  - {s}" for s in det.skipped]
        if args.apply:
            out.append(f"Written ({len(written)})")
            out += [f"  - {s}" for s in written]
            out.append(f"Errors ({len(errors)})")
            out += [f"  - {s}" for s in errors]
        print("\n".join(out))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
