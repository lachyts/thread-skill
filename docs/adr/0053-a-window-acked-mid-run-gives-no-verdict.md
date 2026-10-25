# 0053 — A window acked mid-run gives no verdict

Date: 2026-10-24
Status: accepted. Ruled with Lachy in the verify-and-canary follow-ups grill (the vault task `thread-skill-the-verify-and-canary-structural-follow-ups`, item 1); the RACE, integrate-call and PR-less task routes ruled after the build's first review round. Amends ADR 0030's canary exit codes and execute's "a re-verify is never re-run automatically after a human-visible git-env halt"; replaces ADR 0052's trip-line count.

## Context

A git-env `ack` re-baselines every open window whose owner still holds to `armed` at the ref it reads, so the window's later `check` compares against the acked state and reads clean. On an Integration verify or a RACE re-verify that leaves a hole: the lead halts on the trip while the verify runs on in the background, Lachy acks through `/thread:repair`, the resumed lead reads the rc, `check` exits 0, and the lead pushes or marks done on a run made while the checkout changed under it. Execute's "a RACE rc after a git-env halt in this session is never acted on" lives in the session and does not survive the resume. The completion verify worked around it by counting its window's trip lines before the arm and after the check (ADR 0052 Consequences); the other window kinds had no workaround.

## Decision

**The canary record remembers a trip across the ack, and `check` reports it as its own exit: 4, the window's run gives no verdict.**

- `ack` re-baselines an open tripped window as before, and keeps that window's trip line on its record (`ackedTrips`), so the memory lives with the window, not in the lead's session; a resume's arm over the same still-open window keeps it too.
- `check` exits 4 when its own window's record carries an acked trip and nothing else is wrong. Exit 3 (a trip or a hold that still stands) wins over 4; 0 means the window saw nothing. `check-all` and `arm` never exit 4: they speak for the rollout, not one window.
- Exit 4 never halts, and every verdict the window produced is run again, automatically:
  - the Integration verify `undo`es its merge and goes back to `prepare` with the lane held;
  - a RACE re-verify logs that it gave no verdict and re-runs, the one automatic re-run after a git-env halt Lachy has seen (the ack came before the check, so nothing is left for him to decide);
  - an integrate call's `integrated` row is voided: `reconcile-rollout.py void-integration` frees the lane and appends a `void` Integration-log line, so the record no longer backs `prepare`'s case (ii), a merge with no verifier, and the task is integrated again. A `rejected`, review-blocked or set-aside row is acted on as usual: none is a verdict to merge on;
  - the completion verify records no verdict (ADR 0052), now read from the exit instead of a line count.
- A task call treats 4 as 0, with a PR or without (a read-only task): its agent worked in its own tree cut from origin, never in the shared checkout, Lachy's ack accepted the change, and a PR is verified again at its own Integration.

## Considered options

- **Exit 0 with a stdout marker** (`acked trip(s) in window: N`), each caller parsing it: no exit-code change, but a caller that misses the marker brings the defect back silently.
- **Hand the RACE and the integrate call to Lachy** (RACE undecided, a set-aside at Integration), which needed no new mechanism: rejected for an overnight run that would then wait on him for a decision with nothing left to decide.
- **Treat the integrate call and the RACE as 0**, since their verifiers ran in trees cut from origin: rejected, as it reopens the hole for the two kinds closest to a merge.
- **Re-trip at the check**: a fresh trip line (exit 3) for a window acked mid-run, so Lachy acks again once the run ends. No new exit code, but one event costs an overnight run two waits on him.

## Consequences

- Every caller of `check` learns exit 4; the lead's exit rule ("any non-zero exit halts") gains its one exception.
- The Integration log gains a `void` outcome. Only `integrated` backs a record, so every reader that keys on an outcome passes it by.
- `completion-verify --run` drops `_git_env_trips` and its before-and-after count of the window's trip lines.
- A record written before this change has no `ackedTrips` and reads as none: records are per-rollout and deleted at `retire`, so no migration.
