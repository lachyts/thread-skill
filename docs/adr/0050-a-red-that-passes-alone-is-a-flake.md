# 0050 — A red that passes on its own re-run is a Flake

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the re-grill of PR #202, after an audit of where rollout time went. Amends ADR 0030 decision 3's Integration verify, which reads any red as red.

## Context

In `chorus-rollout-2026-10-18`, 6 of 9 Integration suites the lead ran failed on one timing test outside every diff, under load. Each red cost another full suite (20 to 50 minutes), and conflict Integrations that chased such reds took about 17 hours across three tasks; one integrator (p84-8) wrote a fix for the timing test inside its own task. Execute has no notion of a flaky test: a red is a re-verify or a set-aside. ADR 0049's Away cap makes such reds rarer, not impossible.

## Decision

**When an Integration verify is red only on tests the task's diff does not touch, those failing tests are re-run once on the same tree. If they pass, the verify counts green and each such test is a Flake: logged, and filed as a follow-up for its repo, never fixed inside the task. A failure that repeats is red.**

- A failing test the diff touches is red, as today.
- A repo whose verifier cannot re-run named tests keeps today's rule.

## Considered options

- **A quarantine list** each repo's Integration verify ignores: rejected. Faster, but a listed test can hide a real break for as long as it stays listed.
- **Red is red, and fix flakes at the source** (the Away cap, Chorus P86): rejected as the whole answer. Both reduce flakes; neither ends them, and every one left costs a suite.

## Consequences

- An intermittent real failure can pass its one re-run and merge. The Flake log is where it shows up again, and a test logged as a Flake twice is the repo's to fix.
