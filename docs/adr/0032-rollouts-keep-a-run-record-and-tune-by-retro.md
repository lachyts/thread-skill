# 0032 — rollouts keep a Run record and tune by Retro

Date: 2026-10-04
Status: proposed, implementation pending (grilled with Lachy 2026-10-04 in `/thread:orient Thread
Skill`, from his question "why three tasks at once, why not ten?")

## Context

Lachy asked what limits a rollout's parallelism and how to dial it for faster rollouts. Answering
took hand-assembly from four scattered sources: task-note stamps (`started:`, `ready:`, `merged:`),
`## Integration log` lines, the lead transcript's `ROLLOUT-STATUS` lines and the Workflow journals
(`totalTokens`, `durationMs`). The first reading was wrong (it claimed idle Slots; the status lines
show `running=3` throughout). The corrected reading of chorus-rollout-2026-10-03: 38 merges in about
16 h (about 2.4 per hour), Slots full the whole time at a Parallel ceiling of 3 (about 75 min per
Slot), and the Integration lane busy about 45% (51 Integrations, 431 min, mean 8.5 min, mean wait
8.7 min). The run was Slot-bound, so a higher ceiling would help until the Integration lane
saturates near 7 per hour; RAM binds only for heavy verifiers. Nothing recorded this as it
happened, and the ceiling (a flat template default of 4, hand-set to 3 here) had no home for a
learned value.

## Decision

1. **A Run record, emitted by the deterministic steps.** The scripts that already run at each step
   of the rollout lane and of `/fresh-review`'s loop (`reconcile-rollout.py`, `lead-integrate.py`,
   `merge-task.sh`, `review-ledger.py`) each append one JSON event line: Slot taken and freed, task
   ready, Integration lane taken and freed, merge, set-aside, review round. Tokens and durations
   are folded in from the Workflow journals when a rollout closes. No model writes the record.
2. **It lives in the plugin's data directory**, one file per rollout plus one for review loops,
   with an environment override (`THREAD_EVENTS_DIR`) that points Lachy's machine at
   `_shared/state/thread-events/` so it is backed up and reachable outside the plugin.
3. **A Retro turns the record into Tunings.** At a rollout's end (or on request mid-run) a Retro
   scores the run on **Throughput** (merges per running hour) against **Guardrails** (tokens per
   merge, set-aside rate, conflict rate, quota stalls), names what bound it, and proposes Tunings.
   Lachy picks; a script applies them. The engine never changes its own settings mid-run.
4. **Tunings live in an operator settings file**, a sibling of ADR 0029's `ladder.toml`
   (`~/.config/thread/rollouts.toml`): a defaults table and per-repo tables. Schedule resolves
   from it and stamps the resolved values into the rollout note, so each note records what it ran
   with. With no file, the built-in defaults apply.
5. **Automatic adjustment comes later, by ADR.** Once three or more Retros agree on a rule (e.g.
   "Integration lane under 50% busy and no quota stall → +1 Slot"), that rule may move into the
   engine as a live adjustment, recorded in its own ADR.

Considered:
- *Decision 1:* deriving the timeline on demand from notes, transcripts and journals (no new
  writes, but fragile: it misled the first reading, and transcripts move and compact); a
  lead-written metrics section in the rollout note (model-written, so it drifts out of schema).
- *Decision 2:* hard-coding the estate path (breaks the plugin for other users); a file in each
  target repo (cross-repo comparison means collecting from many places, worktrees complicate it).
- *Decision 3:* live auto-adjust now (fast, but the engine would change itself on unvalidated
  rules); wall-clock to drain, cost per merge, or a scorecard with no headline as the objective
  (noisy, the wrong scarcity, or never decisive).
- *Decision 4:* project-note frontmatter (engine knobs in vault notes, keyed by project not repo);
  a repo `CLAUDE.md` line (every Tuning becomes a slow PR on the target repo).

## Consequences

- Scope is the rollout lane plus review loops; other thread verbs may emit to the same format later.
- The template's "Resource budget" figure ("Lachy's M3 96GB, 3-4") becomes a Retro output, not
  prose; the machine is an M2 Max, 12 cores, 96 GB.
- The spike's open question (a cross-call cap on concurrent Workflow calls, untested past 3) is a
  first Retro's job to answer when a Tuning first raises a ceiling past 4.
