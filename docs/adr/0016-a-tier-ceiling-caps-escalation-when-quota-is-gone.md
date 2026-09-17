# 0016 — a tier ceiling caps escalation when the quota is gone (amends 0006)

Date: 2026-09-17
Status: accepted

## Context

ADR 0006 ends "There is no config switch." That was right about the decision it was
guarding: nobody should be able to turn *evidence-driven escalation* off because they
think a task is easy, because the evidence outranks the guess.

It did not anticipate the case that broke a live rollout on 2026-09-17. The account's
weekly Fable quota hit 100% mid-run, and every judge spawn died with "You've reached your
Fable limit". The engine reported four plan-blocks that were nothing of the kind. Under
0006 as written the rollout had no legal state: an opus seed escalates on its first hard
signal, and the escalation target does not exist. The choice was not "a weaker run versus
a stronger one" but "a capped run versus no run for three days".

## Decision

`args.maxTier` caps every tier decision for a run. Absent or empty means `fable`, which is
the pre-ceiling behaviour byte for byte. The switch names a **resource fact**, never a
judgement about a task — that distinction is what keeps 0006 intact.

Three consequences are load-bearing, and the first is the one that makes the ceiling honest:

1. **A capped tier is terminal, and a terminal tier runs the full Ralph loop.** The
   one-shot verification block is a *hand-over protocol*: run once, commit, hand the
   worktree to a stronger tier. Under a cap there is nobody to hand to. Rendering the
   one-shot anyway — which the first implementation did — buys one verifier pass and zero
   fix iterations, so the cap would deliver a strictly weaker run rather than the same run
   on a cheaper model. A clean-room review caught this while the degraded run was in
   flight; it was stopped and re-dispatched. `verifyBlock` now selects on terminality, not
   on the tier name.
2. **Effort is not capped.** A tier is a (model, effort) bundle (ADR 0007), but only the
   model is quota-scarce. Once a cap suppresses an escalation, the task takes the higher
   tier's effort row — the capability still available to pay for.
3. **A suppressed escalation is recorded** as `tierCapped` on the result. ADR 0006's triage
   invariant — a block is a genuine wall or an input-gated decision, never "the cheap model
   wasn't enough" — holds only in an uncapped run. A `tierCapped` block is explicitly not
   evidence of a wall, and is re-dispatchable uncapped once quota returns. Nothing stamps
   `model: fable` on a note for a tier the run could not use.

An unrecognised `maxTier` value caps at the strict tier and logs, rather than falling
through to uncapped. The failure it guards is spending a quota the account does not have,
so a typo must not silently lift the ceiling.

## Considered Options

- **Wait for the quota window.** Honest, and correct when nothing is urgent. Rejected as
  the only option: the reset was three days out on one account and the rollout's deadline
  was the following Monday's scheduled run.
- **Pre-stamp every task `model: opus` and delete the step-ups.** Loses the planning-time
  judgement permanently to fix a transient resource condition, and still escalates at run
  time, so it does not even work.
- **Let the fable spawns fail and treat the deaths as transient.** What actually happened
  before the ceiling. The engine's transient-death handling reported plan-blocks with a
  "re-dispatch cleanly" diagnosis that was false — re-dispatching hit the same wall.
- **Route the run to another account with quota.** Rejected: crosses an account boundary
  the estate's rules put under the user's control, not an agent's.

## Consequences

ADR 0006 stands unamended for the uncapped case, which is the default and every scheduled
run. `CONTEXT.md` § Model tiering gains **Ceiling** as a distinct term from Step-up and
Escalation. The skill resolves `max_tier` from rollout frontmatter into `args.maxTier`, so
the knob is reachable through the documented dispatch path rather than by hand-editing a
tool call. A rollout that ran capped should be re-read with `tierCapped` in mind before its
blocks are treated as walls.
