# 0029 — escalation climbs the operator's ladder

Date: 2026-09-30
Status: proposed (supersedes ADR 0024's `top-tier` file and absorbs task p7-1's first two questions;
amends ADR 0006's single opus→fable flip, ADR 0007's engine-fixed effort matrix and ADR 0016's
ceiling; grilled with Lachy while scheduling chorus-rollout-2026-09-30, re-grilled the same day in
thread-skill)

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

1. **One operator-held ladder.** `~/.config/thread/ladder.toml` lists **rungs**, bottom first. A
   rung is a model plus its efforts: `effort` (planner, plan-reviser, implementer, reviser,
   investigator), `judge` (plan judge) and `review` (master review). Rungs may share a model, so an
   effort step and a model step are the same kind of move. The **top rung** is the ceiling: it
   replaces ADR 0024's `top-tier` file and the rollout's `max_tier:`. Exhausted quota (ADR 0016) is
   now an edit to the file. A model is named by its tier alias, never a version. If the file is
   absent, the plugin's built-in ladder applies, which is today's behaviour (opus at
   `medium`/`high`/`high`, then fable at `high`/`high`/`xhigh`), so other users see no change.
2. **Lachy's ladder** is two rungs, Opus at `high`/`high`/`xhigh` then Opus at `xhigh`/`high`/`xhigh`.
   No rung uses `max`.
3. **Escalation climbs one rung, once per stage.** Each stage (plan, implement, review) climbs one
   rung the first time it shows trouble, sticky for the rest of the task and never past the top: at
   most three climbs. The evidence is today's: the planner's failed first pass or the first plan
   rejection, a red one-shot verifier or a first-pass block, the first review rejection. A gate
   stop (ADR 0008) and a dead agent are not evidence, as today. On a task already at the top rung
   a climb is a no-op, recorded as such. ADR 0006's shape holds per stage: a first pass below the
   top rung verifies one-shot, and the retry after its climb, like every pass on the top rung, runs
   the full Ralph loop (a top-rung retry keeps today's short `CAPPED_RETRY_ITERATIONS` budget).
4. **A task may start higher, never elsewhere.** Per-task `rung: N` is the planning-time step-up,
   replacing `model: fable`. The per-task `effort:` hatch is retired: every setting a task holds is
   a position on the operator's ladder, so none can leave it. Stray `effort:` and `model:` stamps are
   ignored, and stripped when a rollout is regenerated.
5. **Integration runs on the top rung** (ADR 0030), whatever rung the task reached.
6. **The ladder is read at each task's start.** Under the Queue (ADR 0030) each task is its own
   Workflow call, and its args carry the ladder as it stood when it started. A resume re-passes
   those args unchanged (execute's resume contract). An edit to the file reaches every task that
   starts after it, never one in flight.
7. **The record.** A task's result carries `startRung`, `rung` (where it ended) and `climbs` (the
   stages that climbed, a no-op climb included). The report reads the ladder to name each rung.

Considered: two separate lists, models and efforts, with a rule for which to climb first (an extra
ordering rule, and the judge efforts need a home); climbing once per task, as 0006 does today (a
ladder above two rungs is then reachable only by a starting rung); climbing on every failure to the
top (the spend lands on the tasks already looping); keeping `effort:` as a floor clamped to the
ladder (two ways to say one thing, which can disagree); the first draft's capped-only `high` to
`xhigh` with `max` as a hatch (hard-coded, and `max` is weak on Opus 5.5).

## Consequences

- The engine's `EFFORT` matrix and `TOP_TIER` become the built-in default ladder, not the only one.
  ADR 0007's "the matrix is a stance, not config" holds at the rollout level: there is still no
  rollout- or task-level effort knob. The stance moves to the operator, where 0024 already put the
  ceiling.
- **Rung** replaces **Tier** in the glossary; Top tier and Ceiling become the top rung.
  `tierCapped` goes: a climb at the top is a recorded no-op.
- p7-1 is absorbed: the file is read at each task's start, and a resume keeps its args. Its third
  question (how a block at the top rung is triaged, 0016's "wait for quota" reading) stays open.
- Supersedes protocol 4's ADR 0021 (on `codex/thread-rollout-redesign`, never landed on master),
  which routed by a shared workspace policy and climbed to maximum effort before changing model.
  Lachy's stance is the reverse (`max` is weak on Opus 5.5), and the ladder is a thread-owned file.
  Its sound parts carry over: settings are fixed for a task's run, and the record keeps what was
  asked for apart from what ran. The shared policy (a workspaces ADR) never landed either.
- AGENTS.md § Model tier is locked to Lachy's hand edits. The pointer text to the ladder file is
  proposed to him, never written.
- Schedule stops offering `model: fable` and `effort:` stamps; it offers a starting rung for a task
  it judges hard, confirmed in the same batch as today's step-ups.
