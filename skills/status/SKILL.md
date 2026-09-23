---
name: status
description: 'Use to see the present situation of a wave rollout — a read-only situational report. Triggers on "wave status of [[rollout]]", "where is [[rollout]] / this rollout", "what state is the rollout in", "what''s left on [[rollout]]", "is [[rollout]] done", or pointing at a rollout note and asking what''s happening. Reads the rollout note + every linked task note and cross-checks live GitHub PRs + git worktrees, flags drift, and recommends the next action. NEVER writes the vault or merges anything. Read-only sibling of /thread:repair. Scope: Obsidian + read-only gh/git.'
---

# /thread:status — the present situation of a rollout

`/thread:status [[rollout]]` answers one question: **where is this rollout right now?** It reads the
rollout note and every task carrying `rollout: [[<slug>]]`, cross-checks them against live GitHub PR
state + git worktrees, flags any **drift**, and prints a single recommended next action.

It is **read-only** — it never stamps frontmatter, never merges, never dispatches. To *act* on what it
finds, that's `/thread:repair` (the conductor) or `/thread:execute` (resume). This skill is the diagnosis;
those are the treatment.

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` (older undated `<slug>-rollout` notes
still resolve — see step 1) + its linked task notes, and makes **read-only**
`gh`/`git` calls against the target repo. Writes nothing. Obsidian + GitHub read access only.

## Invocation forms

```
/thread:status [[giflab-rollout]]            # full situational report (live cross-check, the default)
status of [[giflab-rollout]]               # natural language — same thing
/thread:status [[giflab-rollout]] --offline  # vault-only: skip the gh/git cross-check (instant)
```

## Skill flow

### 1. Resolve the rollout note

Resolve `[[<slug>]]` → `~/repos/obsidian/Work/Tasks/<slug>.md`. If several dated/ordinal notes match an
ambiguous name (e.g. "today's giflab rollout"), **list the matches and ask which** — don't assume. Read
the body's `Project root: \`<repoPath>\`` line — it's the repo for the live checks. (No protocol gate:
status is read-only and reports whatever it finds, noting if a note predates `protocol_version: 3`.)

### 2. Gather the vault state (deterministic)

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py status --rollout <rollout-note>
```

Returns JSON: `{ rollout, rolloutStatus, paused, pause_requested, merged_through_wave, total_waves,
timeline, tasks: [{ slug, wave, status, pr, blockerSummary }] }` — **every** task carrying
`rollout: [[<slug>]]` (glob-by-backlink, so read-only tasks the `## File-sets` block omits are still
included), sorted by wave then slug. Pure read, no network. `paused` is the pause stamp's timestamp
(null when not paused); `pause_requested` is true when a soft pause is pending and will take effect at
the next wave boundary (execute → *Pausing + reinstating a rollout*).

`timeline` is the progress/ETA block, computed from the `wave_N_dispatched:` / `wave_N_merged:`
wave-boundary stamps execute writes on the rollout note (`mark-dispatched` at each wave launch, the
`cursor` step post-merge): per-wave `{ wave, tasks, dispatched, merged, durationMinutes }`, plus
`elapsedMinutes`/`elapsedLabel`, `avgTaskMinutes`, `remainingEstimateMinutes`/`remainingLabel` (always
a `~… (rough)` figure — in-rollout arithmetic only, no calibration), `totalWaves`, `complete`. The
stamps are durable frontmatter, so elapsed + estimate render **without any workflow run being alive**
— exactly what a kill/resume needs. `null` when the rollout has no stamps (predates the feature):
omit the timing line rather than guessing.

### 3. Live cross-check (default; `--offline` skips)

The vault is the engine's source of truth — but status is exactly the moment you suspect it's stale.
Cross-check cheaply and flag **drift**:

- **Worktrees** — one `git -C <repoPath> worktree list --porcelain`. For each non-landed task, its
  worktree is `<repoPath>/.claude/worktrees/<slug>`. A blocked task whose worktree is **gone** (reaped
  by the 11am sweep) → note it (re-dispatch will branch fresh from the base branch (`origin/main`, or `origin/<defaultBranch>`) — fine, not an error).
- **PRs** — for each task with a `pr:`, one `gh pr view <pr> --json state,mergedAt,statusCheckRollup`.
  Flag drift:
  - note `review`/`review-blocked` but PR **MERGED** → *out-of-band merge*. (`review` → resolves on the
    next execute via `mark-done`; `review-blocked` → genuine drift, needs `/thread:repair` to reconcile → done.)
  - note `review-blocked` but PR **OPEN with checks now green** → may already be fixed; flag for a retry.
  - note `blocked`/`plan-blocked` carrying an open PR → unusual; surface it.
  - note `in_progress`/`open` but PR **MERGED** → *stranded merge*. `resume-filter` still counts it as
    to-dispatch, so any resume would re-run merged work. `/thread:repair` escalates it; protocol 3 has
    no sanctioned path to done. The flag reads `state` from the per-task `gh pr view` above (no extra
    call). Only tasks carrying `pr:` can be flagged: a stranded task with no `pr:` is invisible here,
    because a `gh pr list --head` search would break the one-call budget.

Keep it to one `worktree list` + one `gh` call per PR'd task. On `--offline`, skip this step entirely and
say the report is vault-only. Offline, stranded merges are invisible: `mark-done` never clears `owner:`
(only `defer` does), so a reverted or clobbered done note still carries `owner:` + `pr:` and reads as
in flight. Any resume or reinstate recommendation made offline must say so (§ 4).

### 4. Render the situational report

```
[[<rollout>]] — wave <K>/<N> merged — 1h 24m elapsed, ~50m remaining (rough)   (status: <rolloutStatus>)

Wave 1  ✓ merged (30m)
  [[task-a]]   done
Wave 2  ~ in progress
  [[task-c]]   review        PR #42 (open)        → awaiting merge
  [[task-d]]   review-blocked PR #43              ⚠ needs: <first line of blockerSummary>
  [[task-e]]   blocked       (worktree present)   ⚠ needs: <first line of blockerSummary>
Wave 3  ◦ not started
  [[task-f]]   open

Drift:
  ⚠ [[task-d]] PR #43 is MERGED on origin but note says review-blocked → /thread:repair reconciles to done
  ⚠ [[task-x]] PR #44 is MERGED but note says in_progress → stranded merge; /thread:repair escalates

Recommended next action: <one line>

(a wave whose run is live renders instead as:)
Wave 2  ~ in flight (owner execute-2026-09-23-95fc34e2)
  [[task-c]]   in_progress  owner execute-2026-09-23-95fc34e2
```

Group by wave; within a wave list each task with status, PR (+ live state), and — for any blocker — the
*first line* of its `blockerSummary` as "needs: …". Surface drift in its own block.

**Timing comes from `timeline`, and the estimate is always rough.** Headline `elapsedLabel` +
`remainingLabel` when present; put each merged wave's `durationMinutes` in parentheses on its wave
header. Render the estimate exactly as labelled — `~50m remaining (rough)` — never restate it as a
precise figure. With no completed wave yet (`avgTaskMinutes` null) show elapsed only; `complete: true`
→ show the total instead ("completed in 2h 10m"); `timeline: null` → no timing line at all (the
rollout predates the wave-boundary stamps).

**A paused rollout renders as paused, not stalled.** When the JSON carries `paused: <timestamp>`,
headline it — `[[<rollout>]] — PAUSED since <timestamp> — wave <K>/<N> merged` — list what's left as
usual, and skip the stalled/blocked framing: the pause is intentional (execute → *Pausing + reinstating
a rollout*), so unlanded tasks behind it are "waiting for reinstate", not blockers to escalate. When
`pause_requested` is true (stamp not yet written), report "pause pending — the in-flight wave finishes +
merges, then the rollout pauses at the wave boundary."

**A wave in flight renders as in flight, not stalled.** The base condition: wave K has at least one task
that is `in_progress`, carries an `owner:`, and is not flagged as a stranded merge (§ 3). The status JSON
doesn't carry `owner:`, so read it from the note itself:
`grep -m1 '^owner:' ~/repos/obsidian/Work/Tasks/<slug>.md`. On `--offline` the stranded-merge exclusion
can't run (§ 3 is skipped), so an offline "in flight" may be a stranded merge: say so.

- **Confirmed** — `Wave K  ~ in flight (owner <tag>)`: the base condition holds, and `timeline.waves[]`
  entry K has `dispatched` set and `merged` null.
- **Hedged** — `Wave K  ~ possibly in flight (owner <tag>)`: the base condition holds and either (a)
  `timeline` is null, or (b) `timeline` is non-null but wave K's `dispatched` is null. (b) is the race
  window: execute § 4.5 step 1 stamps `in_progress` and `owner:` before `mark-dispatched` writes
  `wave_K_dispatched`.

List each such task as `in_progress  owner <tag>`, and render the tag verbatim — it is free-form
(`execute-<date>-<id>`, `cc-…`, older prose tags), never parsed. When wave-K tasks carry more than one
distinct tag, list every one.

**Owner-session qualifier.** A Workflow run is listed in `/workflows` only in the session that launched
it, and the `owner:` tag names that session. "No run in `/workflows`" counts as evidence of a stall only
when it was checked **in that owner session**, or that session is known to have ended (every owner
session, when there are several tags). From any other session, status cannot tell live from stalled: say
so, and recommend checking the owner session first. In continuous mode, while the owner session is
alive, its heartbeat cron re-enters the resume on a genuine stall (`--gated` and single-wave runs have no
heartbeat, and a closed terminal stops it — execute § 8); another session resumes only once the owner
session has ended.

Then **one** recommended next action:

- `paused` stamped → "reinstate with `/thread:execute [[<rollout>]]`" (never `/thread:repair` — a pause
  needs no repair; only recommend repair for drift that is independent of the pause, and say so). If the
  Drift block flags a stranded merge, recommend `/thread:repair [[<rollout>]]` instead: reinstate is a
  cold resume, and its `resume-filter` would re-dispatch the merged task. Repair escalates it; reinstate
  only once it is cleared.
- all tasks `done` → "rollout complete — run the completion ceremony" (or "already archived").
- wave K in flight or possibly in flight (tasks `in_progress` with an owner, wave not merged) → "wait for
  the run; don't resume from here." Check `/workflows` **in the owner session** (`<owner tag>`). If a run
  is visible there, wait. If no run shows there, or that session is known to have ended,
  `/thread:execute [[<rollout>]]` resumes from the cursor, unless the Drift block flags a stranded merge:
  then recommend `/thread:repair [[<rollout>]]`, never the resume. Checked from any other session, "no
  run" proves nothing — check the owner session first. On `--offline`, add: "stranded merges are
  invisible offline; re-run with the live check before resuming".
- any stranded merge (Drift block) → "run `/thread:repair [[<rollout>]]`: it stops and escalates the task
  for your decision. Never resume, because `resume-filter` would re-dispatch the merged task."
- approved PRs awaiting merge / cursor behind → "re-run `/thread:execute [[<rollout>]]` to merge & continue".
- any blocker or drift → "run `/thread:repair [[<rollout>]]`".
- nothing dispatched yet → "run `/thread:execute [[<rollout>]]` to start".

The list is first-match, with one precedence rule: a stranded merge in the Drift block overrides every
item that would recommend `/thread:execute` (reinstate, resume or start) — the recommendation becomes
`/thread:repair [[<rollout>]]`. While a wave is in flight, any flag in the Drift block, stranded merges
included, still goes to `/thread:repair` once the run has ended. Any resume or reinstate recommended from
an `--offline` report carries the offline caveat above.

Keep the whole report scannable — it's a glance, not a wall of text.

## Loopable

Status is read-only, so it's safe to run under the built-in `/loop` as a rollout watchdog:
`/loop 45m /thread:status [[<rollout>]]` during a long rollout catches drift and stranded-`review`
tasks early instead of days later. When a looped status finds the rollout `done`/archived, say so and
stop the loop (a dynamic loop ends by not rescheduling; a fixed loop needs `/loop stop`) — don't keep
polling a finished rollout. The loop watches and recommends; it never triggers `/thread:repair` or
`/thread:execute` on its own. See execute's §8 (*Unattended driving*) for the full pattern set.

## Don'ts

- **Don't write anything.** No frontmatter edits, no merges, no dispatch — that's `/thread:repair` /
  `/thread:execute`. If you find yourself wanting to fix something, stop and recommend the repair verb.
- **Don't re-scan GitHub for the cursor.** `merged_through_wave` in the note is the source of truth for
  "how far merged"; the live PR check is only for drift flags.
- **Don't parse the rollout's markdown wave table** for the task list — use the `status` subcommand's
  glob-by-backlink (it catches read-only tasks the table/`## File-sets` block omit).
- **Don't make more than one `gh` call per PR'd task.** Status is a glance; keep it cheap.
- **Don't recommend a resume against a wave that is in flight or possibly in flight** unless the owner
  session, checked there, shows no run or has ended, and no stranded merge is flagged. Otherwise point at the owner
  session's `/workflows`, or at `/thread:repair`. Offline, qualify any resume: stranded merges are
  invisible there.
