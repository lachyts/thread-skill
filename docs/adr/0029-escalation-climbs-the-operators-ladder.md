# 0029 — escalation climbs the operator's ladder

Date: 2026-09-30
Status: accepted, shipped in 3.0.0 (supersedes ADR 0024's `top-tier` file and absorbs task p7-1's first two questions;
amends ADR 0006's single opus→fable flip, ADR 0007's engine-fixed effort matrix and ADR 0016's
ceiling; grilled with Lachy 2026-09-30)

## Context

Since ADR 0024 the operator's top tier caps every rollout, and Lachy runs everything on Opus 5.5.
Under that cap every task is terminal: it takes the top row of the engine's `EFFORT` matrix from its
first pass and never escalates, because escalation (ADR 0006) only ever meant a change of model. A
task that fights (rejected, red, plan-blocked) gets exactly the effort of one that sails through.
Lachy asked: *"can the effort level start at high and only be escalated when it needs to be."*

A first draft of this ADR answered with a second, hard-coded ladder for capped tasks (`high` to
`xhigh`, `max` as a hand-set hatch). Grilling it exposed that the model ladder, the effort matrix and
the top tier were three separate hard-coded or prose-held facts, each needing an edit or a release
whenever a model arrives or proves weak (Lachy: `max` on Opus 5.5 is not effective), and that the
per-task `effort:` hatch silently disabled escalation: all 53 Chorus tasks carried `effort: high`.
Lachy: *"make it malleable so that next time there are new models and different capabilities, we
have some sort of settings file."*

## Decision

1. **One operator-held ladder.** `~/.config/thread/ladder.toml` lists named **rungs**, bottom
   first. A rung is a model (a tier alias, never a version) plus the efforts of the code-writing
   roles, the plan judge and the master review. Rungs may share a model, so an effort step and a
   model step are the same kind of move. The **top rung** is the ceiling, replacing ADR 0024's
   `top-tier` file and the rollout's `max_tier:`; exhausted quota (ADR 0016) is an edit to the
   file. With no file, the built-in ladder applies.
2. **The built-in ladder names no model above Opus**: two Opus rungs, the code-writing roles at
   `high` then `xhigh`, and no `max`. A machine without the file therefore cannot leave the Opus
   lock, and Fable runs only when a file names it. Other users lose the automatic climb to Fable,
   which 3.0.0's release notes announce.
3. **Escalation climbs one rung, once per stage.** Each stage (plan, implement, review) climbs one
   rung at its first evidence of hardness (ADR 0006's list; a gate stop and a dead agent are not
   evidence), sticky and never past the top; on the top rung a climb is a recorded no-op. ADR
   0006's shape holds per stage: a first pass below the top verifies one-shot, and a retry after a
   real climb, like every pass on the top rung, runs the full loop.
4. **A task may start higher, never elsewhere.** A task's `rung:` names the rung it starts on: the
   planning-time step-up, replacing `model: fable`. Reconcile stamps the rung a task reached, so a
   re-dispatch starts there, and a stamp naming a rung the file no longer has is reported as drift
   and read as the top rung. The per-task `effort:` hatch and the run-level `judgeModel` pin are
   retired: judges run on the task's current rung.
5. **Integration runs on the top rung** (ADR 0030), whatever rung the task reached.
6. **The file is read at the start of each Workflow call** and fixed for that call. A resume keeps
   its call's settings, so an edit reaches a task at its next call.
7. **The record.** A task's result records its starting rung, the rung it ended on, the stages that
   climbed and what each call actually ran.

Considered:
- *Decision 1:* two separate lists, models and efforts, with a rule for which to climb first (an
  extra ordering rule, and the judge efforts need a home); keeping `effort:` as a floor clamped to
  the ladder (two ways to say one thing, which can disagree).
- *Decision 2:* opus-then-fable as the built-in (it fails open to Fable wherever the file is
  missing); a rollout-level cap beside the ladder (the ceiling in two places); Fable 5.1 as a third
  rung (researched 2026-09-30: since Opus 5.5 it ties or trails on most published coding results at
  2.5x the token price and a separate weekly cap, and nothing has measured it on these tasks; a
  blind replay of hard rollout tasks decides, and a win is one line in the operator's file).
- *Decision 3:* climbing once per task, as ADR 0006 does (a ladder above two rungs is then reachable
  only by a starting rung); climbing on every failure straight to the top (the spend lands on tasks
  already looping); the first draft (see Context).
- *Decision 4:* stamping rungs by position (inserting a rung silently re-points every stamp).
- *Decision 6:* a snapshot at the task's start, clamped on resume (a rung swapped for another model
  slips past the clamp, and a cold resume has no snapshot); one read per rollout (a quota edit then
  needs a relaunch).

## Consequences

- The engine's `EFFORT` matrix and `TOP_TIER` give way to the built-in ladder. There is still no
  rollout- or task-level effort knob: ADR 0007's stance moves to the operator, where ADR 0024
  already put the ceiling. `tierCapped` goes.
- p7-1's third question (how a block at the top rung is triaged, ADR 0016's "wait for quota"
  reading) stays open.
- Supersedes protocol 4's `0021-shared-effort-first-routing.md` (on `codex/thread-rollout-redesign`,
  never landed on master), which routed by a shared workspace policy and climbed to maximum effort
  before changing model. Its sound parts carry over: settings are fixed for a call, and the record
  keeps what was asked for apart from what ran.
- Until the ladder is built, `max_tier: opus` stays the Opus lock. Execute prints the ladder it
  resolved (the file's path, or `built-in`) at every launch.
- AGENTS.md § Model tier is locked to Lachy's hand edits. The pointer text to the ladder is proposed
  to him, never written.
- Schedule offers a starting rung for a task it judges hard, in place of `model: fable` and
  `effort:` stamps; regenerating a rollout maps a `model: fable` stamp to the top rung and strips
  `effort:`.
