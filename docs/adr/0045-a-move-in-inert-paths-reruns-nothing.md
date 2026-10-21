# 0045 — A move in inert paths re-runs nothing

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Amends ADR 0030 decision 3, which rejected skipping the re-verify when the landed commits are docs only because tests can read docs: a repo's proven list answers that per repo.

## Context

Integration re-runs the verifier whenever `main` moves under it (merge-task's exit 3). On 2026-10-21 p85-1's 40-minute suite ran again because a peer session pushed `THREAD.md`, a file no Chorus test reads, and an earlier run of the same task had timed out under load with no failure. Peer close-outs, handoff docs and review docs move `main` many times a day without changing anything the verifier can see.

## Decision

**A `main` that moved only in a repo's Inert paths since a green verifier run leaves that run standing: Integration re-runs nothing and merges.**

- **Inert paths are per repo**, in the operator's rollout settings (`~/.config/thread/rollouts.toml`), and empty by default, so a repo nobody has checked always re-runs.
- **Schedule proposes them and proves them.** It offers globs (for Chorus: `THREAD.md`, `docs/handoffs/**`, `docs/reviews/**`) only after showing that no test and no verifier step reads a matching path, and records them on Lachy's yes.
- The check is a path test on the diff between the green run's base and the new `main`, with rename detection off (`--no-renames`), so a file moved into an inert path still counts at the path it left. One non-inert path means a re-run.

## Considered options

- **A fixed built-in list** (THREAD.md and the doc folders everywhere): rejected. Thread-skill's own tests read its markdown (the SKILL.md wiring assertions), so a blanket "docs are inert" is wrong for the very repo that ships the rule.
- **Never skip, rely on the Merge train and a faster suite:** rejected. A peer's close-out would still cost a full suite.

## Consequences

- The proof holds for the tests and verifier steps of its day. A later one that reads an inert path makes the list wrong, so schedule proves a repo's recorded list again each time it schedules there, and drops a glob that no longer passes.
- A wrong list merges a combination nobody verified. The proof at schedule is the guard, and the Run record logs every skipped re-run with its diff, so an Escape traced to one is visible to a Reflection.
