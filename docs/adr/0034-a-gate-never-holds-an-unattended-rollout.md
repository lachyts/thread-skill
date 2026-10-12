# 0034 — a gate never holds an unattended rollout

Date: 2026-10-13
Status: proposed, implementation pending (amends ADR 0008, where a gated input always pauses the rollout until
sign-off; from the 2026-10-13 orient grill of `thread-skill-p18-2-a-gate-never-holds-the-rollout`)

## Context

`[[chorus-rollout-2026-10-10]]` ran 44 h 28 m. One task, `chorus-p18-7-fast-while-held`, declared two spend
gates (a US$5 probe; fast mode at US$50 per Login per month) in the run's first hour. The push never reached
Lachy, the rest of the queue merged, and the rollout went `stuck` on the gate and waited overnight: about 42 h
from the gate being known to his answer. An approval matches the planner's exact gate text (execute § 3.7), so
nothing can be signed before a plan words its gate; some gates will always first appear mid-run.

## Decision

1. **A standing approval.** Lachy signs, once, every spend gate whose total exposure is at most US$50: the cap
   summed across Logins, a recurring cap counted per month, US$50 itself included. Such a gate passes without
   him and is written to `## Approved gates` as auto-approved under the standing rule. Credential and
   irreversible gates never pass under it. The threshold lives in the operator settings (`rollouts.toml`), not
   in the skills. Under this measure p18-7's US$5 probe passes and its fast-mode gate (about US$150 a month)
   asks.
2. **Ask ahead.** A gate the standing approval does not cover is asked before dispatch wherever the work is
   shaped (the grill, orient, schedule's confirm batch), and his answer is recorded on the task.
3. **A gate found mid-run is set aside, never held.** The task is set aside and pushed once; the queue runs
   everything else and the completion ceremony runs with that task listed as waiting on him. His later
   sign-off resumes it in a new run. A rollout never sits `stuck` on a gate alone.

## Considered options

- *Set aside but hold the rollout open* until sign-off: keeps today's `stuck`, minus the blocking.
- *Front-load gate-smelling tasks* so gates fire while he is at the Mac: a heuristic, not a guarantee; it may
  still be used as an ordering hint but is not the rule.
- *Cap read literally, per Login*: would let three Logins at US$49 a month pass as "under US$50".
