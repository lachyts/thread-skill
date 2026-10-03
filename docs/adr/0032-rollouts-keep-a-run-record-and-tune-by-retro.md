# 0032 — rollouts keep a Run record and tune by Retro

Date: 2026-10-04
Status: proposed, implementation pending (amends schedule's stamped defaults (`schedule/SKILL.md`
§ defaults and step 6's self-check), the rollout template's `## Resource budget`, and execute's
"don't raise `parallel_ceiling` blindly" rule; grilled with Lachy 2026-10-04 in `/thread:orient
Thread Skill`, from his question "why three tasks at once, why not ten?")

## Context

Lachy asked what limits a rollout's parallelism and how to dial it for faster rollouts. Answering
took hand-assembly from four scattered sources: task-note stamps (`started:`, `ready:`, `merged:`),
`## Integration log` lines, the lead transcript's `ROLLOUT-STATUS` lines and the Workflow journals
(`totalTokens`, `durationMs`). The first reading was wrong (it claimed idle Slots).

The corrected reading of chorus-rollout-2026-10-03, with its caveats. From 11:35 to 16:16 on 3 Oct
one task ran at a time, around a soft-pause cut-over (ADR 0031). From 16:16 on 3 Oct to 09:23 on
4 Oct every status line reads `running=3`: 38 merges in about 16 h (about 2.4 per hour, about
75 min per Slot). The Integration lane ran 51 Integrations for those merges (431 min, mean 8.5 min,
mean wait 8.7 min), about 45% busy. thread-skill-rollout-2026-10-03 (ceiling 4) ran beside it from
16:33 to 00:43 on the same machine and account, so the window was not uncontended. At 1.34
Integrations per merge, the lane caps merges near 5.3 per hour, and waits climb well before that.
So the window reads Slot-bound with headroom, but how much a higher ceiling buys is a question
for measurement. Nothing recorded any of this as it happened. The ceiling (a flat template default
of 4, set to 3 by hand on this run) also had no home for a learned value. It was raised to 5 by
hand at 2026-10-04T09:43+11:00, mid-run.

## Decision

1. **A Run record, written only by scripts.** Every event is appended by a script subcommand,
   never by a model, through one writer whose header is the schema. Each event is one JSON line:
   a UTC timestamp (`Z`), the host, the rollout, the task, a kind, and kind-specific fields.
   - **Slots:** taken (with the runId and the lead session's journal directory, bound right after
     launch), freed (with the outcome), ready, set aside (stage, reason class).
   - **The Integration lane:** taken, freed (path, triggers, whether it conflicted), merged. A
     read-only task's completion counts as merged.
   - **Run state:** `ceiling-changed` (written by `next` whenever the note's `parallel_ceiling`
     differs from the last value recorded), paused and resumed, hold started and ended (merge
     hold, git-env hold), `idle-slots` (free Slots with nothing startable, and why: dependency or
     Solo), and `quota-stall` (a call that ended on a usage limit).

   A transition that today lives only in the lead's state (a lane freed by a canary trip or halt,
   a Lost-call `resumeFromRunId` resume, a signed-gate resume) gets a thin subcommand that the lead
   calls, so the script still writes it. Tokens and durations come from the Workflow journals the
   bound runIds name. They are folded in whenever a Retro runs, mid-run, at close, or on a
   superseded or dropped rollout, so no rollout depends on reaching a close.
2. **It lives in `${THREAD_EVENTS_DIR:-${XDG_STATE_HOME:-~/.local/state}/thread/events}`**, which
   is the convention `git-env-canary.py` already uses. It holds one file per rollout plus one for
   review loops. On Lachy's machine, `THREAD_EVENTS_DIR` points at `_shared/state/thread-events/`
   so the record is backed up. `/fresh-review`'s `review-ledger.py` sits in another repo
   (`~/.agents`) and is not a plugin step. It writes `review-round` events in the same schema, and
   only when `THREAD_EVENTS_DIR` is set.
3. **A Retro turns the record into Tunings.** At a rollout's end, or on request mid-run, a Retro
   scores the run. **Throughput** is merges per running hour. Running time runs from the first
   Slot taken to the last merge, minus paused spans. Merge holds count as running, because task
   calls go on during them. The score is weighed against **Guardrails**: tokens per merge,
   set-aside rate, conflict rate and quota stalls, each with a bound. The Retro names what bound
   the run: Slots, the Integration lane, quota or dependencies. It reads every record whose span
   overlaps the run, so concurrent rollouts' load on the machine shows up. Then it proposes
   Tunings. Lachy picks, and a script applies them. The engine never changes its own settings
   mid-run.
4. **Tunings live in an operator settings file**, a sibling of ADR 0029's `ladder.toml`:
   `~/.config/thread/rollouts.toml`. It has a defaults table, a `[guardrails]` table of bounds, and
   per-repo tables keyed by the GitHub origin's `owner/name`. That key comes from the local
   `git remote` with no network call, and a self-rollout's separate clone resolves to the same
   key. Schedule resolves from the file and stamps the resolved starting values into the rollout
   note. Any later change to the live note is recorded as `ceiling-changed`. With no file, the
   built-in defaults apply.
5. **Automatic adjustment comes later, by ADR.** Once three or more Retros agree on a rule
   (e.g. "lane under 50% busy, no quota stall → +1 Slot"), that rule may move into the engine as a
   live adjustment, recorded in its own ADR.

Considered:
- *Decision 1:* deriving the timeline on demand from notes, transcripts and journals. It writes
  nothing new, but it is fragile: it misled the first reading, and transcripts move and compact.
  A metrics section the lead writes into the rollout note. That is model-written, so it drifts out
  of schema. Folding journals only at close. That never happens for superseded rollouts, and the
  runIds were never kept.
- *Decision 2:* the plugin's data directory. The scripts run from the lead's Bash tool or Codex,
  where no plugin-data variable is exported, and an uninstall deletes the directory, so an
  append-only history would be wiped. Hard-coding the estate path breaks the plugin for other
  users. A file in each target repo means cross-repo comparison has to collect from many places,
  and worktrees complicate it.
- *Decision 3:* live auto-adjust now. Fast, but the engine would change itself on rules nobody
  has validated. Other objectives: wall-clock to drain is noisy, cost per merge targets the wrong
  scarcity, and a scorecard with no headline is never decisive. A machine-wide Slot cap across
  rollouts was deferred. The Retro reports cross-rollout load first, and the first Retros show
  whether a cap is needed.
- *Decision 4:* project-note frontmatter puts engine knobs in vault notes, keyed by project, not
  repo. A repo `CLAUDE.md` line makes every Tuning a slow PR on the target repo. A path-keyed repo
  table misses a self-rollout's separate clone.

## Consequences

- Scope is the rollout lane plus review loops. Other thread verbs may emit the same format later.
- Schedule's stamped literals (`parallel_ceiling: 4` and the round caps) become resolved values.
  Its step-6 self-check, `tests/schedule-queue.test.sh`'s `parallel_ceiling: 4` assertion and the
  template's `## Resource budget` paragraph ("Lachy's M3 96GB, 3-4") change with them. The machine
  is an M2 Max with 12 cores and 96 GB, so the Workflow per-call agent cap is
  `min(16, CPUs - 2)` = 10. Execute's "~14 on the M3" line is wrong and goes.
- The spike's open question (is there a cross-call cap on concurrent Workflow calls?) has only
  been tested to 3. It is live already: the default of 4 plus an integrate call is 5 calls, and
  the Chorus run at 5 can hold 6. Until a Retro answers it, a ceiling above 4 is an experiment.
  The first Retro, on the Chorus run, answers it.
