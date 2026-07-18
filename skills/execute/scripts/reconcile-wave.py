#!/usr/bin/env python3
"""reconcile-wave.py — deterministic vault bookkeeping for wave-execute (findings #6 + #7).

The Workflow engine (`wave-execute.workflow.js`) returns a structured result; the lead session used to
hand-edit ~5 frontmatter transitions per wave (status + pr + *_rounds_used) plus the cursor advance — 50+
fumble-prone edits across a rollout. This helper performs ALL of those writes deterministically from the
returned task array, and (finding #7) computes the per-task resume set so a partial wave resumes without
re-dispatching already-landed work.

Eight subcommands:

  reconcile   Read the workflow result JSON ({rolloutSlug, tasks:[...]}) and write each task note's
              frontmatter + any blocked-feedback body section. Idempotent (safe to re-run on resume).

  cursor      Set `merged_through_wave: N` on a rollout note (the durable continuous-mode cursor),
              run AFTER merge-wave.sh reports `ok` for wave N. Also the SOFT-PAUSE honour point:
              when the rollout note carries `pause_requested: true`, it stamps `paused: <timestamp>`,
              clears the flag, and prints a `paused=` line — the caller (execute §4.5) must then end
              the wave loop instead of launching the next wave. Riding the cursor step means the
              pause lands on a clean wave boundary with zero extra agent calls.

  mark-done   Flip task notes `status: review` -> `status: done`, run AFTER the wave's merge is
              confirmed (merge-wave.sh `ok` sentinel). `review` means "landed, awaiting confirmation";
              the merge IS that confirmation for PR tasks, and the wave completing is it for read-only
              tasks (master-review approval, nothing to merge). Refuses any note at another status —
              a blocked/unmerged task can never be swept to done. Idempotent (already-done = no-op).

  resume-filter  Given a wave's task slugs, print (one per line) the slugs that still need dispatch —
              i.e. whose current note status is NOT already landed/approved ({done, review, merged}).
              This is the per-task resume rule: the task-note status is the source of truth, so a wave
              that returned one approved + one blocked resumes by re-dispatching only the blocked one.

  status      Read-only situational scan for /wave:status. Given a rollout note, find every task note
              carrying `rollout: [[<this-rollout>]]` (glob-by-backlink — captures read-only tasks the
              `## File-sets` block omits) and emit JSON {rollout, merged_through_wave, status, tasks:
              [{slug, wave, status, pr, blockerSummary}]}. Pure read; no network (the skill owns gh/git).

  resolve     Flip a *blocked* task (review-blocked/blocked/plan-blocked) -> done. The gap-closer for
              the drift case (a blocked note whose PR actually merged out-of-band). Refuses any note
              that isn't in a blocked state — the CALLER (the /wave:repair skill) must have verified
              the work truly landed (e.g. `gh pr view` shows MERGED) before invoking. Idempotent.

  defer       Pop task(s) out of a rollout, back to open backlog: clears `wave:`/`rollout:`/`owner:`
              and sets `status: open` so a future /wave:schedule re-plans them. The dependent-closure
              safety check lives in the /wave:repair skill; this only does the frontmatter surgery.

  clear-pause Reinstate a paused rollout: remove the `paused:` stamp (and any pending
              `pause_requested`) from the rollout note. Run by /wave:execute's resume path when it
              finds a `paused:` stamp — reinstating IS plain re-invocation, so there is no separate
              resume command. Idempotent (no stamp = no-op).

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
from datetime import datetime
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

    def remove(self, key: str):
        """Delete the `key:` line from frontmatter entirely (idempotent — no-op if absent)."""
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        kept = [line for line in self._fm if not pat.match(line)]
        if len(kept) != len(self._fm):
            self._fm = kept
            self.dirty = True

    def has_heading(self, heading: str) -> bool:
        return any(line.strip() == heading for line in self._body.split("\n"))

    def section_text(self, heading: str) -> str:
        """Return the body text under `## heading`, up to the next `## ` heading or EOF (read-only)."""
        out, capturing = [], False
        for line in self._body.split("\n"):
            if line.strip() == heading:
                capturing = True
                continue
            if capturing and line.startswith("## "):
                break
            if capturing:
                out.append(line)
        return "\n".join(out).strip()

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


def _truthy_flag(value) -> bool:
    """Frontmatter boolean-ish: true/yes/1 (any case, quoted or bare) counts as set."""
    if value is None:
        return False
    return value.strip().strip('"').strip("'").lower() in {"true", "yes", "1"}


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

        # Escalation is durable: a task that flipped opus→fable mid-run has proven non-mechanical,
        # so every later re-dispatch (resume, /wave:repair) must start at fable, not re-pay the
        # opus one-shot toll. Stamped for every status — including landed ones, as the record of
        # what it took. Idempotent via Note.set.
        if task.get("escalated"):
            note.set("model", "fable")

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
        esc = " model=fable(escalated)" if task.get("escalated") else ""
        print(f"{slug}: status={status}{(' pr=' + pr) if pr else ''}{esc}{flag}")

    if args.wave is not None and args.rollout and not errors:
        # Optional convenience: advance the cursor in the same call (only when the caller asserts the
        # wave fully merged — normally `cursor` is a separate post-merge step gated on merge-wave.sh ok).
        _, paused_at = _set_cursor(Path(os.path.expanduser(args.rollout)), args.wave, args.dry_run)
        print(f"cursor: merged_through_wave={args.wave}" + (" (dry-run)" if args.dry_run else ""))
        _print_pause_honoured(paused_at, args.dry_run)

    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- cursor -----------------------------------------------------------------

def _set_cursor(rollout_path: Path, wave: int, dry_run=False):
    """Advance the cursor; honour a pending soft-pause request in the same write.

    Returns (note, paused_at): paused_at is the timestamp stamped when `pause_requested: true`
    was honoured this call, else None. The honour deliberately rides the cursor step — it runs at
    exactly the end-of-wave moment (post-merge), so a soft pause lands on a clean wave boundary
    with zero extra agent calls (execute SKILL.md §Pausing + reinstating a rollout).
    """
    note = Note(rollout_path)
    note.set("merged_through_wave", int(wave), after=("merged_through_wave", "parallel_ceiling", "status"))
    paused_at = None
    if _truthy_flag(note.get("pause_requested")):
        paused_at = datetime.now().astimezone().isoformat(timespec="seconds")
        note.set("paused", paused_at, after=("pause_requested", "merged_through_wave", "status"))
        note.remove("pause_requested")
    note.save(dry_run=dry_run)
    return note, paused_at


def _print_pause_honoured(paused_at, dry_run=False):
    if paused_at:
        print(f"paused={paused_at} (pause_requested honoured — end the wave loop; "
              f"do NOT launch the next wave)" + (" (dry-run)" if dry_run else ""))


def cmd_cursor(args) -> int:
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"ERROR: rollout note not found at {path}", file=sys.stderr)
        return 1
    _, paused_at = _set_cursor(path, args.wave, args.dry_run)
    print(f"merged_through_wave={args.wave}" + (" (dry-run)" if args.dry_run else ""))
    _print_pause_honoured(paused_at, args.dry_run)
    return 0


# ---- mark-done ---------------------------------------------------------------

def cmd_mark_done(args) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    errors = []
    for slug in slugs:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue
        status = note.get("status")
        if status == "done":
            print(f"{slug}: already done [no-change]")
            continue
        if status != "review":
            # Only a `review` note is "landed, awaiting confirmation". Anything else means the
            # caller's picture of the wave is stale — refuse rather than mask a blocked/unmerged task.
            errors.append(f"{slug}: status is {status!r}, not 'review' — refusing to mark done")
            continue
        note.set("status", "done")
        note.save(dry_run=args.dry_run)
        print(f"{slug}: status=done" + (" (dry-run)" if args.dry_run else " [written]"))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


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


# ---- status -----------------------------------------------------------------

def _wikilink_slug(value):
    """Normalise a frontmatter wikilink/string (`"[[Area/Foo|alias]]"`) to a bare slug for comparison."""
    if value is None:
        return None
    s = value.strip().strip('"').strip("'").strip()
    s = s.replace("[[", "").replace("]]", "").strip()
    s = s.split("|")[0].split("/")[-1].strip()  # drop any alias, then any path, keep the leaf
    if s.endswith(".md"):
        s = s[:-3]
    return s or None


def cmd_status(args) -> int:
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    rollout_slug = rollout_path.stem
    rollout_note = Note(rollout_path)
    cursor = rollout_note.get("merged_through_wave")
    try:
        cursor = int(cursor) if cursor is not None else 0
    except (TypeError, ValueError):
        cursor = 0

    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    found = []
    for path in sorted(tasks_dir.rglob("*.md")):  # rglob to catch already-archived done tasks too
        if path == rollout_path:
            continue
        try:
            note = Note(path)
        except ValueError:
            continue  # not a frontmatter note
        if (_wikilink_slug(note.get("rollout")) or "").lower() != rollout_slug.lower():
            continue
        wave = note.get("wave")
        try:
            wave = int(wave) if wave is not None else None
        except (TypeError, ValueError):
            wave = None
        pr = note.get("pr")
        blocker = ""
        for heading in BLOCKED_SECTIONS.values():
            t = note.section_text(heading)
            if t:
                blocker = t
                break
        found.append({
            "slug": path.stem,
            "wave": wave,
            "status": note.get("status"),
            "pr": (pr.strip().strip('"') if pr else None),
            "blockerSummary": blocker,
        })

    found.sort(key=lambda t: (t["wave"] if t["wave"] is not None else 9999, t["slug"]))
    total_waves = max((t["wave"] for t in found if t["wave"] is not None), default=0)
    paused = rollout_note.get("paused")
    out = {
        "rollout": rollout_slug,
        "rolloutPath": str(rollout_path),
        "rolloutStatus": rollout_note.get("status"),
        # Pause state (execute §Pausing): `paused` = the stamp's timestamp when the rollout is
        # paused (render as PAUSED, not stalled); `pause_requested` = a soft pause is pending and
        # takes effect at the next wave boundary.
        "paused": (paused.strip().strip('"').strip("'") or None) if paused else None,
        "pause_requested": _truthy_flag(rollout_note.get("pause_requested")),
        "merged_through_wave": cursor,
        "total_waves": total_waves,
        "tasks": found,
    }
    print(json.dumps(out, indent=2))
    return 0


# ---- resolve ----------------------------------------------------------------

# Only a *blocked* note is resolvable to done out-of-band (the drift gap-closer). `review` -> done is
# mark-done's job; open/in_progress means the task never landed and must not be masked.
RESOLVABLE_STATUSES = set(BLOCKED_SECTIONS.keys())  # review-blocked, blocked, plan-blocked


def cmd_resolve(args) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    errors = []
    for slug in slugs:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue
        status = note.get("status")
        if status == "done":
            print(f"{slug}: already done [no-change]")
            continue
        if status not in RESOLVABLE_STATUSES:
            errors.append(
                f"{slug}: status is {status!r}, not a blocked status "
                f"({'/'.join(sorted(RESOLVABLE_STATUSES))}) — refusing to resolve")
            continue
        note.set("status", "done")
        note.save(dry_run=args.dry_run)
        print(f"{slug}: status={status}->done" + (" (dry-run)" if args.dry_run else " [written]"))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- defer ------------------------------------------------------------------

def cmd_defer(args) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    expected = Path(os.path.expanduser(args.rollout)).stem.lower() if args.rollout else None
    errors = []
    for slug in slugs:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue
        if expected is not None:
            cur = (_wikilink_slug(note.get("rollout")) or "").lower()
            if cur and cur != expected:
                errors.append(f"{slug}: belongs to rollout {cur!r}, not {expected!r} — refusing to defer")
                continue
        note.set("status", "open")
        note.remove("wave")
        note.remove("rollout")
        note.remove("owner")
        note.save(dry_run=args.dry_run)
        print(f"{slug}: deferred->open (wave/rollout/owner cleared)" +
              (" (dry-run)" if args.dry_run else " [written]"))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- clear-pause ------------------------------------------------------------

def cmd_clear_pause(args) -> int:
    """Reinstate: remove `paused:` + any pending `pause_requested` from the rollout note.

    Called by /wave:execute's resume path ONLY when it finds a `paused:` stamp — a pending
    `pause_requested` with no stamp is a live user request that must survive resumes (the heartbeat
    cron re-enters execute's resume, and it must never cancel a pause the user asked for). Clearing
    both here covers the hard-pause-before-honour edge (stamp hand-written while a soft request was
    still pending) so a freshly reinstated rollout doesn't immediately re-pause.
    """
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"ERROR: rollout note not found at {path}", file=sys.stderr)
        return 1
    note = Note(path)
    note.remove("paused")
    note.remove("pause_requested")
    note.save(dry_run=args.dry_run)
    if note.dirty:
        print("pause cleared (paused/pause_requested removed)" +
              (" (dry-run)" if args.dry_run else " [written]"))
    else:
        print("no pause stamp [no-change]")
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

    d = sub.add_parser("mark-done", help="flip task notes review->done after their wave's merge is confirmed")
    d.add_argument("--tasks", required=True, help="comma-separated task slugs (every wave task that ended at review)")
    d.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    d.add_argument("--dry-run", action="store_true")
    d.set_defaults(func=cmd_mark_done)

    f = sub.add_parser("resume-filter", help="print the slugs in a wave that still need dispatch")
    f.add_argument("--tasks", required=True, help="comma-separated task slugs for the target wave")
    f.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    f.set_defaults(func=cmd_resume_filter)

    s = sub.add_parser("status", help="emit JSON situational report for a rollout (read-only; /wave:status)")
    s.add_argument("--rollout", required=True, help="path to the rollout note")
    s.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    s.set_defaults(func=cmd_status)

    rv = sub.add_parser("resolve", help="flip a *blocked* task -> done (drift gap-closer; caller must verify the PR merged)")
    rv.add_argument("--tasks", required=True, help="comma-separated task slugs (must be in a blocked status)")
    rv.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    rv.add_argument("--dry-run", action="store_true")
    rv.set_defaults(func=cmd_resolve)

    df = sub.add_parser("defer", help="pop task(s) out of a rollout back to open backlog (/wave:repair)")
    df.add_argument("--tasks", required=True, help="comma-separated task slugs to defer")
    df.add_argument("--rollout", default=None, help="rollout note path (optional; asserts membership before deferring)")
    df.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    df.add_argument("--dry-run", action="store_true")
    df.set_defaults(func=cmd_defer)

    cp = sub.add_parser("clear-pause", help="reinstate a paused rollout: remove paused/pause_requested (/wave:execute resume)")
    cp.add_argument("--rollout", required=True, help="path to the rollout note")
    cp.add_argument("--dry-run", action="store_true")
    cp.set_defaults(func=cmd_clear_pause)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
