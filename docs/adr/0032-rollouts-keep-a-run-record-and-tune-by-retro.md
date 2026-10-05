# 0032 — rollouts keep a Run record and tune by Retro

Date: 2026-10-04
Status: proposed, implementation pending (amends the rollout defaults that schedule stamps and
execute and reconcile assume, the rollout template's `## Resource budget`, and execute's "don't
raise `parallel_ceiling` blindly" rule; grilled with Lachy 2026-10-04 in `/thread:orient Thread
Skill`, from his question "why three tasks at once, why not ten?")

## Context

Lachy asked what limits a rollout's parallelism and how to dial it for faster rollouts. Answering
took hand-assembly from four scattered sources: task-note stamps, `## Integration log` lines, the
lead transcript's `ROLLOUT-STATUS` lines and the Workflow journals. The first reading was wrong.

The corrected reading of chorus-rollout-2026-10-03:
- **Before 16:16+10:00 on 3 Oct**, one task ran at a time, around a soft-pause cut-over.
- **From 16:16+10:00 on 3 Oct to 09:23+11:00 on 4 Oct** (16 h 07 min, across the DST change),
  every status line reads `running=3`. The run made 38 merges, about 2.4 an hour.
- **The Integration lane** handled 51 Integrations for those merges, about 45% busy. At 1.34
  Integrations per merge, the lane caps merges near 5.3 an hour.
- **Another rollout overlapped it:** thread-skill-rollout-2026-10-03 ran on the same machine and
  account.

So the window reads Slot-bound with some headroom, but what a higher ceiling buys has to be
measured. Nothing recorded any of this as it ran. The Parallel ceiling also had no home for a
learned value: it's a flat template default of 4, set to 3 by hand here and raised to 5 by hand
at 09:43+11:00 on 4 Oct.

## Decision

1. **A Run record, written only by scripts.** A rollout's Slot and Integration-lane transitions,
   and the settings in force at each Slot start, are appended as events by script subcommands,
   never by a model. Where a transition happens only in the lead's own state, the lead calls a
   script to record it. The event catalogue and its schema belong to the implementation (P15).
2. **It lives in `${THREAD_EVENTS_DIR:-${XDG_STATE_HOME:-~/.local/state}/thread/events}`**, the
   convention `git-env-canary.py` already uses. Every writer resolves this chain itself. Hooks,
   Codex and launchd export no override, so the default path is the shared meeting point. On
   Lachy's machine, the default directory `~/.local/state/thread/events` is a symlink to
   `_shared/state/thread-events/` so the record is backed up. `THREAD_EVENTS_DIR` is for tests and
   non-default setups.
3. **A Retro turns the record into Tunings.** It scores a run on **Throughput**, weighs it against
   **Guardrails** whose bounds are operator settings, names what bound the run, and proposes
   Tunings. Lachy picks; a script applies them. The engine never changes its own settings mid-run.
4. **Tunings live in an operator settings file**, `~/.config/thread/rollouts.toml`, a sibling of
   ADR 0029's `ladder.toml`. It is keyed per repo by an identity that a self-rollout's separate
   clone shares. Schedule resolves its defaults from the file. With no file, the built-in defaults
   apply.
5. **Automatic adjustment comes later, by ADR.** Once three or more Retros agree on a rule, it may
   move into the engine as a live adjustment, recorded in its own ADR.

Considered:
- *Decision 1:* deriving the timeline on demand. It writes nothing new, but it is fragile: it
  misled the first reading, and transcripts move, compact and are cleaned up. A metrics section
  the lead writes. That is model-written, so it drifts out of schema.
- *Decision 2:* the plugin's data directory. No plugin-data variable is exported where the scripts
  run, and uninstalling the plugin deletes it. Hard-coding the estate path breaks the plugin for
  other users. A file in each target repo makes cross-repo comparison harder. *An exported override
  as the backup's home*: it doesn't reach hooks, Codex or launchd, so their events would split into
  a second directory.
- *Decision 3:* live auto-adjust now. Fast, but it acts on rules nobody has validated. Other
  objectives: wall-clock is noisy, cost per merge targets the wrong scarcity, and a scorecard with
  no headline is never decisive. A machine-wide Slot cap across rollouts is deferred until Retros
  show whether one is needed.
- *Decision 4:* project-note frontmatter keys engine knobs to projects, not repos. A repo
  `CLAUDE.md` line makes every Tuning a slow PR. A path key misses a self-rollout's clone.

## Consequences

- **What it covers.** The decision is about the rollout lane. `/fresh-review` rounds may emit the
  same record format from their own repo, resolving the same directory chain (the override, then
  `XDG_STATE_HOME`, then the home default), so a review round recorded with no override lands
  beside the rollouts.
- **Places that assume the old defaults.** Every place that hard-codes the rollout defaults moves
  to the resolved value: schedule's stamped frontmatter and its self-check, execute's defaults
  table, `reconcile-rollout.py`'s absent-value default, the template's `## Resource budget`
  paragraph and the schedule tests. The machine is an M2 Max with 12 cores, so the Workflow
  per-call agent cap is 10, not "~14 on the M3".
- **Concurrent Workflow calls.** The spike tested only 3 calls at once. Every ceiling of 3 or
  more, plus an integrate call, already runs past that, and the Chorus run at 5 can hold 6. The
  first Retro, on a record backfilled from that run, is where the question gets answered.
