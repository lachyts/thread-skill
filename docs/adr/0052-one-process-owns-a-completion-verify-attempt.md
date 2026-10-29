# 0052 — One process owns a completion verify attempt

Date: 2026-10-24
Status: accepted. Ruled with Lachy in the completion verifier grill, after the build on `chorus/build-thread-skill-s-completion-verifier-tonight` hit the fresh-review STOP rule twice (rounds 3 and 6). Extended to serial chains by ADR 0055.

## Context

The completion verifier (the vault task `thread-skill-the-rollout-runs-its-full-suite-at-completion`) runs a project's full suite once on merged main at the completion ceremony. The first build drove each attempt as separate loop entries: the lead read the state, armed the git-env canary, launched `lead-integrate.py verify` in the background, and on its return ran the canary `check` and then a separate `--record`. Any entry (another session, a heartbeat tick, a resume) could find an attempt between those steps, so the reader grew a `record` state, the record a claim and a lock, and the canary rules about who checks a window and when. About 18 findings across review rounds 2, 4, 5 and 6 came from that seam: a finished run relaunched, attempt 1's rc recorded as attempt 2's, a closed window checked again, a run recorded after a git-env trip was acked, the same run recorded twice. Round 6's regressions all came from the claim-first record that was meant to close it.

## Decision

**`reconcile-rollout.py completion-verify --run` owns one attempt end to end under the attempt's lock: it works out the sha, tree, out and default branch, arms the canary, runs `lead-integrate.py verify --outcome`, checks that window once, classifies, records, and prints one JSON line. The lead only reads the state, launches `--run` in the background on `run` or `rerun`, and reads again when it ends.**

- One attempt per process. A red attempt 1 reads `rerun`, and the lead launches `--run` again; `--run` re-runs it on the red run's own sha. Each background command fits one deadline inside the harness's 2 h cap: its own `completion_timeout:` (default 3600 s, validated like `verify_timeout`, the slot wait taking the rest), never `verify_timeout`, which a project with a fast tier sets for that tier, so a full suite under it would deadline red every rollout.
- The record's commit point is its `## Completion verify log` line: the log moves and a final red's fix task are written before it, the Run record event after it. A process that dies before the line leaves a free lock and no line, which reads as the same attempt still to run. A dead attempt never counts toward the three-in-a-row no-verdict halt.
- A git-env trip during the attempt, its own check's or a loop-entry `check-all`'s that was acked meanwhile, records no verdict (RACE's rule: an rc after a git-env halt is never acted on).
- verify runs as `--run`'s child, never inside its process, and inherits the attempt's lock: no signal state is shared, and a `--run` killed outright still holds the attempt until its verify ends. A stop signal to `--run` is forwarded to verify once, and the run records `stopped` whatever it ends with.
- **A completion Flake files no task.** This amends ADR 0050's "filed as a follow-up for its repo" for the completion verify alone, as the brief rules: the `rerun` line names attempt 1's failing ids, so a test that flakes again shows in the log.

## Considered options

- **Keep the multi-entry shape and fix round 6's findings in place:** rejected. Each round's fixes to that seam drew more regressions than they fixed.
- **verify inside `--run`'s own process** (the first build of this shape): rejected after review rounds 2, 4 and 5 kept finding signal state leaking between the two (dispositions left ignored, a TaskStop swallowed during cleanup, a second signal escaping as a refusal).
- **Both attempts in one process,** so the lead only ever sees decided results: rejected. A 40-minute suite run twice, plus slot waits, can go past the 2 h background cap, and a `rerun` read is cheap.

## Consequences

- Attempt 2 runs the note's command as it is when it starts, and resolves the default branch through origin as attempt 1 does. An edit to the command between attempts is the operator's own act, and an origin outage halts the ceremony, which re-invocation clears.
- A git-env trip inside an attempt's window is found by counting the canary's own trip lines for that window before the arm and after the check, because the canary's `ack` re-baselines an open window. A trip memory in the canary record, which `check` would report for every window kind, is the deeper fix and is left to its own task. ADR 0053 built it: `check` now exits 4 for a window acked mid-run, and the count is gone.
