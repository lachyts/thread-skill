#!/usr/bin/env python3
"""reconcile-rollout.py — deterministic vault bookkeeping for a rollout's queue (ADR 0030).

The Workflow engine (`task.workflow.js`) returns a structured result per task call, and the lead session
used to hand-edit the frontmatter transitions (status + pr + *_rounds_used). This helper performs every
one of those writes deterministically, and reads the rollout's progress back from the task notes: there
is no stored cursor (ADR 0030). A task note's `status:` plus its `started:` / `merged:` / `integrating:`
stamps ARE the rollout's state; its `ready:` stamp and `## Integration log` are the durable record of the
task's Integrations (p12-16).

Subcommands:

  reconcile   Read the workflow result JSON ({rolloutSlug, tasks:[...]}) and write each task note's
              frontmatter + its feedback section. Idempotent (safe to re-run on resume). A `review` row
              whose scope is read-only and that carries no PR is written `status: done` and stamped
              `merged:` (the first stamp wins): a read-only task is done when its review approves and
              never enters Integration. Every row removes `integrating:` (the run that produced the row
              ended any Integration). It also stamps `ready:` and appends the `## Integration log` line
              (see the Status mapping below).

  next        Which tasks start now. Given the rollout note, print one JSON object: the tasks to start
              and restart within the parallel ceiling, every held task with its reason, the running,
              awaiting-Integration, integrating and set-aside tasks, the pause state, the halt verdict
              and the progress line. Notes are re-read on every call, so a `priority:` edit reorders a
              live queue. Schedule order is each task's first wikilink on a list-item or table-row line
              of the rollout body; prose and fenced code never rank. Honours a soft pause: once nothing
              runs, awaits or integrates (a held RACE whose `integrating:` stands included, Race holds
              below), it stamps `paused:` and removes `pause_requested` (the drain, ADR 0030 decision 5).
              Refuses an incomplete rollout (below): exit 1, no stdout, one ERROR line naming why and the
              remedy, `/thread:schedule <its first project> --regenerate`.

  mark-started     Stamp `started: <time>` on task notes as they start (the first start wins) and remove
              `integrating:`. The Workflow sandbox has no clock, so wall-clock enters here. It also consumes
              approve-gates' `gates_signed:` marker (p12-14): when the note carries one, it is removed and a
              second line `<slug>: signed-gate restart (gates signed <stamp>) ...` is printed, so the lead
              prints execute § 3.7's fresh-call warning only on the restart that directly follows a sign-off.

  mark-integrating Stamp `integrating: <time>` on a `review` note with a `pr:` as its Integration begins
              (the first wins): the durable signal /thread:status reads.

  mark-done   Flip task notes `status: review` -> `status: done`, run AFTER the task's merge is confirmed.
              Stamps `merged: <time>` on a PR task with no stamp yet and removes `integrating:`. Refuses
              any note at another status — a blocked/unmerged task can never be swept to done.
              Idempotent (already-done = no-op). Read-only tasks never need it: reconcile writes them done
              (and stamps `merged:`) on approval.

  hand-back   A set-aside task re-enters the queue at the stage it stopped (ADR 0030 decision 4; the lead's
              *Set aside* and "retry [[task]]", and /thread:repair § 4's hand-off). A `blocked` note set
              aside at Integration (its latest `## Blocker diagnosis` run starts `integration:`) with a `pr:`
              goes back to `status: review` with `ready:` restamped (it rejoins the Integration queue); a
              `blocked`, `review-blocked` or `plan-blocked` note set aside at its run, and a code-writing
              `review` note with no `pr:` (approved without a PR, which the queue sets aside at its run),
              go to `status: in_progress` with `owner:` removed (the next `next --running` restarts it, and
              its own call re-runs on the existing tree and branch). Refuses (exit 1, nothing written) every
              other note: gate-pending (approve-gates' job), done, review with a PR (awaiting Integration),
              a read-only review note, in_progress, open, and a note set aside at Integration with no `pr:`.
              A task an undecided RACE or UNVERIFIED holds (Race holds, below; read on the rollout its
              `rollout:` names) is refused first, --dry-run included: exit 2, one ERROR line per held task
              naming it and `/thread:repair [[<rollout>]]`, and nothing written for any listed task.
              Feedback runs and the Integration log are never touched.

  log-integration  The lead's own clean-path Integration record (p12-9): append one `integrated path=lead`
              line to a `review` note with a `pr:` through _integration_log_line, from --started (the
              lead's `lead-integrate.py stamp` at the Integration's start), --anchor, --head and --base
              (40 hex each). wait = --started - `ready:`, duration = --now - --started, both in whole
              minutes (_whole_minutes, the engine's wholeMinutes); triggers `-`. A re-run of the same
              Integration (same --started and SHAs) is a no-op, even at a later --now. Changes no status,
              rounds, `rung:`, `integrating:` or `ready:`. Refuses (exit 1, nothing written) a note
              that is not `review` with a `pr:`, a SHA that is not 40 hex and a --started that is not an
              ISO stamp.

  resume      A task whose PR merged but whose note was never marked (p6-8): for each linked note that
              is not done, merged or dropped and carries `pr:`, ask gh for the PR's state and base. A PR
              MERGED into the repo's default branch flips the note to done with `merged:` from mergedAt.
              Anything else (merged into another base, OPEN, CLOSED) is reported and left alone. A task an
              undecided RACE or UNVERIFIED holds (Race holds, below) is skipped before any gh call: one
              stderr `HOLD:` line names it and `/thread:repair`, the note is untouched, and the verb exits
              3 (which takes precedence over 1; ERROR lines still print).

  status      Read-only situational scan for /thread:status. Given a rollout note, find every task note
              carrying `rollout: [[<this-rollout>]]` (glob-by-backlink — captures read-only tasks the
              `## File-sets` block omits) and emit JSON {rollout, rolloutPath, rolloutStatus, paused,
              pause_requested, incomplete, ceiling, counts, progress, timeline, tasks}; `incomplete` is
              why the rollout must not run as written (below), or null. Pure read; no network.

  touched-phases  Read-only, for /thread:execute's completion ceremony (ADR 0026): given a rollout note,
              walk the same backlinked task notes as `status` (archived ones included) and print one
              `--project <slug> --phases <N,M,...>` line per project slug, slugs and phases sorted, for
              every task named `<slug>-p<N>-*`. Loose tasks are ignored; nothing linked prints nothing.
              Each line is the argument list for `reconcile-project.py <line> --kinds phase --apply`,
              so only phases this rollout touched are ever closed.

  defer       Pop task(s) out of a rollout, back to open backlog: clears `rollout:`/`owner:`, a legacy `wave:`
              and the `started:`/`merged:`/`integrating:`/`ready:`/`gates_signed:` stamps (first-start-wins would otherwise carry a
              stale clock into the next rollout), and sets `status: open` so a future /thread:schedule
              re-plans them. The dependent-closure safety check lives in the /thread:repair skill.

  carry       A supersede's carry (ADR 0030; /thread:schedule step 6, and § 0 finishing an interrupted
              supersede): re-point every unlanded task of the prior rollout (--from, a path) to the rollout
              that supersedes it (--to, a path). Each linked note (the notes `status` reads, root and Archive)
              is classified by its queue state: queued, running, awaiting-integration, integrating and
              set-aside ones are carried (`rollout: "[[<to>]]"` in place; `owner:`, `integrating:` and a
              legacy `wave:` removed; nothing else changes), merged, folded and other ones are kept. It never
              writes the prior note: closing it out is schedule step 7.5's. Prints one `carry <slug> <state>`
              or `keep <slug> <state>` line per linked note, sorted by slug, then `[no-change]`,
              `[written: <n>]` or `(dry-run)`. --dry-run previews and needs no --to. Refuses (exit 2,
              nothing written, one ERROR line): a --from that is missing, unparseable, not tagged `rollout`,
              done or dropped (unless done with `superseded_by:` naming --to: a re-run), or neither paused
              nor never started; a --from with a task an undecided RACE or UNVERIFIED holds (--dry-run
              included; the line names each held slug and `/thread:repair [[<from>]]`); a --to that is
              missing, not directly in the tasks dir, untagged, done or
              dropped, whose `supersedes:` does not name --from, that is --from, or that is not never
              started; no --to without --dry-run. A failed save is exit 1 at once: the prior note is still
              open, so the next unfinished-rollout check pairs the two notes as interrupted.

  verify-timeout  Read-only, for /thread:execute § 3's once-per-entry check (p14-2): given a rollout note,
              print one JSON line {"verifyTimeout": N, "harnessTimeoutMs": (N + 600) * 1000} from its
              `verify_timeout` frontmatter (an integer from 1 to 6600; absent -> 1800; a quoted value or a
              trailing ` # comment` is read as `parallel_ceiling` is). Anything else, or no note: one ERROR
              line on stderr, exit 1, no stdout. Only the rollout note is read.

  clear-pause Reinstate a paused rollout: remove the `paused:` stamp (and any pending
              `pause_requested`) from the rollout note. Run by /thread:execute's resume path when it
              finds a `paused:` stamp — reinstating IS plain re-invocation, so there is no separate
              resume command. Idempotent (no stamp = no-op).

  approve-gates  Sign off a gate-pending task's declared gated inputs (ADR 0008): move the bullets
              under "## Gated inputs (awaiting sign-off)" into "## Approved gates" with a sign-off
              date (gate + cap + sign-off — the durable record the engine reads via task.approvedGates
              so re-dispatches and resumes never re-ask those exact gates), remove the pending section,
              and flip the note by the stage it stopped (p12-14), read before the flip from the
              `## Integration log`'s last line paired with the gate-pending status (p12-16): `set-aside`
              with a `pr:` is a stop at Integration -> `status: review`, `ready:` restamped from --now and
              `integrating:` removed (it rejoins the Integration queue, as hand-back's Integration arm
              does); anything else (a seeded revise's `rejected`, no log) -> `in_progress` with a
              `gates_signed: <now>` marker, where the lead's Restart routing resumes its gate-pending call
              (execute § 3.7) and the restart's mark-started consumes the marker. A `set-aside` last
              line with no `pr:` goes to in_progress with a WARN. Refuses a note that isn't
              gate-pending; idempotent once approved (already-approved note = no-op). Run by the lead
              session ONLY after the human explicitly signs off — never unattended.

Stdlib only. Frontmatter is edited line-surgically (not via a YAML round-trip) to preserve field order,
comments, and spacing exactly — matching how the rest of the vault tooling treats frontmatter. Importing
this module has no side effects: reconcile-project.py loads `Note` from it.

Queue states (one per linked task, re-read on every call):
  done                                        -> merged
  review + pr:                                -> integrating (with `integrating:`), else awaiting-integration
  review, no pr:, scope read-only             -> merged (a legacy read-only approval)
  review, no pr:, any other scope             -> set-aside ("approved without a PR")
  in_progress                                 -> running
  open / no status                            -> queued
  review-blocked, blocked, plan-blocked,
  gate-pending                                -> set-aside; setAsideAt `integration` when blocked and the
                                                 latest `## Blocker diagnosis` run starts `integration:`,
                                                 `gate` for gate-pending, otherwise `run`
  merged (an affine tombstone)                -> folded, outside N
  anything else (dropped, parked)             -> other, outside N
  an undecided RACE / UNVERIFIED (next only)  -> set-aside at race (Race holds, below)

Race holds (_race_holds, read by `resume`, `next`, `carry` and `hand-back`; status § 3's definitions): RACE
is a linked note not done, merged or dropped whose slug a wikilink names on a line of the rollout's
`## Race log` (any alias, heading or escaped pipe; any case). UNVERIFIED is a set-aside note whose latest run
(`blockerSummary`) carries `UNVERIFIED:`. RACE wins when both apply. Either is lifted only by a line in the
rollout's `## Notes` section matching `repair: [[<slug>]] RACE decided:` (an alias allowed, any case): main
holds a combination nobody verified, and only Lachy's recorded decision releases it. `next` re-reads a held
task that has not landed as set-aside at `race` (so it never starts, restarts or integrates, and its
dependants wait) and lists it under `raceHold`; one whose `integrating:` stamp stands (the lead's RACE
re-verify holds the lane) still counts as integrating for the pause drain, the solo rule, the overlap and the
halt verdict. `hand-back` refuses a held task (exit 2, nothing written). `status` reports the stored state,
which status § 3 renders as a RACE itself.

Never started (never_started, read by `carry` and skills/_shared/scripts/unfinished-rollout.py): no execute
session has run the rollout. Only execute's own marks count. On the rollout note: `paused:`, a truthy
`pause_requested`, `completed:`, or a `## Pause log` / `## Completion log` heading line. On a linked task note:
a non-empty `owner:` or `integrating:`. A task's status and its `started:` / `ready:` / `merged:` stamps never
count, because a carry keeps them. A protocol-3 run shows through the `owner:` its engine stamped on each task
at dispatch.

Incomplete (incomplete, read by `next`, `status` and unfinished-rollout.py): a never-started rollout that must
not run as written. The first that applies:
  - it carries `incomplete: true`. Every rollout note is born with it (the schedule template, written at
    step 6), and step 7's last write removes it once every task is stamped, so a /thread:schedule run that
    stopped anywhere in between leaves it. Schedule § 0 also stamps it on the note an interrupted supersede
    wrote; that stamp ends only when a later supersede closes the note;
  - its `supersedes:` names a rollout still unfinished beside it (not done or dropped): the supersede has
    not closed that one out (schedule step 7.5), which is what ends this reason.
Neither reason reads the task notes' links, so a task taken out of a rollout (repair's `defer`, a gate
dropped after step 7, with or without its `## Queue` row) never makes it incomplete. And neither can newly
apply to a rollout that has run, even once every task that marked it started is deferred and it reads as
never started again: `next` never started it while it carried the stamp or while its `supersedes:` target
was open (a closed target stays closed: step 7.5 files it in Archive/Rollouts/), and § 0 stamps only a note
it pairs with an open prior.

Status mapping (workflow status -> note writes), per execute/SKILL.md §6:
  review         -> status: review;        pr: <url>; review_rounds_used: <n>; plan_rounds_used: <n> (if >0);
                    read-only with no PR -> status: done instead;
                    `ready: <stamp>` (overwriting any earlier one) on a move to review from another status,
                    non-read-only, and NOT for a row carrying `integration`: readyAt is when the approving
                    own (or seeded revise) call returned, per the engine header. A set-aside re-entry is
                    leaving Integration, not joining the queue. A re-reconcile (review -> review) never
                    re-stamps;
                    when approvedAtCeiling: a run of reviewHistory (grouped by round) under
                    "## Review history (approved at ceiling)" — ceiling approvals stay auditable
  review-blocked -> status: review-blocked; pr: <url>; a run of reviewHistory (grouped by round; legacy
                    results without it fall back to final-round reviewFeedback) under "## Review-blocked feedback"
  blocked        -> status: blocked;        a run of blockerDiagnosis under "## Blocker diagnosis"
  plan-blocked   -> status: plan-blocked;   a run of blockerDiagnosis under "## Plan-blocked feedback"
  gate-pending   -> status: gate-pending;   UPSERT gatedInputs under "## Gated inputs (awaiting sign-off)"
                    (upsert, not append: a refreshed declaration replaces the pending list, never stales)
  integration    -> (any status; a mode-'integrate' row's `integration` object) one bare line under
                    "## Integration log", exactly 10 space-separated tokens:
                      <startedAt> <outcome> path=<p> pr=<n> anchor=<sha> head=<sha> base=<sha> wait=<n|->
                      duration=<n|-> triggers=<list|->
                    from metrics.startedAt (verbatim), outcome, path, the row's prUrl (its PR number; `pr=-`
                    when missing, empty or neither a GitHub PR URL nor `#7`/`7`), anchor.headSha, headSha,
                    baseSha (full SHAs), metrics.waitMinutes / durationMinutes (ints) and triggers
                    (comma-joined, in order). `-` stands for a missing value (None, '', [], a non-int minute
                    count); whitespace inside a value becomes `_`. Dedupe: a line whose startedAt is set is
                    skipped if an identical line appears anywhere in the section; a line whose startedAt is
                    `-` is skipped only if it equals the section's last non-blank line. So a re-reconcile is
                    byte-identical, and with startedAt so is a replay of an older row (two Integrations of
                    one task started in the same minute with identical fields would collapse: negligible).
                    Until the lead passes startedAt, lines are told apart only by position: S, I, S' keeps
                    three lines, back-to-back identical lines collapse to one. Readers take the LAST line.
                    `integration: null` counts as absent; a non-object is an error (exit 1, no line).
  rung           -> (any status; ADR 0029 decision 7) `rung: <name>`, the rung the task reached, when the row's
                    `rung` is a non-empty rung name ([a-z][a-z0-9._-]*, never a YAML word), so a re-dispatch
                    starts there. A malformed name is an error (exit 1) and stamps nothing. An empty `rung`
                    (an integrate row passing a neutral record through, a lead-written row with none)
                    stamps nothing. Reconcile never writes `model:` or `tier_capped:` and never removes
                    `rung:`; stale `model:`, `effort:` and `tier_capped:` stamps are left for p13-3's
                    `--regenerate`.
                    A pre-3.0.0 row (no `rung`; a call started on the tier engine that finished there, e.g.
                    a Lost-call resume of its old scriptPath) with `escalated` or `tierCapped` true proved
                    the task non-mechanical: it stamps `rung: <the ladder's top rung>` (ladder.py's load(),
                    the file each call reads) and prints a WARNING naming the slug. When the ladder cannot be
                    read that is an error (exit 1) and nothing is stamped. Any other legacy row stamps nothing.
  plan           -> (any status; p14-2) the row's approved plan, settled only by the task's own call: a non-empty
                    string upserts "## Approved plan" (a lead-in line marking it a non-authoritative record,
                    then the plan as a `> ` quote, CRLF -> LF; approved_plan() reads it back for
                    `lead-integrate.py plan`); '' or whitespace removes that section; null or no key leaves
                    it. Anything else is an error (exit 1) and leaves the section; the rest of the row is
                    still written.

Accumulated feedback (p6-4): the run sections keep every run, never only the first. Each run is a block

  ### Run <n> (<stamp>)

  <content>

  <!-- run <n> end sha=<12 hex> -->

where sha is the sha256 of the normalised content (lines right-stripped, outer blank lines dropped, runs
of blank lines collapsed). The content is written neutralised: a heading at level 1-3 in it is pushed
three levels down and a run-end-shaped line is indented, so feedback text can never end its section or
open or close a run (the sha stays over the content as given). See Note.append_run for the rules; nothing
already written is ever deleted.
"""

import argparse
import fnmatch
import hashlib
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_TASKS_DIR = Path(os.path.expanduser("~/repos/obsidian/Work/Tasks"))

# Which workflow statuses carry a PR to record.
STATUS_WITH_PR = {"review", "review-blocked"}

# Per-status body section a run of feedback is written under.
BLOCKED_SECTIONS = {
    "review-blocked": "## Review-blocked feedback",
    "blocked": "## Blocker diagnosis",
    "plan-blocked": "## Plan-blocked feedback",
}

# Gated inputs (ADR 0008): a task the engine paused for human sign-off of declared gates. Deliberately
# NOT in BLOCKED_SECTIONS: `next` never starts or restarts one, and only approve-gates makes it startable
# again.
GATE_PENDING_STATUS = "gate-pending"
GATE_PENDING_SECTION = "## Gated inputs (awaiting sign-off)"
APPROVED_GATES_SECTION = "## Approved gates"
# approve-gates' marker on a signed task sent back to in_progress (p12-14): the restart that directly follows
# the sign-off reads it through mark-started, which removes it (execute § 3.7's fresh-call warning).
GATES_SIGNED_KEY = "gates_signed"

# Review-loop memory (2026-08-14): an approval on the FINAL review round with real rejection history
# (engine flag approvedAtCeiling) persists the accumulated by-round rationale. An AUDIT RECORD, not an
# instruction: deliberately absent from the engine's PRIOR_FEEDBACK_NOTE authoritative-sections list.
# Accumulated per run, like the blocked sections: an Integration rejection can produce a second
# ceiling approval for the same task.
REVIEW_HISTORY_SECTION = "## Review history (approved at ceiling)"

# The durable record of every Integration call (p12-16): one line per mode-'integrate' row, read by the
# lead's clean path, the review-blocked resume and the gate-stop stage rule (see _integration_log_line).
INTEGRATION_LOG_SECTION = "## Integration log"

# The approved plan (p14-2): the plan-gate's approved plan, carried from the task's own call to Integration and
# a seeded revise through the note. A RECORD, not an instruction: the lead-in says so to any agent that reads
# the note, and the plan is stored as a `> ` quote so no line of it can end the section or open or close a
# run. Written by reconcile from the row's `plan` (a non-empty string upserts, '' removes, null leaves it);
# read back by approved_plan() for `lead-integrate.py plan`.
APPROVED_PLAN_SECTION = "## Approved plan"
APPROVED_PLAN_LEAD_IN = ("The last approved plan, kept as a record for Integration. Not authoritative: a plan in "
                         "your prompt supersedes it; with no plan in your prompt, the brief is the contract.")

# The lead's Integration verify timeout (p14-2, execute § 3): rollout frontmatter `verify_timeout`, seconds.
# The harness bound on the background command is the verifier's own bound plus a margin, and the harness
# maximum is 7200000 ms, so the key tops out at 7200 - 600.
DEFAULT_VERIFY_TIMEOUT = 1800
VERIFY_HARNESS_MARGIN = 600
MAX_VERIFY_TIMEOUT = 6600

# Every workflow status with a body section to write (reconcile) or scan (status).
SECTION_BY_STATUS = {**BLOCKED_SECTIONS, GATE_PENDING_STATUS: GATE_PENDING_SECTION}

# Matches the "(approved <date>)" sign-off annotation approve-gates appends to a gate line.
GATE_ANNOT_RE = re.compile(r"\s*\(approved [^)]*\)\s*$", re.I)

# ---- the queue (ADR 0030) ----
DEFAULT_CEILING = 4
SET_ASIDE_STATUSES = {"review-blocked", "blocked", "plan-blocked", GATE_PENDING_STATUS}
FINISHED_STATUSES = {"done", "merged", "dropped"}   # mark-started refuses these; resume skips them
OUTSIDE_N = {"folded", "other"}                     # queue states that are not part of the rollout's N
# The vault's TaskNotes priority scale. `medium`, missing or unknown read as normal.
PRIORITY_WEIGHTS = {"high": 3, "normal": 2, "low": 1, "none": 0}
INTEGRATION_PREFIX = "integration:"                 # a blocked task's latest diagnosis -> set aside at Integration
# A rung name (ADR 0029): written raw as `rung: <name>`, so a plain lowercase token YAML reads back as the same
# string — ladder.py's NAME_RE and YAML_WORDS, and the engine's LADDER_NAME and LADDER_YAML_WORDS.
# tests/ladder.test.mjs (L9) feeds the same names to all three and pins that they agree.
RUNG_NAME_RE = re.compile(r"[a-z][a-z0-9._-]*\Z")
RUNG_YAML_WORDS = frozenset(("true", "false", "yes", "no", "on", "off", "y", "n", "null"))


def is_rung_name(value) -> bool:
    """A usable rung name: the one rule reconcile's stamp and lead-integrate.py inputs both apply."""
    return isinstance(value, str) and bool(RUNG_NAME_RE.match(value)) and value not in RUNG_YAML_WORDS


RUN_HEAD_RE = re.compile(r"^### Run (\d+) \(([^)]*)\)\s*$")
RUN_END_RE = re.compile(r"^<!-- run (\d+) end sha=([0-9a-f]{12}) -->\s*$")
# Lines of written content the note's structure would misread (see _neutralise): an ATX heading at level
# 1-3, whatever its indentation (`## ` ends a section, `### Run <n> (…)` opens a run, and section lookups
# match a heading on its stripped text), and anything shaped like a run end marker.
STRUCTURAL_HEADING_RE = re.compile(r"^([ \t]*)(#{1,3})(?=[ \t]|$)")
RUN_END_LIKE_RE = re.compile(r"^<!-- run \d+ end\b")
FILESET_RE = re.compile(r"^\s*[-*]\s+(?P<slug>[^\s:]+?)\s*:\s*(?P<files>.*)$")
WIKILINK_RE = re.compile(r"\[\[([^\]]+?)\]\]")
# A wikilink's target up to its alias, heading or block anchor. A table cell escapes the alias pipe
# (`[[slug\|alias]]`), so the backslash ends the target too (as in reconcile-project.py).
WIKILINK_OPEN_RE = re.compile(r"\[\[([^\]|#^\\]+)")
# The rollout-body lines whose wikilinks rank a task: list items (`-`, `*`, `+`, `1.`) and table rows.
RANKED_LINE_RE = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s|\|)")
FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
PROJECT_ROOT_RE = re.compile(r"^Project root:\s*`?([^`\n]+?)`?\s*$", re.M)
PR_URL_RE = re.compile(r"^https://github\.com/([^/\s]+/[^/\s]+)/pull/(\d+)/?$")
PR_NUM_RE = re.compile(r"^#?(\d+)$")
# The engine's ISO_STAMP (task.workflow.js), the only startedAt shape the Integration log writes: `_stamp`'s
# offset-minute form, or seconds/fraction with `Z` or a `±HH[:]MM` offset. ASCII digits only.
ISO_STAMP_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})",
                          re.ASCII)


# ---- small value helpers ----------------------------------------------------

def _scalar(value) -> str:
    """A frontmatter scalar: inline ` # comment` dropped, quotes and whitespace stripped ('' for None)."""
    if value is None:
        return ""
    s = re.sub(r"\s+#.*$", "", str(value)).strip()
    return s.strip('"').strip("'").strip()


def _truthy_flag(value) -> bool:
    """Frontmatter boolean-ish: true/yes/1 (any case, quoted or bare) counts as set."""
    if value is None:
        return False
    return _scalar(value).lower() in {"true", "yes", "1"}


def _int_field(value, default):
    """Parse an int-ish frontmatter value, tolerating quotes and inline `# comments`."""
    if value is None:
        return default
    s = str(value).split("#", 1)[0].strip().strip('"').strip("'")
    try:
        return int(s)
    except ValueError:
        return default


def _wikilink_slug(value):
    """Normalise a wikilink or string (`"[[Area/Foo#Heading|alias]]"`) to a bare slug for comparison:
    the alias, a `#heading` or `^block` anchor, a table's alias-escaping backslash (`[[foo\\|alias]]`)
    and any path are dropped, keeping the leaf. Obsidian note names cannot hold `|`, `#` or `^`."""
    if value is None:
        return None
    s = value.strip().strip('"').strip("'").strip()
    s = s.replace("[[", "").replace("]]", "").strip()
    s = re.split(r"[|#^]", s, maxsplit=1)[0].rstrip().rstrip("\\")
    s = s.split("/")[-1].strip()
    if s.endswith(".md"):
        s = s[:-3]
    return s or None


def _list_items(value: str):
    """The entries of a frontmatter value: an inline `[a, "[[b]]"]` list's items or the scalar itself
    (a lone unquoted `[[a]]` is a wikilink, not a list). Each entry is a wikilink's inner text or a bare
    value; quotes stripped; `null`/`~` and empty entries dropped. Commas inside a wikilink never split."""
    v = value.strip()
    if v.startswith("[") and v.endswith("]") and not v.startswith("[["):
        v = v[1:-1]
    out = []
    for part in re.split(r",(?![^\[]*\]\])", v):
        part = part.strip().strip('"').strip("'").strip()
        links = WIKILINK_RE.findall(part)
        if links:
            out.extend(links)
        elif part and part.lower() not in ("null", "~"):
            out.append(part)
    return out


# ---- time ---------------------------------------------------------------------
# The Workflow sandbox cannot read clocks (Date.now() throws), so wall-clock enters here. Every stamp
# this script writes comes from one helper, so durations never mix forms.

def _stamp(dt) -> str:
    """The one stamp format: local time, minute precision, with its offset (2026-10-02T14:05+10:00)."""
    return dt.astimezone().isoformat(timespec="minutes")


def _parse_ts(value):
    """ISO timestamp from a frontmatter value or gh's mergedAt, or None. A trailing Z is parsed (Python
    3.9's fromisoformat refuses it); naive values are assumed local time."""
    s = _scalar(value)
    if not s:
        return None
    if s[-1] in "Zz":
        s = s[:-1] + "+00:00"
    try:
        ts = datetime.fromisoformat(s)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.astimezone()


# The engine's isoMinutes / wholeMinutes (task.workflow.js), ported byte for byte so the lead's own log
# line measures wait and duration exactly as an integrate row's metrics do (tests/lead-integrate.test.sh
# pins the two against each other). JS's String.prototype.trim strips this set.
_JS_WS = "\t\n\v\f\r              " \
         "    　﻿"


def _days_from_civil(y, m, d):
    yy = y - 1 if m <= 2 else y
    era = yy // 400
    yoe = yy - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    return era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - 719468


def _iso_minutes(s):
    """An ISO stamp as minutes since the epoch, or None (the engine's isoMinutes)."""
    if not isinstance(s, str):
        return None
    m = ISO_STAMP_RE.fullmatch(s.strip(_JS_WS))
    if not m:
        return None
    y, mo, d, h, mi = (int(m.group(i)) for i in range(1, 6))
    se = 0 if m.group(6) is None else int(m.group(6))
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    mdays = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if mo < 1 or mo > 12 or d < 1 or d > mdays[mo - 1] or h > 23 or mi > 59 or se > 59:
        return None
    off = 0
    if m.group(7) != "Z":
        digits = m.group(7)[1:].replace(":", "")
        oh, om = int(digits[:2]), int(digits[2:])
        if oh > 23 or om > 59:
            return None
        off = (-1 if m.group(7)[0] == "-" else 1) * (oh * 60 + om)
    return _days_from_civil(y, mo, d) * 1440 + h * 60 + mi + se / 60 - off


def _whole_minutes(start, end):
    """Whole minutes from one stamp to another; None when either is missing or unparseable, or the span is
    negative (the engine's wholeMinutes; JS Math.round is floor(x + 0.5))."""
    f, t = _iso_minutes(start), _iso_minutes(end)
    if f is None or t is None:
        return None
    secs = math.floor((t - f) * 60 + 0.5)
    return None if secs < 0 else secs // 60


def _iso_arg(value):
    """argparse type for --now."""
    ts = _parse_ts(value)
    if ts is None:
        raise argparse.ArgumentTypeError(f"not an ISO timestamp: {value!r}")
    return ts


def _now(args):
    return getattr(args, "now", None) or datetime.now().astimezone()


def _fmt_min(minutes) -> str:
    """42 -> '42m', 84 -> '1h 24m', 120 -> '2h'."""
    m = max(0, int(round(minutes)))
    if m < 60:
        return f"{m}m"
    h, r = divmod(m, 60)
    return f"{h}h {r}m" if r else f"{h}h"


def _rough_label(minutes, infix: str = "") -> str:
    """The single rendering of the remaining estimate — always '~<duration>[infix] (rough)'. Both
    `remainingLabel` and the progress line derive from here so the 'always labelled rough' invariant has
    one source and the two renderings can never drift."""
    return f"~{_fmt_min(minutes)}{infix} (rough)"


# ---- accumulated runs (p6-4) ------------------------------------------------------

def _normalise(text: str) -> str:
    """Lines right-stripped, outer blank lines dropped, runs of blank lines collapsed."""
    lines = [line.rstrip() for line in str(text).split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    out = []
    for line in lines:
        if not line and out and not out[-1]:
            continue
        out.append(line)
    return "\n".join(out)


def _sha12(normalised: str) -> str:
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:12]


def _neutralise(text: str) -> str:
    """Content as written into a section. Feedback is free LLM text, so a line of it can look like note
    structure: a `## ` line would end the section for every reader (the next reconcile would put Run 2
    inside Run 1), a `### Run <n> (…)` line would open a run and an end marker would close one. A heading
    at level 1-3 is pushed three levels down (`## Root cause` -> `##### Root cause`, keeping the
    hierarchy under its `### Run` heading) and a run-end-shaped line is indented one space (still a
    comment). Every other line is unchanged. Hashes are over the content as given, never this form."""
    out = []
    for line in text.split("\n"):
        line = STRUCTURAL_HEADING_RE.sub(r"\1###\2", line)
        if RUN_END_LIKE_RE.match(line):
            line = " " + line
        out.append(line)
    return "\n".join(out)


def quote_block(text: str) -> str:
    """A text stored as a markdown quote (the approved plan, p14-2): CRLF (and a lone CR) normalised to LF,
    trailing whitespace dropped, each line written `> <line>` and a blank line `>`. No stored line can read as
    note structure: it starts with `>`, never `## `, `#`, `### Run` or `<!-- run`."""
    lines = str(text).replace("\r\n", "\n").replace("\r", "\n").rstrip().split("\n")
    return "\n".join(("> " + line) if line else ">" for line in lines)


def unquote_block(lines) -> str:
    """quote_block's inverse over a section's lines: only the `>` lines are kept, each with one `> ` (or a bare
    `>`) stripped, so a lead-in or blank line around the quote is not part of the text."""
    out = []
    for line in lines:
        if line.startswith("> "):
            out.append(line[2:])
        elif line.startswith(">"):
            out.append(line[1:])
    return "\n".join(out)


def approved_plan(note) -> str:
    """The note's approved plan (p14-2): the `> ` quote under `## Approved plan`, unquoted; '' when the note
    has no such section (never plan-gated, or the last own call was not)."""
    found = note._section_bounds(APPROVED_PLAN_SECTION)
    if found is None:
        return ""
    lines, start, end = found
    return unquote_block(lines[start + 1:end])


def _run_end(n: int, sha: str) -> str:
    return f"<!-- run {n} end sha={sha} -->"


def _parse_runs(lines, lo: int, hi: int):
    """The run blocks among lines[lo:hi]: [{n, head, end, sha, stop}]. `end` is the end marker's index
    (None when it is gone) and `stop` the exclusive end of the run's content: its marker, or — for a run
    whose marker was removed — the next run heading or the section end."""
    runs, cur = [], None
    for i in range(lo, hi):
        mh = RUN_HEAD_RE.match(lines[i])
        if mh:
            if cur is not None:
                cur["stop"] = i
                runs.append(cur)
            cur = {"n": int(mh.group(1)), "head": i, "end": None, "sha": None, "stop": hi}
            continue
        me = RUN_END_RE.match(lines[i])
        if me and cur is not None and int(me.group(1)) == cur["n"]:
            cur.update(end=i, sha=me.group(2), stop=i)
            runs.append(cur)
            cur = None
    if cur is not None:
        runs.append(cur)
    return runs


def _top_run(runs):
    """The highest-numbered run (the later one on a duplicate number)."""
    return max(enumerate(runs), key=lambda e: (e[1]["n"], e[0]))[1]


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

    def get_list(self, key: str):
        """`key:` as a list: a block list (`key:` then `  - item` lines), an inline `[a, b]` list or a
        scalar. Each entry is a wikilink's inner text or a bare value (callers normalise slugs with
        _wikilink_slug). [] when the key is absent or empty."""
        pat = re.compile(rf"^{re.escape(key)}:(.*)$")
        for i, line in enumerate(self._fm):
            mm = pat.match(line)
            if not mm:
                continue
            value = re.sub(r"\s+#.*$", "", mm.group(1)).strip()
            if value:
                return _list_items(value)
            out = []
            for item in self._fm[i + 1:]:
                mi = re.match(r"^\s*-\s*(.*)$", item)
                if mi:
                    out.extend(_list_items(re.sub(r"\s+#.*$", "", mi.group(1)).strip()))
                elif item.strip():
                    break
            return out
        return []

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

    def _set_body_lines(self, lines):
        new_body = "\n".join(lines)
        if new_body != self._body:
            self._body = new_body
            self.dirty = True

    def upsert_section(self, heading: str, content: str):
        """Create `## heading` with content, or REPLACE the existing section's content in place
        (unlike append_section's heading-idempotence — for sections whose content must track the
        latest state, e.g. a refreshed gated-inputs declaration). Idempotent on identical content: the
        content is written neutralised, so a `## ` line in it can never end the section (which would
        make the next upsert duplicate everything after that line)."""
        content = _neutralise(content.rstrip())
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, content)
            return
        lines, start, end = found
        self._set_body_lines(lines[:start + 1] + [""] + content.rstrip().split("\n") + [""] + lines[end:])

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

    def run_blocks(self, heading: str):
        """The `### Run <n>` blocks of the first `heading` section ([] when absent or legacy), each
        {n, head, end, sha, stop, content} with content normalised."""
        found = self._section_bounds(heading)
        if found is None:
            return []
        lines, start, end = found
        runs = _parse_runs(lines, start + 1, end)
        for r in runs:
            r["content"] = _normalise("\n".join(lines[r["head"] + 1:r["stop"]]))
        return runs

    def latest_run_text(self, heading: str) -> str:
        """The section's latest diagnosis: the content of its highest run, or the whole section
        (normalised) when it has no runs. '' when the section is absent."""
        found = self._section_bounds(heading)
        if found is None:
            return ""
        runs = self.run_blocks(heading)
        if runs:
            return _top_run(runs)["content"]
        lines, start, end = found
        return _normalise("\n".join(lines[start + 1:end]))

    def append_run(self, heading: str, content: str, now):
        """Record one run of feedback under `heading` (p6-4: every run is kept, not only the first).

        Rules, in order (content is normalised, the sha is over that, and it is written neutralised —
        see _neutralise; empty content writes nothing):
          1. No section: create it holding Run 1.
          2. The highest run's recorded sha equals the new sha: do nothing (a re-reconcile of the same
             result). A run whose end marker is gone is compared by its normalised extent against the
             neutralised content instead. Earlier runs are never compared, so A/B/A appends A again.
          3. The foreign tail — the text after the last end marker, or the whole section when it has no
             runs — normalises equal to the new content, and that content has no line _neutralise would
             change: adopt it in place, inserting the heading before its first non-blank line and the
             marker after its last, changing none of its bytes. This is the same-run copy an implementer
             agent writes into the note itself. (Content with such a line is appended instead: adopting
             it would keep a structural line inside the run.)
          4. Otherwise append the block at the end of the section.
        Nothing already written is deleted or rewritten; legacy text with no run heading stays as it is."""
        body = _normalise(content)
        if not body:
            return
        sha = _sha12(body)
        written = _neutralise(body)
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, f"### Run 1 ({_stamp(now)})\n\n{written}\n\n{_run_end(1, sha)}")
            return
        lines, start, end = found
        runs = _parse_runs(lines, start + 1, end)
        if runs:
            top = _top_run(runs)
            if top["end"] is not None:
                same = top["sha"] == sha
            else:
                same = _normalise("\n".join(lines[top["head"] + 1:top["stop"]])) == written
            if same:
                return
        n = max((r["n"] for r in runs), default=0) + 1
        head = f"### Run {n} ({_stamp(now)})"

        if not runs:
            tail_lo = start + 1
        else:
            marked = [r["end"] for r in runs if r["end"] is not None]
            tail_lo = max(marked) + 1 if marked else None
        # written == body also rules out a `### Run` line in the tail (it would equal a body line).
        if tail_lo is not None and written == body and _normalise("\n".join(lines[tail_lo:end])) == body:
            filled = [i for i in range(tail_lo, end) if lines[i].strip()]
            first, last = filled[0], filled[-1]
            pre = ([""] if lines[first - 1].strip() else []) + [head, ""]
            post = ["", _run_end(n, sha)] + ([""] if last + 1 < len(lines) and lines[last + 1].strip() else [])
            self._set_body_lines(lines[:first] + pre + lines[first:last + 1] + post + lines[last + 1:])
            return

        j = end
        while j > start + 1 and not lines[j - 1].strip():
            j -= 1
        block = ["", head, "", *written.split("\n"), "", _run_end(n, sha), ""]
        self._set_body_lines(lines[:j] + block + lines[end:] if end < len(lines) else lines[:j] + block)

    def append_line(self, heading: str, line: str):
        """Record one bare line under `heading` (the Integration log), creating the section when absent.

        Dedupe, keyed on the line's first token (its startedAt): a line whose startedAt is set is skipped
        when an identical line (right-stripped) appears ANYWHERE in the section, so a re-reconcile and a
        replay of an older row are both no-ops; a line whose startedAt is `-` is skipped only when it
        equals the section's LAST non-blank line, so S, I, S' keeps three lines and the latest stays
        truthful (back-to-back identical `-` lines collapse). Otherwise the line goes right after the
        section's last non-blank line, keeping one blank line after the heading and before any following
        `## ` section. Nothing already written is deleted or rewritten."""
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, line)
            return
        lines, start, end = found
        filled = [i for i in range(start + 1, end) if lines[i].strip()]
        kept = [lines[i].rstrip() for i in filled]
        if line.split(" ", 1)[0] != "-":
            if line in kept:
                return
        elif kept and kept[-1] == line:
            return
        if not filled:
            # An empty section: its blank lines become one either side of the new line.
            self._set_body_lines(lines[:start + 1] + ["", line, ""] + lines[end:])
            return
        j = filled[-1] + 1
        tail = [""] if j == len(lines) or lines[j].strip() else []
        self._set_body_lines(lines[:j] + [line] + tail + lines[j:])

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


def _log_field(value, minutes=False) -> str:
    """One Integration log value. None, '', [] (or a non-int, or bool, minute count) -> `-`; a list is
    comma-joined in order; whitespace inside becomes `_`, so a line always has exactly 10 tokens. This
    guards the token count only: a value may still start with `#`, a backtick or `>`, which is why the
    line's one unprefixed token (startedAt) goes through _log_started instead."""
    if minutes:
        return str(value) if isinstance(value, int) and not isinstance(value, bool) else "-"
    if isinstance(value, (list, tuple)):
        value = ",".join(str(v).strip() for v in value if v is not None and str(v).strip())
    s = "" if value is None else str(value).strip()
    return re.sub(r"\s", "_", s) if s else "-"


def _log_started(value) -> str:
    """The line's leading token: startedAt when it is an ISO stamp (ISO_STAMP_RE, the engine's shape),
    else `-`. The lead supplies startedAt and the engine only checks it is a string, and it is the one
    token with no `key=` prefix, so it alone decides how the line starts; holding it to a digit or `-`
    means the line can never open a `## ` section (ending `## Integration log` above it), an H1, a code
    fence or a quote."""
    s = value.strip() if isinstance(value, str) else ""
    return s if ISO_STAMP_RE.fullmatch(s) else "-"


def _log_pr(pr_url) -> str:
    """The PR number of a row's prUrl (a GitHub PR URL, `#7` or `7`), else `-`: no arbitrary string ever
    reaches the `pr=` token, and an unparseable PR never fails the row (the line is a record)."""
    s = pr_url.strip() if isinstance(pr_url, str) else ""
    m = PR_URL_RE.match(s)
    if m:
        return m.group(2)
    m = PR_NUM_RE.match(s)
    return m.group(1) if m else "-"


def _integration_log_line(task) -> str:
    """The `## Integration log` line for a row carrying a dict `integration` (the engine's
    integrationResult): `<startedAt> <outcome> path=<p> pr=<n> anchor=<sha> head=<sha> base=<sha>
    wait=<n|-> duration=<n|-> triggers=<list|->`. startedAt is written verbatim when it is an ISO stamp
    (else `-`, see _log_started), SHAs in full. The line carries no `now`, so a re-reconcile at another
    time writes the same line."""
    integ = task["integration"]
    metrics = integ.get("metrics") if isinstance(integ.get("metrics"), dict) else {}
    anchor = integ.get("anchor") if isinstance(integ.get("anchor"), dict) else {}
    return " ".join([
        _log_started(metrics.get("startedAt")),
        _log_field(integ.get("outcome")),
        "path=" + _log_field(integ.get("path")),
        "pr=" + _log_pr(task.get("prUrl")),
        "anchor=" + _log_field(anchor.get("headSha")),
        "head=" + _log_field(integ.get("headSha")),
        "base=" + _log_field(integ.get("baseSha")),
        "wait=" + _log_field(metrics.get("waitMinutes"), minutes=True),
        "duration=" + _log_field(metrics.get("durationMinutes"), minutes=True),
        "triggers=" + _log_field(integ.get("triggers")),
    ])


def _log_lines(note) -> list:
    """The `## Integration log`'s non-blank lines, oldest first."""
    return [l.rstrip() for l in note.section_text(INTEGRATION_LOG_SECTION).split("\n") if l.strip()]


def _last_log_line(note):
    """The `## Integration log`'s LAST non-blank line, or None. The p12-16 contract has this one reader
    (approve-gates here, `lead-integrate.py`'s prepare and inputs through last_integration): read the last
    line, never a search, since old lines survive a defer or a recut."""
    lines = _log_lines(note)
    return lines[-1] if lines else None


def _status(note) -> str:
    return _scalar(note.get("status")).lower()


def _pr(note) -> str:
    return _scalar(note.get("pr"))


def _scope(note) -> str:
    return _scalar(note.get("scope")).lower()


def _landed(note) -> bool:
    """Merged for the queue: done, or a read-only task approved with nothing to merge."""
    st = _status(note)
    return st == "done" or (st == "review" and not _pr(note) and _scope(note) == "read-only")


# ---- the rollout's linked tasks ----------------------------------------------

def _scan(rollout_path: Path, tasks_dir: Path):
    """(linked, index): linked = (path, Note) for every task note carrying `rollout: [[<slug>]]` for this
    rollout (glob-by-backlink — captures read-only tasks the `## File-sets` block omits); index = stem
    (lowercased) -> (path, Note) for every note under tasks_dir, Archive included, preferring a root
    copy over an archived one (dependency lookups)."""
    rollout_slug = rollout_path.stem.lower()
    rollout_real = rollout_path.resolve()
    linked, index = [], {}
    for path in sorted(tasks_dir.rglob("*.md")):  # rglob to catch already-archived done tasks too
        if path.resolve() == rollout_real:
            continue
        try:
            note = Note(path)
        except ValueError:
            continue  # not a frontmatter note (or not UTF-8)
        key = path.stem.lower()
        prev = index.get(key)
        if prev is None or (prev[0].parent != tasks_dir and path.parent == tasks_dir):
            index[key] = (path, note)
        if (_wikilink_slug(note.get("rollout")) or "").lower() == rollout_slug:
            linked.append((path, note))
    return linked, index


def _linked_task_notes(rollout_path: Path, tasks_dir: Path):
    return _scan(rollout_path, tasks_dir)[0]


def _queue_state(note):
    """(queue state, setAsideAt) for one task note — the table in the module docstring."""
    st = _status(note)
    if st == "done":
        return "merged", None
    if st == "review":
        if _pr(note):
            return ("integrating" if _scalar(note.get("integrating")) else "awaiting-integration"), None
        if _scope(note) == "read-only":
            return "merged", None
        return "set-aside", "run"  # approved without a PR: nothing for Integration to merge
    if st == "in_progress":
        return "running", None
    if st in ("", "open"):
        return "queued", None
    if st in SET_ASIDE_STATUSES:
        if st == GATE_PENDING_STATUS:
            return "set-aside", "gate"
        if st == "blocked" and \
                note.latest_run_text(BLOCKED_SECTIONS["blocked"]).lower().startswith(INTEGRATION_PREFIX):
            return "set-aside", "integration"
        return "set-aside", "run"
    if st == "merged":
        return "folded", None
    return "other", None


STARTED_HEADINGS = ("## Pause log", "## Completion log")


def _valued(value) -> bool:
    """A frontmatter value that says something: non-empty once quotes and an inline comment are dropped,
    and not YAML's null."""
    return _scalar(value).lower() not in ("", "null", "~")


def never_started(rollout_note, linked):
    """(True, '') when no execute session has run this rollout, else (False, reason). Only execute's own
    marks count (the module docstring's "Never started"): the rollout note's `paused:`, truthy
    `pause_requested`, `completed:`, a `## Pause log` or `## Completion log` heading; a linked task note's
    non-empty `owner:` or `integrating:` (`linked` is `_scan`'s list of (path, Note)). A task's status and
    its started:/ready:/merged: stamps never count, so a freshly carried rollout is still never started. A
    protocol-3 run shows through the `owner:` its engine stamped on each task at dispatch."""
    if _valued(rollout_note.get("paused")):
        return False, f"it carries paused: {_scalar(rollout_note.get('paused'))}"
    if _truthy_flag(rollout_note.get("pause_requested")):
        return False, "it carries pause_requested"
    if _valued(rollout_note.get("completed")):
        return False, f"it carries completed: {_scalar(rollout_note.get('completed'))}"
    for heading in STARTED_HEADINGS:
        if rollout_note.has_heading(heading):
            return False, f"it has a {heading} section"
    for path, note in sorted(linked, key=lambda pn: (pn[0].stem.lower(), str(pn[0]))):
        for key in ("owner", "integrating"):
            if _valued(note.get(key)):
                return False, f"its task {path.stem} carries {key}: {_scalar(note.get(key))}"
    return True, ""


def incomplete(rollout_path: Path, rollout_note, linked, index) -> str:
    """'' when the rollout can run as written, else why not (the module docstring's "Incomplete"). Only a
    never-started rollout is judged; `linked` and `index` are _scan's. The same-folder test compares
    resolved paths, as `_scan` does, so a symlinked or differently spelt vault path never skips it."""
    if not never_started(rollout_note, linked)[0]:
        return ""
    if _truthy_flag(rollout_note.get("incomplete")):
        return ("it carries incomplete: true (the /thread:schedule run that wrote it never reached step 7's last "
                "write, which removes it once every task is stamped, or § 0 stamped it finishing an interrupted "
                "supersede), so its queue may name tasks never stamped to it")
    prior = (_wikilink_slug(_scalar(rollout_note.get("supersedes"))) or "").lower()
    entry = index.get(prior) if prior else None
    if entry is not None and entry[0].parent.resolve() == rollout_path.parent.resolve() and \
            "rollout" in _tags(entry[1]) and _status(entry[1]) not in CLOSED_ROLLOUT_STATUSES:
        return (f"its supersedes: names [[{entry[0].stem}]], still unfinished beside it: the supersede has not "
                "closed that rollout out (schedule step 7.5)")
    return ""


def _priority(note) -> str:
    v = _scalar(note.get("priority")).lower()
    return v if v in PRIORITY_WEIGHTS else "normal"


def _dep_entries(note):
    """`depends-on:` plus `blocked-by:`, as slugs, in declared order, without duplicates."""
    out, seen = [], set()
    for key in ("depends-on", "blocked-by"):
        for entry in note.get_list(key):
            slug = _wikilink_slug(entry)
            if slug and slug.lower() not in seen:
                seen.add(slug.lower())
                out.append(slug)
    return out


def _dep_status(slug: str, index):
    """(satisfied, why): a dependency is satisfied only when its note is landed. A tombstone
    (`status: merged`) resolves through `merged_into:` to the combined unit (cycle-guarded). `why` is
    the parenthesised part of a hold reason."""
    entry = index.get(slug.lower())
    if entry is None:
        return False, "note not found"
    if _status(entry[1]) != "merged":
        return _landed(entry[1]), _status(entry[1]) or "no status"
    cur, seen = slug, {slug.lower()}
    while True:
        target = _wikilink_slug(entry[1].get("merged_into"))
        if not target:
            return False, "merged" if cur == slug else f"folded into [[{cur}]] (merged)"
        if target.lower() in seen:
            return False, f"folded into [[{target}]] (merged)"
        seen.add(target.lower())
        entry = index.get(target.lower())
        if entry is None:
            return False, f"folded into [[{target}]] (note not found)"
        cur = target
        if _status(entry[1]) != "merged":
            return _landed(entry[1]), f"folded into [[{target}]] ({_status(entry[1]) or 'no status'})"


def _unsatisfied(row, index):
    """Hold-reason fragments for a task's unsatisfied dependencies ([] when it is free to start)."""
    out = []
    for dep in row["deps"]:
        ok, why = _dep_status(dep, index)
        if not ok:
            out.append(f"depends on [[{dep}]] ({why})")
    return out


def _file_sets(rollout_note):
    """slug (lowercased) -> planned files, from the rollout's `## File-sets` lines
    (`- <slug>: a, b`). A task with no line plans no files (overlap 0)."""
    found = rollout_note._section_bounds("## File-sets")
    out = {}
    if found is None:
        return out
    lines, start, end = found
    for line in lines[start + 1:end]:
        m = FILESET_RE.match(line)
        if not m:
            continue
        slug = (_wikilink_slug(m.group("slug")) or "").lower()
        files = [f.strip().strip("`").strip() for f in m.group("files").split(",")]
        out[slug] = [f for f in files if f]
    return out


def _schedule_positions(rollout_note):
    """slug (lowercased) -> the ordinal of its first wikilink on a list-item or table-row line of the
    rollout body (the `## Queue` table or a queue list), outside fenced code. Prose never ranks,
    so a note the lead adds above the list mid-rollout cannot reorder the queue."""
    pos, i, fenced = {}, 0, False
    for line in rollout_note._body.split("\n"):
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced or not RANKED_LINE_RE.match(line):
            continue
        for m in WIKILINK_OPEN_RE.finditer(line):
            slug = (_wikilink_slug(m.group(1)) or "").lower()
            if slug and slug not in pos:
                pos[slug] = i
            i += 1
    return pos


def _rows(rollout_path: Path, rollout_note, tasks_dir: Path):
    """(rows, index): one dict per linked task note with everything the queue reads from it."""
    linked, index = _scan(rollout_path, tasks_dir)
    file_sets = _file_sets(rollout_note)
    positions = _schedule_positions(rollout_note)
    rows = []
    for path, note in linked:
        slug = path.stem
        state, set_aside_at = _queue_state(note)
        pos = positions.get(slug.lower())
        # Schedule rank: listed tasks by position, then unlisted ones by slug.
        rank = (0, pos, "") if pos is not None else (1, 0, slug.lower())
        priority = _priority(note)
        rows.append({
            "slug": slug, "path": path, "note": note, "state": state, "setAsideAt": set_aside_at,
            "status": _scalar(note.get("status")) or None, "pr": _pr(note) or None,
            "priority": priority, "weight": PRIORITY_WEIGHTS[priority], "solo": _truthy_flag(note.get("solo")),
            "files": file_sets.get(slug.lower(), []), "rank": rank, "deps": _dep_entries(note),
            "started": _scalar(note.get("started")) or None, "merged": _scalar(note.get("merged")) or None,
            "integrating": _scalar(note.get("integrating")) or None,
        })
    return rows, index


def _rank(row):
    return row["rank"]


# ---- race holds (status § 3's definitions) -------------------------------------

RACE_LOG_SECTION = "## Race log"
NOTES_SECTION = "## Notes"
# Lachy's recorded decision: `repair: [[<slug>]] RACE decided:`, matched on the link's target (an alias, a
# heading or a table-escaped pipe after it is allowed).
RACE_DECIDED_RE = re.compile(r"repair:\s*\[\[([^\]|#^\\]+)[^\]]*\]\]\s*RACE decided:", re.I)
UNVERIFIED_MARK = "UNVERIFIED:"


def _race_holds(rollout_note, linked):
    """{slug_lower: (slug, kind)} for every linked task an undecided RACE or UNVERIFIED holds (the module
    docstring's "Race holds"). RACE: a note not done, merged or dropped whose slug a wikilink names on a line
    of the rollout's `## Race log`. UNVERIFIED: a set-aside note whose latest run (_blocker_summary) carries
    `UNVERIFIED:`. RACE wins when both apply. A `repair: [[<slug>]] RACE decided:` line in the rollout's
    `## Notes` lifts either; a decision recorded anywhere else never does. `linked` is _scan's (path, Note)
    list. Read by `resume`, `next`, `carry` and `hand-back`. `rollout_note` None (hand-back's `rollout:`
    names no readable note) has no Race log and no decision, so only an UNVERIFIED holds there."""
    race_log = rollout_note.section_text(RACE_LOG_SECTION) if rollout_note is not None else ""
    notes = rollout_note.section_text(NOTES_SECTION) if rollout_note is not None else ""
    raced = set()
    for line in race_log.split("\n"):
        for m in WIKILINK_OPEN_RE.finditer(line):
            slug = (_wikilink_slug(m.group(1)) or "").lower()
            if slug:
                raced.add(slug)
    decided = {(_wikilink_slug(m.group(1)) or "").lower() for m in RACE_DECIDED_RE.finditer(notes)}
    holds = {}
    for path, note in linked:
        key = path.stem.lower()
        if key in decided:
            continue
        if key in raced and _status(note) not in FINISHED_STATUSES:
            holds[key] = (path.stem, "RACE")
        elif _queue_state(note)[0] == "set-aside" and UNVERIFIED_MARK in _blocker_summary(note):
            holds[key] = (path.stem, "UNVERIFIED")
    return holds


def _ceiling(rollout_note):
    """(ceiling, error): `parallel_ceiling`, an integer >= 1; absent -> 4; anything else -> error."""
    raw = rollout_note.get("parallel_ceiling")
    if raw is None:
        return DEFAULT_CEILING, None
    s = _scalar(raw)
    if re.fullmatch(r"[0-9]+", s) and int(s) >= 1:
        return int(s), None
    return None, f"parallel_ceiling must be an integer >= 1, got {raw!r}"


def _verify_timeout(rollout_note):
    """(seconds, error): `verify_timeout`, an integer from 1 to MAX_VERIFY_TIMEOUT; absent -> 1800; anything
    else -> error. Read like `parallel_ceiling` (_scalar: a quoted value or a trailing ` # comment` is fine).
    Only the rollout note is read, so a task-level key never applies."""
    raw = rollout_note.get("verify_timeout")
    if raw is None:
        return DEFAULT_VERIFY_TIMEOUT, None
    s = _scalar(raw)
    if re.fullmatch(r"[0-9]+", s) and 1 <= int(s) <= MAX_VERIFY_TIMEOUT:
        return int(s), None
    return None, f"verify_timeout must be an integer from 1 to {MAX_VERIFY_TIMEOUT}, got {raw!r}"


def _overlap(files, in_flight) -> int:
    """How many of a task's planned files match an in-flight file, exactly or by fnmatch either way."""
    return sum(1 for f in files
               if any(f == g or fnmatch.fnmatchcase(f, g) or fnmatch.fnmatchcase(g, f) for g in in_flight))


# ---- counts, timeline, progress ----------------------------------------------

COUNT_KEY = {"merged": "merged", "running": "running", "integrating": "integrating",
             "awaiting-integration": "awaitingIntegration", "queued": "queued", "set-aside": "setAside",
             "folded": "folded", "other": "other"}


def _counts(rows):
    c = {k: 0 for k in ("merged", "running", "integrating", "awaitingIntegration", "queued", "setAside",
                        "setAsideAtIntegration", "folded", "other")}
    for r in rows:
        c[COUNT_KEY[r["state"]]] += 1
        if r["setAsideAt"] == "integration":
            c["setAsideAtIntegration"] += 1
    c["total"] = sum(c[k] for k in ("merged", "running", "integrating", "awaitingIntegration", "queued", "setAside"))
    return c


def _timeline(rows, counts, ceiling, now):
    """The per-task progress/ETA block, or None when no task has a parseable `started:`. In-rollout
    arithmetic only, deliberately rough (always labelled `~… (rough)`): the mean per-task duration
    (started -> merged) x the chunks still ahead at the ceiling."""
    in_n = [r for r in rows if r["state"] not in OUTSIDE_N]
    entries = []
    for r in in_n:
        started = _parse_ts(r["started"])
        if started is None:
            continue
        merged = _parse_ts(r["merged"])
        duration = int(round((merged - started).total_seconds() / 60.0)) if merged else None
        entries.append((started, r["slug"], {
            "slug": r["slug"], "started": r["started"], "merged": r["merged"] if merged else None,
            "durationMinutes": duration,
        }))
    if not entries:
        return None
    entries.sort(key=lambda e: (e[0], e[1]))
    first_started = entries[0][0]
    merges = [(m, r["merged"]) for r in in_n for m in [_parse_ts(r["merged"])] if m is not None]
    last_merged = max(merges, key=lambda e: e[0]) if merges else None
    complete = counts["total"] > 0 and counts["merged"] == counts["total"]
    end = last_merged[0] if (complete and last_merged) else now
    elapsed = max(0.0, (end - first_started).total_seconds() / 60.0)
    durations = [e[2]["durationMinutes"] for e in entries
                 if e[2]["durationMinutes"] is not None and e[2]["durationMinutes"] >= 0]
    avg = sum(durations) / len(durations) if durations else None
    pending = counts["running"] + counts["queued"]
    remaining = int(round(avg * math.ceil(pending / ceiling))) if (avg is not None and pending and ceiling) else None
    return {
        "tasks": [e[2] for e in entries],
        "firstStarted": entries[0][2]["started"],
        "lastMerged": last_merged[1] if last_merged else None,
        "elapsedMinutes": int(round(elapsed)),
        "elapsedLabel": _fmt_min(elapsed),
        "avgTaskMinutes": round(avg, 1) if avg is not None else None,
        "durationsUsed": len(durations),
        "remainingEstimateMinutes": remaining,
        "remainingLabel": _rough_label(remaining) if remaining is not None else None,
        "complete": complete,
    }


def _progress_line(counts, timeline) -> str:
    """`progress: <M>/<N> merged[, <n> running][, <n> integrating][, <n> awaiting integration][, <n>
    queued][, <n> set aside[ (<k> at Integration)]][ — <elapsed> elapsed[, ~<d> remaining (rough)]]`;
    complete: `progress: <N>/<N> merged — rollout complete[ in <elapsed>]`; empty: `progress: 0/0 merged`."""
    n, m = counts["total"], counts["merged"]
    if n == 0:
        return "progress: 0/0 merged"
    if m == n:
        return f"progress: {n}/{n} merged — rollout complete" + (f" in {timeline['elapsedLabel']}" if timeline else "")
    line = f"progress: {m}/{n} merged"
    for key, label in (("running", "running"), ("integrating", "integrating"),
                       ("awaitingIntegration", "awaiting integration"), ("queued", "queued")):
        if counts[key]:
            line += f", {counts[key]} {label}"
    if counts["setAside"]:
        line += f", {counts['setAside']} set aside"
        if counts["setAsideAtIntegration"]:
            line += f" ({counts['setAsideAtIntegration']} at Integration)"
    if timeline:
        line += f" — {timeline['elapsedLabel']} elapsed"
        if timeline["remainingEstimateMinutes"] is not None:
            line += ", " + _rough_label(timeline["remainingEstimateMinutes"], infix=" remaining")
    return line


def _progress_for(rollout_path: Path, tasks_dir: Path, now) -> str:
    """The progress line for a rollout, read fresh from its notes (after any writes this call made)."""
    rollout_note = Note(rollout_path)
    rows, _index = _rows(rollout_path, rollout_note, tasks_dir)
    counts = _counts(rows)
    ceiling, _err = _ceiling(rollout_note)
    return _progress_line(counts, _timeline(rows, counts, ceiling, now))


def _print_progress(args, now):
    """Print the progress line when the verb was given --rollout (the lead relays it, ADR 0030)."""
    if not getattr(args, "rollout", None):
        return
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"WARN: rollout note not found at {path} — no progress line", file=sys.stderr)
        return
    print(_progress_for(path, Path(os.path.expanduser(args.tasks_dir)), now))


# ---- reconcile --------------------------------------------------------------

def resolve_task_path(task, tasks_dir: Path) -> Path:
    # Prefer an explicit taskPath if the result carries one; else resolve <tasks-dir>/<slug>.md
    # (exactly how execute builds taskPath in the args it dispatched).
    tp = task.get("taskPath")
    if tp:
        return Path(os.path.expanduser(tp))
    return tasks_dir / f"{task['slug']}.md"


def _rung_note(task) -> str:
    """The reconcile line's rung part: ` rung=<name>`, then ` from=<start>` when the call climbed off it,
    ` climbs=<stage:from->to,…>` and ` rung-drift=<name>` when they apply; '' for a row with no rung."""
    rung = task.get("rung")
    if not isinstance(rung, str) or not rung:
        return ""
    out = f" rung={rung}"
    start = task.get("startRung")
    if isinstance(start, str) and start and start != rung:
        out += f" from={start}"
    climbs = task.get("climbs")
    if isinstance(climbs, list) and climbs:
        out += " climbs=" + ",".join(
            f"{c.get('stage')}:{c.get('from')}->{c.get('to')}" if isinstance(c, dict) else str(c) for c in climbs)
    drift = task.get("rungDrift")
    if isinstance(drift, str) and drift:
        out += f" rung-drift={drift}"
    return out


# ladder.py, shared with every skill: the operator's ladder, as the lead reads it at each Workflow call's start.
LADDER_PY = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "ladder.py"


def _ladder_top():
    """(top rung name, source) of the operator's ladder, read through ladder.py's load(); (None, why) when it
    cannot be read: a refused file (LadderError, exit 2 or 3 from the CLI) or a ladder.py that will not load."""
    try:
        spec = importlib.util.spec_from_file_location("thread_ladder", LADDER_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ladder = mod.load()
        return ladder["rungs"][-1]["name"], ladder["source"]
    except Exception as e:  # any failure falls back to the caller's ERROR line, never a guessed rung
        return None, str(getattr(e, "reason", "") or e) or type(e).__name__


def _legacy_climb(task) -> str:
    """A pre-3.0.0 row's evidence of hardness (ADR 0029 compat): 'escalated' or 'tier-capped', '' for none.
    Only a row with no `rung` qualifies; every 3.0.0 row carries one (possibly '')."""
    if task.get("rung") is not None:
        return ""
    if task.get("escalated"):
        return "escalated"
    if task.get("tierCapped"):
        return "tier-capped"
    return ""


def cmd_reconcile(args) -> int:
    raw = sys.stdin.read() if args.result == "-" else Path(os.path.expanduser(args.result)).read_text()
    data = json.loads(raw)
    tasks = data.get("tasks", [])
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    now = _now(args)
    errors = []
    warnings = []
    top = None  # (name, source) of the ladder's top rung, read once, only for a pre-3.0.0 row
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

        pr = (task.get("prUrl") or "").strip()
        # A read-only task is done when its review approves: nothing to merge, so it never enters
        # Integration (ADR 0030). The row's scope wins; the note's own is the fallback.
        scope = _scalar(task.get("scope")).lower() or _scope(note)
        note_status = "done" if (status == "review" and not pr and scope == "read-only") else status
        # `ready:` is when the task joined the Integration queue: the approving own (or seeded revise)
        # call returned (the engine's readyAt). Stamped on a move to review from another status,
        # overwriting any earlier value; never on a read-only task (it never enters Integration) and
        # never on an Integration row (an integrated set-aside re-entering review is leaving Integration,
        # not joining the queue).
        if (note_status == "review" and _status(note) != "review" and scope != "read-only"
                and task.get("integration") is None):
            note.set("ready", _stamp(now))
        note.set("status", note_status)
        # Its approval is its completion, so it is stamped `merged:` as a PR task is at its merge (the
        # first stamp wins): its duration then counts in the timeline, and a read-only task finishing
        # last ends the rollout's elapsed time.
        if note_status == "done" and not _scalar(note.get("merged")):
            note.set("merged", _stamp(now))
        # Whatever Integration this task was in, the run that produced this row ended it.
        note.remove("integrating")

        # The rung is durable (ADR 0029 decision 4): a task that climbed has proven non-mechanical, so
        # every later re-dispatch (resume, /thread:repair) starts on the rung it reached, not back at the
        # bottom. Stamped for every status, landed ones included, as the record of what it took; an
        # integrate row passes the task's own record through, and a neutral one (or a lead-written row)
        # carries no rung and stamps nothing. A drifted `rung:` (one the ladder lacks) is overwritten by
        # the rung the call reached. Idempotent via Note.set. Never `model:` or `tier_capped:`.
        rung = task.get("rung")
        legacy = _legacy_climb(task)
        legacy_note = ""
        if rung not in (None, ""):
            if is_rung_name(rung):
                note.set("rung", rung)
            else:
                errors.append(f"{slug}: rung {rung!r} is not a rung name ([a-z][a-z0-9._-]*, never a YAML word) — "
                              "no rung: stamped")
        elif legacy:
            # A call started before 3.0.0 finished on the tier engine (a Lost-call resume re-passes its old
            # scriptPath): its row has no rung record, only the tier flags. The old reconcile made that climb
            # durable (`model: fable` / `tier_capped:`); left unstamped, the re-dispatch would restart on the
            # bottom rung and re-pay it. The top rung is that climb's equivalent on the ladder.
            if top is None:
                top = _ladder_top()
            name, source = top
            if name:  # ladder.py's load() only returns rung names (tests/ladder.test.mjs L9)
                note.set("rung", name)
                legacy_note = f" rung={name} (pre-3.0.0 row, {legacy})"
                warnings.append(f"{slug}: a pre-3.0.0 row ({legacy}, no rung) — stamped rung: {name}, the top rung "
                                f"of the ladder ({source}), so its re-dispatch does not restart on the bottom rung")
            else:
                errors.append(f"{slug}: a pre-3.0.0 row ({legacy}, no rung) — the ladder could not be read ({source}), "
                              "so no rung: was stamped and its re-dispatch would restart on the bottom rung; fix "
                              "~/.config/thread/ladder.toml and re-run this reconcile")

        if status in STATUS_WITH_PR and pr:
            note.set("pr", pr)
        if status == "review":
            note.set("review_rounds_used", int(task.get("reviewRoundsUsed") or 0))
            plan_rounds = int(task.get("planRoundsUsed") or 0)
            if plan_rounds > 0:
                note.set("plan_rounds_used", plan_rounds)
            # Ceiling approval: persist the accumulated rejection rationale as a run (audit record; the
            # engine sets the flag only when there IS history — a clean first-try approve records
            # nothing). A re-reconcile of the same result is a no-op.
            if task.get("approvedAtCeiling"):
                history = history_block(task.get("reviewHistory"))
                if history:
                    note.append_run(REVIEW_HISTORY_SECTION, history, now)

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
                    # p6-4: every run's feedback is kept as its own numbered run, never only the first.
                    note.append_run(heading, content, now)

        # p12-16: an Integration row leaves one line in the note's `## Integration log` (the durable
        # record a cold lead, repair and the gate resume read). `integration: null` counts as absent.
        integration = task.get("integration")
        if isinstance(integration, dict):
            note.append_line(INTEGRATION_LOG_SECTION, _integration_log_line(task))
        elif integration is not None:
            errors.append(f"{slug}: integration is not an object ({type(integration).__name__}) — "
                          "no Integration log line written")

        # p14-2: the approved plan, settled only by the task's own call. A non-empty string is the plan its
        # own call ran with (upserted, quoted, below the lead-in); '' (or whitespace) is an own call with no
        # plan-gate, so an older plan is stale and removed; null or an absent key (a call that reached no plan
        # outcome, a seeded revise, an Integration row, a lead-written row) leaves the section as it is.
        plan = task.get("plan")
        if isinstance(plan, str) and plan.strip():
            note.upsert_section(APPROVED_PLAN_SECTION, APPROVED_PLAN_LEAD_IN + "\n\n" + quote_block(plan))
        elif isinstance(plan, str):
            note.remove_section(APPROVED_PLAN_SECTION)
        elif plan is not None:
            errors.append(f"{slug}: plan is not a string or null ({type(plan).__name__}) — "
                          f"{APPROVED_PLAN_SECTION} left untouched")

        note.save(dry_run=args.dry_run)
        flag = " (dry-run)" if args.dry_run else (" [written]" if note.dirty else " [no-change]")
        ro = " (read-only, approved)" if note_status != status else ""
        print(f"{slug}: status={note_status}{ro}{(' pr=' + pr) if pr else ''}{_rung_note(task)}{legacy_note}{flag}")

    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- next -------------------------------------------------------------------

def cmd_next(args) -> int:
    """Which tasks start now (ADR 0030 decision 1). Pure function of the notes, except that a drained
    soft pause is stamped (`paused:`) here. A task an undecided RACE or UNVERIFIED holds (_race_holds) and
    that has not landed is re-read as set-aside at `race`: it never starts, restarts or integrates, is never
    a seeded revise (those are set aside at `run`), and its dependants wait. One whose `integrating:` stamp
    stands (the lead's RACE re-verify holds the lane on it) still counts as integrating everywhere else: a
    soft pause is not stamped past it, a solo waits for it, its files count as in flight, and no halt is
    reported while it stands. `raceHold` lists each, in rank order, with its kind; the counts and the
    progress line are the re-read rows'."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    now = _now(args)
    rollout_note = Note(rollout_path)
    ceiling, err = _ceiling(rollout_note)
    if err:
        print(f"ERROR: {rollout_path.stem}: {err}", file=sys.stderr)
        return 1
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rows, index = _rows(rollout_path, rollout_note, tasks_dir)
    why = incomplete(rollout_path, rollout_note, [(r["path"], r["note"]) for r in rows], index)
    if why:
        project = next((s for s in (_wikilink_slug(v) for v in rollout_note.get_list("projects")) if s), "<project>")
        print(f"ERROR: {rollout_path.stem} is incomplete: {why}: never run it as written; supersede it with "
              f"/thread:schedule {project} --regenerate", file=sys.stderr)
        return 1
    race = _race_holds(rollout_note, [(r["path"], r["note"]) for r in rows])
    # race_held_lane: a held task whose `integrating:` stamp stands. The lead's RACE re-verify still holds the
    # lane on it, so it stays in flight for the drain, the solo rule, the overlap and the halt verdict; the
    # re-read only keeps it out of `integrating` (never integrated again) and out of every start.
    race_hold, race_held_lane = [], []
    for r in sorted(rows, key=_rank):
        held = race.get(r["slug"].lower())
        if held and not _landed(r["note"]):
            if r["state"] == "integrating":
                race_held_lane.append(r)
            r["state"], r["setAsideAt"] = "set-aside", "race"
            race_hold.append({"slug": r["slug"], "kind": held[1]})
    by_state = {}
    for r in sorted(rows, key=_rank):
        by_state.setdefault(r["state"], []).append(r)
    in_progress = by_state.get("running", [])
    awaiting = by_state.get("awaiting-integration", [])
    integrating = by_state.get("integrating", [])
    queued = by_state.get("queued", [])

    # Live vs stalled. With no --running, every in_progress note is running: it holds a slot and is
    # never restarted, so a live lead and /thread:status agree. With --running, only the listed slugs
    # are live; every other in_progress note is stalled and restarts ahead of new starts.
    if args.running is None:
        live, stalled = in_progress, []
    else:
        want = {(_wikilink_slug(s) or "").lower() for s in args.running.split(",") if s.strip()}
        live = [r for r in in_progress if r["slug"].lower() in want]
        stalled = [r for r in in_progress if r["slug"].lower() not in want]
        known = {r["slug"].lower() for r in in_progress}
        for s in sorted(want - known):
            print(f"WARN: --running {s}: not an in_progress task of this rollout — ignored", file=sys.stderr)

    paused = _scalar(rollout_note.get("paused")) or None
    pause_requested = _truthy_flag(rollout_note.get("pause_requested"))
    paused_now = False
    start, restart, holds, ceiling_held = [], [], [], []
    used = len(live)

    if paused or pause_requested:
        # A soft pause drains (ADR 0030 decision 5): nothing new starts or restarts; once nothing runs,
        # awaits Integration or integrates (a held RACE re-verify included), the pause is stamped and the
        # request removed.
        if not paused and not live and not awaiting and not integrating and not race_held_lane:
            paused = _stamp(now)
            rollout_note.set("paused", paused, after=("pause_requested", "parallel_ceiling", "status"))
            rollout_note.remove("pause_requested")
            rollout_note.save(dry_run=args.dry_run)
            paused_now = True
        reason = "paused" if paused else "pause requested: draining"
        holds += [(r, reason) for r in stalled + queued]
    else:
        for r in sorted(stalled, key=lambda r: (-r["weight"], r["rank"])):
            if used < ceiling:
                restart.append(r)
                used += 1
            else:
                ceiling_held.append(r)
        started = live + restart + awaiting + integrating + race_held_lane
        candidates = []
        for r in queued:
            unsat = _unsatisfied(r, index)
            if unsat:
                holds.append((r, "; ".join(unsat)))
            else:
                candidates.append(r)
        solo_started = next((r for r in sorted(started, key=_rank) if r["solo"]), None)
        if solo_started:
            holds += [(r, f"behind solo [[{solo_started['slug']}]]") for r in candidates]
        else:
            in_flight = {f for r in started for f in r["files"]}
            remaining = list(candidates)
            while remaining:
                best = min(remaining, key=lambda r: (-r["weight"], _overlap(r["files"], in_flight), r["rank"]))
                if best["solo"]:
                    remaining.remove(best)
                    if not started and not start:
                        start.append(best)
                    else:
                        holds.append((best, f"solo: waits for {len(started) + len(start)} started task(s) "
                                            f"to merge or be set aside"))
                    holds += [(r, f"behind solo [[{best['slug']}]]") for r in remaining]
                    break
                if used + len(start) >= ceiling:
                    ceiling_held += remaining
                    break
                start.append(best)
                remaining.remove(best)
                in_flight.update(best["files"])
    in_use = used + len(start)
    holds += [(r, f"ceiling: {in_use}/{ceiling} slots in use") for r in ceiling_held]

    in_n = [r for r in rows if r["state"] not in OUTSIDE_N]
    counts = _counts(rows)
    halt = None
    if not start and not restart and not live and not awaiting and not integrating and not race_held_lane:
        if paused:
            halt = "paused"
        elif not in_n:
            halt = "empty"
        elif counts["merged"] == counts["total"]:
            halt = "complete"
        else:
            halt = "stuck"
    slugs = lambda rs: [r["slug"] for r in rs]  # noqa: E731
    out = {
        "rollout": rollout_path.stem,
        "ceiling": ceiling,
        "slotsInUse": used,
        "start": slugs(start),
        "restart": slugs(restart),
        "hold": [{"slug": r["slug"], "reason": why} for r, why in sorted(holds, key=lambda h: _rank(h[0]))],
        "running": slugs(live),
        "awaitingIntegration": slugs(awaiting),
        "integrating": slugs(integrating),
        "setAside": [{"slug": r["slug"], "status": r["status"], "setAsideAt": r["setAsideAt"]}
                     for r in by_state.get("set-aside", [])],
        "raceHold": race_hold,
        "paused": paused,
        "pauseRequested": pause_requested,
        "pausedNow": paused_now,
        "halt": halt,
        "progress": _progress_line(counts, _timeline(rows, counts, ceiling, now)),
    }
    print(json.dumps(out, indent=2))
    return 0


# ---- per-task stamps ----------------------------------------------------------

def _each_note(args):
    """Yield (slug, path, Note) for --tasks, collecting not-found / unparseable errors in args._errors."""
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    args._errors = []
    for slug in [s.strip() for s in args.tasks.split(",") if s.strip()]:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            args._errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            yield slug, path, Note(path)
        except ValueError as e:
            args._errors.append(str(e))


def _finish(args, now) -> int:
    _print_progress(args, now)
    for e in args._errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if args._errors else 0


def _flag(args, note) -> str:
    return " (dry-run)" if args.dry_run else (" [written]" if note.dirty else " [no-change]")


def cmd_mark_started(args) -> int:
    """Stamp `started:` as a task starts (first start wins: a restart keeps the first clock) and
    remove `integrating:`. Consumes approve-gates' `gates_signed:` marker (p12-14): the restart that
    directly follows a sign-off says so, once, and no later restart does. Refuses a done, merged or
    dropped note."""
    now = _now(args)
    for slug, _path, note in _each_note(args):
        status = _status(note)
        if status in FINISHED_STATUSES:
            args._errors.append(f"{slug}: status is {status!r} — refusing to mark started")
            continue
        existing = _scalar(note.get("started"))
        if not existing:
            note.set("started", _stamp(now))
        note.remove("integrating")
        signed = _scalar(note.get(GATES_SIGNED_KEY))
        note.remove(GATES_SIGNED_KEY)
        note.save(dry_run=args.dry_run)
        print(f"{slug}: started={existing or _stamp(now)}{' (kept)' if existing else ''}{_flag(args, note)}")
        if signed:
            print(f"{slug}: signed-gate restart (gates signed {signed}; {GATES_SIGNED_KEY}: cleared) — "
                  "a fresh call, not a resume of its gate-pending call, prints execute § 3.7's warning first")
    return _finish(args, now)


def cmd_mark_integrating(args) -> int:
    """Stamp `integrating:` as a task's Integration begins (the first wins). Only a `review` note
    with a `pr:` can be integrating; anything else is refused."""
    now = _now(args)
    for slug, _path, note in _each_note(args):
        status = _status(note)
        if status != "review" or not _pr(note):
            args._errors.append(f"{slug}: status is {status!r}{'' if _pr(note) else ' with no pr:'}, "
                                f"not 'review' with a PR — refusing to mark integrating")
            continue
        existing = _scalar(note.get("integrating"))
        if not existing:
            note.set("integrating", _stamp(now))
        note.save(dry_run=args.dry_run)
        print(f"{slug}: integrating={existing or _stamp(now)}{' (kept)' if existing else ''}{_flag(args, note)}")
    return _finish(args, now)


def cmd_mark_done(args) -> int:
    """review -> done once the task's merge is confirmed; stamps `merged:` on a PR task (first wins)
    and removes `integrating:`. Read-only tasks never need it: reconcile writes them done on approval
    (a legacy read-only note still at review is flipped like any other)."""
    now = _now(args)
    for slug, _path, note in _each_note(args):
        status = note.get("status")
        if _status(note) == "done":
            print(f"{slug}: already done [no-change]")
            continue
        if _status(note) != "review":
            # Only a `review` note is "landed, awaiting confirmation". Anything else means the
            # caller's picture of the rollout is stale — refuse rather than mask a blocked/unmerged task.
            args._errors.append(f"{slug}: status is {status!r}, not 'review' — refusing to mark done")
            continue
        note.set("status", "done")
        if _pr(note) and not _scalar(note.get("merged")):
            note.set("merged", _stamp(now))
        note.remove("integrating")
        note.save(dry_run=args.dry_run)
        print(f"{slug}: status=done" + (" (dry-run)" if args.dry_run else " [written]"))
    return _finish(args, now)


# ---- hand-back and log-integration (the lead's, p12-9) -------------------------------------------

# review-blocked, blocked, plan-blocked; and review, which _queue_state sets aside at its run only for a
# code-writing note approved without a pr: (a review note with a PR awaits Integration; a read-only one is done).
HAND_BACK_RUN_STATUSES = set(BLOCKED_SECTIONS) | {"review"}
SHA40_RE = re.compile(r"[0-9a-f]{40}")


def cmd_hand_back(args) -> int:
    """A set-aside task re-enters at the stage it stopped (ADR 0030 decision 4): set aside at Integration
    -> review (ready: restamped, it rejoins the Integration queue); set aside at its run (a blocked,
    review-blocked or plan-blocked note, or a code-writing review note approved without a pr:) ->
    in_progress (owner: removed, the next `next --running` restarts it, and its own call re-runs on the
    existing tree and branch). Everything else is refused, nothing written. A task an undecided RACE or
    UNVERIFIED holds (_race_holds, on the rollout its `rollout:` names) is refused before anything is
    written, as `carry` refuses: exit 2, one ERROR line per held task naming it and `/thread:repair`, and
    no listed task written. Handing it back would let it integrate and later `resume` with no `RACE decided:`
    line."""
    now = _now(args)
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    notes = list(_each_note(args))
    rollouts, held = {}, []
    for slug, path, note in notes:
        ro = _wikilink_slug(note.get("rollout"))
        if not ro:
            continue  # in no rollout: no Race log or decision to read
        if ro.lower() not in rollouts:
            ro_path = tasks_dir / f"{ro}.md"
            try:
                rollouts[ro.lower()] = Note(ro_path) if ro_path.is_file() else None
            except ValueError:
                rollouts[ro.lower()] = None
        hold = _race_holds(rollouts[ro.lower()], [(path, note)]).get(path.stem.lower())
        if hold:
            held.append(f"hand-back: [[{slug}]] {hold[1]} undecided: no \"repair: [[{slug}]] RACE decided:\" line on "
                        f"{ro}: record Lachy's decision first with /thread:repair [[{ro}]]; nothing written")
    if held:
        for line in held + args._errors:
            print(f"ERROR: {line}", file=sys.stderr)
        return 2
    for slug, _path, note in notes:
        status = _status(note)
        state, at = _queue_state(note)
        if state == "set-aside" and at == "integration" and _pr(note):
            note.set("status", "review")
            note.set("ready", _stamp(now))
            note.remove("integrating")
            note.save(dry_run=args.dry_run)
            print(f"{slug}: blocked->review (set aside at Integration; ready: {_stamp(now)}){_flag(args, note)}")
            continue
        if state == "set-aside" and at == "run" and status in HAND_BACK_RUN_STATUSES:
            note.set("status", "in_progress")
            note.remove("owner")
            note.save(dry_run=args.dry_run)
            print(f"{slug}: {status}->in_progress (set aside at its run; owner: cleared){_flag(args, note)}")
            continue
        why = ("set aside at Integration with no pr:" if at == "integration"
               else f"status is {status or 'none'!r} (queue state {state}{'' if at is None else ' at ' + at})")
        args._errors.append(f"{slug}: {why} — refusing to hand back: only a blocked note set aside at Integration "
                            "(with a pr:), or a blocked, review-blocked, plan-blocked or PR-less code-writing review "
                            "note set aside at its run, re-enters (a gate-pending note goes through approve-gates)")
    return _finish(args, now)


def cmd_log_integration(args) -> int:
    """Append the lead's clean-path Integration line (`integrated path=lead`) to a `review` note with a
    `pr:`, through _integration_log_line; nothing else on the note changes."""
    now = _now(args)
    bad = [f"--{k} {v!r} is not a 40-hex commit sha" for k, v in
           (("anchor", args.anchor), ("head", args.head), ("base", args.base)) if not SHA40_RE.fullmatch(v or "")]
    if not ISO_STAMP_RE.fullmatch((args.started or "").strip()):
        bad.append(f"--started {args.started!r} is not an ISO stamp (lead-integrate.py stamp prints one)")
    if bad:
        for e in bad:
            print(f"ERROR: log-integration: {e}", file=sys.stderr)
        return 1
    started = args.started.strip()
    for slug, _path, note in _each_note(args):
        if _status(note) != "review" or not _pr(note):
            args._errors.append(f"{slug}: status is {_status(note) or 'none'!r}{'' if _pr(note) else ' with no pr:'}, "
                                "not 'review' with a PR — refusing to log an Integration")
            continue
        row = {"prUrl": _pr(note), "integration": {
            "outcome": "integrated", "path": "lead", "anchor": {"headSha": args.anchor}, "headSha": args.head,
            "baseSha": args.base, "triggers": [],
            "metrics": {"startedAt": started,
                        "waitMinutes": _whole_minutes(_scalar(note.get("ready")), started),
                        "durationMinutes": _whole_minutes(started, now.astimezone().isoformat(timespec="seconds"))},
        }}
        line = _integration_log_line(row)
        # A re-run of the same Integration (same --started, same record) is a no-op even at a later --now:
        # every token but the measured duration must match. append_line's own dedupe covers the rest.
        key = line.split(" ")[:8]
        logged = [l.split(" ") for l in _log_lines(note)]
        if not any(t[:8] == key for t in logged):
            note.append_line(INTEGRATION_LOG_SECTION, line)
        note.save(dry_run=args.dry_run)
        print(f"{slug}: integration log += {line}{_flag(args, note)}")
    return _finish(args, now)


# ---- resume (p6-8) ------------------------------------------------------------------

def _gh(gh_bin, argv, cwd):
    """(stdout, error) for one gh call; error is None on success."""
    try:
        p = subprocess.run([gh_bin, *argv], cwd=cwd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        return "", f"{gh_bin}: {e}"
    if p.returncode != 0:
        return "", (p.stderr.strip() or p.stdout.strip() or f"exit {p.returncode}").splitlines()[-1]
    return p.stdout, None


def _project_root(rollout_note):
    m = PROJECT_ROOT_RE.search(rollout_note._body)
    return Path(os.path.expanduser(m.group(1).strip())) if m else None


def cmd_resume(args) -> int:
    """Mark done every linked task whose PR MERGED into the repo's default branch but whose note was
    never marked (an in_progress, review or set-aside note). Checks state AND base: a PR merged into a
    stacked or other branch is not landed. A task an undecided RACE or UNVERIFIED holds (_race_holds) is
    skipped before any gh call, with one stderr `HOLD:` line naming it and `/thread:repair`: main holds a
    combination nobody verified, and only Lachy's `RACE decided:` line releases it. Exit 3 when any task
    was held (ahead of exit 1 for an error; ERROR lines still print), else 1 on an error, else 0."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    now = _now(args)
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rollout_note = Note(rollout_path)
    root = _project_root(rollout_note)
    linked = _linked_task_notes(rollout_path, tasks_dir)
    race = _race_holds(rollout_note, linked)
    defaults, errors, held = {}, [], []
    for path, note in linked:
        slug, status, pr = path.stem, _status(note), _pr(note)
        if status in FINISHED_STATUSES or not pr:
            continue
        if slug.lower() in race:
            held.append(f"HOLD: [[{slug}]] {race[slug.lower()][1]} undecided: no \"repair: [[{slug}]] RACE decided:\" "
                        f"line on {rollout_path.stem}; /thread:repair [[{rollout_path.stem}]]")
            continue
        url, num = PR_URL_RE.match(pr), PR_NUM_RE.match(pr)
        if url:
            ref, repo, cwd = pr, url.group(1), None
        elif num:
            if root is None or not root.is_dir():
                errors.append(f"{slug}: pr: {pr!r} is a bare number and the rollout's Project root "
                              f"({root or 'none'}) is not a directory — cannot resolve its repo")
                continue
            ref, repo, cwd = num.group(1), None, str(root)
        else:
            errors.append(f"{slug}: pr: {pr!r} is neither a GitHub PR URL nor a PR number")
            continue
        raw, err = _gh(args.gh_bin, ["pr", "view", ref, "--json", "state,mergedAt,baseRefName,url"], cwd)
        if err is None:
            try:
                info = json.loads(raw)
            except ValueError:
                err = "gh pr view printed no JSON"
        if err is not None:
            errors.append(f"{slug}: gh pr view {ref} failed: {err}")
            continue
        state = str(info.get("state") or "").upper()
        if state != "MERGED":
            print(f"{slug}: PR {ref} is {state or 'in an unknown state'} [no-change]")
            continue
        key = repo or cwd
        if key not in defaults:
            out, derr = _gh(args.gh_bin, ["repo", "view", *([repo] if repo else []), "--json", "defaultBranchRef",
                                          "--jq", ".defaultBranchRef.name"], cwd)
            defaults[key] = (out.strip() or None, derr or ("empty answer" if not out.strip() else None))
        default, derr = defaults[key]
        if default is None:
            errors.append(f"{slug}: cannot resolve the default branch of {repo or cwd}: {derr}")
            continue
        base = str(info.get("baseRefName") or "")
        if base != default:
            print(f"{slug}: PR {ref} merged into {base!r}, not the default branch {default!r} [no-change]")
            continue
        note.set("status", "done")
        if not _scalar(note.get("merged")):
            merged_at = _parse_ts(info.get("mergedAt"))
            if merged_at is not None:
                note.set("merged", _stamp(merged_at))
        note.remove("integrating")
        note.save(dry_run=args.dry_run)
        print(f"{slug}: status={status or 'none'}->done (PR {ref} merged into {default})" + _flag(args, note))
    print(_progress_for(rollout_path, tasks_dir, now))
    for line in held:
        print(line, file=sys.stderr)
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 3 if held else 1 if errors else 0


# ---- status -----------------------------------------------------------------

def _blocker_summary(note) -> str:
    """The latest run of the section matching the note's own status, then the fixed order. A section
    with no runs is read whole."""
    own = SECTION_BY_STATUS.get(_status(note))
    order = ([own] if own else []) + [h for h in SECTION_BY_STATUS.values() if h != own]
    for heading in order:
        text = note.latest_run_text(heading)
        if text:
            return text
    return ""


def cmd_status(args) -> int:
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    now = _now(args)
    rollout_note = Note(rollout_path)
    ceiling, _err = _ceiling(rollout_note)  # null when invalid: status still reports
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rows, index = _rows(rollout_path, rollout_note, tasks_dir)
    counts = _counts(rows)
    timeline = _timeline(rows, counts, ceiling, now)
    tasks = [{
        "slug": r["slug"],
        "status": r["status"],
        "queueState": r["state"],
        "setAsideAt": r["setAsideAt"],
        "pr": r["pr"],
        "priority": r["priority"],
        "solo": r["solo"],
        "started": r["started"],
        "merged": r["merged"],
        "integrating": r["integrating"],
        "waitingOn": _unsatisfied(r, index) if r["state"] == "queued" else [],
        "blockerSummary": _blocker_summary(r["note"]),
    } for r in sorted(rows, key=_rank)]
    paused = rollout_note.get("paused")
    out = {
        "rollout": rollout_path.stem,
        "rolloutPath": str(rollout_path),
        "rolloutStatus": rollout_note.get("status"),
        # Pause state (execute §Pausing): `paused` = the stamp's timestamp when the rollout is paused
        # (render as PAUSED, not stalled); `pause_requested` = a soft pause is pending and drains.
        "paused": _scalar(paused) or None,
        "pause_requested": _truthy_flag(rollout_note.get("pause_requested")),
        # Why the rollout must not run as written (`next` refuses it), or null: see "Incomplete".
        "incomplete": incomplete(rollout_path, rollout_note, [(r["path"], r["note"]) for r in rows], index) or None,
        "ceiling": ceiling,
        "counts": counts,
        "progress": _progress_line(counts, timeline),
        # Per-task started:/merged: stamps — durable on the notes, so elapsed + the rough (~) remaining
        # estimate render with no workflow run alive. null when no task has a started: stamp.
        "timeline": timeline,
        "tasks": tasks,
    }
    print(json.dumps(out, indent=2))
    return 0


# ---- touched-phases ---------------------------------------------------------

PHASED_STEM_RE = re.compile(r"^(?P<slug>.+?)-p(?P<n>\d+)-")


def cmd_touched_phases(args) -> int:
    """Print `--project <slug> --phases <N,...>` per slug among the rollout's linked phased tasks."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    by_slug = {}
    for path, _note in _linked_task_notes(rollout_path, tasks_dir):
        m = PHASED_STEM_RE.match(path.stem)
        if m:  # loose tasks (no `-p<N>-` segment) belong to no phase
            by_slug.setdefault(m.group("slug"), set()).add(int(m.group("n")))
    for slug in sorted(by_slug):
        print(f"--project {slug} --phases {','.join(str(n) for n in sorted(by_slug[slug]))}")
    return 0


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
        for key in ("wave", "rollout", "owner", "started", "merged", "integrating", "ready", GATES_SIGNED_KEY):
            note.remove(key)
        note.save(dry_run=args.dry_run)
        print(f"{slug}: deferred->open (rollout/owner and started/merged/integrating/ready/{GATES_SIGNED_KEY} cleared, "
              "a legacy `wave:` included)" +
              (" (dry-run)" if args.dry_run else " [written]"))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- carry (a supersede, ADR 0030) -------------------------------------------

# _queue_state's exact strings: what a supersede carries into the new rollout, and what stays behind.
CARRIED_STATES = {"queued", "running", "awaiting-integration", "integrating", "set-aside"}
CLOSED_ROLLOUT_STATUSES = {"done", "dropped"}


def _tags(note):
    return {_scalar(t).lower() for t in note.get_list("tags")}


def _link_slug(note, key) -> str:
    """The lowercased note name a wikilink-valued key points at ('' when absent); an inline `# comment`
    is dropped first, as the template's commented `supersedes:` line may carry one."""
    return (_wikilink_slug(_scalar(note.get(key))) or "").lower()


def _carry_note(path: Path, role: str):
    """(Note, None) for an existing, parseable rollout note, else (None, why)."""
    if not path.is_file():
        return None, f"{role} {path}: no such note"
    try:
        note = Note(path)
    except ValueError as e:
        return None, f"{role} {path}: {e}"
    if "rollout" not in _tags(note):
        return None, f"{role} {path.stem}: not a rollout note (its tags lack `rollout`)"
    return note, None


def cmd_carry(args) -> int:
    def refuse(msg):
        print(f"ERROR: carry: {msg}", file=sys.stderr)
        return 2

    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        return refuse(f"tasks dir {tasks_dir} not found")
    src = Path(os.path.expanduser(args.from_))
    src_note, why = _carry_note(src, "--from")
    if why:
        return refuse(why)
    dst = Path(os.path.expanduser(args.to)) if args.to else None
    if dst is None and not args.dry_run:
        return refuse("--to is required (only --dry-run previews without it)")
    src_status = _status(src_note)
    if src_status in CLOSED_ROLLOUT_STATUSES:
        rerun = src_status == "done" and dst is not None and _link_slug(src_note, "superseded_by") == dst.stem.lower()
        if not rerun:
            return refuse(f"--from {src.stem} is {src_status}: a closed rollout carries nothing")
    linked = _scan(src, tasks_dir)[0]
    fresh, why = never_started(src_note, linked)
    if not fresh and not _valued(src_note.get("paused")):
        return refuse(f"--from {src.stem} has run and is not paused ({why}): only a paused or never-started "
                      "rollout is superseded")
    held = _race_holds(src_note, linked)
    if held:
        names = ", ".join(f"[[{slug}]] ({kind})" for slug, kind in sorted(held.values(), key=lambda h: h[0].lower()))
        return refuse(f"--from {src.stem} holds an undecided RACE or UNVERIFIED: {names}: record Lachy's decision "
                      f"first with /thread:repair [[{src.stem}]]")
    if dst is not None:
        if dst.stem.lower() == src.stem.lower() or (dst.exists() and dst.resolve() == src.resolve()):
            return refuse(f"--to is --from ({src.stem}): a rollout never carries into itself")
        dst_note, why = _carry_note(dst, "--to")
        if why:
            return refuse(why)
        if dst.parent.resolve() != tasks_dir.resolve():
            return refuse(f"--to {dst} is not directly in the tasks dir {tasks_dir}")
        if _status(dst_note) in CLOSED_ROLLOUT_STATUSES:
            return refuse(f"--to {dst.stem} is {_status(dst_note)}: carry only into an open rollout")
        if _link_slug(dst_note, "supersedes") != src.stem.lower():
            return refuse(f"--to {dst.stem}: its supersedes: does not name {src.stem}")
        fresh, why = never_started(dst_note, _scan(dst, tasks_dir)[0])
        if not fresh:
            return refuse(f"--to {dst.stem} has run ({why}): never carry into a running queue")

    rows = []
    for path, note in sorted(linked, key=lambda pn: (pn[0].stem.lower(), str(pn[0]))):
        state = _queue_state(note)[0]
        rows.append((path, note, state, state in CARRIED_STATES))
        print(f"{'carry' if state in CARRIED_STATES else 'keep'} {path.stem} {state}")
    if args.dry_run:
        print("(dry-run)")
        return 0
    written = 0
    for path, note, _state, carried in rows:
        if not carried:
            continue
        note.set("rollout", f'"[[{dst.stem}]]"')
        for key in ("owner", "integrating", "wave"):
            note.remove(key)
        if not note.dirty:
            continue
        try:
            note.save()
        except OSError as e:
            print(f"ERROR: carry: {path.stem}: cannot write {path}: {e} ({written} note(s) already carried)",
                  file=sys.stderr)
            return 1
        written += 1
    print(f"[written: {written}]" if written else "[no-change]")
    return 0


# ---- approve-gates ----------------------------------------------------------

def _norm_gate(line: str) -> str:
    """Normalise a gate line for duplicate detection: bullet + sign-off annotation stripped,
    whitespace collapsed, case-folded (mirrors the engine's normalizeGate — a changed cap is
    a DIFFERENT gate)."""
    s = re.sub(r"^[-*]\s+", "", line.strip())
    s = GATE_ANNOT_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def _last_log_outcome(note):
    """The outcome token of the Integration log's last line (_last_log_line), or None."""
    toks = (_last_log_line(note) or "").split(" ")
    return toks[1] if len(toks) > 1 else None


def _gate_stage(note) -> str:
    """Where a gate-pending note stopped (p12-14): 'integration' when the Integration log's last line is
    `set-aside` and the note has a `pr:` (its integrate call stopped for a gate: the pairing
    `lead-integrate.py inputs` reads as resumeAt: integration), else 'run' (its own call, or a seeded
    revise after a `rejected` line)."""
    return "integration" if _last_log_outcome(note) == "set-aside" and _pr(note) else "run"


def cmd_approve_gates(args) -> int:
    """Record the human sign-off for a gate-pending task's declared gated inputs (ADR 0008), and send
    the task back by the stage it stopped (p12-14): a stop at Integration -> `review` with `ready:`
    restamped and `integrating:` removed (it rejoins the Integration queue, and a fresh integrate call
    re-reads the latest main); any other stop -> `in_progress` with a `gates_signed:` marker (Restart
    routing resumes its gate-pending call on the signed plan, execute § 3.7, and the restart's
    mark-started consumes the marker). The stage is read before the status flips.

    The CALLER's contract: run this only after the user explicitly signed off the gates in
    conversation — the sign-off itself is the one decision no agent may make.
    """
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    date = args.date or datetime.now().astimezone().date().isoformat()
    now = _now(args)
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
        stage = _gate_stage(note)  # before the flip: the pairing reads status gate-pending
        if stage == "run" and _last_log_outcome(note) == "set-aside":
            print(f"WARN: {slug}: the Integration log's last line is set-aside but the note has no pr: — "
                  "it cannot rejoin the Integration queue, so it goes to in_progress (its own call)", file=sys.stderr)
        note.upsert_section(APPROVED_GATES_SECTION, "\n".join(merged))
        note.remove_section(GATE_PENDING_SECTION)
        if stage == "integration":
            note.set("status", "review")
            note.set("ready", _stamp(now))
            note.remove("integrating")
            route = f"status review (stopped at Integration: rejoins the Integration queue; ready: {_stamp(now)})"
        else:
            note.set("status", "in_progress")
            note.set(GATES_SIGNED_KEY, _stamp(now))
            route = f"status in_progress ({GATES_SIGNED_KEY}: {_stamp(now)}, consumed by the restart's mark-started)"
        note.save(dry_run=args.dry_run)
        print(f"{slug}: {len(gates)} gate(s) approved (signed off {date}) -> {route}"
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


# ---- verify-timeout -----------------------------------------------------------

def cmd_verify_timeout(args) -> int:
    """The lead's per-entry check of the rollout's `verify_timeout` (execute § 3, p14-2). Read-only. Valid:
    one JSON line {"verifyTimeout": N, "harnessTimeoutMs": (N + 600) * 1000}, exit 0. Invalid or no note:
    one ERROR line on stderr, exit 1, and the lead's entry writes nothing."""
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"ERROR: rollout note not found at {path}", file=sys.stderr)
        return 1
    try:
        note = Note(path)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    seconds, err = _verify_timeout(note)
    if err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print(json.dumps({"verifyTimeout": seconds, "harnessTimeoutMs": (seconds + VERIFY_HARNESS_MARGIN) * 1000}))
    return 0


# ---- CLI --------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description="Deterministic vault reconcile for a rollout's queue (ADR 0030).")
    sub = p.add_subparsers(dest="cmd", required=True)
    tasks_dir_help = "task-note dir (default: the vault's Work/Tasks)"
    now_help = "the time to stamp or measure against, ISO (default: now)"

    r = sub.add_parser("reconcile", help="write task frontmatter + feedback runs from a workflow result")
    r.add_argument("--result", default="-", help="path to the workflow result JSON, or '-' for stdin (default)")
    r.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    r.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the run headings' stamp)")
    r.add_argument("--dry-run", action="store_true")
    r.set_defaults(func=cmd_reconcile)

    nx = sub.add_parser("next", help="print the queue's next moves as JSON (start/restart/hold/halt)")
    nx.add_argument("--rollout", required=True, help="path to the rollout note")
    nx.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    nx.add_argument("--running", default=None,
                    help="comma-separated slugs whose task calls are live (default: every in_progress note); "
                         "any other in_progress note is stalled and restarts")
    nx.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    nx.add_argument("--dry-run", action="store_true", help="write nothing (a drained pause is reported, not stamped)")
    nx.set_defaults(func=cmd_next)

    for name, func, help_ in (
        ("mark-started", cmd_mark_started, "stamp started: on task notes as they start (first start wins)"),
        ("mark-integrating", cmd_mark_integrating, "stamp integrating: on review notes with a PR (first wins)"),
        ("mark-done", cmd_mark_done, "flip task notes review->done after their merge is confirmed (stamps merged:)"),
    ):
        m = sub.add_parser(name, help=help_)
        m.add_argument("--tasks", required=True, help="comma-separated task slugs")
        m.add_argument("--rollout", default=None, help="rollout note path: also print the progress line")
        m.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
        m.add_argument("--now", type=_iso_arg, default=None, help=now_help)
        m.add_argument("--dry-run", action="store_true")
        m.set_defaults(func=func)

    hb = sub.add_parser("hand-back", help="a set-aside task re-enters at its stage: Integration -> review, its run -> in_progress; "
                                          "refuses a held RACE / UNVERIFIED (exit 2)")
    hb.add_argument("--tasks", required=True, help="comma-separated task slugs")
    hb.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    hb.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the ready: restamp)")
    hb.add_argument("--dry-run", action="store_true")
    hb.set_defaults(func=cmd_hand_back)

    li = sub.add_parser("log-integration", help="append the lead's clean-path Integration line (path=lead) to a review note")
    li.add_argument("--tasks", required=True, help="the task slug")
    li.add_argument("--started", required=True, help="the Integration's start (lead-integrate.py stamp)")
    li.add_argument("--anchor", required=True, help="the anchor (40 hex)")
    li.add_argument("--head", required=True, help="the integrated head (40 hex)")
    li.add_argument("--base", required=True, help="the integrated base (40 hex)")
    li.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    li.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the duration's end)")
    li.add_argument("--dry-run", action="store_true")
    li.set_defaults(func=cmd_log_integration)

    rs = sub.add_parser("resume", help="mark done every linked task whose PR merged into the default branch (p6-8); "
                                       "skip and report a held RACE / UNVERIFIED (exit 3)")
    rs.add_argument("--rollout", required=True, help="path to the rollout note")
    rs.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    rs.add_argument("--gh-bin", default="gh", help="the gh executable (tests pass a stub)")
    rs.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    rs.add_argument("--dry-run", action="store_true")
    rs.set_defaults(func=cmd_resume)

    s = sub.add_parser("status", help="emit JSON situational report for a rollout (read-only; /thread:status)")
    s.add_argument("--rollout", required=True, help="path to the rollout note")
    s.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    s.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    s.set_defaults(func=cmd_status)

    tp = sub.add_parser("touched-phases", help="print --project/--phases lines for the phases a rollout touched (read-only; ADR 0026)")
    tp.add_argument("--rollout", required=True, help="path to the rollout note")
    tp.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    tp.set_defaults(func=cmd_touched_phases)

    df = sub.add_parser("defer", help="pop task(s) out of a rollout back to open backlog (/thread:repair)")
    df.add_argument("--tasks", required=True, help="comma-separated task slugs to defer")
    df.add_argument("--rollout", default=None, help="rollout note path (optional; asserts membership before deferring)")
    df.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    df.add_argument("--dry-run", action="store_true")
    df.set_defaults(func=cmd_defer)

    ca = sub.add_parser("carry", help="re-point a superseded rollout's unlanded tasks to its successor (/thread:schedule)")
    ca.add_argument("--from", dest="from_", required=True, help="path to the prior (superseded) rollout note")
    ca.add_argument("--to", default=None, help="path to the new rollout note (required unless --dry-run)")
    ca.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ca.add_argument("--dry-run", action="store_true", help="print the carry/keep lines and write nothing")
    ca.set_defaults(func=cmd_carry)

    cp = sub.add_parser("clear-pause", help="reinstate a paused rollout: remove paused/pause_requested (/thread:execute resume)")
    cp.add_argument("--rollout", required=True, help="path to the rollout note")
    cp.add_argument("--dry-run", action="store_true")
    cp.set_defaults(func=cmd_clear_pause)

    vt = sub.add_parser("verify-timeout", help="print the rollout's verify_timeout and its harness timeout as JSON, "
                                               "or exit 1 when invalid (read-only; execute § 3)")
    vt.add_argument("--rollout", required=True, help="path to the rollout note")
    vt.set_defaults(func=cmd_verify_timeout)

    ag = sub.add_parser("approve-gates", help="record the human sign-off for a gate-pending task's gated inputs (ADR 0008)")
    ag.add_argument("--tasks", required=True, help="comma-separated task slugs (must be at status gate-pending)")
    ag.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ag.add_argument("--date", default=None, help="sign-off date stamped on each gate (default: today)")
    ag.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the ready: restamp of a stop at Integration)")
    ag.add_argument("--dry-run", action="store_true")
    ag.set_defaults(func=cmd_approve_gates)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
