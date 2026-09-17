#!/usr/bin/env python3
"""reconcile-wave.py — deterministic vault bookkeeping for wave-execute (findings #6 + #7).

The Workflow engine (`wave-execute.workflow.js`) returns a structured result; the lead session used to
hand-edit ~5 frontmatter transitions per wave (status + pr + *_rounds_used) plus the cursor advance — 50+
fumble-prone edits across a rollout. This helper performs ALL of those writes deterministically from the
returned task array, and (finding #7) computes the per-task resume set so a partial wave resumes without
re-dispatching already-landed work.

Ten subcommands:

  reconcile   Read the workflow result JSON ({rolloutSlug, tasks:[...]}) and write each task note's
              frontmatter + any blocked-feedback body section. Idempotent (safe to re-run on resume).

  cursor      Set `merged_through_wave: N` on a rollout note (the durable continuous-mode cursor),
              run AFTER merge-wave.sh reports `ok` for wave N. Also the SOFT-PAUSE honour point:
              when the rollout note carries `pause_requested: true`, it stamps `paused: <timestamp>`,
              clears the flag, and prints a `paused=` line — the caller (execute §4.5) must then end
              the wave loop instead of launching the next wave. Riding the cursor step means the
              pause lands on a clean wave boundary with zero extra agent calls. Also the MERGE-side
              wave-boundary timestamp (progress/ETA): stamps `wave_N_merged: <timestamp>` (first
              merge wins) and prints a `progress:` line with elapsed + the rough (~) remaining
              estimate when the rollout carries dispatch stamps.

  mark-dispatched  Stamp `wave_N_dispatched: <timestamp>` on a rollout note at wave launch — the
              DISPATCH-side wave boundary (progress/ETA). First dispatch wins (a resume re-dispatch
              of a partially-landed wave never resets the wave clock); prints the same `progress:`
              line as cursor. The Workflow sandbox has no clock (Date.now() throws), so both wave
              boundaries enter through this script, never the engine.

  mark-done   Flip task notes `status: review` -> `status: done`, run AFTER the wave's merge is
              confirmed (merge-wave.sh `ok` sentinel). `review` means "landed, awaiting confirmation";
              the merge IS that confirmation for PR tasks, and the wave completing is it for read-only
              tasks (master-review approval, nothing to merge). Refuses any note at another status —
              a blocked/unmerged task can never be swept to done. Idempotent (already-done = no-op).

  resume-filter  Given a wave's task slugs, print (one per line) the slugs that still need dispatch —
              i.e. whose current note status is NOT already landed/approved ({done, review, merged}).
              This is the per-task resume rule: the task-note status is the source of truth, so a wave
              that returned one approved + one blocked resumes by re-dispatching only the blocked one.

  status      Read-only situational scan for /thread:status. Given a rollout note, find every task note
              carrying `rollout: [[<this-rollout>]]` (glob-by-backlink — captures read-only tasks the
              `## File-sets` block omits) and emit JSON {rollout, merged_through_wave, status, timeline,
              tasks: [{slug, wave, status, pr, blockerSummary}]}. `timeline` is the progress/ETA block
              computed from the wave_N_dispatched/wave_N_merged stamps (null when the note has none) —
              durable, so elapsed + the rough estimate render without any workflow run being alive.
              Pure read; no network (the skill owns gh/git).

  resolve     Flip a *blocked* task (review-blocked/blocked/plan-blocked) -> done. The gap-closer for
              the drift case (a blocked note whose PR actually merged out-of-band). Refuses any note
              that isn't in a blocked state — the CALLER (the /thread:repair skill) must have verified
              the work truly landed (e.g. `gh pr view` shows MERGED) before invoking. Idempotent.

  defer       Pop task(s) out of a rollout, back to open backlog: clears `wave:`/`rollout:`/`owner:`
              and sets `status: open` so a future /thread:schedule re-plans them. The dependent-closure
              safety check lives in the /thread:repair skill; this only does the frontmatter surgery.

  clear-pause Reinstate a paused rollout: remove the `paused:` stamp (and any pending
              `pause_requested`) from the rollout note. Run by /thread:execute's resume path when it
              finds a `paused:` stamp — reinstating IS plain re-invocation, so there is no separate
              resume command. Idempotent (no stamp = no-op).

  approve-gates  Sign off a gate-pending task's declared gated inputs (ADR 0008): move the bullets
              under "## Gated inputs (awaiting sign-off)" into "## Approved gates" with a sign-off
              date (gate + cap + sign-off — the durable record the engine reads via task.approvedGates
              so re-dispatches never re-ask those exact gates), remove the pending section, and flip
              the note back to in_progress so resume-filter re-dispatches it. Refuses a note that
              isn't gate-pending; idempotent once approved (already-approved note = no-op). Run by
              the lead session ONLY after the human explicitly signs off — never unattended.

Stdlib only (the claude-config repo has no dependency manager). Frontmatter is edited line-surgically
(not via a YAML round-trip) to preserve field order, comments, and spacing exactly — matching how the
rest of the vault tooling treats frontmatter.

Status mapping (workflow status -> note writes), per wave-execute/SKILL.md §6:
  review         -> status: review;        pr: <url>; review_rounds_used: <n>; plan_rounds_used: <n> (if >0);
                    when approvedAtCeiling: append reviewHistory (grouped by round) under
                    "## Review history (approved at ceiling)" — ceiling approvals stay auditable
  review-blocked -> status: review-blocked; pr: <url>; append reviewHistory (grouped by round; legacy
                    results without it fall back to final-round reviewFeedback) under "## Review-blocked feedback"
  blocked        -> status: blocked;        append blockerDiagnosis under "## Blocker diagnosis" (if absent)
  plan-blocked   -> status: plan-blocked;   append blockerDiagnosis under "## Plan-blocked feedback"
  gate-pending   -> status: gate-pending;   UPSERT gatedInputs under "## Gated inputs (awaiting sign-off)"
                    (upsert, not append: a refreshed declaration replaces the pending list, never stales)
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

# Gated inputs (ADR 0008): a task the engine paused for human sign-off of declared gates. Deliberately
# NOT in BLOCKED_SECTIONS — `resolve` must never flip an unsigned gate to done, and resume-filter must
# never auto-redispatch one (only approve-gates makes it dispatchable again).
GATE_PENDING_STATUS = "gate-pending"
GATE_PENDING_SECTION = "## Gated inputs (awaiting sign-off)"
APPROVED_GATES_SECTION = "## Approved gates"

# Review-loop memory (2026-08-14): an approval on the FINAL review round with real rejection history
# (engine flag approvedAtCeiling) persists the accumulated by-round rationale — previously only
# blocked outcomes wrote anything, so ceiling approvals were unauditable. An AUDIT RECORD, not an
# instruction: deliberately absent from the engine's PRIOR_FEEDBACK_NOTE authoritative-sections list
# (a landed task is never re-dispatched).
REVIEW_HISTORY_SECTION = "## Review history (approved at ceiling)"

# Every workflow status with a body section to write (reconcile) or scan (status).
SECTION_BY_STATUS = {**BLOCKED_SECTIONS, GATE_PENDING_STATUS: GATE_PENDING_SECTION}

# Matches the "(approved <date>)" sign-off annotation approve-gates appends to a gate line.
GATE_ANNOT_RE = re.compile(r"\s*\(approved [^)]*\)\s*$", re.I)

# Wave-boundary timestamp fields (progress/ETA). Deliberately FLAT per-wave frontmatter keys —
# the human-decided shape (task note "## Repair input", 2026-07-18): matches this script's
# line-surgical editing (no nested-YAML surgery), individually queryable, trivially greppable.
# Never a nested `timeline:` map.
WAVE_STAMP_RE = re.compile(r"^wave_(\d+)_(dispatched|merged):\s*(.*)$")


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

    def unset(self, key: str):
        """Remove `key:` from the frontmatter entirely. Idempotent; used to retire a marker that a
        later, better-informed run has superseded (a stale marker is triaged against, so leaving one
        is worse than never writing it)."""
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        kept = [line for line in self._fm if not pat.match(line)]
        if len(kept) != len(self._fm):
            self._fm = kept
            self.dirty = True

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

    def _section_bounds(self, heading: str):
        """(start, end) line indices of `## heading` + its content, or None if absent."""
        lines = self._body.split("\n")
        for i, line in enumerate(lines):
            if line.strip() == heading:
                end = i + 1
                while end < len(lines) and not lines[end].startswith("## "):
                    end += 1
                return lines, i, end
        return None

    def upsert_section(self, heading: str, content: str):
        """Create `## heading` with content, or REPLACE the existing section's content in place
        (unlike append_section's heading-idempotence — for sections whose content must track the
        latest state, e.g. a refreshed gated-inputs declaration). Idempotent on identical content."""
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, content)
            return
        lines, start, end = found
        new_lines = lines[:start + 1] + [""] + content.rstrip().split("\n") + [""] + lines[end:]
        new_body = "\n".join(new_lines)
        if new_body != self._body:
            self._body = new_body
            self.dirty = True

    def remove_section(self, heading: str):
        """Delete `## heading` and its content from the body (idempotent — no-op if absent)."""
        found = self._section_bounds(heading)
        if found is None:
            return
        lines, start, end = found
        while start > 0 and not lines[start - 1].strip():
            start -= 1  # absorb the blank gap above the heading so removal leaves no double gap
        head, tail = lines[:start], lines[end:]
        if head and tail and head[-1].strip():
            head.append("")  # keep one blank line between the neighbours we just joined
        if head and not tail:
            head.append("")  # section was last — preserve the trailing newline
        self._body = "\n".join(head + tail)
        self.dirty = True

    def render(self) -> str:
        return "---\n" + "\n".join(self._fm) + "\n---\n" + self._body

    def save(self, dry_run=False):
        if dry_run or not self.dirty:
            return
        self.path.write_text(self.render())


def bullets(items):
    return "\n".join(f"- {s}" for s in items if str(s).strip())


def history_block(history):
    """Grouped by-round review history (engine reviewHistory: [{round, feedback: []}], latest last)."""
    rounds = []
    for entry in history or []:
        body = bullets(entry.get("feedback") or [])
        if body:
            rounds.append(f"Round {entry.get('round', '?')}:\n{body}")
    return "\n\n".join(rounds)


def _truthy_flag(value) -> bool:
    """Frontmatter boolean-ish: true/yes/1 (any case, quoted or bare) counts as set."""
    if value is None:
        return False
    return value.strip().strip('"').strip("'").lower() in {"true", "yes", "1"}


def _int_field(value, default):
    """Parse an int-ish frontmatter value, tolerating quotes and inline `# comments`."""
    if value is None:
        return default
    s = str(value).split("#", 1)[0].strip().strip('"').strip("'")
    try:
        return int(s)
    except ValueError:
        return default


# ---- progress / ETA (wave-boundary timestamps) ------------------------------
# The Workflow engine cannot read clocks (Date.now() throws in its sandbox), so wall-clock enters
# here: mark-dispatched stamps `wave_N_dispatched:` at wave launch, the cursor step stamps
# `wave_N_merged:` post-merge, and everything below is IN-ROLLOUT arithmetic over those stamps —
# average task convergence time from this rollout's completed waves x remaining dispatch chunks at
# the parallel ceiling. Deliberately rough (always rendered with `~` + "rough"): no cross-rollout
# stats file, no calibration — the task-note spec forbids false precision.

def _parse_ts(value):
    """ISO timestamp from a frontmatter value, or None. Naive values are assumed local time."""
    s = (value or "").strip().strip('"').strip("'")
    if not s:
        return None
    try:
        ts = datetime.fromisoformat(s)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.astimezone()


def _now_stamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _fmt_min(minutes) -> str:
    """42 -> '42m', 84 -> '1h 24m', 120 -> '2h'."""
    m = max(0, int(round(minutes)))
    if m < 60:
        return f"{m}m"
    h, r = divmod(m, 60)
    return f"{h}h {r}m" if r else f"{h}h"


def _rough_label(minutes, infix: str = "") -> str:
    """The single rendering of the remaining estimate — always '~<duration>[infix] (rough)'.
    Both `remainingLabel` and the progress line derive from here so the 'always labelled
    rough' invariant has one source and the two renderings can never drift."""
    return f"~{_fmt_min(minutes)}{infix} (rough)"


def _wave_stamps(note) -> dict:
    """{(wave:int, 'dispatched'|'merged'): datetime} for every parseable wave-boundary stamp."""
    out = {}
    for line in note._fm:
        m = WAVE_STAMP_RE.match(line)
        if m:
            ts = _parse_ts(m.group(3))
            if ts is not None:
                out[(int(m.group(1)), m.group(2))] = ts
    return out


def _linked_task_notes(rollout_path: Path, tasks_dir: Path):
    """(path, Note) for every task note carrying `rollout: [[<slug>]]` for this rollout
    (glob-by-backlink — captures read-only tasks the `## File-sets` block omits). Shared by
    `status` and the timeline computation."""
    rollout_slug = rollout_path.stem
    out = []
    for path in sorted(tasks_dir.rglob("*.md")):  # rglob to catch already-archived done tasks too
        if path == rollout_path:
            continue
        try:
            note = Note(path)
        except ValueError:
            continue  # not a frontmatter note
        if (_wikilink_slug(note.get("rollout")) or "").lower() != rollout_slug.lower():
            continue
        out.append((path, note))
    return out


def _compute_timeline(note, tasks_dir: Path, now=None):
    """The progress/ETA block for a rollout note, or None when it has no wave-boundary stamps
    (pre-timestamps rollouts stay renderable — callers omit timing rather than guessing).

    A wave counts toward the average only when BOTH stamps are present; the per-task time is
    approximated as wave duration / dispatch chunks (ceil(tasks/ceiling) — parallel tasks share
    wall-clock), and the remaining estimate is that average x the chunks still ahead of the
    cursor. Rough by design."""
    stamps = _wave_stamps(note)
    if not stamps:
        return None
    now = now or datetime.now().astimezone()

    counts = {}
    for _path, tn in _linked_task_notes(note.path, tasks_dir):
        w = _int_field(tn.get("wave"), None)
        if w is not None:
            counts[w] = counts.get(w, 0) + 1
    ceiling = max(1, _int_field(note.get("parallel_ceiling"), 4) or 4)
    cursor = _int_field(note.get("merged_through_wave"), 0) or 0
    total = max([*counts, *(w for w, _kind in stamps)], default=0)

    def chunks(w):  # dispatch chunks a wave needs at this ceiling (unknown task count => 1)
        return max(1, -(-counts.get(w, 1) // ceiling))

    waves, completed_min, completed_chunks = [], 0.0, 0
    for w in range(1, total + 1):
        d, m = stamps.get((w, "dispatched")), stamps.get((w, "merged"))
        dur = (m - d).total_seconds() / 60.0 if d and m else None
        if dur is not None and dur >= 0:
            completed_min += dur
            completed_chunks += chunks(w)
        else:
            dur = None  # negative (hand-edited/clock-skewed) stamps carry no signal
        waves.append({
            "wave": w,
            "tasks": counts.get(w),
            "dispatched": d.isoformat(timespec="seconds") if d else None,
            "merged": m.isoformat(timespec="seconds") if m else None,
            "durationMinutes": int(round(dur)) if dur is not None else None,
        })

    first_dispatch = min((ts for (_w, k), ts in stamps.items() if k == "dispatched"), default=None)
    last_merged = max((ts for (_w, k), ts in stamps.items() if k == "merged"), default=None)
    complete = total > 0 and cursor >= total
    elapsed = None
    if first_dispatch is not None:
        end = last_merged if (complete and last_merged) else now
        elapsed = max(0.0, (end - first_dispatch).total_seconds() / 60.0)

    avg_task = (completed_min / completed_chunks) if completed_chunks else None
    remaining_chunks = sum(chunks(w) for w in range(cursor + 1, total + 1))
    remaining = avg_task * remaining_chunks if (avg_task is not None and remaining_chunks and not complete) else None

    return {
        "waves": waves,
        "totalWaves": total,
        "mergedThroughWave": cursor,
        "elapsedMinutes": int(round(elapsed)) if elapsed is not None else None,
        "elapsedLabel": _fmt_min(elapsed) if elapsed is not None else None,
        "avgTaskMinutes": round(avg_task, 1) if avg_task is not None else None,
        "remainingEstimateMinutes": int(round(remaining)) if remaining is not None else None,
        "remainingLabel": _rough_label(remaining) if remaining is not None else None,
        "complete": complete,
    }


def _progress_line(note, tasks_dir: Path, event: str, wave: int):
    """One `progress:` line for a wave boundary ('dispatched' | 'merged'), or None when the rollout
    has no dispatch stamp yet (pre-timestamps rollouts: output stays byte-stable). The skill relays
    this line to the user and threads it into the engine's `progress` arg for a live log()."""
    if wave < 1:
        # Wave 0 is the pre-wave-1 cursor position (pause-honour on a partially-landed wave 1) —
        # no wave 0 was ever dispatched or merged, so any progress claim about it would be false.
        return None
    if not any(kind == "dispatched" for _w, kind in _wave_stamps(note)):
        # No dispatch anchor -> elapsed can never render. Return BEFORE _compute_timeline so the
        # stampless path never rglob-scans tasks_dir (byte-stable in behaviour, not just bytes).
        return None
    tl = _compute_timeline(note, tasks_dir)
    if tl is None or tl["elapsedLabel"] is None:
        return None
    total = tl["totalWaves"] or "?"
    if event == "merged" and tl["complete"]:
        return f"progress: wave {wave}/{total} merged — rollout complete in {tl['elapsedLabel']}"
    line = f"progress: wave {wave}/{total} {event} — {tl['elapsedLabel']} elapsed"
    if tl["remainingEstimateMinutes"] is not None:
        line += ", " + _rough_label(tl["remainingEstimateMinutes"], infix=" remaining")
    return line


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
        if status not in ("review", "review-blocked", "blocked", "plan-blocked", GATE_PENDING_STATUS):
            errors.append(f"{slug}: unexpected workflow status {status!r} — left untouched")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue

        note.set("status", status)

        # Escalation is durable: a task that flipped opus→fable mid-run has proven non-mechanical,
        # so every later re-dispatch (resume, /thread:repair) must start at fable, not re-pay the
        # opus one-shot toll. Stamped for every status — including landed ones, as the record of
        # what it took. Idempotent via Note.set.
        if task.get("escalated"):
            note.set("model", "fable")

        # A tier ceiling (args.maxTier, ADR 0016) suppressed an escalation this task would otherwise
        # have taken. That has to be DURABLE: /thread:status and /thread:repair build their triage
        # entirely from note frontmatter, so without a stamp a capped block reads as a genuine wall
        # and is never re-dispatched once the higher tier's quota returns. Deliberately NOT `model:
        # fable` — the run could not use that tier, and stamping it would send the next dispatch
        # straight back into the exhausted quota.
        if task.get("tierCapped"):
            note.set("tier_capped", (task.get("tierCappedAt") or "true"))
        elif note.get("tier_capped"):
            # An uncapped re-run that got further supersedes the old marker rather than leaving a
            # stale one to be triaged against.
            note.unset("tier_capped")

        pr = (task.get("prUrl") or "").strip()
        if status in STATUS_WITH_PR and pr:
            note.set("pr", pr)
        if status == "review":
            note.set("review_rounds_used", int(task.get("reviewRoundsUsed") or 0))
            plan_rounds = int(task.get("planRoundsUsed") or 0)
            if plan_rounds > 0:
                note.set("plan_rounds_used", plan_rounds)
            # Ceiling approval: persist the accumulated rejection rationale (audit record; the engine
            # sets the flag only when there IS history — a clean first-try approve records nothing).
            # append_section is heading-idempotent, so a re-reconcile never duplicates it.
            if task.get("approvedAtCeiling"):
                history = history_block(task.get("reviewHistory"))
                if history:
                    note.append_section(REVIEW_HISTORY_SECTION, history)

        if status in SECTION_BY_STATUS:
            heading = SECTION_BY_STATUS[status]
            if status == "review-blocked":
                # Full grouped history when the engine provides it (review-loop memory) — the
                # re-dispatched agent treats this section as authoritative and must see every round,
                # not just the last. Legacy results (pre-2.0.3 engine) fall back to the final bullets.
                content = history_block(task.get("reviewHistory")) or bullets(task.get("reviewFeedback") or [])
            elif status == GATE_PENDING_STATUS:
                content = bullets(task.get("gatedInputs") or []) or (task.get("blockerDiagnosis") or "").strip()
            else:
                content = (task.get("blockerDiagnosis") or "").strip()
            if content:
                if status == GATE_PENDING_STATUS:
                    # Upsert, not append: a re-planned task may declare a DIFFERENT gate set (e.g. a
                    # revised cap) — the pending list must always be the latest declaration, never stale.
                    note.upsert_section(heading, content)
                else:
                    note.append_section(heading, content)

        note.save(dry_run=args.dry_run)
        flag = " (dry-run)" if args.dry_run else (" [written]" if note.dirty else " [no-change]")
        esc = " model=fable(escalated)" if task.get("escalated") else ""
        esc += f" tier_capped={task.get('tierCappedAt') or 'true'}" if task.get("tierCapped") else ""
        print(f"{slug}: status={status}{(' pr=' + pr) if pr else ''}{esc}{flag}")

    if args.wave is not None and args.rollout and not errors:
        # Optional convenience: advance the cursor in the same call (only when the caller asserts the
        # wave fully merged — normally `cursor` is a separate post-merge step gated on merge-wave.sh ok).
        rollout_note, paused_at = _set_cursor(Path(os.path.expanduser(args.rollout)), args.wave, args.dry_run)
        print(f"cursor: merged_through_wave={args.wave}" + (" (dry-run)" if args.dry_run else ""))
        line = _progress_line(rollout_note, tasks_dir, "merged", args.wave)
        if line:
            print(line)
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
    # Merge-side wave-boundary timestamp (progress/ETA). First merge wins: an idempotent cursor
    # re-run (cold resume, pause-honour re-set) must never shift a recorded boundary. Wave 0 is
    # the pre-wave-1 cursor position (pause-honour re-set on a partially-landed wave 1) — nothing
    # merged, so a `wave_0_merged` stamp would be junk the engine loop never owns; skip it.
    if int(wave) >= 1:
        stamp_key = f"wave_{int(wave)}_merged"
        if note.get(stamp_key) is None:
            note.set(stamp_key, _now_stamp(),
                     after=(f"wave_{int(wave)}_dispatched", "merged_through_wave", "parallel_ceiling", "status"))
    paused_at = None
    if _truthy_flag(note.get("pause_requested")):
        paused_at = _now_stamp()
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
    note, paused_at = _set_cursor(path, args.wave, args.dry_run)
    print(f"merged_through_wave={args.wave}" + (" (dry-run)" if args.dry_run else ""))
    line = _progress_line(note, Path(os.path.expanduser(args.tasks_dir)), "merged", args.wave)
    if line:
        print(line)
    _print_pause_honoured(paused_at, args.dry_run)
    return 0


# ---- mark-dispatched --------------------------------------------------------

def cmd_mark_dispatched(args) -> int:
    """Stamp the dispatch-side wave boundary (`wave_N_dispatched:`) at wave launch (execute §4.5
    step 1). First dispatch wins — a resume re-dispatch of a partially-landed wave must NOT reset
    the wave clock, or completed-wave durations would drift under the estimate's feet."""
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"ERROR: rollout note not found at {path}", file=sys.stderr)
        return 1
    note = Note(path)
    key = f"wave_{args.wave}_dispatched"
    existing = note.get(key)
    if existing is not None:
        print(f"{key}={existing} [no-change]")
    else:
        ts = _now_stamp()
        note.set(key, ts, after=(f"wave_{args.wave - 1}_merged", f"wave_{args.wave - 1}_dispatched",
                                 "merged_through_wave", "parallel_ceiling", "status"))
        note.save(dry_run=args.dry_run)
        print(f"{key}={ts}" + (" (dry-run)" if args.dry_run else " [written]"))
    line = _progress_line(note, Path(os.path.expanduser(args.tasks_dir)), "dispatched", args.wave)
    if line:
        print(line)
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
        if status == GATE_PENDING_STATUS:
            # Awaiting a human sign-off (ADR 0008) — auto-resume (heartbeat included) must never burn a
            # dispatch on, or bypass, a pending gate. approve-gates flips it back to dispatchable.
            print(f"WARN: {slug}: gate-pending (gated inputs await human sign-off) — excluded from "
                  f"dispatch; run approve-gates after the sign-off", file=sys.stderr)
            continue
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
    for path, note in _linked_task_notes(rollout_path, tasks_dir):
        wave = note.get("wave")
        try:
            wave = int(wave) if wave is not None else None
        except (TypeError, ValueError):
            wave = None
        pr = note.get("pr")
        blocker = ""
        for heading in SECTION_BY_STATUS.values():  # includes the pending-gates section (gate-pending)
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
        # Progress/ETA from the wave_N_dispatched/merged stamps — durable on the note, so elapsed
        # + the rough (~) remaining estimate render with no workflow run alive. null when the
        # rollout predates the stamps (callers omit timing rather than guessing).
        "timeline": _compute_timeline(rollout_note, tasks_dir),
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


# ---- approve-gates ----------------------------------------------------------

def _norm_gate(line: str) -> str:
    """Normalise a gate line for duplicate detection: bullet + sign-off annotation stripped,
    whitespace collapsed, case-folded (mirrors the engine's normalizeGate — a changed cap is
    a DIFFERENT gate)."""
    s = re.sub(r"^[-*]\s+", "", line.strip())
    s = GATE_ANNOT_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def cmd_approve_gates(args) -> int:
    """Record the human sign-off for a gate-pending task's declared gated inputs (ADR 0008).

    The CALLER's contract: run this only after the user explicitly signed off the gates in
    conversation — the sign-off itself is the one decision no agent may make.
    """
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    date = args.date or datetime.now().astimezone().date().isoformat()
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
        pending = note.section_text(GATE_PENDING_SECTION)
        if status != GATE_PENDING_STATUS:
            if note.has_heading(APPROVED_GATES_SECTION) and not pending:
                print(f"{slug}: gates already approved [no-change]")
                continue
            errors.append(f"{slug}: status is {status!r}, not {GATE_PENDING_STATUS!r} — refusing to approve gates")
            continue
        gates = [re.sub(r"^[-*]\s+", "", l.strip()) for l in pending.split("\n") if l.strip()]
        if not gates:
            errors.append(f"{slug}: no gates under {GATE_PENDING_SECTION!r} — nothing to sign off")
            continue
        existing = [l for l in note.section_text(APPROVED_GATES_SECTION).split("\n") if l.strip()]
        have = {_norm_gate(l) for l in existing}
        merged = existing + [f"- {g} (approved {date})" for g in gates if _norm_gate(g) not in have]
        note.upsert_section(APPROVED_GATES_SECTION, "\n".join(merged))
        note.remove_section(GATE_PENDING_SECTION)
        note.set("status", "in_progress")
        note.save(dry_run=args.dry_run)
        print(f"{slug}: {len(gates)} gate(s) approved (signed off {date}) -> status in_progress"
              + (" (dry-run)" if args.dry_run else " [written]"))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- clear-pause ------------------------------------------------------------

def cmd_clear_pause(args) -> int:
    """Reinstate: remove `paused:` + any pending `pause_requested` from the rollout note.

    Called by /thread:execute's resume path ONLY when it finds a `paused:` stamp — a pending
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

    c = sub.add_parser("cursor", help="set merged_through_wave:N + stamp wave_N_merged on a rollout note (post-merge)")
    c.add_argument("--rollout", required=True)
    c.add_argument("--wave", type=int, required=True)
    c.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir for the progress line's per-wave task counts")
    c.add_argument("--dry-run", action="store_true")
    c.set_defaults(func=cmd_cursor)

    mdp = sub.add_parser("mark-dispatched", help="stamp wave_N_dispatched on a rollout note at wave launch (first dispatch wins)")
    mdp.add_argument("--rollout", required=True)
    mdp.add_argument("--wave", type=int, required=True)
    mdp.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir for the progress line's per-wave task counts")
    mdp.add_argument("--dry-run", action="store_true")
    mdp.set_defaults(func=cmd_mark_dispatched)

    d = sub.add_parser("mark-done", help="flip task notes review->done after their wave's merge is confirmed")
    d.add_argument("--tasks", required=True, help="comma-separated task slugs (every wave task that ended at review)")
    d.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    d.add_argument("--dry-run", action="store_true")
    d.set_defaults(func=cmd_mark_done)

    f = sub.add_parser("resume-filter", help="print the slugs in a wave that still need dispatch")
    f.add_argument("--tasks", required=True, help="comma-separated task slugs for the target wave")
    f.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    f.set_defaults(func=cmd_resume_filter)

    s = sub.add_parser("status", help="emit JSON situational report for a rollout (read-only; /thread:status)")
    s.add_argument("--rollout", required=True, help="path to the rollout note")
    s.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    s.set_defaults(func=cmd_status)

    rv = sub.add_parser("resolve", help="flip a *blocked* task -> done (drift gap-closer; caller must verify the PR merged)")
    rv.add_argument("--tasks", required=True, help="comma-separated task slugs (must be in a blocked status)")
    rv.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    rv.add_argument("--dry-run", action="store_true")
    rv.set_defaults(func=cmd_resolve)

    df = sub.add_parser("defer", help="pop task(s) out of a rollout back to open backlog (/thread:repair)")
    df.add_argument("--tasks", required=True, help="comma-separated task slugs to defer")
    df.add_argument("--rollout", default=None, help="rollout note path (optional; asserts membership before deferring)")
    df.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    df.add_argument("--dry-run", action="store_true")
    df.set_defaults(func=cmd_defer)

    cp = sub.add_parser("clear-pause", help="reinstate a paused rollout: remove paused/pause_requested (/thread:execute resume)")
    cp.add_argument("--rollout", required=True, help="path to the rollout note")
    cp.add_argument("--dry-run", action="store_true")
    cp.set_defaults(func=cmd_clear_pause)

    ag = sub.add_parser("approve-gates", help="record the human sign-off for a gate-pending task's gated inputs (ADR 0008)")
    ag.add_argument("--tasks", required=True, help="comma-separated task slugs (must be at status gate-pending)")
    ag.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR))
    ag.add_argument("--date", default=None, help="sign-off date stamped on each gate (default: today)")
    ag.add_argument("--dry-run", action="store_true")
    ag.set_defaults(func=cmd_approve_gates)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
