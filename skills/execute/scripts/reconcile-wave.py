#!/usr/bin/env python3
"""reconcile-wave.py — deterministic vault bookkeeping for wave-execute (findings #6 + #7).

The Workflow engine (`wave-execute.workflow.js`) returns a structured result; the lead session used to
hand-edit ~5 frontmatter transitions per wave (status + pr + *_rounds_used) plus the cursor advance — 50+
fumble-prone edits across a rollout. This helper performs ALL of those writes deterministically from the
returned task array, and (finding #7) computes the per-task resume set so a partial wave resumes without
re-dispatching already-landed work.

Three subcommands:

  reconcile   Read the workflow result JSON ({rolloutSlug, tasks:[...]}) and write each task note's
              frontmatter + any blocked-feedback body section. Idempotent (safe to re-run on resume).

  cursor      Set `merged_through_wave: N` on a rollout note (the durable continuous-mode cursor),
              run AFTER merge-wave.sh reports `ok` for wave N.

  resume-filter  Given a wave's task slugs, print (one per line) the slugs that still need dispatch —
              i.e. whose current note status is NOT already landed/approved ({done, review, merged}).
              This is the per-task resume rule: the task-note status is the source of truth, so a wave
              that returned one approved + one blocked resumes by re-dispatching only the blocked one.

Stdlib only (the claude-config repo has no dependency manager). Frontmatter is edited line-surgically
(not via a YAML round-trip) to preserve field order, comments, and spacing exactly — matching how the
rest of the vault tooling treats frontmatter.

Status mapping (workflow status -> note writes), per wave-execute/SKILL.md §6:
  review         -> status: review;        pr: <url>; review_rounds_used: <n>; plan_rounds_used: <n> (if >0)
  review-blocked -> status: review-blocked; pr: <url>; append reviewFeedback under "## Review-blocked feedback"
  blocked        -> status: blocked;        append blockerDiagnosis under "## Blocker diagnosis" (if absent)
  plan-blocked   -> status: plan-blocked;   append blockerDiagnosis under "## Plan-blocked feedback"
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

DEFAULT_TASKS_DIR = Path(os.path.expanduser("~/repos/obsidian/Work/Tasks"))

# Statuses that count as "already landed/approved" — never re-dispatched on resume (finding #7).
LANDED_STATUSES = {"done", "review", "merged"}

# Which workflow statuses carry a PR to record.
STATUS_WITH_PR = {"review", "review-blocked"}

# Per-status body section to append when the engine reports blocked feedback.
BLOCKED_SECTIONS = {
    "review-blocked": "## Review-blocked feedback",
    "blocked": "## Blocker diagnosis",
    "plan-blocked": "## Plan-blocked feedback",
}


# ---- frontmatter surgery (order/format preserving) --------------------------

class Note:
    """A markdown note split into (frontmatter lines, body text), edited in place."""

    def __init__(self, path: Path):
        self.path = path
        text = path.read_text()
        m = re.match(r"^(---\n)(.*?\n)(---\n)(.*)$", text, re.DOTALL)
        if not m:
            raise ValueError(f"{path}: no YAML frontmatter block found")
        self._fm = m.group(2).rstrip("\n").split("\n")  # list of frontmatter lines (no delimiters)
        self._body = m.group(4)                          # verbatim body text after the closing ---
        self.dirty = False

    def get(self, key: str):
        pat = re.compile(rf"^{re.escape(key)}:\s*(.*)$")
        for line in self._fm:
            mm = pat.match(line)
            if mm:
                return mm.group(1).strip()
        return None

    def set(self, key: str, value, after=("owner", "status")):
        """Replace `key:`'s value in place, or insert a new line after the first present anchor key."""
        newline = f"{key}: {value}"
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        for i, line in enumerate(self._fm):
            if pat.match(line):
                if line != newline:
                    self._fm[i] = newline
                    self.dirty = True
                return
        # not present — insert just after the first available anchor key
        for anchor in after:
            apat = re.compile(rf"^{re.escape(anchor)}:\s*")
            for i, line in enumerate(self._fm):
                if apat.match(line):
                    self._fm.insert(i + 1, newline)
                    self.dirty = True
                    return
        self._fm.append(newline)
        self.dirty = True

    def has_heading(self, heading: str) -> bool:
        return any(line.strip() == heading for line in self._body.split("\n"))

    def append_section(self, heading: str, content: str):
        """Append `## heading\\n\\n<content>` to the body once (idempotent on the heading)."""
        if self.has_heading(heading):
            return
        block = self._body.rstrip("\n")
        sep = "\n\n" if block else ""
        self._body = f"{block}{sep}\n{heading}\n\n{content.rstrip()}\n"
        self.dirty = True

    def render(self) -> str:
        return "---\n" + "\n".join(self._fm) + "\n---\n" + self._body

    def save(self, dry_run=False):
        if dry_run or not self.dirty:
            return
        self.path.write_text(self.render())


def bullets(items):
    return "\n".join(f"- {s}" for s in items if str(s).strip())


# ---- reconcile --------------------------------------------------------------

def resolve_task_path(task, tasks_dir: Path) -> Path:
    # Prefer an explicit taskPath if the result carries one; else resolve <tasks-dir>/<slug>.md
    # (exactly how wave-execute builds taskPath in the args it dispatched).
    tp = task.get("taskPath")
    if tp:
        return Path(os.path.expanduser(tp))
    return tasks_dir / f"{task['slug']}.md"


def cmd_reconcile(args) -> int:
    raw = sys.stdin.read() if args.result == "-" else Path(os.path.expanduser(args.result)).read_text()
    data = json.loads(raw)
    tasks = data.get("tasks", [])
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    errors = []
    for task in tasks:
        slug = task.get("slug", "<no-slug>")
        status = task.get("status")
        path = resolve_task_path(task, tasks_dir)
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        if status not in ("review", "review-blocked", "blocked", "plan-blocked"):
            errors.append(f"{slug}: unexpected workflow status {status!r} — left untouched")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue

        note.set("status", status)

        pr = (task.get("prUrl") or "").strip()
        if status in STATUS_WITH_PR and pr:
            note.set("pr", pr)
        if status == "review":
            note.set("review_rounds_used", int(task.get("reviewRoundsUsed") or 0))
            plan_rounds = int(task.get("planRoundsUsed") or 0)
            if plan_rounds > 0:
                note.set("plan_rounds_used", plan_rounds)

        if status in BLOCKED_SECTIONS:
            heading = BLOCKED_SECTIONS[status]
            if status == "review-blocked":
                content = bullets(task.get("reviewFeedback") or [])
            else:
                content = (task.get("blockerDiagnosis") or "").strip()
            if content:
                note.append_section(heading, content)

        note.save(dry_run=args.dry_run)
        flag = " (dry-run)" if args.dry_run else (" [written]" if note.dirty else " [no-change]")
        print(f"{slug}: status={status}{(' pr=' + pr) if pr else ''}{flag}")

    if args.wave is not None and args.rollout and not errors:
        # Optional convenience: advance the cursor in the same call (only when the caller asserts the
        # wave fully merged — normally `cursor` is a separate post-merge step gated on merge-wave.sh ok).
        _set_cursor(Path(os.path.expanduser(args.rollout)), args.wave, args.dry_run)
        print(f"cursor: merged_through_wave={args.wave}" + (" (dry-run)" if args.dry_run else ""))

    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- cursor -----------------------------------------------------------------

def _set_cursor(rollout_path: Path, wave: int, dry_run=False):
    note = Note(rollout_path)
    note.set("merged_through_wave", int(wave), after=("merged_through_wave", "parallel_ceiling", "status"))
    note.save(dry_run=dry_run)
    return note


def cmd_cursor(args) -> int:
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"ERROR: rollout note not found at {path}", file=sys.stderr)
        return 1
    _set_cursor(path, args.wave, args.dry_run)
    print(f"merged_through_wave={args.wave}" + (" (dry-run)" if args.dry_run else ""))
    return 0


# ---- resume-filter ----------------------------------------------------------

def cmd_resume_filter(args) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    to_dispatch = []
    for slug in slugs:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            # A slug with no note can't be resumed from status — surface it but still re-dispatch.
            print(f"WARN: {slug}: note not found at {path} — including for dispatch", file=sys.stderr)
            to_dispatch.append(slug)
            continue
        status = Note(path).get("status")
        if status not in LANDED_STATUSES:
            to_dispatch.append(slug)
    for slug in to_dispatch:
        print(slug)
    return 0


# ---- CLI --------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description="Deterministic vault reconcile for wave-execute.")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("reconcile", help="write task frontmatter + blocked feedback from a workflow result")
    r.add_argument("--result", default="-", help="path to the workflow result JSON, or '-' for stdin (default)")
    r.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    r.add_argument("--rollout", default=None, help="rollout note path (only with --wave, to advance the cursor)")
    r.add_argument("--wave", type=int, default=None, help="advance merged_through_wave to N in the same call")
    r.add_argument("--dry-run", action="store_true")
    r.set_defaults(func=cmd_reconcile)

    c = sub.add_parser("cursor", help="set merged_through_wave:N on a rollout note (post-merge)")
    c.add_argument("--rollout", required=True)
    c.add_argument("--wave", type=int, required=True)
    c.add_argument("--dry-run", action="store_true")
    c.set_defaults(func=cmd_cursor)

    f = sub.add_parser("resume-filter", help="print the slugs in a wave that still need dispatch")
    f.add_argument("--tasks", required=True, help="comma-separated task slugs for the target wave")
    f.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    f.set_defaults(func=cmd_resume_filter)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
