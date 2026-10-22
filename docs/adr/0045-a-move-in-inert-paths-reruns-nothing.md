# 0045 — A move in inert paths re-runs nothing

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18`, built by P29. Amends ADR 0030 decision 3, which rejected skipping the re-verify when the landed commits are docs only because tests can read docs: a repo's proven list answers that per repo.

## Context

Integration re-runs the verifier whenever `main` moves under it (merge-task's exit 3). On 2026-10-21 p85-1's 40-minute suite ran again because a peer session pushed `THREAD.md`, a file no Chorus test reads, and an earlier run of the same task had timed out under load with no failure. Peer close-outs, handoff docs and review docs move `main` many times a day without changing anything the verifier can see.

## Decision

**A `main` that moved only in a repo's Inert paths since a green verifier run leaves that run standing: Integration re-runs nothing and merges.**

- **Inert paths are per repo**, in the operator's rollout settings (`~/.config/thread/rollouts.toml`), and empty by default, so a repo nobody has checked always re-runs.
- **Schedule proposes them.** It offers globs (git pathspec globs; for Chorus: `THREAD.md`, `docs/handoffs/**`, `docs/reviews/**`) once the proof below passes, and records them on Lachy's yes, once every running rollout's snapshot knows the key (ADR 0043).
- **The proof runs again at every skip, on the exact tree being merged** (the task's diff on the new `main`), over the whole repo's code: the tests, the verifier's steps and the code they exercise. Any reader of a matching path means a re-run, and so does anything that walks the tree under a glob (a link-check of every `*.md`, a recursive glob), which names no path. So a peer's push, the task's own diff and a source file that starts reading an inert path are all caught at the merge they would affect, never a schedule later.
- The check is a path test on what changed between the green run's base and the new `main`; a file moved into an inert path still counts at the path it left, and one non-inert path means a re-run.

## Considered options

- **A fixed built-in list** (THREAD.md and the doc folders everywhere): rejected. Thread-skill's own tests read its markdown (the SKILL.md wiring assertions), so a blanket "docs are inert" is wrong for the very repo that ships the rule.
- **Never skip, rely on a Merge train (ADR 0044, deferred) and a faster suite:** rejected. A peer's close-out would still cost a full suite.

## Consequences

- A glob that fails its proof at a skip only costs that merge a suite; schedule drops a glob that keeps failing.
- A wrong list merges a combination nobody verified. The proof at schedule is the guard, and the Run record logs every skipped re-run with its diff, so an Escape traced to one is visible to a Reflection.
