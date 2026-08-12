---
name: status
description: 'Use to see the present situation of a wave rollout — a read-only situational report. Triggers on "wave status of [[rollout]]", "where is [[rollout]] / this rollout", "what state is the rollout in", "what''s left on [[rollout]]", "is [[rollout]] done", or pointing at a rollout note and asking what''s happening. Reads the rollout note + every linked task note and cross-checks live GitHub PRs + git worktrees, flags drift, and recommends the next action. NEVER writes the vault or merges anything. Read-only sibling of /wave:repair. Scope: Obsidian + read-only gh/git.'
---

# /wave:status — the present situation of a rollout

`/wave:status [[rollout]]` answers one question: **where is this rollout right now?** It reads the
rollout note and every task carrying `rollout: [[<slug>]]`, cross-checks them against live GitHub PR
state + git worktrees, flags any **drift**, and prints a single recommended next action.

It is **read-only** — it never stamps frontmatter, never merges, never dispatches. To *act* on what it
finds, that's `/wave:repair` (the conductor) or `/wave:execute` (resume). This skill is the diagnosis;
those are the treatment.

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` (older undated `<slug>-rollout` notes
still resolve — see step 1) + its linked task notes, and makes **read-only**
`gh`/`git` calls against the target repo. Writes nothing. Obsidian + GitHub read access only.

## Invocation forms

```
/wave:status [[giflab-rollout]]            # full situational report (live cross-check, the default)
status of [[giflab-rollout]]               # natural language — same thing
/wave:status [[giflab-rollout]] --offline  # vault-only: skip the gh/git cross-check (instant)
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
  by the 11am sweep) → note it (re-dispatch will branch fresh from `origin/main` — fine, not an error).
- **PRs** — for each task with a `pr:`, one `gh pr view <pr> --json state,mergedAt,statusCheckRollup`.
  Flag drift:
  - note `review`/`review-blocked` but PR **MERGED** → *out-of-band merge*. (`review` → resolves on the
    next execute via `mark-done`; `review-blocked` → genuine drift, needs `/wave:repair` to reconcile → done.)
  - note `review-blocked` but PR **OPEN with checks now green** → may already be fixed; flag for a retry.
  - note `blocked`/`plan-blocked` carrying an open PR → unusual; surface it.

Keep it to one `worktree list` + one `gh` call per PR'd task. On `--offline`, skip this step entirely and
say the report is vault-only.

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
  ⚠ [[task-d]] PR #43 is MERGED on origin but note says review-blocked → /wave:repair reconciles to done

Recommended next action: <one line>
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

Then **one** recommended next action:

- `paused` stamped → "reinstate with `/wave:execute [[<rollout>]]`" (never `/wave:repair` — a pause
  needs no repair; only recommend repair for drift that is independent of the pause, and say so).
- all tasks `done` → "rollout complete — run the completion ceremony" (or "already archived").
- approved PRs awaiting merge / cursor behind → "re-run `/wave:execute [[<rollout>]]` to merge & continue".
- any blocker or drift → "run `/wave:repair [[<rollout>]]`".
- nothing dispatched yet → "run `/wave:execute [[<rollout>]]` to start".

Keep the whole report scannable — it's a glance, not a wall of text.

## Loopable

Status is read-only, so it's safe to run under the built-in `/loop` as a rollout watchdog:
`/loop 45m /wave:status [[<rollout>]]` during a long rollout catches drift and stranded-`review`
tasks early instead of days later. When a looped status finds the rollout `done`/archived, say so and
stop the loop (a dynamic loop ends by not rescheduling; a fixed loop needs `/loop stop`) — don't keep
polling a finished rollout. The loop watches and recommends; it never triggers `/wave:repair` or
`/wave:execute` on its own. See execute's §8 (*Unattended driving*) for the full pattern set.

## Don'ts

- **Don't write anything.** No frontmatter edits, no merges, no dispatch — that's `/wave:repair` /
  `/wave:execute`. If you find yourself wanting to fix something, stop and recommend the repair verb.
- **Don't re-scan GitHub for the cursor.** `merged_through_wave` in the note is the source of truth for
  "how far merged"; the live PR check is only for drift flags.
- **Don't parse the rollout's markdown wave table** for the task list — use the `status` subcommand's
  glob-by-backlink (it catches read-only tasks the table/`## File-sets` block omit).
- **Don't make more than one `gh` call per PR'd task.** Status is a glance; keep it cheap.
