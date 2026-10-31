# 0060 — Verify names its diff base

Date: 2026-10-31
Status: accepted. Built in thread-skill-p34-3 (Phase 34 · Task 3, `thread-skill-p34-3-the-race-re-verify-reaches-from-the-merge-parent`); its plan chose shape 1 of the task note's two.

## Context

Chorus ADR 0107's p86-5 amendment ("A RACE re-verify is fast-tier only") records the gap. From p86-5 Chorus's `verifier:` is a declared fast tier plus a reach: `scripts/test --reach origin/main …` reads `git diff origin/main...HEAD` and keeps the slow tests that diff reaches. execute § 4.5's RACE procedure (merge-task's exit 5: merged, but as an unverified combination) re-runs that verifier through `lead-integrate.py verify --detach-at <the merge commit>`. By then `merge-task.sh` has refreshed `origin/<default>` to hold the merge, as it does on every MERGED path, so the reach reads an empty diff and the guard for "main holds a combination nobody verified" runs the fast tier alone. Only the completion run, after every other merge, runs the slow tier over that combination.

The verifier is opaque to the engine, and `origin/<default>` is a ref every worktree of the repo shares.

## Decision

`lead-integrate.py verify` gets a project-neutral contract. Whenever `--diff-base REV` is given, every step it runs (the env bootstrap, the verifier, and the Flake check's named re-run and confirming run, on every Heat-hold pass) runs with `THREAD_VERIFY_BASE=<REV resolved to its 40-hex sha in the tree>`. Without `--diff-base`, the variable is removed from the steps' environment, whatever the caller's; a REV that does not resolve leaves it unset and logs `verify: WARN --diff-base REV does not resolve in the tree; THREAD_VERIFY_BASE not set`, the verdict unchanged. Only the steps' environment carries it: verify's own git calls are unaffected.

Both lead call sites already pass `--diff-base`: the Integration verify passes `<mainSha>` and the RACE re-verify `'<the merge commit>^1'`, the main the task merged onto (a squash's one parent included). The completion verify (`--outcome`) refuses `--diff-base`, so it never sees a base. A fast tier's reach reads `THREAD_VERIFY_BASE` as its base when it is set and falls back to its own default (`origin/<default>`) otherwise. `origin/<default>` never moves for this.

## Considered options

- **Run `completion_verifier:` for the RACE re-verify** (the task note's shape 2). Simple and project-neutral, but it runs Chorus's 24 to 40 minute full suite under the RACE's `--timeout <verify_timeout>`, the fast tier's bound: rc 124 and then a spurious RACE revert, unless `completion_timeout`, the slot-wait arithmetic and the Flake check's confirming run (a second full suite inside the 7200 s harness bound) were all reworked. Refused.
- **Move or pin `origin/<default>`** back to the merge commit's first parent for the re-verify. It is a shared ref across every worktree and peer lead, and merge-task's refresh is right: it must hold main. Refused.
- **A `{base}` placeholder in `verifier:`**. The engine's agents run the same `verifier:` string in their own task trees, and the Inert proof reads it as text; both would have to learn the placeholder. Refused.

## Consequences

- A RACE re-verify on a reach-shaped fast tier checks the slow tests the merged task reaches, once the project's reach reads the variable. The Integration verify gains the same: a peer's merge-task refreshing `origin/<default>` mid-run no longer changes what it reaches.
- A project's reach must opt in. The variable is inert for any project that does not read it, so a project with no reach runs byte-identically. schedule's *completion verifier* paragraph tells project authors.
- `THREAD_VERIFY_BASE` is a public, cross-repo contract. The Chorus follow-up, `chorus-the-reach-honours-thread-verify-base`, makes its `tests/conftest.py` `_reach` honour it and updates Chorus ADR 0107's "A RACE re-verify is fast-tier only" bullet; until it lands Chorus's RACE re-verify stays fast-tier only.
- `tests/run.sh` unsets the variable at top level, so thread-skill's own Integration verify of `make test` never hands its base to the inner suites.
